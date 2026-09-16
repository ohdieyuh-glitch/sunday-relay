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
/**
 * `rebuttal` is the disagreement's own stage. When the architect MAINTAINS a
 * challenged position, the reviewer that raised the challenge judges the
 * evidence behind it — once — and Julius resolves the disagreement on that
 * judgement. It has no repair stage: a rebuttal is never repaired, because the
 * bound is one answer and one re-review, and the argument does not go round.
 */
export const JULIUS_REVIEW_STAGES = ['plan', 'build', 'guidance', 'rebuttal', 'repair:plan', 'repair:build', 'repair:guidance'] as const;
export type JuliusReviewStage = typeof JULIUS_REVIEW_STAGES[number];

/**
 * THE REVIEW STAGES A MISSION RUNS WHEN NOTHING NEEDS REPAIRING — its normal
 * path, and the only one anything may budget against.
 *
 * DERIVED by removing the repair stages rather than written out, because a
 * seventh stage added above must appear here or be deliberately excluded, and a
 * second hand-kept list is how `MAX_REVIEWER_ATTEMPTS` came to describe two
 * stages long after there were six.
 *
 * A repair stage is NOT budgeted here and that is the point: a repair is a new
 * task Julius creates after a review that SUCCEEDED and asked for changes. It
 * is not another attempt at the review, and counting it as one would make a
 * reviewer doing its job look like a reviewer failing at it.
 */
export const JULIUS_NORMAL_REVIEW_STAGES: readonly JuliusReviewStage[] =
  Object.freeze(JULIUS_REVIEW_STAGES.filter((stage) => !stage.startsWith('repair:') && stage !== 'rebuttal'));

/**
 * THE CONDITIONAL STAGES, NAMED — the ones a healthy mission never runs.
 *
 * A repair review exists because a review asked for changes; a rebuttal review
 * exists because a reviewer challenged the architect and the architect
 * maintained its position. Both are real reviewer work, both spend from the same
 * reviewer share of the job, and neither belongs in the number that prices the
 * NORMAL path: budgeting them there prices the healthy mission for the unhealthy
 * one, which is the rule the repair stages were already excluded under.
 *
 * WHAT THIS COSTS, said plainly: a mission that argues once runs one review more
 * than its share was priced for, and one that also repairs runs more again. The
 * per-review deadline is unchanged; the job's own wall clock absorbs them, and
 * the drive stops at that deadline with the numbers on the record rather than
 * overrunning it.
 */
export const JULIUS_CONDITIONAL_REVIEW_STAGES: readonly JuliusReviewStage[] =
  Object.freeze(JULIUS_REVIEW_STAGES.filter((stage) => !JULIUS_NORMAL_REVIEW_STAGES.includes(stage)));

/**
 * ONE PIPELINE ATTEMPT PER REVIEW STAGE, AND NO AUTOMATIC SECOND.
 *
 * The generic `MAX_TASK_ATTEMPTS` gives every task three, which for a review is
 * three provider calls against the same packet, the same engine deadline and
 * the same prompt. The reviewer's observed failure is a request that outran the
 * engine's per-request timeout; repeating it verbatim reaches the same wall, so
 * the second and third attempts buy nothing and spend the job's reviewer share
 * doing it. That is a blind retry, which this system does not do.
 *
 * WHAT THIS DOES NOT REDUCE: the review itself. The reviewer keeps its full
 * deadline, its bounded in-adapter correction, its tools and its evidence
 * depth — one attempt is a whole review, not a shorter one. Transient provider
 * noise is the adapter's business and stays inside this same declared deadline.
 */
export const REVIEW_TASK_ATTEMPTS = 1;

/** `review:<stage>` → stage. Anything else is null — an unknown stage is not a guess. */
export function reviewStageOf(taskType: string): JuliusReviewStage | null {
  if (!taskType.startsWith('review:')) return null;
  const reviewed = taskType.slice('review:'.length);
  return (JULIUS_REVIEW_STAGES as readonly string[]).includes(reviewed) ? reviewed as JuliusReviewStage : null;
}

/**
 * THE STAGE A NON-REVIEW TASK EXECUTES UNDER — its own task type, when that
 * type names a stage.
 *
 * The pipeline used to derive this by elimination: not a reviewer and bound to
 * a contract meant the coder, so `repair:` prefixed meant `repair:build` and
 * everything else meant `build`. That was true while the coder was the only
 * bound non-review role. ADR-021 made the architect bound too, and the
 * elimination then labelled a guidance task's contract charge `build` — a
 * durable record saying the architect held the coder's charge.
 *
 * The content of a charge does not vary by stage, so nothing was withheld from
 * anyone; what was wrong was the NAME on it, in the one record that exists to
 * say which agreement a worker executed under.
 *
 * Returns null for a type that names no stage. A SUB-AGENT CHILD is exactly
 * that case — `spawnJuliusSubagent` takes the task type from its caller, so a
 * child can be `audit` or anything else — and it still executes under its
 * parent's contract and still needs a charge. `boundStageForRole` below is that
 * fallback, and it is keyed on the ROLE rather than on a prefix, because the
 * role is what actually decides what a worker is doing.
 */
export function workStageOf(taskType: string): JuliusReviewStage | null {
  if (taskType.startsWith('review:')) return null;
  return (JULIUS_REVIEW_STAGES as readonly string[]).includes(taskType) ? taskType as JuliusReviewStage : null;
}

/**
 * THE STAGE A BOUND TASK EXECUTES UNDER WHEN ITS TYPE NAMES NONE.
 *
 * Keyed on the role, and on nothing else. A bound CODING_AGENT task is a build
 * round whatever its caller called it; a bound PROMPT_ARCHITECT task is
 * guidance, because the architect that DRAFTS the terms is unbound by
 * construction and only the one that ADVISES under them ever reaches here. A
 * repair round of either keeps its own repair stage.
 *
 * The reviewer is deliberately absent: its stage comes from `reviewStageOf`,
 * and an unrecognised `review:<something>` is not guessed at.
 */
export function boundStageForRole(role: string, taskType: string): JuliusReviewStage | null {
  const repairing = taskType.startsWith('repair:');
  if (role === 'CODING_AGENT') return repairing ? 'repair:build' : 'build';
  if (role === 'PROMPT_ARCHITECT') return repairing ? 'repair:guidance' : 'guidance';
  return null;
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
  readonly subject: 'PLAN' | 'IMPLEMENTATION' | 'GUIDANCE' | 'REBUTTAL';
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

/**
 * A REBUTTAL IS JUDGED ON ITS EVIDENCE, NOT ON WHO SAID IT.
 *
 * The reviewer is judging the architect's answer to its OWN challenge, which is
 * the one review where the reviewer has a position of its own to defend. So the
 * questions are about what the cited evidence shows, and the last one asks it
 * to say plainly whether the evidence changes its mind — because Julius resolves
 * the disagreement on that answer and there is no second round to correct it in.
 */
const REBUTTAL_JUDGES: readonly string[] = Object.freeze([
  'Does the rebuttal answer the challenge that was actually raised, rather than a weaker one?',
  'Is each cited locator real, relevant and checkable from the mission state you were given?',
  'Does the cited evidence actually support the maintained position, rather than merely accompanying it?',
  'Is there evidence against the position that the rebuttal leaves unaddressed?',
  'Having read the evidence, does your challenge still stand? CONTINUE accepts the architect\'s position; anything stricter maintains your challenge.',
]);

/**
 * A rebuttal review may not demand the work: the disagreement may have been
 * raised about a plan or a packet, and the implementation is not what is being
 * argued about.
 */
const REBUTTAL_MUST_NOT_DEMAND: readonly string[] = Object.freeze([
  'a second rebuttal from the architect',
  'a contract amendment applied without a reviewed revision',
  'completed edits that the challenged position does not concern',
]);

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
  /**
   * REQUIRES NOTHING FROM THE ARTIFACT EXCHANGE, and that is deliberate. The
   * challenge, the architect's argument and its citations are all in the packet
   * Julius compiled for this review, written as durable Project Brain entries
   * when the disagreement opened and when the rebuttal arrived. A requirement on
   * a process-local artifact would make a resumed run unable to finish an
   * argument it had already started — the disagreement would hold the work with
   * nothing able to release it.
   */
  'rebuttal': Object.freeze({
    stage: 'rebuttal', subject: 'REBUTTAL', repair: false,
    judges: REBUTTAL_JUDGES, mustNotDemand: REBUTTAL_MUST_NOT_DEMAND,
    requires: Object.freeze<JuliusReviewRequirement[]>([]),
  }),
});

export function reviewChargeFor(stage: JuliusReviewStage): JuliusReviewCharge {
  return CHARGES[stage];
}

/**
 * WHAT A REVIEW TASK IS ABOUT — `<subject>:review` read back.
 *
 * The pipeline mints review tasks as `${subject}:review`, and until now every
 * consumer that needed the subject reconstructed it by slicing the string in
 * place. Once a review needs an artifact belonging to its SUBJECT rather than
 * to the run — a guidance packet does — that slice moves into an adapter,
 * which is where a convention becomes a bug nobody can grep for. Null for
 * anything that is not a review task.
 */
export function reviewSubjectTaskId(taskId: string): string | null {
  // A REVIEW THAT PAUSED TO RESEARCH continues as `segment:<review>:<n>:task`,
  // and the continuation is still a review of the same subject — it must find
  // the same artifacts, or a researched guidance review is refused for lacking
  // the packet it was judging.
  const segment = /^segment:(.+):[1-9]\d*:task$/u.exec(taskId);
  if (segment !== null) return reviewSubjectTaskId(segment[1]!);
  return taskId.endsWith(':review') ? taskId.slice(0, -':review'.length) : null;
}
