/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 1
 * Shared four-status domain model (PURE, browser-safe, deterministic).
 *
 * The foundational rule this module enforces:
 *
 *   execution completed ≠ outcome satisfied ≠ verification complete ≠ release
 *   authorized
 *
 * Four INDEPENDENT status dimensions travel together but never collapse into a
 * single ambiguous "complete". Every mutation flows through a validated
 * transition that either returns the next status + an append-only event, or a
 * structured error that preserves the previous state byte-for-byte.
 *
 * No React, no network, no storage, no provider dependencies. Later milestones
 * (Mission Command Protocol, execution capsules, trace ledger, economics,
 * multiplayer) consume this model — see docs/relay/MISSION_STATUS_MODEL.md.
 */

/* ----------------------------------------------------------- status types */

export type AqualaExecutionStatus =
  | 'not_started'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AqualaMissionOutcomeStatus = 'unknown' | 'partial' | 'satisfied' | 'violated';

export type AqualaVerificationStatus =
  | 'unverified'
  | 'reviewing'
  | 'changes_required'
  | 'approved'
  | 'verified';

export type AqualaReleaseStatus =
  | 'not_eligible'
  | 'human_approval_required'
  | 'eligible'
  | 'released'
  | 'rolled_back';

export interface AqualaOutcomeStatus {
  executionStatus: AqualaExecutionStatus;
  outcomeStatus: AqualaMissionOutcomeStatus;
  verificationStatus: AqualaVerificationStatus;
  releaseStatus: AqualaReleaseStatus;
}

export type AqualaStatusDimension = 'execution' | 'outcome' | 'verification' | 'release';

export type AqualaActorType = 'user' | 'relay' | 'agent' | 'reviewer' | 'system';

/* ------------------------------------------------------- canonical initial */

/** The ONE canonical starting point. No component may invent its own. */
export function createInitialAqualaOutcomeStatus(): AqualaOutcomeStatus {
  return {
    executionStatus: 'not_started',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  };
}

/* ----------------------------------------------------------- event model */

export interface AqualaStatusTransitionEvent {
  readonly eventId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly taskId?: string;
  readonly dimension: AqualaStatusDimension;
  readonly previousStatus: string;
  readonly nextStatus: string;
  readonly reason: string;
  readonly actorId: string;
  readonly actorType: AqualaActorType;
  readonly missionRevision: number;
  readonly artifactRevision?: string;
  readonly occurredAt: string;
}

/** A request to move ONE dimension. The domain validates it against the
    per-dimension table and the cross-dimension invariants before accepting. */
export interface AqualaStatusTransitionRequest {
  dimension: AqualaStatusDimension;
  nextStatus: string;
  reason: string;
  actorId: string;
  actorType: AqualaActorType;
  eventId: string;
  projectId: string;
  missionId: string;
  taskId?: string;
  missionRevision: number;
  /** The artifact revision the actor's decision refers to. Present for
      artifact-bound dimensions (verification/release). */
  artifactRevision?: string;
  /** The mission's CURRENT artifact revision, when the caller knows it.
      Supplying it lets the domain reject a stale review at apply time
      (approving revision A while the mission is on revision B). When omitted
      the decision revision is assumed current — reconstruction still detects
      staleness via its own context. */
  currentArtifactRevision?: string;
  occurredAt: string;
  /** Deterministic release policy — governs eligible/released gating only. */
  policy?: AqualaReleasePolicy;
}

/* ----------------------------------------------------------- error model */

export type AqualaStatusTransitionErrorCode =
  | 'INVALID_EXECUTION_TRANSITION'
  | 'INVALID_OUTCOME_TRANSITION'
  | 'INVALID_VERIFICATION_TRANSITION'
  | 'INVALID_RELEASE_TRANSITION'
  | 'CROSS_DIMENSION_INVARIANT_VIOLATION'
  | 'STALE_ARTIFACT_REVIEW'
  | 'RELEASE_NOT_ELIGIBLE'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'REVISION_MISMATCH'
  | 'UNKNOWN_STATUS';

export interface AqualaStatusTransitionError {
  code: AqualaStatusTransitionErrorCode;
  dimension: AqualaStatusDimension;
  previousStatus: string;
  requestedStatus: string;
  reason: string;
  /** True when a human (founder/authorized approver) must act to proceed. */
  humanActionRequired: boolean;
}

export type StatusTransitionResult =
  | { ok: true; status: AqualaOutcomeStatus; event: AqualaStatusTransitionEvent }
  | { ok: false; status: AqualaOutcomeStatus; error: AqualaStatusTransitionError };

function fail(
  status: AqualaOutcomeStatus,
  code: AqualaStatusTransitionErrorCode,
  dimension: AqualaStatusDimension,
  previousStatus: string,
  requestedStatus: string,
  reason: string,
  humanActionRequired = false,
): StatusTransitionResult {
  return {
    ok: false,
    status,
    error: { code, dimension, previousStatus, requestedStatus, reason, humanActionRequired },
  };
}

/* ------------------------------------------------- per-dimension tables */

const EXECUTION_TRANSITIONS: Record<AqualaExecutionStatus, readonly AqualaExecutionStatus[]> = {
  not_started: ['starting', 'running'],
  starting: ['running', 'failed', 'cancelled'],
  running: ['waiting', 'completed', 'failed', 'cancelled'],
  waiting: ['running', 'completed', 'failed', 'cancelled'],
  // Terminal process states never silently resume.
  completed: [],
  failed: [],
  cancelled: [],
};

const OUTCOME_TRANSITIONS: Record<AqualaMissionOutcomeStatus, readonly AqualaMissionOutcomeStatus[]> = {
  unknown: ['partial', 'satisfied', 'violated'],
  partial: ['satisfied', 'violated'],
  // A later artifact / new evidence may invalidate a satisfied outcome.
  satisfied: ['violated', 'partial'],
  violated: [],
};

const VERIFICATION_TRANSITIONS: Record<AqualaVerificationStatus, readonly AqualaVerificationStatus[]> = {
  unverified: ['reviewing'],
  reviewing: ['changes_required', 'approved'],
  changes_required: ['reviewing'],
  approved: ['verified', 'unverified', 'reviewing'],
  // A new artifact revision may make an old verification stale.
  verified: ['unverified', 'reviewing'],
};

const RELEASE_TRANSITIONS: Record<AqualaReleaseStatus, readonly AqualaReleaseStatus[]> = {
  not_eligible: ['human_approval_required', 'eligible'],
  human_approval_required: ['eligible', 'not_eligible'],
  eligible: ['released', 'not_eligible', 'human_approval_required'],
  released: ['rolled_back'],
  // A fresh authorized release after rollback is an explicit later operation,
  // never an undocumented rolled_back → released jump.
  rolled_back: ['not_eligible'],
};

const EXECUTION_STATES = Object.keys(EXECUTION_TRANSITIONS) as AqualaExecutionStatus[];
const OUTCOME_STATES = Object.keys(OUTCOME_TRANSITIONS) as AqualaMissionOutcomeStatus[];
const VERIFICATION_STATES = Object.keys(VERIFICATION_TRANSITIONS) as AqualaVerificationStatus[];
const RELEASE_STATES = Object.keys(RELEASE_TRANSITIONS) as AqualaReleaseStatus[];

export const AQUALA_STATUS_VALUES = {
  execution: EXECUTION_STATES,
  outcome: OUTCOME_STATES,
  verification: VERIFICATION_STATES,
  release: RELEASE_STATES,
} as const;

const isMember = <T extends string>(all: readonly T[], v: string): v is T =>
  (all as readonly string[]).includes(v);

/* --------------------------------------------- per-dimension validators */

export interface DimensionValidation {
  ok: boolean;
  reason: string;
}

const ok = (): DimensionValidation => ({ ok: true, reason: 'valid transition' });
const no = (reason: string): DimensionValidation => ({ ok: false, reason });

export function validateExecutionTransition(
  previous: AqualaExecutionStatus,
  next: AqualaExecutionStatus,
): DimensionValidation {
  if (previous === next) return no('no-op execution transition');
  return EXECUTION_TRANSITIONS[previous].includes(next)
    ? ok()
    : no(`execution ${previous} → ${next} is not permitted`);
}

export function validateOutcomeTransition(
  previous: AqualaMissionOutcomeStatus,
  next: AqualaMissionOutcomeStatus,
): DimensionValidation {
  if (previous === next) return no('no-op outcome transition');
  return OUTCOME_TRANSITIONS[previous].includes(next)
    ? ok()
    : no(`outcome ${previous} → ${next} is not permitted`);
}

export function validateVerificationTransition(
  previous: AqualaVerificationStatus,
  next: AqualaVerificationStatus,
): DimensionValidation {
  if (previous === next) return no('no-op verification transition');
  return VERIFICATION_TRANSITIONS[previous].includes(next)
    ? ok()
    : no(`verification ${previous} → ${next} is not permitted`);
}

export function validateReleaseTransition(
  previous: AqualaReleaseStatus,
  next: AqualaReleaseStatus,
): DimensionValidation {
  if (previous === next) return no('no-op release transition');
  return RELEASE_TRANSITIONS[previous].includes(next)
    ? ok()
    : no(`release ${previous} → ${next} is not permitted`);
}

/* ------------------------------------------------- release policy config */

/** Deterministic release-eligibility policy — NOT a general policy engine.
    Governs what `eligible` (and therefore `released`) requires. */
export interface AqualaReleasePolicy {
  requireOutcomeSatisfied: boolean;
  requireVerificationVerified: boolean;
  requireHumanApproval: boolean;
}

export const DEFAULT_RELEASE_POLICY: AqualaReleasePolicy = {
  requireOutcomeSatisfied: true,
  requireVerificationVerified: true,
  requireHumanApproval: true,
};

export interface ReleaseEligibility {
  /** Technical gates (outcome/verification) are satisfied. */
  gatesMet: boolean;
  /** A human must still approve before release even though gates are met. */
  humanApprovalRequired: boolean;
  /** Concise reasons any gate is unmet (empty when gatesMet). */
  unmet: string[];
}

/** Pure derivation of release eligibility from the current status + policy.
    Never mutates; callers decide whether to request a release transition. */
export function deriveReleaseEligibility(
  status: AqualaOutcomeStatus,
  policy: AqualaReleasePolicy = DEFAULT_RELEASE_POLICY,
): ReleaseEligibility {
  const unmet: string[] = [];
  if (policy.requireOutcomeSatisfied && status.outcomeStatus !== 'satisfied') {
    unmet.push('outcome is not satisfied');
  }
  if (policy.requireVerificationVerified && status.verificationStatus !== 'verified') {
    unmet.push('verification is not verified');
  }
  // Hard blockers regardless of policy toggles.
  if (status.verificationStatus === 'changes_required') unmet.push('review requires changes');
  if (status.outcomeStatus === 'violated') unmet.push('outcome is violated');
  const gatesMet = unmet.length === 0;
  return { gatesMet, humanApprovalRequired: gatesMet && policy.requireHumanApproval, unmet };
}

/* ------------------------------------------- cross-dimension invariants */

export interface CrossDimensionContext {
  /** Revision the reviewer approval/verification refers to. */
  reviewedArtifactRevision?: string;
  /** The mission's current artifact revision. */
  currentArtifactRevision?: string;
  policy?: AqualaReleasePolicy;
}

/**
 * Guards combinations the per-dimension tables cannot see. Returns the first
 * violated invariant, or null when the proposed status is coherent.
 */
export function validateCrossDimensionInvariants(
  current: AqualaOutcomeStatus,
  proposed: AqualaOutcomeStatus,
  context: CrossDimensionContext = {},
): AqualaStatusTransitionError | null {
  const policy = context.policy ?? DEFAULT_RELEASE_POLICY;

  // 7 + 8: a blocked review or violated outcome forces release to not_eligible.
  if (
    (proposed.verificationStatus === 'changes_required' || proposed.outcomeStatus === 'violated') &&
    proposed.releaseStatus !== 'not_eligible' &&
    proposed.releaseStatus !== 'rolled_back'
  ) {
    return {
      code: 'CROSS_DIMENSION_INVARIANT_VIOLATION',
      dimension: 'release',
      previousStatus: current.releaseStatus,
      requestedStatus: proposed.releaseStatus,
      reason:
        proposed.outcomeStatus === 'violated'
          ? 'a violated outcome forces release to not_eligible'
          : 'changes_required forces release to not_eligible',
      humanActionRequired: false,
    };
  }

  // 11 + 13: a verification DECISION into approved/verified must reference
  // the CURRENT artifact. Binds only when the verification dimension is the
  // one transitioning — a standing approved/verified status must not reject
  // unrelated execution/outcome/release events (those are not artifact-bound
  // decisions and legitimately omit artifactRevision).
  const bindsArtifact =
    (proposed.verificationStatus === 'approved' || proposed.verificationStatus === 'verified') &&
    proposed.verificationStatus !== current.verificationStatus;
  if (
    bindsArtifact &&
    context.currentArtifactRevision !== undefined &&
    context.reviewedArtifactRevision !== context.currentArtifactRevision
  ) {
    return {
      code: 'STALE_ARTIFACT_REVIEW',
      dimension: 'verification',
      previousStatus: current.verificationStatus,
      requestedStatus: proposed.verificationStatus,
      reason: 'reviewer decision does not reference the current artifact revision',
      humanActionRequired: false,
    };
  }

  // 6: release eligible requires configured verification/outcome gates met.
  if (proposed.releaseStatus === 'eligible') {
    const elig = deriveReleaseEligibility(proposed, policy);
    if (!elig.gatesMet) {
      return {
        code: 'RELEASE_NOT_ELIGIBLE',
        dimension: 'release',
        previousStatus: current.releaseStatus,
        requestedStatus: 'eligible',
        reason: `release gates unmet: ${elig.unmet.join('; ')}`,
        humanActionRequired: false,
      };
    }
  }

  // Human approval can only be REQUESTED once the technical gates are met —
  // the state means "everything passed; a human decides", never "nothing has
  // run yet". Checked only when the release dimension transitions into it.
  if (
    proposed.releaseStatus === 'human_approval_required' &&
    current.releaseStatus !== 'human_approval_required'
  ) {
    const elig = deriveReleaseEligibility(proposed, policy);
    if (!elig.gatesMet) {
      return {
        code: 'RELEASE_NOT_ELIGIBLE',
        dimension: 'release',
        previousStatus: current.releaseStatus,
        requestedStatus: 'human_approval_required',
        reason: `human approval cannot be requested before release gates are met: ${elig.unmet.join('; ')}`,
        humanActionRequired: false,
      };
    }
  }

  // 5: released requires eligibility immediately before release, and blocks a
  // direct jump when human approval is still required by policy. Checked only
  // when the release dimension is the one transitioning into released — a
  // standing released status must never wedge later execution/outcome/
  // verification facts (rollback exists for reversal, not for bookkeeping).
  if (proposed.releaseStatus === 'released' && current.releaseStatus !== 'released') {
    const elig = deriveReleaseEligibility(proposed, policy);
    if (!elig.gatesMet) {
      return {
        code: 'RELEASE_NOT_ELIGIBLE',
        dimension: 'release',
        previousStatus: current.releaseStatus,
        requestedStatus: 'released',
        reason: `cannot release before eligibility: ${elig.unmet.join('; ')}`,
        humanActionRequired: false,
      };
    }
    if (current.releaseStatus !== 'eligible') {
      return {
        code: 'RELEASE_NOT_ELIGIBLE',
        dimension: 'release',
        previousStatus: current.releaseStatus,
        requestedStatus: 'released',
        reason: 'release requires the eligible state immediately before releasing',
        humanActionRequired: policy.requireHumanApproval,
      };
    }
  }

  return null;
}

/* ------------------------------------------------- apply one transition */

function applyDimension(
  status: AqualaOutcomeStatus,
  dimension: AqualaStatusDimension,
  next: string,
): { status?: AqualaOutcomeStatus; validation: DimensionValidation; unknown?: boolean } {
  switch (dimension) {
    case 'execution': {
      if (!isMember(EXECUTION_STATES, next)) return { validation: no('unknown execution status'), unknown: true };
      const v = validateExecutionTransition(status.executionStatus, next);
      return { validation: v, status: v.ok ? { ...status, executionStatus: next } : undefined };
    }
    case 'outcome': {
      if (!isMember(OUTCOME_STATES, next)) return { validation: no('unknown outcome status'), unknown: true };
      const v = validateOutcomeTransition(status.outcomeStatus, next);
      return { validation: v, status: v.ok ? { ...status, outcomeStatus: next } : undefined };
    }
    case 'verification': {
      if (!isMember(VERIFICATION_STATES, next)) return { validation: no('unknown verification status'), unknown: true };
      const v = validateVerificationTransition(status.verificationStatus, next);
      return { validation: v, status: v.ok ? { ...status, verificationStatus: next } : undefined };
    }
    case 'release': {
      if (!isMember(RELEASE_STATES, next)) return { validation: no('unknown release status'), unknown: true };
      const v = validateReleaseTransition(status.releaseStatus, next);
      return { validation: v, status: v.ok ? { ...status, releaseStatus: next } : undefined };
    }
    default:
      // Unreachable through the types, but persisted/forged events can carry
      // any string at runtime — fail structurally, never with a TypeError.
      return { validation: no('unknown status dimension'), unknown: true };
  }
}

const INVALID_CODE: Record<AqualaStatusDimension, AqualaStatusTransitionErrorCode> = {
  execution: 'INVALID_EXECUTION_TRANSITION',
  outcome: 'INVALID_OUTCOME_TRANSITION',
  verification: 'INVALID_VERIFICATION_TRANSITION',
  release: 'INVALID_RELEASE_TRANSITION',
};

function previousOf(status: AqualaOutcomeStatus, dimension: AqualaStatusDimension): string {
  return dimension === 'execution'
    ? status.executionStatus
    : dimension === 'outcome'
      ? status.outcomeStatus
      : dimension === 'verification'
        ? status.verificationStatus
        : status.releaseStatus;
}

/**
 * The single authorized mutation path. On success returns the next status and
 * exactly one append-only event. On any failure the ORIGINAL status is
 * returned untouched alongside a structured error.
 */
export function applyStatusTransition(
  current: AqualaOutcomeStatus,
  request: AqualaStatusTransitionRequest,
): StatusTransitionResult {
  const previousStatus = previousOf(current, request.dimension);

  const step = applyDimension(current, request.dimension, request.nextStatus);
  if (step.unknown) {
    return fail(current, 'UNKNOWN_STATUS', request.dimension, previousStatus, request.nextStatus, step.validation.reason);
  }
  if (!step.validation.ok || !step.status) {
    return fail(current, INVALID_CODE[request.dimension], request.dimension, previousStatus, request.nextStatus, step.validation.reason);
  }

  const invariant = validateCrossDimensionInvariants(current, step.status, {
    reviewedArtifactRevision: request.artifactRevision,
    currentArtifactRevision: request.currentArtifactRevision ?? request.artifactRevision,
    policy: request.policy,
  });
  if (invariant) {
    return { ok: false, status: current, error: invariant };
  }

  const event: AqualaStatusTransitionEvent = Object.freeze({
    eventId: request.eventId,
    projectId: request.projectId,
    missionId: request.missionId,
    taskId: request.taskId,
    dimension: request.dimension,
    previousStatus,
    nextStatus: request.nextStatus,
    reason: request.reason,
    actorId: request.actorId,
    actorType: request.actorType,
    missionRevision: request.missionRevision,
    artifactRevision: request.artifactRevision,
    occurredAt: request.occurredAt,
  });
  return { ok: true, status: step.status, event };
}

/* ----------------------------------------------------- reconstruction */

export interface ReconstructContext {
  /** The mission's current artifact revision, used to detect stale reviews. */
  currentArtifactRevision?: string;
  policy?: AqualaReleasePolicy;
}

export type ReconstructResult =
  | { ok: true; status: AqualaOutcomeStatus }
  | { ok: false; status: AqualaOutcomeStatus; failedIndex: number; error: AqualaStatusTransitionError };

/**
 * Deterministically fold an ordered event stream into a final status. The
 * input array is never mutated. Fails on the FIRST invalid event, reporting
 * its index — previousStatus mismatch, backward revision, illegal transition,
 * cross-dimension violation, or stale-artifact approval.
 */
export function reconstructStatusFromEvents(
  initial: AqualaOutcomeStatus,
  events: readonly AqualaStatusTransitionEvent[],
  context: ReconstructContext = {},
): ReconstructResult {
  let status: AqualaOutcomeStatus = { ...initial };
  let lastRevision = -Infinity;

  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];

    if (e.missionRevision < lastRevision) {
      return {
        ok: false,
        status,
        failedIndex: i,
        error: {
          code: 'REVISION_MISMATCH',
          dimension: e.dimension,
          previousStatus: previousOf(status, e.dimension),
          requestedStatus: e.nextStatus,
          reason: `mission revision moved backward (${e.missionRevision} < ${lastRevision})`,
          humanActionRequired: false,
        },
      };
    }

    const expectedPrevious = previousOf(status, e.dimension);
    if (e.previousStatus !== expectedPrevious) {
      return {
        ok: false,
        status,
        failedIndex: i,
        error: {
          code: 'REVISION_MISMATCH',
          dimension: e.dimension,
          previousStatus: expectedPrevious,
          requestedStatus: e.nextStatus,
          reason: `event previousStatus "${e.previousStatus}" does not match reconstructed "${expectedPrevious}"`,
          humanActionRequired: false,
        },
      };
    }

    const step = applyDimension(status, e.dimension, e.nextStatus);
    if (step.unknown || !step.validation.ok || !step.status) {
      return {
        ok: false,
        status,
        failedIndex: i,
        error: {
          code: step.unknown ? 'UNKNOWN_STATUS' : INVALID_CODE[e.dimension],
          dimension: e.dimension,
          previousStatus: expectedPrevious,
          requestedStatus: e.nextStatus,
          reason: step.validation.reason,
          humanActionRequired: false,
        },
      };
    }

    const invariant = validateCrossDimensionInvariants(status, step.status, {
      reviewedArtifactRevision: e.artifactRevision,
      currentArtifactRevision: context.currentArtifactRevision ?? e.artifactRevision,
      policy: context.policy,
    });
    if (invariant) {
      return { ok: false, status, failedIndex: i, error: invariant };
    }

    status = step.status;
    lastRevision = e.missionRevision;
  }

  return { ok: true, status };
}
