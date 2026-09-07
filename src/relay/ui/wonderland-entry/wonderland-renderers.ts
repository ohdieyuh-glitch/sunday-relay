import {
  WONDERLAND_NO_RENDERER_REASON,
  beginWonderlandEntry,
  refuseWonderlandAdmission,
  requestWonderlandAdmission,
} from '../../mission/wonderland/wonderland-entry';
import type {
  WonderlandEntry,
  WonderlandRendererOffer,
} from '../../mission/wonderland/wonderland-entry';
import type { WonderlandReadiness } from '../relay-experience/wonderland-handoff';

/**
 * WHAT THIS BUILD CAN ACTUALLY SHOW — the browser's half of the entry.
 *
 * The domain describes an entry attempt; it deliberately does not know what a
 * renderer is or whether one exists. This is where that is answered, and today
 * the answer is nothing: the web build ships no Wonderland client. There is no
 * pixel-streaming player, no signalling client and no embedded world scene
 * anywhere in `src/relay/ui`, and the Unreal module under `wonderland/` is
 * source that nothing in this repository builds or serves.
 *
 * WHY THE EMPTY LIST IS THE POINT. It would have been easy to leave the entry
 * button pointing at a route and let a successful join stand in for arrival.
 * That is a real, working request that leaves a person looking at the landing
 * page, and it is the failure the entry contract is shaped to make impossible.
 * So the honest state is written down: admitted is reachable, presenting is
 * not, and the reason travels with it.
 *
 * WHEN A RENDERER ARRIVES it is added here, and the test asserting this list is
 * empty fails — which is the intended mechanism. Whoever adds the first one
 * must also change the claim that nothing can be shown, in the same change.
 */
export const BUILT_IN_WONDERLAND_RENDERERS: readonly WonderlandRendererOffer[] =
  Object.freeze([]);

/**
 * The renderer this build would use, or null.
 *
 * First rather than best, because a build with two would need a policy for
 * choosing and there is no evidence yet about what that policy should weigh.
 * A second renderer is the moment to write one, not now.
 */
export function preferredWonderlandRenderer(
  available: readonly WonderlandRendererOffer[] = BUILT_IN_WONDERLAND_RENDERERS,
): WonderlandRendererOffer | null {
  return available.length > 0 ? available[0] : null;
}

/**
 * Why a person cannot be shown the world, or null when one could be.
 *
 * Derived from the list rather than written twice, so a build that gains a
 * renderer cannot keep telling people it has none.
 */
export function wonderlandRendererGap(
  available: readonly WonderlandRendererOffer[] = BUILT_IN_WONDERLAND_RENDERERS,
): string | null {
  return preferredWonderlandRenderer(available) === null ? WONDERLAND_NO_RENDERER_REASON : null;
}

/* --------------------------------------------------- the landing's gate */

/**
 * THE EXISTING LANDING GATE, EXPRESSED AS AN ENTRY.
 *
 * `wonderlandReadiness` already decides whether the entrance is offered, and it
 * already carries the sentence explaining a build that cannot reach it. This
 * translates that decision into the entry vocabulary instead of restating it —
 * two gates that each decided for themselves whether Wonderland was reachable
 * is precisely the bug the handoff module's own comment records having fixed.
 *
 * A readiness of `ready` produces an entry that has NOT been requested. Ready
 * means the attempt is worth making; it is not the attempt, and it is certainly
 * not its result.
 */
export function wonderlandEntryForReadiness(
  readiness: WonderlandReadiness,
  input: { readonly projectId: string; readonly playerId: string },
): WonderlandEntry {
  const start = beginWonderlandEntry(input);
  switch (readiness.kind) {
    case 'ready':
      return start;
    case 'unreachable':
      return refuseWonderlandAdmission(start, { reason: readiness.reason });
    case 'agent_not_active':
      return refuseWonderlandAdmission(start, {
        reason: 'Activate your Compound Agent before entering Wonderland.',
      });
  }
}

/**
 * The state to hold while a join is in flight.
 *
 * Exported as its own step so a surface cannot skip it: a button that went
 * straight from `ready` to a result would have no state to be busy in, and the
 * usual repair for that is a local `isLoading` flag that the honest state then
 * has to be kept in sync with.
 */
export const beginWonderlandJoin = requestWonderlandAdmission;
