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
  /** What this run is authorized to spend at most, from its own budget. */
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
      && request.autoPauseAtFraction > 0 && request.autoPauseAtFraction <= 1)) {
    malformedFields.push('autoPauseAtFraction');
  }
  if (malformedFields.length > 0) {
    return {
      kind: 'budget_blocked',
      refusals: [{
        reason: 'invalid_budget_configuration',
        detail: `These are not budget values: ${malformedFields.join(', ')}. A malformed cap is a `
          + 'configuration defect, not a budget of zero and not one of infinity, so nothing was '
          + 'authorized.',
      }],
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

  let tightestHeadroom: bigint | null = null;
  for (const window of SPEND_WINDOWS) {
    const budget = request.windows[window];
    const cap = parse(budget.capMicros);
    if (cap === null) continue; // unbounded: no ceiling to violate

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
      continue;
    }

    const remaining = cap - spent;
    if (remaining <= 0n) {
      refusals.push({
        reason: 'cap_exceeded',
        window,
        detail: `The ${window} cap of ${budget.capMicros} micros is already spent `
          + `(${budget.spentMicros}).`,
      });
      continue;
    }

    // THE REVIEWER'S MONEY IS NOT HEADROOM. A run that eats the budget its
    // own verification needs produces an unreviewable result and a bill.
    const spendable = remaining - reserved;
    if (reserved > 0n && spendable <= 0n) {
      refusals.push({
        reason: 'reviewer_budget_would_be_consumed',
        window,
        detail: `Only ${remaining} micros remain in the ${window} window and `
          + `${request.reservedReviewerMicros} is reserved for the Reviewer, so a run here would `
          + 'consume the budget its own verification needs.',
      });
      continue;
    }

    if (runCap !== null && runCap > spendable) {
      refusals.push({
        reason: 'cap_exceeded',
        window,
        detail: `This run may spend up to ${request.runCapMicros} micros but only ${spendable} `
          + `remain in the ${window} window after the Reviewer's reservation.`,
      });
      continue;
    }

    if (request.autoPauseAtFraction !== null) {
      // Crossing the pause threshold is a DIFFERENT fact from exhausting the
      // cap: the schedule pauses itself before the money runs out, which is
      // the point of having a threshold at all.
      const spentPermille = (spent * 1000n) / cap;
      const thresholdPermille = BigInt(Math.round(request.autoPauseAtFraction * 1000));
      if (spentPermille >= thresholdPermille) {
        refusals.push({
          reason: 'auto_pause_threshold_reached',
          window,
          detail: `The ${window} window is at ${spentPermille}‰ of its cap and the automatic pause `
            + `threshold is ${thresholdPermille}‰. The schedule pauses itself rather than spending `
            + 'to the limit.',
        });
        continue;
      }
    }

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
