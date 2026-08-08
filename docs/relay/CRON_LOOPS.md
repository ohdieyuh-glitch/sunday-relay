# Cron Loops — architecture decision

**Status: GRAMMAR + PURE EVALUATOR + CLAIM/OVERLAP/MISSED-RUN DECISIONS
+ FILE-BACKED CLAIM ADAPTER + THE TICK PASS + A DURABLE SCHEDULE STORE + AN
AUTHENTICATED TICK ENDPOINT AND THE SCHEDULE FAMILY (CREATE, LIST, PAUSE,
EDIT, DELETE)
IMPLEMENTED, PLUS AN IN-BRIDGE SCHEDULER THAT IS OFF BY DEFAULT. A SCHEDULED
RUN IS CREATED AND NEVER DISPATCHED, WHETHER AN OPERATOR OR THE TIMER ASKED.**

`/loop schedule`, `/loop cron`, `/loop schedules` parse today and produce typed
commands. `src/relay/mission/loop/cron/` now holds the schedule stage this
document approved: `cron-expression.ts` (five-field semantics, refusals by
field and token), `timezone-port.ts` (the injected `TimezonePort` with its
Intl adapter — zero/one/two instants per local minute),
`cron-occurrences.ts` (the pure evaluator: deterministic occurrence identity
per the formula below, both DST rules, bounded windows, named refusals, said
truncation), `cron-claim.ts` (the claim-before-effect sequence below, pure
over an injected `OccurrenceClaimPort`), `cron-overlap.ts` (overlap policies,
unknown fails closed) and `cron-missed.ts` (missed-run policies; high-risk
work never auto-caught-up, whatever the policy says).
`src/relay/persistence/cron-claim-node.ts` is the file-backed
`OccurrenceClaimPort`: the guarded run lock per occurrence directory, an
claim marker written all-or-nothing, exclusively and DURABLY (fsynced temp +
no-clobber link — the at-most-once authority must survive a crash), a durable
trigger journal, and path-shaped occurrence ids refused. The lock answer is
WIDENED (the follow-up its review named, closed before anything loops on
it): `held` retries, `blocked` carries the remove-it-by-hand problem,
`failed` names the IO — classified by inspection, never by message-matching.
`cron-tick.ts` composes the five pieces into one pure bounded pass
(`runCronTick`): dispatch claims BEFORE creating, an overlap skip claims
(handled-without-a-run), queue/replace/refused do not claim, overlap state
evolves within the tick, and every due occurrence lands in the report with
its outcome. `relay-bridge/cron-service.ts` binds it to the real ports (the Loop run
store, the file-backed claim adapter, the Intl timezone port, and
`confirmLoopRun` with `creationSource: 'schedule'`), and
`relay-bridge/cron-routes.ts` exposes `POST /relay-api/cron/tick` plus the
schedule family — `POST` and `GET /relay-api/cron/schedules` and
`POST /relay-api/cron/schedules/:id/pause` and
`POST /relay-api/cron/schedules/:id/edit` and
`POST /relay-api/cron/schedules/:id/delete` — all operator-only, flag-gated,
server-clocked, with explicit `authorized: true` on everything that writes.

WHAT A TICK STILL DOES NOT DO, because a surface would guess generously:

- **A timer may call it, and only if switched on.** The in-bridge scheduler
  (`relay-bridge/cron-scheduler.ts`) is gated on its own flag, on Cron, on the
  Loop engine and on a mounted state root — four switches, all off by default.
  `GET /loop/capability` reports `cronScheduled` as what is actually true
  rather than a constant, so a surface reads the state instead of inferring it.
  A pass creates run RECORDS and dispatches nothing: automatic creation is not
  automatic execution.
- **A scheduled run is created, never advanced.** Three independent reasons:
  `createRun` is synchronous and cannot await the engine; the run carries
  `creationSource: 'schedule'`, which the Loop service turns into
  `trigger: 'cron'`; and `preflightLoopDispatch` refuses a cron trigger. The
  response says `dispatched: 0` as a claim about the code path.
- **A stored schedule PINS the binding its runs are attributed to.** It is
  given at creation and carried in the contract version, and a tick that sends
  one is refused by name like any other field the schedule owns. While the
  binding arrived with the TICK it was also part of the occurrence claim key,
  so the durable marker protected a (schedule, binding) pair rather than the
  schedule: review measured three ticks over one identical window, differing
  only in `binding`, producing nine runs — six of them in the same Loop for the
  same three hours. Rebinding is an EDIT, so it appends a version and the runs
  already created keep explaining themselves.
- **Every occurrence-CONSUMING overlap policy is refused.** The rule: no
  policy may durably consume an occurrence on the strength of a run that is
  not actually working. That excludes `queue_one` (this document's documented
  default) and `queue_all`, which would promise an enqueue no queue performs;
  and it excludes `skip`, whose meaning is "a run is live, drop this
  occurrence" — a drop that is irreversible, because the claim marker exists
  to refuse the replay, made against a record that never runs. Servable:
  `parallel_with_limit` and `replace`, which answer capacity and
  replace-pending WITHOUT claiming. The first version served `skip` and
  steered callers to it; across ticks it permanently ate every occurrence
  after the first, with one inert run to show for it.
- **The overlap count is runs that are EXECUTING**, not runs that are
  unfinished. A scheduled run is created `queued` and never advanced here, so
  counting it as occupancy saturated the count at the first tick and wedged
  the endpoint forever. A run that starts leaves `queued` and counts from
  that moment, so this stays correct when dispatch lands.
- **The occurrence identity's first term is the schedule id itself.** The
  approved formula assumes that id is globally unique, and within the namespace
  that matters it is: the claim markers share one flat namespace per state root,
  and that root holds exactly one schedule per id. The bridge USED to qualify
  the term with (project, workspace, loop), from the days when a schedule was
  caller-declared and two projects could both say "daily-triage". With the
  binding read from the very schedule the id already names, that qualification
  could no longer distinguish anything — while it could still MOVE under a
  rebinding, making every marker written under the old binding unreachable.
  An identity term that varies with mutable data is how a handled window gets
  replayed, so the qualification is gone rather than contained.

**A NAMED DEVIATION from "server authority" above:** `afterExclusive` — the
window's START — is client-supplied, and this document says a client-supplied
time field must never influence due-ness. What bounds it today: the window's
END and the evaluation instant are server-clocked; the eight-day evaluation
limit refuses anything wider; the missed-run policy caps catch-up; the route
is operator-only and needs explicit authorization; and the durable claim
marker makes a replay free rather than a double dispatch. The durable
watermark that would close the deviation belongs to the schedule store, which
exists now (`src/relay/persistence/cron-schedule-node.ts`) and does not hold
one yet: what bounds the window today is the governing version's own
`authoredAt`. The
`loop_cron` feature flag is off and depends on `loop_scheduler`, which
depends on `loop_engine`.

This document records the approved beta architecture so the runtime stage does
not have to relitigate it.

---

## What a Cron Loop is

A recurring or scheduled **Relay Loop** — not an operating-system cron command.
A Cron Loop schedules a bounded Loop Contract through Relay's ordinary Mission
runtime, agent scheduler, permissions, approvals, spending limits, MCP gateway,
plugin policies, Project Brain, Trace Ledger, evidence system, reviewer gates,
completion rules and recovery system.

**Cron does not create a bypass around Relay governance**, and it never permits
arbitrary unaudited shell execution. The parsed schedule type carries no
command-string field at all — that is a type-level guarantee, not a runtime
check.

## Terminology

| Term | Meaning |
|---|---|
| Cron Loop | a recurring or scheduled Relay Loop |
| Cron Loop Contract | the scheduled definition |
| Cron Loop Run | one scheduled execution |
| Trigger | one schedule occurrence |
| Missed Run | a failed or skipped occurrence |
| Loop Timezone | the schedule's explicit IANA timezone |

## The scheduling decision

The repository has **no database, no queue and no scheduler primitive**.
Runtime dependencies are eight packages, none of which is a datastore. Durable
state is an append-only NDJSON journal plus derived snapshots on a mounted
volume (`src/relay/persistence/`), and the only leasing primitive is a file
lock (`src/relay/persistence/lock.ts`).

Options considered, against what actually exists:

| Option | Verdict |
|---|---|
| Database-backed scheduling | **Rejected for beta.** No database exists. Adding one introduces a dependency, a second migration system beside the journal's, and a second source of truth. Correct later at multi-tenant scale; wrong as the first step. |
| Queue-delayed jobs | **Rejected.** No queue exists, and at-least-once delivery would make idempotency load-bearing on day one. |
| Railway cron as the source of truth | **Rejected.** Platform cron is a waker, not durable schedule truth. |
| A separate scheduler process | **Deferred.** The pattern exists (`relay-hermes-service/`), but a second process needs its own deploy, auth and volume mount, and would race the bridge for the same file locks. |
| **In-bridge scheduler over the existing journal** | ✅ **APPROVED for beta.** |

### The approved shape

- **Relay's journal and snapshots remain the source of truth.** Always.
  `src/relay/persistence/cron-schedule-node.ts` is that store: one directory
  per schedule holding an append-only version journal and a derived snapshot.
  The JOURNAL is the authority and the snapshot is a cache — a read replays
  the journal and never trusts the snapshot's contents, so a stale, missing
  or wrong snapshot cannot make a schedule report a version its own history
  never recorded. An edit goes through `planScheduleEdit` rather than a second
  copy of that rule. A schedule can be created, listed and paused through the
  endpoints; EDITING exists in the store only, so a stored schedule has the one
  version creation gave it. The tick endpoint READS one, and a request that sends a field the schedule
  owns is REFUSED rather than having it ignored. A request now says WHICH
  schedule to tick and
  over what window, while the expression, timezone, contract and version are
  the schedule's own. A caller can no longer run one schedule's window under
  rules it invented, a missing schedule is a 404, and a PAUSED or CORRUPT one
  is refused rather than partially evaluated. An operator can create, list and
  pause schedules through `/relay-api/cron/schedules` — creating and pausing
  need the same explicit authorization a tick does, and the AUTHORING INSTANT
  is the server's, because a caller who could backdate a version would own
  moments that predate it and hand back the replay the clamp prevents. The
  window's start is CLAMPED to
  the governing version's authoring instant, so an edit cannot replay an
  already-handled window: the occurrence identity carries the contract
  version, and without the clamp a new version gave every past occurrence a
  fresh identity and a fresh claim — six runs for the same three hours. Every write holds the guarded run lock and
  a corrupt journal interior is REPORTED rather than truncated — truncating
  let the next edit mint a duplicate version, which is the ambiguity the edit
  decision exists to refuse. The registry does not declare these files as
  shared domain references: that field names modules BOTH surfaces import,
  and the browser may never reach `src/relay/persistence`.
- The **in-bridge scheduler** may dispatch occurrences during beta. The bridge
  is the only component with continuous uptime, the mounted volume
  (`RELAY_DATA_DIR`) and the operator credential.
- **Occurrence claiming** uses a generalized run-lock plus an atomically
  written, persisted claim marker.
- **Railway cron may wake the scheduler** via an authenticated tick endpoint.
  It must never define occurrences, hold state, or be required for correctness.
- **Postgres and queues are not required** for the initial beta.
- **Distributed multi-worker scheduling is not claimed for beta.** Saying so is
  better than implying otherwise.
- Define an **`OccurrenceClaimPort`** so the file-backed adapter can be replaced
  later without touching the scheduler.

Do not build a database or a queue for the parser stage.

## Server authority

Scheduling is controlled by the server. It must not rely on browser timers, an
open tab, device time, client-side intervals, the user's laptop being online,
or the CLI staying open.

A client-supplied time field must never influence due-ness. That is a test, not
a convention.

## Idempotency

Every occurrence gets a deterministic identity:

```
occurrenceId = digest(scheduleId ‖ contractVersion ‖ intendedLocalInstant ‖ resolvedUtcInstant)
```

`intendedLocalInstant` disambiguates daylight-saving duplicates;
`resolvedUtcInstant` pins the shift; `contractVersion` stops an edited schedule
colliding with its predecessor's occurrences.

**Claim before effect:**

```
1. acquire the occurrence lock
2. if the claim marker exists → already handled → exit
3. write the claim marker atomically
4. append the trigger-claimed journal event
5. only then: preflight, budget check, run creation
```

Resolved-instant TIES exist and are at most two: a spring-forward shift can
land on an instant the schedule also matches natively (intended `02:00`
shifted to `03:00`, beside a native `03:00`). They are two INTENTS with two
identities — Vixie-cron-consistent — and the claim step treats them as two
triggers, never deduplicates them by instant.

A trigger creates **at most one** Cron Loop Run. This protects against
scheduler retries, duplicate delivery, restart during dispatch, two workers
claiming one occurrence, a network timeout after successful creation, a manual
`run-now` colliding with a scheduled trigger, and daylight-saving duplicate
local times.

A retry must not start a second run, double-charge, duplicate an external
action, consume a duplicate approval, or produce conflicting mission records.

## Timezones

Every Cron Loop carries an explicit **IANA timezone naming a PLACE**
(`America/Los_Angeles`). The timezone is shown before confirmation. Three rules
are enforced, at creation and again at the tick, because a stored schedule can
outlive the rule that admitted it:

1. A bare numeric UTC offset (`+05:30`) is a validation failure.
2. The name must be **Area/Location**. This refuses the single-word IANA names
   (`Japan`, `EST`, `Singapore`) too — they ARE IANA names, so the refusal says
   "not an Area/Location timezone name" rather than claiming otherwise. Write
   `Asia/Tokyo`.
3. The name must resolve into ICU's list of real locations
   (`Intl.supportedValuesOf('timeZone')`). This refuses `Etc/GMT±N`, which is a
   fixed offset, and all thirteen `SystemV/*` zones, which are frozen at the
   pre-1987 US ruleset — six of them do observe daylight saving, so they are
   refused for having rules that no longer follow the place they name, not for
   being fixed. Where that list cannot be read the zone is refused as
   unverifiable, which says so rather than blaming the zone.

`UTC` is accepted: it names no location and is deliberately admitted, because a
Loop meaning "midnight UTC" is not drifting.

- **Spring-forward** (the local time does not exist): default to the next valid
  local time, and record that the occurrence was shifted.
- **Fall-back** (the local time occurs twice): execute **once**, using the
  deterministic occurrence identity above.
- **Changing a timezone** creates a new contract version and never rewrites
  historical triggers.

`Intl.DateTimeFormat` with a `timeZone` option is the only IANA-aware primitive
available without a new dependency, so the pure schedule evaluator should be
written against a small injected `TimezonePort`. That keeps the domain
clock-free and makes adding a timezone library a one-adapter decision rather
than a rewrite.

## Overlap policies

`skip` · `queue_one` (**default**) · `queue_all` (bounded) · `replace` (safe
stop-or-checkpoint first) · `parallel_with_limit` (bounded).

**An unknown overlap policy fails closed.** Relay must not silently create
unlimited overlapping AI-agent runs.

## Missed-run policies

`skip_missed` · `run_latest` (**default**) · `run_all_with_limit` ·
`require_confirmation`.

Configurable: maximum catch-up age, maximum catch-up runs, whether
external-write work requires renewed approval, whether stale monitoring work is
discarded.

**External-write, deployment and financial work is never auto-caught-up**,
whatever the policy says. Relay must not run days of stale high-risk operations
because a worker was offline.

## Budget and approvals

Every Cron Loop supports per-run, per-day, per-week and per-billing-period cost
caps, token and provider-call caps, a maximum simultaneous-run count, a
reserved Reviewer budget, an emergency global guard and an automatic pause
threshold.

Before dispatch, Relay verifies authorized budget. If there is not enough: do
not start paid execution, record `budget_blocked`, notify, compute the next
eligible trigger truthfully, and **never treat a blocked run as successful**.
Unknown cost remains Unknown; zero never substitutes.

`cron-budget.ts` implements that decision: `authorizeScheduledSpend` checks
every window, the emergency guard, the simultaneous-run ceiling and the
automatic pause threshold, and reports EVERY failing reason rather than the
first. A bounded cap over an UNKNOWN spend refuses — substituting zero is how
an unmetered schedule passes a spend check — and a reserved Reviewer
allowance is subtracted from headroom before the comparison, because a run
that eats the money its own verification needs produces an unreviewable
result and a bill. An UNKNOWN run cap refuses against a bounded window for
the same reason an unknown spend does — review found declaring it Unknown was
strictly more permissive than declaring any number.

WHAT IT DOES NOT COVER, named rather than implied: **token caps and
provider-call caps are not implemented here** (the run's own budget carries
them; nothing cross-checks them against a window), and neither is the
"notify, compute the next eligible trigger truthfully" half of the rule above
— a blocked decision is returned, and no caller notifies or re-computes
anything. It is also NOT WIRED: the tick does not consult it, and nothing
observes spend-to-date to feed it.

Creating a schedule does **not** grant permanent approval to every future
operation. Seven approval scopes are distinguished: schedule creation,
read-only recurring work, one external write, recurring external writes,
deployment, financial operations, credential access. A recurring grant is
time-limited **and** argument-scoped.

A Cron Loop may inspect issues. It may not merge arbitrary pull requests unless
a policy authorizes that exact operation class. It may prepare a deployment. It
may not deploy without deployment authority, rollback policy and approval.

`cron-approvals.ts` implements that decision. A grant covers ONE scope and
never widens — a read-only grant is not a write grant, and a one-external-write
grant is not a recurring one, which is why the spec separates them. A recurring
grant with NO expiry is refused rather than read as forever: an endless grant
is precisely the permanent approval the paragraph above denies. It is
argument-scoped, and an EMPTY argument scope covers nothing rather than
everything. `schedule_creation` authorizes no operation at all, and an operation naming NO
arguments is refused rather than vacuously permitted. Deploying needs all three
prerequisites, and any one missing means Relay may prepare a deployment and no
more.

**NO GRANT REACHES PAST A BOUNDARY STOP ACTION.** `financial_operations` and
`credential_access` run into `new_financial_commitment` and `secret_export`,
which stop execution in every mode including Autonomous. UNCHAIN.md says an
unattended agent runs under the same seventeen, and mode policy is a ceiling an
approval does not raise — an approval records that a human wanted the work, not
that the boundary moved. Consumption of a single-act grant is returned as an
OBLIGATION for the caller to record; this decision is pure and marks nothing.

NOT WIRED: nothing consults it, and no grant is stored anywhere.

## Circuit breakers

A schedule pauses automatically on repeated consecutive failures, repeated
authentication failures, MCP revocation, provider unavailability, a cost
threshold or spike, repeated reviewer rejection, external rate limiting,
repeated duplicate external actions, a disappeared repository or workspace, an
organization membership change, a security policy change, or reduced credential
scopes.

The user must see why it paused, the last safe run, the last failure, the
required action, **whether any external effect occurred**, and whether manual
review is required. Resuming requires the condition to re-evaluate clean.

`cron-breakers.ts` implements that decision. The external-effect answer is
THREE-VALUED — occurred, did not, or UNKNOWN — and Unknown is never rendered
as "no": a confident "no external effect" the code cannot support is what
ends an investigation that should have happened, so Unknown requires the same
human review that a known effect does. Access and policy changes (MCP
revocation, repeated authentication failures, organization membership,
security policy, reduced credential scopes) always require review, because a
schedule cannot tell whether the change was intended. A condition that could
not be READ neither trips nor clears: it does not pause the schedule on its
own, and it does block a resume, because unobserved is not clean and resuming
on silence is resuming on an assumption.

**AN OPEN QUESTION, NOT A DECISION MADE HERE.** What a schedule should do when
NONE of its breakers can be read is not settled by this document. The first
implementation answered "keep running" and wrote that answer into this
section in the same commit, then cited it as though it were approved — review
caught the circularity. The evaluator now returns a third state,
`unobserved`, distinct from both running and paused, so the caller chooses
with the facts in front of it. **Founder decision needed:** should a schedule
whose breakers are entirely unreadable keep running, or stop? Everything else
in this repository that meets an unknown fails closed.

A malformed reading is refused rather than read as "unknown" — a producer's
typo must not downgrade a real trip into carry-on — and a condition that is
external BY DEFINITION (repeated duplicate external actions, external rate
limiting) reported alongside "no external effect" is refused as
contradictory rather than answered.

NOT WIRED: nothing observes these conditions or consults the verdict.

## Versioning

Editing a Cron Loop creates a new contract version, preserving the previous
schedule and contract, the change author and time, and which runs came from
which version. An in-progress run continues under the version it started with.
Changing the future schedule never mutates an active run.

`POST /relay-api/cron/schedules/:id/edit` exposes it: the same validation a
create gets, from the same reader so the two cannot drift, with the server's
clock for the authoring instant. The response NAMES what changed, diffed from
the history the store returned so it describes the version that landed. Pausing
is not an edit and cannot be reached through it — `paused` is a refused field,
so a schedule is stopped by the control that stops it.

It passes the planner THIS SCHEDULE'S runs, and reports the ones still
unfinished. A run records the schedule that created it — `confirmLoopRun` refuses a
schedule-created run that does not name one, because the run id is a digest of
the occurrence and does not reverse, so nothing could attribute it afterwards.

The Loop-wide list it used to have was wrong in both directions: two schedules
may bind one Loop, so it reported another schedule's runs as this one's, and
once that schedule moved to a new version its runs cited a version this history
lacked and every future edit was refused as orphaning.

The scan covers EVERY LOOP the schedule has ever named, not just its head's:
`loopId` is a versioned field, so runs made before a rebinding live in the Loop
that version named.

WHAT CANNOT BE ATTRIBUTED IS COUNTED, never dropped. Four cases reduce to
Unknown rather than to "not ours": a run that reads back as nothing; one whose
journal is torn or corrupt, which does NOT read back as null but as a partial
record; one that never got its IDENTITY, because only `loop.run_created`
confers it and a record can sit durably at the event before it, carrying the
seed's `api` default; and a schedule-created run written before runs recorded
their schedule. Each would otherwise let an edit report a clean list over this
schedule's own unfinished work.

The runs it names are UNFINISHED, which is not the same as running: nothing in
this build advances a scheduled run, so none of them has been dispatched. They
are normally `queued`; an operator control can move a run out of that state, so
the claim is about dispatch rather than about the state.

`cron-versioning.ts` implements that decision. An edit APPENDS: every previous
version rides through unchanged, including the one being superseded, whose
schedule is what explains its own runs. `governingVersionFor` resolves a run
to the version it STARTED under and answers `null` — not the head — when the
run cites a version the history lacks. The plan returns the active runs the
edit must not disturb rather than leaving a caller to infer them, and it names
which fields changed, because a version whose diff nobody can state is a
version nobody can review. Refused: an unattributed edit, an authored-at
without an explicit offset, a history with a REPEATED version, a run citing an
unknown version, and an edit that changes no schedule or contract field.
GAPS are accepted — a run citing v4 in [1, 2, 4] resolves unambiguously, and
an earlier version refused gaps on a stated reason that was simply untrue.
The store holds the history this appends to, and the tick reads its head. What
is still missing is the EDIT path: nothing calls `planScheduleEdit` from a
surface, so a stored schedule has exactly the one version creation gave it.

## Cron S-Loops

**Default: unavailable.** The `cron_sloop` flag is off and depends on `sloop`,
which depends on `unchain`.

Four future policies are possible: require an active Unchain at trigger time;
reserve one Unchain at confirmation; ask before consuming an Unchain; or use an
enterprise-granted scheduled entitlement. Until the founder approves exact
behaviour the policy stays configurable, defaults to unavailable, and **never
hardcodes automatic Unchain consumption**.

## Deleting a schedule

Deletion frees the id, and purges the occurrence claims the schedule made.

It READS NOTHING FIRST, deliberately. The case that motivates deletion is a
schedule too CORRUPT to read — a journal written before a required field
existed, or a zone no evaluator resolves — and every other operation replays
before acting. Until deletion existed, such a record could only be removed by
editing the volume by hand.

THE ID COMES BACK, and an earlier design of this said it must not. The worry
was that claim markers survive deletion, are keyed on a digest including
`scheduleId` and `contractVersion`, and would be inherited by a schedule
recreated under the same name — its occurrences reading as already handled,
which is the mirror of a replay. Measured, that collision is unreachable: a
recreated schedule is authored NOW, and the tick clamps its window to its own
authoring instant, so it can only own moments that postdate its creation. A
tombstone would have burned the name permanently to prevent something that
cannot happen, and reclaiming one would have meant editing the volume by hand —
the very remedy deletion exists to abolish.

The claims are purged regardless, as defence in depth, so a freed id leaves
nothing behind that has to be reasoned about. Only this schedule's claims: a
marker naming another schedule is left alone, because removing it would replay
that schedule's handled windows. The purge is counted and reported.

The claims go FIRST and the schedule LAST. A crash between them leaves a
schedule that still reads, so the delete can simply be run again; the reverse
would leave orphaned claims under an id nothing remembers.

Deleting a schedule does not touch the runs it created: they keep their own
records and stay attributed to the version they started under. Whether any are
still UNFINISHED is not checked — a run records its schedule now, so it could
be, and deletion simply does not ask. Nothing in this build advances a
scheduled run, so an unfinished one has not been dispatched — it is normally
`queued`, though an operator control can move it out of that state.

This is also the remedy for a schedule the tick refuses on rules that arrived
after it was stored — a fixed offset, a `SystemV/*` zone, a single-word IANA
name, or a version predating the binding.

## The in-bridge scheduler

A Cron Loop is only recurring if something asks. `relay-bridge/cron-scheduler.ts`
is that something: a timer inside the bridge, off unless
`RELAY_LOOP_CRON_SCHEDULER_ENABLED=1`, which also needs Cron on, the Loop engine
on and a state root mounted. Four switches, all off by default — a background
process nobody chose is worse than none.

`planSchedulerPass` decides what a pass covers and is pure: it holds no clock,
reads no disk and performs no tick. The bridge owns the effects.

A PASS LOOKS BACK RATHER THAN REMEMBERING. There is no durable per-schedule
watermark, so a pass cannot ask what it already did — it asks again. The claim
marker makes a replayed occurrence `already_handled` rather than a second run,
so an overlapping window costs nothing and a missed pass is caught up by the
next one. The lookback is a CATCH-UP BOUND, not a schedule, and it can never
exceed the evaluator's own window limit.

THE LOOKBACK IS DERIVED FROM THE INTERVAL, not fixed. A window narrower than the
gap between passes does not even OFFER that gap to the evaluator, so
`schedulerLookbackMinutes` takes two intervals of headroom, floored at fifteen
minutes and capped by the evaluator's own limit.

THE WINDOW IS NOT THE THING THAT BOUNDS CATCH-UP, and an earlier version of this
section said it was. Re-measured against the derived window: a per-minute
schedule with a hundred occurrences due still produced FIFTY runs, exactly as
before. `PARALLEL_LIMIT_PER_PASS` caps run creation at five per schedule per
pass whatever the window holds — the window decides what is offered, that limit
decides what is taken. A backlog therefore drains at five per pass and no
faster, and the surplus is reported as `capacitySkipped` rather than implied by
a smaller number. Widening the lookback alone does not make a long interval
safe.

IT IS BOUNDED THE OTHER WAY TOO, and the bound ROTATES. A pass ticks at most a
stated number of schedules, because the bridge answers requests on the same
event loop that walks them. The first version walked from the beginning every
time, and since the store lists ids sorted, a deployment with more schedules
than the cap ticked the same first ones forever and never reached the tail —
reported as `skipped`, as though the next pass would take it. A pass now resumes
after the last schedule it reached, so the cap DEFERS rather than starves, and
the deferred ids are named in the report and in the log.

A PASS IS ALSO BOUNDED BY THE RECORDS IT CREATED. Every overlap policy needs to
know how many of a Loop's runs are executing, and answering that walks the
Loop's run records and replays each journal. Nothing in this build advances a
scheduled run and nothing prunes one, so that walk grows without limit on the
event loop that answers `/health` — 115 ms at a hundred records, 390 ms at seven
hundred, paid every pass whether or not anything was due. Two bounds close it:
each Loop's count is read at most once per pass, and a Loop holding
`MAX_RUN_RECORDS_PER_LOOP` (200) records is refused rather than grown — that
constant counts EVERY run record in the Loop, including an operator's own, which
is what its name says and what the cost actually follows. The
residual worst case is arithmetic on the shipped constants — 25 distinct Loops
at the ceiling ≈ 2.8 s of counting per pass — which is bounded and still past a
health-check budget. A cheap index of executing runs is the real fix and is not
built.

**A LOOP AT THE CEILING STOPS RECURRING, AND STAYS STOPPED.** Nothing in this
build reduces a run count: no run is advanced, none is pruned, and no route
deletes one. This is a STOP, not a pause that clears itself, and it is reached
in about three hours by a per-minute schedule and eight days by an hourly one.
Because it is that severe, it is not reported as a number: the refusal carries
`run_records_at_ceiling` by name and the deployment log says the schedules have
stopped and will not resume on their own. **The remedy is to edit the schedule
so it binds to a fresh Loop** — an edit appends a version, and the runs already
created keep explaining themselves under the version they started with. That
path is tested end to end rather than described.

**AND THE REMEDY IS A TREADMILL, WHICH IS THE PART A READER WOULD NOT INFER.**
The fresh Loop refills at exactly the same rate, so until a run record is
prunable this is a RECURRING operator action every ~200 runs — every few hours
for a per-minute schedule. It also gets slower each time: the edit route replays
the journal of every run in every Loop the schedule has ever named, so each
rebind makes the next edit more expensive. Nothing about the ceiling is a
solution; it is a bound on a cost, bought with an operator's time.

**IT REACHES NO SURFACE BUT THE DEPLOYMENT LOG.** A founder on the website
cannot learn that a Cron Loop has permanently stopped — only someone reading
Railway logs can. `cronScheduled` stays true and stays truthful, because it is a
bridge-level fact and not a per-schedule one. Carrying per-schedule health onto
a route is listed under *Not implemented* rather than left to be discovered.

A REFUSAL IS A REASON, NOT A COUNT. Eight distinct causes used to arrive as one
integer — a bad timezone, an unparseable expression, a vanished schedule, and a
Loop that had permanently stopped were indistinguishable. Each refusal now
carries `vanished_or_paused`, `no_version`, `zone_not_tickable`,
`expression_unparseable`, `run_records_at_ceiling`, `unreadable_instant` or
`evaluator_refused`, and a corrupt schedule is named separately from a paused
one all the way to the log — a paused schedule is a choice and stays quiet, a
corrupt one needs a human and does not.

ONE PASS AT A TIME, for a RE-ENTRANT CALLER. A pass is fully synchronous, so a
`setInterval` callback cannot begin while one is executing — Node fires the
timer late instead. The guard therefore protects a host that calls `runOnce`
from inside `onPass`, and it is stated that way rather than advertised as
protection against an overrunning timer, which cannot happen in this shape.

A REFUSED TICK IS NOT A TICK. The evaluator's refusals are the authority — an
unresolvable zone, a window it will not accept — and such a schedule is
reported as refused rather than counted as done.

THE TIMER REFUSES WHAT THE OPERATOR TICK REFUSES. `relay-bridge/cron-tickability.ts`
is the one gate both callers use. They disagreed at first, and review reproduced
it: three schedules the endpoint answers 422 for — a fixed offset, a `SystemV/*`
zone and a single-word IANA name — produced nine runs under the timer, at
instants that drift an hour twice a year. Those are exactly the schedules this
document tells an operator to edit or delete because they will not run.

WHAT A PASS SAYS IT DID NOT DO. An occurrence durably claimed with no run behind
it, an occurrence the overlap limit dropped, a truncated occurrence list, a
truncated schedule listing, a deferred schedule and a caught failure each reach
the log. The first version logged ticks, creations and refusals only, so a pass
that deferred five schedules or claimed an occurrence without a run printed a
line indistinguishable from a clean one — and a pass that threw printed nothing
at all, which is what a healthy idle bridge prints.

`GET /loop/capability` reports `cronScheduled` FROM THE SCHEDULER OBJECT, not
from the flags. The flags are necessary and not sufficient: the timer also needs
a mounted state root, and an absent volume is deliberately not fatal, so a
bridge with both flags set and no volume boots, runs no timer, answers 503 on
the tick — and used to tell every surface it was scheduled.

## Not implemented

Execution of a trigger-created run
(the record is created; nothing advances it) · listing
PAGINATION: the listing replays at most 200 schedules and reports `truncated`
truthfully, but nothing can reach schedule 201, so with more than 200 stored an
operator cannot learn whether the ones past the cap are paused or corrupt — and
since the automatic pass reads the same listing, schedule 201 is not merely
invisible, it never runs. The pass reports `listingTruncated` so the loss is at
least stated · a durable per-schedule watermark (the pass rotation lives in
memory, so a restart begins the walk at the first schedule again, and a bridge
restarting more often than one full rotation never reaches its tail) ·
PER-SCHEDULE HEALTH ON A ROUTE: a schedule stopped by the run-record ceiling is
named in the deployment log and nowhere a surface can read, so the website
cannot tell a founder that one of their Cron Loops has permanently stopped ·
run-record PRUNING, whose absence is what makes that ceiling terminal and its
remedy recurring · a cheap index of EXECUTING runs, whose absence is why the
count is walked at all ·
the occurrence queue,
and therefore the `queue_one` and `queue_all` overlap policies · period budget-cap ENFORCEMENT (the
decision exists; nothing observes spend-to-date to feed it) ·
recurring-approval STORAGE and enforcement (the decision exists; no grant is
persisted and nothing consults it) · circuit-breaker OBSERVATION (the decision exists;
nothing feeds it and nothing pauses a schedule) · conditional Cron Loops · the Cron UI · token and provider-call
caps at the schedule level · notification and next-eligible-trigger
computation on a blocked run.

Cron expression semantics, timezone handling, DST resolution, the occurrence
identity, the claim-before-effect sequence, overlap policies, missed-run
policies and the file-backed claim adapter ARE implemented (see status
above) — listed apart because an
implemented stage left on this list is an invitation to rebuild it.
