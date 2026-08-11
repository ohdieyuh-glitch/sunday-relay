import { describe, expect, it } from 'vitest';

import {
  ALWAYS_PROTECTED_PATHS,
  DEFAULT_CHANGE_CEILINGS,
  HIGH_CONSEQUENCE_PERMISSIONS,
  REPOSITORY_PERMISSIONS,
  advanceShipStage,
  authorizeRepositoryAction,
  classifyObservedChanges,
  createRepositoryRegistration,
  createRepositoryRegistry,
  decideShipped,
  deployPermissionFor,
  deriveShipStage,
  hasHighConsequencePermission,
  livePermissions,
  narrowPermissions,
  narrowScope,
  repositoryKey,
  resolveProtectedBranches,
  resolveProtectedPaths,
  resolveRepositoryTarget,
  revalidateRepositoryTarget,
  revokeRepositoryRegistration,
  validateRepositoryIdentity,
  validateRepositoryLocation,
  validateRepositoryScope,
} from './index';
import type {
  LiveProbeResult,
  PermissionGrant,
  RepositoryPermission,
  RepositoryRegistration,
  RepositoryRegistrationDraft,
  ShipStageEvidence,
} from './index';

/**
 * CONFIGURABLE REPOSITORY TARGETS.
 *
 * Every hosted Mission Relay has run edited the same throwaway fixture, and
 * `docs/relay/FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md` explains why that
 * is not a limitation to lift casually: it is the reason every safety property
 * holds BY CONSTRUCTION. Pointing a Mission at a real repository removes all of
 * them, and this file is where each replacement is held.
 *
 * The doc set the bar for this test file explicitly: *"Every refusal above is
 * testable offline, with the same discipline the rest of Relay uses: a mutation
 * probe that removes the guard must fail a named test."* Every `it` here is
 * written to fail against the absence of the thing it describes, and the
 * mutations run are recorded in the commit message.
 *
 * Nothing here touches a filesystem, a network or a clock. Time is a string.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const EARLIER = '2026-08-01T00:00:00.000Z';
const LATER = '2026-09-01T00:00:00.000Z';

const grant = (
  permission: RepositoryPermission,
  overrides: Partial<PermissionGrant> = {},
): PermissionGrant => ({
  permission,
  authorizedBy: 'founder',
  authorizedAt: EARLIER,
  expiresAt: null,
  note: null,
  ...overrides,
});

/** The full ladder, which several tests need in order to reach the top of it. */
const LADDER: readonly RepositoryPermission[] = [
  'read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr',
];

const draft = (overrides: Partial<RepositoryRegistrationDraft> = {}): RepositoryRegistrationDraft => ({
  identity: {
    provider: 'github',
    host: 'github.com',
    owner: 'ohdieyuh-glitch',
    name: 'sunday-relay',
    defaultBranch: 'main',
  },
  location: { kind: 'remote_clone', cloneUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay.git' },
  scope: { read: ['**'], write: ['src/**'] },
  grants: [grant('read'), grant('write_worktree')],
  ceilings: DEFAULT_CHANGE_CEILINGS,
  registeredBy: 'founder',
  ...overrides,
});

const register = (overrides: Partial<RepositoryRegistrationDraft> = {}): RepositoryRegistration => {
  const result = createRepositoryRegistration({ draft: draft(overrides), now: NOW });
  if (!result.ok) throw new Error(`fixture registration refused: ${result.error.message}`);
  return result.value;
};

const request = (overrides: Record<string, unknown> = {}) => ({
  repositoryKey: 'github:github.com/ohdieyuh-glitch/sunday-relay',
  selectedBy: 'founder',
  selectedAt: NOW,
  workingBranch: 'relay/mission-1',
  ...overrides,
}) as Parameters<typeof resolveRepositoryTarget>[0]['request'];

const resolve = (registration: RepositoryRegistration | null, overrides: Record<string, unknown> = {}) =>
  resolveRepositoryTarget({ registration, request: request(overrides), now: NOW });

/* ============================================================ identity */

describe('identity is stated, never inferred from a URL', () => {
  it('derives one canonical key per repository', () => {
    expect(repositoryKey(draft().identity)).toBe('github:github.com/ohdieyuh-glitch/sunday-relay');
    expect(repositoryKey({ provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' }))
      .toBe('local:demo');
  });

  it('normalizes host case but NOT owner or name', () => {
    // Two repositories differing only in owner case are two repositories on a
    // case-sensitive host. Merging them would be a wrong answer in the
    // direction of MORE access.
    const upper = repositoryKey({ ...draft().identity, host: 'GitHub.com', owner: 'OhDieYuh-Glitch' });
    expect(upper).toBe('github:github.com/OhDieYuh-Glitch/sunday-relay');
    expect(upper).not.toBe(repositoryKey(draft().identity));
  });

  it('refuses a local identity carrying a host or an owner', () => {
    for (const over of [{ host: 'github.com' }, { owner: 'someone' }]) {
      const result = validateRepositoryIdentity({
        provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main', ...over,
      });
      // A local identity with a remote host produces a key that LOOKS remote
      // and a target that is not.
      expect(result.ok, JSON.stringify(over)).toBe(false);
    }
  });

  it('compares a clone URL against the identity rather than parsing one out of it', () => {
    const identity = draft().identity;
    const mismatched = validateRepositoryLocation(identity, {
      kind: 'remote_clone',
      cloneUrl: 'https://github.com/someone-else/sunday-relay.git',
    });
    expect(mismatched.ok).toBe(false);
    // And the owner is NOT adopted from the URL.
    if (!mismatched.ok) expect(mismatched.error.message).toContain('does not match the registered owner/name');
  });

  it('refuses every clone transport that authenticates from an ambient host key', () => {
    const identity = draft().identity;
    for (const cloneUrl of [
      'ssh://git@github.com/ohdieyuh-glitch/sunday-relay.git',
      'git://github.com/ohdieyuh-glitch/sunday-relay.git',
      'file:///tmp/sunday-relay',
      'http://github.com/ohdieyuh-glitch/sunday-relay.git',
      'https://user:token@github.com/ohdieyuh-glitch/sunday-relay.git',
    ]) {
      const result = validateRepositoryLocation(identity, { kind: 'remote_clone', cloneUrl });
      // An ambient SSH key is a credential Relay neither issued, scoped, nor
      // can revoke — which defeats the whole credential boundary.
      expect(result.ok, cloneUrl).toBe(false);
    }
  });
});

/* =============================================================== scope */

describe('scope is explicit and never defaults to everything', () => {
  it('refuses an empty read scope instead of reading it as "everything"', () => {
    const result = validateRepositoryScope({ read: [], write: [] });
    expect(result.ok).toBe(false);
    // The tempting fallback is the dangerous one, and the message says how to
    // ask for everything on purpose.
    if (!result.ok) expect(result.error.message).toContain('["**"]');
  });

  it('accepts an empty WRITE scope as read-only', () => {
    const result = validateRepositoryScope({ read: ['**'], write: [] });
    expect(result.ok).toBe(true);
  });

  it('refuses a write scope wider than the read scope rather than widening read', () => {
    const result = validateRepositoryScope({ read: ['src/**'], write: ['docs/**'] });
    expect(result.ok).toBe(false);
    // Silently widening read would grant something nobody wrote down.
    if (!result.ok) expect(result.error.message).toContain('not covered by read scope');
  });

  it('refuses a Mission scope that exceeds the registration, rather than clamping it', () => {
    const registered = { read: ['src/**'], write: ['src/relay/**'] };
    const wider = narrowScope(registered, { read: ['**'], write: ['**'] });
    expect(wider.ok).toBe(false);
    // A clamp would turn a mistaken request into a silently different Mission,
    // and the Reviewer would read a diff produced under a scope nobody wrote.
    const narrower = narrowScope(registered, { read: ['src/relay/**'], write: ['src/relay/mission/**'] });
    expect(narrower.ok).toBe(true);
  });

  it('accepts a narrow write scope under a narrow read scope', () => {
    /**
     * The ordinary secure configuration: read one subtree, write a subtree of
     * it. Containment used to accept only glob-FREE covers, so this was
     * REFUSED — and the way past the refusal was to widen read to `['**']`.
     * A guard that makes the secure option the awkward one gets configured
     * around, so the over-refusal was the security problem.
     */
    expect(validateRepositoryScope({ read: ['src/**'], write: ['src/relay/**'] }).ok).toBe(true);
    // And the direction that must still refuse: write wider than read.
    expect(validateRepositoryScope({ read: ['src/relay/**'], write: ['src/**'] }).ok).toBe(false);
    // A cover whose glob is not at the tail guarantees no directory, so it
    // covers nothing — the conservative answer, not a guess.
    expect(validateRepositoryScope({ read: ['src/*.ts'], write: ['src/relay/**'] }).ok).toBe(false);
  });

  it('lets a Mission ask for nothing and get exactly the registration', () => {
    const registered = { read: ['src/**'], write: ['src/relay/**'] };
    const same = narrowScope(registered, null);
    expect(same.ok && same.value).toEqual(registered);
  });
});

describe('protected paths', () => {
  it('protects .git unconditionally and refuses an attempt to unprotect it', () => {
    expect(ALWAYS_PROTECTED_PATHS).toContain('.git');
    const result = resolveProtectedPaths({ additional: [], unprotect: ['.git'] });
    expect(result.ok).toBe(false);
    // A founder who wrote `.git` here believes something untrue and is told,
    // rather than quietly overridden.
    if (!result.ok) expect(result.error.message).toContain('cannot be unprotected');
  });

  it('protects CI and lockfiles by default, and lets each be opted out by name', () => {
    const defaults = resolveProtectedPaths({ additional: [], unprotect: [] });
    expect(defaults.ok && defaults.value).toContain('.github');
    expect(defaults.ok && defaults.value).toContain('package-lock.json');

    // A dependency-bump Mission unprotects the lockfile explicitly, and gets
    // ONLY that — CI stays protected.
    const opted = resolveProtectedPaths({ additional: [], unprotect: ['package-lock.json'] });
    expect(opted.ok && opted.value).not.toContain('package-lock.json');
    expect(opted.ok && opted.value).toContain('.github');
  });

  it('refuses a glob in a protected path rather than honouring it in name only', () => {
    // The enforcer matches literal segment prefixes. A glob accepted here would
    // be recorded as policy and ignored in practice.
    const result = resolveProtectedPaths({ additional: ['src/**/secret.ts'], unprotect: [] });
    expect(result.ok).toBe(false);
  });

  it('makes protection beat scope for an observed change', () => {
    const verdict = classifyObservedChanges({
      changedPaths: ['.github/workflows/ci.yml', 'src/app.ts', 'docs/README.md', '../escape.ts'],
      writeScope: ['**'],
      protectedPaths: ['.git', '.github'],
    });
    // Inside a `**` write scope and still refused — an agent that can edit CI
    // can disable the checks that would have caught it.
    expect(verdict.protectedHits).toEqual(['.github/workflows/ci.yml']);
    expect(verdict.allowed).toEqual(['src/app.ts', 'docs/README.md']);
    expect(verdict.invalid).toEqual(['../escape.ts']);
  });

  it('reports an out-of-scope change as out of scope, not as allowed', () => {
    const verdict = classifyObservedChanges({
      changedPaths: ['src/app.ts', 'infra/terraform.tf'],
      writeScope: ['src/**'],
      protectedPaths: [],
    });
    expect(verdict.allowed).toEqual(['src/app.ts']);
    expect(verdict.outOfScope).toEqual(['infra/terraform.tf']);
  });
});

/* ======================================================= authorization */

describe('permissions are granted one at a time and never escalate', () => {
  it('names all eight grades the founder asked for', () => {
    expect(REPOSITORY_PERMISSIONS).toEqual([
      'read', 'write_worktree', 'commit', 'push_feature_branch',
      'create_pr', 'merge_pr', 'deploy_staging', 'deploy_production',
    ]);
  });

  it('refuses an action the registration does not grant', () => {
    const registration = register();
    const decision = authorizeRepositoryAction({ registration, permission: 'commit', now: NOW });
    expect(decision.granted).toBe(false);
    expect(decision.problem?.refusal).toBe('permission_not_granted');
    expect(decision.grant).toBeNull();
  });

  it('grants an action the registration does grant, and names the grant that did it', () => {
    const registration = register();
    const decision = authorizeRepositoryAction({ registration, permission: 'write_worktree', now: NOW });
    expect(decision.granted).toBe(true);
    // The grant travels, so evidence can show WHICH authorization was used.
    expect(decision.grant?.authorizedBy).toBe('founder');
  });

  it('refuses an expired grant exactly like an absent one', () => {
    const registration = register({
      grants: [grant('read'), grant('write_worktree', { expiresAt: EARLIER })],
    });
    const decision = authorizeRepositoryAction({ registration, permission: 'write_worktree', now: NOW });
    expect(decision.granted).toBe(false);
    expect(decision.problem?.refusal).toBe('permission_grant_expired');
    // And an unexpired one is unaffected.
    expect(livePermissions(registration, NOW)).toEqual(['read']);
  });

  it('refuses a permission whose prerequisite has expired underneath it', () => {
    // The shape that would let a Mission MERGE work it is no longer allowed to
    // propose: a live merge_pr sitting above an expired create_pr.
    const registration = register({
      grants: [
        grant('read'), grant('write_worktree'), grant('commit'), grant('push_feature_branch'),
        grant('create_pr', { expiresAt: EARLIER }),
        grant('merge_pr'),
      ],
      credential: { envVarName: 'RELAY_GITHUB_TOKEN' },
    });
    const decision = authorizeRepositoryAction({ registration, permission: 'merge_pr', now: NOW });
    expect(decision.granted).toBe(false);
    expect(decision.problem?.refusal).toBe('permission_prerequisite_missing');
  });

  it('refuses a remote-reaching grant with no server-side credential configured', () => {
    // Refused at REGISTRATION, before any Mission exists — so the founder
    // learns immediately rather than at the push step of a paid Mission.
    const rejected = createRepositoryRegistration({
      draft: draft({
        grants: [grant('read'), grant('write_worktree'), grant('commit'), grant('push_feature_branch')],
        // No credential env var name.
      }),
      now: NOW,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.details).toContain('credential_missing');

    // The same grants WITH a credential name are accepted, which is what makes
    // the refusal above about the credential and not about the grants.
    const accepted = createRepositoryRegistration({
      draft: draft({
        grants: [grant('read'), grant('write_worktree'), grant('commit'), grant('push_feature_branch')],
        credential: { envVarName: 'RELAY_GITHUB_TOKEN' },
      }),
      now: NOW,
    });
    expect(accepted.ok).toBe(true);
  });

  it('resolves "whatever this Mission needs" to the safe FLOOR, never the full grant set', () => {
    const registration = register({
      grants: LADDER.map((p) => grant(p)),
      credential: { envVarName: 'RELAY_GITHUB_TOKEN' },
    });
    const narrowed = narrowPermissions({ registration, requested: null, now: NOW });
    expect(narrowed.ok).toBe(true);
    // "Build me an app" must not produce a Mission holding merge or deploy.
    if (narrowed.ok) expect(narrowed.permissions).toEqual(['read', 'write_worktree']);
  });

  it('refuses a Mission asking for merge without asking for the ladder beneath it', () => {
    const registration = register({
      grants: LADDER.map((p) => grant(p)),
      credential: { envVarName: 'RELAY_GITHUB_TOKEN' },
    });
    const narrowed = narrowPermissions({ registration, requested: ['read', 'merge_pr'], now: NOW });
    expect(narrowed.ok).toBe(false);
    // Expanding it would mean the founder wrote one permission and got five.
    if (!narrowed.ok) {
      expect(narrowed.problems.map((p) => p.refusal)).toContain('permission_prerequisite_missing');
    }
  });

  it('marks merge and production deploy as the two that may never be inferred', () => {
    expect(HIGH_CONSEQUENCE_PERMISSIONS).toEqual(['merge_pr', 'deploy_production']);
    expect(hasHighConsequencePermission(['read', 'write_worktree', 'commit'])).toBe(false);
    expect(hasHighConsequencePermission(['read', 'merge_pr'])).toBe(true);
    expect(hasHighConsequencePermission(['deploy_staging'])).toBe(false);
  });
});

/* ========================================================== registry */

describe('registration is a recorded human act', () => {
  it('refuses a registration that does not say who authorized it', () => {
    const result = createRepositoryRegistration({ draft: draft({ registeredBy: '   ' }), now: NOW });
    expect(result.ok).toBe(false);
    // Without this string the whole audit trail has no anchor.
    if (!result.ok) expect(result.error.message).toContain('who authorized it');
  });

  it('derives the key rather than accepting one', () => {
    const registration = register();
    expect(registration.key).toBe('github:github.com/ohdieyuh-glitch/sunday-relay');
    expect(registration.registeredAt).toBe(NOW);
    expect(registration.revokedAt).toBeNull();
  });

  it('fixes handedToAgent at false and derives permittedUses from the real grants', () => {
    const registration = register({
      grants: [...LADDER.map((p) => grant(p)), grant('deploy_staging')],
      credential: {
        envVarName: 'RELAY_GITHUB_TOKEN',
        // A caller trying to claim the agent holds the token, and to widen the
        // audit trail to a permission that was never granted.
        handedToAgent: true as never,
        permittedUses: ['deploy_production'],
      },
    });
    // An agent holding a repository token has push access regardless of every
    // other control, so this can never be true.
    expect(registration.credential.handedToAgent).toBe(false);
    // And `deploy_production` was never granted, so it is not in the audit
    // trail — the value is derived, not accepted.
    expect(registration.credential.permittedUses).not.toContain('deploy_production');
    expect(registration.credential.permittedUses).toContain('push_feature_branch');
    // Read and worktree writes reach no remote, so they need no credential.
    expect(registration.credential.permittedUses).not.toContain('read');
    expect(registration.credential.permittedUses).not.toContain('write_worktree');
    /**
     * AND NEITHER DEPLOY GRANT IS IN THE REPOSITORY CREDENTIAL'S AUDIT TRAIL.
     *
     * `deploy_staging` used to be, and the check it fed reads
     * `registration.credential.envVarName` — the credential for the repository
     * HOST, which a deploy does not use. A deploy uses the deployment
     * provider's own credential, and some providers need none. The cost of
     * getting this wrong was not a bad error message: a founder wanting to
     * deploy a LOCAL repository was told to configure a git host token, and the
     * only way past the refusal was to configure one. The guard was satisfied
     * by increasing credential exposure. See `requiresCredential`.
     */
    expect(registration.credential.permittedUses).not.toContain('deploy_staging');
  });

  it('lets a LOCAL repository hold a deploy grant with no repository credential', () => {
    const result = createRepositoryRegistration({
      draft: draft({
        identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
        location: { kind: 'local_path', path: '/tmp/demo' },
        grants: [grant('read'), grant('deploy_staging')],
      }),
      now: NOW,
    });
    // Nothing here reaches a git host, so nothing here needs a git credential.
    expect(result.ok).toBe(true);

    // And the grants that DO reach the host are still refused without one.
    const pushing = createRepositoryRegistration({
      draft: draft({
        identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
        location: { kind: 'local_path', path: '/tmp/demo' },
        grants: [grant('read'), grant('write_worktree'), grant('commit'), grant('push_feature_branch')],
      }),
      now: NOW,
    });
    expect(pushing.ok).toBe(false);
    if (!pushing.ok) expect(pushing.error.details).toContain('credential_missing');
  });

  it('requires allowDeletions to be stated rather than omitted', () => {
    const result = createRepositoryRegistration({
      draft: draft({ ceilings: { maxFilesChanged: 5, maxLinesRemoved: 10 } as never }),
      now: NOW,
    });
    // `undefined` reading as `false` would be a permission decided by omission.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toContain('deletion_not_permitted');
  });

  it('refuses a non-positive ceiling', () => {
    for (const ceilings of [
      { maxFilesChanged: 0, maxLinesRemoved: 10, allowDeletions: false },
      { maxFilesChanged: 5, maxLinesRemoved: -1, allowDeletions: false },
      { maxFilesChanged: 1.5, maxLinesRemoved: 10, allowDeletions: false },
    ]) {
      const result = createRepositoryRegistration({ draft: draft({ ceilings }), now: NOW });
      expect(result.ok, JSON.stringify(ceilings)).toBe(false);
    }
  });

  it('always protects the default branch even when configuration forgets to', () => {
    const registration = register({ protectedBranches: ['release'] });
    expect(registration.protectedBranches).toContain('main');
    expect(resolveProtectedBranches(registration)).toContain('main');
  });

  it('retains a revoked registration and does not move the first revocation', () => {
    const registration = register();
    const revoked = revokeRepositoryRegistration({ registration, revokedBy: 'founder', now: NOW });
    expect(revoked.ok && revoked.value.revokedAt).toBe(NOW);
    if (!revoked.ok) throw new Error('revocation failed');
    // Revoking again must not erase WHEN access actually stopped.
    const again = revokeRepositoryRegistration({ registration: revoked.value, revokedBy: 'someone', now: LATER });
    expect(again.ok && again.value.revokedAt).toBe(NOW);
    expect(again.ok && again.value.revokedBy).toBe('founder');
  });

  it('refuses a revocation that does not record who performed it', () => {
    const result = revokeRepositoryRegistration({ registration: register(), revokedBy: '', now: NOW });
    expect(result.ok).toBe(false);
  });

  it('refuses two registrations for one repository rather than picking one', () => {
    const registration = register();
    const duplicated = createRepositoryRegistry([registration, registration]);
    expect(duplicated.ok).toBe(false);
    // Last-write-wins would make the narrower registration decorative and
    // nobody would know which policy was live.
    if (!duplicated.ok) expect(duplicated.error.message).toContain('Duplicate repository registrations');
  });

  it('keeps revoked registrations visible while excluding them from what is usable', () => {
    const live = register();
    const dead = revokeRepositoryRegistration({
      registration: register({
        identity: { ...draft().identity, name: 'other-repo' },
        // The clone URL is checked AGAINST the identity, so a fixture that
        // changes the name must change the URL. That refusal is the feature.
        location: { kind: 'remote_clone', cloneUrl: 'https://github.com/ohdieyuh-glitch/other-repo.git' },
      }),
      revokedBy: 'founder', now: NOW,
    });
    if (!dead.ok) throw new Error('revocation failed');
    const registry = createRepositoryRegistry([live, dead.value]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(registry.value.all).toHaveLength(2);
    expect(registry.value.usable).toHaveLength(1);
    // Hiding it would make an audit read as though it never existed.
    expect(registry.value.find(dead.value.key)?.revokedAt).toBe(NOW);
  });
});

/* ========================================================= resolution */

describe('resolving a Mission target', () => {
  it('refuses an unregistered repository by name, before anything else is evaluated', () => {
    const result = resolve(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.refusal)).toEqual(['repository_not_registered']);
    // The refusal name travels in `details`, so a caller never has to regex a
    // sentence to find out why.
    expect(result.error.details).toContain('repository_not_registered');
  });

  it('refuses a revoked registration WITHOUT evaluating its scope or branches', () => {
    const revoked = revokeRepositoryRegistration({ registration: register(), revokedBy: 'founder', now: NOW });
    if (!revoked.ok) throw new Error('revocation failed');
    // Deliberately also asks for an illegal working branch. Only the revocation
    // may be reported: every other message would describe a repository nobody
    // is allowed to touch.
    const result = resolve(revoked.value, { workingBranch: 'main' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.refusal)).toEqual(['repository_registration_revoked']);
  });

  it('refuses a provider Relay cannot drive, at configuration rather than at the push step', () => {
    const registration = register({
      identity: { provider: 'gitlab', host: 'gitlab.com', owner: 'someone', name: 'thing', defaultBranch: 'main' },
      location: { kind: 'remote_clone', cloneUrl: 'https://gitlab.com/someone/thing.git' },
    });
    const result = resolve(registration, { repositoryKey: registration.key });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.refusal).toBe('repository_provider_unsupported');
  });

  it('refuses the base branch as a working branch, and refuses any protected branch', () => {
    const registration = register({ protectedBranches: ['release'] });
    for (const workingBranch of ['main', 'release']) {
      const result = resolve(registration, { workingBranch });
      expect(result.ok, workingBranch).toBe(false);
      if (!result.ok) expect(result.problems.map((p) => p.refusal)).toContain('protected_branch_target');
    }
  });

  it('allows the base branch to BE protected, because protection is about writing', () => {
    const registration = register();
    const result = resolve(registration, { baseBranch: 'main', workingBranch: 'relay/x' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.baseBranch).toBe('main');
  });

  it('reports every problem at once rather than one per attempt', () => {
    const registration = register();
    const result = resolve(registration, {
      workingBranch: 'main',
      scope: { read: ['**'], write: ['**'] },
      permissions: ['read', 'merge_pr'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const refusals = result.problems.map((p) => p.refusal);
    // A founder fixing refusals one at a time widens permissions by trial and
    // error until the errors stop.
    expect(refusals).toContain('protected_branch_target');
    expect(refusals).toContain('mission_scope_exceeds_registration');
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('leaves baselineSha unknown, because this layer cannot read a repository', () => {
    const result = resolve(register());
    expect(result.ok).toBe(true);
    // Unknown is not zero and not the branch name. The provider fills it in and
    // the attestation compares the two.
    if (result.ok) expect(result.target.baselineSha).toBeNull();
  });

  it('records provenance with no way to say "inferred from the objective"', () => {
    const result = resolve(register());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.provenance.selectionMode).toBe('explicit_registered_key');
    expect(result.target.provenance.selectedBy).toBe('founder');
    expect(result.target.provenance.registeredBy).toBe('founder');
  });

  it('refuses a Mission authorized to write with nowhere to write', () => {
    const registration = register({ scope: { read: ['**'], write: [] } });
    const result = resolve(registration, { permissions: ['read', 'write_worktree'] });
    // Otherwise it runs an agent, produces a diff, and fails every path against
    // the scope after the money is spent.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.map((p) => p.refusal)).toContain('mission_scope_exceeds_registration');
  });

  it('permits a read-only Mission on a read-only registration', () => {
    const registration = register({ scope: { read: ['**'], write: [] }, grants: [grant('read')] });
    const result = resolve(registration, { permissions: ['read'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.permissions).toEqual(['read']);
  });

  it('freezes the target so nothing downstream can widen it', () => {
    const result = resolve(register());
    if (!result.ok) throw new Error('resolution failed');
    expect(Object.isFrozen(result.target)).toBe(true);
  });
});

describe('revocation reaches a Mission already in flight', () => {
  const targetFor = (registration: RepositoryRegistration) => {
    const result = resolve(registration, { permissions: ['read', 'write_worktree'] });
    if (!result.ok) throw new Error(`resolution failed: ${result.error.message}`);
    return result.target;
  };

  it('revokes a target whose registration was revoked mid-Mission', () => {
    const registration = register();
    const target = targetFor(registration);
    const revoked = revokeRepositoryRegistration({ registration, revokedBy: 'founder', now: LATER });
    if (!revoked.ok) throw new Error('revocation failed');
    const decision = revalidateRepositoryTarget({ target, registration: revoked.value, now: LATER });
    expect(decision.ok).toBe(false);
    // A revocation that only applies to future work is not a revocation.
    if (!decision.ok) expect(decision.problem.refusal).toBe('repository_registration_revoked');
  });

  it('revokes a target whose registration disappeared entirely', () => {
    const decision = revalidateRepositoryTarget({ target: targetFor(register()), registration: null, now: LATER });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.problem.refusal).toBe('repository_not_registered');
  });

  it('drops a permission the registration has since lost', () => {
    const registration = register();
    const target = targetFor(registration);
    const narrowed = register({ grants: [grant('read')] });
    const decision = revalidateRepositoryTarget({ target, registration: narrowed, now: LATER });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.permissions).toEqual(['read']);
  });

  it('does NOT add a permission the registration has since gained', () => {
    const registration = register();
    const target = targetFor(registration);
    const widened = register({
      grants: LADDER.map((p) => grant(p)),
      credential: { envVarName: 'RELAY_GITHUB_TOKEN' },
    });
    const decision = revalidateRepositoryTarget({ target, registration: widened, now: LATER });
    expect(decision.ok).toBe(true);
    // The Mission Contract the Reviewer read named the old set. Re-asking can
    // only ever take permission away.
    if (decision.ok) expect(decision.permissions).toEqual(['read', 'write_worktree']);
  });
});

/* ========================================================== lifecycle */

describe('the shipping lifecycle keeps verified, shipped and live apart', () => {
  const full: readonly RepositoryPermission[] = [...LADDER, 'deploy_staging', 'deploy_production'];

  it('walks the whole ladder when every permission is held', () => {
    const steps: [Parameters<typeof advanceShipStage>[0]['currentStage'], Parameters<typeof advanceShipStage>[0]['to']][] = [
      ['verified_complete', 'committed'],
      ['committed', 'pushed'],
      ['pushed', 'pull_request_open'],
      ['pull_request_open', 'merged'],
    ];
    for (const [currentStage, to] of steps) {
      const decision = advanceShipStage({ currentStage, to, permissions: full });
      expect(decision.ok, `${currentStage} → ${to}`).toBe(true);
    }
  });

  it('refuses each step whose permission is missing, naming the permission', () => {
    const cases: [Parameters<typeof advanceShipStage>[0]['currentStage'], Parameters<typeof advanceShipStage>[0]['to'], RepositoryPermission][] = [
      ['verified_complete', 'committed', 'commit'],
      ['committed', 'pushed', 'push_feature_branch'],
      ['pushed', 'pull_request_open', 'create_pr'],
      ['pull_request_open', 'merged', 'merge_pr'],
    ];
    for (const [currentStage, to, needed] of cases) {
      const decision = advanceShipStage({
        currentStage, to,
        permissions: full.filter((p) => p !== needed),
      });
      expect(decision.ok, `${to} without ${needed}`).toBe(false);
      if (!decision.ok) {
        expect(decision.problem.refusal).toBe('permission_not_granted');
        expect(decision.problem.message).toContain(needed);
      }
    }
  });

  it('refuses a merge that skipped the pull request', () => {
    const decision = advanceShipStage({ currentStage: 'pushed', to: 'merged', permissions: full });
    // A merge with no PR is a push to the protected base branch under another
    // word.
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.problem.refusal).toBe('identity_invalid');
  });

  it('never infers production authorization from a staging grant', () => {
    const staging = advanceShipStage({
      currentStage: 'merged', to: 'deployed', environment: 'staging',
      permissions: ['read', 'deploy_staging'],
    });
    expect(staging.ok).toBe(true);
    if (staging.ok) expect(staging.permissionUsed).toBe('deploy_staging');

    const production = advanceShipStage({
      currentStage: 'merged', to: 'deployed', environment: 'production',
      permissions: ['read', 'deploy_staging'],
    });
    // "Build this" must never reach production. This is that rule, mechanically.
    expect(production.ok).toBe(false);
    if (!production.ok) expect(production.problem.message).toContain('deploy_production');

    expect(deployPermissionFor('production')).toBe('deploy_production');
    expect(deployPermissionFor('staging')).toBe('deploy_staging');
  });

  it('refuses a deploy that does not name its environment', () => {
    const decision = advanceShipStage({ currentStage: 'merged', to: 'deployed', permissions: full });
    // Defaulting to staging would deploy for a caller that forgot to say where;
    // defaulting to production needs no explanation. There is no safe default.
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.problem.message).toContain('no default');
  });

  it('allows a staging deploy of an unmerged branch', () => {
    const decision = advanceShipStage({
      currentStage: 'pushed', to: 'deployed', environment: 'staging',
      permissions: ['read', 'deploy_staging'],
    });
    // Refusing this would push founders to merge in order to test.
    expect(decision.ok).toBe(true);
  });

  it('refuses to let anything ADVANCE into shipped', () => {
    const decision = advanceShipStage({ currentStage: 'live_verified', to: 'shipped', permissions: full });
    expect(decision.ok).toBe(false);
    // Otherwise a caller holding a merge grant could assert a ship it never
    // observed. The refusal names the alternative.
    if (!decision.ok) expect(decision.problem.message).toContain('decideShipped');
  });

  it('refuses to let a shipping transition mint verified_complete', () => {
    const decision = advanceShipStage({ currentStage: 'committed', to: 'verified_complete', permissions: full });
    expect(decision.ok).toBe(false);
  });
});

describe('shipped is a conclusion computed from evidence', () => {
  const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';

  const deployment = (overrides: Partial<ShipStageEvidence> = {}): ShipStageEvidence => ({
    stage: 'deployed',
    observedAt: NOW,
    commitSha: SHA,
    branch: 'relay/mission-1',
    remoteRef: 'refs/heads/relay/mission-1',
    pullRequestRef: null,
    environment: 'production',
    deployedRevision: SHA,
    liveProbe: null,
    detail: null,
    ...overrides,
  });

  const probe = (overrides: Partial<LiveProbeResult> = {}): LiveProbeResult => ({
    reachable: true,
    healthy: true,
    reportedRevision: SHA,
    method: 'GET /health',
    observedAt: NOW,
    detail: null,
    ...overrides,
  });

  it('ships when the committed revision is deployed and the running system says so', () => {
    const verdict = decideShipped({ committedSha: SHA, deployment: deployment(), liveProbe: probe() });
    expect(verdict.shipped).toBe(true);
    expect(verdict.liveRevision).toBe(SHA);
  });

  it('refuses to ship a deploy whose revision the provider never named', () => {
    const verdict = decideShipped({
      committedSha: SHA,
      deployment: deployment({ deployedRevision: null }),
      liveProbe: probe(),
    });
    // The provider said it did something, not what. Deployed is recorded; the
    // ship is not.
    expect(verdict.shipped).toBe(false);
    expect(verdict.reason).toContain('did not report which revision');
  });

  it('refuses to ship when the deployed revision is not the committed one', () => {
    const verdict = decideShipped({
      committedSha: SHA,
      deployment: deployment({ deployedRevision: OTHER }),
      liveProbe: probe(),
    });
    // The most common real failure: a deploy that succeeded against a stale
    // build, a cached artifact, or the wrong branch.
    expect(verdict.shipped).toBe(false);
    expect(verdict.reason).toContain('is not the revision Relay committed');
  });

  it('refuses to ship without any observation of the deployed system', () => {
    const verdict = decideShipped({ committedSha: SHA, deployment: deployment(), liveProbe: null });
    expect(verdict.shipped).toBe(false);
    expect(verdict.reason).toContain('never observed');
  });

  it('refuses to ship an unreachable or unhealthy system', () => {
    expect(decideShipped({ committedSha: SHA, deployment: deployment(), liveProbe: probe({ reachable: false }) }).shipped)
      .toBe(false);
    // Reached and unhealthy is not the same as unreachable, and neither ships.
    const unhealthy = decideShipped({
      committedSha: SHA, deployment: deployment(), liveProbe: probe({ healthy: false }),
    });
    expect(unhealthy.shipped).toBe(false);
    expect(unhealthy.reason).toContain('unhealthy');
  });

  it('refuses to ship when the running system reports a DIFFERENT revision', () => {
    const verdict = decideShipped({
      committedSha: SHA, deployment: deployment(), liveProbe: probe({ reportedRevision: OTHER }),
    });
    // 200 while serving last week's bundle is reachable, healthy, and not
    // shipped.
    expect(verdict.shipped).toBe(false);
    expect(verdict.reason).toContain('reports serving');
    expect(verdict.liveRevision).toBe(OTHER);
  });

  it('ships a system that does not report its revision, and says the match is the provider\'s word', () => {
    const verdict = decideShipped({
      committedSha: SHA, deployment: deployment(), liveProbe: probe({ reportedRevision: null }),
    });
    // Many systems cannot report a revision; refusing all of them would make
    // the word unusable. What must not happen is claiming the SYSTEM said so.
    expect(verdict.shipped).toBe(true);
    expect(verdict.reason).toContain('not the system');
    expect(verdict.liveRevision).toBeNull();
  });

  it('refuses to ship with no commit at all', () => {
    for (const committedSha of [null, '', '   ']) {
      const verdict = decideShipped({ committedSha, deployment: deployment(), liveProbe: probe() });
      expect(verdict.shipped, JSON.stringify(committedSha)).toBe(false);
    }
  });

  it('always says why, shipped or not', () => {
    const yes = decideShipped({ committedSha: SHA, deployment: deployment(), liveProbe: probe() });
    const no = decideShipped({ committedSha: SHA, deployment: null, liveProbe: null });
    expect(yes.reason.length).toBeGreaterThan(0);
    expect(no.reason.length).toBeGreaterThan(0);
  });

  it('derives the stage from evidence rather than from a stored claim', () => {
    const evidence: ShipStageEvidence[] = [
      { ...deployment({ stage: 'committed', environment: null, deployedRevision: null }) },
      { ...deployment({ stage: 'pushed', environment: null, deployedRevision: null }) },
    ];
    const unshipped = { shipped: false, reason: 'no deploy', liveRevision: null };
    expect(deriveShipStage({ evidence, verdict: unshipped })).toBe('pushed');
    // A record with a gap reports the furthest step it actually has evidence
    // for, and never the one it wishes it had.
    expect(deriveShipStage({ evidence: [], verdict: unshipped })).toBe('verified_complete');
    expect(deriveShipStage({
      evidence,
      verdict: { shipped: true, reason: 'ok', liveRevision: SHA },
    })).toBe('shipped');
  });
});
