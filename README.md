# Sunday Relay

**Build with Compound AI Agents. Live with them in Wonderland.**

Relay is a customizable **Compound AI Agent platform** — an agentic engineering
runtime and an Agentic Engineering Factory. It turns separate AI tools, models
and agent harnesses into one coordinated, supervised and **independently
verified** Compound AI Agent, and it owns the question every chat interface
leaves open: *is this actually done?*

**Completion is earned, not claimed.**

Relay is a product of Aquala Technologies, developed in this repository
independently of [Sunday Alcatraz](https://github.com/ohdieyuh-glitch/turbo-broccoli).
Relay accepts Relay product work only — see
[`docs/REPOSITORY_GOVERNANCE.md`](docs/REPOSITORY_GOVERNANCE.md).

> **Read the status tiers before believing anything below.** This README marks
> every capability as **PROVEN**, **PRIVATE BETA** (being built now) or
> **ROADMAP** (designed, not built). Sections 14–16 give the full ledger. If a
> claim here and the code disagree, the code is right and the claim is a defect.

---

## 1. What Relay is

Relay is where a Compound AI Agent is **built, configured and held to account**.

A user says *"build me an app"*, *"build this AI agent"*, *"fix this repo"* or
*"ship this"*, and Relay runs that as a **Mission**: it plans, implements,
verifies its own work by observation, has an **independent reviewer** read the
result, repairs what the review finds, re-verifies, and only then calls it
complete.

Relay owns the engineering and product truth: the Mission Engine, the Loop
Engine, Project Brain, PSP / Compound Agent configuration, permissions,
handoffs, verification, evidence, repair, repository and deployment authority,
durable project intelligence, and completion authority.

Relay is **not** a software team, and it is not a shared editor. It is the
runtime that makes an agent's claim of completion checkable.

## 2. The Compound AI Agent architecture — PROVEN

```
Prompt Architect → Coding Agent → Relay verification
      → independent Harnessing Reviewer → automatic repair
      → re-verification → VERIFIED COMPLETE
```

Three properties make this more than a pipeline diagram:

- **The Reviewer is independent and read-only.** It cannot edit the work it
  judges. The Coding Agent repairs; Relay decides completion.
- **Relay verifies by OBSERVATION, never by the agent's claim.** It reads the
  filesystem and git, not the transcript.
- **Requested and served are separate facts.** The model that answered is
  attested from the provider's own response, never from what was configured.

This runs hosted today, including the automatic repair → re-verify → re-review
cycle.

## 3. Build → Verify → Repair → Ship

The full lifecycle Relay models:

```
BUILD → VERIFY → REVIEW → REPAIR → VERIFIED COMPLETE
      → COMMIT → PUSH / PR → MERGE if authorized
      → DEPLOY → LIVE VERIFY → SHIPPED
```

**PROVEN:** `COMMIT → DEPLOY → LIVE VERIFY → SHIPPED`, performed end to end
against a real `git init` repository, a real artifact copy and a real HTTP
read-back. *Deployed* and *shipped* are deliberately different facts: a deploy
that succeeds while the running system serves a different revision comes back
deployed and **not** shipped.

**PRIVATE BETA:** `PUSH / PR / MERGE`. The GitHub provider is written and proven
offline against an injected fetch, and the runner invokes it — but no credential
exists in this environment, so **not one real remote request has ever been
made**. `merge_pr` is never implied: a Mission holding `create_pr` and not
`merge_pr` stops with its pull request open, and that is the complete outcome.

## 4. Project Brain — PROVEN (models + producer), PRIVATE BETA (breadth)

Durable project intelligence: what a repository is, how it is built and
verified, what has been deployed, what failed, and which repairs were actually
re-verified.

Episodes (deploys, failures, verified repairs) become short-term observations.
Durable facts (stack, architecture, build and verification commands, branch
policy, deployment target) become **promotion proposals a human approves** —
never long-term entries written directly. A run tells you what happened once; it
does not establish how a repository works.

A verdict that says **not shipped** is recorded too. A Brain fed only the runs
that worked learns that everything works.

## 5. Loops — PROVEN

The Loop Engine runs bounded, resumable work: claim → advance → release, with
repair loops and scheduled ticks. Loops are how Relay makes progress without a
human holding the turn open.

## 6. Configurable Repository Targets — PROVEN

Relay operates on **real repositories**, safely, through a first-class target:
explicit provider/repo identity, owner, baseline SHA, base and working branch,
read/write scope, protected paths, provenance, credential boundary and
authorization.

- **Eight permission grades, no escalation:** `read`, `write_worktree`,
  `commit`, `push_feature_branch`, `create_pr`, `merge_pr`, `deploy_staging`,
  `deploy_production`. **Production authorization is never inferred from
  "build this."**
- **Isolated worktrees.** The agent never edits the source checkout.
- **Relay reads git, not the agent.** Renames are counted as deletions,
  symlink escapes are refused, and the write surface is an allow-list.
- **A Mission may narrow its scope and never widen it**, and revocation lands
  mid-Mission because the registration is re-read before every consequential
  step.

## 7. Wonderland — PRIVATE BETA

> **Relay is where you build your Compound AI Agent.
> Wonderland is where it lives.
> Ship on Sunday is where its ecosystem trades.**

Wonderland is Relay's **persistent multiplayer open-world layer**, built in
Unreal Engine with Relay remaining authoritative for Missions, Loops, Brain,
PSPs, permissions, verification and durable state. Unreal visualizes and
controls the experience; it never owns engineering truth.

This is **not** Google-Docs-style multiplayer. Users inhabit Wonderland through
their Compound AI Agents, and real Relay activity is projected into the world.

**Status:** the Relay↔Unreal interface contracts, the Dog pawn and the parity
gate that keeps the C++ and TypeScript definitions in agreement are built and
tested. **The C++ has never been compiled — there is no Unreal binary in this
environment — so Wonderland is not yet playable.** Nothing here should be read
as a shipped game.

## 8. Relay Dogs — PROVEN (identity), PRIVATE BETA (in-world)

Your Compound AI Agent has a body: a small stylized voxel figure with short
legs, short limbs and a recognizable tail. Skins **transform** the Relay Dog;
they never replace it with an unrelated humanoid, and its proportions are
guarded by tests.

Dogs breathe — ambient life, never a state indicator.

## 9. Projects and repositories as world manifestations — ROADMAP

A project is not a folder icon. Repositories and projects can physically
manifest in Wonderland as buildings, skyscrapers, creatures, ships, machines,
moving fortresses and living landmarks — and **verified** development causes
those manifestations to evolve.

*Your software becomes part of the world.*

## 10. NPCs, quests and GVEs from Project Brain — ROADMAP (one real GVE in private beta)

Project Brain can identify weaknesses, opportunities, missing capabilities,
research needs, Agent weaknesses and technical debt. Wonderland turns those
needs into NPC quests, GVEs, dungeons, encounters and eventually bosses.

A GVE connects gameplay to **real Relay work**. Three long-term classes:

| Class | What it improves |
|---|---|
| **PROJECT GVE** | real software |
| **AGENT GVE** | the Compound Agent itself |
| **HYBRID GVE** | both |

Private beta targets **one** real GVE wired to actual Relay execution and
verification. The rest is designed, not built.

## 11. Skill Disciplines and Skill Plugins — ROADMAP

Agents specialize. Disciplines and plugins are the mechanism, and verified
engineering badges are the evidence that a discipline was actually earned.

## 12. Competitive multiplayer direction — ROADMAP

Agent-v-Agent Coliseum competition, PSP Championships, clans and Clan Wars,
Battle Pass, seasonal Rank and permanent Level, bosses and rare drops.

Deliberately **not** being overbuilt for private beta. A competitive layer over
an unproven runtime would be a game about nothing.

## 13. Ship on Sunday — ROADMAP

Where the ecosystem trades: agents, skills, plugins and the software Relay
builds.

---

## 14. What is PROVEN today

- The hosted three-role pipeline, including the automatic repair and re-review
  cycle, running live.
- The served Reviewer model is **attested from the provider's response**, not
  from configuration — and reports `Unknown` rather than guessing.
- Repository Targets: authorization spine, isolated worktrees, git-observed
  diffs, protected paths, change ceilings, mid-Mission revocation.
- `COMMIT → DEPLOY → LIVE VERIFY → SHIPPED` performed against a real
  repository, a real artifact and a real HTTP probe.
- Project Brain feed with a real producer.
- The Relay web surface and CLI at parity, and the Relay Stage.

## 15. What is being built for PRIVATE BETA

- **Wonderland playable vertical slice** — contracts and pawn built; **C++
  never compiled**, no Unreal binary here.
- **Remote operations** — push, PR and merge are wired and have **never made a
  real request**; no credential exists in this environment.
- **A paid three-role run against a real repository** — the machinery is
  proven offline with the architect and reviewer injected. `XAI_API_KEY` and
  `OPENAI_API_KEY` are verified absent here, so this is a founder
  authorization boundary, not an engineering one.
- **One real GVE** tied to actual Relay execution.
- **A durable registration store** — registrations are values today, so a
  restart loses them. Not started.

## 16. ROADMAP

World manifestations that evolve with verified work; NPC/quest generation from
Project Brain; the full GVE classes; Skill Disciplines and Plugins; verified
engineering badges; Coliseum, PSP Championships, clans and Clan Wars; Battle
Pass, Rank and Level; bosses and rare drops; the Ship on Sunday marketplace.

**None of it is implemented.** It is written down so the direction is legible,
not so it can be mistaken for a feature list.

---

Relay turns AI agents from chat interfaces into persistent builders with
identity, memory, verification, progression — and a world to inhabit.

---

## Getting started

```bash
npm install

npm run dev                  # the Relay web surface (http://localhost:5173/)
npm run relay                # the Relay CLI
npm test                     # the full suite
npm run typecheck            # application + bridge
npm run build                # production build
```

The documentation writes CLI commands as `relay <command>`. That invocation is
real: `package.json` maps the `relay` bin to the built CLI, so after
`npm run relay:build` (which `npm run relay` does for you) `npx relay …` works,
as does `relay …` once the package is linked. Without a build, use
`npm run relay -- <command>`.

Offline, no-cost demonstrations (no provider is contacted, no file is changed):

```bash
npm run relay:cli:demo       # the CLI product demo
npm run relay:cli:demo:plain # the same walkthrough, plain text
npm run relay:yc-demo:check  # the demo preflight
```

Commands that reach a real provider are opt-in and require an explicit
`--confirm-live` flag. Nothing in the default test, build or demo path
dispatches to a provider.

## Documentation

`docs/relay/` is the authoritative specification set. Start with:

| Document | What it settles |
| --- | --- |
| `ARCHITECTURE.md` | placement, boundaries, hybrid local/cloud execution |
| `RELAY_MVP_SPEC.md` | product scope |
| `PROTOCOL.md` | the Relay protocol and envelopes |
| `MISSION_CONTRACT.md`, `MISSION_STATUS_MODEL.md` | Mission Operations |
| `EXECUTION_CAPSULES.md`, `AQUALA_TRACE_STANDARD.md` | execution evidence |
| `MISSION_ECONOMICS.md` | cost receipts, budgets, approvals |
| `PSP_AGENT_ID_AND_ENTITLEMENT.md` | PSP Agent ID and entitlement |
| `SECURITY_BOUNDARIES.md`, `WORKSPACE_SECURITY.md` | dispatch, credentials, workspace |
| `WEBSITE_CLI_PARITY_CONTRACT.md` | the two-surface guarantee |
| `OFFICIAL_RELAY_DOG_IDENTITY.md`, `UI_VISION.md` | product identity |
| `TEST_STRATEGY.md`, `DECISIONS.md` | how it is proven, and why |
| `DEVELOPMENT_CONTRACTS.md` | what the repository separation carried, and what it deliberately did not |
| `YC_DEMO_BASELINE.json` | the versioned product baseline the readiness check validates |
| `FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md` | the design questions behind Repository Targets — the *why*. **This row read "NOT STARTED" until the feature shipped** |
| `REPOSITORY_TARGETS.md` | what Repository Targets actually ARE — the *what exists*, with its own checked "What is NOT built" list |
| `PRIVATE_BETA_REMAINING.md` | the exact boundary between built-and-proven and built-and-unproven, and the two things that need the founder |
| `WONDERLAND_ART_DIRECTION.md` | the founder's visual reference and the rules it sets |

**If you are the founder about to test this, start with two documents that were
not listed here at all:**

| Document | What it is for |
|---|---|
| `FOUNDER_TESTING_HANDOFF.md` | what is live, what is honestly not, and what needs your authorization. Read §0 first — it records which of its own earlier advice was wrong |
| `FOUNDER_MISSION_PACK.md` | five missions to run, free ones first. Generated from `src/relay/mission/founder-pack/founder-missions.ts`, and its claims are checked against the code that decides them |

They existed and the map above did not name them, so the two documents written
for the founder were the two a founder would not find.

`RELAY_STATUS.md` and `RELAY_INTEGRATION.md` at the repository root are
**historical records** from the period when Relay was developed inside the
Alcatraz repository. They are superseded by `docs/relay/` and are kept because
they are the honest provenance of this work.

## Contributing

Branches use the `relay/*` namespace, every material change opens a pull
request against `main` in this repository, and merges are **squash merges with
founder authorization**. Relay changes never open pull requests against the
Alcatraz repository. See [`docs/REPOSITORY_GOVERNANCE.md`](docs/REPOSITORY_GOVERNANCE.md).

## License

MIT — see [`LICENSE`](LICENSE).
