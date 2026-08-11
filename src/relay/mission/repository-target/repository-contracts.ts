/**
 * REPOSITORY TARGETS — what a Mission is allowed to touch, and who decided.
 *
 * Every hosted Mission Relay has ever run edited the same repository: a
 * throwaway git repo built under the OS temp directory by
 * `buildSafeEditFixture()`, containing four files, discarded when the Mission
 * ends. That is not a limitation to be lifted casually. It is the reason every
 * safety property currently holds BY CONSTRUCTION:
 *
 *   | Property                                  | Why it holds today            |
 *   |-------------------------------------------|-------------------------------|
 *   | An agent cannot damage anything important | The repo is a temp directory  |
 *   | "Protected paths untouched" is checkable  | The set is four known files   |
 *   | "Source worktree unchanged" is provable   | Relay made it seconds earlier |
 *   | A bad diff costs nothing                  | Nothing is pushed or merged   |
 *   | Credential blast radius is bounded        | No credential exists at all   |
 *
 * Pointing a Mission at a real repository removes every one of them, and each
 * has to be replaced by something deliberate. This module is the replacement:
 * a repository must be REGISTERED before a Mission can name it, registration
 * records who authorized it and when, and every capability beyond reading is a
 * separate explicit grant that can be revoked.
 *
 * PURE DOMAIN. No Node, no network, no clock — time is an injected ISO string.
 * The browser, the CLI and the bridge all read the same declarations and reach
 * the same conclusions, and none of the three can widen them.
 *
 * WHAT THIS MODULE IS NOT. It never clones, never runs git, never holds a
 * credential and never performs an action. It decides what is ALLOWED. The
 * Node-side providers act on that decision, and observe what actually happened
 * — which is a separate fact this module deliberately cannot produce.
 */

/**
 * WHERE A REPOSITORY LIVES.
 *
 * Local git is the core primitive and stays first in this list because it is
 * the one Relay's existing worktree, inspection and verification machinery
 * already speaks. GitHub is the first REMOTE provider, not the architecture:
 * nothing in the Mission engine may branch on `=== 'github'`, or the next
 * provider becomes a rewrite rather than an addition.
 */
export const REPOSITORY_PROVIDERS = ['local', 'github', 'gitlab', 'bitbucket'] as const;
export type RepositoryProviderId = (typeof REPOSITORY_PROVIDERS)[number];

/** Providers Relay has an implementation for TODAY. Registered is not the same
 *  as reachable: a registration naming an unimplemented provider is accepted by
 *  the domain (it is a coherent thing to describe) and refused at selection
 *  (see `repositoryProviderSupported`), which keeps "we could describe it" and
 *  "we can drive it" as two separate facts — the same distinction role slots
 *  draw between a registered occupant and a dispatchable one. */
export const IMPLEMENTED_REPOSITORY_PROVIDERS: readonly RepositoryProviderId[] = ['local', 'github'];

/**
 * THE CAPABILITY LADDER.
 *
 * A user saying "build this" authorizes `write_worktree` at most. Everything
 * beyond it is a separate decision, and no code path may promote one to the
 * next. The names are the founder's, kept verbatim so a grant reads the same
 * in the registry, the Mission Contract, the API and the UI.
 */
export const REPOSITORY_PERMISSIONS = [
  /** Clone/fetch and read files inside the read scope. */
  'read',
  /** Modify files inside the write scope, in an isolated worktree only. */
  'write_worktree',
  /** Create commits on the Mission's working branch. Never on the base. */
  'commit',
  /** Push the Mission's working branch to the remote. Never the base branch. */
  'push_feature_branch',
  /** Open a pull request from the working branch into the base. */
  'create_pr',
  /** Merge that pull request. See MERGE_IS_DIFFERENT below. */
  'merge_pr',
  /** Deploy to a non-production environment. */
  'deploy_staging',
  /** Deploy to production. */
  'deploy_production',
] as const;
export type RepositoryPermission = (typeof REPOSITORY_PERMISSIONS)[number];

/**
 * MERGE IS DIFFERENT, AND THE RECORD SHOULD SAY WHY.
 *
 * `docs/relay/FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md` — written before
 * this module existed — says Relay may OPEN a pull request and may never MERGE
 * one, and that no configuration flag should be able to grant it. The founder's
 * goal statement that authorized this work names `MERGE PR` as one of eight
 * explicit permissions. Both cannot be literally true, so the disagreement is
 * resolved in the open rather than silently:
 *
 *   - `merge_pr` EXISTS, because the founder asked for it.
 *   - It is never implied by anything. It is not reachable by escalation from
 *     `create_pr`, it is refused when the grant does not name it, and
 *     `HIGH_CONSEQUENCE_PERMISSIONS` below marks it — with production deploy —
 *     as one of the two grants that may not be inferred, defaulted, or carried
 *     over from a previous Mission.
 *
 * The doc's reasoning survives as the bar, not as a veto.
 */

/**
 * PREREQUISITES, CHECKED — NEVER AUTO-GRANTED.
 *
 * A grant naming `merge_pr` without `create_pr` is INCOHERENT, and there are
 * two ways to handle that: expand it, or refuse it. Expanding is how an agent
 * ends up with more reach than anyone decided to give it — the founder wrote
 * one permission and got three. Refusing keeps the grant exactly as inspectable
 * as it looks. Relay refuses.
 */
export const PERMISSION_PREREQUISITES: Readonly<Record<RepositoryPermission, readonly RepositoryPermission[]>> =
  Object.freeze({
    read: [],
    write_worktree: ['read'],
    commit: ['write_worktree'],
    push_feature_branch: ['commit'],
    create_pr: ['push_feature_branch'],
    merge_pr: ['create_pr'],
    // Deploying reads a repository and a build; it does not require the ability
    // to change one. A Mission may be authorized to deploy an existing revision
    // without ever being authorized to write a line of it.
    deploy_staging: ['read'],
    deploy_production: ['deploy_staging'],
  });

/**
 * The two grants that may never arrive by inference, by default, or by
 * inheritance from a previous Mission — they must be named, by a human, for
 * this repository, and they are the only two that carry a mandatory
 * `authorizedBy` re-confirmation at Mission scope.
 */
export const HIGH_CONSEQUENCE_PERMISSIONS: readonly RepositoryPermission[] = ['merge_pr', 'deploy_production'];

/* ------------------------------------------------------------- identity */

/**
 * WHICH REPOSITORY. Requested identity and actual identity are separate types
 * on purpose (see `RepositoryTargetAttestation`) — this one is what somebody
 * ASKED for, and it is never evidence that it is what Relay reached.
 */
export interface RepositoryIdentity {
  readonly provider: RepositoryProviderId;
  /** Remote host, e.g. `github.com`. Null for `local`, and only for `local`. */
  readonly host: string | null;
  /** Owner or organization. Null for `local`, and only for `local`. */
  readonly owner: string | null;
  /** Repository name, or — for `local` — the directory basename. */
  readonly name: string;
  /** The branch Missions base from unless one says otherwise. */
  readonly defaultBranch: string;
}

/**
 * WHERE THE BYTES ARE, on the machine that will run the Mission.
 *
 * A local target names a path Relay may open. A remote target names a clone
 * URL Relay may fetch. Both are recorded so a Mission's provenance answers
 * "where did this code come from" without re-deriving it from a credential.
 */
export type RepositoryLocation =
  | { readonly kind: 'local_path'; readonly path: string }
  | { readonly kind: 'remote_clone'; readonly cloneUrl: string };

/* ---------------------------------------------------------------- scope */

/**
 * READ AND WRITE SCOPE.
 *
 * Relay already has the right primitive — the file claim: the Coding Agent
 * declares what it changed, Relay compares that against what actually changed,
 * and a mismatch fails the Mission. That machinery is not replaced here. It is
 * given a scope to operate inside.
 *
 * `read` is usually wider than `write`, because an agent that cannot read the
 * surrounding code writes worse patches, and reading a file is not editing it.
 *
 * BOTH ARE EXPLICIT AND NEITHER DEFAULTS. An empty `write` means READ-ONLY,
 * which is a supported and useful mode. An empty `read` means nothing may be
 * read, which is useless — so registration refuses it rather than quietly
 * treating it as "everything". "Everything" is spelled `['**']`, by a human,
 * on purpose.
 */
export interface RepositoryScope {
  readonly read: readonly string[];
  readonly write: readonly string[];
}

/**
 * PATHS THAT MAY NOT CHANGE, even inside the write scope.
 *
 * `unprotect` is the escape hatch and it is deliberately awkward: it names an
 * exact default that this repository opts OUT of, so an audit reads the
 * exception rather than having to diff two lists to find it. `.git` is not
 * listed there and cannot be — see `ALWAYS_PROTECTED_PATHS`.
 */
export interface ProtectedPathConfig {
  /** Additional protected paths for this repository. */
  readonly additional: readonly string[];
  /** Defaults this repository explicitly opts out of, named one by one. */
  readonly unprotect: readonly string[];
}

/**
 * PROTECTED UNCONDITIONALLY. No configuration reaches this list.
 *
 * `.git` is the repository's own history and Relay's evidence that the agent
 * changed what it says it changed. An agent that can write `.git` can rewrite
 * the baseline the whole verification is measured against.
 */
export const ALWAYS_PROTECTED_PATHS: readonly string[] = ['.git'];

/**
 * PROTECTED BY DEFAULT, overridable only by naming the path in `unprotect`.
 *
 * The grouping is the argument for each entry:
 *
 *   - CI and automation. An agent that can edit CI can disable the checks that
 *     would have caught it. This is the single highest-leverage line here.
 *   - Dependency manifests and lockfiles. A dependency change is a supply-chain
 *     decision, not a side effect of a bug fix. A Mission whose whole purpose
 *     is a dependency bump unprotects them explicitly.
 *   - Secrets and environment files. Relay already redacts these in payloads;
 *     it should also refuse to write them.
 *   - Relay's own configuration inside the target repository, which is how a
 *     Mission would widen its own envelope for the next one.
 */
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  '.github',
  '.gitlab-ci.yml',
  '.circleci',
  'azure-pipelines.yml',
  'Jenkinsfile',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'go.sum',
  '.env',
  '.relay',
];

/* ----------------------------------------------------------- ceilings */

/**
 * MASS-CHANGE CEILINGS.
 *
 * A diff that deletes four hundred files is not a fix that went slightly
 * wrong. Exceeding a ceiling REFUSES the Mission; it never truncates the diff,
 * because a truncated diff is a Reviewer reading a fragment and answering as
 * though it read the whole thing.
 *
 * `allowDeletions` is separate from write scope on purpose: "change this file"
 * and "remove this file" are different acts, and the second is off by default.
 */
export interface ChangeCeilings {
  readonly maxFilesChanged: number;
  readonly maxLinesRemoved: number;
  readonly allowDeletions: boolean;
}

export const DEFAULT_CHANGE_CEILINGS: ChangeCeilings = Object.freeze({
  maxFilesChanged: 25,
  maxLinesRemoved: 2_000,
  allowDeletions: false,
});

/* ------------------------------------------------------- authorization */

/**
 * ONE GRANT, and the evidence that a human made it.
 *
 * `authorizedBy` and `authorizedAt` are not decoration — a registration whose
 * authorizer is unknown is a registration nobody can be shown to have made,
 * and this whole module exists so that question has an answer.
 *
 * `expiresAt` is optional because a standing grant is legitimate; when present
 * it is enforced against the injected clock, and an expired grant is refused
 * exactly like an absent one.
 */
export interface PermissionGrant {
  readonly permission: RepositoryPermission;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  readonly expiresAt: string | null;
  /** Free-text reason recorded with the grant. Never parsed, only shown. */
  readonly note: string | null;
}

/**
 * WHERE A CREDENTIAL LIVES — never the credential itself.
 *
 * This type carries the NAME of a server-side environment variable and nothing
 * else. No value, no prefix, no length, no fingerprint. A record that carried
 * "starts with ghp_" would be a record that leaks a little every time it is
 * shown, and this object is shown: it travels into Mission evidence, the PR
 * body and the UI.
 *
 * `handedToAgent` is fixed at `false` in every constructor here and is present
 * as a field so the answer is VISIBLE in evidence rather than merely true in
 * code. The Coding Agent works in a local worktree with no remote and no
 * network; Relay performs every remote operation itself, after the agent
 * exits. An agent holding a repository token has push access regardless of
 * every other control in this file.
 */
export interface CredentialBoundary {
  /** Env var name the bridge reads the credential from. Server-side only. */
  readonly envVarName: string | null;
  /** Always false. Present so evidence states it rather than implying it. */
  readonly handedToAgent: false;
  /** What the credential is allowed to be used for, for the audit trail. */
  readonly permittedUses: readonly RepositoryPermission[];
}

/* --------------------------------------------------------- registration */

/**
 * A REGISTERED REPOSITORY.
 *
 * Registration is a founder action. It is never an inference from a URL in an
 * objective, and never an implication of a credential's reach — a token that
 * can see fifty repositories does not authorize fifty targets.
 */
export interface RepositoryRegistration {
  /** Canonical key, derived — never supplied. See `repositoryKey`. */
  readonly key: string;
  readonly identity: RepositoryIdentity;
  readonly location: RepositoryLocation;
  readonly scope: RepositoryScope;
  readonly protectedPaths: ProtectedPathConfig;
  readonly ceilings: ChangeCeilings;
  readonly grants: readonly PermissionGrant[];
  readonly credential: CredentialBoundary;
  /** Branches no Mission may commit to, push to, or target as a working
   *  branch. The default branch is always one of these; see `protectedBranches`. */
  readonly protectedBranches: readonly string[];
  readonly registeredBy: string;
  readonly registeredAt: string;
  /** Set when revoked. A revoked registration is retained, never deleted, so
   *  the audit trail survives the revocation. */
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

/* -------------------------------------------------------------- refusals */

/**
 * WHY RELAY SAID NO, as a closed set.
 *
 * Every refusal here is reported by NAME at the configuration boundary, before
 * any provider request, any clone and any spend — the same shape as
 * `role_binding_refused`. A refusal the caller has to parse out of a sentence
 * is a refusal that gets logged and ignored.
 */
export const REPOSITORY_REFUSALS = [
  'repository_not_registered',
  'repository_registration_revoked',
  'repository_provider_unsupported',
  'permission_not_granted',
  'permission_grant_expired',
  'permission_prerequisite_missing',
  'mission_scope_exceeds_registration',
  'scope_empty_read',
  'protected_path_unprotect_refused',
  'protected_branch_target',
  'base_branch_not_permitted',
  'credential_missing',
  'identity_invalid',
  'ceiling_exceeded',
  'deletion_not_permitted',
] as const;
export type RepositoryRefusal = (typeof REPOSITORY_REFUSALS)[number];

export interface RepositoryProblem {
  readonly refusal: RepositoryRefusal;
  /** Safe, human-readable. Never a credential, a path outside the repo, or a
   *  file body. */
  readonly message: string;
}

/* ------------------------------------------------------- mission target */

/**
 * THE RESOLVED TARGET ONE MISSION WILL RUN AGAINST.
 *
 * Produced by `resolveRepositoryTarget` from a registration plus what the
 * Mission asked for, and then FROZEN: nothing downstream may widen it. A
 * Mission may ask for less than the repository allows; it may never ask for
 * more.
 *
 * `baselineSha` is null here and filled in by the Node side once it has
 * actually resolved the base branch to a commit. Unknown is not zero, and a
 * baseline nobody has read yet is unknown.
 */
export interface MissionRepositoryTarget {
  readonly repositoryKey: string;
  readonly identity: RepositoryIdentity;
  readonly location: RepositoryLocation;
  /** The branch the Mission bases from. Verified to exist by the provider. */
  readonly baseBranch: string;
  /** The branch the Mission works on. Never the base, never protected. */
  readonly workingBranch: string;
  /** Exact commit the Mission started from. Null until the provider reads it. */
  readonly baselineSha: string | null;
  readonly scope: RepositoryScope;
  /** Fully resolved: always-protected ∪ (defaults − unprotect) ∪ additional. */
  readonly protectedPaths: readonly string[];
  readonly ceilings: ChangeCeilings;
  /** Exactly what this Mission may do — a subset of the registration's live
   *  grants, narrowed by what the Mission asked for. */
  readonly permissions: readonly RepositoryPermission[];
  readonly credential: CredentialBoundary;
  readonly protectedBranches: readonly string[];
  /** Where this target came from, for the Mission Contract's provenance line. */
  readonly provenance: RepositoryProvenance;
}

/**
 * HOW THIS TARGET CAME TO BE SELECTED.
 *
 * `selectedBy` is a human or a system component, never a model. There is no
 * `inferred_from_objective` member of this union and there must never be one:
 * the absence of that member is what makes "an agent cannot silently choose a
 * repository" a property of the type rather than a promise in a comment.
 */
export interface RepositoryProvenance {
  readonly registeredBy: string;
  readonly registeredAt: string;
  readonly selectedBy: string;
  readonly selectedAt: string;
  readonly selectionMode: 'explicit_registered_key';
}

/* ------------------------------------------------------- attestation */

/**
 * REQUESTED VS ACTUAL, for repositories.
 *
 * The same rule that keeps a swapped model visible keeps a swapped repository
 * visible. The requested half is what the Mission Contract said; the actual
 * half is what the provider OBSERVED after the fact — the remote it really
 * fetched, the SHA it really resolved, the branch it really created. They are
 * separate fields precisely so a divergence is reportable, and `matches` is
 * computed from the two rather than asserted alongside them.
 *
 * Every `actual*` field is nullable because "not observed yet" is a real state
 * and must not render as agreement.
 */
export interface RepositoryTargetAttestation {
  readonly requestedKey: string;
  readonly requestedBaseBranch: string;
  readonly requestedBaselineSha: string | null;
  /** Observed remote/path identity key, from the provider. */
  readonly actualKey: string | null;
  readonly actualBaseBranch: string | null;
  readonly actualBaselineSha: string | null;
  readonly actualWorkingBranch: string | null;
  /** True only when every observed field is present AND equal to its request. */
  readonly matches: boolean;
  readonly observedAt: string | null;
}
