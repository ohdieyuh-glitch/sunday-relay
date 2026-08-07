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
 * The name ICU RESOLVES this zone to, or `null` when nothing can resolve it.
 *
 * NOT "the IANA canonical name", which is what an earlier version of this
 * comment claimed. ICU answers with the CLDR id, which for several zones is
 * the legacy name and the opposite of the IANA canonical one:
 * `Asia/Kolkata` resolves to `Asia/Calcutta`, `Europe/Kyiv` to `Europe/Kiev`,
 * `America/Nuuk` to `America/Godthab`. Do not use this to normalize a zone for
 * storage or equality — it is a LOOKUP KEY, useful because the resolution
 * folds case and aliases: `etc/gmt+5` and `ETC/GMT+5` both land on
 * `Etc/GMT+5`, so a rule about a family of zones must be applied here rather
 * than to the caller's spelling.
 */
export function resolvedZoneName(timeZone: string): string | null {
  const cached = resolvedNames.get(timeZone);
  if (cached !== undefined) return cached;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    resolvedNames.set(timeZone, resolved);
    return resolved;
  } catch {
    return null;
  }
}

/** Successes only, exactly as `formatterFor` above does it. Caching failures
 *  too would let any caller grow this map without bound with strings that name
 *  nothing; the successes are bounded by the zone database. */
const resolvedNames = new Map<string, string>();

/** What this server can say about whether a zone names a real location. */
export type ZonePlaceVerdict = 'place' | 'not_a_place' | 'cannot_verify';

/**
 * Does this name a PLACE, rather than a zone whose rules cannot follow one?
 *
 * TWO FAMILIES ARE REFUSED, for DIFFERENT reasons — which matters, because a
 * refusal that gave the wrong one is what this check has been corrected for
 * twice:
 *
 * - `Etc/GMT±N` is a fixed offset. It can never express daylight saving, so a
 *   schedule on one drifts against its author's wall clock forever.
 * - `SystemV/*` is a FROZEN LEGACY zone. Six of its thirteen members DO observe
 *   daylight saving — `SystemV/EST5EDT` is GMT-05:00 in January and GMT-04:00
 *   in July — but on the pre-1987 US ruleset, so they diverge from the places
 *   they appear to name for weeks each spring and autumn.
 *
 * `Intl.supportedValuesOf('timeZone')` is ICU's OWN list of real locations and
 * excludes both families while including every genuine place, resolving
 * aliases on the way (`Japan` → `Asia/Tokyo`, `EST` → `America/Panama`).
 * Asking it decides the CLASS; two attempts to enumerate these families by
 * pattern were each a step behind, missing first every case variant and then
 * all thirteen `SystemV/*` zones.
 *
 * `UTC` is admitted deliberately: absent from that list because it names no
 * location, and still the one offset a recurring schedule may legitimately
 * choose — a Loop that means "midnight UTC" is not drifting.
 *
 * WHERE THE LIST CANNOT BE READ the answer is `cannot_verify`, never
 * `not_a_place`. Callers still refuse, because unverifiable work must not be
 * scheduled unattended — but they do not tell an operator that
 * `America/Los_Angeles` is a fixed offset.
 */
export function zoneNamesAPlace(timeZone: string): ZonePlaceVerdict {
  return zonePlaceVerdict(resolvedZoneName(timeZone), supportedZones());
}

/**
 * The decision alone, over values a caller supplies.
 *
 * Split out so the three verdicts can be exercised directly. The
 * `cannot_verify` branch is ALSO reachable through the real function by
 * removing `Intl.supportedValuesOf`, and the tests do both — an earlier
 * version of this comment claimed it was unreachable, which is how the branch
 * shipped with no test at all.
 */
export function zonePlaceVerdict(
  resolved: string | null, known: ReadonlySet<string> | null,
): ZonePlaceVerdict {
  if (resolved === null) return 'not_a_place';
  if (resolved === 'UTC') return 'place';
  if (known === null) return 'cannot_verify';
  return known.has(resolved) ? 'place' : 'not_a_place';
}

/** How many resolutions are memoized. Exported so a test can prove the cache
 *  cannot be grown without bound by strings that name no zone. */
export function resolvedZoneCacheSize(): number {
  return resolvedNames.size;
}

/** The list, once read. A FAILURE IS NOT CACHED: caching it wedged a healthy
 *  bridge into refusing every create and every tick until restart, because a
 *  single transient failure was remembered forever. Retrying costs one Intl
 *  call on a host that cannot answer, and the host that can heals itself. */
let supported: Set<string> | null = null;
function supportedZones(): Set<string> | null {
  if (supported !== null) return supported;
  try {
    if (typeof Intl.supportedValuesOf !== 'function') return null;
    supported = new Set(Intl.supportedValuesOf('timeZone'));
    return supported;
  } catch {
    return null;
  }
}

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
