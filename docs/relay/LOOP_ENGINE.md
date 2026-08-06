# The Relay Loop Engine

**Status: COMMAND FOUNDATION IMPLEMENTED. SINGLE-LOOP RUNTIME IMPLEMENTED,
OFFLINE, DEFAULT OFF. NO LOOP HAS RUN IN PRODUCTION.**

Those are four different claims and this file keeps them apart, because the
previous version of this line said "RUNTIME NOT IMPLEMENTED" for three commits
after the runtime landed — which is the same defect as a comment describing a
gate the code does not have, pointed the other way.

What exists:

- the grammar, the target contract, the Loop Contract foundation, the blocker
  model, the completion-trust rules and the feature gates;
- a durable **single-Loop iteration runtime** — one Loop, one role
  (`coding_agent`), one adapter — with journal-as-authority persistence, a
  node lock, recovery, redaction and an offline proof;
- authenticated bridge routes for capability, status, inspect, history,
  confirm, pause, resume and stop;
- CLI commands that reach those routes for a named run, and a website composer
  and run panel over the same shared projections.

What does not exist: a scheduler, Cron execution, multi-agent orchestration,
swarms, Unchain, and any form of Loop creation from the website.

**No Loop has run outside a test.** The engine is default OFF
(`RELAY_LOOP_ENGINE_ENABLED`), nothing is deployed with it on, and every agent
call in every proof goes to a deterministic scripted fake that is structurally
incapable of reaching a network, a process, a provider SDK, a credential or a
real clock.

A command that parses is not a Loop that ran, and a runtime that exists is not
a runtime anyone has run.

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

## The background worker

A run's journal, snapshot and lock survive a restart; `loop-worker.ts` is what
PICKS IT UP. `runLoopWorkerPass` does ONE bounded pass — discover, claim,
advance, release, report — and returns what it did. It is deliberately not a
scheduler, a queue or a daemon: the thing that decides how often to run is
somebody else's decision, which is what makes the pass testable without
waiting.

Every defect a worker can add is a CLAIM defect, so the pass refuses five ways:

- It never claims a lock a LIVE owner holds, and treats a lock on another host
  as live — cross-host liveness is unknowable, and reclaiming would run the
  same iteration twice. An iteration is a paid dispatch.
- An UNREADABLE lock is not a free one; it may be a live owner mid-write.
- Every run it looked at appears in the report with why it was skipped. A
  worker that skips silently is indistinguishable from one with nothing to do —
  the second is fine, the first is an outage.
- One bounded pass: at most `maxRuns` claims, at most `maxIterationsPerRun`
  advances each, and `capacityReached` says whether it stopped early or ran out
  of work — different facts a caller must be able to tell apart.
- The lock releases AFTER the engine has journalled. A crash between them
  leaves a stale lock and a complete journal, which recovery reads; the other
  order leaves a claimable run whose last iteration is gone.

The engine seam is one function, `LoopAdvanceFn`, bound to the real engine by
`bindLoopAdvance`. The pass is TOTAL and labels every failure as what it was:
a throwing `release()` is reported as `release_failed` and the pass continues;
an engine failure is `advance_failed`, never a context problem; a refusal is
DECLINED, not advanced — five refusals used to read as "advanced 5", a
busy-looking pass that did no work; a duplicated discovery claims the run once
and names the duplicate; and a failed discovery returns an empty REPORT rather
than a rejected promise, because a pass that dies silently is indistinguishable
from one that never ran.

NOT WIRED: nothing schedules a pass yet — no daemon, no cron, no CLI verb
invokes it. That is the next stage, not a footnote.

**PRECONDITION FOR WIRING, found by review and not yet fixed:** the persistence
lock's stale reclaim is not atomic. Two same-host processes can both observe
`stale_owner_dead`; the loser's unconditional rename then displaces the
winner's LIVE lock and both acquire. `acquireRunLock` also reclaims UNREADABLE
locks, which this worker refuses — so a naive binding would leak the
primitive's policy through the worker's refusal. `lock.ts` needs a post-acquire
ownership re-read (or a guarded rename) before any two workers run against the
same state root.

## The pass planner

The worker executes ONE bounded pass; `loop-scheduler.ts` decides what the
pass should touch. `planLoopPass` is PURE — no clock, no filesystem, no
dispatch: it takes a snapshot of runs and emits a plan (which runs, in what
order, with what per-run iteration grant) for a caller to feed to
`runLoopWorkerPass`. A plan is an argument about fairness, and an argument you
cannot test without waiting is one nobody will ever check.

The defect class at this layer is STARVATION — a run that never gets a turn is
a silent skip one level up — so the plan holds five rules:

- **Least-recently-advanced goes first.** Recency of attention, not creation:
  a noisy new run must not shoulder past a quiet old one. A run never advanced
  has had the least attention of all and sorts oldest.
- **A timestamp that does not parse — or names no explicit UTC offset — is
  refused BY NAME** (`unreadable_timestamp`), not guessed at. Mapping an
  unparseable one to "oldest" would hand a corrupt journal permanent first
  place, a NaN inside the comparator breaks sort transitivity, and an
  offset-less timestamp parses as HOST-LOCAL time — each makes
  "deterministic" silently false. Ties break in CODEPOINT order, not
  `localeCompare`: locale is a hidden input a pure planner must not have.
- **A budget that is not a budget is `invalid_budget`**, kept apart from
  `no_remaining_budget` — "spent its budget" and "budget is corrupt" are
  different facts, and folding the second into the first masks journal
  corruption as routine exhaustion.
- **Every run in the snapshot is accounted for**: claimed, or excluded with a
  reason (`paused`, `terminal`, `recovery_required`, `no_remaining_budget`,
  `invalid_budget`, `unreadable_timestamp`, `invalid_options`,
  `capacity_reached`). "The pass will get to it" is how starvation hides.
- **Invalid options refuse the whole plan as `invalid_options`**, the repair
  loop's bound rule again — and they do NOT set `capacityReached`, because
  "the planner refused to plan" and "the plan was too small for the work" are
  different outages.
- **Same snapshot, same plan.** Ties break on runId, so two planners given one
  snapshot cannot argue.

The grant never exceeds the run's own `remainingIterations` — a schedule is
not permission to overspend.

NOT WIRED: nothing composes planner and worker yet — no daemon, no cron. The
lock-reclaim precondition above still gates any second concurrent worker.

## Staffing a resolved target (`/loop all`)

`resolveLoopTarget` decides WHO; `confirmLoopRun` creates ONE run for one
decision. `loop-target-confirmation.ts` is the layer between them: a confirmed
multi-role target becomes ONE RUN PER RESOLVED ROLE, all under one Loop, via
`confirmLoopRunsForTarget`. The fan-out refuses four ways:

- **Nobody resolution did not staff.** `resolvedRoles` is the whole guest
  list; unavailable roles — including `unknown`, which never staffs — ride the
  report verbatim as `unstaffed`.
- **No collapsing two roles into one decision.** Each role's confirmation
  derives its own request id (`<requestId>#<role>`), so its own idempotency
  key and its own derived run id. The store's one-key-one-run invariant stays
  true, and a retry converges to the same runs as duplicates instead of
  minting a second team.
- **One role's failure never cancels the rest** — each failure is reported
  beside the successes, per role. Created runs are not rolled back: they are
  durable and idempotent, so the honest recovery is a retry that converges.
- **N budgets are not one.** The budget is PER RUN; the report totals the
  authorized spend caps in integer micros, or answers `null` when the total
  cannot truthfully be stated — any cap unbounded, or a duplicate run whose
  stored cap is not canonical micros.

Refusals come BEFORE anything durable exists: a spend cap `BigInt` would
throw on, a negative cap, or a base request id using the reserved `#` refuse
the whole decision with nothing created — a refusal after durable creation is
a report that dies mid-way, after spend was authorized. A store backing that
throws mid-confirmation is that role's named `store_failure`, never a lost
report; and a resolver that repeated a role does not double-count an
authorization.

Which role a run was created for is recoverable from its durable idempotency
key through `staffedRoleOf` — a stated contract, not a string someone parses
by accident. It is the confirmation's INTENT; the observed role still arrives
only with `loop.agent_assigned`, and a key naming no known role answers
`null`, because unknown is not guessed at.

NOT WIRED: the bridge still confirms a single run per decision and parks the
other roles in a side map; pointing it at `confirmLoopRunsForTarget`, and
staffing agent ports for the non-coding roles, is the wiring this replaces —
a follow-on change, reviewed as such.

## Observing a run

A drafted Loop and a running one are different questions, and the surfaces
answer them differently on purpose.

**A command that NAMES a run reaches the server.** `relay loop status <run-id>`
asks what a run is doing; it does not describe the command back to you.
`inspect` and `history` are the same. On the website, `/loop status <run-id>`
opens the run panel — **and in this build that panel has no session to ask.**

Be exact about that, because "opens the run panel" on its own would imply a
reading it cannot do. `RelayLoopSurfaceHost` renders the panel only when the
host supplies BOTH a port and a store, and **no shipped host supplies either**:
the website has no operator credential and no browser-session plumbing for Loop
routes. So the surface a user reaches today says, in as many words, that it has
no Relay Bridge session and is claiming nothing about any run that may exist.
That is a truthful state rather than a broken one — and it is the state, not
the panel, that ships. A command with **no** id stays with the preview, because
"your current Loop" is not something a client can resolve — there is no local
notion of one, and inventing a default would be the surface guessing.

**Reading is free and needs no authorization.** Pausing, resuming and stopping
change what a run does with money and with a workspace — resuming in particular
is an authorization of *more* work, not the resumption of something already paid
for. Each therefore needs `--authorize` **and** an `--idempotency-key` the
caller mints. A key generated by the CLI would be new on every attempt, so a
retry after a timeout would arrive as a second decision with nothing for the
server to match it against: that is how one intended stop becomes two recorded
ones. Reuse the same key when retrying; mint a new one only for a new decision.

**The website may read a run and may not control one.** It has no operator
credential and no way to get one, so `pause`, `resume` and `stop` do not open
the run surface there at all — rather than opening it with controls that would
fail.

### Three rules the run panel exists to hold

1. **Animation follows the server, never the click.** Only the state class the
   server reported may animate, and only `active` does. Not a timer, not an
   optimistic flag set when Start was pressed, not "we sent a request and have
   not heard back". Each of those produces a spinner that keeps spinning after a
   run has failed — the commonest way a product lies about background work, and
   the user's only clue is that it never stops. A run *waiting* on approval or
   budget is making no progress, so it does not animate either.

2. **Restoration is a read, not a cache.** Across a refresh the browser persists
   exactly one thing: `{runId, loopId}`. Everything else is fetched. A cached
   projection would survive the refresh and show a finished run as still
   running, with nothing to tell the user it was stale. A stored id whose run
   the server cannot answer for is cleared, not drawn from memory.

3. **A control that cannot act is not drawn.** Controls come from the
   projection, which knows whether each is permitted and why not; and a control
   whose handler the host did not supply is omitted entirely rather than
   rendered dead. A `Stop` that silently does nothing tells a user a run was
   stopped while it is still spending.

**A transport failure is never drawn as a run failure.** "Relay could not reach
the bridge" and "the Loop failed" are different facts with different fixes, and
the panel keeps them in separate regions with different words.

## Not implemented

Scheduler WIRING (the pass planner exists; nothing invokes it) · agent slots ·
work stealing · critical-path scheduling · scheduler telemetry · the watchdog ·
multi-Loop concurrency ·
multi-role BRIDGE WIRING (staffing exists — `confirmLoopRunsForTarget` creates
one run per resolved role; the bridge still creates a single run and drives
one role, `coding_agent`) · Cron scheduling
(grammar only — see `CRON_LOOPS.md`) · Unchain (see `UNCHAIN.md`) · S-Loop
runtime · swarm branches · convergence · Rechaining · Loop templates ·
marketplace integration · starting a Loop from the website.

The iteration runtime and durable Loop persistence **are** implemented — they
were listed here for three commits after they landed, which is the same defect
as a comment describing a gate the code does not have, and worse, because it
invites the next session to rebuild what exists.
