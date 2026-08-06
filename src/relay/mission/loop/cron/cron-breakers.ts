/**
 * SUNDAY RELAY — WHEN A SCHEDULE STOPS ITSELF, AND WHAT IT OWES THE USER.
 *
 * CRON_LOOPS.md names twelve conditions that pause a schedule automatically,
 * six things the user must then be able to see, and one rule for resuming:
 * "Resuming requires the condition to re-evaluate clean."
 *
 * THE HARD PART IS NOT TRIPPING. It is the disclosure, and one field in it:
 * **whether any external effect occurred**. A schedule that paused after
 * touching the outside world is a different situation from one that paused
 * before, and the difference decides whether a human must look. So the
 * external-effect answer is THREE-VALUED — occurred, did not occur, or
 * UNKNOWN — and Unknown is never rendered as "no". A breaker that reports a
 * confident "no external effect" it cannot support is worse than one that
 * does not report at all, because it ends the investigation.
 *
 * RESUMING IS THE SAME RULE FROM THE OTHER SIDE. A condition that cannot be
 * OBSERVED has not re-evaluated clean, so it does not permit a resume. Only
 * an observation that says "clear" clears anything; silence does not.
 */

/** One condition's current reading. `unknown` is a first-class answer. */
export type BreakerReading = 'clear' | 'tripped' | 'unknown';

export const BREAKER_CONDITIONS = [
  'repeated_consecutive_failures',
  'repeated_authentication_failures',
  'mcp_revoked',
  'provider_unavailable',
  'cost_threshold_or_spike',
  'repeated_reviewer_rejection',
  'external_rate_limited',
  'repeated_duplicate_external_actions',
  'repository_or_workspace_disappeared',
  'organization_membership_changed',
  'security_policy_changed',
  'credential_scopes_reduced',
] as const;
export type BreakerCondition = (typeof BREAKER_CONDITIONS)[number];

/**
 * Conditions that mean somebody's ACCESS or POLICY changed underneath the
 * schedule. A pause on one of these always needs a human, because the
 * schedule cannot tell whether the change was intended — and re-running work
 * under changed authority is how a revoked permission gets exercised anyway.
 *
 * This is a CLASSIFICATION of the twelve, not a new founder decision: each
 * one here is an access or policy fact in the spec's own wording.
 */
export const SECURITY_CLASS_CONDITIONS: readonly BreakerCondition[] = [
  'mcp_revoked',
  'repeated_authentication_failures',
  'organization_membership_changed',
  'security_policy_changed',
  'credential_scopes_reduced',
];

export interface BreakerSignals {
  readonly readings: Readonly<Record<BreakerCondition, BreakerReading>>;
  /**
   * Did this schedule's work reach outside Relay? `null` is UNKNOWN, and
   * Unknown is never reported as "no external effect".
   */
  readonly externalEffectOccurred: boolean | null;
  /** The last run that completed without tripping anything. `null` when
   *  there has never been one — which is not the same as "unknown". */
  readonly lastSafeRunId: string | null;
  readonly lastFailureRunId: string | null;
}

export interface BreakerDisclosure {
  /** Why it paused. Empty only when it did not pause. */
  readonly trippedBy: readonly BreakerCondition[];
  /** Conditions that could not be read. They neither trip nor clear — but
   *  they DO block a resume, because unobserved is not clean. */
  readonly unreadable: readonly BreakerCondition[];
  readonly lastSafeRunId: string | null;
  readonly lastFailureRunId: string | null;
  /**
   * `true`, `false`, or `null` for UNKNOWN. A surface must render `null` as
   * Unknown and never as "no".
   */
  readonly externalEffectOccurred: boolean | null;
  readonly manualReviewRequired: boolean;
  /** What a human has to do, in a sentence a surface can print. */
  readonly requiredAction: string;
}

export type BreakerVerdict =
  | { readonly state: 'running'; readonly disclosure: BreakerDisclosure }
  | { readonly state: 'paused'; readonly disclosure: BreakerDisclosure };

/** Evaluate every condition and say what the user is owed. */
export function evaluateCircuitBreakers(signals: BreakerSignals): BreakerVerdict {
  const trippedBy: BreakerCondition[] = [];
  const unreadable: BreakerCondition[] = [];
  for (const condition of BREAKER_CONDITIONS) {
    const reading = signals.readings[condition];
    if (reading === 'tripped') trippedBy.push(condition);
    else if (reading !== 'clear') unreadable.push(condition);
  }

  // A HUMAN IS NEEDED when the outside world was touched, when it MIGHT have
  // been, or when access or policy changed underneath the schedule. Unknown
  // counts as "might have been" — that is the whole reason it is a distinct
  // value rather than a default of `false`.
  const externalUnknownOrOccurred = signals.externalEffectOccurred !== false;
  const securityTripped = trippedBy.some((c) => SECURITY_CLASS_CONDITIONS.includes(c));
  const paused = trippedBy.length > 0;
  const manualReviewRequired = paused && (externalUnknownOrOccurred || securityTripped);

  const disclosure: BreakerDisclosure = {
    trippedBy,
    unreadable,
    lastSafeRunId: signals.lastSafeRunId,
    lastFailureRunId: signals.lastFailureRunId,
    externalEffectOccurred: signals.externalEffectOccurred,
    manualReviewRequired,
    requiredAction: requiredActionFor({ paused, trippedBy, unreadable, signals, manualReviewRequired }),
  };

  return paused ? { state: 'paused', disclosure } : { state: 'running', disclosure };
}

export type ResumeDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal: 'still_tripped' | 'not_re_evaluated';
      readonly conditions: readonly BreakerCondition[];
      readonly problem: string;
    };

/**
 * May a paused schedule resume?
 *
 * "Resuming requires the condition to re-evaluate CLEAN." Two ways that
 * fails, and they are different facts: the condition still reads tripped, or
 * it could not be read at all. The second is the one a permissive
 * implementation gets wrong — an unobservable condition has not been shown
 * clean, and resuming on silence is resuming on an assumption.
 */
export function mayResumeAfterBreaker(signals: BreakerSignals): ResumeDecision {
  const stillTripped = BREAKER_CONDITIONS.filter((c) => signals.readings[c] === 'tripped');
  if (stillTripped.length > 0) {
    return {
      ok: false,
      refusal: 'still_tripped',
      conditions: stillTripped,
      problem: `These conditions still read tripped: ${stillTripped.join(', ')}. A schedule resumes `
        + 'when the condition that stopped it re-evaluates clean, not when someone asks twice.',
    };
  }

  const unreadable = BREAKER_CONDITIONS.filter((c) => signals.readings[c] !== 'clear');
  if (unreadable.length > 0) {
    return {
      ok: false,
      refusal: 'not_re_evaluated',
      conditions: unreadable,
      problem: `These conditions could not be read: ${unreadable.join(', ')}. Unobserved is not `
        + 'clean, so nothing here has re-evaluated and the schedule stays paused.',
    };
  }

  return { ok: true };
}

function requiredActionFor(input: {
  readonly paused: boolean;
  readonly trippedBy: readonly BreakerCondition[];
  readonly unreadable: readonly BreakerCondition[];
  readonly signals: BreakerSignals;
  readonly manualReviewRequired: boolean;
}): string {
  if (!input.paused) {
    return input.unreadable.length === 0
      ? 'None. Every condition reads clear.'
      : `None right now, but ${input.unreadable.length} condition(s) could not be read, so the `
        + 'schedule cannot be resumed from a pause until they can be.';
  }

  const external = input.signals.externalEffectOccurred;
  const externalSentence = external === true
    ? ' This schedule DID reach outside Relay before pausing, so check what it changed there.'
    : external === null
      ? ' Whether it reached outside Relay is UNKNOWN — that is not the same as no, and it has to '
        + 'be established before any resume.'
      : ' It did not reach outside Relay.';

  return `Paused by: ${input.trippedBy.join(', ')}.${externalSentence}`
    + (input.manualReviewRequired
      ? ' A human must review before this schedule runs again.'
      : ' It resumes once every condition re-evaluates clean.');
}
