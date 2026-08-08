/**
 * SUNDAY RELAY — WHETHER A STORED SCHEDULE MAY BE TICKED AT ALL.
 *
 * ONE GATE, TWO CALLERS. The operator tick and the in-bridge timer must agree
 * about what may run, and before this module they did not: the route refused a
 * fixed offset, a `SystemV/*` zone and a single-word IANA name, while the timer
 * — which reads the same stored schedule — ran all three. Review reproduced it:
 * three schedules the endpoint answers 422 for produced nine runs under the
 * timer. A schedule an operator is told will not run must not run.
 *
 * The store deliberately does NOT enforce this (it validates required fields
 * and the authoring instant, nothing about zones), because a rule that arrives
 * after a schedule is written must not make the stored schedule unreadable.
 * That is exactly why the gate has to live at every point of USE.
 *
 * It answers a KIND rather than a message, so the route can keep wording each
 * refusal for a human while the timer records the same decision as a reason.
 */

/**
 * An IANA-SHAPED name. Shape is not existence — `America/Atlantis` matches and
 * resolves to nothing — which is why resolution is checked separately below.
 */
export const IANA_ZONE = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/;

export type StoredZoneRefusal =
  /** Not Area/Location shaped at all: `EST`, `+05:00`. */
  | 'not_iana_shaped'
  /** IANA-shaped, and this server's evaluator resolves it to nothing. */
  | 'unresolvable'
  /** This server cannot check it against a list of real locations. */
  | 'cannot_verify'
  /** A fixed offset (`Etc/GMT±N`) or a frozen legacy zone (`SystemV/*`). */
  | 'not_a_place';

export interface ZoneJudge {
  resolveZone(timeZone: string): string | null;
  zoneNamesAPlace(timeZone: string): 'place' | 'not_a_place' | 'cannot_verify';
}

/**
 * Why this stored zone may not be ticked, or `null` when it may.
 *
 * The order matters and mirrors the route's: shape first (the cheapest and the
 * most obviously wrong), then whether anything resolves it, then whether what
 * it resolves to is a PLACE whose daylight-saving rules move with it. A fixed
 * offset cannot express daylight saving, so a schedule pinned to one drifts an
 * hour against the wall clock twice a year — silently, and twice a year.
 */
export function refuseStoredZone(timeZone: string, judge: ZoneJudge): StoredZoneRefusal | null {
  if (!IANA_ZONE.test(timeZone)) return 'not_iana_shaped';
  // The `!== null` guard is deliberate: a stored zone nothing can resolve is
  // left to the evaluator, whose `unknown_timezone` is the answer the tick
  // endpoint has always given for it.
  if (judge.resolveZone(timeZone) === null) return null;
  const verdict = judge.zoneNamesAPlace(timeZone);
  if (verdict === 'place') return null;
  if (verdict === 'cannot_verify') return 'cannot_verify';
  return 'not_a_place';
}
