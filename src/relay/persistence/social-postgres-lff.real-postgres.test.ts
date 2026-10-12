import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RelayResult } from '../protocol/errors';
import type { SocialOperationId } from '../social/social-contracts';
import { LFF_CREATION_WINDOW_MS, LFF_MAX_CREATED_PER_WINDOW, LFF_RETENTION_MS } from '../social/social-lff';
import { createInMemorySocialStore, type SocialStore } from '../social/social-store';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { lffSerialBehindLine, openSocialPostgresStore } from './social-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * LFF ON REAL POSTGRESQL, THROUGH THE SOCIAL STORE (slice B2b: social-postgres.ts loads 038's three tables, writes them through and
 * logs the extra events). Each case is its OWN database (the whole chain migrated, 038 included), so the store's load reads only what
 * the case wrote -- the social tables are global, and a create prunes EVERY player's old creation rows:
 *   PARITY      one LFF story through the in-memory store and this store: every viewer's event page (events, cursor, reset) is
 *               byte for byte the same -- the creates, the requests, the accept that fills (the close told to the others), the
 *               edit that fills, a block each way (a withdrawal told to the owner, a deletion to the requester), a withdraw, a
 *               decline, the delete -- and so is the LFF state; a store opened again reads back the same pages and state;
 *   RESTART     the story up to the delete: a second store reads back EXACTLY the posts, the requests in all five statuses
 *               (CANCELLED a row like any other), the creation record and the serial; a delete after the restart cascades the
 *               post's requests and keeps its creation;
 *   CAP         ten creations (five deleted, five closed), a restart, and the eleventh is refused -- a deleted post's creation
 *               still counts; at exactly 24 h it still counts; 1 ms later a create is accepted, and its prune deletes the oldest
 *               creation AND another player's expired one in the same transaction (the post itself stays);
 *   CLOCK       a stepped-back server clock (an edit, an accept, a block, a withdraw and a close a minute BEFORE the rows were
 *               made) passes every *_times CHECK, updated_at never moving back; the later clock moves it;
 *   FAIL CLOSED a database that refuses -- or silently swallows -- the close told to the others fails the WHOLE accept: no row
 *               and no event moves, the store keeps its state; the control commits the close BEFORE the accept;
 *   ACCEPT      an accept changes only its request row and the event log (every other table checksummed); the accept that fills
 *               changes the post too (CLOSED, version + 1);
 *   NO GRAFT    (review m1) a STALE second store re-mints ids the database already holds -- its post (another owner) and its request
 *               (another requester) are refused by the guarded upserts and roll back whole: no row of any table moves, the held
 *               rows keep their own words; a fresh store then writes both under new ids, and the owner's own rows update;
 *   SAME PLAYER (r2 review r2-m1) a stale store re-mints the id of the SAME player's request on the SAME post, which the owner
 *               ACCEPTED meanwhile: refused by created_at, the accept stands; the store logs one line with no data;
 *   RETENTION   (review m3) a closed post exactly 30 days old stays; 1 ms older, the next write deletes it and the cascade its
 *               requests, in that write's transaction; a younger closed post and the creation record are untouched.
 * social-postgres-lff.test.ts runs the same story (the same text, checked there) with no database. Runs wherever
 * JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(ms).toISOString();

// ---- STORY BEGIN (one text in social-postgres-lff.test.ts and social-postgres-lff.real-postgres.test.ts; the first checks they agree)
const ROLES = ['KAI', 'NOVA', 'VEGA', 'LYRA', 'ORION', 'CLEO', 'DEX', 'ELI'] as const;
type Cast = Readonly<Record<(typeof ROLES)[number], string>>;
/** One operation, applied (at one server time) to every store the story runs on; it answers what the first store answered. */
type Act = (op: SocialOperationId, actor: string, ids?: string[], body?: Record<string, unknown>) => Promise<any>;

/**
 * THE LFF STORY: Kai's three posts and everything B1 can do to them -- a create, requests, an accept that FILLS a post (the other
 * requester told a close), an edit that fills one (the live requesters told a close), a requester who blocks the owner (two live
 * requests stored as her WITHDRAWALS; the owner told two withdrawals), an owner who blocks a requester (CANCELLED; the requester
 * told a deletion), a withdraw,
 * a decline and, at 'all', the owner's delete (the live requester told it). Before the delete every request status is held:
 * PENDING, ACCEPTED, DECLINED, WITHDRAWN and CANCELLED.
 */
async function lffStory(act: Act, P: Cast, until: 'before-delete' | 'all') {
  const A = (await act('lff.post.create', P.KAI, [], { category: 'TEAMS', title: 'A squad for the jam', openSlots: 1 })).postId as string;
  const novaOnA = (await act('lff.request.create', P.NOVA, [A], { message: 'I write shaders' })).requestId as string;
  const vegaOnA = (await act('lff.request.create', P.VEGA, [A])).requestId as string;
  await act('lff.request.accept', P.KAI, [novaOnA]); // fills A: Vega is told a close, Nova the accept
  const B = (await act('lff.post.create', P.KAI, [], { category: 'BUILDERS', title: 'Two builders', openSlots: 2, skills: ['Rust', 'Unreal'], projectLabel: 'Relay jam', description: 'Nights, UTC' })).postId as string;
  const lyraOnB = (await act('lff.request.create', P.LYRA, [B])).requestId as string;
  const orionOnB = (await act('lff.request.create', P.ORION, [B])).requestId as string;
  await act('lff.request.accept', P.KAI, [lyraOnB]); // one of two: nothing closes
  await act('lff.post.edit', P.KAI, [B], { openSlots: 1 }); // fills B by an edit: Lyra and Orion are told a close
  const C = (await act('lff.post.create', P.KAI, [], { category: 'DESIGNERS', title: 'A level designer', openSlots: 3 })).postId as string;
  const vegaOnC = (await act('lff.request.create', P.VEGA, [C])).requestId as string;
  await act('blocks.add', P.VEGA, [], { targetId: P.KAI }); // the requester blocks the owner: A's and C's requests WITHDRAWN (hers, SEC m-a), Kai told two withdrawals
  const cleoOnC = (await act('lff.request.create', P.CLEO, [C])).requestId as string;
  await act('blocks.add', P.KAI, [], { targetId: P.CLEO }); // the owner blocks the requester: CANCELLED, Cleo told C's deletion
  const orionOnC = (await act('lff.request.create', P.ORION, [C])).requestId as string;
  await act('lff.request.withdraw', P.ORION, [orionOnC]);
  const dexOnC = (await act('lff.request.create', P.DEX, [C])).requestId as string;
  await act('lff.request.decline', P.KAI, [dexOnC]);
  const eliOnC = (await act('lff.request.create', P.ELI, [C])).requestId as string;
  if (until === 'all') await act('lff.post.delete', P.KAI, [C]); // Eli is told; C's requests go with it, its creation stays
  return { A, B, C, novaOnA, vegaOnA, lyraOnB, orionOnB, vegaOnC, cleoOnC, orionOnC, dexOnC, eliOnC };
}

/** What each player is TOLD by the whole story ('all'), in order. Nobody is told a block; Kai's two withdrawals are Vega's block. */
const STORY_TOLD: Readonly<Record<(typeof ROLES)[number], readonly SocialOperationId[]>> = {
  KAI: [
    'lff.post.create', 'lff.request.create', 'lff.request.create', 'lff.request.accept', 'lff.post.create', 'lff.request.create', 'lff.request.create',
    'lff.request.accept', 'lff.post.edit', 'lff.post.create', 'lff.request.create', 'lff.request.withdraw', 'lff.request.withdraw', 'lff.request.create',
    'blocks.add', 'lff.request.create', 'lff.request.withdraw', 'lff.request.create', 'lff.request.decline', 'lff.request.create', 'lff.post.delete',
  ],
  NOVA: ['lff.request.create', 'lff.request.accept'],
  VEGA: ['lff.request.create', 'lff.post.close', 'lff.request.create', 'blocks.add'],
  LYRA: ['lff.request.create', 'lff.request.accept', 'lff.post.close'],
  ORION: ['lff.request.create', 'lff.post.close', 'lff.request.create', 'lff.request.withdraw'],
  CLEO: ['lff.request.create', 'lff.post.delete'],
  DEX: ['lff.request.create', 'lff.request.decline'],
  ELI: ['lff.request.create', 'lff.post.delete'],
};
// ---- STORY END

suite('LFF on real PostgreSQL through the social store (slice B2b)', () => {
  const nonce = randomBytes(5).toString('hex');
  const CAST: Cast = Object.fromEntries(ROLES.map((r) => [r, `usr_${r.toLowerCase()}_${nonce}`])) as Cast;
  const EVERYONE = Object.values(CAST);
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  /** A fresh database: the product's whole chain (038 included), and the cast as players. */
  const database = async (label: string): Promise<Pool> => {
    const name = `wonderlandlff${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 4 });
    made.push({ name, pool });
    await new TransactionalWonderlandDatabase(pool).migrate();
    await pool.query('INSERT INTO relay_wonderland.players(player_id) SELECT unnest($1::text[])', [EVERYONE]);
    return pool;
  };
  /** Every player of the cast signed in to each store, at one time. */
  const signIn = async (stores: readonly SocialStore[], ms: number): Promise<void> => {
    for (const id of EVERYONE) {
      for (const store of stores) await store.ensureUser({ userId: id, displayName: id.split('_')[1], handle: `@${id}` }, at(ms));
    }
  };
  /**
   * An Act over these stores. THE CLOCK IS THE REAL NOW, moving a second per operation, never a fixed date: eventsFor prunes events
   * older than 7 days against the REAL clock (the time bomb that fired in social-postgres.real-postgres.test.ts on 10-09).
   */
  const actor = (on: readonly SocialStore[], clock: { ms: number }): Act => async (op, who, ids = [], body = {}) => {
    clock.ms += 1000;
    const nowIso = at(clock.ms);
    const results: RelayResult<unknown>[] = [];
    for (const store of on) results.push(await store.apply(op, who, { ids, body, query: {} }, nowIso));
    const first = results[0];
    expect(first.ok, `${op} by ${who}: ${first.ok ? '' : first.error.message}`).toBe(true);
    for (const r of results) expect(JSON.stringify(r), `${op} by ${who}: every store answers alike`).toBe(JSON.stringify(first));
    return first.ok ? (first.value as any) : undefined;
  };
  const apply = (store: SocialStore, op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number) =>
    store.apply(op, who, { ids, body, query: {} }, at(ms));
  const lffOf = async (store: SocialStore) => {
    const s = await store.read();
    return { posts: s.lffPosts, requests: s.lffRequests, creations: s.lffCreations, nextSerial: s.nextSerial };
  };
  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  /** Every relay_wonderland table's rows, as a checksum per table (EXCEPT the listed ones). */
  const checksums = async (pool: Pool, except: readonly string[] = []): Promise<Record<string, string>> => {
    const tables = (await pool.query(
      "SELECT c.relname AS t FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' ORDER BY 1",
    )).rows.map((row: { t: string }) => row.t).filter((t: string) => !except.includes(t));
    const out: Record<string, string> = {};
    for (const t of tables) {
      out[t] = (await pool.query(`SELECT count(*)::text || ':' || coalesce(md5(string_agg(r::text, '|' ORDER BY r::text)), '-') AS h FROM relay_wonderland.${t} r`)).rows[0].h as string;
    }
    return out;
  };
  const eventsAfter = async (pool: Pool, seq: number): Promise<Array<[string, string[]]>> =>
    (await pool.query('SELECT op, audience FROM relay_wonderland.social_events WHERE seq > $1 ORDER BY seq', [seq])).rows.map((r: { op: string; audience: string[] }) => [r.op, r.audience]);
  const lastSeq = async (pool: Pool): Promise<number> => count(pool, 'SELECT coalesce(max(seq), 0) AS n FROM relay_wonderland.social_events');

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterAll(async () => {
    for (const { name, pool } of made) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('PARITY: the story through the in-memory store and this store -- every viewer\'s event page is byte for byte the same, and so is the LFF state, after a restart too', async () => {
    const pool = await database('parity');
    const clock = { ms: Date.now() };
    const pg = await openSocialPostgresStore(pool);
    const memory = createInMemorySocialStore();
    await signIn([memory, pg], clock.ms);
    await lffStory(actor([memory, pg], clock), CAST, 'all');
    for (const role of ROLES) {
      const [fromMemory, fromPg] = [await memory.eventsFor(CAST[role], 0, 500), await pg.eventsFor(CAST[role], 0, 500)];
      expect(JSON.stringify(fromPg), role).toBe(JSON.stringify(fromMemory));
      expect(fromPg.events.map((e) => e.op), `${role}: told what the story says`).toEqual(STORY_TOLD[role]);
    }
    expect(await lffOf(pg)).toEqual(await lffOf(memory));
    // THE NOTICES ARE ROWS, each written BEFORE its operation's own: Vega's block is two withdrawals to Kai, then blocks.add to Vega
    const rows = await eventsAfter(pool, 0);
    const block = rows.findIndex(([op, audience]) => op === 'blocks.add' && audience.includes(CAST.VEGA));
    expect(rows.slice(block - 2, block + 1)).toEqual([['lff.request.withdraw', [CAST.KAI]], ['lff.request.withdraw', [CAST.KAI]], ['blocks.add', [CAST.VEGA]]]);
    // A RESTART reads back the same pages and the same state
    const restarted = await openSocialPostgresStore(pool);
    for (const role of ROLES) {
      expect(JSON.stringify(await restarted.eventsFor(CAST[role], 0, 500)), `${role} after a restart`).toBe(JSON.stringify(await memory.eventsFor(CAST[role], 0, 500)));
    }
    expect(await lffOf(restarted)).toEqual(await lffOf(memory));
  }, 300_000);

  it('RESTART: the posts, the requests in all five statuses (CANCELLED a row like any other), the creation record and the serial come back exactly; a delete after it keeps the creation', async () => {
    const pool = await database('restart');
    const clock = { ms: Date.now() };
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], clock.ms);
    const ids = await lffStory(actor([pg], clock), CAST, 'before-delete');
    const held = await lffOf(pg);
    const restarted = await openSocialPostgresStore(pool);
    expect(await lffOf(restarted), 'read back exactly, in the order the domain held them').toEqual(held);
    expect([...new Set(held.requests.map((r) => r.status))].sort()).toEqual(['ACCEPTED', 'CANCELLED', 'DECLINED', 'PENDING', 'WITHDRAWN']);
    // the rows themselves: the statuses, and the times the domain stamped (a block's ending at the block's time). Vega, the requester,
    // blocked: her two are WITHDRAWN (SEC m-a); Kai, the owner, blocked Cleo: hers is CANCELLED
    const requests = (await pool.query('SELECT request_id, status, updated_at FROM relay_wonderland.lff_join_requests ORDER BY length(request_id), request_id')).rows;
    expect(requests.map((r: { request_id: string; status: string }) => [r.request_id, r.status])).toEqual([
      [ids.novaOnA, 'ACCEPTED'], [ids.vegaOnA, 'WITHDRAWN'], [ids.lyraOnB, 'ACCEPTED'], [ids.orionOnB, 'PENDING'], [ids.vegaOnC, 'WITHDRAWN'],
      [ids.cleoOnC, 'CANCELLED'], [ids.orionOnC, 'WITHDRAWN'], [ids.dexOnC, 'DECLINED'], [ids.eliOnC, 'PENDING'],
    ]);
    expect(requests.map((r: { updated_at: Date }) => r.updated_at.getTime())).toEqual(held.requests.map((r) => r.updatedAtMs));
    const posts = (await pool.query('SELECT post_id, status, version, open_slots, skills FROM relay_wonderland.lff_posts ORDER BY length(post_id), post_id')).rows;
    expect(posts.map((p: { post_id: string; status: string; version: string; open_slots: number; skills: string[] }) => [p.post_id, p.status, Number(p.version), p.open_slots, p.skills])).toEqual([
      [ids.A, 'CLOSED', 2, 1, []], [ids.B, 'CLOSED', 2, 1, ['Rust', 'Unreal']], [ids.C, 'OPEN', 1, 3, []],
    ]);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_post_creations WHERE owner_id = $1', [CAST.KAI])).toBe(3);
    // THE DELETE, on the restarted store: the post's requests go with it (the cascade), its creation stays
    await actor([restarted], clock)('lff.post.delete', CAST.KAI, [ids.C]);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_join_requests WHERE post_id = $1', [ids.C])).toBe(0);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_posts WHERE post_id = $1', [ids.C])).toBe(0);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_post_creations WHERE owner_id = $1 AND post_id = $2', [CAST.KAI, ids.C])).toBe(1);
    expect(await lffOf(await openSocialPostgresStore(pool)), 'and a third store reads what the second holds').toEqual(await lffOf(restarted));
  }, 300_000);

  it('CAP: ten creations (five deleted, five closed), a restart, and the eleventh is refused; at exactly 24 h it still counts; 1 ms later it is accepted, and its prune deletes the oldest creation and another player\'s expired one', async () => {
    const pool = await database('cap');
    const T = Date.now();
    let pg = await openSocialPostgresStore(pool);
    await signIn([pg], T - HOUR);
    const create = (store: SocialStore, who: string, ms: number) => apply(store, 'lff.post.create', who, [], { category: 'TEAMS', title: 'A squad', openSlots: 1 }, ms);
    const created = async (who: string, ms: number): Promise<string> => {
      const r = await create(pg, who, ms);
      expect(r.ok, `create by ${who}: ${r.ok ? '' : r.error.message}`).toBe(true);
      return r.ok ? (r.value as { postId: string }).postId : '';
    };
    const novaPost = await created(CAST.NOVA, T); // another player's creation, older than all of Kai's
    const kaiPosts: string[] = [];
    for (let i = 0; i < LFF_MAX_CREATED_PER_WINDOW; i += 1) {
      const ms = T + (i + 1) * MIN;
      const id = await created(CAST.KAI, ms);
      kaiPosts.push(id);
      // never more than one open: the open-post cap is not what this case is about
      expect((await apply(pg, i % 2 === 0 ? 'lff.post.delete' : 'lff.post.close', CAST.KAI, [id], {}, ms + 1000)).ok).toBe(true);
    }
    const creationsOf = async (who: string): Promise<string[]> =>
      (await pool.query('SELECT post_id FROM relay_wonderland.lff_post_creations WHERE owner_id = $1 ORDER BY length(post_id), post_id', [who])).rows.map((r: { post_id: string }) => r.post_id);
    expect(await creationsOf(CAST.KAI)).toEqual(kaiPosts);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_posts WHERE owner_id = $1', [CAST.KAI]), 'five closed; five deleted').toBe(5);
    expect(await count(pool, `SELECT count(*) AS n FROM relay_wonderland.lff_post_creations c WHERE c.owner_id = $1
      AND NOT EXISTS (SELECT 1 FROM relay_wonderland.lff_posts p WHERE p.post_id = c.post_id)`, [CAST.KAI]), 'a deleted post leaves its creation').toBe(5);

    // THE RESTART: the cap is the database's, not the process's
    pg = await openSocialPostgresStore(pool);
    const eleventh = await create(pg, CAST.KAI, T + 11 * MIN);
    expect(eleventh.ok).toBe(false);
    expect(eleventh.ok === false && eleventh.error.code).toBe('illegal-transition');
    expect(eleventh.ok === false && eleventh.error.message).toContain(`you have created ${LFF_MAX_CREATED_PER_WINDOW} posts in the last 24 hours`);
    const first = T + MIN;
    expect((await create(pg, CAST.KAI, first + LFF_CREATION_WINDOW_MS)).ok, 'exactly 24 h old, the first still counts').toBe(false);
    expect(await creationsOf(CAST.KAI), 'a refusal writes nothing').toEqual(kaiPosts);

    // 1 MS PAST THE WINDOW: accepted, and its prune (every player's rows older than the window) runs in the same transaction
    const late = await created(CAST.KAI, first + LFF_CREATION_WINDOW_MS + 1);
    expect(await creationsOf(CAST.KAI), 'the oldest is pruned; nine and the new one remain').toEqual([...kaiPosts.slice(1), late]);
    expect(await creationsOf(CAST.NOVA), 'another player\'s expired creation is pruned too').toEqual([]);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_posts WHERE post_id = $1', [novaPost]), 'her post itself stays').toBe(1);
    expect((await lffOf(await openSocialPostgresStore(pool))).creations, 'and a restart reads the pruned record').toEqual((await lffOf(pg)).creations);
  }, 300_000);

  it('CLOCK: a stepped-back server clock -- an edit, an accept, a block, a withdraw and a close a minute BEFORE the rows were made -- passes every *_times CHECK; the later clock moves updated_at', async () => {
    const pool = await database('clock');
    const T = Date.now();
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], T - HOUR);
    const ok = async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
      const r = await apply(pg, op, who, ids, body, ms);
      expect(r.ok, `${op} by ${who} at ${at(ms)}: ${r.ok ? '' : `${r.error.code} ${r.error.message}`}`).toBe(true);
      return r.ok ? r.value : undefined;
    };
    const P = (await ok('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T)).postId as string;
    const nova = (await ok('lff.request.create', CAST.NOVA, [P], {}, T + 1000)).requestId as string;
    const vega = (await ok('lff.request.create', CAST.VEGA, [P], {}, T + 2000)).requestId as string;
    const lyra = (await ok('lff.request.create', CAST.LYRA, [P], {}, T + 3000)).requestId as string;
    const back = T - MIN;
    await ok('lff.post.edit', CAST.KAI, [P], { title: 'A squad, edited' }, back);
    await ok('lff.request.accept', CAST.KAI, [nova], {}, back);
    await ok('blocks.add', CAST.VEGA, [], { targetId: CAST.KAI }, back);
    await ok('lff.request.withdraw', CAST.NOVA, [nova], {}, back);
    await ok('lff.post.close', CAST.KAI, [P], {}, back);
    const Q = (await ok('lff.post.create', CAST.KAI, [], { category: 'DESIGNERS', title: 'Made in the past', openSlots: 1 }, back)).postId as string;
    const post = async (id: string) => (await pool.query('SELECT status, version, created_at, updated_at FROM relay_wonderland.lff_posts WHERE post_id = $1', [id])).rows[0];
    const request = async (id: string) => (await pool.query('SELECT status, created_at, updated_at FROM relay_wonderland.lff_join_requests WHERE request_id = $1', [id])).rows[0];
    const times = (row: { created_at: Date; updated_at: Date }) => [row.created_at.getTime(), row.updated_at.getTime()];
    expect([(await post(P)).status, Number((await post(P)).version), ...times(await post(P))], 'edited and closed in the past: updated_at stays at T').toEqual(['CLOSED', 3, T, T]);
    expect([(await request(nova)).status, ...times(await request(nova))]).toEqual(['WITHDRAWN', T + 1000, T + 1000]);
    expect([(await request(vega)).status, ...times(await request(vega))], 'Vega, the requester, blocked: her withdrawal').toEqual(['WITHDRAWN', T + 2000, T + 2000]);
    expect(times(await post(Q)), 'a post made at the stepped-back time is simply made then').toEqual([back, back]);
    // THE CONTROL: the later clock moves updated_at
    await ok('lff.request.decline', CAST.KAI, [lyra], {}, T + 10_000);
    await ok('lff.post.edit', CAST.KAI, [Q], { title: 'Made in the past, edited' }, T + 20_000);
    expect([(await request(lyra)).status, ...times(await request(lyra))]).toEqual(['DECLINED', T + 3000, T + 10_000]);
    expect(times(await post(Q))).toEqual([back, T + 20_000]);
    expect(await lffOf(await openSocialPostgresStore(pool)), 'and a restart reads the same').toEqual(await lffOf(pg));
  }, 300_000);

  it('FAIL CLOSED: a database that refuses -- or silently swallows -- the close told to the others fails the whole accept (no row, no event, no state); the control commits the close BEFORE the accept', async () => {
    const pool = await database('failclosed');
    const clock = { ms: Date.now() };
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], clock.ms);
    const act = actor([pg], clock);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 1 })).postId as string;
    const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId as string;
    await act('lff.request.create', CAST.VEGA, [A]);
    const held = await pg.read();
    const rowsBefore = await checksums(pool);
    // a trigger on the event log: the close (only the close) is refused with an error, or dropped without one (RETURN NULL)
    const faults: ReadonlyArray<readonly [string, string]> = [['refuses', "RAISE EXCEPTION 'lff_b2b_test: the event log refuses %', NEW.op;"], ['swallows', 'RETURN NULL;']];
    for (const [name, action] of faults) {
      await pool.query(`CREATE FUNCTION public.lff_b2b_${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.op = 'lff.post.close' THEN ${action} END IF; RETURN NEW; END $$`);
      await pool.query(`CREATE TRIGGER lff_b2b_${name} BEFORE INSERT ON relay_wonderland.social_events FOR EACH ROW EXECUTE FUNCTION public.lff_b2b_${name}()`);
      try {
        const refused = await apply(pg, 'lff.request.accept', CAST.KAI, [nova], {}, (clock.ms += 1000));
        expect(refused.ok, name).toBe(false);
        expect(refused.ok === false && refused.error, name).toMatchObject({ code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed' });
        expect(await pg.read(), `${name}: the store keeps the state it had`).toBe(held);
        expect(await checksums(pool), `${name}: no row of any table moved, the event log included`).toEqual(rowsBefore);
      } finally {
        await pool.query(`DROP TRIGGER lff_b2b_${name} ON relay_wonderland.social_events`);
        await pool.query(`DROP FUNCTION public.lff_b2b_${name}()`);
      }
    }
    // THE CONTROL: the same accept, nothing in the way -- the close to Vega, THEN the accept to Kai and Nova, one transaction
    const seq = await lastSeq(pool);
    await act('lff.request.accept', CAST.KAI, [nova]);
    expect(await eventsAfter(pool, seq)).toEqual([['lff.post.close', [CAST.VEGA]], ['lff.request.accept', [CAST.KAI, CAST.NOVA]]]);
    expect((await pool.query('SELECT status, version FROM relay_wonderland.lff_posts WHERE post_id = $1', [A])).rows.map((r: { status: string; version: string }) => [r.status, Number(r.version)])).toEqual([['CLOSED', 2]]);
    expect((await pool.query('SELECT status FROM relay_wonderland.lff_join_requests WHERE request_id = $1', [nova])).rows.map((r: { status: string }) => r.status)).toEqual(['ACCEPTED']);
  }, 300_000);

  it('ACCEPT changes only its request row and the event log; the accept that fills the post changes the post too (CLOSED, version + 1)', async () => {
    const pool = await database('accept');
    const clock = { ms: Date.now() };
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], clock.ms);
    const act = actor([pg], clock);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
    const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId as string;
    const vega = (await act('lff.request.create', CAST.VEGA, [A])).requestId as string;
    await act('lff.request.create', CAST.LYRA, [A]);
    const statuses = async () => (await pool.query('SELECT request_id, status FROM relay_wonderland.lff_join_requests ORDER BY length(request_id), request_id')).rows.map((r: { request_id: string; status: string }) => `${r.request_id}:${r.status}`);
    let others = await checksums(pool, ['lff_join_requests', 'social_events']);
    const before = await statuses();
    await act('lff.request.accept', CAST.KAI, [nova]);
    expect(await checksums(pool, ['lff_join_requests', 'social_events']), 'no other table moved: not the post, not anybody\'s profile or relationships').toEqual(others);
    expect(await statuses(), 'only Nova\'s request').toEqual(before.map((line) => (line === `${nova}:PENDING` ? `${nova}:ACCEPTED` : line)));
    others = await checksums(pool, ['lff_join_requests', 'lff_posts', 'social_events']);
    await act('lff.request.accept', CAST.KAI, [vega]); // the second of two: fills the post
    expect(await checksums(pool, ['lff_join_requests', 'lff_posts', 'social_events'])).toEqual(others);
    expect((await pool.query('SELECT status, version FROM relay_wonderland.lff_posts WHERE post_id = $1', [A])).rows.map((r: { status: string; version: string }) => [r.status, Number(r.version)])).toEqual([['CLOSED', 2]]);
    expect((await pg.eventsFor(CAST.LYRA, 0, 500)).events.map((e) => e.op), 'Lyra, still pending, is told a close').toEqual(['lff.request.create', 'lff.post.close']);
  }, 300_000);

  it('NO GRAFT (review m1): a stale second store re-mints ids the database holds -- its post and its request are refused and roll back whole; a fresh store writes them under new ids', async () => {
    const pool = await database('nograft');
    const clock = { ms: Date.now() };
    const live = await openSocialPostgresStore(pool);
    await signIn([live], clock.ms);
    const act = actor([live], clock);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Kai\'s own words', openSlots: 2 })).postId as string;
    // ONE BRIDGE PER STORE is the rule; these two break it (a deploy overlap): each holds the serial as it is when opened
    const staleForPost = await openSocialPostgresStore(pool);
    const B = (await act('lff.post.create', CAST.KAI, [], { category: 'BUILDERS', title: 'Kai, again', openSlots: 1 })).postId as string;
    const staleForRequest = await openSocialPostgresStore(pool);
    const vega = (await act('lff.request.create', CAST.VEGA, [A], { message: 'Vega\'s own words' })).requestId as string;
    const rowsBefore = await checksums(pool);
    const outage = { code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed' };

    // the stale store mints B's id for NOVA's post: the database holds Kai's under it
    const post = await apply(staleForPost, 'lff.post.create', CAST.NOVA, [], { category: 'DESIGNERS', title: 'Nova\'s words', openSlots: 1 }, (clock.ms += 1000));
    expect(post.ok === false && post.error, `the stale store minted ${B} again`).toMatchObject(outage);
    // the other stale store mints Vega's request id for NOVA's request on A: the database holds Vega's under it
    const request = await apply(staleForRequest, 'lff.request.create', CAST.NOVA, [A], { message: 'Nova\'s words' }, (clock.ms += 1000));
    expect(request.ok === false && request.error, `the stale store minted ${vega} again`).toMatchObject(outage);
    expect(await checksums(pool), 'no row of any table moved: no graft, no creation, no event, no serial').toEqual(rowsBefore);
    expect((await pool.query('SELECT owner_id, title FROM relay_wonderland.lff_posts WHERE post_id = $1', [B])).rows).toEqual([{ owner_id: CAST.KAI, title: 'Kai, again' }]);
    expect((await pool.query('SELECT requester_id, message FROM relay_wonderland.lff_join_requests WHERE request_id = $1', [vega])).rows).toEqual([{ requester_id: CAST.VEGA, message: 'Vega\'s own words' }]);

    // THE CONTROL: a fresh store (the durable serial) writes both under new ids, and the owner's own rows update
    const fresh = await openSocialPostgresStore(pool);
    const again = actor([fresh], clock);
    const novaPost = (await again('lff.post.create', CAST.NOVA, [], { category: 'DESIGNERS', title: 'Nova\'s words', openSlots: 1 })).postId as string;
    const nova = (await again('lff.request.create', CAST.NOVA, [A], { message: 'Nova\'s words' })).requestId as string;
    expect([novaPost, nova].some((id) => [A, B, vega].includes(id)), 'new ids').toBe(false);
    await again('lff.post.edit', CAST.KAI, [B], { title: 'Kai, edited' });
    await again('lff.request.accept', CAST.KAI, [vega]);
    expect((await pool.query('SELECT post_id, owner_id, title, version FROM relay_wonderland.lff_posts ORDER BY length(post_id), post_id COLLATE "C"')).rows
      .map((r: { post_id: string; owner_id: string; title: string; version: string }) => [r.post_id, r.owner_id, r.title, Number(r.version)])).toEqual([
      [A, CAST.KAI, 'Kai\'s own words', 1], [B, CAST.KAI, 'Kai, edited', 2], [novaPost, CAST.NOVA, 'Nova\'s words', 1],
    ]);
    expect((await pool.query('SELECT request_id, requester_id, status FROM relay_wonderland.lff_join_requests ORDER BY length(request_id), request_id COLLATE "C"')).rows
      .map((r: { request_id: string; requester_id: string; status: string }) => [r.request_id, r.requester_id, r.status])).toEqual([
      [vega, CAST.VEGA, 'ACCEPTED'], [nova, CAST.NOVA, 'PENDING'],
    ]);
  }, 300_000);

  it('SAME PLAYER (r2 review r2-m1): a stale store re-mints the id of Nova\'s own request on the same post, which Kai ACCEPTED meanwhile -- refused by created_at, the accept stands, one line logged with no data', async () => {
    const pool = await database('sameplayer');
    const clock = { ms: Date.now() };
    const live = await openSocialPostgresStore(pool);
    await signIn([live], clock.ms);
    const act = actor([live], clock);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
    // ONE BRIDGE PER STORE is the rule; this breaks it (a deploy overlap): the stale store holds the serial as it is now
    const lines: string[] = [];
    const stale = await openSocialPostgresStore(pool, { log: (line) => lines.push(line) });
    const nova = (await act('lff.request.create', CAST.NOVA, [A], { message: 'first ask' })).requestId as string;
    await act('lff.request.accept', CAST.KAI, [nova]);
    const rowsBefore = await checksums(pool);
    // the stale store mints Nova's request id again -- for Nova, on A: the same post and requester, a later created_at
    const again = await apply(stale, 'lff.request.create', CAST.NOVA, [A], { message: 'second ask' }, (clock.ms += 1000));
    expect(again.ok === false && again.error, `the stale store minted ${nova} again`).toMatchObject({
      code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed',
    });
    expect(await checksums(pool), 'no row of any table moved: the owner\'s accept stands').toEqual(rowsBefore);
    expect((await pool.query('SELECT requester_id, status, message FROM relay_wonderland.lff_join_requests WHERE request_id = $1', [nova])).rows)
      .toEqual([{ requester_id: CAST.NOVA, status: 'ACCEPTED', message: 'first ask' }]);
    expect(lines, 'one line, and it names no id, player or words').toEqual([lffSerialBehindLine('request')]);
    for (const secret of [nova, A, CAST.NOVA, CAST.KAI, 'second ask']) expect(lines[0]).not.toContain(secret);
    // THE CONTROL: the live store's own row updates (Nova withdraws the request she was accepted on)
    await act('lff.request.withdraw', CAST.NOVA, [nova]);
    expect((await pool.query('SELECT status FROM relay_wonderland.lff_join_requests WHERE request_id = $1', [nova])).rows).toEqual([{ status: 'WITHDRAWN' }]);
  }, 300_000);

  it('RETENTION (review m3): a closed post exactly 30 days old stays; 1 ms older, the next write deletes it and the cascade its requests -- a younger closed post, the creation record and everyone\'s events are untouched', async () => {
    const pool = await database('retention');
    const T = Date.now();
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], T - HOUR);
    const ok = async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
      const r = await apply(pg, op, who, ids, body, ms);
      expect(r.ok, `${op} by ${who} at ${at(ms)}: ${r.ok ? '' : `${r.error.code} ${r.error.message}`}`).toBe(true);
      return r.ok ? r.value : undefined;
    };
    const A = (await ok('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T)).postId as string;
    const nova = (await ok('lff.request.create', CAST.NOVA, [A], { message: 'hello' }, T + 1000)).requestId as string;
    const vega = (await ok('lff.request.create', CAST.VEGA, [A], {}, T + 2000)).requestId as string;
    await ok('lff.request.accept', CAST.KAI, [nova], {}, T + 3000);
    await ok('lff.request.decline', CAST.KAI, [vega], {}, T + 4000);
    await ok('lff.post.close', CAST.KAI, [A], {}, T + 5000);
    const B = (await ok('lff.post.create', CAST.LYRA, [], { category: 'BUILDERS', title: 'Younger', openSlots: 1 }, T + HOUR)).postId as string;
    await ok('lff.post.close', CAST.LYRA, [B], {}, T + HOUR + 1000);
    const L = (await ok('lff.post.create', CAST.ORION, [], { category: 'DESIGNERS', title: 'Orion\'s', openSlots: 1 }, T + LFF_RETENTION_MS - HOUR)).postId as string;
    const postsNamed = async (id: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_posts WHERE post_id = $1', [id]);
    const requestsOn = async (id: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_join_requests WHERE post_id = $1', [id]);
    const creations = async () => (await pool.query('SELECT owner_id, post_id, created_at FROM relay_wonderland.lff_post_creations ORDER BY owner_id, post_id')).rows;
    const creationsBefore = await creations();

    // AT EXACTLY 30 DAYS: Orion's edit leaves Kai's post and its two requests in place
    await ok('lff.post.edit', CAST.ORION, [L], { title: 'at the edge' }, T + LFF_RETENTION_MS);
    expect([await postsNamed(A), await requestsOn(A)]).toEqual([1, 2]);

    // 1 MS LATER: the same kind of write deletes it; the cascade takes both requests, in that write's transaction
    const seq = await lastSeq(pool);
    await ok('lff.post.edit', CAST.ORION, [L], { title: 'past it' }, T + LFF_RETENTION_MS + 1);
    expect([await postsNamed(A), await requestsOn(A)], 'purged, with its requests').toEqual([0, 0]);
    expect(await postsNamed(B), 'a younger closed post stays').toBe(1);
    expect((await pool.query('SELECT title, version FROM relay_wonderland.lff_posts WHERE post_id = $1', [L])).rows.map((r: { title: string; version: string }) => [r.title, Number(r.version)])).toEqual([['past it', 3]]);
    expect(await creations(), 'the creation record is not the purge\'s').toEqual(creationsBefore);
    expect(await eventsAfter(pool, seq), 'the write tells its actor; the purge tells nobody').toEqual([['lff.post.edit', [CAST.ORION]]]);
    expect(await lffOf(await openSocialPostgresStore(pool)), 'and a restart reads the purged state').toEqual(await lffOf(pg));
  }, 300_000);
});
