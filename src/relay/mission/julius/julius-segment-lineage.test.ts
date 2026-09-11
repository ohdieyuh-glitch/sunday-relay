import { describe, expect, it } from 'vitest';

import { isJuliusRepairOf, repairRoundsBefore } from './julius-repair-lineage';
import {
  JULIUS_BARRIER_ROUTES, isJuliusSegmentOf, juliusSegmentSubjectTaskId, juliusSegmentTaskId,
  nextSegmentNumber, routeIsBarrier, sanitizeJuliusSegmentState, segmentChildrenOf, segmentNumberOf,
} from './julius-segment-lineage';
import type { JuliusTask } from './julius-runtime';
import type { JuliusCheckpointRouting } from './julius-continuous-lifecycle';

const task = (over: Partial<JuliusTask> & { taskId: string }): JuliusTask => ({
  missionId: 'mission-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'RUNNABLE', ...over,
} as JuliusTask);

const SUBJECT = task({ taskId: 'build-1' });
const seg = (n: number, over: Partial<JuliusTask> = {}): JuliusTask =>
  task({ taskId: juliusSegmentTaskId('build-1', n), parentTaskId: 'build-1', ordinal: n, ...over });

describe('the continuation lineage is a sibling of the repair lineage, never the same one', () => {
  it('recognises a continuation by parent, role, task type and id shape', () => {
    expect(isJuliusSegmentOf(SUBJECT, seg(2))).toBe(true);
  });

  it('refuses an impostor that gets any part of the shape wrong', () => {
    expect(isJuliusSegmentOf(SUBJECT, seg(2, { parentTaskId: 'build-9' })), 'wrong parent').toBe(false);
    expect(isJuliusSegmentOf(SUBJECT, seg(2, { role: 'PROMPT_ARCHITECT' })), 'wrong role').toBe(false);
    expect(isJuliusSegmentOf(SUBJECT, seg(2, { taskType: 'repair:build' })), 'wrong stage').toBe(false);
    expect(isJuliusSegmentOf(SUBJECT, task({ taskId: 'segment:other:2:task', parentTaskId: 'build-1' })), 'names another subject').toBe(false);
    expect(isJuliusSegmentOf(SUBJECT, task({ taskId: 'build-1:continued', parentTaskId: 'build-1' })), 'wrong id shape').toBe(false);
    expect(isJuliusSegmentOf(SUBJECT, task({ taskId: 'segment:build-1:0:task', parentTaskId: 'build-1' })), 'segment zero').toBe(false);
  });

  /**
   * THE SEPARATION THAT MATTERS. A repair means the work was REJECTED and
   * consumes a round of a bound the founder set for rejected work. A segment
   * boundary means no such thing. If a continuation were counted as a repair, a
   * mission that paused three times for guidance would exhaust a repair ceiling
   * nothing had failed against.
   */
  it('a continuation is not a repair, and a repair is not a continuation', () => {
    const repair = task({
      taskId: 'repair:build-1:1:task', parentTaskId: 'build-1', taskType: 'repair:build',
    });
    expect(isJuliusRepairOf(SUBJECT, repair), 'the repair is a repair').toBe(true);
    expect(isJuliusSegmentOf(SUBJECT, repair), 'and is NOT a continuation').toBe(false);

    const continuation = seg(2);
    expect(isJuliusSegmentOf(SUBJECT, continuation), 'the continuation is a continuation').toBe(true);
    expect(isJuliusRepairOf(SUBJECT, continuation), 'and is NOT a repair').toBe(false);
  });

  it('yielding does not spend a repair round', () => {
    const tasks = [SUBJECT, seg(2), seg(3), seg(4)];
    expect(repairRoundsBefore(SUBJECT, tasks), 'three yields, zero repairs').toBe(0);
  });

  it('numbers continuations in order and counts the next from the rows', () => {
    expect(segmentNumberOf(juliusSegmentTaskId('build-1', 7))).toBe(7);
    expect(segmentNumberOf('build-1')).toBe(0);
    expect(juliusSegmentSubjectTaskId(juliusSegmentTaskId('run:x:build', 3))).toBe('run:x:build');
    expect(juliusSegmentSubjectTaskId('not-a-segment')).toBeNull();

    expect(nextSegmentNumber(SUBJECT, [SUBJECT]), 'the subject alone is segment 1').toBe(2);
    expect(nextSegmentNumber(SUBJECT, [SUBJECT, seg(2)])).toBe(3);
    // Out of order in the array is still in order by number.
    expect(segmentChildrenOf(SUBJECT, [SUBJECT, seg(3), seg(2)]).map((t) => t.taskId))
      .toEqual([juliusSegmentTaskId('build-1', 2), juliusSegmentTaskId('build-1', 3)]);
    expect(nextSegmentNumber(SUBJECT, [SUBJECT, seg(3), seg(2)])).toBe(4);
  });
});

describe('a yield is only a barrier when participation is actually required', () => {
  it('CONTINUE and WARNING are not barriers — ending a dispatch there buys nothing', () => {
    expect(routeIsBarrier('CONTINUE')).toBe(false);
    expect(routeIsBarrier('WARNING')).toBe(false);
  });

  it('every route that schedules work is a barrier, under the name it really has', () => {
    // THIS TEST USED TO PASS WHILE PROVING NOTHING. It looped over the barrier
    // list itself and asserted each member was a barrier, which is true of any
    // list of any strings — and two of those strings (`REQUIRE_REVIEW`,
    // `REPAIR`) were names no router produces, so the barriers they stood for
    // were unreachable. The names are now read off the routing type, and the
    // list is checked against a routing value rather than against itself.
    const routes: readonly JuliusCheckpointRouting[] = [
      { route: 'REQUEST_GUIDANCE', role: 'PROMPT_ARCHITECT', reasonCode: 'x' },
      { route: 'REQUEST_REVIEW', role: 'INDEPENDENT_REVIEWER', reasonCode: 'x' },
      { route: 'REQUIRE_REPAIR', reasonCode: 'x' },
      { route: 'REQUIRE_CONTRACT_REVISION', reasonCode: 'x' },
      { route: 'SERVE_RESEARCH', reasonCode: 'x' },
      { route: 'HALT', reasonCode: 'x' },
      { route: 'CONTINUE', reasonCode: 'x' },
    ];
    const barriers = routes.filter((routing) => routeIsBarrier(routing.route)).map((r) => r.route);
    expect(barriers).toEqual([
      'REQUEST_GUIDANCE', 'REQUEST_REVIEW', 'REQUIRE_REPAIR', 'REQUIRE_CONTRACT_REVISION',
      'SERVE_RESEARCH', 'HALT',
    ]);
    // Every route the router can produce is classified — no route falls through
    // into "not a barrier" merely because nobody thought about it.
    expect(routes).toHaveLength(JULIUS_BARRIER_ROUTES.length + 1);
  });

  it('an unknown route is not silently treated as safe to continue through', () => {
    // It is not a barrier, and the pipeline refuses an unknown route elsewhere;
    // what this pins is that nobody adds a route here by accident.
    expect(routeIsBarrier('ACCEPT')).toBe(false);
    expect(routeIsBarrier('')).toBe(false);
  });
});

describe('resume state is rebuilt from an allowlist, never trusted as sent', () => {
  const VALID = () => ({ completedSoFar: ['Read the integrity module.'], nextIntent: 'Wire the claim-qualified path.' });

  it('admits a bounded, substantive state', () => {
    expect(sanitizeJuliusSegmentState(VALID())).toEqual({
      completedSoFar: ['Read the integrity module.'], nextIntent: 'Wire the claim-qualified path.',
    });
  });

  it('refuses the whole state rather than dropping half of it', () => {
    expect(sanitizeJuliusSegmentState({ ...VALID(), nextIntent: '' }), 'empty intent').toBeNull();
    expect(sanitizeJuliusSegmentState({ ...VALID(), completedSoFar: 'not a list' })).toBeNull();
    expect(sanitizeJuliusSegmentState({ ...VALID(), completedSoFar: [''] }), 'empty entry').toBeNull();
    expect(sanitizeJuliusSegmentState({ completedSoFar: [] }), 'no intent at all').toBeNull();
    expect(sanitizeJuliusSegmentState(null)).toBeNull();
    expect(sanitizeJuliusSegmentState([VALID()]), 'an array is not a state').toBeNull();
  });

  it('bounds what a provider can put in the record', () => {
    expect(sanitizeJuliusSegmentState({ ...VALID(), nextIntent: 'x'.repeat(1_001) })).toBeNull();
    expect(sanitizeJuliusSegmentState({ ...VALID(), completedSoFar: ['x'.repeat(501)] })).toBeNull();
    expect(sanitizeJuliusSegmentState({ ...VALID(), completedSoFar: Array.from({ length: 21 }, () => 'x') })).toBeNull();
  });

  /**
   * NO PROVIDER SESSION, NO TRANSCRIPT, NO HIDDEN REASONING. A resume that
   * depended on provider-side state would make the provider the memory
   * authority — which `store: false` exists to prevent — and would not survive
   * the restart it is supposed to survive.
   */
  it('carries nothing the allowlist does not name', () => {
    const sanitized = sanitizeJuliusSegmentState({
      ...VALID(), sessionId: 'sess_abc', transcript: 'everything said so far', reasoning: 'hidden',
    });
    expect(sanitized).not.toBeNull();
    expect(Object.keys(sanitized as object).sort()).toEqual(['completedSoFar', 'nextIntent']);
  });
});
