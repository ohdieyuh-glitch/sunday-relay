import { describe, expect, it } from 'vitest';

import { effectivelyAcceptedTaskIds, isJuliusRepairOf, juliusWorkUnitRootOf, repairAncestorsOf, repairRoundsBefore } from './julius-repair-lineage';
import { canStillBeAccepted } from './julius-release-runtime';
import {
  JULIUS_BARRIER_ROUTES, isJuliusSegmentOf, juliusSegmentSubjectTaskId, juliusSegmentTaskId,
  juliusReviewConclusionOf, juliusYieldContinuationOf, nextSegmentNumber, routeIsBarrier, sanitizeJuliusSegmentState, segmentChildrenOf, segmentNumberOf,
} from './julius-segment-lineage';
import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';
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
      { route: 'HOLD_FOR_DISAGREEMENT', reasonCode: 'x' },
      { route: 'SERVE_RESEARCH', reasonCode: 'x' },
      { route: 'HALT', reasonCode: 'x' },
      { route: 'CONTINUE', reasonCode: 'x' },
    ];
    const barriers = routes.filter((routing) => routeIsBarrier(routing.route)).map((r) => r.route);
    expect(barriers).toEqual([
      'REQUEST_GUIDANCE', 'REQUEST_REVIEW', 'REQUIRE_REPAIR', 'HOLD_FOR_DISAGREEMENT',
      'SERVE_RESEARCH', 'HALT',
    ]);
    // Every route the router can produce is classified — no route falls through
    // into "not a barrier" merely because nobody thought about it. A recorded
    // disagreement and CONTINUE are the two that do not stop the work.
    expect(routes.concat([{ route: 'RECORD_DISAGREEMENT', reasonCode: 'x' }])).toHaveLength(JULIUS_BARRIER_ROUTES.length + 2);
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

/**
 * WHAT A DISPATCH YIELDED TO — the edge that carries its review obligation.
 * Qualification attempt 3 reviewed every yielded dispatch; the verification now
 * asks this helper first, and acceptance and liveness follow the edge it names.
 */
describe('a yielded dispatch is found by the continuation its barrier minted', () => {
  it('the root yields to segment 2, and segment n to segment n + 1', () => {
    const rows = [SUBJECT, seg(2, { state: 'SUCCEEDED' }), seg(3)];
    expect(juliusYieldContinuationOf(SUBJECT, rows)?.taskId).toBe('segment:build-1:2:task');
    expect(juliusYieldContinuationOf(rows[1]!, rows)?.taskId).toBe('segment:build-1:3:task');
    expect(juliusYieldContinuationOf(rows[2]!, rows), 'the newest segment has not yielded').toBeNull();
  });

  it('a task that never paused has no continuation, and an impostor row names none', () => {
    expect(juliusYieldContinuationOf(SUBJECT, [SUBJECT])).toBeNull();
    const impostor = seg(2, { role: 'PROMPT_ARCHITECT' });
    expect(juliusYieldContinuationOf(SUBJECT, [SUBJECT, impostor]), 'wrong role').toBeNull();
    const wrongParent = seg(2, { parentTaskId: 'build-9' });
    expect(juliusYieldContinuationOf(SUBJECT, [SUBJECT, wrongParent]), 'wrong parent').toBeNull();
  });

  it('a repair is its own unit: its pause continues it, not the task it repairs', () => {
    const repair = task({ taskId: 'repair:build-1:1:task', parentTaskId: 'build-1', taskType: 'repair:build', state: 'SUCCEEDED' });
    const repairSegment = task({ taskId: juliusSegmentTaskId('repair:build-1:1:task', 2), parentTaskId: 'repair:build-1:1:task', taskType: 'repair:build' });
    const rows = [SUBJECT, repair, repairSegment];
    expect(juliusYieldContinuationOf(repair, rows)?.taskId).toBe('segment:repair:build-1:1:task:2:task');
    expect(juliusYieldContinuationOf(SUBJECT, rows), 'the repaired build did not yield').toBeNull();
  });
});

describe('acceptance and liveness reach a yielded dispatch only through its continuation', () => {
  const decision = (taskId: string, action: string) => ({
    decisionId: `d:${taskId}`, runId: 'run-1', taskId, action, reasonCode: 'X', evidenceIds: [], safeSummary: 'x',
  }) as unknown as JuliusRecordedDecision;

  it('accepted when its continuation is accepted, and not before', () => {
    const yielded = task({ taskId: 'build-1', state: 'SUCCEEDED' });
    const continuation = seg(2, { state: 'SUCCEEDED' });
    const rows = [yielded, continuation];
    expect(effectivelyAcceptedTaskIds(rows, []).has('build-1'), 'nothing decided yet').toBe(false);
    expect(effectivelyAcceptedTaskIds(rows, [decision('segment:build-1:2:task', 'REPAIR')]).has('build-1')).toBe(false);
    expect(effectivelyAcceptedTaskIds(rows, [decision('segment:build-1:2:task', 'ACCEPT')]).has('build-1')).toBe(true);
    // An undecided task that never yielded is still never accepted.
    expect(effectivelyAcceptedTaskIds([task({ taskId: 'build-2', state: 'SUCCEEDED' })], []).has('build-2')).toBe(false);
  });

  it('a REPAIR is superseded by a repair that yielded to an accepted continuation', () => {
    const build = task({ taskId: 'build-1', state: 'SUCCEEDED' });
    const repair = task({ taskId: 'repair:build-1:1:task', parentTaskId: 'build-1', taskType: 'repair:build', state: 'SUCCEEDED' });
    const repairSegment = task({ taskId: juliusSegmentTaskId('repair:build-1:1:task', 2), parentTaskId: 'repair:build-1:1:task', taskType: 'repair:build', state: 'SUCCEEDED' });
    const accepted = effectivelyAcceptedTaskIds([build, repair, repairSegment], [
      decision('build-1', 'REPAIR'), decision('segment:repair:build-1:1:task:2:task', 'ACCEPT'),
    ]);
    expect(accepted.has('build-1')).toBe(true);
  });

  it('live while its continuation is waiting or running, dead when the continuation failed', () => {
    const yielded = task({ taskId: 'build-1', state: 'SUCCEEDED' });
    expect(canStillBeAccepted([yielded, seg(2, { state: 'BLOCKED' })], [])('build-1')).toBe(true);
    expect(canStillBeAccepted([yielded, seg(2, { state: 'RUNNABLE' })], [])('build-1')).toBe(true);
    expect(canStillBeAccepted([yielded, seg(2, { state: 'FAILED' })], [])('build-1'), 'nothing else can ever decide it').toBe(false);
  });
});

/**
 * THE REPAIR BOUND IS THE UNIT'S, WHATEVER PAUSED IN BETWEEN.
 *
 * Qualification attempt 3 (run 34766115321) ran five repair chains of up to three
 * rounds under a three-round contract, because counting stopped at every segment
 * and a repair of a segment began again at round 1.
 */
describe('repair rounds are counted across the whole unit of work, through its pauses', () => {
  const repairOf = (parent: string, round: number, over: Partial<JuliusTask> = {}): JuliusTask =>
    task({ taskId: `repair:${parent}:${round}:task`, parentTaskId: parent, taskType: 'repair:build', state: 'SUCCEEDED', ...over });
  const segmentOf = (root: string, n: number, over: Partial<JuliusTask> = {}): JuliusTask =>
    task({ taskId: juliusSegmentTaskId(root, n), parentTaskId: root, taskType: root === 'build-1' ? 'build' : 'repair:build', state: 'SUCCEEDED', ...over });

  it('a plain repair chain counts exactly as it always did', () => {
    const r1 = repairOf('build-1', 1);
    const r2 = repairOf(r1.taskId, 2);
    const rows = [SUBJECT, r1, r2];
    expect(repairRoundsBefore(SUBJECT, [SUBJECT])).toBe(0);
    expect(repairRoundsBefore(r1, [SUBJECT, r1])).toBe(1);
    expect(repairRoundsBefore(r2, rows)).toBe(2);
    expect(juliusWorkUnitRootOf(r2, rows).taskId).toBe('build-1');
  });

  it('ATTEMPT 3\'S SHAPE: pause, refuse the continuation, repair it, pause, refuse again — one unit, rounds keep counting', () => {
    // build-1 pauses -> segment 2 is refused -> repair round 1 of segment 2
    // pauses -> its segment 2 is refused -> repair round 2 of THAT segment.
    const s2 = segmentOf('build-1', 2);
    const r1 = repairOf(s2.taskId, 1);
    const r1s2 = segmentOf(r1.taskId, 2);
    const r2 = repairOf(r1s2.taskId, 2);
    const rows = [SUBJECT, s2, r1, r1s2, r2];
    for (const row of rows) expect(juliusWorkUnitRootOf(row, rows).taskId, `${row.taskId} belongs to build-1`).toBe('build-1');
    expect(repairRoundsBefore(r1s2, rows), 'the refused continuation of round 1 is already two rounds into the unit').toBe(2);
    // The old counter, repair ancestors only, would have said 0 and 1 here.
    expect(repairAncestorsOf(r1s2, rows)).toHaveLength(0);
  });

  it('pauses alone still spend nothing, and another unit\'s repairs are not this unit\'s', () => {
    const plan = task({ taskId: 'plan-1', taskType: 'plan', role: 'PROMPT_ARCHITECT' });
    const planRepair = task({ taskId: 'repair:plan-1:1:task', parentTaskId: 'plan-1', taskType: 'repair:plan', role: 'PROMPT_ARCHITECT' });
    const rows = [plan, planRepair, SUBJECT, segmentOf('build-1', 2), segmentOf('build-1', 3)];
    expect(repairRoundsBefore(segmentOf('build-1', 3), rows)).toBe(0);
    expect(repairRoundsBefore(plan, rows)).toBe(1);
  });

  it('an impostor repair-shaped row under another parent does not spend this unit\'s rounds', () => {
    const impostor = task({ taskId: 'repair:build-1:1:task', parentTaskId: 'build-9', taskType: 'repair:build' });
    expect(repairRoundsBefore(SUBJECT, [SUBJECT, impostor])).toBe(0);
  });
});

describe('a review concludes only through its research', () => {
  const PLAN = task({ taskId: 'plan-1', role: 'PROMPT_ARCHITECT', taskType: 'plan', state: 'SUCCEEDED' });
  const review = (state: string) => task({ taskId: 'plan-1:review', parentTaskId: 'plan-1', role: 'INDEPENDENT_REVIEWER', taskType: 'review:plan', state: state as never });
  const research = (n: number, state: string) => task({
    taskId: juliusSegmentTaskId('plan-1:review', n), parentTaskId: 'plan-1:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:plan', state: state as never,
  });
  const read = (tasks: readonly JuliusTask[]) => juliusReviewConclusionOf(PLAN, tasks);

  it('names each state from the task rows alone', () => {
    expect(read([PLAN]).conclusion).toBe('NONE');
    expect(read([PLAN, review('ACTIVE')]).conclusion).toBe('PENDING');
    expect(read([PLAN, review('SUCCEEDED')])).toEqual({ conclusion: 'CONCLUDED', reviewTaskId: 'plan-1:review', failedSegmentTaskId: null });
    expect(read([PLAN, review('FAILED')]).conclusion).toBe('FAILED');
    expect(read([PLAN, review('SUCCEEDED'), research(2, 'BLOCKED')]).conclusion, 'waiting on its research').toBe('PENDING');
    expect(read([PLAN, review('SUCCEEDED'), research(2, 'SUCCEEDED')]).conclusion, 'researched and concluded').toBe('CONCLUDED');
    expect(read([PLAN, review('SUCCEEDED'), research(2, 'FAILED')])).toEqual({
      conclusion: 'RESEARCH_FAILED', reviewTaskId: 'plan-1:review', failedSegmentTaskId: 'segment:plan-1:review:2:task',
    });
    expect(read([PLAN, review('SUCCEEDED'), research(2, 'SUCCEEDED'), research(3, 'CANCELLED')]).conclusion, 'the second pause failed').toBe('RESEARCH_FAILED');
  });

  it('a failed research continuation makes the work unacceptable, so nothing waits on it', () => {
    const BUILD = task({ taskId: 'build-1', dependencyIds: ['plan-1'], state: 'BLOCKED' });
    expect(canStillBeAccepted([PLAN, BUILD, review('SUCCEEDED'), research(2, 'FAILED')], [])('plan-1')).toBe(false);
    expect(canStillBeAccepted([PLAN, BUILD, review('SUCCEEDED'), research(2, 'BLOCKED')], [])('plan-1')).toBe(true);
    expect(canStillBeAccepted([PLAN, BUILD, review('SUCCEEDED')], [])('plan-1')).toBe(true);
  });
});
