# Project Brain — one durable Brain for Julius and Wonderland

**Status (2026-10-01):** backend built and proven on branch `relay/julius-project-brain-backend`
(real PostgreSQL 16.15; a real bridge process; restart; isolation). The Unreal panel adapter is written on
`local/wonderland-project-brain-client` and is **not yet built or boot-tested** — that is the Wonderland lane's
build (one heavy job at a time, and every UE 5.8 build is boot-verified because a new early FName can crash a
packaged boot).

```
Wonderland panel (UWonderlandProjectBrainSubsystem + FWonderlandProjectBrainLink)
        ↕  /relay-api/wonderland/brain[/events|/proposals|/reviews|/mutations]   (player or desktop session + membership)
Project Brain API / event layer (relay-bridge/project-brain-routes.ts, LISTEN/NOTIFY)
        ↕  /relay-api/project-brain/projects/<id>[/...]                          (operator + tenant membership; companions)
Julius runtime  ── brainEntriesForRun ──►  durable Project Brain
        ↕
relay_wonderland: Julius's own rows + project_brain_* (migration 029)
```

## 1. One canonical Brain

There is **one** Project Brain and it is Julius's. Everything Julius already records durably *is* the Brain:
`julius_brain_entries`, acceptance criteria and their evidence, reviewer findings, evidence and work artifacts,
verification decisions, repair cycles, approvals, task contracts, transitions, the trajectory, claim standings,
context snapshots, sub-agents, and the event ledger. None of it is copied.

Migration `029_julius_project_brain.sql` adds only what had no home: **what a person (or a companion) states to a
project**, in the same schema, read by the same runtime:

| table | what it holds |
|---|---|
| `project_brain_records` | the current version of each statement: typed domain, status, scope (PROJECT or one MISSION), author **and** deliverer |
| `project_brain_record_versions` | every version ever written — append-only (trigger) |
| `project_brain_links` | typed relationships between any two refs (a record, a finding, a criterion, evidence, a mission…) — append-only |
| `project_brain_mutations` | one row per accepted change with the answer it was given — the idempotency log; append-only |
| trigger on `events` | `pg_notify('relay_project_brain', project_id)` for every Julius or Project Brain event — delivered only on COMMIT |

The record row may only move forward one version at a time and never change owner, domain, scope or author
(trigger `project_brain_records_guard`). History is never edited: a correction is a new version.

The in-memory Wonderland battle backend's `brains` map is **no longer served**: `/wonderland/projects/<id>/brain`
is answered by the canonical Brain.

## 2. Data model (`src/relay/mission/project-brain/`)

**Document** (`relay-project-brain.v1`, `buildProjectBrainDocument`): nineteen sections —
objective, missions, architecture, requirements, constraints, acceptanceCriteria, decisions, research, findings,
handoffs, repairs, activity, evidence, evals, trace, provenance, governance, memory, companions. Every item carries
a typed `ref`, its `sourceTable`, `author` and `deliverer`, `evidenceRefs`, `subjectRef`, status/version and time.
A fact appears once: a verification decision from its own table, never also from its context copy.

**Typed refs:** `type:id` with types `pbr mission entry claim finding criterion evidence decision repair approval
contract artifact transition trajectory event task` (the type is the text before the first colon, so Julius's own
ids travel unchanged; a record's ref is its id `pbr:<uuid>`).

**Record domains** a person may state: USER_FACT, PREFERENCE, IDENTITY, INSTRUCTION, WORKFLOW, SCRATCHPAD,
SHARED_CONTEXT, OBJECTIVE_NOTE, REQUIREMENT, CONSTRAINT, ACCEPTANCE_CRITERION, ARCHITECTURE_NOTE, DECISION,
RESEARCH_NOTE, MISSION_INPUT, MEMORY_REVIEW (reviews one of Julius's memories), FINDING_RESPONSE (answers a finding),
GOVERNANCE_ACK (acknowledges an approval/contract). A companion may state only COMPANION_RESULT.

**Statuses and moves:** terms of a contract (requirement, constraint, criterion, objective note, architecture note)
are born **PROPOSED**; only an owner (`brain:adopt`) moves them to ADOPTED or DECLINED. Notes are born ACTIVE. An
author may always withdraw what they said. Any move not in the table is refused.

**Provenance:** author ≠ deliverer, both bound by the server from the credential and the door — never from the body.
A request that names `author`, `provenance`, `reasoning` or any other undefined field is refused.

**Never stored:** credential-shaped content (API keys, tokens, private keys, JWTs, `password: …`, connection strings
with passwords) and hidden-reasoning markers are **refused** (422, `durable:false`), not silently redacted. Julius's
own rows are already safe summaries.

## 3. Julius ↔ Project Brain

* **Writes:** Julius writes its Brain exactly as before, through its runtime ports — nothing new to call.
* **Reads:** the live store's `brainEntriesForRun` (`relay-bridge/julius/postgres-store.ts`) appends the project's
  live statements (project-wide, or scoped to this run) to the run's own entries. They enter as `OBJECTIVE`-kind
  entries, which `julius-context-provenance.ts` qualifies as **user_stated / UNVERIFIED / INSTRUCTION** — so a
  proposed requirement can never outrank the locked contract, a verification decision or a cited finding, and is
  labelled `[a proposal, not a term of the contract]`. Each version is its own entry (`pbr:<uuid>@v<n>`), so the
  durable context snapshot records exactly which version a worker read.
* **Cross-mission carry:** project-scoped statements reach every mission of the project; mission-scoped ones only
  their run. Julius's existing carry of VERIFIED/APPROVED claims is unchanged. Scope is enforced by the SQL and again
  in the projection, before any ranking (mutation M10 vs control M11).
* **Mission contract:** the document projects each mission's contract policy (execution mode, review requirement,
  completion rule, limits, requested permissions, scope, roles) into `governance`, beside approvals, task-contract
  locks, lifecycle control and the per-role served-model topology from `JuliusRuntimeApi.inspectSlots`.

## 4. The two doors

**Operator** — `Authorization: Bearer <RELAY_BRIDGE_API_TOKEN>` + `x-relay-tenant` (the tenant's membership row in
`project_members` decides the capabilities):

| method | path | |
|---|---|---|
| GET | `/relay-api/project-brain/projects/<id>[?runId=]` | the document |
| GET | `…/events?cursor=<c\|head>&waitMs=<≤25000>[&mode=sse][&runId=]` | the feed (page/long-poll or SSE) |
| POST | `…/mutations` | CREATE / REVISE / SET_STATUS / LINK |
| GET | `…/companion-context?runId=` (+ `x-relay-companion`) | one mission's scoped context for a companion |
| POST | `…/companion-results` (+ `x-relay-companion`) | a companion's result → COMPANION_RESULT, PROPOSED |
| GET | `…/julius-context?runId=` | exactly what Julius reads from the Brain for that run |

**Wonderland** — `Authorization: Relay-Session <token>`: a signed-in **browser control** session (with its Origin)
or a **native desktop** session (no Origin, bound to the one project it was paired for):

| method | path | |
|---|---|---|
| GET | `/relay-api/wonderland/brain?projectId=[&view=document]` | the panel view `relay-wonderland-project-brain.v1` (29 surfaces, by the panel's own ids) or the document |
| GET | `/relay-api/wonderland/brain/events?projectId=&cursor=&waitMs=[&mode=sse]` | the feed |
| POST | `/relay-api/wonderland/brain/proposals` `{projectId, surfaceId, text, idempotencyKey, runId?}` | the panel's Propose; the server maps surface → domain |
| POST | `/relay-api/wonderland/brain/reviews` `{projectId, surfaceId, entryRef, verdict: ACCEPT\|DECLINE, idempotencyKey}` | the panel's Accept / Decline |
| POST | `/relay-api/wonderland/brain/mutations?projectId=` | the generic mutation |
| GET | `/relay-api/wonderland/projects/<id>/brain` | the canonical document (replaces the in-memory battle brain) |
| POST | `/relay-api/wonderland/native/pair` · `/native/session` · `/native/revoke` | desktop pairing (carried from the integration lane) |

Membership roles: **OWNER** read/write/adopt · **EDITOR** read/write · **VIEWER** read · anything else nothing.
Not a member and not a project answer the same **404**. No database: **503** naming `JULIUS_DATABASE_URL, DATABASE_URL`
— never an empty brain. The runtime reads `JULIUS_DATABASE_URL` first, then `DATABASE_URL`; tests read only
`JULIUS_TEST_DATABASE_URL`.

**Native scope (founder directive 2026-10-01):** a native desktop session, which the 09-27 decision confined to the
Julius world stream, now also reads and writes the Project Brain of **the project it was paired for** — because the
panel the desktop client already draws does exactly that. The battle and presence routes still refuse it.

## 5. Writes: transactions, idempotency, versions, truthfulness

One transaction per mutation under a per-project advisory lock: idempotency check (same key + same request →
the stored answer, nothing written; same key + different request → 409), version check (`expectedVersion` must be
current → else 409 with the current version; no blind last-write-wins), reference resolution **inside the project**
(a guessed id from another project is "not found"), then record + version + links + mutation + event in one COMMIT.

| answer | meaning |
|---|---|
| 201 `durable:true` | saved now |
| 200 `durable:true, replayed:true` | saved earlier; this is that answer again |
| 4xx `durable:false` | refused; nothing saved |
| 503 `durable:false` | the database could not be reached or failed before COMMIT; nothing saved |
| 503 `durable:'unknown'` | COMMIT was sent and not confirmed — retry with the **same key** (safe: it is either answered from the log or applied once) |

A checked-out connection whose backend dies cannot crash the bridge (error listener while held; pool error listener
on the bridge's Julius pool).

## 6. Live updates

The feed is the durable `events` log itself — Julius's `julius.*` events and the Brain's `project_brain.*` events,
named in one vocabulary (`project_brain.mission.created|state_changed`, `.finding.created`, `.evidence.recorded`,
`.decision.recorded`, `.repair.started`, `.eval.recorded`, `.trace.recorded`, `.handoff.recorded`,
`.governance.updated`, `.provenance.updated`, `.record.created|revised|status_changed`, `.link.created`,
`.activity.recorded`). Events carry **refs, never content**.

The cursor is one high-water mark per stream (`pbc1.<base64url JSON>`); within a stream sequences are allocated
under a row lock, so they commit in order with no gaps and replay is exactly-once. A reader takes the document and
its cursor from **one REPEATABLE READ snapshot**, then follows from that cursor; on reconnect it does the same.

Wake-ups: one `LISTEN relay_project_brain` connection per bridge; a long poll answers **with events or at its
deadline, never on an empty wake** (the listener coming up wakes every follower; found by the real-process proof).
SSE event ids are the resume cursor (`Last-Event-ID`).

## 7. Wonderland panel adapter (`local/wonderland-project-brain-client`)

`FWonderlandProjectBrainLink` (plain C++, owned by `UWonderlandProjectBrainSubsystem`): no new UCLASS, UFUNCTION,
UPROPERTY or log category (it logs to `LogTemp`) — the smallest FName footprint possible. Once the stream's native
session is paired for a project it reads `/wonderland/brain`, long-polls `/events` (20 s), and on any event re-reads
the view. Propose and Accept/Decline are sent with one idempotency key per action, reused on retry (no connection or
503). The panel says **"PROPOSED · SAVED IN PROJECT BRAIN"** and the footer says what the last write did, in the
bridge's words; unpaired, the labelled development preview is unchanged. Console: `wl.Brain.Link`, `wl.Brain.Refresh`.

## 8. What is still mock, demo or local — classified

| where | what | classification |
|---|---|---|
| `wonderland/…/WonderlandProjectBrain.cpp` `BuildDevelopmentPreview` | sample surfaces | **unpaired fallback only**, labelled DEVELOPMENT PREVIEW; replaced by the live view once paired (adapter pending CORE's build) |
| `src/relay/mission/wonderland/wonderland-backend.ts` `brains` | in-memory battle brain | **no longer served**; battle-internal residue (P3: remove or route battle lessons into the canonical Brain) |
| `src/relay/ui/app/demo-adapter.ts` `prepareProjectBrain` | the Relay **web** app's demo Brain (store defaults to the demo adapter) | not Wonderland's path; P2: point the web workspace at `/project-brain` |
| `src/relay/persistence/brain-memory-node.ts` + `ship-brain-feed.ts` | file-backed LLMOps short-term memory of shipped runs | a separate telemetry memory, not the Project Brain; P2: decide whether ship results become Brain activity |
| `src/relay/cli/product/commands.ts` brain view | CLI view over empty short-term memory | P3 |
| `src/relay/mission/julius/julius-memory-store.ts` | in-memory Julius store | test-only (fixtures) |
| `local/project-brain-foundation`, `local/project-brain-python` | standalone `julius_brain` ledger designs | not composed; superseded by this canonical design (P3: retire or fold in) |

## 9. Proof

* Pure: 32 domain/view cases; 5 wake-up cases; 8 route cases.
* Real PostgreSQL: 13 store cases (atomicity, idempotency, versions, 12 concurrent writers, racing changes, duplicate
  keys, isolation, DB-enforced immutability, exactly-once feed, NOTIFY only after COMMIT, interrupted write, unknown
  COMMIT then safe retry, restart) and 11 end-to-end cases A–O through a real bridge server.
* Mutation: 15/15 mutants killed (+1 defence-in-depth control survives as designed).
* Real processes: `npm run project-brain:proof` with `PROJECT_BRAIN_PROOF_DATABASE_URL` (throwaway) and
  `PROJECT_BRAIN_PROOF_OUT` — 11/11 steps, evidence in `_qa_handoff/julius_project_brain/`.
