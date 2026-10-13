/**
 * WONDERFS BUDGETS (contract r1.4 §8.4; the routes plan §3.3): per principal per project, per principal for bytes, and per process for
 * the byte answers in flight. A budget limits SCALE, never integrity (the founder's mandate): a refused call does nothing and charges
 * nothing, and its answer is `429 rate_limited` + `Retry-After: N` with the body's "try again in N s." carrying the SAME N (§8.4).
 *
 * The GCRA is the idea of the social budgets (wonderland-social-routes.ts createCommandBudgets), copied rather than shared: that
 * table's type is keyed to the social classes, and that file belongs to another lane. Integer milliseconds: no fractional token
 * that never comes due.
 *
 * R1 classes (reads only; R2 adds commits, uploaded bytes/day, open conflicts, concurrent uploads):
 *   read        per (player, project): a burst of 120, then one per 200 ms (= social's read rate);
 *   read_any    per player, across every project: a burst of 240, then one per 100 ms -- so spreading probes over many project ids
 *               buys nothing (the per-project key alone would refill per id);
 *   bytes       per player (R1-r3, security review MAJOR-1(b)): the bytes the bridge READS AND VERIFIES for them -- a whole blob per
 *               byte answer, whatever its Range, because the whole blob is read from the store and re-hashed. A burst of 512 MiB,
 *               refilled at 256 MiB a minute. It bounds the store reads and the hashing one player can cause, not only the bytes sent;
 *   byte reads  at most WONDERFS_MAX_BYTE_READS_IN_FLIGHT byte answers at once per PROCESS, and at most
 *               WONDERFS_MAX_BYTE_READS_PER_PLAYER of them for any one player (R1-r3, MAJOR-1(a)), so one player can never hold every
 *               slot. A slot is held until its answer is written or abandoned (wonderfs-routes.ts writeWonderfsAnswer).
 * The numbers are Alpha proposals (plan D3). The state lives in this object: the bridge builds ONE per process (server.ts), like
 * social's.
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

export interface WonderfsByteBudget {
  /** The most bytes a player may have read for them at once (must be at least the largest file, §11's 64 MiB). */
  readonly burstBytes: number;
  readonly perMinuteBytes: number;
}

export const WONDERFS_BYTE_BUDGET: WonderfsByteBudget = Object.freeze({ burstBytes: 512 * 1024 * 1024, perMinuteBytes: 256 * 1024 * 1024 });
export const WONDERFS_MAX_BYTE_READS_IN_FLIGHT = 2;
export const WONDERFS_MAX_BYTE_READS_PER_PLAYER = 1;
/** What a refused byte read is told to wait: one in flight ends quickly, so a second is enough. */
export const WONDERFS_BYTE_READ_RETRY_MS = 1_000;

export interface WonderfsBudgetOptions {
  readonly maxByteReads?: number;
  readonly maxByteReadsPerPlayer?: number;
  readonly byteBudget?: WonderfsByteBudget;
}

export type WonderfsBudgetDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterMs: number; readonly budget: WonderfsBudgetClass | 'bytes' | 'byte_reads' };

export interface WonderfsBudgets {
  /** Charge one read to (player, project) and to the player; `projectId` null = a read that names no project (H1). */
  take(playerId: string, projectId: string | null, now: number): WonderfsBudgetDecision;
  /** Charge `bytes` read and verified for the player; refused, it charges nothing. */
  takeBytes(playerId: string, bytes: number, now: number): WonderfsBudgetDecision;
  /**
   * Start one byte answer for `playerId`: null when the process, or this player, already holds its share. The returned function
   * gives the slot back; it may be called any number of times and gives it back once.
   */
  startByteRead(playerId: string): (() => void) | null;
}

/** "try again in N s." and `Retry-After: N`: one N, whole seconds, at least 1. */
export function wonderfsRetrySeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

export function createWonderfsBudgets(table: WonderfsBudgetTable = WONDERFS_BUDGETS, options: WonderfsBudgetOptions = {}): WonderfsBudgets {
  const maxByteReads = options.maxByteReads ?? WONDERFS_MAX_BYTE_READS_IN_FLIGHT;
  const maxPerPlayer = options.maxByteReadsPerPlayer ?? WONDERFS_MAX_BYTE_READS_PER_PLAYER;
  const byteBudget = options.byteBudget ?? WONDERFS_BYTE_BUDGET;
  const bytesPerMs = byteBudget.perMinuteBytes / 60_000;
  const tat = new Map<string, number>(); // `${class}\n${player}[\n${project}]` -> the theoretical arrival time, integer ms
  const buckets = new Map<string, { tokens: number; at: number }>(); // player -> bytes left at `at`
  const heldBy = new Map<string, number>(); // player -> byte answers in flight
  let lastPrune = 0;
  let byteReads = 0;
  const bytesNow = (playerId: string, now: number): number => {
    const held = buckets.get(playerId);
    return held === undefined ? byteBudget.burstBytes : Math.min(byteBudget.burstBytes, held.tokens + Math.max(0, now - held.at) * bytesPerMs);
  };
  return {
    take(playerId, projectId, now) {
      const at = Math.floor(now);
      if (at - lastPrune > 60_000) {
        lastPrune = at;
        for (const [key, t] of tat) if (t <= at) tat.delete(key); // fully refilled: nothing to remember
        for (const player of [...buckets.keys()]) if (bytesNow(player, at) >= byteBudget.burstBytes) buckets.delete(player);
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
    takeBytes(playerId, bytes, now) {
      const tokens = bytesNow(playerId, now);
      if (bytes > tokens) return { ok: false, retryAfterMs: Math.ceil((bytes - tokens) / bytesPerMs), budget: 'bytes' };
      buckets.set(playerId, { tokens: tokens - bytes, at: now });
      return { ok: true };
    },
    startByteRead(playerId) {
      const mine = heldBy.get(playerId) ?? 0;
      if (byteReads >= maxByteReads || mine >= maxPerPlayer) return null;
      byteReads += 1;
      heldBy.set(playerId, mine + 1);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        byteReads -= 1;
        const left = (heldBy.get(playerId) ?? 1) - 1;
        if (left <= 0) heldBy.delete(playerId);
        else heldBy.set(playerId, left);
      };
    },
  };
}
