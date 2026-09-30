/**
 * DEFECT B: THE LIVE SHELL PORT'S DISPATCH CLAIM IS SCOPED TO ITS OWN INVOCATION.
 *
 * `createExecutorShellPort` authorizes ONE invocation and then asked the tool store to claim
 * dispatches: up to sixteen AUTHORIZED invocations of ANY run in ANY project, keeping only its own.
 * Every other invocation it swept was marked DISPATCHING under this caller and never executed by it,
 * so the port that owned it found nothing to claim and failed as `executor_dispatch_unclaimed`, and
 * the stolen row sat DISPATCHING until a terminal sweep closed it. One job per database hid it; two
 * missions, or a bridge and a job, on one database are enough.
 *
 * These drive the REAL port with a tool store that behaves as the production claim does: it claims
 * every AUTHORIZED invocation the call's scope admits. The same claim against a real PostgreSQL is in
 * `scripts/julius-live-preflight-identity.test.ts` ("DEFECT B").
 */

import { describe, expect, it } from 'vitest';
import type { ToolInvocationResult } from '../../src/relay/mission/julius';
import { createExecutorShellPort } from './executor-effects';

const RUN = 'run:0b0000000000000000000001', TASK = `${RUN}:build`, PROJECT = 'prj-julius-scope-1';
const step = {
  runId: RUN, projectId: PROJECT, taskId: TASK, workerId: 'coding-agent-claude-hosted',
  invocationKey: `${TASK}:diff`, command: 'git --no-pager diff', timeoutMs: 30_000,
};
const resultFor = (invocationId: string): ToolInvocationResult => ({
  invocationId, status: 'SUCCEEDED', exitCode: 0, safeSummary: 'Sandbox command completed.', stdout: '', stderr: '',
  stdoutRef: null, stderrRef: null, artifacts: [], evidence: [], durationMs: 1,
  resourceUsage: { toolCalls: 1, runtimeMs: 1, outputBytes: 0 }, policyDecisionRef: 'card:1', mutations: [],
});

/** A tool store whose claim behaves like the production SQL: it takes every AUTHORIZED row its scope admits. */
function fleet() {
  const rows = new Map<string, { projectId: string; state: 'AUTHORIZED' | 'DISPATCHING'; claimedBy: string | null }>();
  const calls: Record<string, unknown>[] = [];
  let requested = '';
  const tools = {
    request: async (input: { invocationId: string; projectId: string }) => {
      requested = input.invocationId;
      rows.set(input.invocationId, { projectId: input.projectId, state: 'AUTHORIZED', claimedBy: null });
    },
    authorize: async () => true,
    claimDispatch: async (input: { claimedBy: string; limit: number; invocationId?: string; projectId?: string }) => {
      calls.push({ ...input });
      const taken = [...rows.entries()]
        .filter(([id, row]) => row.state === 'AUTHORIZED'
          && (input.invocationId === undefined || id === input.invocationId)
          && (input.projectId === undefined || row.projectId === input.projectId))
        .slice(0, input.limit);
      for (const [, row] of taken) { row.state = 'DISPATCHING'; row.claimedBy = input.claimedBy; }
      return taken.map(([invocationId]) => ({ invocation: { invocationId }, dispatchGeneration: 1 }));
    },
    failDispatch: async () => true,
  };
  return { tools, rows, calls, requested: () => requested };
}

const portOver = (tools: unknown) => createExecutorShellPort({
  pool: { query: async () => ({ rows: [] }) } as never,
  tools: tools as never,
  settlement: { settle: async () => ({ created: true }) } as never,
  client: {
    createSandbox: async () => ({}), prepareWorkspace: async () => ({}),
    executeTool: async (input: { request: { invocationId: string } }) => resultFor(input.request.invocationId),
    destroySandbox: async () => true,
  } as never,
  claims: { claimFor: () => ({ leaseGeneration: 1 }) },
  tenantId: 'tenant', callerId: 'julius-live', policyRevision: 'card:1', executionId: 'execution:1', workspaceSourceRef: 'HEAD',
});

describe('defect B: the live shell port claims its own invocation, and nothing else', () => {
  it('asks the store for exactly this invocation, in this project, one at most', async () => {
    const store = fleet();
    await portOver(store.tools).run(step);
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({ invocationId: store.requested(), projectId: PROJECT, limit: 1 });
  });

  it('another mission\'s AUTHORIZED invocation, pending in the same database, is left for its own port', async () => {
    const store = fleet();
    store.rows.set('inv:another-mission', { projectId: 'prj-another', state: 'AUTHORIZED', claimedBy: null });
    store.rows.set('inv:same-project-other-run', { projectId: PROJECT, state: 'AUTHORIZED', claimedBy: null });
    await portOver(store.tools).run(step);
    expect(store.rows.get(store.requested())?.state, 'this port dispatched its own').toBe('DISPATCHING');
    expect(store.rows.get('inv:another-mission'), 'another project\'s pending dispatch was not taken')
      .toEqual({ projectId: 'prj-another', state: 'AUTHORIZED', claimedBy: null });
    expect(store.rows.get('inv:same-project-other-run'), 'nor another invocation of the same project')
      .toEqual({ projectId: PROJECT, state: 'AUTHORIZED', claimedBy: null });
  });
});
