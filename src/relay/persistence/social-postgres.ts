import type { Pool, PoolClient } from 'pg';

import { relayError, type RelayResult } from '../protocol/errors';
import {
  defaultPrivacySettings,
  type Conversation,
  type ConversationReadState,
  type FriendRelationship,
  type FriendRequest,
  type Message,
  type Party,
  type PartyInvite,
  type RecentPlayerEntry,
  type SocialBlock,
  type SocialMute,
  type SocialOperationId,
  type SocialPrivacySettings,
  type SocialReport,
  type SocialUserId,
  type UserPresence,
  type UserProfile,
} from '../social/social-contracts';
import { applySocialOperation, type SocialCommandInput } from '../social/social-commands';
import { emptySocialState, hasUser, type SocialState, type SocialUserRecord } from '../social/social-state';
import { ensureSocialUser, newRelayDog, tellAfterCommit, viewerCursor, type SocialAfterCommit, type SocialEventPage, type SocialPlayerIdentity, type SocialStore } from '../social/social-store';
import { emptyWorldState, type WorldState } from '../social/world-presence';
import { protectedStoreWriterGuard } from './protected-store-writer-guard';

/**
 * WONDERLAND SOCIAL, DURABLE: the social store over PostgreSQL (wonderland-migrations/033_wonderland_social.sql).
 *
 * ONE STATE IN MEMORY, EVERY CHANGE WRITTEN THROUGH. The domain rules are pure functions over one SocialState
 * (src/relay/social), so the bridge -- one process (Railway) -- holds that state, runs each command against it ONE AT A
 * TIME, and writes exactly the rows the command changed, in ONE transaction, before the new state is adopted. A command
 * whose write fails changes nothing and says so: "Saved" only after the durable write resolves (CLAUDE.md). A restart
 * reads every row back (`open`), so relationships, messages, read positions, parties, invites, profiles, privacy, the
 * presence a player chose and the id sequence all return; "connected" does not -- everyone is OFFLINE until their client
 * reports again.
 *
 * EVENTS ARE ROWS. A change concerning anyone writes `social_events` (operation, time, audience) in the same
 * transaction, so a client polling after a restart still finds what it missed, and the events cannot disagree with the
 * state they describe.
 *
 * A database that cannot be reached THROWS out of `open`, and the route answers 503: an outage is not an empty social
 * graph.
 */

const ISO = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());
const iso = (value: Date | string): string => new Date(value).toISOString();

/** Keyed by-reference diff: the domain makes a new object only for what it changed. */
function diffBy<T>(before: readonly T[], after: readonly T[], key: (t: T) => string): { put: T[]; drop: string[] } {
  const was = new Map(before.map((t) => [key(t), t]));
  const now = new Map(after.map((t) => [key(t), t]));
  const put: T[] = [];
  for (const [k, t] of now) if (was.get(k) !== t) put.push(t);
  const drop = [...was.keys()].filter((k) => !now.has(k));
  return { put, drop };
}

const pairKey = (a: string, b: string) => `${a}\u0000${b}`;

/* ------------------------------------------------------------------------------------------------------------ load */

async function loadState(client: Pool | PoolClient): Promise<SocialState> {
  const q = async <R extends Record<string, unknown>>(sql: string) => (await client.query<R>(sql)).rows;
  const profiles = await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_profiles`);
  const privacy = new Map((await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_privacy`)).map((r) => [r.player_id as string, r]));
  const presence = new Map((await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_presence`)).map((r) => [r.player_id as string, r]));
  const users: Record<SocialUserId, SocialUserRecord> = {};
  for (const p of profiles) {
    const id = p.player_id as string;
    const profile: UserProfile = {
      userId: id,
      displayName: p.display_name,
      handle: p.handle,
      avatarRef: p.avatar_ref,
      nationId: p.nation_id,
      clanName: p.clan_name,
      progression: { source: 'PENDING', rank: null, level: null },
      primaryAgent: p.primary_agent,
      // 033 constrains relay_dog only NOT NULL: a row holding no object reads as the new player's Dog (an unregistered skin id in
      // an object is kept as stored and never served: resolveProfileFor shows only canonical skins)
      relayDog: p.relay_dog !== null && typeof p.relay_dog === 'object' && !Array.isArray(p.relay_dog) ? p.relay_dog : newRelayDog(),
      activeCompanion: p.active_companion,
      showcaseAgents: p.showcase_agents,
      showcaseCompanions: p.showcase_companions,
      stats: p.stats,
      memberSinceIso: iso(p.member_since),
    };
    const pv = privacy.get(id);
    const settings: SocialPrivacySettings =
      pv === undefined
        ? defaultPrivacySettings(id)
        : {
            userId: id,
            presenceVisibility: pv.presence_visibility,
            activityVisibility: pv.activity_visibility,
            locationVisibility: pv.location_visibility,
            privateServerVisibility: pv.private_server_visibility,
            messagePolicy: pv.message_policy,
            friendRequestPolicy: pv.friend_request_policy,
            serverJoinPolicy: pv.server_join_policy,
          };
    const pr = presence.get(id);
    const lastSeen = pr === undefined ? iso(p.member_since) : iso(pr.last_seen_at);
    const state: UserPresence = {
      userId: id,
      connected: false, // never stored: true only while a client is talking
      availability: pr?.availability ?? 'AVAILABLE', // the player's CHOICE: durable (the offline preference survives a restart)
      // WHAT THEY WERE DOING AND WHERE are the last session's, not the player's (Second, 10-07): the world is in memory and empty
      // after a restart, so a stored location names a context that no longer exists, and on signing in again a friend would see
      // it -- and the old activity -- until the client reported anew. Neither is in the restart-durable list; both start clean.
      activity: 'IDLE',
      activityDetail: null,
      location: null,
      partyId: null, // from the party record, below
      lastSeenAtIso: lastSeen,
      updatedAtIso: pr === undefined ? lastSeen : iso(pr.updated_at),
    };
    users[id] = { profile, privacy: settings, presence: state };
  }

  const friendships: FriendRelationship[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_friendships`)).map((r) => ({
    userA: r.user_a,
    userB: r.user_b,
    sinceIso: iso(r.since),
  }));
  const requests: FriendRequest[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_friend_requests ORDER BY created_at, request_id`)).map((r) => ({
    requestId: r.request_id,
    fromUserId: r.from_user,
    toUserId: r.to_user,
    status: r.status,
    createdAtIso: iso(r.created_at),
    resolvedAtIso: ISO(r.resolved_at),
  }));
  const blocks: SocialBlock[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_blocks`)).map((r) => ({ blockerId: r.blocker_id, blockedId: r.blocked_id, sinceIso: iso(r.since) }));
  const mutes: SocialMute[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_mutes`)).map((r) => ({ muterId: r.muter_id, mutedId: r.muted_id, voice: r.voice, messages: r.messages }));
  const reports: SocialReport[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_reports ORDER BY filed_at, report_id`)).map((r) => ({
    reportId: r.report_id,
    reporterId: r.reporter_id,
    reportedId: r.reported_id,
    reason: r.reason,
    note: r.note,
    subjectRef: r.subject_ref,
    filedAtIso: iso(r.filed_at),
  }));
  const recentPlayers: RecentPlayerEntry[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_recent_players ORDER BY met_at DESC`)).map((r) => ({
    ownerId: r.owner_id,
    userId: r.user_id,
    context: r.context,
    contextLabel: r.context_label,
    metAtIso: iso(r.met_at),
  }));

  const memberRows = await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_party_members ORDER BY joined_at, player_id`);
  const parties: Record<string, Party> = {};
  for (const r of await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_parties`)) {
    parties[r.party_id] = {
      partyId: r.party_id,
      name: r.name,
      leaderId: r.leader_id,
      members: memberRows
        .filter((m) => m.party_id === r.party_id)
        .map((m) => ({ userId: m.player_id, role: m.role, joinedAtIso: iso(m.joined_at), selfMuted: m.self_muted })),
      privacy: r.privacy,
      invitePermission: r.invite_permission,
      createdAtIso: iso(r.created_at),
      version: Number(r.version),
    };
  }
  for (const party of Object.values(parties)) {
    for (const m of party.members) {
      const user = users[m.userId];
      if (user !== undefined) users[m.userId] = { ...user, presence: { ...user.presence, partyId: party.partyId } };
    }
  }
  const partyInvites: PartyInvite[] = (await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_party_invites ORDER BY created_at, invite_id`)).map((r) => ({
    inviteId: r.invite_id,
    partyId: r.party_id,
    fromUserId: r.from_user,
    toUserId: r.to_user,
    status: r.status,
    createdAtIso: iso(r.created_at),
    expiresAtIso: iso(r.expires_at),
  }));

  const convMembers = await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_conversation_members ORDER BY player_id`);
  const conversations: Record<string, Conversation> = {};
  for (const r of await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_conversations`)) {
    conversations[r.conversation_id] = {
      conversationId: r.conversation_id,
      kind: r.kind,
      memberIds: convMembers.filter((m) => m.conversation_id === r.conversation_id).map((m) => m.player_id),
      title: r.title,
      partyId: r.party_id,
      createdAtIso: iso(r.created_at),
      lastSequence: Number(r.last_sequence),
      lastMessageAtIso: ISO(r.last_message_at),
    };
  }
  const readStates: ConversationReadState[] = convMembers
    .filter((m) => Number(m.last_read_sequence) > 0)
    .map((m) => ({ conversationId: m.conversation_id, userId: m.player_id, lastReadSequence: Number(m.last_read_sequence) }));
  const messages: Record<string, Message[]> = {};
  for (const r of await q<Record<string, any>>(`SELECT * FROM relay_wonderland.social_messages ORDER BY conversation_id, sequence`)) {
    (messages[r.conversation_id] ??= []).push({
      messageId: r.message_id,
      conversationId: r.conversation_id,
      sequence: Number(r.sequence),
      senderId: r.sender_id,
      kind: r.kind,
      body: r.body,
      ref: r.ref,
      sentAtIso: iso(r.sent_at),
    });
  }
  const serial = (await q<{ value: string }>(`SELECT value FROM relay_wonderland.social_meta WHERE name='next_serial'`))[0];

  return {
    ...emptySocialState(),
    users,
    friendships,
    requests,
    blocks,
    mutes,
    reports,
    recentPlayers,
    parties,
    partyInvites,
    conversations,
    messages,
    readStates,
    // no row until the first id is minted: migration 033 writes none (a bootstrap leaves every table empty)
    nextSerial: serial === undefined ? 1 : Number(serial.value),
  };
}

/* ----------------------------------------------------------------------------------------------------------- write */

/** 033's social_events CHECK(cardinality(audience) BETWEEN 1 AND 256): one event is written as as many rows as it needs. */
export const EVENT_AUDIENCE_MAX = 256;

async function writeUser(c: PoolClient, id: string, record: SocialUserRecord, before: SocialUserRecord | undefined): Promise<void> {
  const p = record.profile;
  if (before === undefined || before.profile !== p) {
    await c.query(
      `INSERT INTO relay_wonderland.social_profiles(player_id, display_name, handle, avatar_ref, nation_id, clan_name, relay_dog, primary_agent,
         active_companion, showcase_agents, showcase_companions, stats, member_since, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT(player_id) DO UPDATE SET display_name=EXCLUDED.display_name, handle=EXCLUDED.handle, avatar_ref=EXCLUDED.avatar_ref,
         nation_id=EXCLUDED.nation_id, clan_name=EXCLUDED.clan_name, relay_dog=EXCLUDED.relay_dog, primary_agent=EXCLUDED.primary_agent,
         active_companion=EXCLUDED.active_companion, showcase_agents=EXCLUDED.showcase_agents, showcase_companions=EXCLUDED.showcase_companions,
         stats=EXCLUDED.stats, updated_at=now()`,
      [id, p.displayName, p.handle, p.avatarRef, p.nationId, p.clanName, JSON.stringify(p.relayDog), p.primaryAgent === null ? null : JSON.stringify(p.primaryAgent),
        p.activeCompanion === null ? null : JSON.stringify(p.activeCompanion), JSON.stringify(p.showcaseAgents), JSON.stringify(p.showcaseCompanions),
        JSON.stringify(p.stats), p.memberSinceIso],
    );
  }
  const v = record.privacy;
  if (before === undefined || before.privacy !== v) {
    await c.query(
      `INSERT INTO relay_wonderland.social_privacy(player_id, presence_visibility, activity_visibility, location_visibility, private_server_visibility,
         message_policy, friend_request_policy, server_join_policy)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(player_id) DO UPDATE SET presence_visibility=EXCLUDED.presence_visibility, activity_visibility=EXCLUDED.activity_visibility,
         location_visibility=EXCLUDED.location_visibility, private_server_visibility=EXCLUDED.private_server_visibility,
         message_policy=EXCLUDED.message_policy, friend_request_policy=EXCLUDED.friend_request_policy, server_join_policy=EXCLUDED.server_join_policy,
         version=relay_wonderland.social_privacy.version+1, updated_at=now()`,
      [id, v.presenceVisibility, v.activityVisibility, v.locationVisibility, v.privateServerVisibility, v.messagePolicy, v.friendRequestPolicy,
        v.serverJoinPolicy],
    );
  }
  const s = record.presence;
  if (before === undefined || before.presence !== s) {
    await c.query(
      `INSERT INTO relay_wonderland.social_presence(player_id, availability, activity, activity_detail, location, last_seen_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(player_id) DO UPDATE SET availability=EXCLUDED.availability, activity=EXCLUDED.activity, activity_detail=EXCLUDED.activity_detail,
         location=EXCLUDED.location, last_seen_at=EXCLUDED.last_seen_at, updated_at=EXCLUDED.updated_at`,
      [id, s.availability, s.activity, s.activityDetail, s.location === null ? null : JSON.stringify(s.location), s.lastSeenAtIso, s.updatedAtIso],
    );
  }
}

/** Every row the command changed, deletes before inserts (a player moving parties must leave before joining). */
async function writeChanges(c: PoolClient, before: SocialState, after: SocialState): Promise<void> {
  // ---- deletes first
  const friends = diffBy(before.friendships, after.friendships, (f) => pairKey(f.userA, f.userB));
  for (const k of friends.drop) {
    const [a, b] = k.split('\u0000');
    await c.query(`DELETE FROM relay_wonderland.social_friendships WHERE user_a=$1 AND user_b=$2`, [a, b]);
  }
  const blocks = diffBy(before.blocks, after.blocks, (b) => pairKey(b.blockerId, b.blockedId));
  for (const k of blocks.drop) {
    const [a, b] = k.split('\u0000');
    await c.query(`DELETE FROM relay_wonderland.social_blocks WHERE blocker_id=$1 AND blocked_id=$2`, [a, b]);
  }
  const mutes = diffBy(before.mutes, after.mutes, (m) => pairKey(m.muterId, m.mutedId));
  for (const k of mutes.drop) {
    const [a, b] = k.split('\u0000');
    await c.query(`DELETE FROM relay_wonderland.social_mutes WHERE muter_id=$1 AND muted_id=$2`, [a, b]);
  }
  const recent = diffBy(before.recentPlayers, after.recentPlayers, (r) => pairKey(r.ownerId, r.userId));
  for (const k of recent.drop) {
    const [a, b] = k.split('\u0000');
    await c.query(`DELETE FROM relay_wonderland.social_recent_players WHERE owner_id=$1 AND user_id=$2`, [a, b]);
  }
  const parties = diffBy(Object.values(before.parties), Object.values(after.parties), (p) => p.partyId);
  for (const id of parties.drop) await c.query(`DELETE FROM relay_wonderland.social_parties WHERE party_id=$1`, [id]);
  for (const party of parties.put) {
    const was = before.parties[party.partyId];
    if (was === undefined) continue;
    const keep = party.members.map((m) => m.userId);
    await c.query(`DELETE FROM relay_wonderland.social_party_members WHERE party_id=$1 AND NOT (player_id = ANY($2::text[]))`, [party.partyId, keep]);
  }

  // ---- users first among inserts: every other row references them
  for (const [id, record] of Object.entries(after.users)) {
    if (before.users[id] !== record) await writeUser(c, id, record, before.users[id]);
  }
  for (const f of friends.put) {
    await c.query(`INSERT INTO relay_wonderland.social_friendships(user_a, user_b, since) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [f.userA, f.userB, f.sinceIso]);
  }
  for (const r of diffBy(before.requests, after.requests, (x) => x.requestId).put) {
    await c.query(
      `INSERT INTO relay_wonderland.social_friend_requests(request_id, from_user, to_user, status, created_at, resolved_at) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(request_id) DO UPDATE SET status=EXCLUDED.status, resolved_at=EXCLUDED.resolved_at`,
      [r.requestId, r.fromUserId, r.toUserId, r.status, r.createdAtIso, r.resolvedAtIso],
    );
  }
  for (const b of blocks.put) {
    await c.query(`INSERT INTO relay_wonderland.social_blocks(blocker_id, blocked_id, since) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [b.blockerId, b.blockedId, b.sinceIso]);
  }
  for (const m of mutes.put) {
    await c.query(
      `INSERT INTO relay_wonderland.social_mutes(muter_id, muted_id, voice, messages) VALUES($1,$2,$3,$4)
       ON CONFLICT(muter_id, muted_id) DO UPDATE SET voice=EXCLUDED.voice, messages=EXCLUDED.messages`,
      [m.muterId, m.mutedId, m.voice, m.messages],
    );
  }
  for (const r of diffBy(before.reports, after.reports, (x) => x.reportId).put) {
    await c.query(
      `INSERT INTO relay_wonderland.social_reports(report_id, reporter_id, reported_id, reason, note, subject_ref, filed_at) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(report_id) DO NOTHING`,
      [r.reportId, r.reporterId, r.reportedId, r.reason, r.note, r.subjectRef, r.filedAtIso],
    );
  }
  for (const r of recent.put) {
    await c.query(
      `INSERT INTO relay_wonderland.social_recent_players(owner_id, user_id, context, context_label, met_at) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(owner_id, user_id) DO UPDATE SET context=EXCLUDED.context, context_label=EXCLUDED.context_label, met_at=EXCLUDED.met_at`,
      [r.ownerId, r.userId, r.context, r.contextLabel, r.metAtIso],
    );
  }
  for (const p of parties.put) {
    await c.query(
      `INSERT INTO relay_wonderland.social_parties(party_id, name, leader_id, privacy, invite_permission, created_at, version) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(party_id) DO UPDATE SET name=EXCLUDED.name, leader_id=EXCLUDED.leader_id, privacy=EXCLUDED.privacy,
         invite_permission=EXCLUDED.invite_permission, version=EXCLUDED.version`,
      [p.partyId, p.name, p.leaderId, p.privacy, p.invitePermission, p.createdAtIso, p.version],
    );
    for (const m of p.members) {
      await c.query(
        `INSERT INTO relay_wonderland.social_party_members(party_id, player_id, role, joined_at, self_muted) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(party_id, player_id) DO UPDATE SET role=EXCLUDED.role, self_muted=EXCLUDED.self_muted`,
        [p.partyId, m.userId, m.role, m.joinedAtIso, m.selfMuted],
      );
    }
  }
  for (const i of diffBy(before.partyInvites, after.partyInvites, (x) => x.inviteId).put) {
    if (after.parties[i.partyId] === undefined) continue; // its party is gone, and the row with it (cascade)
    await c.query(
      `INSERT INTO relay_wonderland.social_party_invites(invite_id, party_id, from_user, to_user, status, created_at, expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(invite_id) DO UPDATE SET status=EXCLUDED.status`,
      [i.inviteId, i.partyId, i.fromUserId, i.toUserId, i.status, i.createdAtIso, i.expiresAtIso],
    );
  }
  // READ STATES BY KEY (the migration adversary's M2, 10-07): any send or read used to rewrite every member row of every
  // conversation in the store. Now a conversation that changed writes its members; otherwise only the rows whose read moved.
  const readKey = (conversationId: string, userId: string) => `${conversationId}\u0000${userId}`;
  const readAfter = new Map(after.readStates.map((r) => [readKey(r.conversationId, r.userId), r.lastReadSequence]));
  const readBefore = before.readStates === after.readStates ? readAfter : new Map(before.readStates.map((r) => [readKey(r.conversationId, r.userId), r.lastReadSequence]));
  for (const conv of Object.values(after.conversations)) {
    const was = before.conversations[conv.conversationId];
    if (was !== conv) {
      await c.query(
        `INSERT INTO relay_wonderland.social_conversations(conversation_id, kind, title, party_id, last_sequence, last_message_at, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(conversation_id) DO UPDATE SET title=EXCLUDED.title, last_sequence=EXCLUDED.last_sequence, last_message_at=EXCLUDED.last_message_at`,
        [conv.conversationId, conv.kind, conv.title, conv.partyId, conv.lastSequence, conv.lastMessageAtIso, conv.createdAtIso],
      );
      await c.query(`DELETE FROM relay_wonderland.social_conversation_members WHERE conversation_id=$1 AND NOT (player_id = ANY($2::text[]))`, [conv.conversationId, conv.memberIds]);
    }
    for (const member of conv.memberIds) {
      const key = readKey(conv.conversationId, member);
      if (was === conv && readBefore.get(key) === readAfter.get(key)) continue;
      await c.query(
        `INSERT INTO relay_wonderland.social_conversation_members(conversation_id, player_id, last_read_sequence) VALUES($1,$2,$3)
         ON CONFLICT(conversation_id, player_id) DO UPDATE SET last_read_sequence=EXCLUDED.last_read_sequence`,
        [conv.conversationId, member, readAfter.get(key) ?? 0],
      );
    }
    if (before.messages[conv.conversationId] !== after.messages[conv.conversationId]) {
      for (const m of diffBy(before.messages[conv.conversationId] ?? [], after.messages[conv.conversationId] ?? [], (x) => x.messageId).put) {
        await c.query(
          `INSERT INTO relay_wonderland.social_messages(message_id, conversation_id, sequence, sender_id, kind, body, ref, sent_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(message_id) DO NOTHING`,
          [m.messageId, m.conversationId, m.sequence, m.senderId, m.kind, m.body, m.ref, m.sentAtIso],
        );
      }
    }
  }
  if (before.nextSerial !== after.nextSerial) {
    // AN UPSERT: migration 033 writes no row, so the first minted id creates next_serial. A bare UPDATE would change nothing
    // there, and after a restart the ids would start again at 1: the same ids minted twice, and each ON CONFLICT DO NOTHING
    // below them would silently drop the new row. GREATEST (Second Julius, 10-07): the durable serial never moves BACKWARDS,
    // even when a stale writer (a second bridge left running over a deploy) writes an older one, so a restart never re-mints
    // an id below anything ever persisted. (One bridge per store is the rule; this bounds the damage of breaking it.)
    await c.query(
      `INSERT INTO relay_wonderland.social_meta(name, value) VALUES('next_serial', $1)
       ON CONFLICT(name) DO UPDATE SET value = GREATEST(relay_wonderland.social_meta.value, EXCLUDED.value)`,
      [after.nextSerial],
    );
  }
}

/* ----------------------------------------------------------------------------------------------------------- store */

export interface SocialPostgresOptions {
  /** How long the event log keeps an event (default 7 days); a client further behind is told to reset. */
  readonly eventRetentionMs?: number;
  /** Told after each change that took somebody out of a party, once its transaction COMMITTED (party voice removal). */
  readonly afterCommit?: SocialAfterCommit;
}

/**
 * Read every social row back and serve the store. THROWS when the database cannot be reached, or when it is a protected store
 * (C2: the Julius live store never holds social data), BEFORE reading anything. The route then answers 503.
 */
export async function openSocialPostgresStore(pool: Pool, options: SocialPostgresOptions = {}): Promise<SocialStore> {
  await protectedStoreWriterGuard(pool, 'the social store')();
  let state = await loadState(pool);
  // THE SHARED PRESENCE LAYER is real-time and in memory only: a restart empties it, and clients rejoin.
  let world: WorldState = emptyWorldState();
  const retentionMs = Math.max(60_000, options.eventRetentionMs ?? 7 * 24 * 3600 * 1000);
  let lastPruneAt = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
  const transact = async (write: (c: PoolClient) => Promise<void>): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await write(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    read: () => serial(async () => state),
    ensureUser: (identity: SocialPlayerIdentity, nowIso: string) =>
      serial(async () => {
        const next = ensureSocialUser(state, identity, nowIso);
        if (next === state) return;
        // ensureSocialUser changes only this player's record (an incumbent keeps a contested handle); the ordering below stays
        // harmless and general: any other changed record is written first, as 033's unique lower(handle) is checked row by row
        const changedIds = Object.keys(next.users).filter((id) => next.users[id] !== state.users[id]);
        const order = [...changedIds.filter((id) => id !== identity.userId), ...changedIds.filter((id) => id === identity.userId)];
        await transact(async (c) => {
          for (const id of order) await writeUser(c, id, next.users[id], state.users[id]);
        });
        state = next;
      }),
    apply: (op: SocialOperationId, actorId: SocialUserId, input: SocialCommandInput, nowIso: string) =>
      serial(async (): Promise<RelayResult<unknown>> => {
        if (!hasUser(state, actorId)) return { ok: false, error: relayError('not-found', 'no social record for this player') };
        const outcome = applySocialOperation(state, op, actorId, input, nowIso, world);
        if (!outcome.ok) return outcome;
        const next = outcome.value.state;
        if (next === state && outcome.value.world !== undefined && outcome.value.audience.length === 0) {
          world = outcome.value.world;   // a position report or a read: nothing durable moved
          return { ok: true, value: outcome.value.data };
        }
        if (next !== state || outcome.value.audience.length > 0) {
          // SAVED ONLY AFTER THE DURABLE WRITE: the new state is adopted only when its rows (and its event) committed.
          try {
            await transact(async (c) => {
              await writeChanges(c, state, next);
              // 033 caps one event row's audience at 256 (social_events CHECK); a player with many friends would have hit it on
              // every world.join, forever (the migration adversary's M3, 10-07). One event, as many rows as it needs: each
              // viewer is in exactly one of them, so each still sees it once.
              const audience = [...new Set(outcome.value.audience)];
              for (let i = 0; i < audience.length; i += EVENT_AUDIENCE_MAX) {
                await c.query(`INSERT INTO relay_wonderland.social_events(op, at, audience) VALUES($1,$2,$3)`, [outcome.value.eventOp ?? op, nowIso, audience.slice(i, i + EVENT_AUDIENCE_MAX)]);
              }
            });
          } catch (error) {
            // A REFUSAL IS NOT AN OUTAGE (MINOR 1, 10-07): a data or integrity error (SQLSTATE class 22 / 23) refuses the same way
            // every time, so it is not offered as a retry; anything else (a serialization failure, a lost connection) is.
            const sqlState = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
            if (/^2[23]/.test(sqlState)) return { ok: false, error: relayError('validation-failed', 'the store refused this change; nothing was changed') };
            return { ok: false, error: relayError('stale-ledger-version', 'the change could not be saved; nothing was changed', { retryable: true }) };
          }
          const before = state;
          state = next;
          if (outcome.value.world !== undefined) world = outcome.value.world;
          // AFTER THE COMMIT, never before it, and never waited on (voice removal retries on its own; the change stands)
          tellAfterCommit(options.afterCommit, op, actorId, before, next);
        }
        return { ok: true, value: outcome.value.data };
      }),
    eventsFor: async (userId: SocialUserId, after: number, limit: number): Promise<SocialEventPage> => {
      // RETENTION, at most once a minute (every client polls every few seconds; the prune need not run with each).
      if (Date.now() - lastPruneAt > 60_000) {
        lastPruneAt = Date.now();
        await pool.query(`DELETE FROM relay_wonderland.social_events WHERE at < $1`, [new Date(Date.now() - retentionMs).toISOString()]);
      }
      const capped = Math.max(1, Math.min(limit, 500));
      // one row past the cap tells a page cut short from a complete one
      const rows = await pool.query<{ seq: string; op: SocialOperationId; at: Date }>(
        `SELECT seq, op, at FROM relay_wonderland.social_events WHERE seq > $1 AND audience @> ARRAY[$2]::text[] ORDER BY seq LIMIT $3`,
        [after, userId, capped + 1],
      );
      // THE VIEWER'S OWN CURSOR (SocialEventPage.latest): their newest event, never the log's global newest; the global oldest
      // only marks the retention edge (it moves with week-old pruning, not with anybody acting now).
      const bounds = await pool.query<{ mine: string | null; oldest: string | null }>(
        `SELECT (SELECT max(seq) FROM relay_wonderland.social_events WHERE audience @> ARRAY[$1]::text[])::text AS mine,
                (SELECT min(seq) FROM relay_wonderland.social_events)::text AS oldest`,
        [userId],
      );
      const mine = bounds.rows[0]?.mine === null || bounds.rows[0]?.mine === undefined ? null : Number(bounds.rows[0].mine);
      const oldest = bounds.rows[0]?.oldest === null || bounds.rows[0]?.oldest === undefined ? null : Number(bounds.rows[0].oldest);
      const events = rows.rows.slice(0, capped).map((r) => ({ seq: Number(r.seq), op: r.op, atIso: new Date(r.at).toISOString() }));
      return {
        events,
        latest: viewerCursor({ after, page: events, truncated: rows.rows.length > capped, viewerNewest: mine, oldest }),
        reset: after > 0 && oldest !== null && after < oldest - 1,
      };
    },
  };
}
