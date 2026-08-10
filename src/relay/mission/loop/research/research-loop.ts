import { contentFingerprint, outranks, type EvidenceArtifact } from '../../evidence';
import type { LiveReachSource } from '../../live-reach';

/**
 * RESEARCH LOOPS — propose, gather, evaluate, keep or revert, record, repeat.
 *
 * This is NOT a second loop engine. The Loop Engine already owns iterations,
 * limits, stop conditions, states and decisions, and already has `research` in
 * its loop types. What was missing is the part specific to research: what a
 * question is, what counts as an answer, and who is allowed to change either.
 *
 * THE FREEZE IS THE WHOLE POINT.
 *
 * A loop that can edit its own success criteria will always succeed. So the
 * plan — the question, the criteria, the evaluator, the permitted sources, the
 * reviewer-independence requirement — is fingerprinted when the loop starts,
 * and every iteration is evaluated against THAT fingerprint. An iteration
 * carrying a different one is refused rather than evaluated, because the
 * alternative is a loop that quietly moved its own goalposts and reported
 * success.
 *
 * INCONCLUSIVE IS A REAL OUTCOME. A round that neither confirmed nor refuted
 * is not a failure and is not a pass; forcing it into either is how research
 * loops become theatre. It is recorded as itself, and it does not advance the
 * question.
 *
 * Pure: no clock, no network, no Node. Evidence arrives already retrieved and
 * already normalized.
 */

/* ---------------------------------------------------------- the plan */

export interface ResearchCriterion {
  readonly id: string;
  readonly text: string;
  /** A blocking criterion must be satisfied for the question to be answered. */
  readonly blocking: boolean;
  /**
   * The weakest authority that may satisfy this criterion.
   *
   * A question about what a library does is answered by the library, not by a
   * forum agreeing about it. Stating the bar per criterion is what stops a
   * loop from accumulating agreement and calling it evidence.
   */
  readonly minimumAuthority: 'primary' | 'secondary' | 'community';
}

export interface ResearchPlan {
  readonly planId: string;
  readonly question: string;
  readonly criteria: readonly ResearchCriterion[];
  /** Who evaluates. Frozen with everything else: swapping the judge mid-loop
   *  is the same defect as editing the criteria. */
  readonly evaluatorId: string;
  /** Sources this loop may draw on. Empty means any permitted source. */
  readonly permittedSources: readonly LiveReachSource[];
  /**
   * Whether the reviewer must be independent of whoever proposed.
   *
   * Carried in the frozen plan rather than checked ad hoc, so a loop cannot
   * relax it between iterations.
   */
  readonly requiresIndependentReview: boolean;
  /** How stale evidence may be, in minutes, or null for no requirement. */
  readonly maximumEvidenceAgeMinutes: number | null;
}

/**
 * A fingerprint over everything that decides what counts as an answer.
 *
 * Deliberately includes the evaluator and the independence requirement, and
 * deliberately EXCLUDES the plan id — renaming a plan is not changing it, and
 * a fingerprint that moved on a rename would refuse honest loops.
 */
export function fingerprintPlan(plan: ResearchPlan): string {
  const canonical = JSON.stringify({
    question: plan.question,
    criteria: [...plan.criteria]
      .map((c) => ({ id: c.id, text: c.text, blocking: c.blocking, minimumAuthority: c.minimumAuthority }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    evaluatorId: plan.evaluatorId,
    permittedSources: [...plan.permittedSources].sort(),
    requiresIndependentReview: plan.requiresIndependentReview,
    maximumEvidenceAgeMinutes: plan.maximumEvidenceAgeMinutes,
  });
  return contentFingerprint(canonical);
}

export interface FrozenResearchPlan {
  readonly plan: ResearchPlan;
  readonly fingerprint: string;
  readonly frozenAt: string;
}

/** Freeze a plan. `frozenAt` arrives from the caller; this module has no clock. */
export function freezeResearchPlan(plan: ResearchPlan, frozenAt: string): FrozenResearchPlan {
  return { plan, fingerprint: fingerprintPlan(plan), frozenAt };
}

/* ------------------------------------------------------ the iteration */

export const RESEARCH_VERDICTS = ['kept', 'reverted', 'inconclusive', 'refused'] as const;
export type ResearchVerdict = (typeof RESEARCH_VERDICTS)[number];

export const RESEARCH_REFUSALS = [
  'plan_changed',
  'source_not_permitted',
  'reviewer_not_independent',
  'no_evidence',
] as const;
export type ResearchRefusal = (typeof RESEARCH_REFUSALS)[number];

export interface CriterionOutcome {
  readonly criterionId: string;
  readonly satisfied: boolean;
  /** Evidence that met the authority bar, if any did. */
  readonly satisfiedBy: readonly string[];
  /** Why not, when not. Always a sentence. */
  readonly reason: string;
}

export interface ResearchIterationResult {
  readonly verdict: ResearchVerdict;
  readonly refusal: ResearchRefusal | null;
  readonly criteria: readonly CriterionOutcome[];
  /** Every reason this round did not settle the question. */
  readonly openReasons: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly detail: string;
}

export interface ResearchIterationInput {
  readonly frozen: FrozenResearchPlan;
  /** The fingerprint the ITERATION believes it is working to. */
  readonly planFingerprint: string;
  readonly evidence: readonly EvidenceArtifact[];
  /** Who proposed this round, and who is reviewing it. */
  readonly proposedBy: string;
  readonly reviewedBy: string | null;
  /** Which criteria this round claims to satisfy. Checked, not trusted. */
  readonly claimedCriterionIds: readonly string[];
}

const AUTHORITY_ORDER = { primary: 'primary', secondary: 'secondary', community: 'community' } as const;

/** Whether an artifact's authority meets a criterion's bar. */
function meetsAuthority(artifact: EvidenceArtifact, minimum: ResearchCriterion['minimumAuthority']): boolean {
  if (artifact.authority === AUTHORITY_ORDER[minimum]) return true;
  return outranks(artifact.authority, AUTHORITY_ORDER[minimum]);
}

/**
 * Evaluate one round against the FROZEN plan.
 *
 * Refusals come first and stop everything: a round working to a different plan,
 * drawing on a source the plan did not permit, or reviewed by the person who
 * proposed it is not a round that produced a weak answer — it is a round whose
 * answer cannot be read at all.
 */
export function evaluateResearchIteration(input: ResearchIterationInput): ResearchIterationResult {
  const { plan } = input.frozen;
  const refuse = (refusal: ResearchRefusal, detail: string): ResearchIterationResult => ({
    verdict: 'refused',
    refusal,
    criteria: [],
    openReasons: [detail],
    evidenceIds: input.evidence.map((e) => e.evidenceId),
    detail,
  });

  if (input.planFingerprint !== input.frozen.fingerprint) {
    // The defence against a loop that succeeds by editing its own definition
    // of success.
    return refuse(
      'plan_changed',
      'This iteration was evaluated against a plan that is not the one this loop froze. Criteria, evaluator, permitted sources and the independence requirement are fixed for the life of a loop.',
    );
  }

  if (plan.permittedSources.length > 0) {
    const stray = input.evidence.find((e) => !plan.permittedSources.includes(e.source));
    if (stray !== undefined) {
      return refuse(
        'source_not_permitted',
        `Evidence ${stray.evidenceId} came from ${stray.source}, which this loop's plan does not permit.`,
      );
    }
  }

  if (plan.requiresIndependentReview
    && (input.reviewedBy === null || input.reviewedBy === input.proposedBy)) {
    return refuse(
      'reviewer_not_independent',
      input.reviewedBy === null
        ? 'This loop requires an independent review and no reviewer is recorded.'
        : `${input.reviewedBy} both proposed and reviewed this round, which is not an independent review.`,
    );
  }

  if (input.evidence.length === 0) {
    return refuse('no_evidence', 'No evidence was gathered, so nothing was tested.');
  }

  const openReasons: string[] = [];
  const criteria: CriterionOutcome[] = plan.criteria.map((criterion) => {
    const claimed = input.claimedCriterionIds.includes(criterion.id);
    const qualifying = input.evidence.filter((artifact) => {
      if (!meetsAuthority(artifact, criterion.minimumAuthority)) return false;
      if (plan.maximumEvidenceAgeMinutes === null) return true;
      // UNKNOWN AGE CANNOT SATISFY AN AGE REQUIREMENT. A plan that demands
      // evidence younger than a day is not satisfied by evidence of unknown
      // date, however recently it was fetched.
      if (artifact.age.minutes === null) return false;
      return artifact.age.minutes <= plan.maximumEvidenceAgeMinutes;
    });

    if (!claimed) {
      return {
        criterionId: criterion.id,
        satisfied: false,
        satisfiedBy: [],
        reason: 'This round did not claim to address this criterion.',
      };
    }
    if (qualifying.length === 0) {
      const reason = `Claimed, but no evidence met the ${criterion.minimumAuthority} authority bar${
        plan.maximumEvidenceAgeMinutes === null ? '' : ' and freshness requirement'}.`;
      return { criterionId: criterion.id, satisfied: false, satisfiedBy: [], reason };
    }
    return {
      criterionId: criterion.id,
      satisfied: true,
      satisfiedBy: qualifying.map((e) => e.evidenceId),
      reason: `Satisfied by ${String(qualifying.length)} qualifying observation(s).`,
    };
  });

  for (const outcome of criteria) {
    if (!outcome.satisfied) {
      const criterion = plan.criteria.find((c) => c.id === outcome.criterionId);
      if (criterion?.blocking === true) openReasons.push(`${criterion.id}: ${outcome.reason}`);
    }
  }

  const blocking = plan.criteria.filter((c) => c.blocking);
  const allBlockingSatisfied = blocking.every(
    (c) => criteria.find((o) => o.criterionId === c.id)?.satisfied === true,
  );
  const anySatisfied = criteria.some((o) => o.satisfied);

  if (allBlockingSatisfied && blocking.length > 0) {
    return {
      verdict: 'kept',
      refusal: null,
      criteria,
      openReasons,
      evidenceIds: input.evidence.map((e) => e.evidenceId),
      detail: 'Every blocking criterion was satisfied by qualifying evidence.',
    };
  }

  // NOTHING SATISFIED AND NOTHING CONTRADICTED is inconclusive, not failure.
  // Reverting means this round's direction was wrong; inconclusive means it
  // did not settle anything, and the difference is what stops a loop from
  // discarding a line of enquiry that simply needs another round.
  if (!anySatisfied) {
    return {
      verdict: 'inconclusive',
      refusal: null,
      criteria,
      openReasons: openReasons.length > 0 ? openReasons : ['No criterion was satisfied by qualifying evidence.'],
      evidenceIds: input.evidence.map((e) => e.evidenceId),
      detail: 'This round neither satisfied nor contradicted the question.',
    };
  }

  return {
    verdict: 'reverted',
    refusal: null,
    criteria,
    openReasons,
    evidenceIds: input.evidence.map((e) => e.evidenceId),
    detail: 'Some criteria were satisfied and at least one blocking criterion was not.',
  };
}

/** Whether the loop has an answer it may act on. Only `kept` qualifies. */
export function questionAnswered(result: ResearchIterationResult): boolean {
  return result.verdict === 'kept';
}
