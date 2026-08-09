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
| Founder machine, nothing configured | runs (development defaults) |
| Founder machine, live architect + Claude Code + Hermes | **runs — the full three-role mission** |
| Hosted, `RELAY_PROMPT_ARCHITECT_MODE=fusion` + `RELAY_BRIDGE_FAKE_CLAUDE=1` | runs — the keyless offline pipeline, no spend |
| Hosted, `fusion` + `RELAY_ROLE_CODING_AGENT=claude_agent_sdk_hosted` | a real, API-billed coding run with no Reviewer — **but only where `FUSION_BASE_URL` reaches a running Sunday Alcatraz.** Production still publishes the localhost default, so today this fails at `architect_unavailable` before the Coding Agent is reached |
| Hosted, live three-role | **cannot run.** The hosted Reviewer is still not dispatchable — the mission's reviewer leg spawns a local Hermes and does not use the remote transport |

Production today refuses with `role_binding_refused`, **naming the variables to
set** — where before it said `coding_agent_not_ready`. No capability is lost.

## 5. What is NOT done

| # | Requirement | State |
|---|---|---|
| 1 | Production-hosted three-role execution | **Not done.** Architect hosted; Coding Agent and Reviewer are not |
| 2 | Swappable role slots | **Substantially done.** Registry, fail-closed binding, requested-vs-actual identity, dispatchability. Hosted EXECUTION of the swapped occupants is not |
| 3 | Real workspace path | **Partially present already** — see §6 |
| 4 | Evidence & Retrieval on MCP + Brain | **Not started** |
| 5 | Skill Ops capabilities | **Not started** |
| 6 | Adapter plumbing verbs | **Partially present.** `ports.ts` declares `descriptor` + `execute`; the other verbs exist unevenly across connectors, not as one contract |
| 7 | Research Loops | **Not started.** The Loop Engine exists; `createLoopService` still has no production caller |
| 8 | GraphRAG / LangChain / LangGraph | **Not started.** No retrieval, embedding or vector code exists in the repo |
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
