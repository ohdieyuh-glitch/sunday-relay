# Founder Testing Handoff — Sunday Relay

Written 2026-08-09 by the execution session. Every fact was verified against
the source or against production. Anything unverified says so.

---

## 1. Where the code is

| | |
|---|---|
| `origin/main` at session start | `ab44956` (PR #69) |
| Open PRs at session start | none |
| Vercel Production deployed | `ab44956` |
| Railway `profound-insight / production` deployed | `ab44956` |
| **`origin/main` now** | **`9c5188e`** — PR #70, 5 commits, squash-merged |
| Vercel + Railway now deployed | **`9c5188e`**, verified |

Production was exactly `origin/main`, confirmed from the GitHub deployments
API. **`/health` carries no commit marker**, so which SHA Railway runs cannot be
proven from outside; that API is the only external evidence. Vercel can be
proven directly — its bundle embeds `VITE_VERCEL_GIT_COMMIT_SHA`.

## 2. What is live

| Surface | URL | Verified |
|---|---|---|
| Frontend | https://sunday-relay.vercel.app | `200` |
| Bridge | https://sunday-relay-production-7d60.up.railway.app | `/health` `200` |

`GET /relay-api/health` (unauthenticated) reports `promptArchitectReady: true`
— **the OpenAI Prompt Architect IS configured in production.**
`~/DEFERRED_FOUNDER_ACTIONS.md` still says "no provider credential exists
anywhere"; that document has been stale since 2026-08-04.

It also publishes `fusionBaseUrl: "http://localhost:3000"` from a hosted
service. Nothing on the live path depends on it; it should be removed or made
honest.

Every operator route answers `401` unauthenticated — verified one by one on
`/reviewer/readiness`, `/hosted-coding/readiness`, `/loop/capability`,
`/beta/status`, `/cron/schedules`.

## 3. The honest state of the three roles

| Role | Occupant in production | Runs there? |
|---|---|---|
| Prompt Architect | OpenAI, API-billed | **Yes** |
| Coding Agent | Claude Code — an **installed CLI** | **No.** A container has no such CLI and never will |
| Reviewer | Hermes — an **installed binary**, or a dedicated service | **No.** A container has neither |

The three-role mission HAS completed end to end **on the founder's machine**
(2026-08-09): Architect (gpt-4o, api-billed) → Coding Agent (Claude Code, one
invocation) → Relay's own verification → independent Hermes review (approved) →
completion policy satisfied. All attestations `requested === actual`,
`fallbackOccurred: false`, ≈2 cents.

**Hosted execution is half-closed.** The hosted Coding Agent is wired and
proven; the hosted Reviewer is not, and no hosted shape completes a mission on
Railway as configured today — see §4.

## 4. What PR #70 delivered — MERGED and DEPLOYED

`GET /relay-api/health` on production now returns, live:

```json
"roleSlotsBound": false,
"roleSlotRefusals": ["coding_agent:no_occupant_requested","reviewer:no_occupant_requested"]
```

That is the change observable from outside, with no credential.


Relay's three roles are permanent; who stands in them was never modelled. The
choice was spread across `RELAY_PROMPT_ARCHITECT_MODE`, `RELAY_HERMES_MODE`, a
`claudeMode` string, and a pair of identity literals in `coding.ts`.

`src/relay/mission/role-slots/` registers **seven occupants**. Binding runs at
the mission preflight, **before any spend**, and fails closed on: an
unregistered occupant, one in the wrong slot, one that cannot run on this host,
missing configuration (named by variable), a selector set to nonsense, two
settings that decide the same slot differently, an occupant this bridge cannot
dispatch, and a Reviewer that is not independent of the implementer.

Independence is decided by `reviewerIsIndependent` — the rule Relay already had
— not a second one.

### The occupants

| Role | Occupant id | Runs where | Billing | Mission can dispatch it |
|---|---|---|---|---|
| prompt_architect | `openai_gpt_architect` | anywhere | api | yes |
| prompt_architect | `fusion_architect` | anywhere | none | yes |
| coding_agent | `claude_code_local` | founder machine | subscription | yes |
| coding_agent | `claude_code_fake` | anywhere | none → `simulated` | yes |
| coding_agent | `claude_agent_sdk_hosted` | anywhere | api | **yes** — wired, needs `ANTHROPIC_API_KEY` + `RELAY_HOSTED_CODING_MODEL` |
| reviewer | `hermes_local` | founder machine | api | yes |
| reviewer | `hermes_remote_service` | anywhere | api | **no — not wired** |

### New configuration

| Variable | Selects | Values |
|---|---|---|
| `RELAY_ROLE_CODING_AGENT` | the Coding Agent occupant | a registered occupant id |
| `RELAY_ROLE_REVIEWER` | the Reviewer occupant | `hermes_local` / `hermes_remote_service` |

Both are documented in `.env.example` and held by the documentation contract.
`RELAY_PROMPT_ARCHITECT_MODE` still selects the architect. The `RELAY_HERMES_*`
names now only **configure** the remote transport — they no longer **select**
the reviewer, because one variable with two readers had no value satisfying
both.

### Which deployments can complete a mission after this branch

| Deployment | Result |
|---|---|
| Founder machine, nothing configured | **refused** — `architect_not_configured`. An empty `RELAY_PROMPT_ARCHITECT_MODE` means BLOCKED, not offline |
| Founder machine, `RELAY_PROMPT_ARCHITECT_MODE=fusion` + a reachable Alcatraz | runs on the installed Claude Code CLI — **subscription-billed**, no API spend |
| Founder machine, live architect + Claude Code + Hermes | **runs — the full three-role mission** |
| Hosted, `RELAY_PROMPT_ARCHITECT_MODE=fusion` + `RELAY_BRIDGE_FAKE_CLAUDE=1` | runs — the keyless offline pipeline, no spend — **but only where `FUSION_BASE_URL` reaches a running Sunday Alcatraz.** `fusion` is an HTTP architect with no offline fallback |
| Hosted, `fusion` + `RELAY_ROLE_CODING_AGENT=claude_agent_sdk_hosted` | a real, API-billed coding run with no Reviewer — **but only where `FUSION_BASE_URL` reaches a running Sunday Alcatraz.** Production still publishes the localhost default, so today this fails at `architect_unavailable` before the Coding Agent is reached |
| Hosted, live three-role | **cannot run.** The hosted Reviewer is still not dispatchable — the mission's reviewer leg spawns a local Hermes and does not use the remote transport |

Production today refuses with `role_binding_refused`, **naming the variables to
set** — where before it said `coding_agent_not_ready`. No capability is lost.

## 4b. The workspace a founder actually opens

Eight changes to the shipped browser application, all on one branch. Every one
is reachable by clicking; none of it is a mock.

### The Relay Dog

Breathes continuously — chest, head, and each paw settling on its own phase —
and walks a real four-beat gait: front-near → rear-far → front-near's opposite
→ rear-near, quarter-cycle apart, with the body shifting as each paw lands. The
sprite gained a fourth leg to make that possible, and the CLI's copy of the
sprite gained the same one, because a pixel-parity test holds the two together.

The mission-state model was NOT replaced. It still decides the pose; what
changed is that the pose is now drawn by six animated parts instead of one
translated block.

### Progression tiers

Seven chakra tiers, root through crown, as accents on the eyes, the collar and
the light the figure casts. The body, its shading and the visor never change.

**Relay awards no levels, and the picker says so where a founder reads it.**
Nothing in this repository counts missions toward a rank; PSP agent evolution
is captured and not started. The tier is an appearance choice stored beside the
colorway and the backdrop. No tier is the default and renders the Dog exactly
as it shipped — root is never assumed, because assuming the first rung asserts
a level nobody reached.

### The Project Brain

An original drawing — lobes, luminous pathways, nodes on those pathways, a
receding plane beneath — floating above the Dog, above the mission box. No
external asset is loaded; the reference images supplied with the direction were
watermarked stock and nothing is traced from them.

Clicking it opens the Brain's own view, which keeps the object as its
centrepiece and reports what Relay has actually recorded: durable knowledge,
self-approved entries, what it is holding now, what it DROPPED, what awaits
approval, and the newest input. Sections are the Brain document's own; this
surface invents none. With no document it says *"No Brain document has been
generated for this project"* rather than drawing an empty chart.

The Brain, the two threads of light, and the Dog share one accent from one
place, so choosing a tier lights the whole column.

### The agent stack bar

The three roles are now controls. Clicking one opens a compact selector in
place — not a route into the setup flow, not a new sidebar.

It writes the project's REAL configuration through the same `saveSettings` the
fifteen-section flow uses. There is no second store, and the strip's names come
back through the projection that was already there.

What it may claim is deliberately limited. Each option carries the catalog's own
availability (AVAILABLE / NOT CONFIGURED / COMING LATER …) plus what the
occupant registry knows: whether Relay registers something that can run this
choice on this kind of deployment, and whether that occupant reads server
configuration. **Never which variables** — the browser must not carry the
server's configuration surface, and a boundary test walks the real import graph
to hold it.

Invalid combinations fail closed in both directions: a reviewer that is not
independent from the coding agent cannot be chosen, and neither can a coding
agent that would make the reviewer already chosen dependent.

Two gaps this surfaced, both real:

- **`reviewer-hermes` did not exist in the catalog.** Relay ships a Hermes
  Reviewer harness in a local and a remote form, both registered occupants, and
  the one reviewer a hosted bridge can bind was unselectable. It is a catalog
  entry now.
- **`reviewer-codex` is selectable configuration with no registered occupant.**
  The CLI can run that adapter; the bridge cannot bind it. The selector says so
  rather than letting a founder save a preference that dies at dispatch.

### Quick Setup

Project Settings opens on QUICK SETUP — agent stack, mode, permissions, compute,
create — with ADVANCED SETUP one click away and all fifteen sections intact.

Both are views of ONE draft in one component saving through the same callbacks.
The gate is the same validator; SAVE DRAFT emits a complete draft, not a
Quick-shaped subset.

### Project Settings navigation

Opening Settings from inside a project returns to that project. The exit button
follows its destination instead of always saying "RELAY HOME".

### What the browser still cannot do

**Start a mission.** That is unchanged and deliberate: one operator credential,
a browser session that is read-only, so the CLI drives and the browser observes.
A role switched in the workspace is stored in the project and is what the next
mission is configured FROM; on the live bridge, which occupant actually runs is
still decided by the server's role variables.

## 4c. Live Reach — current external information

Evaluation of Agent Reach: `docs/relay/AGENT_REACH_EVALUATION.md`, with a file
citation for every claim. The short version, because it changed the plan:

**Agent Reach does not retrieve anything.** Its own `core.py` says it is an
"installer, doctor, and configuration tool" and that "after installation,
agents call the upstream tools directly". Its MCP server exposes one tool,
`get_status`. The actual retrieval path is an agent running third-party CLIs in
a shell with platform cookies in its environment — the boundary Relay exists to
prevent. **It also implements no write operation of any kind**, so no Relay
social action capability can be attributed to it.

| Category | Outcome |
|---|---|
| Used directly | Nothing |
| Wrapped | Nothing |
| Adapted | Ordered backend candidates with fallback; probe-based readiness that distinguishes missing / broken / timeout / error |
| Relay-native | Everything else: capability model, provider seam, evidence, permissions, audit, every retrieval |
| Rejected | The execution model, browser cookie extraction, the host-mutating installer, and any claim of write support |

Relay's existing `mcp-network-policy.ts` is **stronger** than Agent Reach's URL
guard — it also checks post-DNS resolved addresses and every redirect hop — so
Live Reach reuses it unchanged rather than adding a second SSRF guard.

### Sources, and what each honestly is

| Source | Backends | State |
|---|---|---|
| Web | `relay_http_fetch` | Relay-native, no credential |
| GitHub | `relay_github_public`, `relay_http_fetch` | Relay-native, no credential, rate limited per address |
| RSS / Atom | `relay_rss_fetch`, `relay_http_fetch` | Relay-native, publishes its own timestamps |
| X, Reddit, LinkedIn, Instagram, Facebook, YouTube | none | Modelled, with what each would require. **Cannot become READY.** |

`backends[0]` is preferred and the rest are fallbacks; an operator override can
reorder but never introduce, so a stale override cannot hide a backend that
works.

### READY means observed

Probes are side-effect-free GETs. Nothing probed reports **UNKNOWN**, not
"unavailable" — nothing has been asked. A source that answers 401/403 reports
**AUTHENTICATION REQUIRED**; 429 reports **RATE LIMITED** and keeps
`Retry-After`. No amount of configuration produces READY.

### Evidence

A retrieval returns an **EvidenceArtifact**, not text: reference, author,
publication time (or `null`), retrieval time, freshness measured from
publication, the backend that ACTUALLY served it, `fallbackOccurred`,
sanitization state, instruction-shaped phrases found, authority, and everything
Relay does not know written down.

Retrieved content is **data**. `renderForPrompt` fences it, states that it is an
observation BEFORE the content appears, and defuses text that tries to close the
fence.

### Project Brain

A retrieval lands in **short-term** memory and appears under RECENTLY OBSERVED.
Promotion to what the project KNOWS is a proposal that waits for an approver who
is not the proposer. The statement must be written by the proposer — the
citation carries the reference, retrieval time and content fingerprint, so a
later re-fetch can prove the page changed after approval.

### Permissions

Capabilities arrive **ENABLED**. Read and actions are separable, per-capability
overrides win over group switches, and absent means default rather than denied.
A disabled capability is refused by the real path: `fetchImpl` is asserted never
called for each of the four refusal routes.

**Enabled is not authority.** A Mission must state that it asked for the act.
The bridge route defaults `missionAuthorises` to false, so no HTTP caller can
authorise itself.

### The two notices

Global, once, on first entry to Live Reach settings — stating that capabilities
arrive enabled AND that this is not permission to use them, with KEEP ENABLED /
MANAGE INDIVIDUALLY / DISABLE ALL. Then per-source, once, on first entry to that
source. Acknowledged separately and persisted.

### Actions: none exist, and nothing pretends otherwise

No source implements any action capability. The ACTIONS group in settings says
so where a founder looks for the switches, no action route is mounted, and a
test asserts across every source that none is claimed.

### The exact path to test it

1. Open `#/relay/live-reach`. The global notice is there on a browser that has
   never visited.
2. Expand **GitHub**. Its own notice appears once. Read capabilities are listed
   and ON; ACTIONS says Relay performs none.
3. Turn **Search** off, reload — still off, because it was written to the store.
4. Readiness reads **UNKNOWN** in the browser: nothing has been probed from
   there, and the browser is not allowed to probe.
5. Operator-authenticated, against the bridge:

```
curl -s -X POST "$BRIDGE/relay-api/live-reach/probe" \
  -H "authorization: Bearer $RELAY_BRIDGE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"github","url":"https://api.github.com/"}'
```

6. Then a retrieval, with Mission authority stated:

```
curl -s -X POST "$BRIDGE/relay-api/live-reach/retrieve" \
  -H "authorization: Bearer $RELAY_BRIDGE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"github","reference":"https://api.github.com/repos/nodejs/node/releases/latest",
       "missionId":"<id>","projectId":"<id>","missionAuthorises":true,
       "probes":[{"backendId":"relay_github_public","capability":"read_item","result":"observed","probedAt":"<iso>"}]}'
```

Expect an artifact whose `publishedAt` is the release's own date and whose
`age.freshness` reflects it. Drop `missionAuthorises` and the same call answers
`403 mission_does_not_authorize` **without fetching**.

### Known limits, stated

- **No JavaScript is executed.** A page that renders client-side returns what
  the server sent, which is sometimes nothing.
- **No credential is ever sent.** Sources needing a session report that they do.
- **Probes are supplied, not scheduled.** Nothing yet re-probes on a timer, so
  readiness is as current as the last probe a caller made.
- **The browser cannot probe or retrieve.** Both are operator-only, so the
  settings screen shows UNKNOWN until an operator probes.
- **No action capability exists**, on any source.

## 5. What is NOT done

| # | Requirement | State |
|---|---|---|
| 1 | Production-hosted three-role execution | **Half.** Architect hosted and Coding Agent wired; the hosted **Reviewer** is the remaining gap |
| 2 | Swappable role slots | **Substantially done.** Registry, fail-closed binding, requested-vs-actual identity, dispatchability, and hosted execution for the Coding Agent. The Reviewer's hosted surface is not dispatchable |
| 3 | Real workspace path | **Substantially done in the browser** — see §4b and §6. Opening a project, configuring the stack, switching roles and observing role/evidence/verification state all work by clicking; STARTING a mission is still operator-only by design |
| 4 | Evidence & Retrieval on MCP + Brain | **Substantially done** — see §4c. Live Reach retrieves through the permission boundary into EvidenceArtifacts, and the Brain references them without absorbing them. Retrieval is operator-only |
| 5 | Skill Ops capabilities | **Not started** |
| 6 | Adapter plumbing verbs | **Partially present.** `ports.ts` declares `descriptor` + `execute`; the other verbs exist unevenly across connectors, not as one contract |
| 7 | Research Loops | **Not started.** The Loop Engine exists; `createLoopService` still has no production caller |
| 8 | GraphRAG / LangChain / LangGraph | **Not started**, and the gap is narrower than it was: retrieval now exists (§4c). No embedding or vector code exists |
| 9 | Real wiring rule | **Enforced for what shipped.** Three pre-existing violations recorded in §7 |
| 10 | Founder Mission test pack | **This document covers what can be tested today** |

## 6. The testing path that exists today

The browser entry renders `RelayPreviewApp`, not `RelayApp`. Routes:

| Route | Screen |
|---|---|
| `#/relay` | Relay Entry Home |
| `#/relay/console` | Mission Control |
| `#/relay/project/<id>` | Project workspace |
| `#/relay/project/<id>/terminal` | Workspace with the Live Terminal |
| `#/relay/project/<id>/settings` | Project settings |

**The browser cannot start a Mission, by design.** There is one operator
credential, `RELAY_BRIDGE_API_TOKEN`; the browser gets in only via a pairing
grant that redeems to a **read-only** session. Everything that spends money or
mutates a run is operator-only. So the shape is: **the CLI drives, the browser
observes.**

### The exact path to test the workspace itself (no credentials, no spend)

Nothing below spends money or needs a bridge.

1. Open https://sunday-relay.vercel.app
2. Type a request on the Entry Home → **BUILD PROJECT BRIEF** → **SEND TO
   PROJECT SETTINGS**.
3. Settings opens on **QUICK SETUP**. Pick the stack, mode, permissions and
   limits, then **CREATE PROJECT**. Press **ADVANCED SETUP** at any point —
   the same draft, all fifteen sections.
4. In the workspace: the Brain floats above the Dog above the mission box, and
   a thread of light joins them. Watch the Dog for ten seconds without doing
   anything — it should never be still.
5. **Click PROMPT ARCHITECT, CODING AGENT and REVIEWER in the strip.** Each
   opens its own selector. Choose a different Reviewer; the strip's name
   changes, and it survives a browser refresh because it was written to the
   project.
6. **Click the Brain.** It opens its own view. With nothing recorded it says
   so in words.
7. **RELAY DOG TIER**, below the stage: choose CROWN, then NO TIER. The Dog's
   eyes, collar and cast light follow, and so does the Brain above it.
8. Open **PROJECT SETTINGS** from inside the workspace and press the exit —
   it returns to the project, not to the homepage.
9. Turn on your operating system's reduce-motion setting and reload: the Dog
   stops moving and the Brain stops rotating. The tier's colour stays, because
   colour is not motion.

### The exact path to test the real three-role mission (founder machine)

1. `cd ~/sunday-relay-product && git fetch origin && git checkout main && git pull`
2. `npm run relay:build` — `dist-relay/` is gitignored, so a merged command
   does not exist in your binary until you rebuild in that checkout.
3. Set `RELAY_PROMPT_ARCHITECT_MODE=live`, `OPENAI_API_KEY`,
   `OPENAI_PROMPT_ARCHITECT_MODEL`, and leave the role selectors unset (a
   laptop defaults to `claude_code_local` + `hermes_local`).
4. Start the bridge and POST `/relay-api/mission/start` with operator auth.
5. Watch it in the browser at `#/relay/console`.

Before trusting any Hermes-backed path, run the one check that actually proves
Hermes works — `hermes status` and `hermes doctor` both report a key that is
merely present, and Hermes exits 0 when its provider rejects the call:

```
cd "$(mktemp -d)" && env -i PATH="$PATH" HOME="$HOME" hermes -z 'Reply with the single word: OK' --safe-mode
```

## 7. Real-wiring violations still open

1. **`relay-bridge/server.ts`** passes `null, null, null` for `reviewerRuns`,
   `hostedCodingRuns` and `loopRuns`, so those route families answer
   `*_not_ready` in production.
2. **`createLoopService` is imported only by its own test.**
3. **`ReviewerRunPort` and `HostedCodingRunPort` have no implementation** —
   only the interfaces and the routes that would call one.

## 8. Founder-gated items

| Id | What | Blocks |
|---|---|---|
| DFA-001 | Railway CLI is **Unauthorized**; creating a second Railway service needs browser consent | The dedicated Hermes service |
| — | `ANTHROPIC_API_KEY` + `RELAY_HOSTED_CODING_MODEL` + `RELAY_ROLE_CODING_AGENT=claude_agent_sdk_hosted` on Railway | Hosted Coding Agent execution. The code is wired and proven; the credentials AND a reachable `FUSION_BASE_URL` are both outstanding |
| DFA-003 | Supabase password rotation | Nothing in this repository |

**This session held no `RELAY_BRIDGE_API_TOKEN`**, so every production check
here is an unauthenticated probe. No operator route was driven, and **no
provider call was made by this session**.

## 9. Recommended next Missions, in order

1. ~~**Hosted Coding Agent execution.**~~ **DONE** — `relay-bridge/agent-invoker.ts`
   isolates the one step of eight that depends on the surface, and
   `hosted-coding-agent/hosted-invoker.ts` implements it over
   `runHostedCodingAgent`. Nothing else was duplicated. Set the two Railway
   variables above to use it.

   Worth recording: "remove it from the exclusion and that is the whole change"
   was WRONG, and an independent review proved it by running the real mission
   registry on a host with no `claude` on PATH. The mission probed for the
   local CLI unconditionally, so the hosted occupant still died with "Install
   Claude Code" — the wrong-machine instruction the registry exists to remove,
   surviving one layer beneath it.
2. **Hosted Reviewer.** Either DFA-001 (a Hermes service, plus teaching the
   mission's reviewer leg to use the remote transport — today it always spawns
   locally), or register a Reviewer occupant that needs no installed binary.
   The registry makes the second a configuration change rather than a redesign.
3. **Wire the three run engines** (§7). Note the hazard left in writing at
   `local-transport.ts:53-60`: the transport's ceilings are per instance and
   `transport-factory.ts` builds a fresh one per request — harmless only while
   no route calls `startReview`. Hoist the instance.
4. Then Evidence & Retrieval, Skill Ops, Research Loops, and the external
   adapter evaluation.

## 10. What this session actually cost, and what it proves

Five commits, 15 files. **Four independent review rounds**, which between them
found **seven High findings — three of them defects introduced by the previous
round's own repair.** That is the documented failure mode of this repository,
reproduced faithfully, and the reason the rounds are not optional.

| Round | The finding that mattered |
|---|---|
| 1 | Binding decided who was *named*, not who *ran* |
| 2 | The round-1 repair broke `actorMatches()` on every ordinary local mission |
| 3 | Binding demanded a Reviewer on the development path, killing a working hosted pipeline |
| 4 | Naming `claude_code_fake` without its mode ran the **real, paid CLI** and attested it `simulated` |

Two repairs shipped with **no regression barrier**: reverting either left the
whole 718-test bridge suite green. Both now fail a test that runs the real
coding leg against the real registry occupant, verified by mutation.
