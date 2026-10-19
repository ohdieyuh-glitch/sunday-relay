import { fail, ok, relayError, type RelayResult } from '../src/relay/protocol/errors';

/**
 * SIGN IN WITH GITHUB — the user-to-server OAuth flow of the SAME GitHub App
 * that authorizes repositories.
 *
 * This closes the product-boundary auth gap: today the only way to mint a
 * session is the operator's `/browser/pair`, so a fresh user cannot get in
 * without the founder running a CLI. A GitHub App's user OAuth flow gives Relay
 * a verified GitHub identity — `authorize URL → code → user access token →
 * GET /user` — from which a user principal (and then a session) is minted, no
 * operator token involved.
 *
 * SECRETS STAY SERVER-SIDE. The client secret and the user access token are used
 * here and nowhere else: never logged, thrown inside an error, returned to the
 * browser, put in a URL that reaches the browser, attested, or persisted. Only
 * the resulting `login`/`id` — a public identity — leaves this module.
 */

export interface GitHubOAuthConfig {
  readonly clientId: string;
  /** SECRET — never logged/returned/persisted. */
  readonly clientSecret: string;
}

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const OAUTH_ROOT = 'https://github.com';
const API_ROOT = 'https://api.github.com';

/**
 * Read the GitHub App OAuth config from server-side env: `RELAY_GITHUB_APP_-
 * CLIENT_ID` and `RELAY_GITHUB_APP_CLIENT_SECRET`. Null when unset — the bridge
 * then has no user sign-in and says so, rather than pretending.
 */
export function githubOAuthConfigFromEnv(env: NodeJS.ProcessEnv): GitHubOAuthConfig | null {
  const clientId = env.RELAY_GITHUB_APP_CLIENT_ID;
  const clientSecret = env.RELAY_GITHUB_APP_CLIENT_SECRET;
  if (typeof clientId !== 'string' || clientId.trim() === '') return null;
  if (typeof clientSecret !== 'string' || clientSecret.trim() === '') return null;
  return { clientId: clientId.trim(), clientSecret };
}

/**
 * The URL the browser is sent to, to authorize the App. `state` is an opaque,
 * single-use, server-generated CSRF token the caller must verify on the callback
 * — never a caller-influenced value. The client SECRET is never in this URL
 * (only the public client id is), so it is safe to hand to a browser.
 */
export function buildAuthorizeUrl(input: {
  readonly config: GitHubOAuthConfig;
  readonly redirectUri: string;
  readonly state: string;
  readonly oauthRoot?: string;
}): string {
  const root = input.oauthRoot ?? OAUTH_ROOT;
  const params = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    // A GitHub App user token's scope is the App's configured user permissions;
    // no `scope` param is sent (and none that could widen it).
  });
  return `${root}/login/oauth/authorize?${params.toString()}`;
}

export interface GitHubUserIdentity {
  readonly login: string;
  readonly id: number;
  readonly type: string;
}

/**
 * Exchange the callback `code` for a user access token, then read the identity
 * it belongs to. Returns ONLY the public identity; the access token is used to
 * call `/user` and then discarded, never surfaced.
 */
export async function exchangeCodeForUser(input: {
  readonly config: GitHubOAuthConfig;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetchImpl?: FetchLike;
  readonly oauthRoot?: string;
  readonly apiRoot?: string;
}): Promise<RelayResult<GitHubUserIdentity>> {
  if (typeof input.code !== 'string' || input.code.trim() === '') {
    return fail(relayError('validation-failed', 'A GitHub OAuth code is required to sign in.'));
  }
  const doFetch = input.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const oauthRoot = input.oauthRoot ?? OAUTH_ROOT;
  const apiRoot = input.apiRoot ?? API_ROOT;

  let tokenResp: Awaited<ReturnType<FetchLike>>;
  try {
    tokenResp = await doFetch(`${oauthRoot}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'relay-github-app' },
      body: JSON.stringify({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    });
  } catch {
    // A thrown fetch can carry the request body (the secret + code) in its message.
    return fail(relayError('validation-failed', 'The GitHub OAuth token request could not be sent.'));
  }
  if (!tokenResp.ok) {
    return fail(relayError('validation-failed', `GitHub refused the OAuth token exchange (HTTP ${tokenResp.status}).`));
  }
  let tokenBody: Record<string, unknown>;
  try {
    tokenBody = (await tokenResp.json() ?? {}) as Record<string, unknown>;
  } catch {
    return fail(relayError('validation-failed', 'GitHub returned an unreadable OAuth token response.'));
  }
  const accessToken = typeof tokenBody.access_token === 'string' ? tokenBody.access_token : '';
  if (accessToken === '') {
    // GitHub reports an `error` field on a bad code; do not echo it verbatim.
    return fail(relayError('validation-failed', 'GitHub returned no user access token for this sign-in.'));
  }

  let userResp: Awaited<ReturnType<FetchLike>>;
  try {
    userResp = await doFetch(`${apiRoot}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'relay-github-app',
      },
    });
  } catch {
    return fail(relayError('validation-failed', 'The GitHub identity request could not be sent.'));
  }
  if (!userResp.ok) {
    return fail(relayError('validation-failed', `GitHub refused the identity request (HTTP ${userResp.status}).`));
  }
  let userBody: Record<string, unknown>;
  try {
    userBody = (await userResp.json() ?? {}) as Record<string, unknown>;
  } catch {
    return fail(relayError('validation-failed', 'GitHub returned an unreadable identity.'));
  }
  const login = typeof userBody.login === 'string' ? userBody.login : '';
  const id = typeof userBody.id === 'number' ? userBody.id : 0;
  if (login === '' || id === 0) {
    return fail(relayError('validation-failed', 'GitHub returned an identity without a login.'));
  }
  // The access token is now out of scope and never surfaced.
  return ok({ login, id, type: typeof userBody.type === 'string' ? userBody.type : 'User' });
}
