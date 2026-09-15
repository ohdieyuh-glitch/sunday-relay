import { describe, expect, it } from 'vitest';

import type { JuliusTask, JuliusWorkerRole } from './julius-runtime';
import { JULIUS_DEFAULT_MAX_CODER_SEGMENTS } from './julius-verification-runtime';
import { MAX_TASK_ATTEMPTS } from './julius-task-pipeline';
import { juliusTickAllowance, planJuliusTickBudget, type JuliusTickStructure } from './julius-tick-budget';

/**
 * THE TICK ALLOWANCE, COUNTED FROM THE MISSION'S OWN STRUCTURE.
 *
 * The regression cases are the two paid runs that met the old ceiling of 32:
 * attempt 4 (run 34774471909, main 44fd503a) and attempt 3 (run 34766115321,
 * main 9fc999f7). Their task graphs below are the bundles' tasks.tsv rows, with
 * the run id shortened to R.
 */

type Row = readonly [taskId: string, taskType: string, role: JuliusWorkerRole, state: JuliusTask['state'], parentTaskId: string | null];
const graph = (rows: readonly Row[]): JuliusTask[] => rows.map(([taskId, taskType, role, state, parentTaskId], ordinal) => ({
  taskId, taskType, role, state, parentTaskId, ordinal, missionId: 'mission:julius-continuous-1',
  dependencyIds: parentTaskId === null ? [] : [parentTaskId], requiredEvidenceTypes: [],
}));

/** julius-continuous-1 as both attempts ran it: plan + build, 3 repair cycles, reviewer required. */
const CONTINUOUS_1: JuliusTickStructure = {
  units: ['PROMPT_ARCHITECT', 'CODING_AGENT'], repairRounds: 3,
  segmentCeiling: JULIUS_DEFAULT_MAX_CODER_SEGMENTS, reviewerRequired: true, taskAttempts: MAX_TASK_ATTEMPTS,
};

const ATTEMPT_4: readonly Row[] = [
  ["run:R:plan", "plan", "PROMPT_ARCHITECT", "SUCCEEDED", null],
  ["run:R:build", "build", "CODING_AGENT", "SUCCEEDED", null],
  ["segment:run:R:plan:2:task", "plan", "PROMPT_ARCHITECT", "SUCCEEDED", "run:R:plan"],
  ["segment:run:R:build:2:task", "build", "CODING_AGENT", "SUCCEEDED", "run:R:build"],
  ["segment:run:R:plan:3:task", "plan", "PROMPT_ARCHITECT", "SUCCEEDED", "run:R:plan"],
  ["repair:segment:run:R:plan:3:task:1:task", "repair:plan", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:run:R:plan:3:task"],
  ["segment:run:R:build:3:task", "build", "CODING_AGENT", "SUCCEEDED", "run:R:build"],
  ["segment:run:R:plan:3:task:review", "review:plan", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:run:R:plan:3:task"],
  ["guidance:segment:run:R:build:3:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:run:R:build:3:task"],
  ["guidance:segment:run:R:build:3:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:segment:run:R:build:3:task:1:task"],
  ["segment:repair:segment:run:R:plan:3:task:1:task:2:task", "repair:plan", "PROMPT_ARCHITECT", "SUCCEEDED", "repair:segment:run:R:plan:3:task:1:task"],
  ["segment:run:R:build:4:task", "build", "CODING_AGENT", "SUCCEEDED", "run:R:build"],
  ["repair:segment:run:R:build:4:task:1:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "segment:run:R:build:4:task"],
  ["segment:repair:segment:run:R:plan:3:task:1:task:2:task:review", "review:repair:plan", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:segment:run:R:plan:3:task:1:task:2:task"],
  ["segment:run:R:build:4:task:review", "review:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:run:R:build:4:task"],
  ["repair:segment:repair:segment:run:R:plan:3:task:1:task:2:task:2:task", "repair:plan", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:repair:segment:run:R:plan:3:task:1:task:2:task"],
  ["segment:repair:segment:run:R:build:4:task:1:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:run:R:build:4:task:1:task"],
  ["guidance:segment:repair:segment:run:R:build:4:task:1:task:2:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:repair:segment:run:R:build:4:task:1:task:2:task"],
  ["segment:repair:segment:repair:segment:run:R:plan:3:task:1:task:2:task:2:task:2:task", "repair:plan", "PROMPT_ARCHITECT", "SUCCEEDED", "repair:segment:repair:segment:run:R:plan:3:task:1:task:2:task:2:task"],
  ["guidance:segment:repair:segment:run:R:build:4:task:1:task:2:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:segment:repair:segment:run:R:build:4:task:1:task:2:task:1:task"],
  ["segment:repair:segment:repair:segment:run:R:plan:3:task:1:task:2:task:2:task:2:task:review", "review:repair:plan", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:segment:repair:segment:run:R:plan:3:task:1:task:2:task:2:task:2:task"],
  ["segment:repair:segment:run:R:build:4:task:1:task:3:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:run:R:build:4:task:1:task"],
  ["segment:repair:segment:run:R:build:4:task:1:task:4:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:run:R:build:4:task:1:task"],
  ["guidance:segment:repair:segment:run:R:build:4:task:1:task:4:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:repair:segment:run:R:build:4:task:1:task:4:task"],
  ["segment:repair:segment:run:R:build:4:task:1:task:4:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:segment:run:R:build:4:task:1:task:4:task"],
  ["guidance:segment:repair:segment:run:R:build:4:task:1:task:4:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:segment:repair:segment:run:R:build:4:task:1:task:4:task:1:task"],
  ["repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "segment:repair:segment:run:R:build:4:task:1:task:4:task"],
  ["segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task"],
  ["segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:3:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task"],
  ["segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task"],
  ["guidance:segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task"],
  ["segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "RUNNABLE", "segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task"],
  ["guidance:segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:segment:repair:segment:repair:segment:run:R:build:4:task:1:task:4:task:2:task:4:task:1:task"],
];

const ATTEMPT_3: readonly Row[] = [
  ["run:R:plan", "plan", "PROMPT_ARCHITECT", "SUCCEEDED", null],
  ["run:R:build", "build", "CODING_AGENT", "SUCCEEDED", null],
  ["run:R:plan:review", "review:plan", "INDEPENDENT_REVIEWER", "SUCCEEDED", "run:R:plan"],
  ["repair:run:R:build:1:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "run:R:build"],
  ["run:R:build:review", "review:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "run:R:build"],
  ["guidance:repair:run:R:build:1:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "repair:run:R:build:1:task"],
  ["repair:run:R:build:1:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "repair:run:R:build:1:task"],
  ["guidance:repair:run:R:build:1:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:repair:run:R:build:1:task:1:task"],
  ["repair:repair:run:R:build:1:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:run:R:build:1:task"],
  ["segment:repair:run:R:build:1:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:run:R:build:1:task"],
  ["guidance:segment:repair:run:R:build:1:task:2:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "segment:repair:run:R:build:1:task:2:task"],
  ["repair:repair:run:R:build:1:task:2:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "repair:repair:run:R:build:1:task:2:task"],
  ["repair:segment:repair:run:R:build:1:task:2:task:1:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "segment:repair:run:R:build:1:task:2:task"],
  ["segment:repair:run:R:build:1:task:2:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:run:R:build:1:task:2:task"],
  ["guidance:segment:repair:run:R:build:1:task:2:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:segment:repair:run:R:build:1:task:2:task:1:task"],
  ["repair:segment:repair:run:R:build:1:task:2:task:1:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "repair:segment:repair:run:R:build:1:task:2:task:1:task"],
  ["segment:repair:repair:run:R:build:1:task:2:task:2:task", "repair:build", "CODING_AGENT", "BLOCKED", "repair:repair:run:R:build:1:task:2:task"],
  ["segment:repair:run:R:build:1:task:3:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:run:R:build:1:task"],
  ["repair:repair:repair:run:R:build:1:task:2:task:3:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:repair:run:R:build:1:task:2:task"],
  ["repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:segment:repair:run:R:build:1:task:2:task:1:task"],
  ["repair:segment:repair:run:R:build:1:task:3:task:1:task", "repair:build", "CODING_AGENT", "RUNNABLE", "segment:repair:run:R:build:1:task:3:task"],
  ["segment:repair:run:R:build:1:task:3:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:run:R:build:1:task:3:task"],
  ["segment:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task", "repair:build", "CODING_AGENT", "BLOCKED", "repair:segment:repair:run:R:build:1:task:2:task:1:task"],
  ["guidance:repair:repair:repair:run:R:build:1:task:2:task:3:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "repair:repair:repair:run:R:build:1:task:2:task:3:task"],
  ["guidance:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:1:task", "guidance", "PROMPT_ARCHITECT", "RUNNABLE", "repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task"],
  ["repair:repair:repair:run:R:build:1:task:2:task:3:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "RUNNABLE", "repair:repair:repair:run:R:build:1:task:2:task:3:task"],
  ["repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task"],
  ["segment:repair:run:R:build:1:task:4:task", "repair:build", "CODING_AGENT", "BLOCKED", "repair:run:R:build:1:task"],
  ["guidance:repair:repair:repair:run:R:build:1:task:2:task:3:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:repair:repair:repair:run:R:build:1:task:2:task:3:task:1:task"],
  ["segment:repair:repair:repair:run:R:build:1:task:2:task:3:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:repair:repair:run:R:build:1:task:2:task:3:task"],
  ["segment:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:2:task", "repair:build", "CODING_AGENT", "BLOCKED", "repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task"],
  ["repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task"],
  ["repair:segment:repair:repair:repair:run:R:build:1:task:2:task:3:task:2:task:1:task", "repair:build", "CODING_AGENT", "RUNNABLE", "segment:repair:repair:repair:run:R:build:1:task:2:task:3:task:2:task"],
  ["segment:repair:repair:repair:run:R:build:1:task:2:task:3:task:2:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:repair:repair:run:R:build:1:task:2:task:3:task:2:task"],
  ["guidance:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:1:task", "guidance", "PROMPT_ARCHITECT", "SUCCEEDED", "repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task"],
  ["repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task"],
  ["segment:repair:repair:repair:run:R:build:1:task:2:task:3:task:3:task", "repair:build", "CODING_AGENT", "BLOCKED", "repair:repair:repair:run:R:build:1:task:2:task:3:task"],
  ["guidance:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:1:task:review", "review:guidance", "INDEPENDENT_REVIEWER", "SUCCEEDED", "guidance:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:1:task"],
  ["segment:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:2:task", "repair:build", "CODING_AGENT", "SUCCEEDED", "repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task"],
  ["repair:segment:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:2:task:1:task", "repair:build", "CODING_AGENT", "FAILED", "segment:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:2:task"],
  ["segment:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:2:task:review", "review:repair:build", "INDEPENDENT_REVIEWER", "SUCCEEDED", "segment:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:2:task"],
  ["segment:repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task:3:task", "repair:build", "CODING_AGENT", "BLOCKED", "repair:repair:repair:segment:repair:run:R:build:1:task:2:task:1:task:2:task:3:task"],
];

/** The seeded unit a task belongs to: follow parents to a root. */
const unitOf = (task: JuliusTask, byId: ReadonlyMap<string, JuliusTask>): string => {
  let current = task;
  while (current.parentTaskId !== null) current = byId.get(current.parentTaskId)!;
  return current.taskId;
};
/** Tasks that were dispatched: one tick each on the live path. A RUNNABLE task was still waiting. */
const dispatched = (tasks: readonly JuliusTask[]) =>
  tasks.filter((task) => task.state === 'SUCCEEDED' || task.state === 'FAILED');

describe('the derivation', () => {
  it('counts julius-continuous-1: 73 planned, 1729 at the hard maximum, with its reason in closed tokens', () => {
    const budget = planJuliusTickBudget(CONTINUOUS_1);
    // Architect: (3+1) lineages x (4 segments + 1 review) = 20.
    // Coder: (3+1) x (4 segments + 4 guidance + 4 guidance reviews + 1 review) = 52.
    // Plus the advance that settles the run.
    expect(budget.plannedTicks).toBe(20 + 52 + 1);
    // Every path: architect 4 x (4 + 4 review segments) = 32; coder
    // 4 x (4 + 4 x (4 guidance lineages x (4 + 4)) + 4) = 544; x 3 attempts, + 1.
    expect(budget.hardMaxTicks).toBe((32 + 544) * 3 + 1);
    expect(budget.reason).toBe('units=PROMPT_ARCHITECT,CODING_AGENT repair_rounds=3 segment_ceiling=4 reviewer=required attempts=3');
    expect(budget.version).toBe('julius-tick-budget.v1');
  });

  it('follows each term: rounds, segments, reviews and units each move the plan by exactly their share', () => {
    const one = { ...CONTINUOUS_1, units: ['PROMPT_ARCHITECT'] as const, repairRounds: 0, segmentCeiling: 1 };
    expect(planJuliusTickBudget(one).plannedTicks, 'one segment, one review, one advance').toBe(3);
    expect(planJuliusTickBudget({ ...one, repairRounds: 1 }).plannedTicks).toBe(5);
    expect(planJuliusTickBudget({ ...one, segmentCeiling: 2 }).plannedTicks).toBe(4);
    expect(planJuliusTickBudget({ ...one, reviewerRequired: false }).plannedTicks).toBe(2);
    expect(planJuliusTickBudget({ ...one, units: ['CODING_AGENT'] }).plannedTicks, 'segment, guidance, its review, review, advance').toBe(5);
    expect(planJuliusTickBudget({ ...one, units: [] }).plannedTicks, 'nothing to do but settle').toBe(1);
  });

  it('never reads a malformed bound as a larger allowance', () => {
    const odd = planJuliusTickBudget({ ...CONTINUOUS_1, repairRounds: -2, segmentCeiling: Number.NaN, taskAttempts: 0 });
    expect(odd.structure).toMatchObject({ repairRounds: 0, segmentCeiling: 1, taskAttempts: 1 });
    expect(odd.plannedTicks).toBeLessThan(planJuliusTickBudget(CONTINUOUS_1).plannedTicks);
  });
});

describe('attempt 4 (run 34774471909): the old ceiling stopped a run the structure still permitted', () => {
  const tasks = graph(ATTEMPT_4);
  const budget = planJuliusTickBudget(CONTINUOUS_1);

  it('consumed 32 ticks, one per dispatch, with 41 of its 73 still allowed and nothing beyond the main path', () => {
    expect(dispatched(tasks)).toHaveLength(32);
    const now = juliusTickAllowance({ budget, tasks, retries: 0 });
    expect(now).toEqual({ allowance: 73, beyondMainPath: 0, retries: 0 });
    expect(now.allowance - 32, 'the ticks the old ceiling took away').toBe(41);
  });

  it('stayed inside each unit share: plan 10 of 20, build 22 of 52', () => {
    const byId = new Map(tasks.map((task) => [task.taskId, task]));
    const perUnit = new Map<string, number>();
    for (const task of dispatched(tasks)) {
      const unit = unitOf(task, byId);
      perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
    }
    expect(Object.fromEntries(perUnit)).toEqual({ 'run:R:plan': 10, 'run:R:build': 22 });
    const segments = JULIUS_DEFAULT_MAX_CODER_SEGMENTS;
    expect(perUnit.get('run:R:plan')!).toBeLessThanOrEqual((3 + 1) * (segments + 1));
    expect(perUnit.get('run:R:build')!).toBeLessThanOrEqual((3 + 1) * (3 * segments + 1));
  });

  it('would have reached a decision inside the allowance: a third build round costs at most 13 more dispatches', () => {
    // The RUNNABLE review of round 2, a round-3 lineage at the main-path
    // maximum, and the advance.
    expect(tasks.filter((task) => task.state === 'RUNNABLE').map((task) => task.taskType)).toEqual(['review:repair:build']);
    const projected = 32 + 1 + (3 * JULIUS_DEFAULT_MAX_CODER_SEGMENTS + 1) + 1;
    expect(projected).toBe(47);
    expect(projected).toBeLessThanOrEqual(budget.plannedTicks);
  });
});

describe('attempt 3 (run 34766115321): a fan-out cannot buy itself more ticks', () => {
  const tasks = graph(ATTEMPT_3);
  const budget = planJuliusTickBudget(CONTINUOUS_1);

  it('its build unit opened more repair lineages than three rounds allow, and the allowance did not grow for them', () => {
    const repairRoots = tasks.filter((task) => task.taskType === 'repair:build' && task.taskId.startsWith('repair:'));
    expect(repairRoots.length, 'repair lineages minted by the pre-#268 fan-out').toBeGreaterThan(CONTINUOUS_1.repairRounds);
    const now = juliusTickAllowance({ budget, tasks, retries: 0 });
    expect(now.beyondMainPath, 'repairs of work and their segments are already counted, never extensions').toBe(0);
    expect(now.allowance).toBe(budget.plannedTicks);
  });
});

describe('the allowance grows only for legitimate work the main path does not count, and never past the hard maximum', () => {
  const budget = planJuliusTickBudget(CONTINUOUS_1);
  const base = graph(ATTEMPT_4);
  const extra = (rows: readonly Row[]) => [...base, ...graph(rows)];

  it('a review that paused for research adds its continuation', () => {
    const review = 'segment:run:R:plan:3:task:review';
    expect(juliusTickAllowance({ budget, retries: 0, tasks: extra([[`segment:${review}:2:task`, 'review:plan', 'INDEPENDENT_REVIEWER', 'RUNNABLE', review]]) }))
      .toEqual({ allowance: 74, beyondMainPath: 1, retries: 0 });
  });

  it('a guidance task that paused for research adds its continuation', () => {
    const guidance = 'guidance:segment:run:R:build:3:task:1:task';
    expect(juliusTickAllowance({ budget, retries: 0, tasks: extra([[`segment:${guidance}:2:task`, 'guidance', 'PROMPT_ARCHITECT', 'RUNNABLE', guidance]]) }).beyondMainPath).toBe(1);
  });

  it('a repaired guidance adds itself and its review', () => {
    const guidance = 'guidance:segment:run:R:build:3:task:1:task';
    expect(juliusTickAllowance({ budget, retries: 0, tasks: extra([[`repair:${guidance}:1:task`, 'repair:guidance', 'PROMPT_ARCHITECT', 'RUNNABLE', guidance]]) }).beyondMainPath).toBe(2);
  });

  it('a retried attempt adds the tick it cost', () => {
    expect(juliusTickAllowance({ budget, tasks: base, retries: 2 })).toEqual({ allowance: 75, beyondMainPath: 0, retries: 2 });
  });

  it('nothing extends past the hard maximum, and a malformed count adds nothing', () => {
    expect(juliusTickAllowance({ budget, tasks: base, retries: 10_000 }).allowance).toBe(budget.hardMaxTicks);
    expect(juliusTickAllowance({ budget, tasks: base, retries: -5 }).allowance).toBe(73);
  });
});
