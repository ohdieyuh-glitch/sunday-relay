/**
 * SUNDAY RELAY — CONTROLLED BETA WAVES.
 *
 * WHAT A WAVE IS. A named, capped, explicitly-opened cohort. Wave 0 is the
 * controlled public beta; waves 1-3 are the private waves that follow. A wave is
 * not a date and not a feature flag: it is a decision someone made, recorded
 * durably, with a seat count that can run out.
 *
 * WHY THIS EXISTS AS A DOMAIN AND NOT A FLAG. "Is this person in the beta?" has
 * four different answers — admitted, never enrolled, enrolled in a wave that has
 * not opened, and turned away because the wave is full — and a boolean collapses
 * all four into "no". An operator who cannot tell "we have not invited them"
 * from "we invited them and ran out of seats" cannot run a beta.
 *
 * THE RULES THIS PRODUCT HOLDS ITSELF TO, applied here:
 *
 * - **Unknown is not denied.** A participant with no enrollment record is
 *   `not_enrolled`, which is a fact about our records, not a judgement about
 *   them. It is never rendered as a refusal we made.
 * - **Unknown occupancy is not zero.** If the seats taken cannot be counted,
 *   admission is REFUSED rather than granted on an assumed empty wave. Counting
 *   an uncountable cohort as empty is how a capped beta becomes uncapped.
 * - **Announce facts, not intentions.** `admitted` is returned only for an
 *   enrollment that already exists. Deciding to admit and having admitted are
 *   different events, and this module performs only the first.
 * - **A closed wave stays closed.** Reopening is an explicit act, not the
 *   absence of a closing one.
 *
 * PURE. No clock, no I/O, no storage. Time enters as an injected ISO string and
 * the caller owns the durable record — the same split every other Relay domain
 * uses, so the browser and the CLI reach identical verdicts.
 */

export const RELAY_BETA_WAVES = ['wave_0', 'wave_1', 'wave_2', 'wave_3'] as const;
export type RelayBetaWave = (typeof RELAY_BETA_WAVES)[number];

/**
 * A wave's lifecycle. `not_open` is the default and the safe one: a wave nobody
 * opened admits nobody, which is what makes "controlled" mean anything.
 */
export type BetaWaveState = 'not_open' | 'open' | 'closed';

export interface BetaWaveConfig {
  readonly wave: RelayBetaWave;
  readonly state: BetaWaveState;
  /**
   * How many participants this wave may hold. A cap is the whole point of a
   * controlled beta, so it is required rather than defaulted — an absent cap
   * would have to mean either zero or infinity, and both are guesses.
   */
  readonly seats: number;
}

export interface BetaEnrollment {
  readonly participantId: string;
  readonly wave: RelayBetaWave;
  /** When the enrollment was durably recorded. Never a request's own clock. */
  readonly enrolledAt: string;
}

export type BetaAccessDecision =
  | { readonly admitted: true; readonly wave: RelayBetaWave; readonly enrolledAt: string }
  | { readonly admitted: false; readonly reason: BetaRefusal; readonly detail: string };

export type BetaRefusal =
  /** We hold no enrollment for them. A fact about our records, not a refusal. */
  | 'not_enrolled'
  /** Enrolled in a wave nobody has opened yet. */
  | 'wave_not_open'
  /** Enrolled in a wave that has been closed. */
  | 'wave_closed'
  /** The wave is full and this participant is beyond its seats. */
  | 'wave_full'
  /** The seats taken could not be counted, so admission is not granted. */
  | 'occupancy_unknown'
  /** The wave named by the enrollment is not one this build has. */
  | 'unknown_wave';

export interface BetaAccessInput {
  readonly participantId: string;
  /** Every enrollment this build knows about, in the order they were recorded. */
  readonly enrollments: readonly BetaEnrollment[];
  /** The waves and their state. A wave absent from here is `unknown_wave`. */
  readonly waves: readonly BetaWaveConfig[];
  /**
   * How many seats each wave currently holds, or `null` when it cannot be
   * counted. `null` REFUSES; it never reads as an empty wave.
   */
  readonly occupancy: Readonly<Record<string, number | null>>;
}

/**
 * Whether this participant may use Relay, and — when they may not — which of the
 * five distinct reasons applies.
 *
 * SEATS ARE DECIDED BY ENROLMENT ORDER, not by arrival. A participant admitted
 * on Tuesday does not lose their seat because someone else opened the app first
 * on Wednesday: the wave's own enrollment list is the authority, and a
 * participant beyond the seat count is over the line wherever they connect from.
 */
export function decideBetaAccess(input: BetaAccessInput): BetaAccessDecision {
  const enrollment = input.enrollments.find((e) => e.participantId === input.participantId);
  if (enrollment === undefined) {
    return {
      admitted: false,
      reason: 'not_enrolled',
      detail: 'Relay holds no beta enrollment for this participant. That is a fact about our '
        + 'records, not a decision about them.',
    };
  }

  const wave = input.waves.find((w) => w.wave === enrollment.wave);
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

  // UNKNOWN OCCUPANCY REFUSES. Reading an uncountable cohort as empty is how a
  // capped beta silently becomes an uncapped one.
  const taken = input.occupancy[enrollment.wave];
  if (taken === undefined || taken === null) {
    return {
      admitted: false,
      reason: 'occupancy_unknown',
      detail: `Relay cannot count how many seats ${enrollment.wave} holds, so it will not admit `
        + 'against a number it does not have.',
    };
  }

  // THE PARTICIPANT'S OWN POSITION, not the current total. Someone inside the
  // cap keeps their seat even after later enrollments push the wave over it.
  const position = input.enrollments
    .filter((e) => e.wave === enrollment.wave)
    .findIndex((e) => e.participantId === input.participantId);
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

/**
 * What an operator needs to see about one wave.
 *
 * `seatsRemaining` is `null` — never `0` — when occupancy cannot be counted,
 * because "the wave is full" and "we cannot tell" are different facts and only
 * one of them is a reason to stop inviting people.
 */
export interface BetaWaveStatus {
  readonly wave: RelayBetaWave;
  readonly state: BetaWaveState;
  readonly seats: number;
  readonly seatsTaken: number | null;
  readonly seatsRemaining: number | null;
  readonly admitting: boolean;
}

export function projectWaveStatus(
  wave: BetaWaveConfig, occupancy: Readonly<Record<string, number | null>>,
): BetaWaveStatus {
  const taken = occupancy[wave.wave];
  const known = typeof taken === 'number';
  return {
    wave: wave.wave,
    state: wave.state,
    seats: wave.seats,
    seatsTaken: known ? taken : null,
    seatsRemaining: known ? Math.max(0, wave.seats - taken) : null,
    // A wave admits only when it is open AND its occupancy is known AND a seat
    // is left. Any unknown collapses this to false, never to an optimistic true.
    admitting: wave.state === 'open' && known && taken < wave.seats,
  };
}
