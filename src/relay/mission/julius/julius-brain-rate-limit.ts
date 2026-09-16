/**
 * THE ABUSE BOUNDARY: BOUNDED WORK PER RUN, NEVER ONE QUEUE FOR EVERYONE.
 *
 * A limit shared by every caller is a way for one run to starve the rest, so
 * every decision is taken in three independent scopes, and the narrowest one
 * that is exhausted is the one that refuses:
 *
 *   ATTEMPT    one workflow run and attempt — the blast radius of a faulty run
 *   MISSION    every attempt of one mission
 *   PRINCIPAL  everything one principal does, whatever mission it names
 *
 * and per operation class, because a run reading its context is not a run
 * writing history: READ, WRITE, ARTIFACT_READ, RECOVERY, ADMIN.
 *
 * A REFUSAL CHANGES NOTHING. It is decided before any effect runs, carries a
 * machine-readable reason and the scope that refused, and mutates no Brain
 * state. Counters hold identifiers and numbers — never a token, a session, a
 * payload or anything from a record.
 *
 * DURABILITY IS A CHOICE THE DEPLOYMENT MAKES. The in-memory store is per
 * process: a restart, or a second instance, starts its windows again, so limits
 * hold approximately across a fleet. A durable store makes them exact, at the
 * cost of a write per admitted call. Both implement `JuliusBrainRateLimitStore`,
 * and neither is allowed to fail open: a store that throws refuses the call.
 */

export const JULIUS_BRAIN_OPERATION_CLASSES = ['READ', 'WRITE', 'ARTIFACT_READ', 'RECOVERY', 'ADMIN'] as const;
export type JuliusBrainOperationClass = typeof JULIUS_BRAIN_OPERATION_CLASSES[number];
export const JULIUS_BRAIN_RATE_SCOPES = ['ATTEMPT', 'MISSION', 'PRINCIPAL'] as const;
export type JuliusBrainRateScope = typeof JULIUS_BRAIN_RATE_SCOPES[number];

export interface JuliusBrainRateWindow { readonly limit: number; readonly windowMs: number }
export type JuliusBrainRateLimits = Readonly<Record<JuliusBrainOperationClass, Partial<Record<JuliusBrainRateScope, JuliusBrainRateWindow>>>>;

/** Sensible starting points; the deployment tunes them. One paid run is a few hundred calls. */
export const JULIUS_BRAIN_DEFAULT_RATE_LIMITS: JuliusBrainRateLimits = {
  READ: { ATTEMPT: { limit: 600, windowMs: 60_000 }, MISSION: { limit: 2_400, windowMs: 60_000 }, PRINCIPAL: { limit: 3_000, windowMs: 60_000 } },
  WRITE: { ATTEMPT: { limit: 300, windowMs: 60_000 }, MISSION: { limit: 1_200, windowMs: 60_000 }, PRINCIPAL: { limit: 1_500, windowMs: 60_000 } },
  ARTIFACT_READ: { ATTEMPT: { limit: 120, windowMs: 60_000 }, MISSION: { limit: 480, windowMs: 60_000 }, PRINCIPAL: { limit: 600, windowMs: 60_000 } },
  RECOVERY: { ATTEMPT: { limit: 4, windowMs: 600_000 }, MISSION: { limit: 12, windowMs: 600_000 }, PRINCIPAL: { limit: 24, windowMs: 600_000 } },
  ADMIN: { PRINCIPAL: { limit: 60, windowMs: 60_000 } },
};

export interface JuliusBrainRateRequest {
  readonly principalId: string;
  readonly brainRunId: string;
  readonly missionId: string;
  readonly operationClass: JuliusBrainOperationClass;
}

export type JuliusBrainRateDecision =
  | { readonly ok: true; readonly remaining: Readonly<Partial<Record<JuliusBrainRateScope, number>>> }
  | {
    readonly ok: false; readonly reasonCode: 'rate_limited'; readonly scope: JuliusBrainRateScope;
    readonly operationClass: JuliusBrainOperationClass; readonly limit: number; readonly windowMs: number; readonly retryAfterMs: number;
  };

/** One fixed window per key. `consume` is atomic for its store. */
export interface JuliusBrainRateLimitStore {
  consume(input: { readonly key: string; readonly windowStart: number; readonly windowMs: number; readonly limit: number }):
    Promise<{ readonly used: number; readonly allowed: boolean }>;
  /** Give back a reservation when a later scope refuses, so one refusal does not spend the others. */
  release(input: { readonly key: string; readonly windowStart: number }): Promise<void>;
}

export function createJuliusBrainRateLimitMemoryStore(): JuliusBrainRateLimitStore & { readonly size: () => number } {
  const counters = new Map<string, number>();
  return {
    size: () => counters.size,
    async consume({ key, windowStart, limit }) {
      const at = `${key}|${windowStart}`;
      const used = (counters.get(at) ?? 0) + 1;
      if (used > limit) return { used: used - 1, allowed: false };
      counters.set(at, used);
      // Windows older than this one cannot be reached again.
      for (const held of counters.keys()) if (held.startsWith(`${key}|`) && Number(held.slice(key.length + 1)) < windowStart) counters.delete(held);
      return { used, allowed: true };
    },
    async release({ key, windowStart }) {
      const at = `${key}|${windowStart}`;
      const used = counters.get(at);
      if (used !== undefined && used > 0) counters.set(at, used - 1);
    },
  };
}

export interface JuliusBrainRateLimiter {
  admit(request: JuliusBrainRateRequest): Promise<JuliusBrainRateDecision>;
}

export function createJuliusBrainRateLimiter(deps: {
  readonly clock: { now(): string };
  readonly limits?: JuliusBrainRateLimits;
  readonly store?: JuliusBrainRateLimitStore;
}): JuliusBrainRateLimiter {
  const limits = deps.limits ?? JULIUS_BRAIN_DEFAULT_RATE_LIMITS;
  const store = deps.store ?? createJuliusBrainRateLimitMemoryStore();
  const keyFor = (scope: JuliusBrainRateScope, request: JuliusBrainRateRequest) => {
    const subject = scope === 'ATTEMPT' ? request.brainRunId : scope === 'MISSION' ? request.missionId : request.principalId;
    return `${scope}|${request.operationClass}|${subject}`;
  };

  return {
    async admit(request) {
      const now = Date.parse(deps.clock.now());
      const configured = limits[request.operationClass] ?? {};
      const taken: { key: string; windowStart: number }[] = [];
      const remaining: Partial<Record<JuliusBrainRateScope, number>> = {};
      // Narrowest first, so a faulty run is refused by its own scope rather than by everyone else's.
      for (const scope of JULIUS_BRAIN_RATE_SCOPES) {
        const window = configured[scope];
        if (window === undefined) continue;
        const windowStart = Math.floor(now / window.windowMs) * window.windowMs;
        const key = keyFor(scope, request);
        const result = await store.consume({ key, windowStart, windowMs: window.windowMs, limit: window.limit });
        if (!result.allowed) {
          for (const held of taken) await store.release(held);
          return { ok: false, reasonCode: 'rate_limited', scope, operationClass: request.operationClass, limit: window.limit, windowMs: window.windowMs, retryAfterMs: windowStart + window.windowMs - now };
        }
        taken.push({ key, windowStart });
        remaining[scope] = window.limit - result.used;
      }
      return { ok: true, remaining };
    },
  };
}
