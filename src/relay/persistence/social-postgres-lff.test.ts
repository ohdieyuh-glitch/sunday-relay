import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { RelayResult } from '../protocol/errors';
import type { SocialCommandOutcome } from '../social/social-commands';
import type { SocialOperationId } from '../social/social-contracts';
import { LFF_NOT_FOUND_MESSAGE, LFF_RETENTION_MS } from '../social/social-lff';
import { emptySocialState, type SocialState } from '../social/social-state';
import { createInMemorySocialStore, type SocialStore } from '../social/social-store';
import { emptyWorldState } from '../social/world-presence';
import { durableWriteOf, EVENT_AUDIENCE_MAX, lffSerialBehindLine, openSocialPostgresStore, SocialEventNotWritten, writeSocialEvent } from './social-postgres';

/*
 * LFF ON THE POSTGRESQL SOCIAL STORE, WITHOUT A DATABASE (slice B2b). A fake pool answers the protected-store identity reads as an
 * ordinary database, hands back the rows a case gives it for each table, and RECORDS every other statement with its parameters, so
 * what the store writes -- which rows, in which order, in which transaction -- is read off exactly:
 *   - LOAD: the three LFF tables read back as the domain holds them (bigint and integer through Number, times as epoch ms);
 *   - WRITE-THROUGH ORDER: post deletes, request deletes, post upserts, request upserts, then the creation record (pruning other
 *     players' rows too); the extra events (a fill's close, a block's withdrawal or deletion) BEFORE the operation's own, all in
 *     the operation's one transaction;
 *   - FAIL CLOSED: an extra event the database refuses OR swallows (rowCount 0) rolls the whole operation back, and the store keeps
 *     the state it had; the control (the same operation, nothing injected) commits;
 *   - NO GRAFT (review m1): a post or request id the database already holds for ANOTHER row (another owner, created_at, post or
 *     requester, or a newer version) is refused by the guarded upsert (the fake decides it as PostgreSQL's WHERE does), and the
 *     whole operation rolls back; the controls -- the owner's own row, updated -- commit;
 *   - THE GUARDS: an outcome that carries an extra event is a WRITE whatever else it carries (durableWriteOf), so neither the
 *     world path nor the read path can drop one; writeSocialEvent de-duplicates, skips an empty audience and cuts rows at 256;
 *   - THE STORY: one LFF story through the in-memory store and this store; every viewer's event stream, rebuilt from the committed
 *     social_events rows, is byte for byte the in-memory store's. social-postgres-lff.real-postgres.test.ts runs the SAME story
 *     text (checked here) against real PostgreSQL, where the database assigns the sequence and reads it back.
 */

/* ------------------------------------------------------------------------------------------------------------ the fake */

interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}
type Fault = { readonly match: (s: Statement) => boolean; readonly kind: 'throw' | 'swallow' } | null;

/** What the fake database knows of a post or request row under an id: the facts the guarded upserts' WHERE compares. */
interface PostFacts { readonly owner: string; readonly createdMs: number; readonly version: number }
interface RequestFacts { readonly postId: string; readonly requesterId: string; readonly createdMs: number }
/**
 * What the fake database holds: post and request rows, the posts whose held_at is set (D-L5 moderation evidence), and the keys
 * (post_id#seq) of the lff_post_snapshots rows -- a post with one is EVIDENCE, which the hold-or-delete statements ask.
 */
interface Held { posts: Map<string, PostFacts>; requests: Map<string, RequestFacts>; evidence: Set<string>; snapshots: Set<string> }
/**
 * Rows the database holds that the store never loaded (an id minted elsewhere: a lost acknowledgement, a stale second bridge), and
 * facts another bridge wrote: a post held (`evidence`), a post made evidence (`snapshots`: post ids with a seq-1 snapshot).
 */
interface Unseen {
  readonly posts?: Readonly<Record<string, PostFacts>>;
  readonly requests?: Readonly<Record<string, RequestFacts>>;
  readonly evidence?: readonly string[];
  readonly snapshots?: readonly string[];
}

function fakePool(tables: Readonly<Record<string, readonly Record<string, unknown>[]>> = {}, unseen: Unseen = {}) {
  const executed: Statement[] = [];
  let fault: Fault = null;
  // THE GUARDED UPSERTS AS POSTGRESQL DECIDES THEM (ON CONFLICT ... DO UPDATE ... WHERE): under a held id, a row is updated (rowCount 1)
  // only when the WHERE holds -- a post of the same owner and created_at at no newer version, NOT held (D-L5); a request of the same
  // post, requester and created_at -- and otherwise nothing happens (rowCount 0); a request on a HELD post writes nothing at all (its
  // INSERT ... SELECT yields no row). A ROLLBACK puts back what BEGIN saw; a post delete cascades its requests. THE D-L5 STATEMENTS as
  // their WHERE decides them: the hold (its own row: same owner and created_at, held_at NULL), the backstop hold (also: a snapshot
  // names the post), the post DELETE (its own row, not held, no snapshot), the "another row under this id?" check, the request
  // DELETE (refused while its post is held) and the snapshot INSERT (a second write of a key refused, class 23).
  let held: Held = {
    posts: new Map<string, PostFacts>([
      ...(tables.lff_posts ?? []).map((r): [string, PostFacts] => [String(r.post_id), { owner: String(r.owner_id), createdMs: new Date(r.created_at as Date).getTime(), version: Number(r.version) }]),
      ...Object.entries(unseen.posts ?? {}),
    ]),
    requests: new Map<string, RequestFacts>([
      ...(tables.lff_join_requests ?? []).map((r): [string, RequestFacts] => [
        String(r.request_id),
        { postId: String(r.post_id), requesterId: String(r.requester_id), createdMs: new Date(r.created_at as Date).getTime() },
      ]),
      ...Object.entries(unseen.requests ?? {}),
    ]),
    evidence: new Set([
      ...(tables.lff_posts ?? []).filter((r) => r.held_at !== null && r.held_at !== undefined).map((r) => String(r.post_id)),
      ...(unseen.evidence ?? []),
    ]),
    snapshots: new Set([
      ...(tables.lff_post_snapshots ?? []).map((r) => `${String(r.post_id)}#${String(r.seq)}`),
      ...(unseen.snapshots ?? []).map((id) => `${id}#1`),
    ]),
  };
  let saved: Held = held;
  const copy = (h: Held): Held => ({ posts: new Map(h.posts), requests: new Map(h.requests), evidence: new Set(h.evidence), snapshots: new Set(h.snapshots) });
  const isEvidence = (id: string): boolean => [...held.snapshots].some((k) => k.startsWith(`${id}#`));
  const ours = (id: string, owner: unknown, created: unknown): boolean => {
    const row = held.posts.get(id);
    return row !== undefined && row.owner === String(owner) && row.createdMs === (created as Date).getTime();
  };
  const guardedUpsert = (statement: Statement): number | null => {
    const p = statement.params;
    if (statement.sql.startsWith('INSERT INTO relay_wonderland.lff_posts')) {
      const mine: PostFacts = { owner: String(p[1]), createdMs: (p[9] as Date).getTime(), version: Number(p[12]) };
      const was = held.posts.get(String(p[0]));
      if (was !== undefined && !(was.owner === mine.owner && was.createdMs === mine.createdMs && was.version <= mine.version && !held.evidence.has(String(p[0])))) return 0;
      held.posts.set(String(p[0]), mine);
      return 1;
    }
    if (statement.sql.startsWith('INSERT INTO relay_wonderland.lff_join_requests')) {
      const mine: RequestFacts = { postId: String(p[1]), requesterId: String(p[2]), createdMs: (p[5] as Date).getTime() };
      if (held.evidence.has(mine.postId)) return 0; // the INSERT's own SELECT yields no row on a held post
      const was = held.requests.get(String(p[0]));
      if (was !== undefined && !(was.postId === mine.postId && was.requesterId === mine.requesterId && was.createdMs === mine.createdMs)) return 0;
      held.requests.set(String(p[0]), mine);
      return 1;
    }
    if (statement.sql.startsWith('INSERT INTO relay_wonderland.lff_post_snapshots')) {
      const key = `${String(p[0])}#${String(p[1])}`;
      if (held.snapshots.has(key)) throw Object.assign(new Error('duplicate key value violates unique constraint "lff_post_snapshots_pkey"'), { code: '23505' });
      held.snapshots.add(key);
      return 1;
    }
    if (statement.sql.startsWith('UPDATE relay_wonderland.lff_posts SET held_at')) {
      const id = String(p[0]);
      const backstop = statement.sql.includes('EXISTS');
      if (!ours(id, p[2], p[3]) || held.evidence.has(id) || (backstop && !isEvidence(id))) return 0;
      held.evidence.add(id);
      return 1;
    }
    if (statement.sql.startsWith('DELETE FROM relay_wonderland.lff_posts')) {
      const id = String(p[0]);
      if (!ours(id, p[1], p[2]) || held.evidence.has(id) || isEvidence(id)) return 0;
      held.posts.delete(id);
      for (const [rid, r] of held.requests) if (r.postId === id) held.requests.delete(rid);
      return 1;
    }
    if (statement.sql.startsWith('DELETE FROM relay_wonderland.lff_join_requests')) {
      const was = held.requests.get(String(p[0]));
      if (was === undefined || held.evidence.has(was.postId)) return 0;
      held.requests.delete(String(p[0]));
      return 1;
    }
    return null;
  };
  const query = async (sql: string, params: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    // the protected-store writer guard's identity reads: an ORDINARY database (protected-store-writer-guard.test.ts's ORDINARY)
    if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'railway' }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    const statement: Statement = { sql: sql.trim().replace(/\s+/gu, ' '), params };
    executed.push(statement);
    const read = /^SELECT \* FROM relay_wonderland\.(\w+)/u.exec(statement.sql);
    if (read !== null) {
      const rows = (tables[read[1]] ?? []).map((row) => ({ ...row }));
      return { rows, rowCount: rows.length };
    }
    // the hold's "is ANOTHER row under this id?" check (D-L5, the security review's m-2)
    if (statement.sql.startsWith('SELECT 1 FROM relay_wonderland.lff_posts')) {
      const id = String(params[0]);
      const other = held.posts.has(id) && !ours(id, params[1], params[2]);
      return { rows: other ? [{ '?column?': 1 }] : [], rowCount: other ? 1 : 0 };
    }
    if (statement.sql === 'BEGIN') saved = copy(held);
    if (statement.sql === 'ROLLBACK') held = saved;
    if (fault !== null && fault.match(statement)) {
      if (fault.kind === 'throw') throw Object.assign(new Error('injected: the event log refused this row'), { code: '53100' });
      return { rows: [], rowCount: 0 }; // a rule or trigger that swallowed the INSERT
    }
    const upserted = guardedUpsert(statement);
    if (upserted !== null) return { rows: [], rowCount: upserted };
    return { rows: [], rowCount: /^(INSERT|UPDATE|DELETE)\b/u.test(statement.sql) ? 1 : 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return {
    pool,
    executed,
    inject: (next: Fault) => { fault = next; },
    held: () => held,
    /** Another bridge's writes the store's state never saw: a post made evidence (its seq-1 snapshot); a post held; a post's row replaced. */
    dbEvidence: (postId: string) => { held.snapshots.add(`${postId}#1`); },
    dbHold: (postId: string) => { held.evidence.add(postId); },
    dbReplacePost: (postId: string, facts: PostFacts) => { held.posts.set(postId, facts); },
  };
}

/** One recorded statement, as a line a case can compare: the verb, the table and the key facts of the row. */
function label(s: Statement): string {
  if (s.sql === 'BEGIN' || s.sql === 'COMMIT' || s.sql === 'ROLLBACK') return s.sql;
  if (s.sql.startsWith('SELECT 1 FROM relay_wonderland.lff_posts')) return `check post ${String(s.params[0])} is ours`;
  const m = /^(INSERT INTO|DELETE FROM|UPDATE) relay_wonderland\.(\w+)/u.exec(s.sql);
  if (m === null) return s.sql.slice(0, 60);
  const p = s.params;
  switch (m[2]) {
    case 'social_events':
      return `event ${String(p[0])} -> ${(p[2] as string[]).join(',')}`;
    case 'lff_posts':
      if (m[1] === 'UPDATE') return `hold post ${String(p[0])}${s.sql.includes('EXISTS') ? ' if evidence' : ''}`;
      return m[1] === 'DELETE FROM' ? `delete post ${String(p[0])}` : `upsert post ${String(p[0])} ${String(p[8])} v${String(p[12])}`;
    case 'lff_join_requests':
      return m[1] === 'DELETE FROM' ? `delete request ${String(p[0])}` : `upsert request ${String(p[0])} ${String(p[4])}`;
    case 'lff_post_snapshots':
      return `snapshot ${String(p[0])} #${String(p[1])} ${String(p[2])}`;
    case 'lff_post_creations':
      return `${m[1] === 'DELETE FROM' ? 'delete' : 'insert'} creation ${String(p[0])}/${String(p[1])}`;
    default:
      return `${m[1] === 'DELETE FROM' ? 'delete' : 'write'} ${m[2]}`;
  }
}

/** The event rows that COMMITTED, in the order written (a fresh bigserial numbers them 1, 2, 3, ...). */
function committedEvents(executed: readonly Statement[]): { op: string; atIso: string; audience: string[] }[] {
  const out: { op: string; atIso: string; audience: string[] }[] = [];
  let open: typeof out = [];
  for (const s of executed) {
    if (s.sql === 'BEGIN') open = [];
    else if (s.sql === 'COMMIT') out.push(...open);
    else if (s.sql === 'ROLLBACK') open = [];
    else if (s.sql.startsWith('INSERT INTO relay_wonderland.social_events')) open.push({ op: String(s.params[0]), atIso: String(s.params[1]), audience: s.params[2] as string[] });
  }
  return out;
}

/* ----------------------------------------------------------------------------------------------------------- the setup */

const T0 = Date.parse('2026-10-12T09:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const nameOf = (id: string) => id.split('_')[1].replace(/^./u, (c) => c.toUpperCase());

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

const CAST: Cast = Object.fromEntries(ROLES.map((r) => [r, `usr_${r.toLowerCase()}`])) as Cast;
const EVERYONE = Object.values(CAST);

/**
 * The PostgreSQL store over a fake pool (and, when asked, the in-memory store), every player of the cast already signed in. `lines`
 * holds what the store logged (its operator lines).
 */
async function stores(tables: Readonly<Record<string, readonly Record<string, unknown>[]>> = {}, unseen: Unseen = {}) {
  const fake = fakePool(tables, unseen);
  const lines: string[] = [];
  const pg = await openSocialPostgresStore(fake.pool, { log: (line) => lines.push(line) });
  const memory = createInMemorySocialStore();
  for (const id of EVERYONE) {
    const identity = { userId: id, displayName: nameOf(id), handle: `@${id}` };
    await pg.ensureUser(identity, new Date(T0 - HOUR).toISOString());
    await memory.ensureUser(identity, new Date(T0 - HOUR).toISOString());
  }
  return { ...fake, pg, memory, lines };
}

/** An Act over these stores, the clock moving one second per operation (or set by `at`). */
function actor(on: readonly SocialStore[], clock = { ms: T0 }): Act {
  return async (op, who, ids = [], body = {}) => {
    clock.ms += 1000;
    const nowIso = new Date(clock.ms).toISOString();
    const results: RelayResult<unknown>[] = [];
    for (const store of on) results.push(await store.apply(op, who, { ids, body, query: {} }, nowIso));
    const first = results[0];
    expect(first.ok, `${op} by ${who}: ${first.ok ? '' : first.error.message}`).toBe(true);
    for (const r of results) expect(JSON.stringify(r), `${op} by ${who}: every store answers alike`).toBe(JSON.stringify(first));
    return first.ok ? (first.value as any) : undefined;
  };
}

const apply = (store: SocialStore, op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number) =>
  store.apply(op, who, { ids, body, query: {} }, new Date(ms).toISOString());

/* ------------------------------------------------------------------------------------------------------------- the cases */

describe('LFF on the PostgreSQL social store, without a database (slice B2b)', () => {
  it('LOAD: the three LFF tables come back as the domain holds them -- bigint and integer through Number, times as epoch ms', async () => {
    const { pg, executed } = await stores({
      lff_posts: [
        {
          post_id: 'lffp_12', owner_id: CAST.KAI, category: 'BUILDERS', title: 'Two builders', description: 'Nights', project_label: 'Relay jam',
          skills: ['Rust', 'Unreal'], open_slots: 2, status: 'CLOSED', created_at: new Date(T0), updated_at: new Date(T0 + 5 * MIN),
          expires_at: new Date(T0 + 14 * 24 * HOUR), version: '3',
        },
        {
          post_id: 'lffp_9', owner_id: CAST.NOVA, category: 'TEAMS', title: 'A squad', description: '', project_label: '', skills: null,
          open_slots: 1, status: 'OPEN', created_at: new Date(T0 - HOUR), updated_at: new Date(T0 - HOUR), expires_at: new Date(T0 + 13 * 24 * HOUR), version: '1',
        },
      ],
      lff_join_requests: ['PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED'].map((status, i) => ({
        request_id: `lffr_${20 + i}`, post_id: 'lffp_12', requester_id: EVERYONE[i + 1], message: i === 0 ? 'hi' : '', status,
        created_at: new Date(T0 + i * MIN), updated_at: new Date(T0 + (i + 1) * MIN),
      })),
      lff_post_creations: [{ owner_id: CAST.KAI, post_id: 'lffp_12', created_at: new Date(T0) }, { owner_id: CAST.NOVA, post_id: 'lffp_9', created_at: new Date(T0 - HOUR) }],
    });
    const state = await pg.read();
    expect(state.lffPosts).toEqual([
      {
        id: 'lffp_12', ownerId: CAST.KAI, category: 'BUILDERS', title: 'Two builders', description: 'Nights', projectLabel: 'Relay jam', skills: ['Rust', 'Unreal'],
        openSlots: 2, status: 'CLOSED', createdAtMs: T0, updatedAtMs: T0 + 5 * MIN, expiresAtMs: T0 + 14 * 24 * HOUR, version: 3,
      },
      {
        id: 'lffp_9', ownerId: CAST.NOVA, category: 'TEAMS', title: 'A squad', description: '', projectLabel: '', skills: [], openSlots: 1, status: 'OPEN',
        createdAtMs: T0 - HOUR, updatedAtMs: T0 - HOUR, expiresAtMs: T0 + 13 * 24 * HOUR, version: 1,
      },
    ]);
    expect(state.lffPosts.map((p) => typeof p.version), 'a bigint arrives as a string; the domain holds a number').toEqual(['number', 'number']);
    expect(state.lffRequests.map((r) => [r.id, r.status, r.requesterId, r.createdAtMs, r.updatedAtMs])).toEqual(
      ['PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED'].map((status, i) => [`lffr_${20 + i}`, status, EVERYONE[i + 1], T0 + i * MIN, T0 + (i + 1) * MIN]),
    );
    expect(state.lffRequests[0]).toEqual({ id: 'lffr_20', postId: 'lffp_12', requesterId: CAST.NOVA, message: 'hi', status: 'PENDING', createdAtMs: T0, updatedAtMs: T0 + MIN });
    expect(state.lffCreations).toEqual([{ userId: CAST.KAI, postId: 'lffp_12', atMs: T0 }, { userId: CAST.NOVA, postId: 'lffp_9', atMs: T0 - HOUR }]);
    // each table read once, in the serial order the domain appended them in
    const reads = executed.map((s) => s.sql).filter((sql) => sql.includes('relay_wonderland.lff_'));
    expect(reads).toEqual([
      'SELECT * FROM relay_wonderland.lff_posts ORDER BY length(post_id), post_id COLLATE "C"',
      'SELECT * FROM relay_wonderland.lff_join_requests ORDER BY length(request_id), request_id COLLATE "C"',
      'SELECT * FROM relay_wonderland.lff_post_creations ORDER BY length(post_id), post_id COLLATE "C", owner_id COLLATE "C"',
      'SELECT * FROM relay_wonderland.lff_post_snapshots ORDER BY length(post_id), post_id COLLATE "C", seq',
    ]);
  });

  it('CREATE: the post, the pruning of EVERY player\'s creations older than the window, the new creation, the serial, then the event -- one transaction', async () => {
    const { pg, executed } = await stores({
      lff_post_creations: [
        { owner_id: CAST.NOVA, post_id: 'lffp_900', created_at: new Date(T0 - 25 * HOUR) }, // another player's, past the window: pruned
        { owner_id: CAST.KAI, post_id: 'lffp_901', created_at: new Date(T0 - HOUR) }, // inside the window: kept
      ],
    });
    const mark = executed.length;
    expect((await apply(pg, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2, skills: ['Go'] }, T0)).ok).toBe(true);
    expect(executed.slice(mark).map(label)).toEqual([
      'BEGIN',
      'upsert post lffp_1 OPEN v1',
      `delete creation ${CAST.NOVA}/lffp_900`,
      `insert creation ${CAST.KAI}/lffp_1`,
      'write social_meta',
      `event lff.post.create -> ${CAST.KAI}`,
      'COMMIT',
    ]);
    const post = executed.slice(mark).find((s) => s.sql.startsWith('INSERT INTO relay_wonderland.lff_posts'))!;
    expect(post.params.slice(0, 9)).toEqual(['lffp_1', CAST.KAI, 'TEAMS', 'A squad', '', '', ['Go'], 2, 'OPEN']);
    expect((post.params.slice(9, 12) as Date[]).map((d) => d.getTime()), 'created, updated, expires: the domain\'s milliseconds').toEqual([T0, T0, T0 + 14 * 24 * HOUR]);
    expect(post.params[12]).toBe(1);
    expect((await pg.read()).lffCreations.map((c) => c.postId)).toEqual(['lffp_901', 'lffp_1']);
  });

  it('ACCEPT THAT FILLS: the post upsert BEFORE the request upsert (its foreign key), then the close told to the others BEFORE the accept', async () => {
    const { pg, executed } = await stores();
    const act = actor([pg]);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 1 })).postId;
    const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId;
    await act('lff.request.create', CAST.VEGA, [A]);
    const mark = executed.length;
    await act('lff.request.accept', CAST.KAI, [nova]);
    expect(executed.slice(mark).map(label)).toEqual([
      'BEGIN',
      `upsert post ${A} CLOSED v2`,
      `upsert request ${nova} ACCEPTED`,
      `event lff.post.close -> ${CAST.VEGA}`,
      `event lff.request.accept -> ${CAST.KAI},${CAST.NOVA}`,
      'COMMIT',
    ]);
  });

  it('DELETE: the post (it cascades its requests: no statement per request, review n3); the creation record stays', async () => {
    const { pg, executed, held } = await stores();
    const act = actor([pg]);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 1 })).postId;
    const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId;
    const mark = executed.length;
    await act('lff.post.delete', CAST.KAI, [A]);
    expect(executed.slice(mark).map(label)).toEqual(['BEGIN', `delete post ${A}`, `event lff.post.delete -> ${CAST.KAI},${CAST.NOVA}`, 'COMMIT']);
    expect([held().posts.has(A), held().requests.has(nova)], 'the cascade took the request').toEqual([false, false]);
    expect((await pg.read()).lffCreations.map((c) => c.postId), 'a deleted post still counts toward the cap').toEqual([A]);
  });

  it('RETENTION (review m3): exactly 30 days old a closed post stays; 1 ms older the next write deletes it -- ONE statement per post, its requests by the cascade', async () => {
    const { pg, executed, held } = await stores();
    const ok = async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
      const r = await apply(pg, op, who, ids, body, ms);
      expect(r.ok, `${op} by ${who}: ${r.ok ? '' : r.error.message}`).toBe(true);
      return r.ok ? r.value : undefined;
    };
    const A = (await ok('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T0)).postId as string;
    const nova = (await ok('lff.request.create', CAST.NOVA, [A], {}, T0 + 1000)).requestId as string;
    const vega = (await ok('lff.request.create', CAST.VEGA, [A], {}, T0 + 2000)).requestId as string;
    await ok('lff.request.accept', CAST.KAI, [nova], {}, T0 + 3000);
    await ok('lff.request.decline', CAST.KAI, [vega], {}, T0 + 4000);
    await ok('lff.post.close', CAST.KAI, [A], {}, T0 + 5000);
    const L = (await ok('lff.post.create', CAST.LYRA, [], { category: 'DESIGNERS', title: 'Lyra\'s', openSlots: 1 }, T0 + LFF_RETENTION_MS - HOUR)).postId as string;
    // AT EXACTLY 30 DAYS: Lyra's edit writes only her post
    let mark = executed.length;
    await ok('lff.post.edit', CAST.LYRA, [L], { title: 'edited at the edge' }, T0 + LFF_RETENTION_MS);
    expect(executed.slice(mark).map(label)).toEqual(['BEGIN', `upsert post ${L} OPEN v2`, `event lff.post.edit -> ${CAST.LYRA}`, 'COMMIT']);
    // 1 MS LATER: the same kind of write deletes Kai's post first, by one statement; the cascade takes both its requests
    mark = executed.length;
    await ok('lff.post.edit', CAST.LYRA, [L], { title: 'edited past it' }, T0 + LFF_RETENTION_MS + 1);
    expect(executed.slice(mark).map(label)).toEqual(['BEGIN', `delete post ${A}`, `upsert post ${L} OPEN v3`, `event lff.post.edit -> ${CAST.LYRA}`, 'COMMIT']);
    expect([held().posts.has(A), held().requests.has(nova), held().requests.has(vega)]).toEqual([false, false, false]);
    const state = await pg.read();
    expect([state.lffPosts.map((p) => p.id), state.lffRequests]).toEqual([[L], []]);
  });

  it('BLOCKS: the cancelled request is written in the block\'s transaction, and the far side is told BEFORE the block\'s own event -- each way', async () => {
    const { pg, executed } = await stores();
    const act = actor([pg]);
    const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId;
    const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId;
    const vega = (await act('lff.request.create', CAST.VEGA, [A])).requestId;
    let mark = executed.length;
    await act('blocks.add', CAST.NOVA, [], { targetId: CAST.KAI }); // the requester blocks the owner: stored as her withdrawal (SEC m-a)
    expect(executed.slice(mark).map(label)).toEqual([
      'BEGIN', 'write social_blocks', `upsert request ${nova} WITHDRAWN`, `event lff.request.withdraw -> ${CAST.KAI}`, `event blocks.add -> ${CAST.NOVA}`, 'COMMIT',
    ]);
    mark = executed.length;
    await act('blocks.add', CAST.KAI, [], { targetId: CAST.VEGA }); // the owner blocks the requester
    expect(executed.slice(mark).map(label)).toEqual([
      'BEGIN', 'write social_blocks', `upsert request ${vega} CANCELLED`, `event lff.post.delete -> ${CAST.VEGA}`, `event blocks.add -> ${CAST.KAI}`, 'COMMIT',
    ]);
  });

  it('A STEPPED-BACK CLOCK: an edit, an accept and a block write updated_at as the domain keeps it (never before created_at)', async () => {
    const { pg, executed } = await stores();
    expect((await apply(pg, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T0)).ok).toBe(true);
    expect((await apply(pg, 'lff.request.create', CAST.NOVA, ['lffp_1'], {}, T0 + 1000)).ok).toBe(true);
    expect((await apply(pg, 'lff.request.create', CAST.VEGA, ['lffp_1'], {}, T0 + 2000)).ok).toBe(true);
    const mark = executed.length;
    const back = T0 - MIN;
    expect((await apply(pg, 'lff.post.edit', CAST.KAI, ['lffp_1'], { title: 'A squad, edited' }, back)).ok).toBe(true);
    expect((await apply(pg, 'lff.request.accept', CAST.KAI, ['lffr_2'], {}, back)).ok).toBe(true);
    expect((await apply(pg, 'blocks.add', CAST.VEGA, [], { targetId: CAST.KAI }, back)).ok).toBe(true);
    const rows = executed.slice(mark).filter((s) => /^INSERT INTO relay_wonderland\.lff_(posts|join_requests)/u.test(s.sql));
    // by the statement's TARGET (the request upsert names lff_posts too, in its held-post guard, D-L5)
    expect(rows.map((s) => [label(s), (s.sql.startsWith('INSERT INTO relay_wonderland.lff_posts') ? (s.params[10] as Date) : (s.params[6] as Date)).getTime()])).toEqual([
      ['upsert post lffp_1 OPEN v2', T0],
      ['upsert request lffr_2 ACCEPTED', T0 + 1000],
      ['upsert request lffr_3 WITHDRAWN', T0 + 2000], // Vega, the requester, blocked: her withdrawal (SEC m-a)
    ]);
  });

  describe('FAIL CLOSED: an extra event the database does not keep fails the WHOLE operation', () => {
    for (const kind of ['throw', 'swallow'] as const) {
      it(`the close told to the others is ${kind === 'throw' ? 'refused (an error)' : 'swallowed (rowCount 0)'}: rolled back, nothing adopted; the control commits`, async () => {
        const { pg, executed, inject } = await stores();
        const act = actor([pg]);
        const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 1 })).postId;
        const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId;
        await act('lff.request.create', CAST.VEGA, [A]);
        const before = await pg.read();
        inject({ kind, match: (s) => s.sql.startsWith('INSERT INTO relay_wonderland.social_events') && s.params[0] === 'lff.post.close' });
        const mark = executed.length;
        const refused = await apply(pg, 'lff.request.accept', CAST.KAI, [nova], {}, T0 + HOUR);
        expect(refused.ok).toBe(false);
        expect(refused.ok === false && refused.error).toMatchObject({ code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed' });
        expect(executed.slice(mark).map(label), 'the accept\'s own event was never reached; nothing committed').toEqual([
          'BEGIN', `upsert post ${A} CLOSED v2`, `upsert request ${nova} ACCEPTED`, `event lff.post.close -> ${CAST.VEGA}`, 'ROLLBACK',
        ]);
        expect(await pg.read(), 'the store keeps the state it had: the post OPEN, the request PENDING').toBe(before);
        // THE CONTROL: the same accept, nothing injected, commits both events in order
        inject(null);
        const again = executed.length;
        expect((await apply(pg, 'lff.request.accept', CAST.KAI, [nova], {}, T0 + HOUR)).ok).toBe(true);
        expect(executed.slice(again).map(label).slice(-3)).toEqual([`event lff.post.close -> ${CAST.VEGA}`, `event lff.request.accept -> ${CAST.KAI},${CAST.NOVA}`, 'COMMIT']);
        expect((await pg.read()).lffPosts.map((p) => p.status)).toEqual(['CLOSED']);
      });
    }

    it('a block\'s withdrawal the database swallows fails the block too: no block, the request still PENDING', async () => {
      const { pg, inject } = await stores();
      const act = actor([pg]);
      const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 1 })).postId;
      await act('lff.request.create', CAST.NOVA, [A]);
      const before = await pg.read();
      inject({ kind: 'swallow', match: (s) => s.sql.startsWith('INSERT INTO relay_wonderland.social_events') && s.params[0] === 'lff.request.withdraw' });
      expect((await apply(pg, 'blocks.add', CAST.NOVA, [], { targetId: CAST.KAI }, T0 + HOUR)).ok).toBe(false);
      expect(await pg.read()).toBe(before);
      expect(before.blocks).toEqual([]);
      expect(before.lffRequests.map((r) => r.status)).toEqual(['PENDING']);
    });
  });

  describe('NO GRAFT (review m1): an upsert updates only its OWN row, or the whole operation fails closed', () => {
    const create = (store: SocialStore, ms: number) => apply(store, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Kai\'s own words', openSlots: 2 }, ms);
    const outage = { code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed' };
    const cases: ReadonlyArray<readonly [string, PostFacts]> = [
      ['another player\'s post', { owner: CAST.NOVA, createdMs: T0, version: 1 }],
      ['another post of the same owner (made at another time)', { owner: CAST.KAI, createdMs: T0 - HOUR, version: 1 }],
      ['a newer version of the same post (a stale writer)', { owner: CAST.KAI, createdMs: T0, version: 2 }],
    ];
    /** The one operator line (review n1): which table, and NO data -- no id, player, title or SQL. */
    const expectOneLineNoData = (lines: readonly string[], kind: 'post' | 'request', secrets: readonly string[]) => {
      expect(lines, 'exactly one line, the fixed text').toEqual([lffSerialBehindLine(kind)]);
      expect(lines[0]).toMatch(new RegExp(`^\\[social-postgres\\] lff_row_not_ours ${kind}: `, 'u'));
      for (const secret of [...secrets, ...EVERYONE, 'lffp_', 'lffr_', 'INSERT', 'relay_wonderland']) expect(lines[0], `the line carries no ${secret}`).not.toContain(secret);
    };

    for (const [what, facts] of cases) {
      it(`a re-minted post id the database holds for ${what}: refused, rolled back, the store keeps its state, one line logged`, async () => {
        const { pg, executed, held, lines } = await stores({}, { posts: { lffp_1: facts } });
        const before = await pg.read();
        const mark = executed.length;
        const refused = await create(pg, T0);
        expect(refused.ok).toBe(false);
        expect(refused.ok === false && refused.error).toMatchObject(outage);
        expect(executed.slice(mark).map(label), 'nothing after the refused upsert').toEqual(['BEGIN', 'upsert post lffp_1 OPEN v1', 'ROLLBACK']);
        expect(await pg.read()).toBe(before);
        expect(held().posts.get('lffp_1'), 'the held row is untouched').toEqual(facts);
        expectOneLineNoData(lines, 'post', ['Kai\'s own words']);
        // and it keeps failing closed (no self-heal): the same write again is refused again, and logged again
        expect((await create(pg, T0 + 1000)).ok).toBe(false);
        expect(lines).toHaveLength(2);
      });
    }

    it('THE CONTROL: the very same row (same owner, created_at, version) and the owner\'s own later edit update it; nothing is logged', async () => {
      const { pg, held, lines } = await stores({}, { posts: { lffp_1: { owner: CAST.KAI, createdMs: T0, version: 1 } } });
      expect((await create(pg, T0)).ok, 'an identical write of the same row (a retry after a lost acknowledgement)').toBe(true);
      expect((await apply(pg, 'lff.post.edit', CAST.KAI, ['lffp_1'], { title: 'Kai, edited' }, T0 + 1000)).ok).toBe(true);
      expect(held().posts.get('lffp_1')).toEqual({ owner: CAST.KAI, createdMs: T0, version: 2 });
      expect(lines).toEqual([]);
    });

    it('another outage (an event the database refuses) is NOT this line: the log is for the id serial only', async () => {
      const { pg, inject, lines } = await stores();
      inject({ kind: 'throw', match: (s) => s.sql.startsWith('INSERT INTO relay_wonderland.social_events') });
      expect((await create(pg, T0)).ok).toBe(false);
      expect(lines).toEqual([]);
    });

    it('a stale version: another writer moved the post past ours -- the edit is refused; put back, the same edit commits', async () => {
      const { pg, held } = await stores();
      expect((await create(pg, T0)).ok).toBe(true);
      held().posts.set('lffp_1', { owner: CAST.KAI, createdMs: T0, version: 5 });
      const before = await pg.read();
      expect((await apply(pg, 'lff.post.edit', CAST.KAI, ['lffp_1'], { title: 'Kai, edited' }, T0 + 1000)).ok).toBe(false);
      expect(await pg.read()).toBe(before);
      held().posts.set('lffp_1', { owner: CAST.KAI, createdMs: T0, version: 1 });
      expect((await apply(pg, 'lff.post.edit', CAST.KAI, ['lffp_1'], { title: 'Kai, edited' }, T0 + 1000)).ok).toBe(true);
    });

    it('a re-minted REQUEST id the database holds for another post or requester: refused, rolled back, one line; the control (its own row, accepted) commits', async () => {
      const { pg, executed, held, lines } = await stores({}, { requests: { lffr_2: { postId: 'lffp_9', requesterId: CAST.VEGA, createdMs: T0 + 1000 } } });
      expect((await create(pg, T0)).ok).toBe(true); // lffp_1; the next id minted is lffr_2, which the database already holds
      const before = await pg.read();
      const mark = executed.length;
      const refused = await apply(pg, 'lff.request.create', CAST.NOVA, ['lffp_1'], {}, T0 + 1000);
      expect(refused.ok === false && refused.error).toMatchObject(outage);
      expect(executed.slice(mark).map(label)).toEqual(['BEGIN', 'upsert request lffr_2 PENDING', 'ROLLBACK']);
      expect(await pg.read()).toBe(before);
      expect(held().requests.get('lffr_2')).toEqual({ postId: 'lffp_9', requesterId: CAST.VEGA, createdMs: T0 + 1000 });
      expectOneLineNoData(lines, 'request', []);
      // THE CONTROL: a store whose database holds nothing under the id -- the request is written, then its own row is accepted
      const fresh = await stores();
      expect((await create(fresh.pg, T0)).ok).toBe(true);
      expect((await apply(fresh.pg, 'lff.request.create', CAST.NOVA, ['lffp_1'], {}, T0 + 1000)).ok).toBe(true);
      expect((await apply(fresh.pg, 'lff.request.accept', CAST.KAI, ['lffr_2'], {}, T0 + 2000)).ok).toBe(true);
      expect(fresh.held().requests.get('lffr_2')).toEqual({ postId: 'lffp_1', requesterId: CAST.NOVA, createdMs: T0 + 1000 });
      expect(fresh.lines).toEqual([]);
    });

    it('r2-m1: a re-minted request id the database holds for the SAME player on the SAME post, made at another time (e.g. one the owner accepted): refused, the held row keeps its status; the identical row is updated', async () => {
      // the held row: Nova's own request on lffp_1, made at T0 + 500 by another bridge (and, say, accepted there)
      const heldRow: RequestFacts = { postId: 'lffp_1', requesterId: CAST.NOVA, createdMs: T0 + 500 };
      const { pg, executed, held, lines } = await stores({}, { requests: { lffr_2: heldRow } });
      expect((await create(pg, T0)).ok).toBe(true);
      const before = await pg.read();
      const mark = executed.length;
      const refused = await apply(pg, 'lff.request.create', CAST.NOVA, ['lffp_1'], {}, T0 + 1000);
      expect(refused.ok === false && refused.error, 'same post and requester, another created_at: not ours').toMatchObject(outage);
      expect(executed.slice(mark).map(label)).toEqual(['BEGIN', 'upsert request lffr_2 PENDING', 'ROLLBACK']);
      expect(await pg.read()).toBe(before);
      expect(held().requests.get('lffr_2'), 'the held row is untouched').toEqual(heldRow);
      expectOneLineNoData(lines, 'request', []);
      // THE CONTROL: the held row IS ours (same post, requester AND created_at: a retry after a lost acknowledgement) -- written,
      // and the owner's accept of it commits
      const same = await stores({}, { requests: { lffr_2: { postId: 'lffp_1', requesterId: CAST.NOVA, createdMs: T0 + 1000 } } });
      expect((await create(same.pg, T0)).ok).toBe(true);
      expect((await apply(same.pg, 'lff.request.create', CAST.NOVA, ['lffp_1'], {}, T0 + 1000)).ok).toBe(true);
      expect((await apply(same.pg, 'lff.request.accept', CAST.KAI, ['lffr_2'], {}, T0 + 2000)).ok).toBe(true);
      expect(same.lines).toEqual([]);
    });

    it('the SQL says so: each upsert\'s DO UPDATE carries its WHERE (the fake above decides exactly that WHERE)', async () => {
      const { pg, executed } = await stores();
      const act = actor([pg]);
      const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId;
      await act('lff.request.create', CAST.NOVA, [A]);
      const upserts = executed.filter((s) => /^INSERT INTO relay_wonderland\.lff_(posts|join_requests)\b/u.test(s.sql));
      // a request writes NOTHING on a held post, neither a new row nor a change (D-L5; the security review's m-3): its INSERT's own SELECT
      expect(upserts[1].sql.slice(0, upserts[1].sql.indexOf('ON CONFLICT'))).toBe(
        'INSERT INTO relay_wonderland.lff_join_requests(request_id, post_id, requester_id, message, status, created_at, updated_at) '
          + 'SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::timestamptz, $7::timestamptz '
          + 'WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.lff_posts h WHERE h.post_id = $2::text AND h.held_at IS NOT NULL) ',
      );
      expect(upserts.map((s) => s.sql.slice(s.sql.indexOf('ON CONFLICT')))).toEqual([
        'ON CONFLICT(post_id) DO UPDATE SET category=EXCLUDED.category, title=EXCLUDED.title, description=EXCLUDED.description, '
          + 'project_label=EXCLUDED.project_label, skills=EXCLUDED.skills, open_slots=EXCLUDED.open_slots, status=EXCLUDED.status, '
          + 'updated_at=EXCLUDED.updated_at, version=EXCLUDED.version WHERE relay_wonderland.lff_posts.owner_id = EXCLUDED.owner_id '
          + 'AND relay_wonderland.lff_posts.created_at = EXCLUDED.created_at AND relay_wonderland.lff_posts.version <= EXCLUDED.version '
          + 'AND relay_wonderland.lff_posts.held_at IS NULL',
        'ON CONFLICT(request_id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at '
          + 'WHERE relay_wonderland.lff_join_requests.post_id = EXCLUDED.post_id AND relay_wonderland.lff_join_requests.requester_id = EXCLUDED.requester_id '
          + 'AND relay_wonderland.lff_join_requests.created_at = EXCLUDED.created_at',
      ]);
    });
  });

  describe('D-L5: an EVIDENCE post is HELD by one statement and never deleted, its content as reported is snapshotted, and to every player it is exactly a delete', () => {
    /** A report through the existing flow: about `reportedId`, naming `subjectRef`, or (each CONTROL) naming no post. */
    const spam = (reportedId: string, subjectRef: string | null): Record<string, unknown> => ({ reportedId, reason: 'SPAM', ...(subjectRef === null ? {} : { subjectRef }) });
    const outage = { code: 'stale-ledger-version', retryable: true, message: 'the change could not be saved; nothing was changed' };

    /** Through BOTH stores: Kai's post A; Nova asks; Vega asks and is accepted; Lyra reports (naming A, or no post); Kai deletes A or closes it. */
    async function afterReport(names: 'A' | 'no post', last: 'lff.post.delete' | 'lff.post.close' = 'lff.post.delete') {
      const s = await stores();
      const act = actor([s.memory, s.pg]);
      const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
      const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId as string;
      const vega = (await act('lff.request.create', CAST.VEGA, [A])).requestId as string;
      await act('lff.request.accept', CAST.KAI, [vega]);
      const reportMark = s.executed.length;
      await act('reports.file', CAST.LYRA, [], spam(CAST.KAI, names === 'A' ? A : null));
      const reportWrite = s.executed.slice(reportMark).map(label);
      const mark = s.executed.length;
      await act(last, CAST.KAI, [A]);
      return { ...s, A, nova, vega, mark, reportWrite };
    }
    /** One viewer's stream, rebuilt from the committed social_events rows (a fresh bigserial numbers them 1, 2, 3, ...). */
    const stream = (executed: readonly Statement[], viewer: string): string =>
      JSON.stringify(committedEvents(executed).map((r, i) => ({ seq: i + 1, ...r })).filter((r) => r.audience.includes(viewer)).map(({ seq, op, atIso }) => ({ seq, op, atIso })));
    /** One operation through both stores at one server time: they must answer alike. */
    const both = async (on: readonly SocialStore[], op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
      const results = [];
      for (const store of on) results.push(await apply(store, op, who, ids, body, ms));
      expect(results[0].ok, `${op} by ${who}: ${results[0].ok ? '' : results[0].error.message}`).toBe(true);
      for (const r of results) expect(JSON.stringify(r), `${op}: every store answers alike`).toBe(JSON.stringify(results[0]));
      return results[0].ok ? results[0].value : undefined;
    };

    it('R-2: the owner\'s delete of an evidence post is ONE hold (held_at set, no DELETE, so its requests stay); unreported, ONE delete -- both stores answer alike and hold the same evidence', async () => {
      const held = await afterReport('A');
      const deleted = await afterReport('no post');
      // the report that makes A evidence writes its snapshot in the report's own transaction; the control's writes none
      expect(held.reportWrite).toEqual(['BEGIN', 'write social_reports', `snapshot ${held.A} #1 REPORTED`, 'write social_meta', `event reports.file -> ${CAST.LYRA}`, 'COMMIT']);
      expect(deleted.reportWrite, 'the control').toEqual(['BEGIN', 'write social_reports', 'write social_meta', `event reports.file -> ${CAST.LYRA}`, 'COMMIT']);
      const told = `event lff.post.delete -> ${CAST.KAI},${CAST.NOVA},${CAST.VEGA}`;
      expect(held.executed.slice(held.mark).map(label)).toEqual(['BEGIN', `hold post ${held.A}`, told, 'COMMIT']);
      expect(deleted.executed.slice(deleted.mark).map(label), 'the control').toEqual(['BEGIN', `delete post ${deleted.A}`, told, 'COMMIT']);
      // THE DATABASE: the evidence post and both its requests stay, the post marked held; the control's are gone (the cascade)
      expect([held.held().posts.has(held.A), held.held().evidence.has(held.A), held.held().requests.has(held.nova), held.held().requests.has(held.vega)]).toEqual([true, true, true, true]);
      expect([deleted.held().posts.has(deleted.A), deleted.held().requests.has(deleted.nova), deleted.held().requests.has(deleted.vega)]).toEqual([false, false, false]);
      // the stamp is the domain's (the delete's server time), on Kai's own row (owner, created_at), and both stores hold the same evidence
      const [pgState, memState] = [await held.pg.read(), await held.memory.read()];
      const hold = held.executed.slice(held.mark).find((st) => st.sql.startsWith('UPDATE relay_wonderland.lff_posts'))!;
      expect([(hold.params[1] as Date).getTime(), hold.params[2], (hold.params[3] as Date).getTime()]).toEqual([memState.lffHeld[0].heldAtMs, CAST.KAI, memState.lffHeld[0].post.createdAtMs]);
      expect([pgState.lffHeld, pgState.lffSnapshots]).toEqual([memState.lffHeld, memState.lffSnapshots]);
      expect(pgState.lffHeld.map((h) => [h.post.id, h.requests.map((r) => `${r.id}:${r.status}`)])).toEqual([[held.A, [`${held.nova}:PENDING`, `${held.vega}:ACCEPTED`]]]);
      // TO THE PLAYERS, THE CONTROL: the same LFF state, and nothing held there
      const control = await deleted.pg.read();
      expect([pgState.lffPosts, pgState.lffRequests, pgState.lffCreations, pgState.nextSerial]).toEqual([control.lffPosts, control.lffRequests, control.lffCreations, control.nextSerial]);
      expect([control.lffHeld, control.lffSnapshots]).toEqual([[], []]);
    });

    it('R-3 through both stores: every viewer\'s committed event stream is byte for byte the ordinary delete\'s; the control (a close instead) shows the comparison can fail', async () => {
      const held = await afterReport('A');
      const deleted = await afterReport('no post');
      for (const viewer of EVERYONE) {
        expect(stream(held.executed, viewer), viewer).toBe(stream(deleted.executed, viewer));
        expect(JSON.stringify((await held.memory.eventsFor(viewer, 0, 500)).events), `${viewer} (in memory)`).toBe(JSON.stringify((await deleted.memory.eventsFor(viewer, 0, 500)).events));
      }
      const closed = await afterReport('no post', 'lff.post.close');
      expect(stream(closed.executed, CAST.VEGA), 'the control: a close is told differently').not.toBe(stream(deleted.executed, CAST.VEGA));
    });

    it('M-1: each edit of an evidence post appends ONE snapshot in the edit\'s own transaction; an unreported post\'s edit, or one a non-qualifying report names, writes none', async () => {
      const s = await stores();
      const on = [s.memory, s.pg];
      const A = (await both(on, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Abusive words', openSlots: 2 }, T0)).postId as string;
      const B = (await both(on, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Also abusive', openSlots: 2 }, T0 + 1000)).postId as string;
      await both(on, 'reports.file', CAST.LYRA, [], spam(CAST.KAI, A), T0 + 2000);
      let mark = s.executed.length;
      await both(on, 'reports.file', CAST.LYRA, [], spam(CAST.NOVA, B), T0 + 3000); // FQ-1 (a): it names someone else, so B is not evidence
      expect(s.executed.slice(mark).map(label), 'a report that does not qualify: filed, no snapshot').toEqual(['BEGIN', 'write social_reports', 'write social_meta', `event reports.file -> ${CAST.LYRA}`, 'COMMIT']);
      for (const [id, v] of [[A, 2], [B, 2]] as const) {
        mark = s.executed.length;
        await both(on, 'lff.post.edit', CAST.KAI, [id], { title: 'Nice words' }, T0 + 4000);
        expect(s.executed.slice(mark).map(label), id).toEqual(id === A
          ? ['BEGIN', `upsert post ${A} OPEN v${v}`, `snapshot ${A} #2 EDITED`, `event lff.post.edit -> ${CAST.KAI}`, 'COMMIT']
          : ['BEGIN', `upsert post ${B} OPEN v${v}`, `event lff.post.edit -> ${CAST.KAI}`, 'COMMIT']);
      }
      const inserts = s.executed.filter((st) => st.sql.startsWith('INSERT INTO relay_wonderland.lff_post_snapshots'));
      expect(inserts.map((st) => [st.params[0], st.params[1], st.params[2], st.params[7]]), 'as reported, then as edited').toEqual([[A, 1, 'REPORTED', 'Abusive words'], [A, 2, 'EDITED', 'Nice words']]);
      const [pgState, memState] = [await s.pg.read(), await s.memory.read()];
      expect(pgState.lffSnapshots).toEqual(memState.lffSnapshots);
      // and a second write of a snapshot key is refused whole (class 23), never a silent overwrite
      s.held().snapshots.add(`${A}#3`);
      const refused = await apply(s.pg, 'lff.post.edit', CAST.KAI, [A], { title: 'Again' }, T0 + 5000);
      expect(refused.ok === false && refused.error.code).toBe('validation-failed');
      expect(await s.pg.read()).toBe(pgState);
    });

    it('m-3 (the D-L5 r2 security review): a QUALIFYING report whose row the database does not keep (its id already held there: ON CONFLICT DO NOTHING, rowCount 0) fails closed -- no snapshot names a report that is not this one; one line, no data; the control commits; a report that makes nothing evidence keeps its old answer (the scope)', async () => {
      const { pg, executed, inject, lines } = await stores();
      const created = await apply(pg, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 }, T0);
      expect(created.ok).toBe(true);
      const A = created.ok ? (created.value as { postId: string }).postId : '';
      // the database already holds a report under the id this store mints (a lost COMMIT acknowledgement, a stale second bridge)
      inject({ kind: 'swallow', match: (st) => st.sql.startsWith('INSERT INTO relay_wonderland.social_reports') });
      const before = await pg.read();
      let mark = executed.length;
      const refused = await apply(pg, 'reports.file', CAST.LYRA, [], spam(CAST.KAI, A), T0 + 1000);
      expect(refused.ok === false && refused.error, 'a retryable outage, never ok').toMatchObject(outage);
      expect(executed.slice(mark).map(label), 'nothing after the report row the database did not keep: no snapshot').toEqual(['BEGIN', 'write social_reports', 'ROLLBACK']);
      expect(await pg.read(), 'the store keeps its state: A is not evidence').toBe(before);
      expect(lines, 'one line, the fixed text').toEqual([lffSerialBehindLine('report')]);
      for (const secret of [A, CAST.LYRA, CAST.KAI, 'rep_', 'INSERT', 'relay_wonderland']) expect(lines[0], `the line carries no ${secret}`).not.toContain(secret);
      // THE SCOPE: a report that makes nothing evidence is written as before (033's ON CONFLICT DO NOTHING; the stale-serial case of
      // social-postgres.real-postgres.test.ts relies on it): the guard is for the provenance a snapshot records
      mark = executed.length;
      expect((await apply(pg, 'reports.file', CAST.LYRA, [], spam(CAST.KAI, null), T0 + 2000)).ok).toBe(true);
      expect(executed.slice(mark).map(label)).toEqual(['BEGIN', 'write social_reports', 'write social_meta', `event reports.file -> ${CAST.LYRA}`, 'COMMIT']);
      // THE CONTROL: the database keeps the row -- the same qualifying report commits, its snapshot naming it
      inject(null);
      mark = executed.length;
      expect((await apply(pg, 'reports.file', CAST.LYRA, [], spam(CAST.KAI, A), T0 + 3000)).ok).toBe(true);
      expect(executed.slice(mark).map(label)).toEqual(['BEGIN', 'write social_reports', `snapshot ${A} #1 REPORTED`, 'write social_meta', `event reports.file -> ${CAST.LYRA}`, 'COMMIT']);
      const after = await pg.read();
      expect(after.lffSnapshots.map((x) => x.reportId)).toEqual([after.reports[after.reports.length - 1].reportId]);
      expect(lines, 'and nothing more is logged').toHaveLength(1);
    });

    it('R-1 RETENTION: a closed post reported AFTER it closed (by the user accepted on it), 1 ms past 30 days, is HELD by the purging write (one statement; its requests stay); the same post unreported is deleted', async () => {
      for (const names of ['A', 'no post'] as const) {
        const { pg, executed, held } = await stores();
        const ok = async (op: SocialOperationId, who: string, ids: string[], body: Record<string, unknown>, ms: number): Promise<any> => {
          const r = await apply(pg, op, who, ids, body, ms);
          expect(r.ok, `${op} by ${who}: ${r.ok ? '' : r.error.message}`).toBe(true);
          return r.ok ? r.value : undefined;
        };
        const A = (await ok('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T0)).postId as string;
        const nova = (await ok('lff.request.create', CAST.NOVA, [A], {}, T0 + 1000)).requestId as string;
        await ok('lff.request.accept', CAST.KAI, [nova], {}, T0 + 2000);
        await ok('lff.post.close', CAST.KAI, [A], {}, T0 + 3000);
        await ok('reports.file', CAST.NOVA, [], spam(CAST.KAI, names === 'A' ? A : null), T0 + 4000);
        const L = (await ok('lff.post.create', CAST.LYRA, [], { category: 'DESIGNERS', title: 'Lyra\'s', openSlots: 1 }, T0 + LFF_RETENTION_MS - HOUR)).postId as string;
        const mark = executed.length;
        await ok('lff.post.edit', CAST.LYRA, [L], { title: 'past it' }, T0 + LFF_RETENTION_MS + 1);
        expect(executed.slice(mark).map(label), names).toEqual([
          'BEGIN', names === 'A' ? `hold post ${A}` : `delete post ${A}`, `upsert post ${L} OPEN v2`, `event lff.post.edit -> ${CAST.LYRA}`, 'COMMIT',
        ]);
        expect([held().posts.has(A), held().requests.has(nova)], names).toEqual(names === 'A' ? [true, true] : [false, false]);
        const state = await pg.read();
        expect([state.lffPosts.map((p) => p.id), state.lffRequests, state.lffHeld.map((h) => h.post.id)], names).toEqual([[L], [], names === 'A' ? [A] : []]);
      }
    });

    for (const op of ['lff.request.decline', 'lff.request.withdraw'] as const) {
      it(`m1 (${op}): a request change whose OWN write purges its evidence post is written FIRST, then the hold -- the database keeps it as memory does; the control (the same ${op} before 30 days) holds nothing`, async () => {
        for (const due of [true, false]) {
          const s = await stores();
          const on = [s.memory, s.pg];
          const P = (await both(on, 'lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 }, T0)).postId as string;
          const nova = (await both(on, 'lff.request.create', CAST.NOVA, [P], {}, T0 + 1000)).requestId as string;
          await both(on, 'reports.file', CAST.LYRA, [], spam(CAST.KAI, P), T0 + 2000);
          await both(on, 'lff.post.close', CAST.KAI, [P], {}, T0 + 3000);
          const mark = s.executed.length;
          const [who, status, told] = op === 'lff.request.decline' ? [CAST.KAI, 'DECLINED', `${CAST.KAI},${CAST.NOVA}`] : [CAST.NOVA, 'WITHDRAWN', `${CAST.NOVA},${CAST.KAI}`];
          await both(on, op, who, [nova], {}, due ? T0 + LFF_RETENTION_MS + 1 : T0 + 10 * MIN);
          expect(s.executed.slice(mark).map(label), due ? 'due' : 'the control').toEqual(due
            ? ['BEGIN', `upsert request ${nova} ${status}`, `hold post ${P}`, `event ${op} -> ${told}`, 'COMMIT']
            : ['BEGIN', `upsert request ${nova} ${status}`, `event ${op} -> ${told}`, 'COMMIT']);
          const [pgState, memState] = [await s.pg.read(), await s.memory.read()];
          expect([pgState.lffHeld, pgState.lffRequests], 'the PostgreSQL store holds what memory holds').toEqual([memState.lffHeld, memState.lffRequests]);
          if (due) expect(memState.lffHeld[0].requests.map((r) => r.status), 'held as last written').toEqual([status]);
        }
      });
    }

    it('THE BACKSTOP: the DATABASE holds evidence the store\'s state lacks (another bridge recorded the report\'s snapshot) -- the guarded DELETE removes nothing and the post is held; the control deletes', async () => {
      for (const elsewhere of [true, false]) {
        const { pg, executed, held, dbEvidence } = await stores();
        const act = actor([pg]);
        const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
        const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId as string;
        if (elsewhere) dbEvidence(A);
        const mark = executed.length;
        await act('lff.post.delete', CAST.KAI, [A]);
        const told = `event lff.post.delete -> ${CAST.KAI},${CAST.NOVA}`;
        expect(executed.slice(mark).map(label)).toEqual(elsewhere ? ['BEGIN', `delete post ${A}`, `hold post ${A} if evidence`, told, 'COMMIT'] : ['BEGIN', `delete post ${A}`, told, 'COMMIT']);
        expect([held().posts.has(A), held().evidence.has(A), held().requests.has(nova)]).toEqual(elsewhere ? [true, true, true] : [false, false, false]);
        expect((await pg.read()).lffPosts, 'either way the players see a delete').toEqual([]);
      }
    });

    it('A HELD ROW IS NEVER WRITTEN AGAIN: a stale store\'s edit of a post another bridge held, its accept of a request on it, and a NEW request on it are each refused whole; the controls (the same edit and accept before the hold) commit', async () => {
      const { pg, executed, held, dbHold, lines } = await stores();
      const act = actor([pg]);
      const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 3 })).postId as string;
      const nova = (await act('lff.request.create', CAST.NOVA, [A])).requestId as string;
      const vega = (await act('lff.request.create', CAST.VEGA, [A])).requestId as string;
      // THE CONTROLS, before any hold
      await act('lff.post.edit', CAST.KAI, [A], { title: 'edited' });
      await act('lff.request.accept', CAST.KAI, [nova]);
      // another bridge holds A (a report and a delete this store never saw)
      dbHold(A);
      const before = await pg.read();
      let mark = executed.length;
      const edit = await apply(pg, 'lff.post.edit', CAST.KAI, [A], { title: 'over the evidence' }, T0 + HOUR);
      expect(edit.ok === false && edit.error).toMatchObject(outage);
      expect(executed.slice(mark).map(label)).toEqual(['BEGIN', `upsert post ${A} OPEN v3`, 'ROLLBACK']);
      mark = executed.length;
      const accept = await apply(pg, 'lff.request.accept', CAST.KAI, [vega], {}, T0 + HOUR);
      expect(accept.ok === false && accept.error).toMatchObject(outage);
      expect(executed.slice(mark).map(label)).toEqual(['BEGIN', `upsert request ${vega} ACCEPTED`, 'ROLLBACK']);
      mark = executed.length;
      const ask = await apply(pg, 'lff.request.create', CAST.DEX, [A], {}, T0 + HOUR);
      expect(ask.ok === false && ask.error, 'a NEW request row on the held post (the security review\'s m-3)').toMatchObject(outage);
      expect(executed.slice(mark).map(label).filter((l) => l !== 'write social_meta')).toEqual(['BEGIN', `upsert request lffr_${before.nextSerial} PENDING`, 'ROLLBACK']);
      expect(await pg.read(), 'the store keeps its state').toBe(before);
      expect(held().posts.get(A)?.version, 'the held row is untouched').toBe(2);
      expect(lines).toEqual([lffSerialBehindLine('post'), lffSerialBehindLine('request'), lffSerialBehindLine('request')]);
    });

    it('NO GRAFT ON THE HOLD OR THE DELETE (the security review\'s m-2): another row under the id at hold time fails the delete closed; the DELETE never removes another\'s row; a row already held is the evidence already there', async () => {
      // the hold, over ANOTHER row under A's id: refused whole, one line
      const graft = await stores();
      const act = actor([graft.pg]);
      const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
      await act('reports.file', CAST.LYRA, [], spam(CAST.KAI, A));
      graft.dbReplacePost(A, { owner: CAST.NOVA, createdMs: T0 - HOUR, version: 1 });
      const before = await graft.pg.read();
      let mark = graft.executed.length;
      const refused = await apply(graft.pg, 'lff.post.delete', CAST.KAI, [A], {}, T0 + HOUR);
      expect(refused.ok === false && refused.error).toMatchObject(outage);
      expect(graft.executed.slice(mark).map(label)).toEqual(['BEGIN', `hold post ${A}`, `check post ${A} is ours`, 'ROLLBACK']);
      expect([await graft.pg.read(), graft.held().evidence.has(A), graft.lines]).toEqual([before, false, [lffSerialBehindLine('post')]]);
      // the DELETE, over ANOTHER row under B's id: removes nothing (and holds nothing: it is not ours)
      const B = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Another', openSlots: 2 })).postId as string;
      graft.dbReplacePost(B, { owner: CAST.NOVA, createdMs: T0 - HOUR, version: 1 });
      mark = graft.executed.length;
      await act('lff.post.delete', CAST.KAI, [B]);
      expect(graft.executed.slice(mark).map(label)).toEqual(['BEGIN', `delete post ${B}`, `hold post ${B} if evidence`, `event lff.post.delete -> ${CAST.KAI}`, 'COMMIT']);
      expect([graft.held().posts.get(B), graft.held().evidence.has(B)], 'the other row stays as it was').toEqual([{ owner: CAST.NOVA, createdMs: T0 - HOUR, version: 1 }, false]);
      // THE CONTROL: ours, already held by another bridge -- nothing to do, the delete commits
      const already = await stores();
      const act2 = actor([already.pg]);
      const C = (await act2('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
      await act2('reports.file', CAST.LYRA, [], spam(CAST.KAI, C));
      already.dbHold(C);
      mark = already.executed.length;
      await act2('lff.post.delete', CAST.KAI, [C]);
      expect(already.executed.slice(mark).map(label)).toEqual(['BEGIN', `hold post ${C}`, `check post ${C} is ours`, `event lff.post.delete -> ${CAST.KAI}`, 'COMMIT']);
      expect(already.lines).toEqual([]);
    });

    it('LOAD: a held post (held_at set) and its requests come back as EVIDENCE, never as a player\'s post or request; its snapshots come back in order; to its owner it is the uniform not-found', async () => {
      const heldPost = {
        post_id: 'lffp_7', owner_id: CAST.KAI, category: 'TEAMS', title: 'Held', description: '', project_label: '', skills: [], open_slots: 2, status: 'CLOSED',
        created_at: new Date(T0), updated_at: new Date(T0 + MIN), expires_at: new Date(T0 + 14 * 24 * HOUR), version: '2',
      };
      const { pg } = await stores({
        lff_posts: [
          { ...heldPost, held_at: new Date(T0 + HOUR) },
          {
            post_id: 'lffp_9', owner_id: CAST.NOVA, category: 'TEAMS', title: 'Live', description: '', project_label: '', skills: [], open_slots: 1, status: 'OPEN',
            created_at: new Date(T0), updated_at: new Date(T0), expires_at: new Date(T0 + 14 * 24 * HOUR), version: '1', held_at: null,
          },
        ],
        lff_join_requests: [
          { request_id: 'lffr_8', post_id: 'lffp_7', requester_id: CAST.NOVA, message: 'hi', status: 'ACCEPTED', created_at: new Date(T0 + 1000), updated_at: new Date(T0 + 2000) },
          { request_id: 'lffr_10', post_id: 'lffp_9', requester_id: CAST.KAI, message: '', status: 'PENDING', created_at: new Date(T0 + 3000), updated_at: new Date(T0 + 3000) },
        ],
        lff_post_snapshots: [
          { ...heldPost, title: 'As reported', version: '1', updated_at: new Date(T0), seq: 1, cause: 'REPORTED', report_id: 'rep_6', captured_at: new Date(T0 + 30_000) },
          { ...heldPost, seq: 2, cause: 'EDITED', report_id: null, captured_at: new Date(T0 + MIN) },
        ],
      });
      const state = await pg.read();
      expect([state.lffPosts.map((p) => p.id), state.lffRequests.map((r) => r.id)]).toEqual([['lffp_9'], ['lffr_10']]);
      const asStored = {
        id: 'lffp_7', ownerId: CAST.KAI, category: 'TEAMS', title: 'Held', description: '', projectLabel: '', skills: [], openSlots: 2, status: 'CLOSED',
        createdAtMs: T0, updatedAtMs: T0 + MIN, expiresAtMs: T0 + 14 * 24 * HOUR, version: 2,
      };
      expect(state.lffHeld).toEqual([{
        post: asStored,
        requests: [{ id: 'lffr_8', postId: 'lffp_7', requesterId: CAST.NOVA, message: 'hi', status: 'ACCEPTED', createdAtMs: T0 + 1000, updatedAtMs: T0 + 2000 }],
        heldAtMs: T0 + HOUR,
      }]);
      expect(state.lffSnapshots).toEqual([
        { postId: 'lffp_7', seq: 1, cause: 'REPORTED', reportId: 'rep_6', capturedAtMs: T0 + 30_000, post: { ...asStored, title: 'As reported', version: 1, updatedAtMs: T0 } },
        { postId: 'lffp_7', seq: 2, cause: 'EDITED', reportId: null, capturedAtMs: T0 + MIN, post: asStored },
      ]);
      for (const who of [CAST.KAI, CAST.NOVA]) {
        const get = await apply(pg, 'lff.post.get', who, ['lffp_7'], {}, T0 + 2 * HOUR);
        expect(get.ok === false && get.error, who).toMatchObject({ code: 'not-found', message: LFF_NOT_FOUND_MESSAGE });
      }
      expect((await apply(pg, 'lff.post.get', CAST.NOVA, ['lffp_9'], {}, T0 + 2 * HOUR)).ok, 'the control: the live post').toBe(true);
    });

    it('the SQL says so: the hold, the guarded DELETE and its backstop, the snapshot INSERT and the request DELETE -- each exactly (the fake decides exactly those)', async () => {
      const { pg, executed, dbEvidence } = await stores();
      const act = actor([pg]);
      const A = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'A squad', openSlots: 2 })).postId as string;
      const B = (await act('lff.post.create', CAST.KAI, [], { category: 'TEAMS', title: 'Another', openSlots: 2 })).postId as string;
      await act('reports.file', CAST.LYRA, [], spam(CAST.KAI, A));
      await act('lff.post.delete', CAST.KAI, [A]); // the domain holds it
      dbEvidence(B);
      await act('lff.post.delete', CAST.KAI, [B]); // the database does
      expect(executed.filter((st) => /^(UPDATE|DELETE FROM) relay_wonderland\.lff_posts\b/u.test(st.sql)).map((st) => st.sql)).toEqual([
        'UPDATE relay_wonderland.lff_posts SET held_at=GREATEST($2::timestamptz, updated_at) WHERE post_id=$1 AND owner_id=$3 AND created_at=$4 AND held_at IS NULL',
        'DELETE FROM relay_wonderland.lff_posts WHERE post_id=$1 AND owner_id=$2 AND created_at=$3 AND held_at IS NULL '
          + 'AND NOT EXISTS (SELECT 1 FROM relay_wonderland.lff_post_snapshots s WHERE s.post_id = $1)',
        'UPDATE relay_wonderland.lff_posts SET held_at=GREATEST($2::timestamptz, updated_at) WHERE post_id=$1 AND owner_id=$3 AND created_at=$4 '
          + 'AND held_at IS NULL AND EXISTS (SELECT 1 FROM relay_wonderland.lff_post_snapshots s WHERE s.post_id = $1)',
      ]);
      expect(executed.filter((st) => st.sql.startsWith('INSERT INTO relay_wonderland.lff_post_snapshots')).map((st) => st.sql)).toEqual([
        'INSERT INTO relay_wonderland.lff_post_snapshots(post_id, seq, cause, report_id, captured_at, owner_id, category, title, description, project_label, '
          + 'skills, open_slots, status, created_at, updated_at, expires_at, version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12,$13,$14,$15,$16,$17)',
      ]);
      // no domain operation drops a lone request today; the statement that would is pinned, so a held post's requests stay
      expect(readFileSync(join(__dirname, 'social-postgres.ts'), 'utf8').replace(/\s+/gu, ' ')).toContain(
        'DELETE FROM relay_wonderland.lff_join_requests WHERE request_id=$1 AND NOT EXISTS (SELECT 1 FROM relay_wonderland.lff_posts h '
          + 'WHERE h.post_id = relay_wonderland.lff_join_requests.post_id AND h.held_at IS NOT NULL)',
      );
    });
  });

  describe('THE GUARDS: an extra event is never dropped', () => {
    const state: SocialState = emptySocialState();
    const outcome = (over: Partial<SocialCommandOutcome>): SocialCommandOutcome => ({ state, data: null, audience: [], ...over });
    const extra = [{ op: 'lff.post.close' as SocialOperationId, audience: ['usr_x'] }];

    it('an outcome carrying an extra event is a WRITE, beside a world move or alone; the controls without one are not', () => {
      expect(durableWriteOf(state, outcome({ world: emptyWorldState(), extraEvents: extra })), 'not the world path').toBe('write');
      expect(durableWriteOf(state, outcome({ extraEvents: extra })), 'not the read path').toBe('write');
      expect(durableWriteOf(state, outcome({ world: emptyWorldState() })), 'control: a world move alone').toBe('world');
      expect(durableWriteOf(state, outcome({})), 'control: a read').toBe('none');
      expect(durableWriteOf(state, outcome({ world: emptyWorldState(), extraEvents: [] })), 'control: an empty list is no extra').toBe('world');
      expect(durableWriteOf(state, outcome({ state: { ...state } })), 'a state change').toBe('write');
      expect(durableWriteOf(state, outcome({ audience: ['usr_x'], world: emptyWorldState() })), 'an event').toBe('write');
    });

    it('writeSocialEvent: de-duplicated, an empty audience writes nothing, rows cut at 256, and a row not kept throws', async () => {
      const rows: unknown[][] = [];
      const client = { query: async (_sql: string, params: unknown[]) => { rows.push(params); return { rows: [], rowCount: 1 }; } };
      const many = Array.from({ length: 300 }, (_, i) => `usr_${i}`);
      expect(await writeSocialEvent(client as never, 'lff.post.close', '2026-10-12T09:00:00.000Z', [...many, ...many])).toBe(2);
      expect(rows.map((p) => (p[2] as string[]).length)).toEqual([EVENT_AUDIENCE_MAX, 300 - EVENT_AUDIENCE_MAX]);
      expect(new Set(rows.flatMap((p) => p[2] as string[])).size).toBe(300);
      expect(await writeSocialEvent(client as never, 'lff.post.close', '2026-10-12T09:00:00.000Z', [])).toBe(0);
      expect(rows).toHaveLength(2);
      const swallowing = { query: async () => ({ rows: [], rowCount: 0 }) };
      await expect(writeSocialEvent(swallowing as never, 'lff.post.close', '2026-10-12T09:00:00.000Z', ['usr_x'])).rejects.toBeInstanceOf(SocialEventNotWritten);
    });
  });

  it('THE STORY: every viewer\'s stream from the committed social_events rows is byte for byte the in-memory store\'s, and the LFF state is the same', async () => {
    const { pg, memory, executed } = await stores();
    const ids = await lffStory(actor([memory, pg]), CAST, 'all');
    const rows = committedEvents(executed);
    const ops = rows.map((r) => r.op);
    // the B1 notices are there, each before its own operation's event
    expect(ops.filter((op) => op === 'lff.post.close'), 'two fills, by an accept and by an edit').toHaveLength(2);
    expect(ops.filter((op) => op === 'lff.request.withdraw'), 'two by the block, one by Orion').toHaveLength(3);
    for (const role of ROLES) {
      const viewer = CAST[role];
      const fromRows = rows.map((r, i) => ({ seq: i + 1, ...r })).filter((r) => r.audience.includes(viewer)).map(({ seq, op, atIso }) => ({ seq, op, atIso }));
      const fromMemory = (await memory.eventsFor(viewer, 0, 500)).events;
      expect(JSON.stringify(fromRows), role).toBe(JSON.stringify(fromMemory));
      expect(fromMemory.map((e) => e.op), `${role}: told what the story says`).toEqual(STORY_TOLD[role]);
    }
    const [m, p] = [await memory.read(), await pg.read()];
    expect([p.lffPosts, p.lffRequests, p.lffCreations, p.nextSerial]).toEqual([m.lffPosts, m.lffRequests, m.lffCreations, m.nextSerial]);
    expect(p.lffPosts.map((x) => [x.id, x.status, x.version])).toEqual([[ids.A, 'CLOSED', 2], [ids.B, 'CLOSED', 2]]);
  });

  it('THE STORY TEXT is the same in the real-PostgreSQL suite (so what this run accepts is what CI runs there)', () => {
    const story = (file: string): string => {
      const text = readFileSync(join(__dirname, file), 'utf8');
      const begin = text.indexOf('// ---- STORY BEGIN');
      const end = text.indexOf('// ---- STORY END');
      expect(begin, `${file}: STORY BEGIN`).toBeGreaterThan(-1);
      expect(end, `${file}: STORY END`).toBeGreaterThan(begin);
      return text.slice(begin, end);
    };
    expect(story('social-postgres-lff.real-postgres.test.ts')).toBe(story('social-postgres-lff.test.ts'));
  });
});
