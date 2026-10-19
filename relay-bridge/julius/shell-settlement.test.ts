/**
 * THE LIVE SHELL PORT NEVER LEAVES A CLAIMED DISPATCH OPEN, AND SETTLES WHAT IT RECEIVED, RAW.
 *
 * Paid run 36568129865 (Mission 6): the coder's close-out `…:build:status:g1` was claimed
 * (DISPATCHING), the executor answered 500, the port threw, and the invocation stayed DISPATCHING
 * after the run had FAILED. These drive the REAL port (`createExecutorShellPort`) with the durable
 * repositories reduced to what it calls, so they run everywhere; the same paths against a real
 * PostgreSQL are in `scripts/julius-live-preflight-identity.test.ts` and, through the real executor,
 * in the provider-free preflight.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { JuliusDispatchError, type SandboxExecutionPort, type ToolInvocationResult } from '../../src/relay/mission/julius';
import { createExecutorShellPort } from './executor-effects';
import { digestOf, shellDispatchClosure, shellDispatchFailure, shellEffectSettlement } from './shell-settlement';

const SECTION = '\u0000JULIUS-SECTION-9f2a\u0000';
/** What the real close-out prints: NUL-separated by design. */
const CLOSE_OUT = [`END ${'c'.repeat(40)}\n`, ' M README.md\u0000', 'M\u0000README.md\u0000', '', 'M\u0000README.md\u0000'].join(SECTION);
const resultFor = (invocationId: string, over: Partial<ToolInvocationResult> = {}): ToolInvocationResult => ({
  invocationId, status: 'SUCCEEDED', exitCode: 0, safeSummary: 'Sandbox command completed.', stdout: CLOSE_OUT, stderr: '',
  stdoutRef: null, stderrRef: null, artifacts: [], evidence: [], durationMs: 7,
  resourceUsage: { toolCalls: 1, runtimeMs: 7, outputBytes: Buffer.byteLength(CLOSE_OUT) }, policyDecisionRef: 'card:1', mutations: [], ...over,
});

describe('how a dispatch that will not settle is classified', () => {
  it.each([
    ['create', null, 'NO_EFFECT'],
    ['prepare', 'executor_unavailable', 'NO_EFFECT'],
    ['execute', 'executor_request_invalid', 'NO_EFFECT'],
    ['execute', 'executor_identity_invalid', 'NO_EFFECT'],
    ['execute', 'executor_authorization_refused', 'NO_EFFECT'],
    ['execute', 'executor_scope_refused', 'NO_EFFECT'],
    // Paid run 36568129865's answer: a 500 AFTER the receipts were written. The effect had happened.
    ['execute', 'executor_unavailable', 'UNKNOWN_OUTCOME'],
    ['execute', 'executor_outcome_unknown', 'UNKNOWN_OUTCOME'],
    ['execute', 'executor_security_failure', 'UNKNOWN_OUTCOME'],
    ['execute', 'executor_response_invalid', 'UNKNOWN_OUTCOME'],
    ['execute', 'executor_refused_unclassified', 'UNKNOWN_OUTCOME'],
    ['execute', null, 'UNKNOWN_OUTCOME'],
    ['settle', null, 'UNKNOWN_OUTCOME'],
  ] as const)('%s / %s → %s', (stage, refusal, failure) => {
    expect(shellDispatchFailure(stage, refusal)).toBe(failure);
  });

  it('the closure names the step and the class, and never carries the executor\'s text', () => {
    const closure = shellDispatchClosure({
      invocationId: 'inv', invocationKey: 'run:efb6e20f0d11885bc5085a68:build:status', dispatchGeneration: 3,
      stage: 'execute', refusal: 'executor_unavailable', failureClass: 'executor_unavailable', completedAt: 't',
    });
    expect(closure).toEqual({
      invocationId: 'inv', dispatchGeneration: 3, failure: 'UNKNOWN_OUTCOME', failureClass: 'executor_unavailable', completedAt: 't',
      safeSummary: 'The status effect failed at execute (executor_unavailable); whether the executor ran it is unknown to Julius.',
    });
    expect(shellDispatchClosure({ invocationId: 'i', invocationKey: 'preflight:n:4', dispatchGeneration: 1, stage: 'create', refusal: null, failureClass: 'executor_unavailable', completedAt: 't' }).safeSummary)
      .toBe('The tool effect failed at create (executor_unavailable); the executor ran nothing.');
  });
});

describe('the settlement of one shell effect is the raw result', () => {
  it('digests and hashes the raw output, NULs included; storage encoding is the repository\'s business', () => {
    const result = resultFor('inv');
    const command = shellEffectSettlement({ invocationId: 'inv', dispatchGeneration: 2, result, safeSummary: 'summary', occurredAt: 't' });
    expect(command.result.stdout).toBe(CLOSE_OUT);
    expect(command.resultDigest).toBe(digestOf(result));
    expect(command.evidence).toEqual([{ evidenceId: 'tool:inv', type: 'COMMAND_EXECUTION', integrityHash: createHash('sha256').update(CLOSE_OUT).digest('hex'), facts: { safeSummary: 'summary' } }]);
    expect(command).toMatchObject({ settlementId: 'settlement:inv', invocationId: 'inv', dispatchGeneration: 2, artifacts: [], taskOutcome: null, occurredAt: 't' });
  });
});

describe('the live shell port never leaves a claimed dispatch open (paid run 36568129865)', () => {
  const RUN = 'run:efb6e20f0d11885bc5085a68', TASK = `${RUN}:build`;
  const step = {
    runId: RUN, projectId: 'prj-julius-live-6', taskId: TASK, workerId: 'coding-agent-claude-hosted',
    invocationKey: `${TASK}:status`, command: 'git status --porcelain=v1 --untracked-files=all -z', timeoutMs: 30_000,
  };
  const harness = (options: {
    client?: Partial<SandboxExecutionPort>;
    settle?: () => Promise<unknown>;
    failDispatch?: () => Promise<boolean>;
  } = {}) => {
    const closed: Record<string, unknown>[] = [];
    const settled: Record<string, unknown>[] = [];
    let requested = '';
    const port = createExecutorShellPort({
      pool: { query: async () => ({ rows: [] }) } as never,
      tools: {
        request: async (input: { invocationId: string }) => { requested = input.invocationId; },
        authorize: async () => true,
        claimDispatch: async () => [{ invocation: { invocationId: requested }, dispatchGeneration: 4 }],
        failDispatch: async (input: Record<string, unknown>) => { closed.push(input); return (options.failDispatch ?? (async () => true))(); },
      } as never,
      settlement: { settle: async (command: Record<string, unknown>) => { settled.push(command); return (options.settle ?? (async () => ({ created: true })))(); } } as never,
      client: {
        createSandbox: async () => ({}), prepareWorkspace: async () => ({}),
        executeTool: async () => resultFor(requested), destroySandbox: async () => true,
        ...options.client,
      } as never,
      claims: { claimFor: () => ({ leaseGeneration: 1 }) },
      tenantId: 'tenant', callerId: 'julius-live', policyRevision: 'card:1', executionId: 'execution:1', workspaceSourceRef: 'HEAD',
    });
    return { port, closed, settled, invocationId: () => requested };
  };
  const failureOf = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => { throw new Error('expected the effect to fail'); }, (error: unknown) => error);

  it('a close-out that succeeds is settled raw and returned raw: the NULs reach the parser, and nothing is closed', async () => {
    const { port, closed, settled, invocationId } = harness();
    const result = await port.run(step);
    expect(result).toMatchObject({ status: 'SUCCEEDED', exitCode: 0, stdout: CLOSE_OUT });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ invocationId: invocationId(), dispatchGeneration: 4, resultDigest: digestOf(resultFor(invocationId())) });
    expect((settled[0]!.result as ToolInvocationResult).stdout).toBe(CLOSE_OUT);
    expect(closed).toEqual([]);
  });

  it('an executor 500 after the effect closes the dispatch as UNKNOWN_OUTCOME before the refusal surfaces', async () => {
    const { port, closed, settled, invocationId } = harness({ client: { executeTool: async () => { throw new Error('EXECUTOR_UNAVAILABLE:executor_failure'); } } });
    const failure = await failureOf(port.run(step));
    expect(failure).toBeInstanceOf(JuliusDispatchError);
    expect((failure as JuliusDispatchError).failureClass).toBe('executor_unavailable');
    expect(closed).toEqual([expect.objectContaining({ invocationId: invocationId(), dispatchGeneration: 4, failure: 'UNKNOWN_OUTCOME', failureClass: 'executor_unavailable' })]);
    expect(String(closed[0]!.safeSummary)).toContain('The status effect failed at execute');
    expect(settled).toEqual([]);
  });

  it('a refused create closes it as NO_EFFECT', async () => {
    const { port, closed } = harness({ client: { createSandbox: async () => { throw new Error('EXECUTOR_UNAVAILABLE:sandbox_create_failed'); } } });
    expect(await failureOf(port.run(step))).toBeInstanceOf(JuliusDispatchError);
    expect(closed).toEqual([expect.objectContaining({ failure: 'NO_EFFECT', failureClass: 'executor_unavailable' })]);
  });

  it('a prepare refused by the host daemon (the executor-private shape) closes it as NO_EFFECT', async () => {
    const { port, closed } = harness({ client: { prepareWorkspace: async () => { throw new Error('EXECUTOR_UNAVAILABLE:sandbox_create_failed'); } } });
    expect(await failureOf(port.run(step))).toBeInstanceOf(JuliusDispatchError);
    expect(closed).toEqual([expect.objectContaining({ failure: 'NO_EFFECT' })]);
  });

  it('an execute refused as an invalid request closes it as NO_EFFECT: the executor refused before reserving it', async () => {
    const { port, closed } = harness({ client: { executeTool: async () => { throw new Error('EXECUTOR_UNAVAILABLE:INVALID_REQUEST:execution_envelope_invalid:taskId'); } } });
    expect(await failureOf(port.run(step))).toBeInstanceOf(JuliusDispatchError);
    expect(closed).toEqual([expect.objectContaining({ failure: 'NO_EFFECT', failureClass: 'executor_request_invalid' })]);
  });

  it('a settlement that fails closes it as UNKNOWN_OUTCOME, and the failure still surfaces as itself', async () => {
    const refusal = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: '22021' });
    const { port, closed } = harness({ settle: async () => { throw refusal; } });
    expect(await failureOf(port.run(step))).toBe(refusal);
    expect(closed).toEqual([expect.objectContaining({ failure: 'UNKNOWN_OUTCOME', failureClass: 'tool_settlement_failed' })]);
    expect(String(closed[0]!.safeSummary)).toContain('failed at settle');
  });

  it('a close that itself fails never replaces the refusal in hand', async () => {
    const { port, closed } = harness({
      client: { executeTool: async () => { throw new Error('STARTED_UNKNOWN_OUTCOME'); } },
      failDispatch: async () => { throw new Error('database_unreachable'); },
    });
    const failure = await failureOf(port.run(step));
    expect(failure).toBeInstanceOf(JuliusDispatchError);
    expect((failure as JuliusDispatchError).failureClass).toBe('executor_outcome_unknown');
    expect(closed).toHaveLength(1);
  });
});
