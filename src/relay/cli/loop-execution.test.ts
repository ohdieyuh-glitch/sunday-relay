import { describe, expect, it } from 'vitest';
import {
  executeLoopControl,
  executeLoopCreation,
  executeLoopHistory,
  executeLoopInspect,
  executeLoopStatus,
  renderLoopStatusLines,
  type LoopClientResult,
  type LoopExecutionClient,
} from './loop-execution';
import type { LoopStatusProjection } from '../mission';

/**
 * The CLI's execution surface, offline.
 *
 * Every claim here is about restraint: that nothing is sent before a
 * confirmation, that the server's answer is rendered rather than second-
 * guessed, and that Unknown is printed as Unknown rather than as a number the
 * CLI made up.
 */

const STATUS: LoopStatusProjection = {
  loopId: 'lpe_1',
  runId: 'lpr_1',
  projectId: 'prj_1',
  workspaceId: 'wsp_1',
  state: 'completed',
  stateClass: 'successful_terminal',
  succeeded: true,
  finished: true,
  currentIterationId: null,
  currentOrdinal: null,
  identity: {
    requestedRole: 'coding_agent',
    resolvedRole: 'coding_agent',
    requestedAdapterId: 'fake-loop-agent',
    actualAdapterId: 'fake-loop-agent',
    actualAgentId: 'fake-agent-1',
    requestedModel: 'asked-for',
    actualModel: 'actually-ran',
  },
  usage: {
    maxIterations: 10, iterationsStarted: 3, iterationsCompleted: 3,
    maxTotalDurationMinutes: 60, maxSpendMicros: '10000000',
    knownSpendMicros: '3000', spendUnknown: false, currency: 'USD',
    maxTotalTokens: 1000, tokensUsed: 300, tokensUnknown: false,
    maxProviderCalls: 100, providerCallsUsed: 3, providerCallsUnknown: false,
  },
  blocker: null,
  latestFailure: null,
  latestCheckpoint: null,
  interruptionReason: null,
  recoveryGeneration: 0,
  createdAt: '2026-08-03T12:00:00.000Z',
  updatedAt: '2026-08-03T12:00:03.000Z',
};

/** A client that records what it was asked to do. */
function stubClient(overrides: Partial<LoopExecutionClient> = {}) {
  const calls: string[] = [];
  const enabled: LoopClientResult<{ loopEngineEnabled: boolean; supportedRoles: readonly string[] }> = {
    ok: true, data: { loopEngineEnabled: true, supportedRoles: ['coding_agent'] },
  };
  const client: LoopExecutionClient = {
    capability: async () => { calls.push('capability'); return enabled; },
    confirm: async () => { calls.push('confirm'); return { ok: true, data: { ...STATUS, duplicate: false } }; },
    status: async () => { calls.push('status'); return { ok: true, data: STATUS }; },
    inspect: async () => { calls.push('inspect'); return { ok: false, status: 404, kind: 'not_found', message: 'no' }; },
    history: async () => { calls.push('history'); return { ok: true, data: { runs: [] } }; },
    control: async () => { calls.push('control'); return { ok: true, data: { ...STATUS, duplicate: false } }; },
    ...overrides,
  };
  return { client, calls };
}

const CREATE = {
  projectId: 'prj_1', loopId: 'lpe_1', contractRef: 'ref', contractVersion: 1,
  contractBindingDigest: 'digest', objective: 'do the thing', targetExpression: 'coding',
  workspaceId: 'wsp_1', confirmationRequestId: 'cfm_1',
};

describe('nothing runs without a confirmation', () => {
  it('sends nothing at all when the user has not confirmed', async () => {
    const { client, calls } = stubClient();
    const result = await executeLoopCreation(client, { ...CREATE, confirmed: false });
    expect(result.failed).toBe(false);
    expect(result.lines.join(' ')).toContain('not been confirmed');
    // The decisive assertion: the server was never contacted.
    expect(calls).toEqual([]);
  });

  it('checks the server capability before confirming anything', async () => {
    const { client, calls } = stubClient();
    await executeLoopCreation(client, { ...CREATE, confirmed: true });
    expect(calls).toEqual(['capability', 'confirm']);
  });

  it('stops at a disabled engine without sending a contract', async () => {
    const { client, calls } = stubClient({
      capability: async () => ({ ok: true, data: { loopEngineEnabled: false, supportedRoles: [] } }),
    });
    const result = await executeLoopCreation(client, { ...CREATE, confirmed: true });
    expect(result.failed).toBe(true);
    expect(result.lines.join(' ')).toContain('not enabled on this server');
    // The contract was never sent. (The overridden capability stub does not
    // record itself, so the assertion is about what did NOT happen.)
    expect(calls).not.toContain('confirm');
  });
});

describe('the server is authoritative', () => {
  it('renders a refusal rather than arguing with it', async () => {
    const { client } = stubClient({
      confirm: async () => ({
        ok: false, status: 422, kind: 'unsupported_target',
        message: 'No adapter in this build can staff the reviewer role.',
      }),
    });
    const result = await executeLoopCreation(client, { ...CREATE, targetExpression: 'reviewer', confirmed: true });
    expect(result.failed).toBe(true);
    expect(result.lines.join(' ')).toContain('reviewer role');
    expect(result.lines.join(' ')).toContain('unsupported_target');
  });

  it('says so when a confirmation was already recorded', async () => {
    const { client } = stubClient({
      confirm: async () => ({ ok: true, data: { ...STATUS, duplicate: true } }),
    });
    const result = await executeLoopCreation(client, { ...CREATE, confirmed: true });
    expect(result.lines[0]).toContain('already been recorded');
    expect(result.failed).toBe(false);
  });

  it('shows the real run id the server returned', async () => {
    const { client } = stubClient();
    const result = await executeLoopCreation(client, { ...CREATE, confirmed: true });
    expect(result.lines.join('\n')).toContain('lpr_1');
  });
});

describe('what the status renders', () => {
  it('separates requested identity from actual identity', () => {
    const lines = renderLoopStatusLines(STATUS).join('\n');
    expect(lines).toContain('requested asked-for, actual actually-ran');
  });

  it('prints Unknown for an unreported cost, never a number', () => {
    const unknown: LoopStatusProjection = {
      ...STATUS,
      usage: { ...STATUS.usage, knownSpendMicros: null, spendUnknown: true, tokensUsed: null, tokensUnknown: true },
    };
    const lines = renderLoopStatusLines(unknown).join('\n');
    expect(lines).toContain('Spend       Unknown');
    expect(lines).toContain('Tokens      Unknown');
    expect(lines).not.toContain('0.0000');
  });

  it('prints Unknown for an unobserved model rather than the requested one', () => {
    const unobserved: LoopStatusProjection = {
      ...STATUS,
      identity: { ...STATUS.identity!, actualModel: null, actualAgentId: null },
    };
    const lines = renderLoopStatusLines(unobserved).join('\n');
    expect(lines).toContain('actual Unknown');
    expect(lines).toContain('Agent       Unknown');
  });

  it('never calls an exhausted run successful', () => {
    const exhausted: LoopStatusProjection = {
      ...STATUS, state: 'iteration_exhausted', stateClass: 'exhausted', succeeded: false, finished: true,
    };
    const lines = renderLoopStatusLines(exhausted).join('\n');
    expect(lines).toContain('iteration exhausted');
    expect(lines).toContain('did not complete');
    expect(lines).not.toContain('Outcome     completed');
  });

  it('says nothing about outcome while a run is still going', () => {
    const running: LoopStatusProjection = {
      ...STATUS, state: 'running', stateClass: 'active', succeeded: false, finished: false,
    };
    expect(renderLoopStatusLines(running).join('\n')).not.toContain('Outcome');
  });

  it('shows a blocker and what to do about it', () => {
    const blocked: LoopStatusProjection = {
      ...STATUS,
      blocker: { reason: 'unavailable_role', detail: 'The coding_agent role is not connected.', requiredUserAction: 'Connect it.' },
    };
    const lines = renderLoopStatusLines(blocked).join('\n');
    expect(lines).toContain('not connected');
    expect(lines).toContain('Connect it.');
  });
});

describe('reads and controls', () => {
  it('renders a status', async () => {
    const { client } = stubClient();
    expect((await executeLoopStatus(client, 'lpr_1')).lines.join('\n')).toContain('lpr_1');
  });

  it('reports a missing run without pretending it succeeded', async () => {
    const { client } = stubClient();
    const result = await executeLoopInspect(client, 'lpr_missing');
    expect(result.failed).toBe(true);
    expect(result.lines.join(' ')).toContain('not_found');
  });

  it('says a Loop has no runs rather than printing an empty table', async () => {
    const { client } = stubClient();
    const result = await executeLoopHistory(client, 'lpe_1');
    expect(result.lines.join(' ')).toContain('no runs yet');
    expect(result.failed).toBe(false);
  });

  it('passes the caller\'s request id through for every control', async () => {
    const seen: string[] = [];
    const { client } = stubClient({
      control: async (input) => { seen.push(`${input.action}:${input.requestId}`); return { ok: true, data: STATUS }; },
    });
    for (const action of ['pause', 'resume', 'stop'] as const) {
      await executeLoopControl(client, { runId: 'lpr_1', action, requestId: `lpq_${action}` });
    }
    expect(seen).toEqual(['pause:lpq_pause', 'resume:lpq_resume', 'stop:lpq_stop']);
  });

  it('reports a duplicate control request as already recorded', async () => {
    const { client } = stubClient({
      control: async () => ({ ok: true, data: { ...STATUS, duplicate: true } }),
    });
    const result = await executeLoopControl(client, { runId: 'lpr_1', action: 'pause', requestId: 'lpq_1' });
    expect(result.lines[0]).toContain('already been recorded');
  });
});
