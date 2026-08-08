import { MAX_CRON_WINDOW_MINUTES } from './cron-occurrences';

/**
 * SUNDAY RELAY — WHAT ONE AUTOMATIC SCHEDULER PASS SHOULD TICK.
 *
 * Pure. It decides WHICH stored schedules a pass covers and over what window;
 * it performs no tick, reads no disk and holds no timer. The bridge owns the
 * clock and the effects, this owns the decision — the same split the tick
 * itself uses.
 *
 * WHY A LOOKBACK RATHER THAN A WATERMARK. There is no durable per-schedule
 * watermark (CRON_LOOPS.md names its absence), so a pass cannot ask "what have
 * I already done?". What it can do is ask again: the durable claim marker makes
 * a replayed occurrence `already_handled` rather than a second run, so a window
 * that overlaps the previous pass costs nothing and a missed pass is caught up
 * by the next one. The lookback is therefore a CATCH-UP BOUND, not a schedule.
 *
 * IT IS BOUNDED IN BOTH DIRECTIONS. The window can never exceed the evaluator's
 * own limit, and a pass covers at most a stated number of schedules — a pass
 * that walked every schedule on a large volume would hold the event loop for
 * the whole walk, and the bridge answers requests on that loop.
 */

/** A schedule as the pass sees it: an id and what the store said about it. */
export interface SchedulerCandidate {
  readonly scheduleId: string;
  readonly state: 'active' | 'paused' | 'corrupt' | 'missing';
}

export interface SchedulerPassInput {
  readonly candidates: readonly SchedulerCandidate[];
  /** The server's clock. Never a caller's. */
  readonly now: string;
  /** How far back a pass reaches, bounding catch-up after an outage. */
  readonly lookbackMinutes: number;
  /** How many schedules one pass may tick. */
  readonly maxPerPass: number;
}

export interface PlannedTick {
  readonly scheduleId: string;
  readonly afterExclusive: string;
  readonly untilInclusive: string;
}

/** A schedule the pass did not tick, and the reason stated rather than implied. */
export interface SkippedSchedule {
  readonly scheduleId: string;
  readonly reason: 'paused' | 'corrupt' | 'missing' | 'over_pass_limit';
}

export interface SchedulerPass {
  readonly ticks: readonly PlannedTick[];
  readonly skipped: readonly SkippedSchedule[];
  /** True when the pass limit cut the list, so the caller can say so. */
  readonly truncated: boolean;
}

export type SchedulerPassResult =
  | { readonly ok: true; readonly pass: SchedulerPass }
  | { readonly ok: false; readonly refusal: string; readonly problem: string };

export function planSchedulerPass(input: SchedulerPassInput): SchedulerPassResult {
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) {
    return {
      ok: false,
      refusal: 'unreadable_now',
      problem: 'the pass instant must be a readable ISO-8601 instant; a pass cannot bound a window '
        + 'it cannot place in time.',
    };
  }
  if (!Number.isInteger(input.lookbackMinutes) || input.lookbackMinutes <= 0) {
    return {
      ok: false,
      refusal: 'unusable_lookback',
      problem: `the lookback must be a positive whole number of minutes; got `
        + `${String(input.lookbackMinutes)}.`,
    };
  }
  // THE EVALUATOR'S OWN LIMIT WINS. A lookback wider than the window the
  // evaluator will accept would be refused per schedule, so the pass would
  // report work it never had a chance to do.
  if (input.lookbackMinutes > MAX_CRON_WINDOW_MINUTES) {
    return {
      ok: false,
      refusal: 'lookback_exceeds_window',
      problem: `a lookback of ${String(input.lookbackMinutes)} minutes is wider than the `
        + `${String(MAX_CRON_WINDOW_MINUTES)}-minute evaluation limit, and every tick it planned `
        + 'would be refused.',
    };
  }
  if (!Number.isInteger(input.maxPerPass) || input.maxPerPass <= 0) {
    return {
      ok: false,
      refusal: 'unusable_pass_limit',
      problem: `a pass must be allowed at least one schedule; got ${String(input.maxPerPass)}.`,
    };
  }

  const afterExclusive = new Date(nowMs - input.lookbackMinutes * 60_000).toISOString();
  const ticks: PlannedTick[] = [];
  const skipped: SkippedSchedule[] = [];
  let truncated = false;

  for (const candidate of input.candidates) {
    if (candidate.state !== 'active') {
      // NAMED, not silently dropped. "Nothing ran" and "nothing ran because
      // eleven schedules are corrupt" are the same count and different facts.
      skipped.push({ scheduleId: candidate.scheduleId, reason: candidate.state });
      continue;
    }
    if (ticks.length >= input.maxPerPass) {
      truncated = true;
      skipped.push({ scheduleId: candidate.scheduleId, reason: 'over_pass_limit' });
      continue;
    }
    ticks.push({ scheduleId: candidate.scheduleId, afterExclusive, untilInclusive: input.now });
  }

  return { ok: true, pass: { ticks, skipped, truncated } };
}
