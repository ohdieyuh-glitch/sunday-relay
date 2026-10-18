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

import {
  JULIUS_NORMAL_REVIEW_STAGES, REVIEW_TASK_ATTEMPTS,
} from '../src/relay/mission/julius/julius-review-stage';

/** Bumped when the derivation changes, so a recorded deadline stays readable.
 *  v2: the request count and the attempt ceiling are derived rather than
 *  asserted, and both changed when they were. */
export const REVIEWER_DEADLINE_POLICY_VERSION = 'julius-reviewer-deadline.v2' as const;

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
/**
 * 90 -> 120 when the coder got a share of its own. The reviewers may burn 50
 * minutes worst case and the coder 40 (two attempts, each its session plus the
 * executor steps around it); the architect's own ceiling and the
 * image builds, PostgreSQL, Hermes and the evidence dump need room beside them,
 * and `coder-envelope.test.ts` proves the four add up inside this number.
 *
 * 120 -> 300 for Decision C's arms (the founder workflow draft r5, 2026-10-13). The shares above price NO repair
 * cycle ("REPAIR STAGES ARE DELIBERATELY OUT", below), while each arm's contract grants three and registration
 * r8.4 [r8-4] makes a coder-level repair a condition of every valid WITHOUT. `coder-envelope.test.ts` proves an
 * arm's worst case, every granted cycle included, fits with the stage deadline's margins (live-composition.ts).
 * The paid job's `timeout-minutes` must say the same number: until the founder commits the r5 workflow, the
 * structural tests that hold the two equal are red BY REGISTRATION (Decision C registration r8.5, section 7).
 */
export const JOB_BUDGET_MS = 300 * 60_000;
export const REVIEWER_JOB_SHARE_MS = 50 * 60_000;

/**
 * WHAT THE RUNTIME ACTUALLY SPENDS, not a number beside it.
 *
 * This read `6`, described in its own comment as "the retry ceiling on
 * `review:plan` plus the one on `review:build`" — two stages, three attempts
 * each. By then the reviewer registered SIX stages, nothing outside this file
 * and its mirror ever consulted the constant, and the ceiling that really
 * bounded attempts was `MAX_TASK_ATTEMPTS` in the pipeline. So the denominator
 * of the affordability check described a system that had not existed for some
 * time, and the check passed because of it.
 *
 * It is now the product of the two numbers the dispatch path enforces: the
 * review stages a normal mission runs, and the attempts the pipeline grants
 * each one. Change either and this moves, because it is the same value.
 *
 * REPAIR STAGES ARE DELIBERATELY OUT. A repair is a new task created after a
 * review that SUCCEEDED and asked for changes; it carries its own review, with
 * its own ceiling, and budgeting it here would price the healthy path for the
 * unhealthy one.
 */
export const MAX_REVIEWER_ATTEMPTS = JULIUS_NORMAL_REVIEW_STAGES.length * REVIEW_TASK_ATTEMPTS;

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

/** The per-request deadline the bootstrap writes into the engine's profile.
 *  `reviewer-deadline.test.ts` holds the workflow to this exact number.
 *
 *  90 -> 480 AFTER PAID QUALIFICATION 34753589938. The reviewer holds no tool,
 *  so a review is ONE request that reasons and then writes the whole verdict;
 *  90 s was sized for a loop of short tool calls, and that run's first attempt
 *  outran it. 480 s is the longest review ever watched (400 093 ms, cut off
 *  still running) with a fifth again beside it, so one request may take as long
 *  as a whole review has. The bootstrap ties the engine's two stream watchdogs
 *  to this same number, and the operative deadline is re-derived from it —
 *  and comes out unchanged (792 000 ms), because it was already sized for the
 *  longest review. */
export const REVIEWER_REQUEST_TIMEOUT_SECONDS = 480;

/**
 * THE FIXED LOCAL STARTUP BEFORE A PROVIDER IS CONTACTED, MEASURED.
 *
 * ~18 s against the real binary (v0.18.2), provider-free, and the same cold or
 * warm — which is also how "the first attempt always fails" was falsified as a
 * cold-start story.
 *
 * IT IS NOT `engineOverheadMs`, AND THE DIFFERENCE IS DELIBERATE. That number
 * is a conservative envelope for everything around the requests; this one is
 * the piece somebody actually watched. The inference below subtracts wall clock
 * that was certainly NOT spent waiting on a provider, so it must use the
 * measurement: subtracting the larger padding would credit the engine with time
 * it may never have taken and understate the request count, which is the error
 * this whole derivation exists to end.
 */
export const MEASURED_ENGINE_STARTUP_MS = 18_000;

/**
 * HOW MANY UPSTREAM REQUESTS A REVIEW REALLY MAKES — as a FLOOR, read off the
 * durations we have watched.
 *
 * This was asserted as `2`, and paid Mission 4 falsifies it. Its `review:plan`
 * attempt 2 COMPLETED in 381 880 ms at a commit where the bootstrap wrote
 * `request_timeout_seconds: 90` and `api_max_retries: 0` into the engine
 * profile, with an isolated `HERMES_HOME` that leaves the model no toolset at
 * all. Two requests can account for at most `18 000 + 2 x 90 000 = 198 000 ms`.
 * The review took nearly twice that, so it made at least five.
 *
 * Nothing noticed because the understatement hid behind the observation that
 * should have exposed it: `analyticalWorstCaseMs` came to 360 000, BELOW the
 * 400 093 ms high water, so `basis` was `OBSERVED_CENSORED` and the analytical
 * number never bound anything.
 *
 * A FLOOR, NEVER THE COUNT. A bundle cannot say how many requests a review
 * issued — the engine does not report it and `-z` prints nothing until the end.
 * What a duration proves is a minimum, and a censored duration proves a minimum
 * too, so both kinds count. Anything beyond that stays unknown.
 */
export function impliedRequestsPerReview(
  requestTimeoutSeconds: number = REVIEWER_REQUEST_TIMEOUT_SECONDS,
  observations: readonly ReviewerDurationObservation[] = RECORDED_REVIEWER_OBSERVATIONS,
  startupMs: number = MEASURED_ENGINE_STARTUP_MS,
): number {
  const perRequestMs = requestTimeoutSeconds * 1000;
  if (!Number.isFinite(perRequestMs) || perRequestMs <= 0) throw new Error('invalid_request_timeout');
  let floor = 1;
  for (const observation of observations) {
    const waiting = observation.elapsedMs - startupMs;
    if (waiting <= 0) continue;
    floor = Math.max(floor, Math.ceil(waiting / perRequestMs));
  }
  return floor;
}

export const DEFAULT_ANALYTICAL_MODEL: ReviewerAnalyticalModel = Object.freeze({
  requestTimeoutSeconds: REVIEWER_REQUEST_TIMEOUT_SECONDS,
  requestsPerReview: impliedRequestsPerReview(),
  /**
   * The conservative envelope around the requests — spawn, profile load,
   * teardown and whatever the engine does between calls. Retained as the
   * padding it has always been, and explicitly NOT the measured startup above.
   */
  engineOverheadMs: 180_000,
});

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
  /**
   * The request-count FLOOR the analytical worst case was built on, carried in
   * the result so the bootstrap can bound the engine with the same number
   * instead of computing `x 2` of its own — which is what it did, and what made
   * its ordering check pass with 300 s of margin that did not exist.
   */
  readonly requestsPerReview: number;
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
    requestsPerReview: model.requestsPerReview,
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

/**
 * ONE BOUNDED RE-ASK FOR A TRANSIENT UPSTREAM CONDITION, INSIDE THE SAME DEADLINE.
 *
 * A review stage gets exactly one pipeline attempt (`REVIEW_TASK_ATTEMPTS`),
 * and `review_service_unavailable` — a 429 or a 503 from the provider — is
 * `retryable: true`. Those two facts met on the live path and produced a third:
 * the retryable shape reached a pipeline that had no attempt left to spend on
 * it, so the first provider hiccup on any of a mission's review dispatches was
 * FINAL. The qualification dispatches the reviewer five times.
 *
 * The rule the pipeline enforces is right — a second task attempt is a blind
 * retry of the same packet against the same wall — and it is not what this is.
 * A transient status is an answer that never arrived; asking once more is the
 * adapter's business, and it is bounded here in the two ways that make it
 * something other than a retry: ONCE (`REVIEW_TRANSIENT_REASK_LIMIT`), and only
 * when the declared deadline still has room for a whole review after what the
 * first ask consumed. The second engine run is handed the REMAINING window, not
 * the full one, so the adapter still stops before the deadline Julius enforces
 * around the dispatch.
 *
 * UNKNOWN IS NOT ZERO. A first ask whose duration cannot be established from
 * its own two instants is not treated as having consumed nothing; it is refused
 * the re-ask, and the transient failure surfaces exactly as it did before this
 * existed.
 */
export const REVIEW_TRANSIENT_REASK_LIMIT = 1;
/** A rate limit clears in seconds; a drain in about as long. Short, and fixed. */
export const REVIEW_TRANSIENT_REASK_BACKOFF_MS = 5_000;

/**
 * THE SHAPES THE RE-ASK ANSWERS: an answer that never arrived, and nothing else.
 *
 * `review_service_unavailable` is a 429 or a 503. `review_timeout` is the
 * other one, and it was missing. The two most recent COMPLETED paid missions
 * each had a first review attempt time out and a second ask then complete it:
 * run 34470535718 (Mission 4) had `plan:review` cut by Relay at 400 093 ms and
 * completed on the next ask in 381 880 ms; run 34529874100 (Mission 5) had
 * `build:review` die after 94 200 ms — the engine's own 90 s request timeout,
 * inside a 480 112 ms window — and complete on the next ask in under 209 s.
 * Both missions completed because the pipeline still granted a second task
 * attempt. `REVIEW_TASK_ATTEMPTS = 1` removes it, so without this line the
 * failure the paid reviewer path has shown most often became FINAL, and it
 * lands after the coder has already spent.
 *
 * NOT a blind retry of a window-cut review. The same remaining-window rule
 * governs both shapes, and a review Relay itself stopped has consumed the
 * whole declared deadline, so `INSUFFICIENT_REMAINING` refuses it by
 * arithmetic. Only a timeout the engine raised early enough to leave a whole
 * review in the window is asked again — which is exactly the case the paid
 * record shows.
 */
export const REVIEW_TRANSIENT_REASK_SHAPES: ReadonlySet<string> = new Set(['review_service_unavailable', 'review_timeout']);

export type ReviewerReaskRefusal = 'CONSUMED_UNKNOWN' | 'INSUFFICIENT_REMAINING';

export type ReviewerReaskDecision =
  | { readonly allowed: true; readonly remainingMs: number; readonly floorMs: number }
  | { readonly allowed: false; readonly remainingMs: number | null; readonly floorMs: number; readonly reason: ReviewerReaskRefusal };

export function reviewerReaskWithinDeadline(input: {
  /** The deadline the dispatch was declared under — `HermesConfig.timeoutMs`. */
  readonly deadlineMs: number;
  /** Wall clock the asks so far consumed, or null when it cannot be established. */
  readonly consumedMs: number | null;
  readonly backoffMs?: number;
  /** The largest duration the policy believes a review can need. */
  readonly floorMs?: number;
}): ReviewerReaskDecision {
  const floorMs = input.floorMs ?? resolveReviewerDeadline().floorMs;
  const backoffMs = input.backoffMs ?? REVIEW_TRANSIENT_REASK_BACKOFF_MS;
  if (!Number.isSafeInteger(input.deadlineMs) || input.deadlineMs <= 0) throw new Error('invalid_reask_deadline');
  if (!Number.isSafeInteger(backoffMs) || backoffMs < 0) throw new Error('invalid_reask_backoff');
  if (!Number.isSafeInteger(floorMs) || floorMs <= 0) throw new Error('invalid_reask_floor');
  if (input.consumedMs === null || !Number.isFinite(input.consumedMs) || input.consumedMs < 0) {
    return { allowed: false, remainingMs: null, floorMs, reason: 'CONSUMED_UNKNOWN' };
  }
  const remainingMs = input.deadlineMs - Math.ceil(input.consumedMs) - backoffMs;
  if (remainingMs < floorMs) return { allowed: false, remainingMs, floorMs, reason: 'INSUFFICIENT_REMAINING' };
  return { allowed: true, remainingMs, floorMs };
}
