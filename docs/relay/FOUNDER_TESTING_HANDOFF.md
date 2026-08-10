# Founder Testing Handoff — Sunday Relay

Written 2026-08-09 by the execution session. Every fact was verified against
the source or against production. Anything unverified says so.

---

## 0. Addendum — 2026-08-10

Nine changes merged since this document was written. Read this first: several
of them CORRECT things the sections below used to say, and two correct advice
that would have produced a false record.

| Merged | What it changes for you |
|---|---|
| #77 | `/relay-api/health` no longer publishes `fusionBaseUrl: "http://localhost:3000"` from a container that has no loopback service. **Verified live: it now reads `null`.** The Hermes transport instance is also hoisted, so its ceilings are real rather than per-request |
| #78 | The `/reviewer/*` and `/hosted-coding/*` 503s stopped saying the engine is "not configured". No setting enables them — those routes carry no prompt, workspace or review packet — so they now name the mission path that works. Consequence, recorded rather than hidden: `relay reviewer start` cannot succeed against a hosted bridge |
| #80 | Retrieval is metered, so a cap over it is a cap. The unit is retrievals and bytes, never money. Observable at `GET /relay-api/live-reach/usage/<missionId>` |
| #81 | The skill catalogue is enforced at run time instead of being a declaration nothing consulted |
| #82, #84, #85, #86 | The Founder Mission Pack, and three corrections to it. See §5 row 10 |
| #83 | **The one that changes your instructions.** See below |

### The Reviewer instruction in §9 was wrong, and it mattered

`RELAY_OPENAI_REVIEWER_MODE=live` with `RELAY_ROLE_REVIEWER` unset used to
resolve the provider transport while binding the `hermes_local` default. OpenAI
would have performed the review and **Hermes would have been attested** — the
mission narrating one occupant while another did the work.

Fixed: an explicitly configured transport now supplies the occupant, so setting
the mode alone is correct and sufficient. Setting `RELAY_ROLE_REVIEWER` to
something that contradicts the mode is refused before any spend, naming both
variables.

Four other places repeated the same stale claim and each cost something: the
dispatchable set refused a remote Reviewer Relay could genuinely drive, the
Reviewer panel displayed a limitation the product no longer had, `.env.example`
promised values the code rejected, and the deployment table below said a hosted
three-role mission "cannot run". All corrected.

### What has NOT changed

Your three founder-gated items in §9 stand. Nothing here staffs a role, spends
anything, or deploys the Hermes service. `roleSlotsBound` is still `false` in
production because production has still named no occupant — which is truthful,
not broken.

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

~~It also publishes `fusionBaseUrl: "http://localhost:3000"` from a hosted
service.~~ **FIXED.** A production deployment with nothing configured now
resolves it to `null`: loopback there is the default nobody changed, presented
as a decision somebody made. The consequence is worth having — a mission that
selects the development architect on such a deployment is refused at the
CONFIGURATION rather than discovering it at an HTTP call to an address nothing
answers.

Every operator route answers `401` unauthenticated — verified one by one on
`/reviewer/readiness`, `/hosted-coding/readiness`, `/loop/capability`,
`/beta/status`, `/cron/schedules`.

## 3. The honest state of the three roles

**Production has named no occupant for two of the three roles.** `/health`
reports `roleSlotsBound: false` with `no_occupant_requested` for the Coding
Agent and the Reviewer, so the column below is what each role COULD hold, not
what production has chosen. An earlier version of this table named Claude Code
and Hermes as though production had picked them; it had not.

| Role | What can hold it on a container | Runs there? |
|---|---|---|
| Prompt Architect | OpenAI, API-billed | **Yes** — configured today |
| Coding Agent | `claude_agent_sdk_hosted`, API-billed | **Yes, wired and proven** — needs `ANTHROPIC_API_KEY` + `RELAY_HOSTED_CODING_MODEL`. The Claude Code CLI cannot run there and never will, which is why the hosted occupant exists |
| Reviewer | `openai_reviewer` (nothing to deploy) or `hermes_remote_service` (needs the service) | **Yes** — `callReviewer` dispatches on the resolved transport. Local Hermes remains founder-machine only |

The three-role mission HAS completed end to end **on the founder's machine**
(2026-08-09): Architect (gpt-4o, api-billed) → Coding Agent (Claude Code, one
invocation) → Relay's own verification → independent Hermes review (approved) →
completion policy satisfied. All attestations `requested === actual`,
`fallbackOccurred: false`, ≈2 cents.

~~**Hosted execution is half-closed.**~~ **No longer true, and it was the
sentence most likely to set your expectations.** It said the hosted Reviewer is
not wired. It is: `callReviewer` dispatches on the resolved transport, and both
non-local Reviewers are dispatchable — the dispatchable set had excluded one of
them on the strength of a comment that had gone stale. See the §0 addendum.

What IS still true is that no hosted shape completes a mission on Railway **as
configured today**, and the reason is credentials rather than code: production
has named no Coding Agent and no Reviewer. That is a decision waiting on you,
not a gap waiting on work.

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
| reviewer | `openai_reviewer` | anywhere | api | **yes** — the Reviewer that needs nothing deployed. It was MISSING from this table entirely: registered, dispatchable, and absent from the list a founder reads to choose one. Enable with `RELAY_OPENAI_REVIEWER_MODE=live` + `RELAY_OPENAI_REVIEWER_MODEL` |
| reviewer | `hermes_remote_service` | anywhere | api | **yes** — `callReviewer` dispatches on the resolved transport. It was listed as not wired long after it was, because the justification for the dispatchable set was a stale comment nobody re-read |

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
| Hosted, `fusion` + `RELAY_ROLE_CODING_AGENT=claude_agent_sdk_hosted` | a real, API-billed coding run with no Reviewer — **but only where `FUSION_BASE_URL` reaches a running Sunday Alcatraz.** This row used to say production still publishes the localhost default, so this fails at `architect_unavailable`. It no longer publishes it: #77 resolves it to `null` on a production deployment, **verified live**. The consequence is better rather than milder — the mission is refused at the CONFIGURATION, by name, instead of discovering it at an HTTP call to an address nothing answers |
| Hosted, live three-role | **Can run, given credentials.** This row said "cannot run — the hosted Reviewer is still not dispatchable, the mission's reviewer leg spawns a local Hermes and does not use the remote transport". Both halves were false: `callReviewer` dispatches on the resolved transport, and both non-local Reviewers are dispatchable. Use `openai_reviewer` (nothing to deploy) or `hermes_remote_service` (needs the service). Set the Coding Agent variables too — see §8 |

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
- **Metering is per process.** Retrieval IS metered now — `relay_live_reach`
  declares the `usage` verb and `GET /relay-api/live-reach/usage/<missionId>`
  reports it — but the meters live in memory, so a bridge restart forgets what
  a mission has already spent and a cap binds within a process rather than
  across one. Stated because a budget that silently resets is worse than a
  budget you know the shape of.

## 4d. Research Loops and subordinate orchestrators

### Research Loops

Not a second loop engine. The Loop Engine already owns iterations, limits,
stop conditions, states and decisions, and already had `research` among its
loop types. What was missing was research-specific: what a question is, what
counts as an answer, and who may change either.

**The plan is frozen.** Question, criteria, evaluator, permitted sources,
independence requirement and freshness bar are fingerprinted when the loop
starts. A round carrying a different fingerprint is REFUSED, not evaluated — a
loop that can edit its own success criteria will always succeed. The
fingerprint covers the evaluator (swapping the judge is the same defect as
moving the bar) and deliberately ignores the plan id and criterion ordering (a
rename is not a change).

**Inconclusive is a real outcome.** A round that neither confirmed nor refuted
is not a failure and not a pass. Reverting means the direction was wrong;
inconclusive means nothing was settled.

**Authority bars are per criterion**, so fifty community observations do not
satisfy a criterion naming a primary source — and unknown publication age
cannot satisfy a freshness requirement, however recently the page was fetched.

### Subordinate orchestrators (LangGraph and anything like it)

**Nothing is installed**, and that is the finding rather than a gap. The
question is what an external orchestrator is ALLOWED to do, and that has to be
answerable before one runs. Same conclusion as the Agent Reach evaluation: take
the pattern, refuse the runtime.

The boundary is built and tested:

| Direction | What crosses |
|---|---|
| Down | Objective, frozen input VALUES, a step ceiling, and the NAMES of tools Relay would run on its behalf. No credential, no permission, no connection — `FORBIDDEN_BRIEF_KEYS` is enforced, not documented |
| Up | Proposals. Never a verdict, completion, permission, role assignment or budget change |

A framework asserting authority is **refused, not sanitized** — stripping the
sentence would hide that a component someone trusts with part of their
reasoning tried to declare a mission complete. The refusal keeps what was said.

A graph may still DISCUSS what it cannot decide: "the mission will be complete
when the tests pass" is analysis, "the mission is complete" is a claim. Both
cases are tested, so the patterns cannot be tightened into uselessness.

Tools requested but never offered in the brief are surfaced rather than hidden.

## 4e. Relay Skills

Skill Ops-style capabilities as declared bundles behind the permission model
that already exists. A skill states what it does, which MCP capabilities it
needs, the highest risk any of its steps reaches, which roles may run it, and
what it PRODUCES.

**There is no second judgement.** The skill layer narrows and then asks
`evaluatePermission`, which is the one place that answers — `requires_approval`
included, passed through rather than resolved. The test that holds this does
not read the code: it runs both the skill call and the permission model alone
across every role and every risk class and asserts the skill layer is never
more permissive.

| Skill | Produces | Roles | Highest risk |
|---|---|---|---|
| `relay.evidence.gather` | evidence | architect, reviewer, security-reviewer | read_only |
| `relay.repository.read` | analysis | all but operations | read_only |
| `relay.repository.edit` | workspace_change | coding-agent only | workspace_write |

Three, deliberately, and each is something Relay can already do — a catalogue
naming skills with no implementation is the fabricated-capability failure in
another costume. No wildcards: a skill that can invoke anything is not a skill.

`skillChangesSomething` separates skills that change something from skills that
do not, because a Mission's authority and an agent's permission are different
questions — the same line Live Reach draws.

## 4f. The Reviewer can now run somewhere other than your laptop

`runHermesReview` spawns a local Hermes process. Correct on a founder's
machine, impossible on a container — so a hosted bridge had no Reviewer at
all, which was the remaining half of production-hosted three-role execution.

**The transport was never the hard part. The preflight was.** `hermesPreflight`
runs `hermes --help` and fails when the binary is absent, which on a container
is always. A bridge correctly configured for the remote Reviewer would have
been refused before the remote path was reached, with an error about an
executable nobody intended to use. That is exactly what happened to the hosted
Coding Agent, so a transport now carries BOTH halves — how to run a review and
how to check one could run — chosen together, and a test asserts the local
probe is never called for a remote transport.

| | Local | Remote | Provider API |
|---|---|---|---|
| Runs | spawned Hermes process | authenticated HTTP to the Reviewer service | the Prompt Architect's provider |
| Readiness | `hermes --help` / `status` | `GET /v1/readiness` — offline, creates no run | configuration presence, stated as such |
| Selected by | default | `RELAY_HERMES_MODE=remote` | `RELAY_OPENAI_REVIEWER_MODE=live` |
| Needs deploying | no | **yes** | no |

See §4h for how Relay picks between them and what it refuses.

Same `HermesOutcome`, same `validateHermesReview`, so no verdict logic exists
twice and a remote reviewer cannot return a shape the local one could not.

**Refusals that matter:**

- A review that has not returned in time is `review_incomplete` saying whether
  it finished is **unknown** — the service may still be reviewing, and calling
  it failed would be a claim about someone else's process.
- A production bridge will not trust a Reviewer URL absent from
  `RELAY_HERMES_TRUSTED_ORIGINS`, and will not send its bearer token over
  plaintext. Checked against the environment, not a flag.
- A service that cannot enforce read-only is refused however healthy it is —
  read-only is the Reviewer's whole safety property.
- Remote-configured-and-broken never falls back to local: it refuses naming the
  missing variable.
- The run id IS the idempotency key, so a redelivered request cannot start a
  second paid review.

### To use it

On the bridge: `RELAY_HERMES_MODE=remote`, `RELAY_HERMES_SERVICE_URL`,
`RELAY_HERMES_SERVICE_TOKEN`, `RELAY_HERMES_TRUSTED_ORIGINS`.

**What is still founder-gated: the service is not deployed.** DFA-001 — the
Railway CLI is unauthorized and creating the service needs browser consent.
Every code path above is proven offline; none of it has spoken to a running
Hermes service.

## 4g. Adapter lifecycle verbs

Ten verbs — `readiness`, `start`, `execute`, `stream`, `resume`, `stop`,
`result`, `usage`, `identity`, `capabilities` — as a vocabulary that runs
nothing. An adapter declares which it implements; Relay refuses the rest.

**Four change what you may promise.** An adapter that cannot `stop` cannot be
cancelled, and a cancel button over it is a lie. One that reports no `usage`
cannot be budgeted, and a spend cap over it is a hope. `operatorPromises`
derives cancellable / budgetable / attributable / probeable from the
declaration rather than assuming them.

**Declared is not implemented.** `reconcileDeclaration` fails a declared verb
with no handler *and* a handler nobody declared — the second is reachable by
accident, never by policy, and invisible to every surface reading the
declaration.

The absences are the useful part:

| Adapter | Cannot | Why |
|---|---|---|
| Claude Agent SDK (hosted) | `stop` | Nothing outlives the call |
| Hermes Reviewer (local) | `usage` | The one-shot CLI reports none, and Relay will not estimate |
| Live Reach | `stream` | A partially sanitized document must never reach an agent |
| All but the remote reviewer | `resume` | No server-side session is held |

## 5. What is NOT done

| # | Requirement | State |
|---|---|---|
| 1 | Production-hosted three-role execution | **Code complete; two variables away.** Architect hosted; Coding Agent wired and proven; Reviewer now has THREE transports — local, remote Hermes, and a provider-API Reviewer needing nothing deployed (§4f, §4h). Set `RELAY_OPENAI_REVIEWER_MODE` and a model and the Reviewer leg runs hosted |
| 2 | Swappable role slots | **Substantially done.** Registry, fail-closed binding, requested-vs-actual identity, dispatchability, and hosted execution for the Coding Agent. Every registered occupant is now dispatchable, including both non-local Reviewers — and the transport and the bound occupant are reconciled, so Relay can no longer review with one and attest another |
| 3 | Real workspace path | **Substantially done in the browser** — see §4b and §6. Opening a project, configuring the stack, switching roles and observing role/evidence/verification state all work by clicking; STARTING a mission is still operator-only by design |
| 4 | Evidence & Retrieval on MCP + Brain | **Substantially done** — see §4c. Live Reach retrieves through the permission boundary into EvidenceArtifacts, and the Brain references them without absorbing them. Retrieval is operator-only, and now METERED: `relay_live_reach` declares the `usage` verb, so a cap over retrieval is enforceable rather than aspirational. Unit is retrievals and bytes, never money; readable at `GET /relay-api/live-reach/usage/<missionId>` |
| 5 | Skill Ops capabilities | **Done, and wired.** Declared skills behind the existing permission model, proven never more permissive than it — and the mission's evidence leg now runs `relay.evidence.gather` through `evaluateInternalSkillCall` before anything leaves the machine, so the catalogue is enforced rather than declared. It does NOT go through the MCP permission model, and §9 item 7 explains why that would have been a second judgment system |
| 6 | Adapter plumbing verbs | **Contract done** — see §4g. Ten verbs as one vocabulary; adapters declare what they implement, Relay refuses the rest, and declarations are reconciled against real handlers in both directions |
| 7 | Research Loops | **Domain done, no production run** — see §4d. Frozen plan, per-criterion authority bars, inconclusive as a real outcome. `createLoopService` NOW has a production caller (`composeLoopRuns` in `main()`), so the sentence that used to sit here is out of date — what is still missing is a Loop AGENT: the only one shipped simulates, and production refuses it by design |
| 8 | GraphRAG / LangChain / LangGraph | **Evaluated and bounded** — see §4d. The subordination boundary exists and is tested; no framework is installed, deliberately. No embedding or vector code exists |
| 9 | Real wiring rule | **Enforced for what shipped, and it caught this document too.** Of the three "violations" §7 recorded, two were WRONG DIAGNOSES — both engines existed and ran; the standalone ports lacked an input, not an implementation. The third was real. §7 also now carries a fourth, found by applying the rule to the Reviewer: the transport and the bound occupant were never reconciled |
| 10 | Founder Mission test pack | **Both halves exist.** This document is the handoff; `docs/relay/FOUNDER_MISSION_PACK.md` is the pack — five entries, free-first, generated from `founder-missions.ts`. Every entry carries a `wouldFailIf`, which is what separates a test pack from a demo script. **Its claims are RUN, not merely validated**, and that distinction was earned: shape-validation passed three entries that were wrong — a refusal no mechanism produces, an invented idempotency key, and prerequisites that omitted two of the three roles. Each was well-formed. The refusal claim is now checked against `evaluateLiveReach`, the idempotency claim against the real registry, and an entry that starts a mission must say what staffs the other roles |

### A Mission that reads before it plans

`start` accepts `evidenceReferences` — explicit, empty by default. A Mission
does not decide on its own that it needs the internet, and Relay does not
decide for it; the caller that knows the Mission's scope names what may be
read.

What happens then, in order: each reference is retrieved through the same
permission evaluation the route uses, the observation becomes an
EvidenceArtifact, and the fenced block is handed to the Prompt Architect
**before it plans** — because a plan made from a recollection cannot be fixed
by evidence arriving after it.

A reference that cannot be retrieved is recorded as a system notice and the
Mission continues with less. Nothing is fabricated: a test fails a placeholder
pushed on refusal.

Retrieval is emitted as `research` with truth `relay_evidence` — Relay made
the request itself and saw the answer, so it is Relay's evidence and not an
agent's claim. A failure is `system_notice`, because nothing was observed.

**The first request on a fresh bridge will be refused `not_ready`, and that is
correct.** Readiness is observed, and a process that has just started has
observed nothing. Probe first:

```
curl -s -X POST "$BRIDGE/relay-api/live-reach/probe" \
  -H "authorization: Bearer $RELAY_BRIDGE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"github","url":"https://api.github.com/"}'
```

Seeding an optimistic probe at startup would be exactly the "configured
therefore ready" claim the readiness model exists to refuse.

### The whole evidence chain, and where to see each hop

Every hop has a barrier, and the two that read "different facts" are the ones
most likely to be quietly collapsed by a later change.

| Hop | What it does | Refuses |
|---|---|---|
| Mission authorises | `evidenceReferences` on `start`, empty by default | A Mission cannot decide it needs the internet |
| Live Reach retrieves | Permission evaluation, then a bounded fetch | Disabled capability, unauthorised Mission, unobserved source — none of which dispatch |
| EvidenceArtifact | Publication ≠ retrieval, backend that served it | Undated stays UNKNOWN |
| Architect | A fenced block, before it plans | Content cannot escape the fence |
| The wire | References, never content | Absent ≠ empty |
| The store | Mirrored, never merged | An empty list replaces a fuller one |
| The host | Passes the active mission's references | Absent stays absent |
| The Brain view | Source, published, retrieved, backend, fallback | Retrieved text never rendered |

**To see it end to end** (operator credential required for the bridge half):

1. Probe once — readiness is observed, and a fresh process has observed
   nothing:

```
curl -s -X POST "$BRIDGE/relay-api/live-reach/probe" \
  -H "authorization: Bearer $RELAY_BRIDGE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"github","url":"https://api.github.com/"}'
```

2. Start a Mission naming what it may read, then open
   `#/relay/project/<id>/brain`. **RETRIEVED FOR THIS MISSION** lists where it
   came from, when the source said it was published, when Relay fetched it, and
   which backend actually served it — with a fallback named when one happened.

3. Turn `read_item` off for that source at `#/relay/live-reach` and start
   another Mission. The reference is refused, the Mission continues without it,
   and the Brain shows the section with nothing in it — *authorised and
   retrieved none*, which is not the same as never having been authorised.

### 4h. Three Reviewers, and how Relay picks

| Transport | Needs | Selected by |
|---|---|---|
| Local Hermes | the binary on the PATH — never true on a container | the default |
| Remote Hermes | a deployed Reviewer service | `RELAY_HERMES_MODE=remote` |
| GPT (provider API) | nothing deployed; the architect's existing credential | `RELAY_OPENAI_REVIEWER_MODE=live` |

The transport is resolved ONCE and both the preflight and the call read it, so
Relay never probes for one Reviewer and invokes another — the defect that broke
the hosted Coding Agent, refused here in advance by construction.

**That sentence was true and incomplete, and the gap was live.** Resolving the
transport once settles who PROBES and who RUNS. It says nothing about who is
ATTESTED, which the role slot decides — a third decision, and until #83 nothing
reconciled it with the other two. Setting `RELAY_OPENAI_REVIEWER_MODE=live`
with no named occupant resolved the provider transport while binding the
`hermes_local` default, so OpenAI would have reviewed and Hermes would have
been recorded. Now: an explicitly configured transport supplies the occupant,
and an explicit contradiction is refused before any spend, naming both
variables. Coherence "by construction" is a strong claim, and it is worth
noticing that this section made it about two of the three decisions.

**Two enabled at once is refused, not resolved.** Both are turned on by an
operator naming a mode; picking one silently would make the reviewer that ran
depend on the order of two lines in a resolver.

**Asked-for-and-unavailable never falls back to local**, for either. Falling
back turns a configuration mistake into a confusing failure about a binary
nobody intended to use.

All three return the same `HermesOutcome` and are read by the same validator,
so no Reviewer can return a shape the others could not, and no caller learns
which one answered from the shape of the answer.

### What no code change can close

Three boundaries remain, and none of them is a missing implementation:

| Boundary | Needs |
|---|---|
| The Hermes Reviewer service is not deployed | Railway browser consent — DFA-001 |
| `RELAY_ROLE_CODING_AGENT` and `RELAY_ROLE_REVIEWER` are unset in production | Someone with Railway access to set them; `/relay-api/health` reports `roleSlotsBound: false` with both refusals `no_occupant_requested`, which is truthful |
| No Loop agent is named in production | `loopEngine: no_agent_named`. The only agent this build ships simulates its iterations, and production refuses it regardless — so this stays until a real Loop agent exists |

Verified against the live surfaces rather than assumed: the frontend answers
`200`, the bridge answers `ok`, `promptArchitectReady` is `true`, and the three
lines above are what it actually reports.

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

1. ~~**`relay-bridge/server.ts`** passed `null, null, null`.~~ **NOT A
   VIOLATION — the diagnosis was wrong, and §9 item 5 carries the correction.**
   The Loop engine is constructed. The other two stay `null` by design: both
   ENGINES exist and both run inside the mission leg, and what the standalone
   ports lack is an INPUT their routes do not carry — a prompt and a workspace,
   or a review packet. Their refusals now say so and name the mission path.
2. ~~**`createLoopService` is imported only by its own test.**~~ **CLOSED.**
   `composeLoopRuns` builds it in `main()` when a durable state root is
   mounted and an operator names an agent, and refuses the simulator on a
   production deployment — checked against the environment, not a flag, so no
   configuration can turn it back on. `/relay-api/health` reports
   `loopEngine` as a code: `wired`, `wired_simulated`, `no_state_root`,
   `no_agent_named`, `unknown_agent` or `simulated_agent_in_production`.

   **On the live bridge today this reads `no_agent_named`**, which is correct:
   the only agent this build ships simulates its iterations, and production
   would refuse it anyway.
3. ~~**`ReviewerRunPort` and `HostedCodingRunPort` have no implementation.**~~
   **FALSE, and this entry is kept as the record of a wrong diagnosis that
   nearly caused the wrong build.** `mission.ts:436` constructs the hosted
   invoker and `mission.ts:1387` runs the Reviewer over a real packet. See
   §9 item 5.

4. **Two Reviewer decisions were never reconciled** — FIXED, and it was live.
   `resolveReviewerTransport` decides who reviews; the role slot decides who is
   attested. With `RELAY_OPENAI_REVIEWER_MODE=live` and `RELAY_ROLE_REVIEWER`
   unset — the exact configuration this document recommends — a founder machine
   resolved the provider transport and bound the `hermes_local` default, so
   OpenAI reviewed and Hermes was attested. An explicitly configured transport
   now supplies the occupant when none is named, and an explicit disagreement
   is refused before any spend, naming both settings.

## 8. Founder-gated items

| Id | What | Blocks |
|---|---|---|
| DFA-001 | Railway CLI is **Unauthorized**; creating a second Railway service needs browser consent | The dedicated Hermes service |
| — | `ANTHROPIC_API_KEY` + `RELAY_HOSTED_CODING_MODEL` + `RELAY_ROLE_CODING_AGENT=claude_agent_sdk_hosted` on Railway | Hosted Coding Agent execution. **This row used to add "AND a reachable `FUSION_BASE_URL`", which was wrong and made your remaining work look larger than it is.** `fusionBaseUrl` is read only inside the Fusion architect branch (`mission.ts:1213`); the coding leg never reads it. Production already runs the OpenAI architect (`promptArchitectReady: true`), so Alcatraz is not needed for this at all — the credentials are the whole blocker |
| DFA-003 | Supabase password rotation | Nothing in this repository |

**Neither session held a `RELAY_BRIDGE_API_TOKEN`** — not the one that wrote
this document on 2026-08-09, nor the one that produced the §0 addendum on
2026-08-10. Every production check in it is an unauthenticated probe. No
operator route was driven and **no provider call was made**, by either.

That is why nothing here reports a completed hosted mission: not because one
failed, but because no session could authorise one.

## 9. Recommended next Missions, in order

The code items from the previous version of this list are done and merged. What
is left is ordered by what unblocks the most, and the first three need YOU —
they are access decisions, not implementations.

### Needs your authorization

1. **Turn on a hosted Reviewer — two variables, nothing to deploy.**

   ```
   RELAY_OPENAI_REVIEWER_MODE=live
   RELAY_OPENAI_REVIEWER_MODEL=<a model you are willing to pay for>
   ```

   `OPENAI_API_KEY` is already set in production for the Prompt Architect, and
   this uses the same credential. Independence holds: the coding agent is
   Anthropic and this Reviewer is OpenAI.

   Two things are deliberately NOT defaulted, and both cost money. The mode,
   because reusing an existing credential for a second paid role should be a
   decision. And the model, because a model is what a review costs and how good
   it is — Relay will not pick one for you.

   It shares the `openai-gpt` independence group with the OpenAI architect on
   purpose: a deployment that ever runs an OpenAI CODING agent is refused this
   Reviewer automatically.

   **Deploying the Hermes service (DFA-001) is now optional.** It remains the
   better Reviewer if you want a structurally read-only harness rather than a
   provider API, and everything on Relay's side for it is merged and proven
   offline — remote transport, a matching preflight, mission wiring — but it is
   no longer the only way to have a hosted Reviewer.

   Do not set both `RELAY_HERMES_MODE=remote` and
   `RELAY_OPENAI_REVIEWER_MODE=live`. Relay refuses rather than choosing, so
   you never read a verdict from a component you did not pick.

   **`RELAY_ROLE_REVIEWER` may be left unset here, and that is now correct
   rather than merely tolerated.** Setting the mode is you naming the Reviewer
   once; Relay follows that statement instead of applying its own development
   default. What it will NOT do is let the two disagree — setting
   `RELAY_ROLE_REVIEWER=hermes_local` while the provider mode is live is
   refused before any spend, naming both variables.

   This is a correction to what this document told you earlier. The two
   settings were never reconciled, so the configuration recommended above used
   to run the review on OpenAI and attest `hermes_local` — the mission
   narrating one occupant while another did the work. Fixed, with the failing
   case held by a mission-level test.

2. **Set the role variables on Railway.** `RELAY_ROLE_CODING_AGENT` and
   `RELAY_ROLE_REVIEWER` are unset, which is why `/relay-api/health` reports
   `roleSlotsBound: false` with `no_occupant_requested` for both. That is
   truthful, not broken: production has named no occupant.

   This item used to end "setting them, plus `ANTHROPIC_API_KEY` and
   `RELAY_HOSTED_CODING_MODEL`, is what makes a hosted three-role mission
   possible". That list was incomplete: naming a Reviewer does not configure
   one. `openai_reviewer` requires `RELAY_OPENAI_REVIEWER_MODE`,
   `OPENAI_API_KEY` and `RELAY_OPENAI_REVIEWER_MODEL`, and
   `hermes_remote_service` requires a deployed service. You would have met a
   refusal naming the missing variable — actionable, and still an errand this
   document sent you on.

   **The complete minimum, given what production already has:**

   ```
   RELAY_ROLE_CODING_AGENT=claude_agent_sdk_hosted
   ANTHROPIC_API_KEY=<yours>
   RELAY_HOSTED_CODING_MODEL=<a model you are willing to pay for>
   RELAY_OPENAI_REVIEWER_MODE=live
   RELAY_OPENAI_REVIEWER_MODEL=<a model you are willing to pay for>
   ```

   The architect is already configured. **`RELAY_ROLE_REVIEWER` is deliberately
   absent from that list** — setting the mode is you naming the Reviewer once,
   and Relay follows it rather than applying its own default. Set it only if
   you want it to agree with the mode; a contradiction is refused before any
   spend, naming both variables.

3. **Decide whether a real Loop agent is worth building.** `loopEngine` reads
   `no_agent_named` because the only agent this build ships SIMULATES its
   iterations, and production refuses it by design. A Loop that runs is a Loop
   agent away, and that is a product decision rather than a wiring gap.

### Buildable without you, in value order

**All four are now done.** Items 4 through 7 are struck through and kept rather
than deleted, because three of them had the wrong diagnosis and the correction
is the useful part — a list that only showed the answers would hide that the
question was wrong twice.


4. ~~**A Reviewer occupant that needs no installed binary.**~~ **DONE** —
   `openai_reviewer`, merged. It turned out the credential was already in
   production and only the occupant was missing, which is why this moved from
   "buildable" to "done" in one pass. See item 1 above for the two variables.

5. ~~**The remaining two run engines.**~~ **RESOLVED, and the earlier entry
   here had the diagnosis wrong.** It said `ReviewerRunPort` and
   `HostedCodingRunPort` were `null` "because neither has an implementation to
   construct". Both implementations exist and both already run:

   - The **hosted Coding Agent** is constructed at `mission.ts:436` and runs as
     a mission's coding leg, inside a prepared workspace, producing the diff.
   - The **Reviewer** runs at `mission.ts:1387`, over a packet built from that
     diff, through whichever transport is configured — local Hermes, a remote
     Hermes service, or the provider Reviewer at `mission.ts:429`.

   What the two ports actually lack is not an engine but an **input**. A hosted
   run needs a prompt and a workspace; a review needs a packet. Neither route
   carries one — both accept ids only. So a standalone lifecycle is not a
   missing wire, it is a second path that would run the same engines over
   inputs it would have to invent, under separate run state, reviewing the same
   artifact twice.

   Both routes therefore stay refused, and the refusals were rewritten: they
   used to say the engine was "not configured", which sends an operator hunting
   for a variable nobody ever wrote. They now say no configuration enables the
   route and name the mission path that works. Two tests hold that line.

   One consequence worth knowing: `relay reviewer start` reaches
   `/reviewer/start` and therefore cannot succeed against a hosted bridge. It
   now fails with an accurate reason instead of a misleading one. Reviews still
   happen on every mission automatically.

6. ~~**Evidence metering.**~~ **DONE.** `relay_live_reach` now declares the
   `usage` verb, so `operatorPromises().budgetable` is true and a cap over
   retrieval is a cap rather than a hope.

   The unit is retrievals and bytes, never money — there is no cost field
   anywhere in `live-reach-metering.ts`, and a test keeps one from arriving.
   What took the work was what Relay cannot know:

   - a host that ANSWERED — including a 429 or a 401 — counted the request, so
     Relay counts it too. Being rate limited is not free.
   - a host that never answered is recorded as **unconfirmed**, never as spent
     and never as free. The budget charges it anyway, because the other
     direction makes an unreachable host a way to retry without limit.
   - a refusal Relay made itself leaves the meter completely untouched,
     timestamps included.
   - bytes are `null` until something is measured, and a byte cap over a total
     that cannot account for every read is reported **unenforceable** rather
     than quietly allowed.

   Observable at `GET /relay-api/live-reach/usage/<missionId>` (operator auth,
   free, touches no network). A budget is named per request; absent means none.

   One defect fell out of building it: the server passed no service to the Live
   Reach route, so the route built a fresh one per request while missions used
   the long-lived one — two meters, and a cap that reset on every call. Both
   now share the single service constructed in `main()`.

   Known limit, stated rather than implied: meters live in memory, so a restart
   forgets them and a budget binds within a process rather than across one.

7. ~~**A production caller for skills.**~~ **DONE — and the reason it took a
   different shape than this entry first proposed is worth reading, because
   building it the obvious way would have made Relay less honest.**

   The mission's evidence leg now runs `relay.evidence.gather` through
   `evaluateInternalSkillCall` before anything leaves the machine, so the
   catalogue is enforced at run time rather than being a declaration nothing
   consulted. What follows is why it does NOT go through the MCP permission
   model. Three facts, each checkable:

   - The capability names the skills declare — `relay.live_reach.retrieve`,
     `relay.workspace.read`, `relay.workspace.write` — appear **nowhere else in
     the repository**. No MCP server offers them, no snapshot contains them, no
     grant references them.
   - `evaluateSkillCall` ends at `evaluatePermission`, and the only production
     caller of that is `mcp-gateway.ts:249`, which evaluates a real connection
     to an EXTERNAL MCP server. The only registry entries that exist are
     `MCP_REGISTRY_FIXTURES`, which are simulations and say so.
   - Relay's own internals are not MCP capabilities. Live Reach retrieval is
     judged by `evaluateLiveReach`; a workspace write is judged by the mission's
     write scope. Those are the permissions that actually decide.

   So calling a skill through the MCP permission model would mean registering
   an MCP server for Relay's own internals, with an approved snapshot nobody
   approved, to satisfy a gate whose real answer is already given elsewhere.
   That is the "second judgment system" the direction explicitly rules out —
   and it would report `capabilityExistsInSnapshot: false`, so it would deny
   every skill anyway until somebody made the snapshot up.

   **BUILT, the correct way.** `evaluateInternalSkillCall` takes the governing
   verdict as a PARAMETER, so it cannot be called without having already asked
   whoever actually governs the operation. It contributes only what the skill
   layer uniquely knows — the role narrowing, the declared capability list, and
   `skillChangesSomething` — and there is no path through it that returns `ok`
   while the governor says no. Skills over EXTERNAL MCP capabilities still go
   through `evaluatePermission`, because there the snapshot and the grants are
   real. One narrowing implementation serves both, so the two cannot drift.

   The mission's evidence leg now runs `relay.evidence.gather` through it
   before anything leaves the machine, which is what turned the catalogue from
   a document into something enforced.

   **What this does NOT buy, stated so nobody reads more into it:** the role at
   that call site is constant — the architect is the only thing that gathers
   evidence — and the architect is permitted, so the role axis cannot refuse
   there today. What it does buy is proven by mutation: removing `architect`
   from `permittedRoles` in the real catalogue drops the mission to zero
   retrievals and records the refusal. Renaming the capability or bumping the
   version does the same. A second caller with a different role will arrive at
   a gate that already exists.

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
