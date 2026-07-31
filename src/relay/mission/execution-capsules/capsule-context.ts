/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Responsibility binding, captured input context, permission snapshot, and
 * workspace binding (PURE).
 *
 * What a run was RESPONSIBLE for — and under which revisions, handoff, policy,
 * passport, permissions, and workspace — is fixed when the capsule is prepared
 * and never drifts afterwards. A later mission or task revision does not
 * quietly re-point an old capsule: it needs a new run (Milestone 2 `retry` /
 * `reassign` boundary), so an old report always stays attributable to the
 * revision the agent actually received.
 *
 * Reuse, not reinvention: the permission snapshot is the Milestone 2
 * `CommandPermissionContext` shape (the command domain already validates
 * against it), and the workspace binding references the canonical
 * `RelayWorkspace` id + pinned source revision rather than copying the
 * workspace record.
 */

import type {
  CommandPermissionContext,
  CommandWorkspaceContext,
} from '../commands/command-context';

/* ------------------------------------------------------ responsibility */

export const CAPSULE_RESPONSIBILITIES = [
  'implementation',
  'review',
  'repair',
  'architecture',
  'operations',
] as const;
export type CapsuleResponsibility = (typeof CAPSULE_RESPONSIBILITIES)[number];

/** Responsibilities that change files and therefore require a writable
    workspace binding. */
export const FILE_CHANGING_RESPONSIBILITIES: readonly CapsuleResponsibility[] = [
  'implementation',
  'repair',
];

/* --------------------------------------------- revision + policy binding */

/**
 * The immutable "what was this run answering to" block. Every field is fixed
 * at preparation; the service rejects any later change
 * (`RESPONSIBILITY_REVISION_MISMATCH`).
 */
export interface CapsuleResponsibilityBinding {
  readonly responsibility: CapsuleResponsibility;
  readonly missionRevision: number;
  readonly taskRevision: number;
  readonly handoffId: string;
  readonly handoffCompilerVersion: string;
  readonly policyPackVersion: string;
  readonly passportId: string;
  /** Whether policy waives the final-report requirement for completion. */
  readonly finalReportWaived: boolean;
}

/* ------------------------------------------------------- input context */

/**
 * REFERENCES to the inputs the agent received — not copies. The Project Brain
 * is referenced by revision, never embedded; private reasoning is never
 * captured; raw prompt retention is deliberately out of scope (it belongs to
 * PSP observability policy, Milestone 7).
 */
export interface CapsuleInputContext {
  readonly missionObjectiveRef: string;
  readonly taskResponsibilityRef: string;
  readonly projectBrainRevision: string;
  readonly bindingConstraintsRef: string;
  readonly filesInScope: readonly string[];
  readonly filesOutOfScope: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly requiredReportFormat: string;
  readonly reviewRequired: boolean;
  readonly maximumRepairAttempts: number;
  readonly networkPolicy: CommandPermissionContext['networkPolicy'];
  readonly productionWritesProhibited: boolean;
}

/* --------------------------------------------------- permission snapshot */

/**
 * The EFFECTIVE permissions at preparation time, plus the policy version they
 * came from. Secret VALUES are never present — `secretPolicy` records the
 * category only (the credential-handle model owns real secrets). Later
 * expansion or revocation does not rewrite this snapshot; it arrives as a
 * permission trace reference, so the capsule always shows which policy was
 * actually active while the run executed.
 */
export interface CapsulePermissionSnapshot {
  readonly permissionPolicyVersion: string;
  readonly capturedAt: string;
  readonly effective: CommandPermissionContext;
  /** Read-only runs (reviewers) hold no writable paths. */
  readonly readOnly: boolean;
  readonly approvalRequired: boolean;
}

export function createPermissionSnapshot(
  permissionPolicyVersion: string,
  capturedAt: string,
  effective: CommandPermissionContext,
  approvalRequired = false,
): CapsulePermissionSnapshot {
  return Object.freeze({
    permissionPolicyVersion,
    capturedAt,
    effective: Object.freeze({ ...effective }),
    readOnly: effective.writablePaths.length === 0,
    approvalRequired,
  });
}

/* ------------------------------------------------------ workspace binding */

/**
 * Binds a run to ONE workspace. `baseCommitSha` mirrors the canonical
 * `RelayWorkspace.sourceRevision` pin; `kind` keeps the CLI worktree and the
 * browser worktree structurally distinguishable so they can never be confused.
 * No real worktree is created, inspected, or transferred here — Ophiuchus
 * execution binding arrives in a later milestone.
 */
export interface CapsuleWorkspaceBinding {
  readonly workspaceId: string;
  readonly isolationMode: CommandWorkspaceContext['isolationMode'];
  readonly kind: CommandWorkspaceContext['kind'];
  readonly repositoryIdentity: string;
  readonly branchName: string;
  readonly baseCommitSha: string;
  readonly writeOwnerAgentId: string | null;
  /** True when this run may only read the workspace (reviewer capsules). */
  readonly readOnly: boolean;
  readonly protectedPaths: readonly string[];
  /** Reserved for the future Ophiuchus execution reference. */
  readonly ophiuchusExecutionRef?: string;
}

export function workspaceRequiredFor(responsibility: CapsuleResponsibility): boolean {
  return FILE_CHANGING_RESPONSIBILITIES.includes(responsibility);
}
