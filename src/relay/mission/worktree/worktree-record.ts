import { digestOf } from '../durable/durable-digest';
import {
  MISSION_BRANCH_PREFIX,
  MISSION_WORKTREE_STATES,
  PROTECTED_BRANCH_NAMES,
  SUPPORTED_WORKTREE_SCHEMA_VERSIONS,
  WORKTREE_LEASE_MS,
  WORKTREE_SCHEMA_VERSION,
  type MissionWorktreeRecord,
  type MissionWorktreeRecordDraft,
  type WorktreeOwnerLease,
} from './worktree-contracts';

/**
 * Sealing, validation and safe-name derivation for the mission-worktree
 * record. Pure — no git, no filesystem, no clock.
 *
 * The checksum reuses `digestOf` from the durable module rather than adding
 * a second hash implementation, so a record written by the CLI verifies
 * byte-identically in the browser.
 */

/* ------------------------------------------------------- branch naming */

/**
 * Derive the mission branch. The mission id is SANITIZED, not trusted: a
 * value like `--upload-pack=evil` or `../../main` cannot become a git option
 * or escape the namespace, because everything outside `[A-Za-z0-9._-]` is
 * removed before the prefix is applied.
 */
export function deriveMissionBranch(missionId: string): { ok: true; branch: string } | { ok: false; reason: string } {
  if (typeof missionId !== 'string') return { ok: false, reason: 'Mission id must be a string.' };
  const token = missionId.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[-.]+/, '').slice(0, 60);
  if (token.length === 0) {
    return { ok: false, reason: 'Mission id yields no safe branch token.' };
  }
  return validateMissionBranch(`${MISSION_BRANCH_PREFIX}${token}`);
}

/**
 * Validate a mission branch name. Rejects git-option injection, traversal,
 * refspec tricks, and — critically — any protected branch, so a Coding Agent
 * can never be handed `main`.
 */
export function validateMissionBranch(
  branch: string,
): { ok: true; branch: string } | { ok: false; reason: string } {
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 120) {
    return { ok: false, reason: 'Branch name must be 1–120 characters.' };
  }
  if (!branch.startsWith(MISSION_BRANCH_PREFIX)) {
    return { ok: false, reason: `Mission branches must begin with ${MISSION_BRANCH_PREFIX}.` };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
    return { ok: false, reason: 'Branch name contains rejected characters.' };
  }
  if (
    branch.includes('..') || branch.includes('//') || branch.includes('@{') ||
    branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock') ||
    branch.split('/').some((seg) =>
      seg === '' || seg === '.' || seg === '..' || seg.startsWith('-') || seg.endsWith('.lock'))
  ) {
    return { ok: false, reason: 'Branch name shape is rejected.' };
  }
  const leaf = branch.slice(MISSION_BRANCH_PREFIX.length);
  if (PROTECTED_BRANCH_NAMES.some((p) => p.toLowerCase() === leaf.toLowerCase())) {
    return { ok: false, reason: `"${leaf}" is a protected branch name and may never be a mission branch.` };
  }
  if (PROTECTED_BRANCH_NAMES.some((p) => p.toLowerCase() === branch.toLowerCase())) {
    return { ok: false, reason: 'A protected branch may never be a mission branch.' };
  }
  return { ok: true, branch };
}

/** Safe single path segment. Used for the per-repository and per-mission
    directory names, so neither can traverse or collide by accident. */
export function safeWorktreeSegment(
  raw: string,
): { ok: true; segment: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'Segment must be a string.' };
  const token = raw.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[.]+/, '').slice(0, 64);
  if (token === '' || token === '.' || token === '..') {
    return { ok: false, reason: `"${raw}" yields no safe path segment.` };
  }
  return { ok: true, segment: token };
}

/* -------------------------------------------------------------- leases */

export function claimWorktreeLease(sessionId: string, now: string): WorktreeOwnerLease {
  return {
    sessionId,
    claimedAt: now,
    expiresAt: new Date(Date.parse(now) + WORKTREE_LEASE_MS).toISOString(),
  };
}

/** May this session act on the record? An expired foreign lease may be
    taken over; a live foreign lease may not. */
export function worktreeLeaseAllows(
  record: MissionWorktreeRecord | null,
  sessionId: string,
  now: string,
): boolean {
  if (record === null || record.owner === null) return true;
  if (record.owner.sessionId === sessionId) return true;
  const expires = Date.parse(record.owner.expiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(expires) || !Number.isFinite(current)) return true;
  return expires <= current;
}

/* ------------------------------------------------------------- sealing */

export function sealWorktreeRecord(
  draft: MissionWorktreeRecordDraft | MissionWorktreeRecord,
): MissionWorktreeRecord {
  const { checksum: _stale, ...rest } = draft as MissionWorktreeRecord;
  return { ...rest, checksum: digestOf(rest) };
}

/** Continue from a stored record without carrying its stale checksum. */
export function worktreeDraftFrom(record: MissionWorktreeRecord): MissionWorktreeRecordDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export function verifyWorktreeChecksum(record: MissionWorktreeRecord): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestOf(rest) === checksum;
}

/* ---------------------------------------------------------- validation */

export type WorktreeReadResult =
  | { readonly ok: true; readonly record: MissionWorktreeRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

function structurallyValid(value: unknown): value is MissionWorktreeRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const nonEmpty = (k: string): boolean => typeof v[k] === 'string' && (v[k] as string).length > 0;
  if (!['worktreeRef', 'missionId', 'projectId', 'repositoryName', 'repositoryRoot'].every(nonEmpty)) return false;
  if (!['baseBranch', 'baseCommit', 'missionBranch', 'worktreePath', 'createdAt', 'expectedHead'].every(nonEmpty)) return false;
  if (!MISSION_WORKTREE_STATES.includes(v.state as never)) return false;
  if (v.dirty !== null && typeof v.dirty !== 'boolean') return false;
  if (v.actualHead !== null && typeof v.actualHead !== 'string') return false;
  if (typeof v.cleanupEligible !== 'boolean' || typeof v.archived !== 'boolean') return false;
  if (!Array.isArray(v.cleanupBlockers) || !Array.isArray(v.validationFindings)) return false;
  if (!Array.isArray(v.evidenceRefs)) return false;
  if (v.provenance !== 'live' && v.provenance !== 'simulated') return false;
  if (typeof v.checksum !== 'string') return false;
  return true;
}

/** The only way stored bytes become a trusted record: version, then shape,
    then checksum. No failure is ever converted into "no worktree". */
export function readWorktreeRecord(raw: unknown): WorktreeReadResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'not_found' };
  if (typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored value is not an object' };
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'missing schema version' };
  }
  if (!(SUPPORTED_WORKTREE_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false,
      reason: 'unsupported_version',
      detail: `worktree record schema ${version} is not readable by this build (writes ${WORKTREE_SCHEMA_VERSION})`,
    };
  }
  if (!structurallyValid(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'record shape is not a mission worktree record' };
  }
  if (!verifyWorktreeChecksum(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'checksum does not match record contents' };
  }
  return { ok: true, record: raw };
}
