import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import { JuliusRuntimeApi, projectJuliusSlotViews, type JuliusApiIdentity } from './julius-runtime-api';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE STATE A SURFACE NEEDS, FROM THE RUNTIME THAT OWNS IT.
 *
 * `JuliusRuntimeApi` is the one surface anything outside the runtime may read,
 * and until now it could answer "what is the run doing" and not "what is each
 * of the three peers doing". A surface asked to draw a Prompt Architect, a
 * Coding Agent and an Independent Reviewer had two options: invent per-role
 * state from task names, or read the timeline and re-derive the runtime's own
 * conclusions in UI code. Both make the UI a second authority on Julius.
 *
 * WHAT THESE CASES HOLD, and each is a thing a UI would otherwise get wrong:
 *
 *   - a slot nobody has dispatched says NEVER_DISPATCHED, which is a state
 *     rather than an empty row;
 *   - a cost nobody reported is a FLOOR and says so, so a surface cannot render
 *     an unpriced mission as a cheap one;
 *   - `servedModel` is never a copy of `requestedModel`;
 *   - the projection is driven by a REAL mission, not a hand-built event list,
 *     so a field the runtime stopped emitting fails here.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});

const scope = { projectId: 'prj-1' };
const IDENTITY: JuliusApiIdentity = {
  tenantId: 'tenant', projectId: 'prj-1', actorId: 'operator', scopes: ['run:read'],
};
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };

/** The coder is the one slot whose provider reports a price, exactly as in Live Run 3. */
const BUILD_PRICED = {
  kind: 'succeed' as const, usdMicros: 608_861,
  evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }],
};
const PRICELESS = { kind: 'succeed' as const, usdMicros: null };

function build(coder: readonly { kind: 'succeed' }[] = [BUILD_PRICED]): JuliusHarness {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ ...PLAN_OK, ...PRICELESS }] },
      { worker: CODER, script: coder },
      { worker: REVIEWER, script: [{ ...REVIEW_ACCEPT, ...PRICELESS }, { ...REVIEW_ACCEPT, ...PRICELESS }] },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({
    taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'],
  }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  return harness;
}

async function drain(loop: JuliusRunLoop, maxTicks = 20): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if ((await loop.tick(scope)).claimed === 0) return tick;
  }
  return maxTicks;
}

const apiFor = (harness: JuliusHarness) => new JuliusRuntimeApi({
  store: harness.store as never,
  timeline: harness.store as never,
  approvers: { mayDecide: () => true } as never,
  clock: harness.clock,
});

const slotsOf = async (harness: JuliusHarness) => {
  const result = await apiFor(harness).inspectSlots(IDENTITY, 'run-1');
  expect(result.ok, 'an authorized read must be allowed').toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return new Map(result.value.map((slot) => [slot.role, slot]));
};

describe('the three peer slots, read through the authoritative API', () => {
  it('answers for all three roles, always, in a fixed order', async () => {
    const harness = build();
    await drain(harness.loop);
    const result = await apiFor(harness).inspectSlots(IDENTITY, 'run-1');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.map((slot) => slot.role),
      'a surface can index by position and never has to handle a missing role')
      .toEqual(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
  });

  it('reports who worked, how often, and where in the ledger they last were', async () => {
    const harness = build();
    await drain(harness.loop);
    const slots = await slotsOf(harness);
    for (const role of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const) {
      const slot = slots.get(role)!;
      expect(slot.dispatches, `${role} participated`).toBeGreaterThan(0);
      expect(slot.state, `${role} finished its work`).toBe('IDLE');
      expect(slot.lastSequence, `${role} has a ledger position`).not.toBeNull();
      expect(slot.workerId, `${role} names who held it`).not.toBeNull();
    }
    // The ledger order is the mission order: the architect worked before the
    // coder, and the reviewer after it.
    expect(slots.get('PROMPT_ARCHITECT')!.lastSequence!)
      .toBeLessThan(slots.get('INDEPENDENT_REVIEWER')!.lastSequence!);
  });

  /**
   * THE FIELD A SURFACE WOULD MOST LIKELY GET WRONG. Live Run 3 settled
   * $0.608861 for a mission whose architect and both reviewer calls reported
   * nothing. A UI that summed the known figures and called it the total would
   * have published a number three components short.
   */
  it('reports an unpriced slot as a floor, never as free', async () => {
    const harness = build();
    await drain(harness.loop);
    const slots = await slotsOf(harness);

    const coder = slots.get('CODING_AGENT')!;
    expect(coder.knownUsdMicros).toBe(608_861);
    expect(coder.costComplete, 'the one slot that reported everything it spent').toBe(true);
    expect(coder.unknownCostComponents).toBe(0);

    const reviewer = slots.get('INDEPENDENT_REVIEWER')!;
    expect(reviewer.unknownCostComponents, 'a settlement that reported no amount is counted')
      .toBeGreaterThan(0);
    expect(reviewer.costComplete, 'so its sum is a floor and says so').toBe(false);
    expect(reviewer.knownUsdMicros, 'and the floor is zero, which is not the same as free').toBe(0);
  });

  it('never copies the requested model into the served one', async () => {
    const harness = build();
    await drain(harness.loop);
    for (const slot of (await slotsOf(harness)).values()) {
      // The scripted adapter reports no model at all, which is exactly the shape
      // of the gap paid run 34414726976's bundle recorded for two of three legs.
      expect(slot.servedModel, `${slot.role}: silence is null`).toBeNull();
      expect(slot.requestedModel).toBeNull();
    }
  });

  it('calls a slot that never ran NEVER_DISPATCHED rather than idle', async () => {
    // A mission that only plans: the Coding Agent slot exists and nothing ever
    // dispatched it. The architect and its reviewer did work, so the empty row
    // is the one under test rather than the whole projection being empty.
    const harness = createJuliusHarness({
      workers: [
        { worker: ARCHITECT, script: [{ ...PLAN_OK, ...PRICELESS }] },
        { worker: CODER, script: [BUILD_PRICED] },
        { worker: REVIEWER, script: [{ ...REVIEW_ACCEPT, ...PRICELESS }] },
      ],
      card: cardPolicy({
        allowedProviders: ['openai', 'anthropic', 'hermes'],
        capabilities: ['plan', 'implement', 'review'], concurrency: 1,
      }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 0 }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({
      taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan',
      requiredEvidenceTypes: ['ARTIFACT'],
    }));
    await drain(harness.loop);
    const slots = await slotsOf(harness);
    const coder = slots.get('CODING_AGENT')!;
    expect(coder.state).toBe('NEVER_DISPATCHED');
    expect(coder.lastSequence).toBeNull();
    expect(coder.workerId, 'a slot nobody held names nobody').toBeNull();
    expect(coder.costComplete,
      'a slot that spent nothing because it never ran has a complete, empty account').toBe(true);
    expect(slots.get('PROMPT_ARCHITECT')!.state, 'and the slots that did work still say so').toBe('IDLE');
  });

  it('shows a failed slot as FAILED and names the class, without failing the others', async () => {
    const harness = build([{ kind: 'fail', code: 'PROVIDER_UNAVAILABLE' } as never]);
    await drain(harness.loop);
    const slots = await slotsOf(harness);
    expect(slots.get('CODING_AGENT')!.state).toBe('FAILED');
    expect(slots.get('PROMPT_ARCHITECT')!.state,
      'one slot failing is not the whole agent failing').toBe('IDLE');
  });

  it('refuses a read the identity is not scoped for', async () => {
    const harness = build();
    await drain(harness.loop);
    const result = await apiFor(harness)
      .inspectSlots({ ...IDENTITY, scopes: [] }, 'run-1');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('scope_missing');
  });

  it('refuses a run that belongs to another project', async () => {
    const harness = build();
    await drain(harness.loop);
    const result = await apiFor(harness).inspectSlots({ ...IDENTITY, projectId: 'prj-other' }, 'run-1');
    expect(result.ok).toBe(false);
  });
});

describe('the slot projection itself', () => {
  it('orders by the ledger position, never by the wall clock', () => {
    // Several events of one mission routinely land in the same millisecond, so
    // a wall-clock sort has no deterministic tiebreak. Both rows below share
    // one timestamp and disagree about order; `sequence` is what decides.
    const at = '2026-09-10T02:00:00.000Z';
    const entry = (sequence: number, type: string, facts: Record<string, string | number | boolean | null>) => ({
      eventId: `e${sequence}`, sequence, type, taskId: 'build-1', workerId: 'coder',
      occurredAt: at, facts,
    });
    const views = projectJuliusSlotViews([
      entry(2, 'worker.completed', { role: 'CODING_AGENT' }),
      entry(1, 'worker.dispatched', { role: 'CODING_AGENT' }),
    ]);
    const coder = views.find((slot) => slot.role === 'CODING_AGENT')!;
    expect(coder.state, 'completed came second in the ledger, so the slot is idle').toBe('IDLE');
    expect(coder.lastSequence).toBe(2);
  });

  it('attributes a row that states no role to the task whose role was stated', () => {
    // `budget.settled` carries no role. Dropping it would under-count every
    // slot's spend; guessing from the task NAME would be the poisoning failure
    // in another costume. It is attributed through the task a prior row named.
    const at = '2026-09-10T02:00:00.000Z';
    const views = projectJuliusSlotViews([
      { eventId: 'e1', sequence: 1, type: 'worker.dispatched', taskId: 'b', workerId: 'coder', occurredAt: at, facts: { role: 'CODING_AGENT' } },
      { eventId: 'e2', sequence: 2, type: 'budget.settled', taskId: 'b', workerId: null, occurredAt: at, facts: { usdMicros: 1_000 } },
      { eventId: 'e3', sequence: 3, type: 'budget.settled', taskId: 'unknown-task', workerId: null, occurredAt: at, facts: { usdMicros: 9_999 } },
    ]);
    const coder = views.find((slot) => slot.role === 'CODING_AGENT')!;
    expect(coder.knownUsdMicros, 'the settlement of a task whose role is known is counted').toBe(1_000);
    const others = views.filter((slot) => slot.role !== 'CODING_AGENT');
    for (const slot of others) {
      expect(slot.knownUsdMicros, 'and a row belonging to no known role is charged to nobody').toBe(0);
    }
  });

  it('never lets a silent row erase a model an earlier row stated', () => {
    const at = '2026-09-10T02:00:00.000Z';
    const views = projectJuliusSlotViews([
      { eventId: 'e1', sequence: 1, type: 'worker.dispatched', taskId: 'r', workerId: 'reviewer', occurredAt: at,
        facts: { role: 'INDEPENDENT_REVIEWER', requestedModel: 'grok-build-0.1' } },
      { eventId: 'e2', sequence: 2, type: 'worker.completed', taskId: 'r', workerId: 'reviewer', occurredAt: at,
        facts: { role: 'INDEPENDENT_REVIEWER', servedModel: 'grok-build-0.1', provider: 'xai' } },
      { eventId: 'e3', sequence: 3, type: 'evidence.recorded', taskId: 'r', workerId: 'reviewer', occurredAt: at,
        facts: { role: 'INDEPENDENT_REVIEWER' } },
    ]);
    const reviewer = views.find((slot) => slot.role === 'INDEPENDENT_REVIEWER')!;
    expect(reviewer.requestedModel).toBe('grok-build-0.1');
    expect(reviewer.servedModel).toBe('grok-build-0.1');
    expect(reviewer.providerId).toBe('xai');
  });

  /**
   * ONE RESERVATION, ONE COMPONENT ((a2) step 3). The view is a FLOOR of known API spend and a flag for
   * what nobody priced, and it counted every `budget.settled` row. A reservation can carry two rows
   * honestly now (the sweep's close, then a late settlement), and two figures for one dispatch were
   * SUMMED. Per reservation: the larger figure is the floor, and anything unpriced is one component.
   */
  describe('a reservation settled twice is one component', () => {
    const at = '2026-09-10T02:00:00.000Z';
    const coderOf = (...settlements: Array<Record<string, string | number | boolean | null>>) => projectJuliusSlotViews([
      { eventId: 'e1', sequence: 1, type: 'worker.dispatched', taskId: 'b', workerId: 'coder', occurredAt: at, facts: { role: 'CODING_AGENT' } },
      ...settlements.map((facts, index) => ({ eventId: `s${index}`, sequence: index + 2, type: 'budget.settled', taskId: 'b', workerId: null, occurredAt: at, facts })),
    ]).find((slot) => slot.role === 'CODING_AGENT')!;
    const known = (usdMicros: number) => ({ reservationId: 'r1', usdMicros, costBasis: 'PROVIDER_REPORTED', released: false });
    const unknown = { reservationId: 'r1', usdMicros: null, costBasis: 'UNKNOWN', released: false };

    it('RED FIRST: two figures for one reservation: the larger is the floor, never the sum', () => {
      expect(coderOf(known(100_000), known(400_000))).toMatchObject({ knownUsdMicros: 400_000, unknownCostComponents: 0, costComplete: true });
    });
    it('RED FIRST: two unpriced rows for one reservation are ONE unpriced component', () => {
      expect(coderOf(unknown, unknown)).toMatchObject({ knownUsdMicros: 0, unknownCostComponents: 1, costComplete: false });
    });
    it('a figure beside an unpriced close: the figure is the floor, and the slot is still incomplete', () => {
      expect(coderOf(unknown, known(450_000))).toMatchObject({ knownUsdMicros: 450_000, unknownCostComponents: 1, costComplete: false });
    });
    it('CONTROL: two reservations are two components; a row naming no reservation counts as it always did', () => {
      expect(coderOf(known(100_000), { ...known(400_000), reservationId: 'r2' })).toMatchObject({ knownUsdMicros: 500_000 });
      expect(coderOf({ usdMicros: 7 }, { usdMicros: 9 })).toMatchObject({ knownUsdMicros: 16 });
    });
  });
});
