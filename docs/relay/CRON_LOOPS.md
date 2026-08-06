# Cron Loops — architecture decision

**Status: GRAMMAR + PURE EVALUATOR + CLAIM/OVERLAP/MISSED-RUN DECISIONS
+ FILE-BACKED CLAIM ADAPTER + THE TICK PASS AND AN AUTHENTICATED TICK ENDPOINT IMPLEMENTED. NO SCHEDULER
AND NO TIMER: NOTHING CALLS THE TICK ON A SCHEDULE, AND A SCHEDULED RUN IS
CREATED BUT NEVER DISPATCHED.**

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
`relay-bridge/cron-routes.ts` exposes `POST /relay-api/cron/tick` —
operator-only, flag-gated, explicit `authorized: true`, server-clocked.

WHAT A TICK STILL DOES NOT DO, because a surface would guess generously:

- **Nothing calls it on a schedule.** There is no timer and no scheduler
  process. `GET /loop/capability` reports `cronScheduled: false` so no
  surface can infer one from the endpoint's existence.
- **A scheduled run is created, never advanced.** Three independent reasons:
  `createRun` is synchronous and cannot await the engine; the run carries
  `creationSource: 'schedule'`, which the Loop service turns into
  `trigger: 'cron'`; and `preflightLoopDispatch` refuses a cron trigger. The
  response says `dispatched: 0` as a claim about the code path.
- **There is no schedule store.** Every schedule field arrives in the request
  body. No `RelayLoopSchedule` exists anywhere; nothing lists, pauses or
  versions a schedule. This ships a manual tick over a caller-declared
  schedule, not a Cron Loop product.
- **Queue policies are refused.** No occurrence queue exists, so `queue_one`
  (this document's documented default) and `queue_all` answer 422
  `no_queue_exists` rather than promising an enqueue nothing performs.

**A NAMED DEVIATION from "server authority" above:** `afterExclusive` — the
window's START — is client-supplied, and this document says a client-supplied
time field must never influence due-ness. What bounds it today: the window's
END and the evaluation instant are server-clocked; the eight-day evaluation
limit refuses anything wider; the missed-run policy caps catch-up; the route
is operator-only and needs explicit authorization; and the durable claim
marker makes a replay free rather than a double dispatch. The durable
watermark that would close the deviation belongs to the schedule store that
does not exist yet. The
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

Every Cron Loop carries an explicit **IANA timezone** (`America/Los_Angeles`).
A bare numeric UTC offset is a validation failure for recurring schedules. The
timezone is shown before confirmation.

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

Creating a schedule does **not** grant permanent approval to every future
operation. Seven approval scopes are distinguished: schedule creation,
read-only recurring work, one external write, recurring external writes,
deployment, financial operations, credential access. A recurring grant is
time-limited **and** argument-scoped.

A Cron Loop may inspect issues. It may not merge arbitrary pull requests unless
a policy authorizes that exact operation class. It may prepare a deployment. It
may not deploy without deployment authority, rollback policy and approval.

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

## Versioning

Editing a Cron Loop creates a new contract version, preserving the previous
schedule and contract, the change author and time, and which runs came from
which version. An in-progress run continues under the version it started with.
Changing the future schedule never mutates an active run.

## Cron S-Loops

**Default: unavailable.** The `cron_sloop` flag is off and depends on `sloop`,
which depends on `unchain`.

Four future policies are possible: require an active Unchain at trigger time;
reserve one Unchain at confirmation; ask before consuming an Unchain; or use an
enterprise-granted scheduled entitlement. Until the founder approves exact
behaviour the policy stays configurable, defaults to unavailable, and **never
hardcodes automatic Unchain consumption**.

## Not implemented

The in-bridge scheduler and its timer · execution of a trigger-created run
(the record is created; nothing advances it) · the schedule store, and
therefore schedule listing, pausing and versioning · the occurrence queue,
and therefore the `queue_one` and `queue_all` overlap policies · period
budget caps · recurring approvals · circuit breakers · schedule
versioning · conditional Cron Loops · the Cron UI.

Cron expression semantics, timezone handling, DST resolution, the occurrence
identity, the claim-before-effect sequence, overlap policies, missed-run
policies and the file-backed claim adapter ARE implemented (see status
above) — listed apart because an
implemented stage left on this list is an invitation to rebuild it.
