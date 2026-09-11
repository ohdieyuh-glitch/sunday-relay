import { describe, expect, it } from 'vitest';

import {
  JULIUS_SLOT_SOURCES,
  projectJuliusSlotLedger,
  reserveJuliusSlotCapacity,
  type JuliusBudgetRow,
  type JuliusMissionSlotLedger,
} from './julius-slot-ledger';
import { juliusSlotEnvelopePolicy, slotRoundShareUsdMicros } from './julius-slot-envelope';
import { JULIUS_COST_BASES } from './julius-cost-accounting';

/**
 * THE MONEY, AND THE ONE RULE THAT MAKES IT SAFE.
 *
 * An unknown settlement is not a refund. Everything else here is a consequence
 * of that sentence, and every case is written so that the OPPOSITE behaviour —
 * the one a reasonable implementation drifts into — fails.
 */

const CEILING = 30_000_000;
const POLICY = () => juliusSlotEnvelopePolicy({
  ceilingUsdMicros: CEILING, authorizedRepairRounds: 3, maxCoderSegments: 4,
});

const reserved = (reservationId: string, role: string, usdMicros: number, taskId = 't'): JuliusBudgetRow =>
  ({ type: 'budget.reserved', taskId, facts: { reservationId, role, usdMicros } });
const settledKnown = (reservationId: string, role: string, usdMicros: number): JuliusBudgetRow =>
  ({ type: 'budget.settled', taskId: 't', facts: { reservationId, role, usdMicros, costBasis: 'PROVIDER_REPORTED', released: false } });
const settledUnknown = (reservationId: string, role: string): JuliusBudgetRow =>
  ({ type: 'budget.settled', taskId: 't', facts: { reservationId, role, usdMicros: null, costBasis: 'UNKNOWN', released: false } });
const releasedRow = (reservationId: string, role: string): JuliusBudgetRow =>
  ({ type: 'budget.settled', taskId: 't', facts: { reservationId, role, usdMicros: null, costBasis: 'UNKNOWN', released: true } });

const project = (rows: readonly JuliusBudgetRow[]): JuliusMissionSlotLedger => projectJuliusSlotLedger({
  runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2', ceilingUsdMicros: CEILING, rows,
});

describe('the vocabularies say what they mean', () => {
  it('names a basis for money that is held and not yet accounted for', () => {
    expect([...JULIUS_COST_BASES]).toEqual([
      'PROVIDER_REPORTED', 'MEASURED_FROM_USAGE', 'ESTIMATED', 'RESERVED_UNSETTLED', 'UNKNOWN',
    ]);
  });

  it('names the three places a dispatch\'s money can come from, and no fourth', () => {
    expect([...JULIUS_SLOT_SOURCES]).toEqual(['SLOT_SHARE', 'SLOT_REMAINDER', 'REALLOCATED']);
  });
});

describe('an unknown settlement is not a refund', () => {
  const share = slotRoundShareUsdMicros(POLICY(), 'PROMPT_ARCHITECT');

  it('charges the slot what the reservation HELD, not nothing', () => {
    const ledger = project([
      reserved('r1', 'PROMPT_ARCHITECT', share),
      settledUnknown('r1', 'PROMPT_ARCHITECT'),
    ]);
    const account = ledger.bySlot.PROMPT_ARCHITECT!;
    expect(account.outstandingUsdMicros, 'the hold is closed').toBe(0);
    expect(account.settledKnownUsdMicros, 'and nothing is claimed as known').toBe(0);
    expect(account.settledUnknownUsdMicros, 'but the money is still gone').toBe(share);
    expect(account.settledUnknownCount).toBe(1);
    expect(account.remainingOwnEnvelopeUsdMicros).toBe(account.envelopeUsdMicros - share);
  });

  it('keeps that money out of the pool another slot could borrow', () => {
    // THE ATTACK THIS CLOSES: if an unknown settlement freed its hold, every
    // dispatch by a provider that does not report price would hand its money
    // back and a second slot would spend it again.
    const spent = project([
      reserved('r1', 'PROMPT_ARCHITECT', share),
      settledUnknown('r1', 'PROMPT_ARCHITECT'),
    ]);
    const untouched = project([]);
    expect(spent.unallocatedUsdMicros).toBe(untouched.unallocatedUsdMicros - share);
  });

  it('cannot let a mission exceed its ceiling however silent its providers are', () => {
    // Every slot settles UNKNOWN, for ever. The mission may hold and spend the
    // ceiling and not one micro-dollar more.
    const rows: JuliusBudgetRow[] = [];
    let n = 0;
    for (const slot of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const) {
      for (let round = 0; round < 40; round += 1) {
        n += 1;
        const ledger = project(rows);
        const verdict = reserveJuliusSlotCapacity({ ledger, slot });
        if (!verdict.ok) continue;
        rows.push(reserved(`r${String(n)}`, slot, verdict.usdMicros));
        rows.push(settledUnknown(`r${String(n)}`, slot));
      }
    }
    const final = project(rows);
    const committed = (['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const)
      .reduce((sum, slot) => {
        const account = final.bySlot[slot]!;
        return sum + account.outstandingUsdMicros + account.settledKnownUsdMicros + account.settledUnknownUsdMicros;
      }, 0);
    expect(committed).toBeLessThanOrEqual(CEILING);
    expect(final.unallocatedUsdMicros).toBe(CEILING - committed);
    // And the mission does eventually stop granting, rather than granting
    // forever at a smaller and smaller amount.
    expect(reserveJuliusSlotCapacity({ ledger: final, slot: 'CODING_AGENT' }).ok).toBe(false);
  });

  it('frees a reservation ONLY when the row says nothing was sent', () => {
    const held = project([reserved('r1', 'CODING_AGENT', share), settledUnknown('r1', 'CODING_AGENT')]);
    const handed = project([reserved('r1', 'CODING_AGENT', share), releasedRow('r1', 'CODING_AGENT')]);
    expect(held.unallocatedUsdMicros).toBeLessThan(handed.unallocatedUsdMicros);
    expect(handed.bySlot.CODING_AGENT!.releasedUsdMicros).toBe(share);
    expect(handed.bySlot.CODING_AGENT!.settledUnknownUsdMicros).toBe(0);
    // Both rows carry the SAME basis and the SAME null amount. Only `released`
    // separates them, which is why it is a field and not an inference.
    expect(held.bySlot.CODING_AGENT!.settledUnknownUsdMicros).toBe(share);
  });
});

describe('a dispatch draws in a fixed order, and never out of another slot\'s pocket', () => {
  it('takes its own per-round share while its envelope covers one', () => {
    const verdict = reserveJuliusSlotCapacity({ ledger: project([]), slot: 'CODING_AGENT' });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.source).toBe('SLOT_SHARE');
    expect(verdict.usdMicros).toBe(slotRoundShareUsdMicros(POLICY(), 'CODING_AGENT'));
  });

  it('then whatever is left inside its own envelope', () => {
    const account = project([]).bySlot.CODING_AGENT!;
    const almostAll = account.envelopeUsdMicros - Math.floor(account.perRoundShareUsdMicros / 2);
    const verdict = reserveJuliusSlotCapacity({
      ledger: project([reserved('r1', 'CODING_AGENT', almostAll), settledKnown('r1', 'CODING_AGENT', almostAll)]),
      slot: 'CODING_AGENT',
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.source).toBe('SLOT_REMAINDER');
    expect(verdict.usdMicros).toBe(account.envelopeUsdMicros - almostAll);
  });

  it('then capacity NO slot is holding, and never a slot that is holding some', () => {
    const coder = project([]).bySlot.CODING_AGENT!;
    // The coder has spent its whole envelope. The architect is HOLDING its
    // entire envelope in an open reservation.
    const architect = project([]).bySlot.PROMPT_ARCHITECT!;
    const rows = [
      reserved('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      settledKnown('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      reserved('r2', 'PROMPT_ARCHITECT', architect.envelopeUsdMicros),
    ];
    const ledger = project(rows);
    expect(ledger.bySlot.PROMPT_ARCHITECT!.outstandingUsdMicros).toBe(architect.envelopeUsdMicros);

    const verdict = reserveJuliusSlotCapacity({ ledger, slot: 'CODING_AGENT' });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.source).toBe('REALLOCATED');
    // It borrowed from the REVIEWER's untouched envelope, which nobody holds —
    // never from the architect's open reservation.
    expect(verdict.usdMicros).toBeLessThanOrEqual(ledger.unallocatedUsdMicros);
    expect(ledger.unallocatedUsdMicros)
      .toBe(CEILING - coder.envelopeUsdMicros - architect.envelopeUsdMicros);
  });

  it('cannot borrow capacity whose settlement is conservatively outstanding', () => {
    const coder = project([]).bySlot.CODING_AGENT!;
    const reviewer = project([]).bySlot.INDEPENDENT_REVIEWER!;
    const withUnknown = project([
      reserved('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      settledKnown('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      reserved('r2', 'INDEPENDENT_REVIEWER', reviewer.envelopeUsdMicros),
      settledUnknown('r2', 'INDEPENDENT_REVIEWER'),
    ]);
    const withKnownZero = project([
      reserved('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      settledKnown('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      reserved('r2', 'INDEPENDENT_REVIEWER', reviewer.envelopeUsdMicros),
      settledKnown('r2', 'INDEPENDENT_REVIEWER', 0),
    ]);
    // The reviewer that REPORTED zero returns its envelope to the pool; the
    // one that reported nothing does not, and the difference is the whole
    // envelope rather than a rounding.
    expect(withKnownZero.unallocatedUsdMicros - withUnknown.unallocatedUsdMicros)
      .toBe(reviewer.envelopeUsdMicros);
  });

  it('cannot be drained by one dispatch, even with the whole mission unheld', () => {
    const coder = project([]).bySlot.CODING_AGENT!;
    const ledger = project([
      reserved('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      settledKnown('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
    ]);
    const verdict = reserveJuliusSlotCapacity({
      ledger, slot: 'CODING_AGENT', requestedUsdMicros: CEILING,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    // Bounded by ONE share however much is lying unheld and however much is
    // asked for.
    expect(verdict.usdMicros).toBe(coder.perRoundShareUsdMicros);
    expect(verdict.usdMicros).toBeLessThan(ledger.unallocatedUsdMicros);
  });

  it('refuses a slot with no envelope rather than inventing a share for it', () => {
    const verdict = reserveJuliusSlotCapacity({
      ledger: project([]), slot: 'SPECIALIST:security' as never,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('SLOT_NOT_A_PEER');
  });
});

describe('two dispatches cannot borrow the same dollar', () => {
  it('refuses the second decision made against a ledger the first has moved', () => {
    const coder = project([]).bySlot.CODING_AGENT!;
    const rows = [
      reserved('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
      settledKnown('r1', 'CODING_AGENT', coder.envelopeUsdMicros),
    ];
    const before = project(rows);

    // BOTH dispatches project the same ledger and both decide against it.
    const first = reserveJuliusSlotCapacity({ ledger: before, slot: 'CODING_AGENT', ifRevision: before.revision });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');

    // The first one's reservation reaches the durable ledger.
    rows.push(reserved('r2', 'CODING_AGENT', first.usdMicros));
    const after = project(rows);
    expect(after.revision).toBeGreaterThan(before.revision);

    // The second, still pinned to the revision it read, is refused rather than
    // granted money the first one already took.
    const second = reserveJuliusSlotCapacity({ ledger: after, slot: 'CODING_AGENT', ifRevision: before.revision });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.refusal).toBe('LEDGER_REVISION_STALE');

    // Re-projecting and deciding again is what makes it see what was taken.
    const retry = reserveJuliusSlotCapacity({ ledger: after, slot: 'CODING_AGENT', ifRevision: after.revision });
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error('unreachable');
    expect(retry.unallocatedUsdMicros).toBeLessThan(first.unallocatedUsdMicros);
  });

  it('counts a movement it cannot attribute, so an unreadable row still bumps the revision', () => {
    // A `budget.reserved` row written before the role and amount travelled with
    // it is a real ledger movement that cannot be attributed. Ignoring it
    // entirely would leave the revision unchanged and let a stale decision
    // through, so it counts toward the revision and toward no account.
    const legacy: JuliusBudgetRow = { type: 'budget.reserved', taskId: 't', facts: { reservationId: 'r0' } };
    const ledger = project([legacy]);
    expect(ledger.revision).toBe(1);
    expect(ledger.bySlot.CODING_AGENT!.outstandingUsdMicros).toBe(0);
    expect(ledger.unallocatedUsdMicros).toBe(CEILING);
  });
});

describe('a restart re-reads the money rather than re-creating it', () => {
  it('projects the same accounts from the same rows, twice', () => {
    const rows = [
      reserved('r1', 'CODING_AGENT', 2_000_000),
      settledKnown('r1', 'CODING_AGENT', 1_500_000),
      reserved('r2', 'PROMPT_ARCHITECT', 1_000_000),
      settledUnknown('r2', 'PROMPT_ARCHITECT'),
      reserved('r3', 'INDEPENDENT_REVIEWER', 800_000),
    ];
    expect(project(rows)).toEqual(project(rows));
  });

  it('does not hand back money a crashed process had already spent', () => {
    const rows = [
      reserved('r1', 'CODING_AGENT', 2_000_000),
      settledKnown('r1', 'CODING_AGENT', 2_000_000),
    ];
    const resumed = project(rows);
    expect(resumed.bySlot.CODING_AGENT!.settledKnownUsdMicros).toBe(2_000_000);
    expect(resumed.unallocatedUsdMicros).toBe(CEILING - 2_000_000);
  });

  it('keeps an in-flight reservation OUTSTANDING across the restart, not free', () => {
    // The dispatch that was running when the process died left a `reserved`
    // row and no settlement. The resumed process must see money that is held
    // and unaccounted for — `RESERVED_UNSETTLED` in the cost vocabulary — and
    // must not hand it to the next dispatch.
    const resumed = project([reserved('r1', 'CODING_AGENT', 2_000_000)]);
    expect(resumed.bySlot.CODING_AGENT!.outstandingUsdMicros).toBe(2_000_000);
    expect(resumed.bySlot.CODING_AGENT!.outstandingCount).toBe(1);
    expect(Object.keys(resumed.openReservations)).toEqual(['r1']);
    expect(resumed.unallocatedUsdMicros).toBe(CEILING - 2_000_000);
  });

  it('ignores a duplicate reservation row rather than charging it twice', () => {
    const once = project([reserved('r1', 'CODING_AGENT', 2_000_000)]);
    const twice = project([reserved('r1', 'CODING_AGENT', 2_000_000), reserved('r1', 'CODING_AGENT', 2_000_000)]);
    expect(twice.bySlot.CODING_AGENT!.outstandingUsdMicros).toBe(once.bySlot.CODING_AGENT!.outstandingUsdMicros);
    expect(twice.bySlot.CODING_AGENT!.reservationsOpened).toBe(1);
  });

  it('ignores a settlement for a reservation it never saw opened', () => {
    const ledger = project([settledKnown('ghost', 'CODING_AGENT', 999_999)]);
    expect(ledger.bySlot.CODING_AGENT!.settledKnownUsdMicros).toBe(0);
    expect(ledger.unallocatedUsdMicros).toBe(CEILING);
  });
});

describe('a slot outside the envelope still spends, and is still counted', () => {
  it('gives a specialist a zero-envelope account rather than dropping its rows', () => {
    // A mission cheaper than it was is the failure this whole module exists to
    // prevent, so an unrecognised role is accounted for even though it has no
    // share to claim.
    const ledger = project([
      reserved('r1', 'SPECIALIST:security', 500_000),
      settledKnown('r1', 'SPECIALIST:security', 400_000),
    ]);
    const account = ledger.bySlot['SPECIALIST:security']!;
    expect(account.envelopeUsdMicros).toBe(0);
    expect(account.settledKnownUsdMicros).toBe(400_000);
    expect(account.borrowedUsdMicros).toBe(400_000);
    expect(ledger.unallocatedUsdMicros).toBe(CEILING - 400_000);
  });
});

describe('a historical run is not reinterpreted under a rule it never ran beneath', () => {
  const allocated = (policyVersion: string): JuliusBudgetRow =>
    ({ type: 'budget.allocated', taskId: 't', facts: { role: 'CODING_AGENT', allocationPolicy: policyVersion } });

  it('records every policy the run\'s own rows name', () => {
    const ledger = project([allocated('julius-allocation.v2'), reserved('r1', 'CODING_AGENT', 1_000)]);
    expect(ledger.recordedPolicyVersions).toEqual(['julius-allocation.v2']);
    expect(ledger.historicalPolicyConflict).toBe(false);
  });

  it('flags a v1 run read under v2, and still projects the money', () => {
    // The money is the money: a v1 run's spend is real and must not vanish.
    // What may not happen is a v2 DECISION made from accounts that run never had.
    const ledger = project([
      allocated('julius-allocation.v1'),
      reserved('r1', 'CODING_AGENT', 7_500_000),
      settledKnown('r1', 'CODING_AGENT', 5_177_120),
    ]);
    expect(ledger.recordedPolicyVersions).toEqual(['julius-allocation.v1']);
    expect(ledger.historicalPolicyConflict).toBe(true);
    expect(ledger.bySlot.CODING_AGENT!.settledKnownUsdMicros).toBe(5_177_120);
    expect(ledger.unallocatedUsdMicros).toBe(CEILING - 5_177_120);
  });

  it('refuses to reserve against a conflicted ledger, by name', () => {
    const ledger = project([allocated('julius-allocation.v1'), reserved('r1', 'CODING_AGENT', 1_000)]);
    const verdict = reserveJuliusSlotCapacity({ ledger, slot: 'CODING_AGENT' });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('HISTORICAL_POLICY_CONFLICT');
    expect(verdict.detail).toContain('julius-allocation.v1');
  });

  it('catches a run that changed rule mid-flight, which is nobody\'s intention', () => {
    const ledger = project([allocated('julius-allocation.v1'), allocated('julius-allocation.v2')]);
    expect(ledger.recordedPolicyVersions).toEqual(['julius-allocation.v1', 'julius-allocation.v2']);
    expect(ledger.historicalPolicyConflict).toBe(true);
  });

  it('does not let an allocation row move the revision reservations are pinned to', () => {
    // An allocation is a decision recorded beside the money, not a movement of
    // it. Counting it would make every decision stale the moment another
    // dispatch was merely considered.
    const withDecision = project([allocated('julius-allocation.v2'), reserved('r1', 'CODING_AGENT', 1_000)]);
    const without = project([reserved('r1', 'CODING_AGENT', 1_000)]);
    expect(withDecision.revision).toBe(without.revision);
  });
});
