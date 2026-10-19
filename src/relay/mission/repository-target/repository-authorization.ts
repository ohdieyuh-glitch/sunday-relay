/**
 * REPOSITORY AUTHORIZATION — the eight permissions, and what may be inferred
 * from each of them.
 *
 * Nothing. That is the entire design. Every function here fails closed: an
 * absent grant, an expired grant, a revoked registration, an unparseable
 * timestamp and an unrecognised permission all produce the same answer — no —
 * with a named refusal, because the alternative to a named refusal is a caller
 * that logs "authorization failed" and a founder who cannot tell which of five
 * things went wrong.
 *
 * PURE. Time arrives as an injected ISO string. A function that read the clock
 * could not be tested against an expiry boundary without waiting for it, and
 * every expiry test would be a race.
 */

import {
  HIGH_CONSEQUENCE_PERMISSIONS,
  PERMISSION_PREREQUISITES,
  REPOSITORY_PERMISSIONS,
  type PermissionGrant,
  type RepositoryPermission,
  type RepositoryProblem,
  type RepositoryRegistration,
} from './repository-contracts';

export const isRepositoryPermission = (value: string): value is RepositoryPermission =>
  (REPOSITORY_PERMISSIONS as readonly string[]).includes(value);

/**
 * Is this ISO instant strictly in the past relative to `now`?
 *
 * An UNPARSEABLE value is treated as EXPIRED. The opposite choice — ignore what
 * you cannot read — turns a typo in an expiry date into a permanent grant, and
 * this is the one place in the module where being wrong grants something.
 */
function expired(expiresAt: string | null, now: string): boolean {
  if (expiresAt === null) return false;
  const end = Date.parse(expiresAt);
  const at = Date.parse(now);
  if (Number.isNaN(end) || Number.isNaN(at)) return true;
  return end <= at;
}

/**
 * Validate a grant list at REGISTRATION time.
 *
 * Two rules, both refusals rather than repairs:
 *
 *   1. Every prerequisite must be present in the same list. A grant naming
 *      `merge_pr` without `create_pr` is refused, not expanded — expanding is
 *      how a founder writes one permission and gets three.
 *   2. Every grant must name an authorizer and a parseable timestamp. A
 *      registration whose authorizer is unknown is a registration nobody can be
 *      shown to have made.
 */
export function validatePermissionGrants(grants: readonly PermissionGrant[]): readonly RepositoryProblem[] {
  const problems: RepositoryProblem[] = [];
  const named = new Set<RepositoryPermission>();
  for (const grant of grants) {
    if (!grant || !isRepositoryPermission(grant.permission)) {
      problems.push({
        refusal: 'permission_not_granted',
        message: `Unknown repository permission "${String(grant?.permission)}".`,
      });
      continue;
    }
    if (typeof grant.authorizedBy !== 'string' || grant.authorizedBy.trim() === '') {
      problems.push({
        refusal: 'permission_not_granted',
        message: `Grant for "${grant.permission}" names no authorizer.`,
      });
      continue;
    }
    if (typeof grant.authorizedAt !== 'string' || Number.isNaN(Date.parse(grant.authorizedAt))) {
      problems.push({
        refusal: 'permission_not_granted',
        message: `Grant for "${grant.permission}" has no readable authorization time.`,
      });
      continue;
    }
    named.add(grant.permission);
  }
  for (const permission of named) {
    for (const prerequisite of PERMISSION_PREREQUISITES[permission]) {
      if (!named.has(prerequisite)) {
        problems.push({
          refusal: 'permission_prerequisite_missing',
          message:
            `"${permission}" requires "${prerequisite}", which this registration does not grant. ` +
            'Relay refuses an incoherent grant rather than expanding it.',
        });
      }
    }
  }
  return problems;
}

/** Grants that are live at `now`: not expired, on a registration not revoked. */
export function livePermissions(
  registration: RepositoryRegistration,
  now: string,
): readonly RepositoryPermission[] {
  if (registration.revokedAt !== null) return [];
  const live: RepositoryPermission[] = [];
  for (const grant of registration.grants) {
    if (!isRepositoryPermission(grant.permission)) continue;
    if (expired(grant.expiresAt, now)) continue;
    live.push(grant.permission);
  }
  return [...new Set(live)];
}

export interface AuthorizationDecision {
  readonly granted: boolean;
  readonly problem: RepositoryProblem | null;
  /** The grant that authorized it, for the evidence trail. Null when refused. */
  readonly grant: PermissionGrant | null;
}

const refuse = (problem: RepositoryProblem): AuthorizationDecision => ({ granted: false, problem, grant: null });

/**
 * MAY THIS REGISTRATION DO THIS, RIGHT NOW?
 *
 * Revocation is checked FIRST and takes effect immediately, including for a
 * Mission already in flight — a revocation that only applies to future work is
 * not a revocation. That is why this is a function of the CURRENT registration
 * rather than a capability captured when the Mission started: a Mission that
 * cached its permissions at start would keep them after the founder took them
 * away. Callers must re-ask before every consequential act.
 */
export function authorizeRepositoryAction(input: {
  readonly registration: RepositoryRegistration;
  readonly permission: RepositoryPermission;
  readonly now: string;
}): AuthorizationDecision {
  const { registration, permission, now } = input;
  if (!isRepositoryPermission(permission)) {
    return refuse({ refusal: 'permission_not_granted', message: `Unknown repository permission.` });
  }
  if (registration.revokedAt !== null) {
    return refuse({
      refusal: 'repository_registration_revoked',
      message: `Repository "${registration.key}" was revoked and may not be used.`,
    });
  }
  /**
   * THE MOST PERMISSIVE LIVE GRANT, not the first one declared.
   *
   * This was `find(g => g.permission === permission)` — first match only — while
   * `livePermissions` is any-grant-is-live. An independent review executed the
   * disagreement on grants `[read(expired 2020), read(live), …]`:
   *
   *   livePermissions           => ['read', 'write_worktree', 'commit']
   *   authorizeRepositoryAction => granted:false, 'permission_grant_expired'
   *
   * A resolved target and `revalidateRepositoryTarget` both build on
   * `livePermissions`, so they could hold a permission the act-time authorizer
   * refuses — and appending a renewed grant beside an expired one is the obvious
   * way a founder extends an expiry. Two authorities on one fact is how they came
   * to disagree; now there is one reading.
   *
   * `withPermission` is kept so an EXPIRED grant still produces
   * `permission_grant_expired` rather than `permission_not_granted`: the founder
   * did grant it, and "you never had this" would be the wrong sentence.
   */
  const withPermission = registration.grants.filter((g) => g.permission === permission);
  const grant = withPermission.find((g) => !expired(g.expiresAt, now)) ?? withPermission[0] ?? null;
  if (grant === null) {
    return refuse({
      refusal: 'permission_not_granted',
      message: `Repository "${registration.key}" does not grant "${permission}".`,
    });
  }
  if (expired(grant.expiresAt, now)) {
    return refuse({
      refusal: 'permission_grant_expired',
      message: `The "${permission}" grant on "${registration.key}" has expired.`,
    });
  }
  // Prerequisites are re-checked HERE and not only at registration, because a
  // prerequisite can expire on its own schedule. A live `merge_pr` sitting above
  // an expired `create_pr` is exactly the shape that would let a Mission merge
  // work it was no longer allowed to propose.
  for (const prerequisite of PERMISSION_PREREQUISITES[permission]) {
    // Same reading as above: a renewed prerequisite beside an expired one is
    // live, and first-match-only would have called it expired.
    const upstream = registration.grants.find((g) => g.permission === prerequisite && !expired(g.expiresAt, now)) ?? null;
    if (upstream === null) {
      return refuse({
        refusal: 'permission_prerequisite_missing',
        message: `"${permission}" on "${registration.key}" requires a live "${prerequisite}" grant.`,
      });
    }
  }
  // A credential-requiring action must have somewhere to read a credential
  // from. Refused by name here rather than failing at the provider, so the
  // Mission stops at CONFIGURATION — before a clone, before a spend.
  //
  // A credential is configured when EITHER an env var names it (the founder-PAT
  // path) OR a GitHub App installation supplies it (the user-safe path). An App
  // installation IS a configured credential — the bridge mints a short-lived,
  // repo-scoped installation token from it at the point of use. So this refuses
  // only when NEITHER source is present: no env var AND no installation id. That
  // preserves fail-closed (a grant that reaches a remote with no credential at
  // all is refused at configuration) while admitting the installation path.
  if (
    requiresCredential(permission) &&
    registration.credential.envVarName === null &&
    (registration.credential.installationId ?? null) === null
  ) {
    return refuse({
      refusal: 'credential_missing',
      message: `"${permission}" on "${registration.key}" needs a server-side credential and none is configured.`,
    });
  }
  return { granted: true, problem: null, grant };
}

/**
 * Which permissions cannot be performed without the REPOSITORY credential.
 *
 * A LOCAL repository needs none of these — it is on the filesystem — but the
 * decision is per permission rather than per provider, because the question is
 * "does this act reach the repository host", and the answer for
 * `push_feature_branch` is yes regardless of who is asking. `local`
 * registrations therefore simply do not carry these grants; a local
 * registration that DID name `push_feature_branch` is refused for a missing
 * credential, which is the honest reason.
 *
 * THE TWO DEPLOY GRANTS ARE DELIBERATELY ABSENT, and this is a correction.
 *
 * They were here, and the check they fed reads
 * `registration.credential.envVarName` — the credential for the REPOSITORY
 * HOST. A deploy does not use that credential. It uses the deployment
 * provider's own, which the provider declares in
 * `DeploymentProviderDescriptor.credentialEnvVarName` and which some providers
 * (a local directory, a self-hosted target on the same box) do not need at all.
 *
 * Keeping them here had a concrete cost, and it was not merely a wrong error
 * message: a founder who wanted to deploy a LOCAL repository was told to
 * configure a git host token, and the only way past the refusal was to
 * configure one. The guard pushed toward MORE credential exposure than the task
 * required, which is the same failure shape as a scope check that can only be
 * satisfied by widening the scope. A guard that is satisfied by weakening the
 * system is worse than no guard.
 *
 * What replaces it: `providerSupportsEnvironment` refuses a provider asked for
 * an environment it is not configured for, a simulated provider may never touch
 * production, and a provider that needs a credential refuses without one — at
 * the provider, which is the only layer that knows.
 */
export const requiresCredential = (permission: RepositoryPermission): boolean =>
  permission === 'push_feature_branch' ||
  permission === 'create_pr' ||
  permission === 'merge_pr';

/**
 * NARROW A MISSION'S REQUEST against what the repository actually grants.
 *
 * `requested === null` means "whatever this Mission's work needs", and it
 * resolves to the SAFE FLOOR — read plus write_worktree, if those are granted —
 * never to everything the registration allows. "Build me an app" must not
 * produce a Mission holding a production deploy grant it never asked for.
 *
 * A request naming something the registration does not grant is REFUSED, not
 * trimmed. Trimming produces a Mission that runs, reaches the push step, and
 * discovers there that it cannot finish — after the money is spent.
 */
export function narrowPermissions(input: {
  readonly registration: RepositoryRegistration;
  readonly requested: readonly RepositoryPermission[] | null;
  readonly now: string;
}): { readonly ok: true; readonly permissions: readonly RepositoryPermission[] } | { readonly ok: false; readonly problems: readonly RepositoryProblem[] } {
  const { registration, requested, now } = input;
  const live = livePermissions(registration, now);
  if (requested === null) {
    const floor = (['read', 'write_worktree'] as RepositoryPermission[]).filter((p) => live.includes(p));
    return { ok: true, permissions: floor };
  }
  const problems: RepositoryProblem[] = [];
  const granted: RepositoryPermission[] = [];
  for (const permission of requested) {
    const decision = authorizeRepositoryAction({ registration, permission, now });
    /**
     * GRANTED is the branch that must be positive. This read
     * `if (!granted && problem !== null) refuse; else grant`, so a decision with
     * `granted: false, problem: null` would have been GRANTED. Unreachable today
     * — every refusal goes through `refuse()`, which always sets a problem — and
     * still the wrong default for a fail-closed module.
     */
    if (decision.granted) granted.push(permission);
    else {
      problems.push(decision.problem ?? {
        refusal: 'permission_not_granted',
        message: `"${permission}" was refused without a stated reason.`,
      });
    }
  }
  // A Mission asking for `merge_pr` must also be asking for the ladder beneath
  // it. Refused rather than completed, for the registration-time reason: a
  // Mission that receives permissions it did not name has more reach than the
  // person who wrote the request decided to give it.
  for (const permission of granted) {
    for (const prerequisite of PERMISSION_PREREQUISITES[permission]) {
      if (!granted.includes(prerequisite)) {
        problems.push({
          refusal: 'permission_prerequisite_missing',
          message: `A Mission requesting "${permission}" must also request "${prerequisite}".`,
        });
      }
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, permissions: [...new Set(granted)] };
}

/**
 * Does this permission set include anything that cannot be undone by deleting a
 * branch? Used to decide whether a Mission needs a fresh human confirmation
 * rather than a standing registration grant.
 */
export const hasHighConsequencePermission = (permissions: readonly RepositoryPermission[]): boolean =>
  permissions.some((p) => HIGH_CONSEQUENCE_PERMISSIONS.includes(p));

/** One line per permission, for the Mission Contract and the PR body. Ordered
 *  by the ladder rather than by grant order so two Missions with the same
 *  authority render identically. */
export function renderPermissionLine(permissions: readonly RepositoryPermission[]): string {
  if (permissions.length === 0) return 'no repository permissions';
  const ordered = REPOSITORY_PERMISSIONS.filter((p) => permissions.includes(p));
  return ordered.join(', ');
}

/**
 * WHO MAY TARGET OR SHIP A REGISTERED REPOSITORY.
 *
 * The operator owns everything: they hold the credential that gates registration
 * itself. Beyond the operator, exactly one principal may act on a registration —
 * the participant it is OWNED BY — and only when the owner is set. This is the
 * rule that lets a beta user connect and ship THEIR OWN repository without the
 * operator, while guaranteeing a user can never reach a repository someone else
 * registered:
 *
 *   - operator            -> always allowed.
 *   - ownerParticipant null (operator-owned / legacy) -> only the operator.
 *   - ownerParticipant set -> the operator, or a caller whose participant EQUALS
 *     it. A null caller participant never equals a set owner, so "signed in as
 *     nobody in particular" is refused, not coincidentally admitted.
 *
 * The caller identity comes from the verified session, never a request body.
 */
export function registrationOwnerAdmits(input: {
  readonly ownerParticipant: string | null;
  readonly caller:
    | { readonly kind: 'operator' }
    | { readonly kind: 'participant'; readonly participantId: string | null };
}): boolean {
  if (input.caller.kind === 'operator') return true;
  if (input.ownerParticipant === null) return false;
  return input.caller.participantId !== null && input.caller.participantId === input.ownerParticipant;
}
