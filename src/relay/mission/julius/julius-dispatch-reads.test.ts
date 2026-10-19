import { describe, expect, it } from 'vitest';

import { juliusDispatchReadsFor } from './julius-task-pipeline';
import type { JuliusTaskRecord } from './julius-runtime';

/**
 * WHOSE BODIES A DISPATCH MAY READ.
 *
 * #285 made the bodies durable and attempt-scoped; the question this answers is
 * the one that decides whether that was worth anything: WHICH ATTEMPT is a
 * given dispatch about? Get it wrong and every other guarantee still holds
 * while the reviewer judges the wrong round.
 *
 * The two answers this replaces are both silent-wrong-answer machines, and the
 * cases below are written against them specifically:
 *
 *   slicing `:review` off a task id names a TASK and never an attempt; and
 *   "the latest body of this kind" is the previous round whenever this round's
 *   capture failed.
 */

const task = (over: Partial<JuliusTaskRecord> & Pick<JuliusTaskRecord, 'taskId'>): JuliusTaskRecord => ({
  missionId: 'mission-1',
  parentTaskId: null,
  dependencyIds: [],
  requiredEvidenceTypes: [],
  taskType: 'build',
  role: 'CODING_AGENT',
  ordinal: 0,
  state: 'SUCCEEDED',
  leaseGeneration: 1,
  ...over,
});

const PLAN = task({ taskId: 'plan-1', taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, leaseGeneration: 4 });
const BUILD = task({ taskId: 'build-1', ordinal: 1, leaseGeneration: 7 });
const REVIEW = task({
  taskId: 'build-1:review', taskType: 'review:build', role: 'INDEPENDENT_REVIEWER',
  parentTaskId: 'build-1', ordinal: 2, state: 'RUNNABLE', leaseGeneration: 1,
});

describe('the attempt a review is about', () => {
  it('is the subject task\'s own generation, not a number derived from the review\'s id', () => {
    const reads = juliusDispatchReadsFor(REVIEW, [PLAN, BUILD, REVIEW]);

    expect(reads.subject, 'the attempt under review').toEqual({ taskId: 'build-1', leaseGeneration: 7 });
    expect(reads.plan, 'and the plan it was written against').toEqual({ taskId: 'plan-1', leaseGeneration: 4 });
  });

  it('follows the RECORDED parent, so a task id that does not end in :review still resolves', () => {
    // The point of not slicing strings: the relationship is a column, and a
    // task id that no convention would parse resolves exactly the same.
    const oddly = { ...REVIEW, taskId: 'reviewer-for-the-build' };
    expect(juliusDispatchReadsFor(oddly, [PLAN, BUILD, oddly]).subject)
      .toEqual({ taskId: 'build-1', leaseGeneration: 7 });
  });

  it('climbs past a review\'s own continuation to the subject the continuation is still about', () => {
    // A review that paused to research continues as a reviewer-role child of
    // that review. Stopping at the first parent would make the continuation a
    // review OF A REVIEW, which has no diff and would be refused.
    const segment = task({
      taskId: 'segment:build-1:review:1:task', taskType: 'review:build', role: 'INDEPENDENT_REVIEWER',
      parentTaskId: 'build-1:review', ordinal: 3, state: 'RUNNABLE', leaseGeneration: 2,
    });
    expect(juliusDispatchReadsFor(segment, [PLAN, BUILD, REVIEW, segment]).subject)
      .toEqual({ taskId: 'build-1', leaseGeneration: 7 });
  });

  it('names NOTHING rather than something plausible when the subject has not succeeded', () => {
    /**
     * THE ONE THAT MATTERS. A task still running has a generation that can
     * still move, so naming it would be naming an attempt whose bytes are not
     * final. Absent is what the adapters already refuse on
     * (`reviewer_implementation_absent`), and a refusal is the correct end for
     * a review that cannot say what it is reviewing.
     */
    const running = { ...BUILD, state: 'ACTIVE' as const };
    expect(juliusDispatchReadsFor(REVIEW, [PLAN, running, REVIEW]).subject).toBeUndefined();
  });

  it('names nothing when the parent is missing or the graph loops, rather than some other task', () => {
    expect(juliusDispatchReadsFor(REVIEW, [PLAN, REVIEW]).subject, 'no parent row').toBeUndefined();

    const a = task({ taskId: 'a', role: 'INDEPENDENT_REVIEWER', parentTaskId: 'b' });
    const b = task({ taskId: 'b', role: 'INDEPENDENT_REVIEWER', parentTaskId: 'a' });
    expect(juliusDispatchReadsFor(a, [a, b]).subject, 'a cycle is a graph nobody can climb').toBeUndefined();
  });

  it('gives a non-reviewer no subject at all — only a review is ABOUT another task', () => {
    const reads = juliusDispatchReadsFor(BUILD, [PLAN, BUILD]);
    expect(reads.subject).toBeUndefined();
    expect(reads.plan, 'but a coder is still told which plan it implements').toEqual({ taskId: 'plan-1', leaseGeneration: 4 });
  });
});

describe('the plan in force', () => {
  it('is the LATEST plan round that succeeded, because a revision supersedes what it revised', () => {
    const revision = task({
      taskId: 'repair:plan-1:1:task', taskType: 'repair:plan', role: 'PROMPT_ARCHITECT',
      ordinal: 5, leaseGeneration: 2,
    });
    expect(juliusDispatchReadsFor(BUILD, [PLAN, BUILD, revision]).plan)
      .toEqual({ taskId: 'repair:plan-1:1:task', leaseGeneration: 2 });
  });

  it('ignores an architect task that writes no plan', () => {
    // A guidance task is a PROMPT_ARCHITECT task with a later ordinal, and it
    // writes GUIDANCE. Treating it as the plan would point every coder at a
    // body of the wrong kind, which resolves to null and refuses the dispatch.
    const guidance = task({
      taskId: 'guidance:build-1:1:task', taskType: 'guidance', role: 'PROMPT_ARCHITECT',
      ordinal: 9, leaseGeneration: 3,
    });
    expect(juliusDispatchReadsFor(BUILD, [PLAN, BUILD, guidance]).plan)
      .toEqual({ taskId: 'plan-1', leaseGeneration: 4 });
  });

  it('names no plan while the plan round has not succeeded', () => {
    const drafting = { ...PLAN, state: 'ACTIVE' as const };
    expect(juliusDispatchReadsFor(BUILD, [drafting, BUILD]).plan).toBeUndefined();
  });
});
