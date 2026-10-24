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
| Prompt Architect state | `inspectSlots` → `JuliusSlotView` | **new** |
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

**Server run id.** That reservation also mints one server run id and keeps it
with the pair. The shape is the Julius bootstrap run id: `run:` plus 24
lowercase hex characters (`JULIUS_BOOTSTRAP_RUN_ID`). The validator of that
shape is private as `BOOTSTRAP_RUN_ID` in `relay-bridge/julius/mission-contract.ts`.
This copy is the same pattern. YUJI: confirm bootstrap will require this id.
The mint is a CSPRNG (`node:crypto` `randomBytes(12)`), called inside the
admission store's reservation, before any ledger write. `randomUUID` does not
match that 24-hex shape, so it is not the mint. The 202 and the same-pair 200
both return the id as `serverRunId`. `legacyRunId` is also on `data`, and it is
that same `run:` id when the row has one, or `null` when it does not.
`serverRunId` is not renamed and the mint is unchanged. `dispatchedAt` is
on `data` as well. This response has not dispatched, so it is `null`. A
resend returns the same id. The mapping
lives only in the admission store. YUJI's paid-dispatch and bootstrap will
later refuse anything that does not match an admitted pair. That refusal goes
through G6 after #404 and the migration, and it is not in this change.

**Durable admission file.** The store is the file named by
`JULIUS_WONDERLAND_ADMISSION_STORE` (`src/relay/integration/wonderland-admission/admission-file.ts`).
Admission runs only when that value is a local absolute path, the parent
directory exists and is writable, and the file, when it already exists, is a
writable file. Unset, a relative path, or a URL answers **503**
`julius_dispatch_unavailable` and reserves nothing. Tests construct the
in-memory ledger. The server does not.

The file is one JSON document, schema version 2, holding the admission rows.
Schema version 1 is refused. It predates the required `state` field, and this
process does not guess that field. A numeric `schemaVersion` other than 2
fails closed with `ledger_schema_unsupported`. That is not a corrupt file.
A non-numeric schema version, extra document keys, duplicate rows, an unknown
row key, or a `state` other than `ADMISSION_HELD` or `LEDGER_UNWRITTEN` is
corrupt. Either refusal answers 503 and the bytes stay as they are.

A write is a temp file in the same directory, an fsync of that file, a rename
onto the store path, and an fsync of the directory. A lock file beside the
store allows one writer. A held lock answers 503 and is left alone. The
process never takes the lock when `JULIUS_WONDERLAND_ADMISSION` is not exactly
`1`. It also never steals a lock. A lock whose recorded pid is another live
process, or a pid that is no longer running, stays held. Pid reuse and
containers make an automatic steal unsafe. A missing file is an empty ledger.

A clean shutdown deletes the lock. A `SIGKILL`, or any exit that skips
`close()`, leaves `<store>.lock` on disk. The next open then answers 503
`julius_dispatch_unavailable` and does not admit. Recovery is a manual
operator step, after the operator has confirmed that no admission process is
still running: delete that lock file, and only that file. Do not delete or
rewrite the admission document to clear the lock.

A process that shuts down and opens that same file replays the pair. The
`serverRunId`, the state, the model pins, and the caps are the ones in the
file. The replay does not mint a second id, does not invent empty pins, and
does not append a second row. Each row records `state` and `modelPins`. The
reservation is written as `LEDGER_UNWRITTEN` before the completion write,
through the same writer. If that completion write fails, the file keeps
`LEDGER_UNWRITTEN` and the same `serverRunId`. A later process replays that
state and does not mint another id. The completion write is not tried again.

`dispatched` stays false on an admission row. The founder operator claim tool
is the only writer of the dispatched transition. That transition, and later
progress, are written to the operator journal beside the admission file
(`<store>.operator.json`), with the same schema version, atomic write, lock,
and fail-closed rule. The admission document stays `{ schemaVersion, rows }`.

## Status

`GET /relay-api/wonderland/julius/status?runId=<run:24hex>&projectId=` is a
read of the local admission file. The pathname match is the same rule as
admission: a query stays on the route, and a trailing slash, a different case,
or a child path stays on the Wonderland catch-all.

The guards are the admission guards: loopback peer and Host, no forwarding
header, a native session, the founder player, and the paired project. The
route then reads the file and returns `{ wljRunId, serverRunId, legacyRunId,
dispatchedAt, state, cause?, updatedAt }`. `legacyRunId` is always present.
It is the row's `run:` plus 24 lowercase hex id, or `null` when the row has
no such id. `serverRunId` is the same field it was. `dispatchedAt` is the
ISO timestamp of the first recorded operator dispatch, or `null` when that
dispatch has not been recorded. `state` and `cause` are closed. The route checks the stored
value against those unions. A stored state outside the union, or a stored
cause outside the union, is returned as `state: "unknown"` with no cause.
The stored token is not copied into the answer. `unknown` is never terminal.
The route does not call the operator tool, does not run `gh`, does not read
a credential, and does not spawn a process. The status clock is the server
clock (`Date.now()` at the bridge). A query, a header, and a body do not
set it. When the held phase has elapsed and no claim is stored, that read
records one operator-journal note, `failed` / `AWAITING_OPERATOR_EXPIRED`,
at the first expired instant. The admission document is not rewritten.

`WonderlandStatusState`:

```ts
export const WONDERLAND_STATUS_STATES = [
  'held',
  'reserved',
  'awaiting_operator',
  'ledger_unwritten',
  'interrupted',
  'failed',
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
`interrupted`. `FAILED` is `failed`. The operator claim writes `dispatched`,
`dispatch_failed`, and `already_spent`, with a cause of `RUN_ID_ALREADY_SPENT`,
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

`held`, `reserved`, `awaiting_operator`, and `dispatched` are not terminal.
`unknown` is not terminal.

A run is visible to the player recorded for that server run id in the operator
journal. When the journal has no owner, the founder id is the owner. A different player, a
`runId` that is not `run:` plus 24 lowercase hex, and an unknown `runId` each
receive the same 404 body. Those answers do not rewrite the admission
document. An elapsed held phase may record the journal note above.

## Durability

- After a restart, a held record stays held. Opening the admission file does
  not dispatch and does not mint a new server run id.
- Replaying the same `wlj_` returns the stored state and the stored
  `serverRunId`. The replay does not create a fresh pair.
- If the ledger write fails, the answer is fail-closed `LEDGER_UNWRITTEN`.
  The pair stays reserved. A resend returns that same pair, and the run id is
  not freed for a second admission.
- A write is atomic: the new document is written to a temp file, `fsync`ed,
  then renamed over the store. A reader sees the previous document or the
  complete next one.

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
writable path. A clean shutdown releases the writer lock. A lock left behind
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
