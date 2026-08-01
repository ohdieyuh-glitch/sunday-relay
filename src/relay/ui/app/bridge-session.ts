/**
 * THE BROWSER'S BRIDGE SESSION.
 *
 * The browser never holds an operator credential. It holds, at most, a
 * short-lived, origin-bound, read-only session token that it obtained by
 * redeeming a one-time pairing grant the founder carried across by hand.
 *
 * WHERE THE TOKEN LIVES. In memory for the life of the tab, mirrored into
 * `sessionStorage` so a reload does not force re-pairing. Never
 * `localStorage`: that survives the tab, the browser restart and every other
 * site's lifetime, which is exactly the property a bearer token should not
 * have. If `sessionStorage` is unavailable the session simply stays in memory
 * rather than degrading to something more persistent.
 *
 * THIS MODULE HOLDS NO POLICY. It cannot decide that a session is valid — only
 * the bridge can, and it re-checks on every request. What lives here is the
 * honest STATE the interface renders, including the states people usually skip:
 * "reachable but not paired" and "session expired" are not the same thing as
 * "offline", and none of the three is "connected".
 */

export const BRIDGE_SESSION_STORAGE_KEY = 'sunday-relay.bridge.session';

/** Every state the connection can truthfully be in. */
export type BridgeConnectionState =
  /** Live mode is off. The default, and what production ships today. */
  | 'offline'
  /** Configured, answering, but this browser holds no session. */
  | 'reachable_not_paired'
  /** A grant is being redeemed right now. */
  | 'pairing'
  /** A session was issued and the bridge accepted it. */
  | 'connected'
  /** We held a session and the bridge has stopped accepting it. */
  | 'session_expired'
  /** Configured, but not answering at all. */
  | 'bridge_unavailable'
  /** Answering, and refusing the credential we presented. */
  | 'authentication_rejected';

export const BRIDGE_STATE_LABEL: Readonly<Record<BridgeConnectionState, string>> = Object.freeze({
  offline: 'Offline — no Relay Bridge configured',
  reachable_not_paired: 'Relay Bridge reachable — not paired',
  pairing: 'Pairing…',
  connected: 'Securely connected',
  session_expired: 'Session expired — pair again',
  bridge_unavailable: 'Relay Bridge unavailable',
  authentication_rejected: 'Authentication rejected',
});

/**
 * `connected` is the ONLY state that may claim a working connection, and it is
 * reachable only after the bridge accepted a session we actually hold.
 */
export function claimsConnection(state: BridgeConnectionState): boolean {
  return state === 'connected';
}

export interface StoredBridgeSession {
  readonly token: string;
  readonly origin: string;
  /** ISO. Advisory only — the bridge is the authority on expiry. */
  readonly expiresAt: string;
  readonly scope: 'browser_read_only';
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): SessionStorageLike | null {
  try {
    // `sessionStorage` only. Reaching for `localStorage` here would outlive
    // the tab and is the single most common way a bearer token leaks.
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** In-memory copy, authoritative for this tab. */
let inMemory: StoredBridgeSession | null = null;

export function loadBridgeSession(): StoredBridgeSession | null {
  if (inMemory !== null) return inMemory;
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(BRIDGE_SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.token !== 'string' || typeof o.origin !== 'string') return null;
    // A session is bound to the origin it was paired for; one restored under a
    // different origin is discarded rather than presented and refused.
    if (typeof window !== 'undefined' && o.origin !== window.location.origin) {
      store.removeItem(BRIDGE_SESSION_STORAGE_KEY);
      return null;
    }
    inMemory = {
      token: o.token,
      origin: o.origin,
      expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : '',
      scope: 'browser_read_only',
    };
    return inMemory;
  } catch {
    return null;
  }
}

export function saveBridgeSession(session: StoredBridgeSession): void {
  inMemory = session;
  const store = storage();
  if (store === null) return; // Memory-only is the safe degradation.
  try {
    store.setItem(BRIDGE_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* quota or privacy mode — the in-memory session still works */
  }
}

export function clearBridgeSession(): void {
  inMemory = null;
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(BRIDGE_SESSION_STORAGE_KEY);
  } catch {
    /* nothing to do — the in-memory copy is already gone */
  }
}

/**
 * The Authorization header for a browser session.
 *
 * Deliberately NOT `Bearer`: the operator credential uses that scheme, and a
 * distinct scheme means a browser session can never be mistaken for one, in
 * either direction, by any code or any log reader.
 */
export function bridgeSessionHeader(session: StoredBridgeSession): Record<string, string> {
  return { Authorization: `Relay-Session ${session.token}` };
}

/** Maps an HTTP outcome onto the truthful state. Never optimistic. */
export function stateFromResponse(input: {
  hadSession: boolean;
  status: number | null;
}): BridgeConnectionState {
  if (input.status === null) return 'bridge_unavailable';
  if (input.status === 401) {
    // We held something and it is no longer accepted — that is expiry from the
    // browser's point of view, and it must not read as "connected".
    return input.hadSession ? 'session_expired' : 'reachable_not_paired';
  }
  if (input.status === 403) return 'authentication_rejected';
  if (input.status >= 200 && input.status < 300) {
    // Only a session we actually hold can be called connected.
    return input.hadSession ? 'connected' : 'reachable_not_paired';
  }
  return 'bridge_unavailable';
}
