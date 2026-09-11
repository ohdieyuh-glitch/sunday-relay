import { safeJuliusCostBasis, type JuliusCostBasis } from './julius-cost-accounting';
import type { JuliusWorkerRole } from './julius-runtime';
import {
  JULIUS_BUDGET_SLOTS, slotEnvelopeUsdMicros, slotRoundShareUsdMicros,
  type JuliusSlotEnvelopePolicy,
} from './julius-slot-envelope';

/**
 * WHAT EACH PEER SLOT HOLDS, HAS SPENT, AND MAY STILL DRAW — from the durable
 * ledger rather than from a counter.
 *
 * `julius-slot-envelope` decides what ONE dispatch may spend. This is the other
 * half: the state that decision is made against. It was previously approximated
 * in the pipeline as `envelope - rounds x share`, which is a conservative lower
 * bound and nothing more — it cannot tell a reservation still open from one
 * settled for less than it held, and it cannot say whose money a borrowed
 * dollar was.
 *
 * PROJECTED FROM EVENTS, NOT STORED. `budget.reserved` and `budget.settled` are
 * already written durably for every dispatch, and the timeline reader already
 * exists on both the memory store and PostgreSQL. So the slot ledger needs no
 * table, cannot drift from the money record, and survives a restart for the
 * same reason `nextSegmentNumber` does: it is derived from rows that exist. A
 * resumed process re-reads the same events and reaches the same accounts.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: **AN UNKNOWN SETTLEMENT IS NOT A
 * REFUND.** Live Run 3 recorded $0.608861 for a mission where three of four
 * components reported nothing; the Prompt Architect and the Independent
 * Reviewer routinely settle with no amount at all. If an unknown settlement
 * freed its reservation, every dispatch by a provider that does not report
 * price would hand its money back to the mission and another slot would spend
 * it a second time. So an unknown settlement CONVERTS the hold rather than
 * releasing it: the money leaves `outstanding` and enters
 * `settledUnknown`, where it is still gone.
 *
 * The cost of that rule is stated rather than hidden: a slot whose provider is
 * silent is charged what it RESERVED, which may be more than it spent. That
 * over-charges the mission's own accounting and never under-charges it, and
 * over-charging is the only direction that cannot overspend a ceiling.
 *
 * Pure: no clock, no store, no network.
 */

export const JULIUS_SLOT_LEDGER_VERSION = 'julius-slot-ledger.v1' as const;

/** Where a dispatch's money came from. Recorded so a reader can see borrowing. */
export const JULIUS_SLOT_SOURCES = ['SLOT_SHARE', 'SLOT_REMAINDER', 'REALLOCATED'] as const;
export type JuliusSlotSource = (typeof JULIUS_SLOT_SOURCES)[number];

/** Why a reservation could not be made. Each names a different next move. */
export const JULIUS_SLOT_RESERVE_REFUSALS = [
  /** The ledger moved under this caller. Re-project and try again. */
  'LEDGER_REVISION_STALE',
  /** Neither this slot's envelope nor unheld mission capacity has anything. */
  'MISSION_CAPACITY_EXHAUSTED',
  /** Not one of the three peer slots; a specialist draws its fixed estimate. */
  'SLOT_NOT_A_PEER',
  'AMOUNT_INVALID',
  /**
   * The run's own rows name a different allocation policy. Its evidence is not
   * reinterpreted under a rule it never ran beneath.
   */
  'HISTORICAL_POLICY_CONFLICT',
] as const;
export type JuliusSlotReserveRefusal = (typeof JULIUS_SLOT_RESERVE_REFUSALS)[number];

export interface JuliusSlotReservation {
  readonly reservationId: string;
  readonly slot: JuliusWorkerRole;
  readonly taskId: string;
  readonly usdMicros: number;
}

/**
 * ONE SLOT'S POSITION. Every field the founder's directive asks for, and each
 * one is either measured or explicitly unknown — never inferred.
 */
export interface JuliusSlotAccount {
  readonly slot: JuliusWorkerRole;
  /** The configured share of the ceiling, in micro-dollars. */
  readonly envelopeUsdMicros: number;
  /** Dispatches the contract authorises for this slot. */
  readonly authorizedRounds: number;
  /** What ONE dispatch of this slot may draw from its own envelope. */
  readonly perRoundShareUsdMicros: number;
  /** Reservations opened. Not the same as dispatches that finished. */
  readonly reservationsOpened: number;
  /** Money held right now by reservations that have not settled. */
  readonly outstandingUsdMicros: number;
  readonly outstandingCount: number;
  /** Settled with an amount somebody actually reported. */
  readonly settledKnownUsdMicros: number;
  readonly settledKnownCount: number;
  /**
   * Settled with NO amount. Held against the envelope permanently, at what the
   * reservation held, because a cost nobody reported is not a cost of zero.
   */
  readonly settledUnknownUsdMicros: number;
  readonly settledUnknownCount: number;
  /** Released without a spend — a dispatch that never reached a provider. */
  readonly releasedUsdMicros: number;
  /** envelope − outstanding − known − unknown, floored at zero. */
  readonly remainingOwnEnvelopeUsdMicros: number;
  /** Money this slot drew from capacity no slot was holding. */
  readonly borrowedUsdMicros: number;
}

export interface JuliusMissionSlotLedger {
  readonly version: typeof JULIUS_SLOT_LEDGER_VERSION;
  readonly runId: string;
  readonly policyVersion: string;
  readonly ceilingUsdMicros: number;
  readonly bySlot: Readonly<Record<string, JuliusSlotAccount>>;
  readonly openReservations: Readonly<Record<string, JuliusSlotReservation>>;
  /**
   * Ceiling minus everything any slot holds or has spent — the only pool a
   * slot may borrow from. Capacity whose settlement is conservatively
   * outstanding is NOT in it, because `settledUnknown` is subtracted like any
   * other spend.
   */
  readonly unallocatedUsdMicros: number;
  /**
   * EVERY ALLOCATION POLICY THIS RUN'S OWN ROWS NAME, in the order first seen.
   *
   * A run records the governing policy on every `budget.allocated` row, so the
   * durable record states which rule produced each number and nobody has to
   * infer it from the code that happens to be deployed today.
   */
  readonly recordedPolicyVersions: readonly string[];
  /**
   * TRUE WHEN THE ROWS DISAGREE WITH THE POLICY BEING APPLIED.
   *
   * A historical run allocated under `julius-allocation.v1` has no slot
   * envelopes, and reading its rows as if it did would invent a per-slot
   * position nobody ever decided — evidence migrated silently, which is the
   * thing the founder's directive forbids by name. The projection still builds
   * (the money is the money) and the flag says the accounts must not be used to
   * MAKE a v2 decision.
   */
  readonly historicalPolicyConflict: boolean;
  /**
   * How many durable budget rows this ledger was built from. A reservation
   * pinned to a stale revision is refused, which is what makes two concurrent
   * dispatches unable to borrow the same dollar.
   */
  readonly revision: number;
}

/* ----------------------------------------------------------- projection */

/** One durable budget row, as the timeline carries it. */
export interface JuliusBudgetRow {
  readonly type: string;
  readonly taskId: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

const emptyAccount = (
  slot: JuliusWorkerRole, policy: JuliusSlotEnvelopePolicy | null,
): JuliusSlotAccount => ({
  slot,
  envelopeUsdMicros: policy === null ? 0 : slotEnvelopeUsdMicros(policy, slot),
  authorizedRounds: policy === null ? 0 : (policy.roundsPerSlot[slot] ?? 0),
  perRoundShareUsdMicros: policy === null ? 0 : slotRoundShareUsdMicros(policy, slot),
  reservationsOpened: 0,
  outstandingUsdMicros: 0,
  outstandingCount: 0,
  settledKnownUsdMicros: 0,
  settledKnownCount: 0,
  settledUnknownUsdMicros: 0,
  settledUnknownCount: 0,
  releasedUsdMicros: 0,
  remainingOwnEnvelopeUsdMicros: policy === null ? 0 : slotEnvelopeUsdMicros(policy, slot),
  borrowedUsdMicros: 0,
});

/** A settlement that reports no usable amount is unknown, whatever it claims. */
const settlementIsKnown = (basis: JuliusCostBasis, usdMicros: number | null): boolean =>
  usdMicros !== null && (basis === 'PROVIDER_REPORTED' || basis === 'MEASURED_FROM_USAGE');

/**
 * Build the ledger from the run's own durable budget rows.
 *
 * ORDER IS THE LEDGER'S, NOT THE CALLER'S. Rows arrive in timeline sequence,
 * which is the order the money moved; a reservation settled before it was
 * opened is impossible in that order and is ignored rather than invented.
 */
export function projectJuliusSlotLedger(input: {
  readonly runId: string;
  readonly policy: JuliusSlotEnvelopePolicy | null;
  readonly policyVersion: string;
  readonly ceilingUsdMicros: number;
  readonly rows: readonly JuliusBudgetRow[];
}): JuliusMissionSlotLedger {
  const accounts = new Map<string, JuliusSlotAccount>();
  for (const slot of JULIUS_BUDGET_SLOTS) accounts.set(slot, emptyAccount(slot, input.policy));
  const open = new Map<string, JuliusSlotReservation>();
  const recordedPolicies: string[] = [];
  let revision = 0;

  const accountFor = (slot: string): JuliusSlotAccount => {
    const existing = accounts.get(slot);
    if (existing !== undefined) return existing;
    // A SPECIALIST or an unrecognised role still SPENDS, and a ledger that
    // dropped its rows would report a mission cheaper than it was. It gets an
    // account with a zero envelope: it may hold and settle, and it may never
    // claim a share it was never given.
    const created = emptyAccount(slot as JuliusWorkerRole, null);
    accounts.set(slot, created);
    return created;
  };

  for (const row of input.rows) {
    if (row.type === 'budget.allocated') {
      // NOT A MOVEMENT. An allocation is a decision recorded beside the money,
      // so it names the rule without touching the revision the reservations
      // are pinned to.
      const recorded = text(row.facts.allocationPolicy);
      if (recorded !== null && !recordedPolicies.includes(recorded)) recordedPolicies.push(recorded);
      continue;
    }
    if (row.type === 'budget.reserved') {
      const reservationId = text(row.facts.reservationId);
      const slot = text(row.facts.role);
      const usdMicros = num(row.facts.usdMicros);
      revision += 1;
      // A row from before `budget.reserved` carried its role and amount cannot
      // be attributed. It is COUNTED in the revision — it is a real ledger
      // movement — and left out of the accounts rather than guessed at.
      if (reservationId === null || slot === null || usdMicros === null) continue;
      if (open.has(reservationId)) continue;
      open.set(reservationId, { reservationId, slot: slot as JuliusWorkerRole, taskId: row.taskId ?? '', usdMicros });
      const account = accountFor(slot);
      accounts.set(slot, {
        ...account,
        reservationsOpened: account.reservationsOpened + 1,
        outstandingUsdMicros: account.outstandingUsdMicros + usdMicros,
        outstandingCount: account.outstandingCount + 1,
      });
      continue;
    }
    if (row.type !== 'budget.settled') continue;
    revision += 1;
    const reservationId = text(row.facts.reservationId);
    if (reservationId === null) continue;
    const reservation = open.get(reservationId);
    if (reservation === undefined) continue;
    open.delete(reservationId);

    const basis = safeJuliusCostBasis(row.facts.costBasis);
    const reported = num(row.facts.usdMicros);
    const account = accountFor(reservation.slot);
    const released = row.facts.released === true;

    if (released) {
      // NOTHING WAS SENT. The only case that genuinely frees capacity, and the
      // caller states it explicitly — this is never inferred from a null.
      accounts.set(reservation.slot, {
        ...account,
        outstandingUsdMicros: account.outstandingUsdMicros - reservation.usdMicros,
        outstandingCount: account.outstandingCount - 1,
        releasedUsdMicros: account.releasedUsdMicros + reservation.usdMicros,
      });
      continue;
    }
    if (settlementIsKnown(basis, reported)) {
      accounts.set(reservation.slot, {
        ...account,
        outstandingUsdMicros: account.outstandingUsdMicros - reservation.usdMicros,
        outstandingCount: account.outstandingCount - 1,
        settledKnownUsdMicros: account.settledKnownUsdMicros + (reported as number),
        settledKnownCount: account.settledKnownCount + 1,
      });
      continue;
    }
    // UNKNOWN. Charged at what it HELD, not at nothing.
    accounts.set(reservation.slot, {
      ...account,
      outstandingUsdMicros: account.outstandingUsdMicros - reservation.usdMicros,
      outstandingCount: account.outstandingCount - 1,
      settledUnknownUsdMicros: account.settledUnknownUsdMicros + reservation.usdMicros,
      settledUnknownCount: account.settledUnknownCount + 1,
    });
  }

  let committed = 0;
  const bySlot: Record<string, JuliusSlotAccount> = {};
  for (const [slot, account] of accounts) {
    const held = account.outstandingUsdMicros + account.settledKnownUsdMicros + account.settledUnknownUsdMicros;
    committed += held;
    bySlot[slot] = Object.freeze({
      ...account,
      remainingOwnEnvelopeUsdMicros: Math.max(0, account.envelopeUsdMicros - held),
      borrowedUsdMicros: Math.max(0, held - account.envelopeUsdMicros),
    });
  }

  return Object.freeze({
    version: JULIUS_SLOT_LEDGER_VERSION,
    runId: input.runId,
    policyVersion: input.policyVersion,
    ceilingUsdMicros: input.ceilingUsdMicros,
    bySlot: Object.freeze(bySlot),
    openReservations: Object.freeze(Object.fromEntries(open)),
    unallocatedUsdMicros: Math.max(0, input.ceilingUsdMicros - committed),
    recordedPolicyVersions: Object.freeze([...recordedPolicies]),
    historicalPolicyConflict: recordedPolicies.some((recorded) => recorded !== input.policyVersion),
    revision,
  });
}

/* ------------------------------------------------------------- reserving */

export type JuliusSlotReserveVerdict =
  | {
    readonly ok: true;
    readonly usdMicros: number;
    readonly source: JuliusSlotSource;
    readonly slot: JuliusWorkerRole;
    readonly perRoundShareUsdMicros: number;
    readonly remainingOwnEnvelopeUsdMicros: number;
    readonly unallocatedUsdMicros: number;
    readonly ledgerRevision: number;
  }
  | {
    readonly ok: false;
    readonly refusal: JuliusSlotReserveRefusal;
    readonly detail: string;
    readonly ledgerRevision: number;
  };

/**
 * WHAT THIS DISPATCH MAY DRAW, and out of whose pocket.
 *
 * Own per-round share first; then whatever is left inside this slot's OWN
 * envelope; then, and only then, capacity no slot is holding — still bounded by
 * one share, so a single dispatch cannot drain a mission even when every peer
 * has finished cheaply.
 *
 * NEVER ANOTHER SLOT'S ACTIVE RESERVATION, and that is arithmetic rather than a
 * promise: `unallocatedUsdMicros` subtracts every slot's outstanding holdings
 * before the subtraction that produces it, so a dollar another slot is holding
 * is not in the pool this function draws from. The same subtraction removes
 * capacity whose settlement is conservatively outstanding.
 *
 * `ifRevision` is the concurrency guard. Two dispatches that both projected the
 * same ledger cannot both reserve against it: the second is refused
 * `LEDGER_REVISION_STALE` and re-projects, which is the only way the second one
 * can see what the first took.
 */
export function reserveJuliusSlotCapacity(input: {
  readonly ledger: JuliusMissionSlotLedger;
  readonly slot: JuliusWorkerRole;
  /**
   * What this dispatch asks for. OMITTED means "my share" — the ordinary case,
   * and the reason it is optional: a caller that had to compute the share
   * itself in order to ask for it would be deciding the thing this function
   * exists to decide, and the two would eventually disagree.
   */
  readonly requestedUsdMicros?: number;
  /** The revision the caller decided against. Omit only when not racing. */
  readonly ifRevision?: number;
}): JuliusSlotReserveVerdict {
  const { ledger, slot } = input;
  const refuse = (refusal: JuliusSlotReserveRefusal, detail: string): JuliusSlotReserveVerdict =>
    ({ ok: false, refusal, detail, ledgerRevision: ledger.revision });

  if (ledger.historicalPolicyConflict) {
    return refuse(
      'HISTORICAL_POLICY_CONFLICT',
      `This run's own rows were allocated under ${ledger.recordedPolicyVersions.join(', ')} and this decision `
      + `would be made under ${ledger.policyVersion}. A historical run is not reinterpreted under a rule it `
      + 'never ran beneath.',
    );
  }
  if (input.ifRevision !== undefined && input.ifRevision !== ledger.revision) {
    return refuse(
      'LEDGER_REVISION_STALE',
      `This decision was made against ledger revision ${String(input.ifRevision)} and the ledger is at `
      + `${String(ledger.revision)}. Re-project and decide again rather than spend a number that is already wrong.`,
    );
  }
  if (input.requestedUsdMicros !== undefined
    && (!Number.isFinite(input.requestedUsdMicros) || input.requestedUsdMicros <= 0)) {
    return refuse('AMOUNT_INVALID', 'A reservation that names an amount must name a positive one.');
  }
  const account = ledger.bySlot[slot];
  if (account === undefined || account.envelopeUsdMicros <= 0) {
    return refuse(
      'SLOT_NOT_A_PEER',
      `${slot} has no configured envelope in this mission, so it draws its fixed estimate rather than a share.`,
    );
  }

  const share = account.perRoundShareUsdMicros;
  const own = account.remainingOwnEnvelopeUsdMicros;
  const requested = input.requestedUsdMicros ?? Math.max(share, 1);
  /**
   * THE MISSION BOUND APPLIES TO EVERY GRANT, NOT ONLY TO BORROWING.
   *
   * The first version checked `unallocated` only on the REALLOCATED branch, on
   * the reasoning that the envelopes sum to the ceiling so a slot inside its
   * own envelope cannot overspend. That is false the moment anyone borrows: a
   * slot that draws from unheld capacity is spending an envelope some OTHER
   * slot has not started, and that slot's `remainingOwnEnvelope` — a per-slot
   * view — still counts the same dollar as its own. Both spend it.
   *
   * A ceiling test caught it at 49,998,000 against 30,000,000: a 67% overspend,
   * from a rule that read as obviously safe. Every grant is now bounded by what
   * the MISSION actually has left, which is the only number that cannot be
   * double-counted because it is derived from every slot at once.
   */
  const missionRoom = ledger.unallocatedUsdMicros;
  if (missionRoom <= 0) {
    return refuse(
      'MISSION_CAPACITY_EXHAUSTED',
      'The mission is holding or has spent its whole ceiling; nothing remains for any slot.',
    );
  }
  const granted = (usdMicros: number, source: JuliusSlotSource): JuliusSlotReserveVerdict => ({
    ok: true,
    usdMicros: Math.floor(Math.min(usdMicros, missionRoom)),
    source,
    slot,
    perRoundShareUsdMicros: share,
    remainingOwnEnvelopeUsdMicros: own,
    unallocatedUsdMicros: ledger.unallocatedUsdMicros,
    ledgerRevision: ledger.revision,
  });

  if (share > 0 && own >= share) return granted(Math.min(requested, share), 'SLOT_SHARE');
  if (own > 0) return granted(Math.min(requested, own), 'SLOT_REMAINDER');
  // BORROWING IS BOUNDED BY ONE SHARE. A slot that has finished its own
  // envelope may keep working on what the others did not need, and may not
  // take the mission's whole remainder in a single dispatch.
  const bound = Math.max(share, 1);
  return granted(Math.min(requested, bound, ledger.unallocatedUsdMicros), 'REALLOCATED');
}
