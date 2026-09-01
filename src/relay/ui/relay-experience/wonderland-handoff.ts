import { configuredBridgeUrl as liveBridgeUrl, loadBridgeSession } from '../app/bridge-session';

/**
 * THE ENTER WONDERLAND BOUNDARY.
 *
 * Wonderland is a real surface with a real entrance: the Relay Bridge exposes
 * `POST /wonderland/presence/join`, and joining presence IS entering. This
 * module is the frontend side of that boundary and nothing more — it does not
 * modify, wrap or re-implement any bridge or battle code.
 *
 * WHAT IT WILL NOT DO IS PRETEND. The bridge route requires a configured bridge
 * URL and a signed-in session. When either is missing the honest answer is that
 * the Compound Agent is READY to enter and the entrance is unreachable from
 * this browser — with the precise reason. A green button that navigates
 * nowhere, or a fabricated success, would be a false claim about a live system,
 * and this product's rule is that unknown stays unknown.
 */

export type WonderlandReadiness =
  /** Agent not activated yet — the entrance is not offered. */
  | { readonly kind: 'agent_not_active' }
  /** Everything is in place; joining will be attempted against the bridge. */
  | { readonly kind: 'ready' }
  /** Activated, but this browser cannot reach the entrance. Says why. */
  | { readonly kind: 'unreachable'; readonly reason: string };

/**
 * The bridge URL this build was configured with, or null. THE SAME GATE THE
 * ENTRY USES: `bridge-session.configuredBridgeUrl` is live only when
 * `VITE_RELAY_LIVE=1` names a bridge. Reading `VITE_RELAY_BRIDGE_URL` on its
 * own here made the world claim the Wonderland entrance was reachable in a
 * build whose entry gate was transparent — two gates disagreeing about one fact.
 */
export function configuredBridgeUrl(): string | null {
  try {
    return liveBridgeUrl();
  } catch {
    return null;
  }
}

export function wonderlandReadiness(agentActivated: boolean): WonderlandReadiness {
  if (!agentActivated) return { kind: 'agent_not_active' };
  if (configuredBridgeUrl() === null) {
    return { kind: 'unreachable', reason: 'No Relay Bridge is configured for this build.' };
  }
  if (loadBridgeSession() === null) {
    return { kind: 'unreachable', reason: 'Sign in to Relay to enter Wonderland.' };
  }
  return { kind: 'ready' };
}

/** Short uppercase label for the telemetry strip. Never overstates. */
export function readinessLabel(readiness: WonderlandReadiness): string {
  switch (readiness.kind) {
    case 'agent_not_active': return 'AWAITING ACTIVATION';
    case 'ready': return 'READY';
    case 'unreachable': return 'READY · ENTRANCE UNREACHABLE';
  }
}
