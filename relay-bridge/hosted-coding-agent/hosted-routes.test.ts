import { describe, expect, it } from 'vitest';
import {
  browserMayReadHostedRoute, handleHostedCodingRoute,
  type HostedCodingRunPort,
} from './hosted-routes';
import {
  newHostedRun, sanitizeHostedRun, settleHostedRun, isTerminal, NO_EVIDENCE,
  type HostedRunRecord,
} from './hosted-run-record';
import {
  createHostedRunStore, decideHostedStart, recoverHostedRun,
} from './hosted-run-store';
import { browserSessionMayCall } from '../browser-session/grants';

/**
 * The control plane. Every test is offline, and the permission boundary is
 * asserted from both sides: what an operator may do, and what a paired browser
 * must be refused.
 */

const NOW = '2026-08-02T12:00:00.000Z';
const TOKEN = 'operator-token';
const ENV = { RELAY_BRIDGE_API_TOKEN: TOKEN } as NodeJS.ProcessEnv;

const record = (over: Partial<HostedRunRecord> = {}): HostedRunRecord => ({
  ...newHostedRun({
    runId: 'run-1', missionId: 'm1', idempotencyKey: 'key-1',
    requestedModel: 'claude-sonnet-5', now: NOW,
  }),
  ...over,
});

const port = (over: Partial<HostedCodingRunPort> = {}): { p: HostedCodingRunPort; calls: string[] } => {
  const calls: string[] = [];
  const p: HostedCodingRunPort = {
    start: async () => { calls.push('start'); return { ok: true, record: record() }; },
    get: async () => { calls.push('get'); return record(); },
    inspect: async () => { calls.push('inspect'); return record(); },
    stop: async () => { calls.push('stop'); return { ok: true, record: record({ state: 'stopped' }) }; },
    retry: async () => { calls.push('retry'); return { ok: true, record: record({ runId: 'run-2', priorRunId: 'run-1' }) }; },
    ...over,
  };
  return { p, calls };
};

const call = (
  method: string, path: string,
  opts: { body?: unknown; auth?: string; as?: 'operator' | 'browser'; runs?: HostedCodingRunPort | null } = {},
) => handleHostedCodingRoute({
  method, path, authorization: opts.auth, body: opts.body, env: ENV, now: NOW,
  authorize: opts.as === undefined ? undefined : () => ({ kind: opts.as as 'operator' | 'browser' }),
}, opts.runs === undefined ? port().p : opts.runs);

describe('every hosted route is authenticated', () => {
  it('refuses an unauthenticated readiness probe', async () => {
    const r = await call('GET', '/hosted-coding/readiness');
    expect(r?.status).toBe(401);
  });

  it('refuses an unauthenticated start', async () => {
    const r = await call('POST', '/hosted-coding/start', { body: { missionId: 'm', idempotencyKey: 'k', authorized: true } });
    expect(r?.status).toBe(401);
  });

  it('returns null for a path that is not ours', async () => {
    expect(await call('GET', '/reviewer/readiness')).toBeNull();
  });
});

describe('readiness is free and makes no provider request', () => {
  it('answers an operator with evidence and never claims a verified connection', async () => {
    const r = await call('GET', '/hosted-coding/readiness', { auth: `Bearer ${TOKEN}` });
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: Record<string, unknown> }).data;
    // A credential being present is not a credential being valid.
    expect(data.connectionVerified).toBe(false);
    expect(data.modelVerified).toBe(false);
  });

  it('is readable by a paired browser session', async () => {
    const r = await call('GET', '/hosted-coding/readiness', { as: 'browser' });
    expect(r?.status).toBe(200);
  });

  it('leaks no credential material to the browser', async () => {
    const r = await call('GET', '/hosted-coding/readiness', { as: 'browser' });
    expect(JSON.stringify(r?.body)).not.toMatch(/sk-ant|Bearer|RELAY_BRIDGE_API_TOKEN/);
  });
});

describe('a browser session may read, and may never spend', () => {
  it('may read status and inspect', async () => {
    expect((await call('GET', '/hosted-coding/status/run-1', { as: 'browser' }))?.status).toBe(200);
    expect((await call('GET', '/hosted-coding/inspect/run-1', { as: 'browser' }))?.status).toBe(200);
  });

  it('is refused start, stop and retry with 403', async () => {
    for (const [method, path, body] of [
      ['POST', '/hosted-coding/start', { missionId: 'm', idempotencyKey: 'k', authorized: true }],
      ['POST', '/hosted-coding/stop/run-1', {}],
      ['POST', '/hosted-coding/retry', { priorRunId: 'run-1', idempotencyKey: 'k2', authorized: true }],
    ] as const) {
      const r = await call(method, path, { as: 'browser', body });
      expect(r?.status, `${method} ${path}`).toBe(403);
      expect(JSON.stringify(r?.body)).toContain('requires an operator');
    }
  });

  it('never reaches the run engine on a refused call', async () => {
    const { p, calls } = port();
    await handleHostedCodingRoute({
      method: 'POST', path: '/hosted-coding/start',
      body: { missionId: 'm', idempotencyKey: 'k', authorized: true },
      authorization: undefined, env: ENV, now: NOW,
      authorize: () => ({ kind: 'browser' }),
    }, p);
    expect(calls).toEqual([]);
  });

  it('gets the SANITIZED record from inspect, not the full one', async () => {
    const full = record({ evidence: { ...NO_EVIDENCE, preservedWorkspacePath: '/data/secret-path' } });
    const r = await call('GET', '/hosted-coding/inspect/run-1', {
      as: 'browser', runs: port({ inspect: async () => full }).p,
    });
    // A workspace path is host layout and is not a browser's business.
    expect(JSON.stringify(r?.body)).not.toContain('/data/secret-path');
  });

  it('the shared authorizer agrees with the route-level allowlist', async () => {
    // Both gates must permit the same set, or a browser gets 403 upstream.
    for (const p of ['/hosted-coding/readiness', '/hosted-coding/status/x', '/hosted-coding/inspect/x']) {
      expect(browserSessionMayCall('GET', p), p).toBe(true);
      expect(browserMayReadHostedRoute('GET', p), p).toBe(true);
    }
    for (const p of ['/hosted-coding/start', '/hosted-coding/stop/x', '/hosted-coding/retry']) {
      expect(browserSessionMayCall('POST', p), p).toBe(false);
      expect(browserMayReadHostedRoute('POST', p), p).toBe(false);
    }
  });
});

describe('reaching a route is not consent to spend', () => {
  it('refuses an operator start without explicit authorization', async () => {
    const r = await call('POST', '/hosted-coding/start', {
      auth: `Bearer ${TOKEN}`, body: { missionId: 'm', idempotencyKey: 'k' },
    });
    expect(r?.status).toBe(403);
    expect(JSON.stringify(r?.body)).toContain('explicit authorization');
  });

  it('requires FRESH authorization for a retry', async () => {
    const r = await call('POST', '/hosted-coding/retry', {
      auth: `Bearer ${TOKEN}`, body: { priorRunId: 'run-1', idempotencyKey: 'k2' },
    });
    expect(r?.status).toBe(403);
    expect(JSON.stringify(r?.body)).toContain('fresh explicit authorization');
  });

  it('starts for an authorized operator', async () => {
    const r = await call('POST', '/hosted-coding/start', {
      auth: `Bearer ${TOKEN}`, body: { missionId: 'm', idempotencyKey: 'k', authorized: true },
    });
    expect(r?.status).toBe(200);
  });

  it('validates required fields before authorizing anything', async () => {
    const r = await call('POST', '/hosted-coding/start', {
      auth: `Bearer ${TOKEN}`, body: { authorized: true },
    });
    expect(r?.status).toBe(422);
  });
});

describe('without a run engine the bridge says so', () => {
  it('answers readiness anyway, because readiness is free', async () => {
    expect((await call('GET', '/hosted-coding/readiness', { auth: `Bearer ${TOKEN}`, runs: null }))?.status).toBe(200);
  });

  it('refuses lifecycle routes with 503 rather than inventing a run', async () => {
    const r = await call('GET', '/hosted-coding/status/run-1', { auth: `Bearer ${TOKEN}`, runs: null });
    expect(r?.status).toBe(503);
    expect(JSON.stringify(r?.body)).toContain('hosted_coding_not_ready');
  });

  /**
   * AND SAYS WHY TRUTHFULLY. The hosted agent is not missing — `mission.ts`
   * constructs its invoker and the coding leg runs it. What is missing is a
   * prompt and a workspace, which this route carries neither of. Saying the
   * engine is "not configured" would send an operator after a variable that
   * was never written.
   */
  it('does not describe a configuration step that does not exist', async () => {
    const r = await call('POST', '/hosted-coding/start', {
      auth: `Bearer ${TOKEN}`, runs: null, body: { missionId: 'm', idempotencyKey: 'k' },
    });
    const message = String((r?.body as { error?: unknown }).error ?? '');
    expect(message).toContain('No configuration enables this route');
    expect(message).toMatch(/prompt and a workspace/);
    expect(message).not.toMatch(/not configured/i);
  });
});

describe('duplicate execution is prevented at the store', () => {
  const store = () => createHostedRunStore(null);

  it('returns the existing run for a repeated idempotency key', () => {
    const s = store();
    const first = decideHostedStart({ store: s, runId: 'r1', missionId: 'm', idempotencyKey: 'k', requestedModel: null, now: NOW });
    expect(first.kind).toBe('start');
    s.write(first.record as HostedRunRecord);

    // A double-click, a proxy replay or a client timeout must not bill twice.
    const again = decideHostedStart({ store: s, runId: 'r2', missionId: 'm', idempotencyKey: 'k', requestedModel: null, now: NOW });
    expect(again.kind).toBe('duplicate');
    expect(again.record?.runId).toBe('r1');
  });

  it('refuses a second concurrent run', () => {
    const s = store();
    const first = decideHostedStart({ store: s, runId: 'r1', missionId: 'm', idempotencyKey: 'k1', requestedModel: null, now: NOW });
    s.write({ ...(first.record as HostedRunRecord), state: 'running' });
    const second = decideHostedStart({ store: s, runId: 'r2', missionId: 'm', idempotencyKey: 'k2', requestedModel: null, now: NOW });
    expect(second.kind).toBe('refused');
    expect(second.status).toBe(409);
  });

  it('allows a new run once the previous one is terminal', () => {
    const s = store();
    const first = decideHostedStart({ store: s, runId: 'r1', missionId: 'm', idempotencyKey: 'k1', requestedModel: null, now: NOW });
    s.write({ ...(first.record as HostedRunRecord), state: 'completed' });
    expect(decideHostedStart({ store: s, runId: 'r2', missionId: 'm', idempotencyKey: 'k2', requestedModel: null, now: NOW }).kind)
      .toBe('start');
  });

  it('says so when storage is volatile rather than pretending it is durable', () => {
    expect(store().durable).toBe(false);
    expect(store().locationLabel).toContain('no durable volume');
  });
});

describe('an SDK success is not a verdict', () => {
  const settle = (sdk: boolean, validation: boolean) => settleHostedRun({
    record: record(), sdkCompleted: sdk, validationPassed: validation,
    actualRuntime: 'Claude Agent SDK', actualModel: 'claude-sonnet-5-20260114',
    runtimeVersion: '2.1.220', usageInputTokens: 900, usageOutputTokens: 100,
    reportedCostUsd: 0.01, evidence: NO_EVIDENCE, failureReason: null, now: NOW,
  });

  it('completes only when the SDK finished AND Relay validated', () => {
    expect(settle(true, true).state).toBe('completed');
  });

  it('fails a run whose SDK succeeded but whose validation did not', () => {
    const r = settle(true, false);
    expect(r.state).toBe('failed');
    expect(r.failureReason).toContain('validation did not pass');
    // The two facts stay separate in the record.
    expect(r.sdkCompleted).toBe(true);
    expect(r.validationPassed).toBe(false);
  });

  it('never echoes the requested model as the verified one', () => {
    const r = settle(true, true);
    expect(r.requestedModel).toBe('claude-sonnet-5');
    expect(r.actualModel).toBe('claude-sonnet-5-20260114');
    expect(r.actualModel).not.toBe(r.requestedModel);
  });

  it('renders Unknown for a model the runtime never named', () => {
    const s = sanitizeHostedRun({ ...record(), actualModel: null });
    expect(s.actualModel).toBe('Unknown');
    expect(s.requestedModel).toBe('claude-sonnet-5');
  });

  it('renders Unknown usage and cost rather than zero', () => {
    const s = sanitizeHostedRun(record());
    expect(s.usageLabel).toBe('Unknown');
    expect(s.costLabel).toBe('Unknown');
  });
});

describe('recovery after a restart', () => {
  it('fails an unconfirmable in-flight run and never replays it', () => {
    const recovered = recoverHostedRun(record({ state: 'running' }), NOW);
    expect(recovered.state).toBe('failed');
    expect(recovered.failureReason).toContain('cannot confirm');
    expect(recovered.failureReason).toContain('no new run was started');
  });

  it('leaves a finished run exactly as it was', () => {
    const done = record({ state: 'completed', validationPassed: true });
    expect(recoverHostedRun(done, NOW)).toEqual(done);
  });

  it('treats every non-active state as terminal', () => {
    for (const s of ['completed', 'failed', 'stopped', 'timed_out'] as const) {
      expect(isTerminal(s), s).toBe(true);
    }
    for (const s of ['ready', 'running'] as const) expect(isTerminal(s), s).toBe(false);
  });
});
