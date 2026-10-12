/**
 * WONDERFS BUDGETS (contract r1.4 §8.4; the routes plan §3.3): per principal per project, and per process for the bytes in flight.
 * A budget limits SCALE, never integrity (the founder's mandate): a refused call does nothing and charges nothing, and its answer
 * is `429 rate_limited` + `Retry-After: N` with the body's "try again in N s." carrying the SAME N (§8.4).
 *
 * The GCRA is the idea of the social budgets (wonderland-social-routes.ts createCommandBudgets), copied rather than shared: that
 * table's type is keyed to the social classes, and that file belongs to another lane. Integer milliseconds: no fractional token
 * that never comes due.
 *
 * R1 classes (reads only; R2 adds commits, uploaded bytes/day, open conflicts, concurrent uploads):
 *   read       per (player, project): a burst of 120, then one per 200 ms (= social's read rate);
 *   read_any   per player, across every project: a burst of 240, then one per 100 ms -- so spreading probes over many project ids
 *              buys nothing (the per-project key alone would refill per id);
 *   byte reads per PROCESS: at most WONDERFS_MAX_BYTE_READS_IN_FLIGHT file / blob answers at once. A file is up to 64 MiB (§11) and
 *              the Alpha store hands its bytes over whole (no streaming until the WfsBlobStore seam, R2/R5), so this bounds the
 *              bridge's memory, as the plan bounds uploads.
 * The state lives in this object: the bridge builds ONE per process (server.ts), like social's.
 */

export interface WonderfsRate {
  readonly burst: number;
  readonly everyMs: number;
}

export const WONDERFS_BUDGETS = Object.freeze({
  read: Object.freeze({ burst: 120, everyMs: 200 }),
  read_any: Object.freeze({ burst: 240, everyMs: 100 }),
});
export type WonderfsBudgetClass = keyof typeof WONDERFS_BUDGETS;
export type WonderfsBudgetTable = Readonly<Record<WonderfsBudgetClass, WonderfsRate>>;

export const WONDERFS_MAX_BYTE_READS_IN_FLIGHT = 2;
/** What a refused byte read is told to wait: one in flight ends quickly, so a second is enough. */
export const WONDERFS_BYTE_READ_RETRY_MS = 1_000;

export type WonderfsBudgetDecision = { readonly ok: true } | { readonly ok: false; readonly retryAfterMs: number; readonly budget: WonderfsBudgetClass | 'byte_reads' };

export interface WonderfsBudgets {
  /** Charge one read to (player, project) and to the player; `projectId` null = a read that names no project (H1). */
  take(playerId: string, projectId: string | null, now: number): WonderfsBudgetDecision;
  /** Start one byte answer; null when the process already serves its maximum. Call the returned function exactly once when done. */
  startByteRead(): (() => void) | null;
}

/** "try again in N s." and `Retry-After: N`: one N, whole seconds, at least 1. */
export function wonderfsRetrySeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

export function createWonderfsBudgets(table: WonderfsBudgetTable = WONDERFS_BUDGETS, maxByteReads: number = WONDERFS_MAX_BYTE_READS_IN_FLIGHT): WonderfsBudgets {
  const tat = new Map<string, number>(); // `${class}:${player}[:${project}]` -> the theoretical arrival time, integer ms
  let lastPrune = 0;
  let byteReads = 0;
  return {
    take(playerId, projectId, now) {
      const at = Math.floor(now);
      if (at - lastPrune > 60_000) {
        lastPrune = at;
        for (const [key, t] of tat) if (t <= at) tat.delete(key); // fully refilled: nothing to remember
      }
      // a project id never holds '\n' (grants.ts PROJECT_ID_PATTERN), so these keys cannot collide
      const keys: Array<[WonderfsBudgetClass, string]> = [
        ['read', `read\n${playerId}\n${projectId ?? '*'}`],
        ['read_any', `read_any\n${playerId}`],
      ];
      const next: Array<[string, number]> = [];
      for (const [budget, key] of keys) {
        const { burst, everyMs } = table[budget];
        const t = Math.max(tat.get(key) ?? at, at);
        const tolerance = (burst - 1) * everyMs;
        if (t - at > tolerance) return { ok: false, retryAfterMs: t - at - tolerance, budget };
        next.push([key, t + everyMs]);
      }
      for (const [key, t] of next) tat.set(key, t);
      return { ok: true };
    },
    startByteRead() {
      if (byteReads >= maxByteReads) return null;
      byteReads += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        byteReads -= 1;
      };
    },
  };
}
