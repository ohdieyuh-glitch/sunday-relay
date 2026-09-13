import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';
import type { JuliusBrainAppend } from './julius-runtime-ports';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE LEARNING LOOP — WHAT A RUN'S OWN VERIFIED REPAIRS TEACH THE REST OF IT.
 *
 * Mission 4 gave Project Brain memory a trust standing. Mission 5 made context
 * construction consume it. Nothing PRODUCES verified memory: the kernel pays an
 * independent reviewer to find a defect, pays a repair to fix it, pays a second
 * review to accept the fix, and then keeps none of it where later work can see.
 *
 * WHAT THE KERNEL DOES TODAY, read from `julius-task-pipeline.ts`:
 *
 *   - A repair round sees only the OPEN blocking findings recorded on its
 *     immediate subject. Round two repairs round one's work and is never told
 *     what round one was fixing, so it can undo it.
 *   - A finding never leaves OPEN. When its lineage is accepted, nothing records
 *     that it was resolved, or by what.
 *   - A verification DECISION is written to Project Brain scoped to the decided
 *     task, which is never dispatched again, so no worker ever reads it.
 *   - Nothing carries a resolved finding to any later dispatch, and a later
 *     review that repeats it is not recognised as a repeat.
 *
 * THE LOOP THIS MODULE STATES, and the pipeline runs:
 *
 *   FINDING     an independent review sends work back (already recorded)
 *   LINEAGE     every repair round, and its re-review, sees every blocking
 *               finding its lineage has accumulated, root first
 *   RESOLUTION  when the lineage is effectively accepted, its OPEN blocking
 *               findings become RESOLVED, attributed to the repair that was
 *               accepted
 *   LESSON      each resolution leaves one run-level Project Brain entry that
 *               every later dispatch in the run is compiled with
 *   DELIVERY    each dispatch records how many lessons it was handed and how
 *               many its character budget withheld; none disappears silently
 *   RECURRENCE  a new blocking finding that repeats a RESOLVED one from another
 *               lineage is recognised by an exact key — never by similarity —
 *               and leaves an entry saying the lesson did not hold
 *
 * WITHIN ONE RUN. Nothing here carries memory between runs: that needs a
 * project-scoped Project Brain and a persistent store, which is a separate
 * decision. The lessons are Project Brain entries so that such a carry has
 * something verified to read when it exists.
 *
 * PURE: no clock, no store, no network, no randomness. Times arrive as values.
 *
 * Every function below throws `learning_loop_not_implemented` until the
 * mission that owns this module implements it. The module is imported by
 * nothing on the repository's own paths, so the repository's tests stay green.
 */

export const JULIUS_LEARNING_LOOP_VERSION = 'julius-learning-loop.v1' as const;

/** Every lesson's entry id starts with this, so a reader can find lessons by id alone. */
export const JULIUS_LESSON_ENTRY_PREFIX = 'brain:lesson:' as const;

/** Every entry recording that a lesson did not hold starts with this. */
export const JULIUS_LESSON_NOT_HELD_ENTRY_PREFIX = 'brain:lesson-not-held:' as const;

/** The longest finding claim a learning entry quotes, in characters. */
export const JULIUS_LESSON_CLAIM_MAX_CHARACTERS = 400 as const;

/** A finding the accepted lineage closed, and what closed it. */
export interface JuliusFindingResolution {
  readonly finding: JuliusReviewerFinding;
  /** The repair whose acceptance made the finding's lineage effectively accepted. */
  readonly resolvedByTaskId: string;
  /** The stage the finding was raised against: `build`, `plan`, never `repair:build`. */
  readonly stage: string;
}

/** Which learning entries a compiled context carried, and which its budget withheld. */
export interface JuliusLessonDelivery {
  /** Learning entry ids the packet admitted, in brain order. */
  readonly delivered: readonly string[];
  /** Learning entry ids the brain held that the packet did not admit, in brain order. */
  readonly withheld: readonly string[];
}

const notImplemented = (): never => {
  throw new Error('learning_loop_not_implemented');
};

/**
 * THE KEY TWO FINDINGS SHARE WHEN ONE REPEATS THE OTHER.
 *
 * Exact, after normalisation that removes only presentation: letter case, runs
 * of whitespace, a leading bracketed tag such as `[blocking]`, and trailing
 * punctuation. The stage is part of the key and is folded to its base stage, so
 * `repair:repair:build` and `build` agree and `plan` and `build` do not. Two
 * claims that say the same thing in different words have different keys: this
 * is a record of repetition, never a judgement of similarity.
 */
export function juliusFindingRecurrenceKey(input: { readonly stage: string; readonly claim: string }): string {
  void input;
  return notImplemented();
}

/**
 * THE BLOCKING FINDINGS A REPAIR-SHAPED TASK EXISTS TO ADDRESS: every OPEN
 * blocking finding recorded on any task of its repair lineage.
 *
 * For a `repair:*` task that is its lineage root and every repair between the
 * root and itself; for a `review:repair:*` task it is the lineage of the repair
 * under review. Root first, then by recording time, then by finding id. Any
 * other task has none.
 */
export function juliusLineageFindings(
  task: JuliusTask,
  tasks: readonly JuliusTask[],
  findings: readonly JuliusReviewerFinding[],
): readonly JuliusReviewerFinding[] {
  void task; void tasks; void findings;
  return notImplemented();
}

/**
 * THE OPEN BLOCKING FINDINGS THE RUN'S DECISIONS HAVE NOW CLOSED.
 *
 * A finding is resolvable when the task it was recorded on is effectively
 * accepted under the run's decisions — accepted itself, or sent back and
 * repaired by a lineage whose latest repair was accepted. The resolution names
 * that accepted repair. A HALT, or a REPAIR nobody repaired, resolves nothing;
 * a RESOLVED or non-blocking finding is never offered again, so the answer is
 * stable under replay.
 */
export function juliusResolvableFindings(input: {
  readonly tasks: readonly JuliusTask[];
  readonly decisions: readonly JuliusRecordedDecision[];
  readonly findings: readonly JuliusReviewerFinding[];
}): readonly JuliusFindingResolution[] {
  void input;
  return notImplemented();
}

/**
 * THE LESSON A RESOLUTION LEAVES IN PROJECT BRAIN: one run-level `REPAIR`
 * entry, id `brain:lesson:<findingId>`, whose text names the stage, the
 * finding, the repair that resolved it and the claim, quoted to at most
 * {@link JULIUS_LESSON_CLAIM_MAX_CHARACTERS} characters. Built from closed
 * values and the finding's already-safe claim; no reviewer body reaches it.
 */
export function juliusLessonAppend(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly workerId: string;
  readonly resolution: JuliusFindingResolution;
  readonly occurredAt: string;
}): JuliusBrainAppend {
  void input;
  return notImplemented();
}

/**
 * THE RESOLVED FINDING A NEW BLOCKING FINDING REPEATS, or null.
 *
 * The earliest RESOLVED blocking finding with the same recurrence key, recorded
 * on a different repair lineage. A repeat inside the finding's own lineage is
 * that lineage still being repaired, not a lesson failing.
 */
export function juliusRecurrenceOf(input: {
  readonly finding: JuliusReviewerFinding;
  readonly tasks: readonly JuliusTask[];
  readonly findings: readonly JuliusReviewerFinding[];
}): JuliusReviewerFinding | null {
  void input;
  return notImplemented();
}

/**
 * THE ENTRY RECORDING THAT A LESSON DID NOT HOLD: one run-level `REPAIR` entry,
 * id `brain:lesson-not-held:<findingId>`, naming the new finding, the task it
 * was recorded on and the resolved finding it repeats.
 */
export function juliusLessonNotHeldAppend(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly workerId: string;
  readonly finding: JuliusReviewerFinding;
  readonly recurrenceOf: JuliusReviewerFinding;
  readonly occurredAt: string;
}): JuliusBrainAppend {
  void input;
  return notImplemented();
}

/**
 * WHICH LEARNING ENTRIES A COMPILED CONTEXT CARRIED. `brain` is the run's
 * Project Brain in order; `sourceEntryIds` is what the compiled packet admitted.
 * Only entries whose ids carry a learning prefix are counted.
 */
export function juliusLessonDelivery(input: {
  readonly brain: readonly { readonly entryId: string }[];
  readonly sourceEntryIds: readonly string[];
}): JuliusLessonDelivery {
  void input;
  return notImplemented();
}
