import type { Pool, PoolClient } from 'pg';

import {
  WONDERLAND_EMPTY_SOCIAL_STATE,
  decideWonderlandSocialCommand,
  isWonderlandEntityId,
  isWonderlandInstanceId,
  isWonderlandPlayerId,
  wonderlandFriendKey,
  wonderlandLiveState,
  wonderlandServerIdOfInstance,
  type WonderlandActivity,
  type WonderlandLocation,
  type WonderlandSocialCommand,
  type WonderlandSocialMutation,
  type WonderlandSocialOutcome,
  type WonderlandSocialState,
  type WonderlandSocialStore,
} from '../mission/wonderland-social';

/**
 * THE WONDERLAND SOCIAL STORE ON POSTGRESQL (migration 033).
 *
 * THE DECISION IS NOT MADE HERE. `execute` reads the actor's neighbourhood, asks
 * `decideWonderlandSocialCommand` — the same function the memory store asks —
 * and writes the mutation list it returns, as SQL, in one transaction. A store
 * that re-implemented "a block removes the friendship" in SQL would one day
 * disagree with the domain about it; this one cannot.
 *
 * ONE SOCIAL WRITER AT A TIME. Every write transaction takes a transaction-level
 * advisory lock (`WONDERLAND_SOCIAL_LOCK_KEY`) first, so two commands never
 * decide on the same neighbourhood concurrently: "the leader kicks the member"
 * and "the member blocks the leader" serialize instead of each applying to a
 * party the other has already changed. The key is the social layer's own and
 * never Julius's, so row 13 (i)'s write paths are untouched.
 *
 * READS ARE ONE SNAPSHOT. `stateFor` and `voiceStateFor` read inside a single
 * REPEATABLE READ, READ ONLY transaction: a slice assembled from several
 * queries that straddled a commit could pair the block that just landed with
 * the presence from before it, and show a blocked player where they stand.
 *
 * WHAT IS READ — THE NEIGHBOURHOOD. Every projection and every decision asks
 * about relations between the actor (or viewer) and players near them. The
 * slice holds every row that can answer such a question: the players involved,
 * the parties and servers they belong to (whole), blocks, friendships and
 * requests touching any of them, and their presence. The store contract suite
 * proves that projections over this slice equal projections over the whole
 * state.
 *
 * EXISTENCE. The players row is created for the authenticated ACTOR (a session
 * proved who they are). A target becomes known only through `upsertProfile`,
 * which the account layer calls; a command aimed at anyone else is refused by
 * the domain as UNAVAILABLE, so a typed id never creates a row.
 */

/** 'SOCIAL' in ASCII. The social layer's lock, distinct from every Julius lock. */
export const WONDERLAND_SOCIAL_LOCK_KEY = 0x534f4349414cn;

type Query = Pick<PoolClient, 'query'>;
const ids = (values: Iterable<string>): string[] => [...new Set(values)].filter(isWonderlandPlayerId).sort();
const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
/** jsonb reorders keys; the domain's shape is rebuilt so both stores hold the same value. */
const locationOf = (value: unknown): WonderlandLocation | null => {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return { zone: String(record.zone), x: Number(record.x), y: Number(record.y), z: Number(record.z) };
};

interface SliceRequest {
  readonly playerIds: readonly string[];
  readonly partyIds?: readonly string[];
  readonly serverIds?: readonly string[];
  readonly instanceIds?: readonly string[];
  readonly messageIds?: readonly string[];
  /** Read this viewer's Recent Players rows and conversations too. */
  readonly viewerId?: string;
}

/** The ids a command names, so its neighbourhood can be read before it is decided. */
function namedBy(actorId: string, command: WonderlandSocialCommand): SliceRequest {
  const players = new Set<string>([actorId]);
  const partyIds: string[] = [];
  const serverIds: string[] = [];
  const instanceIds: string[] = [];
  const messageIds: string[] = [];
  const record = command as unknown as Record<string, unknown>;
  for (const key of ['toId', 'fromId', 'otherId', 'targetId', 'inviteeId', 'memberId']) {
    if (typeof record[key] === 'string') players.add(record[key] as string);
  }
  if (typeof record.partyId === 'string' && isWonderlandEntityId(record.partyId)) partyIds.push(record.partyId);
  if (typeof record.serverId === 'string' && isWonderlandEntityId(record.serverId)) serverIds.push(record.serverId);
  if (command.kind === 'ENTER_INSTANCE' && isWonderlandInstanceId(command.instanceId)) {
    instanceIds.push(command.instanceId);
    const serverId = wonderlandServerIdOfInstance(command.instanceId);
    if (serverId !== null && isWonderlandEntityId(serverId)) serverIds.push(serverId);
  }
  if (command.kind === 'SEND_MESSAGE' && isWonderlandEntityId(command.messageId)) messageIds.push(command.messageId);
  return { playerIds: [...players], partyIds, serverIds, instanceIds, messageIds };
}

/**
 * READ A NEIGHBOURHOOD. Ids are gathered first (cheap, by index), then every
 * row touching them is read once, and the slice is returned as an ordinary
 * `WonderlandSocialState`.
 */
async function readSlice(db: Query, request: SliceRequest): Promise<WonderlandSocialState> {
  const players = new Set(ids(request.playerIds));
  const partyIds = new Set((request.partyIds ?? []).filter(isWonderlandEntityId));
  const serverIds = new Set((request.serverIds ?? []).filter(isWonderlandEntityId));
  const instanceIds = (request.instanceIds ?? []).filter(isWonderlandInstanceId);

  if (instanceIds.length > 0) {
    const present = await db.query<{ player_id: string }>('SELECT player_id FROM relay_wonderland.social_presence WHERE instance_id = ANY($1)', [instanceIds]);
    for (const row of present.rows) players.add(row.player_id);
  }
  if (request.viewerId !== undefined) {
    const met = await db.query<{ other_id: string }>('SELECT other_id FROM relay_wonderland.social_encounters WHERE player_id = $1', [request.viewerId]);
    for (const row of met.rows) players.add(row.other_id);
    const friends = await db.query<{ other: string }>(
      `SELECT CASE WHEN player_low = $1 THEN player_high ELSE player_low END AS other
         FROM relay_wonderland.social_friendships WHERE player_low = $1 OR player_high = $1`, [request.viewerId]);
    for (const row of friends.rows) players.add(row.other);
    const here = await db.query<{ instance_id: string }>('SELECT instance_id FROM relay_wonderland.social_presence WHERE player_id = $1', [request.viewerId]);
    if (here.rows[0] !== undefined) {
      const around = await db.query<{ player_id: string }>('SELECT player_id FROM relay_wonderland.social_presence WHERE instance_id = $1', [here.rows[0].instance_id]);
      for (const row of around.rows) players.add(row.player_id);
    }
  }

  // Parties and servers, whole: a party's members and a server's owner and members join the neighbourhood.
  const partyRows = await db.query<{ party_id: string }>(
    `SELECT party_id FROM relay_wonderland.social_party_members WHERE player_id = ANY($1)
     UNION SELECT party_id FROM relay_wonderland.social_party_invites WHERE invitee_id = ANY($1)
     UNION SELECT party_id FROM relay_wonderland.social_parties WHERE party_id = ANY($2)`,
    [ids(players), [...partyIds]]);
  for (const row of partyRows.rows) partyIds.add(row.party_id);
  const serverRows = await db.query<{ server_id: string }>(
    `SELECT server_id FROM relay_wonderland.social_servers WHERE owner_id = ANY($1)
     UNION SELECT server_id FROM relay_wonderland.social_server_members WHERE player_id = ANY($1)
     UNION SELECT server_id FROM relay_wonderland.social_server_invites WHERE invitee_id = ANY($1)
     UNION SELECT server_id FROM relay_wonderland.social_servers WHERE server_id = ANY($2)`,
    [ids(players), [...serverIds]]);
  for (const row of serverRows.rows) serverIds.add(row.server_id);

  const parties = await db.query<{ party_id: string; leader_id: string; created_at: Date; members: string[] }>(
    `SELECT p.party_id, p.leader_id, p.created_at,
            COALESCE(array_agg(m.player_id ORDER BY m.join_order) FILTER (WHERE m.player_id IS NOT NULL), '{}') AS members
       FROM relay_wonderland.social_parties p
       LEFT JOIN relay_wonderland.social_party_members m ON m.party_id = p.party_id
      WHERE p.party_id = ANY($1) GROUP BY p.party_id`, [[...partyIds]]);
  const servers = await db.query<{ server_id: string; owner_id: string; name: string; created_at: Date; members: string[] }>(
    `SELECT s.server_id, s.owner_id, s.name, s.created_at,
            COALESCE(array_agg(m.player_id ORDER BY m.join_order) FILTER (WHERE m.player_id IS NOT NULL), '{}') AS members
       FROM relay_wonderland.social_servers s
       LEFT JOIN relay_wonderland.social_server_members m ON m.server_id = s.server_id
      WHERE s.server_id = ANY($1) GROUP BY s.server_id`, [[...serverIds]]);
  for (const party of parties.rows) for (const member of party.members) players.add(member);
  for (const server of servers.rows) { players.add(server.owner_id); for (const member of server.members) players.add(member); }
  const partyInvites = await db.query<{ party_id: string; invitee_id: string; inviter_id: string; created_at: Date }>(
    'SELECT party_id, invitee_id, inviter_id, created_at FROM relay_wonderland.social_party_invites WHERE party_id = ANY($1) ORDER BY created_at, invitee_id',
    [[...partyIds]]);
  const serverInvites = await db.query<{ server_id: string; invitee_id: string; created_at: Date }>(
    'SELECT server_id, invitee_id, created_at FROM relay_wonderland.social_server_invites WHERE server_id = ANY($1) ORDER BY created_at, invitee_id',
    [[...serverIds]]);

  const everyone = ids(players);
  const [profiles, settings, friendships, requests, blocks, presence] = [
    await db.query<{ player_id: string; display_name: string | null }>('SELECT player_id, display_name FROM relay_wonderland.social_profiles WHERE player_id = ANY($1)', [everyone]),
    await db.query<{ player_id: string; visibility: string }>('SELECT player_id, visibility FROM relay_wonderland.social_settings WHERE player_id = ANY($1)', [everyone]),
    await db.query<{ player_low: string; player_high: string }>(
      'SELECT player_low, player_high FROM relay_wonderland.social_friendships WHERE player_low = ANY($1) OR player_high = ANY($1)', [everyone]),
    await db.query<{ from_id: string; to_id: string; created_at: Date }>(
      'SELECT from_id, to_id, created_at FROM relay_wonderland.social_friend_requests WHERE from_id = ANY($1) OR to_id = ANY($1) ORDER BY created_at, from_id, to_id', [everyone]),
    await db.query<{ blocker_id: string; blocked_id: string; created_at: Date }>(
      'SELECT blocker_id, blocked_id, created_at FROM relay_wonderland.social_blocks WHERE blocker_id = ANY($1) OR blocked_id = ANY($1) ORDER BY created_at, blocker_id, blocked_id', [everyone]),
    await db.query<{ player_id: string; instance_id: string; location: unknown; activity: string; dog_id: string | null; updated_at: Date }>(
      'SELECT player_id, instance_id, location, activity, dog_id, updated_at FROM relay_wonderland.social_presence WHERE player_id = ANY($1)', [everyone]),
  ];
  const encounters = request.viewerId === undefined ? { rows: [] as { player_id: string; other_id: string; instance_id: string; at: Date }[] }
    : await db.query<{ player_id: string; other_id: string; instance_id: string; at: Date }>(
      'SELECT player_id, other_id, instance_id, at FROM relay_wonderland.social_encounters WHERE player_id = $1', [request.viewerId]);
  const messages = await db.query<{ message_id: string; from_id: string; to_id: string; body: string; sent_at: Date }>(
    request.viewerId === undefined
      ? 'SELECT message_id, from_id, to_id, body, sent_at FROM relay_wonderland.social_messages WHERE message_id = ANY($1)'
      : 'SELECT message_id, from_id, to_id, body, sent_at FROM relay_wonderland.social_messages WHERE message_id = ANY($1) OR from_id = $2 OR to_id = $2',
    request.viewerId === undefined ? [request.messageIds ?? []] : [request.messageIds ?? [], request.viewerId]);

  return {
    ...WONDERLAND_EMPTY_SOCIAL_STATE,
    profiles: Object.fromEntries(profiles.rows.map((row) => [row.player_id, { displayName: row.display_name }])),
    settings: Object.fromEntries(settings.rows.map((row) => [row.player_id, { visibility: row.visibility as 'EVERYONE' | 'HIDDEN_FROM_STRANGERS' }])),
    friendships: friendships.rows.map((row) => wonderlandFriendKey(row.player_low, row.player_high)).sort(),
    friendRequests: requests.rows.map((row) => ({ fromId: row.from_id, toId: row.to_id, at: iso(row.created_at) })),
    blocks: blocks.rows.map((row) => ({ blockerId: row.blocker_id, blockedId: row.blocked_id, at: iso(row.created_at) })),
    parties: Object.fromEntries(parties.rows.map((row) => [row.party_id, {
      partyId: row.party_id, leaderId: row.leader_id, memberIds: row.members, createdAt: iso(row.created_at),
    }])),
    partyInvites: partyInvites.rows.map((row) => ({ partyId: row.party_id, inviteeId: row.invitee_id, inviterId: row.inviter_id, at: iso(row.created_at) })),
    servers: Object.fromEntries(servers.rows.map((row) => [row.server_id, {
      serverId: row.server_id, ownerId: row.owner_id, name: row.name, memberIds: row.members, createdAt: iso(row.created_at),
    }])),
    serverInvites: serverInvites.rows.map((row) => ({ serverId: row.server_id, inviteeId: row.invitee_id, at: iso(row.created_at) })),
    presence: Object.fromEntries(presence.rows.map((row) => [row.player_id, {
      playerId: row.player_id, instanceId: row.instance_id, location: locationOf(row.location),
      activity: row.activity as WonderlandActivity, dogId: row.dog_id, updatedAt: iso(row.updated_at),
    }])),
    encounters: encounters.rows.map((row) => ({ playerId: row.player_id, otherId: row.other_id, instanceId: row.instance_id, at: iso(row.at) })),
    messages: messages.rows.map((row) => ({ messageId: row.message_id, fromId: row.from_id, toId: row.to_id, body: row.body, sentAt: iso(row.sent_at) })),
  };
}

/** One mutation, as SQL. The same list the memory store folds. */
async function write(db: Query, mutation: WonderlandSocialMutation, at: string): Promise<void> {
  switch (mutation.kind) {
    case 'SETTINGS_SET':
      await db.query(
        `INSERT INTO relay_wonderland.social_settings(player_id, visibility, updated_at) VALUES($1,$2,$3)
         ON CONFLICT (player_id) DO UPDATE SET visibility = EXCLUDED.visibility, updated_at = EXCLUDED.updated_at`,
        [mutation.playerId, mutation.settings.visibility, at]);
      return;
    case 'FRIEND_REQUEST_ADDED':
      await db.query('INSERT INTO relay_wonderland.social_friend_requests(from_id, to_id, created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [mutation.fromId, mutation.toId, mutation.at]);
      return;
    case 'FRIEND_REQUEST_REMOVED':
      await db.query('DELETE FROM relay_wonderland.social_friend_requests WHERE from_id = $1 AND to_id = $2', [mutation.fromId, mutation.toId]);
      return;
    case 'FRIENDSHIP_ADDED': {
      const [low, high] = mutation.a < mutation.b ? [mutation.a, mutation.b] : [mutation.b, mutation.a];
      await db.query('INSERT INTO relay_wonderland.social_friendships(player_low, player_high, created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [low, high, mutation.at]);
      return;
    }
    case 'FRIENDSHIP_REMOVED': {
      const [low, high] = mutation.a < mutation.b ? [mutation.a, mutation.b] : [mutation.b, mutation.a];
      await db.query('DELETE FROM relay_wonderland.social_friendships WHERE player_low = $1 AND player_high = $2', [low, high]);
      return;
    }
    case 'BLOCK_ADDED':
      await db.query('INSERT INTO relay_wonderland.social_blocks(blocker_id, blocked_id, created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [mutation.blockerId, mutation.blockedId, mutation.at]);
      return;
    case 'BLOCK_REMOVED':
      await db.query('DELETE FROM relay_wonderland.social_blocks WHERE blocker_id = $1 AND blocked_id = $2', [mutation.blockerId, mutation.blockedId]);
      return;
    case 'PARTY_CREATED':
      await db.query('INSERT INTO relay_wonderland.social_parties(party_id, leader_id, created_at) VALUES($1,$2,$3)', [mutation.partyId, mutation.leaderId, mutation.at]);
      await db.query('INSERT INTO relay_wonderland.social_party_members(party_id, player_id) VALUES($1,$2)', [mutation.partyId, mutation.leaderId]);
      return;
    case 'PARTY_MEMBER_ADDED':
      await db.query('INSERT INTO relay_wonderland.social_party_members(party_id, player_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [mutation.partyId, mutation.playerId]);
      return;
    case 'PARTY_MEMBER_REMOVED':
      await db.query('DELETE FROM relay_wonderland.social_party_members WHERE party_id = $1 AND player_id = $2', [mutation.partyId, mutation.playerId]);
      return;
    case 'PARTY_LEADER_SET':
      await db.query('UPDATE relay_wonderland.social_parties SET leader_id = $2 WHERE party_id = $1', [mutation.partyId, mutation.leaderId]);
      return;
    case 'PARTY_DISBANDED':
      await db.query('DELETE FROM relay_wonderland.social_parties WHERE party_id = $1', [mutation.partyId]);
      return;
    case 'PARTY_INVITE_ADDED':
      await db.query('INSERT INTO relay_wonderland.social_party_invites(party_id, invitee_id, inviter_id, created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [mutation.partyId, mutation.inviteeId, mutation.inviterId, mutation.at]);
      return;
    case 'PARTY_INVITE_REMOVED':
      await db.query('DELETE FROM relay_wonderland.social_party_invites WHERE party_id = $1 AND invitee_id = $2', [mutation.partyId, mutation.inviteeId]);
      return;
    case 'SERVER_CREATED':
      await db.query('INSERT INTO relay_wonderland.social_servers(server_id, owner_id, name, created_at) VALUES($1,$2,$3,$4)',
        [mutation.serverId, mutation.ownerId, mutation.name, mutation.at]);
      return;
    case 'SERVER_MEMBER_ADDED':
      await db.query('INSERT INTO relay_wonderland.social_server_members(server_id, player_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [mutation.serverId, mutation.playerId]);
      return;
    case 'SERVER_MEMBER_REMOVED':
      await db.query('DELETE FROM relay_wonderland.social_server_members WHERE server_id = $1 AND player_id = $2', [mutation.serverId, mutation.playerId]);
      return;
    case 'SERVER_INVITE_ADDED':
      await db.query('INSERT INTO relay_wonderland.social_server_invites(server_id, invitee_id, created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [mutation.serverId, mutation.inviteeId, mutation.at]);
      return;
    case 'SERVER_INVITE_REMOVED':
      await db.query('DELETE FROM relay_wonderland.social_server_invites WHERE server_id = $1 AND invitee_id = $2', [mutation.serverId, mutation.inviteeId]);
      return;
    case 'PRESENCE_SET': {
      const p = mutation.presence;
      await db.query(
        `INSERT INTO relay_wonderland.social_presence(player_id, instance_id, location, activity, dog_id, updated_at) VALUES($1,$2,$3::jsonb,$4,$5,$6)
         ON CONFLICT (player_id) DO UPDATE SET instance_id = EXCLUDED.instance_id, location = EXCLUDED.location,
           activity = EXCLUDED.activity, dog_id = EXCLUDED.dog_id, updated_at = EXCLUDED.updated_at`,
        [p.playerId, p.instanceId, p.location === null ? null : JSON.stringify(p.location), p.activity, p.dogId, p.updatedAt]);
      return;
    }
    case 'PRESENCE_CLEARED':
      await db.query('DELETE FROM relay_wonderland.social_presence WHERE player_id = $1', [mutation.playerId]);
      return;
    case 'ENCOUNTER_RECORDED': {
      const e = mutation.encounter;
      await db.query(
        `INSERT INTO relay_wonderland.social_encounters(player_id, other_id, instance_id, at) VALUES($1,$2,$3,$4)
         ON CONFLICT (player_id, other_id) DO UPDATE SET instance_id = EXCLUDED.instance_id, at = EXCLUDED.at`,
        [e.playerId, e.otherId, e.instanceId, e.at]);
      return;
    }
    case 'MESSAGE_SENT': {
      const m = mutation.message;
      await db.query('INSERT INTO relay_wonderland.social_messages(message_id, from_id, to_id, body, sent_at) VALUES($1,$2,$3,$4,$5)',
        [m.messageId, m.fromId, m.toId, m.body, m.sentAt]);
      return;
    }
    default:
      throw new Error(`wonderland_social_mutation_unknown:${(mutation as { kind: string }).kind}`);
  }
}

export class WonderlandSocialPostgresStore implements WonderlandSocialStore {
  constructor(private readonly pool: Pool) {}

  async execute(input: { readonly actorId: string; readonly commandId: string; readonly command: WonderlandSocialCommand; readonly at: string }): Promise<WonderlandSocialOutcome> {
    if (!isWonderlandPlayerId(input.actorId) || !isWonderlandEntityId(input.commandId)) return { ok: false, code: 'INVALID' };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [WONDERLAND_SOCIAL_LOCK_KEY.toString()]);
      const previous = await client.query<{ actor_id: string; outcome: WonderlandSocialOutcome }>(
        'SELECT actor_id, outcome FROM relay_wonderland.social_commands WHERE command_id = $1', [input.commandId]);
      if (previous.rows[0] !== undefined) {
        await client.query('COMMIT');
        return previous.rows[0].actor_id === input.actorId ? previous.rows[0].outcome : { ok: false, code: 'ID_TAKEN' };
      }
      // The authenticated actor exists: a session proved who they are.
      await client.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [input.actorId]);
      const slice = await readSlice(client, namedBy(input.actorId, input.command));
      const decided = decideWonderlandSocialCommand(slice, input.actorId, input.command, input.at);
      for (const mutation of decided.mutations) await write(client, mutation, input.at);
      await client.query(
        'INSERT INTO relay_wonderland.social_commands(command_id, actor_id, command_kind, outcome) VALUES($1,$2,$3,$4::jsonb)',
        [input.commandId, input.actorId, String(input.command.kind).slice(0, 40), JSON.stringify(decided.outcome)]);
      await client.query('COMMIT');
      return decided.outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertProfile(input: { readonly playerId: string; readonly displayName: string | null }): Promise<void> {
    if (!isWonderlandPlayerId(input.playerId)) throw new Error('wonderland_social_player_invalid');
    const name = input.displayName === null ? null : input.displayName.trim().slice(0, 64) || null;
    await this.pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [input.playerId]);
    await this.pool.query(
      `INSERT INTO relay_wonderland.social_profiles(player_id, display_name, updated_at) VALUES($1,$2,now())
       ON CONFLICT (player_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
      [input.playerId, name]);
  }

  async ensureProfile(playerId: string): Promise<void> {
    if (!isWonderlandPlayerId(playerId)) throw new Error('wonderland_social_player_invalid');
    await this.pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [playerId]);
    // A name already recorded (from the account, at sign-in) is left exactly as it is.
    await this.pool.query(
      `INSERT INTO relay_wonderland.social_profiles(player_id, display_name, updated_at) VALUES($1,NULL,now())
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId]);
  }

  private async readConsistent(request: SliceRequest): Promise<WonderlandSocialState> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const slice = await readSlice(client, request);
      await client.query('COMMIT');
      return slice;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async stateFor(input: { readonly viewerId: string; readonly publicInstanceIds?: readonly string[]; readonly now: string }): Promise<WonderlandSocialState> {
    if (!isWonderlandPlayerId(input.viewerId)) return WONDERLAND_EMPTY_SOCIAL_STATE;
    return wonderlandLiveState(
      await this.readConsistent({ playerIds: [input.viewerId], viewerId: input.viewerId, instanceIds: input.publicInstanceIds ?? [] }), input.now);
  }

  async voiceStateFor(input: { readonly participantIds: readonly string[]; readonly now: string }): Promise<WonderlandSocialState> {
    return wonderlandLiveState(await this.readConsistent({ playerIds: input.participantIds }), input.now);
  }
}
