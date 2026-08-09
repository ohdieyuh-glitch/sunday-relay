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

/* ------------------------------------------------------ redeeming a grant */

/** The bridge this browser was built to talk to. Non-secret, build-time. */
export function configuredBridgeUrl(): string | null {
  const env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined) as
    | { VITE_RELAY_BRIDGE_URL?: string; VITE_RELAY_LIVE?: string }
    | undefined;
  if (env?.VITE_RELAY_LIVE !== '1') return null;
  const url = env?.VITE_RELAY_BRIDGE_URL?.trim();
  return url !== undefined && url !== '' ? url.replace(/\/$/, '') : null;
}

/**
 * WHICH MACHINE THIS BROWSER IS TALKING TO.
 *
 * `null` when no bridge is configured — the offline product has never seen a
 * machine, and answering "founder machine" there would be a claim about a
 * computer that does not exist. A loopback bridge is the founder's own laptop;
 * anything else this browser was built to reach is a hosted deployment.
 *
 * This decides which registered occupants could run a founder's choice, so
 * guessing it wrong is the difference between "set a variable" and "never, on
 * this host".
 */
export function configuredDeploymentKind(
  url: string | null = configuredBridgeUrl(),
): 'hosted' | 'founder_machine' | null {
  if (url === null || url === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // An unparseable value is not evidence of either kind.
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
    || host.endsWith('.localhost');
  return loopback ? 'founder_machine' : 'hosted';
}

export interface PairBrowserResult {
  readonly state: BridgeConnectionState;
  /** Safe to display. Never contains a grant, a secret or a token. */
  readonly message: string | null;
}

/**
 * Redeems a one-time pairing grant for a browser session.
 *
 * The grant is sent ONCE and never stored — not in memory, not in
 * sessionStorage, not in a log. Only the session token that comes back is
 * kept, and only for this tab. The Origin header is attached by the browser
 * itself, which is what binds the exchange to the approved site.
 */
export async function pairBrowser(input: {
  grantId: string;
  grantSecret: string;
  fetchImpl?: typeof fetch;
  bridgeUrl?: string | null;
}): Promise<PairBrowserResult> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) {
    return { state: 'offline', message: 'No Relay Bridge is configured for this build.' };
  }
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));

  let status: number | null = null;
  let token: string | null = null;
  let expiresAt = '';
  try {
    const res = await doFetch(`${base}/relay-api/browser/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The grant travels in the BODY, never a URL — a URL reaches proxies,
      // history and logs.
      body: JSON.stringify({ grantId: input.grantId, grantSecret: input.grantSecret }),
      credentials: 'omit',
      cache: 'no-store',
    });
    status = res.status;
    if (res.ok) {
      const payload = await res.json() as { data?: { sessionToken?: unknown; expiresAt?: unknown } };
      const t = payload.data?.sessionToken;
      if (typeof t === 'string' && t !== '') {
        token = t;
        expiresAt = typeof payload.data?.expiresAt === 'string' ? payload.data.expiresAt : '';
      }
    }
  } catch {
    return { state: 'bridge_unavailable', message: 'The Relay Bridge could not be reached.' };
  }

  if (token === null) {
    // A rejected grant is authentication_rejected, never "connected". The
    // bridge deliberately gives one message for every failure mode.
    if (status === 401 || status === 403) {
      return {
        state: 'authentication_rejected',
        message: 'That grant was not accepted. Grants expire after two minutes and may be used once.',
      };
    }
    return { state: 'bridge_unavailable', message: 'The Relay Bridge did not return a session.' };
  }

  saveBridgeSession({
    token,
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    expiresAt,
    scope: 'browser_read_only',
  });
  return { state: 'connected', message: null };
}

export interface DisconnectResult {
  readonly state: BridgeConnectionState;
  /** True ONLY when the bridge confirmed it destroyed the session. */
  readonly revokedOnBridge: boolean;
  readonly message: string;
}

/**
 * Ends the session.
 *
 * The local copy is cleared WHATEVER happens, so a browser can always reach a
 * known-clean state. But a local clear is not a revocation: when the bridge
 * cannot be reached the result says so rather than implying the session is
 * dead everywhere.
 */
export async function disconnectBrowser(input: {
  fetchImpl?: typeof fetch;
  bridgeUrl?: string | null;
} = {}): Promise<DisconnectResult> {
  const session = loadBridgeSession();
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));

  let revokedOnBridge = false;
  if (session !== null && base !== null) {
    try {
      const res = await doFetch(`${base}/relay-api/browser/revoke`, {
        method: 'POST',
        headers: bridgeSessionHeader(session),
        credentials: 'omit',
        cache: 'no-store',
      });
      revokedOnBridge = res.ok;
    } catch {
      revokedOnBridge = false;
    }
  }

  // Always, even if the bridge never answered.
  clearBridgeSession();
  return {
    state: 'reachable_not_paired',
    revokedOnBridge,
    message: revokedOnBridge
      ? 'Session revoked on the Relay Bridge and cleared from this browser.'
      : 'Cleared from this browser. The Relay Bridge did not confirm revocation — the session expires on its own.',
  };
}
