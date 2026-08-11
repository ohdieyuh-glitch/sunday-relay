# Configurable Repository Targets

**Status: the authorization spine, the observation layer and the shipping
lifecycle are BUILT and TESTED. The remote provider and the paid three-role run
against a real repository are NOT.** Read "What is not built" before believing
anything else here.

Design questions and their reasoning:
`FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md`. That document is the *why*;
this one is the *what exists*.

---

## Why this needed replacing something, not just adding something

Every hosted Mission Relay has ever run edited the same repository: a throwaway
git repo built under the OS temp directory by `buildSafeEditFixture()`, four
files, discarded when the Mission ends. Every safety property held **by
construction**:

| Property | Why it held |
|---|---|
| An agent cannot damage anything that matters | The repo is a temp directory |
| "Protected paths untouched" is checkable | The set is four known files |
| "Source worktree unchanged" is provable | Relay made it seconds earlier |
| A bad diff costs nothing | Nothing is pushed, merged or published |
| Credential blast radius is bounded | No repository credential exists |

Pointing a Mission at a real repository removes all five. Each one below is the
deliberate replacement.

---

## The shape

```
src/relay/mission/repository-target/     PURE DOMAIN — decides what is ALLOWED
  repository-contracts.ts       permissions, scope, ceilings, refusal names
  repository-identity.ts        the canonical key; identity is stated, not parsed
  repository-scope.ts           glob scope, literal protection, containment
  repository-authorization.ts   grants, expiry, prerequisites, narrowing
  repository-registry.ts        registration as a recorded human act
  repository-resolution.ts      the one gate: registration + request → target
  repository-observation.ts     ceilings, and judging an OBSERVED diff
  repository-lifecycle.ts       COMMIT → PUSH → PR → MERGE → DEPLOY → LIVE → SHIPPED
  deployment-provider.ts        the DeploymentProvider port

src/relay/workspace/                     NODE — performs and OBSERVES
  repository-target-observer.ts  real git observation + the write surface
```

The domain has no Node, no network and no clock — time is an injected ISO
string — so the browser, the CLI and the bridge read the same record and reach
the same conclusions, and none of the three can widen them.

---

## 1. Authorization: eight grades, no escalation

```
read → write_worktree → commit → push_feature_branch → create_pr → merge_pr
read → deploy_staging → deploy_production
```

- A repository must be **registered** before a Mission can name it.
  Registration records `registeredBy` and `registeredAt`, and a registration
  that does not say who authorized it is refused.
- `RepositoryTargetRequest` has **no field** for a URL, a clone path or an
  owner. A Mission names a registered key or names nothing. The absence of
  those fields is what makes "an objective cannot introduce a repository" a
  property of the type rather than a promise in a comment.
- `RepositoryProvenance.selectionMode` has exactly one member,
  `explicit_registered_key`. There is no `inferred_from_objective` and there
  must never be one.
- **A prerequisite is checked, never auto-granted.** A grant naming `merge_pr`
  without `create_pr` is refused, not expanded — expanding is how a founder
  writes one permission and gets five.
- **`requested === null` resolves to the safe floor** (`read` +
  `write_worktree`), never to everything the registration allows. "Build me an
  app" must not produce a Mission holding a production deploy grant.
- **Revocation is immediate, including mid-Mission.**
  `revalidateRepositoryTarget` re-asks the CURRENT registration before every
  consequential act and can only ever take permission away — a permission the
  registration has since GAINED is not adopted, because the Mission Contract the
  Reviewer read named the old set.

### Merge: where this contradicts the design document, in the open

`FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md` says Relay may open a pull
request and may **never** merge one, and that no configuration flag should grant
it. The founder's goal statement that authorized this work names `MERGE PR` as
one of eight permissions. Both cannot be literally true, so:

- `merge_pr` **exists**, because the founder asked for it.
- It is **never implied**. Not reachable by escalation from `create_pr`, refused
  when the grant does not name it, and marked in
  `HIGH_CONSEQUENCE_PERMISSIONS` — with `deploy_production` — as one of the two
  grants that may not be inferred, defaulted, or carried over.
- `merged` may follow `pull_request_open` and **nothing else**. There is no path
  from `pushed` to `merged`: a merge with no pull request is a push to the
  protected base branch under a different word.

The document's reasoning survives as the bar, not as a veto.

---

## 2. Scope and protection

Two matching languages, deliberately:

- **Scope is glob-matched** (`src/**`, `packages/*/src/**`). A useful write
  scope in a real repository is a shape, not a list.
- **Protection is literal segment-prefix matched** — because that is exactly
  what `src/relay/workspace/protected-paths.ts` already enforces when Relay
  inspects the worktree. A glob in a protected path is **refused at
  registration**: accepted, it would be honoured by the policy record and
  ignored by the enforcer, so the rule would be true in the record and false in
  the repository.

Rules:

- An empty **write** scope means read-only, which is supported and useful. An
  empty **read** scope is refused — "everything" is spelled `['**']`, by a
  human, on purpose.
- A write pattern not covered by the read scope is refused rather than widening
  read.
- A Mission may ask for **less** than the registration allows and never more.
  Asking for more is refused, not clamped: a clamp turns a mistaken request
  into a silently different Mission and the Reviewer reads a diff produced
  under a scope nobody wrote down.
- **Protection beats scope.** A path inside a `**` write scope that matches a
  protected rule is protected.
- `.git` is protected unconditionally and an attempt to unprotect it is refused
  **by name** rather than silently filtered.
- Protected by default, each overridable only by naming it — fifteen entries:
  `.github`, `.gitlab-ci.yml`, `.circleci`, `azure-pipelines.yml`, `Jenkinsfile`,
  eight dependency manifests and lockfiles (`package-lock.json`,
  `pnpm-lock.yaml`, `yarn.lock`, `npm-shrinkwrap.json`, `Cargo.lock`,
  `poetry.lock`, `Gemfile.lock`, `go.sum`), `.env` and `.relay`. The count is
  asserted by a test rather than written here from memory: an earlier draft of
  this line said "the six common lockfiles" when the array held eight, which is
  exactly the class of claim — a number in prose the code does not support —
  that has produced more defects in this repository than any other.

---

## 3. Observation: Relay reads git, never the agent

`ObservedDiff.observedBy` is a union of `relay_git_inspection` and
`relay_fixture_inspection`. **There is no member naming the Coding Agent, the
Reviewer, or a model.** Adding one would be the whole safety property, deleted.

`observeRepositoryWorktree` performs two real git reads — `status --porcelain=v1
-z` for the file set, `diff --numstat HEAD` for line counts — and:

- A binary file's counts are `-` in numstat and become **null**, not zero.
- An untracked file's added-lines are counted from disk, bounded at 2 MB; over
  the bound, or containing a NUL byte, the count is **null**. Its removed-count
  is **0**, which is a fact about a file that did not previously exist — the
  one honest zero in the module.
- A path in `status` but absent from `numstat` that is not untracked reports
  both counts as null. Relay does not know, and says so.

`judgeObservedDiff` then composes every rule, in this order:

1. A **conflicted** worktree is refused first and alone. An unfinished merge is
   not a diff, and classifying its paths would report scope violations for
   conflict markers instead of the one fact that matters.
2. An observation with **no baseline SHA** is refused — without it the artifact
   digest the Reviewer bound its verdict to describes a diff against nothing.
3. Scope, protection and ceilings, all reported **together**.
4. **Never a partial accept.** `committablePaths` is empty unless nothing was
   refused. Committing the legal half of a diff whose other half touched
   protected paths leaves the repository in a state no Reviewer ever read.

The observer **echoes the baseline it was given** and never reads HEAD for
itself. After a commit HEAD has moved, so an observer that read HEAD would make
`baseMovedUnderMission` compare a value against itself and always agree the
base was unchanged.

### Ceilings

`maxFilesChanged`, `maxLinesRemoved`, `allowDeletions` — all three previously
existed in the contracts with nothing reading them.

- Exceeding **refuses**; it never truncates. A truncated diff is a Reviewer
  reading a fragment and answering as though it read the whole thing.
- An **unknown** removal count is refused rather than assumed small. This is the
  one place absent data blocks rather than merely reports, because the
  alternative is a binary blob emptying a repository under a ceiling that saw
  zero.
- `allowDeletions` must be stated explicitly, `true` or `false`. `undefined`
  reading as `false` would be a permission decided by an omission.

---

## 4. The write surface: an allow-list

`runRepositoryGit` permits exactly ten subcommands: `rev-parse`, `status`,
`diff`, `add`, `commit`, `branch`, `show`, `log`, `ls-files`, `cat-file`.

`push`, `fetch`, `remote`, `merge`, `rebase`, `reset`, `clean`, `gc`, `tag` and
`config` are **absent, and their absence is the enforcement**. The design
document's rule — *Relay adds commits; it never rewrites them* — is that array.
A deny-list would be a list somebody has to keep complete, and git has more ways
to destroy history than anyone remembers.

Refused whatever the subcommand: `--force`, `-f`, `--hard`, `--amend`,
`--force-with-lease`, `--no-verify`, `--allow-empty`, `--reset-author`,
`--date`, `--author`. `commit --amend` is inside `commit`, and `add --force`
writes an ignored file — which in a real repository is where credentials live.

`commitObservedWork` refuses before writing a byte when: the judgement was not
accepted (naming the judgement's own refusals, so the refusal is Relay's and not
git's "nothing to commit"); the Mission does not hold `commit`; the worktree is
not on the Mission's working branch; the branch is the base or protected; or the
message is empty. It stages **only** the judged paths — a file created after the
judgement stays uncommitted and visible — and reads the commit SHA back from
git rather than computing one.

---

## 5. Credentials

- The repository credential is **server-side only**. `CredentialBoundary`
  carries the **name** of an environment variable and nothing else: no value, no
  prefix, no length, no fingerprint. This object travels into Mission evidence,
  the PR body and the UI.
- `handedToAgent` is **fixed at `false` by construction** — a caller cannot set
  it true. The field exists so evidence *states* the boundary rather than
  leaving a reader to assume it. An agent holding a repository token has push
  access regardless of every other control here.
- `permittedUses` is **derived** from the grants that actually need a credential,
  never accepted from the caller. A draft listing `deploy_production` while
  granting only `read` would otherwise put a production deploy in the audit
  trail of a read-only repository.
- **Deploy grants do not require the repository credential.** They used to, and
  the check read the git-host credential — which a deploy does not use. The cost
  was concrete: a founder deploying a LOCAL repository was told to configure a
  git host token, and the only way past the refusal was to configure one. The
  guard was satisfied by *increasing* credential exposure. A deployment
  provider declares its own credential in its descriptor.

---

## 6. The shipping lifecycle

```
BUILD → VERIFY → REVIEW → REPAIR → VERIFIED COMPLETE
      → COMMIT → PUSH/PR → MERGE (if authorized) → DEPLOY → LIVE VERIFY → SHIPPED
```

`verified_complete` is the **join** with the existing proven pipeline, not a new
invention. Three words that never merge:

| Word | Means |
|---|---|
| **Verified Complete** | the artifact passed RELAY. Says nothing about where it is |
| **Shipped** | the INTENDED REVISION was actually deployed |
| **Live** | evidence came back FROM the deployed system |

**`shipped` is not a stage anything advances into.** `advanceShipStage` refuses
it by name and points at `decideShipped`, which requires all four of:

1. A commit exists and Relay knows its SHA.
2. The deployment reports the revision it deployed. A provider that returned
   success without naming one has said it did something, not what.
3. That revision **equals** the committed one — the check that catches the most
   common real failure: a deploy that succeeded against a stale build, a cached
   artifact, or the wrong branch.
4. A live probe reached the system, found it healthy, and — when the system
   reports a revision — that revision matches too.

A system that does **not** report its revision does not block shipping (many
cannot), but the verdict's reason then says the match is *the provider's word,
not the system's*. A system that reports a **different** revision does block:
200 while serving last week's bundle is reachable, healthy, and not shipped.

`deriveShipStage` reads the stage off the **evidence** rather than a stored
claim, so a record with a gap reports the furthest step it actually has evidence
for.

### Deploy authorization

`deployPermissionFor(environment)` returns one name. Production asks for
`deploy_production` and nothing else satisfies it. **"Build this" never
authorizes production**, and that is this function. A deploy that does not name
its environment is **refused** — defaulting to staging would deploy for a caller
that forgot to say where, and defaulting to production needs no explanation.

Staging may deploy an **unmerged** branch: refusing it would push founders to
merge in order to test.

`providerSupportsEnvironment` refuses a provider asked for an environment it is
not configured for — without it, a staging-only provider handed a production
deploy would quietly deploy to the only environment it knows. A **simulated**
provider may never touch production: not because it would do damage, but because
it would produce a production deployment record for a deploy that never
happened, and that record is what a founder reads to decide the software is
live.

---

## What is PROVEN, and how

`src/relay/workspace/repository-target-observer.test.ts` runs a **real** `git
init`, a **real** `git worktree`, real files written to disk by something other
than the observation, a **real** deploy to a directory, a **real** HTTP server,
and a **real** `fetch` over a real socket:

- Real numstat: one line replaced and one added reads as `+2 / -1`.
- A real untracked binary file reads as unknown-added / zero-removed and is
  accepted; a real **modified tracked** binary file reads as unknown-removed and
  is **refused**.
- A real `.github/workflows/ci.yml` edit under a `**` write scope is refused by
  protection, and the legal file in the same diff is not committed either.
- The **source** repository is byte-for-byte unchanged while the worktree
  changes.
- A commit SHA that matches an independent `rev-parse` and resolves under
  `cat-file -t`.
- A file created **after** the judgement is not committed.
- A real second commit to `main` is detected as a moved base.
- SHIPPED when a real server reports the committed revision; **not** shipped
  when it reports a stale one; **not** shipped when nothing is listening.
- A production deploy refused twice over — by the Mission's permissions and by
  the provider's configuration.

**Mutation discipline.** 33 probes, each reverting one guard and naming the test
that fell. Four probes initially did **not** bite and the tests were
strengthened until they did — including one where the assertion was satisfied by
`'a'.repeat(40)`, one where git's own "nothing to commit" was doing the work the
guard was credited for, and one where nothing tested that the observer echoes
its baseline instead of reading HEAD.

---

## The Project Brain feed

Repository work teaches the Brain two different kinds of thing, and the split is
the whole design:

| | Goes to | Approved by |
|---|---|---|
| Deployment history, refusals, failures, verified repairs — **events** | short-term memory | nobody |
| Architecture, stack, commands, branch policy, deploy target — **knowledge** | a promotion **proposal** | a human |

"This repository's verification command is `npm test`" is a durable claim that
will steer every future mission. Relay must not write it into approved memory on
its own authority — if an agent could promote its own observation, *"the Brain
says so"* would mean *"an agent wrote it down twice"*, and the approval gate that
makes long-term memory worth trusting would be decorative. There is deliberately
no function in this module that produces a `RelayLongTermEntry`.

Four rules, each with a mutation proof:

1. **Only what Relay established itself may even be PROPOSED.**
   `proposeRepositoryKnowledge` refuses `verifiedByRelay: false` by name and says
   to record a short-term observation instead. A stack inferred by a model from a
   filename is a claim that would send every later mission down the same wrong
   path, and a proposal is halfway to approved.
2. **A deploy observation may never read as a ship.** Its summary carries
   *"Whether it is live is a separate observation"* and a test asserts the words
   "shipped" and "live" do not appear as claims. A short-term entry saying
   "deployed to production" beside a mission that never shipped is how a Brain
   comes to believe something the pipeline explicitly refused to conclude.
3. **A refusal records the refusal NAMES, not a count.** "2 problems" teaches a
   future mission nothing; `protected_path_unprotect_refused` teaches it what not
   to do again.
4. **`ShipVerdict.reason` is carried verbatim.** Every rewording is a chance to
   turn "the running system reports a different revision" into "deploy failed",
   and which of the four ship conditions failed is the whole value.

No new observation kind and no new memory source were added:
`run_outcome`/`error`/`repair` and `repository_observed` already existed — the
Brain's vocabulary had already assumed a repository could teach it something and
that it would need approving. And no knowledge kind carries an opinion: there is
no `code_quality`, no `technical_debt`, no `recommended_refactor`, because an
approval queue full of model opinions is an approval queue nobody reads.

---

## What is NOT built

Stated plainly, because a document that reads as finished is worse than one that
reads as unfinished.

1. **No remote provider exists.** `push_feature_branch`, `create_pr` and
   `merge_pr` are *authorized* by this code and *performed* by nothing. There is
   no GitHub client here. The write surface's allow-list has no `push`, and that
   is deliberate: the remote operations belong to a provider that holds a
   credential, and it is a separate, separately-audited surface that has not
   been written.
2. **The paid three-role pipeline has not run against a real repository.**
   Everything proven above is the machinery the Architect, Coding Agent and
   Reviewer would hand their work to. Running them against a real repository
   needs provider credentials and founder authorization.
3. **Not wired into the Mission engine.** `relay-bridge/mission.ts` still calls
   `buildSafeEditFixture()`. Nothing in the bridge reads a
   `MissionRepositoryTarget` yet. The controlled-fixture path is unchanged and
   remains the default and the test path, which the design document requires.
4. **No durable store.** Registrations are built and read as values; nothing
   persists them across a restart yet. The store belongs beside the other
   durable stores in `src/relay/persistence`, on the same key/value backing.
5. **No dry-run mode.** The design document requires one — produce the branch
   and the PR body, push nothing — and it does not exist because there is
   nothing to push with.
6. **The Project Brain feed is BUILT but has no producer.**
   `repository-brain-feed.ts` projects repository work into the **existing**
   Brain — `rememberShortTerm` and `proposePromotion` in
   `src/relay/shared/llmops/brain-memory.ts`, following the
   `evidence/evidence-brain-link.ts` precedent. It is not a second store. What
   is missing is a caller: nothing in the bridge invokes it yet, for the same
   reason as (3) — the mission engine does not read a repository target.
   See "The Project Brain feed" below.
7. **`gitlab` and `bitbucket`** are nameable in the domain and refused at
   selection by `repositoryProviderSupported`. Registered is not drivable, and
   the refusal happens at configuration rather than at the push step.
8. **Review-packet fidelity at real repository size is unproven.** The design
   document flags this as the highest-risk remaining item: three separate
   defects in the goal that produced it were display sanitizers truncating
   machine-read payloads, and a larger repository makes that class of bug far
   more likely and far more damaging.
