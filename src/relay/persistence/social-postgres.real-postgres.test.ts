import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from '../../../relay-bridge/wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from '../../../relay-bridge/wonderland-social-scope';
import { applySocialOperation } from '../social/social-commands';
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
    kai: { sessionId: 's1', participantId: KAI, issuedAtMs: Date.parse('2026-10-02T15:00:00.000Z'), capabilities: [NATIVE_SOCIAL_CAPABILITY] },
    nova: { sessionId: 's2', participantId: NOVA, issuedAtMs: Date.parse('2026-10-02T15:00:00.000Z'), capabilities: [NATIVE_SOCIAL_CAPABILITY] },
    vega: { sessionId: 's3', participantId: VEGA, issuedAtMs: Date.parse('2026-10-02T15:00:00.000Z'), capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  };
  let pool: Pool;
  let store: SocialStore;
  // THE CLOCK STARTS AT THE REAL NOW, never a fixed date: the store prunes events older than its retention (7 days) against the
  // REAL clock (eventsFor), so a fixed 2026-10-02 start made every run after 2026-10-09T15:00Z prune this suite's own events
  // before reading them -- "expected 0 > 0", and the two cases after it failed on its missing state (CI 38159218942, 10-11).
  let clock = Date.now();
  let conversationId = '';
  let partyId = '';

  const call = async (who: string, method: string, path: string, body: unknown = null) => {
    clock += 1000;
    const deps: SocialRouteDeps = {
      verifySession: (token) => SESSIONS[token] ?? null,
      sessionIssuedAt: null,
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

/**
 * THE 10-07 HARDENING ON REAL POSTGRESQL (SECOND WONDERLAND): what only the database can show. Its own players (a nonce), its own
 * cleanup, the same throwaway rule as above.
 *   - one event to 261 viewers is written as two rows (033: audience <= 256), and every viewer still sees it exactly once;
 *   - a message in one conversation does not rewrite the member rows of another (their xmin is unchanged);
 *   - a handle held by another record is never a 23505: the incumbent keeps it, the claimant falls back;
 *   - a refusal the database makes deterministically (SQLSTATE class 23: a foreign key the store cannot see) answers 400, never a
 *     retryable 503 (CORE, 10-07: the NUL case below no longer reaches the database, so this is the case that isolates the mapping);
 *   - a NUL in a private server's name never reaches the database at all: refused at validation, never retryable.
 */
suite('Wonderland social hardening on real PostgreSQL (10-07)', () => {
  const nonce = randomBytes(5).toString('hex');
  const HOST = `usr_host_${nonce}`;
  const FRIENDS = Array.from({ length: 260 }, (_, i) => `usr_f${i}_${nonce}`);
  const ASKER = `usr_asker_${nonce}`;
  const GONE = `usr_gone_${nonce}`;
  const ALL = [HOST, ...FRIENDS, ASKER, GONE];
  let pool: Pool;
  let store: SocialStore;
  // THE REAL NOW, never a fixed date: eventsFor prunes events older than 7 days against the REAL clock, so a fixed 2026-10-07 start
  // would have pruned this suite's own events from 2026-10-14T13:00Z (the time bomb that fired in the suite above on 10-09)
  let clock = Date.now();
  const at = () => new Date((clock += 1000)).toISOString();
  const apply = async (op: Parameters<SocialStore['apply']>[0], actor: string, body: Record<string, unknown> = {}, ids: string[] = []) => {
    const r = await store.apply(op, actor, { ids, body, query: {} }, at());
    if (!r.ok) throw new Error(`${op} by ${actor} refused: ${r.error.message}`);
    return r.value as any;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    await pool.query(`INSERT INTO relay_wonderland.players(player_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, [ALL]);
    store = await openSocialPostgresStore(pool);
    for (const id of ALL) await store.ensureUser({ userId: id, displayName: id.split('_')[1], handle: `@${id}` }, at());
  }, 120_000);

  // THE SAME TEARDOWN SHAPE AS THE SUITE ABOVE (CORE, 10-07: a bare early return here failed ci-test-accounting's "no test can
  // END without asserting"). The pool is absent only when its construction threw, and then nothing was made.
  const removeWhatTheHardeningMade = async (db: Pool): Promise<void> => {
    await db.query(`DELETE FROM relay_wonderland.social_parties WHERE leader_id = ANY($1::text[])`, [ALL]);
    await db.query(
      `DELETE FROM relay_wonderland.social_conversations WHERE conversation_id IN
         (SELECT conversation_id FROM relay_wonderland.social_conversation_members WHERE player_id = ANY($1::text[]))`,
      [ALL],
    );
    await db.query(`DELETE FROM relay_wonderland.social_events WHERE audience && $1::text[]`, [ALL]);
    await db.query(`DELETE FROM relay_wonderland.players WHERE player_id = ANY($1::text[])`, [ALL]);
    await db.end();
  };
  afterAll(async () => {
    await (pool === undefined ? Promise.resolve() : removeWhatTheHardeningMade(pool));
  }, 120_000);

  it('one event to 261 viewers is two rows (<= 256 each), and every viewer sees it exactly once', async () => {
    for (const f of FRIENDS) {
      await apply('requests.send', f, { toUserId: HOST });
      const req = (await store.read()).requests.find((r) => r.fromUserId === f && r.toUserId === HOST && r.status === 'PENDING')!;
      await apply('requests.accept', HOST, {}, [req.requestId]);
    }
    // the host is ONLINE (CORE, 10-07): a friend's view of an offline player shows no party, so viewMoved rightly told nobody of
    // the party and the event had one viewer; online, the open party moves all 260 friends' views
    await apply('presence.update_self', HOST, { connected: true });
    const before = Number((await pool.query(`SELECT coalesce(max(seq), 0) AS m FROM relay_wonderland.social_events`)).rows[0].m);
    await apply('parties.create', HOST, { name: 'Big', privacy: 'OPEN_TO_FRIENDS' });
    const rows = (await pool.query(`SELECT cardinality(audience) AS n FROM relay_wonderland.social_events WHERE seq > $1 AND op = 'parties.create' AND audience && $2::text[]`, [before, ALL])).rows;
    expect(rows.map((r) => Number(r.n)).sort((a, b) => b - a)).toEqual([256, 5]);
    for (const viewer of [HOST, FRIENDS[0], FRIENDS[255], FRIENDS[259]]) {
      const page = await store.eventsFor(viewer, before, 500);
      expect(page.events.filter((e) => e.op === 'parties.create').length, viewer).toBe(1);
    }
  }, 300_000);

  it('a message in one conversation does not rewrite the member rows of another (xmin unchanged)', async () => {
    const one = (await apply('conversations.open', HOST, { otherUserId: FRIENDS[0] })).conversationId as string;
    const two = (await apply('conversations.open', HOST, { otherUserId: FRIENDS[1] })).conversationId as string;
    await apply('messages.send', HOST, { body: 'to two' }, [two]);
    const xmin = async (id: string) => (await pool.query(`SELECT player_id, xmin::text AS x FROM relay_wonderland.social_conversation_members WHERE conversation_id = $1 ORDER BY player_id`, [id])).rows;
    const twoBefore = await xmin(two);
    await apply('messages.send', HOST, { body: 'to one' }, [one]);
    await apply('messages.read', FRIENDS[0], {}, [one]);
    expect(await xmin(two)).toEqual(twoBefore);
    // control: the conversation that moved DID write its read row
    const oneRead = (await pool.query(`SELECT last_read_sequence FROM relay_wonderland.social_conversation_members WHERE conversation_id = $1 AND player_id = $2`, [one, FRIENDS[0]])).rows;
    expect(oneRead.map((r) => Number(r.last_read_sequence))).toEqual([1]);
  }, 120_000);

  it('a handle held by another record is never a 23505: the incumbent keeps it, the claimant falls back (and survives a restart)', async () => {
    const login = `@h${nonce}`;
    await store.ensureUser({ userId: FRIENDS[2], displayName: 'h', handle: login }, at());
    await store.ensureUser({ userId: FRIENDS[3], displayName: 'h', handle: login.toUpperCase() }, at());
    store = await openSocialPostgresStore(pool);
    const handles = (await pool.query(`SELECT player_id, handle FROM relay_wonderland.social_profiles WHERE player_id = ANY($1::text[]) ORDER BY player_id`, [[FRIENDS[2], FRIENDS[3]]])).rows;
    expect(Object.fromEntries(handles.map((r) => [r.player_id, r.handle]))).toEqual({ [FRIENDS[2]]: login, [FRIENDS[3]]: `@_${FRIENDS[3]}` });
  }, 60_000);

  it('a deterministic database refusal (a player row deleted behind the store: a foreign key, SQLSTATE class 23) answers validation-failed, never retryable', async () => {
    // The row (and, by cascade, every social row of theirs) goes behind the store's back. The store still holds the player, so
    // the DOMAIN accepts a friend request to them: only the database's foreign key refuses it, and the same way every time.
    await pool.query(`DELETE FROM relay_wonderland.players WHERE player_id = $1`, [GONE]);
    const ask = { ids: [], body: { toUserId: GONE }, query: {} };
    expect(applySocialOperation(await store.read(), 'requests.send', ASKER, ask, at()).ok, 'the domain alone accepts it: the refusal is the database\'s').toBe(true);
    const r = await store.apply('requests.send', ASKER, ask, at());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('validation-failed');
      expect(r.error.retryable).not.toBe(true);
    }
    // and nothing changed: neither the store nor the database holds the request
    expect((await store.read()).requests.some((q) => q.fromUserId === ASKER && q.toUserId === GONE)).toBe(false);
    expect((await pool.query(`SELECT 1 FROM relay_wonderland.social_friend_requests WHERE from_user = $1`, [ASKER])).rowCount).toBe(0);
  }, 60_000);

  it('a NUL in a private server name never reaches the database: validation-failed, never retryable', async () => {
    const r = await store.apply('world.join', FRIENDS[4], { ids: [], body: { target: 'PRIVATE', name: 'a\u0000b' }, query: {} }, at());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('validation-failed');
      expect(r.error.retryable).not.toBe(true);
    }
  }, 60_000);
});
