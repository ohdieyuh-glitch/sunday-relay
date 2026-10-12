/**
 * WONDERFS — the STORE INTERFACE every route depends on (R0b; contract r1.4 §6.1, §6.2, §7, §10). Routes never touch rows or
 * the engine's state: they call a `WfsStore`.
 *
 * Two implementations, ONE engine: the PostgreSQL store (persistence/wonderfs-postgres.ts) and the in-memory store
 * (wonderfs-memory-store.ts, for handler tests and the dev server). In both, the reference engine (wonderfs-engine.ts) DECIDES
 * every change and the store persists exactly what it decided. The same conformance cases run against both
 * (persistence/wonderfs-store-conformance.ts: locally on memory, on real PostgreSQL in CI).
 *
 * The read contract, identical in both:
 *   - ONE CONSISTENT STATE per call: a read never mixes two committed states (Postgres: one REPEATABLE READ READ ONLY snapshot;
 *     memory: one immutable state object);
 *   - PAGES are bounded twice: at most `limit` items (1..WFS_PAGE_MAX_LIMIT), and at most WFS_PAGE_MAX_BYTES of JSON for the
 *     whole page (§6.1, §7). The one exception is an item that ALONE exceeds the bound (a commit record touching thousands of
 *     files): it is served alone, so a feed never stalls (`wfsBoundPage`);
 *   - STABLE CURSORS: a tree page is pinned to a REVISION (the cursor carries it), so a commit landing between two pages never
 *     shifts, repeats or drops an entry; history, changes, events and conflicts page by an immutable key;
 *   - ORDER: tree entries by path key in CODE-POINT order (= UTF-8 byte order = PostgreSQL `COLLATE "C"`), then file id;
 *   - UNKNOWN = `not-found` with one message ("Not found."), for a project, branch, file, conflict or revision alike (§9.1); a
 *     malformed query is `validation-failed`; an outage is `stale-ledger-version` (retryable), never "not found".
 *
 * NOT here (later slices): authorization (the route asks `memberRole` FIRST and reads nothing else before it succeeds, §19.m2),
 * streaming blobs / Range / the WfsBlobStore seam (R1/R2), snapshots (R4).
 *
 * Pure: no Node, no I/O. Types, limits and the shared paging / status helpers both stores use, so they cannot drift apart.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { WfsHumanRole } from './wonderfs-authz';
import type {
  WfsBranchId,
  WfsCommit,
  WfsCommitOutcome,
  WfsCommitRequest,
  WfsConflict,
  WfsEntry,
  WfsFileId,
  WfsMergeApproval,
  WfsPrincipal,
  WfsRecordedOp,
  WfsReviewVerdict,
} from './wonderfs-contracts';
import type { WfsBranchState, WfsProjectState } from './wonderfs-engine';

/* ---------------------------------------------------------------------------------------------------------------- limits */

/** §6.1 / §7: a page is at most 1 MiB of JSON (the client caps a JSON answer at 2 MiB). */
export const WFS_PAGE_MAX_BYTES = 1024 * 1024;
/** What a page's ITEMS may use of it; the rest is the page's own envelope (ids, revisions, the cursor: far below 4 KiB). */
export const WFS_PAGE_ITEM_BYTES = WFS_PAGE_MAX_BYTES - 4096;
export const WFS_PAGE_DEFAULT_LIMIT = 200;
export const WFS_PAGE_MAX_LIMIT = 1000;
/** A closed conflict's record (and the blobs it holds) is kept this long after its resolution or dismissal (§11, N-MAJOR-1). */
export const WFS_CONFLICT_RETENTION_MS = 30 * 24 * 3600 * 1000;

/* ----------------------------------------------------------------------------------------------------------------- shapes */

export interface WfsStoreEvent {
  /** e.g. commit, conflict, branch.fork, branch.merge, branch.discard, approval */
  readonly kind: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/** H1 (R1): the caller's projects, a page at a time. */
export interface WfsProjectsQuery {
  /** The previous page's `next` (a project id): only projects after it, in code-point order. */
  readonly after?: string | null;
  readonly limit?: number;
}

/** A project the player may read: a membership the ONE mapping gives a role, with a LIVE file environment. */
export interface WfsMemberProject {
  readonly projectId: string;
  readonly role: WfsHumanRole;
}

export interface WfsProjectsPage {
  /** By project id, in code-point order. */
  readonly projects: readonly WfsMemberProject[];
  readonly next: string | null;
}

/** H4: what a member sees first. */
export interface WfsProjectHead {
  readonly projectId: string;
  /** main's chain anchor (§19.M7). */
  readonly genesisHash: string;
  readonly main: { readonly headRev: number; readonly headCommitHash: string };
  /** Live files and their bytes on main (§11's limits are judged on these). */
  readonly usage: { readonly files: number; readonly bytes: number };
  /** The newest lifecycle event's sequence number (0: none yet): where an events reader starts. */
  readonly lastEventSeq: number;
}

export interface WfsTreeQuery {
  readonly branchId: WfsBranchId;
  /** The revision to list; omitted = the head. A cursor carries its own revision (a different `rev` with it is refused). */
  readonly rev?: number | null;
  /** The previous page's `next`. Opaque; it carries no path. */
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface WfsTreePage {
  readonly branchId: WfsBranchId;
  /** The revision this page lists (pinned for every following page). */
  readonly rev: number;
  /** The branch's head NOW (it may be past `rev` while a listing pages on). */
  readonly headRev: number;
  /** Live entries, by path key in code-point order, then file id. */
  readonly entries: readonly WfsEntry[];
  readonly next: string | null;
}

export interface WfsHistoryQuery {
  readonly branchId: WfsBranchId;
  readonly fileId: WfsFileId;
  /** Only versions below this one (the previous page's `next`); omitted = from the newest. */
  readonly before?: number | null;
  readonly limit?: number;
}

/** One version of one file on one branch. `rev` = the branch revision whose commit made it; 0 = the branch's fork-time base. */
export interface WfsFileVersion {
  readonly rev: number;
  readonly entry: WfsEntry;
}

export interface WfsHistoryPage {
  readonly branchId: WfsBranchId;
  readonly fileId: WfsFileId;
  /** The file as it is at the head (a tombstone if deleted). */
  readonly current: WfsEntry;
  /** Newest first. */
  readonly versions: readonly WfsFileVersion[];
  readonly next: number | null;
}

export interface WfsChangesQuery {
  readonly branchId: WfsBranchId;
  readonly afterRev: number;
  readonly limit?: number;
}

export interface WfsChangesPage {
  readonly branchId: WfsBranchId;
  readonly headRev: number;
  /** The FULL commit records after `afterRev`, gapless, in order (§7, P-3). */
  readonly commits: readonly WfsCommit[];
  /** The last revision returned when more follow (pass it as the next `afterRev`); null = caught up to this page's head. */
  readonly next: number | null;
}

export interface WfsEventsQuery {
  readonly afterSeq: number;
  readonly limit?: number;
}

export interface WfsEventRecord {
  readonly seq: number;
  readonly kind: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly atIso: string;
}

export interface WfsEventsPage {
  readonly events: readonly WfsEventRecord[];
  readonly lastSeq: number;
  readonly next: number | null;
}

/** 036's statuses: a resolution with no ops (keep theirs) is a DISMISSAL. `superseded` is J-10's (agent phase): never written yet. */
export type WfsConflictStatus = 'open' | 'resolved' | 'dismissed';

export interface WfsConflictClosing {
  readonly status: WfsConflictStatus;
  readonly closedAtIso: string | null;
  readonly retainUntilIso: string | null;
}

export interface WfsConflictsQuery {
  /** Only this branch's conflicts; omitted = every branch. */
  readonly branchId?: WfsBranchId | null;
  readonly status: 'open' | 'all';
  /** The previous page's `next` (a conflict id). */
  readonly after?: string | null;
  readonly limit?: number;
}

/** A conflict in a LIST: what it is, without its (possibly large) preserved ops; `conflict()` returns the whole record. */
export interface WfsConflictSummary {
  readonly conflictId: string;
  readonly branchId: WfsBranchId;
  readonly requestId: string;
  readonly status: WfsConflictStatus;
  readonly principal: WfsPrincipal;
  readonly baseRev: number;
  readonly headRevAtRefusal: number;
  readonly atIso: string;
  readonly mergesBranchId: WfsBranchId | null;
  readonly opCount: number;
  readonly failureCount: number;
}

export interface WfsConflictsPage {
  /** By conflict id (code-point order). */
  readonly conflicts: readonly WfsConflictSummary[];
  readonly next: string | null;
}

export interface WfsConflictView extends WfsConflictClosing {
  readonly record: WfsConflict;
}

export interface WfsBlobInfo {
  readonly sha256: string;
  readonly size: number;
  /** Named by a version, a current or fork-time entry, or a retained conflict, on any branch of this project. */
  readonly referenced: boolean;
}

/** A blob's bytes checked against its address and recorded size, read from the store (never from a process's memory). */
export type WfsBlobIntegrity =
  | { readonly status: 'absent' }
  | { readonly status: 'intact'; readonly size: number }
  | { readonly status: 'corrupt'; readonly reason: 'bytes_missing' | 'size_mismatch' | 'hash_mismatch' };

/* ------------------------------------------------------------------------------------------------------------- the store */

export interface WfsStore {
  /** A project's file environment, created with its Project Avatar's project (INV-10: always on; there is no "off"). Idempotent. */
  createProject(projectId: string, nowIso: string): Promise<RelayResult<{ readonly genesisHash: string }>>;
  /**
   * The member's WonderFS role NOW, through the ONE product -> WonderFS mapping (r1.4 §8.2); `null` = no role. It reads only the
   * membership (no wfs_* row), so a route can call it BEFORE any other lookup (§19.m2). An outage is a failure, never `null`.
   */
  memberRole(projectId: string, playerId: string): Promise<RelayResult<WfsHumanRole | null>>;
  /**
   * H1 (R1; the R0b review's MAJOR-2 / C3): the projects `playerId` may read -- a membership whose PRODUCT role the ONE mapping
   * turns into a WonderFS role, JOINED to a live file environment, in ONE consistent state. A soft-deleted project, a membership in
   * a project with no file environment, and a role no product writer produces are all ABSENT (never an error). Paged by project id
   * in code-point order. It reads the caller's own memberships only: no requested object is named, so nothing is looked up before
   * an authorization (§19.m2).
   */
  projectsOf(playerId: string, query: WfsProjectsQuery): Promise<RelayResult<WfsProjectsPage>>;

  /** The whole state as committed (one consistent state), or null. For tests, the oracle and tools; routes use the paged reads. */
  project(projectId: string): Promise<WfsProjectState | null>;
  head(projectId: string): Promise<RelayResult<WfsProjectHead>>;
  tree(projectId: string, query: WfsTreeQuery): Promise<RelayResult<WfsTreePage>>;
  fileHistory(projectId: string, query: WfsHistoryQuery): Promise<RelayResult<WfsHistoryPage>>;
  changes(projectId: string, query: WfsChangesQuery): Promise<RelayResult<WfsChangesPage>>;
  events(projectId: string, query: WfsEventsQuery): Promise<RelayResult<WfsEventsPage>>;
  conflicts(projectId: string, query: WfsConflictsQuery): Promise<RelayResult<WfsConflictsPage>>;
  conflict(projectId: string, conflictId: string): Promise<RelayResult<WfsConflictView>>;
  /** A blob this project holds (null: it holds none at that address), read from the store: correct across bridge instances. */
  blobInfo(projectId: string, sha256: string): Promise<RelayResult<WfsBlobInfo | null>>;
  /** Re-hash a held blob's stored bytes against its address and recorded size. */
  verifyBlob(projectId: string, sha256: string): Promise<RelayResult<WfsBlobIntegrity>>;
  readBlob(projectId: string, sha256: string): Promise<Uint8Array | null>;

  /** §6.2. Blob presence is read from the store inside the change (never a process cache): a blob another bridge stored counts. */
  commit(projectId: string, req: WfsCommitRequest, nowIso: string): Promise<RelayResult<WfsCommitOutcome>>;
  fork(projectId: string, input: { readonly fromBranchId: WfsBranchId; readonly owner: WfsPrincipal }, nowIso: string): Promise<RelayResult<{ readonly branchId: WfsBranchId }>>;
  /**
   * The approval is the one STORED by `approve`, looked up by its id -- never an object the caller built -- and the approver's
   * CURRENT role is read with the merge (r1.4 N-minor-1). A review verdict is checked against the reviewer's RECORDED verdict by
   * the Julius layer before it reaches here (TJ-3).
   */
  mergeBack(projectId: string, input: { readonly requestId: string; readonly branchId: WfsBranchId; readonly principal: WfsPrincipal; readonly approvalId: string | null; readonly reviewVerdict: WfsReviewVerdict | null }, nowIso: string): Promise<RelayResult<WfsCommitOutcome>>;
  /** The human's CURRENT role is read with the approval (r1.4 N-minor-1); the approval is kept. */
  approve(projectId: string, input: { readonly branchId: WfsBranchId; readonly principal: WfsPrincipal }, nowIso: string): Promise<RelayResult<WfsMergeApproval>>;
  discard(projectId: string, branchId: WfsBranchId, nowIso: string): Promise<RelayResult<null>>;
  /** Stores bytes under the sha256 computed HERE; idempotent. */
  putBlob(projectId: string, bytes: Uint8Array): Promise<RelayResult<{ readonly sha256: string; readonly size: number }>>;
}

/* ------------------------------------------------------------------------------------------ shared by both implementations */

/** The one not-found every read answers with (§9.1); the reason goes to `details`, the server's log only. */
export function wfsNotFound(reasonForServerLog: string): RelayResult<never> {
  return fail(relayError('not-found', 'Not found.', { details: [`wonderfs: ${reasonForServerLog}`] }));
}

function invalidQuery(why: string): RelayResult<never> {
  return fail(relayError('validation-failed', `WonderFS refused the request: ${why}.`, { details: [`wonderfs: ${why}`] }));
}

const isCount = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= 2_147_483_647;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export const wfsIsSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256_RE.test(value);

/** A blob address as given to a read: 64 lowercase hex characters, else refused before any lookup. */
export function wfsCheckSha256(value: unknown): RelayResult<string> {
  return wfsIsSha256(value) ? ok(value) : invalidQuery('a content hash is not 64 lowercase hex characters');
}

function checkId(value: unknown, what: string): RelayResult<string> {
  return typeof value === 'string' && ID_RE.test(value) ? ok(value) : invalidQuery(`the ${what} is malformed`);
}

/** A page size: omitted = the default; else a whole number 1..WFS_PAGE_MAX_LIMIT. */
export function wfsPageLimit(limit: unknown): RelayResult<number> {
  if (limit === undefined) return ok(WFS_PAGE_DEFAULT_LIMIT);
  return isCount(limit, 1) && limit <= WFS_PAGE_MAX_LIMIT ? ok(limit) : invalidQuery(`a page holds 1 to ${WFS_PAGE_MAX_LIMIT} items`);
}

const TREE_CURSOR_RE = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;

/** A tree page's cursor: the revision being listed and how many entries came before. Opaque to callers; never a path. */
export function wfsEncodeTreeCursor(rev: number, offset: number): string {
  return `${rev}.${offset}`;
}

export function wfsDecodeTreeCursor(cursor: string): { readonly rev: number; readonly offset: number } | null {
  const m = TREE_CURSOR_RE.exec(cursor);
  return m === null ? null : { rev: Number(m[1]), offset: Number(m[2]) };
}

/** A tree query, checked before any lookup: `rev: null` = the head (resolved inside the read's one state). */
export function wfsCheckTreeQuery(q: WfsTreeQuery): RelayResult<{ readonly branchId: string; readonly rev: number | null; readonly offset: number; readonly limit: number }> {
  const branchId = checkId(q.branchId, 'branch id');
  if (!branchId.ok) return branchId;
  const limit = wfsPageLimit(q.limit);
  if (!limit.ok) return limit;
  const rev = q.rev ?? null;
  if (rev !== null && !isCount(rev, 0)) return invalidQuery('the revision is malformed');
  const cursor = q.cursor ?? null;
  if (cursor === null) return ok({ branchId: branchId.value, rev, offset: 0, limit: limit.value });
  const decoded = typeof cursor === 'string' ? wfsDecodeTreeCursor(cursor) : null;
  if (decoded === null) return invalidQuery('the page cursor is malformed');
  if (rev !== null && rev !== decoded.rev) return invalidQuery('the page cursor belongs to another revision');
  return ok({ branchId: branchId.value, rev: decoded.rev, offset: decoded.offset, limit: limit.value });
}

export function wfsCheckHistoryQuery(q: WfsHistoryQuery): RelayResult<{ readonly branchId: string; readonly fileId: string; readonly before: number | null; readonly limit: number }> {
  const branchId = checkId(q.branchId, 'branch id');
  if (!branchId.ok) return branchId;
  const fileId = checkId(q.fileId, 'file id');
  if (!fileId.ok) return fileId;
  const limit = wfsPageLimit(q.limit);
  if (!limit.ok) return limit;
  const before = q.before ?? null;
  if (before !== null && !isCount(before, 1)) return invalidQuery('the history cursor is malformed');
  return ok({ branchId: branchId.value, fileId: fileId.value, before, limit: limit.value });
}

export function wfsCheckChangesQuery(q: WfsChangesQuery): RelayResult<{ readonly branchId: string; readonly afterRev: number; readonly limit: number }> {
  const branchId = checkId(q.branchId, 'branch id');
  if (!branchId.ok) return branchId;
  const limit = wfsPageLimit(q.limit);
  if (!limit.ok) return limit;
  if (!isCount(q.afterRev, 0)) return invalidQuery('the revision to read after is malformed');
  return ok({ branchId: branchId.value, afterRev: q.afterRev, limit: limit.value });
}

/** H1's query, and the player it is for, checked before any lookup. */
export function wfsCheckProjectsQuery(playerId: unknown, q: WfsProjectsQuery): RelayResult<{ readonly playerId: string; readonly after: string | null; readonly limit: number }> {
  const player = checkId(playerId, 'player id');
  if (!player.ok) return player;
  const limit = wfsPageLimit(q.limit);
  if (!limit.ok) return limit;
  const after = q.after ?? null;
  if (after !== null && !checkId(after, 'project cursor').ok) return invalidQuery('the project cursor is malformed');
  return ok({ playerId: player.value, after, limit: limit.value });
}

export function wfsCheckEventsQuery(q: WfsEventsQuery): RelayResult<{ readonly afterSeq: number; readonly limit: number }> {
  const limit = wfsPageLimit(q.limit);
  if (!limit.ok) return limit;
  if (!isCount(q.afterSeq, 0)) return invalidQuery('the event to read after is malformed');
  return ok({ afterSeq: q.afterSeq, limit: limit.value });
}

export function wfsCheckConflictsQuery(q: WfsConflictsQuery): RelayResult<{ readonly branchId: string | null; readonly all: boolean; readonly after: string | null; readonly limit: number }> {
  const limit = wfsPageLimit(q.limit);
  if (!limit.ok) return limit;
  if (q.status !== 'open' && q.status !== 'all') return invalidQuery('the conflict status is neither open nor all');
  const branchId = q.branchId ?? null;
  if (branchId !== null && !checkId(branchId, 'branch id').ok) return invalidQuery('the branch id is malformed');
  const after = q.after ?? null;
  if (after !== null && !checkId(after, 'conflict cursor').ok) return invalidQuery('the conflict cursor is malformed');
  return ok({ branchId, all: q.status === 'all', after, limit: limit.value });
}

/**
 * Code-point order: the order of UTF-8 bytes, i.e. PostgreSQL's `COLLATE "C"` on a UTF-8 database. NOT JavaScript's default
 * (UTF-16 code units), which puts U+10000.. before U+E000..U+FFFF; both stores page in THIS order, so a page means the same
 * thing in each.
 */
export function wfsCompareKeys(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a.codePointAt(i) as number;
    const y = b.codePointAt(i) as number;
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i += 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Tree order: path key, then file id (a total order even if two keys ever met). */
export const wfsCompareEntries = (a: WfsEntry, b: WfsEntry): number => wfsCompareKeys(a.pathKey, b.pathKey) || wfsCompareKeys(a.fileId, b.fileId);

/** The UTF-8 length of `value`'s JSON (JSON.stringify leaves only well-formed surrogate pairs, each 4 bytes). */
export function wfsJsonBytes(value: unknown): number {
  const s = JSON.stringify(value) ?? '';
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

/**
 * One page out of `rows` (read with ONE MORE than `limit`, so "more follow" is known): at most `limit` items and at most
 * `itemBytes` of JSON for the list. The first item is always taken, so a single item larger than the bound is served alone and
 * the reader still moves on.
 */
export function wfsBoundPage<T>(rows: readonly T[], limit: number, itemBytes: number = WFS_PAGE_ITEM_BYTES): { readonly items: T[]; readonly more: boolean } {
  const items: T[] = [];
  let used = 2; // the list's brackets
  for (const row of rows) {
    if (items.length === limit) break;
    const size = wfsJsonBytes(row) + (items.length === 0 ? 0 : 1);
    if (items.length > 0 && used + size > itemBytes) break;
    items.push(row);
    used += size;
  }
  return { items, more: items.length < rows.length };
}

/** An ISO instant in one spelling (what PostgreSQL's timestamptz gives back), so both stores answer identically. */
export const wfsIso = (at: string | Date): string => new Date(at).toISOString();

/** The blob addresses an op set names (what a conflict holds while it is retained: N-MAJOR-1). */
export function wfsBlobsNamed(ops: readonly WfsRecordedOp[]): string[] {
  const out = new Set<string>();
  for (const op of ops) {
    if ((op.op === 'create' || op.op === 'update') && typeof op.sha256 === 'string') out.add(op.sha256);
    if (op.op === 'merge_put' && typeof op.changes.content?.sha256 === 'string') out.add(op.changes.content.sha256);
  }
  return [...out].sort();
}

/**
 * A conflict's 036 status and retention, decided when the change that opened or closed it is written: an engine "resolved"
 * whose resolving commit has NO ops is a dismissal (keep theirs); a closed conflict is retained 30 days from its closing.
 */
export function wfsConflictClosing(c: WfsConflict, branches: ReadonlyMap<WfsBranchId, WfsBranchState>, nowIso: string): WfsConflictClosing {
  if (c.status === 'open') return { status: 'open', closedAtIso: null, retainUntilIso: null };
  const resolving = c.resolvedByCommitId === null ? undefined : [...branches.values()].flatMap((b) => b.commits).find((x) => x.commitId === c.resolvedByCommitId);
  const closedAtIso = wfsIso(resolving?.atIso ?? nowIso);
  return {
    status: resolving !== undefined && resolving.ops.length === 0 ? 'dismissed' : 'resolved',
    closedAtIso,
    retainUntilIso: new Date(Date.parse(closedAtIso) + WFS_CONFLICT_RETENTION_MS).toISOString(),
  };
}

/** The ONE lifecycle event a commit-shaped outcome records (D-5); a replay records none. */
export function wfsOutcomeEvent(outcome: WfsCommitOutcome, kind: string): WfsStoreEvent | null {
  if (outcome.replay) return null;
  return outcome.status === 'committed'
    ? { kind, body: { branchId: outcome.branchId, rev: outcome.rev, commitId: outcome.commitId } }
    : { kind: 'conflict', body: { branchId: outcome.branchId, conflictId: outcome.conflictId } };
}

/** A held blob's bytes against its address and recorded size (`recordedSize: null` = not held). */
export function wfsBlobIntegrity(sha256: string, recordedSize: number | null, bytes: Uint8Array | null, sha256Bytes: (bytes: Uint8Array) => string): WfsBlobIntegrity {
  if (recordedSize === null) return { status: 'absent' };
  if (bytes === null) return { status: 'corrupt', reason: 'bytes_missing' };
  if (bytes.byteLength !== recordedSize) return { status: 'corrupt', reason: 'size_mismatch' };
  if (sha256Bytes(bytes) !== sha256) return { status: 'corrupt', reason: 'hash_mismatch' };
  return { status: 'intact', size: recordedSize };
}
