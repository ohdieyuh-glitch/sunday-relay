/**
 * SUNDAY RELAY — COMPLETION IS EARNED, NOT CLAIMED.
 *
 * A model saying "done" is a CLAIM. In the Aquala trace vocabulary that is
 * literally the weakest of the four source-trust levels:
 *
 *   claim     — the actor reported something about its own work
 *   observed  — a supervisory system saw it, without attesting identity
 *   attested  — a trusted supervisory source or adapter produced attestation
 *   verified  — Relay or an authorized verification system validated evidence
 *
 * This module makes that vocabulary load-bearing for Loops: a `claim` can
 * never, on its own, end a Loop. It can only ever mark an iteration as
 * CLAIMED complete, which is a different thing and is recorded as such.
 *
 * WHY IT IS SEPARATE FROM THE MISSION VERDICT ENGINE. `evaluateMissionVerdict`
 * decides whether a MISSION is verified complete; this decides whether a LOOP
 * may stop iterating. They agree by construction — a Loop cannot complete
 * without a `verified_complete` mission verdict — but they answer different
 * questions and a Loop asks its own extra ones (are there unknown iterations?
 * did every required review actually happen?).
 *
 * PURE. No clock, no I/O.
 */

import type { AqualaTraceSourceTrust } from '../trace/trace-types';
import type { MissionCompletionRule, MissionVerdict } from '../contracts';

/**
 * Trust levels that may SUPPORT completion.
 *
 * `observed` is deliberately excluded alongside `claim`: seeing a process exit
 * is not the same as validating what it produced, and a Loop that stopped
 * because something was merely observed would be claiming more than it knows.
 */
export const COMPLETION_SUPPORTING_TRUSTS: readonly AqualaTraceSourceTrust[] = ['attested', 'verified'];

export function trustSupportsCompletion(trust: AqualaTraceSourceTrust): boolean {
  return COMPLETION_SUPPORTING_TRUSTS.includes(trust);
}

/* --------------------------------------------------------------- inputs */

/** One iteration's outcome, as the Loop runtime recorded it. */
export interface RelayLoopIterationOutcomeSummary {
  readonly iterationId: string;
  /** `unknown` means Relay could not confirm how it ended. Such an iteration
   *  is never replayed and never counts toward completion. */
  readonly outcome: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'unknown';
}

/** One piece of evidence offered in support of completion. */
export interface RelayLoopEvidenceSummary {
  readonly evidenceId: string;
  readonly sourceTrust: AqualaTraceSourceTrust;
  /** Which acceptance criteria this evidence speaks to. */
  readonly criterionIds: readonly string[];
}

export interface RelayLoopCompletionInput {
  readonly completionRule: MissionCompletionRule;
  readonly acceptanceCriteria: readonly { readonly id: string; readonly blocking: boolean }[];
  readonly evidence: readonly RelayLoopEvidenceSummary[];
  readonly iterations: readonly RelayLoopIterationOutcomeSummary[];
  /** The mission verdict engine's answer. Anything short of
   *  `verified_complete` blocks the Loop, whatever else is true. */
  readonly missionVerdict: MissionVerdict | null;
  readonly openBlockingFindings: number;
  readonly independentReviewRequired: boolean;
  readonly reviewOccurred: boolean;
  readonly reviewApproved: boolean;
  readonly reviewerWasIndependent: boolean;
  /** Whether the durable write of the terminal state has resolved. Announce
   *  facts, not intentions: a Loop is not complete until its completion is. */
  readonly terminalWriteDurable: boolean;
}

/* -------------------------------------------------------------- outcome */

export const RELAY_LOOP_COMPLETION_VERDICTS = [
  'verified_complete',
  'claimed_complete',
  'incomplete',
] as const;
export type RelayLoopCompletionVerdict = (typeof RELAY_LOOP_COMPLETION_VERDICTS)[number];

export interface RelayLoopCompletionResult {
  readonly verdict: RelayLoopCompletionVerdict;
  /** Deterministic, human-readable, in evaluation order. Never free-text
   *  agent output. */
  readonly reasons: readonly string[];
  readonly checks: readonly { readonly requirement: string; readonly passed: boolean; readonly detail: string }[];
  /** Blocking criteria with no supporting evidence at attested or better. */
  readonly unsupportedBlockingCriterionIds: readonly string[];
}

/**
 * Decide whether a Loop may complete.
 *
 * Every requirement is evaluated — the result reports ALL failures, not the
 * first, so a user fixing a Loop sees the whole list at once.
 *
 * The distinction that matters: a Loop whose only shortfall is trust returns
 * `claimed_complete`, not `incomplete`. Work happened and something asserted
 * it finished; what is missing is corroboration. Saying that precisely is more
 * useful than a flat failure, and it is the truthful shape of the situation.
 */
export function evaluateLoopCompletion(
  input: RelayLoopCompletionInput,
): RelayLoopCompletionResult {
  const checks: { requirement: string; passed: boolean; detail: string }[] = [];
  const reasons: string[] = [];

  const supporting = input.evidence.filter((e) => trustSupportsCompletion(e.sourceTrust));
  const supportedCriteria = new Set(supporting.flatMap((e) => e.criterionIds));
  const blocking = input.acceptanceCriteria.filter((c) => c.blocking);
  const unsupported = blocking.filter((c) => !supportedCriteria.has(c.id)).map((c) => c.id);

  const anyClaimOnly = input.evidence.length > 0 && supporting.length === 0;

  checks.push({
    requirement: 'blocking criteria supported by attested or verified evidence',
    passed: unsupported.length === 0,
    detail:
      unsupported.length === 0
        ? `All ${blocking.length} blocking criteria have supporting evidence.`
        : `${unsupported.length} blocking criteria have no evidence above "observed": ${unsupported.join(', ')}.`,
  });

  const unknownIterations = input.iterations.filter((i) => i.outcome === 'unknown');
  checks.push({
    requirement: 'no iteration ended in an unconfirmable state',
    passed: unknownIterations.length === 0,
    detail:
      unknownIterations.length === 0
        ? 'Every iteration has a confirmed outcome.'
        : `${unknownIterations.length} iteration(s) ended unconfirmably and are never replayed: ${unknownIterations
            .map((i) => i.iterationId)
            .join(', ')}.`,
  });

  checks.push({
    requirement: 'mission verdict is verified_complete',
    passed: input.missionVerdict === 'verified_complete',
    detail:
      input.missionVerdict === null
        ? 'The mission verdict is Unknown, which never counts as complete.'
        : `The mission verdict is "${input.missionVerdict}".`,
  });

  checks.push({
    requirement: 'no open blocking findings',
    passed: input.openBlockingFindings === 0,
    detail:
      input.openBlockingFindings === 0
        ? 'No blocking findings are open.'
        : `${input.openBlockingFindings} blocking finding(s) remain open.`,
  });

  const reviewNeeded =
    input.independentReviewRequired ||
    input.completionRule === 'all_blocking_criteria_and_independent_review';
  const reviewSatisfied =
    !reviewNeeded || (input.reviewOccurred && input.reviewApproved && input.reviewerWasIndependent);
  checks.push({
    requirement: 'required independent review approved the work',
    passed: reviewSatisfied,
    detail: !reviewNeeded
      ? 'No independent review is required by this completion rule.'
      : !input.reviewOccurred
        ? 'The required independent review has not run.'
        : !input.reviewerWasIndependent
          ? 'The review was not structurally independent of the implementer.'
          : input.reviewApproved
            ? 'An independent review approved the work.'
            : 'The independent review did not approve the work.',
  });

  checks.push({
    requirement: 'terminal state is durably written',
    passed: input.terminalWriteDurable,
    detail: input.terminalWriteDurable
      ? 'The terminal state write resolved.'
      : 'The terminal state has not been durably written — completion is not announced before it is a fact.',
  });

  for (const check of checks) {
    if (!check.passed) reasons.push(check.detail);
  }

  if (reasons.length === 0) {
    return { verdict: 'verified_complete', reasons: [], checks, unsupportedBlockingCriterionIds: [] };
  }

  // Work was reported and nothing corroborated it: that is a claim, and
  // calling it one is more truthful than calling it a failure.
  const onlyTrustIsMissing =
    (anyClaimOnly || unsupported.length > 0) &&
    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;

  return {
    verdict: onlyTrustIsMissing ? 'claimed_complete' : 'incomplete',
    reasons,
    checks,
    unsupportedBlockingCriterionIds: unsupported,
  };
}

/** A model's assertion, on its own, can never complete a Loop. */
export function claimAloneCompletes(): false {
  return false;
}
