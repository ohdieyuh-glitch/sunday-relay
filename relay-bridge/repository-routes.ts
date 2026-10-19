import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { createRepositoryRegistration } from '../src/relay/mission/repository-target';
import type { RepositoryRegistrationDraft, RepositoryRegistration } from '../src/relay/mission/repository-target';
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

/**
 * NAMES AND POSTURE ONLY, never a credential value and never a local path. A
 * registration record still carries a `credential.envVarName` and a
 * `location.path`; the summary carries the key, identity, whether the repository
 * is revoked, and the credential env var NAME — never its value, never the path.
 * The one summary shape is shared by the operator listing (every registration)
 * and the participant listing (only their own), so both surfaces expose exactly
 * the same posture and neither can drift into leaking more than the other.
 */
const summarizeRegistration = (r: RepositoryRegistration) => ({
  key: r.key,
  provider: r.identity.provider,
  owner: r.identity.owner,
  name: r.identity.name,
  defaultBranch: r.identity.defaultBranch,
  grants: r.grants.map((g) => g.permission),
  credentialEnvVarName: r.credential.envVarName,
  revoked: r.revokedAt !== null,
  registeredAt: r.registeredAt,
});

export function isRepositoryRoute(path: string): boolean {
  return path === '/repository/register' || path === '/repository/list';
}

/**
 * WHO IS REGISTERING. Resolved by the server from the operator token or a
 * verified browser session — never from the request body. Absent on the request
 * means "derive the operator decision from the token", which keeps every caller
 * that predates user registration behaving exactly as before.
 */
export type RepositoryCaller =
  | { readonly kind: 'operator' }
  | { readonly kind: 'participant'; readonly participantId: string }
  | { readonly kind: 'anonymous' };

/** Just enough of the installation-grant registry to check ownership — a
    structural type, so this module need not depend on the auth-routes module. */
export interface InstallationGrantCheck {
  granted(participant: string, installationId: string): boolean;
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
  /** The resolved caller. Absent => derive operator-or-anonymous from the token. */
  readonly caller?: RepositoryCaller;
}

export function handleRepositoryRoute(
  request: RepositoryRouteRequest,
  store: RepositoryRegistrationStore | null,
  installGrants: InstallationGrantCheck | null = null,
): ReviewerRouteResult | null {
  if (!isRepositoryRoute(request.path)) return null;

  const caller: RepositoryCaller = request.caller
    ?? (bearerMatches(request.authorization, request.env[BRIDGE_TOKEN_ENV])
      ? { kind: 'operator' }
      : { kind: 'anonymous' });

  if (caller.kind === 'anonymous') {
    return err(401, 'authentication_failed', 'Repository registration requires authentication.');
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
     * path, a remote provider with no credential, and the rest. A refusal
     * returns the domain's own message, unaltered.
     */
    const draft = request.body as RepositoryRegistrationDraft;

    if (caller.kind === 'participant') {
      /**
       * A USER REGISTERS ONLY THEIR OWN REPOSITORY. Ownership and the authorizer
       * come from the VERIFIED SESSION, never the body, so a browser cannot bind
       * a repository to anyone but itself. The credential is a GitHub App
       * installation the user PROVED they control (never a founder env var), so a
       * user can never reach a repository through the operator's credentials.
       */
      const installationId = typeof draft.credential?.installationId === 'string'
        ? draft.credential.installationId.trim() : '';
      if (installationId === '') {
        return err(422, 'registration_refused',
          'A user registration must name the GitHub App installation that authorizes it.');
      }
      if (installGrants === null || !installGrants.granted(caller.participantId, installationId)) {
        return err(403, 'installation_not_authorized',
          'You have not authorized that GitHub App installation. Install the app on the repository first.');
      }
      const userDraft: RepositoryRegistrationDraft = {
        ...draft,
        ownerParticipant: caller.participantId,
        registeredBy: caller.participantId,
        // Only the installation, and only the installation — never an env var name.
        credential: { installationId },
      };
      const built = createRepositoryRegistration({ draft: userDraft, now: request.now });
      if (!built.ok) return err(422, 'registration_refused', built.error.message);
      store.save(built.value);
      return ok({ registered: true, key: built.value.key, ownerParticipant: built.value.ownerParticipant });
    }

    // OPERATOR path — the registration is operator-owned. `ownerParticipant` is
    // forced null here so a body field can never make it look user-owned.
    const operatorDraft: RepositoryRegistrationDraft = { ...draft, ownerParticipant: null };
    const built = createRepositoryRegistration({ draft: operatorDraft, now: request.now });
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
    /**
     * ONE ENDPOINT, CALLER-SCOPED. The operator lists EVERY registration; a
     * verified participant lists ONLY their own; anonymous was already refused
     * above. The scope is DERIVED FROM THE RESOLVED CALLER (the verified session
     * or the operator token) — never from the request body or a query param, so
     * a caller cannot widen their own view by asserting an identity.
     */
    const listed = store.list();
    if (listed === null) {
      // The store could not read its directory. Unknown, and unknown is not an
      // empty list — the same rule the store itself draws. This holds for the
      // participant scope too: a participant with an unreadable store is 503, not
      // an empty (and falsely reassuring) list of their own repositories.
      return err(503, 'repository_store_unreadable',
        'Relay cannot read its registration records, so it will not answer against them.');
    }

    if (caller.kind === 'operator') {
      // THE OPERATOR SEES EVERY REGISTRATION — intentional and unchanged.
      return ok({ registrations: listed.map(summarizeRegistration) });
    }

    /**
     * A PARTICIPANT SEES ONLY THEIR OWN. Strict equality to the caller's own
     * participant id: a participant can never see another participant's
     * registration, nor an operator-owned (`ownerParticipant === null`) one. The
     * id is the VERIFIED session's, so it cannot be forged from the request.
     */
    const mine = listed.filter((r) => r.ownerParticipant === caller.participantId);
    return ok({ registrations: mine.map(summarizeRegistration) });
  }

  return err(404, 'unknown_repository_route', 'No such repository route.');
}
