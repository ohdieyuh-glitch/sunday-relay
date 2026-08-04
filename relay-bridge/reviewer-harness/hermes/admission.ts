/**
 * AGGREGATE ADMISSION CONTROL — the ceiling above the per-run ceilings.
 *
 * THE GAP THIS CLOSES (independent review, F1). Per-run limits were already
 * server-owned and clamped: a caller could not ask for a 24-hour timeout or a
 * 1 GB output cap. Nothing bounded the number of runs. Two hundred concurrent
 * `POST /v1/reviews` from one authenticated caller were all accepted, each
 * spawning a Hermes process group that holds the provider credential for up to
 * ten minutes, and neither the run map nor the idempotency map was ever
 * evicted. The realistic trigger is not an attacker — it is a bridge retry
 * loop, made likelier by this service's own documented "idempotency is NOT
 * restart-safe" property.
 *
 * TRUTHFUL, ENFORCEABLE UNITS ONLY.
 *
 * The tempting aggregate bound is spend, or tokens. This service cannot
 * enforce either and must not pretend to: usage is reported by the harness
 * AFTER a run, may be absent entirely (`source: 'unavailable'`), and a
 * pre-admission spend check would have to invent a number for work that has
 * not happened. A limit computed from a guess is not a limit.
 *
 * So the two bounds here are exactly the two quantities the service itself
 * decides and can hold:
 *
 *   ACTIVE RUNS      it starts each process group, so it knows the count.
 *   WORST-CASE WALL  every admitted run carries an effective `timeoutMs` this
 *   CLOCK IN FLIGHT  service already clamps and enforces, so the sum over
 *                    active runs is a real upper bound on outstanding work —
 *                    not a forecast.
 *
 * Neither is a spend limit and neither is described as one. Spend is bounded
 * by Relay Core, which owns run truth and the Mission Contract's budget.
 *
 * RETENTION IS THE SECOND HALF OF THE SAME FINDING. Capping concurrency while
 * retaining every terminal run forever moves the unbounded growth rather than
 * removing it. Terminal runs are retained up to a ceiling and then evicted
 * oldest-first, and an evicted run takes its idempotency entries with it —
 * otherwise the idempotency map becomes the leak. An ACTIVE run is never
 * evicted: dropping it would discard the only reference to its
 * `AbortController`, and a shutdown could then not reach its process group,
 * which is the precise orphan this service promises cannot happen.
 *
 * This module is PURE. It decides; the transport keeps the state and does the
 * releasing. Splitting it that way is what makes the policy testable without
 * spawning anything.
 */

/**
 * The shape of the ceilings.
 *
 * Declared as an interface of `number` rather than inferred from the frozen
 * literal below: `typeof ADMISSION_CEILINGS` would give the LITERAL types
 * `4`, `2_400_000` and `64`, so any other value — including the smaller ones
 * a test needs to reach a ceiling without spawning four processes — would be a
 * type error. The values are still frozen at runtime and still server-owned;
 * only the type is widened.
 */
export interface AdmissionCeilings {
  readonly maxActiveReviews: number;
  readonly maxActiveTimeoutBudgetMs: number;
  readonly maxRetainedTerminalRuns: number;
}

/**
 * SERVER-OWNED. Not configurable by a request, and not read from the request
 * environment: a caller that could raise the ceiling is not bounded by it.
 */
export const ADMISSION_CEILINGS: AdmissionCeilings = Object.freeze({
  /**
   * Concurrent reviews. Each one is a Hermes process group holding the
   * provider credential, so this is a real resource count on a single
   * container, not an arbitrary throttle.
   */
  maxActiveReviews: 4,
  /**
   * Sum of the effective `timeoutMs` of active runs.
   *
   * THIS NUMBER WAS 2_400_000 AND COULD NEVER REFUSE ANYTHING. That is exactly
   * `maxActiveReviews × SERVICE_LIMIT_CEILINGS.timeoutMs`, and the count check
   * returns first — so this check only ever ran with `activeCount ≤ 3`, where
   * the largest reachable sum is `3 × 600_000 + 600_000 = 2_400_000`, and the
   * predicate is a strict `>`. No input to the service could reach it, while
   * the docstring called the two bounds "deliberately not redundant" and the
   * README published the ceiling to operators as a second limit. A ceiling
   * that cannot fire is a claimed gate the code does not have — the same
   * defect class as the comment F2 was raised about.
   *
   * 1_800_000 ms (30 minutes) is reachable and means something: three
   * full-length 600 s runs fill it, and a fourth is refused **even though a
   * slot is free**. Four runs still fit whenever they average 450 s or less,
   * which the harness default of 180 s (`runner.ts`) comfortably does. So the
   * two bounds now genuinely differ: `maxActiveReviews` binds a fleet of short
   * runs, this binds a fleet of long ones.
   */
  maxActiveTimeoutBudgetMs: 1_800_000,
  /**
   * Terminal runs retained for `GET /v1/reviews/:id` after they finish.
   * Beyond this, the oldest are evicted. Relay Core holds the durable record;
   * this is a short-lived read-through cache, and it says so.
   */
  maxRetainedTerminalRuns: 64,
});

export const ADMISSION_REFUSAL_REASONS = [
  'active_run_limit',
  'active_wall_clock_limit',
  'unusable_timeout_request',
] as const;
export type AdmissionRefusalReason = (typeof ADMISSION_REFUSAL_REASONS)[number];

export interface AdmissionState {
  /** Runs currently executing. */
  readonly activeCount: number;
  /** Sum of the effective timeouts of those runs, in milliseconds. */
  readonly activeTimeoutBudgetMs: number;
}

export type AdmissionVerdict =
  | { readonly admitted: true }
  | {
    readonly admitted: false;
    readonly reason: AdmissionRefusalReason;
    /**
     * SANITIZED. It names the ceiling that was reached and nothing else — no
     * other caller's run id, no idempotency key, no host, no process id, no
     * count of who else is running. A capacity message is returned to whoever
     * asked, and what else the service is doing is not their business.
     */
    readonly safeMessage: string;
  };

/**
 * Decide whether one more review may start. Deliberately synchronous and
 * side-effect free: the caller must check and reserve in a single
 * uninterrupted step, and an `await` inside this decision would open exactly
 * the window in which two callers both see the last free slot.
 */
export function evaluateAdmission(
  state: AdmissionState,
  requestedTimeoutMs: number,
  ceilings: AdmissionCeilings = ADMISSION_CEILINGS,
): AdmissionVerdict {
  /**
   * A RESERVATION MUST BE A NUMBER, OR THE BUDGET STOPS BEING ONE.
   *
   * `NaN - x` is `NaN` forever: one non-finite reservation would poison
   * `activeTimeoutBudgetMs` for the life of the process and silently disable
   * the wall-clock ceiling with no error and no way back. The service's own
   * `parseReviewBody` already requires a positive safe integer, so nothing in
   * the deployed path can arrive here malformed — but this module is exported,
   * documented as the authority, and testable on its own, and a policy module
   * that trusts its caller is not an authority.
   */
  if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    return {
      admitted: false,
      reason: 'unusable_timeout_request',
      safeMessage: 'A review must declare a positive wall-clock timeout before it can be admitted.',
    };
  }
  if (state.activeCount >= ceilings.maxActiveReviews) {
    return {
      admitted: false,
      reason: 'active_run_limit',
      safeMessage:
        `The Hermes Reviewer service is already running its maximum of ${ceilings.maxActiveReviews} `
        + 'concurrent reviews. This is a capacity limit, not a fault; retry once a review finishes.',
    };
  }
  if (state.activeTimeoutBudgetMs + requestedTimeoutMs > ceilings.maxActiveTimeoutBudgetMs) {
    return {
      admitted: false,
      reason: 'active_wall_clock_limit',
      safeMessage:
        'The Hermes Reviewer service has reached its ceiling for outstanding review wall-clock time. '
        + 'This is a capacity limit, not a fault; retry once a review finishes.',
    };
  }
  return { admitted: true };
}

/**
 * Which retained terminal runs must go, oldest first.
 *
 * `order` is ADMISSION order, oldest first — the order runs were accepted, not
 * the order they finished. The distinction is worth stating because the two
 * differ whenever a short run overtakes a long one, and "oldest" here means
 * "admitted longest ago". Either is a defensible retention policy; only one of
 * them is what the caller actually passes, and a docstring naming the other
 * would be the kind of unchecked claim this milestone exists to remove.
 *
 * `isActive` is consulted for every candidate rather than assumed from the
 * list, so an active run can never be selected however the caller's
 * bookkeeping drifts — the guarantee that matters most here is the one that
 * keeps a live `AbortController` reachable.
 */
export function selectEvictions(
  order: readonly string[],
  isActive: (runId: string) => boolean,
  ceilings: AdmissionCeilings = ADMISSION_CEILINGS,
): readonly string[] {
  const terminal = order.filter((runId) => !isActive(runId));
  const excess = terminal.length - ceilings.maxRetainedTerminalRuns;
  return excess <= 0 ? [] : terminal.slice(0, excess);
}
