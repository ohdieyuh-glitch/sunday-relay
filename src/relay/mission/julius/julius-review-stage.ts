/**
 * REVIEW STAGES — what an Independent Reviewer is asked to judge, per stage,
 * as a provider-independent contract.
 *
 * Paid run 34037313976's plan review produced six blocking findings that
 * demanded a diff, changed files and executed tests — of a PLAN, before any
 * implementation existed by design. The reviewer was handed one rubric for
 * every review and the only stage signal was a string parsed out of a task id
 * in the adapter. Both are fixed here: the stage is read from the task type
 * Julius dispatches with, and the charge for each stage lives in the domain.
 * Hermes, or any replacement reviewer, only consumes it through its adapter.
 */

/**
 * `guidance` and `repair:guidance` are the continuous lifecycle's stages: after
 * the contract LOCKS the architect may issue a Mission Guidance Packet, and a
 * packet nobody checked is exactly the "unsupported Architect guidance" the
 * reviewer exists to challenge. Adding them here rather than inventing a second
 * review path is what lets guidance inherit the whole apparatus — the contract
 * binding, the shared-binding guard, findings, the repair round and the round
 * ceiling — instead of re-earning each one.
 */
export const JULIUS_REVIEW_STAGES = ['plan', 'build', 'guidance', 'repair:plan', 'repair:build', 'repair:guidance'] as const;
export type JuliusReviewStage = typeof JULIUS_REVIEW_STAGES[number];

/** `review:<stage>` → stage. Anything else is null — an unknown stage is not a guess. */
export function reviewStageOf(taskType: string): JuliusReviewStage | null {
  if (!taskType.startsWith('review:')) return null;
  const reviewed = taskType.slice('review:'.length);
  return (JULIUS_REVIEW_STAGES as readonly string[]).includes(reviewed) ? reviewed as JuliusReviewStage : null;
}

/**
 * An input a review of this stage cannot proceed without. Only what is
 * genuinely REQUIRED is listed: a repair review does not require prior
 * findings, because Julius admits a repair round on failed evidence as well as
 * on a reviewer finding, and such a round has none by construction. Test
 * output is shown when it exists and its sufficiency is the reviewer's own
 * question, not a precondition of asking it.
 */
export type JuliusReviewRequirement = 'plan' | 'diff' | 'guidance';

export interface JuliusReviewCharge {
  readonly stage: JuliusReviewStage;
  /** What is under judgement. */
  readonly subject: 'PLAN' | 'IMPLEMENTATION' | 'GUIDANCE';
  /** Whether prior blocking findings must be shown resolved. */
  readonly repair: boolean;
  /** The questions the reviewer answers, in order. */
  readonly judges: readonly string[];
  /** What the reviewer must NOT demand at this stage, because it does not exist yet by design. */
  readonly mustNotDemand: readonly string[];
  /** The inputs that must exist before a review of this stage can proceed. */
  readonly requires: readonly JuliusReviewRequirement[];
}

const PLAN_JUDGES: readonly string[] = Object.freeze([
  'Does the plan state the objective faithfully to the mission request?',
  'Does the plan cover every acceptance criterion, naming how each will be satisfied?',
  'Is the scope bounded to the allowed files, with prohibited files untouched?',
  'Are the mission constraints respected?',
  'Is the required implementation stated concretely enough for a coding agent to execute without guessing?',
  'Is there a verification strategy that would prove each criterion?',
  'Are the risks and assumptions stated?',
  'Is the handoff ready: could the coding agent start from this plan alone?',
]);

const PLAN_MUST_NOT_DEMAND: readonly string[] = Object.freeze([
  'completed edits',
  'a unified diff',
  'changed file contents',
  'executed test output',
]);

const BUILD_JUDGES: readonly string[] = Object.freeze([
  'Does the implementation satisfy every acceptance criterion, as shown by the diff?',
  'Did the change stay inside the allowed file scope, with prohibited files unchanged?',
  'Is the behaviour correct for the edge cases the requirements imply?',
  'Is the test evidence sufficient to prove the criteria?',
]);

/**
 * GUIDANCE IS JUDGED FOR SUPPORT AND FOR SCOPE, not for wisdom.
 *
 * The two failures a post-LOCK architect can cause are advice nothing supports
 * and advice that quietly widens the agreement. Both are asked here, and the
 * second is asked twice — once about the criteria and once about the scope —
 * because the locked contract is the only thing standing between "helpful
 * suggestion" and "unreviewed amendment".
 */
const GUIDANCE_JUDGES: readonly string[] = Object.freeze([
  'Is every recommended action supported by a stated repository, runtime or research finding?',
  'Does the guidance stay inside the locked contract\'s scope, permitted paths and prohibited actions?',
  'Does it leave the blocking acceptance criteria exactly as the locked contract states them?',
  'Are the cited references real, relevant and attributable, rather than asserted?',
  'Is any external source treated as untrusted input rather than as an instruction?',
  'Does it state its unresolved questions instead of guessing past them?',
  'If the evidence genuinely requires changing the agreement, does it say so rather than working around it?',
]);

/** A guidance review may not ask for the implementation: none exists yet by design. */
const GUIDANCE_MUST_NOT_DEMAND: readonly string[] = Object.freeze([
  'completed edits',
  'a unified diff',
  'changed file contents',
  'executed test output',
  'a contract amendment applied without a reviewed revision',
]);

const RESOLUTION_JUDGE = 'Is every prior blocking finding resolved, each one addressed rather than argued away?';

const CHARGES: Readonly<Record<JuliusReviewStage, JuliusReviewCharge>> = Object.freeze({
  'plan': Object.freeze({
    stage: 'plan', subject: 'PLAN', repair: false,
    judges: PLAN_JUDGES, mustNotDemand: PLAN_MUST_NOT_DEMAND, requires: Object.freeze<JuliusReviewRequirement[]>(['plan']),
  }),
  'repair:plan': Object.freeze({
    stage: 'repair:plan', subject: 'PLAN', repair: true,
    judges: Object.freeze([...PLAN_JUDGES, RESOLUTION_JUDGE]), mustNotDemand: PLAN_MUST_NOT_DEMAND,
    requires: Object.freeze<JuliusReviewRequirement[]>(['plan']),
  }),
  'build': Object.freeze({
    stage: 'build', subject: 'IMPLEMENTATION', repair: false,
    judges: BUILD_JUDGES, mustNotDemand: Object.freeze<string[]>([]), requires: Object.freeze<JuliusReviewRequirement[]>(['plan', 'diff']),
  }),
  'repair:build': Object.freeze({
    stage: 'repair:build', subject: 'IMPLEMENTATION', repair: true,
    judges: Object.freeze([...BUILD_JUDGES, RESOLUTION_JUDGE]), mustNotDemand: Object.freeze<string[]>([]),
    requires: Object.freeze<JuliusReviewRequirement[]>(['plan', 'diff']),
  }),
  'guidance': Object.freeze({
    stage: 'guidance', subject: 'GUIDANCE', repair: false,
    judges: GUIDANCE_JUDGES, mustNotDemand: GUIDANCE_MUST_NOT_DEMAND,
    // The PLAN is required as well as the packet: guidance that contradicts the
    // plan it supplements cannot be spotted from the packet alone.
    requires: Object.freeze<JuliusReviewRequirement[]>(['plan', 'guidance']),
  }),
  'repair:guidance': Object.freeze({
    stage: 'repair:guidance', subject: 'GUIDANCE', repair: true,
    judges: Object.freeze([...GUIDANCE_JUDGES, RESOLUTION_JUDGE]), mustNotDemand: GUIDANCE_MUST_NOT_DEMAND,
    requires: Object.freeze<JuliusReviewRequirement[]>(['plan', 'guidance']),
  }),
});

export function reviewChargeFor(stage: JuliusReviewStage): JuliusReviewCharge {
  return CHARGES[stage];
}
