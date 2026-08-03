/**
 * SUNDAY RELAY — THE LOOP CONTRACT FOUNDATION.
 *
 * A Loop Contract is the versioned, confirmable statement of what a Loop will
 * do and what bounds it. It is NOT a second Mission Contract: the mission
 * layer still owns objective, acceptance criteria, completion rule and
 * evidence, and this contract REFERENCES a mission rather than restating it.
 * What a Loop adds is the control layer above a mission — how many times, for
 * how long, at what cost, targeting whom, stopping when.
 *
 * MINIMAL ON PURPOSE. Only what Stages 1A–1C need to state a Loop truthfully
 * and preview it before confirmation. The scheduler, iteration runtime, swarm
 * policy and Cron schedule fields land with the stages that implement them —
 * declaring them now would be a shape with no behaviour behind it, which is
 * how a contract starts lying about what a product does.
 *
 * PURE. No clock: every timestamp is an injected ISO string, exactly as in
 * `mission/durable` and `mission/economics`.
 */

import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import type { Provenance } from '../../protocol/enums';
import type { RelayAgentRole } from '../agent-operating';
import type { MissionCompletionRule } from '../contracts';
import { stableDigest } from '../mission';
import type { RelayLoopTargetSelector } from './loop-roles';

/* ------------------------------------------------------------- versioning */

export const RELAY_LOOP_CONTRACT_SCHEMA_V1 = 'relay-loop-contract.v1' as const;
export const RELAY_LOOP_CONTRACT_SCHEMA_VERSION = RELAY_LOOP_CONTRACT_SCHEMA_V1;
export const SUPPORTED_LOOP_CONTRACT_SCHEMA_VERSIONS = [RELAY_LOOP_CONTRACT_SCHEMA_V1] as const;
export type RelayLoopContractSchemaVersion =
  (typeof SUPPORTED_LOOP_CONTRACT_SCHEMA_VERSIONS)[number];

/* ------------------------------------------------------------ loop types */

/**
 * The seven Loop types share ONE engine. This is a policy preset, never a
 * subclass: nothing may switch behaviour on it at runtime — the defaults it
 * implies are resolved once, here, at contract-compile time.
 */
export const RELAY_LOOP_TYPES = [
  'execution',
  'research',
  'monitoring',
  'optimization',
  'maintenance',
  'review_and_repair',
  'swarm',
] as const;
export type RelayLoopType = (typeof RELAY_LOOP_TYPES)[number];

/* ---------------------------------------------------------------- states */

/**
 * THE CLOSED LOOP STATE SET — one enum, never a scatter of booleans.
 *
 * Declared whole now so later stages extend behaviour rather than redesign
 * vocabulary. Stages 1A–1C only ever produce `draft` and `awaiting_confirmation`;
 * the transition function lands with the runtime that can actually move
 * between the rest, because a transition table with no runtime behind it would
 * be a guess dressed as a guarantee.
 */
export const RELAY_LOOP_STATES = [
  'draft',
  'validating',
  'awaiting_confirmation',
  'queued',
  'starting',
  'planning',
  'decomposing',
  'running',
  'observing',
  'reviewing',
  'repairing',
  'waiting_dependency',
  'waiting_approval',
  'waiting_budget',
  'rate_limited',
  'backing_off',
  'pausing',
  'paused',
  'resuming',
  'stopping',
  'converging',
  'completion_check',
  'completed',
  'stopped',
  'iteration_exhausted',
  'duration_exhausted',
  'timed_out',
  'budget_exhausted',
  'token_exhausted',
  'provider_call_exhausted',
  'failed',
  'recovery_required',
] as const;
export type RelayLoopState = (typeof RELAY_LOOP_STATES)[number];

/**
 * Terminal states. `recovery_required` is deliberately NOT terminal: an
 * unconfirmable Loop is unfinished, not finished.
 *
 * EVERY EXHAUSTION IS TERMINAL AND NONE OF THEM IS COMPLETION. They are listed
 * separately rather than collapsed into one `exhausted` state because the five
 * limits fail for different reasons and a user fixes them differently — raising
 * an iteration cap is not the same act as raising a spend cap. `timed_out` is
 * distinct again: a wall-clock deadline is not a consumed resource.
 */
export const TERMINAL_LOOP_STATES: readonly RelayLoopState[] = [
  'completed',
  'stopped',
  'iteration_exhausted',
  'duration_exhausted',
  'timed_out',
  'budget_exhausted',
  'token_exhausted',
  'provider_call_exhausted',
  'failed',
];

/**
 * The five ways a Loop can run out of a bounded resource. Kept as its own set
 * so a surface can say "a limit stopped this" without re-listing them, and so a
 * test can prove none of them is ever treated as completion.
 */
export const EXHAUSTION_LOOP_STATES: readonly RelayLoopState[] = [
  'iteration_exhausted',
  'duration_exhausted',
  'budget_exhausted',
  'token_exhausted',
  'provider_call_exhausted',
];

/**
 * States that may show a Resume control. Mirrors
 * `RESUMABLE_CLASSIFICATIONS` in `mission/durable`: an unconfirmable Loop is
 * never resumable without inspection.
 */
export const RESUMABLE_LOOP_STATES: readonly RelayLoopState[] = ['paused'];

/** The swarm axis, separate from the Loop axis. */
export const RELAY_SWARM_STATES = [
  'swarm_planning',
  'swarm_fanout',
  'swarm_running',
  'swarm_rebalancing',
  'swarm_converging',
  'swarm_rechaining',
  'swarm_collapsed',
] as const;
export type RelaySwarmState = (typeof RELAY_SWARM_STATES)[number];

/* ---------------------------------------------------------------- limits */

/**
 * Every bound a Loop runs inside. `null` means UNBOUNDED and is never a
 * default: `validateLoopContract` requires recorded consent for an unbounded
 * iteration count, because "run forever" is a decision, not an omission.
 */
export interface RelayLoopLimits {
  readonly maxIterations: number | null;
  readonly maxTotalDurationMinutes: number | null;
  readonly maxIterationDurationMinutes: number | null;
  readonly maxTotalSpendUsd: number | null;
  readonly maxIterationSpendUsd: number | null;
  readonly maxTotalTokens: number | null;
  readonly maxTotalProviderCalls: number | null;
  readonly maxConsecutiveFailures: number;
  readonly maxConcurrentSlots: number;
}

export const DEFAULT_LOOP_LIMITS: RelayLoopLimits = Object.freeze({
  maxIterations: 5,
  maxTotalDurationMinutes: 30,
  maxIterationDurationMinutes: 10,
  maxTotalSpendUsd: null,
  maxIterationSpendUsd: null,
  maxTotalTokens: null,
  maxTotalProviderCalls: null,
  maxConsecutiveFailures: 2,
  maxConcurrentSlots: 1,
});

/* ------------------------------------------------------ stop conditions */

/**
 * Why a Loop stops on its own. Closed set — an unlisted condition cannot end a
 * Loop, which is the same reasoning that keeps a model's assertion from ending
 * one.
 */
export const RELAY_LOOP_STOP_CONDITIONS = [
  'completion_policy_satisfied',
  'max_iterations_reached',
  'max_duration_reached',
  'budget_exhausted',
  'token_cap_reached',
  'provider_call_cap_reached',
  'consecutive_failures',
  'blocking_finding_open',
  'reviewer_rejected',
  'operator_stopped',
  'policy_violation',
] as const;
export type RelayLoopStopCondition = (typeof RELAY_LOOP_STOP_CONDITIONS)[number];

/* ------------------------------------------------------------- review */

export interface RelayLoopReviewPolicy {
  /** Whether an independent review is required before a Loop may complete. */
  readonly independentReviewRequired: boolean;
  /** Roles that may satisfy it. Empty means "whatever the entitlement says",
   *  which is resolved against `mission/entitlement`, not invented here. */
  readonly reviewerRoles: readonly RelayAgentRole[];
  readonly maxRepairIterations: number;
}

/* -------------------------------------------------------------- contract */

/** Where the Loop came from — a fact worth keeping, because a Loop compiled
 *  from a slash command and one instantiated from a template answer different
 *  questions when something goes wrong. */
export const RELAY_LOOP_CREATION_SOURCES = [
  'slash_command',
  'composer',
  'cli',
  'template',
  'schedule',
] as const;
export type RelayLoopCreationSource = (typeof RELAY_LOOP_CREATION_SOURCES)[number];

export interface RelayLoopScope {
  readonly projectId: string;
  /** The mission this Loop drives. `null` while a draft is still being
   *  composed — the Composer binds one before confirmation. */
  readonly missionId: string | null;
  readonly missionContractRevision: number | null;
  readonly workspaceId: string | null;
}

export interface RelayLoopContract {
  readonly schemaVersion: RelayLoopContractSchemaVersion;
  readonly loopId: string;
  readonly version: number;
  readonly supersedes: string | null;

  readonly objective: string;
  readonly loopType: RelayLoopType;
  readonly scope: RelayLoopScope;

  readonly target: RelayLoopTargetSelector;
  readonly requestedRoles: readonly RelayAgentRole[];
  /** What the registry could actually staff at compile time. Separate from
   *  `requestedRoles` for the same reason requested and actual runtime are
   *  separate everywhere else in Relay. */
  readonly resolvedRoles: readonly RelayAgentRole[];

  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly completionRule: MissionCompletionRule;
  readonly review: RelayLoopReviewPolicy;

  readonly limits: RelayLoopLimits;
  readonly stopConditions: readonly RelayLoopStopCondition[];

  readonly state: RelayLoopState;
  /** Flags in force when this version was compiled — so a preview can be
   *  re-read later and still explain why something was unavailable. */
  readonly enabledFeatures: readonly string[];

  readonly creationSource: RelayLoopCreationSource;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: Provenance;

  /** Deterministic digest of the BINDING fields — the fields whose change
   *  invalidates work already done under this contract. */
  readonly bindingDigest: string;
}

/* ------------------------------------------------------------- authoring */

export interface RelayLoopContractDraft {
  readonly loopId: string;
  readonly objective: string;
  readonly loopType?: RelayLoopType;
  readonly scope: RelayLoopScope;
  readonly target: RelayLoopTargetSelector;
  readonly requestedRoles: readonly RelayAgentRole[];
  readonly resolvedRoles: readonly RelayAgentRole[];
  readonly acceptanceCriteria?: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly completionRule?: MissionCompletionRule;
  readonly review?: Partial<RelayLoopReviewPolicy>;
  readonly limits?: Partial<RelayLoopLimits>;
  readonly stopConditions?: readonly RelayLoopStopCondition[];
  readonly enabledFeatures?: readonly string[];
  readonly creationSource: RelayLoopCreationSource;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly provenance: Provenance;
  /** Explicit, recorded consent for an unbounded iteration count. */
  readonly unboundedIterationsConsent?: boolean;
}

/**
 * BINDING fields — changing any of these invalidates work already performed
 * under the contract, exactly as `bindingFields` does for a Mission Contract.
 * Cosmetic fields (creation source, timestamps, the flag list) are excluded:
 * a Loop whose flag set changed has not changed what it is trying to do.
 */
export function loopBindingFields(contract: RelayLoopContract): Record<string, unknown> {
  return {
    objective: contract.objective,
    loopType: contract.loopType,
    projectId: contract.scope.projectId,
    missionId: contract.scope.missionId,
    targetKind: contract.target.kind,
    requestedRoles: [...contract.requestedRoles].sort(),
    acceptanceCriteria: [...contract.acceptanceCriteria]
      .map((c) => ({ id: c.id, blocking: c.blocking }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    completionRule: contract.completionRule,
    review: {
      independentReviewRequired: contract.review.independentReviewRequired,
      reviewerRoles: [...contract.review.reviewerRoles].sort(),
      maxRepairIterations: contract.review.maxRepairIterations,
    },
    limits: contract.limits,
    stopConditions: [...contract.stopConditions].sort(),
  };
}

const DEFAULT_REVIEW: RelayLoopReviewPolicy = Object.freeze({
  independentReviewRequired: true,
  reviewerRoles: Object.freeze([]) as readonly RelayAgentRole[],
  maxRepairIterations: 1,
});

const DEFAULT_STOP_CONDITIONS: readonly RelayLoopStopCondition[] = Object.freeze([
  'completion_policy_satisfied',
  'max_iterations_reached',
  'max_duration_reached',
  'budget_exhausted',
  'consecutive_failures',
  'operator_stopped',
]);

function positiveOrNull(value: number | null, label: string, problems: string[]): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value <= 0) problems.push(`${label} must be a positive number or null (unbounded).`);
}

/**
 * Validate an authored draft.
 *
 * Everything it refuses is something that would otherwise become a Loop that
 * cannot be described truthfully: an objective nobody can act on, a bound that
 * is not a bound, an unbounded run nobody consented to, a review policy that
 * requires a reviewer the target does not include.
 */
export function validateLoopContractDraft(draft: RelayLoopContractDraft): string[] {
  const problems: string[] = [];
  const limits = { ...DEFAULT_LOOP_LIMITS, ...(draft.limits ?? {}) };

  if (draft.objective.trim() === '') problems.push('A Loop needs an objective.');
  if (draft.scope.projectId.trim() === '') problems.push('A Loop needs a project.');
  if (draft.createdBy.trim() === '') problems.push('A Loop needs a creating identity.');

  if (limits.maxIterations === null && draft.unboundedIterationsConsent !== true) {
    problems.push('An unbounded iteration count requires explicit recorded consent.');
  }
  positiveOrNull(limits.maxIterations, 'maxIterations', problems);
  positiveOrNull(limits.maxTotalDurationMinutes, 'maxTotalDurationMinutes', problems);
  positiveOrNull(limits.maxIterationDurationMinutes, 'maxIterationDurationMinutes', problems);
  positiveOrNull(limits.maxTotalSpendUsd, 'maxTotalSpendUsd', problems);
  positiveOrNull(limits.maxIterationSpendUsd, 'maxIterationSpendUsd', problems);
  positiveOrNull(limits.maxTotalTokens, 'maxTotalTokens', problems);
  positiveOrNull(limits.maxTotalProviderCalls, 'maxTotalProviderCalls', problems);

  if (!Number.isInteger(limits.maxConsecutiveFailures) || limits.maxConsecutiveFailures < 1) {
    problems.push('maxConsecutiveFailures must be a positive integer.');
  }
  if (!Number.isInteger(limits.maxConcurrentSlots) || limits.maxConcurrentSlots < 1) {
    problems.push('maxConcurrentSlots must be a positive integer.');
  }
  if (
    limits.maxIterationSpendUsd !== null &&
    limits.maxTotalSpendUsd !== null &&
    limits.maxIterationSpendUsd > limits.maxTotalSpendUsd
  ) {
    problems.push('maxIterationSpendUsd may not exceed maxTotalSpendUsd.');
  }
  if (
    limits.maxIterationDurationMinutes !== null &&
    limits.maxTotalDurationMinutes !== null &&
    limits.maxIterationDurationMinutes > limits.maxTotalDurationMinutes
  ) {
    problems.push('maxIterationDurationMinutes may not exceed maxTotalDurationMinutes.');
  }

  const review = { ...DEFAULT_REVIEW, ...(draft.review ?? {}) };
  if (!Number.isInteger(review.maxRepairIterations) || review.maxRepairIterations < 0) {
    problems.push('maxRepairIterations must be a non-negative integer.');
  }

  const ids = draft.acceptanceCriteria?.map((c) => c.id) ?? [];
  if (new Set(ids).size !== ids.length) problems.push('Acceptance criterion ids must be unique.');

  // A Loop that requires an independent review but names only one role cannot
  // satisfy structural independence — the same reviewer cannot review itself.
  if (
    review.independentReviewRequired &&
    draft.resolvedRoles.length === 1 &&
    review.reviewerRoles.length > 0 &&
    review.reviewerRoles.every((r) => draft.resolvedRoles.includes(r))
  ) {
    problems.push(
      'An independent review cannot be satisfied by the only resolved role — a reviewer may not review its own work.',
    );
  }

  return problems;
}

/**
 * Compile a validated draft into a sealed contract in `draft` state.
 *
 * Sealed means the binding digest is computed and the contract can be
 * confirmed. It does NOT mean anything is running — `state` is `draft` and
 * only an explicit confirmation moves it on.
 */
export function buildLoopContract(
  draft: RelayLoopContractDraft,
): RelayResult<RelayLoopContract> {
  const problems = validateLoopContractDraft(draft);
  if (problems.length > 0) {
    return fail(relayError('validation-failed', 'The Loop contract is not valid.', { details: problems }));
  }

  const base: Omit<RelayLoopContract, 'bindingDigest'> = {
    schemaVersion: RELAY_LOOP_CONTRACT_SCHEMA_VERSION,
    loopId: draft.loopId,
    version: 1,
    supersedes: null,
    objective: draft.objective.trim(),
    loopType: draft.loopType ?? 'execution',
    scope: draft.scope,
    target: draft.target,
    requestedRoles: [...draft.requestedRoles],
    resolvedRoles: [...draft.resolvedRoles],
    acceptanceCriteria: [...(draft.acceptanceCriteria ?? [])],
    completionRule: draft.completionRule ?? 'all_blocking_criteria_and_independent_review',
    review: { ...DEFAULT_REVIEW, ...(draft.review ?? {}) },
    limits: { ...DEFAULT_LOOP_LIMITS, ...(draft.limits ?? {}) },
    stopConditions: [...(draft.stopConditions ?? DEFAULT_STOP_CONDITIONS)],
    state: 'draft',
    enabledFeatures: [...(draft.enabledFeatures ?? [])],
    creationSource: draft.creationSource,
    createdBy: draft.createdBy,
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
    provenance: draft.provenance,
  };

  return ok({ ...base, bindingDigest: stableDigest(loopBindingFields({ ...base, bindingDigest: '' })) });
}

/** Did a change alter something work already done depends on? */
export function isBindingLoopChange(a: RelayLoopContract, b: RelayLoopContract): boolean {
  return stableDigest(loopBindingFields(a)) !== stableDigest(loopBindingFields(b));
}
