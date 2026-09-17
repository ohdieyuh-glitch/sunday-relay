/**
 * BOUNDED RESUMABLE CODER SEGMENTS — the causal barrier a checkpoint has to be.
 *
 * ADR-021 made Julius able to ASK at a checkpoint. It did not make the coder
 * WAIT for the answer. A `guidanceRequest` arrives on the result of a dispatch
 * that has already finished, so guidance written in response to it reaches a
 * worker that stopped working — continuous supervision that is really post-hoc
 * recording, and every proof of the ASK passes while the property nobody stated
 * is false.
 *
 * THE SEAM DOES NOT CHANGE TO FIX THIS. `dispatch(input) => Promise<result>` is
 * still one promise in and one result out; a callback channel would re-earn the
 * lease, the attempt, the contract gate, evidence, review, repair and recovery
 * from scratch, and would be the undocumented side channel ADR-021 forbids by
 * name. What changes is that a unit of coder work becomes a SEGMENT, and a
 * segment that ends at a barrier ends the DISPATCH.
 *
 * The barrier is then structural rather than behavioural: segment N+1 is a TASK
 * THAT DOES NOT EXIST until Julius has recorded the required participation.
 * Nothing has to trust a model to stop, because the continuation it would need
 * has not been created. That is the difference between "the coder agreed to
 * wait" and "there was nothing to run".
 *
 * WHY NOT REUSE THE REPAIR LINEAGE, which already has exactly this shape. Two
 * reasons, both about truth: a repair means the work was REJECTED, and a
 * segment boundary means no such thing; and a repair consumes a round of a
 * bound the founder set for rejected work, so a mission that yielded three
 * times for guidance would exhaust a repair ceiling nothing had failed against.
 * The lineages are deliberately siblings — same shape, different meaning,
 * separately counted.
 */

import type { JuliusTask } from './julius-runtime';
import type { JuliusCheckpointRouting } from './julius-continuous-lifecycle';
import type { JuliusTaskContractBinding } from './julius-task-contract';

export const JULIUS_SEGMENT_VERSION = 'julius-coder-segment.v1' as const;

/**
 * WHY A SEGMENT ENDED. `COMPLETE` is the ordinary end of the work and mints
 * nothing; `YIELDED` is the barrier. A segment that ended for any other reason
 * is a failure and travels the failure path, not this one.
 */
export const JULIUS_SEGMENT_OUTCOMES = ['COMPLETE', 'YIELDED'] as const;
export type JuliusSegmentOutcome = typeof JULIUS_SEGMENT_OUTCOMES[number];

export const JULIUS_SEGMENT_LIMITS = Object.freeze({
  entryChars: 500,
  entries: 20,
  intentChars: 1_000,
});

/**
 * THE STATE A CONTINUATION RESUMES FROM — explicit, typed, contract-bound and
 * replay-safe, which are the four properties a hidden session handle has none
 * of.
 *
 * `binding` is NOT nullable. A continuation that cannot name the revision it
 * resumes under is a continuation nobody can date, and after a contract
 * revision it would be indistinguishable from current work. That is what makes
 * "stale work cannot resume across a re-lock" checkable rather than hoped for.
 *
 * There is deliberately no provider session id, no transcript and no hidden
 * reasoning. A resume that depended on provider-side state would make the
 * provider the memory authority, which `store: false` exists to prevent, and
 * would not survive the restart it is supposed to survive.
 */
export interface JuliusCoderSegmentState {
  readonly version: typeof JULIUS_SEGMENT_VERSION;
  /** The original coder task. Every segment of one unit of work shares it. */
  readonly subjectTaskId: string;
  /** 1-based. Segment 1 is the subject itself; a continuation is 2 or more. */
  readonly segment: number;
  readonly binding: JuliusTaskContractBinding;
  /** The checkpoint that ended the previous segment. */
  readonly yieldedAtCheckpointId: string;
  /** Bounded, already-safe sentences. Never a diff, a transcript or a body. */
  readonly completedSoFar: readonly string[];
  readonly nextIntent: string;
}

const trimmedEntry = (value: unknown, cap: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 || text.length > cap ? null : text;
};

const entryList = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  if (value.length > JULIUS_SEGMENT_LIMITS.entries) return null;
  const out: string[] = [];
  for (const item of value) {
    const text = trimmedEntry(item, JULIUS_SEGMENT_LIMITS.entryChars);
    if (text === null) return null;
    out.push(text);
  }
  return Object.freeze(out);
};

/**
 * THE ID SHAPE, and it is a contract rather than a convention.
 *
 * `isJuliusSegmentOf` reads it back and refuses anything that does not match,
 * so an impostor row cannot present itself as the continuation of work it has
 * no relationship to — the same reasoning `isJuliusRepairOf` documents for the
 * repair planner.
 */
export const juliusSegmentTaskId = (subjectTaskId: string, segment: number): string =>
  `segment:${subjectTaskId}:${segment}:task`;

/** `segment:<subject>:<n>:task` → the subject. Anything else is null. */
export function juliusSegmentSubjectTaskId(taskId: string): string | null {
  const match = /^segment:(.+):([1-9]\d*):task$/u.exec(taskId);
  return match === null ? null : match[1];
}

/**
 * THE CONTINUATION'S FULL CONTRACT: the parent link, the parent's role, the
 * parent's OWN task type — a continuation is the same kind of work, never a
 * different stage — and the id shape.
 *
 * The task type check is what keeps a segment out of the repair lineage and a
 * repair out of this one: `isJuliusRepairOf` requires `repair:<stage>` and an
 * id prefixed `repair:`, and neither can be true here.
 */
export function isJuliusSegmentOf(parent: JuliusTask, child: JuliusTask): boolean {
  if (child.parentTaskId !== parent.taskId || child.role !== parent.role) return false;
  if (child.taskType !== parent.taskType) return false;
  const subject = juliusSegmentSubjectTaskId(child.taskId);
  return subject === parent.taskId;
}

/** The continuation children of a task, in segment order. */
export function segmentChildrenOf(subject: JuliusTask, tasks: readonly JuliusTask[]): JuliusTask[] {
  return tasks
    .filter((item) => isJuliusSegmentOf(subject, item))
    .sort((a, b) => segmentNumberOf(a.taskId) - segmentNumberOf(b.taskId));
}

/**
 * THE SEGMENT THAT IS WAITING ON THIS TASK, or null when none is.
 *
 * A barrier mints exactly one continuation and leaves it BLOCKED on the task
 * that must finish first — the SUBJECT for a research pause, the ARCHITECT'S
 * GUIDANCE TASK for a guidance pause, which is the edge that stops the coder
 * resuming before the advice exists. Whatever answers the pause has to reach
 * that continuation, because the dispatch which asked has already ended and the
 * continuation is the only place an answer can appear.
 *
 * IT IS FOUND, NOT COMPUTED. `nextSegmentNumber` gives the number the NEXT
 * barrier would use, which after the continuation exists is one too high — the
 * same off-by-construction that made an earlier guard unfireable. Reading the
 * rows says which segment is actually waiting.
 *
 * MORE THAN ONE WAITING SEGMENT IS NOT A CHOICE TO MAKE. A subject pauses once
 * at a time, so two would mean a shape nobody has built; picking the likelier
 * one would be Julius guessing which pause an answer belonged to. Null, and the
 * caller records that nothing could be delivered.
 */
export function pendingSegmentFor(
  blockedOnTaskId: string,
  tasks: readonly JuliusTask[],
): JuliusTask | null {
  const waiting = tasks.filter((item) =>
    item.state === 'BLOCKED'
    && item.dependencyIds.includes(blockedOnTaskId)
    && juliusSegmentSubjectTaskId(item.taskId) !== null);
  return waiting.length === 1 ? waiting[0]! : null;
}

/**
 * THE SEGMENT A TASK YIELDED TO, or null when it did not yield.
 *
 * A dispatch that ends at a barrier is not finished work: it said so, and Julius
 * minted the segment that carries it on. That continuation is the only task that
 * can hold the unit's finished work, so it is the one that is reviewed. The
 * yielded dispatch itself is judged through it — accepted when its continuation
 * is, live while its continuation is (`effectivelyAcceptedTaskIds`,
 * `canStillBeAccepted`). Qualification attempt 3 (run 34766115321) reviewed
 * every yielded dispatch as if it were finished, sent each one to repair, and so
 * ran a repair round AND a continuation for all ten pauses: two lines of work on
 * one deliverable, every time a worker asked a question.
 *
 * FOUND BY ID, from the chain the id shape already guarantees. A unit's segments
 * chain from its root (`juliusSegmentLineageRootOf`): the root is segment 1, and
 * a barrier on segment `n` mints `n + 1`. A dispatch yields once and only the
 * newest segment can run, so segment `n + 1` exists exactly when segment `n`
 * yielded. The row must also carry the continuation's full contract
 * (`isJuliusSegmentOf`), so an impostor id links nothing.
 */
export function juliusYieldContinuationOf(subject: JuliusTask, tasks: readonly JuliusTask[]): JuliusTask | null {
  const root = juliusSegmentLineageRootOf(subject, tasks);
  const segment = subject.taskId === root.taskId ? 1 : segmentNumberOf(subject.taskId);
  if (segment === 0) return null;
  const continuationId = juliusSegmentTaskId(root.taskId, segment + 1);
  const continuation = tasks.find((row) => row.taskId === continuationId);
  return continuation !== undefined && isJuliusSegmentOf(root, continuation) ? continuation : null;
}

/**
 * THE WORK A REVIEW IS ABOUT — the parent of the review's own lineage head.
 *
 * A reviewer that paused to have Julius read something continues in
 * `segment:<review>:<n>:task`, and that continuation's parent is the review that
 * paused, not the work under review. Reading the reviewed work off the
 * dispatch's own parent bound the continuation's verdict to the REVIEW:
 * reproduced on the peer-channel branch, a researched review's finding was
 * recorded against `plan-1:review` and never reached the plan. Null for a task
 * that is not a reviewer's, or whose head names no parent.
 */
export function juliusReviewedWorkOf(review: JuliusTask, tasks: readonly JuliusTask[]): JuliusTask | null {
  if (review.role !== 'INDEPENDENT_REVIEWER') return null;
  const head = juliusSegmentLineageRootOf(review, tasks);
  if (head.parentTaskId === null) return null;
  return tasks.find((row) => row.taskId === head.parentTaskId) ?? null;
}

/** The `n` in `segment:<subject>:<n>:task`, or 0 for anything else. */
export function segmentNumberOf(taskId: string): number {
  const match = /^segment:.+:([1-9]\d*):task$/u.exec(taskId);
  return match === null ? 0 : Number(match[1]);
}

/**
 * THE HEAD OF THIS UNIT OF WORK — the task the whole segment chain belongs to.
 *
 * A CHAIN, NOT A TREE, and the difference is the ceiling. Segment 2 asking
 * again would otherwise become the subject of its own lineage
 * (`segment:segment:build-1:2:task:2:task`), each level starting its count from
 * one, and the bound would never bind: a worker that asks at every segment
 * would nest forever while the number at every level stayed at two. The ceiling
 * was written against exactly that loop, so it has to be counted against the
 * work rather than against the most recent pause in it.
 *
 * Read back from the id, which is why the id shape is a contract: a row that
 * did not come from `juliusSegmentTaskId` cannot name itself part of a lineage.
 */
export function juliusSegmentLineageRootOf(task: JuliusTask, tasks: readonly JuliusTask[]): JuliusTask {
  const subjectId = juliusSegmentSubjectTaskId(task.taskId);
  if (subjectId === null) return task;
  const subject = tasks.find((row) => row.taskId === subjectId);
  // A continuation whose subject row is missing is its own root rather than
  // nothing: refusing to answer here would stop a mission over a lost row.
  return subject === undefined ? task : juliusSegmentLineageRootOf(subject, tasks);
}

/**
 * THE NEXT SEGMENT NUMBER for a subject, counted from durable task rows.
 *
 * Counted from the rows and never from a field, for the reason
 * `repairRoundsBefore` records: the repair-cycle table was never written on the
 * live path and answered zero for every round, so a bound nothing reached was
 * reported as enforced. A number derived from the tasks that exist cannot drift
 * from the tasks that exist.
 */
export function nextSegmentNumber(subject: JuliusTask, tasks: readonly JuliusTask[]): number {
  const children = segmentChildrenOf(subject, tasks);
  const highest = children.reduce((max, child) => Math.max(max, segmentNumberOf(child.taskId)), 1);
  return highest + 1;
}

/**
 * REBUILD THE RESUME STATE FROM AN ALLOWLIST, exactly as a guidance proposal and
 * a contract proposal are rebuilt. A key nobody listed cannot reach the record
 * however the provider sent it, and a PRESENT-but-unusable field refuses the
 * whole state rather than being dropped: half a resume is a coder told half of
 * what it already did.
 */
export function sanitizeJuliusSegmentState(value: unknown): Omit<JuliusCoderSegmentState, 'version' | 'binding' | 'subjectTaskId' | 'segment' | 'yieldedAtCheckpointId'> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const completedSoFar = entryList(source.completedSoFar);
  const nextIntent = trimmedEntry(source.nextIntent, JULIUS_SEGMENT_LIMITS.intentChars);
  if (completedSoFar === null || nextIntent === null) return null;
  return Object.freeze({ completedSoFar, nextIntent });
}

/**
 * A YIELD IS ONLY A BARRIER WHEN SOMETHING IS REQUIRED TO HAPPEN AT IT.
 *
 * A checkpoint that routes CONTINUE needs no participation, so ending the
 * dispatch there would cost a round trip and buy nothing. The barrier exists
 * for the routes that schedule work — guidance, a repair, a halt — and this is
 * the one place that decides which those are, so the pipeline and the tests
 * cannot hold different opinions.
 */
/**
 * TYPED AGAINST THE ROUTES THAT EXIST, because the first version of this list
 * was not and two of its four entries were names no router ever produced.
 * `REQUIRE_REVIEW` and `REPAIR` are not routes — `REQUEST_REVIEW` and
 * `REQUIRE_REPAIR` are — so those two barriers were unreachable, and a test
 * that looped over this array asserting each one stops the coder passed while
 * proving nothing. A `readonly string[]` will accept any sentence; this will
 * not compile against a route that is not in `JuliusCheckpointRouting`.
 */
export type JuliusCheckpointRoute = JuliusCheckpointRouting['route'];

/**
 * `HOLD_FOR_DISAGREEMENT` is here and `RECORD_DISAGREEMENT` is not. A material
 * challenge — the work breaks its terms, is unsafe, misses what it was for —
 * means work produced past it may be built on something about to be judged
 * wrong; a non-material one is argued while the work proceeds. (The route this
 * replaced, `REQUIRE_CONTRACT_REVISION`, sent every challenge straight to the
 * revision model; a challenge now opens a disagreement Julius resolves.)
 */
export const JULIUS_BARRIER_ROUTES: readonly JuliusCheckpointRoute[] = Object.freeze([
  'REQUEST_GUIDANCE',
  'REQUEST_REVIEW',
  'REQUIRE_REPAIR',
  'HOLD_FOR_DISAGREEMENT',
  // Julius goes and looks. No worker is scheduled, and the asking worker still
  // stops — an observation that arrives after the code was written is a
  // citation, not research.
  'SERVE_RESEARCH',
  'HALT',
]);

export const routeIsBarrier = (route: string): boolean =>
  (JULIUS_BARRIER_ROUTES as readonly string[]).includes(route);

/* ------------------------------------------------------ review conclusion */

/**
 * HAS THIS WORK BEEN REVIEWED — AND IF NOT, WHY NOT.
 *
 * A review is concluded when a reviewer's dispatch about this work ended without
 * yielding, or when every research continuation it yielded to carried it through
 * to one that did. A review that paused to read something and whose continuation
 * then FAILED has NOT concluded: what it said before it looked is on the record
 * and was deliberately never applied, and nothing after it produced a verdict.
 *
 * Counting "any reviewer child that succeeded" read that paused dispatch as a
 * finished review. Reproduced on main 5c53cb93: the reviewer approved-and-asked,
 * its research continuation failed, and the plan was ACCEPTED with no verdict
 * applied — the contract locked, the Coding Agent dispatched and paid — before
 * the run failed on the continuation anyway.
 *
 * In precedence order, naming what most decides the work:
 *   CONCLUDED        a review of it ended, through its research if it had any
 *   PENDING          a review of it is still running or waiting on research
 *   RESEARCH_FAILED  a review of it paused for research and the research failed
 *   FAILED           a review of it failed outright
 *   NONE             no review of it exists
 */
export const JULIUS_REVIEW_CONCLUSIONS = ['CONCLUDED', 'PENDING', 'RESEARCH_FAILED', 'FAILED', 'NONE'] as const;
export type JuliusReviewConclusion = (typeof JULIUS_REVIEW_CONCLUSIONS)[number];

export interface JuliusReviewConclusionReading {
  readonly conclusion: JuliusReviewConclusion;
  /** The review this reading is about: the concluded one, or the one that did not conclude. */
  readonly reviewTaskId: string | null;
  /** For RESEARCH_FAILED, the continuation that failed. */
  readonly failedSegmentTaskId: string | null;
}

const LIVE_REVIEW_STATES: ReadonlySet<string> = new Set(['RUNNABLE', 'ACTIVE', 'BLOCKED']);

export function juliusReviewConclusionOf(work: Pick<JuliusTask, 'taskId'>, tasks: readonly JuliusTask[]): JuliusReviewConclusionReading {
  const readings: JuliusReviewConclusionReading[] = [];
  for (const head of tasks) {
    if (head.role !== 'INDEPENDENT_REVIEWER' || head.parentTaskId !== work.taskId) continue;
    let current: JuliusTask = head;
    const seen = new Set<string>();
    let reading: JuliusReviewConclusionReading | null = null;
    while (reading === null) {
      if (seen.has(current.taskId)) {
        reading = { conclusion: 'FAILED', reviewTaskId: head.taskId, failedSegmentTaskId: current.taskId };
        break;
      }
      seen.add(current.taskId);
      if (current.state === 'SUCCEEDED') {
        const next = juliusYieldContinuationOf(current, tasks);
        if (next === null) reading = { conclusion: 'CONCLUDED', reviewTaskId: head.taskId, failedSegmentTaskId: null };
        else current = next;
      } else if (LIVE_REVIEW_STATES.has(current.state)) {
        reading = { conclusion: 'PENDING', reviewTaskId: head.taskId, failedSegmentTaskId: null };
      } else if (current.taskId === head.taskId) {
        reading = { conclusion: 'FAILED', reviewTaskId: head.taskId, failedSegmentTaskId: null };
      } else {
        reading = { conclusion: 'RESEARCH_FAILED', reviewTaskId: head.taskId, failedSegmentTaskId: current.taskId };
      }
    }
    readings.push(reading);
  }
  for (const conclusion of JULIUS_REVIEW_CONCLUSIONS) {
    const found = readings.find((reading) => reading.conclusion === conclusion);
    if (found !== undefined) return Object.freeze(found);
  }
  return Object.freeze({ conclusion: 'NONE', reviewTaskId: null, failedSegmentTaskId: null });
}
