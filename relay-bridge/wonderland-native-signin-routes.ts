import { createHash, randomBytes } from 'node:crypto';
import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { participantIdForIdentity } from './github-auth-routes';

/**
 * THE WONDERLAND DESKTOP CLIENT SIGNS IN -- GitHub's device flow, verified by the bridge (R16, 2026-10-03).
 *
 * A player in the desktop client has no browser session to pair from, and a player with no project could not pair at all
 * (wonderland-native-pairing-routes.ts binds a pairing to one project). So the client signs its player in itself, the way a
 * console or a CLI does, through GitHub's OAuth DEVICE FLOW on the bridge's existing GitHub App:
 *
 *   POST /wonderland/native/signin/start    The bridge asks GitHub for a device code, KEEPS IT (in memory, under a random
 *                                           handle whose hash is the key), and gives the client only the handle, the short
 *                                           code the player types, and the address they type it at.
 *   POST /wonderland/native/signin/poll     The bridge -- never the client -- asks GitHub whether the player approved. On
 *        {handle}                           approval it reads WHO they are from GitHub with the user token, DISCARDS that
 *                                           token (never stored, logged or returned), records the player, and mints a
 *                                           `native_social` session (grants.ts) for the SAME `ghu-<id>` participant the
 *                                           website sign-in produces -- one identity system, not two.
 *   POST /wonderland/native/signin/revoke   The client signs out (Authorization: Relay-Session <token>).
 *
 * DESKTOP ONLY. A request carrying a web Origin is refused: no page can start, finish or end a desktop sign-in.
 * NO SECRET. The device flow needs the App's public client id only; RELAY_GITHUB_APP_CLIENT_SECRET is never read here.
 * OFF BY DEFAULT. Unless the deployment sets WONDERLAND_SOCIAL_ENABLED=1 and has a client id, every route answers 503.
 * IN MEMORY. A pending sign-in, like every session, dies with the process -- the fail-closed direction.
 * NO ADMISSION HERE. As on the website's sign-in, signing in spends nothing; the beta gate guards spending, not identity.
 */

export const NATIVE_SIGNIN_PREFIX = '/wonderland/native/signin/';

/** How many sign-ins may be pending at once: a bound on memory, not a policy. */
export const MAX_PENDING_SIGNINS = 1000;
/** GitHub's device codes live 15 minutes; never trust a longer claim. */
const MAX_DEVICE_TTL_S = 900;
const MIN_INTERVAL_S = 5;

export type SignInFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface NativeSignInRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly body: unknown;
  readonly now: number;
}

export interface NativeSignInResult {
  readonly status: number;
  readonly body: unknown;
}

/** One pending sign-in. The device code is GitHub's secret for this sign-in and never leaves the bridge. */
interface PendingSignIn {
  readonly deviceCode: string;
  readonly expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  inFlight: boolean;
}

export interface PendingSignInStore {
  /** Keep a device code; returns the handle the client will poll with. Null when full. */
  put(deviceCode: string, expiresAt: number, intervalMs: number, now: number): string | null;
  get(handle: string, now: number): PendingSignIn | null | 'expired';
  drop(handle: string): void;
  readonly size: number;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('base64url');

export function createPendingSignInStore(limit = MAX_PENDING_SIGNINS): PendingSignInStore {
  const pending = new Map<string, PendingSignIn>();
  const sweep = (now: number): void => { for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k); };
  return {
    put(deviceCode, expiresAt, intervalMs, now) {
      sweep(now);
      if (pending.size >= limit) return null;
      const handle = randomBytes(32).toString('base64url');
      pending.set(sha256(handle), { deviceCode, expiresAt, intervalMs, nextPollAt: now, inFlight: false });
      return handle;
    },
    get(handle, now) {
      if (typeof handle !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(handle)) return null;
      const key = sha256(handle);
      const entry = pending.get(key);
      if (entry === undefined) return null;
      if (entry.expiresAt <= now) {
        pending.delete(key);
        return 'expired';
      }
      return entry;
    },
    drop(handle) {
      if (typeof handle === 'string') pending.delete(sha256(handle));
    },
    get size() { return pending.size; },
  };
}

export interface NativeSignInDeps {
  /** WONDERLAND_SOCIAL_ENABLED === '1' on this deployment. */
  readonly enabled: boolean;
  /** The GitHub App's public client id (RELAY_GITHUB_APP_CLIENT_ID); null when unset. */
  readonly clientId: string | null;
  readonly sessions: BrowserSessionStore;
  readonly pending: PendingSignInStore;
  /**
   * Record the verified player BEFORE their session exists: the row the social store's records reference, and the login
   * their social record is named from. Throws when it cannot be recorded; nothing is minted then.
   */
  readonly recordPlayer: (player: { readonly participantId: string; readonly login: string }) => Promise<void>;
  /**
   * THE SOCIAL SCHEMA IS THERE (MAIN JUJU's early read, 10-04; the founder's explicit-apply ruling for the social migration, 033 since the 10-04 renumbering). With the flag on but the
   * schema not yet applied to this store, sign-in answers the same 503 the social routes do -- before GitHub is asked and before any
   * players row is written. Absent: ready (the tests' default).
   */
  readonly socialReady?: () => Promise<boolean>;
  /**
   * SIGN-OUT ENDS PRESENCE (Second's R16 run, 10-04: A signed out and C still saw A ONLINE until the bridge restarted). Called
   * after the session is revoked, with the player it belonged to; server.ts ends their social presence and world place
   * (endSocialPresence). A failure here never undoes the sign-out.
   */
  readonly onSignOut?: (participantId: string, now: number) => Promise<void>;
  readonly fetchImpl?: SignInFetch;
  /**
   * The server's WARN log. Only a failed device-code request writes to it: GitHub's HTTP status and GitHub's `error` CODE
   * (matched to [a-z_]{1,64}), never the client id, a device or user code, or any text of GitHub's answer.
   */
  readonly log?: (line: string) => void;
  readonly oauthRoot?: string;
  readonly apiRoot?: string;
}

const ok = (data: unknown): NativeSignInResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): NativeSignInResult => ({ status, body: { error: { kind, message } } });

const UNAVAILABLE = (): NativeSignInResult =>
  err(503, 'signin_unavailable', 'Signing in from the desktop is not available on this server right now.');
const FAILED = (): NativeSignInResult =>
  err(401, 'signin_failed', 'This sign-in is not known or is already finished. Start signing in again.');
const EXPIRED = (): NativeSignInResult =>
  err(401, 'signin_expired', 'This sign-in code expired before it was approved. Start signing in again.');
const DENIED = (): NativeSignInResult =>
  err(401, 'signin_denied', 'The sign-in was declined on GitHub.');

export function isNativeSignInRoute(path: string): boolean {
  return path.startsWith(NATIVE_SIGNIN_PREFIX);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

async function postJson(doFetch: SignInFetch, url: string, payload: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'relay-github-app' },
      body: JSON.stringify(payload),
    });
    // GitHub answers the device-flow errors with HTTP 200 and an `error` field; any non-2xx is a failure to ask at all.
    if (!response.ok) return null;
    return asRecord(await response.json());
  } catch {
    // A thrown fetch can carry the request body (the device code) in its message: say nothing of it.
    return null;
  }
}

/** The device-code request, with GitHub's HTTP status kept for the WARN line (null status: the request never got an answer). */
async function postDeviceCode(doFetch: SignInFetch, url: string, payload: Record<string, string>): Promise<{ status: number | null; body: Record<string, unknown> | null }> {
  let response: Awaited<ReturnType<SignInFetch>>;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'relay-github-app' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { status: null, body: null }; // a thrown fetch can carry the request body in its message: say nothing of it
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = asRecord(await response.json());
  } catch {
    body = null;
  }
  // GitHub answers the device-flow errors with HTTP 200 and an `error` field; a non-2xx (e.g. 400 device_flow_disabled) is a refusal too
  return { status: response.status, body: response.ok ? body : { error: body?.error } };
}

/** GitHub's error CODE, safe for a log line: [a-z_]{1,64} or a fixed word -- never free text. */
const githubErrorCode = (value: unknown): string => (typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : 'unrecognised');

export async function handleNativeSignInRoute(
  request: NativeSignInRequest,
  deps: NativeSignInDeps,
): Promise<NativeSignInResult | null> {
  if (!isNativeSignInRoute(request.path)) return null;
  const { method, path, now } = request;
  if (method !== 'POST') return err(405, 'method_not_allowed', 'Desktop sign-in is a POST.');
  // DESKTOP ONLY: every one of these is the native client's, so a web page is refused before anything else happens.
  if (request.origin !== undefined && request.origin !== '') {
    return err(403, 'native_client_only', 'Desktop sign-in is done by the Wonderland desktop client, not from a web page.');
  }
  const doFetch = deps.fetchImpl ?? (globalThis.fetch as unknown as SignInFetch);
  const oauthRoot = deps.oauthRoot ?? 'https://github.com';
  const apiRoot = deps.apiRoot ?? 'https://api.github.com';

  /* ------------------------------------------------------------ sign out */
  if (path === '/wonderland/native/signin/revoke') {
    const token = sessionTokenFrom(request.authorization);
    const verified = token === null ? null : deps.sessions.verifyNativeSocialSession({ token, now });
    if (token === null || verified === null || !verified.ok) {
      return err(401, 'not_signed_in', 'There is no desktop sign-in to end.');
    }
    deps.sessions.revokeSession({ token, now });
    if (deps.onSignOut !== undefined) {
      try {
        await deps.onSignOut(verified.participantId, now);
      } catch {
        // the sign-out itself stands; presence is the social store's to settle
      }
    }
    return ok({ revoked: true });
  }

  if (!deps.enabled || deps.clientId === null || deps.clientId.trim() === '') return UNAVAILABLE();
  if (deps.socialReady !== undefined && !(await deps.socialReady())) return UNAVAILABLE();
  const clientId = deps.clientId.trim();

  /* ---------------------------------------------------------------- start */
  if (path === '/wonderland/native/signin/start') {
    const asked = await postDeviceCode(doFetch, `${oauthRoot}/login/device/code`, { client_id: clientId });
    // ONE WARN line per failed request, for the operator (the caller's answer stays the same silent 503): GitHub's HTTP status
    // and error CODE only -- never the client id, a code, or GitHub's text.
    const refused = (why: string): NativeSignInResult => {
      deps.log?.(`wonderland sign-in: GitHub refused the device-code request (HTTP ${asked.status ?? 'none'}, ${why}) -- answering 503 signin_unavailable`);
      return UNAVAILABLE();
    };
    const answer = asked.body;
    if (asked.status === null) return refused('error=no_answer');
    if (answer === null) return refused('error=unreadable_answer');
    const deviceCode = typeof answer.device_code === 'string' ? answer.device_code : '';
    const userCode = typeof answer.user_code === 'string' ? answer.user_code : '';
    const verificationUri = typeof answer.verification_uri === 'string' ? answer.verification_uri : '';
    // device_flow_disabled, incorrect_client_credentials, unauthorized_client …: this deployment cannot sign anyone in.
    if (answer.error !== undefined && answer.error !== null) return refused(`error=${githubErrorCode(answer.error)}`);
    if (asked.status < 200 || asked.status > 299) return refused('error=unrecognised');
    if (deviceCode === '' || deviceCode.length > 200) return refused('error=no_device_code');
    // What the player is shown must be GitHub's own short code and GitHub's own page, nothing an answer could smuggle in.
    if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(userCode)) return refused('error=malformed_user_code');
    if (!verificationUri.startsWith(`${oauthRoot}/`) || verificationUri.length > 200) return refused('error=foreign_verification_uri');
    const expiresIn = typeof answer.expires_in === 'number' && answer.expires_in > 0 ? Math.min(answer.expires_in, MAX_DEVICE_TTL_S) : MAX_DEVICE_TTL_S;
    const interval = typeof answer.interval === 'number' && answer.interval >= MIN_INTERVAL_S ? answer.interval : MIN_INTERVAL_S;
    const expiresAt = now + expiresIn * 1000;
    const handle = deps.pending.put(deviceCode, expiresAt, interval * 1000, now);
    if (handle === null) return err(503, 'signin_busy', 'Too many sign-ins are in progress. Try again in a minute.');
    return ok({ handle, userCode, verificationUri, interval, expiresAt: new Date(expiresAt).toISOString() });
  }

  /* ----------------------------------------------------------------- poll */
  if (path === '/wonderland/native/signin/poll') {
    const handle = asRecord(request.body).handle;
    if (typeof handle !== 'string') return FAILED();
    const entry = deps.pending.get(handle, now);
    if (entry === 'expired') return EXPIRED();
    if (entry === null) return FAILED();
    const pendingAnswer = () => ok({ state: 'pending', interval: Math.ceil(entry.intervalMs / 1000) });
    // GITHUB'S PACE, NOT THE CLIENT'S: a poll before the interval, or while one is in flight, does not reach GitHub.
    if (entry.inFlight || now < entry.nextPollAt) return pendingAnswer();
    entry.inFlight = true;
    try {
      const answer = await postJson(doFetch, `${oauthRoot}/login/oauth/access_token`, {
        client_id: clientId,
        device_code: entry.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      entry.nextPollAt = now + entry.intervalMs;
      if (answer === null) return pendingAnswer(); // GitHub unreachable this time: the code is still good, ask again later
      const error = typeof answer.error === 'string' ? answer.error : null;
      if (error === 'authorization_pending') return pendingAnswer();
      if (error === 'slow_down') {
        const asked = typeof answer.interval === 'number' ? answer.interval * 1000 : entry.intervalMs + 5000;
        entry.intervalMs = Math.max(entry.intervalMs + 5000, asked);
        entry.nextPollAt = now + entry.intervalMs;
        return pendingAnswer();
      }
      if (error !== null) {
        deps.pending.drop(handle);
        if (error === 'expired_token') return EXPIRED();
        if (error === 'access_denied') return DENIED();
        return FAILED();
      }
      const userToken = typeof answer.access_token === 'string' ? answer.access_token : '';
      // From here the device code is spent, whatever happens next.
      deps.pending.drop(handle);
      if (userToken === '') return FAILED();
      let identity: { login: string; id: number; type: string } | null = null;
      try {
        const response = await doFetch(`${apiRoot}/user`, {
          headers: { Authorization: `Bearer ${userToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'relay-github-app' },
        });
        if (response.ok) {
          const user = asRecord(await response.json());
          const login = typeof user.login === 'string' ? user.login : '';
          const id = typeof user.id === 'number' && Number.isSafeInteger(user.id) && user.id > 0 ? user.id : 0;
          if (/^[A-Za-z0-9-]{1,39}$/.test(login) && id > 0) identity = { login, id, type: typeof user.type === 'string' ? user.type : 'User' };
        }
      } catch {
        identity = null;
      }
      // The user token is out of scope from here on: used once, to ask GitHub who this is, and never kept.
      if (identity === null) return FAILED();
      const participantId = participantIdForIdentity(identity);
      try {
        await deps.recordPlayer({ participantId, login: identity.login });
      } catch {
        return err(503, 'signin_unavailable', 'You were verified, but this server could not record your player. Sign in again shortly.');
      }
      const minted = deps.sessions.mintNativeSocialSession({ now, participantId });
      if (!minted.ok) return err(500, 'signin_failed', 'The verified identity could not be turned into a session.');
      return ok({
        state: 'signed_in',
        token: minted.session.token,
        expiresAt: new Date(minted.session.expiresAt).toISOString(),
        participantId,
        login: identity.login,
      });
    } finally {
      entry.inFlight = false;
    }
  }

  return err(404, 'unknown_signin_route', 'Desktop sign-in serves /wonderland/native/signin/start, /poll and /revoke.');
}
