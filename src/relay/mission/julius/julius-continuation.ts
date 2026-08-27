/**
 * AUTONOMY, AS A DECISION ABOUT CONTINUING.
 *
 * WHAT UNCHAINED DID BEFORE THIS. `autonomy` was read in exactly two places:
 * `evaluateJuliusPolicy` skipped the approval gate when it was `UNCHAINED`,
 * and the `UNCHAINED_CONTINUATION` case reported whether it was set. Nothing
 * else in the runtime consulted it, so a run marked UNCHAINED retried, routed,
 * repaired and spawned exactly like a SUPERVISED one. Unchained was a label.
 *
 * WHAT IT MEANS NOW. Autonomy decides ONE thing: whether the runtime may carry
 * on by itself after a decision point, or must stop and let a person decide.
 * It decides nothing about what is permitted — every situation below is first
 * put to `evaluateJuliusPolicy`, and a DENY is a DENY at every autonomy level.
 *
 *   SUPERVISED   stops at every decision point, even a permitted one. A
 *                supervised run is one a person is watching, and carrying on
 *                without them is the thing they asked not to happen.
 *   AUTONOMOUS   carries on where C.A.R.D. permits, and stops at the first
 *                bound it reaches.
 *   UNCHAINED    carries on where C.A.R.D. permits, including past the
 *                approval gates C.A.R.D. itself marks skippable.
 *
 * UNCHAINED IS NOT "PROTECTIONS OFF", and this module contains no branch that
 * could make it so. There is no code path here in which `autonomy` widens a
 * limit, admits a denied provider, permits a denied capability, raises a
 * budget, crosses a tenant, deepens a sub-agent tree or extends iterative
 * review past its C.A.R.D. round cap. Every one of those is asserted by a
 * bypass-attempt test rather than promised here.
 *
 * ON "HIGHER BOUNDED CONCURRENCY", stated honestly: UNCHAINED does not raise
 * `policy.concurrency`, because a C.A.R.D. ceiling is a ceiling. What differs
 * is that SUPERVISED runs ONE task at a time so a person can follow it, and
 * the other two levels use the width C.A.R.D. already granted. The difference
 * is that supervised is narrower, not that unchained is wider.
 */

import { evaluateJuliusPolicy, type JuliusCardPolicy, type JuliusPolicyOperation } from './julius-policy';
import type { JuliusErrorCode } from './julius-router';

/* ------------------------------------------------------------ situations */

/**
 * A POINT AT WHICH THE RUNTIME COULD CARRY ON OR COULD STOP.
 *
 * Each carries the numbers its own bound is checked against, because those
 * bounds belong to `evaluateJuliusPolicy` and this module supplies inputs to
 * it rather than re-deciding them.
 */
export type JuliusContinuation =
  | { readonly kind: 'RETRY'; readonly attempt: number; readonly maxAttempts: number; readonly errorCode: JuliusErrorCode }
  | { readonly kind: 'REROUTE'; readonly excludedWorkerIds: readonly string[]; readonly remainingWorkers: number }
  | { readonly kind: 'FALLBACK'; readonly providerId: string }
  | { readonly kind: 'REPAIR'; readonly round: number; readonly maxRounds: number }
  | { readonly kind: 'ITERATIVE_REVIEW'; readonly round: number }
  | { readonly kind: 'SUBAGENT'; readonly depth: number; readonly active: number; readonly total: number };

export type JuliusContinuationDecision =
  | {
    readonly proceed: true;
    /** True when nothing was asked of a person. */
    readonly automatic: true;
    readonly reasonCode: string;
    readonly limit: number | null;
  }
  | {
    readonly proceed: false;
    readonly reasonCode: string;
    readonly safeRationale: string;
    /** True when a person could unblock this; false when policy forbids it. */
    readonly awaitingHuman: boolean;
  };

/* ------------------------------------------------------- the operation map */

/**
 * Which C.A.R.D. operation each continuation is governed by.
 *
 * A total map rather than a switch with a default: a continuation added
 * without an operation would otherwise silently inherit whatever the default
 * permitted, which is the shape of every "the new case was allowed by
 * accident" bug.
 */
const OPERATION_FOR: Readonly<Record<JuliusContinuation['kind'], JuliusPolicyOperation>> = Object.freeze({
  RETRY: 'AUTOMATIC_RETRY',
  REROUTE: 'DISPATCH_WORKER',
  FALLBACK: 'FALLBACK_PROVIDER',
  REPAIR: 'DISPATCH_WORKER',
  ITERATIVE_REVIEW: 'CONTINUE_ITERATIVE_REVIEW',
  SUBAGENT: 'SPAWN_SUBAGENT',
});

/**
 * SOME SITUATIONS ARE MORE THAN ONE QUESTION, AND A GAP IN #171 MAKES THAT
 * MATTER.
 *
 * `evaluateJuliusPolicy`'s `FALLBACK_PROVIDER` case reads `policy.fallback`
 * and NOTHING ELSE — it never looks at the provider being fallen back TO. So
 * "may this run fall back?" was being answered while "may it use THAT
 * provider?" went unasked, and a C.A.R.D. with `allowedProviders: []` would
 * still permit a fallback to any provider at all. The gap is invisible from
 * either side: the fallback rule is correct about fallback and the provider
 * rule is correct about providers; only the caller can notice that a fallback
 * IS a provider use.
 *
 * So a situation yields a LIST of policy questions and the strictest answer
 * wins. #171 is not changed: both rules it already owns are simply both asked.
 */
const policyChecks = (situation: JuliusContinuation): Parameters<typeof evaluateJuliusPolicy>[1][] => {
  const operation = OPERATION_FOR[situation.kind];
  switch (situation.kind) {
    case 'FALLBACK':
      return [
        { operation },
        { operation: 'USE_PROVIDER', providerId: situation.providerId },
      ];
    case 'ITERATIVE_REVIEW': return [{ operation, round: situation.round }];
    case 'SUBAGENT': return [{ operation, depth: situation.depth, active: situation.active, total: situation.total }];
    default: return [{ operation }];
  }
};

/**
 * The strictest of several verdicts: any DENY wins, then any REQUIRE_APPROVAL,
 * then the last permissive answer — whose `limit` is the one a caller cares
 * about, since the permissive answers are the bounded ones.
 */
function strictestVerdict(policy: JuliusCardPolicy, situation: JuliusContinuation) {
  const verdicts = policyChecks(situation).map((request) => evaluateJuliusPolicy(policy, request));
  return verdicts.find((verdict) => verdict.effect === 'DENY')
    ?? verdicts.find((verdict) => verdict.effect === 'REQUIRE_APPROVAL')
    ?? verdicts[verdicts.length - 1]!;
}

/* --------------------------------------------------------- the structural bounds */

/**
 * BOUNDS THAT ARE NOT C.A.R.D.'S, and are still absolute.
 *
 * A retry past its attempt ceiling and a repair past its round ceiling are
 * refused before policy is consulted at all: those numbers come from the
 * mission and the verification policy, and no autonomy level is a reason to
 * exceed a limit that was set somewhere else. Returning `awaitingHuman: false`
 * says so — a person cannot approve their way past an exhausted retry budget,
 * they can only start something new.
 */
function structuralRefusal(situation: JuliusContinuation): JuliusContinuationDecision | null {
  if (situation.kind === 'RETRY' && situation.attempt >= situation.maxAttempts) {
    return {
      proceed: false, reasonCode: 'RETRY_ATTEMPTS_EXHAUSTED', awaitingHuman: false,
      safeRationale: `This task has used all ${situation.maxAttempts} of its attempts.`,
    };
  }
  if (situation.kind === 'RETRY' && !RETRYABLE_CODES.includes(situation.errorCode)) {
    return {
      proceed: false, reasonCode: 'ERROR_NOT_RETRYABLE', awaitingHuman: false,
      safeRationale: `${situation.errorCode} does not become correct by being repeated.`,
    };
  }
  if (situation.kind === 'REPAIR' && situation.round > situation.maxRounds) {
    return {
      proceed: false, reasonCode: 'REPAIR_ROUNDS_EXHAUSTED', awaitingHuman: false,
      safeRationale: `This task has used all ${situation.maxRounds} of its repair rounds.`,
    };
  }
  if (situation.kind === 'REROUTE' && situation.remainingWorkers < 1) {
    return {
      proceed: false, reasonCode: 'NO_ALTERNATIVE_ROUTE', awaitingHuman: false,
      safeRationale: 'Every eligible worker has already been tried.',
    };
  }
  return null;
}

/**
 * WHICH FAILURES A REPEAT COULD PLAUSIBLY FIX.
 *
 * The same classification `JuliusDispatchError` carries as `retryable`, listed
 * here so the CONTINUATION decision does not depend on an error object being
 * handed along intact through however many layers. An authentication failure
 * and a malformed request are the same on the second attempt as on the first.
 */
const RETRYABLE_CODES: readonly JuliusErrorCode[] = Object.freeze(['RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE']);

/* ------------------------------------------------------------ the decision */

export function decideJuliusContinuation(
  policy: JuliusCardPolicy,
  situation: JuliusContinuation,
): JuliusContinuationDecision {
  const structural = structuralRefusal(situation);
  if (structural !== null) return structural;

  // C.A.R.D. FIRST, ALWAYS. Autonomy is consulted only after policy has said
  // the operation is permitted at all, so there is no ordering in which an
  // autonomy level could be reached with a denied operation in hand.
  const verdict = strictestVerdict(policy, situation);
  if (verdict.effect === 'DENY') {
    return {
      proceed: false, reasonCode: verdict.reasonCode, awaitingHuman: false,
      safeRationale: verdict.safeRationale,
    };
  }
  if (verdict.effect === 'REQUIRE_APPROVAL') {
    // Reached only when C.A.R.D. did NOT mark this operation skippable under
    // UNCHAINED — `evaluateJuliusPolicy` has already applied that rule. So
    // this is a gate the C.A.R.D. holds open for a person at every level.
    return {
      proceed: false, reasonCode: verdict.reasonCode, awaitingHuman: true,
      safeRationale: verdict.safeRationale,
    };
  }

  if (policy.autonomy === 'SUPERVISED') {
    return {
      proceed: false, reasonCode: 'SUPERVISED_STOP', awaitingHuman: true,
      safeRationale: `This run is supervised, so ${situation.kind.toLowerCase().replace('_', ' ')} waits for a person even though C.A.R.D. permits it.`,
    };
  }

  return {
    proceed: true, automatic: true,
    reasonCode: policy.autonomy === 'UNCHAINED' ? 'UNCHAINED_CONTINUATION' : 'AUTONOMOUS_CONTINUATION',
    limit: verdict.limit,
  };
}

/* ---------------------------------------------------------- concurrency */

/**
 * How many tasks this run may have in flight.
 *
 * NEVER MORE THAN `policy.concurrency`, at any autonomy level. SUPERVISED is
 * one, so a person can follow what is happening; the other two use the width
 * C.A.R.D. already granted. If `policy.concurrency` is malformed the answer is
 * one rather than a guess: a broken ceiling is not permission to be wide.
 */
export function continuationConcurrency(policy: JuliusCardPolicy): number {
  const ceiling = Number.isSafeInteger(policy.concurrency) && policy.concurrency > 0 ? policy.concurrency : 1;
  return policy.autonomy === 'SUPERVISED' ? 1 : ceiling;
}

/**
 * Whether a run at this autonomy level may act on its own AT ALL.
 *
 * Used by a caller that wants one question answered before assembling a
 * situation. It is deliberately NOT a shortcut around
 * {@link decideJuliusContinuation}: answering true here says only that the
 * level permits automation, never that this particular operation is permitted.
 */
export function autonomyPermitsAutomation(policy: JuliusCardPolicy): boolean {
  return policy.autonomy !== 'SUPERVISED';
}
