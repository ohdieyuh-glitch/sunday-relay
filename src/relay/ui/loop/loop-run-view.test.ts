import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  activityFor,
  controlsFor,
  isUsableRestorePoint,
  projectLoopRunView,
  restorePointFor,
} from './loop-run-view';
import type { LoopStatusProjection } from '../../mission';

/**
 * The browser's view of a running Loop.
 *
 * Every assertion here is about the surface NOT knowing better than the
 * server: it may not animate work the server has not reported, may not enable
 * a control the state forbids, and may not turn Unknown into a number.
 */

const BASE: LoopStatusProjection = {
  loopId: 'lpe_1',
  runId: 'lpr_1',
  projectId: 'prj_1',
  workspaceId: null,
  state: 'running',
  stateClass: 'active',
  succeeded: false,
  finished: false,
  currentIterationId: 'lpi_1',
  currentOrdinal: 1,
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
    maxIterations: 10, iterationsStarted: 1, iterationsCompleted: 0,
    maxTotalDurationMinutes: 60, maxSpendMicros: '10000000',
    knownSpendMicros: '1000', spendUnknown: false, currency: 'USD',
    maxTotalTokens: 1000, tokensUsed: 100, tokensUnknown: false,
    maxProviderCalls: 100, providerCallsUsed: 1, providerCallsUnknown: false,
  },
  blocker: null,
  latestFailure: null,
  latestCheckpoint: null,
  interruptionReason: null,
  recoveryGeneration: 0,
  createdAt: '2026-08-03T12:00:00.000Z',
  updatedAt: '2026-08-03T12:00:01.000Z',
};

const withState = (
  state: LoopStatusProjection['state'],
  stateClass: string,
  extra: Partial<LoopStatusProjection> = {},
): LoopStatusProjection => ({ ...BASE, state, stateClass, ...extra });

/* ======================================================== activity === */

describe('the surface animates only what the server reports', () => {
  it('shows nothing at all before there is a run', () => {
    expect(activityFor(null)).toBe('none');
    const view = projectLoopRunView({ status: null });
    expect(view.activity).toBe('none');
    expect(view.runId).toBeNull();
    expect(view.emptyReason).toContain('confirm it to start');
  });

  it('animates only for an active state', () => {
    expect(activityFor(withState('running', 'active'))).toBe('working');
    expect(activityFor(withState('observing', 'active'))).toBe('working');
    expect(activityFor(withState('completion_check', 'active'))).toBe('working');
  });

  it('does NOT animate a waiting run — waiting is not progress', () => {
    for (const state of ['waiting_approval', 'waiting_budget', 'rate_limited', 'backing_off'] as const) {
      expect(activityFor(withState(state, 'waiting')), state).toBe('waiting');
      expect(activityFor(withState(state, 'waiting'))).not.toBe('working');
    }
  });

  it('does not animate a finished, paused or held run', () => {
    expect(activityFor(withState('completed', 'successful_terminal'))).toBe('finished');
    expect(activityFor(withState('iteration_exhausted', 'exhausted'))).toBe('finished');
    expect(activityFor(withState('stopped', 'unsuccessful_terminal'))).toBe('finished');
    expect(activityFor(withState('paused', 'resumable'))).toBe('at_rest');
    expect(activityFor(withState('recovery_required', 'recovery'))).toBe('attention');
    for (const state of ['completed', 'paused', 'recovery_required'] as const) {
      expect(activityFor(withState(state, state === 'paused' ? 'resumable' : state === 'completed' ? 'successful_terminal' : 'recovery')))
        .not.toBe('working');
    }
  });

  it('does not animate an admitted-but-unstarted run', () => {
    expect(activityFor(withState('queued', 'initial'))).toBe('none');
  });
});

/* ======================================================== controls === */

describe('controls follow the server state, never the last click', () => {
  const byAction = (status: LoopStatusProjection | null) =>
    Object.fromEntries(controlsFor(status).map((c) => [c.action, c]));

  it('offers nothing when there is no run', () => {
    const controls = byAction(null);
    expect(controls.pause.enabled).toBe(false);
    expect(controls.resume.enabled).toBe(false);
    expect(controls.stop.enabled).toBe(false);
  });

  it('offers pause and stop while running, but not resume', () => {
    const controls = byAction(withState('running', 'active'));
    expect(controls.pause.enabled).toBe(true);
    expect(controls.stop.enabled).toBe(true);
    expect(controls.resume.enabled).toBe(false);
    expect(controls.resume.unavailableReason).toContain('not paused');
  });

  it('offers resume and stop while paused, but not pause', () => {
    const controls = byAction(withState('paused', 'resumable'));
    expect(controls.resume.enabled).toBe(true);
    expect(controls.stop.enabled).toBe(true);
    expect(controls.pause.enabled).toBe(false);
  });

  it('offers nothing on a finished run, whatever the ending', () => {
    for (const [state, cls] of [
      ['completed', 'successful_terminal'],
      ['stopped', 'unsuccessful_terminal'],
      ['iteration_exhausted', 'exhausted'],
      ['budget_exhausted', 'exhausted'],
      ['timed_out', 'unsuccessful_terminal'],
      ['failed', 'unsuccessful_terminal'],
    ] as const) {
      const controls = byAction(withState(state, cls, { finished: true }));
      for (const action of ['pause', 'resume', 'stop'] as const) {
        expect(controls[action].enabled, `${state}/${action}`).toBe(false);
        expect(controls[action].unavailableReason).toContain('finished run');
      }
    }
  });

  it('never offers Resume on a run held for recovery', () => {
    // Stage 2 auto-resumes nothing. An enabled Resume here would suggest the
    // uncertainty can be clicked away.
    const controls = byAction(withState('recovery_required', 'recovery'));
    expect(controls.resume.enabled).toBe(false);
    expect(controls.resume.unavailableReason).toContain('cannot be vouched for');
    // Stop is still allowed — ending an uncertain run is a legitimate choice.
    expect(controls.stop.enabled).toBe(true);
  });

  it('offers no second pause while a pause is in progress', () => {
    const controls = byAction(withState('pausing', 'stopping'));
    expect(controls.pause.enabled).toBe(false);
    expect(controls.resume.enabled).toBe(false);
  });

  it('offers nothing more while a stop is in progress', () => {
    const controls = byAction(withState('stopping', 'stopping'));
    expect(controls.stop.enabled).toBe(false);
  });
});

/* =========================================================== usage === */

describe('Unknown is rendered as Unknown', () => {
  it('never turns an unreported cost into a number', () => {
    const view = projectLoopRunView({
      status: {
        ...BASE,
        usage: { ...BASE.usage, knownSpendMicros: null, spendUnknown: true, tokensUsed: null, tokensUnknown: true },
      },
    });
    const spend = view.usageLines.find((l) => l.label === 'Spend');
    const tokens = view.usageLines.find((l) => l.label === 'Tokens');
    expect(spend?.value).toBe('Unknown');
    expect(spend?.unknown).toBe(true);
    expect(tokens?.value).toBe('Unknown');
    expect(JSON.stringify(view.usageLines)).not.toContain('0.0000');
  });

  it('never turns an uncounted provider call into a number either', () => {
    // Without this the row rendered `null / 100` and declared itself known —
    // the confident number nobody measured that this projection forbids.
    const view = projectLoopRunView({
      status: {
        ...BASE,
        usage: { ...BASE.usage, providerCallsUsed: null, providerCallsUnknown: true },
      },
    });
    const calls = view.usageLines.find((l) => l.label === 'Provider calls');
    expect(calls?.value).toBe('Unknown');
    expect(calls?.unknown).toBe(true);
    expect(JSON.stringify(view.usageLines)).not.toContain('null');
  });

  it('shows a known total when it is known', () => {
    const view = projectLoopRunView({ status: BASE });
    expect(view.usageLines.find((l) => l.label === 'Spend')?.value).toContain('0.0010');
    expect(view.usageLines.find((l) => l.label === 'Spend')?.unknown).toBe(false);
  });

  it('keeps requested and actual model in separate lines', () => {
    const view = projectLoopRunView({ status: BASE });
    expect(view.identityLines.find((l) => l.label === 'Model requested')?.value).toBe('asked-for');
    expect(view.identityLines.find((l) => l.label === 'Model actual')?.value).toBe('actually-ran');
  });

  it('shows Unknown for an unobserved model, never the requested one', () => {
    const view = projectLoopRunView({
      status: { ...BASE, identity: { ...BASE.identity!, actualModel: null, actualAgentId: null } },
    });
    const actual = view.identityLines.find((l) => l.label === 'Model actual');
    expect(actual?.value).toBe('Unknown');
    expect(actual?.unknown).toBe(true);
    expect(view.identityLines.find((l) => l.label === 'Agent')?.value).toBe('Unknown');
  });
});

/* ==================================================== blockers/failures */

describe('blockers and exhaustion are rendered as themselves', () => {
  it('surfaces a blocker and what to do about it', () => {
    const view = projectLoopRunView({
      status: {
        ...BASE,
        blocker: {
          reason: 'unavailable_role',
          detail: 'The coding_agent role is not connected.',
          requiredUserAction: 'Connect the Coding Agent.',
        },
      },
    });
    expect(view.blocker).toContain('not connected');
    expect(view.requiredUserAction).toContain('Connect');
  });

  it('never calls an exhausted run successful', () => {
    const view = projectLoopRunView({
      status: withState('token_exhausted', 'exhausted', { finished: true, succeeded: false }),
    });
    expect(view.succeeded).toBe(false);
    expect(view.finished).toBe(true);
    expect(view.headline).toBe('token exhausted');
  });

  it('marks a completed run as succeeded, and only that one', () => {
    const view = projectLoopRunView({
      status: withState('completed', 'successful_terminal', { finished: true, succeeded: true }),
    });
    expect(view.succeeded).toBe(true);
  });
});

/* ========================================================= restore === */

describe('a refresh restores from the server, not from a cache', () => {
  it('persists only the run id and loop id', () => {
    const point = restorePointFor(BASE);
    expect(point).toEqual({ runId: 'lpr_1', loopId: 'lpe_1' });
    // Nothing about state, usage or identity is carried across a refresh —
    // a cached projection would show a completed run as still running.
    expect(Object.keys(point ?? {})).toEqual(['runId', 'loopId']);
  });

  it('has nothing to restore when there is no run', () => {
    expect(restorePointFor(null)).toBeNull();
  });

  it('rejects a stored value that is not a restore point', () => {
    expect(isUsableRestorePoint({ runId: 'lpr_1', loopId: 'lpe_1' })).toBe(true);
    for (const bad of [null, 'lpr_1', {}, { runId: 'nope', loopId: 'lpe_1' }, { runId: 'lpr_1' }]) {
      expect(isUsableRestorePoint(bad)).toBe(false);
    }
  });
});

/* ======================================================= boundaries === */

describe('the run view stays a browser-safe leaf', () => {
  it('reads no clock, no storage and no network', () => {
    const source = readFileSync(join(__dirname, 'loop-run-view.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      /\bfetch\s*\(/, /localStorage/, /sessionStorage/, /setTimeout/, /setInterval/,
      /Date\.now\(\)/, /new Date\(\)/, /from\s+['"]node:/, /process\.env/,
    ]) {
      expect(forbidden.test(source), `the run view matches ${forbidden}`).toBe(false);
    }
  });
});
