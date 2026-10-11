/**
 * WONDERFS — the commit engine (§4-§6). One project's whole file history, changed only by commits.
 *
 * What it guarantees, each with a test in wonderfs-engine.test.ts:
 *   - ATOMIC (INV-3): a commit applies every op or none.
 *   - NEVER SILENTLY DISCARD (INV-2): a changeset whose preconditions fail is kept whole, with its author, as a CONFLICT, in
 *     the same step that refuses it. Only a later recorded commit (keep mine / keep both) or dismissal (keep theirs) closes it.
 *   - LINEAR (INV-4): each branch's revisions are gapless; each commit names its predecessor's hash (INV-6).
 *   - IDEMPOTENT (INV-8): a request id answers the same way forever; reused with another payload it is refused.
 *   - HISTORY (INV-7): a deletion is a tombstone; the tree at any revision is reconstructible from the commits.
 *
 * Concurrency is per-file preconditions (§6.3), never locks: an edit and a concurrent move of the same file both land, because
 * an update checks only `contentVersion` and a move only `pathVersion`.
 *
 * Agents and clones work on their own branches and merge back (§6.5): a file the target changed since the fork is a conflict,
 * and then NOTHING applies and the branch stays as it was.
 *
 * This is the in-memory reference: correct, deterministic, and the oracle the Postgres store is tested against. Pure domain:
 * time, ids, sha256 and blob presence are injected.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { canonicalJson, wfsCommitHashInput } from './wonderfs-canonical';
import type {
  WfsBranchId,
  WfsCommit,
  WfsCommitOutcome,
  WfsCommitRequest,
  WfsConflict,
  WfsConflictId,
  WfsEntry,
  WfsFileId,
  WfsLimits,
  WfsMergePut,
  WfsOp,
  WfsOpFailure,
  WfsPrincipal,
  WfsPrincipalKind,
  WfsProjectId,
  WfsRecordedOp,
  WfsSha256,
} from './wonderfs-contracts';
import { normalizeWfsPath, wfsIsBeneath, wfsParentPath, wfsPathKey, wfsRebase, WFS_MAX_PATH_CHARS, type WfsPath } from './wonderfs-paths';

export const WFS_MAIN_BRANCH: WfsBranchId = 'main';

export interface WfsBranchState {
  readonly branchId: WfsBranchId;
  readonly kind: 'main' | 'agent';
  /** The branch this one forked from, at which of its revisions. `null` for main. */
  readonly parent: { readonly branchId: WfsBranchId; readonly forkRev: number } | null;
  /** Who works on an agent branch. `null` for main. */
  readonly owner: WfsPrincipal | null;
  readonly headRev: number;
  readonly headCommitHash: string | null;
  /** Every entry this branch can see, tombstones included, by file id. */
  readonly entries: ReadonlyMap<WfsFileId, WfsEntry>;
  /** The parent's entries at the fork: what merge-back compares against, and where history replay starts. Empty for main. */
  readonly base: ReadonlyMap<WfsFileId, WfsEntry>;
  readonly commits: readonly WfsCommit[];
  readonly closed: null | { readonly how: 'merged' | 'discarded'; readonly atIso: string; readonly targetRev: number | null };
}

export interface WfsStoredRequest {
  readonly payloadHash: string;
  readonly outcome: WfsCommitOutcome;
}

export interface WfsProjectState {
  readonly projectId: WfsProjectId;
  readonly branches: ReadonlyMap<WfsBranchId, WfsBranchState>;
  readonly conflicts: ReadonlyMap<WfsConflictId, WfsConflict>;
  /** Request id -> what it was and how it was answered (INV-8). */
  readonly requests: ReadonlyMap<string, WfsStoredRequest>;
}

export interface WfsEngineContext {
  readonly nowIso: string;
  readonly newId: (kind: 'file' | 'commit' | 'conflict' | 'branch') => string;
  readonly sha256Hex: (text: string) => string;
  /** The recorded size of a blob PRESENT in this project, else `null` (§10.1: a commit references present blobs only). */
  readonly blobSize: (sha256: WfsSha256) => number | null;
  readonly limits: WfsLimits;
}

export type WfsApplied = { readonly project: WfsProjectState; readonly outcome: WfsCommitOutcome };

export function emptyWfsProject(projectId: WfsProjectId): WfsProjectState {
  const main: WfsBranchState = {
    branchId: WFS_MAIN_BRANCH,
    kind: 'main',
    parent: null,
    owner: null,
    headRev: 0,
    headCommitHash: null,
    entries: new Map(),
    base: new Map(),
    commits: [],
    closed: null,
  };
  return { projectId, branches: new Map([[WFS_MAIN_BRANCH, main]]), conflicts: new Map(), requests: new Map() };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Request validation: a malformed request is REFUSED before anything changes (it is not a conflict: there is no well-formed
// intent to preserve, and the client keeps it in its journal, §12).
// ---------------------------------------------------------------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const PRINCIPAL_KINDS: readonly WfsPrincipalKind[] = ['human', 'julius', 'imported_agent', 'clone', 'service'];

function invalid(why: string): RelayResult<never> {
  return fail(relayError('validation-failed', `WonderFS refused the request: ${why}.`, { details: [`wonderfs: ${why}`] }));
}

const isCount = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min;

/** A validated op, with its path(s) normalized. */
type CheckedOp =
  | { readonly given: WfsOp & { op: 'create' }; readonly target: WfsPath }
  | { readonly given: WfsOp & { op: 'move' }; readonly target: WfsPath }
  | { readonly given: Exclude<WfsOp, { op: 'create' } | { op: 'move' }>; readonly target: null };

function checkBlob(sha256: unknown, size: unknown, ctx: WfsEngineContext): string | null {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return 'a file content hash is not 64 lowercase hex characters';
  if (!isCount(size, 0)) return 'a file size is not a whole number of bytes';
  if (size > ctx.limits.maxFileBytes) return `a file is larger than the ${ctx.limits.maxFileBytes}-byte limit`;
  const present = ctx.blobSize(sha256);
  if (present === null) return 'a file\'s content was not uploaded to this project before the commit';
  if (present !== size) return 'a file\'s size does not match its uploaded content';
  return null;
}

function checkOps(ops: unknown, allowEmpty: boolean, ctx: WfsEngineContext): RelayResult<CheckedOp[]> {
  if (!Array.isArray(ops)) return invalid('ops is not a list');
  if (ops.length === 0 && !allowEmpty) return invalid('a commit has no operations');
  if (ops.length > ctx.limits.maxOpsPerCommit) return invalid(`a commit has more than ${ctx.limits.maxOpsPerCommit} operations`);
  const out: CheckedOp[] = [];
  for (const raw of ops as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return invalid('an operation is not an object');
    const op = raw as Record<string, unknown>;
    if (op.op !== 'create' && typeof op.fileId !== 'string') return invalid('an operation names no file');
    if (op.op !== 'create' && !ID_RE.test(op.fileId as string)) return invalid('a file id is malformed');
    switch (op.op) {
      case 'create': {
        const target = normalizeWfsPath(op.path);
        if (!target.ok) return target;
        if (op.kind === 'file') {
          const bad = checkBlob(op.sha256, op.size, ctx);
          if (bad !== null) return invalid(bad);
        } else if (op.kind === 'dir') {
          if (op.sha256 !== undefined || op.size !== undefined) return invalid('a folder has no content');
        } else {
          return invalid('a created entry is neither a file nor a folder');
        }
        out.push({ given: { op: 'create', path: target.value.path, kind: op.kind, sha256: op.sha256 as WfsSha256 | undefined, size: op.size as number | undefined }, target: target.value });
        break;
      }
      case 'update': {
        if (!isCount(op.expectContentVersion, 1)) return invalid('an update names no content version it expects');
        const bad = checkBlob(op.sha256, op.size, ctx);
        if (bad !== null) return invalid(bad);
        out.push({ given: { op: 'update', fileId: op.fileId as string, expectContentVersion: op.expectContentVersion, sha256: op.sha256 as string, size: op.size as number }, target: null });
        break;
      }
      case 'move': {
        if (!isCount(op.expectPathVersion, 1)) return invalid('a move names no path version it expects');
        const target = normalizeWfsPath(op.newPath);
        if (!target.ok) return target;
        out.push({ given: { op: 'move', fileId: op.fileId as string, expectPathVersion: op.expectPathVersion, newPath: target.value.path }, target: target.value });
        break;
      }
      case 'delete': {
        const byContent = op.expectContentVersion !== undefined;
        const bySubtree = op.expectSubtreeRev !== undefined;
        if (byContent === bySubtree) return invalid('a delete names exactly one of: the content version (a file) or the subtree revision (a folder)');
        if (byContent && !isCount(op.expectContentVersion, 1)) return invalid('a delete\'s content version is malformed');
        if (bySubtree && !isCount(op.expectSubtreeRev, 0)) return invalid('a delete\'s subtree revision is malformed');
        out.push({
          given: byContent
            ? { op: 'delete', fileId: op.fileId as string, expectContentVersion: op.expectContentVersion as number }
            : { op: 'delete', fileId: op.fileId as string, expectSubtreeRev: op.expectSubtreeRev as number },
          target: null,
        });
        break;
      }
      case 'undelete': {
        if (!isCount(op.expectVersion, 1)) return invalid('an undelete names no version it expects');
        out.push({ given: { op: 'undelete', fileId: op.fileId as string, expectVersion: op.expectVersion }, target: null });
        break;
      }
      default:
        return invalid('an operation is not one of create / update / move / delete / undelete');
    }
  }
  return ok(out);
}

function checkPrincipal(p: unknown): string | null {
  if (typeof p !== 'object' || p === null) return 'the request names no principal';
  const principal = p as Record<string, unknown>;
  if (!PRINCIPAL_KINDS.includes(principal.kind as WfsPrincipalKind)) return 'the principal kind is unknown';
  if (typeof principal.id !== 'string' || principal.id.length === 0) return 'the principal has no id';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The tree helpers (linear scans: this is the reference; the Postgres store answers the same questions from indexes).
// ---------------------------------------------------------------------------------------------------------------------------

function liveByKey(entries: ReadonlyMap<WfsFileId, WfsEntry>, key: string, except: WfsFileId | null): WfsEntry | undefined {
  for (const e of entries.values()) if (!e.deleted && e.pathKey === key && e.fileId !== except) return e;
  return undefined;
}

function parentIsLiveDir(entries: ReadonlyMap<WfsFileId, WfsEntry>, path: string): boolean {
  const parent = wfsParentPath(path);
  if (parent === null) return true;
  const p = liveByKey(entries, wfsPathKey(parent), null);
  return p !== undefined && p.kind === 'dir';
}

/** The latest revision at which the folder or anything beneath it (tombstones included) changed: a folder delete's precondition. */
export function wfsSubtreeRev(entries: ReadonlyMap<WfsFileId, WfsEntry>, dir: WfsEntry): number {
  let rev = dir.updatedRev;
  for (const e of entries.values()) if (wfsIsBeneath(e.pathKey, dir.pathKey) && e.updatedRev > rev) rev = e.updatedRev;
  return rev;
}

// ---------------------------------------------------------------------------------------------------------------------------
// One op against the scratch tree. Each returns null (applied, or a harmless no-op) or the failure it was refused for.
// ---------------------------------------------------------------------------------------------------------------------------

type Failure = Omit<WfsOpFailure, 'opIndex'>;
const failure = (kind: WfsOpFailure['kind'], fileId: WfsFileId | null, path: string | null, detail: string): Failure => ({ kind, fileId, path, detail });

function applyCreate(t: Map<WfsFileId, WfsEntry>, given: WfsOp & { op: 'create' }, target: WfsPath, rev: number, fileId: WfsFileId): Failure | null {
  if (liveByKey(t, target.key, null) !== undefined) return failure('path_taken', null, target.path, 'something already exists at this path');
  if (!parentIsLiveDir(t, target.path)) return failure('parent_missing', null, target.path, 'its folder does not exist');
  t.set(fileId, {
    fileId,
    kind: given.kind,
    path: target.path,
    pathKey: target.key,
    sha256: given.kind === 'file' ? (given.sha256 as WfsSha256) : null,
    size: given.kind === 'file' ? (given.size as number) : null,
    deleted: false,
    version: 1,
    contentVersion: 1,
    pathVersion: 1,
    createdRev: rev,
    updatedRev: rev,
  });
  return null;
}

function applyUpdate(t: Map<WfsFileId, WfsEntry>, given: WfsOp & { op: 'update' }, rev: number): Failure | null {
  const e = t.get(given.fileId);
  if (e === undefined) return failure('missing', given.fileId, null, 'no such file on this branch');
  if (e.deleted) return failure('edit_deleted', e.fileId, e.path, 'the file was deleted');
  if (e.kind !== 'file') return failure('kind_mismatch', e.fileId, e.path, 'a folder has no content to update');
  if (e.contentVersion !== given.expectContentVersion) return failure('content', e.fileId, e.path, `the file changed (version ${e.contentVersion}, expected ${given.expectContentVersion})`);
  if (e.sha256 === given.sha256 && e.size === given.size) return null;
  t.set(e.fileId, { ...e, sha256: given.sha256, size: given.size, version: e.version + 1, contentVersion: e.contentVersion + 1, updatedRev: rev });
  return null;
}

function applyMove(t: Map<WfsFileId, WfsEntry>, given: WfsOp & { op: 'move' }, target: WfsPath, rev: number): Failure | null {
  const e = t.get(given.fileId);
  if (e === undefined) return failure('missing', given.fileId, null, 'no such file on this branch');
  if (e.deleted) return failure('edit_deleted', e.fileId, e.path, 'the file was deleted');
  if (e.pathVersion !== given.expectPathVersion) return failure('move_move', e.fileId, e.path, `it was moved (path version ${e.pathVersion}, expected ${given.expectPathVersion})`);
  if (target.path === e.path) return null;
  if (liveByKey(t, target.key, e.fileId) !== undefined) return failure('path_taken', e.fileId, target.path, 'something already exists at the new path');
  if (e.kind === 'dir' && wfsIsBeneath(target.key, e.pathKey)) return failure('cycle', e.fileId, target.path, 'a folder cannot move into itself');
  if (!parentIsLiveDir(t, target.path)) return failure('parent_missing', e.fileId, target.path, 'the new folder does not exist');
  const descendants = e.kind === 'dir' ? [...t.values()].filter((d) => !d.deleted && wfsIsBeneath(d.pathKey, e.pathKey)) : [];
  const fromDepth = e.path.split('/').length;
  const moved = descendants.map((d) => ({ d, path: wfsRebase(d.path, fromDepth, target.components) }));
  const tooLong = moved.find((m) => m.path.length > WFS_MAX_PATH_CHARS);
  if (tooLong !== undefined) return failure('path_too_long', tooLong.d.fileId, tooLong.d.path, `a file inside would pass ${WFS_MAX_PATH_CHARS} characters`);
  t.set(e.fileId, { ...e, path: target.path, pathKey: target.key, version: e.version + 1, pathVersion: e.pathVersion + 1, updatedRev: rev });
  for (const m of moved) t.set(m.d.fileId, { ...m.d, path: m.path, pathKey: wfsPathKey(m.path), version: m.d.version + 1, pathVersion: m.d.pathVersion + 1, updatedRev: rev });
  return null;
}

function applyDelete(t: Map<WfsFileId, WfsEntry>, given: WfsOp & { op: 'delete' }, rev: number): Failure | null {
  const e = t.get(given.fileId);
  if (e === undefined) return failure('missing', given.fileId, null, 'no such file on this branch');
  if (e.deleted) return null; // already gone: two people deleting the same thing agree
  if (e.kind === 'file') {
    if (given.expectContentVersion === undefined) return failure('kind_mismatch', e.fileId, e.path, 'a file delete names its content version');
    if (e.contentVersion !== given.expectContentVersion) return failure('delete_edited', e.fileId, e.path, `the file changed (version ${e.contentVersion}, expected ${given.expectContentVersion})`);
    t.set(e.fileId, { ...e, deleted: true, version: e.version + 1, updatedRev: rev });
    return null;
  }
  if (given.expectSubtreeRev === undefined) return failure('kind_mismatch', e.fileId, e.path, 'a folder delete names its subtree revision');
  const subtree = wfsSubtreeRev(t, e);
  if (subtree > given.expectSubtreeRev) return failure('delete_edited', e.fileId, e.path, `something in the folder changed at revision ${subtree}`);
  for (const d of [...t.values()]) {
    if (!d.deleted && (d.fileId === e.fileId || wfsIsBeneath(d.pathKey, e.pathKey))) t.set(d.fileId, { ...d, deleted: true, version: d.version + 1, updatedRev: rev });
  }
  return null;
}

function applyUndelete(t: Map<WfsFileId, WfsEntry>, given: WfsOp & { op: 'undelete' }, rev: number): Failure | null {
  const e = t.get(given.fileId);
  if (e === undefined) return failure('missing', given.fileId, null, 'no such file on this branch');
  if (!e.deleted) return null; // already back
  if (e.version !== given.expectVersion) return failure('content', e.fileId, e.path, `it changed (version ${e.version}, expected ${given.expectVersion})`);
  if (liveByKey(t, e.pathKey, e.fileId) !== undefined) return failure('path_taken', e.fileId, e.path, 'something else now exists at its path');
  if (!parentIsLiveDir(t, e.path)) return failure('parent_missing', e.fileId, e.path, 'its folder does not exist');
  t.set(e.fileId, { ...e, deleted: false, version: e.version + 1, updatedRev: rev });
  return null;
}

/**
 * One file of a merge-back (§6.5, D-6), judged aspect by aspect against the target's counters at the fork:
 *   - content the branch changed conflicts only with content the target changed (`content`);
 *   - a path the branch changed conflicts only with a path the target changed (`move_move`);
 *   - an edit or move on the branch conflicts with a deletion on the target (`edit_deleted`);
 *   - a deletion on the branch conflicts with ANY change on the target (`delete_edited`): deleting what someone else just
 *     changed must be a human's choice, never a merge's.
 */
function applyMergePut(t: Map<WfsFileId, WfsEntry>, put: WfsMergePut, rev: number): Failure | null {
  const cur = t.get(put.fileId);
  const c = put.changes;
  if (put.base === null) {
    if (cur !== undefined) return failure('content', put.fileId, cur.path, 'the target already holds this file id');
    if (c.path === undefined) return failure('invariant', put.fileId, null, 'a new file carries no path');
    t.set(put.fileId, {
      fileId: put.fileId,
      kind: put.kind,
      path: c.path,
      pathKey: wfsPathKey(c.path),
      sha256: put.kind === 'file' ? (c.content?.sha256 ?? null) : null,
      size: put.kind === 'file' ? (c.content?.size ?? null) : null,
      deleted: false,
      version: 1,
      contentVersion: 1,
      pathVersion: 1,
      createdRev: rev,
      updatedRev: rev,
    });
    return null;
  }
  const base = put.base;
  if (cur === undefined) return failure('missing', put.fileId, c.path ?? null, 'the target no longer holds this file');
  const targetDeleted = cur.deleted && !base.deleted;
  if (c.deleted === true) {
    if (cur.version !== base.version) return failure('delete_edited', cur.fileId, cur.path, 'the branch deletes a file the target changed since the fork');
  } else if (c.deleted === false) {
    if (cur.version !== base.version) return failure('content', cur.fileId, cur.path, 'the branch restores a file the target changed since the fork');
  } else if (targetDeleted && (c.content !== undefined || c.path !== undefined)) {
    return failure('edit_deleted', cur.fileId, cur.path, 'the target deleted this file since the fork');
  }
  if (c.content !== undefined && cur.contentVersion !== base.contentVersion) {
    return failure('content', cur.fileId, cur.path, `the target changed this file's content since the fork (version ${cur.contentVersion}, fork ${base.contentVersion})`);
  }
  if (c.path !== undefined && cur.pathVersion !== base.pathVersion) {
    return failure('move_move', cur.fileId, cur.path, 'the target moved this file since the fork');
  }
  const contentChanges = c.content !== undefined && (c.content.sha256 !== cur.sha256 || c.content.size !== cur.size);
  const pathChanges = c.path !== undefined && c.path !== cur.path;
  const deletionChanges = c.deleted !== undefined && c.deleted !== cur.deleted;
  if (!contentChanges && !pathChanges && !deletionChanges) return null;
  t.set(cur.fileId, {
    ...cur,
    ...(contentChanges ? { sha256: c.content!.sha256, size: c.content!.size, contentVersion: cur.contentVersion + 1 } : {}),
    ...(pathChanges ? { path: c.path!, pathKey: wfsPathKey(c.path!), pathVersion: cur.pathVersion + 1 } : {}),
    ...(deletionChanges ? { deleted: c.deleted! } : {}),
    version: cur.version + 1,
    updatedRev: rev,
  });
  return null;
}

/** The whole-tree check after every op applied (§6.6 uniqueness, explicit parents). Merge-back relies on it; ops should never reach it. */
function treeInvariantFailures(t: ReadonlyMap<WfsFileId, WfsEntry>, opIndex: number): WfsOpFailure[] {
  const out: WfsOpFailure[] = [];
  const seen = new Map<string, WfsEntry>();
  for (const e of t.values()) {
    if (e.deleted) continue;
    const other = seen.get(e.pathKey);
    if (other !== undefined) out.push({ opIndex, kind: 'path_taken', fileId: e.fileId, path: e.path, detail: `the same path as ${other.fileId}` });
    seen.set(e.pathKey, e);
  }
  for (const e of t.values()) {
    if (!e.deleted && !parentIsLiveDir(t, e.path)) out.push({ opIndex, kind: 'parent_missing', fileId: e.fileId, path: e.path, detail: 'its folder does not exist' });
  }
  return out;
}

function usage(t: ReadonlyMap<WfsFileId, WfsEntry>): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const e of t.values()) {
    if (!e.deleted && e.kind === 'file') {
      files += 1;
      bytes += e.size ?? 0;
    }
  }
  return { files, bytes };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The one way a branch changes.
// ---------------------------------------------------------------------------------------------------------------------------

interface CommitInput {
  readonly requestId: string;
  readonly payloadHash: string;
  readonly baseRev: number;
  readonly principal: WfsPrincipal;
  readonly resolvesConflictId: WfsConflictId | null;
  readonly mergesBranchId: WfsBranchId | null;
  readonly carriedCommitHashes: readonly string[];
  readonly approvedBy: string | null;
}

type Step = { readonly kind: 'op'; readonly op: CheckedOp } | { readonly kind: 'merge'; readonly put: WfsMergePut };

function commitSteps(project: WfsProjectState, branch: WfsBranchState, steps: readonly Step[], input: CommitInput, ctx: WfsEngineContext): RelayResult<WfsApplied> {
  const rev = branch.headRev + 1;
  const t = new Map(branch.entries);
  const failures: WfsOpFailure[] = [];
  const recorded: WfsRecordedOp[] = [];
  steps.forEach((step, opIndex) => {
    let f: Failure | null;
    if (step.kind === 'merge') {
      f = applyMergePut(t, step.put, rev);
      recorded.push(step.put);
    } else {
      const { given, target } = step.op;
      switch (given.op) {
        case 'create': {
          const fileId = ctx.newId('file');
          f = applyCreate(t, given, target as WfsPath, rev, fileId);
          recorded.push(f === null ? { ...given, assignedFileId: fileId } : given);
          break;
        }
        case 'update':
          f = applyUpdate(t, given, rev);
          recorded.push(given);
          break;
        case 'move':
          f = applyMove(t, given, target as WfsPath, rev);
          recorded.push(given);
          break;
        case 'delete':
          f = applyDelete(t, given, rev);
          recorded.push(given);
          break;
        case 'undelete':
          f = applyUndelete(t, given, rev);
          recorded.push(given);
          break;
      }
    }
    if (f !== null) failures.push({ opIndex, ...f });
  });
  if (failures.length === 0) failures.push(...treeInvariantFailures(t, -1));

  if (failures.length > 0) {
    // INV-2: refuse ATOMICALLY and keep the whole changeset, as given, with its author.
    const conflictId = ctx.newId('conflict');
    const asGiven = recorded.map((r) => {
      if (r.op !== 'create' || r.assignedFileId === undefined) return r;
      const { assignedFileId: _dropped, ...given } = r;
      return given;
    });
    const conflict: WfsConflict = {
      conflictId,
      branchId: branch.branchId,
      requestId: input.requestId,
      ops: asGiven,
      failures,
      principal: input.principal,
      baseRev: input.baseRev,
      headRevAtRefusal: branch.headRev,
      atIso: ctx.nowIso,
      mergesBranchId: input.mergesBranchId,
      status: 'open',
      resolvedByCommitId: null,
    };
    const outcome: WfsCommitOutcome = { status: 'conflict', branchId: branch.branchId, conflictId, failures, headRev: branch.headRev, replay: false };
    return ok({
      project: {
        ...project,
        conflicts: new Map(project.conflicts).set(conflictId, conflict),
        requests: new Map(project.requests).set(input.requestId, { payloadHash: input.payloadHash, outcome }),
      },
      outcome,
    });
  }

  // §11: scale is limited. A commit that would GROW a project past a limit is refused (nothing changes; the client keeps it).
  const before = usage(branch.entries);
  const after = usage(t);
  if ((after.files > ctx.limits.maxFiles && after.files > before.files) || (after.bytes > ctx.limits.maxProjectBytes && after.bytes > before.bytes)) {
    return fail(relayError('budget-exceeded', 'This project is full: delete something, or keep this change for later.', {
      details: [`wonderfs: files ${after.files}/${ctx.limits.maxFiles}, bytes ${after.bytes}/${ctx.limits.maxProjectBytes}`],
    }));
  }

  const touched = [...t.values()]
    .filter((e) => branch.entries.get(e.fileId)?.version !== e.version)
    .sort((a, b) => (a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0));
  const body: Omit<WfsCommit, 'commitHash'> = {
    projectId: project.projectId,
    branchId: branch.branchId,
    rev,
    commitId: ctx.newId('commit'),
    requestId: input.requestId,
    prevCommitHash: branch.headCommitHash,
    principal: input.principal,
    baseRev: input.baseRev,
    atIso: ctx.nowIso,
    ops: recorded,
    touched,
    resolvesConflictId: input.resolvesConflictId,
    mergesBranchId: input.mergesBranchId,
    carriedCommitHashes: input.carriedCommitHashes,
    approvedBy: input.approvedBy,
  };
  const commit: WfsCommit = { ...body, commitHash: ctx.sha256Hex(wfsCommitHashInput(body)) };
  const nextBranch: WfsBranchState = { ...branch, headRev: rev, headCommitHash: commit.commitHash, entries: t, commits: [...branch.commits, commit] };
  const conflicts = new Map(project.conflicts);
  if (input.resolvesConflictId !== null) {
    const c = conflicts.get(input.resolvesConflictId) as WfsConflict;
    conflicts.set(c.conflictId, { ...c, status: 'resolved', resolvedByCommitId: commit.commitId });
  }
  const outcome: WfsCommitOutcome = { status: 'committed', branchId: branch.branchId, rev, commitId: commit.commitId, commitHash: commit.commitHash, replay: false };
  return ok({
    project: {
      ...project,
      branches: new Map(project.branches).set(branch.branchId, nextBranch),
      conflicts,
      requests: new Map(project.requests).set(input.requestId, { payloadHash: input.payloadHash, outcome }),
    },
    outcome,
  });
}

/** INV-8: the stored answer for a request id, or a refusal when the id is reused for something else. `null` = new. */
function replayed(project: WfsProjectState, requestId: string, payloadHash: string): RelayResult<WfsApplied> | null {
  const prior = project.requests.get(requestId);
  if (prior === undefined) return null;
  if (prior.payloadHash !== payloadHash) {
    return fail(relayError('duplicate-idempotency-key', 'That request id was already used for a different change.', { details: ['wonderfs: request id reused with another payload'] }));
  }
  return ok({ project, outcome: { ...prior.outcome, replay: true } });
}

function openBranch(project: WfsProjectState, branchId: unknown): RelayResult<WfsBranchState> {
  const branch = typeof branchId === 'string' ? project.branches.get(branchId) : undefined;
  if (branch === undefined) return fail(relayError('not-found', 'No such branch in this project.', { details: ['wonderfs: unknown branch'] }));
  if (branch.closed !== null) return fail(relayError('immutable', 'That branch is closed.', { details: [`wonderfs: branch ${branch.closed.how}`] }));
  return ok(branch);
}

/** Apply one commit request (§6.2). The ONLY way a principal changes a branch. */
export function applyWfsCommit(project: WfsProjectState, req: WfsCommitRequest, ctx: WfsEngineContext): RelayResult<WfsApplied> {
  if (typeof req.requestId !== 'string' || !REQUEST_ID_RE.test(req.requestId)) return invalid('the request id is malformed');
  const badPrincipal = checkPrincipal(req.principal);
  if (badPrincipal !== null) return invalid(badPrincipal);
  const resolves = req.resolvesConflictId ?? null;
  const payloadHash = ctx.sha256Hex(canonicalJson({ kind: 'commit', branchId: req.branchId, baseRev: req.baseRev, ops: req.ops, principal: req.principal, resolvesConflictId: resolves }));
  const prior = replayed(project, req.requestId, payloadHash);
  if (prior !== null) return prior;

  if (!isCount(req.baseRev, 0)) return invalid('the base revision is malformed');
  const branch = openBranch(project, req.branchId);
  if (!branch.ok) return branch;
  if (resolves !== null) {
    const c = project.conflicts.get(resolves);
    if (c === undefined || c.branchId !== branch.value.branchId) return fail(relayError('not-found', 'No such conflict on this branch.', { details: ['wonderfs: unknown conflict'] }));
    if (c.status !== 'open') return fail(relayError('immutable', 'That conflict is already resolved.', { details: ['wonderfs: conflict resolved'] }));
  }
  const checked = checkOps(req.ops, resolves !== null, ctx);
  if (!checked.ok) return checked;
  return commitSteps(project, branch.value, checked.value.map((op) => ({ kind: 'op' as const, op })), {
    requestId: req.requestId,
    payloadHash,
    baseRev: req.baseRev,
    principal: req.principal,
    resolvesConflictId: resolves,
    mergesBranchId: null,
    carriedCommitHashes: [],
    approvedBy: null,
  }, ctx);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Branches (§6.5).
// ---------------------------------------------------------------------------------------------------------------------------

export function forkWfsBranch(project: WfsProjectState, input: { readonly fromBranchId: WfsBranchId; readonly owner: WfsPrincipal }, ctx: WfsEngineContext): RelayResult<{ readonly project: WfsProjectState; readonly branchId: WfsBranchId }> {
  const badOwner = checkPrincipal(input.owner);
  if (badOwner !== null) return invalid(badOwner);
  const from = openBranch(project, input.fromBranchId);
  if (!from.ok) return from;
  const branchId = ctx.newId('branch');
  if (project.branches.has(branchId)) return invalid('the branch id generator repeated an id');
  const branch: WfsBranchState = {
    branchId,
    kind: 'agent',
    parent: { branchId: from.value.branchId, forkRev: from.value.headRev },
    owner: input.owner,
    headRev: 0,
    headCommitHash: null,
    entries: new Map(from.value.entries),
    base: new Map(from.value.entries),
    commits: [],
    closed: null,
  };
  return ok({ project: { ...project, branches: new Map(project.branches).set(branchId, branch) }, branchId });
}

/**
 * Merge an agent branch into the branch it forked from: ONE atomic commit there (§6.5). Every file the branch changed must
 * still be at the target's fork-time version; otherwise nothing applies, a conflict naming the branch is kept, and the branch
 * stays open and intact. On success the branch closes as merged and the merge commit carries the branch's commit hashes.
 */
export function mergeBackWfsBranch(
  project: WfsProjectState,
  input: { readonly requestId: string; readonly branchId: WfsBranchId; readonly principal: WfsPrincipal; readonly approvedBy: string | null },
  ctx: WfsEngineContext,
): RelayResult<WfsApplied> {
  if (typeof input.requestId !== 'string' || !REQUEST_ID_RE.test(input.requestId)) return invalid('the request id is malformed');
  const badPrincipal = checkPrincipal(input.principal);
  if (badPrincipal !== null) return invalid(badPrincipal);
  const payloadHash = ctx.sha256Hex(canonicalJson({ kind: 'merge', branchId: input.branchId, principal: input.principal, approvedBy: input.approvedBy }));
  const prior = replayed(project, input.requestId, payloadHash);
  if (prior !== null) return prior;

  const branch = openBranch(project, input.branchId);
  if (!branch.ok) return branch;
  const b = branch.value;
  if (b.kind !== 'agent' || b.parent === null) return invalid('only an agent branch merges back');
  const target = openBranch(project, b.parent.branchId);
  if (!target.ok) return target;

  const puts: WfsMergePut[] = [];
  for (const e of b.entries.values()) {
    const base = b.base.get(e.fileId);
    if (base === undefined) {
      if (e.deleted) continue; // made and removed on the branch: nothing to bring back
      puts.push({
        op: 'merge_put',
        fileId: e.fileId,
        kind: e.kind,
        base: null,
        changes: e.kind === 'file' ? { path: e.path, content: { sha256: e.sha256, size: e.size } } : { path: e.path },
      });
      continue;
    }
    if (base.version === e.version) continue;
    const content = e.sha256 !== base.sha256 || e.size !== base.size ? { sha256: e.sha256, size: e.size } : undefined;
    const path = e.path !== base.path ? e.path : undefined;
    const deleted = e.deleted !== base.deleted ? e.deleted : undefined;
    if (content === undefined && path === undefined && deleted === undefined) continue; // e.g. deleted and restored: back where it was
    puts.push({
      op: 'merge_put',
      fileId: e.fileId,
      kind: e.kind,
      base: { version: base.version, contentVersion: base.contentVersion, pathVersion: base.pathVersion, deleted: base.deleted },
      changes: { ...(content !== undefined ? { content } : {}), ...(path !== undefined ? { path } : {}), ...(deleted !== undefined ? { deleted } : {}) },
    });
  }
  puts.sort((x, y) => (x.fileId < y.fileId ? -1 : x.fileId > y.fileId ? 1 : 0));

  const applied = commitSteps(project, target.value, puts.map((put) => ({ kind: 'merge' as const, put })), {
    requestId: input.requestId,
    payloadHash,
    baseRev: b.parent.forkRev,
    principal: input.principal,
    resolvesConflictId: null,
    mergesBranchId: b.branchId,
    carriedCommitHashes: b.commits.map((c) => c.commitHash),
    approvedBy: input.approvedBy,
  }, ctx);
  if (!applied.ok || applied.value.outcome.status !== 'committed') return applied;
  const merged = applied.value;
  const closed: WfsBranchState = { ...b, closed: { how: 'merged', atIso: ctx.nowIso, targetRev: merged.outcome.status === 'committed' ? merged.outcome.rev : null } };
  return ok({ project: { ...merged.project, branches: new Map(merged.project.branches).set(b.branchId, closed) }, outcome: merged.outcome });
}

/** Close an agent branch without merging. Its commits stay in history (an agent's work is never silently deleted either). */
export function discardWfsBranch(project: WfsProjectState, branchId: WfsBranchId, nowIso: string): RelayResult<WfsProjectState> {
  const branch = openBranch(project, branchId);
  if (!branch.ok) return branch;
  if (branch.value.kind !== 'agent') return invalid('main is never discarded');
  return ok({ ...project, branches: new Map(project.branches).set(branchId, { ...branch.value, closed: { how: 'discarded', atIso: nowIso, targetRev: null } }) });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reads (§6.1, §7).
// ---------------------------------------------------------------------------------------------------------------------------

/** Every entry (tombstones included) as it stood at `rev`, rebuilt from the base and the commits: the history is the truth. */
export function wfsEntriesAt(branch: WfsBranchState, rev: number = branch.headRev): Map<WfsFileId, WfsEntry> {
  const at = new Map(branch.base);
  for (const c of branch.commits) {
    if (c.rev > rev) break;
    for (const e of c.touched) at.set(e.fileId, e);
  }
  return at;
}

/** The live tree at `rev` (default: head), ordered by path key. */
export function wfsTreeAt(branch: WfsBranchState, rev: number = branch.headRev): WfsEntry[] {
  return [...wfsEntriesAt(branch, rev).values()].filter((e) => !e.deleted).sort((a, b) => (a.pathKey < b.pathKey ? -1 : a.pathKey > b.pathKey ? 1 : 0));
}

/** The change feed's page: commits after `afterRev`, gapless and in order (§7). */
export function wfsChangesAfter(branch: WfsBranchState, afterRev: number, limit: number): { readonly commits: readonly WfsCommit[]; readonly headRev: number } {
  const from = Math.max(0, Math.min(afterRev, branch.headRev));
  return { commits: branch.commits.slice(from, from + Math.max(0, limit)), headRev: branch.headRev };
}
