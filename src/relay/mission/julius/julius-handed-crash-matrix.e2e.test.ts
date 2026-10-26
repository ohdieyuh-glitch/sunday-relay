import { describe, expect, it } from 'vitest';

import type { JuliusProviderAdapter } from './julius-router';
import { JuliusRunLoop } from './julius-run-loop';
import {
  createFakeTime, createJuliusHarness, seedRun, task, worker,
  type FakeTime, type JuliusHarness, type ScriptedOutcome,
} from './julius-runtime-fixtures';

/**
 * NO DUPLICATE PROVIDER EXECUTION ACROSS A CRASH, AT EVERY BOUNDARY OF ONE ATTEMPT.
 *
 * Beta readiness row 8 named the gap: a provider dispatch HANDED before a crash was
 * re-dispatched by recovery, so a paid answer could be bought twice. Follow-up (a)
 * (#310) closed it in `planJuliusRecovery`: a durable `worker.dispatched` for the
 * attempt the task is on makes the lost attempt HANDED_OUTCOME_UNKNOWN, and it is
 * failed with that named cause instead of requeued. The executor takes the same
 * stance for tool effects (STARTED_UNKNOWN_OUTCOME, never replayed blind).
 *
 * `julius-handed-recovery.e2e.test.ts` proves the two central points (a crash
 * inside the provider call, and a handoff write that never landed). This file
 * walks the WHOLE attempt, one crash per boundary, in the drills' shape:
 *   - process A claims the task and dies at the boundary (the call there never
 *     returns, so nothing after it runs);
 *   - its lease lapses;
 *   - process B, a different owner over the same durable rows, sweeps and ticks.
 * THE PROOF IS THE PROVIDER'S OWN DISPATCH COUNTER, shared by both processes, as a
 * real provider's bill would be.
 *   - Crashed BEFORE the handoff: nothing was sent, so the task IS requeued
 *     (the control) and the survivor's dispatch is the only one.
 *   - Crashed AT OR AFTER the handoff: the attempt may have been paid for, so it
 *     is never sent again. It ends FAILED as HANDED_OUTCOME_UNKNOWN, the run
 *     ends FAILED on it, and the hold stays RESERVED: unknown, never $0.
 *
 * One boundary is deliberately conservative, and the test says so rather than
 * hiding it: a handoff row that COMMITTED but whose acknowledgement never came
 * back reads as handed although no provider was called. The mission fails
 * spuriously, with zero dispatches; it is never a double spend.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], timeoutMs: 30_000 });
const scope = { projectId: 'prj-1' };
const LEASE_MS = 1_000;
const ANSWER: ScriptedOutcome = { kind: 'succeed', usdMicros: null, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Green.' }] };
const RETRYABLE: ScriptedOutcome = { kind: 'fail', code: 'RATE_LIMIT', runtimeStarted: false };

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

type Boundary =
  | 'worker.selected' | 'reserve' | 'budget.reserved' | 'handoff-before-write'
  | 'handoff-unacknowledged' | 'provider' | 'evidence' | 'accept';

interface Rig {
  readonly harness: JuliusHarness;
  readonly time: FakeTime;
  /** Every call the provider received, from either process. */
  readonly dispatches: () => number;
  /** Resolves when process A reaches the boundary it dies at. */
  readonly crashed: Promise<void>;
}

/**
 * The run, the provider and ONE crash: the first call through `boundary` made on
 * attempt `onAttempt` never returns. Every other call, process B's included, goes
 * through unchanged.
 */
function rig(boundary: Boundary, options: { readonly script?: readonly ScriptedOutcome[]; readonly onAttempt?: number } = {}): Rig {
  const harness = createJuliusHarness({ workers: [{ worker: CODER, script: options.script ?? [ANSWER] }] });
  seedRun(harness, { tasks: [task({ taskId: 'task-1', requiredEvidenceTypes: ['TEST'] })] });
  const time = createFakeTime('2026-10-25T12:00:00.000Z');
  const onAttempt = options.onAttempt ?? 1;
  const attemptNow = (): number => harness.store.taskRow('task-1')?.attempt ?? 0;

  let fired = false;
  let markCrashed = (): void => undefined;
  const crashed = new Promise<void>((resolve) => { markCrashed = resolve; });
  /** True exactly once: at the first matching call on the attempt this rig crashes on. */
  const crashHere = (matches: boolean): boolean => {
    if (fired || !matches || attemptNow() !== onAttempt) return false;
    fired = true;
    markCrashed();
    return true;
  };

  const store = harness.store as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
  const wrap = (name: string, decide: (arg: Record<string, unknown>) => boolean, after = false): void => {
    const original = store[name]!.bind(harness.store);
    store[name] = (async (arg: Record<string, unknown>) => {
      if (!after && crashHere(decide(arg))) return never();
      const value = await (original as (input: unknown) => Promise<unknown>)(arg);
      if (after && crashHere(decide(arg))) return never();
      return value;
    }) as never;
  };
  const isTask = (arg: Record<string, unknown>): boolean => (arg.taskId ?? (arg.event as Record<string, unknown> | undefined)?.taskId) === 'task-1';
  const eventType = (arg: Record<string, unknown>): unknown => arg.type ?? (arg.event as Record<string, unknown> | undefined)?.type;

  if (boundary === 'worker.selected' || boundary === 'budget.reserved') wrap('appendEvent', (arg) => isTask(arg) && eventType(arg) === boundary);
  if (boundary === 'handoff-before-write') wrap('appendHandoffEvent', (arg) => isTask(arg) && eventType(arg) === 'worker.dispatched');
  if (boundary === 'handoff-unacknowledged') wrap('appendHandoffEvent', (arg) => isTask(arg) && eventType(arg) === 'worker.dispatched', true);
  if (boundary === 'evidence') wrap('appendEvidence', () => true);
  if (boundary === 'accept') wrap('acceptWorkerResult', isTask);
  if (boundary === 'reserve') {
    const reserve = harness.budget.reserve.bind(harness.budget);
    (harness.budget as { reserve: typeof reserve }).reserve = async (input) => (crashHere(input.taskId === 'task-1') ? never() : reserve(input));
  }

  const inner = harness.adapters.get(CODER.adapterId)!;
  let dispatches = 0;
  const provider: JuliusProviderAdapter = {
    adapterId: CODER.adapterId,
    async dispatch(input) {
      dispatches += 1;
      if (boundary === 'provider' && crashHere(true)) return never();
      return inner.dispatch(input);
    },
  };
  (harness.adapters as Map<string, JuliusProviderAdapter>).set(CODER.adapterId, provider);
  return { harness, time, dispatches: () => dispatches, crashed };
}

/** A process: its own owner, the shared durable rows, a clock the test drives, no lease renewal. */
const processAs = (r: Rig, owner: string) =>
  new JuliusRunLoop({ ...r.harness.deps, clock: r.time.clock, owner }, r.harness.policies, { claimLimit: 4, leaseMs: LEASE_MS });

const recoveries = (harness: JuliusHarness): string[] => harness.store.events()
  .filter((event) => event.type === 'recovery.action' && event.taskId === 'task-1')
  .map((event) => `${String(event.facts.action)}:${String(event.facts.reasonCode)}`);

/** A dies at its boundary; its lease lapses; B sweeps and drives the run until it settles. */
async function crashAndRecover(r: Rig): Promise<{ runState: string | undefined }> {
  const a = processAs(r, 'process-a');
  // Process A's earlier attempts, if the rig crashes on a later one, run to their end.
  for (let tick = 0; tick < 6; tick += 1) {
    const reachedCrash = await Promise.race([r.crashed.then(() => true), a.tick(scope).then(() => false)]);
    if (reachedCrash) break;
    await r.time.advance(LEASE_MS);
  }
  await r.crashed;
  await r.time.advance(LEASE_MS * 3);
  const b = processAs(r, 'process-b');
  for (let tick = 0; tick < 5; tick += 1) {
    await b.tick(scope);
    await r.time.advance(LEASE_MS);
  }
  await b.advanceRun('run-1', scope.projectId);
  return { runState: (await r.harness.store.loadRun('run-1', scope.projectId))?.state };
}

describe('a crash BEFORE the handoff: nothing was sent, so the task IS requeued (the control)', () => {
  for (const boundary of ['worker.selected', 'reserve', 'budget.reserved', 'handoff-before-write'] as const) {
    it(`died at ${boundary}: REQUEUE/LEASE_EXPIRED, the survivor completes it, one dispatch in all`, async () => {
      const r = rig(boundary);
      const { runState } = await crashAndRecover(r);

      expect(r.harness.store.events().some((event) => event.type === 'worker.dispatched' && event.facts.attempt === 1),
        'process A never recorded a handoff').toBe(false);
      expect(recoveries(r.harness)).toEqual(['REQUEUE:LEASE_EXPIRED']);
      expect(r.harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
      expect(r.dispatches(), 'the survivor\'s dispatch is the only provider call').toBe(1);
      expect(runState).toBe('COMPLETED');
    }, 30_000);
  }
});

describe('a crash AT OR AFTER the handoff: never sent a second time', () => {
  for (const boundary of ['provider', 'evidence', 'accept'] as const) {
    it(`died at ${boundary}: FAIL_TASK/HANDED_OUTCOME_UNKNOWN, exactly one dispatch, the hold kept`, async () => {
      const r = rig(boundary);
      const { runState } = await crashAndRecover(r);

      expect(recoveries(r.harness)).toEqual(['FAIL_TASK:HANDED_OUTCOME_UNKNOWN']);
      expect(r.harness.store.taskRow('task-1')!.state).toBe('FAILED');
      expect(r.dispatches(), 'the answer that may have been paid for is never bought again').toBe(1);
      expect(r.harness.store.results().some((row) => row.taskId === 'task-1' && row.status === 'SUCCEEDED'),
        'and no result is invented for it').toBe(false);
      expect(runState, 'the run ends on the named cause').toBe('FAILED');
      expect(r.harness.budget.reservations().some((row) => row.state === 'RESERVED'),
        'its hold stays charged: unknown, never $0').toBe(true);
    }, 30_000);
  }

  it('died after the handoff COMMITTED but before it was acknowledged: conservative, a spurious failure with ZERO dispatches, never a double spend', async () => {
    const r = rig('handoff-unacknowledged');
    const { runState } = await crashAndRecover(r);

    expect(recoveries(r.harness)).toEqual(['FAIL_TASK:HANDED_OUTCOME_UNKNOWN']);
    expect(r.dispatches(), 'the durable record says handed; nothing reached the provider, and nothing is sent now').toBe(0);
    expect(runState).toBe('FAILED');
  }, 30_000);
});

describe('the attempt counts: a later attempt is judged by ITS OWN handoff', () => {
  it('attempt 1 failed retryably, attempt 2 was handed and the process died: two dispatches, never three', async () => {
    const r = rig('provider', { script: [RETRYABLE, ANSWER], onAttempt: 2 });
    const { runState } = await crashAndRecover(r);

    expect(recoveries(r.harness)).toEqual(['FAIL_TASK:HANDED_OUTCOME_UNKNOWN']);
    expect(r.dispatches()).toBe(2);
    expect(runState).toBe('FAILED');
  }, 30_000);

  it('CONTROL: attempt 1 was handed and answered, attempt 2 died BEFORE its handoff: attempt 1\'s record does not stop the requeue', async () => {
    const r = rig('handoff-before-write', { script: [RETRYABLE, ANSWER], onAttempt: 2 });
    const { runState } = await crashAndRecover(r);

    expect(r.harness.store.events().some((event) => event.type === 'worker.dispatched' && event.facts.attempt === 1),
      'attempt 1 WAS handed').toBe(true);
    expect(recoveries(r.harness)).toEqual(['REQUEUE:LEASE_EXPIRED']);
    expect(r.harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(r.dispatches(), 'attempt 1 and the survivor\'s attempt 3; the crashed attempt 2 sent nothing').toBe(2);
    expect(runState).toBe('COMPLETED');
  }, 30_000);
});
