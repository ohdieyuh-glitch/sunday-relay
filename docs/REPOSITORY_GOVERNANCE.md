# Repository Governance — Sunday Relay

Sunday Relay is an **independent product**. This document is the contract for
how work enters it.

---

## 1. Canonical repositories

| Product | Repository | Scope |
| --- | --- | --- |
| **Sunday Relay** | `ohdieyuh-glitch/sunday-relay` | Relay product work |
| **Sunday Alcatraz** (Fusion) | `ohdieyuh-glitch/turbo-broccoli` | Alcatraz/Fusion product work |

Both are Aquala Technologies products. Neither is a feature, branch, demo route
or subdirectory of the other.

- Relay's `origin` is `sunday-relay`. It is never `turbo-broccoli`.
- Alcatraz's `origin` stays `turbo-broccoli` and is not modified by Relay work.
- No Relay branch is pushed to `turbo-broccoli`.
- No Alcatraz branch is pushed to `sunday-relay`.

### Product purity

| Repository | Accepts | Rejects |
| --- | --- | --- |
| `sunday-relay` | Relay product work | Alcatraz/Fusion implementation |
| `turbo-broccoli` | Alcatraz/Fusion work | Relay feature implementation |

Either repository may contain **typed integration contracts** for the other,
but only when unavoidable and only after review. Implementation never crosses.

`src/relay/relay-boundary.test.ts` and `src/relay/relay-core-boundary.test.ts`
enforce the Relay side of this in CI: Relay must not import the Alcatraz
engine, server, session store or UI, and must not import another product's
stylesheet.

---

## 2. Migration history

Relay was built inside the Alcatraz repository as a set of git worktrees
sharing `turbo-broccoli/.git`. It became independent on **2026-07-29**.

- 40 Relay commits across four lineages were extracted with **relay-only
  trees** — every replayed commit's tree was asserted equal to the relay
  subset of its original tree. No Alcatraz file appears in any commit of this
  repository.
- The lineages are preserved as `relay/history-cli`, `relay/history-web`,
  `relay/history-app-home-v2` and `relay/history-landing-onboarding`.
- `main` merges the CLI and website lineages and then establishes the
  standalone product identity.
- Work that existed only in the worktrees' *working trees* (never committed)
  is preserved on `relay/integration-worktree-state`.
- Nothing was force-pushed. No Alcatraz history was rewritten. The Alcatraz
  repository and its worktrees were read only.

Relay source has never existed on Alcatraz `main`, and no Relay branch was
ever pushed to the Alcatraz remote, so no Alcatraz removal PR is required.

---

## 3. Branch policy

All Relay branches live in this repository and use the `relay/*` namespace:

```
relay/mission-economics          relay/claude-adapter
relay/mission-operations-interface   relay/hermes-adapter
relay/psp-runtime                relay/founder-alpha
relay/beta-hardening             relay/fix-<description>
relay/docs-<description>
```

The `feature/relay-*` names from the pre-separation period are retained only on
the preserved history branches. Never use `fusion/*`, `alcatraz/*` or
`sunday-alcatraz/*` for Relay work.

---

## 4. Pull request policy

Every material Relay milestone gets its own PR **against `main` in this
repository**. Relay changes never open PRs against `turbo-broccoli`.

Each PR uses `.github/PULL_REQUEST_TEMPLATE.md` and must disclose: milestone
purpose, base and head SHAs, files changed, website impact, CLI impact,
website/CLI parity impact, Mission Operations impact, tests, typechecks,
builds, security review, external calls, migrations, environment changes,
deployment changes, independent review, unresolved findings, and rollback.

A PR stays open until tests pass, parity passes, required independent review
completes, and blocking findings are repaired.

---

## 5. Merge policy

**Squash merge only.** Merge commits and rebase merges are disabled on the
repository. Each merged milestone becomes one clear commit on `main`.

```bash
gh pr merge <PR_NUMBER> --repo ohdieyuh-glitch/sunday-relay --squash
```

### Founder merge gate

**Green is not authorization.** No Relay PR is merged without explicit founder
authorization, and auto-merge is off by default. A prior approval does not
carry to a later PR.

After a squash merge: record the resulting `main` SHA, verify remote `main`,
verify CI, keep the source branch until post-merge verification completes, and
do **not** deploy unless deployment was separately authorized.

---

## 6. Repository settings

| Setting | Required | Status |
| --- | --- | --- |
| Default branch `main` | yes | applied |
| Squash merging | enabled | applied |
| Merge commits | disabled | applied |
| Rebase merging | disabled | applied |
| Auto-merge | off | applied |
| Delete branch on merge | off | applied |
| Force-push to `main` blocked | yes | **not applied** |
| Deletion of `main` blocked | yes | **not applied** |
| Direct pushes to `main` prohibited | yes | **not applied** |
| Required status checks on `main` | yes | **not applied** |

Branch protection and repository rulesets are **unavailable on this
repository's current plan**. Both the classic protection API and the rulesets
API return:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

**Founder action required** — either upgrade the account to GitHub Pro/Team, or
make `sunday-relay` public. Then apply protection on `main`: block force
pushes, block deletion, require a pull request, and require the Relay CI checks.
Until then the protections above are policy in this document only, not enforced
by the platform.

---

## 7. Website / CLI relationship

Relay has two surfaces over one core: the website/application and the terminal
CLI. They share the Mission Operations domains, status model, commands,
Execution Capsules, Trace Ledger, economics, PSP models and the official Relay
Dog.

Parity is a **requirement, not an aspiration**. `npm run
relay:surface-parity:check` verifies the capability registry; a PR that changes
one surface must state its effect on the other.

---

## 8. CI separation

Relay CI (`.github/workflows/relay-ci.yml`) is independent of Alcatraz CI. It
runs typecheck, the test suite, the website build, the CLI build, a secret
scan and a repository-boundary scan.

Relay CI **never deploys**, and never triggers an Alcatraz Railway or Vercel
deployment. Alcatraz workflows are not reused here.

---

## 9. Deployment separation

Relay will have its own deployment, separate from Alcatraz in every dimension:

| | Alcatraz | Relay |
| --- | --- | --- |
| Frontend project | existing | separate, to be created |
| Backend service | existing | separate, to be created |
| Domain | existing | separate domain/subdomain |
| Environment scope | existing | separate |
| Provider credentials | its own | its own |
| Production logs | its own | its own |
| Spend policy | its own | its own |

**No Relay deployment exists yet.** Nothing was deployed, no DNS was changed
and no environment variable was set during the repository separation.

---

## 10. Secrets separation

- Alcatraz secrets are **never** copied into Relay. None were.
- Relay uses its own environment scope and its own provider credentials.
- Relay's local execution uses native provider auth held by the local bridge.
  No provider key is ever read in the browser bundle or committed here.
- CI runs a secret scan on every PR.

---

## 11. Cross-product integration rules

Allowed:

- typed integration contracts, reviewed, with no implementation attached
- documentation that references the other product by name
- shared design-token *values* where both products are deliberately aligned

Forbidden:

- importing the other product's engine, server, session store, UI or stylesheet
- copying the other product's migrations, deployment config or secrets
- opening a PR for one product against the other's repository
- rewriting the other product's history
- a CI workflow in one repository that deploys the other

---

## 12. Emergency exceptions

An exception requires: explicit founder authorization recorded in the PR, a
written statement of what rule is being suspended and why, a rollback plan, and
a follow-up issue to restore the rule. Emergencies never justify force-pushing
`main`, rewriting history, copying secrets across products, or deploying
without separate authorization.

---

## 13. Julius provenance, and the accepted-main trust root

Julius executes the code on `main`. Three gates establish that the code it runs
is the code somebody approved, and they answer different questions:

| Gate | Question |
| --- | --- |
| `npm run julius:review-currency -- <owner/repo> <pr>` | is this pull request approved at its exact head? |
| `npm run julius:main-provenance -- <owner/repo>` | is the tree on `main` the tree of an approved worker candidate? |
| `npm run julius:main-monotonicity -- <owner/repo>` | has `main` only ever moved forward from an accepted checkpoint? |

The first two read GitHub records alone. The third needs a record of what was
accepted before, and where that record lives is the whole of this section.

### 13.0 Why workflow files are founder-controlled at all

Workflows are where this repository's security controls run: the writer that
records an accepted-main checkpoint, and the paid-mission workflow that spends
money. They must be beyond the reach of the identity they police, and they are,
for a reason that is a fact about GitHub rather than a convention: **the coding
worker cannot write workflow files at all.** A push touching
`.github/workflows/**` from a GitHub App without the `workflows` permission is
refused by the server, and `julius-worker[bot]` does not have that permission.
It also cannot dispatch a workflow (`actions: read`), cannot upload an artifact
by any REST route, and cannot delete one.

`julius-worker[bot]` must never be granted `Workflows: Write`. It would hand the
worker the ability to rewrite both this writer and the paid-mission workflow,
and every guarantee in this section rests on it not having that.

The refusal is not theoretical. Attempting to land the writer as part of an
ordinary worker-authored pull request was rejected by the server:

```
! [remote rejected] refusing to allow a GitHub App to create or update
  workflow `.github/workflows/julius-accept-main.yml` without `workflows` permission
```

### 13.1 The one-time accepted-main trust-root bootstrap

The writer cannot be introduced by the ordinary route, because the ordinary
route requires a worker-authored pull request and the worker cannot author
changes to workflow files. Someone with `workflows` authority has to place the
first copy. That is the founder, once, as a deliberate administrative act.

This is a bootstrap in the strict sense: it is the step that establishes the
trust root, and it cannot be performed by the mechanism it establishes.

It happened once, in commit `1c8a63add32c685a4d1983691d4f98281199ac2a`, which
touches `.github/workflows/julius-accept-main.yml` and nothing else. That commit
is the bootstrap; it is not a precedent for anything but itself, and later
workflow changes are governed by 13.2 rather than by it.

The content was published with its digest before installation and verified
byte-for-byte afterwards
(`sha256:8de58423dca8487f3ea9e1f093a7e1f976375797daf89d1dfbb4d12eded615b5`), so
what landed is what was reviewed even though no pull request carried it. That is
the ceremony in 13.2 applied to its own first instance.

### 13.2 Founder-controlled workflow administration

The bootstrap above happened once. The *reason* it had to happen does not go
away with it: the worker still cannot write `.github/workflows/**`, so every
future change there — amending the accepted-main writer, wiring the live
preflight into `julius-first-live-mission.yml`, anything else under that
directory — must also be installed by the founder.

This is a standing arrangement, not a repeated exception, and it exists for
exactly one reason: **no other identity is structurally able to make the
change.** It is permitted because it is unavoidable, and it is bounded by the
ceremony below rather than by anyone's restraint.

An earlier draft of this section said the exception was "exactly one file". That
was wrong, and the way it was wrong is worth recording: it read as though only
`julius-accept-main.yml` could ever be founder-installed, which is false, and it
invited the opposite reading later — that a founder-authored commit is a normal
tool once precedent exists. Neither is the rule. The bootstrap was one specific
installation; workflow administration is a permanent, narrow, ceremonied power
over one directory.

#### The ceremony, required for every founder-installed workflow change

Each step exists because skipping it turns "the founder had to install this"
into "the founder installed something".

1. **Identify the exact file or files** under `.github/workflows/**` beforehand.
   A change of unstated scope is not reviewable.
2. **Publish the final content** before installation, in full.
3. **Publish its SHA-256 digest** before installation.
4. **The founder installs exactly those bytes.** Nothing edited in passing, and
   nothing else in the same commit.
5. **Verify the digest after installation.** What landed must be what was
   published, and the verification is recorded.
6. **Expect `main` to become `unprovenanced`.** A founder-authored tip is not
   the merge result of an approved worker candidate, and the gate will say so.
7. **No paid or live execution while unprovenanced.** The block is the point;
   it is never suspended to get a run through.
8. **Open a fresh worker-authored restoration pull request** from that exact new
   `main`. Not a rebase of something older — from the commit that landed.
9. **Founder approves it at the exact head sha**, under the ordinary rules.
10. **Merging restores provenance**, because the gate asks about the commit
    `main` carries rather than about history.
11. **This never applies to ordinary source code.** See below.
12. **The worker is never granted `Workflows: Write`.** Granting it would make
    every step above pointless, because the constraint the ceremony compensates
    for would no longer exist.

#### It never extends to ordinary source

A founder-authored change to anything outside `.github/workflows/**` inherits
none of this. The justification is structural impossibility, and it does not
apply: the worker *can* write source, so a founder writing it instead is a
choice, and the choice bypasses the reviewer model by making the author and the
approver the same person. It would also leave `main` unprovenanced with no
bootstrap and no ceremony to account for it.

Source changes go through the worker and are approved by the founder at an exact
sha. There is no version of this section that permits otherwise.

### 13.3 Why `main` temporarily becomes unprovenanced

`julius:main-provenance` requires the commit on `main` to be the merge result of
a **worker-authored** pull request approved at an exact sha. A founder-authored
installation commit satisfies none of that, so immediately after the install the
gate reports `unprovenanced` and blocks.

That is the gate working. It is not suppressed, not exempted, and not worked
around. Live execution is correctly unavailable for as long as the condition
holds.

### 13.4 Why a subsequent worker-authored PR restores it

The gate asks about the commit `main` currently carries, not about history. Once
an ordinary worker-authored, exact-sha-approved pull request merges, the tip is
again the merge result of an approved candidate and `julius:main-provenance`
returns `provenant`. Nothing needs to be repaired; the next normal change is the
repair.

Only after that may the writer be dispatched, because it refuses to record a
checkpoint for a commit that is not `provenant`. Recording one for an unreviewed
commit would launder it into the trusted history and make it the floor every
later run compares against.

### 13.5 Checkpoint retention and renewal

Checkpoints are Actions artifacts, and artifacts expire. Ninety days is the
ceiling this plan allows, so retention cannot be raised to avoid the problem.

The guard is not weakened to tolerate expiry. An expired checkpoint is not
authority, and if every checkpoint expires `julius:main-monotonicity` answers
`uninitialized` and blocks. That is a lockout of live execution, and it is the
correct failure: a rollback guard with no record of what was accepted is not a
guard.

Renewal is therefore an operational obligation. **Dispatch `Julius accept main`
at the current `main` at least every 60 days**, which leaves 30 days of margin.
Any dispatch renews, because each records a fresh checkpoint, and older ones
ageing out costs nothing while a live one remains. A lapse needs no exception to
recover from: dispatch once at the current `main`.

### 13.6 Recovering from an intentional rollback

1. Move `main` to the intended commit.
2. Delete the `julius-accepted-main-<sha>` artifacts no longer contained in it.
3. Dispatch `Julius accept main` at the intended commit.

Step 2 needs `actions: write`, which neither the worker nor the writer workflow
holds. Lowering the floor is an act by a person and leaves a trail in the
Actions UI.
