import { describe, expect, it } from 'vitest';

import {
  effectivelyAcceptedTaskIds, isJuliusRepairOf, repairAncestorsOf, repairLineageRootOf,
  repairRoundsBefore, repairTaskTypeFor, stageOfTaskType,
} from './julius-repair-lineage';
import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';

const tsk = (taskId: string, over: Partial<JuliusTask> = {}): JuliusTask => ({
  taskId, missionId: 'msn-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'SUCCEEDED', ...over,
});
const repairOf = (parent: JuliusTask, round = 1, over: Partial<JuliusTask> = {}): JuliusTask =>
  tsk(`repair:${parent.taskId}:${round}:task`, {
    parentTaskId: parent.taskId, taskType: repairTaskTypeFor(parent.taskType), role: parent.role,
    ordinal: parent.ordinal + round, ...over,
  });
const decision = (taskId: string, action: JuliusRecordedDecision['action']): JuliusRecordedDecision =>
  ({ taskId, action, reasonCode: 'x', evidenceIds: [], safeSummary: 'x' });

describe('the stage of a task type', () => {
  it('strips every repair prefix, so a repair of a repair is still its stage', () => {
    expect(stageOfTaskType('build')).toBe('build');
    expect(stageOfTaskType('repair:build')).toBe('build');
    expect(stageOfTaskType('repair:repair:plan')).toBe('plan');
  });

  it('names the repair type from the stage, idempotently across rounds', () => {
    expect(repairTaskTypeFor('plan')).toBe('repair:plan');
    expect(repairTaskTypeFor('repair:plan')).toBe('repair:plan');
    expect(repairTaskTypeFor('repair:repair:build')).toBe('repair:build');
  });
});

describe('what counts as a repair of a task', () => {
  const plan = tsk('plan-1', { taskType: 'plan', role: 'PROMPT_ARCHITECT' });
  const build = tsk('build-1', { ordinal: 1 });

  it('the planner shape: parent link, same role, repair of the parent stage, planner id', () => {
    expect(isJuliusRepairOf(plan, repairOf(plan))).toBe(true);
    expect(isJuliusRepairOf(build, repairOf(build))).toBe(true);
    // Round two chains on round one and keeps the stage type.
    const first = repairOf(build);
    expect(isJuliusRepairOf(first, repairOf(first))).toBe(true);
    expect(repairOf(first).taskType).toBe('repair:build');
  });

  it('a plan revised by the Coding Agent is not the planner shape', () => {
    // The shape paid run 34037313976 minted: a repair of a PLAN on the coder.
    expect(isJuliusRepairOf(plan, repairOf(plan, 1, { role: 'CODING_AGENT' }))).toBe(false);
  });

  it('impostors: wrong parent, wrong type, wrong id shape, round zero', () => {
    expect(isJuliusRepairOf(build, repairOf(build, 1, { parentTaskId: 'plan-1' }))).toBe(false);
    expect(isJuliusRepairOf(build, repairOf(build, 1, { taskType: 'build' }))).toBe(false);
    expect(isJuliusRepairOf(build, tsk('subagent:sub-1', { parentTaskId: 'build-1', taskType: 'repair:build' }))).toBe(false);
    expect(isJuliusRepairOf(build, repairOf(build, 0))).toBe(false);
  });
});

describe('lineage, depth and rounds from task rows alone', () => {
  const build = tsk('build-1');
  const r1 = repairOf(build, 1);
  const r2 = repairOf(r1, 1);
  const tasks = [build, r1, r2];

  it('walks ancestors nearest-first and finds the root', () => {
    expect(repairAncestorsOf(r2, tasks).map((task) => task.taskId)).toEqual([r1.taskId, 'build-1']);
    expect(repairLineageRootOf(r2, tasks).taskId).toBe('build-1');
    expect(repairLineageRootOf(build, tasks).taskId).toBe('build-1');
  });

  it('counts the rounds before a new round: rounds above the subject plus rounds beneath it', () => {
    expect(repairRoundsBefore(build, [build])).toBe(0);
    expect(repairRoundsBefore(build, [build, r1])).toBe(1);
    // Repairing round one's task: one round above it, none beneath → the next is round 2.
    expect(repairRoundsBefore(r1, tasks.slice(0, 2))).toBe(1);
    expect(repairRoundsBefore(r2, tasks)).toBe(2);
  });

  it('stops at a broken or cyclic parent link instead of looping', () => {
    const loopA = tsk('repair:b:1:task', { parentTaskId: 'b', taskType: 'repair:build' });
    const loopB = tsk('b', { parentTaskId: 'repair:b:1:task' });
    expect(repairAncestorsOf(loopA, [loopA, loopB]).map((task) => task.taskId)).toEqual(['b']);
  });
});

describe('effective acceptance', () => {
  const build = tsk('build-1');
  const r1 = repairOf(build, 1);
  const r2 = repairOf(r1, 1);

  it('ACCEPT is accepted; a REPAIR nobody repaired is not; HALT never is', () => {
    expect([...effectivelyAcceptedTaskIds([build], [decision('build-1', 'ACCEPT')])]).toEqual(['build-1']);
    expect([...effectivelyAcceptedTaskIds([build], [decision('build-1', 'REPAIR')])]).toEqual([]);
    expect([...effectivelyAcceptedTaskIds([build, r1], [decision('build-1', 'HALT'), decision(r1.taskId, 'ACCEPT')])]).toEqual([r1.taskId]);
  });

  it('a REPAIR is superseded by an accepted repair lineage, through every round', () => {
    const accepted = effectivelyAcceptedTaskIds(
      [build, r1, r2],
      [decision('build-1', 'REPAIR'), decision(r1.taskId, 'REPAIR'), decision(r2.taskId, 'ACCEPT')],
    );
    expect([...accepted].sort()).toEqual(['build-1', r1.taskId, r2.taskId].sort());
  });

  it('a repair that has not SUCCEEDED supersedes nothing, whatever its decision says', () => {
    const failed = { ...r1, state: 'FAILED' as const };
    expect([...effectivelyAcceptedTaskIds([build, failed], [decision('build-1', 'REPAIR'), decision(failed.taskId, 'ACCEPT')])]).toEqual([failed.taskId]);
  });

  it('only the CURRENT decision counts, and the accepting actions are the caller\'s', () => {
    const later = [decision('build-1', 'ACCEPT'), decision('build-1', 'REPAIR')];
    expect([...effectivelyAcceptedTaskIds([build], later)]).toEqual([]);
    expect([...effectivelyAcceptedTaskIds([build], [decision('build-1', 'COMPLETE')])]).toEqual([]);
    expect([...effectivelyAcceptedTaskIds([build], [decision('build-1', 'COMPLETE')], ['ACCEPT', 'COMPLETE'])]).toEqual(['build-1']);
  });
});
