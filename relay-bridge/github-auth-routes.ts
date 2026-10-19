import { createHash, randomBytes } from 'node:crypto';

import type { ReviewerRouteResult } from './reviewer-routes';
import {
  buildAuthorizeUrl,
  exchangeCodeForUser,
  type GitHubOAuthConfig,
  type GitHubUserIdentity,
} from './github-oauth';
import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { discoverInstallationRepositories, type FetchLike } from './github-app-installation';
import type { AppIdentityConfig } from './github-app-identity';

/**
 * "SIGN IN WITH GITHUB" — the product-boundary routes.
 *
 * This is what lets a fresh private-beta user in WITHOUT a founder terminal. The
 * only session-minting path before this was `POST /browser/pair`, which costs
 * the operator token; here a user proves who they are to GitHub and Relay mints
 * a session bound to that verified identity.
 *
 *   GET /auth/github/start     -> a single-use CSRF `state` + the GitHub
 *                                 authorize URL the browser is sent to.
 *   GET /auth/github/callback  -> verify `state`, exchange `code` for the
 *                                 GitHub identity, mint a control session whose
 *                                 participant IS that identity.
 *
 * SECRETS STAY SERVER-SIDE. The client secret and the user access token live in
 * github-oauth.ts and never reach here; this module only ever sees the public
 * identity that comes back. When the GitHub App is not configured, both routes
 * answer 503 truthfully rather than pretending sign-in exists.
 */

export const GITHUB_AUTH_PREFIX = '/auth/github/';

/** How long a browser has to complete the redirect round-trip. Short, because a
    `state` is used within seconds; a restart forgetting it is fail-closed. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const okResult = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const errResult = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { kind, error: message } });

/* ------------------------------------------------------------ state store --- */

export type StateConsumption =
  | { readonly found: true; readonly participant: string | null }
  | { readonly found: false };

export interface OAuthStateStore {
  /** Mint a single-use CSRF state, optionally BOUND to a participant. The bound
   *  participant is recovered at consume — it is how the install callback, a
   *  no-session top-level navigation from GitHub, learns whose installation it
   *  is recording. Returned once; only the state's hash is retained. */
  issue(now: number, participant?: string | null): string;
  /** Recovers the bound participant (may be null) exactly once for a live,
   *  unexpired state; every later or unknown call is `{ found: false }`. */
  consume(state: string, now: number): StateConsumption;
  readonly size: number;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

interface StoredState { readonly expiresAt: number; readonly participant: string | null; }

/**
 * The CSRF states for the sign-in and install redirects, in memory only. A state
 * is a single-use nonce: minted at `start`, burned at `callback`. Stored as a
 * hash so a memory dump cannot replay one, and swept on the write path so an
 * expired nonce is never mistaken for a live one. A state may CARRY a participant
 * — the install flow binds one so its callback knows whose installation it is.
 */
export function createOAuthStateStore(): OAuthStateStore {
  const states = new Map<string, StoredState>();

  const sweep = (now: number): void => {
    for (const [hash, s] of states) if (s.expiresAt <= now) states.delete(hash);
  };

  return {
    issue(now, participant = null) {
      sweep(now);
      const state = randomBytes(32).toString('base64url');
      states.set(sha256(state).toString('base64url'), { expiresAt: now + OAUTH_STATE_TTL_MS, participant });
      return state;
    },
    consume(state, now) {
      if (typeof state !== 'string' || state === '') return { found: false };
      // The map is keyed by the state's hash, so a hit IS the match: a 256-bit
      // random nonce that hashes to a stored key is that nonce (collision
      // resistance), and no separate secret comparison is needed.
      const key = sha256(state).toString('base64url');
      const stored = states.get(key);
      if (stored === undefined) return { found: false };
      // Burn FIRST: a single-use nonce must not survive a concurrent replay,
      // even one arriving in the same millisecond.
      states.delete(key);
      if (stored.expiresAt <= now) return { found: false };
      return { found: true, participant: stored.participant };
    },
    get size() { return states.size; },
  };
}

/* ----------------------------------------------------- installation grants --- */

/** GitHub installation ids are small positive integers. */
const INSTALLATION_ID = /^[0-9]{1,20}$/;

export interface InstallationGrants {
  /** Record that `participant` proved control of `installationId` (via GitHub's
   *  post-install redirect). Idempotent. */
  record(participant: string, installationId: string): void;
  /** Whether this participant proved control of this installation in this
   *  process. In memory only: a restart forgets grants, which is fail-closed —
   *  a durable registration already carries the installation it was built with,
   *  so this is consulted only at REGISTER time, never at ship time. */
  granted(participant: string, installationId: string): boolean;
  readonly size: number;
}

export function createInstallationGrants(): InstallationGrants {
  const byParticipant = new Map<string, Set<string>>();
  return {
    record(participant, installationId) {
      const set = byParticipant.get(participant) ?? new Set<string>();
      set.add(installationId);
      byParticipant.set(participant, set);
    },
    granted(participant, installationId) {
      return byParticipant.get(participant)?.has(installationId) ?? false;
    },
    get size() {
      let n = 0;
      for (const set of byParticipant.values()) n += set.size;
      return n;
    },
  };
}

/* ------------------------------------------------------- sign-in claims --- */

/** How long a browser has to redeem its one-time claim after the redirect. */
export const SIGN_IN_CLAIM_TTL_MS = 2 * 60_000;

/**
 * THE ONE-TIME SIGN-IN CLAIM. The callback cannot hand the session token to a
 * browser in a URL — a token in a URL reaches history, referrers and logs. So it
 * mints a claim: a single-use, short-lived CODE that stands in for the token in
 * the redirect, and is exchanged for the token over a POST whose body carries it.
 * The token itself never appears in any URL.
 */
/** What a redeemed claim yields — the session token plus the public identity a
    frontend needs to show who it acts as. The token travels only in this POST body. */
export interface SignInPayload {
  readonly sessionToken: string;
  readonly scope: string;
  readonly participantId: string | null;
  readonly login: string;
  readonly origin: string;
  readonly expiresAt: string;
}

export interface SignInClaimStore {
  /** Mint a claim standing in for a fresh sign-in payload. Returns the claim code. */
  issue(payload: SignInPayload, now: number): string;
  /** Exchange a claim for its payload exactly once; null if unknown/expired/used. */
  redeem(claim: string, now: number): SignInPayload | null;
  readonly size: number;
}

export function createSignInClaimStore(): SignInClaimStore {
  // Keyed by the claim's hash → the payload it stands for. The token is at rest
  // here only for the ~2 minutes between the redirect and its redemption.
  const claims = new Map<string, { readonly payload: SignInPayload; readonly expiresAt: number }>();
  const sweep = (now: number): void => { for (const [k, v] of claims) if (v.expiresAt <= now) claims.delete(k); };
  return {
    issue(payload, now) {
      sweep(now);
      const claim = randomBytes(32).toString('base64url');
      claims.set(sha256(claim).toString('base64url'), { payload, expiresAt: now + SIGN_IN_CLAIM_TTL_MS });
      return claim;
    },
    redeem(claim, now) {
      if (typeof claim !== 'string' || claim === '') return null;
      const key = sha256(claim).toString('base64url');
      const stored = claims.get(key);
      if (stored === undefined) return null;
      claims.delete(key); // single-use: burn before the expiry check
      if (stored.expiresAt <= now) return null;
      return stored.payload;
    },
    get size() { return claims.size; },
  };
}

/* ---------------------------------------------------------------- routing --- */

export function isGithubAuthRoute(path: string): boolean {
  return path.startsWith(GITHUB_AUTH_PREFIX);
}

/** GitHub's numeric user id is stable across login renames; the login is not.
    Encode the id into the participant shape the session store already accepts. */
export function participantIdForIdentity(identity: GitHubUserIdentity): string {
  return `ghu-${identity.id}`;
}

export interface GithubAuthDeps {
  /** Null when the App is unconfigured — the routes then answer 503. */
  readonly oauthConfig: GitHubOAuthConfig | null;
  readonly sessions: BrowserSessionStore;
  readonly stateStore: OAuthStateStore;
  /** The absolute callback URL registered with the GitHub App. */
  readonly redirectUri: string;
  /** The frontend origin the minted session is bound to. Null => not usable. */
  readonly sessionOrigin: string | null;
  readonly now: number;
  /** Separate single-use state store for the INSTALL flow, so an install state
   *  and a sign-in state can never be redeemed for one another. */
  readonly installStateStore: OAuthStateStore;
  /** Where a proven (participant, installationId) pair is recorded. */
  readonly installGrants: InstallationGrants;
  /** The GitHub App installation URL base (…/apps/<slug>/installations/new).
   *  Null => the install flow answers 503. */
  readonly installBaseUrl: string | null;
  /** One-time claims: the callback mints one and redirects the browser with it;
   *  the frontend exchanges it for the session token over POST /auth/github/claim. */
  readonly claimStore: SignInClaimStore;
  /** The GitHub App's own identity (id + private key), for minting the short-lived
   *  discovery token that lists an installation's repositories. Null => the
   *  discovery route answers 503: there is no App key to mint a token with. The
   *  key is held only here, passed to the mint, and never surfaced. */
  readonly appIdentity: AppIdentityConfig | null;
  /** Test seam. Defaults to the real GitHub exchange. */
  readonly exchange?: (input: {
    config: GitHubOAuthConfig; code: string; redirectUri: string;
  }) => Promise<import('./github-oauth').GitHubUserIdentity | { readonly __error: string }>;
  /** Test seam for the outbound GitHub calls the discovery route makes (mint +
   *  list). Defaults to the real `fetch`; injected in tests so no real network
   *  is touched — mirrors github-app-installation's own `doFetch` seam. */
  readonly discoverFetch?: FetchLike;
}

/** A route result that may redirect. The github-auth callback redirects the
 *  browser back to the frontend with a one-time claim rather than JSON. */
export type GithubAuthResult = ReviewerRouteResult & { readonly redirect?: string };

function queryOf(url: string): URLSearchParams {
  const q = url.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}

/**
 * @param request.url The raw request target WITH its query string — the caller
 *   must pass `req.url`, not the query-stripped dispatch path, because the
 *   callback reads `code` and `state` from the query.
 */
export async function handleGithubAuthRoute(
  request: {
    readonly method: string;
    readonly path: string;
    readonly url: string;
    /** Present for the session-authed install/start; absent for the redirects. */
    readonly authorization?: string | undefined;
    readonly origin?: string | undefined;
    /** Body of a POST (install/start), already parsed. */
    readonly body?: unknown;
  },
  deps: GithubAuthDeps,
): Promise<GithubAuthResult | null> {
  const { method, path } = request;
  if (!isGithubAuthRoute(path)) return null;

  const unconfigured = deps.oauthConfig === null || deps.sessionOrigin === null || deps.redirectUri === '';
  if (unconfigured) {
    // Truthful: the founder has not registered a GitHub App yet, so there is no
    // sign-in. This never fabricates a session.
    return errResult(503, 'github_sign_in_unconfigured',
      'GitHub sign-in is not configured on this bridge.');
  }
  const config = deps.oauthConfig as GitHubOAuthConfig;
  const sessionOrigin = deps.sessionOrigin as string;

  /* ----------------------------------------------------- begin sign-in --- */
  if (method === 'GET' && path === '/auth/github/start') {
    const state = deps.stateStore.issue(deps.now);
    const authorizeUrl = buildAuthorizeUrl({ config, redirectUri: deps.redirectUri, state });
    return okResult({ authorizeUrl, state });
  }

  /* --------------------------------------------------------- callback --- */
  if (method === 'GET' && path === '/auth/github/callback') {
    const query = queryOf(request.url);
    const code = query.get('code') ?? '';
    const state = query.get('state') ?? '';
    if (code === '' || state === '') {
      return errResult(400, 'github_callback_invalid', 'The GitHub callback is missing code or state.');
    }
    // CSRF: the state must be one THIS bridge issued and never yet redeemed.
    // Checked before the code is exchanged, so a forged callback spends nothing.
    if (!deps.stateStore.consume(state, deps.now).found) {
      return errResult(401, 'github_state_invalid', 'That sign-in request is expired or was already used.');
    }

    let identity: GitHubUserIdentity;
    if (deps.exchange) {
      const result = await deps.exchange({ config, code, redirectUri: deps.redirectUri });
      if (result !== null && typeof result === 'object' && '__error' in result) {
        return errResult(401, 'github_exchange_failed', String(result.__error));
      }
      identity = result as GitHubUserIdentity;
    } else {
      const exchanged = await exchangeCodeForUser({ config, code, redirectUri: deps.redirectUri });
      if (!exchanged.ok) {
        // The exchange already stripped the secret/token from its message.
        return errResult(401, 'github_exchange_failed', exchanged.error.message);
      }
      identity = exchanged.value;
    }

    const participantId = participantIdForIdentity(identity);
    const minted = deps.sessions.mintIdentitySession({
      origin: sessionOrigin, now: deps.now, participantId, scope: 'browser_control',
    });
    if (!minted.ok) {
      // A verified GitHub id that does not fit the participant shape is a bug in
      // the encoding, not a user error — refuse rather than mint a nameless one.
      return errResult(500, 'session_mint_failed', 'The verified identity could not be turned into a session.');
    }
    // The token must NOT ride in the redirect URL. Mint a one-time claim, and
    // send the browser back to the frontend with only that claim in the fragment
    // (a fragment never reaches a server or a log); the frontend exchanges it for
    // the token over POST /auth/github/claim.
    const claim = deps.claimStore.issue({
      sessionToken: minted.session.token,
      scope: minted.session.scope,
      participantId: minted.session.participantId,
      login: identity.login,
      origin: minted.session.origin,
      expiresAt: new Date(minted.session.expiresAt).toISOString(),
    }, deps.now);
    return {
      status: 302,
      redirect: `${sessionOrigin}/#relay_claim=${encodeURIComponent(claim)}`,
      body: { data: { redirected: true } },
    };
  }

  /* ------------------------------------ exchange a claim for the session --- */
  if (method === 'POST' && path === '/auth/github/claim') {
    // The exchange is a same-origin POST from the frontend; a claim redeemed from
    // anywhere else is refused, so a leaked claim in history cannot be spent by
    // another site.
    if (request.origin !== undefined && request.origin !== sessionOrigin) {
      return errResult(403, 'origin_not_allowed', 'A sign-in claim may only be redeemed from the approved origin.');
    }
    const claim = typeof (request.body as { claim?: unknown })?.claim === 'string'
      ? (request.body as { claim: string }).claim : '';
    const payload = deps.claimStore.redeem(claim, deps.now);
    if (payload === null) {
      return errResult(401, 'github_claim_invalid', 'That sign-in claim is expired or was already used.');
    }
    return okResult(payload);
  }

  /* ------------------------------------------- begin an app installation --- */
  if (method === 'POST' && path === '/auth/github/install/start') {
    if (deps.installBaseUrl === null || deps.installBaseUrl === '') {
      return errResult(503, 'github_install_unconfigured',
        'GitHub App installation is not configured on this bridge.');
    }
    // WHO is installing must be a signed-in control session — the participant
    // comes from the VERIFIED session, never the body, so a browser cannot bind
    // an installation to anyone but itself.
    const token = sessionTokenFrom(request.authorization);
    if (token === null) {
      return errResult(401, 'authentication_required', 'Installing an app requires a signed-in session.');
    }
    const verified = deps.sessions.verifySession({ token, origin: request.origin, now: deps.now });
    if (!verified.ok || verified.scope !== 'browser_control' || verified.participantId === null) {
      return errResult(401, 'authentication_failed', 'This session cannot authorize an installation.');
    }
    // A state BOUND to the participant, so the no-session callback below knows
    // whose installation it is recording.
    const state = deps.installStateStore.issue(deps.now, verified.participantId);
    const sep = deps.installBaseUrl.includes('?') ? '&' : '?';
    return okResult({ installUrl: `${deps.installBaseUrl}${sep}state=${encodeURIComponent(state)}`, state });
  }

  /* --------------------------------- record a proven installation (redirect) --- */
  if (method === 'GET' && path === '/auth/github/install/callback') {
    const query = queryOf(request.url);
    const installationId = query.get('installation_id') ?? '';
    const state = query.get('state') ?? '';
    if (!INSTALLATION_ID.test(installationId) || state === '') {
      return errResult(400, 'github_install_invalid', 'The installation callback is missing a valid installation_id or state.');
    }
    // The state proves this redirect follows an install THIS user began. Its
    // bound participant is who now controls the installation — recorded so, and
    // only so, may that user register a repository under it.
    const consumed = deps.installStateStore.consume(state, deps.now);
    if (!consumed.found || consumed.participant === null) {
      return errResult(401, 'github_install_state_invalid', 'That installation request is expired or was already used.');
    }
    deps.installGrants.record(consumed.participant, installationId);
    // Send the browser back to the frontend with the (public, non-secret)
    // installation id in the fragment, so it can register a repository under it.
    // Consistent with the sign-in callback: GitHub's redirect must land on the
    // app, not a JSON page.
    return {
      status: 302,
      redirect: `${sessionOrigin}/#relay_installation=${encodeURIComponent(installationId)}`,
      body: { data: { installed: true, installationId } },
    };
  }

  /* --------- DISCOVER the repositories a proven installation can access --- */
  if (method === 'GET' && path === '/auth/github/install/repositories') {
    // WHO is asking must be a signed-in control session — the participant comes
    // from the VERIFIED session, never the query, mirroring install/start. A
    // browser cannot claim an identity it was not paired for.
    const token = sessionTokenFrom(request.authorization);
    if (token === null) {
      return errResult(401, 'authentication_required',
        'Listing installation repositories requires a signed-in session.');
    }
    const verified = deps.sessions.verifySession({ token, origin: request.origin, now: deps.now });
    if (!verified.ok || verified.scope !== 'browser_control' || verified.participantId === null) {
      return errResult(401, 'authentication_failed', 'This session cannot list installation repositories.');
    }
    const installationId = queryOf(request.url).get('installation_id') ?? '';
    if (!INSTALLATION_ID.test(installationId)) {
      return errResult(400, 'github_install_invalid', 'A valid installation_id is required.');
    }
    // The participant must have PROVEN control of THIS installation via the
    // install callback. A valid session is not enough — a browser cannot
    // discover repositories for an installation it never proved.
    if (!deps.installGrants.granted(verified.participantId, installationId)) {
      return errResult(403, 'github_installation_not_proven',
        'This session has not proven control of that installation.');
    }
    // Minting the discovery token needs the App's own key. Absent => a truthful
    // 503, the same shape the other unconfigured routes answer with.
    if (deps.appIdentity === null) {
      return errResult(503, 'github_app_unconfigured',
        'This bridge has no GitHub App key to list installation repositories.');
    }
    // Mint an all-repos, metadata:read token and list the repositories it can
    // reach. The token never leaves `discoverInstallationRepositories`; this
    // route only ever sees names and posture.
    const discovered = await discoverInstallationRepositories({
      appIdentity: deps.appIdentity,
      installationId,
      fetchImpl: deps.discoverFetch,
      // The route's clock is in ms; the App-JWT mint wants seconds.
      nowSeconds: Math.floor(deps.now / 1000),
    });
    if (!discovered.ok) {
      // A truthful refusal — GitHub's status is inside the stripped message —
      // never a fabricated empty list.
      return errResult(502, 'github_repositories_unavailable', discovered.error.message);
    }
    return okResult({
      installationId,
      repositories: discovered.value.repositories.map((r) => ({
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        defaultBranch: r.defaultBranch,
        private: r.private,
      })),
      truncated: discovered.value.truncated,
    });
  }

  return errResult(404, 'github_auth_unknown', 'Unknown GitHub auth operation.');
}
