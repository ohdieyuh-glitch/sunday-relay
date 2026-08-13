/**
 * THE BROWSER'S BRIDGE SESSION.
 *
 * The browser never holds an operator credential. It holds, at most, a
 * short-lived, origin-bound session token it obtained by redeeming a one-time
 * pairing grant the founder carried across by hand. The session's SCOPE was
 * decided at mint by the operator: read-only observation, or — since the
 * founder made the website a real control surface — control, which may start
 * a mission acting as the participant bound into it. The browser can display
 * its scope; it can never widen it.
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
  /**
   * What the bridge SAID it minted, kept for display. The bridge re-decides
   * scope on every request from its own record, so a tampered stored value
   * gains nothing — it only makes the panel lie to its own user.
   */
  readonly scope: 'browser_read_only' | 'browser_control';
  /** Who a control session acts as, for display. Null for read-only. */
  readonly participantId: string | null;
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
      // An unrecognized stored scope restores as read-only — the least. The
      // bridge would enforce that anyway; this keeps the display from
      // claiming more than a tampered record could deliver.
      scope: o.scope === 'browser_control' ? 'browser_control' : 'browser_read_only',
      participantId: typeof o.participantId === 'string' ? o.participantId : null,
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
  let scope: 'browser_read_only' | 'browser_control' = 'browser_read_only';
  let participantId: string | null = null;
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
      const payload = await res.json() as {
        data?: { sessionToken?: unknown; expiresAt?: unknown; scope?: unknown; participantId?: unknown };
      };
      const t = payload.data?.sessionToken;
      if (typeof t === 'string' && t !== '') {
        token = t;
        expiresAt = typeof payload.data?.expiresAt === 'string' ? payload.data.expiresAt : '';
        scope = payload.data?.scope === 'browser_control' ? 'browser_control' : 'browser_read_only';
        participantId = typeof payload.data?.participantId === 'string' ? payload.data.participantId : null;
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
    // What the bridge SAID it minted — never assumed, never widened locally.
    scope,
    participantId,
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

/* ---------------------------------------------------- sign in with GitHub */

/**
 * BEGIN SIGN IN WITH GITHUB. Asks the bridge for the authorize URL and sends the
 * browser there. No operator token, no grant carried by hand — a beta user signs
 * in as themselves. The bridge holds the client secret; this only ever sees a
 * public authorize URL.
 */
export async function beginGitHubSignIn(input: {
  bridgeUrl?: string | null;
  fetchImpl?: typeof fetch;
  navigate?: (url: string) => void;
} = {}): Promise<{ readonly ok: boolean; readonly message: string | null }> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, message: 'No Relay Bridge is configured for this build.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}/relay-api/auth/github/start`, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return { ok: false, message: 'GitHub sign-in is not available on this bridge.' };
    const payload = await res.json() as { data?: { authorizeUrl?: unknown } };
    const url = payload.data?.authorizeUrl;
    if (typeof url !== 'string' || url === '') return { ok: false, message: 'The bridge returned no authorize URL.' };
    (input.navigate ?? ((u: string) => { if (typeof window !== 'undefined') window.location.href = u; }))(url);
    return { ok: true, message: null };
  } catch {
    return { ok: false, message: 'The Relay Bridge could not be reached.' };
  }
}

/**
 * COMPLETE SIGN IN from the redirect. GitHub sent the browser back to the bridge,
 * which redirected here with a ONE-TIME CLAIM in the URL fragment — never the
 * token. This reads that claim, exchanges it for the session over a POST (so the
 * token only ever travels in a body), saves the session, and strips the claim
 * from the URL so it does not linger in history. Returns `signedIn: false` with
 * a null message when the URL carries no claim — i.e. this was an ordinary load,
 * not a sign-in return.
 */
export async function completeGitHubSignIn(input: {
  locationHash?: string;
  bridgeUrl?: string | null;
  fetchImpl?: typeof fetch;
  clearClaim?: () => void;
} = {}): Promise<{ readonly signedIn: boolean; readonly message: string | null }> {
  const hash = input.locationHash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const match = /[#&]relay_claim=([^&]+)/.exec(hash);
  if (match === null) return { signedIn: false, message: null }; // an ordinary load, not a sign-in return
  const claim = decodeURIComponent(match[1]);
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { signedIn: false, message: 'No Relay Bridge is configured for this build.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}/relay-api/auth/github/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim }),
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) {
      return { signedIn: false, message: 'That sign-in link is expired or was already used. Please sign in again.' };
    }
    const payload = await res.json() as {
      data?: { sessionToken?: unknown; scope?: unknown; participantId?: unknown; expiresAt?: unknown };
    };
    const token = payload.data?.sessionToken;
    if (typeof token !== 'string' || token === '') return { signedIn: false, message: 'The bridge returned no session.' };
    saveBridgeSession({
      token,
      origin: typeof window !== 'undefined' ? window.location.origin : '',
      expiresAt: typeof payload.data?.expiresAt === 'string' ? payload.data.expiresAt : '',
      scope: payload.data?.scope === 'browser_control' ? 'browser_control' : 'browser_read_only',
      participantId: typeof payload.data?.participantId === 'string' ? payload.data.participantId : null,
    });
    // Strip the claim from the URL so it never lingers in history or a share.
    (input.clearClaim ?? (() => {
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }))();
    return { signedIn: true, message: null };
  } catch {
    return { signedIn: false, message: 'The Relay Bridge could not be reached.' };
  }
}

/* ------------------------------------------------- connect a repository */

/**
 * BEGIN INSTALLING the Relay GitHub App. A signed-in participant asks the bridge
 * where to install; the bridge answers with the App's install URL carrying a
 * participant-bound state, and the browser goes there. Needs a session — the
 * installation is bound to WHO installs it.
 */
export async function beginRepositoryInstall(input: {
  bridgeUrl?: string | null;
  fetchImpl?: typeof fetch;
  navigate?: (url: string) => void;
} = {}): Promise<{ readonly ok: boolean; readonly message: string | null }> {
  const session = loadBridgeSession();
  if (session === null) return { ok: false, message: 'Sign in before connecting a repository.' };
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, message: 'No Relay Bridge is configured for this build.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}/relay-api/auth/github/install/start`, {
      method: 'POST', headers: bridgeSessionHeader(session), credentials: 'omit', cache: 'no-store',
    });
    if (!res.ok) return { ok: false, message: 'Connecting a repository is not available on this bridge.' };
    const payload = await res.json() as { data?: { installUrl?: unknown } };
    const url = payload.data?.installUrl;
    if (typeof url !== 'string' || url === '') return { ok: false, message: 'The bridge returned no install URL.' };
    (input.navigate ?? ((u: string) => { if (typeof window !== 'undefined') window.location.href = u; }))(url);
    return { ok: true, message: null };
  } catch {
    return { ok: false, message: 'The Relay Bridge could not be reached.' };
  }
}

/** Read the (public) installation id the install redirect left in the URL, or
    null on an ordinary load. The id is not a secret; the token never rides here. */
export function readInstallationFromReturn(input: { locationHash?: string } = {}): string | null {
  const hash = input.locationHash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const match = /[#&]relay_installation=([^&]+)/.exec(hash);
  return match === null ? null : decodeURIComponent(match[1]);
}

/**
 * REGISTER A REPOSITORY the signed-in participant owns. The bridge binds it to
 * their identity from the session (never the body) and refuses a repository they
 * did not authorize. Returns the canonical key on success, or the domain's own
 * refusal message.
 */
export async function registerRepository(input: {
  draft: unknown;
  bridgeUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ readonly ok: boolean; readonly key: string | null; readonly message: string | null }> {
  const session = loadBridgeSession();
  if (session === null) return { ok: false, key: null, message: 'Sign in before connecting a repository.' };
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, key: null, message: 'No Relay Bridge is configured for this build.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}/relay-api/repository/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bridgeSessionHeader(session) },
      body: JSON.stringify(input.draft),
      credentials: 'omit',
      cache: 'no-store',
    });
    const payload = await res.json() as { data?: { key?: unknown }; error?: { message?: unknown } };
    if (!res.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : 'The repository could not be connected.';
      return { ok: false, key: null, message };
    }
    const key = payload.data?.key;
    return { ok: true, key: typeof key === 'string' ? key : null, message: null };
  } catch {
    return { ok: false, key: null, message: 'The Relay Bridge could not be reached.' };
  }
}
