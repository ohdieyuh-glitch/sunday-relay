import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from '../../../relay-bridge/wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from '../../../relay-bridge/wonderland-social-scope';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { openSocialPostgresStore } from './social-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import type { SocialStore } from '../social/social-store';
import { partyOf } from '../social/social-state';

/**
 * WONDERLAND SOCIAL ON REAL POSTGRESQL, ACROSS A RESTART.
 *
 * Two players run the launch loop through the REAL routes against the durable store: a friend request and its
 * acceptance, presence, a message and its read position, a party with an invitation accepted, a mute. Then the store is
 * thrown away and opened again from the database -- a backend restart -- and everything a player relies on must come
 * back: friends, messages, unread and read positions, the party and its membership, the chosen status (OFFLINE until the
 * client reports again), privacy, the events a client missed, and the id sequence (a new id after the restart never
 * collides with one before it). Then a block, and the blocked player is never told.
 *
 * Runs only where JULIUS_TEST_DATABASE_URL names a THROWAWAY database (fresh: the social tables are global); `todo`
 * elsewhere. The chain's own migrate() applies 033_wonderland_social with the rest.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

suite('Wonderland social on real PostgreSQL, across a restart', () => {
  const nonce = randomBytes(5).toString('hex');
  const KAI = `usr_kai_${nonce}`;
  const NOVA = `usr_nova_${nonce}`;
  const VEGA = `usr_vega_${nonce}`;
  const SESSIONS: Record<string, SocialSessionFacts> = {
    kai: { sessionId: 's1', participantId: KAI, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
    nova: { sessionId: 's2', participantId: NOVA, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
    vega: { sessionId: 's3', participantId: VEGA, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  };
  let pool: Pool;
  let store: SocialStore;
  let clock = Date.parse('2026-10-02T15:00:00.000Z');
  let conversationId = '';
  let partyId = '';

  const call = async (who: string, method: string, path: string, body: unknown = null) => {
    clock += 1000;
    const deps: SocialRouteDeps = {
      verifySession: (token) => SESSIONS[token] ?? null,
      identify: async (id) => ({ userId: id, displayName: id.split('_')[1].replace(/^./, (c) => c.toUpperCase()), handle: `@${id}` }),
      store,
    };
    const result = await handleSocialRoute({ method, path: `/wonderland/social${path}`, authorization: `Relay-Session ${who}`, origin: undefined, body, now: clock }, deps);
    return result as { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    for (const id of [KAI, NOVA, VEGA]) await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [id]);
    store = await openSocialPostgresStore(pool);
  }, 60_000);

  // THE CATCH-ALL SHARES ONE DATABASE (real-infra runs every real-postgres file in parallel on it): everything this suite
  // made is removed, in foreign-key order. Parties first (leader_id does not cascade), then the conversations its players
  // are in, its events, and its players -- whose deletion cascades every other social_* row that names them.
  const removeWhatThisSuiteMade = async (db: Pool): Promise<void> => {
    const ids = [KAI, NOVA, VEGA];
    await db.query(`DELETE FROM relay_wonderland.social_parties WHERE leader_id = ANY($1::text[])`, [ids]);
    await db.query(
      `DELETE FROM relay_wonderland.social_conversations WHERE conversation_id IN
         (SELECT conversation_id FROM relay_wonderland.social_conversation_members WHERE player_id = ANY($1::text[]))`,
      [ids],
    );
    await db.query(`DELETE FROM relay_wonderland.social_events WHERE audience && $1::text[]`, [ids]);
    await db.query(`DELETE FROM relay_wonderland.players WHERE player_id = ANY($1::text[])`, [ids]);
    await db.end();
  };
  // beforeAll's first act constructs the pool, so it is absent only when that construction itself threw: then nothing
  // was made, and there is nothing to remove. This is teardown, not a test; nothing here could assert.
  afterAll(async () => {
    await (pool === undefined ? Promise.resolve() : removeWhatThisSuiteMade(pool));
    // An explicit bound (as #344 gives the migration suites'): the cleanup's deletes share the catch-all's one database with
    // every other real-postgres file, and can outlast vitest's default 10_000 ms for a hook on a loaded runner.
  }, 60_000);

  it('the loop, written through, comes back whole after a restart', async () => {
    // the loop
    await call('kai', 'GET', '/snapshot');
    await call('nova', 'GET', '/snapshot');
    expect((await call('kai', 'POST', '/requests', { toUserId: NOVA })).status).toBe(200);
    const requestId = (await call('nova', 'GET', '/snapshot')).body.data.requests.incoming[0].requestId;
    expect((await call('nova', 'POST', `/requests/${requestId}/accept`)).status).toBe(200);
    expect((await call('kai', 'POST', '/presence', { connected: true, availability: 'BUSY', signals: { juliusWorking: true } })).status).toBe(200);
    conversationId = (await call('kai', 'POST', '/conversations', { otherUserId: NOVA })).body.data.conversationId;
    expect((await call('kai', 'POST', `/conversations/${conversationId}/messages`, { body: 'first' })).status).toBe(200);
    expect((await call('kai', 'POST', `/conversations/${conversationId}/messages`, { body: 'second' })).status).toBe(200);
    expect((await call('nova', 'POST', `/conversations/${conversationId}/read`, { sequence: 1 })).status).toBe(200);
    partyId = (await call('kai', 'POST', '/parties', { name: 'Lab Crew' })).body.data.partyId;
    expect((await call('kai', 'POST', `/parties/${partyId}/invites`, { toUserId: NOVA })).status).toBe(200);
    const inviteId = (await call('nova', 'GET', '/snapshot')).body.data.partyInvites[0].inviteId;
    expect((await call('nova', 'POST', `/party-invites/${inviteId}/accept`)).status).toBe(200);
    expect((await call('nova', 'POST', '/privacy', { messagePolicy: 'EVERYONE' })).status).toBe(200);
    expect((await call('kai', 'POST', '/mutes', { targetId: NOVA, voice: true, messages: false })).status).toBe(200);
    // Kai is somewhere and doing something when the server restarts (Second, 10-07): both are the session's, not the player's
    expect((await call('kai', 'POST', '/world/join', { target: 'PUBLIC' })).status).toBe(200);
    const kaiBefore = (await store.read()).users[KAI].presence;
    expect(kaiBefore.location?.serverName).toBe('Golden Arrival');
    expect(kaiBefore.activity).not.toBe('IDLE');
    const novaEventsBefore = (await call('nova', 'GET', '/events')).body.data;
    expect(novaEventsBefore.events.length).toBeGreaterThan(0);
    // THE ID SERIAL IS DURABLE (10-07): migration 033 writes no social_meta row, so the store's first minted id must WRITE
    // next_serial (an upsert). A bare UPDATE changes nothing there, and after the restart the ids would start again at 1.
    const serialBefore = (await store.read()).nextSerial;
    expect(serialBefore, 'ids were minted before the restart').toBeGreaterThan(1);
    expect((await pool.query(`SELECT value FROM relay_wonderland.social_meta WHERE name = 'next_serial'`)).rows.map((row) => Number(row.value)),
      'the durable serial is the store\'s').toEqual([serialBefore]);

    // THE RESTART: a new store, read back from the database alone
    store = await openSocialPostgresStore(pool);
    expect((await store.read()).nextSerial, 'the serial continues where it was').toBe(serialBefore);

    const kai = (await call('kai', 'GET', '/snapshot')).body.data;
    const nova = (await call('nova', 'GET', '/snapshot')).body.data;
    expect(kai.friends.map((f: any) => f.userId)).toEqual([NOVA]);
    expect(nova.friends.map((f: any) => f.userId)).toEqual([KAI]);
    // the chosen status survives; "connected" does not -- OFFLINE until the client reports again
    expect(nova.friends[0].presence.onlineState).toBe('OFFLINE');
    expect((await store.read()).users[KAI].presence.availability).toBe('BUSY');
    // ...but where Kai was and what Kai was doing start clean: the world is empty after a restart, so a stored location would name
    // a context that no longer exists, and a friend would see it (and the old activity) the moment Kai signed in again
    const kaiAfter = (await store.read()).users[KAI].presence;
    expect([kaiAfter.location, kaiAfter.activity, kaiAfter.activityDetail]).toEqual([null, 'IDLE', null]);
    // messages, in order, with Nova's read position (1 of 2 read: 1 unread)
    expect(nova.messages[conversationId].map((m: any) => m.body)).toEqual(['first', 'second']);
    expect(nova.conversations.find((c: any) => c.conversationId === conversationId).unread).toBe(1);
    // the party and its membership, from both sides
    expect(kai.party.members.map((m: any) => m.userId).sort()).toEqual([KAI, NOVA].sort());
    expect(nova.party.partyId).toBe(partyId);
    expect(kai.party.viewerIsLeader).toBe(true);
    // privacy and the mute
    expect((await store.read()).users[NOVA].privacy.messagePolicy).toBe('EVERYONE');
    expect((await store.read()).mutes).toEqual([{ muterId: KAI, mutedId: NOVA, voice: true, messages: false }]);
    // the events a client missed are still there to poll
    const novaEventsAfter = (await call('nova', 'GET', '/events')).body.data;
    expect(novaEventsAfter.events.map((e: any) => e.seq)).toEqual(novaEventsBefore.events.map((e: any) => e.seq));
    // the id sequence continues: a new request after the restart takes a new id
    await call('vega', 'GET', '/snapshot');
    expect((await call('vega', 'POST', '/requests', { toUserId: KAI })).status).toBe(200);
    const ids = (await store.read()).requests.map((r) => r.requestId);
    expect(new Set(ids).size).toBe(ids.length);

    // A BLOCK, durable, and never NAMED to the blocked player. They share Kai's party, so F1 holds it until Nova confirms
    // (unconfirmed: refused, nothing changes); confirmed, Nova -- not the leader -- leaves, and Kai keeps his party. Kai is told
    // exactly what any member who leaves tells those who stay (parties.leave; founder, 10-04) -- never a block.
    const kaiLatest = (await call('kai', 'GET', '/events')).body.data.latest;
    const novaLatest = (await call('nova', 'GET', '/events')).body.data.latest;
    const unconfirmed = await call('nova', 'POST', '/blocks', { targetId: KAI });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error?.message).toContain('will cause you to leave this party');
    expect((await store.read()).blocks).toEqual([]);
    expect((await call('nova', 'POST', '/blocks', { targetId: KAI, confirmSharedParty: true })).status).toBe(200);
    expect((await call('kai', 'GET', `/events?after=${kaiLatest}`)).body.data.events.map((e: any) => e.op)).toEqual(['parties.leave']);
    // what the blocker's own log says is the party change, never a block (nothing names a block, in the durable rows too)
    const novaTold = (await call('nova', 'GET', `/events?after=${novaLatest}`)).body.data.events.map((e: any) => e.op);
    expect(novaTold).toContain('parties.leave');
    expect(novaTold).not.toContain('blocks.add');
    store = await openSocialPostgresStore(pool);
    const kaiAfterBlock = (await call('kai', 'GET', '/snapshot')).body.data;
    expect(kaiAfterBlock.friends).toEqual([]);
    expect(kaiAfterBlock.profiles[NOVA]).toBeUndefined();
    expect(partyOf(await store.read(), NOVA)).toBeUndefined();
    expect(partyOf(await store.read(), KAI)?.members.map((m) => m.userId)).toEqual([KAI]);
    expect((await call('kai', 'POST', `/conversations/${conversationId}/messages`, { body: 'hello?' })).status).not.toBe(200);
  }, 60_000);

  it('the wall is durable: the hidden DM, revoked invites, labels and every viewer cursor survive a restart', async () => {
    // (continuing: Nova has blocked Kai) FOUNDER RULING (b): their DM is gone for BOTH, after a restart too
    store = await openSocialPostgresStore(pool);
    for (const who of ['kai', 'nova']) {
      const snapshot = (await call(who, 'GET', '/snapshot')).body.data;
      expect(snapshot.conversations.map((c: any) => c.conversationId)).not.toContain(conversationId);
      expect(Object.keys(snapshot.messages)).not.toContain(conversationId);
      expect((await call(who, 'GET', `/conversations/${conversationId}/messages`)).body.error?.kind).toBe('not-found');
    }
    // a recent-player label is stored as its party (the source), never a name; Nova, no longer able to see it, reads "Party"
    const label = await pool.query(`SELECT context_label FROM relay_wonderland.social_recent_players WHERE owner_id = $1 AND user_id = $2`, [NOVA, KAI]);
    expect(label.rows[0]?.context_label).toBe(partyId);
    // (Kai is behind Nova's wall: her recent list skips him outright; the label rule shows on Kai's side after the unblock)

    // THE CURSOR IS EACH VIEWER'S OWN: Vega acting (no relation to Kai) does not move Kai's latest
    const kaiCursor = (await call('kai', 'GET', '/events')).body.data.latest;
    for (let i = 0; i < 3; i += 1) await call('vega', 'POST', '/presence', { connected: true, activityDetail: `vega ${i}` });
    const kaiAfterVega = (await call('kai', 'GET', `/events?after=${kaiCursor}`)).body.data;
    expect(kaiAfterVega.events).toEqual([]);
    expect(kaiAfterVega.latest).toBe(kaiCursor);

    // A PENDING INVITE DIES WITH THE BLOCK, durably: Kai befriends Vega, invites her, Vega blocks Kai
    const vegaRequest = (await call('kai', 'GET', '/snapshot')).body.data.requests.incoming[0].requestId;
    expect((await call('kai', 'POST', `/requests/${vegaRequest}/accept`)).status).toBe(200);
    const inviteId = (await call('kai', 'POST', `/parties/${partyId}/invites`, { toUserId: VEGA })).body.data.inviteId;
    expect((await call('vega', 'POST', '/blocks', { targetId: KAI })).status).toBe(200);
    store = await openSocialPostgresStore(pool);
    const row = await pool.query(`SELECT status FROM relay_wonderland.social_party_invites WHERE invite_id = $1`, [inviteId]);
    expect(row.rows[0]?.status).toBe('REVOKED');
    expect((await call('vega', 'GET', '/snapshot')).body.data.partyInvites).toEqual([]);
    expect((await call('vega', 'POST', `/blocks/${KAI}/remove`)).status).toBe(200);
    expect((await call('vega', 'POST', `/party-invites/${inviteId}/accept`)).body.error?.kind).toBe('not-found');
    expect(partyOf(await store.read(), VEGA)).toBeUndefined();

    // THE UNBLOCK BRINGS THE DM BACK UNCHANGED, for both
    expect((await call('nova', 'POST', `/blocks/${KAI}/remove`)).status).toBe(200);
    store = await openSocialPostgresStore(pool);
    for (const who of ['kai', 'nova']) {
      expect((await call(who, 'GET', `/conversations/${conversationId}/messages`)).body.data.map((m: any) => m.body)).toEqual(['first', 'second']);
    }
    // and Kai's own label for Nova (met in his own party, which he still sees) reads its name
    expect((await call('kai', 'GET', '/recent-players')).body.data.find((e: any) => e.userId === NOVA)?.contextLabel).toBe('Lab Crew');
  }, 60_000);
  it('the durable serial never moves backwards: a stale second store on the same database (a deploy overlap) cannot lower it', async () => {
    // ONE bridge per store is the rule; a second one mints ids the first already holds (its rows are then dropped by ON CONFLICT
    // DO NOTHING). What the store guarantees is narrower: the serial a restart reads is never below one ever persisted.
    const durable = async (): Promise<number[]> =>
      (await pool.query(`SELECT value FROM relay_wonderland.social_meta WHERE name = 'next_serial'`)).rows.map((row) => Number(row.value));
    const stale = await openSocialPostgresStore(pool); // holds the durable serial as it is now
    store = await openSocialPostgresStore(pool);
    for (let i = 0; i < 3; i += 1) expect((await call('kai', 'POST', '/reports', { reportedId: VEGA, reason: 'SPAM' })).status).toBe(200);
    const ahead = (await store.read()).nextSerial;
    expect(await durable(), 'the current store wrote its serial').toEqual([ahead]);
    // the stale store mints ONE id: its serial is behind, and its write must not move the durable one back
    store = stale;
    expect((await call('vega', 'POST', '/reports', { reportedId: KAI, reason: 'SPAM' })).status).toBe(200);
    expect((await stale.read()).nextSerial, 'the stale store is behind').toBeLessThan(ahead);
    expect(await durable(), 'the durable serial did not move back').toEqual([ahead]);
    store = await openSocialPostgresStore(pool);
    expect((await store.read()).nextSerial, 'a restart reads the highest serial ever written').toBe(ahead);
  }, 60_000);
});
