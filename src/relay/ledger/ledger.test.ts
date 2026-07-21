import { beforeEach, describe, expect, it } from 'vitest';
import { appendEvent, currentLedgerVersion, listEvents } from './ledger';
import { projectLedger } from './projection';
import { promoteClaim, recordClaim, rejectClaim } from './promotion';
import { createInMemoryRelayStores, type InMemoryRelayStores } from '../storage/memory';
import { deterministicIds, fixedId, makeReport, makeVerification, testClock } from '../testing/factories';
import { parseReport, type EventDraft } from '../protocol/envelopes';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import type { EventId, ProjectId } from '../protocol/ids';

const projectId = fixedId('prj');

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    at: '2026-07-21T22:00:00.000Z',
    projectId,
    source: 'relay-core',
    kind: 'run.created',
    provenance: 'simulated',
    classification: 'historical',
    safeSummary: 'test event',
    payload: {},
    ...overrides,
  };
}

let stores: InMemoryRelayStores;
let ids: ReturnType<typeof deterministicIds>;
const clock = testClock();

beforeEach(() => {
  stores = createInMemoryRelayStores({ acknowledgeVolatile: true });
  ids = deterministicIds();
});

const ingest = (report: Record<string, unknown>) => {
  const parsed = parseReport(report);
  if (!parsed.ok) throw new Error(parsed.error.details?.join('; ') ?? parsed.error.message);
  return parsed.value;
};

describe('G/H — append-only ledger with monotonic versions', () => {
  it('starts at version 0, advances by exactly one per append, assigns gap-free sequences', () => {
    expect(currentLedgerVersion(stores.events, projectId)).toBe(0);
    for (let i = 1; i <= 3; i++) {
      const result = appendEvent(stores.events, { draft: draft(), eventId: ids.next('evt') as EventId });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.sequence).toBe(i);
      expect(currentLedgerVersion(stores.events, projectId)).toBe(i);
    }
  });

  it('rejects duplicate event ids, duplicate sequences, and gaps at the store', () => {
    const first = appendEvent(stores.events, { draft: draft(), eventId: 'evt_dup' as EventId });
    expect(first.ok).toBe(true);
    const dupId = appendEvent(stores.events, { draft: draft(), eventId: 'evt_dup' as EventId });
    expect(dupId.ok).toBe(false);
    if (!dupId.ok) expect(dupId.error.code).toBe('duplicate-event');

    const dupSeq = stores.events.append({ ...(first.ok ? first.value : (undefined as never)), eventId: 'evt_other' as EventId }, undefined);
    expect(dupSeq.ok).toBe(false);
    if (!dupSeq.ok) expect(dupSeq.error.code).toBe('sequence-violation');

    const gap = stores.events.append(
      { ...(first.ok ? first.value : (undefined as never)), eventId: 'evt_gap' as EventId, sequence: 5 },
      undefined,
    );
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.error.code).toBe('sequence-violation');
  });

  it('stored events are immutable and wrong-run/other-project events do not interleave sequences', () => {
    const result = appendEvent(stores.events, { draft: draft(), eventId: ids.next('evt') as EventId });
    if (!result.ok) throw new Error('append failed');
    expect(() => {
      (result.value as { safeSummary: string }).safeSummary = 'tampered';
    }).toThrow();

    const otherProject = 'prj_other' as ProjectId;
    const other = appendEvent(stores.events, { draft: draft({ projectId: otherProject }), eventId: ids.next('evt') as EventId });
    expect(other.ok && other.value.sequence).toBe(1); // per-project ordering
  });

  it('idempotency: same key + same payload returns the original; conflicting payload errors; no duplicate append', () => {
    const key = 'idem-1';
    const a = appendEvent(stores.events, { draft: draft(), eventId: ids.next('evt') as EventId, idempotencyKey: key });
    const b = appendEvent(stores.events, { draft: draft(), eventId: ids.next('evt') as EventId, idempotencyKey: key });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.value.eventId).toBe(a.value.eventId);
    expect(listEvents(stores.events, projectId)).toHaveLength(1);

    const conflicting = appendEvent(stores.events, {
      draft: draft({ payload: { different: true } }),
      eventId: ids.next('evt') as EventId,
      idempotencyKey: key,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) expect(conflicting.error.code).toBe('duplicate-idempotency-key');
  });

  it('replay determinism: projection over listed events equals projection over a JSON round-trip', () => {
    appendEvent(stores.events, { draft: draft({ kind: 'run.created', runId: fixedId('run'), payload: { objective: 'o' } }), eventId: ids.next('evt') as EventId });
    appendEvent(stores.events, { draft: draft({ kind: 'run.started', runId: fixedId('run') }), eventId: ids.next('evt') as EventId });
    const events = listEvents(stores.events, projectId);
    const replayed = JSON.parse(JSON.stringify(events));
    expect(projectLedger(replayed)).toEqual(projectLedger(events));
    expect(projectLedger(events).ledgerVersion).toBe(2);
    expect(projectLedger(events).runStatuses[fixedId('run')]).toBe('active');
  });
});

describe('H/J/K — claims, promotion, and canonical state', () => {
  const implReport = () => ingest(makeReport('implementation', { summary: 'did work', changedFiles: ['a.ts'] }));

  it('a schema-valid report is recorded as an UNVERIFIED claim and canonical state does not move', () => {
    const recorded = recordClaim({ store: stores.events, ids, report: implReport(), at: clock.now() });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.event.classification).toBe('unverified-claim');
    const projection = projectLedger(listEvents(stores.events, projectId));
    expect(projection.claims[recorded.value.claimId].status).toBe('recorded');
    expect(projection.canonical.promotedClaimIds).toHaveLength(0);
    expect(projection.canonical.verifiedEvidenceRefs).toHaveLength(0);
  });

  it('promotion requires passing Relay-produced verification; failed verification cannot promote', () => {
    const recorded = recordClaim({ store: stores.events, ids, report: implReport(), at: clock.now() });
    if (!recorded.ok) return;
    const denied = promoteClaim({
      store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(),
      verification: makeVerification('failed'),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('evidence-required');

    const promoted = promoteClaim({
      store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(),
      verification: makeVerification('passed'),
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.value.classification).toBe('canonical');
    const projection = projectLedger(listEvents(stores.events, projectId));
    expect(projection.claims[recorded.value.claimId].status).toBe('promoted');
    expect(projection.canonical.promotedClaimIds).toEqual([recorded.value.claimId]);
  });

  it('promotion advances the ledger exactly once and duplicate promotion is idempotent per key', () => {
    const recorded = recordClaim({ store: stores.events, ids, report: implReport(), at: clock.now() });
    if (!recorded.ok) return;
    const before = currentLedgerVersion(stores.events, projectId);
    const promote = (key: string) =>
      promoteClaim({
        store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(),
        verification: makeVerification('passed'), idempotencyKey: key,
      });
    const first = promote('promo-1');
    expect(first.ok).toBe(true);
    expect(currentLedgerVersion(stores.events, projectId)).toBe(before + 1);
    const replay = promote('promo-1');
    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) expect(replay.value.eventId).toBe(first.value.eventId);
    expect(currentLedgerVersion(stores.events, projectId)).toBe(before + 1); // exactly once
    // A NEW promotion attempt without the key is refused: already promoted.
    const again = promoteClaim({
      store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(),
      verification: makeVerification('passed'),
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('claim-promotion');
  });

  it('rejected claims stay historical and cannot later be promoted', () => {
    const recorded = recordClaim({ store: stores.events, ids, report: implReport(), at: clock.now() });
    if (!recorded.ok) return;
    const rejected = rejectClaim({ store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(), reason: 'unsupported' });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(rejected.value.classification).toBe('historical');
    const projection = projectLedger(listEvents(stores.events, projectId));
    expect(projection.claims[recorded.value.claimId].status).toBe('rejected');
    const late = promoteClaim({
      store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(),
      verification: makeVerification('passed'),
    });
    expect(late.ok).toBe(false);
  });

  it('promoting an unknown claim fails; evidence references survive replay', () => {
    const unknown = promoteClaim({
      store: stores.events, ids, claimId: fixedId('clm', 'ghost'), at: clock.now(),
      verification: makeVerification('passed'),
    });
    expect(unknown.ok).toBe(false);

    const recorded = recordClaim({ store: stores.events, ids, report: implReport(), at: clock.now() });
    if (!recorded.ok) return;
    promoteClaim({
      store: stores.events, ids, claimId: recorded.value.claimId, at: clock.now(),
      verification: makeVerification('passed'),
    });
    const replayed = projectLedger(JSON.parse(JSON.stringify(listEvents(stores.events, projectId))));
    expect(replayed.canonical.verifiedEvidenceRefs).toContain(fixedId('bnd'));
  });
});

describe('in-memory adapters are explicitly non-production', () => {
  it('refuses construction without acknowledging volatility and labels durability truthfully', () => {
    expect(() => createInMemoryRelayStores(undefined as never)).toThrow();
    expect(() => createInMemoryRelayStores({} as never)).toThrow();
    expect(stores.durability).toBe('volatile-test-only');
  });

  it('reset happens only through the explicit test helper', () => {
    appendEvent(stores.events, { draft: draft(), eventId: ids.next('evt') as EventId });
    expect(listEvents(stores.events, projectId)).toHaveLength(1);
    stores.resetAllForTest();
    expect(listEvents(stores.events, projectId)).toHaveLength(0);
  });
});
