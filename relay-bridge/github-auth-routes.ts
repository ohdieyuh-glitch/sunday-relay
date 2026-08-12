import { createHash, randomBytes } from 'node:crypto';

import type { ReviewerRouteResult } from './reviewer-routes';
import {
  buildAuthorizeUrl,
  exchangeCodeForUser,
  type GitHubOAuthConfig,
  type GitHubUserIdentity,
} from './github-oauth';
import type { BrowserSessionStore } from './browser-session/grants';

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

export interface OAuthStateStore {
  /** Mint a single-use CSRF state. Returned once; only its hash is retained. */
  issue(now: number): string;
  /** True exactly once for a live, unexpired state; every later call is false. */
  consume(state: string, now: number): boolean;
  readonly size: number;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * The CSRF states for the sign-in redirect, in memory only. A state is a
 * single-use nonce: minted at `start`, burned at `callback`. Stored as a hash so
 * a memory dump cannot replay one, and swept on the write path so an expired
 * nonce is never mistaken for a live one.
 */
export function createOAuthStateStore(): OAuthStateStore {
  const states = new Map<string, number>();

  const sweep = (now: number): void => {
    for (const [hash, expiresAt] of states) if (expiresAt <= now) states.delete(hash);
  };

  return {
    issue(now) {
      sweep(now);
      const state = randomBytes(32).toString('base64url');
      states.set(sha256(state).toString('base64url'), now + OAUTH_STATE_TTL_MS);
      return state;
    },
    consume(state, now) {
      if (typeof state !== 'string' || state === '') return false;
      // The map is keyed by the state's hash, so a hit IS the match: a 256-bit
      // random nonce that hashes to a stored key is that nonce (collision
      // resistance), and no separate secret comparison is needed.
      const key = sha256(state).toString('base64url');
      const expiresAt = states.get(key);
      if (expiresAt === undefined) return false;
      // Burn FIRST: a single-use nonce must not survive a concurrent replay,
      // even one arriving in the same millisecond.
      states.delete(key);
      return expiresAt > now;
    },
    get size() { return states.size; },
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
  /** Test seam. Defaults to the real GitHub exchange. */
  readonly exchange?: (input: {
    config: GitHubOAuthConfig; code: string; redirectUri: string;
  }) => Promise<import('./github-oauth').GitHubUserIdentity | { readonly __error: string }>;
}

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
  },
  deps: GithubAuthDeps,
): Promise<ReviewerRouteResult | null> {
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
    if (!deps.stateStore.consume(state, deps.now)) {
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
    return okResult({
      // The Relay-Session token the browser presents on later calls. Returned
      // once; the store keeps only its hash.
      sessionToken: minted.session.token,
      scope: minted.session.scope,
      // WHO this browser now acts as — a public accountability fact, the GitHub
      // login, never a secret. The session's binding uses the stable numeric id.
      participantId: minted.session.participantId,
      login: identity.login,
      origin: minted.session.origin,
      expiresAt: new Date(minted.session.expiresAt).toISOString(),
    });
  }

  return errResult(404, 'github_auth_unknown', 'Unknown GitHub auth operation.');
}
