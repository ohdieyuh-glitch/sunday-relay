/**
 * JULIUS'S OWN OVERHEAD, SEPARATED FROM (SIMULATED) PROVIDER WALL CLOCK.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT. Every provider here is the
 * scripted fixture adapter wrapped in an INJECTED delay — fixed, or drawn from
 * a seeded uniform distribution. The delay is SIMULATED PROVIDER LATENCY. It
 * is not, and must never be presented as, the latency of a real provider:
 * no real provider is called, nothing is paid for, and a real model's wall
 * clock is Unknown here. What IS real is everything Julius does around the
 * call — the claim, admission, context compilation, the store writes, the
 * verification decisions and the run advancement — measured on the clock the
 * caller injects.
 *
 * HOW THE TWO ARE SEPARATED. Each loop gets its own router over adapters that
 * record, per dispatch, the time spent INSIDE the adapter (the simulated
 * provider). A single loop dispatches serially, so for one loop
 *   Julius time = Σ tick wall clock − Σ in-adapter time
 * exactly, and that is the overhead figure this reports. With several loops
 * sharing one event loop, one loop's bookkeeping can delay another's timer, so
 * the multi-loop cases report MAKESPAN against the serial sum and against the
 * critical path, and do not claim a per-dispatch overhead.
 *
 * PURE BY CONSTRUCTION. No timer and no wall clock are read here: the caller
 * injects `nowMs` and `sleep`, so the mission domain stays free of Node and of
 * an ambient clock, and the same engine runs under the test and the script.
 */

import { JuliusProviderRouter, type JuliusProviderAdapter } from './julius-router';
import { JULIUS_RUNTIME_VERSION } from './julius-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';
import { JuliusRunLoop } from './julius-run-loop';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';

/** The label every figure this module produces carries. */
export const JULIUS_SIMULATED_LATENCY_LABEL =
  'SIMULATED PROVIDER LATENCY: injected delays around scripted fake providers; not real-provider latency, which is Unknown here.';

export const JULIUS_LATENCY_SCHEMA = 'julius-latency-measure.v1';

export interface JuliusLatencyPorts {
  /** A monotonic millisecond clock (e.g. `performance.now`). */
  nowMs(): number;
  /** Resolves after at least `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

export type JuliusLatencyProfile =
  | { readonly kind: 'fixed'; readonly ms: number }
  | { readonly kind: 'uniform'; readonly minMs: number; readonly maxMs: number; readonly seed: number };

export interface JuliusLatencyCase {
  readonly name: string;
  readonly missions: number;
  /** Run loops (workers, each with its own owner) sharing one store. */
  readonly loops: number;
  readonly claimLimit: number;
  readonly profile: JuliusLatencyProfile;
}

export interface JuliusLatencyStats {
  readonly count: number;
  readonly meanMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}

export interface JuliusLatencyCaseResult {
  readonly name: string;
  readonly label: string;
  readonly missions: number;
  readonly loops: number;
  readonly claimLimit: number;
  readonly profile: JuliusLatencyProfile;
  readonly completedMissions: number;
  readonly dispatches: number;
  /** Distinct tasks dispatched; equal to `dispatches` when no task ran twice. */
  readonly distinctDispatchedTasks: number;
  /** Σ injected simulated-provider delay over every dispatch. */
  readonly serialInjectedMs: number;
  /** The longest per-mission chain of injected delay: no schedule can beat it. */
  readonly criticalPathInjectedMs: number;
  /** Wall clock from the first tick to every mission terminal. */
  readonly makespanMs: number;
  /**
   * The best any schedule over `loops` serial workers could do:
   * max(critical path, serial sum ÷ loops). A lower bound, not a target.
   */
  readonly idealMakespanMs: number;
  /** Σ time spent inside the (simulated) provider adapters. */
  readonly inAdapterMs: number;
  /**
   * In-adapter time beyond the injected delay: the host's timer overshooting
   * a `sleep`. Provider-side by construction, so it is NOT counted as Julius's.
   */
  readonly timerOvershootMs: number;
  /** makespan ÷ serial injected sum; null when the sum is zero (undefined, not 0). */
  readonly makespanOverSerial: number | null;
  /** makespan ÷ ideal makespan; null when the ideal is zero. */
  readonly makespanOverIdeal: number | null;
  /**
   * JULIUS'S OWN TIME, single-loop cases only: Σ tick wall − Σ in-adapter time.
   * `null` for multi-loop cases, where it cannot be attributed honestly.
   */
  readonly juliusMs: number | null;
  readonly juliusPerDispatchMs: number | null;
  /** Julius time per dispatch ÷ mean injected delay; null when either is unknown or the delay is zero. */
  readonly juliusOverInjected: number | null;
  /** Ticks that claimed work: wall clock, and (single loop) Julius-only time. */
  readonly busyTicks: number;
  readonly idleTicks: number;
  readonly tickWall: JuliusLatencyStats;
  readonly tickJulius: JuliusLatencyStats | null;
  readonly injected: JuliusLatencyStats;
}

/* ------------------------------------------------------------ the workers */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'provider-a', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'provider-b', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'provider-c', adapterId: 'reviewer-adapter',
});

const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PROJECT = 'prj-latency';

/* ------------------------------------------------------- injected latency */

/** FNV-1a over a string, then a mulberry32 step: a deterministic unit draw per key. */
function unitDraw(seed: number, key: string): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let t = (hash + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

/**
 * THE DELAY FOR ONE DISPATCH, keyed by task id and attempt rather than by
 * dispatch order, so a multi-loop case — whose order is not deterministic —
 * still injects the same delays and the serial sum is a fixed number.
 */
export function juliusInjectedLatencyMs(profile: JuliusLatencyProfile, key: string): number {
  if (profile.kind === 'fixed') return profile.ms;
  return Math.round(profile.minMs + unitDraw(profile.seed, key) * (profile.maxMs - profile.minMs));
}

/* ------------------------------------------------------------- statistics */

export function juliusLatencyStats(values: readonly number[]): JuliusLatencyStats {
  if (values.length === 0) return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
  const round = (value: number) => Math.round(value * 1_000) / 1_000;
  return {
    count: sorted.length,
    meanMs: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    p50Ms: round(rank(0.5)), p95Ms: round(rank(0.95)), maxMs: round(sorted[sorted.length - 1]!),
  };
}

/* ------------------------------------------------------------ the measure */

interface DispatchRecord {
  readonly taskId: string;
  readonly runId: string;
  readonly injectedMs: number;
  readonly inAdapterMs: number;
}

function runIdOf(taskId: string): string {
  return taskId.split(':')[0]!;
}

/**
 * ONE CASE: N missions of plan → plan review → build → build review, driven
 * by L loops over one store until every mission is terminal.
 */
export async function measureJuliusLatencyCase(
  input: JuliusLatencyCase,
  ports: JuliusLatencyPorts,
  options: { readonly idlePollMs?: number; readonly maxWallMs?: number } = {},
): Promise<JuliusLatencyCaseResult> {
  const idlePollMs = options.idlePollMs ?? 2;
  const maxWallMs = options.maxWallMs ?? 600_000;
  const runIds = Array.from({ length: input.missions }, (_, index) => `run-${String(index).padStart(3, '0')}`);

  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'plan written' }] }] },
      { worker: CODER, script: [{ kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'tests green' }] }] },
      { worker: REVIEWER, script: [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'no blocking findings' }] }] },
    ],
    card: cardPolicy({
      allowedProviders: ['provider-a', 'provider-b', 'provider-c'],
      capabilities: ['plan', 'implement', 'review'],
      concurrency: 2,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor,
    // Ample for every case: each dispatch reports 1 000 µ$ of FAKE cost.
    budgetUsdMicros: 1_000_000_000,
  });
  for (const runId of runIds) {
    const missionId = `msn-${runId.slice(4)}`;
    const run: JuliusRunRow = {
      runId, missionId, projectId: PROJECT, state: 'READY',
      cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
    };
    harness.store.seedRun(run);
    seedTaskContractInto(harness.store, { runId, projectId: PROJECT, taskId: `${runId}:build` });
    harness.store.seedTask(runId, task({
      taskId: `${runId}:plan`, missionId, ordinal: 0,
      role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'],
    }));
    harness.store.seedTask(runId, task({
      taskId: `${runId}:build`, missionId, ordinal: 1,
      role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED',
      dependencyIds: [`${runId}:plan`], requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria(runId, [
      { criterionId: `${runId}:AC-1`, description: `the suite passes for ${missionId}`, requiredEvidenceTypes: ['TEST'] },
    ]);
  }

  /**
   * A CLOCK TIED TO THE INJECTED ONE, not the harness's stepping clock. The
   * stepping clock advances a second per read, so a loop polling idle while
   * another waits out a simulated provider would race fake time past the
   * other's lease. This one follows the measured clock, strictly increasing.
   */
  const epochMs = Date.parse('2026-10-25T00:00:00.000Z');
  const origin = ports.nowMs();
  let lastIsoMs = 0;
  const clock = {
    now() {
      const ms = Math.max(epochMs + Math.floor(ports.nowMs() - origin), lastIsoMs + 1);
      lastIsoMs = ms;
      return new Date(ms).toISOString();
    },
  };

  const attempts = new Map<string, number>();
  const loops = Array.from({ length: input.loops }, (_, loopIndex) => {
    const records: DispatchRecord[] = [];
    const adapters = new Map<string, JuliusProviderAdapter>();
    for (const [adapterId, inner] of harness.adapters) {
      adapters.set(adapterId, {
        adapterId,
        async dispatch(dispatch) {
          const attempt = (attempts.get(dispatch.taskId) ?? 0) + 1;
          attempts.set(dispatch.taskId, attempt);
          const injectedMs = juliusInjectedLatencyMs(input.profile, `${dispatch.taskId}#${String(attempt)}`);
          const started = ports.nowMs();
          if (injectedMs > 0) await ports.sleep(injectedMs);
          const result = await inner.dispatch(dispatch);
          records.push({ taskId: dispatch.taskId, runId: runIdOf(dispatch.taskId), injectedMs, inAdapterMs: ports.nowMs() - started });
          return result;
        },
      });
    }
    const deps = {
      ...harness.deps, clock, owner: `latency-worker-${String(loopIndex)}`,
      router: new JuliusProviderRouter(harness.workers, adapters, harness.health),
    };
    const loop = new JuliusRunLoop(deps, harness.policies, { claimLimit: input.claimLimit, leaseMs: 600_000 });
    return { loop, records, tickWall: [] as number[], tickJulius: [] as number[], idleTicks: 0 };
  });

  const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
  let completedMissions = 0;
  const allTerminal = async () => {
    let done = 0;
    let completed = 0;
    for (const runId of runIds) {
      const run = await harness.store.loadRun(runId, PROJECT);
      if (run !== null && terminal.has(run.state)) done += 1;
      if (run?.state === 'COMPLETED') completed += 1;
    }
    completedMissions = completed;
    return done === runIds.length;
  };

  const started = ports.nowMs();
  await Promise.all(loops.map(async (entry) => {
    while (!(await allTerminal())) {
      if (ports.nowMs() - started > maxWallMs) throw new Error(`julius_latency_case_timeout: ${input.name}`);
      const before = entry.records.length;
      const tickStarted = ports.nowMs();
      const report = await entry.loop.tick({ projectId: PROJECT });
      const wall = ports.nowMs() - tickStarted;
      if (report.claimed === 0) {
        entry.idleTicks += 1;
        // A single loop with nothing claimable and a mission not terminal is
        // a stall, not a wait: nobody else will release work.
        if (input.loops === 1) throw new Error(`julius_latency_case_stalled: ${input.name}`);
        await ports.sleep(idlePollMs);
        continue;
      }
      entry.tickWall.push(wall);
      const inAdapter = entry.records.slice(before).reduce((total, record) => total + record.inAdapterMs, 0);
      entry.tickJulius.push(wall - inAdapter);
    }
  }));
  const makespanMs = ports.nowMs() - started;

  const records = loops.flatMap((entry) => entry.records);
  const serialInjectedMs = records.reduce((total, record) => total + record.injectedMs, 0);
  const perRun = new Map<string, number>();
  for (const record of records) perRun.set(record.runId, (perRun.get(record.runId) ?? 0) + record.injectedMs);
  const criticalPathInjectedMs = Math.max(0, ...perRun.values());
  const inAdapterMs = records.reduce((total, record) => total + record.inAdapterMs, 0);
  const idealMakespanMs = Math.max(criticalPathInjectedMs, serialInjectedMs / input.loops);
  const single = input.loops === 1;
  const juliusMs = single ? loops[0]!.tickJulius.reduce((total, value) => total + value, 0) : null;
  const juliusPerDispatchMs = juliusMs === null || records.length === 0 ? null : juliusMs / records.length;
  const meanInjected = records.length === 0 ? 0 : serialInjectedMs / records.length;
  const round = (value: number) => Math.round(value * 1_000) / 1_000;
  const ratio = (value: number) => Math.round(value * 10_000) / 10_000;

  return {
    name: input.name,
    label: JULIUS_SIMULATED_LATENCY_LABEL,
    missions: input.missions, loops: input.loops, claimLimit: input.claimLimit, profile: input.profile,
    completedMissions,
    dispatches: records.length,
    distinctDispatchedTasks: new Set(records.map((record) => record.taskId)).size,
    serialInjectedMs, criticalPathInjectedMs,
    makespanMs: round(makespanMs),
    idealMakespanMs: round(idealMakespanMs),
    inAdapterMs: round(inAdapterMs),
    timerOvershootMs: round(inAdapterMs - serialInjectedMs),
    makespanOverSerial: serialInjectedMs === 0 ? null : ratio(makespanMs / serialInjectedMs),
    makespanOverIdeal: idealMakespanMs === 0 ? null : ratio(makespanMs / idealMakespanMs),
    juliusMs: juliusMs === null ? null : round(juliusMs),
    juliusPerDispatchMs: juliusPerDispatchMs === null ? null : round(juliusPerDispatchMs),
    juliusOverInjected: juliusPerDispatchMs === null || meanInjected === 0 ? null : ratio(juliusPerDispatchMs / meanInjected),
    busyTicks: loops.reduce((total, entry) => total + entry.tickWall.length, 0),
    idleTicks: loops.reduce((total, entry) => total + entry.idleTicks, 0),
    tickWall: juliusLatencyStats(loops.flatMap((entry) => entry.tickWall)),
    tickJulius: single ? juliusLatencyStats(loops[0]!.tickJulius) : null,
    injected: juliusLatencyStats(records.map((record) => record.injectedMs)),
  };
}

/* --------------------------------------------------------------- matrices */

export const JULIUS_LATENCY_JITTER: JuliusLatencyProfile = { kind: 'uniform', minMs: 50, maxMs: 500, seed: 13 };
export const JULIUS_LATENCY_ZERO: JuliusLatencyProfile = { kind: 'fixed', ms: 0 };

/** The cases the committed record holds; the test runs a subset of them. */
export function juliusLatencyMatrix(scope: 'record' | 'test'): readonly JuliusLatencyCase[] {
  const sizes = scope === 'record' ? [1, 3, 12, 50] : [1, 3, 12];
  const cases: JuliusLatencyCase[] = [];
  for (const missions of sizes) {
    cases.push({ name: `zero-latency/${String(missions)}-missions/1-loop`, missions, loops: 1, claimLimit: 10, profile: JULIUS_LATENCY_ZERO });
  }
  for (const missions of sizes.filter((size) => scope === 'record' || size <= 12)) {
    cases.push({ name: `jitter-50-500ms/${String(missions)}-missions/1-loop`, missions, loops: 1, claimLimit: 10, profile: JULIUS_LATENCY_JITTER });
  }
  cases.push({ name: 'jitter-50-500ms/12-missions/4-loops', missions: 12, loops: 4, claimLimit: 1, profile: JULIUS_LATENCY_JITTER });
  if (scope === 'record') {
    cases.push({ name: 'jitter-50-500ms/50-missions/8-loops', missions: 50, loops: 8, claimLimit: 1, profile: JULIUS_LATENCY_JITTER });
  }
  return cases;
}

export interface JuliusLatencyRecord {
  readonly schema: string;
  readonly label: string;
  readonly runtimeVersion: string;
  readonly generatedAt: string | null;
  readonly baseCommit: string | null;
  readonly environment: Readonly<Record<string, string | number | null>>;
  /** Cases run first and DISCARDED, so module loading and JIT warm-up are not booked to the first case. */
  readonly warmUpCases: number;
  readonly cases: readonly JuliusLatencyCaseResult[];
}

/** One small zero-latency case, run and discarded before a matrix. */
export const JULIUS_LATENCY_WARM_UP: JuliusLatencyCase = {
  name: 'warm-up (discarded)', missions: 3, loops: 1, claimLimit: 10, profile: { kind: 'fixed', ms: 0 },
};

export async function measureJuliusLatencyMatrix(
  cases: readonly JuliusLatencyCase[],
  ports: JuliusLatencyPorts,
  meta: { readonly generatedAt: string | null; readonly baseCommit: string | null; readonly environment: Readonly<Record<string, string | number | null>> },
): Promise<JuliusLatencyRecord> {
  await measureJuliusLatencyCase(JULIUS_LATENCY_WARM_UP, ports);
  const results: JuliusLatencyCaseResult[] = [];
  // Serially, so one case's timers never share the event loop with another's.
  for (const item of cases) results.push(await measureJuliusLatencyCase(item, ports));
  return {
    schema: JULIUS_LATENCY_SCHEMA, label: JULIUS_SIMULATED_LATENCY_LABEL, runtimeVersion: JULIUS_RUNTIME_VERSION,
    generatedAt: meta.generatedAt, baseCommit: meta.baseCommit, environment: meta.environment, warmUpCases: 1, cases: results,
  };
}
