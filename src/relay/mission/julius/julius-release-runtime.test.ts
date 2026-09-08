import { describe, expect, it } from 'vitest';

import { canStillBeAccepted, evaluateJuliusRelease } from './julius-release-runtime';
import { repairTaskTypeFor } from './julius-repair-lineage';
import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';

const tsk = (taskId: string, over: Partial<JuliusTask> = {}): JuliusTask => ({
  taskId, missionId: 'msn-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'SUCCEEDED', ...over,
});
const decision = (taskId: string, action: JuliusRecordedDecision['action']): JuliusRecordedDecision =>
  ({ taskId, action, reasonCode: 'x', evidenceIds: [], safeSummary: 'x' });

/** The declared live graph: plan, a review of it, and a build blocked on the plan. */
const plan = tsk('plan-1', { taskType: 'plan', role: 'PROMPT_ARCHITECT' });
const planReview = tsk('plan-1:review', {
  parentTaskId: 'plan-1', dependencyIds: ['plan-1'], taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER', ordinal: 1,
});
const build = tsk('build-1', { dependencyIds: ['plan-1'], ordinal: 1, state: 'BLOCKED' });

describe('DEFECT 4 — a build is released by the plan review\'s acceptance, not by the plan\'s success', () => {
  it('plan success alone releases nothing', () => {
    const result = evaluateJuliusRelease({ tasks: [plan, planReview, build], decisions: [] });
    expect(result.releasable).toEqual([]);
    expect(result.withheld).toEqual([{ taskId: 'build-1', waitingOn: ['plan-1'] }]);
  });

  it('an ACCEPT on the plan releases the build, exactly once and deterministically', () => {
    const result = evaluateJuliusRelease({
      tasks: [plan, { ...planReview, state: 'SUCCEEDED' }, build], decisions: [decision('plan-1', 'ACCEPT')],
    });
    expect(result.releasable).toEqual(['build-1']);
    expect(result.withheld).toEqual([]);
    // Already released → no longer BLOCKED → not offered again.
    const again = evaluateJuliusRelease({
      tasks: [plan, planReview, { ...build, state: 'RUNNABLE' }], decisions: [decision('plan-1', 'ACCEPT')],
    });
    expect(again.releasable).toEqual([]);
  });

  it('a rejected plan review releases nothing', () => {
    const result = evaluateJuliusRelease({ tasks: [plan, planReview, build], decisions: [decision('plan-1', 'REPAIR')] });
    expect(result.releasable).toEqual([]);
    expect(result.withheld[0]?.waitingOn).toEqual(['plan-1']);
  });

  it('a HALT on the plan releases nothing, ever', () => {
    const result = evaluateJuliusRelease({ tasks: [plan, planReview, build], decisions: [decision('plan-1', 'HALT')] });
    expect(result.releasable).toEqual([]);
  });

  it('a revised plan accepted through its repair lineage releases the build', () => {
    const revision = tsk('repair:plan-1:1:task', {
      parentTaskId: 'plan-1', taskType: repairTaskTypeFor('plan'), role: 'PROMPT_ARCHITECT', ordinal: 1,
    });
    const result = evaluateJuliusRelease({
      tasks: [plan, planReview, build, revision],
      decisions: [decision('plan-1', 'REPAIR'), decision(revision.taskId, 'ACCEPT')],
    });
    expect(result.releasable).toEqual(['build-1']);
  });

  it('a revised plan that was itself rejected keeps the build blocked', () => {
    const revision = tsk('repair:plan-1:1:task', {
      parentTaskId: 'plan-1', taskType: repairTaskTypeFor('plan'), role: 'PROMPT_ARCHITECT', ordinal: 1,
    });
    const result = evaluateJuliusRelease({
      tasks: [plan, planReview, build, revision],
      decisions: [decision('plan-1', 'REPAIR'), decision(revision.taskId, 'REPAIR')],
    });
    expect(result.releasable).toEqual([]);
  });
});

describe('the dependency rule in general', () => {
  it('SKIPPED satisfies; FAILED, CANCELLED, ACTIVE and missing dependencies never do', () => {
    const dependent = tsk('d', { dependencyIds: ['a', 'b', 'c', 'missing'], state: 'BLOCKED' });
    const result = evaluateJuliusRelease({
      tasks: [tsk('a', { state: 'SKIPPED' }), tsk('b', { state: 'FAILED' }), tsk('c', { state: 'ACTIVE' }), dependent],
      decisions: [decision('b', 'ACCEPT'), decision('c', 'ACCEPT')],
    });
    expect(result.releasable).toEqual([]);
    expect(result.withheld[0]?.waitingOn).toEqual(['b', 'c', 'missing']);
  });

  it('a fan-in is released only when EVERY dependency is accepted', () => {
    const join = tsk('join', { dependencyIds: ['a', 'b'], state: 'BLOCKED', ordinal: 2 });
    const tasks = [tsk('a'), tsk('b', { ordinal: 1 }), join];
    expect(evaluateJuliusRelease({ tasks, decisions: [decision('a', 'ACCEPT')] }).releasable).toEqual([]);
    expect(evaluateJuliusRelease({ tasks, decisions: [decision('a', 'ACCEPT'), decision('b', 'ACCEPT')] }).releasable).toEqual(['join']);
  });

  it('COMPLETE is an acceptance for release purposes', () => {
    const tasks = [tsk('a'), tsk('b', { dependencyIds: ['a'], state: 'BLOCKED' })];
    expect(evaluateJuliusRelease({ tasks, decisions: [decision('a', 'COMPLETE')] }).releasable).toEqual(['b']);
  });

  it('an unrelated ACCEPT releases nothing', () => {
    const tasks = [tsk('a'), tsk('z'), tsk('b', { dependencyIds: ['a'], state: 'BLOCKED' })];
    expect(evaluateJuliusRelease({ tasks, decisions: [decision('z', 'ACCEPT')] }).releasable).toEqual([]);
  });

  it('orders releasable tasks by ordinal then id, so two evaluators agree', () => {
    const tasks = [tsk('a'), tsk('y', { dependencyIds: ['a'], state: 'BLOCKED', ordinal: 3 }), tsk('x', { dependencyIds: ['a'], state: 'BLOCKED', ordinal: 3 }), tsk('w', { dependencyIds: ['a'], state: 'BLOCKED', ordinal: 1 })];
    expect(evaluateJuliusRelease({ tasks, decisions: [decision('a', 'ACCEPT')] }).releasable).toEqual(['w', 'x', 'y']);
  });

  it('is pure: the same rows give the same answer after a "restart"', () => {
    const tasks = [plan, planReview, build];
    const decisions = [decision('plan-1', 'ACCEPT')];
    const first = evaluateJuliusRelease({ tasks, decisions });
    const second = evaluateJuliusRelease({ tasks: structuredClone(tasks), decisions: structuredClone(decisions) });
    expect(second).toEqual(first);
  });
});

describe('whether a SUCCEEDED task can still be accepted', () => {
  const kid = (id: string, over: Partial<JuliusTask>): JuliusTask => tsk(id, { parentTaskId: 'plan-1', ...over });
  const reviewKid = (state: JuliusTask['state']) =>
    kid('plan-1:review', { state, taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER' });

  it('a task with no review scheduled yet is live: verification has not run', () => {
    expect(canStillBeAccepted([plan], [])('plan-1')).toBe(true);
  });

  it('a review still running or awaiting its verdict keeps it live; a review that failed for good does not', () => {
    for (const state of ['RUNNABLE', 'ACTIVE', 'BLOCKED', 'SUCCEEDED'] as const) {
      expect(canStillBeAccepted([plan, reviewKid(state)], [])('plan-1'), state).toBe(true);
    }
    for (const state of ['FAILED', 'CANCELLED'] as const) {
      expect(canStillBeAccepted([plan, reviewKid(state)], [])('plan-1'), state).toBe(false);
    }
  });

  it('ONLY a review decides it: a succeeded sub-agent child cannot mask a review that failed', () => {
    // The children map is keyed by parentTaskId alone, so any child used to
    // keep its parent live — and a sub-agent (created with the requesting task
    // as its parent) would hold a dependent waiting on an acceptance that can
    // never come.
    const subagent = kid('subagent:sub-1', { state: 'SUCCEEDED', taskType: 'implement', role: 'CODING_AGENT' });
    expect(canStillBeAccepted([plan, reviewKid('FAILED'), subagent], [])('plan-1')).toBe(false);
  });

  it('an accepted task is live; a halted one never is', () => {
    expect(canStillBeAccepted([plan], [decision('plan-1', 'ACCEPT')])('plan-1')).toBe(true);
    expect(canStillBeAccepted([plan], [decision('plan-1', 'HALT')])('plan-1')).toBe(false);
  });

  it('a REPAIR is live only while a repair of the planner\'s own shape can still accept it', () => {
    const revision = (over: Partial<JuliusTask> = {}): JuliusTask => tsk('repair:plan-1:1:task', {
      parentTaskId: 'plan-1', taskType: repairTaskTypeFor('plan'), role: 'PROMPT_ARCHITECT', state: 'RUNNABLE', ...over,
    });
    const repaired = [decision('plan-1', 'REPAIR')];
    expect(canStillBeAccepted([plan, revision()], repaired)('plan-1')).toBe(true);
    expect(canStillBeAccepted([plan, revision({ state: 'FAILED' })], repaired)('plan-1')).toBe(false);
    expect(canStillBeAccepted([plan, revision({ state: 'SUCCEEDED' })], [...repaired, decision('repair:plan-1:1:task', 'ACCEPT')])('plan-1')).toBe(true);
    expect(canStillBeAccepted([plan, revision({ state: 'SUCCEEDED' })], [...repaired, decision('repair:plan-1:1:task', 'HALT')])('plan-1')).toBe(false);
    expect(canStillBeAccepted([plan], repaired)('plan-1'), 'a REPAIR nobody repaired').toBe(false);
    // A merely repair-SHAPED child — the wrong role, as the pre-change planner
    // minted for every subject — supersedes nothing, so it cannot keep its
    // parent live either.
    expect(canStillBeAccepted([plan, revision({ role: 'CODING_AGENT' })], repaired)('plan-1')).toBe(false);
  });
});
