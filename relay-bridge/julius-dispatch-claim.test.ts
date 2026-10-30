import { describe, expect, it } from 'vitest';

import { createMemoryAdmissionStore } from './julius-dispatch-admission';
import { providerRequestId } from './julius-dispatch';
import { createSharedSpendLedger, createSpentTagSpendLedger, preSpendDecision, spendRefusalCode } from './julius-dispatch-spend';
import { createDurableStandInSpendLedger } from './julius-dispatch-wiring-testkit';
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
    const ledger = createDurableStandInSpendLedger();
    const runId = 'run:aaaaaaaaaaaaaaaaaaaaaaaa';
    // J1's combined cap is $90 since the founder ruling of 2026-10-30: $60.000001 known plus this $30 is over it.
    await ledger.record(runId, fact(runId, 60_000_001));
    const read = await ledger.readPrior({ missionId: 'julius-inworld-data-1', projectId: 'proj-1' });
    const again = authorizeJuliusLiveSpend({
      namespace: 'julius-inworld-data-1', spendUsd: 30, repairCycles: 3, ledger: read,
    });
    expect(again.authorized).toBe(false);
    if (!again.authorized) expect(again.reasonCode).toBe('qualifying_pair_spend_exceeded');
  });
  it('a fact summarized by the runtime module, placed on the same port, is what a later read returns', async () => {
    const ledger = createDurableStandInSpendLedger();
    const prior = fact('run:bbbbbbbbbbbbbbbbbbbbbbbb', 10_000_000);
    await ledger.record(prior.taskId.slice(0, 28), prior);
    const summarized = summarizeJuliusPriorRunSpend('run:bbbbbbbbbbbbbbbbbbbbbbbb', [prior]);
    expect(summarized.spendVerified).toBe(true);
    expect(summarized.knownUsdMicros).toBe(10_000_000);
    const read = await ledger.readPrior({ missionId: 'julius-inworld-data-1', projectId: 'proj-1' });
    expect(read).toEqual({ readable: true, priorRuns: [summarized], durableRecord: 'PRESENT' });
    const admitted = authorizeJuliusLiveSpend({
      namespace: 'julius-inworld-data-1', spendUsd: 30, repairCycles: 3, ledger: read,
    });
    expect(admitted).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
  });
});

describe('J1 dispatch reads the durable spent-tag record', () => {
  const J1 = 'julius-inworld-data-1';
  const listing = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const decide = async (ledger: ReturnType<typeof createSpentTagSpendLedger> | ReturnType<typeof createSharedSpendLedger>, spendUsd = 30, repairCycles = 3) =>
    preSpendDecision({ markerNamespace: J1, spendUsd, repairCycles, ledger: await ledger.readPrior({ missionId: J1, projectId: 'proj-1' }) });

  it('authorizes $30 and 3 repairs when the tag listing is empty', async () => {
    const ledger = createSpentTagSpendLedger({ repository: 'ohdieyuh-glitch/sunday-relay', token: 'ghs_test_not_a_real_token', fetchImpl: listing(200, []) });
    expect(await decide(ledger)).toEqual({ applicable: true, authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
  });

  it('refuses $30.01 and a fourth repair cycle on that same empty record', async () => {
    const ledger = createSpentTagSpendLedger({ repository: 'ohdieyuh-glitch/sunday-relay', token: 'ghs_test_not_a_real_token', fetchImpl: listing(200, []) });
    expect(await decide(ledger, 30.01)).toMatchObject({ authorized: false, reasonCode: 'namespace_spend_ceiling_exceeded' });
    expect(await decide(ledger, 30, 4)).toMatchObject({ authorized: false, reasonCode: 'namespace_repair_ceiling_exceeded' });
  });

  it('refuses when the tag listing cannot be read, and that is a 503, not zero', async () => {
    const ledger = createSpentTagSpendLedger({ repository: 'ohdieyuh-glitch/sunday-relay', token: 'ghs_test_not_a_real_token', fetchImpl: listing(500, {}) });
    const decision = await decide(ledger);
    expect(decision).toMatchObject({ authorized: false, reasonCode: 'spend_ledger_unreadable' });
    expect(spendRefusalCode('spend_ledger_unreadable')).toEqual({ status: 503, code: 'julius_dispatch_spend_ledger_unreadable' });
  });

  it('refuses with no token, and does not call the listing', async () => {
    let called = false;
    const ledger = createSpentTagSpendLedger({ repository: 'ohdieyuh-glitch/sunday-relay', token: '', fetchImpl: (async () => { called = true; return new Response('[]'); }) as typeof fetch });
    expect(await decide(ledger)).toMatchObject({ authorized: false, reasonCode: 'spend_ledger_unreadable' });
    expect(called).toBe(false);
  });

  it('an in-process ledger is not the durable record, and its refusal has its own 503 code', async () => {
    expect(await decide(createSharedSpendLedger())).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_absent' });
    expect(spendRefusalCode('qualifying_pair_spend_absent')).toEqual({ status: 503, code: 'julius_dispatch_spend_record_absent' });
  });

  it('does not write: the reservation tag belongs to the paid workflow, and a settlement resolves without a request', async () => {
    let calls = 0;
    const ledger = createSpentTagSpendLedger({ repository: 'ohdieyuh-glitch/sunday-relay', token: 'ghs_test_not_a_real_token', fetchImpl: (async () => { calls += 1; return new Response('[]'); }) as typeof fetch });
    await expect(ledger.record('wlj_01234567-89ab-4cde-8fab-0123456789ab', {} as JuliusSettlementFact)).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  it('the production in-process ledger is never the durable record', async () => {
    expect((await createSharedSpendLedger().readPrior({ missionId: J1, projectId: 'proj-1' }))).toMatchObject({ durableRecord: 'ABSENT' });
    expect((await createDurableStandInSpendLedger().readPrior({ missionId: J1, projectId: 'proj-1' }))).toMatchObject({ durableRecord: 'PRESENT' });
  });
});
