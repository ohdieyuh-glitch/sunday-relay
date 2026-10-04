import {
  JULIUS_LEARNING_DIMENSIONS,
  JULIUS_LEARNING_LOOP_VERSION,
  type JuliusLearningComparison,
  type JuliusLearningDecision,
  type JuliusLearningDelta,
  type JuliusLearningMetrics,
  type JuliusLearningPairing,
  type JuliusLearningPolicy,
} from './julius-learning-loop';
import { validateJuliusEvent, type JuliusOperationalEvent } from './julius-events';

/**
 * ONE ARM OF A REGISTERED LEARNING PAIR, ON THE RECORD.
 *
 * The Learning Loop measures and gates, and writes nothing
 * (`julius-learning-loop.ts`). Until this record existed nothing in the runtime
 * called it either: it was an evaluation surface a test read after a mission,
 * so a paid matched pair could only have been scored by hand, after the fact,
 * by whoever chose which numbers to read. The live mission now calls it at a
 * registered arm's terminal state (E9-a), and THIS is what that call leaves in
 * the durable ledger: one `learning.arm.recorded` event per run, carrying
 *
 *   EVERY ARM     the registration it ran under, its pairing (objective digest,
 *                 roles, runtime version), the policy declared before it ran,
 *                 and its metrics projected from its own durable trajectory;
 *   THE WITH ARM  also the comparison against the WITHOUT arm, the gate's
 *                 decision and, on PROMOTE only, a PROPOSAL.
 *
 * A PROPOSAL, NEVER A PROMOTION. Trusted memory is `promoteJuliusMemoryClaim`'s
 * to grant, on evidence, from an authority that is not the claim's asserter. A
 * runtime that promoted what it learned on its own measurement would be the
 * asserter verifying itself, so the record names the outcome the independent
 * authority must decide and stops there. Nothing here imports the trust core.
 *
 * THE WITHOUT ARM'S PAIRING IS READ BACK FROM ITS OWN RECORD, never recomputed
 * from the WITH arm's contract. Recomputed, the two pairings would be equal by
 * construction and the loop's matched-pair refusal could never fire: a control
 * that cannot fail. Read back, a WITHOUT arm that ran another objective, other
 * roles or another runtime is refused by the loop's own rule 3.
 *
 * FLAT FACTS, because an event's facts are scalars (`validateJuliusEvent`):
 * lists are joined with commas, and the deltas are one token per declared
 * dimension.
 *
 * Pure: no clock, no store. It builds the event and reads one back; the bridge
 * (`recordJuliusLearningOutcome`) reads the trajectories and writes it.
 */

export const JULIUS_LEARNING_RECORD_VERSION = 'julius-learning-record.v1' as const;
export const JULIUS_LEARNING_ARM_EVENT_TYPE = 'learning.arm.recorded' as const;

export const JULIUS_LEARNING_ARMS = ['WITHOUT', 'WITH'] as const;
export type JuliusLearningArm = (typeof JULIUS_LEARNING_ARMS)[number];

/** The sha256 of the frozen pair registration, as 64 lower-case hex characters. */
export const JULIUS_LEARNING_REGISTRATION_DIGEST = /^[0-9a-f]{64}$/u;

/** The pair an arm belongs to, exactly as its contract declared it BEFORE it ran. */
export interface JuliusLearningRegistration {
  /** Both arms carry the same one: it is what makes them one experiment. */
  readonly registrationDigest: string;
  readonly arm: JuliusLearningArm;
  readonly policy: JuliusLearningPolicy;
  /** The WITHOUT arm's run, named by the WITH arm. Never present on the WITHOUT arm. */
  readonly withoutRunId?: string;
}

/* ------------------------------------------------------------------ policy */

const POLICY_FIELDS: readonly string[] = ['dimensions', 'minimumRelativeImprovement', 'minimumImprovedDimensions'];

/**
 * A POLICY THE GATE CAN BE HELD TO, OR THE REASON IT CANNOT. Null when it can.
 *
 * `decideJuliusLearningPromotion` already refuses a policy that could not
 * refuse: no dimension, no threshold, nothing required to improve. This
 * refuses those BEFORE a run is paid for, with the gate's own reason codes,
 * and two more the gate cannot see: a dimension declared twice (one
 * improvement counted as two), and a policy that requires more improved
 * dimensions than it declares (a gate that can never say yes is not a
 * measurement either). An unknown field is refused, never ignored: a term of
 * the experiment this build does not read is a term nobody would enforce.
 */
export function juliusLearningPolicyRefusal(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'learning_policy_not_an_object';
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some((key) => !POLICY_FIELDS.includes(key))) return 'learning_policy_field_unknown';
  const dimensions = policy.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0) return 'learning_dimensions_required';
  for (const dimension of dimensions) {
    if (typeof dimension !== 'string' || !(JULIUS_LEARNING_DIMENSIONS as readonly string[]).includes(dimension)) {
      return 'learning_dimension_unknown';
    }
  }
  if (new Set(dimensions).size !== dimensions.length) return 'learning_dimension_duplicated';
  const threshold = policy.minimumRelativeImprovement;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || !(threshold > 0)) return 'learning_policy_threshold_required';
  const required = policy.minimumImprovedDimensions;
  if (typeof required !== 'number' || !Number.isSafeInteger(required) || required < 1) return 'learning_policy_requires_no_improvement';
  if (required > dimensions.length) return 'learning_policy_unreachable';
  return null;
}

const samePolicy = (a: JuliusLearningPolicy, b: JuliusLearningPolicy): boolean =>
  a.dimensions.join(',') === b.dimensions.join(',')
  && a.minimumRelativeImprovement === b.minimumRelativeImprovement
  && a.minimumImprovedDimensions === b.minimumImprovedDimensions;

/* ------------------------------------------------------------------ record */

/**
 * THE RECORD'S ID IS NAMED BY ITS RUN, so a run has one record however often
 * its caller runs. The same record again is idempotent; a different record
 * under the same id is a `JuliusEventIdConflict`, and the first one stands
 * (the ledger's append contract). The WITH arm finds its WITHOUT arm's record
 * by this id, so there is never a choice between two.
 */
export const juliusLearningArmEventId = (runId: string): string =>
  `${JULIUS_LEARNING_RECORD_VERSION}:${runId}:${JULIUS_LEARNING_ARM_EVENT_TYPE}`;

/** What the WITH arm found when it met its WITHOUT arm. */
export interface JuliusLearningPairOutcome {
  readonly withoutRunId: string;
  /** Read off the WITHOUT arm's own record. Null when that record could not be read. */
  readonly withoutRunState: string | null;
  /** How many trajectory rows of the WITHOUT arm were compared. Null when none were read. */
  readonly withoutTrajectoryRows: number | null;
  /** The WITHOUT arm's record, when it was found: the WITH record's cause. */
  readonly withoutEventId: string | null;
  readonly comparison: JuliusLearningComparison;
  readonly decision: JuliusLearningDecision;
}

/**
 * WHAT A PROMOTE BECOMES: a proposal to the authority that decides, and
 * nothing more. Every other decision proposes nothing.
 */
export type JuliusLearningProposal = 'PROMOTION_PROPOSED' | 'NONE';
export const juliusLearningProposal = (decision: JuliusLearningDecision): JuliusLearningProposal =>
  (decision.outcome === 'PROMOTE' ? 'PROMOTION_PROPOSED' : 'NONE');

const measured = (value: number | null): string => (value === null ? 'unknown' : String(value));

/** One declared dimension: `dimension:VERDICT:without:with:bounded|total`. */
export const juliusLearningDeltaToken = (delta: JuliusLearningDelta): string =>
  `${delta.dimension}:${delta.verdict}:${measured(delta.without)}:${measured(delta.with)}:${delta.bounded ? 'bounded' : 'total'}`;

/**
 * THE EVENT ONE ARM LEAVES. The WITH arm, and only the WITH arm, carries a
 * pair outcome; anything else is a caller's mistake and is thrown, because a
 * WITHOUT record with a verdict on it, or a WITH record without one, would be
 * read as evidence of something that never happened. Validated HERE, as the
 * PostgreSQL ledger validates it, so a record the database would refuse is
 * refused by every store rather than accepted by the memory one.
 */
export function juliusLearningArmEvent(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly runState: string;
  readonly registration: JuliusLearningRegistration;
  readonly pairing: JuliusLearningPairing;
  readonly metrics: JuliusLearningMetrics;
  readonly trajectoryRows: number;
  readonly pair: JuliusLearningPairOutcome | null;
  readonly occurredAt: string;
}): JuliusOperationalEvent {
  const { registration, pairing, metrics, pair } = input;
  if ((registration.arm === 'WITH') !== (pair !== null)) throw new Error('learning_record_arm_mismatch');
  const facts: Record<string, string | number | boolean | null> = {
    recordVersion: JULIUS_LEARNING_RECORD_VERSION,
    loopVersion: JULIUS_LEARNING_LOOP_VERSION,
    registrationDigest: registration.registrationDigest,
    arm: registration.arm,
    runState: input.runState,
    objectiveDigest: pairing.objectiveDigest,
    roles: [...pairing.roles].sort().join(','),
    runtimeVersion: pairing.runtimeVersion,
    policyDimensions: registration.policy.dimensions.join(','),
    policyMinimumRelativeImprovement: registration.policy.minimumRelativeImprovement,
    policyMinimumImprovedDimensions: registration.policy.minimumImprovedDimensions,
    trajectoryRows: input.trajectoryRows,
    runs: metrics.runs,
    dispatches: metrics.dispatches,
    retries: metrics.retries,
    repairs: metrics.repairs,
    recoveries: metrics.recoveries,
    fallbacks: metrics.fallbacks,
    findings: metrics.findings,
    verifiedCompletions: metrics.verifiedCompletions,
    knownUsdMicros: metrics.knownUsdMicros,
    costComplete: metrics.costComplete,
    averageDurationMs: metrics.averageDurationMs,
    knownInputTokens: metrics.knownInputTokens,
    knownOutputTokens: metrics.knownOutputTokens,
    unknownUsageComponents: metrics.unknownUsageComponents,
    ...(pair === null ? {} : {
      withoutRunId: pair.withoutRunId,
      withoutRunState: pair.withoutRunState,
      withoutTrajectoryRows: pair.withoutTrajectoryRows,
      comparison: pair.comparison.outcome,
      comparisonReason: pair.comparison.outcome === 'COMPARED' ? null : pair.comparison.reasonCode,
      deltas: pair.comparison.outcome === 'COMPARED' ? pair.comparison.deltas.map(juliusLearningDeltaToken).join(',') : null,
      decision: pair.decision.outcome,
      decisionReason: pair.decision.outcome === 'REFUSE' ? pair.decision.reasonCode : null,
      improved: pair.decision.outcome === 'PROMOTE' ? pair.decision.improved.join(',') : '',
      regressed: pair.decision.outcome === 'REFUSE' ? pair.decision.regressed.join(',') : '',
      marginalValue: pair.decision.outcome === 'PROMOTE' ? pair.decision.marginalValue : null,
      proposal: juliusLearningProposal(pair.decision),
    }),
  };
  const event: JuliusOperationalEvent = {
    eventId: juliusLearningArmEventId(input.runId),
    runId: input.runId,
    projectId: input.projectId,
    type: JULIUS_LEARNING_ARM_EVENT_TYPE,
    taskId: null,
    workerId: null,
    // Both arms of one experiment share a correlation, so a reader finds the pair from either side.
    correlationId: `learning-pair:${registration.registrationDigest}`,
    causationId: pair === null ? null : pair.withoutEventId,
    occurredAt: input.occurredAt,
    facts,
  };
  validateJuliusEvent(event);
  return event;
}

/* -------------------------------------------------------------- read back */

/** An arm's record, as the WITH arm reads its WITHOUT arm's. */
export interface JuliusLearningArmRecord {
  readonly registrationDigest: string;
  readonly arm: JuliusLearningArm;
  readonly runState: string;
  readonly pairing: JuliusLearningPairing;
  readonly policy: JuliusLearningPolicy;
  readonly trajectoryRows: number;
}

/**
 * AN ARM'S RECORD, READ BACK, or the reason it cannot be used as one. Every
 * field the pairing needs is checked rather than defaulted: a WITHOUT record
 * that has lost its objective digest must not compare as "the same objective",
 * and one written by another version of the loop measured with other rules.
 */
export function readJuliusLearningArmRecord(
  facts: Readonly<Record<string, string | number | boolean | null>>,
): { readonly ok: true; readonly record: JuliusLearningArmRecord } | { readonly ok: false; readonly reasonCode: string } {
  const invalid = { ok: false, reasonCode: 'learning_pair_without_record_invalid' } as const;
  if (facts.recordVersion !== JULIUS_LEARNING_RECORD_VERSION) return invalid;
  if (facts.loopVersion !== JULIUS_LEARNING_LOOP_VERSION) return { ok: false, reasonCode: 'learning_pair_loop_version_differs' };
  const { registrationDigest, arm, runState, objectiveDigest, roles, runtimeVersion, policyDimensions, trajectoryRows } = facts;
  if (typeof registrationDigest !== 'string' || !JULIUS_LEARNING_REGISTRATION_DIGEST.test(registrationDigest)) return invalid;
  if (arm !== 'WITHOUT' && arm !== 'WITH') return invalid;
  for (const text of [runState, objectiveDigest, roles, runtimeVersion, policyDimensions]) {
    if (typeof text !== 'string' || text === '') return invalid;
  }
  if (typeof trajectoryRows !== 'number' || !Number.isSafeInteger(trajectoryRows) || trajectoryRows < 0) return invalid;
  const policy = {
    dimensions: String(policyDimensions).split(','),
    minimumRelativeImprovement: facts.policyMinimumRelativeImprovement,
    minimumImprovedDimensions: facts.policyMinimumImprovedDimensions,
  };
  if (juliusLearningPolicyRefusal(policy) !== null) return invalid;
  return {
    ok: true,
    record: {
      registrationDigest, arm, runState: String(runState),
      pairing: { objectiveDigest: String(objectiveDigest), roles: String(roles).split(','), runtimeVersion: String(runtimeVersion) },
      policy: policy as JuliusLearningPolicy,
      trajectoryRows,
    },
  };
}

/**
 * DOES THE WITHOUT ARM'S RECORD BELONG TO THIS PAIR? Asked before the loop is,
 * because the loop can only see what it is handed: two arms registered under
 * different digests, or declared under different policies, are two
 * experiments, and their numbers side by side would be an anecdote with a
 * verdict on it. Null when it does.
 */
export function juliusLearningPairRefusal(input: {
  /** The WITH arm's own registration. */
  readonly registration: JuliusLearningRegistration;
  readonly without: JuliusLearningArmRecord;
}): string | null {
  if (input.without.arm !== 'WITHOUT') return 'learning_pair_without_arm_mismatch';
  if (input.without.registrationDigest !== input.registration.registrationDigest) return 'learning_pair_registration_differs';
  if (!samePolicy(input.without.policy, input.registration.policy)) return 'learning_pair_policy_differs';
  return null;
}
