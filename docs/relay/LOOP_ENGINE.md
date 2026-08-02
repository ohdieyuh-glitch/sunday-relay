# The Relay Loop Engine

**Status: COMMAND FOUNDATION IMPLEMENTED. RUNTIME NOT IMPLEMENTED.**

What exists today is the grammar, the target contract, the Loop Contract
foundation, the blocker model, the completion-trust rules and the feature
gates — plus the CLI and composer surfaces that render them. **No Loop has ever
run.** There is no iteration runtime, no scheduler and no multi-agent
orchestration in this repository.

A command that parses is not a Loop that ran.

---

## Why Relay is loop-first

Relay should make persistent compound-agent work more normal than repeatedly
prompting an AI. The user should think *"keep doing this until the condition is
met"*, not *"remember to ask again tomorrow"*.

Chat remains, for small and conversational requests. Loop-first is not
chat-removed, and the two paths meet at exactly one seam (see **Routing**).

## The commands

```
/loop                                open the Loop Composer
/loop <objective>                    draft a Loop for the active compound agent
/loop all <objective>                every eligible agent
/loop team <objective>               alias of `all`
/loop architect <objective>          the Prompt Architect
/loop coding <objective>             the Coding Agent
/loop reviewer <objective>           the independent Harness Reviewer
/loop architect,coding <objective>   several roles at once

/loop status|inspect|pause|resume|stop|history [loop-id]
/loop templates
/loop help
/loops                               the Loop catalog

/loop schedule                       the Scheduled Loop Composer
/loop schedule <when and what>       a recurring Loop, in plain language
/loop cron "<expr>" <objective>      the advanced, explicit form
/loop schedules                      list Cron Loops

/sloop [objective]                   a Swarm Loop — requires Unchain
/sloop status|inspect|converge|stop [loop-id]
/sloop help
```

The same grammar reaches the CLI as argv: `relay loop all "fix the parser"`,
`relay loops`, `relay sloop converge lpe_a`. A literal slash command also works:
`relay "/loop all inspect and repair the project"`.

### Role aliases

| Canonical role | Accepted words |
|---|---|
| `prompt_architect` | `architect`, `prompt-architect`, `prompt_architect`, `planning` |
| `coding_agent` | `coding`, `coder`, `code`, `coding-agent`, `coding_agent` |
| `reviewer` | `reviewer`, `review`, `harness`, `harness-reviewer`, `harness_reviewer` |
| every eligible role | `all`, `team` |

Relay has **three** agent roles, derived from the canonical `MissionRole`.
Research is a Prompt Architect capability, testing is a Coding Agent tool
capability, and verification is a Relay and Reviewer capability — none of them
is a role. Aliases for roles that do not exist (`research`, `testing`,
`security`) are deliberately absent: an alias that resolves to a role Relay
cannot staff would let a command claim a target that can never be filled.

## One parser

`parseSlashCommand` in `src/relay/mission/loop/loop-command-parser.ts` is the
only grammar. The website composer, the CLI, future mobile surfaces, help
output and every test call it. There is no second implementation to keep in
step.

### Routing

```
input begins with "/"   →  the canonical slash grammar
anything else           →  the existing deterministic command interpreter
```

`routeRelayInput` is that decision, made in one place. A surface that
hand-rolled `startsWith('/')` would be a second grammar in disguise, and a test
asserts the composer does not.

### The four ordered rules

Applied to the first token after the command word:

1. a **schedule verb** (`schedule`, `cron`, `schedules`) → scheduling;
2. an **action verb** (`status`, `pause`, `help`, …) → act on a Loop;
3. a **target expression** → target plus objective;
4. anything else → objective, default target.

Rules 1 and 2 are closed word sets. Rule 3 fires when **any** comma-separated
entry is a known role word, so `/loop architect,qa …` reports the bad role
rather than swallowing it into the objective, while `/loop refactor,cleanup …`
stays an objective.

**The honest limit:** when *no* entry is a role word, `qa,ops fix it` and
`refactor,cleanup the parser` are the same shape and nothing distinguishes a
misspelled target from prose. Both are read as objectives. A target that
survives parsing but names nothing real is caught by role resolution against
the registry — the layer that can actually answer.

### What it refuses to guess

- A natural-language schedule is preserved **whole**. Splitting "every weekday
  at 8am" from "inspect the repository" needs real schedule parsing, which is a
  later stage.
- Cron semantics are never interpreted. `99 99 * * *` parses. Field ranges,
  day-of-week spellings and timezones belong to the schedule stage.

## Parsing is not execution

A parsed command authorizes nothing. It has no filesystem, network, provider,
clock, journal or entitlement access — proven structurally by reading the
sources, not by asserting that the calls a test happened to make were harmless.

A successfully parsed command must still pass authentication, workspace
authorization, feature flags, role availability, budget validation, permission
checks, approval checks and Mission preflight.

**Nothing is spent because a command parsed.** A command that requests
execution produces a preview the user must confirm.

## Requested is not actual

`/loop architect,coding fix it` **requests** two roles. Whether they are
configured, connected, and actually answering are three further questions with
three further fields:

| Field | Meaning |
|---|---|
| `requestedRoles` | what the user asked for, preserved even when unstaffable |
| `resolvedRoles` | what the registry could staff |
| `unavailableRoles` | what it could not, and why |
| `assignments[].actualAgentId` | who actually answered — `null` until observed |

**Unknown availability is never resolved.** Staffing a Loop on a missing answer
is how a slot ends up appearing to work when nothing is there.

## Truthful blockers

> No eligible slot is idle while useful runnable work exists unless Relay can
> produce a real blocker, or determine that additional parallel work would be
> unsafe or useless.

Maximum utilization is **not** claimed and is not mathematically guaranteed.
What is enforced is the right-hand side: an idle slot carries a blocker, and a
blocker comes from something real.

A `RelayLoopBlocker` has no free-text constructor. It is built either from a
**failed check** in the existing pre-execution battery
(`coordination/eligibility.ts`), carrying that check's id and detail verbatim,
or from one of a closed set of **modelled runtime conditions**. A UI cannot
invent a third.

Reasons: `waiting_dependency` · `waiting_approval` · `waiting_evidence` ·
`waiting_checkpoint` · `budget_blocked` · `rate_limited` · `missing_model` ·
`missing_tool` · `unavailable_role` · `workspace_conflict` ·
`file_ownership_conflict` · `provider_unavailable` · `feature_disabled` ·
`duplicate_work_suppressed` · `unknown_blocker`.

Because the mission layer may not import `../coordination`, the domain declares
the shape it needs and a composition root passes the real value. A test that
may import both proves the two cannot drift apart.

## Completion is earned, not claimed

The Aquala trust vocabulary is load-bearing:

```
claim     — the actor reported something about its own work
observed  — a supervisory system saw it, without attesting identity
attested  — a trusted supervisory source or adapter produced attestation
verified  — Relay or an authorized verification system validated evidence
```

Only **`attested` or `verified`** evidence may support completion. A model's
assertion enters as `claim` and yields `claimed_complete` — the Loop keeps
going.

A Loop completes only when every one of these holds:

1. blocking criteria supported by attested or verified evidence;
2. no iteration ended in an unconfirmable state;
3. the mission verdict is `verified_complete`;
4. no blocking findings are open;
5. any required independent review ran, approved, and was structurally
   independent;
6. the terminal state has been durably written.

`budget_exhausted` and `timed_out` are **not** `completed`. Reaching a limit is
a truthful stop, not a success.

## Feature gates fail closed

| Flag | Depends on | Default |
|---|---|---|
| `loop_engine` | — | off |
| `loop_scheduler` | `loop_engine` | off |
| `loop_cron` | `loop_scheduler` | off |
| `unchain` | — | off |
| `sloop` | `unchain` | off |
| `cron_sloop` | `sloop` | off |

Only the literal boolean `true` enables. An absent record, an absent key,
`undefined`, the string `'true'`, the number `1` — all off. A dependent flag
does nothing without its prerequisite: a swarm with no Unchain is not a swarm,
and a scheduler with no engine is a timer with no supervision.

## Where things live

```
src/relay/mission/loop/          PURE domain, browser-safe
  loop-command-parser.ts         the one grammar
  loop-command-types.ts          the AST
  loop-roles.ts                  aliases, target selectors
  loop-target.ts                 requested vs resolved vs actual
  loop-blockers.ts               the truthful blocker model
  loop-contract.ts               the Loop Contract foundation
  loop-completion.ts             completion trust
  loop-availability.ts           feature gates + the Unchain gate
  loop-preview.ts                the ONE projection both surfaces render
src/relay/cli/loop-cli.ts        argv → the same slash string → the same preview
```

Re-exported through `src/relay/mission/index.ts` for the same reason economics,
worktrees, the coding agent, the prompt architect and the reviewer harness are:
the CLI boundary permits only the bare `../mission` path, and both surfaces
must normalize through the same parser rather than each growing their own.

## Not implemented

Loop iteration runtime · durable Loop persistence · the work-conserving
scheduler · agent slots · work stealing · critical-path scheduling · scheduler
telemetry · the watchdog · Cron scheduling (grammar only — see `CRON_LOOPS.md`)
· Unchain (see `UNCHAIN.md`) · S-Loop runtime · swarm branches · convergence ·
Rechaining · Loop templates · marketplace integration.
