/**
 * STAGE AND PERCENT, FROM WHAT THE RUN HAS REPORTED. Pure: no I/O, no clock.
 *
 * The input is the event list `/events` serves for one bound run (its `job`,
 * `step` and `phase` events). Nothing here estimates, interpolates or reads
 * elapsed time.
 *
 * - `stage` is the latest `phase` sample (the highest `seq`), or null when
 *   there is none or the latest sample is an `idle`/`ended` marker. A sample
 *   names the task that was active when it was posted; it is not a log.
 * - MISSION progress (`progress` on /status) is a verified fact or nothing:
 *   `{ percent: 100, basis: "verified_completion" }` only when the result read
 *   says `completed` (the evidence reader's completion) AND its checker
 *   verdict is `PASS`; otherwise `{ percent: null, basis: "none" }`. No
 *   in-flight mission percentage exists: a phase sample names only the active
 *   task, with no total, and repair tasks are minted during the run. A
 *   completed run whose checker did not pass (FAIL, NOT_RUN) has null percent.
 *   Workflow steps NEVER feed it.
 * - WORKFLOW progress (`workflowProgress`, labelled as such) is
 *   `floor(100 * stepsCompleted / stepsTotal)` over the steps
 *   GitHub has listed for the run's jobs. It is null, with `basis: "none"`,
 *   unless at least one job and one step are listed and every job GitHub has
 *   shown has listed its steps or finished (a job still queued or waiting
 *   with no steps listed has an unknown size). A step counts as completed
 *   once GitHub reports it `completed`, whatever its conclusion. Steps are
 *   told apart by job name and step name, as the events carry them.
 */

import type { WonderlandMissionEvent } from './wonderland-mission-events-route';

export interface WonderlandMissionStage {
  readonly role: string | null;
  readonly taskType: string | null;
  readonly state: string | null;
  readonly ordinal: number | null;
  readonly repairCycle: number | null;
  /** When GitHub recorded the sample. */
  readonly at: string | null;
  readonly sampled: true;
}

/** Verifiable MISSION progress: a checked completion, or nothing. */
export interface WonderlandMissionProgress {
  readonly percent: 100 | null;
  readonly basis: 'verified_completion' | 'none';
}

export const NO_PROGRESS: WonderlandMissionProgress = { percent: null, basis: 'none' };

/** The label every `workflowProgress` carries, so no client mistakes it for mission progress. */
export const WORKFLOW_PROGRESS_LABEL = 'GitHub workflow steps (not mission progress)';

/** GitHub workflow step progress of the bound run. Not mission progress. */
export interface WonderlandWorkflowProgress {
  readonly label: typeof WORKFLOW_PROGRESS_LABEL;
  readonly percent: number | null;
  readonly basis: 'workflow_steps' | 'none';
  readonly stepsCompleted: number | null;
  readonly stepsTotal: number | null;
}

export const NO_WORKFLOW_PROGRESS: WonderlandWorkflowProgress = {
  label: WORKFLOW_PROGRESS_LABEL, percent: null, basis: 'none', stepsCompleted: null, stepsTotal: null,
};

/**
 * Mission progress from the result read only: 100 for a completed run the
 * pinned checker passed, else null. Takes no events, so a workflow step can
 * never reach it.
 */
export function missionProgress(result: { readonly state?: unknown; readonly checkerVerdict?: unknown } | null): WonderlandMissionProgress {
  if (result !== null && result.state === 'completed' && result.checkerVerdict === 'PASS') {
    return { percent: 100, basis: 'verified_completion' };
  }
  return NO_PROGRESS;
}

/** The latest task sample, or null. An idle or ended marker as the latest sample is no stage. */
export function missionStage(events: readonly WonderlandMissionEvent[]): WonderlandMissionStage | null {
  let latest: WonderlandMissionEvent | null = null;
  for (const event of events) {
    if (event.kind !== 'phase') continue;
    if (latest === null || event.seq > latest.seq) latest = event;
  }
  if (latest === null || latest.marker !== null) return null;
  return {
    role: latest.role ?? null,
    taskType: latest.taskType ?? null,
    state: latest.state ?? null,
    ordinal: latest.ordinal ?? null,
    repairCycle: latest.repairCycle ?? null,
    at: latest.at,
    sampled: true,
  };
}

/** Completed over listed workflow steps, or null when that count is not known. Not mission progress. */
export function workflowProgress(events: readonly WonderlandMissionEvent[]): WonderlandWorkflowProgress {
  // The latest reported status of each job and of each step, by event order.
  const jobs = new Map<string, { seq: number; status: string }>();
  const steps = new Map<string, { seq: number; status: string }>();
  const jobsWithSteps = new Set<string>();
  for (const event of events) {
    if (event.kind === 'job') {
      const name = event.job ?? event.name;
      if (name === undefined || typeof event.status !== 'string') return NO_WORKFLOW_PROGRESS;
      const prior = jobs.get(name);
      if (prior === undefined || event.seq > prior.seq) jobs.set(name, { seq: event.seq, status: event.status });
    } else if (event.kind === 'step') {
      if (event.job === undefined || event.name === undefined || typeof event.status !== 'string') return NO_WORKFLOW_PROGRESS;
      jobsWithSteps.add(event.job);
      const key = JSON.stringify([event.job, event.name]);
      const prior = steps.get(key);
      if (prior === undefined || event.seq > prior.seq) steps.set(key, { seq: event.seq, status: event.status });
    }
  }
  if (jobs.size === 0 || steps.size === 0) return NO_WORKFLOW_PROGRESS;
  // A job GitHub has shown without its steps has an unknown size, unless it finished.
  for (const [name, job] of jobs) {
    if (!jobsWithSteps.has(name) && job.status !== 'completed') return NO_WORKFLOW_PROGRESS;
  }
  // Steps of a job GitHub has not shown are not a count this can trust.
  for (const name of jobsWithSteps) {
    if (!jobs.has(name)) return NO_WORKFLOW_PROGRESS;
  }
  const stepsTotal = steps.size;
  let stepsCompleted = 0;
  for (const step of steps.values()) if (step.status === 'completed') stepsCompleted += 1;
  return { label: WORKFLOW_PROGRESS_LABEL, percent: Math.floor((100 * stepsCompleted) / stepsTotal), basis: 'workflow_steps', stepsCompleted, stepsTotal };
}
