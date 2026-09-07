import {
  bridgeSessionHeader,
  configuredBridgeUrl,
  loadBridgeSession,
} from '../app/bridge-session';
import {
  admitToWonderland,
  refuseWonderlandAdmission,
} from '../../mission/wonderland/wonderland-entry';
import type { WonderlandEntry } from '../../mission/wonderland/wonderland-entry';

/**
 * ASKING THE BRIDGE FOR ADMISSION — the one network call in the entry path.
 *
 * `POST /wonderland/presence/join` is a real route on a real bridge. This is
 * the browser's side of it, and it is deliberately the ONLY thing here that
 * touches the network: everything else in the entry path is a pure fold, which
 * is what lets the interesting cases be tested without a server.
 *
 * WHAT IT REFUSES TO DO. It never reports admission from anything except a
 * 2xx response that named a session. Not from a 200 with an unreadable body,
 * not from a request that threw, and not from the request having been sent.
 * Every other outcome becomes a refusal carrying a sentence a person can act
 * on, because "could not enter" with no reason is a dead end and this button
 * has exactly one job.
 *
 * The response is read defensively rather than parsed into a type. A bridge
 * that changed shape should produce an honest refusal here, not a runtime
 * error inside a click handler.
 */

/** Where the bridge names the session it just created. */
const sessionIdFrom = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  const carrier = typeof data === 'object' && data !== null ? data : body;
  const sessionId = (carrier as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : null;
};

/** The sentence for an HTTP outcome. Matches how the rest of the app reads status. */
function refusalFor(status: number): string {
  if (status === 401) return 'Sign in to Relay to enter Wonderland.';
  if (status === 403) return 'This Relay session is not allowed into that world.';
  if (status === 404) return 'This Relay Bridge does not serve a Wonderland entrance.';
  if (status >= 500) return 'The Relay Bridge could not let you in. Try again shortly.';
  return `The Relay Bridge refused the entrance (HTTP ${status}).`;
}

export interface JoinWonderlandInput {
  readonly entry: WonderlandEntry;
  /** A fresh id per attempt. The route is idempotent on it. */
  readonly commandId: string;
  readonly atIso: string;
  readonly fetchImpl?: typeof fetch;
  readonly bridgeUrl?: string | null;
}

/**
 * Ask, and fold the answer into the entry.
 *
 * Returns an ENTRY rather than a result the caller then has to interpret, so
 * there is no intermediate value a surface could read optimistically. The only
 * way to get `admitted` out of this function is for the bridge to have said so.
 */
export async function joinWonderland(input: JoinWonderlandInput): Promise<WonderlandEntry> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) {
    return refuseWonderlandAdmission(input.entry, {
      reason: 'No Relay Bridge is configured for this build.',
    });
  }
  const session = loadBridgeSession();
  if (session === null) {
    return refuseWonderlandAdmission(input.entry, {
      reason: 'Sign in to Relay to enter Wonderland.',
    });
  }

  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  let response: Response;
  try {
    response = await doFetch(`${base}/wonderland/presence/join`, {
      method: 'POST',
      headers: { ...bridgeSessionHeader(session), 'content-type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify({
        commandId: input.commandId,
        projectId: input.entry.projectId,
      }),
    });
  } catch {
    // A request that never completed says nothing about the world. It is not a
    // refusal BY the bridge, and the sentence says which of the two it is.
    return refuseWonderlandAdmission(input.entry, {
      reason: 'The Relay Bridge could not be reached from this browser.',
    });
  }

  if (!response.ok) {
    return refuseWonderlandAdmission(input.entry, { reason: refusalFor(response.status) });
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const sessionId = sessionIdFrom(body);
  if (sessionId === null) {
    return refuseWonderlandAdmission(input.entry, {
      reason: 'The Relay Bridge accepted the request without naming a session.',
    });
  }
  return admitToWonderland(input.entry, { sessionId, atIso: input.atIso });
}
