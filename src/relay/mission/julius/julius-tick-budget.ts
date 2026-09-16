import type { JuliusTask, JuliusWorkerRole } from './julius-runtime';
import { JULIUS_ARCHITECTURE_DRIFT_LIMITS } from './julius-architecture-drift';
import { juliusSegmentLineageRootOf } from './julius-segment-lineage';

/**
 * HOW MANY RUN-LOOP TICKS A MISSION'S OWN STRUCTURE PERMITS.
 *
 * ON THE LIVE PATH ONE TICK IS AT MOST ONE DISPATCH. The loop claims up to
 * four tasks and runs them in order, but the live card allows one at a time, so
 * every claim after the first goes back unspent. Review, decision, release and
 * repair all land inside the same tick. Qualification attempts 3 and 4 each
 * consumed 32 ticks with exactly 32 dispatches.
 *
 * WHY THIS REPLACES A NUMBER. The ceiling was 32, chosen when a mission was
 * plan → review → build → review with one repair. Attempt 4 (run 34774471909)
 * hit it after 44 of its 120 minutes, still working inside every bound its
 * contract set: 2 of 3 repair rounds per unit, segments within the ceiling, a
 * build review claimable. Its run row stayed READY and nothing recorded why it
 * stopped. The allowance below is counted from the same bounds the runtime
 * enforces, so it runs out only when Julius has dispatched more than its own
 * structure permits. That is a defect worth a terminal FAILED with the
 * numbers, not an ordinary stall.
 *
 * Pure: no clock, no network, no Node.
 */

export const JULIUS_TICK_BUDGET_VERSION = 'julius-tick-budget.v1' as const;

export interface JuliusTickStructure {
  /** The role of each seeded work unit: every root task that is not a review. */
  readonly units: readonly JuliusWorkerRole[];
  /** Repair rounds the contract authorises per work unit (`maxRepairRounds`). */
  readonly repairRounds: number;
  /** Segments a lineage may reach before its pauses stop minting continuations. */
  readonly segmentCeiling: number;
  /** Whether every finished lineage is independently reviewed. */
  readonly reviewerRequired: boolean;
  /** Attempts a task is given before it fails (`MAX_TASK_ATTEMPTS`). */
  readonly taskAttempts: number;
}

export interface JuliusTickBudget {
  readonly version: typeof JULIUS_TICK_BUDGET_VERSION;
  /**
   * THE MAIN PATH, counted in full:
   *   - every unit, in its original lineage and in every repair round;
   *   - every segment of each lineage;
   *   - for a coder segment, the guidance it may ask for and that guidance's
   *     review;
   *   - the review of each lineage's final segment;
   *   - the one advance that settles the run.
   */
  readonly plannedTicks: number;
  /**
   * EVERY PATH THE CODE PERMITS, with every dispatch at its attempt bound:
   *   - reviews and guidance pausing for research to the segment ceiling;
   *   - guidance repaired to the round bound.
   * No allowance exceeds it.
   */
  readonly hardMaxTicks: number;
  readonly structure: JuliusTickStructure;
  /** The derivation, as closed tokens and numbers only, so an evidence line can carry it whole. */
  readonly reason: string;
}

const whole = (value: number, floor: number): number =>
  (Number.isSafeInteger(value) && value >= floor ? value : floor);

/**
 * Dispatches one lineage of `role` can make on the main path.
 *
 * Architect: every segment, then the review of the last. Coder: every segment,
 * each able to pause for guidance (a guidance task on the architect plus its
 * review), then the review of the last. A research pause costs no dispatch of
 * its own; it is served in process and consumes a segment.
 */
function mainPathLineage(role: JuliusWorkerRole, segments: number, review: number): number {
  if (role === 'CODING_AGENT') return segments + segments * (1 + review) + review;
  return segments + review;
}

/**
 * How many REVIEWS one lineage can run when everything pauses and repairs as
 * far as the code allows. Each one is a moment a reviewer may challenge, and a
 * challenge is bounded at exactly one rebuttal and one re-review.
 */
function everyPathReviews(role: JuliusWorkerRole, segments: number, rounds: number, reviewerRequired: boolean): number {
  if (!reviewerRequired) return 0;
  if (role === 'CODING_AGENT') return segments * (rounds + 1) * segments + segments;
  return segments;
}

/** The same lineage when every task in it goes as far as the code allows. */
function everyPathLineage(role: JuliusWorkerRole, segments: number, rounds: number, reviewerRequired: boolean): number {
  const review = reviewerRequired ? segments : 0;
  /**
   * TWO DISPATCHES PER REVIEW THAT CHALLENGES, AND NO MORE.
   *
   * A reviewer may challenge each review it performs; Julius then asks the
   * architect once (a `rebuttal` task) and has the reviewer judge the answer
   * once (a `review:rebuttal` task). The record itself refuses a second
   * rebuttal and a second re-review, and one disagreement exists per
   * challenging review by identity, so this product is the ceiling rather than
   * an estimate: peer disagreement cannot manufacture capacity by repeating.
   */
  const disagreements = everyPathReviews(role, segments, rounds, reviewerRequired) * 2;
  if (role === 'CODING_AGENT') {
    const guidance = (rounds + 1) * (segments + review);
    return segments + segments * guidance + review + disagreements;
  }
  return segments + review + disagreements;
}

export function planJuliusTickBudget(input: JuliusTickStructure): JuliusTickBudget {
  const rounds = whole(input.repairRounds, 0);
  const segments = whole(input.segmentCeiling, 1);
  const attempts = whole(input.taskAttempts, 1);
  const review = input.reviewerRequired ? 1 : 0;
  const structure: JuliusTickStructure = {
    units: [...input.units], repairRounds: rounds, segmentCeiling: segments,
    reviewerRequired: input.reviewerRequired, taskAttempts: attempts,
  };

  const lineages = rounds + 1;
  const planned = input.units.reduce((sum, role) => sum + lineages * mainPathLineage(role, segments, review), 0) + 1;
  const everyPath = input.units.reduce(
    (sum, role) => sum + lineages * everyPathLineage(role, segments, rounds, input.reviewerRequired), 0,
  );
  /**
   * THE ARCHITECT'S CONSULTATIONS ARE A RUN-LEVEL CEILING, NOT A PER-LINEAGE
   * ONE.
   *
   * Julius may go back to the architect for seven named reasons, cause-once per
   * revision and subject, and never more than `consultations` times in one run
   * whatever the task graph looks like. Each consultation costs its own
   * dispatch and, when a reviewer is required, the review of it. Counted once
   * for the run — multiplying it by lineages would price an argument the
   * structure cannot have.
   */
  const consultations = input.reviewerRequired
    ? JULIUS_ARCHITECTURE_DRIFT_LIMITS.consultations * 2
    : JULIUS_ARCHITECTURE_DRIFT_LIMITS.consultations;
  const hardMax = Math.max(planned, everyPath * attempts + consultations * attempts + 1);

  const reason = [
    `units=${input.units.join(',') || 'none'}`,
    `repair_rounds=${String(rounds)}`,
    `segment_ceiling=${String(segments)}`,
    `reviewer=${input.reviewerRequired ? 'required' : 'not_required'}`,
    `attempts=${String(attempts)}`,
    // A disagreement is conditional work: never planned, always bounded.
    `disagreement=${input.reviewerRequired ? 'one_rebuttal_one_re_review_per_review' : 'unreachable'}`,
    // An architecture consultation is conditional work too: never planned,
    // capped for the run rather than per lineage.
    `architecture=max_${String(JULIUS_ARCHITECTURE_DRIFT_LIMITS.consultations)}_consultations_per_run`,
  ].join(' ');
  return { version: JULIUS_TICK_BUDGET_VERSION, plannedTicks: planned, hardMaxTicks: hardMax, structure, reason };
}

export interface JuliusTickAllowance {
  /** Ticks the run may consume now: planned, plus what the run has legitimately added, never past the hard maximum. */
  readonly allowance: number;
  /** Dispatches the run minted that the main path does not count. */
  readonly beyondMainPath: number;
  /** Of those, the ones that exist because a peer disagreed. */
  readonly disagreementTicks: number;
  /** Of those, the ones that exist because Julius went back to the architect. */
  readonly architectureTicks: number;
  /** Dispatch attempts that failed and were handed back for another try. */
  readonly retries: number;
}

const isReview = (task: JuliusTask): boolean => task.taskType.startsWith('review:');
const isGuidance = (task: JuliusTask): boolean => task.taskType === 'guidance' || task.taskType === 'repair:guidance';
/** The two tasks a disagreement can add: the architect's one answer, and the one re-review of it. */
const isDisagreementWork = (task: JuliusTask): boolean => task.taskType === 'rebuttal' || task.taskType === 'review:rebuttal';
/** The two tasks one architecture consultation can add: the consultation, and its review. */
const isArchitectureWork = (task: JuliusTask): boolean => task.taskType === 'architecture' || task.taskType === 'review:architecture';

/**
 * WHAT THE RUN MAY SPEND NOW, recomputed from its own task rows each tick.
 *
 * The main path leaves out work that is legitimate but not routine:
 *   - a review or a guidance task pausing for research (it continues in a
 *     segment of its own);
 *   - guidance repaired after its review refused it.
 * Each such task the run actually minted adds its dispatch, and a guidance
 * repair adds its review. A failed attempt that was retried adds the tick it
 * cost. Everything else was already counted. The hard maximum still caps the
 * total, so nothing extends forever.
 */
export function juliusTickAllowance(input: {
  readonly budget: JuliusTickBudget;
  readonly tasks: readonly JuliusTask[];
  readonly retries: number;
}): JuliusTickAllowance {
  let beyond = 0;
  for (const task of input.tasks) {
    const root = juliusSegmentLineageRootOf(task, input.tasks);
    const continuation = root.taskId !== task.taskId;
    if (continuation && (isReview(root) || isGuidance(root))) beyond += 1;
    if (!continuation && task.taskType === 'repair:guidance') beyond += input.budget.structure.reviewerRequired ? 2 : 1;
    /**
     * A DISAGREEMENT THAT ACTUALLY HAPPENED BUYS ITS OWN TWO DISPATCHES, and
     * only because the tasks exist: a reviewer that challenges nothing adds
     * nothing, and a run cannot mint a third because the disagreement record
     * refuses a second rebuttal and a second re-review. The hard maximum still
     * caps the total.
     */
    if (!continuation && isDisagreementWork(task)) beyond += 1;
    /**
     * A CONSULTATION THAT ACTUALLY HAPPENED BUYS ITS OWN DISPATCH, and only
     * because the task exists: a mission that never drifts consults nobody and
     * adds nothing. Fan-out cannot manufacture capacity — the trigger ledger
     * refuses a second consultation for the same reason and revision, the run
     * cap refuses the thirteenth whatever the reason, and the hard maximum
     * still caps the total.
     */
    if (!continuation && isArchitectureWork(task)) beyond += 1;
  }
  const retries = whole(input.retries, 0);
  const allowance = Math.min(input.budget.hardMaxTicks, input.budget.plannedTicks + beyond + retries);
  const disagreementTicks = input.tasks.filter((task) =>
    isDisagreementWork(task) && juliusSegmentLineageRootOf(task, input.tasks).taskId === task.taskId).length;
  const architectureTicks = input.tasks.filter((task) =>
    isArchitectureWork(task) && juliusSegmentLineageRootOf(task, input.tasks).taskId === task.taskId).length;
  return { allowance, beyondMainPath: beyond, disagreementTicks, architectureTicks, retries };
}
