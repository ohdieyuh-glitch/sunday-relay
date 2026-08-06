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
 *
 * WHAT THIS MODULE REFUSES TO DECIDE. Whether a schedule whose breakers
 * cannot be READ AT ALL should keep running is NOT settled by CRON_LOOPS.md
 * — the spec covers tripping and resuming, and says nothing about total
 * unobservability. The first version of this module answered "keep running"
 * and wrote that answer into the spec in the same commit, then cited the doc
 * as though the founder had decided it. Review caught the circularity.
 *
 * So there is now a THIRD verdict state, `unobserved`, and the caller
 * chooses. The module reports what it can see and what it cannot; it does not
 * quietly pick fail-open for a scheduler that spends money, and it does not
 * quietly pick fail-closed for a founder who never asked for that either.
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
  // "Disappeared" covers access revoked, deleted AND renamed — and a name
  // that resolves again later may be a DIFFERENT repository. The class's own
  // basis applies verbatim: a schedule cannot tell whether the change was
  // intended. Review found excluding it was a silent decision about when a
  // human is needed.
  'repository_or_workspace_disappeared',
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
  | { readonly state: 'paused'; readonly disclosure: BreakerDisclosure }
  /**
   * NOTHING could be read. Deliberately not `running` and not `paused`: the
   * spec does not say which a schedule should be here, so the caller decides
   * with the facts in front of it rather than inheriting a default this
   * module invented.
   */
  | { readonly state: 'unobserved'; readonly disclosure: BreakerDisclosure }
  /** The signals could not be evaluated at all. */
  | { readonly state: 'refused'; readonly refusal: BreakerRefusal; readonly problem: string };

export type BreakerRefusal =
  | 'malformed_reading'
  | 'contradictory_external_effect';

/** Conditions whose very meaning is that Relay acted on the outside world.
 *  Reporting one of these alongside "no external effect" is a contradiction,
 *  not a state — review found it answered confidently instead of refused. */
const EXTERNAL_BY_DEFINITION: readonly BreakerCondition[] = [
  'repeated_duplicate_external_actions',
  'external_rate_limited',
];

const READINGS: readonly BreakerReading[] = ['clear', 'tripped', 'unknown'];

/** Evaluate every condition and say what the user is owed. */
export function evaluateCircuitBreakers(signals: BreakerSignals): BreakerVerdict {
  // A READING THAT IS NOT A READING IS NOT "UNKNOWN". The first version's
  // `!== 'clear'` fallback turned a producer's typo — 'TRIPPED' — into
  // unreadable, and unreadable did not pause: a real trip silently downgraded
  // into carrying on. Refused instead.
  const malformed = BREAKER_CONDITIONS
    .filter((c) => !READINGS.includes(signals.readings[c]));
  if (malformed.length > 0) {
    return {
      state: 'refused',
      refusal: 'malformed_reading',
      problem: `These conditions carry values that are not readings: ${malformed.join(', ')}. `
        + 'A malformed reading is not "unknown" — treating it as one would let a mistyped trip '
        + 'read as carry-on.',
    };
  }

  const trippedBy: BreakerCondition[] = [];
  const unreadable: BreakerCondition[] = [];
  for (const condition of BREAKER_CONDITIONS) {
    const reading = signals.readings[condition];
    if (reading === 'tripped') trippedBy.push(condition);
    else if (reading === 'unknown') unreadable.push(condition);
  }

  // A CONTRADICTION IS NOT A STATE. "Repeated duplicate EXTERNAL actions"
  // cannot coexist with "nothing reached outside Relay", and answering it
  // emits exactly the confident "no external effect" this module's header
  // calls worse than saying nothing.
  const contradiction = trippedBy.filter((c) => EXTERNAL_BY_DEFINITION.includes(c));
  if (contradiction.length > 0 && signals.externalEffectOccurred === false) {
    return {
      state: 'refused',
      refusal: 'contradictory_external_effect',
      problem: `${contradiction.join(', ')} means Relay acted on the outside world, but the `
        + 'external effect is reported as none. One of the two observations is wrong, and '
        + 'answering would assert a "no external effect" that cannot be true.',
    };
  }

  // A HUMAN IS NEEDED when the outside world was touched, when it MIGHT have
  // been, or when access or policy changed underneath the schedule. Unknown
  // counts as "might have been" — that is the whole reason it is a distinct
  // value rather than a default of `false`.
  const externalUnknownOrOccurred = signals.externalEffectOccurred !== false;
  const securityTripped = trippedBy.some((c) => SECURITY_CLASS_CONDITIONS.includes(c));
  const paused = trippedBy.length > 0;
  const manualReviewRequired = paused && (externalUnknownOrOccurred || securityTripped);
  const nothingObserved = unreadable.length === BREAKER_CONDITIONS.length;

  const disclosure: BreakerDisclosure = {
    trippedBy,
    unreadable,
    lastSafeRunId: signals.lastSafeRunId,
    lastFailureRunId: signals.lastFailureRunId,
    externalEffectOccurred: signals.externalEffectOccurred,
    manualReviewRequired,
    requiredAction: requiredActionFor({ paused, trippedBy, unreadable, signals, manualReviewRequired }),
  };

  if (paused) return { state: 'paused', disclosure };
  return nothingObserved ? { state: 'unobserved', disclosure } : { state: 'running', disclosure };
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
    ? ' An external EFFECT occurred before it paused, so check what changed out there.'
    : external === null
      ? ' Whether it reached outside Relay is UNKNOWN — that is not the same as no, and it has to '
        + 'be established before any resume.'
      : ' It did not reach outside Relay.';

  // The unreadable count belongs in the PAUSED sentence too: review found the
  // user told the resume waits on the failure clearing when it actually waits
  // on observability.
  const unreadableSentence = input.unreadable.length === 0
    ? ''
    : ` ${input.unreadable.length} condition(s) also could not be read, and a resume needs every `
      + 'one of them readable and clear.';

  return `Paused by: ${input.trippedBy.join(', ')}.${externalSentence}${unreadableSentence}`
    + (input.manualReviewRequired
      ? ' A human must review before this schedule runs again.'
      : ' It resumes once every condition re-evaluates clean.');
}
