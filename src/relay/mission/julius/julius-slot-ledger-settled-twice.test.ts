import { describe, expect, it } from 'vitest';

import {
  juliusReservationCharge, juliusSettlementReading, projectJuliusSlotLedger,
  type JuliusBudgetRow, type JuliusSettlementReading,
} from './julius-slot-ledger';

/**
 * (a2) STEP 3: A RESERVATION SETTLED MORE THAN ONCE IS CHARGED BY WHAT ITS ROWS PROVE.
 *
 * The slot ledger kept the FIRST settlement of a reservation and ignored the rest. Once recovery closes
 * what a lost attempt left open (step 2), a reservation can carry two rows honestly: the sweep's close,
 * and a late settlement from an attempt whose lease lapsed while it was still alive. First-wins then
 * under-counts:
 *   - closed UNKNOWN (charged the hold), then the provider's own larger figure: the figure was lost;
 *   - closed RELEASED ("nothing was sent"), then a figure: money spent read as money never sent.
 * The rule now, per reservation, with RELEASED rows saying only "nothing was sent" and never outweighing
 * a row that says something was: a known figure is charged, and where an UNKNOWN close stands beside
 * it, the larger of the figure and the hold. Nothing is ever summed: two rows for one reservation are
 * one dispatch's money, recorded twice. A single settlement is read exactly as before.
 */

const HOLD = 300_000;
const row = (facts: Record<string, unknown>): JuliusBudgetRow => ({ type: 'budget.settled', taskId: 't', facts: { reservationId: 'r1', role: 'CODING_AGENT', ...facts } });
const reserved: JuliusBudgetRow = { type: 'budget.reserved', taskId: 't', facts: { reservationId: 'r1', role: 'CODING_AGENT', usdMicros: HOLD } };
const released = row({ released: true, usdMicros: null, costBasis: 'UNKNOWN' });
const unknownClose = row({ released: false, usdMicros: null, costBasis: 'UNKNOWN' });
const known = (usdMicros: number) => row({ released: false, usdMicros, costBasis: 'PROVIDER_REPORTED' });
const executed = (executionUsdMicros: number) => row({ released: false, usdMicros: null, costBasis: 'NOT_APPLICABLE', executionUsdMicros });

const CEILING = 10_000_000;
const ledger = (...settlements: JuliusBudgetRow[]) => projectJuliusSlotLedger({
  runId: 'run-1', policy: null, policyVersion: 'test', ceilingUsdMicros: CEILING, rows: [reserved, ...settlements],
});
const coder = (...settlements: JuliusBudgetRow[]) => {
  const account = ledger(...settlements).bySlot.CODING_AGENT!;
  return {
    outstanding: account.outstandingUsdMicros, released: account.releasedUsdMicros,
    known: account.settledKnownUsdMicros, knownCount: account.settledKnownCount,
    unknown: account.settledUnknownUsdMicros, unknownCount: account.settledUnknownCount,
    execution: account.settledExecutionUsdMicros, executionCount: account.settledExecutionCount,
  };
};
const none = { outstanding: 0, released: 0, known: 0, knownCount: 0, unknown: 0, unknownCount: 0, execution: 0, executionCount: 0 };

describe('(a2) step 3: a reservation settled twice is charged by what its rows prove', () => {
  it('RED FIRST: an UNKNOWN close, then the provider’s larger figure: charged the figure, not the smaller hold', () => {
    expect(coder(unknownClose, known(500_000))).toEqual({ ...none, known: 500_000, knownCount: 1 });
  });

  it('an UNKNOWN close, then a smaller figure: charged the hold, the larger of the two', () => {
    expect(coder(unknownClose, known(100_000))).toEqual({ ...none, unknown: HOLD, unknownCount: 1 });
  });

  it('RED FIRST: a figure, then an UNKNOWN close: the larger of the two again, whichever came first', () => {
    expect(coder(known(100_000), unknownClose)).toEqual({ ...none, unknown: HOLD, unknownCount: 1 });
    expect(coder(known(500_000), unknownClose)).toEqual({ ...none, known: 500_000, knownCount: 1 });
  });

  it('RED FIRST: a RELEASED close, then a figure: money that was spent is charged, never hidden behind "nothing was sent"', () => {
    expect(coder(released, known(200_000))).toEqual({ ...none, known: 200_000, knownCount: 1 });
  });

  it('RED FIRST: two figures for one reservation: the larger, never the sum and never merely the first', () => {
    expect(coder(known(100_000), known(400_000))).toEqual({ ...none, known: 400_000, knownCount: 1 });
    expect(coder(known(400_000), known(100_000))).toEqual({ ...none, known: 400_000, knownCount: 1 });
  });

  it('RED FIRST: an UNKNOWN close, then a priced execution above the hold: charged the execution', () => {
    expect(coder(unknownClose, executed(600_000))).toEqual({ ...none, execution: 600_000, executionCount: 1 });
  });

  it('an UNKNOWN close, then a late FREE release: still the hold; a release never outweighs a row that says money may have gone', () => {
    expect(coder(unknownClose, released)).toEqual({ ...none, unknown: HOLD, unknownCount: 1 });
    expect(coder(released, unknownClose)).toEqual({ ...none, unknown: HOLD, unknownCount: 1 });
  });

  it('two free releases: released once', () => {
    expect(coder(released, released)).toEqual({ ...none, released: HOLD });
  });

  it('CONTROL: one settlement of each kind reads exactly as it always did', () => {
    expect(coder()).toEqual({ ...none, outstanding: HOLD });
    expect(coder(released)).toEqual({ ...none, released: HOLD });
    expect(coder(unknownClose)).toEqual({ ...none, unknown: HOLD, unknownCount: 1 });
    expect(coder(known(250_000))).toEqual({ ...none, known: 250_000, knownCount: 1 });
    expect(coder(known(0))).toEqual({ ...none, known: 0, knownCount: 1 });
    expect(coder(executed(80_000))).toEqual({ ...none, execution: 80_000, executionCount: 1 });
    expect(coder(row({ released: false, usdMicros: null, costBasis: 'NOT_APPLICABLE' })), 'no bill and no price: unknown').toEqual({ ...none, unknown: HOLD, unknownCount: 1 });
  });

  it('the mission is charged once per reservation: what is unallocated moves by the charge, never by the rows', () => {
    expect(ledger(unknownClose, known(500_000)).unallocatedUsdMicros).toBe(CEILING - 500_000);
    expect(ledger(known(100_000), known(400_000)).unallocatedUsdMicros).toBe(CEILING - 400_000);
    expect(ledger(released, known(200_000)).openReservations).toEqual({});
  });
});

describe('juliusReservationCharge, the one rule every reader applies', () => {
  const read = (settlement: JuliusBudgetRow): JuliusSettlementReading => juliusSettlementReading(settlement.facts);
  const charge = (...settlements: JuliusBudgetRow[]) => juliusReservationCharge(HOLD, settlements.map(read));

  it('reads a row once: released is stated, a figure needs a spend basis, an execution needs NOT_APPLICABLE', () => {
    expect(read(released)).toEqual({ released: true, knownUsdMicros: null, executionUsdMicros: null });
    expect(read(known(7))).toEqual({ released: false, knownUsdMicros: 7, executionUsdMicros: null });
    expect(read(executed(9))).toEqual({ released: false, knownUsdMicros: null, executionUsdMicros: 9 });
    expect(read(row({ released: 'true', usdMicros: 5, costBasis: 'ESTIMATED' })), 'a string is not the flag; an estimate is not a figure')
      .toEqual({ released: false, knownUsdMicros: null, executionUsdMicros: null });
  });

  it('is the same whatever the order of the rows', () => {
    const rows = [unknownClose, known(500_000), released, executed(700_000)];
    const expected = charge(...rows);
    expect(expected, 'the largest priced figure, in its own kind').toEqual({ kind: 'EXECUTION', usdMicros: 700_000 });
    for (const order of [[3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1]]) {
      expect(charge(...order.map((index) => rows[index]!)), order.join(',')).toEqual(expected);
    }
  });

  it('never returns less than what a single row of the set would have charged', () => {
    const singles = [released, unknownClose, known(100_000), known(500_000), executed(200_000), executed(600_000)];
    const amount = (result: ReturnType<typeof charge>) =>
      result.kind === 'KNOWN' || result.kind === 'EXECUTION' ? result.usdMicros : result.kind === 'UNKNOWN' || result.kind === 'OUTSTANDING' ? HOLD : 0;
    for (const a of singles) {
      for (const b of singles) {
        expect(amount(charge(a, b)), `${JSON.stringify(a.facts)} + ${JSON.stringify(b.facts)}`).toBeGreaterThanOrEqual(Math.max(amount(charge(a)), amount(charge(b))));
      }
    }
  });
});
