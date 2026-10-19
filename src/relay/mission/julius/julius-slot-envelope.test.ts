import { describe, expect, it } from 'vitest';

import { coderShareUsdMicros, juliusAllocationPolicy } from './julius-allocation-runtime';
import {
  JULIUS_BUDGET_SLOTS, JULIUS_DEFAULT_SLOT_SHARES_BPS, JULIUS_SLOT_SHARE_TOTAL_BPS,
  evaluateJuliusSlotAllocation, juliusRoundsPerSlot, juliusSlotEnvelopePolicy,
  slotEnvelopeUsdMicros, slotRoundShareUsdMicros,
} from './julius-slot-envelope';

const CEILING = 30_000_000; // $30, Mission 5's own ceiling.
const policy = (over: Partial<Parameters<typeof juliusSlotEnvelopePolicy>[0]> = {}) =>
  juliusSlotEnvelopePolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: 3, maxCoderSegments: 4, ...over });

describe('the three slots are peers in the ledger, not on paper only', () => {
  /**
   * THE NUMBER THIS CHANGE EXISTS TO END. Under v1 Mission 5 allocated the
   * coder $7.50 and the architect and reviewer 300,000 micro-dollars each —
   * four cents on the coder's dollar.
   */
  it('v1 funded the architect at four cents on the coder dollar; v2 does not', () => {
    const v1 = juliusAllocationPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: 3 });
    const v1Coder = coderShareUsdMicros(v1);
    const v1Architect = 300_000; // the fixed ESTIMATE every non-coder received
    expect(v1Coder).toBe(7_500_000);
    expect(v1Architect / v1Coder).toBeLessThan(0.05);

    const v2 = policy();
    const ratio = slotEnvelopeUsdMicros(v2, 'PROMPT_ARCHITECT') / slotEnvelopeUsdMicros(v2, 'CODING_AGENT');
    expect(ratio, 'the architect envelope is a peer of the coder envelope').toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it('the default split is an equal third each and totals exactly the ceiling in basis points', () => {
    const total = JULIUS_BUDGET_SLOTS.reduce((sum, slot) => sum + (JULIUS_DEFAULT_SLOT_SHARES_BPS[slot] ?? 0), 0);
    expect(total).toBe(JULIUS_SLOT_SHARE_TOTAL_BPS);
    const p = policy();
    for (const slot of JULIUS_BUDGET_SLOTS) {
      const share = slotEnvelopeUsdMicros(p, slot) / CEILING;
      expect(share, `${slot} sits inside the founder's 30-35% envelope`).toBeGreaterThan(0.30);
      expect(share).toBeLessThan(0.35);
    }
  });

  /**
   * THE SHARES ARE DATA. A mission may say 35/35/30. It may not say 5/90/5 —
   * that is the shape this change exists to end, and it is REFUSED rather than
   * clamped, because clamping would silently run a mission nobody configured.
   */
  it('a configured split inside the envelope is accepted, and one outside it is refused', () => {
    expect(() => policy({ sharesBps: { PROMPT_ARCHITECT: 3_500, CODING_AGENT: 3_500, INDEPENDENT_REVIEWER: 3_000 } })).not.toThrow();
    expect(() => policy({ sharesBps: { PROMPT_ARCHITECT: 500, CODING_AGENT: 9_000, INDEPENDENT_REVIEWER: 500 } }))
      .toThrow('slot_envelope_share_out_of_bounds');
    expect(() => policy({ sharesBps: { PROMPT_ARCHITECT: 3_000, CODING_AGENT: 3_000, INDEPENDENT_REVIEWER: 3_000 } }))
      .toThrow('slot_envelope_shares_must_total_10000');
  });

  /**
   * The reviewer reviews everything the other two produce, so it is authorised
   * the most dispatches — which is exactly why funding it like a bookend made
   * it structurally the shallowest worker in the mission.
   */
  it('authorised rounds come from the contract, and the reviewer has the most', () => {
    const rounds = juliusRoundsPerSlot({ authorizedRepairRounds: 3, maxCoderSegments: 4 });
    expect(rounds.CODING_AGENT).toBe(4);
    expect(rounds.PROMPT_ARCHITECT).toBe(8);
    expect(rounds.INDEPENDENT_REVIEWER).toBe(12);
    expect(rounds.INDEPENDENT_REVIEWER).toBeGreaterThan(rounds.CODING_AGENT);
  });
});

describe('a dispatch draws its own share, then its envelope, then only what nobody holds', () => {
  const p = policy();
  const alloc = (over: Partial<Parameters<typeof evaluateJuliusSlotAllocation>[0]>) =>
    evaluateJuliusSlotAllocation({
      policy: p, role: 'CODING_AGENT', slotRemainingUsdMicros: 99_000_000,
      unreservedUsdMicros: 99_000_000, estimateUsdMicros: 300_000, ...over,
    });

  it('takes its own per-round share when the slot envelope covers it', () => {
    const result = alloc({});
    expect(result.basis).toBe('SLOT_SHARE');
    expect(result.usdMicros).toBe(slotRoundShareUsdMicros(p, 'CODING_AGENT'));
  });

  it('takes what remains inside its own envelope when that is less than a share', () => {
    const result = alloc({ slotRemainingUsdMicros: 1_000 });
    expect(result.basis).toBe('SLOT_REMAINDER');
    expect(result.usdMicros).toBe(1_000);
  });

  /**
   * REALLOCATION IS THE POINT. A slot that genuinely needed less leaves money
   * available; a slot that needs more may draw it. Mission 5's architect and
   * reviewer settled UNKNOWN having held almost nothing, so under v2 that
   * unspent envelope is what a hungry coder draws on.
   */
  it('draws from the unreserved remainder once its own envelope is spent', () => {
    const result = alloc({ slotRemainingUsdMicros: 0, unreservedUsdMicros: 5_000_000 });
    expect(result.basis).toBe('REALLOCATED');
    expect(result.usdMicros).toBeGreaterThan(0);
    // Bounded by one share, so a single dispatch cannot drain the mission.
    expect(result.usdMicros).toBeLessThanOrEqual(slotRoundShareUsdMicros(p, 'CODING_AGENT'));
  });

  it('never takes money another slot is already holding', () => {
    // The slot is spent and NOTHING is unreserved: every remaining micro-dollar
    // belongs to some other slot's outstanding reservation.
    const result = alloc({ slotRemainingUsdMicros: 0, unreservedUsdMicros: 0 });
    expect(result.basis).toBe('EXHAUSTED');
    expect(result.usdMicros).toBe(0);
  });

  it('an unreadable ledger is conservative, never unlimited', () => {
    const result = alloc({ slotRemainingUsdMicros: null, estimateUsdMicros: 1_000 });
    expect(result.basis).toBe('BUDGET_UNKNOWN');
    expect(result.usdMicros).toBe(1_000);
  });

  it('an exhausted mission denies every slot equally', () => {
    for (const slot of JULIUS_BUDGET_SLOTS) {
      const result = alloc({ role: slot, slotRemainingUsdMicros: 0, unreservedUsdMicros: 0 });
      expect(result.basis, `${slot} is denied`).toBe('EXHAUSTED');
      expect(result.usdMicros).toBe(0);
    }
  });

  /** This is an envelope, not a quota: a slot that needs nothing reserves nothing. */
  it('is a floor on what a slot may draw, never a target it must reach', () => {
    const result = alloc({ role: 'INDEPENDENT_REVIEWER', slotRemainingUsdMicros: 10, unreservedUsdMicros: 0 });
    expect(result.usdMicros, 'takes only what it asked for').toBe(10);
  });
});
