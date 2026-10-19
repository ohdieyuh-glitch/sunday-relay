/**
 * THE CANONICAL MISSION-WORKTREE RECORD.
 *
 * Sunday Relay already has a real isolated-worktree lifecycle
 * (`src/relay/workspace/`): it creates a `git worktree` at a pinned revision
 * on a Relay-owned branch, verifies the result, and refuses to touch the
 * source. What it did NOT have is memory — the registry lived in a `Map`
 * that died with the process, keyed by run rather than by mission.
 *
 * This record is that memory: one small, versioned, checksummed shape that
 * survives a restart and is REFERENCED (never duplicated) by durable mission
 * persistence, the Coding Agent Environment, recovery, the website and the
 * CLI. It is pure domain — no Node, no git, no clock — so the browser can
 * read a record the CLI wrote and reach the same conclusions.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: credentials, environment values, the
 * founder's home directory, or raw git output. `repositoryName` is a name,
 * not a path; the absolute worktree path is stored for Node's use and is
 * abbreviated by the projection before any surface renders it.
 */

export const WORKTREE_SCHEMA_V1 = 'relay-mission-worktree.v1' as const;
export const WORKTREE_SCHEMA_VERSION = WORKTREE_SCHEMA_V1;
export const SUPPORTED_WORKTREE_SCHEMA_VERSIONS = [WORKTREE_SCHEMA_V1] as const;
export type WorktreeSchemaVersion = (typeof SUPPORTED_WORKTREE_SCHEMA_VERSIONS)[number];

/**
 * Worktree lifecycle states. These are the CUSTOMER-facing states of one
 * mission's workspace; `WORKSPACE_STATUSES` in `src/relay/workspace` remains
 * the Node service's own vocabulary for a run, and the two are mapped
 * explicitly rather than merged.
 */
export const MISSION_WORKTREE_STATES = [
  'proposed',
  'creating',
  'ready',
  'active',
  'paused',
  'requires_inspection',
  'conflicted',
  'missing',
  'archived',
  'cleanup_ready',
  'cleanup_blocked',
  'removed',
] as const;
export type MissionWorktreeState = (typeof MISSION_WORKTREE_STATES)[number];

/** States in which a Coding Agent may be given the worktree at all. */
export const USABLE_WORKTREE_STATES: readonly MissionWorktreeState[] = ['ready', 'active'];

/** States that must be shown to the user until they act on them. */
export const BLOCKING_WORKTREE_STATES: readonly MissionWorktreeState[] = [
  'requires_inspection',
  'conflicted',
  'missing',
  'cleanup_blocked',
];

/** One thing validation checked, and what it found. */
export interface WorktreeValidationFinding {
  readonly check:
    | 'repository_exists'
    | 'directory_exists'
    | 'git_registration'
    | 'branch_matches'
    | 'head_matches'
    | 'ownership'
    | 'dirty_state'
    | 'active_process';
  readonly ok: boolean;
  /** Safe, human-readable. Never raw git output, never a credential. */
  readonly detail: string;
}

/** What Relay knows about a process using the worktree. `unknown` is a real
    answer after a restart, and it blocks destructive cleanup. */
export const WORKTREE_PROCESS_STATES = ['none', 'active', 'unknown', 'disconnected'] as const;
export type WorktreeProcessState = (typeof WORKTREE_PROCESS_STATES)[number];

export interface MissionWorktreeRecord {
  readonly schemaVersion: WorktreeSchemaVersion;
  /**
   * Stable identity, and the value written into the durable mission record's
   * `environmentRef`. Format: `worktree:<projectId>:<missionId>`.
   */
  readonly worktreeRef: string;
  readonly missionId: string;
  readonly projectId: string;
  /** Repository NAME — never a path containing a home directory. */
  readonly repositoryName: string;
  /** Absolute canonical repository root. Node-only; abbreviated for display. */
  readonly repositoryRoot: string;
  readonly baseBranch: string;
  readonly baseCommit: string;
  readonly missionBranch: string;
  /** Absolute canonical worktree path. Abbreviated before it is displayed. */
  readonly worktreePath: string;
  readonly state: MissionWorktreeState;
  readonly createdAt: string;
  readonly lastValidatedAt: string | null;
  /** The session that owns this worktree, with a lease expiry. */
  readonly owner: WorktreeOwnerLease | null;
  /** The commit Relay expects HEAD to be at. */
  readonly expectedHead: string;
  /** HEAD as actually observed at the last validation. `null` = never seen. */
  readonly actualHead: string | null;
  /** `null` when Relay has not looked — never assumed clean. */
  readonly dirty: boolean | null;
  readonly processState: WorktreeProcessState;
  readonly cleanupEligible: boolean;
  /** Exactly why cleanup is unsafe, when it is. */
  readonly cleanupBlockers: readonly string[];
  readonly archived: boolean;
  readonly interruptionReason: string | null;
  readonly validationFindings: readonly WorktreeValidationFinding[];
  /** Evidence identifiers — trace entries and capsules are REFERENCED. */
  readonly evidenceRefs: readonly string[];
  readonly provenance: 'live' | 'simulated';
  readonly checksum: string;
}

export interface WorktreeOwnerLease {
  readonly sessionId: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
}

export type MissionWorktreeRecordDraft = Omit<MissionWorktreeRecord, 'checksum'>;

/** How long an ownership claim stays valid without renewal. */
export const WORKTREE_LEASE_MS = 60_000;

/* --------------------------------------------------------------- naming */

/** The Relay-owned mission branch namespace. Never `main`, never a
    production branch — `validateMissionBranch` enforces both. */
export const MISSION_BRANCH_PREFIX = 'relay/mission/';

/** Branch names Relay must never adopt as a mission branch, whatever the
    mission id sanitizes to. */
export const PROTECTED_BRANCH_NAMES: readonly string[] = [
  'main', 'master', 'production', 'release', 'develop', 'trunk', 'HEAD',
];

export const worktreeRefFor = (projectId: string, missionId: string): string =>
  `worktree:${projectId}:${missionId}`;
