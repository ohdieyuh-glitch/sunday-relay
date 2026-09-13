/**
 * A SECOND CODER REPAIR REACHES THE EXECUTOR.
 *
 * Paid qualification 34757974058 (main 2110e2c5) failed at its second coder
 * repair, `repair:repair:run:5408584e00ffb49fd1c011a1:build:1:task:2:task`,
 * 260 ms after the budget was reserved and before a provider was asked. The
 * base-revision effect's invocation id was 70 characters; the executor composes
 * `invocationId:dispatchGeneration:sandboxId` with the invocation id as the
 * sandbox id, got 143, and refused it past its 128-character identifier ceiling
 * (`INVALID_REQUEST:execution_envelope_invalid:executionIdentity`).
 *
 * These proofs drive the REAL executor client (`RemoteExecutorControlPlane`)
 * inside the REAL shell port (`createExecutorShellPort`) against a stand-in
 * executor that validates every execute envelope with the REAL validator
 * (`parseExecutorExecutionEnvelope`) and answers refusals exactly as the
 * executor service does (`executor-control-plane-service.ts`: `INVALID_REQUEST:`
 * + message, status 400). Nothing reaches Docker, PostgreSQL or a provider.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseExecutorExecutionEnvelope } from '../../src/relay/workspace/julius-tools/execution-envelope';
import { EXECUTOR_IDENTIFIER_MAX_LENGTH } from '../../src/relay/workspace/julius-tools/executor-schema';
import { RemoteExecutorControlPlane } from '../../src/relay/workspace/julius-tools/remote-executor-control-plane';
import {
  EXECUTOR_INVOCATION_ID_MAX_LENGTH,
  createExecutorShellPort,
  executorInvocationId,
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

/** `fetch`, answering as the executor service answers. Execute envelopes go through the real validator. */
const standInExecutor = (seen: Seen, onAccepted: () => { status: number; body: unknown } = () => ({ status: 409, body: { error: 'TERMINAL_FAILURE:stand_in_stops_after_validation' } })) =>
  vi.fn(async (_url: URL | string, init?: RequestInit) => {
    const operation = new Headers(init?.headers).get('x-julius-operation');
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (operation !== 'execute') return reply(200, { value: {} });
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

const failureOf = async (promise: Promise<unknown>): Promise<Error> => {
  try { await promise; } catch (error) { if (error instanceof Error) return error; throw error; }
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
      expect(failure.message).toBe('TERMINAL_FAILURE:stand_in_stops_after_validation');
    }
  });
});
