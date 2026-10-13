/**
 * WONDERFS — the file environment under every Project Avatar (founder, 2026-10-10: mandatory, always on, no setting).
 *
 * The shapes this domain speaks. The contract they implement is `_qa_handoff/wonderfs/WONDERFS_CONTRACT.r0.md` (a DRAFT
 * until r1 is frozen by both lanes); section numbers in comments (§n) point there.
 *
 * Pure domain: no Node, no network, no clock (time is an injected ISO string), no randomness (ids come from an injected
 * generator), no hashing library (an injected sha256 of a string). Persistence and transport bind to it from outside.
 */

/** Server-issued, opaque. */
export type WfsProjectId = string;
export type WfsBranchId = string;
/** Stable across renames and moves (§2). */
export type WfsFileId = string;
export type WfsCommitId = string;
export type WfsConflictId = string;
/** 64 lowercase hex characters: the sha256 of a blob's exact bytes. */
export type WfsSha256 = string;

export type WfsPrincipalKind = 'human' | 'julius' | 'imported_agent' | 'clone' | 'service';

/**
 * WHO acted, recorded on every commit (§9.2). `onBehalfOf` is the human a non-human acts for; `grantId` the grant it acted
 * under. Unknown is `null`, never a default.
 */
export interface WfsPrincipal {
  readonly kind: WfsPrincipalKind;
  readonly id: string;
  readonly onBehalfOf: string | null;
  readonly grantId: string | null;
  readonly sessionId: string | null;
  /** The client's WLBUILD identity, when a game client acted. */
  readonly clientBuild: string | null;
  readonly tool: string | null;
  readonly missionId: string | null;
  readonly attemptId: string | null;
}

export type WfsEntryKind = 'file' | 'dir';

/**
 * One file or directory at one revision. A deletion is a TOMBSTONE (`deleted: true`), kept in history (§5).
 *
 * Three counters, each answering one question (§6.3):
 *   - `version`: anything changed (the strongest precondition; merge-back and undelete use it);
 *   - `contentVersion`: the bytes changed (update and delete use it, so a concurrent MOVE never stales an edit);
 *   - `pathVersion`: the path changed (move uses it, so a concurrent EDIT never stales a move).
 */
export interface WfsEntry {
  readonly fileId: WfsFileId;
  readonly kind: WfsEntryKind;
  /** The normalized display path (§6.6). */
  readonly path: string;
  /** The case-insensitive uniqueness key of `path` (§6.6). */
  readonly pathKey: string;
  /** `null` for a directory. */
  readonly sha256: WfsSha256 | null;
  /** `null` for a directory. */
  readonly size: number | null;
  readonly deleted: boolean;
  readonly version: number;
  readonly contentVersion: number;
  readonly pathVersion: number;
  readonly createdRev: number;
  readonly updatedRev: number;
}

/** The operations a principal may send (§6.2). Every one carries the precondition it is judged by. */
export type WfsOp =
  | { readonly op: 'create'; readonly path: string; readonly kind: WfsEntryKind; readonly sha256?: WfsSha256; readonly size?: number }
  | { readonly op: 'update'; readonly fileId: WfsFileId; readonly expectContentVersion: number; readonly sha256: WfsSha256; readonly size: number }
  | { readonly op: 'move'; readonly fileId: WfsFileId; readonly expectPathVersion: number; readonly newPath: string }
  /** A file is judged by `expectContentVersion`; a directory by `expectSubtreeRev` (any change beneath it since). */
  | { readonly op: 'delete'; readonly fileId: WfsFileId; readonly expectContentVersion?: number; readonly expectSubtreeRev?: number }
  | { readonly op: 'undelete'; readonly fileId: WfsFileId; readonly expectVersion: number };

/** What merge-back writes (§6.5). Never accepted from a caller: only `mergeBack` produces it. */
export interface WfsMergePut {
  readonly op: 'merge_put';
  readonly fileId: WfsFileId;
  /** The target's `version` of this file at the fork; 0 = the file did not exist there. */
  readonly expectVersion: number;
  readonly state: {
    readonly kind: WfsEntryKind;
    readonly path: string;
    readonly sha256: WfsSha256 | null;
    readonly size: number | null;
    readonly deleted: boolean;
  };
}

/** An op as RECORDED in a commit: a `create` carries the file id the server gave it. */
export type WfsRecordedOp = (WfsOp & { readonly assignedFileId?: WfsFileId }) | WfsMergePut;

/** Why a precondition failed (§6.4). */
export type WfsFailureKind =
  | 'content' // the bytes (or, for undelete / merge, the whole entry) changed since the author saw them
  | 'edit_deleted' // an update / move of a file that is now deleted
  | 'delete_edited' // a delete of something that changed (for a directory: anything beneath it) since the author saw it
  | 'move_move' // a move of a file someone else moved
  | 'path_taken' // the target path is occupied (case-insensitively)
  | 'parent_missing' // the target's parent directory does not exist (or is a file)
  | 'cycle' // a directory moved into itself
  | 'missing' // no such file on this branch
  | 'kind_mismatch' // an update of a directory, or a directory precondition on a file
  | 'path_too_long' // a directory move would push a descendant past the path limit
  | 'invariant'; // the final tree check refused the result (defence in depth: nothing per-op should reach it)

export interface WfsOpFailure {
  readonly opIndex: number;
  readonly kind: WfsFailureKind;
  readonly fileId: WfsFileId | null;
  readonly path: string | null;
  readonly detail: string;
}

/** A commit request (§6.2). `requestId` makes it idempotent (INV-8). */
export interface WfsCommitRequest {
  readonly requestId: string;
  readonly branchId: WfsBranchId;
  /** The revision the author saw. Recorded; correctness rests on the per-op preconditions, not on this. */
  readonly baseRev: number;
  readonly ops: readonly WfsOp[];
  readonly principal: WfsPrincipal;
  /** A commit that closes a conflict (§6.4). With no ops, it records a dismissal. */
  readonly resolvesConflictId?: WfsConflictId | null;
}

/** One immutable, hash-chained commit (§9.2). */
export interface WfsCommit {
  readonly projectId: WfsProjectId;
  readonly branchId: WfsBranchId;
  readonly rev: number;
  readonly commitId: WfsCommitId;
  readonly requestId: string;
  readonly prevCommitHash: string | null;
  readonly commitHash: string;
  readonly principal: WfsPrincipal;
  readonly baseRev: number;
  readonly atIso: string;
  readonly ops: readonly WfsRecordedOp[];
  /** The post-state of every entry this commit changed, ordered by file id. The feed carries these (§7). */
  readonly touched: readonly WfsEntry[];
  readonly resolvesConflictId: WfsConflictId | null;
  readonly mergesBranchId: WfsBranchId | null;
  /** The merged branch's commit hashes, in order (§6.5). */
  readonly carriedCommitHashes: readonly string[];
  readonly approvedBy: string | null;
}

/** A refused changeset, preserved whole with its author (INV-2). */
export interface WfsConflict {
  readonly conflictId: WfsConflictId;
  readonly branchId: WfsBranchId;
  readonly requestId: string;
  readonly ops: readonly WfsRecordedOp[];
  readonly failures: readonly WfsOpFailure[];
  readonly principal: WfsPrincipal;
  readonly baseRev: number;
  readonly headRevAtRefusal: number;
  readonly atIso: string;
  readonly mergesBranchId: WfsBranchId | null;
  readonly status: 'open' | 'resolved';
  readonly resolvedByCommitId: WfsCommitId | null;
}

export type WfsCommitOutcome =
  | { readonly status: 'committed'; readonly branchId: WfsBranchId; readonly rev: number; readonly commitId: WfsCommitId; readonly commitHash: string; readonly replay: boolean }
  | { readonly status: 'conflict'; readonly branchId: WfsBranchId; readonly conflictId: WfsConflictId; readonly failures: readonly WfsOpFailure[]; readonly headRev: number; readonly replay: boolean };

/** Alpha limits (§11). Scale is limited; integrity never is. */
export interface WfsLimits {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxProjectBytes: number;
  readonly maxOpsPerCommit: number;
}

export const WFS_ALPHA_LIMITS: WfsLimits = {
  maxFileBytes: 64 * 1024 * 1024,
  maxFiles: 10_000,
  maxProjectBytes: 2 * 1024 * 1024 * 1024,
  maxOpsPerCommit: 2_000,
};
