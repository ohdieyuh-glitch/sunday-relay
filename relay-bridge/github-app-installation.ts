import { mintAppJwt, type AppIdentityConfig } from './github-app-identity';
import { fail, ok, relayError, type RelayResult } from '../src/relay/protocol/errors';
import type { RepositoryPermission } from '../src/relay/mission/repository-target';

/**
 * ISSUE A GITHUB APP INSTALLATION ACCESS TOKEN — the short-lived, repository-
 * scoped, permission-scoped credential a Mission uses instead of a permanent
 * founder PAT.
 *
 * The flow is App-JWT → `POST /app/installations/{id}/access_tokens`, scoped
 * DOWN at mint time to the ONE repository this Mission targets and the LEAST
 * permissions its granted actions need. GitHub returns a token that expires in
 * ~1 hour and can do nothing outside that repository and those permissions.
 *
 * THE TOKEN IS NEVER SURFACED. It is returned to the caller in memory to hand
 * to the ephemeral git-askpass path; it is never logged, thrown inside an error,
 * attested, persisted, placed in a URL, or returned to a browser. On failure
 * there is no token to leak, and the error carries only an HTTP status and a
 * fixed sentence.
 */

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

const GITHUB_API_ROOT = 'https://api.github.com';

export interface InstallationToken {
  /** The `ghs_…` installation token. SECRET — hand to the credential seam only. */
  readonly token: string;
  /** ISO expiry GitHub reported. Safe to record. */
  readonly expiresAt: string;
  /** The permissions GitHub actually granted the token. Safe to record. */
  readonly permissions: Readonly<Record<string, string>>;
  /** "selected" (scoped to the named repos) or "all". Safe to record. */
  readonly repositorySelection: string;
}

export interface IssueInstallationTokenInput {
  readonly appIdentity: AppIdentityConfig;
  /** The installation the user created when they installed the App on their repo. */
  readonly installationId: string;
  /** The repository names to scope the token to (least blast radius). */
  readonly repositories: readonly string[];
  /** The GitHub App permission map to scope the token to (least privilege). */
  readonly permissions: Readonly<Record<string, string>>;
  readonly fetchImpl?: FetchLike;
  readonly nowSeconds: number;
  readonly apiRoot?: string;
}

const INSTALLATION_ID = /^[0-9]{1,20}$/;

/**
 * Map the Mission's granted repository permissions to the SMALLEST GitHub App
 * permission set that covers them. A read-only Mission gets `contents:read`; a
 * Mission that commits or pushes needs `contents:write`; opening or merging a
 * pull request needs `pull_requests:write`. Nothing is granted that no granted
 * action needs — the token cannot do more than the Mission was authorized to.
 */
export function githubAppPermissionsFor(
  permissions: readonly RepositoryPermission[],
): Readonly<Record<string, string>> {
  const has = (p: RepositoryPermission) => permissions.includes(p);
  const out: Record<string, string> = {};
  // Cloning/reading needs contents:read; committing or pushing escalates it to write.
  if (has('commit') || has('push_feature_branch')) out.contents = 'write';
  else if (has('read') || has('write_worktree')) out.contents = 'read';
  // Pull requests (open or merge) need pull_requests:write; a merge also writes contents.
  if (has('create_pr') || has('merge_pr')) out.pull_requests = 'write';
  if (has('merge_pr')) out.contents = 'write';
  // Deploys are performed by the deployment provider, not this token; not added here.
  return Object.freeze(out);
}

export async function issueInstallationToken(
  input: IssueInstallationTokenInput,
): Promise<RelayResult<InstallationToken>> {
  if (!INSTALLATION_ID.test(input.installationId)) {
    return fail(relayError('validation-failed', 'A numeric GitHub App installation id is required.'));
  }
  if (input.repositories.length === 0) {
    // A token scoped to NO repository is refused rather than silently scoped to all.
    return fail(relayError('validation-failed', 'Refusing to mint an installation token scoped to no repository.'));
  }
  const jwt = mintAppJwt(input.appIdentity, input.nowSeconds);
  if (!jwt.ok) return jwt;

  const doFetch = input.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const root = input.apiRoot ?? GITHUB_API_ROOT;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await doFetch(`${root}/app/installations/${input.installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        // The App JWT authenticates the App itself; it is short-lived and header-only.
        Authorization: `Bearer ${jwt.value}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'relay-github-app',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repositories: [...input.repositories],
        permissions: input.permissions,
      }),
    });
  } catch {
    // A thrown fetch can carry the request (and thus the JWT) in its message; swallow it.
    return fail(relayError('validation-failed', 'The GitHub App installation-token request could not be sent.'));
  }
  if (!response.ok) {
    // Status only. The body may echo nothing sensitive, but we do not forward it.
    return fail(relayError('validation-failed',
      `GitHub refused the installation-token request (HTTP ${response.status}).`));
  }
  let bodyUnknown: unknown;
  try {
    bodyUnknown = await response.json();
  } catch {
    return fail(relayError('validation-failed', 'GitHub returned an unreadable installation-token response.'));
  }
  const body = (bodyUnknown ?? {}) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : '';
  if (token === '') {
    return fail(relayError('validation-failed', 'GitHub returned no installation token.'));
  }
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : '';
  const permissions = (body.permissions && typeof body.permissions === 'object')
    ? (body.permissions as Record<string, string>) : {};
  const repositorySelection = typeof body.repository_selection === 'string'
    ? body.repository_selection : 'unknown';
  return ok({
    token,
    expiresAt,
    permissions: Object.freeze({ ...permissions }),
    repositorySelection,
  });
}
