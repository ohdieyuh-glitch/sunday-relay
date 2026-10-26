import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  JuliusExecutionCoordinator, JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusWorkerRegistry,
  type JuliusCardPolicy, type JuliusExecutionPorts, type JuliusProviderAdapter,
} from '.';
import { JuliusDispatchError } from './julius-router';
import { cardPolicy, createJuliusHarness, seedRun, task, worker, type ScriptedOutcome } from './julius-runtime-fixtures';

/**
 * #43 · NO DUPLICATE PROVIDER EXECUTION ON AN OBSERVED FAILURE.
 *
 * #310 closed the crash case: a lost attempt whose `worker.dispatched` row is
 * durable is never requeued (HANDED_OUTCOME_UNKNOWN). The same handoff left a
 * live hole: an OBSERVED retryable failure after it (a timeout above all) was
 * retried, so a second paid answer could be bought. The founder's rule: "only
 * permit retry when there is positive evidence that no provider execution
 * occurred." So after the handoff the default is OUTCOME UNKNOWN, and the one
 * retry left is the provider's own 429 attested unprocessed.
 *
 * THE PROOF IS A DISPATCH COUNTER: every adapter here counts the calls it got.
 */

const ROOT = process.cwd();

const policy: JuliusCardPolicy = {
  revision: 'card', autonomy: 'AUTONOMOUS', allowedProviders: ['provider'], capabilities: ['code'],
  network: false, filesystemMutation: true, fallback: false, automaticRetry: true,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 },
  iterativeReview: { allowed: false, maxRounds: 0 }, concurrency: 1, approvals: [],
};
const claim = {
  runId: 'run', projectId: 'project', taskId: 'task', leaseOwner: 'scheduler', leaseGeneration: 1,
  capability: 'code', contextId: 'context',
  task: {
    taskId: 'task', missionId: 'mission', parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['TEST' as const], taskType: 'implementation',
    role: 'CODING_AGENT' as const, ordinal: 0, state: 'ACTIVE' as const,
  },
};
const request = {
  claim, policy, role: 'CODING_AGENT' as const, taskType: 'implementation', capability: 'code', operationId: 'operation',
  resources: { usdMicros: 10, inputTokens: 10, outputTokens: 10, toolCalls: 1, runtimeMs: 100 },
};

/** A coordinator over one worker whose adapter throws `error` and counts every call it receives. */
function unit(error: unknown, options: { readonly timeoutMs?: number; readonly ports?: Partial<JuliusExecutionPorts> } = {}) {
  let calls = 0;
  const adapter: JuliusProviderAdapter = {
    adapterId: 'adapter',
    async dispatch() {
      calls += 1;
      if (error === 'hang') return new Promise<never>(() => undefined);
      throw error;
    },
  };
  const registry = new JuliusWorkerRegistry();
  registry.register({
    workerId: 'worker', role: 'CODING_AGENT', adapterId: 'adapter', providerId: 'provider', capabilities: ['code'],
    taskTypes: ['implementation'], concurrencyLimit: 1, timeoutMs: options.timeoutMs ?? 5_000, maxRetries: 2, status: 'AVAILABLE',
  });
  const rows: Record<string, unknown>[] = [];
  const released: { usdMicros: number | null | undefined; spendUnknown: boolean | undefined }[] = [];
  const ports: JuliusExecutionPorts = {
    async reserve() { return { reservationId: 'reservation', state: 'RESERVED', denialReason: null }; },
    async commit() {}, async release(input) { released.push({ usdMicros: input.usdMicros, spendUnknown: input.spendUnknown }); },
    async persistEvidence() {}, async acceptResult() { return { duplicate: false }; },
    async recordEvent(input) { rows.push({ type: input.type, ...input.payload }); },
    ...options.ports,
  };
  const coordinator = new JuliusExecutionCoordinator(new JuliusProviderRouter(registry, new Map([['adapter', adapter]]), new JuliusProviderHealthRegistry()), ports);
  return { coordinator, calls: () => calls, rows, released };
}

const raw = (code: string | number) => Object.assign(new Error(`provider ${String(code)}`), { code });
const UNKNOWN_SPEND = [{ usdMicros: null, spendUnknown: true }];

/* ============================== every site, after the handoff ============ */

describe('S1 · the coordinator\'s own deadline cut', () => {
  it('a worker that outlives its declared deadline: one call, OUTCOME UNKNOWN, never retried', async () => {
    const h = unit('hang', { timeoutMs: 30 });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'TIMEOUT', reasonCode: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN', failureClass: 'worker_deadline_exceeded' });
    expect(h.calls()).toBe(1);
    expect(h.rows.map((row) => row.type)).not.toContain('retry.scheduled');
    expect(h.released).toEqual(UNKNOWN_SPEND);
  }, 30_000);
});

describe('S2 · normalizeProviderError, for a raw error out of any adapter', () => {
  it.each([
    ['code TIMEOUT', raw('TIMEOUT')],
    ['ETIMEDOUT', raw('ETIMEDOUT')],
    ['DOMException TimeoutError', new DOMException('timed out', 'TimeoutError')],
  ])('%s: OUTCOME UNKNOWN (HANDED_TIMEOUT_OUTCOME_UNKNOWN), one call', async (_name, error) => {
    const h = unit(error);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'TIMEOUT', reasonCode: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN' });
    expect(h.calls()).toBe(1);
    expect(h.released).toEqual(UNKNOWN_SPEND);
  });

  it('the string alias RATE_LIMIT attests nothing: OUTCOME UNKNOWN (HANDED_FAILURE_OUTCOME_UNKNOWN), one call', async () => {
    const h = unit(raw('RATE_LIMIT'));
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'RATE_LIMIT', reasonCode: 'HANDED_FAILURE_OUTCOME_UNKNOWN' });
    expect(h.calls()).toBe(1);
    expect(h.released).toEqual(UNKNOWN_SPEND);
  });

  it('POSITIVE EVIDENCE: an HTTP 429 is the provider refusing the request unprocessed, so it IS retried', async () => {
    const h = unit(raw(429));
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'RATE_LIMIT', diagnostics: { diag_runtimeStarted: false } });
    expect(h.rows.map((row) => row.type)).toContain('retry.scheduled');
    expect(h.released, 'and its hold is handed back: nothing was processed').toEqual([{ usdMicros: null, spendUnknown: false }]);
  });

  it('a 401 is not retryable at all, and keeps today\'s ending with no OUTCOME UNKNOWN cause', async () => {
    const result = await unit(raw(401)).coordinator.execute(request);
    expect(result).toMatchObject({ status: 'FAILED', code: 'AUTH_CONFIGURATION' });
    expect((result as { reasonCode?: string }).reasonCode).toBeUndefined();
  });
});

describe('S3 · a typed error an adapter raises (Coding Agent taxonomy, reviewer shapes, Prompt Architect classes)', () => {
  it.each([
    ['TIMEOUT that says it started', new JuliusDispatchError('TIMEOUT', true, 'safe', 'coder_timed_out', { runtimeStarted: true }), 'HANDED_TIMEOUT_OUTCOME_UNKNOWN'],
    // A timeout is never proof the provider did not execute, whatever it attests.
    ['TIMEOUT that says it never started', new JuliusDispatchError('TIMEOUT', true, 'safe', 'coder_timed_out', { runtimeStarted: false }), 'HANDED_TIMEOUT_OUTCOME_UNKNOWN'],
    ['reviewer review_timeout', new JuliusDispatchError('TIMEOUT', true, 'safe', 'review_timeout'), 'HANDED_TIMEOUT_OUTCOME_UNKNOWN'],
    // A 5xx, a reset, a stream cut, a dead process: none proves nothing ran.
    ['PROVIDER_UNAVAILABLE (a 5xx / reset)', new JuliusDispatchError('PROVIDER_UNAVAILABLE', true, 'safe', 'review_service_unavailable'), 'HANDED_FAILURE_OUTCOME_UNKNOWN'],
    ['PROVIDER_UNAVAILABLE that says it never started', new JuliusDispatchError('PROVIDER_UNAVAILABLE', true, 'safe', 'coder_process_exit', { runtimeStarted: false }), 'HANDED_FAILURE_OUTCOME_UNKNOWN'],
    ['RATE_LIMIT inside a started session', new JuliusDispatchError('RATE_LIMIT', true, 'safe', 'rate_limited', { runtimeStarted: true }), 'HANDED_FAILURE_OUTCOME_UNKNOWN'],
  ] as const)('%s: one call, OUTCOME UNKNOWN, the hold closed unknown', async (_name, error, cause) => {
    const h = unit(error);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: error.code, reasonCode: cause });
    expect(h.calls()).toBe(1);
    expect(h.rows.find((row) => row.type === 'task.failed')).toMatchObject({ reasonCode: cause, errorRetryable: true });
    expect(h.released).toEqual(UNKNOWN_SPEND);
  });

  it('POSITIVE EVIDENCE: a RATE_LIMIT attested before anything ran is retried', async () => {
    const h = unit(new JuliusDispatchError('RATE_LIMIT', true, 'safe', 'rate_limited', { runtimeStarted: false }));
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'RATE_LIMIT' });
  });

  it('a non-retryable failure after the handoff keeps today\'s ending, with no OUTCOME UNKNOWN cause', async () => {
    const result = await unit(new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'safe', 'coder_refused')).coordinator.execute(request);
    expect(result).toMatchObject({ status: 'FAILED', code: 'WORKER_EXECUTION_FAILURE' });
    expect((result as { reasonCode?: string }).reasonCode).toBeUndefined();
  });
});

/* ================================= the handoff boundary is #310's ======== */

describe('the boundary is the handoff #310 recovery reads: the `worker.dispatched` row', () => {
  it('a TIMEOUT BEFORE the handoff is retried: the handoff write itself timed out, and no provider was called', async () => {
    const h = unit(raw('TIMEOUT'), { ports: { async recordHandoff() { throw new JuliusDispatchError('TIMEOUT', true, 'The handoff write timed out.'); } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'TIMEOUT' });
    expect(h.calls(), 'nothing reached the provider').toBe(0);
    expect(h.released, 'and nothing was spent').toEqual([{ usdMicros: null, spendUnknown: false }]);
  });

  it('and the same TIMEOUT once `worker.dispatched` is written is OUTCOME UNKNOWN', async () => {
    const handoffs: string[] = [];
    const h = unit(raw('TIMEOUT'), { ports: { async recordHandoff(input) { handoffs.push(input.idempotencyKey); return true; } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', reasonCode: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN' });
    expect(handoffs, 'the row recovery reads for this attempt').toEqual(['operation:worker.dispatched']);
    expect(h.calls()).toBe(1);
  });

  it('`handed` is set by the handoff write and nothing else, on the line before the provider is called', () => {
    const source = readFileSync(join(ROOT, 'src/relay/mission/julius/julius-execution-coordinator.ts'), 'utf8');
    const body = /async execute\(request:JuliusExecutionRequest\)[\s\S]*?\n  \}\n/u.exec(source)?.[0] ?? '';
    const handoffAt = body.indexOf('this.handoff(request,worker,reservationId)');
    const handedAt = body.indexOf('handed=true;');
    const dispatchAt = body.indexOf('await dispatchWithinDeadline(');
    expect(handoffAt).toBeGreaterThan(-1);
    expect(handedAt, 'handed only after the handoff is written').toBeGreaterThan(handoffAt);
    expect(dispatchAt, 'and before the provider is called').toBeGreaterThan(handedAt);
    expect(body.split('handed=true').length - 1, 'one place sets it').toBe(1);
    // The handoff writes the row #310's planJuliusRecovery reads.
    expect(source).toContain("idempotencyKey:`${request.operationId}:worker.dispatched`");
    expect(source).toContain("this.event(request,'worker.dispatched'");
  });
});

/* ======================= the pipeline: dispatch counter end to end ======= */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'shared', capabilities: ['implement'], taskTypes: ['build'] });
const SECOND = worker({ workerId: 'coder-2', role: 'CODING_AGENT', providerId: 'shared', capabilities: ['implement'], taskTypes: ['build'] });
const ANSWER: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Green.' }] };

async function mission(script: readonly ScriptedOutcome[], options: { readonly reroute?: boolean } = {}) {
  const workers = [{ worker: CODER, script }, ...(options.reroute === true ? [{ worker: SECOND, script: [ANSWER] }] : [])];
  const harness = createJuliusHarness({ workers, card: cardPolicy({ allowedProviders: ['shared'] }) });
  seedRun(harness, { tasks: [task({ taskId: 'task-1', requiredEvidenceTypes: ['TEST'] })] });
  for (let tick = 0; tick < 8; tick += 1) if ((await harness.loop.tick({ projectId: 'prj-1' })).claimed === 0) break;
  await harness.loop.advanceRun('run-1', 'prj-1');
  const dispatches = (id: string) => harness.adapters.get(id)?.dispatches.length ?? 0;
  return {
    harness,
    dispatches: dispatches(CODER.adapterId) + dispatches(SECOND.adapterId),
    secondWorker: dispatches(SECOND.adapterId),
    task: harness.store.taskRow('task-1')?.state,
    run: (await harness.store.loadRun('run-1', 'prj-1'))?.state,
    failed: harness.store.events().filter((event) => event.type === 'task.failed' && event.taskId === 'task-1').map((event) => event.facts),
    retries: harness.store.events().filter((event) => event.type === 'retry.scheduled').length,
  };
}

describe('the dispatch counter, through the run loop', () => {
  it('a handed attempt that times out: exactly 1 dispatch, never 2, the task and run FAILED on the cause, the hold kept', async () => {
    const m = await mission([{ kind: 'fail', code: 'TIMEOUT', runtimeStarted: true }, ANSWER]);
    expect(m.dispatches).toBe(1);
    expect(m.retries).toBe(0);
    expect(m.task).toBe('FAILED');
    expect(m.run).toBe('FAILED');
    expect(m.failed).toEqual([expect.objectContaining({ code: 'TIMEOUT', reasonCode: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN' })]);
    expect(m.harness.budget.reservations().filter((row) => row.state === 'RELEASED'), 'never released').toEqual([]);
    expect(m.harness.budget.reservations().filter((row) => row.state === 'COMMITTED' && row.usdMicros > 0), 'charged at its hold, never $0').toHaveLength(1);
    const settled = m.harness.store.events().filter((event) => event.type === 'budget.settled');
    expect(settled.map((event) => event.facts.usdMicros), 'the amount is Unknown').toEqual([null]);
  });

  it('and it is not REROUTED to another worker either: a reroute is a second paid dispatch', async () => {
    const m = await mission([{ kind: 'fail', code: 'TIMEOUT', runtimeStarted: true }], { reroute: true });
    expect(m.secondWorker, 'the other worker is never asked').toBe(0);
    expect(m.dispatches).toBe(1);
    expect(m.task).toBe('FAILED');
  });

  it('a rate limit inside a started session is OUTCOME UNKNOWN too: 1 dispatch', async () => {
    const m = await mission([{ kind: 'fail', code: 'RATE_LIMIT', runtimeStarted: true }, ANSWER]);
    expect(m.dispatches).toBe(1);
    expect(m.failed).toEqual([expect.objectContaining({ code: 'RATE_LIMIT', reasonCode: 'HANDED_FAILURE_OUTCOME_UNKNOWN' })]);
  });

  it('CONTROL: the provider\'s own 429 attested unprocessed IS retried, 2 dispatches, and the mission completes', async () => {
    const m = await mission([{ kind: 'fail', code: 'RATE_LIMIT', runtimeStarted: false }, ANSWER]);
    expect(m.dispatches).toBe(2);
    expect(m.retries).toBe(1);
    expect(m.task).toBe('SUCCEEDED');
    expect(m.run).toBe('COMPLETED');
  });

  it('CONTROL: a non-retryable failure keeps today\'s behaviour: 1 dispatch, FAILED, no OUTCOME UNKNOWN cause', async () => {
    const m = await mission([{ kind: 'fail', code: 'AUTH_CONFIGURATION' }, ANSWER]);
    expect(m.dispatches).toBe(1);
    expect(m.failed).toHaveLength(1);
    expect(m.failed[0]!.reasonCode).toBeUndefined();
  });
});
