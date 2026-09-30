import { describe, expect, it } from 'vitest';

import { juliusLateSettlementDecision, juliusSettlementConflictEvent } from './julius-recovery';
import { JuliusDispatchError, type JuliusProviderAdapter } from './julius-router';
import { JuliusRunLoop } from './julius-run-loop';
import { projectJuliusSlotLedger, type JuliusBudgetRow } from './julius-slot-ledger';
import { createFakeTime, createJuliusHarness, seedRun, task, worker, type FakeTime, type JuliusHarness } from './julius-runtime-fixtures';

/**
 * (a2) STEP 3, THE LATE RELEASE: A FREE RELEASE AFTER THE SWEEP'S CLOSE (agreed with JUJU, 2026-09-29).
 *
 * The sweep closes what a lost attempt left open (step 2). An attempt whose lease lapsed while it was
 * still ALIVE then releases its own hold late, and that second row used to land whatever it said, so
 * the settlement-integrity gate failed a bundle in which no money had moved. What each late FREE
 * release (released:true, no amount) does now, decided by the store under the run-row lock:
 *   - after a RELEASED close it says the same thing, and it is NOT written;
 *   - after an UNKNOWN close (the sweep saw a handoff; the attempt says nothing was sent) it is a
 *     CONFLICT between two readings, neither shown false. Never hidden: the release is written, and a `budget.settlement.conflict`
 *     event names both sides, so the gate reports it for what it is;
 *   - a release that carries COST is always written (step 3's rule charges the larger).
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], timeoutMs: 30_000 });
const scope = { projectId: 'prj-1' };
const LEASE_MS = 1_000;

const loopAs = (harness: JuliusHarness, time: FakeTime, owner: string) =>
  new JuliusRunLoop({ ...harness.deps, clock: time.clock, owner }, harness.policies, { claimLimit: 4, leaseMs: LEASE_MS });
const settledFor = (harness: JuliusHarness, reservationId: string) => harness.store.events()
  .filter((event) => event.type === 'budget.settled' && event.facts.reservationId === reservationId);
const conflicts = (harness: JuliusHarness) => harness.store.events()
  .filter((event) => (event.type as string) === 'budget.settlement.conflict');
const ledgerOf = (harness: JuliusHarness) => projectJuliusSlotLedger({
  runId: 'run-1', policy: null, policyVersion: 'test', ceilingUsdMicros: 10_000_000,
  rows: harness.store.events()
    .filter((event) => event.runId === 'run-1' && ['budget.reserved', 'budget.settled'].includes(event.type))
    .map((event): JuliusBudgetRow => ({ type: event.type, taskId: event.taskId, facts: event.facts })),
});

describe('juliusLateSettlementDecision, the rule both stores take', () => {
  const close = (released: boolean, reason = released ? 'RECOVERED_BEFORE_HANDOFF' : 'RECOVERED_HANDED_OUTCOME_UNKNOWN') => ({ eventId: `e:${reason}`, released, reason });

  it('a row that carries cost is always written, whatever came before it', () => {
    for (const prior of [[], [close(true)], [close(false)], [close(true), close(false)]]) {
      expect(juliusLateSettlementDecision({ released: false }, prior), JSON.stringify(prior)).toBe('WRITE');
    }
  });
  it('a free release: written first, the same after released closes, a conflict beside any close that may have spent', () => {
    expect(juliusLateSettlementDecision({ released: true }, [])).toBe('WRITE');
    expect(juliusLateSettlementDecision({ released: true }, [close(true), close(true)])).toBe('SAME_MEANING');
    expect(juliusLateSettlementDecision({ released: true }, [close(false)])).toBe('CONFLICT');
    expect(juliusLateSettlementDecision({ released: true }, [close(true), close(false)]), 'one unknown close is enough').toBe('CONFLICT');
  });
  it('the conflict names the close it disagrees with, never a released one beside it', () => {
    const release = {
      eventId: 'event:budget.settled:late', runId: 'run-1', projectId: 'prj-1', type: 'budget.settled' as const, taskId: 'task-1', workerId: null,
      correlationId: 'run-1', causationId: null, occurredAt: '2026-09-29T12:00:00.000Z', facts: { reservationId: 'r1', reason: 'CANCELLED', released: true },
    };
    expect(juliusSettlementConflictEvent({ release, prior: [close(true), close(false)] })).toMatchObject({
      eventId: 'event:budget.settlement.conflict:event:budget.settled:late', type: 'budget.settlement.conflict', causationId: 'event:budget.settled:late',
      facts: { reservationId: 'r1', closedAs: 'RECOVERED_HANDED_OUTCOME_UNKNOWN', closedBy: 'e:RECOVERED_HANDED_OUTCOME_UNKNOWN', releasedAs: 'CANCELLED', runId: 'run-1' },
    });
  });
});

/** A promise and the function that settles it, for holding one write or one call open. */
const gate = () => {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
};

describe('(a2) step 3: a late free release after the sweep’s close', () => {
  it('RED FIRST: after a RELEASED close it says the same thing, and it is not written a second time', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    // Worker A is ALIVE but slow: its handoff write waits while its lease lapses and B sweeps.
    const store = harness.store as unknown as { appendHandoffEvent: (input: { event: { type: string } }) => Promise<string> };
    const fence = store.appendHandoffEvent.bind(store);
    const atHandoff = gate();
    const resume = gate();
    let held = false;
    store.appendHandoffEvent = async (input) => {
      if (!held && input.event.type === 'worker.dispatched') { held = true; atHandoff.open(); await resume.opened; }
      return fence(input);
    };

    const a = loopAs(harness, time, 'worker-a').tick(scope);
    await atHandoff.opened;
    const [reserved] = harness.store.events().filter((event) => event.type === 'budget.reserved' && event.taskId === 'task-1');
    const reservationId = String(reserved!.facts.reservationId);
    await time.advance(LEASE_MS * 3);
    await harness.store.recoverExpired(time.clock.now(), 10, scope.projectId); // B's sweep: RELEASED, never handed
    expect(settledFor(harness, reservationId).map((event) => event.facts.reason)).toEqual(['RECOVERED_BEFORE_HANDOFF']);

    resume.open(); // A's fence now answers LEASE_LOST, and A releases its own hold
    await a;
    expect(settledFor(harness, reservationId).map((event) => event.facts.reason), 'one closing row: the second said nothing new').toEqual(['RECOVERED_BEFORE_HANDOFF']);
    expect(conflicts(harness)).toEqual([]);
    expect(ledgerOf(harness).bySlot.CODING_AGENT!.releasedUsdMicros).toBe(Number(reserved!.facts.usdMicros));
  });

  it('RED FIRST: after an UNKNOWN close it is a CONFLICT, written and named, never hidden, and the hold stays charged', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    // Worker A hands off; its provider call waits while its lease lapses and B sweeps; then the provider
    // refuses BEFORE any runtime started, so A's own ending releases the hold as spending nothing.
    const called = gate();
    const answer = gate();
    const refusing: JuliusProviderAdapter = {
      adapterId: CODER.adapterId,
      async dispatch() {
        called.open();
        await answer.opened;
        throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'Refused before the runtime started.', 'authentication_failed', { runtimeStarted: false });
      },
    };
    (harness.adapters as Map<string, JuliusProviderAdapter>).set(CODER.adapterId, refusing);

    const a = loopAs(harness, time, 'worker-a').tick(scope);
    await called.opened;
    const [reserved] = harness.store.events().filter((event) => event.type === 'budget.reserved' && event.taskId === 'task-1');
    const reservationId = String(reserved!.facts.reservationId);
    await time.advance(LEASE_MS * 3);
    const [swept] = await harness.store.recoverExpired(time.clock.now(), 10, scope.projectId); // B's sweep: HANDED
    expect(swept?.reasonCode).toBe('HANDED_OUTCOME_UNKNOWN');

    answer.open();
    await a.catch(() => undefined);
    expect(settledFor(harness, reservationId).map((event) => `${String(event.facts.reason)}|${String(event.facts.released)}`), 'both rows stand')
      .toEqual(['RECOVERED_HANDED_OUTCOME_UNKNOWN|false', 'AUTH_CONFIGURATION|true']);
    expect(conflicts(harness).map((event) => event.facts), 'and the disagreement is named').toEqual([expect.objectContaining({
      reservationId, closedAs: 'RECOVERED_HANDED_OUTCOME_UNKNOWN', releasedAs: 'AUTH_CONFIGURATION',
    })]);
    expect(ledgerOf(harness).bySlot.CODING_AGENT, 'the hold stays charged: a release never outweighs an unknown close')
      .toMatchObject({ releasedUsdMicros: 0, settledUnknownUsdMicros: Number(reserved!.facts.usdMicros) });
  });
});
