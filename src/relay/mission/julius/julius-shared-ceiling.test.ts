/**
 * ALLOCATION v3, AS A RULE RATHER THAN A SPLIT.
 *
 * The two things this has to get right at once are in tension, which is why
 * neither predecessor managed both: every peer must keep capacity it can count
 * on, AND a dispatch that legitimately costs more than a round's worth must be
 * fundable. v1 gave the second to one worker and denied the first to everyone;
 * v2 gave the first and made the second impossible.
 */

import { describe, expect, it } from 'vitest';

import {
  JULIUS_DEFAULT_FLOORS_BPS,
  JULIUS_FLOOR_TOTAL_BPS,
  JULIUS_SHARED_CEILING_VERSION,
  juliusRepairReserveUsdMicros,
  juliusSharedCeilingDraw,
  juliusSharedCeilingPolicy,
  juliusSharedCeilingSourceFor,
  juliusSlotFloorUsdMicros,
} from './julius-shared-ceiling';

/** The mission this repository actually ran, and what its coder actually cost. */
const CEILING = 30_000_000;
const REPAIR_ROUNDS = 3;
const MISSION_5_COST = 5_177_120;

const policy = (over: Partial<Parameters<typeof juliusSharedCeilingPolicy>[0]> = {}) =>
  juliusSharedCeilingPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS, ...over });

const NOTHING_HELD = { PROMPT_ARCHITECT: 0, CODING_AGENT: 0, INDEPENDENT_REVIEWER: 0 };

describe('the policy refuses economics it was built to end', () => {
  it('names itself v3 and freezes', () => {
    const p = policy();
    expect(p.version).toBe(JULIUS_SHARED_CEILING_VERSION);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.floorsBps)).toBe(true);
  });

  it('refuses a coder-dominant split rather than clamping it', () => {
    // 5/90/5 — the economics the peer architecture exists to end. Refused at
    // construction, so it cannot be reached by review failing to notice.
    expect(() => policy({
      floorsBps: { PROMPT_ARCHITECT: 500, CODING_AGENT: 9_000, INDEPENDENT_REVIEWER: 500 },
    })).toThrow('shared_ceiling_floor_out_of_bounds');
  });

  it('refuses floors that leave no shared pool', () => {
    // Floors summing with the repair reserve to the whole ceiling is v2 again
    // with extra steps: every dispatch back inside its own envelope.
    expect(() => policy({
      floorsBps: { PROMPT_ARCHITECT: 3_000, CODING_AGENT: 3_000, INDEPENDENT_REVIEWER: 3_000 },
      repairReserveBps: 1_000,
    })).toThrow('shared_ceiling_leaves_no_shared_pool');
  });

  it('leaves a real pool under its defaults', () => {
    const floors = Object.values(JULIUS_DEFAULT_FLOORS_BPS).reduce((sum, bps) => sum + bps, 0);
    expect(floors).toBeLessThan(JULIUS_FLOOR_TOTAL_BPS);
    // The pool is what funds an expensive dispatch. A rule whose floors summed
    // to the ceiling could not fund one however the money was arranged.
    expect(JULIUS_FLOOR_TOTAL_BPS - floors).toBeGreaterThan(0);
  });
});

describe('A — every peer keeps capacity it can count on', () => {
  it('never lends a peer floor to the slot that is asking', () => {
    const p = policy();
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: CEILING, repairRoundsUsed: 0,
    });
    const architectFloor = juliusSlotFloorUsdMicros(p, 'PROMPT_ARCHITECT');
    const reviewerFloor = juliusSlotFloorUsdMicros(p, 'INDEPENDENT_REVIEWER');
    expect(draw.protectedForPeersUsdMicros).toBe(architectFloor + reviewerFloor);
    // THE GUARANTEE, stated as arithmetic: whatever the coder takes, the two
    // peers can still reach their floors.
    expect(CEILING - draw.maxDrawUsdMicros).toBeGreaterThanOrEqual(architectFloor + reviewerFloor);
  });

  it('stops protecting a floor the peer has already spent into', () => {
    const p = policy();
    const architectFloor = juliusSlotFloorUsdMicros(p, 'PROMPT_ARCHITECT');
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT',
      heldBySlot: { ...NOTHING_HELD, PROMPT_ARCHITECT: architectFloor },
      unallocatedUsdMicros: CEILING - architectFloor, repairRoundsUsed: 0,
    });
    // Money the architect has ALREADY TAKEN is not protected a second time —
    // that would reserve the same dollar twice and strand it.
    expect(draw.protectedForPeersUsdMicros)
      .toBe(juliusSlotFloorUsdMicros(p, 'INDEPENDENT_REVIEWER'));
  });
});

describe('B — a legitimately expensive dispatch is funded', () => {
  it('funds Mission 5\'s real first dispatch, which v2 would have refused', () => {
    const p = policy();
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: CEILING, repairRoundsUsed: 0,
    });
    // THE REGRESSION THIS POLICY EXISTS FOR. Mission 5 settled 5,177,120 and
    // v2's per-round cap was 2,499,750.
    expect(draw.maxDrawUsdMicros).toBeGreaterThanOrEqual(MISSION_5_COST);
    // And it is funded out of the mission, not out of a quota: the draw exceeds
    // the coder's own floor alone only if the pool is genuinely reachable.
    expect(draw.ownFloorRemainingUsdMicros + draw.sharedPoolUsdMicros)
      .toBe(draw.maxDrawUsdMicros);
  });

  it('reports whether a grant came from the slot\'s own floor or the pool', () => {
    const p = policy();
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: CEILING, repairRoundsUsed: 0,
    });
    expect(juliusSharedCeilingSourceFor(1_000, draw)).toBe('OWN_FLOOR');
    expect(juliusSharedCeilingSourceFor(draw.ownFloorRemainingUsdMicros + 1, draw)).toBe('SHARED_POOL');
  });
});

describe('what is never lent', () => {
  it('does not lend money anyone is holding, settled or not', () => {
    const p = policy();
    // Mission room is what the ledger says is unheld. An outstanding
    // reservation and an unknown settlement are both already excluded from it,
    // which is why this rule reads that number rather than recomputing one.
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: { ...NOTHING_HELD, INDEPENDENT_REVIEWER: 9_000_000 },
      unallocatedUsdMicros: CEILING - 9_000_000, repairRoundsUsed: 0,
    });
    expect(draw.maxDrawUsdMicros).toBeLessThanOrEqual(CEILING - 9_000_000);
  });

  it('holds capacity back for repair rounds that can still happen', () => {
    const p = policy();
    const fresh = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: CEILING, repairRoundsUsed: 0,
    });
    expect(fresh.repairReserveUsdMicros).toBeGreaterThan(0);

    // AND RELEASES IT AS THE ROUNDS ARE USED. Reserving for rounds that can no
    // longer happen would strand money at the end of every mission.
    const spent = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: CEILING, repairRoundsUsed: REPAIR_ROUNDS,
    });
    expect(spent.repairReserveUsdMicros).toBe(0);
    expect(spent.maxDrawUsdMicros).toBeGreaterThan(fresh.maxDrawUsdMicros);
  });

  it('reserves nothing when the mission authorised no repairs', () => {
    expect(juliusRepairReserveUsdMicros(policy({ authorizedRepairRounds: 0 }), 0)).toBe(0);
  });
});

describe('the mission ceiling is authoritative over every combination', () => {
  it('never grants more than the mission has left, however the sources add up', () => {
    const p = policy();
    // A ledger that has almost nothing free. Own floor plus pool must not be
    // able to conjure capacity past it — this is the 67% overspend guard, in
    // the one place a new rule could lose it.
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: 1_000, repairRoundsUsed: 0,
    });
    expect(draw.maxDrawUsdMicros).toBeLessThanOrEqual(1_000);
  });

  it('grants nothing at all once the mission is spent', () => {
    const p = policy();
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: NOTHING_HELD,
      unallocatedUsdMicros: 0, repairRoundsUsed: 0,
    });
    expect(draw.maxDrawUsdMicros).toBe(0);
  });

  it('cannot be driven negative by a ledger reporting nonsense', () => {
    const p = policy();
    const draw = juliusSharedCeilingDraw({
      policy: p, slot: 'CODING_AGENT', heldBySlot: { ...NOTHING_HELD, CODING_AGENT: -5 },
      unallocatedUsdMicros: -1_000, repairRoundsUsed: -2,
    });
    expect(draw.maxDrawUsdMicros).toBe(0);
    expect(draw.sharedPoolUsdMicros).toBeGreaterThanOrEqual(0);
    expect(draw.repairReserveUsdMicros).toBeGreaterThanOrEqual(0);
  });
});

describe('no slot can drain the mission by repetition', () => {
  it('shrinks the draw as the slot itself accumulates holdings', () => {
    const p = policy();
    let held = 0;
    let total = 0;
    for (let round = 0; round < 20; round += 1) {
      const draw = juliusSharedCeilingDraw({
        policy: p, slot: 'CODING_AGENT',
        heldBySlot: { ...NOTHING_HELD, CODING_AGENT: held },
        unallocatedUsdMicros: CEILING - held, repairRoundsUsed: 0,
      });
      const granted = Math.min(MISSION_5_COST, draw.maxDrawUsdMicros);
      held += granted;
      total += granted;
    }
    // TWENTY ROUNDS OF THE MOST EXPENSIVE DISPATCH THIS MISSION EVER SAW, and
    // the peers' floors plus the repair reserve are still standing.
    expect(total).toBeLessThanOrEqual(CEILING);
    const peersProtected = juliusSlotFloorUsdMicros(p, 'PROMPT_ARCHITECT')
      + juliusSlotFloorUsdMicros(p, 'INDEPENDENT_REVIEWER');
    expect(CEILING - total).toBeGreaterThanOrEqual(peersProtected);
  });
});
