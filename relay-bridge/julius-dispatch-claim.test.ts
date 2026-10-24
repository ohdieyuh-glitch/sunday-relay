import { describe, expect, it } from 'vitest';

import { createMemoryAdmissionStore } from './julius-dispatch-admission';
import { providerRequestId } from './julius-dispatch';
import { createSharedSpendLedger } from './julius-dispatch-spend';
import { authorizeJuliusLiveSpend, summarizeJuliusPriorRunSpend, type JuliusSettlementFact } from '../src/relay/mission/julius/julius-spend-ceiling';

/**
 * These cases are loaded by the dispatch suite's harness. Importing the harness
 * would run its tests twice, so the behaviours below call the same modules the
 * controller calls and the controller tests in julius-dispatch.test.ts cover the wire.
 */

const fact = (runId: string, usd: number): JuliusSettlementFact => ({
  taskId: `${runId}:coder`, role: 'CODING_AGENT', basis: 'PROVIDER_REPORTED', usdMicros: usd, estimatedUsdMicros: null, billingPath: 'API_BILLED',
});

describe('provider request id shape', () => {
  it('accepts an Anthropic request id, an xAI response id and an OpenAI response id', () => {
    expect(providerRequestId('req_01ABCDEFGHIJKLMNOP')).toBe('req_01ABCDEFGHIJKLMNOP');
    expect(providerRequestId('resp_architect_00112233445566')).toBe('resp_architect_00112233445566');
    expect(providerRequestId('chatcmpl-abcDEF12')).toBe('chatcmpl-abcDEF12');
  });
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['session id', 'sess-not-the-request'],
    ['session underscore', 'sess_not-the-request'],
    ['message id', 'msg_01ABCDEFGHIJKLMNOP'],
    ['too short', 'resp_a'],
    ['no prefix', 'req01ABCDEFGHIJKLMNOP'],
    ['credential shaped', 'req_tokenABCDEFGHIJ'],
  ])('rejects %s', (_name, value) => {
    expect(providerRequestId(value)).toBeNull();
  });
});

describe('claim store', () => {
  const record = {
    clientRunId: 'wlj_11111111-1111-4111-8111-111111111111',
    serverRunId: 'run:111111111111111111111111',
    idempotencyKey: 'key-0000001',
    missionId: 'mission-j1-frozen',
    state: 'admitted' as const,
  };
  it('claims once, replays the second claim, and a closed pair is terminal', async () => {
    const store = createMemoryAdmissionStore();
    store.admit(record);
    expect(await store.claim(record)).toEqual({ ok: true, dispatched: true, replayed: false, serverRunId: record.serverRunId });
    expect(store.status(record.clientRunId)).toBe('dispatched');
    expect(await store.claim(record)).toMatchObject({ ok: true, replayed: true });
    store.close(record.serverRunId);
    expect(await store.claim(record)).toEqual({ ok: false, reason: 'already_terminal' });
  });
  it('a different server id, key or mission is a mismatch, and an unknown id is not admitted', async () => {
    const store = createMemoryAdmissionStore();
    store.admit(record);
    expect(await store.claim({ ...record, serverRunId: 'run:222222222222222222222222' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(await store.claim({ ...record, idempotencyKey: 'key-0000002' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(await store.claim({ ...record, missionId: 'other' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(await store.read('run:000000000000000000000099')).toBeNull();
    expect(store.status(record.clientRunId)).toBe('admitted');
  });
  it('either id reads the same pair', async () => {
    const store = createMemoryAdmissionStore();
    store.admit(record);
    expect((await store.read(record.clientRunId))?.serverRunId).toBe(record.serverRunId);
    expect((await store.read(record.serverRunId))?.clientRunId).toBe(record.clientRunId);
  });
});

describe('one spend ledger, both directions', () => {
  it('a settlement the J1 port records is the spend authorizeJuliusLiveSpend refuses on', async () => {
    const ledger = createSharedSpendLedger();
    const runId = 'run:aaaaaaaaaaaaaaaaaaaaaaaa';
    await ledger.record(runId, fact(runId, 30_000_001));
    const read = await ledger.readPrior({ missionId: 'julius-inworld-data-1', projectId: 'proj-1' });
    const again = authorizeJuliusLiveSpend({
      namespace: 'julius-inworld-data-1', spendUsd: 30, repairCycles: 3, ledger: read,
    });
    expect(again.authorized).toBe(false);
    if (!again.authorized) expect(again.reasonCode).toBe('qualifying_pair_spend_exceeded');
  });
  it('a fact summarized by the runtime module, placed on the same port, is what a later read returns', async () => {
    const ledger = createSharedSpendLedger();
    const prior = fact('run:bbbbbbbbbbbbbbbbbbbbbbbb', 10_000_000);
    await ledger.record(prior.taskId.slice(0, 28), prior);
    const summarized = summarizeJuliusPriorRunSpend('run:bbbbbbbbbbbbbbbbbbbbbbbb', [prior]);
    expect(summarized.spendVerified).toBe(true);
    expect(summarized.knownUsdMicros).toBe(10_000_000);
    const read = await ledger.readPrior({ missionId: 'julius-inworld-data-1', projectId: 'proj-1' });
    expect(read).toEqual({ readable: true, priorRuns: [summarized] });
    const admitted = authorizeJuliusLiveSpend({
      namespace: 'julius-inworld-data-1', spendUsd: 30, repairCycles: 3, ledger: read,
    });
    expect(admitted).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
  });
});
