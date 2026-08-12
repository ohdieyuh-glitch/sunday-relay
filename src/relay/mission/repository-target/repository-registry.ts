/**
 * THE REGISTRY — how a repository becomes nameable, and how it stops being.
 *
 * Registration is a FOUNDER ACTION. It is never inferred from a URL in an
 * objective, never implied by a credential's reach, and never created as a side
 * effect of a Mission asking for it. A token that can see fifty repositories
 * authorizes zero targets; fifty registrations authorize fifty, and somebody's
 * name is on each one.
 *
 * This module builds and reads registrations. It does not store them: the
 * durable store is Node-side and lives with the rest of the persistence layer,
 * which is the boundary that keeps this file loadable in a browser. A registry
 * here is a frozen snapshot somebody else read.
 *
 * WHY BUILDING IS A FUNCTION AND NOT A CONSTRUCTOR. Every field of a
 * registration is a security decision, and the failure mode is not a crash —
 * it is a registration that looks fine and permits more than intended. So this
 * validates all of them and returns EVERY problem, because a founder who fixes
 * refusals one at a time learns to widen configuration until the errors stop.
 */

import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  DEFAULT_CHANGE_CEILINGS,
  type ChangeCeilings,
  type CredentialBoundary,
  type PermissionGrant,
  type ProtectedPathConfig,
  type RepositoryIdentity,
  type RepositoryLocation,
  type RepositoryPermission,
  type RepositoryProblem,
  type RepositoryRegistration,
  type RepositoryScope,
} from './repository-contracts';
import {
  validateRepositoryIdentity,
  validateRepositoryLocation,
  validRepositoryBranchName,
} from './repository-identity';
import { resolveProtectedPaths, validateRepositoryScope } from './repository-scope';
import { requiresCredential, validatePermissionGrants } from './repository-authorization';

/**
 * WHAT A FOUNDER SUPPLIES. Note what is absent: `key` (derived, never
 * supplied — a caller-chosen key is a caller-chosen identity) and `revokedAt`
 * (a registration cannot be born revoked).
 */
export interface RepositoryRegistrationDraft {
  readonly identity: RepositoryIdentity;
  readonly location: RepositoryLocation;
  readonly scope: RepositoryScope;
  readonly protectedPaths?: ProtectedPathConfig;
  readonly ceilings?: ChangeCeilings;
  readonly grants: readonly PermissionGrant[];
  readonly credential?: Partial<CredentialBoundary>;
  readonly protectedBranches?: readonly string[];
  readonly registeredBy: string;
}

const EMPTY_PROTECTED: ProtectedPathConfig = Object.freeze({ additional: [], unprotect: [] });

/**
 * Build a registration, or report every reason it is not one.
 *
 * `registeredBy` is required and must be non-empty. A registration whose
 * authorizer is unknown is a registration nobody can be shown to have made,
 * and the entire audit trail this module exists for rests on that one string.
 */
export function createRepositoryRegistration(input: {
  readonly draft: RepositoryRegistrationDraft;
  readonly now: string;
}): RelayResult<RepositoryRegistration> {
  const { draft, now } = input;
  const problems: RepositoryProblem[] = [];

  if (typeof draft?.registeredBy !== 'string' || draft.registeredBy.trim() === '') {
    problems.push({
      refusal: 'identity_invalid',
      message: 'A registration must record who authorized it. `registeredBy` is empty.',
    });
  }

  const identity = validateRepositoryIdentity(draft?.identity);
  if (!identity.ok) problems.push({ refusal: 'identity_invalid', message: identity.error.message });

  // The location check compares against the identity, so it is only meaningful
  // once the identity is coherent. Skipped rather than run against a shape it
  // would misreport — a "clone URL host mismatch" for an identity with no host
  // sends a founder to fix the wrong field.
  if (identity.ok) {
    const location = validateRepositoryLocation(draft.identity, draft.location);
    if (!location.ok) problems.push({ refusal: 'identity_invalid', message: location.error.message });
  }

  const scope = validateRepositoryScope(draft?.scope);
  if (!scope.ok) {
    problems.push({
      refusal: scope.error.message.includes('read scope is empty') ? 'scope_empty_read' : 'identity_invalid',
      message: scope.error.message,
    });
  }

  const protectedConfig = draft?.protectedPaths ?? EMPTY_PROTECTED;
  const protectedPaths = resolveProtectedPaths(protectedConfig);
  if (!protectedPaths.ok) {
    problems.push({ refusal: 'protected_path_unprotect_refused', message: protectedPaths.error.message });
  }

  problems.push(...validatePermissionGrants(draft?.grants ?? []));

  const ceilings = draft?.ceilings ?? DEFAULT_CHANGE_CEILINGS;
  problems.push(...validateCeilings(ceilings));

  /**
   * THE CREDENTIAL BOUNDARY IS BUILT HERE, NOT ACCEPTED.
   *
   * `handedToAgent` is fixed at `false` by construction rather than copied from
   * the draft. A caller cannot set it true, which means no registration in
   * existence can claim the agent holds a token — the field exists so evidence
   * STATES the boundary rather than leaving a reader to assume it.
   *
   * `permittedUses` is derived from the grants that actually need a credential.
   * Deriving rather than accepting closes a real gap: a draft listing
   * `deploy_production` in `permittedUses` while granting only `read` would put
   * a production deploy in the audit trail of a read-only repository.
   */
  const grantedPermissions = (draft?.grants ?? [])
    .map((g) => g?.permission)
    .filter((p): p is RepositoryPermission => typeof p === 'string');
  const credential: CredentialBoundary = Object.freeze({
    envVarName:
      typeof draft?.credential?.envVarName === 'string' && draft.credential.envVarName.trim() !== ''
        ? draft.credential.envVarName.trim()
        : null,
    installationId:
      typeof draft?.credential?.installationId === 'string' && draft.credential.installationId.trim() !== ''
        ? draft.credential.installationId.trim()
        : null,
    handedToAgent: false,
    permittedUses: Object.freeze(grantedPermissions.filter((p) => requiresCredential(p))),
  });

  // A grant that needs a credential with no credential configured is refused
  // AT REGISTRATION as well as at authorization. Both, deliberately: catching
  // it here means the founder learns immediately, and catching it there means a
  // credential removed later cannot leave a live grant behind it. EITHER source
  // satisfies it — an env var (founder PAT) OR a GitHub App installation.
  if (credential.permittedUses.length > 0 && credential.envVarName === null && credential.installationId === null) {
    problems.push({
      refusal: 'credential_missing',
      message:
        `Grants ${credential.permittedUses.join(', ')} reach a remote and need a server-side credential, ` +
        'but neither an environment variable name nor a GitHub App installation is configured.',
    });
  }

  const protectedBranches = draft?.protectedBranches ?? [];
  for (const branch of protectedBranches) {
    if (!validRepositoryBranchName(branch)) {
      problems.push({ refusal: 'protected_branch_target', message: `Protected branch "${branch}" has a rejected shape.` });
    }
  }

  if (problems.length > 0) {
    return fail(
      relayError('validation-failed', problems.map((p) => p.message).join(' · '), {
        details: problems.map((p) => p.refusal),
      }),
    );
  }
  if (!identity.ok || !scope.ok || !protectedPaths.ok) {
    // Unreachable — each pushed a problem above. Written so the narrowing below
    // is real rather than a cast against a shape I assumed.
    return fail(relayError('validation-failed', 'Registration validation passed and then did not.'));
  }

  return ok(
    Object.freeze({
      key: identity.value,
      identity: draft.identity,
      location: draft.location,
      scope: scope.value,
      protectedPaths: protectedConfig,
      ceilings: Object.freeze({ ...ceilings }),
      grants: Object.freeze(draft.grants.map((g) => Object.freeze({ ...g }))),
      credential,
      protectedBranches: Object.freeze([...new Set([draft.identity.defaultBranch, ...protectedBranches])]),
      registeredBy: draft.registeredBy.trim(),
      registeredAt: now,
      revokedAt: null,
      revokedBy: null,
    }),
  );
}

function validateCeilings(ceilings: ChangeCeilings): readonly RepositoryProblem[] {
  const problems: RepositoryProblem[] = [];
  const positiveInt = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!positiveInt(ceilings?.maxFilesChanged)) {
    problems.push({ refusal: 'ceiling_exceeded', message: '`maxFilesChanged` must be a positive whole number.' });
  }
  if (!positiveInt(ceilings?.maxLinesRemoved)) {
    problems.push({ refusal: 'ceiling_exceeded', message: '`maxLinesRemoved` must be a positive whole number.' });
  }
  if (typeof ceilings?.allowDeletions !== 'boolean') {
    // No default. "Are deletions allowed" is not a question with a safe
    // fallback, and `undefined` reading as `false` would be a permission
    // decided by an omission.
    problems.push({ refusal: 'deletion_not_permitted', message: '`allowDeletions` must be stated explicitly, true or false.' });
  }
  return problems;
}

/**
 * REVOKE. The registration is RETAINED, never deleted — the audit trail has to
 * survive the revocation, or "who authorized this, and who took it away" has
 * only half an answer.
 *
 * Revoking twice is not an error and does not move the timestamp: the first
 * revocation is the one that happened, and overwriting it would erase when
 * access actually stopped.
 */
export function revokeRepositoryRegistration(input: {
  readonly registration: RepositoryRegistration;
  readonly revokedBy: string;
  readonly now: string;
}): RelayResult<RepositoryRegistration> {
  if (typeof input.revokedBy !== 'string' || input.revokedBy.trim() === '') {
    return fail(relayError('validation-failed', 'A revocation must record who performed it.'));
  }
  if (input.registration.revokedAt !== null) return ok(input.registration);
  return ok(
    Object.freeze({
      ...input.registration,
      revokedAt: input.now,
      revokedBy: input.revokedBy.trim(),
    }),
  );
}

/* -------------------------------------------------------------- reading */

export interface RepositoryRegistry {
  /** Every registration, revoked ones included. Revoked is a state, not an
   *  absence — hiding them would make an audit read as though they never were. */
  readonly all: readonly RepositoryRegistration[];
  /** Registrations a Mission may target: registered and not revoked. */
  readonly usable: readonly RepositoryRegistration[];
  find(key: string): RepositoryRegistration | null;
}

/**
 * Read a set of registrations as a registry.
 *
 * A DUPLICATE KEY IS A REFUSAL, not a last-write-wins. Two registrations for
 * one repository describe the same thing with different permissions, and
 * whichever one `find` happened to return would be the effective policy — so
 * the narrower one would be decorative and nobody would know which was live.
 */
export function createRepositoryRegistry(
  registrations: readonly RepositoryRegistration[],
): RelayResult<RepositoryRegistry> {
  const byKey = new Map<string, RepositoryRegistration>();
  const duplicates: string[] = [];
  for (const registration of registrations) {
    if (typeof registration?.key !== 'string' || registration.key === '') {
      return fail(relayError('validation-failed', 'A registration with no key cannot be indexed.'));
    }
    if (byKey.has(registration.key)) duplicates.push(registration.key);
    byKey.set(registration.key, registration);
  }
  if (duplicates.length > 0) {
    return fail(
      relayError('duplicate-task', `Duplicate repository registrations: ${[...new Set(duplicates)].join(', ')}.`, {
        details: [...new Set(duplicates)],
      }),
    );
  }
  const all = Object.freeze([...registrations]);
  return ok(
    Object.freeze({
      all,
      usable: Object.freeze(all.filter((r) => r.revokedAt === null)),
      find: (key: string) => byKey.get(key) ?? null,
    }),
  );
}
