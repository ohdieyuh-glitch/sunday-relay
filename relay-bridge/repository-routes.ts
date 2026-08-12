import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { createRepositoryRegistration } from '../src/relay/mission/repository-target';
import type { RepositoryRegistrationDraft } from '../src/relay/mission/repository-target';
import type { RepositoryRegistrationStore } from '../src/relay/persistence';

/**
 * THE REPOSITORY REGISTRATION SURFACE — operator only, and only registration.
 *
 * Registration is the authorization spine, so it is the operator's act and no
 * one else's: a browser session, even a control session bound to a participant,
 * may not register a repository. The credential that could mint any session is
 * the same one that gates this, so there is no privilege here a session could
 * borrow.
 *
 * WHAT THIS ROUTE DELIBERATELY IS NOT:
 *   - It does not START a mission, so it spends no provider money and needs no
 *     beta admission. It records a repository a later mission MAY name.
 *   - It does not RESOLVE a target or SHIP. Resolution happens when a mission
 *     names a key; shipping is a separate, separately-authorized operation.
 *   - It does not accept a pre-built registration. The body is a DRAFT, and
 *     `createRepositoryRegistration` is the one validator — the route cannot be
 *     tricked into storing a registration the domain would refuse, because the
 *     route never builds one itself.
 *
 * The canonical key is DERIVED by the domain, never supplied: a registration
 * cannot name its own key any more than a mission can introduce its own
 * repository.
 */

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { error: { kind, message } } });

export function isRepositoryRoute(path: string): boolean {
  return path === '/repository/register' || path === '/repository/list';
}

export interface RepositoryRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  /** The server's clock, never a caller's — it stamps `registeredAt`. */
  readonly now: string;
}

export function handleRepositoryRoute(
  request: RepositoryRouteRequest,
  store: RepositoryRegistrationStore | null,
): ReviewerRouteResult | null {
  if (!isRepositoryRoute(request.path)) return null;

  const operator = bearerMatches(request.authorization, request.env[BRIDGE_TOKEN_ENV]);
  if (!operator) {
    return err(401, 'authentication_failed', 'Repository registration is operator-only.');
  }
  if (store === null) {
    // A registration that does not survive a restart is not a registration.
    return err(503, 'repository_store_unavailable',
      'No durable state root is mounted, so no registration can be recorded.');
  }

  if (request.method === 'POST' && request.path === '/repository/register') {
    if (request.body === null || typeof request.body !== 'object') {
      return err(422, 'validation_failed', 'A registration draft object is required.');
    }
    /**
     * THE BODY IS A DRAFT, VALIDATED BY THE DOMAIN. Whatever shape arrives, the
     * only path to a stored registration is through `createRepositoryRegistration`,
     * which refuses a draft that names no authorizer, a glob in a protected
     * path, a remote provider with no credential env var, and the rest. A
     * refusal returns the domain's own message, unaltered.
     */
    const draft = request.body as RepositoryRegistrationDraft;
    const built = createRepositoryRegistration({ draft, now: request.now });
    if (!built.ok) {
      return err(422, 'registration_refused', built.error.message);
    }
    store.save(built.value);
    // The KEY is what a later mission names; the credential env var NAME travels
    // (never its value), and nothing else that could be sensitive.
    return ok({
      registered: true,
      key: built.value.key,
      credentialEnvVarName: built.value.credential.envVarName,
    });
  }

  if (request.method === 'GET' && request.path === '/repository/list') {
    const listed = store.list();
    if (listed === null) {
      // The store could not read its directory. Unknown, and unknown is not an
      // empty list — the same rule the store itself draws.
      return err(503, 'repository_store_unreadable',
        'Relay cannot read its registration records, so it will not answer against them.');
    }
    /**
     * NAMES AND POSTURE ONLY, never a credential value and never a local path
     * beyond what the operator already put there. `list` is an operator route,
     * but a registration record still carries a `credential.envVarName` and a
     * `location.path`; the summary carries the key, identity, whether the
     * repository is revoked, and the credential env var NAME.
     */
    return ok({
      registrations: listed.map((r) => ({
        key: r.key,
        provider: r.identity.provider,
        owner: r.identity.owner,
        name: r.identity.name,
        defaultBranch: r.identity.defaultBranch,
        grants: r.grants.map((g) => g.permission),
        credentialEnvVarName: r.credential.envVarName,
        revoked: r.revokedAt !== null,
        registeredAt: r.registeredAt,
      })),
    });
  }

  return err(404, 'unknown_repository_route', 'No such repository route.');
}
