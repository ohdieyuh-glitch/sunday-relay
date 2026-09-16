import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessMemoryState, createJuliusBrainAccessService, type JuliusBrainServiceCall } from './julius-brain-access';
import { createAccessFixtureIssuer } from './julius-brain-access-fixtures';
import { classifyJuliusBrainFailure, JuliusBrainAccessError } from './julius-brain-failure-model';
import { classifyJuliusBrainRetry } from './julius-brain-retry';
import {
  createJuliusBrainRateLimiter,
  createJuliusBrainRateLimitMemoryStore,
  JULIUS_BRAIN_DEFAULT_RATE_LIMITS,
  type JuliusBrainRateLimits,
} from './julius-brain-rate-limit';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';

const START = Date.parse('2026-09-15T12:00:00.000Z');
const MISSION = 'mission:julius-live-4';
const PROJECT = 'prj-julius-live-4';
const RUN = 'workflow:35000000000/1';

const LIMITS: JuliusBrainRateLimits = {
  READ: { ATTEMPT: { limit: 3, windowMs: 60_000 }, MISSION: { limit: 4, windowMs: 60_000 }, PRINCIPAL: { limit: 100, windowMs: 60_000 } },
  WRITE: { ATTEMPT: { limit: 2, windowMs: 60_000 } },
  ARTIFACT_READ: { ATTEMPT: { limit: 1, windowMs: 60_000 } },
  RECOVERY: { ATTEMPT: { limit: 1, windowMs: 600_000 } },
  ADMIN: { PRINCIPAL: { limit: 1, windowMs: 60_000 } },
};

function limiter(limits = LIMITS) {
  let now = START;
  const store = createJuliusBrainRateLimitMemoryStore();
  const rate = createJuliusBrainRateLimiter({ clock: { now: () => new Date(now).toISOString() }, limits, store });
  const ask = (request: { principalId?: string; brainRunId?: string; missionId?: string; operationClass?: 'READ' | 'WRITE' | 'ARTIFACT_READ' | 'RECOVERY' | 'ADMIN' } = {}) =>
    rate.admit({ principalId: request.principalId ?? 'julius:workflow:35000000000/1', brainRunId: request.brainRunId ?? RUN, missionId: request.missionId ?? MISSION, operationClass: request.operationClass ?? 'READ' });
  return { rate, store, ask, advance: (ms: number) => { now += ms; } };
}

describe('the Brain service abuse boundary', () => {
  it('one run cannot starve another: its own scope refuses it first, and other attempts, missions and classes are untouched', async () => {
    const w = limiter();
    for (let i = 0; i < 3; i += 1) expect((await w.ask()).ok, `read ${i}`).toBe(true);
    const refused = await w.ask();
    expect(refused).toEqual({ ok: false, reasonCode: 'rate_limited', scope: 'ATTEMPT', operationClass: 'READ', limit: 3, windowMs: 60_000, retryAfterMs: 60_000 });

    // Another attempt of the same mission still gets its own allowance, until the mission's own limit.
    expect((await w.ask({ brainRunId: 'workflow:35000000000/2' })).ok).toBe(true);
    const missionFull = await w.ask({ brainRunId: 'workflow:35000000000/3' });
    expect(missionFull).toMatchObject({ ok: false, scope: 'MISSION', limit: 4 });
    // A different mission is unaffected by either.
    expect((await w.ask({ missionId: 'mission:other', brainRunId: 'workflow:35000000111/1' })).ok).toBe(true);
    // And writes are not reads: the exhausted read allowance does not refuse a write.
    expect((await w.ask({ operationClass: 'WRITE' })).ok).toBe(true);
  });

  it('a refusal by a wider scope does not spend the narrower allowance it already took', async () => {
    const w = limiter({ ...LIMITS, READ: { ATTEMPT: { limit: 5, windowMs: 60_000 }, MISSION: { limit: 1, windowMs: 60_000 } } });
    expect((await w.ask()).ok).toBe(true);
    expect(await w.ask({ brainRunId: 'workflow:35000000000/2' })).toMatchObject({ ok: false, scope: 'MISSION' });
    // The second attempt's own counter was released, so once the mission window turns it has its full allowance.
    w.advance(60_000);
    for (let i = 0; i < 1; i += 1) expect((await w.ask({ brainRunId: 'workflow:35000000000/2' })).ok).toBe(true);
    expect((await w.ask()).ok).toBe(false); // the mission window allows one per minute, and attempt 2 took it
  });

  it('windows reset, and remaining counts are reported per scope', async () => {
    const w = limiter();
    expect(await w.ask()).toEqual({ ok: true, remaining: { ATTEMPT: 2, MISSION: 3, PRINCIPAL: 99 } });
    for (let i = 0; i < 2; i += 1) await w.ask();
    expect((await w.ask()).ok).toBe(false);
    w.advance(60_000);
    expect(await w.ask()).toEqual({ ok: true, remaining: { ATTEMPT: 2, MISSION: 3, PRINCIPAL: 99 } });
  });

  it('through the service: a throttled call is refused with its scope, mutates nothing, is audited safely, and is retryable once the window turns', async () => {
    const issuer = createAccessFixtureIssuer(START / 1000);
    let now = START;
    const state = createJuliusBrainAccessMemoryState();
    const rate = limiter({ ...LIMITS, READ: { ATTEMPT: { limit: 2, windowMs: 60_000 } } });
    const service = createJuliusBrainAccessService({
      brainId: 'brain:prj-julius-live-4', environment: 'production', binding: { databaseEnvironment: 'production' }, policy: issuer.policy,
      keys: issuer.keys, grants: () => [], clock: { now: () => new Date(now).toISOString() }, state, limits: rate.rate,
    });
    const fresh: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: RUN };
    const issued = await service.issueSession({ token: issuer.mint(), projectId: PROJECT, missionId: MISSION, stateMode: fresh });
    if (!issued.ok) throw new Error(issued.detail);
    const call = async (value: JuliusBrainServiceCall = { type: 'READ_CONTEXT' }) => {
      const result = await service.authorize({ sessionToken: issued.sessionToken, call: value });
      return result.ok ? 'allowed' : result.reasonCode;
    };
    expect([await call(), await call()]).toEqual(['allowed', 'allowed']);
    expect(await call()).toBe('rate_limited');
    // A write is a different class, and an artifact read a third: the read allowance did not spend them.
    expect(await call({ type: 'WRITE', drafts: [] })).toBe('allowed');
    expect(await call({ type: 'READ_ARTIFACT', contentHash: `sha256:${'a'.repeat(64)}` })).toBe('artifact_not_admitted');

    const audit = await state.readAudit();
    const throttled = audit.filter((event) => event.reasonCode === 'rate_limited');
    expect(throttled).toHaveLength(1);
    expect(throttled[0]).toMatchObject({ action: 'CALL_REFUSED', call: 'READ_CONTEXT', rateScope: 'ATTEMPT', brainRunId: RUN });
    // Nothing of the caller's material is in the audit or the counters.
    expect(JSON.stringify(audit)).not.toContain(issued.sessionToken);
    expect(rate.store.size()).toBeGreaterThan(0);

    // It is a throttle, not a denial: classified retryable, safe to retry, and admitted when the window turns.
    const failure = classifyJuliusBrainFailure(new JuliusBrainAccessError('rate_limited', 'try later'));
    expect(failure).toMatchObject({ failureClass: 'RATE_LIMITED', outcome: 'NOT_APPLIED', retryable: true });
    expect(classifyJuliusBrainRetry(failure)).toBe('SAFE_TO_RETRY');
    now += 60_000;
    rate.advance(60_000);
    expect(await call()).toBe('allowed');
  });

  it('the defaults leave room for a paid run, and a restart of an in-memory limiter starts its windows again — the stated cost of not making them durable', async () => {
    const paid = limiter(JULIUS_BRAIN_DEFAULT_RATE_LIMITS);
    for (let i = 0; i < 300; i += 1) expect((await paid.ask()).ok, `read ${i}`).toBe(true);
    for (let i = 0; i < 100; i += 1) expect((await paid.ask({ operationClass: 'WRITE' })).ok, `write ${i}`).toBe(true);
    for (let i = 0; i < 4; i += 1) expect((await paid.ask({ operationClass: 'RECOVERY' })).ok, `recovery ${i}`).toBe(true);
    expect(await paid.ask({ operationClass: 'RECOVERY' })).toMatchObject({ ok: false, scope: 'ATTEMPT', operationClass: 'RECOVERY' });

    const before = limiter();
    for (let i = 0; i < 3; i += 1) await before.ask();
    expect((await before.ask()).ok).toBe(false);
    const afterRestart = limiter(); // a new process, a new in-memory store
    expect((await afterRestart.ask()).ok).toBe(true);
  });
});
