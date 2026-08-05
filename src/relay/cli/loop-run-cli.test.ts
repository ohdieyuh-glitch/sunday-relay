import { describe, expect, it, vi } from 'vitest';

import { isLoopRunCommand, runLoopRunCli } from './loop-run-cli';
import type { LoopExecutionClient } from './loop-execution';
import type { LoopStatusProjection } from '../mission';

/**
 * ARGV REACHES THE RUNTIME — AND ONLY WHERE IT SHOULD.
 *
 * `relay loop status lpr_x` used to print a preview of the command it had
 * parsed. Honest while there was no runtime; misleading once there was one,
 * because the user asked what a run is DOING and got a description of what they
 * had typed.
 *
 * The two things this must not do are more important than the one it must:
 * it must never start a Loop from a bare objective, and it must never let a
 * control through without an authorization AND a caller-minted request id.
 */

const RUN_ID = 'lpr_00000000000000000001';
const LOOP_ID = 'lpe_00000000000000000001';

/**
 * A COMPLETE projection, not a hand-picked subset.
 *
 * The first version of this fixture carried only the fields the assertions
 * read, and `renderLoopStatusLines` — which the commands call on the way out —
 * threw on the ones it did not. A fixture that cannot survive the code path it
 * stands in for is not evidence about that path.
 */
const projection = (): LoopStatusProjection => ({
  loopId: LOOP_ID,
  runId: RUN_ID,
  projectId: 'prj_1',
  workspaceId: 'wsp_1',
  state: 'running',
  stateClass: 'active',
  succeeded: false,
  finished: false,
  currentIterationId: null,
  currentOrdinal: null,
  identity: {
    requestedRole: 'coding_agent',
    resolvedRole: 'coding_agent',
    requestedAdapterId: 'fake-loop-agent',
    actualAdapterId: 'fake-loop-agent',
    actualAgentId: null,
    requestedModel: 'asked-for',
    actualModel: null,
  },
  usage: {
    maxIterations: 10, iterationsStarted: 1, iterationsCompleted: 0,
    maxTotalDurationMinutes: 60, maxSpendMicros: null,
    knownSpendMicros: null, spendUnknown: true, currency: null,
    maxTotalTokens: null, tokensUsed: null, tokensUnknown: true,
    maxProviderCalls: null, providerCallsUsed: 0,
  },
  blocker: null,
  latestFailure: null,
  latestCheckpoint: null,
  interruptionReason: null,
  recoveryGeneration: 0,
  createdAt: '2026-08-04T12:00:00.000Z',
  updatedAt: '2026-08-04T12:00:01.000Z',
} as unknown as LoopStatusProjection);

function fakeClient(): LoopExecutionClient & { calls: string[] } {
  const calls: string[] = [];
  const okStatus = async () => { calls.push('status'); return { ok: true as const, data: projection() }; };
  return {
    calls,
    capability: vi.fn(async () => ({ ok: true as const, data: { loopEngineEnabled: true, supportedRoles: ['coding_agent'] } })),
    confirm: vi.fn(async () => { calls.push('confirm'); return { ok: true as const, data: projection() }; }),
    status: vi.fn(okStatus),
    inspect: vi.fn(async () => {
      calls.push('inspect');
      // An inspection is a STATUS plus the journal facts the renderer prints.
      return {
        ok: true as const,
        data: {
          ...projection(),
          contract: { ref: 'lct_1', version: 1 },
          journalIntegrity: 'intact',
          snapshotSource: 'journal_replay',
          iterations: [],
        } as never,
      };
    }),
    history: vi.fn(async () => { calls.push('history'); return { ok: true as const, data: { runs: [] } }; }),
    control: vi.fn(async () => { calls.push('control'); return { ok: true as const, data: projection() }; }),
  } as unknown as LoopExecutionClient & { calls: string[] };
}

const env = {} as NodeJS.ProcessEnv;

describe('which commands are live-run commands', () => {
  it('a read that names a run is', () => {
    expect(isLoopRunCommand(['loop', 'status', RUN_ID])).toBe(true);
    expect(isLoopRunCommand(['loop', 'inspect', RUN_ID])).toBe(true);
    // `history` is a question about the LOOP, not about one of its runs.
    expect(isLoopRunCommand(['loop', 'history', LOOP_ID])).toBe(true);
  });

  it('the WRONG kind of id is not a run command', () => {
    // A Loop id names the standing instruction; a run id names one execution.
    // Answering about the wrong object is worse than not answering.
    expect(isLoopRunCommand(['loop', 'status', LOOP_ID])).toBe(false);
    expect(isLoopRunCommand(['loop', 'history', RUN_ID])).toBe(false);
  });

  it('a control that names a run is', () => {
    for (const action of ['pause', 'resume', 'stop']) {
      expect(isLoopRunCommand(['loop', action, RUN_ID]), action).toBe(true);
    }
  });

  it('a DRAFT is not, however it is phrased', () => {
    // The accident this exists not to have: `relay loop "fix the parser"`
    // starting a run because the engine happened to be enabled.
    expect(isLoopRunCommand(['loop', 'fix the parser'])).toBe(false);
    expect(isLoopRunCommand(['loop', 'all', 'fix the parser'])).toBe(false);
    expect(isLoopRunCommand(['loop', 'coding', 'fix the parser'])).toBe(false);
    expect(isLoopRunCommand(['sloop', 'fix the parser'])).toBe(false);
    expect(isLoopRunCommand(['loops'])).toBe(false);
  });

  it('an action with NO run id is not — a browser cannot resolve "my current Loop"', () => {
    expect(isLoopRunCommand(['loop', 'status'])).toBe(false);
  });
});

describe('a read goes straight to the server', () => {
  it('status calls the client with the run id and nothing else', async () => {
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'status', RUN_ID], env, confirmed: false, requestId: '', client,
    });
    expect(outcome.handled).toBe(true);
    expect(client.status).toHaveBeenCalledWith(RUN_ID);
    expect(client.confirm).not.toHaveBeenCalled();
    expect(client.control).not.toHaveBeenCalled();
  });

  it('a read needs NO authorization — reading a run spends nothing', async () => {
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'inspect', RUN_ID], env, confirmed: false, requestId: '', client,
    });
    expect(outcome.handled).toBe(true);
    expect(client.inspect).toHaveBeenCalledWith(RUN_ID);
  });
});

describe('a control needs consent AND an identified decision', () => {
  it('refuses without --authorize, and sends nothing', async () => {
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'stop', RUN_ID], env, confirmed: false, requestId: 'req-1', client,
    });
    expect(outcome.handled).toBe(true);
    if (!outcome.handled) return;
    expect(outcome.result.lines.join(' ')).toContain('--authorize');
    expect(client.control, 'nothing may be sent before consent').not.toHaveBeenCalled();
  });

  it('refuses without a caller-minted request id, and sends nothing', async () => {
    // An id generated by the CLI would be new on every attempt, so a retry
    // after a timeout would arrive as a SECOND decision with nothing for the
    // server's idempotency to match. That is how one stop becomes two.
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'stop', RUN_ID], env, confirmed: true, requestId: '   ', client,
    });
    expect(outcome.handled).toBe(true);
    if (!outcome.handled) return;
    expect(outcome.result.failed).toBe(true);
    expect(outcome.result.lines.join(' ')).toContain('--idempotency-key');
    expect(client.control).not.toHaveBeenCalled();
  });

  it('sends the control once both are present, carrying the caller’s id', async () => {
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'stop', RUN_ID], env, confirmed: true, requestId: 'req-42', client,
    });
    expect(outcome.handled).toBe(true);
    expect(client.control).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID, action: 'stop', requestId: 'req-42',
    }));
  });

  it('never reaches `confirm` — starting a Loop is not something argv can do here', async () => {
    const client = fakeClient();
    for (const argv of [['loop', 'fix it'], ['loop', 'all', 'fix it'], ['loop', 'status', RUN_ID]]) {
      await runLoopRunCli({ positionals: argv, env, confirmed: true, requestId: 'r', client });
    }
    expect(client.confirm, 'this seam must never start a Loop').not.toHaveBeenCalled();
  });
});

describe('a bridge that answers nonsense is a message, not a crash', () => {
  it('a renderer that throws becomes a truthful failure', async () => {
    // The client validates the envelope, not every field each renderer reaches
    // for. `{"data":{}}` reached `renderLoopStatusLines` and threw on
    // `.state.replace`, inside a promise `main.ts` does not catch — so the
    // process died with an unhandled rejection instead of saying anything.
    const client = fakeClient();
    (client.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, data: {} as never,
    });
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'status', RUN_ID], env, confirmed: false, requestId: '', client,
    });
    expect(outcome.handled).toBe(true);
    if (!outcome.handled) return;
    expect(outcome.result.failed).toBe(true);
    expect(outcome.result.lines.join(' ')).toContain('could not read');
    // And it claims nothing about the run.
    expect(outcome.result.lines.join(' ')).toContain('Nothing is claimed');
  });

  it('the same holds for a control', async () => {
    const client = fakeClient();
    (client.control as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, data: {} as never,
    });
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'stop', RUN_ID], env, confirmed: true, requestId: 'req-1', client,
    });
    expect(outcome.handled).toBe(true);
    if (!outcome.handled) return;
    expect(outcome.result.failed).toBe(true);
  });
});

describe('a draft falls through to the preview, unhandled', () => {
  it('returns handled:false so the caller renders the composer preview', async () => {
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'draft something'], env, confirmed: true, requestId: 'r', client,
    });
    expect(outcome.handled).toBe(false);
    expect(client.calls).toEqual([]);
  });

  it('an unparsable command is unhandled too, and contacts nothing', async () => {
    const client = fakeClient();
    const outcome = await runLoopRunCli({
      positionals: ['loop', 'status', '../../etc/passwd'], env, confirmed: true, requestId: 'r', client,
    });
    // Either the grammar refuses it or it is not a run command; both are
    // "handled: false" here, and neither may reach the network.
    if (outcome.handled) {
      expect(client.status).not.toHaveBeenCalledWith('../../etc/passwd');
    }
    expect(client.control).not.toHaveBeenCalled();
  });
});
