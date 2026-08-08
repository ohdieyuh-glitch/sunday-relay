/**
 * SUNDAY RELAY — CONTROLLED BETA WAVES.
 *
 * WHAT A WAVE IS. A named, capped, explicitly-opened cohort. Wave 0 is the
 * controlled public beta; waves 1-3 are the private waves that follow. A wave is not a date and not a feature flag: it is a decision someone
 * made, with a seat count that can run out.
 *
 * WHY THIS IS A DOMAIN AND NOT A BOOLEAN. "Is this person in the beta?" has SIX
 * answers — see `BetaRefusal` — and a boolean collapses all of them into "no".
 * An operator who cannot tell "we never invited them" from "we invited them and
 * ran out of seats" from "our records are incomplete" cannot run a beta.
 *
 * THE FIRST VERSION OF THIS MODULE FAILED ITS OWN THREE GUARANTEES, and review
 * proved each by running it rather than reading it. They are the reason the code
 * below looks the way it does:
 *
 * 1. **Seats moved when the array was reordered.** Position came from array
 *    index, so alice lost her seat to bob purely because a caller returned rows
 *    in a different order — a `SELECT` without `ORDER BY` would have done it.
 *    `enrolledAt` was carried on every record and never read. It is now the
 *    ordering, with `participantId` as a total tie-break so the result is
 *    deterministic even for two enrolments sharing a timestamp.
 * 2. **The wrong enrollment won.** A plain `find` returned the first record for
 *    the participant across ALL waves, so anyone carried from a closed wave into
 *    an open one was refused `wave_closed` forever. The APPLICABLE enrollment is
 *    now chosen: an open wave beats a non-open one.
 * 3. **The cap was unenforceable.** `occupancy` was read once to check for
 *    `null` and never used again, so a caller that fetched only this
 *    participant's enrollments admitted everyone while occupancy reported
 *    1000/10 — the capped beta silently becoming uncapped that the whole design
 *    was meant to prevent. Occupancy and the enrollment list are now
 *    RECONCILED: a count that exceeds the enrollments we can see PROVES the list
 *    is incomplete, and an incomplete list makes every position meaningless.
 *
 * PURE. No clock, no I/O, no storage. Times enter as data on records the caller
 * already holds, and the caller owns the durable write.
 */

export const RELAY_BETA_WAVES = ['wave_0', 'wave_1', 'wave_2', 'wave_3'] as const;
export type RelayBetaWave = (typeof RELAY_BETA_WAVES)[number];

const KNOWN_WAVE = new Set<string>(RELAY_BETA_WAVES);

/** A wave nobody opened admits nobody, which is what "controlled" means. */
export type BetaWaveState = 'not_open' | 'open' | 'closed';

export interface BetaWaveConfig {
  readonly wave: RelayBetaWave;
  /** Required, not defaulted: a wave's state is a decision, never an omission. */
  readonly state: BetaWaveState;
  /**
   * How many participants this wave may hold. Required for the same reason —
   * an absent cap would have to mean zero or infinity, and both are guesses.
   * This module does not choose any wave's cap; the caller supplies it.
   */
  readonly seats: number;
}

export interface BetaEnrollment {
  readonly participantId: string;
  readonly wave: RelayBetaWave;
  /** When it was durably recorded. This ORDERS the wave; it is not decoration. */
  readonly enrolledAt: string;
}

export type BetaAccessDecision =
  | { readonly admitted: true; readonly wave: RelayBetaWave; readonly enrolledAt: string }
  | { readonly admitted: false; readonly reason: BetaRefusal; readonly detail: string };

/** SIX refusals. Any surface handling fewer is handling some of them as "no". */
export type BetaRefusal =
  /** We hold no enrollment. A fact about our records, not a judgement. */
  | 'not_enrolled'
  /** Enrolled in a wave nobody has opened yet. */
  | 'wave_not_open'
  /** Enrolled in a wave that has been closed. */
  | 'wave_closed'
  /** Their enrollment is past the wave's seats. */
  | 'wave_full'
  /** The seats taken cannot be counted, so admission is not granted. */
  | 'occupancy_unknown'
  /** A stored record or the wave's own cap is malformed. A config/records bug. */
  | 'wave_misconfigured'
  /** The enrollment names a wave this build does not have. */
  | 'unknown_wave';

export interface BetaAccessInput {
  readonly participantId: string;
  /** Every enrollment this build knows about. Order here does NOT decide seats. */
  readonly enrollments: readonly BetaEnrollment[];
  readonly waves: readonly BetaWaveConfig[];
  /**
   * Seats currently held per wave, or `null` when it cannot be counted.
   *
   * It is RECONCILED against `enrollments`, not merely null-checked: a count
   * higher than the enrollments we can see proves the list is partial, and a
   * partial list cannot place anyone in a queue.
   */
  readonly occupancy: Readonly<Record<string, number | null>>;
}

/**
 * A seat total we can actually reason about.
 *
 * `Number.isInteger` rather than `typeof === 'number'`, because `NaN` is the
 * canonical result of an uncomputable count — `Number(undefined)`,
 * `parseInt('')`, arithmetic on a missing field — and it used to pass straight
 * through the "cannot count" gate and be admitted against. `isInteger` already
 * implies finite, so a separate `isFinite` clause would be redundant.
 */
function countableSeats(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * A record we can actually order by.
 *
 * READING `enrolledAt` MADE VALIDATING IT MANDATORY. The first repair started
 * sorting on it without checking it, so a persisted row whose `enrolledAt` was
 * never written threw a `TypeError` out of the gate — and out of the operator
 * board — instead of refusing. One malformed row denied a verdict to EVERY
 * participant in that wave. This module's whole argument is that a malformed
 * stored record is refused rather than trusted (`unknown_wave` exists for
 * exactly that); a crash is not a refusal, it is the absence of a verdict.
 */
function usableRecord(e: BetaEnrollment): boolean {
  return typeof e.participantId === 'string' && e.participantId !== ''
    && typeof e.enrolledAt === 'string' && e.enrolledAt !== ''
    && typeof e.wave === 'string';
}

function seatsTakenFor(
  wave: RelayBetaWave, occupancy: BetaAccessInput['occupancy'],
): number | null {
  // `hasOwn`, so a bare bracket read cannot be satisfied by `Object.prototype`.
  if (!Object.hasOwn(occupancy, wave)) return null;
  const taken = occupancy[wave];
  return countableSeats(taken) ? taken : null;
}

/**
 * The wave's enrollment queue: deduplicated, then ordered by when each was
 * recorded.
 *
 * DEDUPLICATED FIRST, because a retried write with no store-side idempotency —
 * and there is no store — used to consume a second seat and evict a real
 * participant, while telling the operator a false ordinal ("enrollment number
 * 3" when only two people existed). The earliest record for a participant wins.
 *
 * ORDERED BY `enrolledAt` with `participantId` as a total tie-break, so two
 * enrolments sharing a timestamp still produce one stable answer everywhere.
 */
function queueFor(
  wave: RelayBetaWave, enrollments: readonly BetaEnrollment[],
): readonly BetaEnrollment[] {
  const earliest = new Map<string, BetaEnrollment>();
  for (const e of enrollments) {
    if (e.wave !== wave || !usableRecord(e)) continue;
    const held = earliest.get(e.participantId);
    if (held === undefined || e.enrolledAt < held.enrolledAt) earliest.set(e.participantId, e);
  }
  return [...earliest.values()].sort((a, b) => (
    a.enrolledAt === b.enrolledAt
      ? a.participantId.localeCompare(b.participantId)
      : a.enrolledAt.localeCompare(b.enrolledAt)
  ));
}

/**
 * Which enrollment actually applies to this participant.
 *
 * AN OPEN WAVE BEATS A NON-OPEN ONE. A participant promoted from a closed wave 0
 * into an open wave 1 holds two records, and returning whichever sorted first
 * refused them `wave_closed` forever. Among equals the earliest wins, so the
 * answer does not depend on array order.
 */
function applicableEnrollment(
  input: BetaAccessInput,
): BetaEnrollment | undefined {
  const mine = input.enrollments
    .filter((e) => usableRecord(e) && e.participantId === input.participantId)
    .sort((a, b) => (
      a.enrolledAt === b.enrolledAt ? a.wave.localeCompare(b.wave)
        : a.enrolledAt.localeCompare(b.enrolledAt)
    ));
  const isOpen = (e: BetaEnrollment): boolean =>
    input.waves.find((w) => w.wave === e.wave)?.state === 'open';
  return mine.find(isOpen) ?? mine[0];
}

export function decideBetaAccess(input: BetaAccessInput): BetaAccessDecision {
  const enrollment = applicableEnrollment(input);
  if (enrollment === undefined) {
    return {
      admitted: false,
      reason: 'not_enrolled',
      detail: 'Relay holds no beta enrollment for this participant. That is a fact about our '
        + 'records, not a decision about them.',
    };
  }

  // BOTH the build's own enumeration and the caller's config. The caller's list
  // is the same trust tier as the enrollment this check exists to distrust.
  const wave = KNOWN_WAVE.has(enrollment.wave)
    ? input.waves.find((w) => w.wave === enrollment.wave)
    : undefined;
  if (wave === undefined) {
    return {
      admitted: false,
      reason: 'unknown_wave',
      detail: `The enrollment names "${enrollment.wave}", which is not a wave this build has. `
        + 'An enrollment from a newer build is not an instruction to admit.',
    };
  }

  if (wave.state === 'not_open') {
    return {
      admitted: false,
      reason: 'wave_not_open',
      detail: `${enrollment.wave} has not been opened. A wave nobody opened admits nobody.`,
    };
  }
  if (wave.state === 'closed') {
    return {
      admitted: false,
      reason: 'wave_closed',
      detail: `${enrollment.wave} is closed. Reopening it is an explicit act.`,
    };
  }
  if (!countableSeats(wave.seats)) {
    // A MALFORMED CAP IS A CONFIG BUG, not an uncountable cohort. Collapsing
    // them gave an operator one `reason` for two different things to go fix,
    // in a module whose thesis is that collapsing distinct facts is the defect.
    return {
      admitted: false,
      reason: 'wave_misconfigured',
      detail: `${enrollment.wave} declares no usable seat count, so nobody is admitted against it.`,
    };
  }

  const queue = queueFor(wave.wave, input.enrollments);
  const taken = seatsTakenFor(wave.wave, input.occupancy);
  if (taken === null) {
    return {
      admitted: false,
      reason: 'occupancy_unknown',
      detail: `Relay cannot count how many seats ${enrollment.wave} holds, so it will not admit `
        + 'against a number it does not have.',
    };
  }
  // RECONCILED. A count higher than the enrollments we can see proves the list
  // is partial, and a partial list cannot place anyone in a queue — which is
  // exactly how a capped beta would otherwise admit everyone while the operator
  // watched the count climb past the cap.
  if (taken > queue.length) {
    return {
      admitted: false,
      reason: 'occupancy_unknown',
      detail: `${enrollment.wave} reports ${String(taken)} seats taken but Relay can see only `
        + `${String(queue.length)} enrollments, so the records it holds are incomplete and no `
        + 'position in the queue can be trusted.',
    };
  }

  const position = queue.findIndex((e) => e.participantId === input.participantId);
  if (position >= wave.seats) {
    return {
      admitted: false,
      reason: 'wave_full',
      detail: `${enrollment.wave} holds ${String(wave.seats)} seats and this enrollment is `
        + `number ${String(position + 1)}.`,
    };
  }

  return { admitted: true, wave: enrollment.wave, enrolledAt: enrollment.enrolledAt };
}

export interface BetaWaveStatus {
  readonly wave: RelayBetaWave;
  readonly state: BetaWaveState;
  readonly seats: number;
  readonly seatsTaken: number | null;
  readonly seatsRemaining: number | null;
  readonly admitting: boolean;
}

/**
 * What an operator sees about one wave — FROM THE SAME SEAT MODEL THE GATE USES.
 *
 * The first version computed this from `occupancy` while the gate computed
 * refusals from position, so the board could report "6 seats free, admitting"
 * while every one of those six invitations was refused at the door. An operator
 * view that disagrees with the gate is worse than no view.
 *
 * `seatsRemaining` is `null` and never `0` when the count is unknown: "full" and
 * "cannot tell" are different facts, and only one is a reason to stop inviting.
 */
export function projectWaveStatus(
  wave: BetaWaveConfig,
  occupancy: Readonly<Record<string, number | null>>,
  /** REQUIRED. The board cannot answer from a count alone — see below. */
  enrollments: readonly BetaEnrollment[],
): BetaWaveStatus {
  const reported = seatsTakenFor(wave.wave, occupancy);
  const queue = queueFor(wave.wave, enrollments);
  /**
   * SEATS TAKEN IS THE QUEUE, NOT THE REPORTED COUNT — because the queue is
   * what the gate actually admits from. Reporting `occupancy` here is what let
   * the board advertise "6 seats free, admitting" over twelve enrollments
   * against ten seats, while the gate refused every one of those six
   * invitations at the door. `occupancy` keeps one job: proving the records are
   * complete enough to trust.
   */
  const known = reported !== null && countableSeats(wave.seats) && reported <= queue.length;
  const taken = queue.length;
  return {
    wave: wave.wave,
    state: wave.state,
    seats: wave.seats,
    seatsTaken: known ? taken : null,
    seatsRemaining: known ? Math.max(0, wave.seats - taken) : null,
    // The next enrollment would take position `taken`; it is admitted exactly
    // when the gate would admit it.
    admitting: wave.state === 'open' && known && taken < wave.seats,
  };
}
