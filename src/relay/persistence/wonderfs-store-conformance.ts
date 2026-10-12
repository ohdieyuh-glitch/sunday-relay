/**
 * ONE CONTRACT FOR A WONDERFS STORE, RUN AGAINST EVERY STORE THAT CLAIMS IT (R0b).
 *
 * The routes depend on `WfsStore` (wonderfs/wonderfs-store.ts), never on one implementation. These cases are that interface's
 * behaviour, written once and run twice: against the in-memory store (wonderfs/wonderfs-memory-store.test.ts, every run) and
 * against real PostgreSQL (wonderfs-postgres.real-postgres.test.ts, CI). A store that passes one run and fails the other is the
 * drift this file exists to stop. Where a case needs an expected value, it comes from the reference ENGINE (the oracle) or is
 * written out literally, never from the code under test.
 *
 * The cases:
 *   EQUIV     every change through the store equals the engine; the whole state, the head, the tree at EVERY revision, file
 *             histories (an agent branch's fork-time base included), the change feed, the events and the conflicts read back
 *             as the engine says;
 *   TREE-PAGE pages bounded by `limit`, gapless, in CODE-POINT order; a commit between two pages changes nothing in them (the
 *             cursor pins the revision); every malformed query refused;
 *   BYTE-PAGE no tree page passes 1 MiB of JSON even when `limit` alone would; a single commit record over the bound is served
 *             ALONE and the feed moves on;
 *   FEEDS     history, changes, events and conflicts page by immutable keys: a change landing between pages never repeats or
 *             drops an item;
 *   NUMERIC-KEYS (R0b-fix, CI r1.7) event seq, change rev, history version and a tree cursor's revision page in NUMERIC order across
 *             the 9|10 boundary (the PostgreSQL events query once sorted by its text alias: [1, 10, 11, 12, ...]);
 *   READ-AT   (R1-r3) fileAt: a file at one revision in one read; readReferencedBlob: bytes only while the live project names them;
 *   BLOB      a blob stored through one store instance (one bridge) is committable through another whose state is cached (F5);
 *             storing it does not move the project's version, so no version-keyed cache could have seen it;
 *   ROLE      the product's OWNER / ADMIN / MEMBER through the one mapping; anything else is no role, never an error;
 *   PROJECTS  (R1, H1) a player's projects: a mapped membership JOINED to a live file environment, paged by project id;
 *   APPROVE   the STORED approval by id, its approver's role re-read at merge;
 *   UNKNOWN   every read of an unknown project, branch, file, conflict or revision is the ONE not-found;
 *   REPLAY    a replay keeps nothing; the same request id for another change is refused.
 */

import { createHash } from 'node:crypto';

import type { RelayResult } from '../protocol/errors';
import {
  applyWfsCommit,
  canonicalJson,
  emptyWfsProject,
  forkWfsBranch,
  mergeBackWfsBranch,
  wfsGenesisHash,
  wfsJsonBytes,
  wfsTreeAt,
  WFS_ALPHA_LIMITS,
  WFS_CONFLICT_RETENTION_MS,
  WFS_MAIN_BRANCH,
  WFS_PAGE_MAX_BYTES,
  WFS_PAGE_MAX_LIMIT,
  type WfsBranchState,
  type WfsChangesPage,
  type WfsCommit,
  type WfsCommitOutcome,
  type WfsCommitRequest,
  type WfsConflict,
  type WfsEngineContext,
  type WfsEntry,
  type WfsEventsPage,
  type WfsFileVersion,
  type WfsHistoryPage,
  type WfsLimits,
  type WfsOp,
  type WfsPrincipal,
  type WfsProjectState,
  type WfsReviewVerdict,
  type WfsStore,
  type WfsTreePage,
} from '../wonderfs';

export type WfsIdSource = (kind: 'file' | 'commit' | 'conflict' | 'branch' | 'approval') => string;

export interface WfsStoreHarness {
  /** A store over the SAME data as every other store this harness opened: a second call is a second bridge. */
  open(options?: { readonly newId?: WfsIdSource; readonly limits?: WfsLimits }): WfsStore;
  /** The product rows a WonderFS project needs first: its `projects` row and its members, with the PRODUCT's role values. */
  seed(projectId: string, members: Readonly<Record<string, string>>): Promise<void>;
  /** Write (or, with null, remove) a member's PRODUCT role value. */
  setRole(projectId: string, playerId: string, productRole: string | null): Promise<void>;
}

export interface WfsStoreCase {
  readonly name: string;
  run(h: WfsStoreHarness): Promise<void>;
}

/** Ids drawn per kind, so a store and the oracle given one each draw the same sequence for every kind. */
export function wfsIdSource(): WfsIdSource {
  const drawn = new Map<string, number>();
  return (kind) => {
    const n = (drawn.get(kind) ?? 0) + 1;
    drawn.set(kind, n);
    return `${kind}-${String(n).padStart(5, '0')}`;
  };
}

/** A project state as comparable data (Maps become sorted entry lists). */
export function wfsPlainState(p: WfsProjectState): unknown {
  const sorted = <V>(m: ReadonlyMap<string, V>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    projectId: p.projectId,
    branches: sorted(p.branches).map(([id, b]) => [id, { ...b, entries: sorted(b.entries), base: sorted(b.base) }]),
    conflicts: sorted(p.conflicts),
    requests: sorted(p.requests),
  };
}

/* ------------------------------------------------------------------------------------------------------------ assertions */

function breach(what: string): never {
  throw new Error(`WonderFS store contract: ${what}`);
}

/** Equal as stored JSON is equal: keys in any order, an `undefined` member the same as an absent one. */
function same(actual: unknown, expected: unknown, what: string): void {
  const a = actual === undefined ? 'undefined' : canonicalJson(actual);
  const e = expected === undefined ? 'undefined' : canonicalJson(expected);
  if (a !== e) breach(`${what}\n  got:      ${a.slice(0, 1500)}\n  expected: ${e.slice(0, 1500)}`);
}

function holds(condition: boolean, what: string): void {
  if (!condition) breach(what);
}

function value<T>(r: RelayResult<T>, what: string): T {
  if (!r.ok) return breach(`${what}: refused ${r.error.code} (${r.error.message}) ${JSON.stringify(r.error.details ?? [])}`);
  return r.value;
}

function refused(r: RelayResult<unknown>, code: string, what: string): void {
  if (r.ok) breach(`${what}: accepted ${JSON.stringify(r.value).slice(0, 300)}`);
  else if (r.error.code !== code) breach(`${what}: refused ${r.error.code}, expected ${code}`);
}

/** The ONE not-found (§9.1): the code and the message are the same whatever was missing. */
function notFound(r: RelayResult<unknown>, what: string): void {
  refused(r, 'not-found', what);
  if (!r.ok && r.error.message !== 'Not found.') breach(`${what}: the not-found says "${r.error.message}", not the one message`);
}

/* --------------------------------------------------------------------------------------------------------------- helpers */

const NOW = '2026-10-12T09:00:00.000Z';
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const who = (id: string, kind: WfsPrincipal['kind'] = 'human'): WfsPrincipal => ({
  kind, id, onBehalfOf: kind === 'human' ? null : 'usr_owner', grantId: kind === 'human' ? null : `grant-${id}`, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null,
});
/** Path keys here are ASCII, where code-unit and code-point order agree (the TREE-PAGE case owns the non-ASCII order). */
const byKey = (a: WfsEntry, b: WfsEntry): number => (a.pathKey < b.pathKey ? -1 : a.pathKey > b.pathKey ? 1 : a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0);
const committedRev = (o: WfsCommitOutcome, what: string): number => (o.status === 'committed' ? o.rev : breach(`${what}: not committed: ${JSON.stringify(o)}`));
const conflictIdOf = (o: WfsCommitOutcome, what: string): string => (o.status === 'conflict' ? o.conflictId : breach(`${what}: not a conflict: ${JSON.stringify(o)}`));
/** The lifecycle event a commit-shaped outcome must record (D-5), written out here, not taken from the stores' code. */
const expectedEvent = (o: WfsCommitOutcome, kind: string): { kind: string; body: Record<string, unknown> } =>
  o.status === 'committed' ? { kind, body: { branchId: o.branchId, rev: o.rev, commitId: o.commitId } } : { kind: 'conflict', body: { branchId: o.branchId, conflictId: o.conflictId } };

async function put(store: WfsStore, projectId: string, text: string): Promise<{ sha256: string; size: number }> {
  const r = value(await store.putBlob(projectId, utf8(text)), `putBlob ${text}`);
  same(r, { sha256: sha(text), size: utf8(text).byteLength }, 'a blob\'s address and size are computed by the store');
  return r;
}

async function commitOk(store: WfsStore, projectId: string, req: WfsCommitRequest): Promise<WfsCommitOutcome> {
  return value(await store.commit(projectId, req, NOW), `commit ${req.requestId}`);
}

/** Every page of a tree listing, following `next` (and checking each page's bounds as it goes). */
async function allTreePages(store: WfsStore, projectId: string, first: { readonly branchId: string; readonly rev?: number; readonly limit: number }): Promise<WfsTreePage[]> {
  const pages: WfsTreePage[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const page: WfsTreePage = value(await store.tree(projectId, { branchId: first.branchId, rev: cursor === null ? first.rev : undefined, cursor, limit: first.limit }), `tree page ${pages.length + 1}`);
    holds(page.entries.length <= first.limit, `a tree page holds at most limit (${first.limit}) entries, got ${page.entries.length}`);
    holds(wfsJsonBytes(page) <= WFS_PAGE_MAX_BYTES, `a tree page is at most ${WFS_PAGE_MAX_BYTES} bytes of JSON, got ${wfsJsonBytes(page)}`);
    if (pages.length > 0) holds(page.rev === pages[0].rev, 'every page of one listing is of the same revision');
    pages.push(page);
    if (page.next === null) return pages;
    holds(page.entries.length > 0, 'a page that says more follow is not empty');
    cursor = page.next;
  }
  return breach('a tree listing never ended');
}

const pathsOf = (entries: readonly WfsEntry[]): string[] => entries.map((e) => e.path);

/** A file's versions on a branch, from the ENGINE's commits (the history is the truth): newest first, the fork-time base as rev 0. */
function historyOf(b: WfsBranchState, fileId: string): Array<{ rev: number; entry: WfsEntry }> {
  const base = b.base.get(fileId);
  return [
    ...(base === undefined ? [] : [{ rev: 0, entry: base }]),
    ...b.commits.flatMap((c) => c.touched.filter((e) => e.fileId === fileId).map((entry) => ({ rev: c.rev, entry }))),
  ].sort((x, y) => y.entry.version - x.entry.version);
}

const summaryOf = (c: WfsConflict, status: string) => ({
  conflictId: c.conflictId, branchId: c.branchId, requestId: c.requestId, status, principal: c.principal, baseRev: c.baseRev,
  headRevAtRefusal: c.headRevAtRefusal, atIso: c.atIso, mergesBranchId: c.mergesBranchId, opCount: c.ops.length, failureCount: c.failures.length,
});

/* ----------------------------------------------------------------------------------------------------------------- cases */

export const WFS_STORE_CASES: readonly WfsStoreCase[] = [
  {
    name: 'EQUIV: every change equals the engine, and the whole state, head, tree at every revision, histories, feed, events and conflicts read back as the engine says',
    async run(h) {
      const P = 'prj-equiv';
      await h.seed(P, { usr_owner: 'OWNER', usr_member: 'MEMBER' });
      const store = h.open({ newId: wfsIdSource() });
      value(await store.createProject(P, NOW), 'createProject');
      const engineIds = wfsIdSource();
      const blobs = new Map<string, number>();
      const ctx: WfsEngineContext = { nowIso: NOW, newId: (k) => engineIds(k), sha256Hex: sha, blobSize: (x) => blobs.get(x) ?? null, limits: WFS_ALPHA_LIMITS };
      const blob = async (text: string) => {
        const b = await put(store, P, text);
        blobs.set(b.sha256, b.size);
        return b;
      };
      let oracle = emptyWfsProject(P, sha);
      const events: Array<{ kind: string; body: Record<string, unknown> }> = [];
      const both = async (req: WfsCommitRequest): Promise<WfsCommitOutcome> => {
        const e = applyWfsCommit(oracle, req, ctx);
        if (!e.ok) return breach(`the oracle refused ${req.requestId}: ${e.error.message}`);
        oracle = e.value.project;
        const s = await commitOk(store, P, req);
        same(s, e.value.outcome, `${req.requestId}: the store's answer is the engine's`);
        events.push(expectedEvent(s, 'commit'));
        return s;
      };
      const owner = who('usr_owner');
      const member = who('usr_member');
      const julius = who('julius-1', 'julius');
      const [A, A2, B, J, J2, U] = [await blob('alpha'), await blob('alpha two'), await blob('beta'), await blob('julius'), await blob('julius two'), await blob('never named')];

      await both({ requestId: 'req-equiv-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: owner, ops: [{ op: 'create', path: 'src', kind: 'dir' }, { op: 'create', path: 'src/a.txt', kind: 'file', ...A }, { op: 'create', path: 'src/b.txt', kind: 'file', ...B }] });
      const fileAt = (path: string) => wfsTreeAt(oracle.branches.get(WFS_MAIN_BRANCH)!).find((x) => x.path === path)?.fileId ?? breach(`no ${path}`);
      const a = fileAt('src/a.txt');
      const b = fileAt('src/b.txt');
      await both({ requestId: 'req-equiv-02', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: owner, ops: [{ op: 'update', fileId: a, expectContentVersion: 1, ...A2 }] });
      await both({ requestId: 'req-equiv-03', branchId: WFS_MAIN_BRANCH, baseRev: 2, principal: member, ops: [{ op: 'move', fileId: b, expectPathVersion: 1, newPath: 'src/c.txt' }] });
      // a STALE edit, kept whole as a conflict (INV-2), then dismissed (keep theirs); a second one stays open
      const c1 = conflictIdOf(await both({ requestId: 'req-equiv-04', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: member, ops: [{ op: 'update', fileId: a, expectContentVersion: 1, ...A }] }), 'stale edit 1');
      await both({ requestId: 'req-equiv-05', branchId: WFS_MAIN_BRANCH, baseRev: 3, principal: owner, ops: [], resolvesConflictId: c1 });
      const c2 = conflictIdOf(await both({ requestId: 'req-equiv-06', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: member, ops: [{ op: 'update', fileId: a, expectContentVersion: 1, ...A }] }), 'stale edit 2');
      await both({ requestId: 'req-equiv-07', branchId: WFS_MAIN_BRANCH, baseRev: 4, principal: owner, ops: [{ op: 'delete', fileId: a, expectContentVersion: 2 }] });
      // an agent branch: forked, two commits, merged back with a verdict bound to its head
      const forked = forkWfsBranch(oracle, { fromBranchId: WFS_MAIN_BRANCH, owner: julius }, ctx);
      if (!forked.ok) return breach(forked.error.message);
      oracle = forked.value.project;
      const branchId = value(await store.fork(P, { fromBranchId: WFS_MAIN_BRANCH, owner: julius }, NOW), 'fork').branchId;
      same(branchId, forked.value.branchId, 'the fork names the engine\'s branch');
      events.push({ kind: 'branch.fork', body: { branchId, fromBranchId: WFS_MAIN_BRANCH } });
      await both({ requestId: 'req-equiv-08', branchId, baseRev: 0, principal: julius, ops: [{ op: 'create', path: 'src/j.txt', kind: 'file', ...J }] });
      const j = wfsTreeAt(oracle.branches.get(branchId)!).find((x) => x.path === 'src/j.txt')?.fileId ?? breach('no j.txt');
      await both({ requestId: 'req-equiv-09', branchId, baseRev: 1, principal: julius, ops: [{ op: 'update', fileId: j, expectContentVersion: 1, ...J2 }] });
      const head = oracle.branches.get(branchId)!;
      const verdict: WfsReviewVerdict = { verdictId: 'verdict-1', verdictHash: sha('verdict-1'), reviewedBranchId: branchId, reviewedHeadCommitHash: head.headCommitHash, reviewedBaseRev: head.parent!.forkRev };
      const merged = mergeBackWfsBranch(oracle, { requestId: 'req-equiv-10', branchId, principal: julius, approval: null, reviewVerdict: verdict, approverRoleNow: null }, ctx);
      if (!merged.ok) return breach(merged.error.message);
      oracle = merged.value.project;
      const sMerged = value(await store.mergeBack(P, { requestId: 'req-equiv-10', branchId, principal: julius, approvalId: null, reviewVerdict: verdict }, NOW), 'mergeBack');
      same(sMerged, merged.value.outcome, 'the merge\'s answer is the engine\'s');
      events.push(expectedEvent(sMerged, 'branch.merge'));

      // everything below through ANOTHER store: what the backing data holds, not what the writer remembers
      const reader = h.open();
      const state = await reader.project(P);
      same(state === null ? null : wfsPlainState(state), wfsPlainState(oracle), 'the whole state == the engine');
      const main = oracle.branches.get(WFS_MAIN_BRANCH)!;
      const live = [...main.entries.values()].filter((e) => !e.deleted && e.kind === 'file');
      same(value(await reader.head(P), 'head'), {
        projectId: P, genesisHash: wfsGenesisHash(P, sha), main: { headRev: main.headRev, headCommitHash: main.headCommitHash },
        usage: { files: live.length, bytes: live.reduce((n, e) => n + (e.size ?? 0), 0) }, lastEventSeq: events.length,
      }, 'the head');
      // the tree at EVERY revision of both branches (the head from the current entries, the rest rebuilt from history)
      for (const [id, br] of oracle.branches) {
        for (let rev = 0; rev <= br.headRev; rev += 1) {
          const page = value(await reader.tree(P, { branchId: id, rev, limit: WFS_PAGE_MAX_LIMIT }), `tree ${id}@${rev}`);
          same(page, { branchId: id, rev, headRev: br.headRev, entries: wfsTreeAt(br, rev).sort(byKey), next: null }, `the tree of ${id} at ${rev}`);
        }
      }
      // file histories: on main (a deleted file's tombstone included), and on the agent branch (its fork-time base as rev 0)
      for (const [id, fileId] of [[WFS_MAIN_BRANCH, a], [WFS_MAIN_BRANCH, b], [branchId, j], [branchId, b]] as const) {
        const br = oracle.branches.get(id)!;
        same(value(await reader.fileHistory(P, { branchId: id, fileId, limit: WFS_PAGE_MAX_LIMIT }), `history ${id}/${fileId}`),
          { branchId: id, fileId, current: br.entries.get(fileId), versions: historyOf(br, fileId), next: null }, `the history of ${fileId} on ${id}`);
      }
      holds(historyOf(oracle.branches.get(branchId)!, b).some((v) => v.rev === 0), 'CONTROL: the agent branch\'s history of a forked file starts at its base');
      // the change feed, the events, the conflicts
      for (const [id, br] of oracle.branches) {
        same(value(await reader.changes(P, { branchId: id, afterRev: 0, limit: WFS_PAGE_MAX_LIMIT }), `changes ${id}`), { branchId: id, headRev: br.headRev, commits: br.commits, next: null }, `the change feed of ${id}`);
      }
      same(value(await reader.events(P, { afterSeq: 0, limit: WFS_PAGE_MAX_LIMIT }), 'events'), {
        events: events.map((e, i) => ({ seq: i + 1, kind: e.kind, body: e.body, atIso: NOW })), lastSeq: events.length, next: null,
      }, 'the lifecycle events, one per change, gapless');
      const conflict = (id: string) => oracle.conflicts.get(id) ?? breach(`no conflict ${id}`);
      const expectAll = [summaryOf(conflict(c1), 'dismissed'), summaryOf(conflict(c2), 'open')].sort((x, y) => (x.conflictId < y.conflictId ? -1 : 1));
      same(value(await reader.conflicts(P, { status: 'all', limit: WFS_PAGE_MAX_LIMIT }), 'conflicts all'), { conflicts: expectAll, next: null }, 'every conflict, a dismissal as dismissed');
      same(value(await reader.conflicts(P, { branchId: WFS_MAIN_BRANCH, status: 'open' }), 'conflicts open'), { conflicts: [summaryOf(conflict(c2), 'open')], next: null }, 'the open conflicts');
      same(value(await reader.conflict(P, c1), 'conflict 1'), {
        record: conflict(c1), status: 'dismissed', closedAtIso: NOW, retainUntilIso: new Date(Date.parse(NOW) + WFS_CONFLICT_RETENTION_MS).toISOString(),
      }, 'a dismissed conflict: its record, kept 30 days');
      same(value(await reader.conflict(P, c2), 'conflict 2'), { record: conflict(c2), status: 'open', closedAtIso: null, retainUntilIso: null }, 'an open conflict');
      // blobs: named ones are referenced (by a version, or by a retained conflict), the unnamed one is not
      for (const [x, referenced] of [[A, true], [A2, true], [J2, true], [U, false]] as const) {
        same(value(await reader.blobInfo(P, x.sha256), 'blobInfo'), { sha256: x.sha256, size: x.size, referenced }, `blob ${x.sha256.slice(0, 8)} referenced=${referenced}`);
        same(value(await reader.verifyBlob(P, x.sha256), 'verifyBlob'), { status: 'intact', size: x.size }, 'a held blob is intact');
      }
    },
  },
  {
    name: 'TREE-PAGE: pages bounded by limit, gapless, in code-point order; a commit between pages changes nothing in them (the cursor pins the revision); malformed queries refused',
    async run(h) {
      const P = 'prj-tree-page';
      await h.seed(P, { usr_owner: 'OWNER' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const p = await put(store, P, 'p');
      const names = ['a.txt', ...Array.from({ length: 20 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`), 'Z.txt', 'é.txt', 'Ａ.txt', '\u{1f600}.txt'];
      await commitOk(store, P, { requestId: 'req-tree-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: names.map((path): WfsOp => ({ op: 'create', path, kind: 'file', ...p })) });
      // CODE-POINT order of the keys: ... z.txt (U+007A) < é (U+00E9) < ａ (U+FF41) < 😀 (U+1F600). JavaScript's default (UTF-16) order
      // would put 😀 (D83D DE00) before ａ: the CONTROL that this order is not the default one
      const expected = ['a.txt', ...names.slice(1, 21), 'Z.txt', 'é.txt', 'Ａ.txt', '\u{1f600}.txt'];
      holds(['ａ.txt', '\u{1f600}.txt'].sort()[0] === '\u{1f600}.txt', 'CONTROL: the default string order differs from code-point order here');
      const whole = await allTreePages(store, P, { branchId: WFS_MAIN_BRANCH, limit: WFS_PAGE_MAX_LIMIT });
      same(whole.length, 1, 'the whole tree fits one page at the largest limit');
      same(pathsOf(whole[0].entries), expected, 'tree order: path key in code-point order');
      const R = whole[0].rev;
      // pages of 7: page 1 now; then a commit removes the FIRST entry and adds one (every later entry would shift by one);
      // the rest of the listing, through the cursor, is still revision R
      const first = value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, limit: 7 }), 'page 1');
      same(pathsOf(first.entries), expected.slice(0, 7), 'page 1');
      const aId = first.entries[0].fileId;
      await commitOk(store, P, { requestId: 'req-tree-02', branchId: WFS_MAIN_BRANCH, baseRev: R, principal: who('usr_owner'), ops: [{ op: 'delete', fileId: aId, expectContentVersion: 1 }, { op: 'create', path: 'zz.txt', kind: 'file', ...p }] });
      const rest: WfsEntry[] = [];
      let cursor = first.next;
      while (cursor !== null) {
        const page: WfsTreePage = value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, cursor, limit: 7 }), 'a later page');
        holds(page.rev === R && page.headRev === R + 1, `a later page is still revision ${R} (head ${R + 1}), got ${page.rev} / ${page.headRev}`);
        holds(page.entries.length <= 7, 'at most limit entries');
        rest.push(...page.entries);
        cursor = page.next;
      }
      same(pathsOf([...first.entries, ...rest]), expected, 'the pinned listing: every entry of revision R once, in order, none of R+1\'s');
      // CONTROL: the same second page at the HEAD is different (a cursor that followed the head would have shifted)
      const headPage2 = value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, cursor: `${R + 1}.7`, limit: 7 }), 'head page 2').entries;
      holds(pathsOf(headPage2).join('/') !== expected.slice(7, 14).join('/'), 'CONTROL: the head\'s second page differs from the pinned one');
      // an offset past the end is an empty last page
      same(value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, cursor: `${R}.999`, limit: 7 }), 'past the end'), { branchId: WFS_MAIN_BRANCH, rev: R, headRev: R + 1, entries: [], next: null }, 'past the end');
      // refused before any lookup: malformed limits, cursors, revisions, ids
      for (const limit of [0, -1, 1.5, WFS_PAGE_MAX_LIMIT + 1, Number.NaN]) refused(await store.tree(P, { branchId: WFS_MAIN_BRANCH, limit }), 'validation-failed', `limit ${limit}`);
      for (const bad of ['', 'abc', '1', '1.2.3', '01.0', '1.-1', '1.1 ', ' 1.1']) refused(await store.tree(P, { branchId: WFS_MAIN_BRANCH, cursor: bad }), 'validation-failed', `cursor "${bad}"`);
      refused(await store.tree(P, { branchId: WFS_MAIN_BRANCH, rev: R + 1, cursor: `${R}.7` }), 'validation-failed', 'a cursor for another revision than rev');
      refused(await store.tree(P, { branchId: WFS_MAIN_BRANCH, rev: -1 }), 'validation-failed', 'a negative revision');
      refused(await store.tree(P, { branchId: '../main' }), 'validation-failed', 'a malformed branch id');
      notFound(await store.tree(P, { branchId: WFS_MAIN_BRANCH, rev: R + 2 }), 'a revision past the head');
      notFound(await store.tree(P, { branchId: WFS_MAIN_BRANCH, cursor: `${R + 2}.0` }), 'a cursor past the head');
      notFound(await store.tree(P, { branchId: 'branch-nope' }), 'an unknown branch');
    },
  },
  {
    name: 'BYTE-PAGE: no tree page passes 1 MiB of JSON even when limit alone would; a commit record over the bound is served alone and the feed moves on',
    async run(h) {
      const P = 'prj-byte-page';
      await h.seed(P, { usr_owner: 'OWNER' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const p = await put(store, P, 'p');
      // 1,000 files at 198 characters of 3-byte UTF-8 each (two folders of 84 + a name of 28; each name <= 255 bytes)
      const d1 = '字'.repeat(84);
      const d2 = `${d1}/${'文'.repeat(84)}`;
      const files = Array.from({ length: 1000 }, (_, i) => `${d2}/${'汉'.repeat(27)}${String.fromCharCode(0x4e00 + i)}`);
      holds(files.every((f) => f.length <= 200), 'the fixture paths are within 200 characters');
      await commitOk(store, P, { requestId: 'req-byte-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [
        { op: 'create', path: d1, kind: 'dir' }, { op: 'create', path: d2, kind: 'dir' }, ...files.map((path): WfsOp => ({ op: 'create', path, kind: 'file', ...p })),
      ] });
      const first = value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, limit: WFS_PAGE_MAX_LIMIT }), 'page 1');
      holds(wfsJsonBytes(first) <= WFS_PAGE_MAX_BYTES, `page 1 is ${wfsJsonBytes(first)} bytes`);
      holds(first.entries.length < WFS_PAGE_MAX_LIMIT && first.next !== null, `the BYTES ended page 1 (${first.entries.length} entries), not the limit`);
      const pages = await allTreePages(store, P, { branchId: WFS_MAIN_BRANCH, limit: WFS_PAGE_MAX_LIMIT });
      const listed = pages.flatMap((pg) => pg.entries);
      same(listed.length, 1002, 'every entry, once');
      same(new Set(listed.map((e) => e.fileId)).size, 1002, 'no entry twice');
      same(pathsOf(listed), [d1, d2, ...files], 'in order across the pages');
      holds(wfsJsonBytes(listed) > WFS_PAGE_MAX_BYTES, 'CONTROL: the limit alone would have put more than 1 MiB in one page');
      // the change feed: that commit's record ALONE is over the bound -- it is served alone, and the next page follows it
      await commitOk(store, P, { requestId: 'req-byte-02', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: who('usr_owner'), ops: [{ op: 'create', path: 'tail', kind: 'dir' }] });
      const feed1 = value(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev: 0, limit: 10 }), 'changes 1');
      same(feed1.commits.map((c) => c.rev), [1], 'an over-bound record is served alone');
      same(feed1.next, 1, 'and the feed says more follow');
      holds(wfsJsonBytes(feed1.commits[0]) > WFS_PAGE_MAX_BYTES, 'CONTROL: that record alone is over the bound (the one exception to the page bound)');
      const feed2 = value(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev: 1, limit: 10 }), 'changes 2');
      same([feed2.commits.map((c) => c.rev), feed2.next, feed2.headRev], [[2], null, 2], 'the feed moves on, gapless');
    },
  },
  {
    name: 'FEEDS: history, changes, events and conflicts page by immutable keys; a change landing between pages never repeats or drops an item',
    async run(h) {
      const P = 'prj-feeds';
      await h.seed(P, { usr_owner: 'OWNER', usr_member: 'MEMBER' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const owner = who('usr_owner');
      const v = [] as Array<{ sha256: string; size: number }>;
      for (let i = 1; i <= 8; i += 1) v.push(await put(store, P, `version ${i}`));
      const r1 = await commitOk(store, P, { requestId: 'req-feed-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: owner, ops: [{ op: 'create', path: 'doc.txt', kind: 'file', ...v[0] }] });
      const F = (value(await store.tree(P, { branchId: WFS_MAIN_BRANCH }), 'tree').entries[0] ?? breach('no doc.txt')).fileId;
      committedRev(r1, 'create');
      for (let i = 2; i <= 6; i += 1) {
        await commitOk(store, P, { requestId: `req-feed-0${i}`, branchId: WFS_MAIN_BRANCH, baseRev: i - 1, principal: owner, ops: [{ op: 'update', fileId: F, expectContentVersion: i - 1, ...v[i - 1] }] });
      }
      // HISTORY, newest first, by version: page 1, then a new version lands, then the rest
      const h1 = value(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: F, limit: 2 }), 'history 1');
      same([h1.versions.map((x) => [x.rev, x.entry.version]), h1.next], [[[6, 6], [5, 5]], 5], 'history page 1');
      await commitOk(store, P, { requestId: 'req-feed-07', branchId: WFS_MAIN_BRANCH, baseRev: 6, principal: owner, ops: [{ op: 'update', fileId: F, expectContentVersion: 6, ...v[6] }] });
      const h2 = value(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: F, before: h1.next, limit: 2 }), 'history 2');
      const h3 = value(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: F, before: h2.next, limit: 2 }), 'history 3');
      same([h2.versions.map((x) => x.entry.version), h2.next, h3.versions.map((x) => x.entry.version), h3.next], [[4, 3], 3, [2, 1], null], 'the rest, below the cursor, gapless');
      same(h3.current.version, 7, 'the current entry is the head\'s');
      same(value(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: F, limit: 2 }), 'history again').versions.map((x) => x.entry.version), [7, 6], 'a fresh first page sees the new version');
      // CHANGES, by revision
      const c1 = value(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev: 0, limit: 4 }), 'changes 1');
      const c2 = value(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev: c1.next ?? breach('changes 1 says done'), limit: 4 }), 'changes 2');
      same([c1.commits.map((c) => c.rev), c1.next, c2.commits.map((c) => c.rev), c2.next, c2.headRev], [[1, 2, 3, 4], 4, [5, 6, 7], null, 7], 'the change feed, gapless');
      same(value(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev: 99 }), 'changes past the head').commits, [], 'nothing after the head');
      // CONFLICTS, by id: five stale edits, paged in twos; two dismissed between pages
      const conflicts: string[] = [];
      for (let i = 1; i <= 5; i += 1) {
        conflicts.push(conflictIdOf(await commitOk(store, P, { requestId: `req-feed-c${i}x`, branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: who('usr_member'), ops: [{ op: 'update', fileId: F, expectContentVersion: 1, ...v[7] }] }), `stale edit ${i}`));
      }
      const byId = [...conflicts].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); // ids are ASCII: code-unit order == code-point order
      const o1 = value(await store.conflicts(P, { status: 'open', limit: 2 }), 'open 1');
      same([o1.conflicts.map((c) => c.conflictId), o1.next], [byId.slice(0, 2), byId[1]], 'open page 1');
      // dismiss the FIRST listed and the LAST: the cursor is an id, so page 2 neither repeats nor skips
      for (const [i, id] of [byId[0], byId[4]].entries()) {
        await commitOk(store, P, { requestId: `req-feed-d${i}x`, branchId: WFS_MAIN_BRANCH, baseRev: 7, principal: owner, ops: [], resolvesConflictId: id });
      }
      const o2 = value(await store.conflicts(P, { status: 'open', after: o1.next, limit: 2 }), 'open 2');
      same([o2.conflicts.map((c) => c.conflictId), o2.next], [byId.slice(2, 4), null], 'open page 2: the dismissed last one is gone, nothing repeats');
      const all = value(await store.conflicts(P, { status: 'all', limit: WFS_PAGE_MAX_LIMIT }), 'all');
      same(all.conflicts.map((c) => [c.conflictId, c.status]), byId.map((id) => [id, id === byId[0] || id === byId[4] ? 'dismissed' : 'open']), 'all, with their statuses');
      // EVENTS, by sequence: 7 commits, 5 conflicts, 2 dismissals
      const seqs: number[] = [];
      let after = 0;
      for (let guard = 0; guard < 100; guard += 1) {
        const page = value(await store.events(P, { afterSeq: after, limit: 3 }), 'events');
        holds(page.events.length <= 3, 'at most limit events');
        seqs.push(...page.events.map((e) => e.seq));
        same(page.lastSeq, 14, 'the newest event');
        if (page.next === null) break;
        after = page.next;
      }
      same(seqs, Array.from({ length: 14 }, (_, i) => i + 1), 'every event once, gapless from 1');
      // an agent branch: a file's history there starts at its fork-time base (rev 0)
      const branchId = value(await store.fork(P, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-1', 'julius') }, NOW), 'fork').branchId;
      await commitOk(store, P, { requestId: 'req-feed-b1', branchId, baseRev: 0, principal: who('julius-1', 'julius'), ops: [{ op: 'update', fileId: F, expectContentVersion: 7, ...v[0] }] });
      same(value(await store.fileHistory(P, { branchId, fileId: F }), 'branch history').versions.map((x) => [x.rev, x.entry.version]), [[1, 8], [0, 7]], 'on the branch: its own version, then the base');
      // refused: malformed cursors; not found: an unknown file, branch or conflict
      refused(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: F, before: 0 }), 'validation-failed', 'history before 0');
      refused(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev: -1 }), 'validation-failed', 'changes after -1');
      refused(await store.events(P, { afterSeq: 1.5 }), 'validation-failed', 'events after 1.5');
      refused(await store.conflicts(P, { status: 'some' as unknown as 'open' }), 'validation-failed', 'a status that is neither open nor all');
      refused(await store.conflicts(P, { status: 'all', after: 'no/slash' }), 'validation-failed', 'a malformed conflict cursor');
      notFound(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: 'file-nope' }), 'an unknown file');
      notFound(await store.conflicts(P, { branchId: 'branch-nope', status: 'all' }), 'conflicts of an unknown branch');
      notFound(await store.conflict(P, 'conflict-nope'), 'an unknown conflict');
    },
  },
  {
    name: 'NUMERIC-KEYS (R0b-fix, CI r1.7): every numeric paging key -- event seq, change rev, history version, a tree cursor\'s revision -- orders as a NUMBER across the 9|10 boundary (text order puts 10 before 2 and skips 2..9)',
    async run(h) {
      const P = 'prj-numeric';
      await h.seed(P, { usr_owner: 'OWNER' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const owner = who('usr_owner');
      const v: Array<{ sha256: string; size: number }> = [];
      for (let i = 1; i <= 12; i += 1) v.push(await put(store, P, `numeric ${i}`));
      await commitOk(store, P, { requestId: 'req-num-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: owner, ops: [{ op: 'create', path: 'a.txt', kind: 'file', ...v[0] }, { op: 'create', path: 'n.txt', kind: 'file', ...v[0] }] });
      const N = (value(await store.tree(P, { branchId: WFS_MAIN_BRANCH }), 'tree').entries.find((e) => e.path === 'n.txt') ?? breach('no n.txt')).fileId;
      for (let i = 2; i <= 12; i += 1) {
        await commitOk(store, P, { requestId: `req-num-${String(i).padStart(2, '0')}`, branchId: WFS_MAIN_BRANCH, baseRev: i - 1, principal: owner, ops: [{ op: 'update', fileId: N, expectContentVersion: i - 1, ...v[i - 1] }] });
      }
      const byThree = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
      // EVENTS by seq: pages of 3, so one page ends at 9 and the next starts at 10
      const eventPages: number[][] = [];
      let afterSeq = 0;
      for (let guard = 0; guard < 20; guard += 1) {
        // explicit page types: each loop's cursor is read from the page it just fetched (TS7022 otherwise)
        const page: WfsEventsPage = value(await store.events(P, { afterSeq, limit: 3 }), `events after ${afterSeq}`);
        eventPages.push(page.events.map((e) => e.seq));
        if (page.next === null) break;
        afterSeq = page.next;
      }
      same(eventPages, byThree, 'events page by page, in numeric order');
      same(value(await store.events(P, { afterSeq: 0, limit: WFS_PAGE_MAX_LIMIT }), 'all events').events.map((e) => e.seq), byThree.flat(), 'all events in one page, in numeric order');
      same(value(await store.events(P, { afterSeq: 9, limit: 2 }), 'events after 9').events.map((e) => e.seq), [10, 11], 'after 9 comes 10');
      // CHANGES by revision
      const changePages: number[][] = [];
      let afterRev = 0;
      for (let guard = 0; guard < 20; guard += 1) {
        const page: WfsChangesPage = value(await store.changes(P, { branchId: WFS_MAIN_BRANCH, afterRev, limit: 3 }), `changes after ${afterRev}`);
        changePages.push(page.commits.map((c: WfsCommit) => c.rev));
        if (page.next === null) break;
        afterRev = page.next;
      }
      same(changePages, byThree, 'changes page by page, in numeric order');
      // HISTORY by version, newest first
      const historyPages: number[][] = [];
      let before: number | null = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const page: WfsHistoryPage = value(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: N, before, limit: 3 }), `history before ${before}`);
        historyPages.push(page.versions.map((x: WfsFileVersion) => x.entry.version));
        if (page.next === null) break;
        before = page.next;
      }
      same(historyPages, [[12, 11, 10], [9, 8, 7], [6, 5, 4], [3, 2, 1]], 'history page by page, in numeric order');
      // a TREE cursor pinned to a one-digit and to a two-digit revision pages the same way
      for (const rev of [9, 10, 12]) {
        const first = value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, rev, limit: 1 }), `tree @${rev}`);
        const second = value(await store.tree(P, { branchId: WFS_MAIN_BRANCH, cursor: first.next, limit: 1 }), `tree @${rev} page 2`);
        same([first.rev, second.rev, [...first.entries, ...second.entries].map((e) => [e.path, e.version]), second.next], [rev, rev, [['a.txt', 1], ['n.txt', rev]], null], `the tree at ${rev}, page by page`);
      }
    },
  },
  {
    name: 'READ-AT (R1-r3): a file at one revision in ONE read (the head, each revision, a tombstone, before it existed, past the head); a blob\'s bytes only while something of the live project names it',
    async run(h) {
      const P = 'prj-read-at';
      await h.seed(P, { usr_owner: 'OWNER' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const owner = who('usr_owner');
      const a1 = await put(store, P, 'read-at one');
      const a2 = await put(store, P, 'read-at two');
      const loose = await put(store, P, 'read-at never committed');
      await commitOk(store, P, { requestId: 'req-at-0001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: owner, ops: [{ op: 'create', path: 'd', kind: 'dir' }] });
      await commitOk(store, P, { requestId: 'req-at-0002', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: owner, ops: [{ op: 'create', path: 'd/f.txt', kind: 'file', ...a1 }] });
      const F = (value(await store.tree(P, { branchId: WFS_MAIN_BRANCH }), 'tree').entries.find((e) => e.path === 'd/f.txt') ?? breach('no d/f.txt')).fileId;
      await commitOk(store, P, { requestId: 'req-at-0003', branchId: WFS_MAIN_BRANCH, baseRev: 2, principal: owner, ops: [{ op: 'update', fileId: F, expectContentVersion: 1, ...a2 }] });
      await commitOk(store, P, { requestId: 'req-at-0004', branchId: WFS_MAIN_BRANCH, baseRev: 3, principal: owner, ops: [{ op: 'delete', fileId: F, expectContentVersion: 2 }] });
      const at = (rev?: number) => store.fileAt(P, { branchId: WFS_MAIN_BRANCH, fileId: F, rev });
      const head = value(await at(), 'at the head');
      same([head.headRev, head.rev, head.entry.deleted, head.entry.version], [4, 4, true, 3], 'at the head: the tombstone');
      same([value(await at(2), 'at 2').entry.sha256, value(await at(3), 'at 3').entry.sha256, value(await at(4), 'at 4').entry.deleted], [a1.sha256, a2.sha256, true], 'each revision: its own version');
      same(value(await at(3), 'at 3 again').rev, 3, 'the revision answered');
      notFound(await at(1), 'before the file existed');
      notFound(await at(5), 'past the head');
      notFound(await store.fileAt(P, { branchId: WFS_MAIN_BRANCH, fileId: 'file-nope' }), 'an unknown file');
      notFound(await store.fileAt(P, { branchId: 'branch-nope', fileId: F }), 'an unknown branch');
      notFound(await store.fileAt('prj-nowhere', { branchId: WFS_MAIN_BRANCH, fileId: F }), 'an unknown project');
      refused(await store.fileAt(P, { branchId: WFS_MAIN_BRANCH, fileId: F, rev: -1 }), 'validation-failed', 'a negative revision');
      refused(await store.fileAt(P, { branchId: WFS_MAIN_BRANCH, fileId: '../x' }), 'validation-failed', 'a malformed file id');
      // bytes: a referenced blob (even one only an OLD version names) with its recorded size; an unreferenced or unknown one is null
      for (const b of [a1, a2]) {
        const got = value(await store.readReferencedBlob(P, b.sha256), `referenced ${b.sha256.slice(0, 8)}`);
        same(got === null ? null : [got.size, got.bytes === null ? null : sha256Bytes(got.bytes)], [b.size, b.sha256], 'a referenced blob: its size and its bytes');
      }
      same(value(await store.readReferencedBlob(P, loose.sha256), 'loose'), null, 'an uploaded, never committed blob: null');
      same(value(await store.readReferencedBlob(P, sha('nothing at all')), 'unknown'), null, 'an unknown address: null');
      notFound(await store.readReferencedBlob('prj-nowhere', a1.sha256), 'an unknown project');
      refused(await store.readReferencedBlob(P, 'ABC'), 'validation-failed', 'a malformed address');
      // CONTROL: the loose blob IS held -- only its reference is missing
      same(value(await store.blobInfo(P, loose.sha256), 'blobInfo loose'), { ...loose, referenced: false }, 'CONTROL: the loose blob is held');
    },
  },
  {
    name: 'BLOB (F5): a blob stored through one bridge is committable through another whose state is cached; storing it does not move the version; address and integrity are the store\'s',
    async run(h) {
      const P = 'prj-blob';
      await h.seed(P, { usr_owner: 'OWNER' });
      const one = h.open();
      const two = h.open();
      value(await two.createProject(P, NOW), 'createProject');
      // bridge TWO commits first, so it holds this project's state at the current version
      await commitOk(two, P, { requestId: 'req-blob-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] });
      const versionBefore = value(await two.head(P), 'head').lastEventSeq;
      const x = await put(one, P, 'stored through bridge one');
      // CONTROL: storing a blob does not move the project's version, so a cache keyed on the version cannot have seen it
      same(value(await two.head(P), 'head').lastEventSeq, versionBefore, 'putBlob moves no version');
      same(value(await two.blobInfo(P, x.sha256), 'blobInfo'), { ...x, referenced: false }, 'bridge two sees the blob, unreferenced');
      const landed = await commitOk(two, P, { requestId: 'req-blob-02', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd/x.txt', kind: 'file', ...x }] });
      same(committedRev(landed, 'the cross-bridge commit'), 2, 'bridge two commits the blob bridge one stored');
      same(value(await one.blobInfo(P, x.sha256), 'blobInfo'), { ...x, referenced: true }, 'now referenced');
      same(value(await two.verifyBlob(P, x.sha256), 'verify'), { status: 'intact', size: x.size }, 'intact');
      same(sha256Bytes((await two.readBlob(P, x.sha256)) ?? breach('no bytes')), x.sha256, 'the bytes read back hash to the address');
      // a blob nobody stored: refused as malformed (not a conflict), nothing kept
      const missing = await two.commit(P, { requestId: 'req-blob-03', branchId: WFS_MAIN_BRANCH, baseRev: 2, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd/y.txt', kind: 'file', sha256: sha('never stored'), size: 12 }] }, NOW);
      refused(missing, 'validation-failed', 'a commit naming a blob the project does not hold');
      same(value(await one.head(P), 'head').lastEventSeq, versionBefore + 1, 'the refusal kept nothing (one event: the cross-bridge commit)');
      // a size that does not match the stored blob is refused too
      refused(await two.commit(P, { requestId: 'req-blob-04', branchId: WFS_MAIN_BRANCH, baseRev: 2, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd/z.txt', kind: 'file', sha256: x.sha256, size: x.size + 1 }] }, NOW), 'validation-failed', 'a wrong size');
      same(value(await two.blobInfo(P, sha('never stored')), 'blobInfo'), null, 'an address nothing was stored at');
      same(value(await two.verifyBlob(P, sha('never stored')), 'verify'), { status: 'absent' }, 'absent');
      same(await two.readBlob(P, sha('never stored')), null, 'no bytes');
      refused(await two.blobInfo(P, 'ABC'), 'validation-failed', 'a malformed address');
      refused(await two.verifyBlob(P, x.sha256.toUpperCase()), 'validation-failed', 'an upper-case address');
      const small = h.open({ limits: { ...WFS_ALPHA_LIMITS, maxFileBytes: 8 } });
      refused(await small.putBlob(P, utf8('nine byte')), 'validation-failed', 'a blob over the per-file limit');
      notFound(await one.blobInfo('prj-nowhere', x.sha256), 'a blob of an unknown project');
    },
  },
  {
    name: 'ROLE: the product\'s OWNER / ADMIN / MEMBER through the one mapping; anything else, and a non-member, is no role (never an error)',
    async run(h) {
      const P = 'prj-role';
      await h.seed(P, { usr_owner: 'OWNER', usr_admin: 'ADMIN', usr_member: 'MEMBER', usr_lower: 'owner', usr_viewer: 'VIEWER', usr_padded: ' OWNER' });
      const store = h.open();
      // no WonderFS project yet: the membership read needs none (a route asks it FIRST, §19.m2)
      const expected: Array<[string, string | null]> = [['usr_owner', 'owner'], ['usr_admin', 'editor'], ['usr_member', 'editor'], ['usr_lower', null], ['usr_viewer', null], ['usr_padded', null], ['usr_stranger', null]];
      for (const [player, role] of expected) same(value(await store.memberRole(P, player), `role of ${player}`), role, `${player} -> ${role}`);
      same(value(await store.memberRole('prj-nowhere', 'usr_owner'), 'role in an unknown project'), null, 'an unknown project: no role');
      await h.setRole(P, 'usr_member', null);
      same(value(await store.memberRole(P, 'usr_member'), 'removed'), null, 'removed: no role');
      await h.setRole(P, 'usr_lower', 'MEMBER');
      same(value(await store.memberRole(P, 'usr_lower'), 'fixed'), 'editor', 'rewritten as the product writes it: editor');
    },
  },
  {
    name: 'PROJECTS (H1): a player\'s projects are the memberships the one mapping gives a role AND a live file environment, paged by project id in code-point order; anything else is absent, never an error',
    async run(h) {
      const store = h.open();
      const me = 'usr_lister';
      // a OWNER, b MEMBER, c ADMIN; d a lower-case legacy 'owner' (no role); e a MEMBER with NO file environment; f someone else's
      await h.seed('prj-list-a', { [me]: 'OWNER' });
      await h.seed('prj-list-b', { [me]: 'MEMBER' });
      await h.seed('prj-list-c', { [me]: 'ADMIN' });
      await h.seed('prj-list-d', { [me]: 'owner' });
      await h.seed('prj-list-e', { [me]: 'MEMBER' });
      await h.seed('prj-list-f', { usr_list_other: 'OWNER' });
      for (const p of ['prj-list-a', 'prj-list-b', 'prj-list-c', 'prj-list-d', 'prj-list-f']) value(await store.createProject(p, NOW), `createProject ${p}`);
      const ids = (r: RelayResult<{ readonly projects: ReadonlyArray<{ readonly projectId: string }> }>, what: string) => value(r, what).projects.map((x) => x.projectId);
      same(value(await store.projectsOf(me, { limit: WFS_PAGE_MAX_LIMIT }), 'mine'), {
        projects: [{ projectId: 'prj-list-a', role: 'owner' }, { projectId: 'prj-list-b', role: 'editor' }, { projectId: 'prj-list-c', role: 'editor' }],
        next: null,
      }, 'exactly the readable ones, with their WonderFS roles');
      // CONTROLS: what keeps d and e out is real -- e IS a membership with a role (only its file environment is missing; a listing
      // without the join would show it), and d HAS a file environment (only its role is no role; a case-insensitive map shows it)
      same(value(await store.memberRole('prj-list-e', me), 'role in e'), 'editor', 'CONTROL: e is a membership with a role');
      same(value(await store.head('prj-list-d'), 'head of d').main.headRev, 0, 'CONTROL: d has a live file environment');
      // pages: by 2, gapless, nothing twice
      const p1 = value(await store.projectsOf(me, { limit: 2 }), 'page 1');
      same([p1.projects.map((x) => x.projectId), p1.next], [['prj-list-a', 'prj-list-b'], 'prj-list-b'], 'page 1');
      same(ids(await store.projectsOf(me, { after: p1.next, limit: 2 }), 'page 2'), ['prj-list-c'], 'page 2');
      same(value(await store.projectsOf(me, { after: 'prj-list-c', limit: 2 }), 'past the end'), { projects: [], next: null }, 'past the end');
      // read NOW: a removed membership is gone at once, and a new file environment appears at once
      await h.setRole('prj-list-b', me, null);
      value(await store.createProject('prj-list-e', NOW), 'createProject prj-list-e');
      same(ids(await store.projectsOf(me, {}), 'after the changes'), ['prj-list-a', 'prj-list-c', 'prj-list-e'], 'b removed, e has a file environment now');
      // another player sees only their own; a stranger sees nothing (no error)
      same(value(await store.projectsOf('usr_list_other', {}), 'other'), { projects: [{ projectId: 'prj-list-f', role: 'owner' }], next: null }, 'another player: their own only');
      same(value(await store.projectsOf('usr_list_stranger', {}), 'stranger'), { projects: [], next: null }, 'a stranger: nothing');
      // refused before any lookup
      for (const limit of [0, -1, 1.5, WFS_PAGE_MAX_LIMIT + 1]) refused(await store.projectsOf(me, { limit }), 'validation-failed', `limit ${limit}`);
      refused(await store.projectsOf(me, { after: 'no/slash' }), 'validation-failed', 'a malformed cursor');
      refused(await store.projectsOf('', {}), 'validation-failed', 'an empty player id');
    },
  },
  {
    name: 'APPROVE: only an editor/owner NOW approves; the merge uses the STORED approval by id and re-reads its approver\'s role; a forged id is no approval',
    async run(h) {
      const P = 'prj-approve';
      await h.seed(P, { usr_owner: 'OWNER', usr_admin: 'ADMIN', usr_member: 'MEMBER', usr_legacy: 'editor' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const agent = who('agent-1', 'imported_agent');
      const branchId = value(await store.fork(P, { fromBranchId: WFS_MAIN_BRANCH, owner: agent }, NOW), 'fork').branchId;
      await commitOk(store, P, { requestId: 'req-appr-01', branchId, baseRev: 0, principal: agent, ops: [{ op: 'create', path: 'agent', kind: 'dir' }] });
      for (const approver of ['usr_owner', 'usr_admin', 'usr_member']) value(await store.approve(P, { branchId, principal: who(approver) }, NOW), `${approver} approves`);
      for (const approver of ['usr_legacy', 'usr_stranger']) {
        const r = await store.approve(P, { branchId, principal: who(approver) }, NOW);
        refused(r, 'permission-denied', `${approver} may not approve`);
        same(r.ok ? null : r.error.details, ['wonderfs: approval_forbidden'], `${approver}: approval_forbidden`);
      }
      refused(await store.approve(P, { branchId, principal: agent }, NOW), 'permission-denied', 'an agent never approves');
      const approval = value(await store.approve(P, { branchId, principal: who('usr_member') }, NOW), 'the member\'s approval');
      const merge = (requestId: string, approvalId: string | null = approval.approvalId) => store.mergeBack(P, { requestId, branchId, principal: agent, approvalId, reviewVerdict: null }, NOW);
      const stale = (r: RelayResult<unknown>, what: string) => {
        refused(r, 'stale-context', what);
        same(r.ok ? null : r.error.details, ['wonderfs: approval_stale'], `${what}: approval_stale`);
      };
      await h.setRole(P, 'usr_member', null);
      stale(await merge('req-appr-m1'), 'the approver was removed');
      await h.setRole(P, 'usr_member', 'editor');
      stale(await merge('req-appr-m2'), 'the approver came back as a lower-case legacy value');
      refused(await merge('req-appr-m3', 'approval-forged'), 'evidence-required', 'a forged approval id is no approval');
      await h.setRole(P, 'usr_member', 'MEMBER');
      same(value(await merge('req-appr-m4'), 'merge').status, 'committed', 'CONTROL: back to what the product writes, the same stored approval merges');
    },
  },
  {
    name: 'UNKNOWN: every read of an unknown project, branch, file, conflict or revision is the ONE not-found; a project the product does not know gets no file environment; creating twice is one project',
    async run(h) {
      const store = h.open();
      const nowhere = 'prj-nowhere';
      const sha0 = sha('x');
      notFound(await store.head(nowhere), 'head');
      notFound(await store.tree(nowhere, { branchId: WFS_MAIN_BRANCH }), 'tree');
      notFound(await store.fileHistory(nowhere, { branchId: WFS_MAIN_BRANCH, fileId: 'file-1' }), 'history');
      notFound(await store.changes(nowhere, { branchId: WFS_MAIN_BRANCH, afterRev: 0 }), 'changes');
      notFound(await store.events(nowhere, { afterSeq: 0 }), 'events');
      notFound(await store.conflicts(nowhere, { status: 'all' }), 'conflicts');
      notFound(await store.conflict(nowhere, 'conflict-1'), 'conflict');
      notFound(await store.blobInfo(nowhere, sha0), 'blobInfo');
      notFound(await store.verifyBlob(nowhere, sha0), 'verifyBlob');
      same(await store.readBlob(nowhere, sha0), null, 'readBlob');
      same(await store.project(nowhere), null, 'project');
      refused(await store.commit(nowhere, { requestId: 'req-unknown-1', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW), 'not-found', 'commit');
      refused(await store.putBlob(nowhere, utf8('x')), 'not-found', 'putBlob');
      refused(await store.createProject('prj-unseeded', NOW), 'not-found', 'a project the product does not know');
      const P = 'prj-twice';
      await h.seed(P, { usr_owner: 'OWNER' });
      const g1 = value(await store.createProject(P, NOW), 'create 1');
      const g2 = value(await h.open().createProject(P, NOW), 'create 2');
      same([g1, g2], [{ genesisHash: wfsGenesisHash(P, sha) }, { genesisHash: wfsGenesisHash(P, sha) }], 'one genesis');
      same(value(await store.head(P), 'head'), { projectId: P, genesisHash: wfsGenesisHash(P, sha), main: { headRev: 0, headCommitHash: wfsGenesisHash(P, sha) }, usage: { files: 0, bytes: 0 }, lastEventSeq: 0 }, 'a new project: main at rev 0, nothing in it');
      same(value(await store.tree(P, { branchId: WFS_MAIN_BRANCH }), 'empty tree'), { branchId: WFS_MAIN_BRANCH, rev: 0, headRev: 0, entries: [], next: null }, 'an empty tree');
      notFound(await store.fileHistory(P, { branchId: WFS_MAIN_BRANCH, fileId: 'file-1' }), 'an unknown file');
    },
  },
  {
    name: 'REPLAY: a replay keeps nothing (no event, the original answer); the same request id for another change, or from another player, is refused',
    async run(h) {
      const P = 'prj-replay';
      await h.seed(P, { usr_owner: 'OWNER', usr_member: 'MEMBER' });
      const store = h.open();
      value(await store.createProject(P, NOW), 'createProject');
      const req: WfsCommitRequest = { requestId: 'req-replay-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'notes', kind: 'dir' }] };
      const first = await commitOk(store, P, req);
      await commitOk(store, P, { ...req, requestId: 'req-replay-02', baseRev: 1, ops: [{ op: 'create', path: 'later', kind: 'dir' }] });
      const seq = value(await store.head(P), 'head').lastEventSeq;
      // the same request from a NEW sign-in (another session ref and build), through another bridge: the ORIGINAL revision
      const again = await commitOk(h.open(), P, { ...req, principal: { ...req.principal, sessionId: 'sref-new', clientBuild: 'build-2' } });
      same(again, { ...first, replay: true }, 'the original answer, marked as a replay');
      same(value(await store.head(P), 'head').lastEventSeq, seq, 'a replay keeps nothing');
      refused(await store.commit(P, { ...req, principal: who('usr_member') }, NOW), 'duplicate-idempotency-key', 'another player, the same id');
      refused(await store.commit(P, { ...req, ops: [{ op: 'create', path: 'other', kind: 'dir' }] }, NOW), 'duplicate-idempotency-key', 'another change, the same id');
    },
  },
];
