# Configurable Repository Targets

**Status: the authorization spine, the observation layer, the shipping
lifecycle and its runner are BUILT and TESTED. `COMMIT -> DEPLOY -> LIVE VERIFY
-> SHIPPED` is PERFORMED, against a real repository, a real artifact and a real
HTTP probe. What has NOT happened is a paid three-role run against a real
repository, and any remote operation at all: the GitHub provider is written and
proven offline and has never made a request, because no credential exists here.**

Read "What is not built" before believing anything else here — and note that
that list is itself checked against the code, not maintained from memory. An
earlier version of it claimed the dry-run mode did not exist while
`planDryRun` was built, exported and covered by 19 tests.

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
  remote-provider.ts            the RemoteRepositoryProvider port
  repository-brain-feed.ts      events → short-term memory, knowledge → a proposal
  repository-dry-run.ts         the plan and the PR body, performing nothing

src/relay/workspace/                     NODE — performs and OBSERVES
  repository-target-observer.ts  real git observation + the write surface

relay-bridge/                            THE BRIDGE — performs
  repository-source.ts          the one branch: fixture or registered target
  github-remote-provider.ts     the first remote provider, injected fetch
  local-directory-deployment-provider.ts
                                the first REAL DeploymentProvider: staging only
  ship-runner.ts                walks COMMIT → DEPLOY → LIVE VERIFY → SHIPPED
  ship-brain-feed.ts            a ship run → the existing Project Brain
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

**Four states exist because they answer different questions.** The founder's
lifecycle names them and an earlier version of this module had none of them:

| State | The question it answers |
|---|---|
| `ready_to_ship` | verified is not the same as ALLOWED to act. A Mission can be verified forever and never be permitted to commit |
| `deploying` | a deploy that never returns used to leave the record saying `merged` — indistinguishable from one never started. A record that cannot say "this is happening right now" cannot be read during the only minutes anyone needs it |
| `deployment_failed` | `decideShipped` returning false covers a stale build AND a deploy that never happened. Those need different actions |
| `rolled_back` | a fact about the running system that survives after the failure is repaired |

The deploy is authorized at the **request** (`deploying`), not at `deployed`.
`deployed` is an observation that it completed, and re-demanding the permission
there would mean a Mission whose grant expired mid-deploy could not record what
had already happened — the record would go quiet at the worst possible moment.

A terminal failure **outranks** the success it followed: a record that reached
`live_verified` and then rolled back is rolled back. `deriveShipStage` checks the
two failure states by name first, because the backwards walk over `SHIP_STAGES`
would otherwise report the earlier success — array order is not a ranking.

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

**Mutation discipline.** Every guard here has a probe that reverts it and a named
test that falls — the count lives in the commit messages, deliberately not here,
because a number in prose that no code derives drifts on the next commit and did:
this line said 33 while two later commits raised it. The tests are the record
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

1. **The remote provider EXISTS and has never touched GitHub.**
   `relay-bridge/github-remote-provider.ts` implements the port with an injected
   fetch and is proven offline: the credential goes into a header and appears in
   no return value, no error and no record; the provider's body is never
   surfaced, because it echoes the request, which carries the token; owner, repo,
   branch and PR reference are validated before they reach a URL; a merge is
   confirmed by READING IT BACK rather than by the merge call's own answer; and
   the observed branch tip is never defaulted from the expected one.

   The dangerous operations are **unreachable rather than refused**: the port has
   no `force` field, no method deletes a ref, and nothing can create a
   repository — which is the strongest form of "never silently create a public
   repository", since code that cannot create one cannot create a public one.
   `push` is a ref READ-BACK, not a git push, so the module that talks to GitHub
   cannot push and the module that can push holds no credential.

   **What has not happened:** a single real request. No credential exists in the
   development environment (verified, not assumed), so every behaviour is proven
   against a fake fetch. It is also NOT yet called by the mission engine — the
   lifecycle authorizes `pushed`/`pull_request_open`/`merged` and nothing invokes
   the provider at those stages.
2. **The paid three-role pipeline has not run against a real repository.**
   Everything proven above is the machinery the Architect, Coding Agent and
   Reviewer would hand their work to. Running them against a real repository
   needs provider credentials and founder authorization.
3. **WIRED. A Mission can target a real repository.** `reg.start()` takes a
   resolved `repositoryTarget` and the files the Mission declares it will write;
   `mission.ts` carries both to the coding leg, which resolves its source through
   `repository-source.ts`. Proven end to end in `orchestrator.test.ts` — the whole
   pipeline against a real `git init`, with the real coding leg (not the harness
   stub) creating a real isolated worktree — and in `coding-leg-offline.test.ts`.
   In both, the source repository is byte-for-byte unchanged and `git status` is
   clean afterwards, on the failure path as well as the success one.

   **What is NOT proven:** that the PAID roles have run this. The architect and
   the reviewer stay injected in those tests, because OpenAI and xAI calls are a
   founder authorization boundary. The pipeline carries the target and refuses
   when it should; whether Grok reviews a real repository's diff well is a
   different question and an unspent one.

   The Live Terminal's project label now follows the source — calling a founder's
   repository "the controlled fixture (throwaway repository)" would be a false
   claim about blast radius on the line they read to know what Relay is touching.

   Superseded text, kept because this document's corrections stay visible:
   nothing in the bridge's mission entry read a
   `MissionRepositoryTarget` yet. The controlled-fixture path is unchanged and
   remains the default and the test path, which the design document requires.
4. **The deployment provider EXISTS and really deploys — to a directory.**
   `relay-bridge/local-directory-deployment-provider.ts` is the first real
   implementation of `DeploymentProvider`, which until now had exactly one
   implementation and it was a fake inside a test. So `DEPLOY → LIVE VERIFY →
   SHIPPED` was a lifecycle Relay could reason about and had never performed.

   It is real in the way that matters: the artifact is genuinely copied, and
   `verifyLive` reads the RUNNING system over HTTP — not the disk `deploy` just
   wrote, because a probe that re-reads the deploy's own evidence proves the
   copy happened twice rather than that anything is serving it. The tests stand
   up an actual HTTP server and cover the failure this stage exists for: a
   deploy that succeeded while the system serves a different revision, which
   comes back `ok: true` from the deploy and `shipped: false` from
   `decideShipped`. `simulated` is FALSE and that is honest — nothing here
   pretends the deployment is somewhere it is not.

   **Staging only, in the type.** `environments` is `['staging']`, so
   `providerSupportsEnvironment` refuses production before the module is
   called — and the module refuses again itself, because a provider that is
   safe only when its caller remembers to ask is not safe. This is not a
   placeholder for a flag: a provider serving a directory on one machine has no
   business shipping to customers, and "never infer production authorization
   from build this" is a founder rule. A production provider is a separate
   implementation, separately authorized.

   **Now driven by `relay-bridge/ship-runner.ts`.** `grep shipStage relay-bridge`
   used to return nothing: the lifecycle could DECIDE every step and nothing
   ever asked it, so it was a set of rules with no subject. `runShipLifecycle`
   walks COMMIT -> DEPLOY -> LIVE VERIFY -> SHIPPED with real components — a real
   `git init`, a commit read back from git, a real artifact copy, a real HTTP
   probe — and stops at the first refusal, reporting the stage it REACHED.
   PUSH/PR/MERGE are deliberately absent: they need a remote credential, and a
   runner that skipped them and still said `shipped` is the failure it exists to
   prevent. Five of six mutations against it fail a
   named test; the sixth — echoing `deployedRevision` from the request instead
   of reading the marker back — is NOT distinguishable by any test here, because
   a write and a read inside one call cannot disagree on a working filesystem.
   That limit is recorded in the test file rather than left for someone to
   discover. The same mutation at `verifyLive`, where it IS observable, fails
   three tests.
5. **No durable store.** Registrations are built and read as values; nothing
   persists them across a restart yet. The store belongs beside the other
   durable stores in `src/relay/persistence`, on the same key/value backing.
6. **CORRECTION — the dry-run mode IS built.** This entry read "it does not
   exist because there is nothing to push with", and that was false when it was
   written or shortly after: `repository-dry-run.ts` exports `planDryRun` and
   `renderPullRequestBody`, both are in the barrel, and 19 tests cover them.
   `planDryRun` produces exactly what the design document asks for — the
   planned operations, each marked with the permission it would need and
   whether the Mission HOLDS it, plus the PR body — and performs nothing.

   The correction is left visible rather than quietly swapped, because the
   defect class matters more than the entry. This document's own header says
   "Read 'What is not built' before believing anything else here", so a stale
   line here is worse than a stale line anywhere else in the repository: it is
   the sentence a founder reads to decide what Relay can do, and it understated
   the product. Every other entry in this list was re-checked against the code
   at the same time — 1, 5 and 8 verified still true, 4 and 7 updated in the
   same pass.

   What is still missing is a CALLER: no bridge route or CLI action runs a dry
   run, so the capability exists and nothing offers it.
7. **The Project Brain feed is BUILT but has no producer.**
   `repository-brain-feed.ts` projects repository work into the **existing**
   Brain — `rememberShortTerm` and `proposePromotion` in
   `src/relay/shared/llmops/brain-memory.ts`, following the
   `evidence/evidence-brain-link.ts` precedent. It is not a second store. What
   **It now HAS a producer.** `relay-bridge/ship-brain-feed.ts` folds a
   `ShipRunResult` into short-term memory: every stage in the order it happened,
   the deploy observation kept SEPARATE from the stage line (so a run whose
   history reads `deployed` while the provider reported a different revision
   still records the disagreement), and the verdict — filed under `error` when
   it is not shipped, because a Brain fed only the runs that worked learns that
   everything works. It promotes NOTHING to long-term memory: a ship run is an
   episode, not a durable fact about a repository, and promotion goes through
   `proposeRepositoryKnowledge` and a human.
   See "The Project Brain feed" below.
8. **`gitlab` and `bitbucket`** are nameable in the domain and refused at
   selection by `repositoryProviderSupported`. Registered is not drivable, and
   the refusal happens at configuration rather than at the push step.
9. **Review-packet fidelity at real repository size is unproven.** The design
   document flags this as the highest-risk remaining item: three separate
   defects in the goal that produced it were display sanitizers truncating
   machine-read payloads, and a larger repository makes that class of bug far
   more likely and far more damaging.
