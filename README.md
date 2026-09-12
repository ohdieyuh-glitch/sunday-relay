# Julius 3.3

**i.Wonder's Compound AI Agent — built to research, create, verify, repair and
ship real software, and to live inside Wonderland.**

Julius 3.3 is the Compound AI Agent developed by i.Wonder Laboratories, Inc.

Rather than treating AI engineering as a collection of independent chat agents,
Julius operates one governed Mission Contract through three persistent peer
intelligence workers:

```
Prompt Architect  →  Coding Agent  →  Independent Reviewer
        ↖___________ all three, all mission long ___________↗
```

> **Read the status tiers before believing anything below.** Every capability in
> this README is marked **PROVEN**, **PRIVATE BETA** or **ROADMAP**, and
> section 11 is the full ledger. If a claim here and the code disagree, the code
> is right and the claim is a defect. Three paid missions have reached verified
> completion. More paid attempts have failed than have succeeded, and each
> failure is recorded by run id and by what it stopped on.

---

## 1. What Julius 3.3 is

Julius is one Compound AI Agent, not an orchestration framework and not a
workflow engine. A participant states an objective — *build this*, *fix this
repository*, *ship this* — and Julius runs it as a **Mission**: it drafts a
Mission Contract, locks it, staffs three persistent workers against it,
supervises them throughout, verifies their work against evidence rather than
against their claims, routes repairs for what verification rejects, and only
then decides the mission is complete.

Julius retains, and never delegates:

| Julius owns | Meaning |
|---|---|
| Mission authority | one mission, one authority, one terminal decision |
| Mission Contract authority | who may change the contract, and when it locks |
| Project Brain | the durable project intelligence a mission reads and writes |
| Orchestration and scheduling | which worker is asked what, and when |
| Permissions and budgets | what each worker may reach, and what it may spend |
| Research policy | the only door through which any worker reaches outside |
| Conflict resolution and synthesis | whose evidence wins, and why |
| Repair routing | what a rejected result becomes |
| Verification | whether the evidence supports the claim |
| Terminal completion authority | **only Julius completes a mission** |

The workers supply intelligence. Julius supplies government. A worker that
returns `BLOCK` has not stopped a run — it has told Julius what it found, and
Julius stops the run.

**Completion is earned, not claimed.**

## 2. The three persistent workers — PROVEN

Three peer-grade intelligence workers, not thin disposable sub-agents. Each may
reason seriously, investigate the repository, use tools, request governed
research, produce evidence and carry substantial mission work, according to its
role.

| Worker | Role |
|---|---|
| **Prompt Architect** | continuous mission intelligence: requirements, investigation, contract drafting, and guidance that continues after the contract locks |
| **Coding Agent** | implementation, debugging, testing, repository work and technical investigation |
| **Independent Reviewer** | continuous adversarial verification of the implementation, the evidence, *and the Architect's guidance* |

Three properties make this more than a diagram:

- **The Reviewer is independent and may never judge its own work.** It reviews
  six stages, including the Architect's guidance under its own rubric.
  Adversarial verdicts must cite evidence that exists in the same run.
- **No slot gets a stronger door than another.** One research mechanism, one
  policy, one observation shape for all three. A coder with a shell and an
  architect reduced to a prompt generator is not three intelligences; it is one
  agent with two commentators.
- **Requested and served are separate facts.** The model that answered is
  attested from the provider's own usage record, never from what was configured,
  and reports `Unknown` rather than guessing.

Three paid missions have run all three workers end to end — three different
vendors staffing the three slots — and reached verified completion. What those
runs did *not* yet exercise is the continuous participation described in
section 5.

## 3. Mission Contracts — PROVEN

The **Mission Contract** is the governed object defining the active mission: its
objective, requirements, constraints, files and systems in and out of scope,
acceptance criteria, required evidence, required reviewers, repair and review
ceilings, spend and runtime bounds, completion rule, and authority.

- A **binding digest** is a stable, order-independent hash of the binding fields
  only. A binding change increments the revision and changes the digest;
  display-only changes do not.
- The contract is **proposed, revised, and locked by an independent evaluator** —
  not by the worker that drafted it.
- Every dispatch is bound to the exact revision it runs under, so work can always
  be dated against the contract it was performed beneath.
- A handoff pinned to an older binding digest is **stale and cannot launch**.

Proven on a paid run: a contract reaching locked revision 2 with one binding
digest, read back identically from two independent durable tables — and, on a
later paid run, reaching revision 5 through three repair rounds.

## 4. Project Brain — PROVEN (writes), PRIVATE BETA (read-back)

**Project Brain is durable project intelligence, not a transcript store.** It
holds evidence-backed context, decisions, repairs, requirements, provenance and
reusable project knowledge — what a repository *is*, how it is built and
verified, what was deployed, what failed, and which repairs were actually
re-verified.

- Brain writes carry a typed kind and task/worker/evidence provenance, and a
  unique run revision, so a stale concurrent writer cannot overwrite shared
  memory.
- Context handed to a worker is **selected by role and task**, bounded by a
  character budget, redacted, and excludes anything marked `SECRET`.
- Episodes become short-term observations. Durable facts become **promotion
  proposals a human approves** — never long-term entries written directly. One
  run tells you what happened once; it does not establish how a repository works.
- A verdict that says **not shipped** is recorded too. A Brain fed only the runs
  that worked learns that everything works.

Proven on a paid run: durable decision entries authored by the run's own
evaluator. No shipped surface reads a record back yet.

## 5. The continuous worker lifecycle — PRIVATE BETA

The architecture is **not** Architect → Coder → Reviewer, once.

All three workers participate throughout a mission, and participation is
expressed **in tasks** rather than beside them — so it inherits the lease, the
attempt, the contract gate, evidence, review, repair and recovery that Julius
already owns. There is no second channel beside the task graph, and no
undocumented side channel into a running worker.

- The **Architect is callable after LOCK** without the contract moving. Its
  guidance is bound to the exact contract revision it was written under and is
  structurally unable to carry a contract field.
- The **Reviewer sees the plan, the guidance and the build within one mission**
  instead of the final output alone, and can force a repair or a halt during
  execution — through Julius, never around it.
- A failed guidance task, or a failed review of guidance, leaves the mission
  **incomplete** rather than proceeding as if advised.

**Status.** The live composition registers the Architect for `guidance` and
`repair:guidance` and the Reviewer for all six review stages, and the whole path
is exercised by end-to-end proofs — including one that checks the *order* of real
dispatches, so a run that merely phased plan/build/review fails it. **No paid
mission has exercised it.** One gap is known and recorded rather than hidden:
the guidance packet is not yet compiled into the Coding Agent's dispatch
context, so how much guidance a coder actually consumed reads as *unknown* —
never as zero.

## 6. Causal checkpoints and barriers — PRIVATE BETA

A **checkpoint** is a durable, typed record that something worth a decision
happened. Julius records it; a worker never does. The triggers are a closed,
event-driven set — `CONTRACT_DRAFTED`, `CONTRACT_REVISION_PROPOSED`,
`GUIDANCE_REQUESTED`, `IMPLEMENTATION_MILESTONE`, `SUBSYSTEM_DISCOVERED`,
`TEST_FAILED`, `MATERIAL_EVIDENCE`, `SECURITY_SENSITIVE_CHANGE`,
`REPAIR_ROUND_ENTERED`, `PRE_COMPLETION_VERIFICATION`, `RESEARCH_REQUESTED`.
There is no timer, no token count and no polling: a cadence measured in ticks
asks when nothing happened and stays silent through the turn that mattered.

A checkpoint that merely *asks* is not supervision. The ability to ask arrived
before the ability to **wait**, and guidance written in response reached a worker
that had already stopped — continuous supervision that was really post-hoc
recording, with every proof of the ask passing while the property nobody had
stated was false.

**The fix is causal, and structural.** A unit of Coding Agent work is a
**segment**, and a segment that ends at a barrier ends the dispatch. Segment N+1
is a task that *does not exist* until Julius has recorded the required
participation. Nothing has to trust a model to stop, because the continuation it
would need has not been created.

A yield is a barrier only when something is genuinely required at it. The barrier
routes are `REQUEST_GUIDANCE`, `REQUEST_REVIEW`, `REQUIRE_REPAIR`,
`REQUIRE_CONTRACT_REVISION`, `SERVE_RESEARCH` and `HALT`; `CONTINUE` and
`WARNING` are not barriers, because ending a dispatch there would cost a round
trip and buy nothing.

Segments are counted separately from repairs, deliberately: a repair means the
work was **rejected**, a segment boundary means no such thing, and a mission that
yielded three times for guidance must not exhaust a repair ceiling nothing had
failed against.

## 7. Governed research — PRIVATE BETA (built, and closed)

Julius's workers cannot reach the network. They can ask Julius to go and look.

```
worker ask → Julius authorization → mission source/host allowlist →
per-slot retrieval budget → SSRF-checked retrieval → redaction →
injection detection → evidence → bounded observation on the
requesting worker's continuation
```

- **A research ask is a barrier.** The worker's dispatch *ends* at the ask;
  Julius retrieves; the continuation carries the observation. An answer arriving
  after the code was written would be a citation, not research.
- **The allowlist is mission authority, structurally.** A request has no field
  that could carry one; retrieved content has no path back into a policy; a
  sealed policy is frozen and fingerprinted, and one the mission did not seal is
  refused as `policy_tampered`. There is no `allowHost`, no `addSource` and no
  `widen*` verb in the module's surface.
- **Eight distinguishable outcomes**, never collapsed into "no evidence":
  `observed`, `injection_signaled`, `policy_refused`, `budget_exhausted`,
  `unreachable`, `unauthenticated`, `throttled`, `unsupported_content`.
- **`injection_signaled` is a success, not a failure.** The observation is kept
  so a Reviewer can see that hostile text was present; what is refused is its
  power to tip a disagreement.
- **Disagreement is settled by evidence, not rank** — authority, then
  corroboration, then publication recency. Who brought a fact is recorded and
  never read, pinned by resolving the same pair under all nine role
  permutations.

**Status.** The door is built, governed and **closed**. Every mission is composed
with research unauthorized: empty allowlist, no slot authorized, budget zero, and
an ask refused before a socket can exist. Opening it for a mission is an act of
mission authority, not a code change. The research ledger is durable, but the
window inside a single retrieval call is not covered — stated in a test so nobody
discovers it from a bill.

## 8. Verification, evidence and repair — PROVEN

Verification is a **separate, Julius-owned phase**. Acceptance criteria map to
normalized evidence types; reviewer findings must cite evidence that exists in
the same run; open blocking findings request repair; missing evidence halts.

**Reviewer approval alone never completes a run.** Completion is valid only when
Julius is verifying, every task is successful or explicitly skipped, and every
required verification decision is `ACCEPT`.

A repair is a real, bounded, parent-linked task:

- it **inherits its subject's role and stage** — `repair:plan` on the Prompt
  Architect, `repair:build` on the Coding Agent, never `repair:repair:*`;
- it is **proven routable before it is created**, and refused otherwise;
- it is scheduled only after a resource reservation exists, and it records the
  original task, the finding, the evidence, and the round;
- replayed scheduling is idempotent; cancelled and terminal runs refuse new
  repair work.

Money is governed the same way. An unknown settlement **is not a refund**: the
hold is converted rather than released, so a slot whose provider goes silent is
charged what it reserved — over-charging the mission's own accounting and never
under-charging it. Every grant is bounded by what the *mission* has left, after a
ceiling test found a 67% overspend hiding in a per-slot view of a shared dollar.

Proven on paid runs: three repair rounds ending `REPAIR / REPAIR / REPAIR /
ACCEPT`, and failure recovery established by mission evidence rather than by
drill alone.

## 9. Repository and software execution — PROVEN

Julius operates on **real repositories**, safely, through a first-class target:
explicit provider and repository identity, owner, baseline SHA, base and working
branch, read/write scope, protected paths, provenance, credential boundary and
authorization.

- **Eight permission grades, no escalation:** `read`, `write_worktree`,
  `commit`, `push_feature_branch`, `create_pr`, `merge_pr`, `deploy_staging`,
  `deploy_production`. **Production authorization is never inferred from
  "build this."**
- **Isolated worktrees.** The agent never edits the source checkout, and the
  execution sandbox runs with no network.
- **Julius reads git, not the agent.** Renames are counted as deletions, symlink
  escapes are refused, and the write surface is an allow-list.
- **A mission may narrow its scope and never widen it**, and revocation lands
  mid-mission because the registration is re-read before every consequential
  step.
- `COMMIT → DEPLOY → LIVE VERIFY → SHIPPED` is performed end to end against a
  real repository, a real artifact copy and a real HTTP read-back. *Deployed* and
  *shipped* are deliberately different facts: a deploy that succeeds while the
  running system serves a different revision comes back deployed and **not**
  shipped.

**Not yet real, and precisely so:** the **Julius repository-target provider has
not yet performed a real customer-repository push, pull-request creation or
merge**. It is written, proven offline against an injected fetch, and invoked by
the runner — but no mission has driven it against a live remote.

That is a statement about the mission path, not about this repository. Changes
here *do* land through real pull requests, opened by the worker App and approved
by a human at an exact head; that is the provenance ceremony in section 15, and
it is a different mechanism from a mission spending a repository-target grant.

`merge_pr` is never implied: a mission holding `create_pr` and not `merge_pr`
stops with its pull request open, and that is the complete outcome.

## 10. Wonderland — ROADMAP (world), PRIVATE BETA (contracts)

**Wonderland is i.Wonder's multiplayer open-world AI creation platform** — a
persistent world where people build, collaborate, explore, compete and create
with Compound AI Agents.

Julius powers the mission intelligence and execution. The world systems represent
that work and let people interact with it. Wonderland holds no engineering truth
of its own: the only outbound request type from the world stamps its authority
field to a constant meaning *Julius decides*, and no struct on either side of the
seam has a field that could express "the world approved this."

**What exists:** a versioned pure-domain world projection in TypeScript, mirrored
C++ structs and enums, and a bidirectional parity gate that reads the real
headers as text and fails on drift in either direction; project-to-entity forms
gated on verified mission evidence; and a small mounted bridge surface for
presence, challenges and events.

**What does not exist, stated plainly:** the C++ **has never been compiled,
linked, loaded or run**. There is no level, no geometry, no materials, no
animation rig, no transport serving the world snapshot, and no rendered frame of
any kind. **Nothing in this repository is a playable game.**

Three world concepts are **designed and not built** — nothing in this repository
implements them, and they are recorded here so the direction is legible, not so
it can be mistaken for a feature list:

| Concept | What it is |
|---|---|
| **Mission Contract Orb** | a stationary world manifestation and status object for an active Mission Contract |
| **Mission / Project Carry-On** | a rideable, summonable world entity that carries access to an active Mission Contract or Project Avatar while the user moves and explores |
| **Project Avatar** | an optional persistent organizational identity for recurring related work — **not** created automatically for every mission |

Of the three, only Project Avatar exists as code at all: a stage and progression
model in TypeScript, exercised by tests, **never rendered and not persisted**.

## 11. Status ledger

Assigned from evidence on trusted `main`, not from intention.

### PROVEN

- **Three paid Julius missions reached verified completion** against real
  providers, with three different vendors staffing the three slots. More paid
  attempts have failed than have succeeded — on a refused plan, an unparseable
  or unauthenticated review, a reviewer timeout, a coder refusal and a coder
  cost ceiling — and each failure is recorded by run id and by what it stopped
  on.
- The **Task Contract lifecycle**: propose → revise → lock by an independent
  evaluator → one binding digest carried by every dispatch, read back identically
  from two independent durable tables on a paid run.
- The **repair loop on a paid run** — three rounds, `REPAIR / REPAIR / REPAIR /
  ACCEPT`, the contract reaching revision 5.
- **Failure recovery** established by mission evidence on a paid run, not only by
  drill.
- **Durable Project Brain writes** authored by the run's own evaluator.
- The runtime against **real PostgreSQL and Docker**, not only against the
  deterministic model.
- **Repository Targets**: the authorization spine, isolated worktrees,
  git-observed diffs, protected paths, change ceilings and mid-mission
  revocation.
- `COMMIT → DEPLOY → LIVE VERIFY → SHIPPED` against a real repository, a real
  artifact and a real HTTP probe.
- **Served model attested from the provider's own response**, reporting `Unknown`
  rather than guessing; unknown cost reported as unknown, never as zero.

### PRIVATE BETA

- **The continuous worker lifecycle** — registered in the live composition and
  proven end to end, including dispatch *ordering*; never exercised on a paid
  mission.
- **Governed research** — one mechanism, three peer slots, mission-sealed
  allowlist; built and deliberately closed, with no mission authorized.
- **Missions against real repository source**, materialized byte-identically from
  a trusted commit. The resulting diff applies cleanly; it has never been pushed,
  proposed or merged.
- **Mission-driven remote GitHub operations** — the repository-target
  provider's push, PR and merge are wired and proven offline; **no mission has
  yet driven them against a real customer repository**. (This repository's own
  worker-App pull requests are the provenance ceremony, not this path.)
- **C.A.R.D.** — one configuration record per Compound Agent, with minted
  identity, a revision that advances only on a real change, and
  claim-by-participant. It is authoritative for the product and **lives in the
  participant's browser today**; a server-side copy, so the record survives more
  than a redirect, is the next stage.
- **Project Brain read-back** — the producer, store and call exist; no shipped
  surface reads a record back.

### ROADMAP

- **Wonderland as a playable world** — compile, level, rig, transport, rendering.
  None of it exists.
- **Reviewer catching power.** The Reviewer has approved work that was genuinely
  right. It has never had a real defect in front of it, and *"the reviewer
  agreed"* is a strictly weaker claim than *"the reviewer caught something
  wrong."*
- **The contract challenge leg** — implemented after a paid run showed silence
  being read as agreement; never exercised on a paid run since.
- **Julius landing its own work** on a trusted branch.
- **A durable registration store** — repository registrations are values today,
  so a restart loses them.
- **Mission Contract Orb and Mission / Project Carry-On** — designed only.

**Nothing above is production ready**, and no line of it should be read as a
feature list.

## 12. Architecture and source map

Julius's domain is pure: no Node, no network and no clock — time is an injected
ISO string — so the browser, the CLI and the bridge read the same record and
reach the same conclusions, and none of the three can widen them.

```
src/relay/mission          pure domain — contracts, projections, no Node, no clock
src/relay/shared           the browser-safe seam every surface reads
src/relay/connectors       provider and harness adapters
src/relay/workspace        Node — isolated worktrees, real git observation
src/relay/persistence      durable state: journal, snapshots, locks, recovery
src/relay/cli              the terminal surface
src/relay/ui               the website; consumes the domain, never the reverse
relay-bridge               the hosted bridge: mission entry, providers, execution
docs/relay                 the authoritative specification set
```

> **`relay` in those paths is a legacy implementation namespace**, retained for
> compatibility and provenance. It is the directory layout, the package scripts,
> the CLI binary name, the `relay/*` branch namespace and the repository's own
> name — not the product. Renaming them is a separate, dedicated migration and is
> deliberately not folded into a documentation change. Julius is the Compound AI
> Agent; Wonderland is the platform; nothing here is named "Relay" as a product.

The boundaries are structurally tested, not merely documented: the browser can
never reach persistence, the workspace, the CLI or a provider SDK; adapters may
not import the mission domain, because adapters cannot own mission verdicts; and
the UI is a consumer that nothing outside it may import.

Julius's own production file set and wiring are exported to
[`JULIUS_HARNESS_MANIFEST.md`](JULIUS_HARNESS_MANIFEST.md) by a generator whose
test fails when the manifest goes stale.

## 13. Getting started

```bash
npm install

npm run dev                  # the web surface (http://localhost:5173/)
npm run relay                # the CLI (legacy command name)
npm test                     # the full suite
npm run typecheck            # application + bridge
npm run build                # production build
```

The documentation writes CLI commands as `relay <command>`. That invocation is
real: `package.json` maps the `relay` bin to the built CLI, so after
`npm run relay:build` (which `npm run relay` does for you) `npx relay …` works,
as does `relay …` once the package is linked. Without a build, use
`npm run relay -- <command>`.

Offline, no-cost demonstrations — no provider is contacted and no file is
changed:

```bash
npm run relay:cli:demo       # the CLI product demo
npm run relay:cli:demo:plain # the same walkthrough, plain text
npm run relay:cli:contract-verify
```

Verification drills, all offline:

```bash
npm run relay:persistence:contract-verify
npm run relay:persistence:recovery-drill
npm run relay:workspace:verify
npm run relay:claude:contract-verify
```

Commands that reach a real provider are opt-in and require an explicit
`--confirm-live` flag. Nothing in the default test, build or demo path dispatches
to a provider, and no provider credential exists in this checkout.

## 14. Documentation

`docs/relay/` is the authoritative specification set. Its directory name is part
of the legacy implementation namespace described above.

| Document | What it settles |
| --- | --- |
| [`docs/relay/JULIUS_RUNTIME.md`](docs/relay/JULIUS_RUNTIME.md) | the Julius runtime: ownership, safety boundaries, and a capability table that separates domain, persistence, wiring, concurrency and recovery |
| [`docs/relay/ADR-021-CONTINUOUS-WORKER-LIFECYCLE.md`](docs/relay/ADR-021-CONTINUOUS-WORKER-LIFECYCLE.md) | the continuous three-worker lifecycle, its checkpoints, and what it deliberately is not |
| [`docs/relay/MISSION_CONTRACT.md`](docs/relay/MISSION_CONTRACT.md) | the Mission Contract shape, validation, revisions and binding digest |
| [`docs/relay/CARD_SINGLE_SOURCE.md`](docs/relay/CARD_SINGLE_SOURCE.md) | C.A.R.D. — one configuration record per Compound Agent, and the one place it lives |
| [`docs/relay/PROJECT_BRAIN_LLMOPS.md`](docs/relay/PROJECT_BRAIN_LLMOPS.md) | Project Brain: contracts, projection, producer, store, and what no surface reads back yet |
| [`docs/relay/REVIEWER_GATE.md`](docs/relay/REVIEWER_GATE.md) | reviewer independence, the finding and repair ledger, and output visibility |
| [`docs/relay/EXECUTION_ATTESTATION.md`](docs/relay/EXECUTION_ATTESTATION.md) | what an attestation proves, and what it deliberately does not |
| [`docs/relay/REPOSITORY_TARGETS.md`](docs/relay/REPOSITORY_TARGETS.md) | repository targets, permission grades, and their own checked "what is NOT built" list |
| [`docs/relay/SECURITY_BOUNDARIES.md`](docs/relay/SECURITY_BOUNDARIES.md) | dispatch, credentials and the redaction boundary |
| [`docs/relay/WORKSPACE_SECURITY.md`](docs/relay/WORKSPACE_SECURITY.md) | worktree isolation, protected paths and bounded command execution |
| [`docs/relay/ADR-016-DURABLE-LOCAL-PERSISTENCE.md`](docs/relay/ADR-016-DURABLE-LOCAL-PERSISTENCE.md) | journal-as-authority, snapshots, atomic writes, locks and recovery |
| [`docs/relay/WONDERLAND.md`](docs/relay/WONDERLAND.md) | the world seam, the authority boundary, and a specific list of what is unproven |
| [`docs/relay/WONDERLAND_ART_DIRECTION.md`](docs/relay/WONDERLAND_ART_DIRECTION.md) | the visual reference and the rules it sets |
| [`docs/relay/TEST_STRATEGY.md`](docs/relay/TEST_STRATEGY.md) | how any of this is proven |
| [`docs/relay/DECISIONS.md`](docs/relay/DECISIONS.md) | the architecture decision records, and why |

The engineering record of what has actually been run:

| Document | What it records |
| --- | --- |
| [`docs/JULIUS_ZERO_SPEND_QUALIFICATION.md`](docs/JULIUS_ZERO_SPEND_QUALIFICATION.md) | the provider-free qualification of the continuous architecture, the five blockers it found — and the sixth that following them up uncovered, one layer further out |
| [`docs/JULIUS_CONTINUOUS_ARMING.md`](docs/JULIUS_CONTINUOUS_ARMING.md) | what was armed, what turned out not to be, and what is deliberately still off |
| [`docs/JULIUS_PAID_RUNS_2026_09_08.md`](docs/JULIUS_PAID_RUNS_2026_09_08.md) | paid dispatches and what each one stopped on |
| [`docs/handoffs/JULIUS_CURRENT.md`](docs/handoffs/JULIUS_CURRENT.md) | the durable engineering state, updated every session |

**If you are the founder about to test this**, two documents are written for you
specifically:

| Document | What it is for |
| --- | --- |
| [`docs/relay/FOUNDER_TESTING_HANDOFF.md`](docs/relay/FOUNDER_TESTING_HANDOFF.md) | what is live, what is honestly not, and what needs your authorization. **Read §0 first** — it records which of its own earlier advice turned out to be wrong |
| [`docs/relay/FOUNDER_MISSION_PACK.md`](docs/relay/FOUNDER_MISSION_PACK.md) | five missions to run, the free ones first. Generated from the mission data, so a mission here cannot name a field the system does not have |

They are named here because a document written for the one reader who will not go
looking is worthless if the README does not point at it — and a test enforces
that every `FOUNDER_*` document stays named.

## 15. Contributing and provenance

Work enters this repository under [`docs/REPOSITORY_GOVERNANCE.md`](docs/REPOSITORY_GOVERNANCE.md):
every material change opens a pull request against `main`, branches use the
legacy `relay/*` namespace, and merges are **squash merges with founder
authorization**. Green is not authorization.

Julius executes the code on `main`, so the code it runs must be the code someone
approved. Three gates establish that, and they answer different questions:

```bash
npm run julius:review-currency -- <owner/repo> <pr>   # approved at its exact head?
npm run julius:main-provenance -- <owner/repo>        # is main's TREE an approved candidate's?
npm run julius:main-monotonicity -- <owner/repo>      # has main only ever moved forward?
```

A squash deliberately gives the landed commit a different sha from the one that
was approved, so the fact that survives is the **tree**. Candidate commits are
authored and committed by the worker App; the founder is a separate approver at
an exact head; the worker never approves or merges its own pull request; and the
worker is structurally unable to write `.github/workflows/**` at all.

`docs/JULIUS_WORKER_PR_RUNBOOK.md` records the ceremony, including the one case
it was walked and the one thing that went wrong when it was.

## 16. License

MIT — see [`LICENSE`](LICENSE).

---

Julius turns AI agents from chat interfaces into a governed Compound AI Agent
with mission authority, durable memory, evidence, verification, repair — and a
world to inhabit.

**i.Wonder Laboratories, Inc.**
