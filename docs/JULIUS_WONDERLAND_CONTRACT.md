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
one of `run`, `slots`, `tasks`, `evidence`, `verification`, `timeline`.
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

**One active run per mission, unless somebody meant two.** A second, DIFFERENT
contract for a mission that still holds a non-terminal run is refused
`409 mission_run_already_active`, and the message names the run that holds it —
follow that `runId`. An identical contract is unaffected: its key is its own
content, so it resumes the run it already made. A terminal prior run (`FAILED`,
`COMPLETED`, `CANCELLED`) holds nothing and never locks a mission, and the guard
is per mission — one mission's live run never blocks another's.

**The explicit rerun.** Send `x-relay-julius-rerun: explicit` to start a
deliberate second run while one is alive. It must come from a human act (an
operator flag, a rerun affordance) and never from a retry default; anything but
that exact word is no intent at all. The response says `rerun: true` when it was
honoured, so a client that did not ask can never be told it got one.

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
`JULIUS_REAL_POSTGRES=1` + `DATABASE_URL`, `todo` otherwise) drives creation and
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
