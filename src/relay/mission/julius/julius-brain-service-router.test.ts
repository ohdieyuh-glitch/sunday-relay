import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessMemoryState, createJuliusBrainAccessService, type JuliusBrainCallFacts, type JuliusBrainRunSession } from './julius-brain-access';
import { createAccessFixtureIssuer } from './julius-brain-access-fixtures';
import { paidRunArchive } from './julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from './julius-brain-archive-import';
import { juliusPrincipal, type JuliusBrainDraft } from './julius-brain-contracts';
import { deriveJuliusBrainRunPreservation, juliusRunPreservedCheckpointLabel } from './julius-brain-preservation';
import { verifyJuliusBrainLedger } from './julius-brain-projection';
import { createJuliusBrainRateLimiter } from './julius-brain-rate-limit';
import { createJuliusBrainRequestMemoryLog } from './julius-brain-request-log';
import { JULIUS_BRAIN_OPERATION_SPECS, JULIUS_BRAIN_REQUEST_FORMAT, JULIUS_BRAIN_SERVICE_OPERATIONS, type JuliusBrainResponse, type JuliusBrainServiceOperation } from './julius-brain-service-api';
import { createJuliusBrainServiceRouter, type JuliusBrainServiceEffects } from './julius-brain-service-router';
import { createJuliusProjectBrainService } from './julius-brain-service';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from './julius-brain-store';

/**
 * THE SERVICE CONTRACT END TO END, over the real access contract, a real Brain,
 * and the real idempotency log. No transport, no database, no network.
 */

const START = Date.parse('2026-09-15T12:00:00.000Z');
const ISSUER = createAccessFixtureIssuer(START / 1000);
const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'workflow:35000000000/1';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const FRESH: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: RUN };

const draft = (key: string, patch: Partial<JuliusBrainDraft> = {}): JuliusBrainDraft => ({
  kind: 'TRACE', op: 'CREATE', entityId: `trace:${key}`, expectedVersion: 0, body: { traceClass: 'ACTION', summary: `service proof ${key}`, facts: {} }, links: [],
  scope: { missionId: MISSION, runId: RUN, taskId: null }, retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
  provenance: { source: 'run_observed', provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null }, idempotencyKey: `service:${key}`, occurredAt: null, ...patch,
});

async function world(options: { limits?: boolean } = {}) {
  let now = START;
  const clock = { now: () => new Date(now).toISOString() };
  const store = createJuliusBrainMemoryStore();
  const brains = createJuliusProjectBrainService({ store, clock });
  await brains.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };
  const state = createJuliusBrainAccessMemoryState();
  const access = createJuliusBrainAccessService({
    brainId: BRAIN, environment: 'production', binding: { databaseEnvironment: 'production' }, policy: ISSUER.policy, keys: ISSUER.keys,
    grants: () => [], clock, state, limits: options.limits === true ? createJuliusBrainRateLimiter({ clock, limits: { READ: { ATTEMPT: { limit: 2, windowMs: 60_000 } }, WRITE: {}, ARTIFACT_READ: {}, RECOVERY: {}, ADMIN: {} } }) : undefined,
  });
  const handle = async (session: JuliusBrainRunSession) => (await brains.open({ brainId: BRAIN, projectId: PROJECT, principal: session.principal }))!;
  const effects: JuliusBrainServiceEffects & { readonly calls: string[] } = {
    calls: [],
    async readContext({ session, role }) {
      effects.calls.push('readContext');
      const view = access.context(session, await readAllJuliusBrainEntities(store, BRAIN, PROJECT), { role: role as 'CODING_AGENT', budgetCharacters: 50_000 });
      return { items: view?.items.length ?? 0, characters: view?.characters ?? 0 };
    },
    async writeRecords({ session, drafts }) {
      effects.calls.push('writeRecords');
      const result = await (await handle(session)).commit(drafts as JuliusBrainDraft[]);
      if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
      return { appended: result.receipts.filter((receipt) => receipt.outcome === 'APPENDED').length, head: result.head.sequence };
    },
    async writeArtifact({ payload }) { effects.calls.push('writeArtifact'); return { contentHash: payload.contentHash, byteSize: payload.byteSize, storageRef: `cas://${String(payload.contentHash).slice(7)}` }; },
    async readArtifact({ contentHash }) { effects.calls.push('readArtifact'); return { contentHash, storageRef: `cas://${contentHash.slice(7)}` }; },
    async checkpoint({ session, label }) { effects.calls.push('checkpoint'); const result = await (await handle(session)).checkpoint(label); return { outcome: result.outcome }; },
    async seal({ session }) { effects.calls.push('seal'); return { brainRunId: session.brainRunId, sealed: true }; },
    async preservation({ session }) {
      effects.calls.push('preservation');
      const derived = deriveJuliusBrainRunPreservation({ brainId: BRAIN, brainRunId: session.brainRunId, records: await readAllJuliusBrainRecords(store, BRAIN, PROJECT), entities: await readAllJuliusBrainEntities(store, BRAIN, PROJECT) });
      return { status: derived.status, reasons: derived.reasons };
    },
    async recover({ session, archiveContentHash }) {
      effects.calls.push('recover');
      const result = await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: clock.now() });
      return { outcome: result.outcome, archiveContentHash, brainRunId: session.brainRunId };
    },
    async verify() { effects.calls.push('verify'); return { ok: verifyJuliusBrainLedger(BRAIN, await readAllJuliusBrainRecords(store, BRAIN, PROJECT)).ok }; },
    async facts(): Promise<JuliusBrainCallFacts> {
      const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
      return { entities, targets: new Map(entities.map((entity) => [entity.entityId, { runId: entity.scope.runId, missionId: entity.scope.missionId }])) };
    },
  };
  const requests = createJuliusBrainRequestMemoryLog();
  const router = createJuliusBrainServiceRouter({ access, effects, requests, clock, state });
  let counter = 0;
  const send = (operation: JuliusBrainServiceOperation, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    router.handle({ format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: extra.requestId as string ?? `req-${(counter += 1).toString().padStart(4, '0')}`, operation, payload, ...extra });
  const register = async (token = ISSUER.mint(), stateMode: JuliusBrainStateModePolicy = FRESH) => {
    const response = await send('REGISTER_ATTEMPT', { projectId: PROJECT, missionId: MISSION, stateMode }, { identityToken: token });
    if (response.outcome !== 'OK') throw new Error(`${response.reasonCode}: ${response.detail}`);
    return response;
  };
  return { store, state, router, effects, requests, send, register, access, advance: (ms: number) => { now += ms; }, clock };
}

describe('the Brain service request contract', () => {
  it('registers an attempt, then answers every operation with the context it derived — never one the request named', async () => {
    const w = await world();
    const registered = await w.register();
    const sessionToken = registered.sessionToken!;
    expect(registered.context).toMatchObject({ brainRunId: RUN, workflowRunId: '35000000000', workflowRunAttempt: 1, missionId: MISSION, projectId: PROJECT, environment: 'production', stateMode: 'FRESH' });

    const asked: JuliusBrainResponse[] = [
      await w.send('WRITE_RECORDS', { drafts: [draft('one')] }, { sessionToken }),
      await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken }),
      await w.send('WRITE_ARTIFACT', { contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 12, name: 'plan.md' }, { sessionToken }),
      await w.send('READ_ARTIFACT', { contentHash: `sha256:${'a'.repeat(64)}` }, { sessionToken }),
      await w.send('CHECKPOINT', { label: juliusRunPreservedCheckpointLabel(RUN) }, { sessionToken }),
      await w.send('SEAL', {}, { sessionToken }),
      await w.send('GET_PRESERVATION_STATUS', {}, { sessionToken }),
      await w.send('VERIFY', {}, { sessionToken }),
    ];
    expect(asked.map((response) => `${response.operation}:${response.outcome}`)).toEqual([
      'WRITE_RECORDS:OK', 'READ_CONTEXT:OK', 'WRITE_ARTIFACT:OK', 'READ_ARTIFACT:REFUSED', 'CHECKPOINT:OK', 'SEAL:OK', 'GET_PRESERVATION_STATUS:OK', 'VERIFY:OK',
    ]);
    // The artifact is not one this FRESH session's mode admits, and the refusal says exactly that.
    expect(asked[3]).toMatchObject({ reasonCode: 'artifact_not_admitted', result: null });
    for (const response of asked) expect(response.context).toMatchObject({ sessionId: registered.context!.sessionId, brainRunId: RUN, stateMode: 'FRESH' });
    expect(asked.find((response) => response.operation === 'VERIFY')!.result).toEqual({ ok: true });
    // No token ever comes back except the session at registration, and no answer carries a store.
    expect(JSON.stringify(asked)).not.toContain(sessionToken);
    expect(JSON.stringify(asked)).not.toMatch(/"principal"|"grant"|"readGrant"|SELECT /i);
  });

  it('refuses a request that is not this contract: unknown operations, missing credentials, and payloads that name what the service derives', async () => {
    const w = await world();
    const { sessionToken } = await w.register();
    const bad = async (body: Record<string, unknown>) => (await w.router.handle({ format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-bad-0001', payload: {}, ...body })) as JuliusBrainResponse;
    expect(await bad({ operation: 'DROP_EVERYTHING' })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'request_invalid' });
    expect(await bad({ operation: 'RAW_STORE' as JuliusBrainServiceOperation })).toMatchObject({ reasonCode: 'request_invalid' });
    expect(await bad({ operation: 'READ_CONTEXT', payload: { role: 'CODING_AGENT' } })).toMatchObject({ reasonCode: 'request_invalid', detail: expect.stringContaining('sessionToken: required') });
    expect(await bad({ operation: 'READ_CONTEXT', sessionToken, payload: { role: 'CODING_AGENT', stateMode: { mode: 'LEARNING' } } }))
      .toMatchObject({ reasonCode: 'request_invalid', detail: expect.stringContaining('payload.stateMode: the service derives this') });
    expect(await bad({ operation: 'WRITE_RECORDS', sessionToken, payload: { drafts: [draft('x')], principal: { kind: 'JULIUS', id: 'julius' } } }))
      .toMatchObject({ reasonCode: 'request_invalid', detail: expect.stringContaining('payload.principal') });
    expect(await bad({ operation: 'READ_CONTEXT', sessionToken, identityToken: ISSUER.mint(), payload: { role: 'CODING_AGENT' } }))
      .toMatchObject({ reasonCode: 'request_invalid', detail: expect.stringContaining('identityToken: only when registering') });
    expect(await bad({ operation: 'SEAL', sessionToken, payload: {}, extra: 'x' })).toMatchObject({ reasonCode: 'request_invalid', detail: expect.stringContaining('extra: not part of the contract') });
    expect(await w.router.handle('not a request')).toMatchObject({ outcome: 'REFUSED', reasonCode: 'request_invalid', requestId: 'unknown' });
    // Every specified operation is one the router can route, and only mutating ones are remembered.
    expect(Object.keys(JULIUS_BRAIN_OPERATION_SPECS).sort()).toEqual([...JULIUS_BRAIN_SERVICE_OPERATIONS].sort());
    expect(w.effects.calls).toEqual([]);
  });

  it('a repeated request id returns the first answer and does the work once; a different request under that id is refused', async () => {
    const w = await world();
    const { sessionToken } = await w.register();
    const first = await w.send('WRITE_RECORDS', { drafts: [draft('once')] }, { sessionToken, requestId: 'req-write-0001' });
    const again = await w.send('WRITE_RECORDS', { drafts: [draft('once')] }, { sessionToken, requestId: 'req-write-0001' });
    expect(first).toMatchObject({ outcome: 'OK', result: { appended: 1 } });
    expect(again).toMatchObject({ outcome: 'OK', result: { appended: 1 }, replayed: true });
    expect(w.effects.calls.filter((call) => call === 'writeRecords')).toHaveLength(1);
    expect((await readAllJuliusBrainRecords(w.store, BRAIN, PROJECT)).filter((record) => record.idempotencyKey === 'service:once')).toHaveLength(1);

    // The same id carrying something else is a client bug, and is refused rather than performed.
    const conflicting = await w.send('WRITE_RECORDS', { drafts: [draft('other')] }, { sessionToken, requestId: 'req-write-0001' });
    expect(conflicting).toMatchObject({ outcome: 'REFUSED', reasonCode: 'request_id_conflict' });
    expect(w.effects.calls.filter((call) => call === 'writeRecords')).toHaveLength(1);
    // Another request id for the same fact: the Brain's own idempotency decides, and adds nothing.
    const sameFact = await w.send('WRITE_RECORDS', { drafts: [draft('once')] }, { sessionToken, requestId: 'req-write-0002' });
    expect(sameFact).toMatchObject({ outcome: 'OK', result: { appended: 0 } });
    expect((await readAllJuliusBrainRecords(w.store, BRAIN, PROJECT)).filter((record) => record.idempotencyKey === 'service:once')).toHaveLength(1);

    // A read is not remembered: it is answered again, freshly.
    const read = await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken, requestId: 'req-read-0001' });
    const readAgain = await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken, requestId: 'req-read-0001' });
    expect([read.outcome, readAgain.outcome, readAgain.replayed]).toEqual(['OK', 'OK', undefined]);
  });

  it('two callers sending one request id at once: one does the work, the other is told it is in flight, and nothing happens twice', async () => {
    const w = await world();
    const { sessionToken } = await w.register();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = { ...w.effects, writeRecords: async (input: Parameters<JuliusBrainServiceEffects['writeRecords']>[0]) => { await gate; return w.effects.writeRecords(input); } };
    const router = createJuliusBrainServiceRouter({ access: w.access, effects: slow, requests: w.requests, clock: w.clock });
    const body = { format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-race-0001', operation: 'WRITE_RECORDS' as const, sessionToken, payload: { drafts: [draft('race')] } };
    const both = Promise.all([router.handle(body), router.handle(body)]);
    release();
    const [one, two] = await both;
    expect([one.outcome, two.outcome].sort()).toEqual(['OK', 'REFUSED']);
    expect([one, two].find((response) => response.outcome === 'REFUSED')).toMatchObject({ reasonCode: 'request_in_flight' });
    expect(w.effects.calls.filter((call) => call === 'writeRecords')).toHaveLength(1);
    // The one that was refused may simply ask again, and gets the stored answer.
    expect(await router.handle(body)).toMatchObject({ outcome: 'OK', replayed: true, result: { appended: 1 } });
  });

  it('a failed effect is not remembered as an answer: the retry may run, and a refusal is', async () => {
    const w = await world();
    const { sessionToken } = await w.register();
    let attempts = 0;
    const flaky = { ...w.effects, writeRecords: async (input: Parameters<JuliusBrainServiceEffects['writeRecords']>[0]) => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); return w.effects.writeRecords(input); } };
    const router = createJuliusBrainServiceRouter({ access: w.access, effects: flaky, requests: w.requests, clock: w.clock });
    const body = { format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-flaky-0001', operation: 'WRITE_RECORDS' as const, sessionToken, payload: { drafts: [draft('flaky')] } };
    expect(await router.handle(body)).toMatchObject({ outcome: 'FAILED', reasonCode: 'operation_failed', detail: 'DATABASE_UNAVAILABLE' });
    expect(await router.handle(body)).toMatchObject({ outcome: 'OK', result: { appended: 1 } });
    expect(attempts).toBe(2);
  });

  it('an admitted operation finishes after its session expires, says so, and is audited; the next request needs a live session', async () => {
    const w = await world();
    const { sessionToken, context } = await w.register();
    const slow = { ...w.effects, writeRecords: async (input: Parameters<JuliusBrainServiceEffects['writeRecords']>[0]) => { w.advance(ISSUER.policy.sessionTtlMs); return w.effects.writeRecords(input); } };
    const router = createJuliusBrainServiceRouter({ access: w.access, effects: slow, requests: w.requests, clock: w.clock, state: w.state });
    const finished = await router.handle({ format: JULIUS_BRAIN_REQUEST_FORMAT, requestId: 'req-long-0001', operation: 'WRITE_RECORDS', sessionToken, payload: { drafts: [draft('long')] } });
    expect(finished).toMatchObject({ outcome: 'OK', completedAfterExpiry: true, result: { appended: 1 } });
    const audit = await w.state.readAudit();
    expect(audit.at(-1)).toMatchObject({ action: 'CALL_ALLOWED', afterExpiry: true, sessionId: context!.sessionId, call: 'WRITE' });
    // Nothing further is admitted under it.
    expect(await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'session_expired' });
    expect(await w.send('WRITE_RECORDS', { drafts: [draft('after')] }, { sessionToken })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'session_expired' });
  });

  it('the abuse boundary answers through the contract, with a reason a client can act on', async () => {
    const w = await world({ limits: true });
    const { sessionToken } = await w.register();
    expect((await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken })).outcome).toBe('OK');
    expect((await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken })).outcome).toBe('OK');
    const throttled = await w.send('READ_CONTEXT', { role: 'CODING_AGENT' }, { sessionToken });
    expect(throttled).toMatchObject({ outcome: 'REFUSED', reasonCode: 'rate_limited', detail: expect.stringContaining('retry in') });
    expect(w.effects.calls.filter((call) => call === 'readContext')).toHaveLength(2);
  });
});
