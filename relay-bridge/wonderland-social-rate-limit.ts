/**
 * WHAT STOPS ONE SIGNED-IN PLAYER FLOODING EVERYONE ELSE.
 *
 * Every social write is a command from a verified player session, so the
 * session's player is the key, not a header a caller could rotate. Without a
 * limit, one account could send friend requests and messages as fast as the
 * bridge answers; a block ends a flood aimed at one victim, but nothing ended
 * a flood aimed at everyone.
 *
 * TOKEN BUCKETS, PER PLAYER. Every ordinary command draws one token from
 * `all`; a message also from `message`, and anything that lands on another
 * player (a friend request, a party or server invitation) also from
 * `invitation`. A command is admitted only if EVERY bucket it draws on holds a
 * token, and then takes one from each; a refused command takes nothing, so a
 * caller who keeps knocking does not dig their own wait deeper.
 *
 * A PLAYER CAN ALWAYS PROTECT THEMSELVES. A block, a change of visibility, and
 * leaving an instance, a party or a server draw ONLY on their own `protect`
 * bucket, never on `all`. Before this, a client whose own routine traffic had
 * spent `all` (sixty presence updates while moving, say) was answered 429 to a
 * block, and the block was not executed (review finding, 2026-10-05). The
 * `protect` bucket still bounds them, so toggling a block or a setting cannot
 * become a flood of its own.
 *
 * The limits are generous for a person and hopeless for a script: a burst of
 * sixty commands, then one a second; twenty messages, then one every three
 * seconds; ten invitations, then one every thirty seconds. A client's own
 * heartbeat (one presence refresh every 30 s) is a small fraction of `all`.
 *
 * EXACT, IN WHOLE MILLISECONDS. Each bucket is kept as the generic cell rate
 * algorithm keeps it: the time its next token is due, never a fractional
 * count. A fractional refill summed over many reads drifted below a whole
 * token (29.999 s and then 0.001 s of a 30 s token summed to 0.9999999999999999),
 * so a token that was due never came back.
 *
 * PURE, the clock injected. A clock that steps backwards is read as no time
 * passing: it refills nothing and locks nobody out. Memory is bounded: past
 * `maxTrackedPlayers`, the player not seen longest is forgotten, which gives
 * them a full budget again (the safe direction for an honest player; keys are
 * verified sessions, so a caller cannot spray new ones).
 */

export type WonderlandCommandBucket = 'all' | 'message' | 'invitation' | 'protect';

export interface WonderlandBucketLimit {
  /** The most commands a player may send at once from a full bucket. */
  readonly capacity: number;
  /** How often one token comes back, in whole milliseconds. */
  readonly intervalMs: number;
}

export const WONDERLAND_COMMAND_LIMITS: Readonly<Record<WonderlandCommandBucket, WonderlandBucketLimit>> = Object.freeze({
  all: Object.freeze({ capacity: 60, intervalMs: 1_000 }),
  message: Object.freeze({ capacity: 20, intervalMs: 3_000 }),
  invitation: Object.freeze({ capacity: 10, intervalMs: 30_000 }),
  protect: Object.freeze({ capacity: 30, intervalMs: 2_000 }),
});

/** What a player does to protect themselves: never held behind their own ordinary traffic. */
export const WONDERLAND_PROTECTIVE_COMMANDS: readonly string[] = Object.freeze(['BLOCK', 'SET_SETTINGS', 'LEAVE_INSTANCE', 'PARTY_LEAVE', 'SERVER_LEAVE']);

/** Which buckets a command kind draws on. */
export function wonderlandCommandBuckets(kind: string): readonly WonderlandCommandBucket[] {
  if (WONDERLAND_PROTECTIVE_COMMANDS.includes(kind)) return ['protect'];
  if (kind === 'SEND_MESSAGE') return ['all', 'message'];
  if (kind === 'FRIEND_REQUEST' || kind === 'PARTY_INVITE' || kind === 'SERVER_INVITE') return ['all', 'invitation'];
  return ['all'];
}

export type WonderlandCommandVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly bucket: WonderlandCommandBucket; readonly retryAfterSeconds: number };

export interface WonderlandCommandLimiter {
  /** Admits the command and takes one token from each bucket it draws on, or refuses it and takes nothing. */
  take(playerId: string, kind: string, nowMs: number): WonderlandCommandVerdict;
}

export function createWonderlandCommandLimiter(
  limits: Readonly<Record<WonderlandCommandBucket, WonderlandBucketLimit>> = WONDERLAND_COMMAND_LIMITS,
  maxTrackedPlayers = 10_000,
): WonderlandCommandLimiter {
  /** Per player: when each bucket's next token is due (absent: the bucket is full), and the latest time seen. */
  type Held = { due: Partial<Record<WonderlandCommandBucket, number>>; seen: number };
  const players = new Map<string, Held>();

  return {
    take(playerId, kind, nowMs) {
      let held = players.get(playerId);
      if (held === undefined) {
        if (players.size >= maxTrackedPlayers) {
          const oldest = players.keys().next().value;
          if (oldest !== undefined) players.delete(oldest);
        }
        held = { due: {}, seen: nowMs };
      } else {
        players.delete(playerId); // seen again: to the back of the eviction order
      }
      players.set(playerId, held);
      // A clock that steps backwards is no time passing.
      const now = Math.max(nowMs, held.seen);
      held.seen = now;

      const buckets = wonderlandCommandBuckets(kind);
      // A bucket admits when its next token is due no later than `now + (capacity - 1) * interval`: that is a full
      // bucket's burst, and one more token every interval after it.
      const lateBy = (bucket: WonderlandCommandBucket): number => {
        const due = Math.max(held!.due[bucket] ?? now, now);
        return due - (limits[bucket].capacity - 1) * limits[bucket].intervalMs - now;
      };
      const short = buckets.filter((bucket) => lateBy(bucket) > 0);
      if (short.length > 0) {
        // The longest wait is the honest one: the command is admitted only when every bucket has a token.
        const longest = short.reduce((a, b) => (lateBy(b) > lateBy(a) ? b : a));
        return Object.freeze({ allowed: false, bucket: longest, retryAfterSeconds: Math.max(1, Math.ceil(lateBy(longest) / 1000)) });
      }
      for (const bucket of buckets) held.due[bucket] = Math.max(held.due[bucket] ?? now, now) + limits[bucket].intervalMs;
      return Object.freeze({ allowed: true });
    },
  };
}
