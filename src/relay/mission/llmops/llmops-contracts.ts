/**
 * SUNDAY RELAY — PROJECT BRAIN LLMOPS
 * Operational signal model (PURE types + vocabularies).
 *
 * This module records what an agent run COST IN TIME, WHERE IT FAILED, WHAT IT
 * WAS WAITING FOR, and WHETHER ANYONE INDEPENDENT JUDGED IT. Cost in money is
 * already modelled by `../economics` and is not duplicated here; an operations
 * view cites receipts rather than recomputing them.
 *
 * Four rules shape the whole model, and each one is enforced by a type rather
 * than by a convention:
 *
 *   1. AN UNOBSERVED PHASE IS ABSENT, NEVER ZERO. There is no `durationMs: 0`
 *      standing in for "we did not measure it". A sample that was not taken is
 *      not in the array, and the projection reports which phases are missing.
 *
 *   2. WAITING ON A HUMAN IS NOT LATENCY. Time blocked on user input, user
 *      approval, or a credential is time the system is not spending and not
 *      failing. Folding it into latency makes every metric a measure of how
 *      fast someone answered a question, and makes an idle system look slow.
 *      Wait intervals are a separate record with a REASON.
 *
 *   3. A RATE WITH AN UNKNOWN DENOMINATOR IS UNKNOWN. Two errors out of an
 *      unknown number of attempts is not a 100% error rate and not a 0% one.
 *
 *   4. A SELF-EVALUATION IS NOT AN INDEPENDENT ONE. `independent` is derived
 *      from whether the judge is the same actor as the author — it is not a
 *      flag a caller can simply assert.
 *
 * No React, no network, no storage, no provider dependencies.
 * See docs/relay/PROJECT_BRAIN_LLMOPS.md.
 */

/* ------------------------------------------------------------------ time */

/**
 * Phases of a single agent turn. A run does not necessarily have all of them —
 * a cached response has no `generation`, a run with no tools has no
 * `tool_execution` — and the absence is meaningful, so it is recorded as
 * absence rather than as a zero.
 */
export const RELAY_LATENCY_PHASES = [
  'queue',
  'first_token',
  'generation',
  'tool_execution',
  'verification',
  'total',
] as const;
export type RelayLatencyPhase = (typeof RELAY_LATENCY_PHASES)[number];

/**
 * One measured interval. `durationMs` is a finite, non-negative number of
 * milliseconds that someone actually observed. There is no constructor that
 * produces a sample for a phase nobody timed.
 */
export interface RelayLatencySample {
  readonly phase: RelayLatencyPhase;
  readonly durationMs: number;
  /** ISO-8601. When the interval ENDED. */
  readonly observedAt: string;
  readonly missionId?: string;
  readonly taskId?: string;
}

/* --------------------------------------------------------------- waiting */

/**
 * Why execution is not proceeding. `user_input`, `user_approval` and
 * `credential` are the three that mean A HUMAN HAS TO DO SOMETHING — the
 * roadmap calls this "Waiting on User" and it is reported as its own figure,
 * because it is the only category of wait a user can shorten.
 */
export const RELAY_WAIT_REASONS = [
  'user_input',
  'user_approval',
  'credential',
  'budget_authorization',
  'external_gate',
  'agent_capacity',
  'rate_limit',
  'unknown',
] as const;
export type RelayWaitReason = (typeof RELAY_WAIT_REASONS)[number];

/** The reasons that a person, not the system, has to clear. */
export const WAITING_ON_USER_REASONS: readonly RelayWaitReason[] = [
  'user_input',
  'user_approval',
  'credential',
  'budget_authorization',
];

/**
 * An interval spent blocked. `until: null` means STILL WAITING — an open
 * interval has a duration only relative to some "as of" instant, so it is
 * never given one at rest.
 */
export interface RelayWaitInterval {
  readonly reason: RelayWaitReason;
  /** ISO-8601. */
  readonly since: string;
  /** ISO-8601, or null while still blocked. */
  readonly until: string | null;
  readonly missionId?: string;
  readonly note?: string;
}

/* ---------------------------------------------------------------- errors */

export const RELAY_ERROR_KINDS = [
  'provider_error',
  'provider_timeout',
  'rate_limited',
  'context_overflow',
  'tool_failure',
  'workspace_failure',
  'validation_failure',
  'budget_refusal',
  'policy_refusal',
  'internal_error',
  'unknown',
] as const;
export type RelayErrorKind = (typeof RELAY_ERROR_KINDS)[number];

/**
 * One failure. `recovered` records whether the RUN continued, which is a
 * different question from whether the attempt succeeded — a retried timeout is
 * both an error that happened and a run that survived, and collapsing the two
 * hides the retry cost that `../economics` is separately billing.
 */
export interface RelayErrorEvent {
  readonly kind: RelayErrorKind;
  /** ISO-8601. */
  readonly at: string;
  readonly recovered: boolean;
  /** 1 for the first attempt. */
  readonly attempt: number;
  readonly missionId?: string;
  readonly detail?: string;
}

/* ----------------------------------------------------------- attempt base */

/**
 * The DENOMINATOR for every rate in the operations view, reported separately
 * from the numerators so that "unknown" survives projection. A caller that
 * cannot count attempts passes null, and every rate downstream becomes
 * `unknown` rather than silently dividing by the number of errors it happens
 * to have seen.
 */
export interface RelayAttemptBase {
  readonly attempts: number | null;
  readonly source: 'counted' | 'estimated' | 'unavailable';
}

/* ----------------------------------------------------------- evaluations */

export const RELAY_EVALUATION_VERDICTS = [
  'pass',
  'fail',
  'inconclusive',
  'not_run',
] as const;
export type RelayEvaluationVerdict = (typeof RELAY_EVALUATION_VERDICTS)[number];

/**
 * A judgement against a named rubric.
 *
 * `judgedBy` and `authoredBy` are both required, because independence is a
 * RELATIONSHIP between them and not a property a caller can assert. See
 * `isIndependentEvaluation`. This is the same rule the repository applies to
 * its own review gate: an authoring agent never approves its own work.
 */
export interface RelayEvaluation {
  readonly evaluationId: string;
  readonly rubricId: string;
  readonly verdict: RelayEvaluationVerdict;
  /** Actor identity of the judge. */
  readonly judgedBy: string;
  /** Actor identity of whoever produced the thing being judged. */
  readonly authoredBy: string;
  /** ISO-8601. */
  readonly at: string;
  readonly missionId?: string;
  readonly note?: string;
}

/**
 * Independence is derived, never declared. An evaluation whose judge is its
 * own author is a self-assessment; it may still be recorded and shown, but it
 * never counts toward independent coverage.
 */
export function isIndependentEvaluation(evaluation: RelayEvaluation): boolean {
  const judge = evaluation.judgedBy.trim().toLowerCase();
  const author = evaluation.authoredBy.trim().toLowerCase();
  if (judge === '' || author === '') return false;
  return judge !== author;
}

/* ---------------------------------------------------------- repair loops */

export const RELAY_REPAIR_OUTCOMES = [
  'converged',
  'limit_reached',
  'abandoned',
  'in_progress',
] as const;
export type RelayRepairOutcome = (typeof RELAY_REPAIR_OUTCOMES)[number];

export interface RelayRepairCycle {
  readonly cycle: number;
  readonly findingId: string;
  readonly repaired: boolean;
  /** ISO-8601. */
  readonly at: string;
}

/**
 * A repair loop and how it ENDED.
 *
 * `limit_reached` is not a success. A loop that ran out of budget with the
 * finding still open has produced an unfixed defect and a bill, and a surface
 * that renders that as "done" is lying about the state of the code.
 */
export interface RelayRepairLoop {
  readonly loopId: string;
  readonly cycles: readonly RelayRepairCycle[];
  readonly outcome: RelayRepairOutcome;
  readonly missionId?: string;
}

/* ------------------------------------------------------------ the record */

/**
 * Everything observed for one project, as recorded rather than as summarised.
 * The projection in `llmops-projection.ts` is the only thing that aggregates.
 */
export interface RelayOperationalRecord {
  readonly projectId: string;
  readonly latency: readonly RelayLatencySample[];
  readonly waits: readonly RelayWaitInterval[];
  readonly errors: readonly RelayErrorEvent[];
  readonly attempts: RelayAttemptBase;
  readonly evaluations: readonly RelayEvaluation[];
  readonly repairLoops: readonly RelayRepairLoop[];
  /** ISO-8601 of the newest signal of ANY kind, or null if nothing observed. */
  readonly newestSignalAt: string | null;
}

/** An empty record — observed nothing, which is not the same as observed zero. */
export function emptyOperationalRecord(projectId: string): RelayOperationalRecord {
  return {
    projectId,
    latency: [],
    waits: [],
    errors: [],
    attempts: { attempts: null, source: 'unavailable' },
    evaluations: [],
    repairLoops: [],
    newestSignalAt: null,
  };
}
