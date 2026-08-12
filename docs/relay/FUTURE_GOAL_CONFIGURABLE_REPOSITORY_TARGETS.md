# Configurable Repository Mission Targets — the design questions

**Status: PARTLY BUILT as of 2026-08-11.** This document is the reasoning and
the bar. What actually exists, and the things that do not, are in
`REPOSITORY_TARGETS.md` — read that for state and this for *why*.

Originally recorded 2026-08-11 with the status **NOT STARTED**, when the hosted
three-role Mission was proven end to end against Relay's controlled fixture and
the founder scoped that goal to objective variety, ruling this out of it. A
later goal authorized it. The header is corrected rather than left standing,
because a document whose status line is a year out of date is exactly the class
of defect this repository has repaired most often: a claim the code no longer
supports.

**Built:** §1 authorization, §2 read/write scope, §3 protected paths, §6
destructive-action controls, plus the observation layer and the shipping
lifecycle the founder's later goal added. **Not built:** §4 branch and
pull-request policy is *authorized* and performed by nothing — no remote
provider exists — and §5's credential handling is designed but has no client to
hold a credential.

**Three of the four preconditions** at the end of this document are not met. The
first — *the controlled-fixture path keeps working, unchanged* — **is** met: this
work touches no bridge file, and `REPOSITORY_TARGETS.md` says so itself. An
earlier draft of this paragraph said "neither of the four", which was wrong about
the first precondition and the wrong word for four items. See the "What is NOT
built" section of `REPOSITORY_TARGETS.md`, which lists them against real code.

### One place this document was overruled, deliberately

§4 says Relay may open a pull request and may **never** merge one, and that no
configuration flag should be able to grant it. The founder's later goal names
`MERGE PR` as one of eight explicit permissions. The resolution is recorded in
the open, in `repository-contracts.ts` and in `REPOSITORY_TARGETS.md`:
`merge_pr` exists because the founder asked for it, is never implied by
anything, is not reachable by escalation from `create_pr`, may only follow an
actually-open pull request, and is one of the two grants marked as never
inferable. **This document's reasoning survives as the bar, not as a veto.**

---

## What exists today, and why that is the whole problem

Every hosted Mission edits the same repository. `relay-bridge/coding.ts` calls
`buildSafeEditFixture()`, which creates a throwaway git repo in a temp
directory containing one implementation file, one test file, a `package.json`
and a `README.md`. The Coding Agent may touch exactly one claimed file. The
repo is discarded when the Mission ends.

That is not a limitation to be lifted casually. It is the reason every safety
property in Relay currently holds **by construction**:

| Property | Why it holds today |
|---|---|
| An agent cannot damage anything that matters | The repo is a temp directory nobody depends on |
| "Protected paths untouched" is checkable | The protected set is four known files |
| "Source worktree unchanged" is provable | Relay created the source seconds earlier |
| A bad diff costs nothing | Nothing is pushed, merged, or published |
| Credential blast radius is bounded | No repository credential exists at all |

Pointing a Mission at a real repository removes every one of those, and each
must be replaced by something deliberate. **This document exists so that
replacement is designed before it is built, not after an agent has write access
to something a founder cares about.**

---

## 1. Repository authorization

**The question:** which repositories may a Mission target, and who decided?

A repository must be *registered* before a Mission can name it, and
registration is a founder action — never an inference from a URL in an
objective, never a credential's implicit reach. A token that can see fifty
repositories does not authorize fifty targets.

Requirements:

- An explicit registry entry per repository: host, owner, name, default branch.
- Registration records **who** authorized it and **when**, as durable evidence.
- A Mission naming an unregistered repository is refused at the CONFIGURATION,
  by name, before any provider request — the same shape as
  `role_binding_refused` today.
- Removing a registration takes effect immediately, including for in-flight
  Missions. A revocation that only applies to future work is not a revocation.

**The failure this prevents:** an objective containing a plausible repository
URL causing Relay to clone and edit something nobody chose.

---

## 2. Read and write scope

**The question:** which paths may this Mission read, and which may it change?

Relay already has the right primitive: the **file claim**. The Coding Agent
declares what it changed, Relay compares that against what actually changed,
and a mismatch fails the Mission. That machinery does not need replacing — it
needs a scope to operate inside.

Requirements:

- Every registered repository carries a **write scope**: an explicit set of path
  globs the agent may modify. Empty means read-only, which must be a supported
  and useful mode.
- A **read scope**, separate and usually wider. Reading a file is not editing
  it, and an agent that cannot read the surrounding code writes worse patches.
- The scope is per-repository AND narrowable per-Mission. A Mission may ask for
  less than the repository allows; it may never ask for more.
- Relay verifies the resulting diff against the scope **after** the agent exits,
  from the worktree, exactly as it verifies file claims today. The agent's own
  account of what it touched is never the authority.

**The failure this prevents:** an agent asked to fix a test quietly editing CI
configuration, a lockfile, or another team's directory.

---

## 3. Protected paths

**The question:** what must never change, even inside the write scope?

Today's protected set is four fixture files. In a real repository the set is
both larger and more consequential, and some of it protects Relay from itself.

Requirements — protected by default, overridable only by explicit founder
configuration per repository:

- `.git/**` — always, unconditionally, no override.
- CI and automation: `.github/**`, any pipeline definition. An agent that can
  edit CI can disable the checks that would catch it.
- Dependency manifests and lockfiles, unless the Mission's whole purpose is a
  dependency change and the founder said so.
- Secrets and environment files: `.env*`, anything matching the credential
  patterns Relay already redacts.
- Relay's own configuration in the target repository, if any.

A protected-path violation must fail the Mission, not warn. Relay already
treats it that way and the behaviour must survive the change.

**The failure this prevents:** the agent disabling the verification that would
have caught its own mistake.

---

## 4. Branch and pull-request policy

**The question:** where does the work land, and who merges it?

Requirements:

- A Mission works on a **new branch**, created from a named base, never on the
  default branch. Committing directly to `main` must not be expressible.
- The base is recorded as a revision SHA at the start and verified unchanged at
  the end. A base that moved under the Mission invalidates the artifact digest,
  and the Reviewer reviewed a diff that no longer applies.
- Relay may **open** a pull request. Relay may never **merge** one. Merge is a
  human decision, and no configuration flag should be able to grant it — the
  same reasoning that keeps `RELAY_BRIDGE_CONFIRM_LIVE` explicit.
- Force-push is never available. Neither is branch deletion.
- The PR body carries the Mission's evidence: the attestations, the Reviewer's
  verdict and findings, the artifact digest, and what Relay verified itself. A
  reviewer on GitHub should see the same evidence Relay saw.

**The failure this prevents:** work merged on the strength of an agent's claim,
with no human in the path.

---

## 5. Credential boundaries

**The question:** what credential does this use, where does it live, and what
can it reach?

Requirements:

- The repository credential is **server-side only**, held by the bridge, never
  in a browser bundle and never in a mission record. Relay's existing rule.
- It is **never handed to the Coding Agent**. The agent works in a local
  worktree with no network and no git remote access; Relay performs every
  remote operation itself, after the agent exits. This is the single most
  important boundary in this document: an agent with a repository token has
  push access regardless of every other control here.
- Scoped as narrowly as the host allows — ideally per-repository, contents
  read/write plus pull-request write, and nothing else. No admin, no workflow
  scope, no organization access.
- Rotatable without redeploying, and revocation must stop in-flight Missions.
- Never logged, never surfaced in an error, never included in a review packet.
  `redactPayload` already exists for the payload paths and must cover any new
  one.

**The failure this prevents:** a prompt-injected agent using a token to reach
repositories the Mission was never authorized to touch.

---

## 6. Destructive-action controls

**The question:** what can this do that cannot be undone?

Requirements:

- **File deletion** is a distinct permission from file modification, off by
  default. "Change this file" and "remove this file" are different acts.
- **Mass-change ceilings**: a limit on files changed and lines removed per
  Mission. Exceeding it refuses rather than truncates — a diff that deletes
  four hundred files is not a fix that went slightly wrong.
- **History is immutable to Relay**: no rebase, no amend, no force-push, no tag
  deletion, no `git gc`. Relay adds commits; it never rewrites them.
- Nothing outside the repository: no package publishing, no deploys, no
  releases, no issue or comment writes beyond the single PR body.
- Every destructive-capable action is recorded as an execution attestation
  before it happens, so an audit shows intent, not only outcome.

**The failure this prevents:** an irreversible action taken faster than a human
can intervene.

---

## What must be true before any of this is built

1. **The controlled-fixture path keeps working, unchanged.** It is the only
   configuration where Relay's safety holds by construction, and it should stay
   the default and the test path.
2. **Every refusal above is testable offline**, with the same discipline the
   rest of Relay uses: a mutation probe that removes the guard must fail a named
   test.
3. **The Reviewer sees the real diff.** Three separate defects in the goal that
   produced this document were display sanitizers truncating machine-read
   payloads. A larger repository makes that class of bug far more likely and far
   more damaging — the review packet's fidelity must be proven at real
   repository sizes, not fixture sizes.
4. **A dry-run mode exists**: produce the branch and the PR body, push nothing.
   The first real repository Mission should be observable before it is
   consequential.

## What this document is not

It is not an implementation plan, and it deliberately names no schedule. It is
the set of questions that must have answers before Relay is allowed to write to
a repository a founder cares about. Building any part of it without the rest is
how an agent ends up with more reach than anyone decided to give it.
