import type { LiveReachSource } from './live-reach-contracts';

/**
 * WHAT A RETRIEVAL SPENDS, COUNTED HONESTLY.
 *
 * `relay_live_reach` declared no `usage` verb and its absence note said so:
 * "Retrieval spends someone's rate limit rather than money, and Relay does not
 * yet meter it." An adapter that reports no usage cannot be budgeted, so a cap
 * over retrieval was a hope. This is the meter that makes the verb true.
 *
 * THE UNIT IS NOT MONEY, and this module never pretends otherwise. There is no
 * cost field, no estimate, no price table. What a retrieval spends is somebody
 * else's rate limit and Relay's own bandwidth, so those are what it counts.
 *
 * THE HARD PART IS WHAT RELAY CANNOT KNOW, and it is the whole reason this is
 * a module rather than a counter:
 *
 *   OBSERVED / THROTTLED / UNAUTHENTICATED  the host answered. It saw the
 *                                           request and its own limit counted
 *                                           it, whatever the status.
 *   UNREACHABLE                             Relay CANNOT TELL. A DNS failure
 *                                           never reached the host; a timeout
 *                                           after connect very likely did.
 *                                           Recording it as spent would invent
 *                                           usage; recording it as free would
 *                                           make a broken host a way to retry
 *                                           without limit.
 *   NOT ATTEMPTED                           Relay's own policy refused before
 *                                           any socket opened. Nothing was
 *                                           spent, and this is the one outcome
 *                                           that must never touch the meter.
 *
 * So unknown effect is its own count, never folded into the known one — and
 * the budget below spends it conservatively, which is the only direction that
 * fails closed.
 *
 * BYTES ARE PARTIAL BY NATURE. Only an observed body has a size; a 429 has
 * none. The sum is therefore `null` until something is known, and `unsized`
 * says how much of the total it cannot speak for. A byte budget over a partial
 * sum would be a number that looks enforced and is not, so `checkRetrievalBudget`
 * reports that case as UNENFORCEABLE rather than quietly allowing the request.
 */

/** What the fetch layer observed, in the vocabulary the meter can price. */
export type MeteredOutcome =
  | 'observed'
  | 'throttled'
  | 'unauthenticated'
  | 'unreachable'
  | 'not_attempted';

export interface SourceUsage {
  /** Attempts the host demonstrably answered. */
  readonly counted: number;
  /** Attempts Relay cannot say the host saw. Never added to `counted`. */
  readonly unknownEffect: number;
}

export interface RetrievalMeter {
  readonly missionId: string;
  readonly counted: number;
  readonly unknownEffect: number;
  /**
   * Sum of KNOWN body sizes. `null` means nothing has been measured yet —
   * which is not the same as zero bytes, and renders Unknown.
   */
  readonly bytes: number | null;
  /** Counted attempts that carried no size, so `bytes` speaks for less. */
  readonly unsized: number;
  readonly bySource: Readonly<Record<string, SourceUsage>>;
  /** The most recent throttle's own words. Absent stays null. */
  readonly lastRetryAfter: string | null;
  readonly firstAt: string | null;
  readonly lastAt: string | null;
}

export function emptyMeter(missionId: string): RetrievalMeter {
  return {
    missionId,
    counted: 0,
    unknownEffect: 0,
    bytes: null,
    unsized: 0,
    bySource: {},
    lastRetryAfter: null,
    firstAt: null,
    lastAt: null,
  };
}

export interface RetrievalRecord {
  readonly source: LiveReachSource;
  readonly outcome: MeteredOutcome;
  /** Known body size, or null when the outcome carried none. */
  readonly bytes: number | null;
  readonly at: string;
  readonly retryAfter?: string | null;
}

/** Did the host see this request? `null` = Relay cannot tell. */
function hostSaw(outcome: MeteredOutcome): boolean | null {
  switch (outcome) {
    case 'observed':
    case 'throttled':
    case 'unauthenticated':
      return true;
    case 'unreachable':
      return null;
    case 'not_attempted':
      return false;
  }
}

/**
 * Fold one retrieval into the meter. Pure: the caller owns the storage.
 *
 * A refusal Relay made itself returns the meter UNCHANGED — including its
 * timestamps, because a mission whose every request was refused has retrieved
 * nothing and its meter should say so rather than showing activity.
 */
export function recordRetrieval(meter: RetrievalMeter, record: RetrievalRecord): RetrievalMeter {
  const saw = hostSaw(record.outcome);
  if (saw === false) return meter;

  const prior = meter.bySource[record.source] ?? { counted: 0, unknownEffect: 0 };
  const known = saw === true;
  const sized = known && record.bytes !== null;

  return {
    missionId: meter.missionId,
    counted: meter.counted + (known ? 1 : 0),
    unknownEffect: meter.unknownEffect + (known ? 0 : 1),
    // A null sum plus a first known size becomes that size, not `null + n`.
    bytes: sized ? (meter.bytes ?? 0) + (record.bytes as number) : meter.bytes,
    unsized: meter.unsized + (known && !sized ? 1 : 0),
    bySource: {
      ...meter.bySource,
      [record.source]: {
        counted: prior.counted + (known ? 1 : 0),
        unknownEffect: prior.unknownEffect + (known ? 0 : 1),
      },
    },
    // The last throttle's own Retry-After, and only from a throttle: a later
    // success does not clear it, because it remains the last thing the host
    // said about its limit.
    lastRetryAfter: record.outcome === 'throttled'
      ? (record.retryAfter ?? null)
      : meter.lastRetryAfter,
    firstAt: meter.firstAt ?? record.at,
    lastAt: record.at,
  };
}

/**
 * A cap on retrieval. `null` on a field means no cap was set for it — which is
 * "unmetered by decision", and the caller is expected to say so rather than
 * render it as a large number.
 */
export interface RetrievalBudget {
  readonly maxRetrievals: number | null;
  readonly maxBytes: number | null;
}

export type BudgetVerdict =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly refusal: 'retrieval_budget_exhausted' | 'byte_budget_unenforceable' | 'byte_budget_exhausted';
    readonly detail: string;
  };

/**
 * May this mission retrieve once more?
 *
 * Checked BEFORE the fetch, because a budget enforced afterwards is a report.
 *
 * The retrieval cap spends `counted + unknownEffect`: an attempt Relay cannot
 * price is charged as if it counted. That is deliberately the pessimistic
 * reading — the alternative makes an unreachable host a way to retry forever.
 */
export function checkRetrievalBudget(meter: RetrievalMeter, budget: RetrievalBudget): BudgetVerdict {
  if (budget.maxRetrievals !== null) {
    const spent = meter.counted + meter.unknownEffect;
    if (spent >= budget.maxRetrievals) {
      return {
        ok: false,
        refusal: 'retrieval_budget_exhausted',
        detail: `This mission has used ${String(spent)} of ${String(budget.maxRetrievals)} permitted retrievals`
          + (meter.unknownEffect > 0
            ? `, ${String(meter.unknownEffect)} of which Relay could not confirm reached a host and charged anyway.`
            : '.'),
      };
    }
  }

  if (budget.maxBytes !== null) {
    // A cap over a sum that cannot account for every retrieval is not a cap.
    // Saying so beats letting the request through under a number that looks
    // enforced.
    if (meter.unsized > 0) {
      return {
        ok: false,
        refusal: 'byte_budget_unenforceable',
        detail: `A byte budget cannot be enforced: ${String(meter.unsized)} retrieval(s) reported no size, `
          + 'so the measured total speaks for less than what was actually read.',
      };
    }
    const used = meter.bytes ?? 0;
    if (used >= budget.maxBytes) {
      return {
        ok: false,
        refusal: 'byte_budget_exhausted',
        detail: `This mission has read ${String(used)} of ${String(budget.maxBytes)} permitted bytes.`,
      };
    }
  }

  return { ok: true };
}

/**
 * The usage an adapter reports, shaped for a surface.
 *
 * `bytes` stays nullable all the way out. A surface that wants a number can
 * decide to print "Unknown"; one that receives a zero cannot tell the
 * difference between nothing read and nothing measured.
 */
export interface ReportedUsage {
  readonly missionId: string;
  readonly retrievals: number;
  readonly unconfirmedRetrievals: number;
  readonly bytes: number | null;
  readonly unsizedRetrievals: number;
  readonly bySource: Readonly<Record<string, SourceUsage>>;
  readonly lastRetryAfter: string | null;
  readonly firstAt: string | null;
  readonly lastAt: string | null;
  /** The unit, stated, so no reader assumes currency. */
  readonly unit: 'retrievals_and_bytes';
}

export function reportUsage(meter: RetrievalMeter): ReportedUsage {
  return {
    missionId: meter.missionId,
    retrievals: meter.counted,
    unconfirmedRetrievals: meter.unknownEffect,
    bytes: meter.bytes,
    unsizedRetrievals: meter.unsized,
    bySource: meter.bySource,
    lastRetryAfter: meter.lastRetryAfter,
    firstAt: meter.firstAt,
    lastAt: meter.lastAt,
    unit: 'retrievals_and_bytes',
  };
}
