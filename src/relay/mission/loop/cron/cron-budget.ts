/**
 * SUNDAY RELAY — WHETHER A SCHEDULED RUN MAY SPEND.
 *
 * CRON_LOOPS.md: "Before dispatch, Relay verifies authorized budget. If there
 * is not enough: do not start paid execution, record `budget_blocked`,
 * notify, compute the next eligible trigger truthfully, and **never treat a
 * blocked run as successful**. Unknown cost remains Unknown; zero never
 * substitutes."
 *
 * That last sentence is the whole module. A schedule that fires every five
 * minutes spends on a timer nobody is watching, so the question "how much has
 * this already cost?" has exactly three answers — a number, unbounded, or
 * UNKNOWN — and only the first can authorize.
 *
 * WHAT IT REFUSES.
 *
 * - **To read Unknown as zero.** A window whose spend-to-date could not be
 *   observed cannot prove headroom, so a bounded cap over an unknown spend
 *   REFUSES. This is the whole difference between a cap and a decoration:
 *   substituting zero is how an unmetered schedule passes a spend check.
 * - **To spend the Reviewer's budget.** A reserved reviewer allowance is
 *   subtracted from headroom BEFORE the comparison, because a run that
 *   consumes the money its own verification needs produces an unreviewable
 *   result and a bill.
 * - **To call a blocked run anything but blocked.** There is no outcome here
 *   that a surface could render as progress.
 * - **To let any single check be skipped.** Every window, the guard, the
 *   concurrency limit and the pause threshold are all evaluated, and EVERY
 *   failing reason is reported — not just the first. An operator fixing one
 *   cap only to hit the next is how a budget review becomes four reviews.
 */

/** Integer micros as a decimal string, or `null` for Unknown/unbounded. */
export type Micros = string | null;

const CANONICAL_MICROS = /^(0|[1-9]\d*)$/;

export type SpendWindow = 'per_run' | 'per_day' | 'per_week' | 'per_billing_period';

export const SPEND_WINDOWS: readonly SpendWindow[] =
  ['per_run', 'per_day', 'per_week', 'per_billing_period'];

export interface WindowBudget {
  /** The cap. `null` means UNBOUNDED — no ceiling was configured. */
  readonly capMicros: Micros;
  /**
   * Spend already committed in this window. `null` means UNKNOWN — not zero,
   * and not "probably fine". A bounded cap over an unknown spend refuses.
   */
  readonly spentMicros: Micros;
}

export interface ScheduledSpendRequest {
  /**
   * What this run may spend at most, from its own budget. `null` means the
   * ceiling is UNKNOWN — and an unknown ceiling cannot be shown to fit inside
   * a bounded window, so it refuses there. It authorizes only where every
   * window is unbounded, because then there is nothing to fit inside.
   */
  readonly runCapMicros: Micros;
  readonly windows: Readonly<Record<SpendWindow, WindowBudget>>;
  /**
   * Money held back for the Reviewer. Subtracted from every window's headroom
   * before comparison. `null` means none is reserved — which is a real
   * configuration, not an unknown.
   */
  readonly reservedReviewerMicros: Micros;
  /** Runs of this schedule already executing, and the ceiling. */
  readonly simultaneousRuns: number;
  readonly maxSimultaneousRuns: number;
  /**
   * The emergency global guard. `true` means engaged, and an engaged guard
   * refuses everything regardless of every other number.
   */
  readonly emergencyGuardEngaged: boolean;
  /**
   * Spend fraction (0-1) at which the schedule pauses itself. `null` means no
   * automatic pause is configured.
   */
  readonly autoPauseAtFraction: number | null;
}

export type SpendRefusalReason =
  | 'emergency_guard_engaged'
  | 'unknown_spend_against_a_cap'
  /** The RUN's own ceiling is unknown while a window is bounded. Unknown is
   *  not zero in this direction either — review found declaring it Unknown
   *  was strictly MORE permissive than declaring any number. */
  | 'unknown_run_cap_against_a_cap'
  | 'cap_exceeded'
  | 'reviewer_budget_would_be_consumed'
  | 'too_many_simultaneous_runs'
  | 'auto_pause_threshold_reached'
  | 'invalid_budget_configuration';

export interface SpendRefusal {
  readonly reason: SpendRefusalReason;
  /** The window it concerns, when it concerns one. */
  readonly window?: SpendWindow;
  readonly detail: string;
}

export type ScheduledSpendDecision =
  /** Every check passed. The run may start paid execution. */
  | { readonly kind: 'authorized'; readonly headroomMicros: Micros }
  /**
   * BLOCKED. Not a partial success, not a smaller run — no paid execution
   * starts, and every failing reason is listed so one fix does not merely
   * reveal the next.
   */
  | { readonly kind: 'budget_blocked'; readonly refusals: readonly SpendRefusal[] };

/** Exact-rational denominator for the pause threshold: one part per million.
 *  Integer permille division truncated fail-open, so nothing divides now. */
const PAUSE_DENOMINATOR = 1_000_000n;

const parse = (value: Micros): bigint | null =>
  value !== null && CANONICAL_MICROS.test(value) ? BigInt(value) : null;

const malformed = (value: Micros): boolean =>
  value !== null && !CANONICAL_MICROS.test(value);

/**
 * Decide whether a scheduled run may spend.
 *
 * Pure and total. Every refusal is named, and the ONLY authorizing answer
 * requires every window to have been observed.
 */
export function authorizeScheduledSpend(
  request: ScheduledSpendRequest,
): ScheduledSpendDecision {
  const refusals: SpendRefusal[] = [];

  // A malformed number is a configuration defect, not a budget of zero and
  // not one of infinity. Checked first so no later comparison runs on it.
  const malformedFields: string[] = [];
  if (malformed(request.runCapMicros)) malformedFields.push('runCapMicros');
  if (malformed(request.reservedReviewerMicros)) malformedFields.push('reservedReviewerMicros');
  for (const window of SPEND_WINDOWS) {
    const budget = request.windows[window];
    if (malformed(budget.capMicros)) malformedFields.push(`${window}.capMicros`);
    if (malformed(budget.spentMicros)) malformedFields.push(`${window}.spentMicros`);
  }
  if (!Number.isInteger(request.simultaneousRuns) || request.simultaneousRuns < 0) {
    malformedFields.push('simultaneousRuns');
  }
  if (!Number.isInteger(request.maxSimultaneousRuns) || request.maxSimultaneousRuns < 1) {
    malformedFields.push('maxSimultaneousRuns');
  }
  if (request.autoPauseAtFraction !== null
    && !(Number.isFinite(request.autoPauseAtFraction)
      && request.autoPauseAtFraction > 0 && request.autoPauseAtFraction <= 1
      // A fraction below one part in PAUSE_DENOMINATOR would round to zero
      // and then match every spend — review found 0.0004 blocking a window
      // that had spent nothing. Refused as configuration rather than
      // silently becoming "pause always".
      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1)) {
    malformedFields.push('autoPauseAtFraction');
  }
  if (malformedFields.length > 0) {
    // Reported ALONGSIDE the checks that do not depend on a malformed number,
    // rather than instead of them: review found a malformed cap hiding an
    // engaged guard and a breached concurrency ceiling, so fixing the config
    // would have revealed two more refusals on the next attempt.
    const alsoFailing: SpendRefusal[] = [];
    if (request.emergencyGuardEngaged) {
      alsoFailing.push({
        reason: 'emergency_guard_engaged',
        detail: 'The emergency global guard is engaged.',
      });
    }
    if (Number.isInteger(request.simultaneousRuns) && request.simultaneousRuns >= 0
      && Number.isInteger(request.maxSimultaneousRuns) && request.maxSimultaneousRuns >= 1
      && request.simultaneousRuns >= request.maxSimultaneousRuns) {
      alsoFailing.push({
        reason: 'too_many_simultaneous_runs',
        detail: `${request.simultaneousRuns} runs are already executing and the ceiling is `
          + `${request.maxSimultaneousRuns}.`,
      });
    }
    return {
      kind: 'budget_blocked',
      refusals: [{
        reason: 'invalid_budget_configuration',
        detail: `These are not budget values: ${malformedFields.join(', ')}. A malformed cap is a `
          + 'configuration defect, not a budget of zero and not one of infinity, so nothing was '
          + 'authorized and no window was compared.',
      }, ...alsoFailing],
    };
  }

  // THE GUARD OUTRANKS EVERY NUMBER. It is reported alongside the others
  // rather than short-circuiting, because an operator disengaging it should
  // see what else would still have blocked the run.
  if (request.emergencyGuardEngaged) {
    refusals.push({
      reason: 'emergency_guard_engaged',
      detail: 'The emergency global guard is engaged. No scheduled run starts paid execution while '
        + 'it is, whatever the caps say.',
    });
  }

  if (request.simultaneousRuns >= request.maxSimultaneousRuns) {
    refusals.push({
      reason: 'too_many_simultaneous_runs',
      detail: `${request.simultaneousRuns} runs of this schedule are already executing and the `
        + `ceiling is ${request.maxSimultaneousRuns}.`,
    });
  }

  const reserved = parse(request.reservedReviewerMicros) ?? 0n;
  const runCap = parse(request.runCapMicros);
  const pauseNumerator = request.autoPauseAtFraction === null
    ? null
    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));

  let tightestHeadroom: bigint | null = null;
  for (const window of SPEND_WINDOWS) {
    const budget = request.windows[window];
    const cap = parse(budget.capMicros);
    if (cap === null) continue; // unbounded: no ceiling to violate

    // EVERY applicable check runs for this window; none short-circuits the
    // others. Review found each window returning at its first refusal, so an
    // operator raising a cap only met the pause threshold on the next tick —
    // the "budget review becoming four reviews" the header says it refuses.
    let windowFailed = false;

    const spent = parse(budget.spentMicros);
    if (spent === null) {
      // UNKNOWN IS NOT ZERO. Without an observed spend there is no way to
      // prove headroom exists, and a cap that authorizes on an unobserved
      // spend is not a cap.
      refusals.push({
        reason: 'unknown_spend_against_a_cap',
        window,
        detail: `The ${window} cap is ${budget.capMicros} micros but spend so far is Unknown. `
          + 'Unknown is not zero, so this cannot be shown to have headroom and nothing was '
          + 'authorized.',
      });
      continue; // every later check needs a spend figure
    }

    if (cap === 0n) {
      refusals.push({
        reason: 'cap_exceeded',
        window,
        detail: `The ${window} cap is zero micros, so no spend is authorized in this window.`,
      });
      windowFailed = true;
    } else if (spent >= cap) {
      refusals.push({
        reason: 'cap_exceeded',
        window,
        detail: `The ${window} cap of ${budget.capMicros} micros is already spent `
          + `(${budget.spentMicros}).`,
      });
      windowFailed = true;
    }

    const remaining = cap - spent;
    const spendable = remaining - reserved;

    if (!windowFailed) {
      if (runCap === null) {
        // The other direction of the same rule: a run whose own ceiling is
        // unknown cannot be shown to fit inside a bounded window. Review
        // found this authorizing — declaring the cap Unknown was strictly
        // more permissive than declaring any number, which is the rule this
        // module is named for, inverted.
        refusals.push({
          reason: 'unknown_run_cap_against_a_cap',
          window,
          detail: `The ${window} window is bounded at ${budget.capMicros} micros but this run's own `
            + 'ceiling is Unknown. An unknown ceiling cannot be shown to fit, and Unknown is not '
            + 'zero.',
        });
        windowFailed = true;
      } else if (runCap > remaining) {
        // It would not fit even if nothing were reserved: the cap is the
        // binding constraint, and the reason says so.
        refusals.push({
          reason: 'cap_exceeded',
          window,
          detail: `This run may spend up to ${request.runCapMicros} micros but only ${remaining} `
            + `remain in the ${window} window.`,
        });
        windowFailed = true;
      } else if (runCap > spendable) {
        // It fits the cap and fails only because of the reservation. Review
        // found this reported as `cap_exceeded`, which was false: the cap was
        // not exceeded, and a machine reading the reason would act on a lie.
        refusals.push({
          reason: 'reviewer_budget_would_be_consumed',
          window,
          detail: `This run may spend up to ${request.runCapMicros} micros and ${remaining} remain `
            + `in the ${window} window, but ${request.reservedReviewerMicros} is reserved for the `
            + 'Reviewer, so the run would consume the budget its own verification needs.',
        });
        windowFailed = true;
      }
    }

    // INDEPENDENT of the cap checks: a window can be under its cap and over
    // its pause threshold at the same time, and an operator needs both facts.
    if (pauseNumerator !== null) {
      // Exact integer comparison, no truncation: spent/cap >= num/den becomes
      // spent*den >= num*cap. Review found the permille division truncating
      // fail-open (66.67% read as 666‰ against a 667‰ threshold).
      if (spent * PAUSE_DENOMINATOR >= pauseNumerator * cap) {
        refusals.push({
          reason: 'auto_pause_threshold_reached',
          window,
          detail: `The ${window} window has spent ${budget.spentMicros} of ${budget.capMicros} `
            + 'micros, at or past the automatic pause threshold. The schedule pauses itself rather '
            + 'than spending to the limit.',
        });
        windowFailed = true;
      }
    }

    if (windowFailed) continue;
    tightestHeadroom = tightestHeadroom === null || spendable < tightestHeadroom
      ? spendable : tightestHeadroom;
  }

  if (refusals.length > 0) return { kind: 'budget_blocked', refusals };

  return {
    kind: 'authorized',
    // `null` when every window was unbounded: the headroom is genuinely not a
    // number, and reporting one would invent a ceiling nobody configured.
    headroomMicros: tightestHeadroom === null ? null : tightestHeadroom.toString(),
  };
}
