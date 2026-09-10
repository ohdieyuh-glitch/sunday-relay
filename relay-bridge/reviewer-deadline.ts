/**
 * THE ONE PLACE THAT DECIDES HOW LONG A REVIEW MAY TAKE.
 *
 * Before this module there were three numbers describing one limit and no two
 * of them agreed:
 *
 *   - `reviewerWorker` declared `timeoutMs: 240_000` in the live composition.
 *     Nothing ever read it. `JuliusWorkerRegistry.register` validates that it
 *     is a positive integer and no code path has ever consulted it again, so a
 *     reader of the composition root learned a number that bound nothing.
 *   - `loadHermesConfig` read `RELAY_HERMES_TIMEOUT_MS` and defaulted to
 *     `180_000`. This was the only limit that actually cut a review off.
 *   - The live workflow set `RELAY_HERMES_TIMEOUT_MS: '400000'` as a literal,
 *     and `julius-live-hermes.sh` guarded it against a worst case modelled as
 *     `HERMES_REQUEST_TIMEOUT_SECONDS x 2 x 1000 + 180_000` = 360_000 ms.
 *
 * PAID MISSION 4 (run 34470535718) falsified the model. Its `review:plan`
 * attempt 1 was cut off at 400_093 ms and attempt 2 SUCCEEDED at 381_880 ms —
 * 21.9 s past the 360_000 ms the bootstrap called the engine's worst case. The
 * guard was comparing the model against the window and passing, while the real
 * thing ran past both. A review that needs longer than the model believes
 * possible is exactly the review the model cannot warn you about.
 *
 * So the deadline is now DERIVED, once, deterministically, from four inputs
 * that are each stated rather than assumed: an analytical model of the
 * engine's own retry behaviour, whatever paid runs have actually been observed
 * to do, an explicit safety headroom, and a hard ceiling owed to the job.
 * Every consumer reads the result of that derivation and nobody keeps a
 * private copy.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. Three observations are not a latency
 * distribution. This module never estimates a percentile, never fits a curve
 * and never reports a confidence. It knows two things: the largest duration
 * anyone has watched a review reach, and whether that number is a measurement
 * or merely a lower bound. Everything else stays unknown, and `basis` says
 * which of the two produced the answer.
 */

/** Bumped when the derivation changes, so a recorded deadline stays readable. */
export const REVIEWER_DEADLINE_POLICY_VERSION = 'julius-reviewer-deadline.v1' as const;

/**
 * A DURATION SOMEBODY ACTUALLY WATCHED, with the run that produced it.
 *
 * `outcome` is the honesty of the record. A `COMPLETED` observation is a
 * measurement: the review finished, and that is how long it took. A `CUT_OFF`
 * observation is CENSORED — Relay stopped the process at its own deadline, so
 * the true duration is at least `elapsedMs` and its actual value was never
 * observed and can never be recovered. Treating a censored sample as a
 * measurement would understate the very thing it is evidence of.
 */
export interface ReviewerDurationObservation {
  readonly runId: string;
  readonly taskId: string;
  readonly stage: 'plan' | 'build';
  readonly elapsedMs: number;
  readonly outcome: 'COMPLETED' | 'CUT_OFF';
}

/**
 * EVERY REVIEWER DURATION THIS REPOSITORY HAS SEEN ON A PAID RUN.
 *
 * Appended to, never edited. These are facts with provenance, not a model: the
 * run id and task id are in the durable evidence bundle of the run that
 * produced them and can be read back. Adding a longer observation raises the
 * deadline on the next resolve, which is the point — the policy learns from
 * what happened rather than from what someone expected to happen.
 */
export const RECORDED_REVIEWER_OBSERVATIONS: readonly ReviewerDurationObservation[] = [
  // Paid Mission 4. `review:plan` attempt 1 hit Relay's 400_000 ms window with
  // `first_output_observed = false` and was SIGTERMed: censored, so the review
  // it was running needed AT LEAST this long and nobody knows how much longer.
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:plan:review', stage: 'plan', elapsedMs: 400_093, outcome: 'CUT_OFF' },
  // Attempt 2 of the same review finished. This one is a measurement, and it
  // is the number that proves 360_000 ms was never the worst case.
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:plan:review', stage: 'plan', elapsedMs: 381_880, outcome: 'COMPLETED' },
  // The build review of the same mission, on a LARGER packet (41_601 bytes vs
  // 28_058), finished in 218_324 ms. Packet size is therefore not the driver,
  // which is why this policy does not scale the deadline by input size.
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:build:review', stage: 'build', elapsedMs: 218_324, outcome: 'COMPLETED' },
];

/**
 * THE JOB IS THE REAL LIMIT, and it is the reason a deadline cannot simply be
 * raised until it stops hurting.
 *
 * The live mission workflow gives the whole job `JOB_BUDGET_MS`. A run may
 * spend at most `MAX_REVIEWER_ATTEMPTS` reviewer attempts — the retry ceiling
 * on `review:plan` plus the one on `review:build` — and each of those may burn
 * a full deadline. `REVIEWER_JOB_SHARE_MS` is the slice of the job the
 * reviewers are allowed to consume between them; the remainder is what the
 * architect, the coder, the image builds and the evidence dump live on.
 *
 * These three numbers are the only place the ceiling comes from. Change one
 * and the ceiling moves, deterministically, and `julius-first-live-mission.yml`
 * is held to `JOB_BUDGET_MS` by a structural test so the two cannot drift.
 */
export const JOB_BUDGET_MS = 90 * 60_000;
export const REVIEWER_JOB_SHARE_MS = 50 * 60_000;
export const MAX_REVIEWER_ATTEMPTS = 6;

/** Multiplied onto the floor. 0.2 = twenty per cent of slack above the worst thing seen. */
export const REVIEWER_DEADLINE_HEADROOM_RATIO = 0.2;

/**
 * The engine's own give-up, modelled. `requestTimeoutSeconds` is the per-request
 * deadline Hermes is configured with; `requestsPerReview` is how many of those a
 * single review may serialise before Hermes stops; `engineOverheadMs` is the
 * spawn, profile load and teardown around them.
 *
 * This is retained as ONE INPUT and is no longer trusted on its own, because
 * Mission 4 ran past it.
 */
export interface ReviewerAnalyticalModel {
  readonly requestTimeoutSeconds: number;
  readonly requestsPerReview: number;
  readonly engineOverheadMs: number;
}

export const DEFAULT_ANALYTICAL_MODEL: ReviewerAnalyticalModel = {
  requestTimeoutSeconds: 90,
  requestsPerReview: 2,
  engineOverheadMs: 180_000,
};

export type ReviewerDeadlineBasis =
  /** The analytical model was the largest input; no observation exceeded it. */
  | 'ANALYTICAL'
  /** A COMPLETED observation exceeded the model. The floor is a measurement. */
  | 'OBSERVED_COMPLETED'
  /** A CUT_OFF observation exceeded everything. The floor is a LOWER BOUND. */
  | 'OBSERVED_CENSORED';

export interface ReviewerDeadline {
  readonly policyVersion: typeof REVIEWER_DEADLINE_POLICY_VERSION;
  /** The one number every consumer uses. Milliseconds. */
  readonly operativeTimeoutMs: number;
  readonly analyticalWorstCaseMs: number;
  /** Largest duration ever observed, or null when nothing has been recorded. */
  readonly observedHighWaterMs: number | null;
  /** True when the high water came from a cut-off run, so it is a lower bound. */
  readonly observedHighWaterCensored: boolean;
  /** The larger of the analytical model and the observations, before headroom. */
  readonly floorMs: number;
  readonly headroomMs: number;
  readonly hardCeilingMs: number;
  readonly basis: ReviewerDeadlineBasis;
  /** `operativeTimeoutMs x MAX_REVIEWER_ATTEMPTS`, what the job must absorb. */
  readonly worstCaseReviewerSpendMs: number;
}

/**
 * Refused rather than clamped.
 *
 * If the floor plus its headroom does not fit under the ceiling, silently
 * clamping would hand back a deadline already known to be shorter than a review
 * has taken — the exact failure this module exists to end. Someone has to
 * decide whether to widen the job, spend fewer attempts, or accept that a
 * review of this size cannot be afforded, and none of those is a default.
 */
export class ReviewerDeadlineUnsatisfiable extends Error {
  readonly requiredMs: number;
  readonly hardCeilingMs: number;
  constructor(requiredMs: number, hardCeilingMs: number) {
    super(
      `reviewer_deadline_unsatisfiable: ${requiredMs} ms is required by the floor plus headroom `
      + `but the job allows at most ${hardCeilingMs} ms per attempt `
      + `(${REVIEWER_JOB_SHARE_MS} ms of reviewer share / ${MAX_REVIEWER_ATTEMPTS} attempts). `
      + `Widen REVIEWER_JOB_SHARE_MS and JOB_BUDGET_MS together, or lower MAX_REVIEWER_ATTEMPTS.`,
    );
    this.name = 'ReviewerDeadlineUnsatisfiable';
    this.requiredMs = requiredMs;
    this.hardCeilingMs = hardCeilingMs;
  }
}

export const reviewerDeadlineHardCeilingMs = (): number =>
  Math.floor(REVIEWER_JOB_SHARE_MS / MAX_REVIEWER_ATTEMPTS);

/** The high-water mark, and whether it is a measurement or a lower bound. */
export function reviewerHighWater(
  observations: readonly ReviewerDurationObservation[] = RECORDED_REVIEWER_OBSERVATIONS,
): { readonly ms: number | null; readonly censored: boolean } {
  if (observations.length === 0) return { ms: null, censored: false };
  let best = observations[0]!;
  for (const observation of observations) if (observation.elapsedMs > best.elapsedMs) best = observation;
  return { ms: best.elapsedMs, censored: best.outcome === 'CUT_OFF' };
}

/**
 * DERIVE THE DEADLINE. Pure, total, and a function of its inputs alone — the
 * same inputs always produce the same number, which is what lets one structural
 * test prove that two consumers cannot disagree.
 */
export function resolveReviewerDeadline(input: {
  readonly model?: ReviewerAnalyticalModel;
  readonly observations?: readonly ReviewerDurationObservation[];
  readonly headroomRatio?: number;
} = {}): ReviewerDeadline {
  const model = input.model ?? DEFAULT_ANALYTICAL_MODEL;
  const headroomRatio = input.headroomRatio ?? REVIEWER_DEADLINE_HEADROOM_RATIO;
  if (!Number.isFinite(headroomRatio) || headroomRatio < 0) throw new Error('invalid_headroom_ratio');
  for (const [name, value] of [
    ['requestTimeoutSeconds', model.requestTimeoutSeconds],
    ['requestsPerReview', model.requestsPerReview],
    ['engineOverheadMs', model.engineOverheadMs],
  ] as const) if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid_analytical_${name}`);

  const analyticalWorstCaseMs =
    model.requestTimeoutSeconds * model.requestsPerReview * 1000 + model.engineOverheadMs;
  const highWater = reviewerHighWater(input.observations ?? RECORDED_REVIEWER_OBSERVATIONS);

  // The floor is the largest thing we have any reason to believe a review can
  // reach: the model, or something that actually happened, whichever is worse.
  const floorMs = Math.max(analyticalWorstCaseMs, highWater.ms ?? 0);
  const basis: ReviewerDeadlineBasis = highWater.ms !== null && highWater.ms > analyticalWorstCaseMs
    ? (highWater.censored ? 'OBSERVED_CENSORED' : 'OBSERVED_COMPLETED')
    : 'ANALYTICAL';

  const withHeadroomMs = Math.ceil(floorMs * (1 + headroomRatio));
  const hardCeilingMs = reviewerDeadlineHardCeilingMs();
  if (withHeadroomMs > hardCeilingMs) throw new ReviewerDeadlineUnsatisfiable(withHeadroomMs, hardCeilingMs);

  return {
    policyVersion: REVIEWER_DEADLINE_POLICY_VERSION,
    operativeTimeoutMs: withHeadroomMs,
    analyticalWorstCaseMs,
    observedHighWaterMs: highWater.ms,
    observedHighWaterCensored: highWater.censored,
    floorMs,
    headroomMs: withHeadroomMs - floorMs,
    hardCeilingMs,
    basis,
    worstCaseReviewerSpendMs: withHeadroomMs * MAX_REVIEWER_ATTEMPTS,
  };
}

/**
 * THE SINGLE OPERATIVE NUMBER, for callers that want nothing else.
 *
 * `loadHermesConfig` uses this for the transport that actually cuts a review
 * off, and the live composition uses THE SAME CALL for the deadline it declares
 * on the reviewer worker. That is the whole mechanism by which the declared and
 * the operative limit are now incapable of disagreeing.
 */
export const reviewerOperativeTimeoutMs = (): number => resolveReviewerDeadline().operativeTimeoutMs;
