/**
 * SUNDAY RELAY — THE TIMEZONE PORT, AND ITS ONE ADAPTER.
 *
 * CRON_LOOPS.md: the pure schedule evaluator is written against a small
 * injected TimezonePort, because `Intl.DateTimeFormat` is the only IANA-aware
 * primitive available without a new dependency — and hiding it behind a port
 * makes adding a timezone library a one-adapter decision, not a rewrite.
 *
 * THE PORT ANSWERS EXACTLY TWO QUESTIONS, both of which have honest hard
 * cases the evaluator must see rather than have smoothed over:
 *
 * - At which UTC instants does this local wall-clock minute occur? The answer
 *   is a LIST: one instant normally, TWO in the fall-back hour, ZERO in the
 *   spring-forward gap. An adapter that always answered one would silently
 *   pick a side of exactly the ambiguity the occurrence identity exists to
 *   pin down.
 * - What local minute is this UTC instant? For iterating a window in the
 *   schedule's own wall-clock terms.
 *
 * `null` — never a throw — for a timezone the host cannot answer for.
 * Unknown is not guessed.
 */

/** One wall-clock minute, in some zone's calendar. Month is 1-12. */
export interface CronLocalMinute {
  readonly year: number;
  readonly month: number;
  readonly dayOfMonth: number;
  readonly hour: number;
  readonly minute: number;
}

export interface TimezonePort {
  /**
   * UTC instants (ISO-8601 `Z`, ascending) at which this local minute occurs
   * in the zone: `[]` in a spring-forward gap, one normally, two in the
   * fall-back hour. `null` when the zone is unknown.
   */
  utcInstantsForLocal(
    local: CronLocalMinute,
    timeZone: string,
  ): readonly string[] | null;
  /** The zone's wall-clock minute at a UTC instant, or `null` when the zone
   *  is unknown. Seconds are truncated — cron is minute-resolution. */
  localMinuteOf(utcInstant: string, timeZone: string): CronLocalMinute | null;
}

/* ------------------------------------------------------- Intl adapter */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Formatters are expensive to build and pure to reuse. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
    return formatter;
  } catch {
    // An unknown zone is an answer, not an exception.
    return null;
  }
}

function localPartsAt(utcMs: number, timeZone: string): CronLocalMinute | null {
  const formatter = formatterFor(timeZone);
  if (formatter === null) return null;
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = Number.parseInt(part.value, 10);
  }
  const { year, month, day, hour, minute } = parts;
  if (year === undefined || month === undefined || day === undefined
    || hour === undefined || minute === undefined) return null;
  return { year, month, dayOfMonth: day, hour, minute };
}

const asUtcMs = (local: CronLocalMinute): number =>
  Date.UTC(local.year, local.month - 1, local.dayOfMonth, local.hour, local.minute);

const sameMinute = (a: CronLocalMinute, b: CronLocalMinute): boolean =>
  a.year === b.year && a.month === b.month && a.dayOfMonth === b.dayOfMonth
  && a.hour === b.hour && a.minute === b.minute;

/**
 * The Intl-backed adapter.
 *
 * Candidate instants come from the zone's plausible offsets around the
 * target (a day either side covers every real transition), and each
 * candidate is VERIFIED by reading its local minute back — the offset trick
 * proposes, the round-trip disposes. Zero verified candidates IS the
 * spring-forward answer, two the fall-back one.
 */
export function createIntlTimezonePort(): TimezonePort {
  const offsetAt = (utcMs: number, timeZone: string): number | null => {
    const local = localPartsAt(utcMs, timeZone);
    if (local === null) return null;
    // Seconds are dropped by CronLocalMinute; compare at minute resolution.
    return asUtcMs(local) - Math.floor(utcMs / MINUTE_MS) * MINUTE_MS;
  };

  return {
    utcInstantsForLocal(local, timeZone) {
      const target = asUtcMs(local);
      const offsets = new Set<number>();
      for (const probe of [target - DAY_MS, target, target + DAY_MS]) {
        const offset = offsetAt(probe, timeZone);
        if (offset === null) return null;
        offsets.add(offset);
      }
      const verified = new Set<number>();
      for (const offset of offsets) {
        const candidate = target - offset;
        const readBack = localPartsAt(candidate, timeZone);
        if (readBack !== null && sameMinute(readBack, local)) verified.add(candidate);
      }
      return [...verified]
        .sort((a, b) => a - b)
        .map((ms) => new Date(ms).toISOString());
    },

    localMinuteOf(utcInstant, timeZone) {
      const ms = Date.parse(utcInstant);
      if (Number.isNaN(ms)) return null;
      return localPartsAt(ms, timeZone);
    },
  };
}
