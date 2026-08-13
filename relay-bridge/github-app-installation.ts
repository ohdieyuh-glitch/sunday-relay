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

export type FetchLike = (url: string, init?: {
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

/* --------------------------------------- authorized-repository DISCOVERY --- */

/**
 * The identity + posture of one repository an installation can access. NAMES and
 * POSTURE ONLY — never a token, never a URL that could carry one. `defaultBranch`
 * is null when GitHub did not report one (Unknown is never a default), and
 * `private` fails CLOSED to `true` when visibility is unreported, so an
 * unconfirmable repository is never rendered as public.
 */
export interface DiscoveredRepository {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string | null;
  readonly private: boolean;
}

export interface InstallationRepositoryDiscovery {
  readonly repositories: readonly DiscoveredRepository[];
  /**
   * True when GitHub reported MORE repositories than this first page returned —
   * the list is then a lower bound, not the whole set. Reported so a caller
   * never mistakes a capped page for "these are all of them".
   */
  readonly truncated: boolean;
}

/** GitHub caps a page at 100; the discovery proof reads the first page only. */
const DISCOVERY_PAGE_SIZE = 100;

/**
 * DISCOVER the repositories an installation can access — GitHub's authorized-
 * repository discovery — returning identity/posture only.
 *
 * It mints an installation token scoped to ALL repos the installation can reach
 * (POST without a `repositories` field) with only `metadata:read` — the LEAST
 * privilege that can list repositories and nothing that could read code or
 * write — then GETs `/installation/repositories` with it. The token is minted,
 * used in one `Authorization` header, and DISCARDED inside this function: it is
 * never returned, logged, thrown, or placed in a URL, exactly like every other
 * installation token. On any GitHub failure this returns a truthful error
 * carrying only an HTTP status and a fixed sentence — never a fabricated empty
 * list.
 *
 * Reuses the SAME App-JWT mint and the SAME outbound fetch seam as
 * `issueInstallationToken`; it invents no second HTTP path.
 */
export async function discoverInstallationRepositories(input: {
  readonly appIdentity: AppIdentityConfig;
  readonly installationId: string;
  readonly fetchImpl?: FetchLike;
  readonly nowSeconds: number;
  readonly apiRoot?: string;
}): Promise<RelayResult<InstallationRepositoryDiscovery>> {
  if (!INSTALLATION_ID.test(input.installationId)) {
    return fail(relayError('validation-failed', 'A numeric GitHub App installation id is required.'));
  }
  const jwt = mintAppJwt(input.appIdentity, input.nowSeconds);
  if (!jwt.ok) return jwt;

  const doFetch = input.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const root = input.apiRoot ?? GITHUB_API_ROOT;

  // 1) Mint an ALL-repos, metadata:read token. No `repositories` field => GitHub
  //    returns a token scoped to every repo the installation can access; the
  //    token is SECRET and never leaves this function.
  let tokenResp: Awaited<ReturnType<FetchLike>>;
  try {
    tokenResp = await doFetch(`${root}/app/installations/${input.installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt.value}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'relay-github-app',
        'Content-Type': 'application/json',
      },
      // NO `repositories` field: an all-repos token, scoped to metadata:read only.
      body: JSON.stringify({ permissions: { metadata: 'read' } }),
    });
  } catch {
    // A thrown fetch can carry the request (and thus the JWT); swallow it.
    return fail(relayError('validation-failed', 'The GitHub App installation-token request could not be sent.'));
  }
  if (!tokenResp.ok) {
    return fail(relayError('validation-failed',
      `GitHub refused the installation-token request (HTTP ${tokenResp.status}).`));
  }
  let tokenBody: Record<string, unknown>;
  try {
    tokenBody = (await tokenResp.json() ?? {}) as Record<string, unknown>;
  } catch {
    return fail(relayError('validation-failed', 'GitHub returned an unreadable installation-token response.'));
  }
  const token = typeof tokenBody.token === 'string' ? tokenBody.token : '';
  if (token === '') {
    return fail(relayError('validation-failed', 'GitHub returned no installation token.'));
  }

  // 2) List the repositories the token can access. The token appears ONLY in
  //    this Authorization header; it is never returned or surfaced.
  let reposResp: Awaited<ReturnType<FetchLike>>;
  try {
    reposResp = await doFetch(`${root}/installation/repositories?per_page=${DISCOVERY_PAGE_SIZE}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'relay-github-app',
      },
    });
  } catch {
    return fail(relayError('validation-failed', 'The GitHub installation-repositories request could not be sent.'));
  }
  if (!reposResp.ok) {
    return fail(relayError('validation-failed',
      `GitHub refused the installation-repositories request (HTTP ${reposResp.status}).`));
  }
  let reposBody: Record<string, unknown>;
  try {
    reposBody = (await reposResp.json() ?? {}) as Record<string, unknown>;
  } catch {
    return fail(relayError('validation-failed', 'GitHub returned an unreadable installation-repositories response.'));
  }

  const rawList = Array.isArray(reposBody.repositories) ? reposBody.repositories : [];
  const repositories: DiscoveredRepository[] = [];
  for (const entry of rawList) {
    if (entry === null || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : '';
    const ownerObj = (r.owner && typeof r.owner === 'object') ? r.owner as Record<string, unknown> : {};
    const owner = typeof ownerObj.login === 'string' ? ownerObj.login : '';
    // An entry without an identity is not a repository; skip it rather than
    // emit a nameless row.
    if (name === '' || owner === '') continue;
    const fullName = typeof r.full_name === 'string' && r.full_name !== ''
      ? r.full_name : `${owner}/${name}`;
    const defaultBranch = typeof r.default_branch === 'string' && r.default_branch !== ''
      ? r.default_branch : null;
    // Fail CLOSED: an unreported visibility is treated as private, never public.
    const isPrivate = typeof r.private === 'boolean' ? r.private : true;
    repositories.push({ owner, name, fullName, defaultBranch, private: isPrivate });
  }
  const totalCount = typeof reposBody.total_count === 'number' ? reposBody.total_count : repositories.length;
  const truncated = totalCount > repositories.length;
  return ok({ repositories, truncated });
}
