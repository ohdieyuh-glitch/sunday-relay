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

import type { JuliusLeaseTimers } from './julius-lease-keeper';
import {
  JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusDispatchError,
  type JuliusDispatchAllocation, type JuliusDispatchWorkspace, type JuliusProviderAdapter, type JuliusProviderResult,
} from './julius-router';
import { JuliusWorkerRegistry, type JuliusTask, type JuliusWorker, type JuliusWorkerRole } from './julius-runtime';
import { lockJuliusTaskContract, seedJuliusTaskContract, type JuliusTaskContract, type JuliusContractReviewCharge } from './julius-task-contract';
import type { JuliusCardPolicy } from './julius-policy';
import type { JuliusVerificationPolicy } from './julius-verification-runtime';
import { createJuliusMemoryStore, type JuliusMemoryStore } from './julius-memory-store';
import { fixedResourceEstimate, juliusContractSubjectTaskId, type JuliusPipelineDependencies } from './julius-task-pipeline';
import { JuliusRunLoop, type JuliusPolicySource, type JuliusRunLoopConfig } from './julius-run-loop';
import type { JuliusBudgetPort, JuliusClock, JuliusIdFactory } from './julius-runtime-ports';
import type { JuliusAllocationPolicy } from './julius-allocation-runtime';
import type { JuliusSlotEnvelopePolicy } from './julius-slot-envelope';
import type { JuliusResearchPort } from './julius-research-protocol';

/* ---------------------------------------------------------------- clock */

export interface SteppingClock extends JuliusClock { advance(ms: number): void; }

export function createSteppingClock(startIso = '2026-08-27T00:00:00.000Z', stepMs = 1_000): SteppingClock {
  let current = Date.parse(startIso);
  return {
    now() { const value = new Date(current).toISOString(); current += stepMs; return value; },
    advance(ms) { current += ms; },
  };
}

/**
 * TIME A TEST MOVES, WITH TIMERS THAT FIRE ONLY WHEN IT DOES.
 *
 * `createSteppingClock` advances on every read, which is right for ordering and
 * wrong for a lease: a renewal cadence can only be proven against a clock that
 * stands still until the proof moves it, and timers that fall due in order.
 */
export interface FakeTime {
  readonly clock: { now(): string };
  readonly timers: JuliusLeaseTimers;
  nowMs(): number;
  /** Move time forward, firing every timer that falls due on the way, in order. */
  advance(ms: number): Promise<void>;
}

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

export function createFakeTime(startIso = '2026-09-17T12:00:00.000Z'): FakeTime {
  let current = Date.parse(startIso);
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    clock: { now: () => new Date(current).toISOString() },
    timers: {
      setTimeout(callback, ms) { sequence += 1; pending.set(sequence, { at: current + ms, callback }); return sequence; },
      clearTimeout(handle) { pending.delete(handle as number); },
    },
    nowMs: () => current,
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        let next: [number, { at: number; callback: () => void }] | null = null;
        for (const entry of pending) if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) next = entry;
        if (next === null) break;
        pending.delete(next[0]);
        current = next[1].at;
        next[1].callback();
        await flushMicrotasks();
      }
      current = target;
      await flushMicrotasks();
    },
  };
}

/**
 * COUNTING IDS, AND WHY A RESTART NEEDS ITS OWN RUN OF THEM.
 *
 * A live process mints ids from a UUID, so a restarted one never re-mints an id
 * another process already used. This factory counts, so a second harness over
 * the same durable rows would hand the SAME id to a DIFFERENT event — which the
 * event store now refuses as a conflict, correctly, and which used to be
 * silently dropped. `epoch` gives a restarted harness its own run of the
 * counter, which is what a real restart has; the first harness passes none and
 * its ids are unchanged, so every proof that names one still names it.
 */
export function createCountingIds(epoch: string | null = null): JuliusIdFactory {
  const counters = new Map<string, number>();
  return {
    next(kind) {
      const value = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, value);
      return epoch === null ? `${kind}#${value}` : `${kind}#${epoch}:${value}`;
    },
  };
}

/** How many harnesses have resumed an existing store in this file. */
let restartEpoch = 0;

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
      // SPENT MONEY IS CHARGED, NOT RELEASED, AND CHARGED AT WHAT IT COST.
      //
      // A failed attempt that billed before it failed settles at what it
      // billed — not at what it was allowed to bill. Clamping to the hold
      // would hide real overspend from the ledger and let the mission be
      // granted money it has already spent; recording the excess drives
      // `available()` down, and past zero it denies the next dispatch, which
      // is the honest direction for a ceiling that has been exceeded. Only an
      // attempt that spent nothing hands its whole hold back.
      const spent = typeof input.usdMicros === 'number' && Number.isFinite(input.usdMicros) && input.usdMicros > 0
        ? input.usdMicros : 0;
      // AND UNKNOWN SPEND KEEPS ITS HOLD. A hosted runtime reports cost only
      // in the final message a timeout never delivers, so the attempt most
      // likely to have billed is the one least likely to say so.
      if (spent === 0 && input.spendUnknown === true) {
        held.set(input.reservationId, { usdMicros: row.usdMicros, state: 'COMMITTED' });
        return;
      }
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
  | {
    readonly kind: 'succeed';
    /** What the worker says about its own attempt. Defaults to SUCCEEDED; a worker may report FAILED. */
    readonly status?: 'SUCCEEDED' | 'FAILED';
    readonly evidence?: readonly Record<string, unknown>[];
    readonly usdMicros?: number | null;
    /** What this worker PROPOSES for its task contract. Unsanitised on purpose — a test may send a hostile shape. */
    readonly contractProposal?: unknown;
    /** A coder asking the architect something mid-mission. Unsanitised, for the same reason. */
    readonly guidanceRequest?: unknown;
    /** An architect answering, after the contract locked. Unsanitised, for the same reason. */
    readonly guidance?: unknown;
    /** What a coder's next segment resumes from. Unsanitised, for the same reason. */
    readonly segmentResume?: unknown;
    /** What this worker needs Julius to go and look at. Unsanitised, for the same reason. */
    readonly researchAsks?: unknown;
    /** A reviewer's canonical verdict. Unsanitised, for the same reason. */
    readonly reviewVerdict?: unknown;
    /** An architect's rebuttal to a disagreement. Unsanitised, for the same reason. */
    readonly rebuttal?: unknown;
    /** An architect's structured architecture state. Unsanitised, for the same reason. */
    readonly architecture?: unknown;
    /** An architect's final consistency assessment. Unsanitised, for the same reason. */
    readonly consistency?: unknown;
    /** A Coding Agent's workspace change set and report. Unsanitised, for the same reason. */
    readonly implementation?: unknown;
    /** A Coding Agent's observations about the design. Unsanitised, for the same reason. */
    readonly architectureObservations?: unknown;
    /**
     * A reviewer that ANSWERS the findings it is shown, the way a real one reads
     * them: by the ids in its own compiled packet. Adds a resolution for each to
     * the declared verdict (a CONTINUE if the step declared none). A step
     * without it answers nothing — which is the silence Julius refuses.
     */
    readonly answerFindings?: 'RESOLVED' | 'OPEN';
  }
  /** `costUsdMicros` is what the boundary billed before it failed, as its diagnostics would carry. */
  | {
    readonly kind: 'fail';
    readonly code: 'RATE_LIMIT' | 'TIMEOUT' | 'AUTH_CONFIGURATION' | 'PROVIDER_UNAVAILABLE' | 'WORKER_EXECUTION_FAILURE';
    readonly costUsdMicros?: number;
    /** Whether the provider runtime launched — the difference between spending nothing and spending an unknown amount. */
    readonly runtimeStarted?: boolean;
    /** The error text the boundary raised — a test may make it hostile, to prove none of it is recorded. */
    readonly message?: string;
    /**
     * WHAT THE FAILED ATTEMPT CHANGED IN THE WORKSPACE, as the live adapter
     * carries it on the error. Unsanitised, for the same reason as the rest: a
     * test may send a shape Julius must refuse.
     */
    readonly implementation?: unknown;
  }
  | { readonly kind: 'malformed' }
  /**
   * A WORKER WHOSE ANSWER DEPENDS ON THE CONTEXT IT WAS GIVEN.
   *
   * Every other step is a constant, which is right for the cases that are about
   * Julius's own machinery and useless for the one case that is about the
   * CONTEXT: a matched-pair learning experiment has to show a worker doing worse
   * because a fact was missing from its packet, not because a script said so.
   *
   * `decide` receives the compiled packet text this dispatch was handed — the
   * real one, out of the durable snapshot, through the same `packetFor` seam
   * `answerFindings` reads. It returns an ordinary step, and may not return
   * another `readsPacket`: one level, so a fixture cannot become a program.
   */
  | {
    readonly kind: 'readsPacket';
    readonly decide: (packet: string | null) => Exclude<ScriptedOutcome, { readonly kind: 'readsPacket' }>;
  };

export interface ScriptedAdapter extends JuliusProviderAdapter {
  /** Everything Julius handed the adapter, so a test can assert what a dispatch carried. */
  readonly dispatches: { taskId: string; contextId: string; taskType?: string; allocation?: JuliusDispatchAllocation; contract?: JuliusContractReviewCharge; workspace?: JuliusDispatchWorkspace; attempt?: { leaseGeneration: number } }[];
}

/**
 * An adapter that answers from a script. When the script runs out it keeps
 * answering with its LAST entry rather than throwing — a test that ticks one
 * extra time should not fail for a reason it did not mean to assert.
 */
export function scriptedAdapter(
  target: JuliusWorker,
  script: readonly ScriptedOutcome[],
  options: {
    /** The compiled packet text a dispatch was handed, for steps that read it (`answerFindings`). */
    readonly packetFor?: (dispatch: { readonly taskId: string; readonly contextId: string }) => string | null;
  } = {},
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
        ...(input.contract === undefined ? {} : { contract: input.contract }),
        ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
        ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      });
      const scripted = script[Math.min(index, script.length - 1)] ?? { kind: 'succeed' as const };
      index += 1;
      // RESOLVED BEFORE ANYTHING ELSE READS IT, so every branch below sees an
      // ordinary step and none of them has to know this kind exists.
      const step = scripted.kind === 'readsPacket'
        ? scripted.decide(options.packetFor?.(input) ?? null)
        : scripted;
      if (step.kind === 'fail') {
        throw new JuliusDispatchError(
          step.code, step.code === 'RATE_LIMIT' || step.code === 'TIMEOUT', step.message ?? 'Scripted provider failure.', undefined,
          step.costUsdMicros === undefined && step.runtimeStarted === undefined
            ? undefined
            : {
              ...(step.costUsdMicros === undefined ? {} : { costUsdMicros: step.costUsdMicros }),
              ...(step.runtimeStarted === undefined ? {} : { runtimeStarted: step.runtimeStarted }),
            },
          step.implementation,
        );
      }
      if (step.kind === 'malformed') {
        return { workerId: 'someone-else', providerId: target.providerId, status: 'SUCCEEDED', safeSummary: 'x', evidence: [], usage: {} };
      }
      const answered = step.answerFindings === undefined ? [] : findingIdsIn(options.packetFor?.(input) ?? '');
      const reviewVerdict = answered.length === 0
        ? step.reviewVerdict
        : {
          verdict: 'CONTINUE', claim: 'The findings I raised are answered.',
          ...(step.reviewVerdict !== null && typeof step.reviewVerdict === 'object' ? step.reviewVerdict as Record<string, unknown> : {}),
          resolutions: answered.map((findingId) => ({
            findingId, status: step.answerFindings,
            claim: step.answerFindings === 'RESOLVED' ? 'The evidence shows the problem is gone.' : 'The problem is still there.',
          })),
        };
      const result: JuliusProviderResult = {
        workerId: target.workerId, providerId: target.providerId, status: step.status ?? 'SUCCEEDED',
        safeSummary: `${target.role} completed ${input.taskId}.`,
        evidence: step.evidence ?? [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite passed.' }],
        usage: {
          // `null` omits the field entirely, which is how a worker reports a
          // cost it does not know — never as a zero.
          ...(step.usdMicros === null ? {} : { usdMicros: step.usdMicros ?? 1_000 }),
          inputTokens: 10, outputTokens: 10, toolCalls: 1, runtimeMs: 5,
        },
        ...(step.contractProposal === undefined ? {} : { contractProposal: step.contractProposal }),
        ...(step.guidanceRequest === undefined ? {} : { guidanceRequest: step.guidanceRequest }),
        ...(step.guidance === undefined ? {} : { guidance: step.guidance }),
        ...(step.segmentResume === undefined ? {} : { segmentResume: step.segmentResume }),
        ...(step.researchAsks === undefined ? {} : { researchAsks: step.researchAsks }),
        ...(reviewVerdict === undefined ? {} : { reviewVerdict }),
        ...(step.rebuttal === undefined ? {} : { rebuttal: step.rebuttal }),
        ...(step.architecture === undefined ? {} : { architecture: step.architecture }),
        ...(step.consistency === undefined ? {} : { consistency: step.consistency }),
        ...(step.implementation === undefined ? {} : { implementation: step.implementation }),
        ...(step.architectureObservations === undefined ? {} : { architectureObservations: step.architectureObservations }),
      };
      return result;
    },
  };
}

/** The finding ids a compiled packet shows a reviewer, as a reviewer reads them. */
function findingIdsIn(packet: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of packet.matchAll(/REVIEW FINDING (\S+) \[/gu)) ids.add(match[1]!);
  for (const match of packet.matchAll(/^ {2}(\S+) \[(?:OPEN|ADDRESSED)[,\]]/gmu)) ids.add(match[1]!);
  return [...ids];
}

/** The text of the packet compiled for one dispatch, from a store that keeps snapshots. */
export function juliusPacketTextIn(
  store: { contexts(): readonly { readonly contextId: string; readonly taskId: string; readonly packet: { readonly blocks: readonly { readonly text: string }[] } }[] },
): (dispatch: { readonly taskId: string; readonly contextId: string }) => string | null {
  return (dispatch) => {
    // The newest snapshot for this dispatch: a harness restarted over the same
    // store counts its ids from one again, so an id alone can name an older one.
    const snapshot = store.contexts().filter((item) => item.contextId === dispatch.contextId && item.taskId === dispatch.taskId).at(-1);
    return snapshot === undefined ? null : snapshot.packet.blocks.map((block) => block.text).join('\n');
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
  /**
   * An allocation policy for the pipeline; absent, dispatches reserve the fixed
   * estimate. Either rule: `julius-allocation.v1`, which funds the coder from
   * the ceiling and hands the peers an estimate, or `julius-allocation.v2`,
   * which gives all three slots an envelope out of the same ceiling.
   */
  readonly allocation?: JuliusAllocationPolicy | JuliusSlotEnvelopePolicy;
  /** How Julius goes and looks; absent, a research ask is recorded as unserved. */
  readonly research?: JuliusResearchPort;
  readonly config?: Partial<JuliusRunLoopConfig>;
  readonly owner?: string;
  readonly capabilityFor?: (task: { taskId: string; taskType: string; role: string }) => string;
  /** The execution attempt peer requests are named under; absent, the local scope. */
  readonly executionScope?: string;
  /** An existing store to run over — a restart of the same durable rows with fresh workers. */
  readonly store?: JuliusMemoryStore;
  /**
   * The packet budget, for a case whose subject IS the budget. 4 000 characters
   * is roomy enough that nothing a normal fixture seeds is ever evicted, which
   * is right for every other test and useless for proving what survives
   * eviction.
   */
  readonly contextCharacterBudget?: number | ((role: JuliusWorkerRole) => number);
}): JuliusHarness {
  const store = input.store ?? createJuliusMemoryStore();
  const clock = createSteppingClock();
  // A harness handed an existing store is a RESTART over durable rows; a live
  // restart mints fresh ids, and so does this one.
  const ids = createCountingIds(input.store === undefined ? null : `r${String(++restartEpoch + 1)}`);
  const budget = createMemoryBudget(input.budgetUsdMicros ?? 1_000_000);
  const registry = new JuliusWorkerRegistry();
  const adapters = new Map<string, ScriptedAdapter>();
  for (const entry of input.workers) {
    registry.register(entry.worker);
    adapters.set(entry.worker.adapterId, scriptedAdapter(entry.worker, entry.script, { packetFor: juliusPacketTextIn(store) }));
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
    ...(input.research === undefined ? {} : { research: input.research }),
    // THE MEMORY STORE IS ALSO THE TIMELINE READER, so the harness exercises
    // the real projected slot ledger rather than the rounds fallback.
    timeline: store,
    ...(input.executionScope === undefined ? {} : { executionScope: input.executionScope }),
    owner: input.owner ?? 'worker-a',
    contextCharacterBudget: input.contextCharacterBudget ?? 4_000,
  };

  const policies: JuliusPolicySource = {
    async policyFor() { return { card, verification }; },
    capabilityFor: input.capabilityFor ?? ((task) => (task.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement')),
  };

  const loop = new JuliusRunLoop(deps, policies, {
    claimLimit: input.config?.claimLimit ?? 10,
    leaseMs: input.config?.leaseMs ?? 60_000,
    ...(input.config?.leaseRenewal === undefined ? {} : { leaseRenewal: input.config.leaseRenewal }),
  });

  return { store, clock, ids, budget, workers: registry, adapters, health, router, deps, loop, policies };
}

/**
 * THE TASK CONTRACT A SEEDED RUN CARRIES.
 *
 * A deployment now seeds a contract at bootstrap and locks it when the plan
 * review is accepted, and no Coding Agent may be dispatched without one. A
 * fixture that skipped it would not be a smaller deployment, it would be a
 * BROKEN one, and every test composing it would prove something about a run
 * production cannot produce.
 *
 *   'locked'  the ordinary state, and the default: the terms are agreed, which
 *             is what a test about scheduling, budgets or recovery assumes.
 *   'draft'   seeded but not agreed — for tests that drive the real accept and
 *             want the lock to happen where production performs it.
 *   'none'    no contract at all, for the gate's own refusal cases.
 */
export type SeededContractState = 'locked' | 'draft' | 'none';

/** A minimal valid contract for a seeded task, with the mission's own shape. */
export function seededTaskContract(input: {
  runId: string; taskId: string; state?: SeededContractState;
}): JuliusTaskContract {
  const seeded = seedJuliusTaskContract({
    runId: input.runId, taskId: input.taskId, missionContractRevision: 1,
    objective: 'The seeded mission objective.',
    requirements: ['the seeded requirement'], constraints: ['the seeded constraint'],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the seeded blocking criterion', blocking: true }],
    filesInScope: [], filesOutOfScope: [],
    spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  if (input.state !== 'locked' && input.state !== undefined) return seeded.contract;
  const locked = lockJuliusTaskContract({
    contract: seeded.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'fixture-evaluator' },
    lockedAt: '2026-08-27T00:00:00.000Z',
  });
  if (locked.outcome !== 'LOCKED') throw new Error(`fixture contract not lockable: ${JSON.stringify(locked)}`);
  return locked.contract;
}

/**
 * Seed one task's contract directly, for the tests that build their task graph
 * with `store.seedTask` rather than through {@link seedRun}. `'draft'` is the
 * useful default there: those tests drive the real plan → review → accept
 * sequence, and the lock then happens exactly where production performs it.
 */
export function seedTaskContractInto(
  store: JuliusMemoryStore,
  input: { runId: string; projectId: string; taskId: string; state?: SeededContractState },
): void {
  if (input.state === 'none') return;
  void store.putTaskContract({
    projectId: input.projectId,
    contract: seededTaskContract({ runId: input.runId, taskId: input.taskId, state: input.state ?? 'draft' }),
    occurredAt: '2026-08-27T00:00:00.000Z',
  });
}

/** Seed a run in a state the scheduler will claim from, plus its tasks. */
export function seedRun(
  harness: JuliusHarness,
  input: {
    readonly runId?: string; readonly projectId?: string; readonly missionId?: string;
    readonly state?: Parameters<JuliusMemoryStore['seedRun']>[0]['state'];
    readonly tasks: readonly Parameters<JuliusMemoryStore['seedTask']>[1][];
    /** Defaults to `'locked'` — see {@link SeededContractState}. */
    readonly taskContracts?: SeededContractState;
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

  // One contract per SUBJECT, resolved by the runtime's own rule rather than a
  // copy of it: a repair is governed by the contract of the task it repairs, a
  // specialist by the coding work it was spawned under or by itself, and the
  // architect and its review by none.
  const contracts = input.taskContracts ?? 'locked';
  if (contracts !== 'none') {
    const seededTasks = input.tasks.map((value) => ({ ...value, missionId })) as readonly JuliusTask[];
    const roots = new Set(seededTasks
      .map((value) => juliusContractSubjectTaskId(value, seededTasks))
      .filter((value): value is string => value !== null));
    for (const taskId of roots) {
      void harness.store.putTaskContract({
        projectId,
        contract: seededTaskContract({ runId, taskId, state: contracts }),
        occurredAt: '2026-08-27T00:00:00.000Z',
      });
    }
  }
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
