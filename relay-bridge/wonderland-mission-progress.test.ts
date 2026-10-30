import { describe, expect, it } from 'vitest';

import type { WonderlandMissionEvent } from './wonderland-mission-events-route';
import { missionProgress, missionStage, NO_PROGRESS, NO_WORKFLOW_PROGRESS, WORKFLOW_PROGRESS_LABEL, workflowProgress } from './wonderland-mission-progress';

let seq = 0;
const job = (name: string, status: string): WonderlandMissionEvent => ({ seq: ++seq, at: null, kind: 'job', job: name, name, status, conclusion: null });
const step = (jobName: string, name: string, status: string): WonderlandMissionEvent => ({ seq: ++seq, at: null, kind: 'step', job: jobName, name, status, conclusion: null });
const phase = (over: Partial<WonderlandMissionEvent> = {}): WonderlandMissionEvent => ({
  seq: ++seq, at: '2026-10-23T17:20:00Z', kind: 'phase', sampled: true, marker: null,
  role: 'ARCHITECT', taskType: 'plan', state: 'running', ordinal: 1, repairCycle: 0, ...over,
});

describe('mission progress: a PASS-checked completion or nothing', () => {
  it('is 100 with basis verified_completion only for completed + PASS', () => {
    expect(missionProgress({ state: 'completed', checkerVerdict: 'PASS' })).toEqual({ percent: 100, basis: 'verified_completion' });
  });

  it('is null for no result, any other state, and a completed run the checker did not pass', () => {
    expect(missionProgress(null)).toEqual(NO_PROGRESS);
    expect(NO_PROGRESS).toEqual({ percent: null, basis: 'none' });
    for (const state of ['dispatched', 'dispatching', 'failed', 'awaiting_operator', 'expired', undefined]) {
      expect(missionProgress({ state, checkerVerdict: 'PASS' }), String(state)).toEqual(NO_PROGRESS);
    }
    for (const verdict of ['FAIL', 'NOT_RUN', null, undefined, 'pass', ' PASS', 'PASSED']) {
      expect(missionProgress({ state: 'completed', checkerVerdict: verdict }), String(verdict)).toEqual(NO_PROGRESS);
    }
  });

  it('carries no step counts: workflow steps are only ever in the labelled workflowProgress', () => {
    expect(Object.keys(missionProgress({ state: 'completed', checkerVerdict: 'PASS' })).sort()).toEqual(['basis', 'percent']);
    expect(WORKFLOW_PROGRESS_LABEL).toBe('GitHub workflow steps (not mission progress)');
    expect(NO_WORKFLOW_PROGRESS.label).toBe(WORKFLOW_PROGRESS_LABEL);
  });
});

describe('workflow progress (labelled, not mission progress): percent only from listed steps, never estimated', () => {
  it('is null with no events, no jobs, or jobs without steps', () => {
    expect(workflowProgress([])).toEqual(NO_WORKFLOW_PROGRESS);
    expect(workflowProgress([phase()])).toEqual(NO_WORKFLOW_PROGRESS);
    expect(workflowProgress([job('Preflight', 'in_progress')])).toEqual(NO_WORKFLOW_PROGRESS);
    expect(workflowProgress([step('Preflight', 'checkout', 'completed')])).toEqual(NO_WORKFLOW_PROGRESS);
  });

  it('is null while a job GitHub has shown has not listed its steps (its size is unknown)', () => {
    expect(workflowProgress([
      job('Preflight', 'completed'), step('Preflight', 'checkout', 'completed'),
      job('Grade', 'queued'),
    ])).toEqual(NO_WORKFLOW_PROGRESS);
  });

  it('is null for a malformed job or step event', () => {
    expect(workflowProgress([job('A', 'in_progress'), { seq: ++seq, at: null, kind: 'step', job: 'A', status: 'completed' }])).toEqual(NO_WORKFLOW_PROGRESS);
  });

  it('counts completed over listed steps, using each step\'s latest status, floored', () => {
    expect(workflowProgress([
      job('Preflight', 'in_progress'),
      step('Preflight', 'checkout', 'in_progress'),
      step('Preflight', 'checkout', 'completed'),
      step('Preflight', 'gates', 'completed'),
      step('Preflight', 'LIVE', 'in_progress'),
      job('Done', 'completed'),
    ])).toEqual({ label: WORKFLOW_PROGRESS_LABEL, percent: 66, basis: 'workflow_steps', stepsCompleted: 2, stepsTotal: 3 });
  });
});

describe('mission stage: the latest reported sample, or null', () => {
  it('is null without a phase sample, and null when the latest is an idle or ended marker', () => {
    expect(missionStage([])).toBeNull();
    expect(missionStage([job('A', 'in_progress')])).toBeNull();
    expect(missionStage([phase(), phase({ marker: 'idle', role: null, taskType: null, state: null, ordinal: null, repairCycle: null })])).toBeNull();
  });

  it('is the highest-seq sample, as reported', () => {
    const first = phase({ ordinal: 1 });
    const second = phase({ role: 'CODER', taskType: 'implement', ordinal: 2 });
    expect(missionStage([second, first])).toEqual({ role: 'CODER', taskType: 'implement', state: 'running', ordinal: 2, repairCycle: 0, at: '2026-10-23T17:20:00Z', sampled: true });
  });
});
