import type { WonderlandPresence, WonderlandSocialState } from './social-contracts';

/**
 * PRESENCE IS LIVE, OR IT IS NOT PRESENCE.
 *
 * A presence row says "this player is standing in this instance, now". It is
 * written when a player enters and refreshed while they stay, but a client that
 * crashes, loses its network or is closed never sends the leave. Before this,
 * such a row stayed true forever: a friend's lookup, a roster, an instance's
 * population, an encounter recorded on someone else's entry, and a voice plan
 * all went on reporting a player who had gone. That is an announcement of a fact
 * that stopped being one — the opposite of the product's rule.
 *
 * So presence carries its own expiry: a row not refreshed within
 * `WONDERLAND_PRESENCE_TTL_SECONDS` is not presence. Nothing is deleted. The row
 * simply stops counting, everywhere at once, because every reader receives state
 * through `wonderlandLiveState`:
 *   - every store read (`stateFor`, `voiceStateFor`) applies it at the request's time;
 *   - every decision (`decideWonderlandSocialCommand`) applies it at the command's time,
 *     so an entry never records an encounter with someone who is not there, and a
 *     heartbeat from an expired presence is told to enter again (`NOT_IN_INSTANCE`).
 *
 * THE CLIENT'S HALF (CORE): while in an instance, send `UPDATE_PRESENCE` at
 * least every `WONDERLAND_PRESENCE_HEARTBEAT_SECONDS`; on `NOT_IN_INSTANCE`, send
 * `ENTER_INSTANCE` again. Four missed heartbeats make a player absent.
 *
 * Pure: the time is passed in, never read.
 */

/** How often a client in an instance refreshes its presence. */
export const WONDERLAND_PRESENCE_HEARTBEAT_SECONDS = 30;
/** How long a presence counts without a refresh. Four heartbeats, so a slow network is not a disconnection. */
export const WONDERLAND_PRESENCE_TTL_SECONDS = 4 * WONDERLAND_PRESENCE_HEARTBEAT_SECONDS;

/**
 * Whether a presence is still true at `now`. An instant that cannot be read is
 * NOT live: liveness is never inferred. A refresh stamped slightly in the future
 * (clock skew between writers) is live.
 */
export function isWonderlandPresenceLive(presence: Pick<WonderlandPresence, 'updatedAt'>, now: string): boolean {
  const updated = Date.parse(presence.updatedAt);
  const at = Date.parse(now);
  if (Number.isNaN(updated) || Number.isNaN(at)) return false;
  return at - updated <= WONDERLAND_PRESENCE_TTL_SECONDS * 1000;
}

/** The state as it is true at `now`: every expired presence removed, everything else untouched. */
export function wonderlandLiveState(state: WonderlandSocialState, now: string): WonderlandSocialState {
  const entries = Object.entries(state.presence);
  const live = entries.filter(([, presence]) => isWonderlandPresenceLive(presence, now));
  if (live.length === entries.length) return state;
  return Object.freeze({ ...state, presence: Object.freeze(Object.fromEntries(live)) });
}
