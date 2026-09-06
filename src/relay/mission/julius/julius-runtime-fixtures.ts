/**
 * A COMPLETE, DETERMINISTIC JULIUS DEPLOYMENT, IN MEMORY.
 *
 * Everything the runtime needs and nothing it would find in production: a
 * worker registry, provider adapters that answer from a script, a budget
 * ledger, a monotonic clock, a counting id factory, and the in-memory store.
 * Assembled here rather than in each test so that "the components form one
 * system" is asserted against ONE composition — if the wiring is wrong, every
 * test that uses this fails together, which is the signal you want.
 *
 * DETERMINISTIC BY CONSTRUCTION. The clock advances by a fixed step on every
 * read and the id factory counts, so a scenario replays identically and a
 * recovery test can assert exact ids. Nothing here reads `Date.now()` or
 * `Math.random()`.
 *
 * THE FAKE PROVIDER IS A SCRIPT, NOT A MOCK. It answers from a queue of
 * outcomes, so a test says "this worker succeeds, then rate-limits, then
 * succeeds" as data rather than by reaching into the router.
 */

import {
  JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusDispatchError,
  type JuliusDispatchAllocation, type JuliusProviderAdapter, type JuliusProviderResult,
} from './julius-router';
import { JuliusWorkerRegistry, type JuliusWorker } from './julius-runtime';
import type { JuliusCardPolicy } from './julius-policy';
import type { JuliusVerificationPolicy } from './julius-verification-runtime';
import { createJuliusMemoryStore, type JuliusMemoryStore } from './julius-memory-store';
import { fixedResourceEstimate, type JuliusPipelineDependencies } from './julius-task-pipeline';
import { JuliusRunLoop, type JuliusPolicySource, type JuliusRunLoopConfig } from './julius-run-loop';
import type { JuliusBudgetPort, JuliusClock, JuliusIdFactory } from './julius-runtime-ports';
import type { JuliusAllocationPolicy } from './julius-allocation-runtime';

/* ---------------------------------------------------------------- clock */

export interface SteppingClock extends JuliusClock { advance(ms: number): void; }

export function createSteppingClock(startIso = '2026-08-27T00:00:00.000Z', stepMs = 1_000): SteppingClock {
  let current = Date.parse(startIso);
  return {
    now() { const value = new Date(current).toISOString(); current += stepMs; return value; },
    advance(ms) { current += ms; },
  };
}

export function createCountingIds(): JuliusIdFactory {
  const counters = new Map<string, number>();
  return {
    next(kind) {
      const value = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, value);
      return `${kind}#${value}`;
    },
  };
}

/* --------------------------------------------------------------- budget */

export interface MemoryBudget extends JuliusBudgetPort {
  /** Remaining micro-dollars. A reservation past this is DENIED, not thrown. */
  remainingUsdMicros(): number;
  reservations(): readonly { reservationId: string; state: string; usdMicros: number }[];
}

export function createMemoryBudget(ceilingUsdMicros: number): MemoryBudget {
  const held = new Map<string, { usdMicros: number; state: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'DENIED' }>();
  const outstanding = () => [...held.values()]
    .filter((row) => row.state === 'RESERVED' || row.state === 'COMMITTED')
    .reduce((total, row) => total + row.usdMicros, 0);

  return {
    async reserve(input) {
      const existing = held.get(input.reservationId);
      // IDEMPOTENT. A retried reservation returns the first answer rather than
      // holding the budget twice for one operation.
      if (existing !== undefined) {
        return existing.state === 'DENIED'
          ? { state: 'DENIED', denialReason: 'BUDGET_EXHAUSTED' }
          : { state: 'RESERVED', denialReason: null };
      }
      if (outstanding() + input.usdMicros > ceilingUsdMicros) {
        held.set(input.reservationId, { usdMicros: 0, state: 'DENIED' });
        return { state: 'DENIED', denialReason: 'BUDGET_EXHAUSTED' };
      }
      held.set(input.reservationId, { usdMicros: input.usdMicros, state: 'RESERVED' });
      return { state: 'RESERVED', denialReason: null };
    },
    async commit(input) {
      const row = held.get(input.reservationId);
      if (row === undefined || row.state !== 'RESERVED') return;
      // UNKNOWN SETTLES AT WHAT IT RESERVED. `null` is "the boundary reported
      // no cost", and freeing the hold on that would hand the rest of the
      // mission money this dispatch may already have spent.
      held.set(input.reservationId, { usdMicros: input.usdMicros ?? row.usdMicros, state: 'COMMITTED' });
    },
    async release(input) {
      const row = held.get(input.reservationId);
      if (row === undefined || row.state !== 'RESERVED') return;
      // SPENT MONEY IS CHARGED, NOT RELEASED. A failed attempt that billed
      // before it failed settles at what it billed; only an attempt that spent
      // nothing hands its whole hold back.
      const spent = typeof input.usdMicros === 'number' && Number.isFinite(input.usdMicros) && input.usdMicros > 0
        ? Math.min(input.usdMicros, row.usdMicros) : 0;
      held.set(input.reservationId, spent > 0
        ? { usdMicros: spent, state: 'COMMITTED' }
        : { usdMicros: 0, state: 'RELEASED' });
    },
    async available() { return ceilingUsdMicros - outstanding(); },
    remainingUsdMicros() { return ceilingUsdMicros - outstanding(); },
    reservations() {
      return [...held.entries()].map(([reservationId, row]) => ({ reservationId, state: row.state, usdMicros: row.usdMicros }));
    },
  };
}

/* -------------------------------------------------------------- workers */

export const WORKER_DEFAULTS = {
  capabilities: ['implement'], taskTypes: ['build'], concurrencyLimit: 2,
  timeoutMs: 30_000, maxRetries: 2, status: 'AVAILABLE',
} as const;

export function worker(over: Partial<JuliusWorker> & Pick<JuliusWorker, 'workerId' | 'role'>): JuliusWorker {
  return {
    adapterId: `${over.workerId}-adapter`, providerId: `${over.workerId}-provider`,
    ...WORKER_DEFAULTS, ...over,
  } as JuliusWorker;
}

/* ------------------------------------------------------- scripted adapter */

export type ScriptedOutcome =
  /** `usdMicros: null` reports NO cost — Unknown, which is not zero. */
  | { readonly kind: 'succeed'; readonly evidence?: readonly Record<string, unknown>[]; readonly usdMicros?: number | null }
  /** `costUsdMicros` is what the boundary billed before it failed, as its diagnostics would carry. */
  | { readonly kind: 'fail'; readonly code: 'RATE_LIMIT' | 'TIMEOUT' | 'AUTH_CONFIGURATION' | 'PROVIDER_UNAVAILABLE' | 'WORKER_EXECUTION_FAILURE'; readonly costUsdMicros?: number }
  | { readonly kind: 'malformed' };

export interface ScriptedAdapter extends JuliusProviderAdapter {
  /** Everything Julius handed the adapter, so a test can assert what a dispatch carried. */
  readonly dispatches: { taskId: string; contextId: string; taskType?: string; allocation?: JuliusDispatchAllocation }[];
}

/**
 * An adapter that answers from a script. When the script runs out it keeps
 * answering with its LAST entry rather than throwing — a test that ticks one
 * extra time should not fail for a reason it did not mean to assert.
 */
export function scriptedAdapter(
  target: JuliusWorker,
  script: readonly ScriptedOutcome[],
): ScriptedAdapter {
  const dispatches: ScriptedAdapter['dispatches'] = [];
  let index = 0;
  return {
    adapterId: target.adapterId,
    dispatches,
    async dispatch(input) {
      dispatches.push({
        taskId: input.taskId, contextId: input.contextId,
        ...(input.taskType === undefined ? {} : { taskType: input.taskType }),
        ...(input.allocation === undefined ? {} : { allocation: input.allocation }),
      });
      const step = script[Math.min(index, script.length - 1)] ?? { kind: 'succeed' as const };
      index += 1;
      if (step.kind === 'fail') {
        throw new JuliusDispatchError(
          step.code, step.code === 'RATE_LIMIT' || step.code === 'TIMEOUT', 'Scripted provider failure.', undefined,
          step.costUsdMicros === undefined ? undefined : { costUsdMicros: step.costUsdMicros },
        );
      }
      if (step.kind === 'malformed') {
        return { workerId: 'someone-else', providerId: target.providerId, status: 'SUCCEEDED', safeSummary: 'x', evidence: [], usage: {} };
      }
      const result: JuliusProviderResult = {
        workerId: target.workerId, providerId: target.providerId, status: 'SUCCEEDED',
        safeSummary: `${target.role} completed ${input.taskId}.`,
        evidence: step.evidence ?? [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite passed.' }],
        usage: {
          // `null` omits the field entirely, which is how a worker reports a
          // cost it does not know — never as a zero.
          ...(step.usdMicros === null ? {} : { usdMicros: step.usdMicros ?? 1_000 }),
          inputTokens: 10, outputTokens: 10, toolCalls: 1, runtimeMs: 5,
        },
      };
      return result;
    },
  };
}

/* ------------------------------------------------------------- policies */

export function cardPolicy(over: Partial<JuliusCardPolicy> = {}): JuliusCardPolicy {
  return {
    revision: 'card-r1', autonomy: 'AUTONOMOUS',
    allowedProviders: [], capabilities: ['implement', 'review'],
    network: true, filesystemMutation: true, fallback: true, automaticRetry: true,
    subagents: { allowed: true, maxDepth: 2, maxActive: 2, maxTotal: 4 },
    iterativeReview: { allowed: true, maxRounds: 3 }, concurrency: 2, approvals: [],
    ...over,
  };
}

export function verificationPolicy(over: Partial<JuliusVerificationPolicy> = {}): JuliusVerificationPolicy {
  return { revision: 'verify-r1', reviewerRequired: false, maxRepairRounds: 2, ...over };
}

/* ------------------------------------------------------------- assembly */

export interface JuliusHarness {
  readonly store: JuliusMemoryStore;
  readonly clock: SteppingClock;
  readonly ids: JuliusIdFactory;
  readonly budget: MemoryBudget;
  readonly workers: JuliusWorkerRegistry;
  readonly adapters: Map<string, ScriptedAdapter>;
  readonly health: JuliusProviderHealthRegistry;
  readonly router: JuliusProviderRouter;
  readonly deps: JuliusPipelineDependencies;
  readonly loop: JuliusRunLoop;
  readonly policies: JuliusPolicySource;
}

export function createJuliusHarness(input: {
  readonly workers: readonly { worker: JuliusWorker; script: readonly ScriptedOutcome[] }[];
  readonly card?: JuliusCardPolicy;
  readonly verification?: JuliusVerificationPolicy;
  readonly budgetUsdMicros?: number;
  /** An allocation policy for the pipeline; absent, dispatches reserve the fixed estimate. */
  readonly allocation?: JuliusAllocationPolicy;
  readonly config?: Partial<JuliusRunLoopConfig>;
  readonly owner?: string;
  readonly capabilityFor?: (task: { taskId: string; taskType: string; role: string }) => string;
}): JuliusHarness {
  const store = createJuliusMemoryStore();
  const clock = createSteppingClock();
  const ids = createCountingIds();
  const budget = createMemoryBudget(input.budgetUsdMicros ?? 1_000_000);
  const registry = new JuliusWorkerRegistry();
  const adapters = new Map<string, ScriptedAdapter>();
  for (const entry of input.workers) {
    registry.register(entry.worker);
    adapters.set(entry.worker.adapterId, scriptedAdapter(entry.worker, entry.script));
  }
  const health = new JuliusProviderHealthRegistry();
  const router = new JuliusProviderRouter(registry, adapters, health);

  const card = input.card ?? cardPolicy({
    allowedProviders: input.workers.map((entry) => entry.worker.providerId),
  });
  const verification = input.verification ?? verificationPolicy();

  const deps: JuliusPipelineDependencies = {
    store, router, budget, clock, ids,
    resources: fixedResourceEstimate({ usdMicros: 2_000, inputTokens: 100, outputTokens: 100, toolCalls: 1, runtimeMs: 1_000 }),
    ...(input.allocation === undefined ? {} : { allocation: input.allocation }),
    owner: input.owner ?? 'worker-a',
    contextCharacterBudget: 4_000,
  };

  const policies: JuliusPolicySource = {
    async policyFor() { return { card, verification }; },
    capabilityFor: input.capabilityFor ?? ((task) => (task.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement')),
  };

  const loop = new JuliusRunLoop(deps, policies, {
    claimLimit: input.config?.claimLimit ?? 10,
    leaseMs: input.config?.leaseMs ?? 60_000,
  });

  return { store, clock, ids, budget, workers: registry, adapters, health, router, deps, loop, policies };
}

/** Seed a run in a state the scheduler will claim from, plus its tasks. */
export function seedRun(
  harness: JuliusHarness,
  input: {
    readonly runId?: string; readonly projectId?: string; readonly missionId?: string;
    readonly state?: Parameters<JuliusMemoryStore['seedRun']>[0]['state'];
    readonly tasks: readonly Parameters<JuliusMemoryStore['seedTask']>[1][];
  },
): { runId: string; projectId: string; missionId: string } {
  const runId = input.runId ?? 'run-1';
  const projectId = input.projectId ?? 'prj-1';
  const missionId = input.missionId ?? 'msn-1';
  harness.store.seedRun({
    runId, missionId, projectId, state: input.state ?? 'READY',
    cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  for (const task of input.tasks) harness.store.seedTask(runId, task);
  return { runId, projectId, missionId };
}

/** A task, with the fields a test rarely cares about filled in. */
export function task(
  over: Partial<Parameters<JuliusMemoryStore['seedTask']>[1]> & { taskId: string },
): Parameters<JuliusMemoryStore['seedTask']>[1] {
  return {
    missionId: 'msn-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
    taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'RUNNABLE', ...over,
  };
}
