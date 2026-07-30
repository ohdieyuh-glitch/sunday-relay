/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 1
 * Compatibility adapter: existing Relay state → four-dimension Aquala status.
 *
 * The browser application (and the bridge behind it) predates the Mission
 * Operations status model. Its authoritative mission record is the coarse
 * `RelayMissionState` union in `src/relay/mission/wire-contracts.ts`, with the
 * coding-terminal status and the reviewer verdict alongside it. This module
 * maps that EXISTING state into `AqualaOutcomeStatus` without collapsing the
 * four dimensions and without inventing facts the old state never asserted:
 *
 *   - a submitted claim is NOT a satisfied outcome (claims are not evidence);
 *   - Relay verification / reviewer review both map to `reviewing` — the old
 *     state does not distinguish them finely enough to say more;
 *   - `verified_complete` derives its release dimension from the release
 *     POLICY (default: human approval required) — the legacy app never
 *     released anything, so the adapter never fabricates `released`.
 *
 * Every adapted status is REACHABLE: `legacyStatusTransitionPlan` returns the
 * ordered transition steps from the canonical initial status, and
 * `materializeLegacyStatusEvents` replays them through the real
 * `applyStatusTransition` engine, yielding a legitimate event history for an
 * older mission. Tests hold this for every legacy state.
 *
 * Type-only imports keep this module pure and browser-safe (no React, no
 * network, no storage).
 */

import type {
  CodingTerminalStatus,
  MissionReview,
  RelayMissionState,
} from '../wire-contracts';
import type { MissionStatus, MissionVerdict } from '../contracts';
import {
  applyStatusTransition,
  createInitialAqualaOutcomeStatus,
  deriveReleaseEligibility,
  DEFAULT_RELEASE_POLICY,
} from './status-model';
import type {
  AqualaActorType,
  AqualaExecutionStatus,
  AqualaMissionOutcomeStatus,
  AqualaOutcomeStatus,
  AqualaReleasePolicy,
  AqualaStatusDimension,
  AqualaStatusTransitionError,
  AqualaStatusTransitionEvent,
  AqualaVerificationStatus,
} from './status-model';

/* -------------------------------------------------------- plan model */

export interface LegacyStatusTransitionStep {
  dimension: AqualaStatusDimension;
  nextStatus: string;
  reason: string;
}

/** One canonical step. Reasons state what the LEGACY record asserted. */
const step = (
  dimension: AqualaStatusDimension,
  nextStatus: string,
  reason: string,
): LegacyStatusTransitionStep => ({ dimension, nextStatus, reason });

/* --------------------------------------- mission-state transition plans */

const START: LegacyStatusTransitionStep[] = [
  step('execution', 'starting', 'legacy record shows the mission was dispatched'),
  step('execution', 'running', 'legacy record shows the mission was in progress'),
];

/**
 * Ordered transition plans from the canonical initial status to the status a
 * legacy coarse state represents. The plan IS the mapping — the adapted
 * status is produced by replaying the plan through the real engine, so an
 * unreachable mapping cannot exist by construction.
 */
const MISSION_STATE_PLANS: Record<RelayMissionState, readonly LegacyStatusTransitionStep[]> = {
  // Settings confirmed / mission ready: nothing has executed, nothing is
  // known, nothing reviewed, nothing releasable — exactly the initial status.
  configured: [],
  ready: [],

  architect_working: [...START],
  handoff_ready: [
    ...START,
    step('execution', 'waiting', 'architect handoff produced; awaiting the coding agent'),
  ],
  coding: [...START],
  claim_submitted: [
    ...START,
    step('execution', 'waiting', 'coding agent submitted a CLAIM; outcome remains unproven'),
  ],
  relay_verifying: [
    ...START,
    step('execution', 'waiting', 'Relay is running independent verification'),
    step('verification', 'reviewing', 'Relay independent verification is under way'),
  ],
  reviewer_reviewing: [
    ...START,
    step('execution', 'waiting', 'independent reviewer is examining the artifact'),
    step('verification', 'reviewing', 'independent review is under way'),
  ],
  repair_required: [
    ...START,
    step('execution', 'waiting', 'review returned blocking findings'),
    step('verification', 'reviewing', 'review examined the artifact'),
    step('verification', 'changes_required', 'reviewer requires changes'),
    step('outcome', 'partial', 'some requirements failed review; work is repairable'),
  ],
  repair_in_progress: [
    ...START,
    step('execution', 'waiting', 'review returned blocking findings'),
    step('verification', 'reviewing', 'review examined the artifact'),
    step('verification', 'changes_required', 'reviewer requires changes'),
    step('outcome', 'partial', 'some requirements failed review; work is repairable'),
    step('execution', 'running', 'repair implementer is actively working'),
  ],
  re_verifying: [
    ...START,
    step('execution', 'waiting', 'review returned blocking findings'),
    step('verification', 'reviewing', 'review examined the artifact'),
    step('verification', 'changes_required', 'reviewer requires changes'),
    step('outcome', 'partial', 'some requirements failed review; work is repairable'),
    step('execution', 'running', 'repair implementer is actively working'),
    step('execution', 'waiting', 'repair submitted; re-verification under way'),
    step('verification', 'reviewing', 're-review of the repaired artifact is under way'),
  ],
  // Reviewer approval alone is NOT a confirmed outcome — the completion
  // authority still decides. Outcome `satisfied` is reserved for
  // verified_complete, matching the mission-layer verdict ladder.
  approved: [
    ...START,
    step('execution', 'completed', 'legacy mission finished its execution'),
    step('verification', 'reviewing', 'independent review examined the artifact'),
    step('verification', 'approved', 'independent reviewer approved the artifact'),
    step('outcome', 'partial', 'requirements passed review; completion authority not yet confirmed'),
  ],
  verified_complete: [
    ...START,
    step('execution', 'completed', 'legacy mission finished its execution'),
    step('verification', 'reviewing', 'independent review examined the artifact'),
    step('verification', 'approved', 'independent reviewer approved the artifact'),
    step('outcome', 'partial', 'requirements passed review; completion authority not yet confirmed'),
    step('outcome', 'satisfied', 'Relay completion authority confirmed the mission outcome'),
    step('verification', 'verified', 'Relay completion policy confirmed verification'),
    // Release is derived from policy below — appended in the plan builder.
  ],
  // Terminal legacy states do NOT assert that any role actively worked —
  // the coarse value also covers preflight/dispatch failures — so these
  // plans go starting → terminal without fabricating a running step.
  failed: [
    step('execution', 'starting', 'legacy mission was dispatched before it failed'),
    step(
      'execution',
      'failed',
      'legacy mission ended in a supported terminal failure; whether any role actively worked is not recorded',
    ),
  ],
  cancelled: [
    step('execution', 'starting', 'legacy mission left configuration before it was cancelled'),
    step(
      'execution',
      'cancelled',
      'legacy mission was safely cancelled; whether any role actively worked is not recorded',
    ),
  ],
};

/**
 * The transition plan for a legacy mission state. For `verified_complete`
 * the release dimension is derived from the release policy through the
 * model's own `deriveReleaseEligibility` — never hardcoded:
 * default policy → `human_approval_required` (the founder still approves
 * releases); a policy without human approval → `eligible`. The legacy app
 * never released, so the plan never ends at `released`.
 */
export function legacyStatusTransitionPlan(
  state: RelayMissionState,
  policy: AqualaReleasePolicy = DEFAULT_RELEASE_POLICY,
): LegacyStatusTransitionStep[] {
  const plan = [...MISSION_STATE_PLANS[state]];
  if (state === 'verified_complete') {
    const eligibility = deriveReleaseEligibility(
      {
        executionStatus: 'completed',
        outcomeStatus: 'satisfied',
        verificationStatus: 'verified',
        releaseStatus: 'not_eligible',
      },
      policy,
    );
    if (eligibility.gatesMet) {
      plan.push(
        eligibility.humanApprovalRequired
          ? step('release', 'human_approval_required', 'release now awaits explicit human approval')
          : step('release', 'eligible', 'release gates met under the configured policy'),
      );
    }
  }
  return plan;
}

/* ------------------------------------------------------ materialization */

export interface LegacyMaterializationInput {
  state: RelayMissionState;
  projectId: string;
  missionId: string;
  /** Stable prefix for deterministic event ids, e.g. the mission id. */
  eventIdPrefix: string;
  /** Timestamp recorded on every compatibility event (the adapter never
      invents per-step times the legacy record did not keep). */
  occurredAt: string;
  actorId?: string;
  actorType?: AqualaActorType;
  missionRevision?: number;
  policy?: AqualaReleasePolicy;
}

export type LegacyMaterializationResult =
  | { ok: true; status: AqualaOutcomeStatus; events: AqualaStatusTransitionEvent[] }
  | { ok: false; failedStep: number; error: AqualaStatusTransitionError };

/**
 * Replays the compatibility plan through the REAL transition engine. The
 * returned events are a legitimate, reconstructable history — not a
 * hand-assembled snapshot — so every downstream consumer (reconstruction,
 * later ledger milestones) treats adapted missions like native ones.
 */
export function materializeLegacyStatusEvents(
  input: LegacyMaterializationInput,
): LegacyMaterializationResult {
  const plan = legacyStatusTransitionPlan(input.state, input.policy);
  let status = createInitialAqualaOutcomeStatus();
  const events: AqualaStatusTransitionEvent[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const planned = plan[i];
    const result = applyStatusTransition(status, {
      dimension: planned.dimension,
      nextStatus: planned.nextStatus,
      reason: planned.reason,
      actorId: input.actorId ?? 'relay-legacy-compat',
      actorType: input.actorType ?? 'system',
      eventId: `${input.eventIdPrefix}-compat-${String(i + 1).padStart(3, '0')}`,
      projectId: input.projectId,
      missionId: input.missionId,
      missionRevision: input.missionRevision ?? 0,
      occurredAt: input.occurredAt,
      policy: input.policy,
    });
    if (!result.ok) {
      return { ok: false, failedStep: i, error: result.error };
    }
    status = result.status;
    events.push(result.event);
  }
  return { ok: true, status, events };
}

/** Replays a plan through the real engine with neutral compat identifiers.
    Returns the safest truthful answer (the initial status — nothing proven,
    nothing releasable) if a plan were ever unreachable; tests replay every
    legacy value to keep that branch dead. */
function replayPlanToStatus(
  plan: readonly LegacyStatusTransitionStep[],
  policy?: AqualaReleasePolicy,
): AqualaOutcomeStatus {
  let current = createInitialAqualaOutcomeStatus();
  for (let i = 0; i < plan.length; i += 1) {
    const planned = plan[i];
    const result = applyStatusTransition(current, {
      dimension: planned.dimension,
      nextStatus: planned.nextStatus,
      reason: planned.reason,
      actorId: 'relay-legacy-compat',
      actorType: 'system',
      eventId: `compat-${String(i + 1).padStart(3, '0')}`,
      projectId: 'compat',
      missionId: 'compat',
      missionRevision: 0,
      occurredAt: '1970-01-01T00:00:00.000Z',
      policy,
    });
    if (!result.ok) return createInitialAqualaOutcomeStatus();
    current = result.status;
  }
  return current;
}

/** The adapted four-dimension status for a legacy mission state. */
export function adaptRelayMissionState(
  state: RelayMissionState,
  policy: AqualaReleasePolicy = DEFAULT_RELEASE_POLICY,
): AqualaOutcomeStatus {
  return replayPlanToStatus(legacyStatusTransitionPlan(state, policy), policy);
}

/* ------------------------------------- mission-layer contract status */

/**
 * Plans for the mission layer's own single-value ancestor
 * (`MissionStatus` in `src/relay/mission/contracts.ts`) — the vocabulary the
 * four-dimension model replaces at mission scope. `draft` and `locked` both
 * map to the initial status: contract authoring/locking precedes any
 * execution, and the status model deliberately does not track contract
 * lifecycle (that stays on the Mission Contract itself).
 */
const MISSION_STATUS_PLANS: Record<
  Exclude<MissionStatus, 'verified_complete'>,
  readonly LegacyStatusTransitionStep[]
> = {
  draft: [],
  locked: [],
  in_progress: [...START],
  // `blocked` follows `in_progress` in the mission-layer lifecycle, so the
  // START steps are asserted by the legacy record itself.
  blocked: [
    ...START,
    step('execution', 'waiting', 'legacy mission is blocked awaiting an honest stop resolution'),
  ],
  cancelled: MISSION_STATE_PLANS.cancelled,
};

export function legacyMissionStatusTransitionPlan(
  status: MissionStatus,
  policy: AqualaReleasePolicy = DEFAULT_RELEASE_POLICY,
): LegacyStatusTransitionStep[] {
  if (status === 'verified_complete') {
    // Identical to the browser-app plan, including the policy-derived
    // release tail (deliberately NOT a MISSION_STATUS_PLANS entry, so the
    // tail can never be silently dropped by a record lookup).
    return legacyStatusTransitionPlan('verified_complete', policy);
  }
  return [...MISSION_STATUS_PLANS[status]];
}

/** The adapted four-dimension status for a mission-layer contract status. */
export function adaptMissionStatus(
  status: MissionStatus,
  policy: AqualaReleasePolicy = DEFAULT_RELEASE_POLICY,
): AqualaOutcomeStatus {
  return replayPlanToStatus(legacyMissionStatusTransitionPlan(status, policy), policy);
}

/* ----------------------------------------- mission verdict adapter */

/**
 * What a mission-layer verdict (`MissionVerdict`) POSITIVELY establishes
 * about the outcome and verification dimensions, grounded in the verdict
 * engine's actual producers (`src/relay/mission/verdict.ts`). A verdict that
 * establishes nothing about a dimension leaves the field absent — the
 * adapter never widens a verdict into claims its producer does not make,
 * and never asserts execution or release dimensions at all:
 *
 * - `claimed_complete` — an implementer claim; establishes nothing.
 * - `reviewed` — reviews exist and NONE approved, so every completed review
 *   demanded changes: verification `changes_required`.
 * - `approved` — an independent review approved but verification is
 *   incomplete: verification `approved`, outcome `partial` (never
 *   `satisfied` — the ladder reserves that for `verified_complete`).
 * - `partially_complete` — the engine's "work is in progress" fall-through;
 *   no outcome evidence exists, so nothing is asserted.
 * - `failed` — a RUN failure (execution fact); requirements were never
 *   evaluated, so it asserts nothing about outcome or verification.
 * - `blocked` — three producer causes (cancelled run, open blocking
 *   findings, limits exceeded); only some involve a human, so no dimension
 *   or human claim is asserted.
 * - `needs_human` — a checkpoint explicitly demands a human decision.
 */
export interface MissionVerdictAssertion {
  outcomeStatus?: AqualaMissionOutcomeStatus;
  verificationStatus?: AqualaVerificationStatus;
  humanActionRequired: boolean;
}

export function adaptMissionVerdict(verdict: MissionVerdict): MissionVerdictAssertion {
  switch (verdict) {
    case 'claimed_complete':
      return { humanActionRequired: false };
    case 'reviewed':
      return { verificationStatus: 'changes_required', humanActionRequired: false };
    case 'approved':
      return { outcomeStatus: 'partial', verificationStatus: 'approved', humanActionRequired: false };
    case 'verified_complete':
      return { outcomeStatus: 'satisfied', verificationStatus: 'verified', humanActionRequired: false };
    case 'partially_complete':
      return { humanActionRequired: false };
    case 'failed':
      return { humanActionRequired: false };
    case 'blocked':
      return { humanActionRequired: false };
    case 'needs_human':
      return { humanActionRequired: true };
  }
}

/* ------------------------------------------ narrower legacy adapters */

/** Coding-terminal status → execution dimension only. The terminal knows
    nothing about outcome, verification, or release. */
export function adaptCodingTerminalStatus(status: CodingTerminalStatus): AqualaExecutionStatus {
  switch (status) {
    case 'waiting':
      return 'starting'; // dispatch accepted, session not live yet
    case 'live':
      return 'running';
    case 'complete':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

/** Reviewer verdict → verification dimension only. `unable_to_review` yields
    NO verification progress — an unfinished review is not a review. */
export function adaptMissionReviewVerdict(
  verdict: MissionReview['verdict'],
): AqualaVerificationStatus {
  switch (verdict) {
    case 'approved':
      return 'approved';
    case 'changes_required':
      return 'changes_required';
    case 'unable_to_review':
      return 'unverified';
  }
}
