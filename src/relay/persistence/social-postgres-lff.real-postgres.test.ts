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
 * LFF ON REAL POSTGRESQL, THROUGH THE SOCIAL STORE (slice B2b: social-postgres.ts loads 037's three tables, writes them through and
 * logs the extra events). Each case is its OWN database (the whole chain migrated, 037 included), so the store's load reads only what
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
 *               requests, in that write's transaction; a younger closed post and the creation record are untouched;
 *   EVIDENCE    (founder D-L5, contract r2.4 / r2.5) an EVIDENCE post's delete, and the purge of evidence posts (one closed and
 *               reported after it closed by a user accepted on it, one open and reported that expired), HOLD the rows (held_at set,
 *               requests kept) while the unreported controls are deleted; each is told exactly as a delete and answers the uniform
 *               not-found; an open reported post stays listed (R-5); the view lff_moderation_evidence lists every evidence post with
 *               its reports, requests and snapshots (R-4); a restart reads the evidence apart from every player's state; a stale
 *               store's edit and accept on a held post are refused whole, and its delete removes nothing even with no snapshot left
 *               (the DELETE's own held_at guard: the correctness review's n-g); evidence only the database holds (another bridge's
 *               snapshot) still holds the post (the store's backstop), and a report row alone does not (the control);
 *   SNAPSHOTS   (D-L5 r2, the security review's M-1) the content AS REPORTED survives the owner's edits: the qualifying report
 *               writes seq 1 in its own transaction, each later edit appends one, the delete holds them all; the view shows them by
 *               seq; both stores and a restart hold the same; a report naming another player, and no report, write none;
 *   HOLD RULE   (FQ-1, MAIN's default, flagged to the founder) a report naming another player, a pre-report of an id not yet
 *               minted, and one from a reporter walled either way or not shown a closed post are each FILED and hold nothing (the
 *               delete is a hard delete); each control holds -- and so does one the server dates before the post (a stepped-back
 *               clock: the D-L5 r2 security review's m-1, no clock is compared);
 *   PROVENANCE  (the D-L5 r2 security review's m-3) a stale store's QUALIFYING report re-mints a report id the database holds: the
 *               report row is not kept (ON CONFLICT DO NOTHING), so the whole report fails closed -- no snapshot names the other
 *               report, no row of any table moves, one line with no data; the live store's same report commits, its snapshot
 *               naming its own report;
 *   m1 PARITY   (the correctness review's m1) a decline or a withdraw whose own write purges its evidence post: the request is
 *               written as changed FIRST, then the hold, so the database, the view, both stores and a restart agree.
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

  /** A fresh database: the product's whole chain (037 included), and the cast as players. */
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
  /** One operation through every store in `on` at ONE given server time: each must answer alike; the first's value is returned. */
  const bothAt = (on: readonly SocialStore[]) => async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
    const results: RelayResult<unknown>[] = [];
    for (const store of on) results.push(await apply(store, op, who, ids, body, ms));
    const first = results[0];
    expect(first.ok, `${op} by ${who} at ${at(ms)}: ${first.ok ? '' : `${first.error.code} ${first.error.message}`}`).toBe(true);
    for (const r of results) expect(JSON.stringify(r), `${op} by ${who}: every store answers alike`).toBe(JSON.stringify(first));
    return first.ok ? (first.value as any) : undefined;
  };
  /** A report through the existing flow (reports.file): about `reportedId`, naming `subjectRef` (or, as a control, no post). */
  const spamOf = (reportedId: string, subjectRef: string | null): Record<string, unknown> => ({ reportedId, reason: 'SPAM', ...(subjectRef === null ? {} : { subjectRef }) });
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

  it('PROVENANCE (the D-L5 r2 security review\'s m-3): a stale store\'s QUALIFYING report re-mints a report id the database holds -- the row is not kept, so the whole report fails closed: no snapshot names the other report, no row moves, one line; the live store\'s same report commits, its snapshot naming its own report', async () => {
    const pool = await database('provenance');
    const clock = { ms: Date.now() };
    const live = await openSocialPostgresStore(pool);
    await signIn([live], clock.ms);
    const act = actor([live], clock);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Abusive words', openSlots: 2 })).postId as string;
    // ONE BRIDGE PER STORE is the rule; this breaks it (a deploy overlap): the stale store holds the serial as it is now, and sees A
    const lines: string[] = [];
    const stale = await openSocialPostgresStore(pool, { log: (line) => lines.push(line) });
    // the live store files a report that makes nothing evidence (it names no post): it takes the next report id
    await act('reports.file', CAST.NOVA, [], spamOf(CAST.VEGA, null));
    const kept = (await pool.query('SELECT report_id, reporter_id FROM relay_wonderland.social_reports')).rows as Array<{ report_id: string; reporter_id: string }>;
    expect(kept.map((r) => r.reporter_id)).toEqual([CAST.NOVA]);
    const rowsBefore = await checksums(pool);
    // the stale store's Lyra reports A, naming its owner -- a QUALIFYING report, under the id the database holds for Nova's report
    const refused = await apply(stale, 'reports.file', CAST.LYRA, [], spamOf(CAST.KAI, A), (clock.ms += 1000));
    expect(refused.ok === false && refused.error, `the stale store minted ${kept[0].report_id} again`).toMatchObject({
      code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed',
    });
    expect(await checksums(pool), 'no row of any table moved: no snapshot names Nova\'s report').toEqual(rowsBefore);
    expect(lines, 'one line, and it names no id or player').toEqual([lffSerialBehindLine('report')]);
    for (const secret of [A, kept[0].report_id, CAST.LYRA, CAST.KAI, CAST.NOVA]) expect(lines[0]).not.toContain(secret);
    // THE CONTROL: the live store's Lyra files the same report; it commits, and the snapshot names HER report
    await act('reports.file', CAST.LYRA, [], spamOf(CAST.KAI, A));
    const named = (await pool.query(
      `SELECT r.reporter_id FROM relay_wonderland.lff_post_snapshots s JOIN relay_wonderland.social_reports r ON r.report_id = s.report_id WHERE s.post_id = $1`, [A],
    )).rows as Array<{ reporter_id: string }>;
    expect(named.map((r) => r.reporter_id)).toEqual([CAST.LYRA]);
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

  it('EVIDENCE (D-L5): an evidence post\'s delete and an evidence post\'s purge HOLD its rows, requests included; the unreported controls are deleted; the view lists the evidence; a restart reads it apart; evidence only the database holds still holds, a report row alone does not; a stale store cannot write over or delete a held row', async () => {
    const pool = await database('evidence');
    const T = Date.now();
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], T - HOUR);
    const ok = async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
      const r = await apply(pg, op, who, ids, body, ms);
      expect(r.ok, `${op} by ${who} at ${at(ms)}: ${r.ok ? '' : `${r.error.code} ${r.error.message}`}`).toBe(true);
      return r.ok ? r.value : undefined;
    };
    const create = async (who: string, title: string, ms: number): Promise<string> => (await ok('lff.post.create', who, [], { category: 'TEAMS', title, openSlots: 3 }, ms)).postId as string;
    const ask = async (who: string, postId: string, ms: number): Promise<string> => (await ok('lff.request.create', who, [postId], {}, ms)).requestId as string;
    /** A report through the existing flow, by Lyra: naming `subjectRef`, or (each control's) naming no post. */
    const spam = (reportedId: string, subjectRef: string | null): Record<string, unknown> => ({ reportedId, reason: 'SPAM', ...(subjectRef === null ? {} : { subjectRef }) });
    const rowOf = async (id: string): Promise<{ held_at: Date | null; title: string; version: string } | undefined> =>
      (await pool.query('SELECT held_at, title, version FROM relay_wonderland.lff_posts WHERE post_id = $1', [id])).rows[0];
    const heldAt = async (id: string): Promise<number | null> => (await rowOf(id))?.held_at?.getTime() ?? null;
    const requestsOn = async (id: string): Promise<string[]> =>
      (await pool.query('SELECT request_id, status FROM relay_wonderland.lff_join_requests WHERE post_id = $1 ORDER BY length(request_id), request_id', [id])).rows
        .map((r: { request_id: string; status: string }) => `${r.request_id}:${r.status}`);
    const evidence = async (): Promise<Array<{ post_id: string; held_at: Date | null; reports: Array<Record<string, string>>; requests: Array<Record<string, string>>; snapshots: Array<Record<string, unknown>> }>> =>
      (await pool.query('SELECT post_id, held_at, reports, requests, snapshots FROM relay_wonderland.lff_moderation_evidence ORDER BY length(post_id), post_id')).rows;

    // R-2: A, reported, and B, its unreported control -- each with a pending and an accepted request -- deleted by their owner
    const A = await create(CAST.KAI, 'Reported', T);
    const nova = await ask(CAST.NOVA, A, T + 1000);
    const vega = await ask(CAST.VEGA, A, T + 2000);
    await ok('lff.request.accept', CAST.KAI, [vega], {}, T + 3000);
    const B = await create(CAST.KAI, 'Control', T + 4000);
    const novaOnB = await ask(CAST.NOVA, B, T + 5000);
    await ok('lff.request.accept', CAST.KAI, [novaOnB], {}, T + 5500);
    // a STALE store (one bridge per store is the rule; a deploy overlap breaks it): it holds A and B live, and never sees what follows
    const lines: string[] = [];
    const stale = await openSocialPostgresStore(pool, { log: (line) => lines.push(line) });
    await ok('reports.file', CAST.LYRA, [], spam(CAST.KAI, A), T + 6000);
    await ok('reports.file', CAST.LYRA, [], spam(CAST.KAI, null), T + 7000);
    const seq = await lastSeq(pool);
    await ok('lff.post.delete', CAST.KAI, [A], {}, T + 8000);
    await ok('lff.post.delete', CAST.KAI, [B], {}, T + 9000);
    expect(await heldAt(A), 'A is held at its delete\'s server time').toBe(T + 8000);
    expect(await requestsOn(A), 'with both its requests, as they were').toEqual([`${nova}:PENDING`, `${vega}:ACCEPTED`]);
    expect([await rowOf(B), await requestsOn(B)], 'the control is deleted, its request by the cascade').toEqual([undefined, []]);
    expect(await eventsAfter(pool, seq), 'each told exactly as a delete').toEqual([['lff.post.delete', [CAST.KAI, CAST.NOVA, CAST.VEGA]], ['lff.post.delete', [CAST.KAI, CAST.NOVA]]]);
    for (const who of [CAST.KAI, CAST.NOVA, CAST.VEGA, CAST.LYRA]) {
      const [got, control] = [await apply(pg, 'lff.post.get', who, [A], {}, T + 10_000), await apply(pg, 'lff.post.get', who, [B], {}, T + 10_000)];
      expect(JSON.stringify(got), `${who}: A answers as B, the uniform not-found`).toBe(JSON.stringify(control));
      expect(got.ok === false && got.error.code).toBe('not-found');
    }

    // R-5 and R-4: C, OPEN and reported, stays a player's -- in the feed, and in the view with no held_at
    const C = await create(CAST.KAI, 'Open, reported', T + 11_000);
    await ok('reports.file', CAST.LYRA, [], spam(CAST.KAI, C), T + 12_000);
    const feed = await ok('lff.feed.list', CAST.DEX, [], {}, T + 12_500);
    expect((feed as { posts: Array<{ postId: string }> }).posts.map((p) => p.postId), 'an open reported post stays listed').toContain(C);
    expect((await evidence()).map((r) => [r.post_id, r.held_at === null ? null : r.held_at.getTime()])).toEqual([[A, T + 8000], [C, null]]);
    const a = (await evidence())[0];
    expect(a.reports.map((r) => [r.reporter_id, r.reported_id, r.reason, r.note])).toEqual([[CAST.LYRA, CAST.KAI, 'SPAM', '']]);
    expect(a.requests.map((r) => `${r.request_id}:${r.requester_id}:${r.status}`)).toEqual([`${nova}:${CAST.NOVA}:PENDING`, `${vega}:${CAST.VEGA}:ACCEPTED`]);
    expect(a.snapshots.map((x) => [x.seq, x.cause, x.title]), 'A as reported (D-L5 r2)').toEqual([[1, 'REPORTED', 'Reported']]);

    // R-1: D, closed, reported AFTER it closed (by Lyra, ACCEPTED on it, so she may still see it: FQ-1 c); E, closed, unreported.
    // Orion's next timed write 30 days on purges: D held, E deleted
    const D = await create(CAST.ORION, 'Closed, reported', T + 13_000);
    const lyraOnD = await ask(CAST.LYRA, D, T + 14_000);
    await ok('lff.request.accept', CAST.ORION, [lyraOnD], {}, T + 14_500);
    await ok('lff.post.close', CAST.ORION, [D], {}, T + 15_000);
    await ok('reports.file', CAST.LYRA, [], spam(CAST.ORION, D), T + 16_000);
    const E = await create(CAST.ORION, 'Closed, unreported', T + 17_000);
    await ok('lff.post.close', CAST.ORION, [E], {}, T + 18_000);
    const purgeAt = T + 17_000 + LFF_RETENTION_MS + 1;
    const seq2 = await lastSeq(pool);
    const F = await create(CAST.ORION, 'The write that purges', purgeAt);
    expect([await heldAt(D), await requestsOn(D)], 'D held, Lyra\'s request with it').toEqual([purgeAt, [`${lyraOnD}:ACCEPTED`]]);
    expect(await heldAt(C), 'C, expired and past 30 days, is held too (it was reported)').toBe(purgeAt);
    expect(await rowOf(E), 'the control is purged').toBeUndefined();
    expect(await heldAt(A), 'A, held before, is untouched').toBe(T + 8000);
    expect(await eventsAfter(pool, seq2), 'the purge tells nobody').toEqual([['lff.post.create', [CAST.ORION]]]);
    expect((await evidence()).map((r) => r.post_id), 'the view: every evidence post, never B, E or F').toEqual([A, C, D]);

    // A RESTART reads the evidence APART: never a player's post or request
    const restarted = await openSocialPostgresStore(pool);
    const after = await restarted.read();
    expect([after.lffPosts.map((p) => p.id), after.lffRequests.map((r) => r.id)]).toEqual([[F], []]);
    expect(after.lffHeld.map((h) => [h.post.id, h.heldAtMs, h.requests.map((r) => r.id)])).toEqual([[A, T + 8000, [nova, vega]], [C, purgeAt, []], [D, purgeAt, [lyraOnD]]]);
    expect(after.lffHeld, 'the live store holds the same evidence').toEqual((await pg.read()).lffHeld);
    expect(after.lffSnapshots, 'and the same snapshots').toEqual((await pg.read()).lffSnapshots);
    expect(after.lffSnapshots.map((x) => [x.postId, x.seq, x.cause])).toEqual([[A, 1, 'REPORTED'], [C, 1, 'REPORTED'], [D, 1, 'REPORTED']]);

    // THE STALE STORE: an edit over the held post, an accept of a request on it and a new request on it are refused (no row moves);
    // its delete removes nothing
    const rowsBefore = await checksums(pool);
    const outage = { code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed' };
    expect(await apply(stale, 'lff.post.edit', CAST.KAI, [A], { title: 'over the evidence' }, T + 20_000)).toMatchObject({ ok: false, error: outage });
    expect(await apply(stale, 'lff.request.accept', CAST.KAI, [nova], {}, T + 21_000)).toMatchObject({ ok: false, error: outage });
    // a NEW request on the held post (the security review's m-3): the INSERT's own SELECT yields no row, so nothing is appended
    expect(await apply(stale, 'lff.request.create', CAST.DEX, [A], {}, T + 21_500)).toMatchObject({ ok: false, error: outage });
    expect(await checksums(pool), 'no row of any table moved').toEqual(rowsBefore);
    expect(lines).toEqual([lffSerialBehindLine('post'), lffSerialBehindLine('request'), lffSerialBehindLine('request')]);
    // n-g: A's snapshots removed (as an operator could): only the DELETE's own `held_at IS NULL` now stands between it and A
    await pool.query('DELETE FROM relay_wonderland.lff_post_snapshots WHERE post_id = $1', [A]);
    expect((await apply(stale, 'lff.post.delete', CAST.KAI, [A], {}, T + 22_000)).ok, 'the stale store believes it deleted A').toBe(true);
    expect([await heldAt(A), (await rowOf(A))?.title, await requestsOn(A)], '...but the held rows stay as they were').toEqual([T + 8000, 'Reported', [`${nova}:PENDING`, `${vega}:ACCEPTED`]]);

    // THE BACKSTOP: evidence only the DATABASE holds (another bridge filed a qualifying report: its row and its seq-1 snapshot) -- the
    // owner's delete holds G; it is never deleted. THE CONTROL, H: a report row alone (one that did not qualify, so no snapshot) holds
    // nothing, and H's delete is a hard delete: the database decides evidence by the snapshots, never by social_reports (FQ-1)
    const G = await create(CAST.KAI, 'Reported elsewhere', purgeAt + 10_000);
    const H = await create(CAST.KAI, 'Named by a report that did not qualify', purgeAt + 10_100);
    for (const [id, tag] of [[G, 'g'], [H, 'h']] as const) {
      await pool.query(
        `INSERT INTO relay_wonderland.social_reports(report_id, reporter_id, reported_id, reason, note, subject_ref, filed_at) VALUES($1, $2, $3, 'SPAM', '', $4, $5)`,
        [`rep_elsewhere_${tag}_${nonce}`, CAST.LYRA, CAST.KAI, id, at(purgeAt + 10_500)],
      );
    }
    await pool.query(
      `INSERT INTO relay_wonderland.lff_post_snapshots(post_id, seq, cause, report_id, captured_at, owner_id, category, title, description, project_label, skills,
         open_slots, status, created_at, updated_at, expires_at, version)
       SELECT post_id, 1, 'REPORTED', $2, $3, owner_id, category, title, description, project_label, skills, open_slots, status, created_at, updated_at, expires_at, version
         FROM relay_wonderland.lff_posts WHERE post_id = $1`,
      [G, `rep_elsewhere_g_${nonce}`, at(purgeAt + 10_500)],
    );
    await ok('lff.post.delete', CAST.KAI, [G], {}, purgeAt + 11_000);
    await ok('lff.post.delete', CAST.KAI, [H], {}, purgeAt + 11_500);
    expect(await heldAt(G), 'held at the delete\'s server time, not deleted').toBe(purgeAt + 11_000);
    expect(await rowOf(H), 'the control: a report row alone holds nothing').toBeUndefined();
    expect((await pg.read()).lffPosts.map((p) => p.id).filter((id) => id === G || id === H), 'to the players, both deleted').toEqual([]);
  }, 300_000);

  it('SNAPSHOTS (D-L5 r2, the security review\'s M-1): the content AS REPORTED survives the owner\'s edits -- the report writes seq 1, each edit appends one, the delete holds them all; both stores and a restart hold the same; the controls write none', async () => {
    const pool = await database('snapshots');
    const T = Date.now();
    const pg = await openSocialPostgresStore(pool);
    const memory = createInMemorySocialStore();
    await signIn([memory, pg], T - HOUR);
    const both = bothAt([memory, pg]);
    const P = (await both('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Abusive words', description: 'More of them', openSlots: 2 }, T)).postId as string;
    const Q = (await both('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Also abusive', openSlots: 2 }, T + 1000)).postId as string;
    await both('reports.file', CAST.LYRA, [], spamOf(CAST.KAI, P), T + 2000);
    await both('reports.file', CAST.LYRA, [], spamOf(CAST.NOVA, Q), T + 3000); // FQ-1 (a): it names someone other than Q's owner
    await both('reports.file', CAST.NOVA, [], spamOf(CAST.KAI, P), T + 3500); // a second report on P adds nothing: every edit is captured
    for (const id of [P, Q]) {
      await both('lff.post.edit', CAST.KAI, [id], { title: 'Nice words' }, T + 4000);
      await both('lff.post.edit', CAST.KAI, [id], { description: 'Nothing to see' }, T + 5000);
      await both('lff.post.delete', CAST.KAI, [id], {}, T + 6000);
    }
    const reportId = (await pool.query('SELECT report_id FROM relay_wonderland.social_reports WHERE subject_ref = $1 AND reporter_id = $2', [P, CAST.LYRA])).rows[0].report_id as string;
    const rows = (await pool.query('SELECT post_id, seq, cause, report_id, captured_at, title, description, version FROM relay_wonderland.lff_post_snapshots ORDER BY seq')).rows;
    expect(rows.map((r: Record<string, any>) => [r.post_id, r.seq, r.cause, r.report_id, r.captured_at.getTime(), r.title, r.description, Number(r.version)])).toEqual([
      [P, 1, 'REPORTED', reportId, T + 2000, 'Abusive words', 'More of them', 1],
      [P, 2, 'EDITED', null, T + 4000, 'Nice words', 'More of them', 2],
      [P, 3, 'EDITED', null, T + 5000, 'Nice words', 'Nothing to see', 3],
    ]);
    // P is HELD as last written; Q, which no qualifying report named, is DELETED (the control)
    const posts = (await pool.query('SELECT post_id, title, description, held_at FROM relay_wonderland.lff_posts')).rows;
    expect(posts.map((r: Record<string, any>) => [r.post_id, r.title, r.description, r.held_at?.getTime() ?? null])).toEqual([[P, 'Nice words', 'Nothing to see', T + 6000]]);
    // THE VIEW: the post as last written, and what was REPORTED, then each edit
    const view = (await pool.query('SELECT post_id, title, snapshots FROM relay_wonderland.lff_moderation_evidence')).rows;
    expect(view.map((r: Record<string, any>) => [r.post_id, r.title, r.snapshots.map((x: Record<string, unknown>) => [x.seq, x.title, x.description])])).toEqual([
      [P, 'Nice words', [[1, 'Abusive words', 'More of them'], [2, 'Nice words', 'More of them'], [3, 'Nice words', 'Nothing to see']]],
    ]);
    // BOTH STORES, AND A RESTART, hold the same evidence
    const [fromPg, fromMemory, restarted] = [await pg.read(), await memory.read(), await (await openSocialPostgresStore(pool)).read()];
    expect([fromPg.lffSnapshots, fromPg.lffHeld], 'the PostgreSQL store holds what memory holds').toEqual([fromMemory.lffSnapshots, fromMemory.lffHeld]);
    expect([restarted.lffSnapshots, restarted.lffHeld], 'and a restart reads it back').toEqual([fromMemory.lffSnapshots, fromMemory.lffHeld]);
    expect(fromMemory.lffSnapshots.map((x) => [x.postId, x.seq])).toEqual([[P, 1], [P, 2], [P, 3]]);
  }, 300_000);

  it('HOLD RULE (FQ-1, MAIN\'s default, flagged to the founder): a report naming another player, a pre-report of an id not yet minted, and one from a reporter walled either way or not shown a closed post are FILED and hold nothing; each control holds, and so does one dated before the post (m-1)', async () => {
    const pool = await database('holdrule');
    const T = Date.now();
    const pg = await openSocialPostgresStore(pool);
    await signIn([pg], T - HOUR);
    const ok = async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
      const r = await apply(pg, op, who, ids, body, ms);
      expect(r.ok, `${op} by ${who} at ${at(ms)}: ${r.ok ? '' : `${r.error.code} ${r.error.message}`}`).toBe(true);
      return r.ok ? r.value : undefined;
    };
    const create = async (owner: string, title: string, ms: number): Promise<string> => (await ok('lff.post.create', owner, [], { category: 'TEAMS', title, openSlots: 3 }, ms)).postId as string;
    const report = (who: string, reportedId: string, subjectRef: string, ms: number) => ok('reports.file', who, [], spamOf(reportedId, subjectRef), ms);
    const snapshotOf = async (id: string): Promise<string[]> =>
      (await pool.query('SELECT report_id FROM relay_wonderland.lff_post_snapshots WHERE post_id = $1 ORDER BY seq', [id])).rows.map((r: { report_id: string }) => r.report_id);
    const reportsNaming = async (id: string): Promise<string[]> =>
      (await pool.query('SELECT report_id FROM relay_wonderland.social_reports WHERE subject_ref = $1 ORDER BY filed_at, report_id', [id])).rows.map((r: { report_id: string }) => r.report_id);

    // (a) Kai's posts: a report naming NOVA, not their owner; the control names Kai
    const A = await create(CAST.KAI, 'a', T);
    await report(CAST.LYRA, CAST.NOVA, A, T + 1000);
    const A2 = await create(CAST.KAI, 'a, the control', T + 2000);
    await report(CAST.LYRA, CAST.KAI, A2, T + 3000);
    // (b) Orion's posts: a pre-report of the next id (the report mints rep_<serial>, the post takes the next) holds nothing; one filed
    // 1 ms before its post was made (a stepped-back server clock) is about a post that exists, so it HOLDS (the D-L5 r2 security
    // review's m-1); the control, at exactly its creation
    const next = `lffp_${(await pg.read()).nextSerial + 1}`;
    await report(CAST.LYRA, CAST.ORION, next, T + 4000);
    const B = await create(CAST.ORION, 'b', T + 5000);
    expect(B, 'the pre-reported id is the post\'s').toBe(next);
    const B2 = await create(CAST.ORION, 'b, stepped back', T + 6000);
    await report(CAST.LYRA, CAST.ORION, B2, T + 5999);
    const B3 = await create(CAST.ORION, 'b, the control', T + 7000);
    await report(CAST.LYRA, CAST.ORION, B3, T + 7000);
    // (c) Cleo's posts: Cleo walls Lyra, and Dex walls Cleo -- each reports C; Eli, pending on the CLOSED C2, is not shown it. The
    // controls: Nova (no wall) reports C; Vega, ACCEPTED on C2, may still see it and reports it
    const C = await create(CAST.CLEO, 'c', T + 8000);
    await ok('blocks.add', CAST.CLEO, [], { targetId: CAST.LYRA }, T + 8500);
    await report(CAST.LYRA, CAST.CLEO, C, T + 9000);
    await ok('blocks.add', CAST.DEX, [], { targetId: CAST.CLEO }, T + 9500);
    await report(CAST.DEX, CAST.CLEO, C, T + 10_000);
    expect(await snapshotOf(C), 'walled either way: nothing').toEqual([]);
    const C2 = await create(CAST.CLEO, 'c2', T + 11_000);
    await ok('lff.request.create', CAST.ELI, [C2], {}, T + 11_100);
    const vega = (await ok('lff.request.create', CAST.VEGA, [C2], {}, T + 11_200)).requestId as string;
    await ok('lff.request.accept', CAST.CLEO, [vega], {}, T + 11_300);
    await ok('lff.post.close', CAST.CLEO, [C2], {}, T + 12_000);
    await report(CAST.ELI, CAST.CLEO, C2, T + 12_500);
    expect(await snapshotOf(C2), 'not shown a closed post: nothing').toEqual([]);
    await report(CAST.NOVA, CAST.CLEO, C, T + 13_000);
    await report(CAST.VEGA, CAST.CLEO, C2, T + 13_500);

    // EVERY report is FILED, for moderators to read, whatever it holds
    for (const [id, n] of [[A, 1], [A2, 1], [B, 1], [B2, 1], [B3, 1], [C, 3], [C2, 2]] as const) expect(await reportsNaming(id), `${id}: filed`).toHaveLength(n);
    // only the qualifying ones made a post evidence, each naming the report that did
    const qualifying = async (id: string, who: string) => (await pool.query('SELECT report_id FROM relay_wonderland.social_reports WHERE subject_ref = $1 AND reporter_id = $2', [id, who])).rows[0].report_id as string;
    expect([await snapshotOf(A), await snapshotOf(B)], '(a), (b): nothing').toEqual([[], []]);
    expect([await snapshotOf(A2), await snapshotOf(B2), await snapshotOf(B3), await snapshotOf(C), await snapshotOf(C2)], 'the controls, and m-1\'s stepped-back report').toEqual([
      [await qualifying(A2, CAST.LYRA)], [await qualifying(B2, CAST.LYRA)], [await qualifying(B3, CAST.LYRA)], [await qualifying(C, CAST.NOVA)], [await qualifying(C2, CAST.VEGA)],
    ]);
    // m-1's snapshot is stamped no earlier than the post was last written (037's snapshot times CHECK accepted it)
    expect((await pool.query('SELECT captured_at, updated_at FROM relay_wonderland.lff_post_snapshots WHERE post_id = $1', [B2])).rows.map((r: { captured_at: Date; updated_at: Date }) => [r.captured_at.getTime(), r.updated_at.getTime()]))
      .toEqual([[T + 6000, T + 6000]]);
    // THE OWNERS DELETE THEM ALL: the evidence is held, everything else is a hard delete
    for (const [owner, ids] of [[CAST.KAI, [A, A2]], [CAST.ORION, [B, B2, B3]], [CAST.CLEO, [C, C2]]] as const) {
      for (const id of ids) await ok('lff.post.delete', owner, [id], {}, T + 20_000);
    }
    const left = (await pool.query('SELECT post_id, held_at FROM relay_wonderland.lff_posts ORDER BY length(post_id), post_id')).rows;
    expect(left.map((r: { post_id: string; held_at: Date | null }) => [r.post_id, r.held_at?.getTime() ?? null])).toEqual([[A2, T + 20_000], [B2, T + 20_000], [B3, T + 20_000], [C, T + 20_000], [C2, T + 20_000]]);
    expect((await pool.query('SELECT post_id FROM relay_wonderland.lff_moderation_evidence ORDER BY length(post_id), post_id')).rows.map((r: { post_id: string }) => r.post_id)).toEqual([A2, B2, B3, C, C2]);
    expect((await (await openSocialPostgresStore(pool)).read()).lffHeld, 'a restart reads the same evidence').toEqual((await pg.read()).lffHeld);
  }, 300_000);

  for (const op of ['lff.request.decline', 'lff.request.withdraw'] as const) {
    it(`m1 RESTART PARITY (${op}): the ${op} whose own write purges its evidence post is written FIRST, then the hold -- the database keeps it as memory does, and a restart reads back what both stores hold; the control (the same ${op} before 30 days) holds nothing`, async () => {
      const pool = await database(op === 'lff.request.decline' ? 'm1decline' : 'm1withdraw');
      const T = Date.now();
      const pg = await openSocialPostgresStore(pool);
      const memory = createInMemorySocialStore();
      await signIn([memory, pg], T - HOUR);
      const both = bothAt([memory, pg]);
      const P = (await both('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T)).postId as string;
      const nova = (await both('lff.request.create', CAST.NOVA, [P], {}, T + 1000)).requestId as string;
      const vega = (await both('lff.request.create', CAST.VEGA, [P], {}, T + 2000)).requestId as string;
      await both('reports.file', CAST.LYRA, [], spamOf(CAST.KAI, P), T + 3000);
      await both('lff.post.close', CAST.KAI, [P], {}, T + 4000);
      const status = op === 'lff.request.decline' ? 'DECLINED' : 'WITHDRAWN';
      const actorOf = (requester: string) => (op === 'lff.request.decline' ? CAST.KAI : requester);
      const rowOf = async (id: string): Promise<[string, number]> => {
        const r = (await pool.query('SELECT status, updated_at FROM relay_wonderland.lff_join_requests WHERE request_id = $1', [id])).rows[0];
        return [r.status, r.updated_at.getTime()];
      };
      const heldAt = async (): Promise<number | null> => (await pool.query('SELECT held_at FROM relay_wonderland.lff_posts WHERE post_id = $1', [P])).rows[0].held_at?.getTime() ?? null;
      // THE CONTROL: Vega's request, ten minutes on -- nothing is due, nothing is held
      await both(op, actorOf(CAST.VEGA), [vega], {}, T + 10 * MIN);
      expect([await rowOf(vega), await heldAt()]).toEqual([[status, T + 10 * MIN], null]);
      // THE CASE: Nova's request, 1 ms past 30 days -- the same write purges P, which is evidence, so it HOLDS it
      const due = T + LFF_RETENTION_MS + 1;
      await both(op, actorOf(CAST.NOVA), [nova], {}, due);
      expect([await heldAt(), await rowOf(nova), await rowOf(vega)], 'the database: held, Nova\'s request as last written').toEqual([due, [status, due], [status, T + 10 * MIN]]);
      const view = (await pool.query('SELECT requests FROM relay_wonderland.lff_moderation_evidence WHERE post_id = $1', [P])).rows[0].requests as Array<Record<string, string>>;
      expect(view.map((r) => [r.request_id, r.status]), 'the evidence view, too').toEqual([[nova, status], [vega, status]]);
      const [fromPg, fromMemory, restarted] = [await pg.read(), await memory.read(), await (await openSocialPostgresStore(pool)).read()];
      expect(fromMemory.lffHeld.map((h) => [h.post.id, h.heldAtMs, h.requests.map((r) => [r.id, r.status, r.updatedAtMs])])).toEqual([[P, due, [[nova, status, due], [vega, status, T + 10 * MIN]]]]);
      expect(fromPg.lffHeld, 'the PostgreSQL store holds what memory holds').toEqual(fromMemory.lffHeld);
      expect([restarted.lffHeld, restarted.lffSnapshots, restarted.lffPosts, restarted.lffRequests], 'and a restart reads back exactly that').toEqual([fromMemory.lffHeld, fromMemory.lffSnapshots, fromMemory.lffPosts, fromMemory.lffRequests]);
    }, 300_000);
  }
});
