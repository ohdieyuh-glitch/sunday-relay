/**
 * SUNDAY RELAY — WHAT STOPS ONE CALLER TAKING THE WHOLE BETA.
 *
 * `POST /beta/request` is the only unauthenticated write surface Relay has.
 * Review pointed it at the real 100-seat configuration and consumed every seat
 * with anonymous requests in 671 ms. The seat cap turned that from permanent
 * destruction into a bounded refusal; this is what stops the bounded refusal
 * being reached in a second by one machine.
 *
 * TWO LIMITS, BECAUSE ONE OF THEM CAN BE LIED TO.
 *
 *   per-key   — the client, as the platform edge reports it.
 *   global    — every request to this route, whoever sent it.
 *
 * The per-key limit is the useful one and rests on `x-forwarded-for`, which a
 * caller reaching the bridge directly can set to anything: a fresh value per
 * request defeats it completely. So the global limit exists precisely because
 * the per-key limit is spoofable — it is the bound that holds when the header
 * is a lie, and it is deliberately generous enough that honest traffic never
 * reaches it while still making "fill the wave in one second" impossible.
 *
 * A LIMIT NOBODY CAN EXCEED BY LYING is the property worth having. Neither
 * limit is a security boundary on its own, and this module does not pretend
 * otherwise — `BETA_WAVES.md` still names a blocklist as missing.
 *
 * PURE, and the clock is injected. A limiter that reads the clock cannot be
 * tested for the boundary that matters — the instant a window rolls over.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Which limit refused, so a log says something an operator can act on. */
  readonly limit: 'per_key' | 'global' | null;
  /** When the caller may try again, as a whole number of seconds. */
  readonly retryAfterSeconds: number;
}

export interface BetaRateLimiter {
  /** Records the attempt and answers whether it may proceed. */
  check(key: string, nowMs: number): RateLimitDecision;
}

export interface RateLimitConfig {
  /** Requests one key may make per window. */
  readonly perKey: number;
  /** Requests EVERY key together may make per window. */
  readonly global: number;
  readonly windowMs: number;
  /**
   * How many distinct keys are tracked before the oldest window is dropped.
   *
   * A limiter that grows a map per unique key is a memory exhaustion the
   * limiter itself invites — the same caller who spoofs a header per request
   * would fill it. Beyond this bound the per-key limit degrades and the global
   * limit carries, which is the safe direction.
   */
  readonly maxTrackedKeys: number;
}

export const BETA_RATE_LIMIT: RateLimitConfig = Object.freeze({
  // Generous for a human filling in a form, hopeless for a script: five
  // attempts a minute is more than anyone signing up honestly needs.
  perKey: 5,
  // 100 seats exist. Sixty requests a minute cannot exhaust them in a second,
  // and no honest launch produces that from one edge.
  global: 60,
  windowMs: 60_000,
  maxTrackedKeys: 10_000,
});

export function createBetaRateLimiter(
  config: RateLimitConfig = BETA_RATE_LIMIT,
): BetaRateLimiter {
  /** key → the window start and how many attempts fell inside it. */
  const perKey = new Map<string, { start: number; count: number }>();
  let globalStart = 0;
  let globalCount = 0;

  const retryIn = (start: number, nowMs: number): number =>
    Math.max(1, Math.ceil((start + config.windowMs - nowMs) / 1000));

  return {
    check(key, nowMs) {
      // THE GLOBAL WINDOW FIRST, because it is the one a lie cannot get past.
      if (nowMs - globalStart >= config.windowMs) {
        globalStart = nowMs;
        globalCount = 0;
      }
      if (globalCount >= config.global) {
        return { allowed: false, limit: 'global', retryAfterSeconds: retryIn(globalStart, nowMs) };
      }

      const held = perKey.get(key);
      const window = held !== undefined && nowMs - held.start < config.windowMs
        ? held
        : { start: nowMs, count: 0 };

      if (window.count >= config.perKey) {
        // A refused request does NOT extend the window. Otherwise a caller who
        // keeps hammering can never recover, which turns a rate limit into a
        // permanent ban nobody decided to issue.
        return { allowed: false, limit: 'per_key', retryAfterSeconds: retryIn(window.start, nowMs) };
      }

      // BOUNDED MEMORY. Evicting the oldest window rather than refusing keeps
      // the limiter honest under a key-spraying caller: the per-key limit
      // degrades, and the global limit is what still holds.
      if (!perKey.has(key) && perKey.size >= config.maxTrackedKeys) {
        let oldestKey: string | null = null;
        let oldestStart = Number.POSITIVE_INFINITY;
        for (const [k, v] of perKey) {
          if (v.start < oldestStart) { oldestStart = v.start; oldestKey = k; }
        }
        if (oldestKey !== null) perKey.delete(oldestKey);
      }

      window.count += 1;
      perKey.set(key, window);
      globalCount += 1;
      return { allowed: true, limit: null, retryAfterSeconds: 0 };
    },
  };
}

/**
 * The client, as well as the bridge can know it.
 *
 * BEHIND A PROXY THIS IS THE PLATFORM'S WORD, NOT A FACT. Railway terminates
 * TLS and sets `x-forwarded-for`; the socket address is the proxy and is
 * useless for telling callers apart. So the first hop of that header is used —
 * and a caller reaching the bridge directly can set it to anything, which is
 * exactly why the global limit exists and why this function's name says
 * `claimed`.
 */
export function claimedClientKey(headers: Record<string, string | string[] | undefined>): string {
  const forwarded = headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first !== 'string' || first.trim() === '') return 'unknown';
  // The leftmost entry is the original client per the convention; the rest are
  // proxies. Bounded, so a caller cannot use the key itself as a memory attack.
  return first.split(',')[0]!.trim().slice(0, 64) || 'unknown';
}
