/**
 * A SECOND CODER REPAIR REACHES THE EXECUTOR, AND A REFUSAL SAYS WHAT IT WAS.
 *
 * Paid qualification 34757974058 (main 2110e2c5) failed at its second coder
 * repair, `repair:repair:run:5408584e00ffb49fd1c011a1:build:1:task:2:task`,
 * 260 ms after the budget was reserved and before a provider was asked. The
 * base-revision effect's invocation id was 70 characters; the executor composes
 * `invocationId:dispatchGeneration:sandboxId` with the invocation id as the
 * sandbox id, got 143, and refused it past its 128-character identifier ceiling
 * (`INVALID_REQUEST:execution_envelope_invalid:executionIdentity`). The durable
 * row read WORKER_EXECUTION_FAILURE with no class, because the client's refusal
 * was an untyped Error.
 *
 * These proofs drive the REAL executor client (`RemoteExecutorControlPlane`)
 * inside the REAL shell port (`createExecutorShellPort`) against a stand-in
 * executor that validates every execute envelope with the REAL validator
 * (`parseExecutorExecutionEnvelope`) and answers refusals exactly as the
 * executor service does (`executor-control-plane-service.ts`: `INVALID_REQUEST:`
 * + message, status 400). Nothing reaches Docker, PostgreSQL or a provider.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { JuliusDispatchError, safeReviewDiagnostics } from '../../src/relay/mission/julius';
import { parseExecutorExecutionEnvelope } from '../../src/relay/workspace/julius-tools/execution-envelope';
import { parseExecutorOperationRequest, type ExecutorOperation } from '../../src/relay/workspace/julius-tools/executor-operation-request';
import { EXECUTOR_IDENTIFIER_MAX_LENGTH } from '../../src/relay/workspace/julius-tools/executor-schema';
import { RemoteExecutorControlPlane } from '../../src/relay/workspace/julius-tools/remote-executor-control-plane';
import {
  EXECUTOR_INVOCATION_ID_MAX_LENGTH,
  classifyExecutorRefusal,
  createExecutorShellPort,
  executorInvocationId,
  executorTaskId,
} from './executor-effects';

afterEach(() => vi.unstubAllGlobals());

const RUN = 'run:5408584e00ffb49fd1c011a1';
/** The exact task that failed, and the chain it would have grown into. */
const FAILED_TASK = `repair:repair:${RUN}:build:1:task:2:task`;
const CHAIN = [
  `${RUN}:build`,
  `repair:${RUN}:build:1:task`,
  FAILED_TASK,
  `repair:repair:repair:${RUN}:build:1:task:2:task:3:task`,
  `segment:repair:repair:repair:${RUN}:build:1:task:2:task:3:task`,
  `segment:repair:segment:repair:repair:repair:${RUN}:build:1:task:2:task:3:task:2:task`,
];
const identityOf = (invocationId: string, dispatchGeneration: number): string => `${invocationId}:${dispatchGeneration}:${invocationId}`;

/* ------------------------------------------------------------ the stand-in executor */

interface Seen { accepted: string[]; refused: string[] }

/**
 * `fetch`, answering as the executor service answers. Execute envelopes go
 * through the real envelope validator, and every other operation through the
 * real operation validator (`parseExecutorOperationRequest`), which is where
 * attempt 3's `identity.taskId` refusal came from.
 */
const standInExecutor = (seen: Seen, onAccepted: () => { status: number; body: unknown } = () => ({ status: 409, body: { error: 'TERMINAL_FAILURE:stand_in_stops_after_validation' } })) =>
  vi.fn(async (_url: URL | string, init?: RequestInit) => {
    const operation = new Headers(init?.headers).get('x-julius-operation');
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (operation !== 'execute') {
      try {
        parseExecutorOperationRequest(operation as Exclude<ExecutorOperation, 'execute'>, JSON.parse(String(init?.body)), { tenantId: 'tenant' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid';
        seen.refused.push(`${operation}:${message}`);
        return reply(message.startsWith('SECURITY_FAILURE:') ? 409 : 400, { error: message.startsWith('SECURITY_FAILURE:') ? message : `INVALID_REQUEST:${message}` });
      }
      return reply(200, { value: {} });
    }
    const envelope = JSON.parse(String(init?.body)) as { executionIdentity: string };
    try {
      parseExecutorExecutionEnvelope(envelope, { allowedCallerIds: new Set(['julius-live']) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid';
      seen.refused.push(envelope.executionIdentity);
      return reply(message.startsWith('SECURITY_FAILURE:') ? 409 : 400, { error: message.startsWith('SECURITY_FAILURE:') ? message : `INVALID_REQUEST:${message}` });
    }
    seen.accepted.push(envelope.executionIdentity);
    const answer = onAccepted();
    return reply(answer.status, answer.body);
  });

/** The live shell port over the real client, with the durable repositories reduced to what the port calls. */
const livePort = (leaseGeneration = 1, dispatchGeneration = 1) => {
  let requested: string | null = null;
  return createExecutorShellPort({
    pool: { query: async () => ({ rows: [] }) } as never,
    tools: {
      request: async (input: { invocationId: string }) => { requested = input.invocationId; },
      authorize: async () => true,
      claimDispatch: async () => [{ invocation: { invocationId: requested }, dispatchGeneration }],
    } as never,
    settlement: { settle: async () => undefined } as never,
    client: new RemoteExecutorControlPlane({
      endpoint: new URL('https://executor.internal'), serviceCredential: 'scoped',
      callerId: 'julius-live', tenantId: 'tenant', requestTimeoutMs: 5_000,
    }),
    claims: { claimFor: () => ({ leaseGeneration }) },
    tenantId: 'tenant', callerId: 'julius-live', policyRevision: 'card:1',
    executionId: 'execution:1', workspaceSourceRef: 'HEAD',
  });
};

const baseEffect = (taskId: string) => ({
  runId: RUN, projectId: 'prj-julius-continuous-1', taskId, workerId: 'coding-agent-claude-hosted',
  invocationKey: `${taskId}:base`, command: 'git rev-parse HEAD', timeoutMs: 15_000,
});

const failureOf = async (promise: Promise<unknown>): Promise<JuliusDispatchError> => {
  try { await promise; } catch (error) { if (error instanceof JuliusDispatchError) return error; throw error; }
  throw new Error('expected the effect to fail');
};

/* ------------------------------------------------------------ 1. the identity */

describe('the invocation id is bounded, and unchanged wherever it already fit', () => {
  it('the ceiling is derived from the executor\'s own, with the invocation id counted twice', () => {
    expect(EXECUTOR_IDENTIFIER_MAX_LENGTH).toBe(128);
    expect(EXECUTOR_INVOCATION_ID_MAX_LENGTH).toBe(58);
  });

  it('REPRODUCES THE PAID FAILURE: the old id for the failed task is refused by the real validator', async () => {
    const old = `${FAILED_TASK}:base:g1`;
    expect(old).toHaveLength(70);
    expect(identityOf(old, 1)).toHaveLength(143);
    const seen: Seen = { accepted: [], refused: [] };
    vi.stubGlobal('fetch', standInExecutor(seen));
    const client = new RemoteExecutorControlPlane({ endpoint: new URL('https://executor.internal'), serviceCredential: 'scoped', callerId: 'julius-live', tenantId: 'tenant', requestTimeoutMs: 5_000 });
    const request = { invocationId: old, runId: RUN, taskId: FAILED_TASK, projectId: 'p', workerId: 'w', toolId: 'shell.bash' as const, toolVersion: '1', arguments: { command: 'git rev-parse HEAD' }, cwd: '.', idempotencyKey: old, timeoutMs: 15_000, expectedMutation: 'WORKSPACE' as const };
    const { canonicalRequestDigest } = await import('../../src/relay/workspace/julius-tools/execution-envelope');
    await expect(client.executeTool({
      sandboxId: old, expectedLeaseGeneration: 1, dispatchGeneration: 1, requestDigest: canonicalRequestDigest(request),
      executionTokenHash: 'a'.repeat(64), effectClassification: 'NON_IDEMPOTENT_MUTATION', request,
    })).rejects.toThrow('EXECUTOR_UNAVAILABLE:INVALID_REQUEST:execution_envelope_invalid:executionIdentity');
    expect(seen.refused).toEqual([identityOf(old, 1)]);
  });

  it('every id that fit before is issued identically, so nothing recorded changes meaning', () => {
    expect(executorInvocationId(`${RUN}:build:base`, 1)).toBe(`${RUN}:build:base:g1`);
    expect(executorInvocationId(`${RUN}:build:test`, 3)).toBe(`${RUN}:build:test:g3`);
    // The first repair's id was 56 characters and reached the executor on the paid run.
    expect(executorInvocationId(`repair:${RUN}:build:1:task:base`, 1)).toBe(`repair:${RUN}:build:1:task:base:g1`);
  });

  it('an id past the bound is compact, deterministic, distinct per key, step and lease, and names its step', () => {
    const id = executorInvocationId(`${FAILED_TASK}:base`, 1);
    expect(id).toMatch(/^x-[0-9a-f]{32}:base:g1$/u);
    expect(executorInvocationId(`${FAILED_TASK}:base`, 1)).toBe(id);
    expect(executorInvocationId(`${FAILED_TASK}:diff`, 1)).not.toBe(id);
    expect(executorInvocationId(`${FAILED_TASK}:base`, 2)).not.toBe(id);
    expect(executorInvocationId(`${CHAIN[3]}:base`, 1)).not.toBe(id);
  });

  it('every task in a repair and segment chain far deeper than a mission allows yields an identity the executor accepts', () => {
    const ids = new Set<string>();
    for (const taskId of CHAIN) {
      for (const step of ['base', 'diff', 'test']) {
        for (const lease of [1, 7, 999_999]) {
          const id = executorInvocationId(`${taskId}:${step}`, lease);
          expect(id.length, id).toBeLessThanOrEqual(EXECUTOR_INVOCATION_ID_MAX_LENGTH);
          expect(identityOf(id, 9_999_999_999).length, id).toBeLessThanOrEqual(EXECUTOR_IDENTIFIER_MAX_LENGTH);
          expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
          ids.add(id);
        }
      }
    }
    expect(ids.size, 'no two effects share an id').toBe(CHAIN.length * 3 * 3);
  });

  it('refuses a key or lease it cannot bind', () => {
    expect(() => executorInvocationId('', 1)).toThrow('executor_invocation_key_empty');
    expect(() => executorInvocationId(`${RUN}:build:base`, 0)).toThrow('executor_lease_generation_invalid');
  });

  it('THE FIX, END TO END: the failed task\'s base effect now passes the real validator through the real client and port', async () => {
    for (const taskId of CHAIN) {
      const seen: Seen = { accepted: [], refused: [] };
      vi.stubGlobal('fetch', standInExecutor(seen));
      // The stand-in stops every accepted envelope, so the port fails AFTER validation — which is the point.
      const failure = await failureOf(livePort(1, 1).run(baseEffect(taskId)));
      expect(seen.refused, taskId).toEqual([]);
      expect(seen.accepted, taskId).toHaveLength(1);
      expect(seen.accepted[0]!.length).toBeLessThanOrEqual(EXECUTOR_IDENTIFIER_MAX_LENGTH);
      expect(failure.failureClass).toBe('executor_terminal_failure');
    }
  });
});

/* ------------------------------------------------------------ 1b. the task id the executor is shown */

/** Attempt 3's failed task, exactly: 134 characters of repair and segment prefixes. */
const ATTEMPT_3_TASK = `repair:segment:repair:repair:repair:segment:repair:${RUN}:build:1:task:2:task:1:task:2:task:3:task:2:task:1:task`;

describe('the task id the executor is shown is bounded too', () => {
  it('REPRODUCES PAID ATTEMPT 3: the raw task id is refused by the real create validator', async () => {
    expect(ATTEMPT_3_TASK).toHaveLength(134);
    const seen: Seen = { accepted: [], refused: [] };
    vi.stubGlobal('fetch', standInExecutor(seen));
    const client = new RemoteExecutorControlPlane({ endpoint: new URL('https://executor.internal'), serviceCredential: 'scoped', callerId: 'julius-live', tenantId: 'tenant', requestTimeoutMs: 5_000 });
    const { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } = await import('./sandbox-limits');
    const sandboxId = executorInvocationId(`${ATTEMPT_3_TASK}:base`, 1);
    await expect(client.createSandbox({
      identity: { sandboxId, invocationId: sandboxId, tenantId: 'tenant', projectId: 'p', runId: RUN, taskId: ATTEMPT_3_TASK, leaseGeneration: 1, policyRevision: 'card:1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() },
      policy: EXECUTOR_SANDBOX_POLICY, limits: EXECUTOR_SANDBOX_LIMITS,
    })).rejects.toThrow('EXECUTOR_UNAVAILABLE:INVALID_REQUEST:executor_operation_invalid:identity.taskId');
    expect(seen.refused).toEqual(['create:executor_operation_invalid:identity.taskId']);
  });

  it('is unchanged wherever it fits, and compact, deterministic and distinct past the bound', () => {
    for (const taskId of CHAIN) expect(executorTaskId(taskId)).toBe(taskId);
    const compact = executorTaskId(ATTEMPT_3_TASK);
    expect(compact).toMatch(/^t-[0-9a-f]{32}$/u);
    expect(executorTaskId(ATTEMPT_3_TASK)).toBe(compact);
    expect(executorTaskId(`${ATTEMPT_3_TASK}:1:task`)).not.toBe(compact);
    expect(executorTaskId('x'.repeat(EXECUTOR_IDENTIFIER_MAX_LENGTH))).toBe('x'.repeat(EXECUTOR_IDENTIFIER_MAX_LENGTH));
    expect(executorTaskId('x'.repeat(EXECUTOR_IDENTIFIER_MAX_LENGTH + 1))).toMatch(/^t-[0-9a-f]{32}$/u);
    expect(() => executorTaskId('')).toThrow('executor_task_id_empty');
  });

  it("THE FIX, END TO END: attempt 3's task creates, prepares, executes and destroys through the real validators, while Julius keeps the full id", async () => {
    const seen: Seen = { accepted: [], refused: [] };
    vi.stubGlobal('fetch', standInExecutor(seen));
    const recorded: string[] = [];
    let requested: string | null = null;
    const port = createExecutorShellPort({
      pool: { query: async (_sql: string, params: unknown[]) => { recorded.push(String(params[0])); return { rows: [] }; } } as never,
      tools: {
        request: async (input: { invocationId: string; taskId: string }) => { requested = input.invocationId; recorded.push(input.taskId); },
        authorize: async () => true,
        claimDispatch: async () => [{ invocation: { invocationId: requested }, dispatchGeneration: 1 }],
      } as never,
      settlement: { settle: async () => undefined } as never,
      client: new RemoteExecutorControlPlane({ endpoint: new URL('https://executor.internal'), serviceCredential: 'scoped', callerId: 'julius-live', tenantId: 'tenant', requestTimeoutMs: 5_000 }),
      claims: { claimFor: () => ({ leaseGeneration: 1 }) },
      tenantId: 'tenant', callerId: 'julius-live', policyRevision: 'card:1', executionId: 'execution:1', workspaceSourceRef: 'HEAD',
    });
    await failureOf(port.run(baseEffect(ATTEMPT_3_TASK)));
    expect(seen.refused, 'no operation is refused').toEqual([]);
    expect(seen.accepted).toHaveLength(1);
    // Julius's own rows — the task binding and the durable invocation — carry the full task id.
    expect(recorded).toContain(ATTEMPT_3_TASK);
    expect(recorded.filter((value) => value.startsWith('t-'))).toEqual([]);
  });
});

/* ------------------------------------------------------------ 2. the refusal is named */

describe('a refused tool effect is recorded as what it was', () => {
  it('the paid run\'s refusal, had the id still been unbounded, is executor_identity_invalid on the base step', async () => {
    // The refusal the paid run received, answered to the port itself for any identity at all.
    vi.stubGlobal('fetch', vi.fn(async (_url: URL | string, init?: RequestInit) => {
      const operation = new Headers(init?.headers).get('x-julius-operation');
      if (operation !== 'execute') return new Response(JSON.stringify({ value: {} }), { status: 200 });
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST:execution_envelope_invalid:executionIdentity' }), { status: 400 });
    }));
    const failure = await failureOf(livePort().run(baseEffect(FAILED_TASK)));
    expect(failure.code).toBe('WORKER_EXECUTION_FAILURE');
    expect(failure.retryable, 'classification changes the record, not the orchestration').toBe(false);
    expect(failure.failureClass).toBe('executor_identity_invalid');
    expect(failure.diagnostics).toMatchObject({ executorStep: 'base', executorRefusal: 'executor_identity_invalid', executorRefusalField: 'execution_identity' });
    expect(failure.safeMessage).not.toContain('INVALID_REQUEST');
  });

  it.each([
    ['EXECUTOR_UNAVAILABLE', 'executor_unavailable', null],
    ['EXECUTOR_UNAVAILABLE:INVALID_REQUEST:execution_envelope_identity_mismatch', 'executor_identity_invalid', 'execution_identity'],
    ['EXECUTOR_UNAVAILABLE:INVALID_REQUEST:execution_envelope_invalid:taskId', 'executor_request_invalid', 'task_id'],
    ['EXECUTOR_UNAVAILABLE:INVALID_REQUEST:execution_envelope_expired', 'executor_request_invalid', null],
    // Attempt 3's refusal, exactly as the executor answered it.
    ['EXECUTOR_UNAVAILABLE:INVALID_REQUEST:executor_operation_invalid:identity.taskId', 'executor_request_invalid', 'identity_task_id'],
    ['EXECUTOR_UNAVAILABLE:internal', 'executor_unavailable', null],
    ['executor_authorization_refused', 'executor_authorization_refused', null],
    ['executor_scope_not_held:execute', 'executor_scope_refused', null],
    ['executor_identity_conflict', 'executor_identity_conflict', null],
    ['STARTED_UNKNOWN_OUTCOME', 'executor_outcome_unknown', null],
    ['SECURITY_FAILURE:executor_attestation_missing', 'executor_security_failure', null],
    ['TERMINAL_FAILURE:sandbox_gone', 'executor_terminal_failure', null],
    ['executor_response_malformed', 'executor_response_invalid', null],
    ['something nobody anticipated', 'executor_refused_unclassified', null],
  ] as const)('%s → %s', (message, refusal, field) => {
    expect(classifyExecutorRefusal(new Error(message))).toEqual({ refusal, field });
  });

  it('the durable diagnostics keep the class, the step and the field, and nothing else the executor said', () => {
    const kept = safeReviewDiagnostics({ executorStep: 'test', executorRefusal: 'executor_request_invalid', executorRefusalField: 'task_id' });
    expect(kept).toMatchObject({ executorStep: 'test', executorRefusal: 'executor_request_invalid', executorRefusalField: 'task_id' });
    const refusedValues = safeReviewDiagnostics({ executorStep: 'rm -rf /', executorRefusal: 'INVALID_REQUEST:execution_envelope_invalid:executionIdentity', executorRefusalField: 'Bearer abc' });
    expect(refusedValues).toMatchObject({ executorStep: null, executorRefusal: null, executorRefusalField: null });
  });

  it('a claim that was never recorded is named too, before anything is requested', async () => {
    const port = createExecutorShellPort({
      pool: { query: async () => ({ rows: [] }) } as never, tools: {} as never, settlement: {} as never, client: {} as never,
      claims: { claimFor: () => null }, tenantId: 't', callerId: 'c', policyRevision: 'r', executionId: 'e', workspaceSourceRef: 'HEAD',
    });
    const failure = await failureOf(port.run(baseEffect(`${RUN}:build`)));
    expect(failure.failureClass).toBe('executor_claim_missing');
    expect(failure.diagnostics).toMatchObject({ executorStep: 'base', executorRefusal: 'executor_claim_missing' });
  });
});
