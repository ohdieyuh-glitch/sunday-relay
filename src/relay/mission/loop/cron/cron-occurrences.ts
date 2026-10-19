/**
 * SUNDAY RELAY — WHICH OCCURRENCES A CRON LOOP OWES A WINDOW.
 *
 * The pure schedule evaluator CRON_LOOPS.md approved: given a validated
 * schedule, a zone, and a UTC window, it answers WHICH occurrences fell due —
 * each with the deterministic identity the claim step depends on:
 *
 *   occurrenceId = digest(scheduleId ‖ contractVersion ‖ intendedLocal ‖ resolvedUtc)
 *
 * `intendedLocal` disambiguates daylight-saving duplicates; `resolvedUtc`
 * pins the shift; `contractVersion` stops an edited schedule colliding with
 * its predecessor's occurrences. Same schedule, same window, same answer, on
 * any host — the clock is an argument and the zone is a port.
 *
 * THE TWO DST RULES, exactly as approved:
 *
 * - **Spring-forward** (the local time does not exist): the occurrence shifts
 *   to the next local minute that DOES exist and says so (`dstShifted`).
 *   A gap full of matching minutes collapses to ONE shifted occurrence —
 *   sixty "02:00 runs" all executing at 03:00 is not a schedule, it is a
 *   stampede wearing one.
 * - **Fall-back** (the local time occurs twice): ONE occurrence, at the
 *   FIRST instant, marked `repeatedLocalTime` — and the identity carries the
 *   resolved instant, so the skipped second pass can never be mistaken for
 *   an unhandled one.
 *
 * WHAT IT REFUSES, by name: window bounds without an explicit UTC offset
 * (the scheduler's own rule, imported not copied); a window running
 * backwards; a window past the evaluation bound — minute-stepping a year is
 * not an evaluation, it is a hang; a limit that is not a bound; a zone the
 * port cannot answer for; and a local minute the zone cannot resolve within
 * a day, which means zone data this module must not guess around.
 */

import { readIsoInstantWithOffset } from '../runtime/loop-scheduler';
import { cronMatches, type CronSchedule } from './cron-expression';
import type { CronLocalMinute, TimezonePort } from './timezone-port';

export interface CronOccurrence {
  readonly occurrenceId: string;
  readonly scheduleId: string;
  readonly contractVersion: number;
  /** The wall-clock minute the schedule intended, `YYYY-MM-DDTHH:mm`. */
  readonly intendedLocalMinute: string;
  /** The UTC instant that intention resolved to. */
  readonly resolvedUtcInstant: string;
  /** True when spring-forward moved a nonexistent local time forward. */
  readonly dstShifted: boolean;
  /** True when fall-back repeated the local time and the first pass ran. */
  readonly repeatedLocalTime: boolean;
}

export type CronRefusalReason =
  | 'invalid_window'
  | 'window_too_large'
  | 'invalid_limit'
  | 'unknown_timezone'
  | 'unresolvable_local_time';

export type CronEvaluation =
  | {
      readonly ok: true;
      /** Ascending by resolved instant, strictly inside the window. */
      readonly occurrences: readonly CronOccurrence[];
      /** True when maxOccurrences cut the answer short — the window still
       *  owes more. A silent cap reads as "covered everything". */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly refusal: CronRefusalReason; readonly problem: string };

export interface CronEvaluationInput {
  readonly schedule: CronSchedule;
  /** IANA zone name. A bare numeric offset is a validation failure upstream. */
  readonly timeZone: string;
  readonly scheduleId: string;
  readonly contractVersion: number;
  /** Occurrences strictly after this UTC instant… */
  readonly afterExclusive: string;
  /** …and at or before this one. */
  readonly untilInclusive: string;
  readonly maxOccurrences: number;
  readonly digest: (value: string) => string;
}

/** Eight days. A catch-up window past this is a policy decision, not an
 *  evaluation, and the missed-run stage owns it. */
export const MAX_CRON_WINDOW_MINUTES = 8 * 24 * 60;

/** How far a spring-forward shift may search. No real gap exceeds a day. */
const MAX_SHIFT_MINUTES = 24 * 60;

const MINUTE_MS = 60_000;

const pad = (n: number, width: 2 | 4): string => String(n).padStart(width, '0');

const localLiteral = (m: CronLocalMinute): string =>
  `${pad(m.year, 4)}-${pad(m.month, 2)}-${pad(m.dayOfMonth, 2)}T${pad(m.hour, 2)}:${pad(m.minute, 2)}`;

/** Calendar arithmetic via UTC epoch — the zone plays no part in stepping a
 *  wall-clock calendar forward one minute. */
const plusMinutes = (m: CronLocalMinute, minutes: number): CronLocalMinute => {
  const d = new Date(Date.UTC(m.year, m.month - 1, m.dayOfMonth, m.hour, m.minute + minutes));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    dayOfMonth: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
};

/** 0 = Sunday. A calendar date's weekday needs no zone. */
const weekdayOf = (m: CronLocalMinute): number =>
  new Date(Date.UTC(m.year, m.month - 1, m.dayOfMonth)).getUTCDay();

const refuse = (refusal: CronRefusalReason, problem: string): CronEvaluation =>
  ({ ok: false, refusal, problem });

/**
 * Every occurrence a window owes, in order, or a named refusal.
 *
 * Total and pure: nothing here reads a clock, throws, or creates anything —
 * the claim step (lock, marker, journal event) is the NEXT stage and is not
 * implemented, which CRON_LOOPS.md and LOOP_ENGINE.md both say plainly.
 */
export function dueCronOccurrences(
  port: TimezonePort,
  input: CronEvaluationInput,
): CronEvaluation {
  const afterMs = readIsoInstantWithOffset(input.afterExclusive);
  const untilMs = readIsoInstantWithOffset(input.untilInclusive);
  if (afterMs === null || untilMs === null) {
    return refuse('invalid_window',
      'Window bounds must be ISO-8601 instants carrying an explicit UTC offset.');
  }
  if (untilMs < afterMs) {
    return refuse('invalid_window',
      `The window runs backwards: ${input.untilInclusive} is before ${input.afterExclusive}.`);
  }
  const windowMinutes = (untilMs - afterMs) / MINUTE_MS;
  if (windowMinutes > MAX_CRON_WINDOW_MINUTES) {
    return refuse('window_too_large',
      `The window spans ${Math.ceil(windowMinutes)} minutes; the evaluation bound is `
      + `${MAX_CRON_WINDOW_MINUTES}. Catch-up past it is a missed-run policy decision, `
      + 'not a bigger scan.');
  }
  if (!Number.isInteger(input.maxOccurrences) || input.maxOccurrences < 1) {
    return refuse('invalid_limit',
      `maxOccurrences must be a positive integer; got ${String(input.maxOccurrences)}.`);
  }

  const startLocal = port.localMinuteOf(input.afterExclusive, input.timeZone);
  if (startLocal === null) {
    return refuse('unknown_timezone',
      `The timezone "${input.timeZone}" could not be answered for.`);
  }

  const occurrences: CronOccurrence[] = [];
  const shiftedResolved = new Set<string>();
  let truncated = false;

  // Iterate the schedule's own wall clock, strictly after the window's start
  // minute. Termination is by RESOLVED instant passing the window's end; the
  // extra day of slack covers any real zone offset, and the iteration cap is
  // the window plus that slack — bounded compute, not a convention.
  const maxSteps = Math.ceil(windowMinutes) + MAX_SHIFT_MINUTES + 2;
  let local = plusMinutes(startLocal, 1);

  for (let step = 0; step < maxSteps; step += 1, local = plusMinutes(local, 1)) {
    const matched = cronMatches(input.schedule, {
      minute: local.minute,
      hour: local.hour,
      dayOfMonth: local.dayOfMonth,
      month: local.month,
      dayOfWeek: weekdayOf(local),
    });

    // Termination probe: once even the earliest possible resolution of this
    // local minute is past the window, the window owes nothing further.
    const asUtcCeiling = Date.UTC(
      local.year, local.month - 1, local.dayOfMonth, local.hour, local.minute,
    ) - MAX_SHIFT_MINUTES * MINUTE_MS;
    if (asUtcCeiling > untilMs) break;
    if (!matched) continue;

    const instants = port.utcInstantsForLocal(local, input.timeZone);
    if (instants === null) {
      return refuse('unknown_timezone',
        `The timezone "${input.timeZone}" could not be answered for.`);
    }

    let resolvedUtcInstant: string;
    let dstShifted = false;
    const repeatedLocalTime = instants.length > 1;

    if (instants.length > 0) {
      // Fall-back runs ONCE, at the first pass. The identity pins which.
      resolvedUtcInstant = instants[0] as string;
    } else {
      // Spring-forward: the intended minute does not exist. Shift to the
      // next local minute that does, whatever the schedule says about it.
      dstShifted = true;
      let shifted = plusMinutes(local, 1);
      let found: string | null = null;
      for (let i = 0; i < MAX_SHIFT_MINUTES; i += 1, shifted = plusMinutes(shifted, 1)) {
        const candidates = port.utcInstantsForLocal(shifted, input.timeZone);
        if (candidates === null) {
          return refuse('unknown_timezone',
            `The timezone "${input.timeZone}" could not be answered for.`);
        }
        if (candidates.length > 0) { found = candidates[0] as string; break; }
      }
      if (found === null) {
        return refuse('unresolvable_local_time',
          `${localLiteral(local)} does not exist in "${input.timeZone}" and no local minute `
          + 'within a day does — zone data this evaluation must not guess around.');
      }
      resolvedUtcInstant = found;
      // A gap full of matching minutes is ONE shifted occurrence, not a
      // stampede at the gap's far edge.
      if (shiftedResolved.has(resolvedUtcInstant)) continue;
      shiftedResolved.add(resolvedUtcInstant);
    }

    // The after-side guard is what stops a window opening INSIDE the
    // fall-back repeat from re-running the first pass — a resolution can land
    // BEFORE the window even though its local minute is after the window's
    // start minute. (`<=` versus `<` is unreachable here: iteration starts at
    // local(after)+1 with seconds truncated, so exact equality cannot occur;
    // `<=` stays as the defensive spelling.)
    const resolvedMs = Date.parse(resolvedUtcInstant);
    if (resolvedMs <= afterMs || resolvedMs > untilMs) continue;

    if (occurrences.length >= input.maxOccurrences) {
      truncated = true;
      break;
    }
    const intendedLocalMinute = localLiteral(local);
    occurrences.push({
      occurrenceId: `occ_${input.digest(
        `${input.scheduleId}|${String(input.contractVersion)}|${intendedLocalMinute}|${resolvedUtcInstant}`,
      ).slice(0, 32)}`,
      scheduleId: input.scheduleId,
      contractVersion: input.contractVersion,
      intendedLocalMinute,
      resolvedUtcInstant,
      dstShifted,
      repeatedLocalTime,
    });
  }

  return { ok: true, occurrences, truncated };
}
