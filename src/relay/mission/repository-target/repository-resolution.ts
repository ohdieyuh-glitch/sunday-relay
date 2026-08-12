/**
 * RESOLVING ONE MISSION'S TARGET — the single gate between "a repository is
 * registered" and "a Mission may run against it".
 *
 * Everything this module needs already exists one file over: identity
 * validation, scope narrowing, protected-path resolution, permission
 * authorization. What did not exist was the place they are composed, and a
 * composition that runs the checks in the wrong ORDER is not a safe
 * composition — it is a safe-looking one. Three ordering rules:
 *
 *   1. **Registration and revocation first.** A revoked registration must not
 *      have its scope, branches or ceilings evaluated at all: every subsequent
 *      message would describe a repository nobody is allowed to touch.
 *   2. **Every problem is collected, then reported together.** A founder
 *      fixing one refusal at a time, one Mission at a time, is a founder who
 *      widens permissions by trial and error. The exception is rule 1 —
 *      nothing after it is meaningful.
 *   3. **Refusal is the default.** Every branch that cannot establish a
 *      permission refuses it. There is no path through this function that
 *      produces a target with a permission the registration did not grant,
 *      which is why `narrowPermissions` is asked rather than trusted.
 *
 * PURE DOMAIN. No Node, no network, no clock. `baselineSha` is deliberately
 * left null here: this module cannot read a git repository, and a baseline
 * nobody has read is unknown, not empty. The provider fills it in and the
 * attestation compares the two.
 */

import { relayError, type RelayError, type RelayErrorCode } from '../../protocol/errors';
import {
  type MissionRepositoryTarget,
  type RepositoryPermission,
  type RepositoryProblem,
  type RepositoryProvenance,
  type RepositoryRegistration,
  type RepositoryScope,
} from './repository-contracts';
import {
  narrowPermissions,
  livePermissions,
} from './repository-authorization';
import { narrowScope, resolveProtectedPaths } from './repository-scope';
import { repositoryProviderSupported, validRepositoryBranchName } from './repository-identity';

/**
 * WHAT A MISSION ASKS FOR.
 *
 * Every field is optional except the key and who is selecting it, and each
 * absent field means "use the registration's value" — never "use everything".
 * `requestedPermissions: null` resolves to the safe floor, not to the
 * registration's full grant set; see `narrowPermissions`.
 *
 * There is no field here for a repository URL, a clone path or an owner. A
 * Mission names a REGISTERED KEY or it names nothing: the absence of those
 * fields is what makes "an objective cannot introduce a repository" a property
 * of the type rather than a promise in a comment.
 */
export interface RepositoryTargetRequest {
  readonly repositoryKey: string;
  /** A human or a system component. Never a model. */
  readonly selectedBy: string;
  readonly selectedAt: string;
  readonly baseBranch?: string;
  readonly workingBranch: string;
  readonly scope?: RepositoryScope | null;
  readonly permissions?: readonly RepositoryPermission[] | null;
}

/**
 * THE RESULT CARRIES THE REFUSAL NAMES, not only a sentence.
 *
 * `RelayResult` is the repository's convention and it is kept — callers that
 * speak the protocol get a real `RelayError`. But `RelayError.details` is
 * `string[]`, and a caller that has to regex a refusal out of a joined message
 * is a caller that stops checking. So both travel: `problems` for code, `error`
 * for the protocol, and the error's `details` carries the refusal NAMES as the
 * log-safe strings that field is for.
 */
export type RepositoryResolution =
  | { readonly ok: true; readonly target: MissionRepositoryTarget }
  | { readonly ok: false; readonly problems: readonly RepositoryProblem[]; readonly error: RelayError };

const refused = (code: RelayErrorCode, problems: readonly RepositoryProblem[]): RepositoryResolution => ({
  ok: false,
  problems,
  error: relayError(code, problems.map((p) => p.message).join(' · '), {
    details: problems.map((p) => p.refusal),
  }),
});

/**
 * BRANCH POLICY, decided here because it is the same on every provider.
 *
 * - The working branch is never the base branch. Committing to the branch the
 *   Mission measured itself against destroys the baseline the artifact digest
 *   is bound to.
 * - The working branch is never a protected branch, and the default branch is
 *   always protected — `main` cannot be a working branch even on a repository
 *   whose `protectedBranches` list forgot to say so. That default is applied
 *   in `resolveProtectedBranches` rather than trusted from configuration,
 *   because "the configuration forgot" is the case this exists for.
 * - The BASE branch may be a protected branch. Basing from `main` is the normal
 *   case; the protection is about what may be WRITTEN, not what may be read.
 */
export function resolveProtectedBranches(registration: RepositoryRegistration): readonly string[] {
  const declared = Array.isArray(registration.protectedBranches) ? registration.protectedBranches : [];
  return [...new Set([registration.identity.defaultBranch, ...declared])];
}

/**
 * Resolve a Mission's repository target, or report every reason it cannot.
 *
 * The returned target is the ONLY thing downstream code may read. Nothing
 * downstream may consult the registration again to widen a decision made
 * here — with one deliberate exception recorded in
 * `repository-authorization.ts`: an ACT must re-ask `authorizeRepositoryAction`
 * against the CURRENT registration, so a revocation reaches a Mission already
 * in flight. Re-asking can only ever take permission away.
 */
export function resolveRepositoryTarget(input: {
  readonly registration: RepositoryRegistration | null;
  readonly request: RepositoryTargetRequest;
  readonly now: string;
}): RepositoryResolution {
  const { registration, request, now } = input;

  /* ---- rule 1: existence and revocation, before anything is evaluated ---- */

  if (registration === null) {
    return refused('not-found', [{
      refusal: 'repository_not_registered',
      message: `Repository "${request.repositoryKey}" is not registered.`,
    }]);
  }
  if (registration.key !== request.repositoryKey) {
    return refused('validation-failed', [{
      refusal: 'identity_invalid',
      message: 'The supplied registration is not the one the Mission named.',
    }]);
  }
  if (registration.revokedAt !== null) {
    return refused('permission-denied', [{
      refusal: 'repository_registration_revoked',
      message: `Repository "${registration.key}" was revoked and may not be used.`,
    }]);
  }
  if (!repositoryProviderSupported(registration.identity.provider)) {
    /**
     * REGISTERED IS NOT DRIVABLE. The domain accepts a registration naming
     * `gitlab` because it is a coherent thing to describe; there is no code
     * that can act on one, and a Mission that reached the push step and
     * discovered that would have spent an Architect call and a Coding Agent
     * run first. Refused at configuration, by name.
     */
    return refused('unsupported-enforcement', [{
      refusal: 'repository_provider_unsupported',
      message: `Relay has no implementation for provider "${registration.identity.provider}".`,
    }]);
  }

  /* ---- rule 2: collect every remaining problem, report them together ---- */

  const problems: RepositoryProblem[] = [];

  const protectedBranches = resolveProtectedBranches(registration);
  const baseBranch = request.baseBranch ?? registration.identity.defaultBranch;
  const workingBranch = request.workingBranch;

  if (!validRepositoryBranchName(baseBranch)) {
    problems.push({ refusal: 'base_branch_not_permitted', message: `Base branch "${baseBranch}" has a rejected shape.` });
  }
  if (!validRepositoryBranchName(workingBranch)) {
    problems.push({ refusal: 'protected_branch_target', message: `Working branch "${workingBranch}" has a rejected shape.` });
  }
  if (workingBranch === baseBranch) {
    problems.push({
      refusal: 'protected_branch_target',
      message: `The working branch may not be the base branch ("${baseBranch}").`,
    });
  }
  if (protectedBranches.includes(workingBranch)) {
    problems.push({
      refusal: 'protected_branch_target',
      message: `"${workingBranch}" is a protected branch and may not be a working branch.`,
    });
  }

  const scope = narrowScope(registration.scope, request.scope ?? null);
  if (!scope.ok) {
    problems.push({
      // `narrowScope` refuses for two different reasons and the caller needs
      // to tell them apart: a Mission asking for MORE than the registration
      // is a permission problem, an unusable scope is a shape problem.
      refusal: scope.error.code === 'permission-denied' ? 'mission_scope_exceeds_registration' : 'scope_empty_read',
      message: scope.error.message,
    });
  }

  const protectedPaths = resolveProtectedPaths(registration.protectedPaths);
  if (!protectedPaths.ok) {
    problems.push({ refusal: 'protected_path_unprotect_refused', message: protectedPaths.error.message });
  }

  const permissions = narrowPermissions({ registration, requested: request.permissions ?? null, now });
  if (!permissions.ok) problems.push(...permissions.problems);

  /**
   * A MISSION WITH NO WRITE PERMISSION IS NOT A FAILURE. Read-only is a
   * supported and useful mode — inspect a repository, produce findings, change
   * nothing — so an empty write scope and a `read`-only permission set are both
   * legal. What is refused is the INCOHERENT pair: a Mission authorized to
   * write with nowhere to write, which would run an agent, produce a diff, and
   * fail every path against the scope after the money was spent.
   */
  if (permissions.ok && scope.ok) {
    const canWrite = permissions.permissions.includes('write_worktree');
    if (canWrite && scope.value.write.length === 0) {
      problems.push({
        refusal: 'mission_scope_exceeds_registration',
        message: 'The Mission is authorized to write but its write scope is empty. Narrow the permission or widen the scope.',
      });
    }
  }

  if (problems.length > 0) return refused('permission-denied', problems);

  /* ---- rule 3: the target, and nothing that was not established above ---- */

  if (!scope.ok || !protectedPaths.ok || !permissions.ok) {
    /**
     * UNREACHABLE, AND STILL WRITTEN. Each of the three is checked above and
     * any failure pushed a problem, so `problems.length > 0` already returned.
     * This is not defensive noise: it is how the narrowing reaches the object
     * literal below without a cast. A cast here would compile against a shape
     * I imagined rather than the one the checks established — the failure mode
     * that has cost this repository more than any other.
     */
    return refused('validation-failed', [{
      refusal: 'identity_invalid',
      message: 'Repository target resolution failed after its own checks passed.',
    }]);
  }

  const provenance: RepositoryProvenance = {
    registeredBy: registration.registeredBy,
    registeredAt: registration.registeredAt,
    selectedBy: request.selectedBy,
    selectedAt: request.selectedAt,
    // The only member of the union. See `RepositoryProvenance`.
    selectionMode: 'explicit_registered_key',
  };

  /**
   * DEEP-FROZEN, because `Object.freeze` is SHALLOW and the header called
   * freezing the mechanism.
   *
   * An independent review executed the widening: `isFrozen(target)` was true
   * while `permissions`, `scope`, `scope.write`, `protectedPaths`, `identity`
   * and `protectedBranches` were all mutable — and pushing `deploy_production`
   * and `merge_pr` onto `target.permissions` flipped a refused judgement to
   * accepted. Those are the two grants `HIGH_CONSEQUENCE_PERMISSIONS` says may
   * never be inferred.
   *
   * `readonly` is a compile-time claim and casts exist. This is the runtime one.
   */
  const frozenScope = Object.freeze({
    read: Object.freeze([...scope.value.read]),
    write: Object.freeze([...scope.value.write]),
  });
  return {
    ok: true,
    target: Object.freeze({
      repositoryKey: registration.key,
      // Frozen COPIES: the registration's own objects are the caller's draft,
      // and mutating `draft.identity.defaultBranch` after registration changed
      // both the registration and an already-resolved target.
      identity: Object.freeze({ ...registration.identity }),
      location: Object.freeze({ ...registration.location }),
      baseBranch,
      workingBranch,
      // Unknown until a provider reads it. Never defaulted to the branch name,
      // to an empty string, or to a zero SHA.
      baselineSha: null,
      scope: frozenScope,
      protectedPaths: Object.freeze([...protectedPaths.value]),
      ceilings: Object.freeze({ ...registration.ceilings }),
      permissions: Object.freeze([...permissions.permissions]),
      credential: Object.freeze({
        ...registration.credential,
        permittedUses: Object.freeze([...registration.credential.permittedUses]),
      }),
      protectedBranches: Object.freeze([...protectedBranches]),
      provenance,
    }),
  };
}

/**
 * DOES THIS TARGET STILL HOLD?
 *
 * Called before every consequential act, against the CURRENT registration
 * rather than the one the target was built from. It can only ever narrow: a
 * registration that gained permissions mid-Mission does not widen a Mission
 * already running, because the Mission Contract the Reviewer read named the
 * old set.
 *
 * This is the mechanism that makes revocation immediate. Without it, a target
 * frozen at Mission start is a capability nobody can take back.
 */
export function revalidateRepositoryTarget(input: {
  readonly target: MissionRepositoryTarget;
  readonly registration: RepositoryRegistration | null;
  readonly now: string;
}): { readonly ok: true; readonly permissions: readonly RepositoryPermission[] } | { readonly ok: false; readonly problem: RepositoryProblem } {
  const { target, registration, now } = input;
  if (registration === null) {
    return {
      ok: false,
      problem: {
        refusal: 'repository_not_registered',
        message: `Repository "${target.repositoryKey}" is no longer registered.`,
      },
    };
  }
  if (registration.key !== target.repositoryKey) {
    return {
      ok: false,
      problem: { refusal: 'identity_invalid', message: 'The registration checked is not the one this Mission targets.' },
    };
  }
  if (registration.revokedAt !== null) {
    return {
      ok: false,
      problem: {
        refusal: 'repository_registration_revoked',
        message: `Repository "${target.repositoryKey}" was revoked while the Mission was in flight.`,
      },
    };
  }
  const live = livePermissions(registration, now);
  // The intersection, in the target's order. A permission the registration has
  // since gained is NOT added; one it has lost disappears here, and the caller
  // asking for it gets a refusal from `authorizeRepositoryAction`.
  return { ok: true, permissions: target.permissions.filter((p) => live.includes(p)) };
}
