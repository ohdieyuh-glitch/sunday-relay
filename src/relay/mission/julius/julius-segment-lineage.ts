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
 * `REQUIRE_CONTRACT_REVISION` belongs here and was missing entirely, which was
 * the more serious half of the same mistake. The contract the coder is working
 * under is the thing being changed; work produced past that point is bound to a
 * revision that is about to stop being current, which is exactly the stale
 * binding the contract lock exists to make impossible.
 */
export const JULIUS_BARRIER_ROUTES: readonly JuliusCheckpointRoute[] = Object.freeze([
  'REQUEST_GUIDANCE',
  'REQUEST_REVIEW',
  'REQUIRE_REPAIR',
  'REQUIRE_CONTRACT_REVISION',
  // Julius goes and looks. No worker is scheduled, and the asking worker still
  // stops — an observation that arrives after the code was written is a
  // citation, not research.
  'SERVE_RESEARCH',
  'HALT',
]);

export const routeIsBarrier = (route: string): boolean =>
  (JULIUS_BARRIER_ROUTES as readonly string[]).includes(route);
