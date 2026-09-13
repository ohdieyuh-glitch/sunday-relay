/**
 * ALLOCATION v3 — ONE SHARED CEILING WITH PROTECTED PEER FLOORS.
 *
 * WHAT WAS WRONG WITH BOTH PREDECESSORS.
 *
 * v1 (`julius-allocation.v1`) has no per-slot dimension at all: the Coding
 * Agent draws an equal share of the WHOLE ceiling over its rounds, and the two
 * peers take a flat estimate out of the same pot. It funds one worker with two
 * commentators, which is the economics the peer architecture exists to end.
 *
 * v2 (`julius-allocation.v2`) gave each peer an envelope and then capped every
 * single dispatch at one per-round share of it. With this repository's own
 * figures — a 30,000,000 ceiling, three repair rounds, four segments — the
 * coder's per-round share is 2,499,750, and Mission 5's first dispatch really
 * settled 5,177,120. v2 would have refused to fund work that actually happened,
 * and no amount of unspent peer money could reach it, because the cap was on
 * the DISPATCH rather than on the mission.
 *
 * THE RULE HERE.
 *
 * A slot's floor is capacity no other slot may take. Everything above the
 * floors is one shared pool, and a dispatch may draw its own unspent floor PLUS
 * whatever of that pool is genuinely free — free meaning not held by anyone and
 * not set aside for repairs that are still authorised. So an expensive first
 * dispatch is funded out of the mission rather than out of a per-round quota,
 * while a peer that has not started yet still finds its floor intact when it
 * does.
 *
 * WHAT IS NEVER LENT:
 *   - another slot's protected floor;
 *   - an outstanding reservation, or one settled at an unknown amount, both of
 *     which the ledger already counts as committed;
 *   - capacity reserved for repair rounds this mission still authorises.
 *
 * The mission ceiling is authoritative over all of it: every grant is bounded
 * by what the MISSION has left, which is the one number that cannot be
 * double-counted because it is derived from every slot at once. That bound is
 * not a belt-and-braces addition — it is the fix for a 67% overspend this
 * repository shipped and caught, and removing it reintroduces the bug.
 *
 * THE PERCENTAGES ARE POLICY DATA. Floors and the repair reserve arrive as
 * basis points and are validated, not invented here. A mission that wants a
 * different split says so; what this module owns is the RULE.
 *
 * Pure: no clock, no store, no network.
 */

import { JULIUS_BUDGET_SLOTS } from './julius-slot-envelope';
import type { JuliusWorkerRole } from './julius-runtime';

export const JULIUS_SHARED_CEILING_VERSION = 'julius-allocation.v3' as const;
export const JULIUS_SHARED_CEILING_RULE = 'PROTECTED_FLOORS_OVER_ONE_SHARED_CEILING' as const;

/** Basis points, because a percentage of a ceiling is the thing being split. */
export const JULIUS_FLOOR_TOTAL_BPS = 10_000 as const;

/**
 * How small a peer's protected floor may get, and how large.
 *
 * The lower bound is what makes "peer" mean something: below it a slot is a
 * commentator with a budget line. The upper bound is what stops a mission
 * quietly restoring coder-dominant economics under a new name — 5/90/5 is
 * refused by construction rather than by review.
 */
export const JULIUS_FLOOR_BOUNDS: Readonly<Record<JuliusWorkerRole, { min: number; max: number }>> =
  Object.freeze({
    PROMPT_ARCHITECT: { min: 2_000, max: 4_500 },
    CODING_AGENT: { min: 2_000, max: 4_500 },
    INDEPENDENT_REVIEWER: { min: 2_000, max: 4_500 },
  } as Record<JuliusWorkerRole, { min: number; max: number }>);

/**
 * Floors that sum to less than the whole ceiling ON PURPOSE.
 *
 * The remainder is the shared pool — the thing v2 did not have. Equal thirds of
 * 75% leaves a quarter of the mission free to follow the work, which is what
 * funds a dispatch that legitimately costs more than its round's worth.
 */
export const JULIUS_DEFAULT_FLOORS_BPS: Readonly<Record<JuliusWorkerRole, number>> = Object.freeze({
  PROMPT_ARCHITECT: 2_500,
  CODING_AGENT: 2_500,
  INDEPENDENT_REVIEWER: 2_500,
} as Record<JuliusWorkerRole, number>);

/** Held back for repair rounds that are still authorised. Policy data. */
export const JULIUS_DEFAULT_REPAIR_RESERVE_BPS = 1_500 as const;
export const JULIUS_REPAIR_RESERVE_MAX_BPS = 4_000 as const;

/**
 * WHAT A DISPATCH IS GIVEN WHEN THE SPEND LEDGER CANNOT BE READ.
 *
 * This rule decides against what every slot currently holds, and only the
 * ledger can say that. With no ledger there are two answers, and which one is
 * honest depends on what the composition is for:
 *
 *   ESTIMATE  hold the fixed per-dispatch estimate, under a basis that names
 *             the absence (`ESTIMATE_NO_LEDGER`). An in-memory composition
 *             with no timeline relies on it, and until now it was the only
 *             behaviour.
 *   DENY      fund nothing, so no provider is reached. A paid mission needs
 *             this: the estimate is thirty cents, and Lab run 34739303313's
 *             coder was stopped by exactly that ceiling after two turns while
 *             the mission had authorised twenty dollars. A paid run that cannot
 *             read its own ledger must not spend at a figure nobody chose.
 *
 * POLICY DATA, defaulting to ESTIMATE, so every composition that builds this
 * policy without saying keeps the behaviour it was written against.
 */
export const JULIUS_WITHOUT_LEDGER_RULES = ['ESTIMATE', 'DENY'] as const;
export type JuliusWithoutLedgerRule = (typeof JULIUS_WITHOUT_LEDGER_RULES)[number];

export interface JuliusSharedCeilingPolicy {
  readonly version: typeof JULIUS_SHARED_CEILING_VERSION;
  readonly rule: typeof JULIUS_SHARED_CEILING_RULE;
  readonly ceilingUsdMicros: number;
  readonly authorizedRepairRounds: number;
  readonly floorsBps: Readonly<Record<JuliusWorkerRole, number>>;
  readonly repairReserveBps: number;
  /** What a dispatch is given when the ledger cannot be read. */
  readonly withoutLedger: JuliusWithoutLedgerRule;
}

const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

export function juliusSharedCeilingPolicy(input: {
  readonly ceilingUsdMicros: number;
  readonly authorizedRepairRounds: number;
  readonly floorsBps?: Readonly<Record<JuliusWorkerRole, number>>;
  readonly repairReserveBps?: number;
  readonly withoutLedger?: JuliusWithoutLedgerRule;
}): JuliusSharedCeilingPolicy {
  if (!isCount(input.ceilingUsdMicros)) throw new Error('shared_ceiling_ceiling_invalid');
  if (!isCount(input.authorizedRepairRounds)) throw new Error('shared_ceiling_repair_rounds_invalid');

  const floorsBps = input.floorsBps ?? JULIUS_DEFAULT_FLOORS_BPS;
  let total = 0;
  for (const slot of JULIUS_BUDGET_SLOTS) {
    const bps = floorsBps[slot];
    if (bps === undefined || !isCount(bps)) throw new Error('shared_ceiling_floor_invalid');
    const bounds = JULIUS_FLOOR_BOUNDS[slot];
    // REFUSED, NEVER CLAMPED. Silently correcting a split would hand the
    // mission an economics it did not choose and could not see.
    if (bps < bounds.min || bps > bounds.max) throw new Error('shared_ceiling_floor_out_of_bounds');
    total += bps;
  }

  const repairReserveBps = input.repairReserveBps ?? JULIUS_DEFAULT_REPAIR_RESERVE_BPS;
  if (!isCount(repairReserveBps) || repairReserveBps > JULIUS_REPAIR_RESERVE_MAX_BPS) {
    throw new Error('shared_ceiling_repair_reserve_invalid');
  }

  /**
   * THE POOL MUST EXIST. Floors plus the repair reserve consuming the whole
   * ceiling would leave nothing shared, which is v2 again with extra steps.
   */
  if (total + repairReserveBps >= JULIUS_FLOOR_TOTAL_BPS) {
    throw new Error('shared_ceiling_leaves_no_shared_pool');
  }

  const withoutLedger = input.withoutLedger ?? 'ESTIMATE';
  // REFUSED, NEVER DEFAULTED. A misspelt DENY silently read as ESTIMATE would
  // put a paid mission straight back on the thirty-cent figure.
  if (!(JULIUS_WITHOUT_LEDGER_RULES as readonly string[]).includes(withoutLedger)) {
    throw new Error('shared_ceiling_without_ledger_invalid');
  }

  return Object.freeze({
    version: JULIUS_SHARED_CEILING_VERSION,
    rule: JULIUS_SHARED_CEILING_RULE,
    ceilingUsdMicros: input.ceilingUsdMicros,
    authorizedRepairRounds: input.authorizedRepairRounds,
    floorsBps: Object.freeze({ ...floorsBps }),
    repairReserveBps,
    withoutLedger,
  });
}

export function juliusSlotFloorUsdMicros(
  policy: JuliusSharedCeilingPolicy,
  slot: JuliusWorkerRole,
): number {
  const bps = policy.floorsBps[slot];
  return bps === undefined ? 0 : Math.floor((policy.ceilingUsdMicros * bps) / JULIUS_FLOOR_TOTAL_BPS);
}

/**
 * Capacity held back for repairs that are still authorised.
 *
 * It SHRINKS as repair rounds are used: reserving for rounds that can no longer
 * happen would strand money at the end of every mission. `roundsUsed` is
 * counted from the run's own rows by the caller, never from a field.
 */
export function juliusRepairReserveUsdMicros(
  policy: JuliusSharedCeilingPolicy,
  roundsUsed: number,
): number {
  const remaining = Math.max(0, policy.authorizedRepairRounds - Math.max(0, roundsUsed));
  if (remaining === 0 || policy.authorizedRepairRounds === 0) return 0;
  const full = Math.floor((policy.ceilingUsdMicros * policy.repairReserveBps) / JULIUS_FLOOR_TOTAL_BPS);
  return Math.floor((full * remaining) / policy.authorizedRepairRounds);
}

export const JULIUS_SHARED_CEILING_SOURCES = [
  /** Drawn from the slot's own protected floor. */
  'OWN_FLOOR',
  /** Drawn from the shared pool, which nobody holds and nothing protects. */
  'SHARED_POOL',
] as const;
export type JuliusSharedCeilingSource = (typeof JULIUS_SHARED_CEILING_SOURCES)[number];

export interface JuliusSharedCeilingDraw {
  /** The most this slot may take right now, from both sources together. */
  readonly maxDrawUsdMicros: number;
  readonly ownFloorRemainingUsdMicros: number;
  readonly sharedPoolUsdMicros: number;
  /** What the other peers must still be able to reach. Never lent. */
  readonly protectedForPeersUsdMicros: number;
  readonly repairReserveUsdMicros: number;
}

/**
 * How much slot `slot` may draw, given what everyone currently holds.
 *
 * `heldBySlot` is committed money — outstanding reservations plus settlements,
 * known and unknown alike — which is exactly what the slot ledger already
 * computes. An unknown settlement is committed here for the same reason it is
 * committed there: a slot whose provider went silent has spent what it held
 * until something says otherwise, and treating that as free would lend money
 * twice.
 */
export function juliusSharedCeilingDraw(input: {
  readonly policy: JuliusSharedCeilingPolicy;
  readonly slot: JuliusWorkerRole;
  readonly heldBySlot: Readonly<Record<string, number>>;
  readonly unallocatedUsdMicros: number;
  readonly repairRoundsUsed: number;
}): JuliusSharedCeilingDraw {
  const missionRoom = Math.max(0, input.unallocatedUsdMicros);

  const ownFloor = juliusSlotFloorUsdMicros(input.policy, input.slot);
  const ownHeld = Math.max(0, input.heldBySlot[input.slot] ?? 0);
  const ownFloorRemaining = Math.max(0, ownFloor - ownHeld);

  let protectedForPeers = 0;
  for (const peer of JULIUS_BUDGET_SLOTS) {
    if (peer === input.slot) continue;
    const floor = juliusSlotFloorUsdMicros(input.policy, peer);
    const held = Math.max(0, input.heldBySlot[peer] ?? 0);
    protectedForPeers += Math.max(0, floor - held);
  }

  const repairReserve = juliusRepairReserveUsdMicros(input.policy, input.repairRoundsUsed);

  /**
   * THE SHARED POOL, and everything it is not.
   *
   * Mission room already excludes what anyone HOLDS. What remains still
   * contains three things that are spoken for: the peers' unmet floors, the
   * repair reserve, and THE ASKER'S OWN UNMET FLOOR. Subtracting all three
   * leaves the part that is free in the only sense that matters — nobody is
   * using it and nobody is owed it.
   *
   * The asker's own floor is subtracted here and added back at `maxDraw`. That
   * looks redundant and is not: leaving it in the pool counts it twice, once as
   * the floor this slot is entitled to and once as capacity anyone may take. A
   * test that asked whether the peers could still reach their floors after a
   * maximal draw caught exactly that — the coder could be granted 18,000,000 of
   * a 30,000,000 ceiling while 15,000,000 was supposedly protected. Same shape
   * as the 67% overspend: a quantity that is real in two places at once.
   */
  const sharedPool = Math.max(
    0,
    missionRoom - protectedForPeers - repairReserve - ownFloorRemaining,
  );

  return Object.freeze({
    // Bounded by mission room LAST, so no combination of the two sources can
    // exceed what the mission actually has. This is the overspend guard.
    maxDrawUsdMicros: Math.min(missionRoom, ownFloorRemaining + sharedPool),
    ownFloorRemainingUsdMicros: ownFloorRemaining,
    sharedPoolUsdMicros: sharedPool,
    protectedForPeersUsdMicros: protectedForPeers,
    repairReserveUsdMicros: repairReserve,
  });
}

/**
 * Which source a granted amount came out of, for the durable row.
 *
 * A grant inside the slot's own floor is its own money; anything beyond it
 * reached into the pool. Reported rather than derived later, because "was this
 * slot borrowing" is a question about the moment of the decision.
 */
export function juliusSharedCeilingSourceFor(
  granted: number,
  draw: JuliusSharedCeilingDraw,
): JuliusSharedCeilingSource {
  return granted <= draw.ownFloorRemainingUsdMicros ? 'OWN_FLOOR' : 'SHARED_POOL';
}
