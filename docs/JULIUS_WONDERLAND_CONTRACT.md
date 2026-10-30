# The Julius → Wonderland contract

**What this is.** The read surface Wonderland may draw a Julius mission from, and
the rule that governs it: **the Julius runtime is authoritative and the UI is a
consumer.** Wonderland renders what this surface says. It never derives a
conclusion Julius did not reach, and it never holds state Julius does not hold.

**What this is not.** It is not a Wonderland change. No file under `wonderland/`
is touched by it, and none needs to be: this document plus
`JuliusRuntimeApi.inspectSlots` is the interface, so the session that owns the
Wonderland client can consume it without a merge against this lane.

---

## The surface

Everything is on `src/relay/mission/julius/julius-runtime-api.ts`
(`JuliusRuntimeApi`). It is transport-neutral on purpose — no HTTP, no
framework, no serialization — and every method takes an identity as its FIRST
argument and refuses before it reads anything.

| What Wonderland must represent | Where it comes from | State today |
|---|---|---|
| mission state | `inspectRun` → `JuliusRunView.state` | **served by the API** |
| C.A.R.D. lifecycle | `JuliusRunView.cardRevision`, `missionContractRevision` | revisions only; the policy body is not exposed |
| Agentic Architect state (the `PROMPT_ARCHITECT` role) | `inspectSlots` → `JuliusSlotView` | **new** |
| Coding Agent state | `inspectSlots` → `JuliusSlotView` | **new** |
| Independent Reviewer state | `inspectSlots` → `JuliusSlotView` | **new** |
| provider identity | `JuliusSlotView.providerId`, `requestedModel`, `servedModel` | **new**, and null where the provider was silent |
| usage / cost where known | `JuliusSlotView.knownUsdMicros` + `costComplete` + `unknownCostComponents` | **new**, as a FLOOR |
| errors | `JuliusSlotView.lastFailureClass`, plus `timeline` | **new** per slot |
| evidence | `inspectEvidence` | served |
| verification | `inspectVerification` | served |
| repair | `inspectTasks` (a repair is a task; `repair:<stage>` is its type) | served |
| completion | `inspectRun` → state `COMPLETED`, and `run.completed` on the timeline | served |
| Project Brain references | `JuliusRunView.projectBrainRevision` | a revision only; entries are not exposed |
| C.A.R.D. slot occupancy history | `timeline` | raw rows |

## The four rules a client must implement, because the shape enforces them

1. **`null` is Unknown and renders as Unknown.** Never `0`, never a default,
   never the requested model shown as the served one. Every nullable field in
   `JuliusSlotView` is nullable because the runtime genuinely may not know.
2. **A cost is a FLOOR unless `costComplete` is true.** Paid run 34414726976
   settled $0.608861 on a mission whose architect and both reviewer calls
   reported nothing. A client that sums `knownUsdMicros` across slots and labels
   it a total publishes a figure three components short. Label it "at least".
3. **`NEVER_DISPATCHED` is a state, not an empty row.** Early in a mission two of
   three slots are in it. A client that draws an empty row as "idle" tells the
   founder a worker is waiting when nothing has ever asked it to work.
4. **Ordering is `sequence`, never `occurredAt`.** Several events of one mission
   routinely land in the same millisecond, and a wall-clock sort has no
   deterministic tiebreak. `lastSequence` is the ledger position the store
   allocates on append.

## How it is served

**`GET /relay-api/julius/runs/<runId>/<view>`** on the bridge, where `<view>` is
one of `run`, `slots`, `tasks`, `evidence`, `verification`, `result`, `timeline`.
Operator `Bearer` credential; `X-Relay-Tenant` and `X-Relay-Project` headers name
the scope, never the path. Read-only: any other method answers 405.

**Every answer is `JuliusRuntimeApi`'s own, verbatim.** `relay-bridge/julius-state-routes.ts`
maps a path to a method and a refusal to a status code, and computes nothing
about a mission. The API is composed over the SAME `createJuliusPostgresRuntimeStore`
the mission job writes through, so there is still exactly one state authority —
Julius's durable rows — and this is a second READER of it, not a second writer
and not a second opinion.

**With no `DATABASE_URL` the family answers 503 and names the variable.** It never
answers an empty run. "No durable state is reachable from this process" and "this
mission has done nothing" are different facts, and a client that confused them
would tell a founder their mission had done nothing. This is the one deployment
decision the mount needed — the long-lived HTTP server now holds a read
connection to Julius's store when configured — and it is made fail-closed rather
than assumed.

**Refusals a client will see and must render as what they are:** `401
operator_required`; `503 julius_state_unavailable` (with the missing variable);
`404 run_not_found` — and a run that exists but belongs to another project
answers the same 404, deliberately, so the route cannot be used to enumerate
other tenants' run ids.

## How a mission is created

**`POST /relay-api/julius/missions`**, operator `Bearer`, body = a mission
contract exactly as the contract file is written (`missionId`,
`markerNamespace`, `projectId`, `tenantId`, `objective`, `requirements`,
`constraints`, `acceptanceCriteria`, `testCommand` — empty when the mission
declares no deterministic check — `workspacePath`, optional `limits` and
`research`). It is validated by the contract file's own parser, so there is no
second schema for a client to drift from.

**Creation is the bootstrap and nothing more.** The run lands durable in `READY`
with its plan and build tasks, its task contract as revision 1 DRAFT, its
criteria and its seed brain — through the same port the mission job uses, over
the same store — and the read routes above can watch it from that moment. The
response says what was not done: `dispatched: false`. Nothing composes a
provider, spends money or ticks the loop; **driving the run is the job's**, and a
client that rendered "created" as "running" would draw a mission nobody is
driving.

**A run's identity is its `runId`; `missionId` is the mission's name.** The
bootstrap's idempotency key is a digest of the contract's CONTENT — the mission
job's own rule, so that re-running the same file resumes the same durable run
rather than paying for a second mission. Re-posting the same bytes therefore
answers with the same `runId` and the run's real state; a contract that differs
in any field is a new run, and the earlier run stays exactly where it was. A
client correlates by `runId` only, never by `missionId`; a user who edits a
draft and resubmits has created a second run, and the client must follow the
`runId` it was given. Whether Julius should refuse a second run while an
earlier run of the same mission is still READY or EXECUTING is a product
decision not taken here. The `409 mission_already_running` below fires only
when the same key arrives with a different payload, which a content-derived
key does not produce in practice.

**`result` is the view to SHOW A USER**, and the one a client should reach for
before assembling its own answer from `evidence` + `verification` + `run`. It
carries: `verified` (true only when the run reached `COMPLETED` — the runtime's
decision, quoted, never recomputed), `terminal`, every acceptance criterion with
`satisfied`, `basis` and the evidence ids that satisfy it — `basis: 'EVIDENCE'`
means every required type is present and PASSED, `basis: 'COMPLETION'` means the
criterion names no evidence (the bootstrap seeds such criteria deliberately) and
is therefore satisfied only by the mission completing; do not read a
`COMPLETION`-basis criterion as met before `verified` is true — the `deliverables` (the PASSED
rows that are a product — a diff, an artifact, a test result — never a reviewer's
finding, each with `retained: false` when no body was kept rather than reading as
an empty one), `outstandingFindings` (why it is not verified), `reviewDecisions`
(so "who verified this" has an answer), `cost` (`knownUsdMicros` beside
`unknownComponents` and `complete`, never a zero standing in for unknown), and
`failure` — `null` only when there is none: a FAILED or CANCELLED run always
names a reason, `UNRECORDED` if the record somehow holds none.

**Where the database comes from.** The bridge reads `JULIUS_DATABASE_URL`
first and `DATABASE_URL` after it, from its own launch environment; with
neither, every Julius route answers `503` naming both. The real-PostgreSQL test
suites read **neither** — they read `JULIUS_TEST_DATABASE_URL`, which must name
a throwaway database — so a machine whose profile exports a `DATABASE_URL` for
the live store can never have a test suite write into it.

**One active run per mission, unless somebody meant two.** A second, DIFFERENT
contract for a mission that still holds a non-terminal run is refused
`409 mission_run_already_active`, and the message names the run that holds it —
follow that `runId`. An identical contract is unaffected: its key is its own
content, so it resumes the run it already made. A terminal prior run (`FAILED`,
`COMPLETED`, `CANCELLED`) holds nothing and never locks a mission, and the guard
is per mission — one mission's live run never blocks another's.

**The explicit rerun.** Send `x-relay-julius-rerun: explicit` **and**
`x-relay-julius-rerun-key: <one stable token per intended rerun>`. Both are
required: the intent must come from a human act (an operator flag, a rerun
affordance) and never from a retry default, and the KEY is what makes the rerun
identifiable — one token means one rerun however many times the request is sent.
Without it the answer is `400 rerun_key_required`, because nothing derived from
durable state can stand in: a rerun changes that state as it lands, so a derived
discriminator would let the retry buy a third execution (measured). Anything but
the exact word `explicit` is no intent at all.

**An unchanged contract CAN be run again** — that is what the key is for. A plain
re-POST of the same bytes resumes its own run, whatever state that run is in; an
explicit rerun with a fresh key makes a distinct run of the same contract, and
repeating that request with the same key returns the run it already made.

**`rerun` on the wire reports the OUTCOME, not the request.** It is `true` only
when this call both asked for a rerun and actually made one; a retry that landed
on an existing run reports `false`. And `next` describes the state: a run that
has already ended is never described as being driven.

**Under concurrency.** The check and the insert are one SERIALIZABLE transaction,
so two simultaneous creates cannot both decide a mission is free. Two identical
requests sent together yield exactly one run: one caller is answered with it, and
a loser — a whole bootstrap is many writes, and a concurrent twin loses one of
them — is answered `503 bootstrap_persistence_failure`, which is retryable and
whose retry returns the one run. Never a second run, so never a second execution
to bill.

**Run ids on the wire.** A run id carries a colon (`run:…`). The read routes
accept it raw or percent-encoded (`run%3A…`) — a standards-correct client may
encode it — and a segment that is not a valid percent-encoding is
`404 run_not_found`, never `unknown_julius_route`.

**Refusals:** `401 operator_required`; `503 julius_state_unavailable` (no
database — no run was created); `503 reviewer_provider_unknown`
(`RELAY_HERMES_PROVIDER` unset — the reviewer's independence group is part of
the mission's recorded identity, and a mission that cannot name it is refused
rather than guessed); `400` carrying the parser's or the bootstrap's own reason
for a malformed contract, missing or non-blocking criteria, or an underivable
task contract.

## What has been exercised against a real database

`relay-bridge/julius-bridge-seam.real-postgres.test.ts` (gated on
`JULIUS_TEST_DATABASE_URL`, which must name a throwaway database — never
`DATABASE_URL`, which on a developer machine points at the persistent store —
and `todo` otherwise) drives creation and
every read view through the production compositions against a real PostgreSQL:
what a client creates is what it then watches, and both are what
`relay_wonderland.julius_runs` / `julius_tasks` / `julius_task_contracts` hold;
a re-posted contract resumes the one run; another project sees 404. On
2026-09-27 the BUILT bridge process was also driven over HTTP against that
database — 401 without the operator token, 201 with it, the same `runId` on
re-post, `run`/`tasks`/`slots`/`timeline` served, 404 under another project,
and the database rows agreeing (`READY`; plan `RUNNABLE` `["ARTIFACT"]`, build
`BLOCKED` `["DIFF"]`). A never-dispatched slot reports `knownUsdMicros: 0`,
`unknownCostComponents: 0`, `costComplete: true` — zero is the truth for a peer
that has never been asked, not a rounding.

## What is NOT served yet, and what it would take

**Dispatch is not reachable from a client.** A created run sits in `READY` until
the mission job drives it, and the job is started from a shell on the machine
that holds the credentials and the executor. Making the drive reachable over
HTTP is the deployment decision after this one — it is where money is spent —
and it is not taken here.

**Update 2026-10-23 (BRIDGE).** The paid drive is still not reachable. `POST
/relay-api/wonderland/julius/dispatch` reserves one admission for a client
`(runId, idempotency key)` pair when `JULIUS_WONDERLAND_ADMISSION` is exactly
`1`, and reserves nothing otherwise. The answer leaves `confirmLive` empty and
`submittedToPaidWorkflow` false. It does not call a provider, does not start
`julius-first-live-mission.yml`, and does not retry. See
`docs/integration/bridge-audit-2026-10-23.md`.

**Wrapper contract for that 202.** The match is the pathname
`/wonderland/julius/dispatch`. A query on that pathname, including
`projectId`, is still admission: the handler reads the project from it. A
trailing slash, a different case, or a child path is still the Wonderland
catch-all and is refused as that catch-all refuses every other unknown
`/wonderland/` path.
A **202** whose `state` is `ADMISSION_HELD` and whose body has no error closes
the pair. `ClassifyDispatchAnswer` reads that 2xx as Accepted. The client then
tracks progress by polling `GET /relay-api/wonderland/julius/status`. It does
not resend the pair. Until a status answer says providers are running, the
client shows **admitted, waiting for the paid run**. `dispatched: false` on
that 202 is the fact that no provider is running yet.

**Server run id.** The reservation does not mint an id. The client's
`wlj_` plus lowercase UUIDv4 is the id, validated by
`scripts/julius-admission-run-id.mjs` (the PR #434 module) and no other
parser. The 202 and the same-pair 200 both return that id as `serverRunId`.
`legacyRunId` is `null` on a new row. `dispatchedAt` is on `data` as well.
This response has not dispatched, so it is `null`. A resend of the same
`wlj_` and idempotency key returns that same id and does not open a second
row. A `run:` id is not accepted as a new dispatch. YUJI's paid-dispatch and
bootstrap will later refuse anything that does not match an admitted pair.
That refusal goes through G6 after #404 and the migration, and it is not in
this change.

**Durable admission file.** The store is the file named by
`JULIUS_WONDERLAND_ADMISSION_STORE` (`src/relay/integration/wonderland-admission/admission-file.ts`).
Admission runs only when that value is a local absolute path, the parent
directory exists and is writable, and the file, when it already exists, is a
writable file. Unset, a relative path, or a URL answers **503**
`julius_dispatch_unavailable` and reserves nothing. Tests construct the
in-memory ledger. The server does not.

The file is one JSON document, schema version 3, holding the admission rows.
A new row's `runId` and `serverRunId` are the same `wlj_` id. Schema version
2 is the legacy document: `runId` is the `wlj_` id and `serverRunId` is
`run:` plus 24 lowercase hex. Those rows are read through the legacy path and
are never rewritten. They cannot be dispatched, resumed, claimed, or
spend-locked. They still count toward the admission caps, and the workflow's
`MISSION_LIMITS` ceiling (including the $60 grant on `julius-continuous-1`)
is unchanged. Schema version 1 is refused. It predates the required `state`
field, and this process does not guess that field. A numeric `schemaVersion`
other than 3 or legacy 2 fails closed with `ledger_schema_unsupported`. That
is not a corrupt file. An id the shared module cannot parse, or a pair that
carries both forms where they do not agree, is corrupt and is not rewritten.
A non-numeric schema version, extra document keys, duplicate rows, an unknown
row key, or a `state` other than `ADMISSION_HELD` or `LEDGER_UNWRITTEN` is
corrupt. Either refusal answers 503 and the bytes stay as they are.

A write is a temp file in the same directory (a random 96-bit suffix, not the
pid), an fsync of that file, a rename onto the store path, and an fsync of
the directory. Two lock files sit beside the store:

- `<store>.lock` is the write lock. It is short-lived. Every writer, the
  bridge and the operator claim tool alike, creates it exclusively, reads the
  current bytes, writes, fsyncs, and deletes it. One writer at a time. A
  writer that finds it held retries for at most `ADMISSION_LOCK_WAIT_MS`
  (2000 ms) and then fails closed with `lock_held`: the bridge answers 503
  `julius_dispatch_unavailable`, and the claim tool prints
  `admission_file_lock_held` and dispatches nothing.
- `<store>.bridge.lock` is held by the bridge for its lifetime, so two
  bridges never serve one store. The claim tool never takes it.

The process never takes either lock when `JULIUS_WONDERLAND_ADMISSION` is not
exactly `1`. It never steals a lock. A lock whose recorded pid is another
live process, or a pid that is no longer running, stays held. Pid reuse and
containers make an automatic steal unsafe. A missing file is an empty ledger.

A clean shutdown deletes `<store>.bridge.lock`. A `SIGKILL`, or any exit
that skips `close()`, leaves it on disk; a kill in the middle of a write can
also leave `<store>.lock`. The next open then answers 503
`julius_dispatch_unavailable` and does not admit. Recovery is a manual
operator step, after the operator has confirmed that no bridge and no claim
tool is still running: delete the stale lock file, and only that file. Do not
delete or rewrite the admission document or the operator journal to clear a
lock.

### Operator procedure: claiming with the bridge up

The bridge stays running while the founder claims; the client keeps polling
`/status` throughout. Within the 360-minute held window:

1. `status`: `node --experimental-strip-types src/relay/integration/wonderland-admission/operator-claim-cli.ts status --store <store> --wonderland-run <wlj_> --server-run <wlj_>`
   Spawns nothing and writes nothing (except the terminal expiry note once
   the window has elapsed).
2. Dry run (optional): `claim --store <store> --wonderland-run <wlj_> --server-run <wlj_> --repo <owner/name> --lane <lane>`.
   It prints the exact `gh workflow run` command and **writes no claim
   record**. `/status` keeps answering `awaiting_operator`. A dry run never
   prevents a later real dispatch.
3. Dispatch: the same command plus `--dispatch --confirm 'RUN LIVE MISSION'`.
   The dispatch runs `--ref main`, so the tool first reads, at `main`
   (`gh api .../contents/<path>?ref=main`), the paid workflow, the mission's
   `contract.json` and the lane grant (`MISSION_LANES` in
   `scripts/julius-live-contract-check.mjs`). It refuses, writing nothing and
   reading no spent tag, when the workflow lacks an input it passes or the
   lane is not one the mission is granted (`lane_not_granted`). The workflow
   writes the spent tag before its own lane check, so a lane it refused would
   burn the `wlj_` id. A mission absent from `MISSION_LANES`, J1 among them,
   is granted `lab` only. The checked-out workflow is not read on a dispatch.
   The tool then reads the spent tag (`gh api --include`) and keeps GitHub's
   `Date:` header from that response as the claim's `githubDate`; without a
   readable `Date:` it claims nothing (`github_clock_unreadable`). It records
   `dispatching` under the write lock, releases the lock, spawns `gh workflow run` once, and records
   the outcome under the write lock: `dispatched` only when that spawn
   exited 0 with no halt, else `dispatch_failed` or `already_spent`, or,
   when the child gave no exit code of its own, the outcome-unknown record
   described below. The
   lock is never held across a `gh` spawn. From the CLI (a separate
   process) the bridge therefore keeps admitting and answering `/status`
   during dispatch. The in-bridge Start route (`POST .../start`) is
   different: by default it runs the claim core over `spawnSync`, which
   holds the bridge's event loop for each `gh` call (up to 120 s each), so
   `/status`, `/events` and `/result` do not answer until the claim
   returns. With `JULIUS_WONDERLAND_START_V2=1` the Start route runs the
   same calls, argv and order over an awaitable `execFile` spawner, and the
   bridge keeps answering during dispatch (see "Start v2" below). The argv is
   `gh workflow run julius-first-live-mission.yml --repo <owner/name> --ref main -f mission=<slug> -f lane=<lane> -f dispatch_key=<key> -f 'confirm_live=RUN LIVE MISSION' -f run_id=<wlj_>`.
   `confirm_live` is passed only with `--confirm 'RUN LIVE MISSION'`.
   `run_id` is PR #459's input. While the workflow does not declare `run_id`
   (or any other input above), the tool refuses with
   `workflow_run_id_input_missing` (or `workflow_dispatch_input_missing`) and
   writes nothing: a dry run checks the checked-out file and spawns no `gh`;
   a dispatch checks `main` and reads nothing past the workflow.
4. If the claim tool prints `admission_file_lock_held`, a writer held the
   lock for longer than 2000 ms. Nothing was recorded and nothing was
   spawned (unless the record already says `dispatching`; see below). Run
   `status` before trying again.

A record left at `dispatching` means the tool stopped between its reservation
and its outcome write, so whether `gh workflow run` started is unknown. It is
not `dispatched`, it is not retried by the tool, and `/status` answers
`dispatching`. The operator resolves it with
`reconcile --store <store> --wonderland-run <wlj_> --server-run <wlj_> --repo <owner/name>`,
which only reads GitHub and appends one outcome, never deleting or rewriting a
record:

- `dispatched` when the spent tag exists, its `julius-run-spent.v1` message
  names this run and a `workflow_run_id`, and that id is the one paid run on
  `main`, at attempt 1, whose run name ends `mode=paid key=<dispatch key>`;
- `dispatch_failed` (journal error `workflow_run_unspent`; `/status` shows
  `dispatch_failed` with no cause) when that one first-attempt run had
  completed without success when the runs were listed, and no spent tag
  existed when read after the listing, so the workflow ended before it spent
  the id. The runs are listed first: a run that already ended cannot tag
  later. A Re-run keeps the run id and raises its attempt, so any attempt
  above 1 leaves the record `dispatching`;
- otherwise the record stays `dispatching` and the tool prints what GitHub
  showed (`reconcile_indeterminate`, `spent_tag_unverified`, …).

**A `gh workflow run` with no answer is outcome-unknown, not a failure.**
When the child was killed at the spawner's timeout, killed by a signal, or
could not be started (gh missing, a spawn error), GitHub may or may not have
the dispatch. The claim tool then appends one more `dispatching` event,
`dispatchAttempted: true`, with the journal error `gh_workflow_run_timeout`,
`gh_workflow_run_signal` or `gh_spawn_failed`, and answers
`dispatch_outcome_unknown`. `/status` keeps answering `dispatching` with no
cause, and the in-bridge Start (`POST .../start`) answers 200 with
`state: dispatching` and `replayed: false`. The record is not retried, a second Start of the same admission
replays it, and it counts as in flight for the mission's in-flight guard, so
a Start of another admission of the same mission is refused with
`julius_paid_run_in_flight` before anything is written or dispatched. Only
`reconcile` moves it, from GitHub evidence, exactly as for a stopped
reservation: `dispatched`, or `dispatch_failed` with `workflow_run_unspent`
or `workflow_run_absent` (no run for the key, no spent tag, and the
reservation at least 15 minutes old on GitHub's clock), which frees the
mission. An ordinary non-zero exit (GitHub refused the dispatch) is still
`dispatch_failed` with `gh_workflow_run_failed`.

The outcome keeps the reservation's time and `githubDate`. The workflow's own
concurrency group is `julius-first-live-mission-${github.run_id}`, one per
Actions run; `julius-paid-<32hex>` (the record's `concurrencyGroup`) is the
derived name the workflow checks beside the spent tag, not a concurrency group.

**Upgrading over an old journal.** An earlier claim tool wrote `dispatched` on
a dry run (`dispatchAttempted: false`). This version refuses that record as a
dispatch it cannot trust, and a journal holding it reads as `corrupt` as a
whole: claim, status, reconcile and the bridge's `/status` all fail closed,
and nothing is written. Before upgrading, run `status` with the old tool: a
pair it shows as `dispatched` with no Actions run was a dry run. Recovering
such a journal is a reviewed step, not an operator one: the journal also holds
ownership and progress, so it is neither edited, deleted nor moved aside by
hand. Claims written by this version carry `githubDate`; a claim without it
still reads, but binds no completion.

**Never downgrade over a journal this version wrote.** This version can write
values a build without it does not know: the outcome-unknown errors above
(`gh_workflow_run_timeout`, `gh_workflow_run_signal`, `gh_spawn_failed`, on a
`dispatching` event with `dispatchAttempted: true`) and the Start binding
keys `startKeyHash` and `clientTriggerId` (written only by the bridge's
Start v2, behind its flag). The journal's `schemaVersion` is unchanged, so an
older claim tool or bridge reads any such claim as `corrupt` and fails closed
for the whole store: claim, status, reconcile, `/events` and `/result` all
refuse, and nothing is written or lost. The rules:

- once this version has run against a store, it is never reverted, and no
  older claim tool or bridge is pointed at that store;
- deploy this version everywhere (bridge and claim tool) first, and only then
  turn on `JULIUS_WONDERLAND_START_V2`.

A process that shuts down and opens that same file replays the pair. The
`serverRunId`, the state, the model pins, and the caps are the ones in the
file. The replay does not mint an id, does not invent empty pins, and
does not append a second row. Each row records `state` and `modelPins`. The
reservation is written as `LEDGER_UNWRITTEN` before the completion write,
through the same writer. If that completion write fails, the file keeps
`LEDGER_UNWRITTEN` and the same `wlj_` id. A later process replays that
state and does not create another id. The completion write is not tried again.
Opening a schema version 2 file does not upgrade it.

`dispatched` stays false on an admission row. The founder operator claim tool
is the only writer of the dispatched transition. That transition, and later
progress, are written to the operator journal beside the admission file
(`<store>.operator.json`), with the same schema version, atomic write, write
lock, and fail-closed rule. The admission document stays `{ schemaVersion, rows }`.

## Status

`GET /relay-api/wonderland/julius/status?runId=<wlj_ or run: id>&projectId=` is a
read of the local admission file. The query accepts either form. A new row is
found by its `wlj_` id. A legacy row is found by that `wlj_` id or by its
`run:` id. The pathname match is the same rule as
admission: a query stays on the route, and a trailing slash, a different case,
or a child path stays on the Wonderland catch-all.

The guards are the admission guards: loopback peer and Host, no forwarding
header, a native session, the founder player, and the paired project. The
route then reads the file and returns `{ wljRunId, serverRunId, legacyRunId,
dispatchedAt, workflowRunId, state, cause?, updatedAt }`. `legacyRunId` is always present.
It is `null` for a new row, and the row's `run:` id for a legacy row.
`serverRunId` is the `wlj_` id for a new row and the `run:` id for a legacy
row. The status route and the operator claim key a new row on the `wlj_` id.
A query is parsed by the PR #434 module. Either form selects the row whose
`runId` or `serverRunId` is that id. An unknown id of either form is the
same `404` `not_found` body. `dispatchedAt` is the
ISO timestamp of the first recorded operator dispatch, or `null` when that
dispatch has not been recorded. `workflowRunId` is a hint only. The
authoritative id is `workflow_run_id` in the spend tag's `julius-run-spent.v1`
message. This field is the GitHub Actions run id the operator dispatch learned
from the workflow run URL its own `gh workflow run` child printed, or `null`
until that URL is known. A request body, query, header, CLI flag, or
environment variable cannot set it. The status route only reads it. `state` and `cause` are closed. The route checks the stored
value against those unions. A stored state outside the union, or a stored
cause outside the union, is returned as `state: "unknown"` with no cause.
The stored token is not copied into the answer. `unknown` is never terminal.
The route does not call the operator tool, does not run `gh`, does not read
a credential, and does not spawn a process. The status clock is the server
clock (`Date.now()` at the bridge). A query, a header, and a body do not
set it. When the held phase has elapsed and no claim is stored, that read
records one operator-journal note, `failed` / `AWAITING_OPERATOR_EXPIRED`,
at the first expired instant. The admission document is not rewritten. The
row stays `ADMISSION_HELD`. Dispatch (the operator `workflowDispatchArgs`
builder and `POST /wonderland/julius/dispatch`), the operator claim, and
status (this route and the operator CLI) read that journal note before they
treat the row as still open. A note already stored is `failed` /
`AWAITING_OPERATOR_EXPIRED` even when the server clock is still inside the
held window and the only admission bytes read are the held row.

`WonderlandStatusState`:

```ts
export const WONDERLAND_STATUS_STATES = [
  'held',
  'reserved',
  'awaiting_operator',
  'ledger_unwritten',
  'interrupted',
  'failed',
  'dispatching',
  'dispatched',
  'dispatch_failed',
  'already_spent',
  'unknown',
] as const;

export type WonderlandStatusState = (typeof WONDERLAND_STATUS_STATES)[number];
```

`WonderlandStatusCause`:

```ts
export const WONDERLAND_STATUS_CAUSES = [
  'RUN_ID_ALREADY_SPENT',
  'SPENT_TAG_UNVERIFIED',
  'gh_workflow_run_failed',
  'AWAITING_OPERATOR_EXPIRED',
] as const;

export type WonderlandStatusCause = (typeof WONDERLAND_STATUS_CAUSES)[number];
```

The admission store's `ADMISSION_HELD` is `held`. While that row is still
waiting for the operator claim, and the awaiting-operator window has not
elapsed, the status route spells it `awaiting_operator`. `RESERVED` is
`reserved`. `LEDGER_UNWRITTEN` is `ledger_unwritten`. `INTERRUPTED` is
`interrupted`. `FAILED` is `failed`. The operator claim writes `dispatching`
(its reservation, written before it spawns `gh workflow run`; not a dispatch,
and `dispatchedAt` stays `null`), then `dispatched` only after that child
exited 0 with no halt, `dispatch_failed`, and `already_spent`, with a cause of `RUN_ID_ALREADY_SPENT`,
`SPENT_TAG_UNVERIFIED`, or `gh_workflow_run_failed` when it has one.
`status --watch` may write only a state from that list other than `unknown`,
and only a cause from the cause list, and only through
`applyWonderlandStatusTransition`. It is not implemented in this change.

```ts
export const GITHUB_HOSTED_JOB_CAP_MS = 360 * 60_000;
export const PAID_SLOT_WINDOW_MS = 350 * 60_000;
export const AWAITING_OPERATOR_WINDOW_MS = GITHUB_HOSTED_JOB_CAP_MS;
```

`AWAITING_OPERATOR_WINDOW_MS` starts at Accepted (`receivedAt`). It is the
held phase before the claim. `PAID_SLOT_WINDOW_MS` starts at the recorded
dispatch time, not at Accepted. `GITHUB_HOSTED_JOB_CAP_MS` is the same
length as the awaiting-operator window and is a different clock: it bounds
the hosted job that starts at that dispatch. A 360-minute admission window
that started at Accepted had to cover the manual claim and the 350-minute
slot wait, which left about 5 minutes.

Terminal states, the ones a record does not leave:

- `ledger_unwritten` — the ledger write is not retried and the pair is not released
- `interrupted` — admission `INTERRUPTED`
- `failed` — admission `FAILED`, or `awaiting_operator` elapsed with cause `AWAITING_OPERATOR_EXPIRED`
- `dispatch_failed` — the claim is not retried and is not returned to admitted
- `already_spent` — the claim is not retried and is not returned to admitted

`AWAITING_OPERATOR_EXPIRED` is the non-paid terminal cause of the held phase.
The workflow was not started and nothing was spent. It is not a slot outcome
and not a spent-tag outcome. The operator claim and a confirmed dispatch
read the server clock before they record a claim or spawn `gh`. That clock
is not a request field, a query, a header, or a CLI argument. Tests inject
it only through the claim tool. The last millisecond of the window is still
open. Once the window has elapsed, the claim is refused, `gh` is not
spawned, and the admission document is left as it is. The operator journal
records one progress note, `failed` / `AWAITING_OPERATOR_EXPIRED`, at the
first expired instant. A later clock, including one set back inside the
window, cannot claim or dispatch that run. The operator CLI `status`
command reports that same `failed` / `AWAITING_OPERATOR_EXPIRED` projection.

Once the operator claim has recorded `dispatched`, `applyWonderlandStatusTransition`
refuses every write of `INTERRUPTED` or `FAILED`, the status spellings
`interrupted` or `failed`, and a cause of those names. After that dispatch,
the only terminal outcomes are the ones the slot and the spent-tag path
report: `dispatch_failed` and `already_spent`.

`held`, `reserved`, `awaiting_operator`, `dispatching`, and `dispatched` are not terminal.
`unknown` is not terminal.

A run is visible to the player recorded for that server run id in the operator
journal. When the journal has no owner, the founder id is the owner. A different player, an
id the shared module cannot parse, and an unknown id each receive the same
404 body. An ambiguous id is refused and does not select a row. Those answers
do not rewrite the admission document. An elapsed held phase may record the
journal note above. A legacy document stays schema version 2.

## Durability

- After a restart, a held record stays held. Opening the admission file does
  not dispatch and does not mint a run id.
- Replaying the same `wlj_` returns the stored state and that same id.
  The replay does not create a fresh pair. A legacy `run:` row is not resumed.
- If the ledger write fails, the answer is fail-closed `LEDGER_UNWRITTEN`.
  The pair stays reserved. A resend returns that same pair, and the run id is
  not freed for a second admission.
- A write is atomic: the new document is written to a temp file, `fsync`ed,
  then renamed over the store. A reader sees the previous document or the
  complete next one.

## Mission result and progress

`GET /relay-api/wonderland/julius/missions/<wljRunId>/result?projectId=<id>`
and `.../progress?projectId=<id>`. Both carry the same guards as status:
loopback peer and Host, no forwarding header, a native session, the founder
player and the paired project. **`projectId` is required**: without it the
answer is `403 julius_dispatch_wrong_project`. A legacy, malformed or unknown
id is the uniform 404.

Both bodies carry `wljRunId`, `serverRunId`, `legacyRunId`, the derived
`traceId`, `state`, `updatedAt`, `phases` and `projectBrainRevision`. `state`
is the status ceiling until the evidence reader returns a completion, and then
`completed`. `/result` adds `dispatchedAt`, `cause` while not completed,
`completion`, and a top-level **`checkerVerdict`**:

| `checkerVerdict` | Meaning |
|---|---|
| `PASS` | the paid workflow's grade job ran the pinned hidden checker on the coder's final message and it passed. The only verified completion. |
| `FAIL` | the checker ran and the artifact failed. A failed evaluation. |
| `NOT_RUN` | no verdict: the run is not completed, it was not graded, or the verdict was absent, unreadable or for another run. Unverified. |

A client shows **Completed only on `PASS`**. A `completed` state with
`NOT_RUN` is a finished but unverified run. Any value other than the three
tokens is `NOT_RUN`. `completion.checker` carries the judged trimmed sha256,
its 12-hex game digest, the checker's own sha256, the graded task and the
reason, or null.

## Progress source

The held-phase expiry is written when the operator claim or a status read
observes it. Later progress from `gh` is still the operator tool's future
`status --watch`. It would read the run with the founder's own `gh` and append that
progress onto the operator journal beside the admission file. A note it appends has to use
`WonderlandStatusState` (never `unknown`) and, when it has a cause,
`WonderlandStatusCause`. That command is not implemented here. The relay only
reads the record the tool has already written, and a token outside those
unions is answered as `state: "unknown"` with no cause.

**Skywalker's ruling.** `julius-first-live-mission.yml` plus
`scripts/julius-paid-slot.mjs` is the only thing that can spend. Admission
later hands that pair off to that workflow. The relay holds no provider keys
and does not run paid roles in-process. How the handoff is triggered is an
open question for Gatekeeper and YUJI.

## Deployment topology

Admission is loopback-only. `isLoopbackPeer` requires the peer address to be
`127.0.0.1`, `::1`, or `::ffff:127.0.0.1`, and `Host` to be `localhost`,
`127.0.0.1`, or `[::1]`. Any forwarding header fails closed. A hosted or
proxied relay cannot admit a mission.

The supported topology for the first founder-only mission is the Wonderland
client calling a `relay-bridge` process on the same machine, at that process's
configured listen port, with no proxy. That process must have
`JULIUS_WONDERLAND_ADMISSION=1`, `JULIUS_WONDERLAND_MISSION` set to the
reviewed slug, and `JULIUS_WONDERLAND_ADMISSION_STORE` set to a local absolute
writable path. A clean shutdown releases the bridge lock. A lock left behind
by `SIGKILL` stays held until an operator deletes that lock file, as described
above. A later process that opens the same file replays the admissions already
there.

Admitting from a non-loopback or hosted client is out of scope. It would need
a separate reviewed auth design.

**A browser session cannot read it yet.** The operator credential governs this
surface because it already governs everything that spends money; which fields a
browser session may see — `providerId` among them — is a product decision that
comes after the mount, not before it. Wonderland's own client reaches the bridge
through the operator path today.

**Control is not mounted.** Pause, resume, cancel and approval decisions exist on
the API and are deliberately not served: they change a run, and a run is changed
by the process that owns it. `approvers` refuses every approval for the same
reason.

Two further gaps, both recorded rather than worked around:

- **Provider qualification is not on the slot view.** `juliusProviderQualification`
  lives in `src/relay/mission/role-slots`, which is a Relay concern; Julius does
  not import it, because Julius core must not depend on a Relay feature. A
  client that wants to show "VERIFIED / COMPATIBLE / UNSUPPORTED" beside a slot
  joins `JuliusSlotView.servedModel` to the registry itself. That join belongs in
  the bridge, one layer above both.
- **Project Brain entries are not exposed.** Only the revision is. An entry
  carries text a worker was shown, and what a browser may read of it is the same
  authenticated-surface decision as above.

## The stability promise

`JuliusSlotView` is additive-only. A field may be added; none will change
meaning, and none will stop being nullable. `state` is a closed set
(`NEVER_DISPATCHED` / `ACTIVE` / `IDLE` / `FAILED`) and a new member would be a
breaking change announced here. `role` is the three permanent peers and never a
`SPECIALIST:*` — a specialist is a bounded child of a slot, and
`inspectSubagents` is where its record lives.

## Start v2 (`JULIUS_WONDERLAND_START_V2=1`)

Off unless the variable is exactly `1`, and only meaningful with
`JULIUS_WONDERLAND_START=1`. Unset, the status path below is not routed,
and `GET /wonderland/julius/status`, `/missions/{id}/progress` and
`/result` answer byte for byte as on main. `POST .../start` with the flag
unset is NOT byte-identical to main: it uses the legacy `spawnSync`
spawner with the argv and the timeout unchanged, and the result mapping is
PR B's (a `gh workflow run` that timed out, was killed by a signal or did
not launch is an outcome-unknown dispatch that stays `dispatching`, and
its answer has `replayed: false`). Nothing in v2 changes a spend gate, the
`gh workflow run` argv, the spent-tag logic, the caps or the order of the
claim core's `gh` calls. The paid workflow stays the spend authority.

**gh >= 2.87.0.** `gh workflow run` prints the run URL only from 2.87.0
(2026-02-18). The claim core learns `workflowRunId` from that URL; with an
older `gh` a `dispatched` claim records `workflowRunId: null`, and before v2
`/events` stayed `run_unbound` for good. v2 binds that run by dispatch key
(below), but the founder's machine should run `gh` 2.87.0 or later.

**The Start.** The claim core runs over an awaitable `execFile` spawner (the
same argv and 120 s timeout as the default `spawnSync` one). Both report a
child killed at the timeout, killed by a signal, or never started as such,
so the claim records it as outcome-unknown (`dispatching`, see "A
`gh workflow run` with no answer" above), never as `gh_workflow_run_failed`. The claim records the Start binding on the `dispatching` reservation,
before `gh workflow run`: `startKeyHash` (sha256 of
`x-relay-idempotency-key`) and `clientTriggerId`. Every later event of that
claim carries them unchanged. They open no gate. A retried Start, with any
key, replays the recorded claim and never runs `gh workflow run` again;
two at once are serialized by the claim core and the second replays. A
journal holding these keys is read as corrupt by code older than this
change, so do not downgrade the bridge over a journal v2 has written.

**Recovery** (`relay-bridge/wonderland-dispatching-recovery.ts`). It never
dispatches and never writes: it runs only the three reads it builds, token
for token (the paid run list, the spent-tag ref GET and the tag object GET),
refuses any other argv before spawning (an allow-list, so a method or a body
in any spelling never reaches `gh`), and writes neither the admission
store nor its journal. It runs in the background when the status route is
read, at most once per 15 s per run, and the status route never waits for
it. Reading the status route therefore never moves a record; only the
founder's `operator-claim-cli reconcile` does.

- G4, a claim left in `dispatching`. A reservation older than 300 s (the
  bridge stopped between the reservation and the outcome write) is
  reported as `start.recovery: "operator_reconcile_required"` with
  `recoveryReason: "dispatching_stuck"`. An outcome-unknown `dispatching`
  event (its `gh workflow run` timed out, was killed or never started) is
  reported the same way at once, with its own error as `recoveryReason`
  and `result.outcomeUnknown: true`. GitHub is not read for either, and
  nothing is written; the founder runs `operator-claim-cli reconcile`,
  which writes `dispatched` or `dispatch_failed` only from GitHub evidence.
- G5, a `dispatched` claim with `workflowRunId: null`. The run is found by
  dispatch key: exactly one first-attempt `workflow_dispatch` run on `main`
  whose title ends ` mode=paid key=<the admission's key>`, as reconcile
  matches them. The id is held in memory, not written (the journal allows
  one `dispatched` event), and is `workflowRunIdSource: "dispatch_key"`.
  `/events` binds it only after `runMatchesClaim` checks the run itself.
- G8, `dispatch_failed` with cause `gh_workflow_run_failed` (`gh` exited
  non-zero; a network failure after the request was sent exits the same
  way). Read as OUTCOME-UNKNOWN: the run may exist. It is never dispatched
  again. It is re-read only through the spent-tag check: a present tag that
  names a run reads as `RUN_ID_ALREADY_SPENT`, a present tag that does not
  as `SPENT_TAG_UNVERIFIED`. A run found by dispatch key (and, with a tag,
  the run the tag names) is bound for `/events`, and `start.recovery` is
  `operator_reconcile_required`, because the journal keeps `dispatch_failed`.
  No run for the key and no tag, past reconcile's 15-minute grace on
  GitHub's clock, is "it did not run". Until GitHub has been read, the
  status `phase` is `unknown`, never terminal.
- An unset or invalid `JULIUS_WONDERLAND_GITHUB_REPO` (not owner/name, or a
  `.`/`..` segment). The recovery is handed no repo, so it builds no GitHub
  read at all. G4 is unaffected (it never reads GitHub): an outcome-unknown
  or stuck `dispatching` claim is still `operator_reconcile_required` with
  `result.outcomeUnknown` from the journal. Where G5 or G8 would read
  GitHub, `start.recovery` is `reconciling` with
  `recoveryReason: "repo_unconfigured"` (G8 stays outcome-unknown), so a
  misconfigured repo is visible, never silent.

**The status read.**
`GET /relay-api/wonderland/julius/missions/{wljRunId}/status?projectId=<J1>`,
v2 only, behind the same loopback guard and owner check as `/status`. It
only reads (it writes neither the admission store nor its journal), and it
takes no input that fakes or simulates a state:

```json
{
  "schema": "wonderland-mission-status.v1",
  "wljRunId": "wlj_...",
  "serverRunId": "wlj_...",
  "phase": "admitted|starting|dispatching|dispatched|queued|executing|grading|completed|failed|did_not_start|interrupted|expired|unknown",
  "terminal": false,
  "admission": { "state": "<the /status state word>", "cause": null, "updatedAt": "...Z" },
  "start": {
    "requested": true,
    "startKeyHash": "<sha256 hex>|null",
    "clientTriggerId": "...|null",
    "dispatchedAt": "...Z|null",
    "workflowRunId": "<digits>|null",
    "workflowRunIdSource": "gh_output|reconcile|dispatch_key|null",
    "retryStartSafe": true,
    "recovery": "none|reconciling|operator_reconcile_required",
    "recoveryReason": "<present only while recovery is pending>",
    "spentTag": "RUN_ID_ALREADY_SPENT|SPENT_TAG_UNVERIFIED|absent|unreadable (G8 only)",
    "request": "<JULIUS_WONDERLAND_START_ACK=1 only; see below>"
  },
  "run": { "status": "...", "conclusion": null, "live": true, "execution": "starting|executing|finished|interrupted|did_not_start",
           "executionStartedAt": null, "stoppedAt": null, "stale": false, "fetchedAt": "...Z" },
  "runReason": "<the /events reason, present only when no run is bound>",
  "stage": { "role": "...", "taskType": "...", "state": "...", "ordinal": 3, "repairCycle": 0, "at": "...Z", "sampled": true },
  "progress": { "percent": "100|null", "basis": "verified_completion|none" },
  "workflowProgress": { "label": "GitHub workflow steps (not mission progress)", "percent": 42,
                        "basis": "workflow_steps|none", "stepsCompleted": 5, "stepsTotal": 12 },
  "result": { "checkerVerdict": "NOT_RUN|PASS|FAIL|null", "outcomeUnknown": false },
  "eventsCursor": "<epoch>.<seq>|null",
  "nextPollMs": 2000,
  "serverTime": "...Z"
}
```

- `admission.state` is the `/status` word, unchanged and lowercase.
- `phase`: `completed` only when `/result` is `completed` (a client still
  shows Completed only on `checkerVerdict: "PASS"`). With a bound run, the
  run's `execution`: `queued` (run not yet in progress), `starting` (gates
  running), `executing`, `grading` (the LIVE step succeeded, no verdict
  yet), `interrupted`, `did_not_start`. Otherwise the journal: `admitted`,
  `starting` (this bridge is running a Start that has not reserved yet),
  `dispatching`, `dispatched` (no run read yet), `failed`, `expired`
  (`AWAITING_OPERATOR_EXPIRED`), `interrupted`, `unknown`. `terminal` is
  true for `completed`, `failed`, `did_not_start`, `interrupted` and
  `expired`.
- `run` is null when no run is bound. `stage` is the latest phase sample, or
  null.
- `progress` is MISSION progress and only ever a verified fact:
  `{ "percent": 100, "basis": "verified_completion" }` when `/result` is
  `completed` (the evidence reader's completion) AND its `checkerVerdict` is
  `PASS`, and `{ "percent": null, "basis": "none" }` otherwise. That
  includes every in-flight run (a phase sample names only the active task,
  with no total, and repair tasks are added during the run, so no mission
  percentage is verifiable before the end) and a completed run whose
  checker did not pass (`FAIL`, `NOT_RUN`). Workflow steps never feed it.
- `workflowProgress` is GitHub workflow step progress, labelled as such in
  every body (`label: "GitHub workflow steps (not mission progress)"`). Its
  `percent` is completed over listed workflow steps, floored, and null with
  `basis: "none"` whenever that count is not known (no run, no steps, or a
  job GitHub lists without its steps). A client must not show it as mission
  progress. Nothing is estimated or interpolated.
- The schema name stays `wonderland-mission-status.v1` although `progress`
  changed meaning from the first draft of this read: the read has never been
  on `main` (it ships with this change), and nothing at `main` reads it or
  its `progress` (no code, client, script, fixture or document there names
  the schema, the route or the field). The read already served on `main`,
  `GET /wonderland/julius/status`, and `/missions/{id}/progress` and
  `/result` are unchanged, with the v2 flag off and on.
- `workflowRunIdSource` is `reconcile` when reconcile wrote the run id (a
  `dispatched` bound through the spent tag, or a `dispatch_failed`
  `workflow_run_unspent` naming the run that ended unspent), `gh_output`
  when the claim's own `gh workflow run` printed it, and `dispatch_key`
  when only the recovery found it (the journal has none).
- `retryStartSafe` is true when a Start sent now would replay the recorded
  claim (or join the one running) and cannot dispatch a second time.
- `nextPollMs` is 2000 while a Start, a dispatch or a run is in progress,
  10000 otherwise, and null once `terminal`.

Not covered by v2, and still open:

- A verifiable in-flight MISSION percentage, and posting the first phase
  sample as soon as the LIVE step starts. It needs the live-progress
  sample to publish counts it does not publish today (a founder-governed
  change); until then `progress.percent` is null before a PASS completion.
- With `JULIUS_WONDERLAND_START_ACK` unset, `POST .../start` still waits
  for the whole claim (its reads and `gh workflow run`, each up to the
  120 s `gh` timeout); a Start for any admission in the same store waits
  behind it, as the claim core runs one claim at a time per store. With
  the flag (below) the Start answers 202 at once, but a Start for a
  mission whose claim is already in the journal still replays through the
  claim core, and so can still wait behind another admission's running
  claim in the same store.

### Start acknowledgment and recovery (A-9; `JULIUS_WONDERLAND_START_ACK=1`)

Off unless `JULIUS_WONDERLAND_START_ACK` is exactly `1`, and only with
`JULIUS_WONDERLAND_START=1` and `JULIUS_WONDERLAND_START_V2=1`. Unset (or
any other value), `POST .../start` and the status read answer byte for byte
as v2 above, `start.request` is absent, and no file below is written. The
claim core, the `gh` argv, every spend gate and the journal are unchanged.

**The answer.** After every check the Start route already makes (session,
owner, body, confirmation phrase, idempotency key, admission state), the
Start is saved as an intent in `<store>.start-intents.json` (schema
`wonderland-start-intents.v1`; temp file, fsync, rename, directory fsync,
mode 0600) under the store's write lock, and the route answers at once:

```json
{ "wljRunId": "wlj_...", "ack": "accepted", "state": "accepted", "startKeyHash": "<sha256 hex>",
  "acceptedAt": "...Z", "replayed": false, "workflowRunId": null, "dispatchedAt": null }
```

with HTTP 202. **A 202 `accepted` is an acknowledgment of the request, not
of the dispatch.** No gate has run and nothing has been spent: the client
must treat it as NOT dispatched and poll the status read until
`start.request.state` is `settled` (or `start` shows a dispatch). The same
claim the synchronous Start runs then runs in the background, with the same
Start binding; its answer, exactly what the synchronous Start would have
sent, is saved on the intent. The intent stores no key, no rerun phrase and
no grant: only the key's hash, the client trigger id and a digest of the
body.

A Start for the same mission:

- the journal already holds a claim for it: the claim core replays it (any
  key), as in v2; no intent is written or changed;
- same key, same body, its claim still running: 202 `replayed: true` (it
  joins; nothing new runs);
- same key, same body, settled: the saved answer, `replayed: true`;
- same key, same body, no claim running in this bridge (it restarted) and
  under 10 minutes old: the claim core is run again (it re-checks
  everything), 202 `replayed: true`; older: 409 `julius_start_interrupted`
  (start again with a new key);
- same key, another body: 409 `julius_start_key_reused`;
- a new key while a claim is running: 409 `julius_start_in_progress`;
- an intents file that cannot be read or written: 503
  `julius_start_unavailable`, nothing claimed.

**The rules.**

- **R1. A 202 never authorizes spend.** An intent is never a spend
  reservation and never consent. The claim core is the only gate and re-runs
  all of them (lane grant, workflow and contract at main, rerun gate,
  in-flight guard, spent tag, the reservation re-check under the lock) every
  time it runs, including on a resume.
- **R2. No new key while a Start is `accepted` or `claiming`.**
- **R3. A same-key retry never dispatches while the journal has a claim**
  for the mission: it replays the claim.
- **R4. The journal wins.** `start.request` never shows a state more
  started than the journal: a saved answer that says `dispatching` or
  `dispatched` with no claim in the journal shows `interrupted`. The
  journal's own fields in `start` (and `phase`) stay the authority.

**`start.request`** (present only with the flag; null when this mission
has no intent; `requestUnreadable: true` beside it when the file cannot be
read):

```json
{ "state": "accepted|claiming|settled|interrupted", "startKeyHash": "<sha256 hex>", "acceptedAt": "...Z",
  "outcome": { "httpStatus": 202, "body": { "...": "the Start answer" } },
  "resumed": false, "resumedAt": null, "resumeRefused": "<present only when a resume was refused>" }
```

`accepted`: saved, no claim running here, and the recovery worker may
still resume it. `claiming`: the claim core is running it in this bridge.
`settled`: `outcome` is the Start answer. `interrupted`: no claim running
and it will not be resumed (a same-key retry under 10 minutes still runs
the claim core again). `outcome` is null unless `settled`.

**The recovery worker** (`JULIUS_WONDERLAND_START_RESUME=1`, with the ack
flag; `JULIUS_WONDERLAND_START_RESUME_DISABLED=1` is a kill switch that wins
over both). It runs in the bridge that holds `<store>.bridge.lock`, once at
boot and then every 30 s, and re-reads the flags, the repository and the
lane on every pass. Under the same store write lock a client retry takes,
it resumes at most one intent per pass, and only one that is `accepted`
with no claim running, at most 10 minutes old, never resumed before, did
not carry the rerun phrase (the phrase is never stored, so such a Start is
never replayed), and has no claim in the journal for its mission, its
server run or its key. Nothing is resumed while ANY claim in the store is
unreconciled: `dispatching` (attempted or not, including outcome-unknown)
or `dispatch_failed` with `gh_workflow_run_failed`. So a crash after the
reservation, or right after `gh workflow run`, is never resumed; the
founder reconciles it as before.

For each resume, in this order and under that lock:

1. the intent's `resumeAttempts` is set to 1 with `resumedAt` and written
   (fsync, rename) BEFORE the claim core is called; if the write fails the
   resume is refused. One attempt per intent, ever.
2. one line (`wonderland-start-resume.v1`: mission id, intent id = the key
   hash, intent age, time) is appended to `<store>.start-resumes.log` and
   fsynced BEFORE the claim core is called; if the append fails the resume
   is refused (`resumeRefused: "resume_log_unwritable"` on the intent; the
   attempt stays spent).
3. the unchanged claim core runs, with the flags and the repository read
   now and no rerun phrase.

The log is evidence only: no code reads it, it gates no spend decision and
no resume, and a missing or corrupt log changes nothing (the count in the
intent file decides; the journal wins over both). `start.request.resumed`
and `resumedAt` come from the intent's own count, never from the log.
**`<store>.start-resumes.log` is excluded from any restore**: restoring it
can neither allow nor prevent a resume, and it must not be used to rebuild
the intents file or the journal.

**Crash windows** (each tested with an abandoned in-process bridge and a
new one over the same files): C0 before the intent is written (no 202; a
retry starts fresh); C1 intent written, no reservation (resumed once, or a
same-key retry runs it); C2 reservation written, `gh workflow run` not
made, and C3 right after `gh workflow run` (the journal says `dispatching`:
never resumed, a retry replays, the founder reconciles); C4 `dispatched`
written, the answer not saved (never resumed; a retry replays). In each,
the total number of `gh workflow run` calls stays at most one.

## Is Julius executing? (`/events` `execution`)

`GET /relay-api/wonderland/julius/missions/{wljRunId}/events` says whether
Julius itself is running. The client must not infer it. `live: true` only
means the bound paid run is queued or in progress, and that includes the
spend-tag and paid-slot gates and the preflight. A run can be `live` and
never execute Julius at all: run 40258482240 failed at the paid-slot code
gate. So a client drives "Julius executing" from `execution`, never from
`live`:

| `execution` | Meaning | The client shows |
|---|---|---|
| `null` | No run is bound (`source: "none"`). Unknown, not "not started". | /status alone |
| `starting` | The run is live. The LIVE step (`LIVE: run the first real Julius mission` in job `Preflight, then the live mission`) has not been seen, and no task sample has arrived. | the activation sequence, never "executing" |
| `executing` | The LIVE step was seen in progress, or a phase sample with a task (`marker: null`) arrived, and the run is live. An `idle` marker alone is not execution. | Julius at work: phases drive the beats |
| `finished` | The LIVE step succeeded. **Not an outcome.** | "grading": the outcome is /result `checkerVerdict` only |
| `interrupted` | Julius started, then the LIVE step failed, was cancelled or timed out, or the run ended without the LIVE step succeeding: a **confirmed** failure or cancellation, reported as soon as GitHub does. `stoppedAt` names the step. | stop the mission presentation now; no success sequence |
| `did_not_start` | The run finished and the LIVE step never ran. `stoppedAt: {job, step}` names the first step that failed, was cancelled or timed out (or else the job; `null` if none did). | "Mission did not start", never "Julius failed" |

`executionStartedAt` is when the LIVE step, or else the first task sample,
was first seen started. It is `null` when that is unknown. Every field is
computed from the run's own job, step and phase events, across the whole
run rather than one page, so a cursor or a reconnect cannot change it.
