/**
 * SUNDAY RELAY — WHAT A TRIGGER MAY DO WHILE RUNS ARE ALREADY LIVE.
 *
 * CRON_LOOPS.md's overlap policies, as one pure decision. The doctrine line
 * is the last one: **an unknown overlap policy fails closed** — Relay must
 * not silently create unlimited overlapping AI-agent runs, and a policy the
 * code does not recognise is exactly how "unlimited" would ship.
 *
 * A bound that is not a bound is refused, not defaulted: `queue_all` without
 * a queue limit and `parallel_with_limit` without a parallel limit are
 * refusals, because those policies ARE their bounds.
 */

export const RELAY_OVERLAP_POLICIES =
  ['skip', 'queue_one', 'queue_all', 'replace', 'parallel_with_limit'] as const;
export type RelayOverlapPolicy = (typeof RELAY_OVERLAP_POLICIES)[number];

export interface OverlapState {
  /** Live runs of this schedule, as the journal reports them. */
  readonly activeRuns: number;
  /** Occurrences already queued behind them. */
  readonly queuedRuns: number;
  /** Required by `queue_all`. */
  readonly queueLimit?: number;
  /** Required by `parallel_with_limit`. */
  readonly parallelLimit?: number;
}

export type OverlapDecision =
  | { readonly action: 'dispatch' }
  /**
   * Do not run this occurrence now. `handled` separates two things review
   * found conflated: a DELIBERATE drop (the `skip` policy: a run is live and
   * this occurrence is meant to be lost) from CAPACITY pressure (a queue or
   * parallel limit is full right now). Only the first is "handled" — marking
   * a capacity skip handled drops an occurrence for a shortage that clears.
   */
  | { readonly action: 'skip'; readonly reason: string; readonly handled: boolean }
  | { readonly action: 'queue'; readonly reason: string }
  /** Dispatch only AFTER the live run is safely stopped or checkpointed —
   *  the caller owns that step; this decision never implies it happened. */
  | { readonly action: 'replace_after_safe_stop'; readonly reason: string }
  | { readonly action: 'refused'; readonly reason: string };

const bound = (value: number | undefined): boolean =>
  value !== undefined && Number.isInteger(value) && value >= 1;

const count = (value: number): boolean => Number.isInteger(value) && value >= 0;

/** One trigger, one decision, every branch named. */
export function decideOverlap(
  policy: string,
  state: OverlapState,
): OverlapDecision {
  if (!count(state.activeRuns) || !count(state.queuedRuns)) {
    return {
      action: 'refused',
      reason: `Run counts must be non-negative integers; got active=${String(state.activeRuns)}, queued=${String(state.queuedRuns)}.`,
    };
  }

  switch (policy as RelayOverlapPolicy) {
    case 'skip':
      return state.activeRuns === 0
        ? { action: 'dispatch' }
        : { action: 'skip', reason: 'A run is live and the policy skips overlaps.', handled: true };

    case 'queue_one':
      // A nonempty queue holds OLDER occurrences; dispatching past it would
      // jump a line the reason strings promise is a line. Review caught the
      // first version doing exactly that at the drain boundary (run just
      // finished, queue not yet promoted).
      if (state.activeRuns === 0 && state.queuedRuns === 0) return { action: 'dispatch' };
      return state.queuedRuns === 0
        ? { action: 'queue', reason: 'A run is live; this occurrence waits as the one queued follower.' }
        : {
            action: 'skip',
            reason: 'The queue of one is already full; the caller drains it first.',
            handled: false,
          };

    case 'queue_all':
      if (!bound(state.queueLimit)) {
        return {
          action: 'refused',
          reason: 'queue_all IS its bound: a positive integer queueLimit is required, not defaulted.',
        };
      }
      if (state.activeRuns === 0 && state.queuedRuns === 0) return { action: 'dispatch' };
      return state.queuedRuns < (state.queueLimit as number)
        ? { action: 'queue', reason: `Queued ${state.queuedRuns + 1} of ${state.queueLimit}; the queue drains in order.` }
        : {
            action: 'skip',
            reason: `The queue limit of ${state.queueLimit} is reached.`,
            handled: false,
          };

    case 'replace':
      return state.activeRuns === 0
        ? { action: 'dispatch' }
        : {
            action: 'replace_after_safe_stop',
            reason: 'The live run must be safely stopped or checkpointed FIRST; nothing here stopped it.',
          };

    case 'parallel_with_limit':
      if (!bound(state.parallelLimit)) {
        return {
          action: 'refused',
          reason: 'parallel_with_limit IS its bound: a positive integer parallelLimit is required, not defaulted.',
        };
      }
      return state.activeRuns < (state.parallelLimit as number)
        ? { action: 'dispatch' }
        : {
            action: 'skip',
            reason: `The parallel limit of ${state.parallelLimit} is reached.`,
            handled: false,
          };

    default:
      return {
        action: 'refused',
        reason: `"${policy}" is not a known overlap policy. An unknown policy fails closed — `
          + 'silently dispatching is how unlimited overlapping runs ship.',
      };
  }
}
