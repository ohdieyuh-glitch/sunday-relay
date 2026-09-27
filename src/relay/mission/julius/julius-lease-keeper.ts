/**
 * A HELD LEASE IS RENEWED WHILE THE WORK IS REAL, AND NEVER BEYOND ITS BOUND.
 *
 * The task lease was taken once, at claim, for a fixed `leaseMs`, and nothing
 * outside a test ever renewed it: `JuliusRunWriter.heartbeat` had no production
 * caller. The live composition leased 600 s while the Coding Agent's declared
 * deadline was 734 s, so a legitimate long attempt outlived its own lease — a
 * second worker's sweep could reclaim the task mid-session and dispatch it
 * again beside the first. And a claim queued behind another task in the same
 * tick spent its lease waiting before it ever ran.
 *
 * TWO RULES, AND BOTH ARE THE POINT.
 *
 *   A LEGITIMATE ATTEMPT MUST NOT EXPIRE. While the holder is working, the lease
 *   is renewed well inside its own length, from the moment the task is admitted.
 *
 *   A STALE WORKER MUST NOT CONTINUE INDEFINITELY. Renewal stops at a HOLD
 *   BOUND derived from the dispatch deadline plus the allowance to settle it, and
 *   never sets an expiry past it. A worker that renewal would have to keep alive
 *   longer than that is not working, it is stuck: its dispatch is aborted and the
 *   lease is left to lapse, so the sweep can reclaim the task and the store's
 *   generation fence refuses anything the stuck worker writes afterwards. A
 *   renewal the store refuses means the lease is already someone else's, and the
 *   dispatch is aborted at once.
 *
 * Pure: time comes from the injected clock, scheduling from injected timers, so
 * both rules are proven with a fake clock and no wall-clock waiting.
 */

import type { JuliusRunWriter } from './julius-runtime-ports';

export const JULIUS_LEASE_LOSS_REASONS = [
  /** The store refused a renewal: the lease is no longer this holder's. */
  'lease_lost',
  /** The hold bound was reached while the work still held the lease. */
  'lease_hold_exhausted',
  /** Renewals kept failing and the last confirmed expiry was about to pass. */
  'lease_renewal_failed',
] as const;
export type JuliusLeaseLossReason = (typeof JULIUS_LEASE_LOSS_REASONS)[number];

/** Scheduling, injected so a proof can drive it. The defaults are the host's. */
export interface JuliusLeaseTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const HOST_TIMERS: JuliusLeaseTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * HOW A RUN LOOP RENEWS WHAT IT HOLDS.
 *
 * `holdBoundMsFor` is the longest the named task may hold its lease from
 * admission: its dispatch deadline — every worker it could be routed to, in
 * turn — plus the allowance to settle the result. A composition derives it from
 * the workers it registered; nothing here holds a number of its own.
 */
export interface JuliusLeaseRenewalPolicy {
  /** How often a held lease is renewed. Must be shorter than the lease. */
  readonly renewEveryMs: number;
  readonly holdBoundMsFor: (task: { readonly role: string; readonly taskType: string }) => number;
  readonly timers?: JuliusLeaseTimers;
}

export interface JuliusLeaseKeeper {
  /** Aborted, with a {@link JuliusLeaseLossReason} as its reason, when the lease is lost or its hold runs out. */
  readonly signal: AbortSignal;
  /**
   * Renew now. False when the store refused — the lease is already another
   * holder's — in which case the signal is aborted `lease_lost`.
   */
  renewNow(): Promise<boolean>;
  /** Stop renewing. Waits for a renewal already in flight, so none lands after the task is finished. */
  stop(): Promise<void>;
  /** Renewals the store confirmed. */
  readonly renewals: () => number;
}

export function keepJuliusLease(input: {
  readonly store: Pick<JuliusRunWriter, 'heartbeat'>;
  readonly clock: { now(): string };
  readonly timers?: JuliusLeaseTimers;
  readonly taskId: string;
  readonly owner: string;
  readonly leaseGeneration: number;
  readonly leaseMs: number;
  readonly renewEveryMs: number;
  /** Epoch milliseconds, on the injected clock, past which the lease is never renewed. */
  readonly holdUntilMs: number;
}): JuliusLeaseKeeper {
  if (!Number.isSafeInteger(input.renewEveryMs) || input.renewEveryMs < 1 || input.renewEveryMs >= input.leaseMs) {
    throw new Error('invalid_julius_lease_renewal_interval');
  }
  const timers = input.timers ?? HOST_TIMERS;
  const controller = new AbortController();
  let stopped = false;
  let handle: unknown = null;
  let inFlight: Promise<boolean> | null = null;
  let confirmed = 0;
  let scheduling = false;
  /** The expiry the store last confirmed, on the injected clock. Unknown until the first renewal. */
  let confirmedExpiryMs: number | null = null;

  const lose = (reason: JuliusLeaseLossReason): void => {
    stopped = true;
    if (handle !== null) { timers.clearTimeout(handle); handle = null; }
    if (!controller.signal.aborted) controller.abort(reason);
  };

  const renew = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(false);
    if (inFlight !== null) return inFlight;
    const nowMs = Date.parse(input.clock.now());
    if (nowMs >= input.holdUntilMs) {
      lose('lease_hold_exhausted');
      return Promise.resolve(false);
    }
    // NEVER PAST THE HOLD BOUND, however long the lease itself is.
    const expiresAtMs = Math.min(nowMs + input.leaseMs, input.holdUntilMs);
    const attempt = (async (): Promise<boolean> => {
      try {
        const held = await input.store.heartbeat({
          taskId: input.taskId, owner: input.owner, leaseGeneration: input.leaseGeneration,
          now: new Date(nowMs).toISOString(), leaseExpiresAt: new Date(expiresAtMs).toISOString(),
        });
        if (!held) {
          lose('lease_lost');
          return false;
        }
        confirmed += 1;
        confirmedExpiryMs = expiresAtMs;
        return true;
      } catch {
        // A STORE THAT DID NOT ANSWER HAS NOT REFUSED. The attempt keeps its
        // lease until the last expiry the store confirmed is about to pass.
        const next = Date.parse(input.clock.now()) + input.renewEveryMs;
        if (confirmedExpiryMs === null || next >= confirmedExpiryMs) lose('lease_renewal_failed');
        return false;
      }
    })();
    // Cleared once settled, however it settled — including a store that threw before its first await.
    inFlight = attempt;
    void attempt.finally(() => { if (inFlight === attempt) inFlight = null; });
    return attempt;
  };

  const schedule = (): void => {
    if (stopped) return;
    handle = timers.setTimeout(() => {
      handle = null;
      void renew().then(() => schedule());
    }, input.renewEveryMs);
  };

  return {
    signal: controller.signal,
    async renewNow() {
      const held = await renew();
      // ONE renewal chain per keeper, however often it is asked to renew now.
      if (held && !scheduling) { scheduling = true; schedule(); }
      return held;
    },
    async stop() {
      stopped = true;
      if (handle !== null) { timers.clearTimeout(handle); handle = null; }
      if (inFlight !== null) await inFlight.catch(() => false);
    },
    renewals: () => confirmed,
  };
}

/**
 * ONE SIGNAL THAT ABORTS WHEN EITHER DOES, carrying the reason of whichever
 * fired first. The run loop's own signal and the lease keeper's both end a
 * dispatch; the coordinator reads one.
 */
export function juliusEitherSignal(first: AbortSignal | undefined, second: AbortSignal): { readonly signal: AbortSignal; readonly detach: () => void } {
  if (first === undefined) return { signal: second, detach: () => undefined };
  const controller = new AbortController();
  const fromFirst = (): void => controller.abort(first.reason);
  const fromSecond = (): void => controller.abort(second.reason);
  if (first.aborted) fromFirst();
  else if (second.aborted) fromSecond();
  first.addEventListener('abort', fromFirst, { once: true });
  second.addEventListener('abort', fromSecond, { once: true });
  return {
    signal: controller.signal,
    detach: () => {
      first.removeEventListener('abort', fromFirst);
      second.removeEventListener('abort', fromSecond);
    },
  };
}

/**
 * THE HOLD BOUND FOR ONE TASK, from the workers that could serve it.
 *
 * Every worker of the task's role, in turn — a reroute tries each once — at its
 * own declared deadline, plus the allowance to settle what the last one
 * returned: evidence, acceptance, verification and any research the result
 * asked Julius to serve inline. A superset of the workers the router would
 * actually choose, deliberately: a bound that is too long lets a stuck worker
 * hold a little longer, and a bound that is too short aborts a legitimate one.
 */
export function juliusLeaseHoldBoundMs(
  workers: readonly { readonly role: string; readonly timeoutMs: number }[],
  task: { readonly role: string },
  settlementAllowanceMs: number,
): number {
  const sameRole = workers.filter((worker) => worker.role === task.role);
  const dispatchMs = sameRole.reduce((sum, worker) => sum + worker.timeoutMs, 0);
  return dispatchMs + settlementAllowanceMs;
}

/**
 * THE LEASE ITSELF, derived rather than chosen: long enough that the longest
 * single dispatch any registered worker declares, settled, never outlives it
 * even if every renewal were lost.
 */
export function juliusLeaseMsFor(
  workers: readonly { readonly timeoutMs: number }[],
  settlementAllowanceMs: number,
): number {
  return workers.reduce((longest, worker) => Math.max(longest, worker.timeoutMs), 0) + settlementAllowanceMs;
}
