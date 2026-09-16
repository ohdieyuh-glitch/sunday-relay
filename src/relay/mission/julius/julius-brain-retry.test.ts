import { describe, expect, it } from 'vitest';

import { classifyJuliusBrainFailure, decideJuliusBrainFailure, JuliusBrainAccessError, type JuliusBrainFailure } from './julius-brain-failure-model';
import {
  classifyJuliusBrainRetry,
  createJuliusBrainRetryRunner,
  JuliusBrainCircuitOpenError,
  JuliusBrainReconciliationRequiredError,
  type JuliusBrainRetryAttemptReport,
} from './julius-brain-retry';

/**
 * THE RETRY CONTRACT, ON DETERMINISTIC TIME. Nothing here sleeps: the clock is a
 * number and `sleep` only records what the policy asked for.
 */

const START = Date.parse('2026-09-15T12:00:00.000Z');
const coded = (code: string, message = 'failed') => Object.assign(new Error(message), { code });
const unavailable = () => coded('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5442');
const lostAfterSend = () => coded('ECONNRESET', 'read ECONNRESET');
const timeout = () => coded('57014', 'canceling statement due to statement timeout');

function runner(options: { attempts?: number; failureThreshold?: number; openMs?: number } = {}) {
  let now = START;
  const slept: number[] = [];
  const reports: JuliusBrainRetryAttemptReport[] = [];
  const retry = createJuliusBrainRetryRunner({
    clock: { now: () => new Date(now).toISOString() },
    sleep: async (ms) => { slept.push(ms); now += ms; },
    random: () => 0.5,
    attempts: options.attempts ?? 3,
    baseDelayMs: 200,
    maxDelayMs: 5_000,
    breaker: { failureThreshold: options.failureThreshold ?? 3, openMs: options.openMs ?? 30_000 },
    onAttempt: (report) => reports.push(report),
  });
  return { retry, slept, reports, advance: (ms: number) => { now += ms; }, at: () => now };
}

describe('the Brain retry and circuit-breaker contract', () => {
  it('classifies every operation: safe, reconcile-first, or never', () => {
    const cases: [unknown, string][] = [
      [unavailable(), 'SAFE_TO_RETRY'],
      [timeout(), 'SAFE_TO_RETRY'],
      [coded('25006', 'read-only transaction'), 'SAFE_TO_RETRY'],
      [coded('40P01', 'deadlock detected'), 'SAFE_TO_RETRY'],
      [lostAfterSend(), 'RECONCILE_BEFORE_RETRY'],
      [coded('57P01', 'terminating connection due to administrator command'), 'RECONCILE_BEFORE_RETRY'],
      [coded('SELF_SIGNED_CERT_IN_CHAIN'), 'DO_NOT_RETRY'],
      [new Error('julius_brain_database_migrations_pending:006_julius_brain_access'), 'DO_NOT_RETRY'],
      [new Error('julius_brain_database_newer_than_code:007_future'), 'DO_NOT_RETRY'],
      [new Error('julius_brain_database_environment_mismatch:production'), 'DO_NOT_RETRY'],
      [new JuliusBrainAccessError('state_mode_not_authorized', 'no grant'), 'DO_NOT_RETRY'],
      [new Error('something nobody anticipated'), 'DO_NOT_RETRY'],
    ];
    for (const [error, expected] of cases) expect(classifyJuliusBrainRetry(classifyJuliusBrainFailure(error)), String((error as Error).message)).toBe(expected);
    // A schema the code does not know is configuration, and it is alerted rather than retried.
    expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'OPEN', failure: classifyJuliusBrainFailure(new Error('julius_brain_database_migrations_pending:006')) }))
      .toMatchObject({ retry: 'NONE', alert: 'CONFIGURATION', then: 'PROCEED_WITHOUT_BRAIN' });
  });

  it('a read that never answered is retried with bounded, jittered backoff, and succeeds', async () => {
    const w = runner({ attempts: 4 });
    let calls = 0;
    const value = await w.retry.run({
      operation: 'READ_CONTEXT',
      attempt: async () => { calls += 1; if (calls < 3) throw unavailable(); return 'context'; },
    });
    expect([value, calls]).toEqual(['context', 3]);
    expect(w.slept).toEqual([100, 200]); // base 200 and 400, halved by the injected jitter
    expect(w.reports.map((report) => report.action)).toEqual(['RETRY', 'RETRY']);
    expect(w.retry.breaker()).toMatchObject({ state: 'CLOSED', consecutiveFailures: 0 });
  });

  it('a transaction the server rolled back is safe to send again; a lost response is not, until the Brain says what happened', async () => {
    // Rolled back: retried without asking anyone.
    const rolled = runner();
    let attempts = 0;
    expect(await rolled.retry.run({ operation: 'WRITE', attempt: async () => { attempts += 1; if (attempts === 1) throw timeout(); return 'committed'; } })).toBe('committed');
    expect(attempts).toBe(2);

    // Lost after the write may have landed, and it had: the Brain says so, and nothing is sent again.
    const applied = runner();
    let sends = 0;
    const found = await applied.retry.run({
      operation: 'WRITE',
      attempt: async () => { sends += 1; throw lostAfterSend(); },
      reconcile: async () => ({ applied: true, value: 'already committed' }),
    });
    expect([found, sends]).toEqual(['already committed', 1]);
    expect(applied.reports.map((report) => report.action)).toEqual(['RECONCILED']);

    // Lost, and it had not landed: exactly one more send.
    const notApplied = runner();
    let tries = 0;
    expect(await notApplied.retry.run({
      operation: 'WRITE',
      attempt: async () => { tries += 1; if (tries === 1) throw lostAfterSend(); return 'committed now'; },
      reconcile: async () => ({ applied: false }),
    })).toBe('committed now');
    expect(tries).toBe(2);

    // Lost, with no way to find out: raised, never sent blind.
    const blind = runner();
    let blindSends = 0;
    await expect(blind.retry.run({ operation: 'WRITE', attempt: async () => { blindSends += 1; throw lostAfterSend(); } })).rejects.toBeInstanceOf(JuliusBrainReconciliationRequiredError);
    expect(blindSends).toBe(1);
  });

  it('repeated infrastructure failure opens the breaker; a probe closes it; a failed probe re-opens it', async () => {
    const w = runner({ attempts: 1, failureThreshold: 3, openMs: 30_000 });
    for (let i = 0; i < 3; i += 1) await expect(w.retry.run({ operation: 'READ_CONTEXT', attempt: async () => { throw unavailable(); } })).rejects.toThrow('ECONNREFUSED');
    expect(w.retry.breaker()).toMatchObject({ state: 'OPEN', consecutiveFailures: 3 });

    // Open: the call fails fast, without touching the Brain.
    let touched = 0;
    const fast = await w.retry.run({ operation: 'READ_CONTEXT', attempt: async () => { touched += 1; return 'x'; } }).catch((error: unknown) => error);
    expect(fast).toBeInstanceOf(JuliusBrainCircuitOpenError);
    expect(touched).toBe(0);
    expect(classifyJuliusBrainFailure(fast)).toEqual({ failureClass: 'SERVICE_UNAVAILABLE', outcome: 'NOT_APPLIED', retryable: true, code: 'julius_brain_circuit_open' });

    // Half-open after the window: a failed probe re-opens it for a full window.
    w.advance(30_000);
    await expect(w.retry.run({ operation: 'READ_CONTEXT', attempt: async () => { throw unavailable(); } })).rejects.toThrow('ECONNREFUSED');
    expect(w.retry.breaker().state).toBe('OPEN');
    w.advance(29_000);
    expect(w.retry.breaker().state).toBe('OPEN');
    // A successful probe closes it.
    w.advance(1_000);
    expect(await w.retry.run({ operation: 'READ_CONTEXT', attempt: async () => 'back' })).toBe('back');
    expect(w.retry.breaker()).toMatchObject({ state: 'CLOSED', consecutiveFailures: 0, openedAt: null });
  });

  it('authorization denials and configuration failures never open the breaker', async () => {
    const w = runner({ attempts: 1, failureThreshold: 2 });
    for (const error of [
      new JuliusBrainAccessError('other_run', 'another run'),
      new JuliusBrainAccessError('state_mode_is_bound', 'bound'),
      new JuliusBrainAccessError('artifact_not_admitted', 'foreign'),
      new JuliusBrainAccessError('session_expired', 'expired'),
      coded('SELF_SIGNED_CERT_IN_CHAIN'),
      new Error('julius_brain_database_migrations_pending:006'),
    ]) {
      await expect(w.retry.run({ operation: 'WRITE', attempt: async () => { throw error; } })).rejects.toThrow();
    }
    expect(w.retry.breaker()).toEqual({ state: 'CLOSED', consecutiveFailures: 0, openedAt: null });
    // And an environment or TLS failure fails closed on the first attempt: no waiting, no second send.
    let sends = 0;
    await expect(w.retry.run({ operation: 'OPEN', attempt: async () => { sends += 1; throw coded('ERR_TLS_CERT_ALTNAME_INVALID'); } })).rejects.toThrow();
    expect([sends, w.slept]).toEqual([1, []]);
  });

  it('an open breaker is a Brain that cannot be reached: FRESH proceeds unpreserved, a run that needs prior state refuses, and nothing is called preserved', async () => {
    const w = runner({ attempts: 1, failureThreshold: 1 });
    await expect(w.retry.run({ operation: 'SEAL', attempt: async () => { throw unavailable(); } })).rejects.toThrow();
    const open = await w.retry.run({ operation: 'SEAL', attempt: async () => 'x' }).catch((error: unknown) => error);
    const failure: JuliusBrainFailure = classifyJuliusBrainFailure(open);
    expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'OPEN', failure })).toMatchObject({ then: 'PROCEED_WITHOUT_BRAIN', preservation: 'NOT_PRESERVED', memoryFallback: 'NONE' });
    expect(decideJuliusBrainFailure({ mode: 'CONTINUATION', phase: 'OPEN', failure }).then).toBe('REFUSE_RUN');
    expect(decideJuliusBrainFailure({ mode: 'LEARNING', phase: 'READ_CONTEXT', failure }).then).toBe('REFUSE_DISPATCH');
    expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'SEAL', failure }).preservation).toBe('NOT_PRESERVED');
  });
});
