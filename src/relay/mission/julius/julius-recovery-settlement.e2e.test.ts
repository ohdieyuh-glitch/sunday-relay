import { describe, expect, it } from 'vitest';

import { juliusRecoverySettlementEvent, planJuliusRecoverySettlements } from './julius-recovery';
import type { JuliusProviderAdapter } from './julius-router';
import { JuliusRunLoop } from './julius-run-loop';
import { projectJuliusSlotLedger, type JuliusBudgetRow } from './julius-slot-ledger';
import { cardPolicy, createFakeTime, createJuliusHarness, seedRun, task, worker, type FakeTime, type JuliusHarness } from './julius-runtime-fixtures';

/**
 * (a2) STEP 2: RECOVERY CLOSES WHAT THE LOST ATTEMPT LEFT OPEN.
 *
 * The coordinator writes `budget.reserved`, then `worker.dispatched`, then `budget.settled`. A process
 * that died after the reservation left it open for ever: recovery requeued the task (or ended it),
 * the next attempt reserved afresh, and the slot ledger, which is PROJECTED from those rows, kept
 * charging the dead attempt's hold as outstanding. Under a shared ceiling that refuses a mission
 * money it can afford. An over-count, never a leak, and still wrong.
 *
 * The sweep now closes every reservation of the task it recovers, in the same atomic step as the
 * lease change, judged by that reservation's OWN attempt:
 *   - no `worker.dispatched` for that attempt: RELEASED (`RECOVERED_BEFORE_HANDOFF`). Nothing was
 *     sent, and step 1's fence means nothing can be sent under that attempt any more;
 *   - a `worker.dispatched` for it: closed as an UNKNOWN outcome (`RECOVERED_HANDED_OUTCOME_UNKNOWN`)
 *     and charged at what it held. Unknown is not free.
 * A reservation whose row names no attempt is released only when the task was never handed at all.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], timeoutMs: 30_000 });
const scope = { projectId: 'prj-1' };
const LEASE_MS = 1_000;
const HOLD = 300_000;

const budgetRows = (harness: JuliusHarness, runId = 'run-1'): JuliusBudgetRow[] => harness.store.events()
  .filter((event) => event.runId === runId && ['budget.allocated', 'budget.reserved', 'budget.settled'].includes(event.type))
  .map((event) => ({ type: event.type, taskId: event.taskId, facts: event.facts }));
const ledgerOf = (harness: JuliusHarness) => projectJuliusSlotLedger({
  runId: 'run-1', policy: null, policyVersion: 'test', ceilingUsdMicros: 10_000_000, rows: budgetRows(harness),
});
const settledFor = (harness: JuliusHarness, reservationId: string) => harness.store.events()
  .filter((event) => event.type === 'budget.settled' && event.facts.reservationId === reservationId);

/* ------------------------------------------------------------ the rule, alone */

describe('planJuliusRecoverySettlements: each reservation is judged by its own attempt', () => {
  const open = (reservationId: string, attempt: number | null) => ({ reservationId, role: 'CODING_AGENT', attempt });
  const released = (reservationId: string) => ({ reservationId, released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' });
  const held = (reservationId: string) => ({ reservationId, released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' });
  /** A handoff from an older build: it names its attempt (or nothing), never its reservation. */
  const legacy = (attempt: number | null) => ({ attempt, reservationId: null });
  /** A handoff as the coordinator writes it now: its attempt AND its reservation. */
  const named = (reservationId: string, attempt = 1) => ({ attempt, reservationId });

  it('no handoff at all: every reservation is released', () => {
    expect(planJuliusRecoverySettlements([open('r1', 1), open('legacy', null)], [])).toEqual([released('r1'), released('legacy')]);
  });
  it('a legacy handoff of the same attempt holds it; a handoff of another attempt does not', () => {
    expect(planJuliusRecoverySettlements([open('r1', 1), open('r2', 2)], [legacy(2)])).toEqual([released('r1'), held('r2')]);
  });
  it('when the rows cannot tell, it is held', () => {
    expect(planJuliusRecoverySettlements([open('legacy', null)], [legacy(1)]), 'a reservation naming no attempt, after any handoff').toEqual([held('legacy')]);
    expect(planJuliusRecoverySettlements([open('r1', 1), open('r2', 2)], [legacy(null)]), 'a handoff naming neither').toEqual([held('r1'), held('r2')]);
  });
  it('a handoff that NAMES its reservation speaks for that one only, whatever attempt the others share (a reroute)', () => {
    expect(planJuliusRecoverySettlements([open('r1', 1), open('r2', 1)], [named('r1')])).toEqual([held('r1'), released('r2')]);
    expect(planJuliusRecoverySettlements([open('r2', 1)], [named('r1')]), 'the first leg’s handoff, its own reservation already settled').toEqual([released('r2')]);
    expect(planJuliusRecoverySettlements([open('legacy', null)], [named('r1')]), 'even a reservation that names no attempt').toEqual([released('legacy')]);
  });
  it('nothing open, nothing closed', () => {
    expect(planJuliusRecoverySettlements([], [legacy(1), named('r2', 2)])).toEqual([]);
  });
  it('the closing row: one id per reservation, no amount, basis UNKNOWN, and the reservation\'s own role', () => {
    const event = juliusRecoverySettlementEvent({
      runId: 'run-1', projectId: 'prj-1', taskId: 'task-1', reservation: open('reservation:r1', 3), settlement: released('reservation:r1') as never, occurredAt: '2026-09-29T12:00:00.000Z',
    });
    expect(event).toEqual({
      eventId: 'event:budget.settled:recovered:reservation:r1', runId: 'run-1', projectId: 'prj-1', type: 'budget.settled', taskId: 'task-1',
      workerId: null, correlationId: 'task-1', causationId: null, occurredAt: '2026-09-29T12:00:00.000Z',
      facts: {
        reservationId: 'reservation:r1', usdMicros: null, reason: 'RECOVERED_BEFORE_HANDOFF', role: 'CODING_AGENT', released: true,
        costBasis: 'UNKNOWN', estimatedUsdMicros: null, attempt: 3, runId: 'run-1',
      },
    });
  });
});

/* ------------------------------------------------------------ the store, directly */

/** Rows as the coordinator writes them, for a store driven by hand. */
const rows = (harness: JuliusHarness, time: FakeTime) => {
  let n = 0;
  const append = (type: 'budget.reserved' | 'budget.settled' | 'worker.dispatched', taskId: string, facts: Record<string, string | number | boolean | null>) => {
    n += 1;
    return harness.store.appendEvent({
      eventId: `event:${type}:by-hand:${String(n)}`, runId: 'run-1', projectId: scope.projectId, type, taskId,
      workerId: null, correlationId: taskId, causationId: null, occurredAt: time.clock.now(), facts: { ...facts, runId: 'run-1' },
    });
  };
  return {
    reserve: (taskId: string, reservationId: string, attempt: number | null) =>
      append('budget.reserved', taskId, { reservationId, role: 'CODING_AGENT', usdMicros: HOLD, ...(attempt === null ? {} : { attempt }) }),
    handoff: (taskId: string, attempt: number | null) =>
      append('worker.dispatched', taskId, { workerId: 'coder', ...(attempt === null ? {} : { attempt }) }),
    settle: (taskId: string, reservationId: string) =>
      append('budget.settled', taskId, { reservationId, usdMicros: null, reason: 'CANCELLED', role: 'CODING_AGENT', released: true, costBasis: 'UNKNOWN', estimatedUsdMicros: null }),
  };
};

const claimAndAdmit = async (harness: JuliusHarness, time: FakeTime, owner: string, leaseMs = LEASE_MS) => {
  const [claim] = await harness.store.claimRunnable({
    owner, now: time.clock.now(), leaseExpiresAt: new Date(time.nowMs() + leaseMs).toISOString(), limit: 1, projectId: scope.projectId,
  });
  expect(claim, `${owner} claims`).toBeDefined();
  const attempt = await harness.store.admitTask({ taskId: claim!.taskId, owner, leaseGeneration: claim!.leaseGeneration, now: time.clock.now() });
  expect(typeof attempt, 'admitted').toBe('number');
  return { ...claim!, attempt: attempt as number, owner };
};

const fresh = (tasks = [task({ taskId: 'task-1' })]) => {
  const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [] }] });
  seedRun(harness, { tasks });
  return { harness, time: createFakeTime('2026-09-29T12:00:00.000Z') };
};

const sweep = async (harness: JuliusHarness, time: FakeTime) => {
  await time.advance(LEASE_MS * 3);
  return harness.store.recoverExpired(time.clock.now(), 10, scope.projectId);
};

describe('(a2) step 2: recovery closes the reservations its lost attempt left open (memory store)', () => {
  it('RED FIRST, NOT HANDED: the orphaned hold is released, so the slot ledger stops charging it', async () => {
    const { harness, time } = fresh();
    const by = rows(harness, time);
    await claimAndAdmit(harness, time, 'dead');
    await by.reserve('task-1', 'reservation:r1', 1);
    expect(Object.keys(ledgerOf(harness).openReservations), 'the defect: the dead attempt holds its money').toEqual(['reservation:r1']);

    const actions = await sweep(harness, time);
    expect(actions.map((action) => `${action.action}:${action.reasonCode}`)).toEqual(['REQUEUE:LEASE_EXPIRED']);
    expect(actions[0]).toMatchObject({ settlements: [{ reservationId: 'reservation:r1', released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' }] });
    const closed = settledFor(harness, 'reservation:r1');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      eventId: 'event:budget.settled:recovered:reservation:r1', taskId: 'task-1',
      facts: { reservationId: 'reservation:r1', released: true, reason: 'RECOVERED_BEFORE_HANDOFF', costBasis: 'UNKNOWN', usdMicros: null, role: 'CODING_AGENT', attempt: 1 },
    });
    const ledger = ledgerOf(harness);
    expect(ledger.openReservations).toEqual({});
    expect(ledger.bySlot.CODING_AGENT).toMatchObject({ outstandingUsdMicros: 0, releasedUsdMicros: HOLD, settledUnknownUsdMicros: 0 });
  });

  it('RED FIRST, HANDED: closed as an unknown outcome and charged at what it held, never freed', async () => {
    const { harness, time } = fresh();
    const by = rows(harness, time);
    await claimAndAdmit(harness, time, 'dead');
    await by.reserve('task-1', 'reservation:r1', 1);
    await by.handoff('task-1', 1);

    const actions = await sweep(harness, time);
    expect(actions.map((action) => `${action.action}:${action.reasonCode}`)).toEqual(['FAIL_TASK:HANDED_OUTCOME_UNKNOWN']);
    expect(actions[0]).toMatchObject({ settlements: [{ reservationId: 'reservation:r1', released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' }] });
    expect(settledFor(harness, 'reservation:r1').map((event) => event.facts)).toEqual([expect.objectContaining({
      released: false, reason: 'RECOVERED_HANDED_OUTCOME_UNKNOWN', costBasis: 'UNKNOWN', usdMicros: null, role: 'CODING_AGENT',
    })]);
    const ledger = ledgerOf(harness);
    expect(ledger.openReservations).toEqual({});
    expect(ledger.bySlot.CODING_AGENT).toMatchObject({ outstandingUsdMicros: 0, releasedUsdMicros: 0, settledUnknownUsdMicros: HOLD });
  });

  it('each reservation is judged by its OWN attempt: an old orphan is released, the handed current one is held', async () => {
    const { harness, time } = fresh();
    const by = rows(harness, time);
    const first = await claimAndAdmit(harness, time, 'a');
    await by.reserve('task-1', 'reservation:r1', first.attempt);
    // Handed back without a settlement: the orphan an older build left behind.
    expect(await harness.store.finishTask({ taskId: 'task-1', owner: 'a', leaseGeneration: first.leaseGeneration, state: 'FAILED', now: time.clock.now(), nextAttemptAt: time.clock.now() })).toBe(true);
    const second = await claimAndAdmit(harness, time, 'b');
    expect(second.attempt).toBe(2);
    await by.reserve('task-1', 'reservation:r2', second.attempt);
    await by.handoff('task-1', second.attempt);

    const actions = await sweep(harness, time);
    expect(actions.map((action) => action.reasonCode)).toEqual(['HANDED_OUTCOME_UNKNOWN']);
    expect(actions[0]!.settlements).toEqual([
      { reservationId: 'reservation:r1', released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' },
      { reservationId: 'reservation:r2', released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' },
    ]);
    expect(ledgerOf(harness).bySlot.CODING_AGENT).toMatchObject({ outstandingUsdMicros: 0, releasedUsdMicros: HOLD, settledUnknownUsdMicros: HOLD });
  });

  it('a reservation already settled is left alone: no second row', async () => {
    const { harness, time } = fresh();
    const by = rows(harness, time);
    await claimAndAdmit(harness, time, 'dead');
    await by.reserve('task-1', 'reservation:r1', 1);
    await by.settle('task-1', 'reservation:r1');

    const actions = await sweep(harness, time);
    expect(actions.map((action) => action.reasonCode)).toEqual(['LEASE_EXPIRED']);
    expect(actions[0]!.settlements ?? [], 'nothing was open').toEqual([]);
    expect(settledFor(harness, 'reservation:r1').map((event) => event.facts.reason), 'the coordinator\'s row, alone').toEqual(['CANCELLED']);
  });

  it('a reservation whose row names no attempt is released only when the task was never handed at all', async () => {
    const never = fresh();
    await claimAndAdmit(never.harness, never.time, 'dead');
    await rows(never.harness, never.time).reserve('task-1', 'reservation:legacy', null);
    expect((await sweep(never.harness, never.time))[0]!.settlements).toEqual([
      { reservationId: 'reservation:legacy', released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' },
    ]);

    const handed = fresh();
    await claimAndAdmit(handed.harness, handed.time, 'dead');
    const by = rows(handed.harness, handed.time);
    await by.reserve('task-1', 'reservation:legacy', null);
    await by.handoff('task-1', 1);
    expect((await sweep(handed.harness, handed.time))[0]!.settlements, 'a handoff it cannot be told apart from holds it').toEqual([
      { reservationId: 'reservation:legacy', released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' },
    ]);
  });

  it('only the recovered task is touched: another task\'s reservation stays open, and another task\'s handoff is not this one\'s', async () => {
    const { harness, time } = fresh([task({ taskId: 'task-1', ordinal: 0 }), task({ taskId: 'task-2', ordinal: 1 })]);
    const by = rows(harness, time);
    const dead = await claimAndAdmit(harness, time, 'dead');
    await by.reserve(dead.taskId, 'reservation:dead', dead.attempt);
    await time.advance(LEASE_MS * 3);
    const live = await claimAndAdmit(harness, time, 'live', 60_000);
    expect(live.taskId).not.toBe(dead.taskId);
    expect(live.attempt, 'the same attempt number as the dead one').toBe(dead.attempt);
    await by.reserve(live.taskId, 'reservation:live', live.attempt);
    await by.handoff(live.taskId, live.attempt);

    const actions = await harness.store.recoverExpired(time.clock.now(), 10, scope.projectId);
    expect(actions.map((action) => action.taskId)).toEqual([dead.taskId]);
    expect(actions[0]!.settlements, 'the live task\'s handoff does not make the dead one handed').toEqual([
      { reservationId: 'reservation:dead', released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' },
    ]);
    expect(settledFor(harness, 'reservation:live'), 'a live attempt keeps its hold').toEqual([]);
    expect(Object.keys(ledgerOf(harness).openReservations)).toEqual(['reservation:live']);
  });

  it('the close is written once: a second sweep adds nothing, and a later crash closes only its own reservation', async () => {
    const { harness, time } = fresh();
    const by = rows(harness, time);
    await claimAndAdmit(harness, time, 'a');
    await by.reserve('task-1', 'reservation:r1', 1);
    await sweep(harness, time);
    expect(await harness.store.recoverExpired(time.clock.now(), 10, scope.projectId), 'nothing is ACTIVE').toEqual([]);

    const again = await claimAndAdmit(harness, time, 'b');
    await by.reserve('task-1', 'reservation:r2', again.attempt);
    const actions = await sweep(harness, time);
    expect(actions[0]!.settlements).toEqual([{ reservationId: 'reservation:r2', released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' }]);
    expect(settledFor(harness, 'reservation:r1'), 'r1 still has exactly one closing row').toHaveLength(1);
    expect(ledgerOf(harness).openReservations).toEqual({});
  });
});

/* ------------------------------------------------------------ through the run loop */

const loopAs = (harness: JuliusHarness, time: FakeTime, owner: string) =>
  new JuliusRunLoop({ ...harness.deps, clock: time.clock, owner }, harness.policies, { claimLimit: 4, leaseMs: LEASE_MS });

const recoveryFacts = (harness: JuliusHarness) => harness.store.events()
  .filter((event) => event.type === 'recovery.action')
  .map((event) => event.facts);

describe('(a2) step 2 through the run loop', () => {
  it('RED FIRST: CLAIMED BUT NEVER HANDED. The dead attempt\'s hold is released by the sweep, and the run ends with nothing open', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    // Worker A's handoff write never returns: it dies after reserving and before handing anything.
    const store = harness.store as unknown as { appendHandoffEvent: (input: { event: { type: string } }) => Promise<unknown> };
    const handoff = store.appendHandoffEvent.bind(store);
    let hung = false;
    let reachedHandoff = (): void => undefined;
    const atHandoff = new Promise<void>((resolve) => { reachedHandoff = resolve; });
    store.appendHandoffEvent = async (input) => {
      if (!hung && input.event.type === 'worker.dispatched') { hung = true; reachedHandoff(); return new Promise(() => undefined); }
      return handoff(input);
    };

    void loopAs(harness, time, 'worker-a').tick(scope);
    await atHandoff;
    const [dead] = harness.store.events().filter((event) => event.type === 'budget.reserved' && event.taskId === 'task-1');
    const deadReservation = String(dead!.facts.reservationId);
    await time.advance(LEASE_MS * 3);
    const b = loopAs(harness, time, 'worker-b');
    for (let tick = 0; tick < 4; tick += 1) await b.tick(scope);

    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(settledFor(harness, deadReservation).map((event) => event.facts.reason), 'closed by the sweep, as released').toEqual(['RECOVERED_BEFORE_HANDOFF']);
    expect(recoveryFacts(harness), 'and the sweep says so').toEqual([expect.objectContaining({ action: 'REQUEUE', reasonCode: 'LEASE_EXPIRED', reservationsReleased: 1, reservationsHeldUnknown: 0 })]);
    const ledger = ledgerOf(harness);
    expect(ledger.openReservations, 'nothing is left open at the end').toEqual({});
    expect(ledger.bySlot.CODING_AGENT!.releasedUsdMicros, 'the dead attempt\'s hold went back to the mission').toBeGreaterThanOrEqual(Number(dead!.facts.usdMicros));
  });

  it('RED FIRST: HANDED, then the worker process died. The hold is closed as unknown and still charged in full', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    // The provider has the work and never answers: the process that asked is gone.
    const held: JuliusProviderAdapter = {
      adapterId: CODER.adapterId,
      async dispatch() { markStarted(); return new Promise(() => undefined); },
    };
    (harness.adapters as Map<string, JuliusProviderAdapter>).set(CODER.adapterId, held);

    void loopAs(harness, time, 'worker-a').tick(scope);
    await started;
    const [reserved] = harness.store.events().filter((event) => event.type === 'budget.reserved' && event.taskId === 'task-1');
    const reservationId = String(reserved!.facts.reservationId);
    await time.advance(LEASE_MS * 3);
    await loopAs(harness, time, 'worker-b').tick(scope);

    expect(harness.store.taskRow('task-1')!.state).toBe('FAILED');
    expect(settledFor(harness, reservationId).map((event) => event.facts)).toEqual([expect.objectContaining({
      released: false, reason: 'RECOVERED_HANDED_OUTCOME_UNKNOWN', costBasis: 'UNKNOWN', usdMicros: null,
    })]);
    expect(recoveryFacts(harness)).toEqual([expect.objectContaining({ action: 'FAIL_TASK', reasonCode: 'HANDED_OUTCOME_UNKNOWN', reservationsReleased: 0, reservationsHeldUnknown: 1 })]);
    const ledger = ledgerOf(harness);
    expect(ledger.openReservations).toEqual({});
    expect(ledger.bySlot.CODING_AGENT).toMatchObject({ releasedUsdMicros: 0, settledUnknownUsdMicros: Number(reserved!.facts.usdMicros) });
    expect(harness.budget.reservations().some((row) => row.state === 'RESERVED'), 'the in-process hold is untouched: unknown, never $0').toBe(true);
  });

  /**
   * ONE ADMISSION, TWO RESERVATIONS (the review of 2475bcc1, finding 2, its probe R1). A reroute calls
   * the coordinator again under the same claim and the same attempt, and each leg reserves. Matched by
   * attempt alone, the first leg's handoff made the reroute's reservation read "handed" although its
   * worker was never called. The handoff now names its own reservation, and a handoff that names one
   * speaks for that reservation only.
   */
  it('RED FIRST: a reroute’s reservation that was never handed is released, though its first leg handed the same attempt', async () => {
    const OTHER = worker({ workerId: 'coder-b', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], providerId: 'provider-b', adapterId: 'coder-b-adapter', timeoutMs: 30_000 });
    const harness = createJuliusHarness({
      workers: [
        // Handed, then refused unprocessed: nothing spent, and the coordinator released that leg itself.
        { worker: CODER, script: [{ kind: 'fail', code: 'PROVIDER_UNAVAILABLE', runtimeStarted: false }] },
        { worker: OTHER, script: [{ kind: 'succeed' }] },
      ],
      card: cardPolicy({ allowedProviders: [CODER.providerId, OTHER.providerId], autonomy: 'AUTONOMOUS' }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    const store = harness.store as unknown as { appendHandoffEvent: (input: { event: { type: string } }) => Promise<unknown> };
    const fence = store.appendHandoffEvent.bind(store);
    let handoffs = 0;
    let reachedSecond = (): void => undefined;
    const atSecond = new Promise<void>((resolve) => { reachedSecond = resolve; });
    store.appendHandoffEvent = async (input) => {
      handoffs += 1;
      // The REROUTE's handoff never returns: the process dies after reserving and before handing.
      if (handoffs === 2) { reachedSecond(); return new Promise(() => undefined); }
      return fence(input);
    };
    void loopAs(harness, time, 'worker-a').tick(scope);
    await atSecond;
    await time.advance(LEASE_MS * 3);
    const actions = await harness.store.recoverExpired(time.clock.now(), 10, scope.projectId);

    const reserved = harness.store.events().filter((event) => event.type === 'budget.reserved');
    expect(reserved.map((event) => event.facts.attempt), 'both legs reserved under the same attempt').toEqual([1, 1]);
    const second = String(reserved[1]!.facts.reservationId);
    expect(harness.adapters.get(OTHER.adapterId)!.dispatches, 'the reroute worker was never called').toHaveLength(0);
    expect(actions[0]!.settlements, 'released: its own dispatch was never handed').toEqual([
      { reservationId: second, released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' },
    ]);
  });
});
