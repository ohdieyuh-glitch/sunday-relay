/**
 * MISSION WORKTREES — the canonical record, its store, safe naming and the
 * one projection both surfaces render. Pure domain: no git, no Node, no
 * clock. The Node lifecycle that actually runs `git worktree` lives in
 * `src/relay/workspace/`, which the browser may never import.
 */
export {
  BLOCKING_WORKTREE_STATES,
  MISSION_BRANCH_PREFIX,
  MISSION_WORKTREE_STATES,
  PROTECTED_BRANCH_NAMES,
  SUPPORTED_WORKTREE_SCHEMA_VERSIONS,
  USABLE_WORKTREE_STATES,
  WORKTREE_LEASE_MS,
  WORKTREE_PROCESS_STATES,
  WORKTREE_SCHEMA_V1,
  WORKTREE_SCHEMA_VERSION,
  worktreeRefFor,
} from './worktree-contracts';
export type {
  MissionWorktreeRecord,
  MissionWorktreeRecordDraft,
  MissionWorktreeState,
  WorktreeOwnerLease,
  WorktreeProcessState,
  WorktreeSchemaVersion,
  WorktreeValidationFinding,
} from './worktree-contracts';
export {
  claimWorktreeLease,
  deriveMissionBranch,
  readWorktreeRecord,
  safeWorktreeSegment,
  sealWorktreeRecord,
  validateMissionBranch,
  verifyWorktreeChecksum,
  worktreeDraftFrom,
  worktreeLeaseAllows,
} from './worktree-record';
export type { WorktreeReadResult } from './worktree-record';
export { createMissionWorktreeStore } from './worktree-store';
export type { MissionWorktreeStorePort, WorktreeWriteResult } from './worktree-store';
export {
  NO_WORKTREE_LABEL,
  WORKTREE_OFFLINE_LABEL,
  WORKTREE_SIMULATED_LABEL,
  WORKTREE_STATE_LABEL,
  WORKTREE_UNAVAILABLE_LABEL,
  abbreviateWorktreePath,
  projectMissionWorktree,
  renderWorktreeStatusLines,
} from './worktree-projection';
export type { MissionWorktreeView, WorktreeProjectionOptions } from './worktree-projection';
