# Project Brain — one durable Brain for Julius and Wonderland

**Status (2026-10-01):** backend built and proven (real PostgreSQL 16.15; a real bridge process; restart; isolation),
stacked on main `88b8b1d0` + PR #306 (the contended contract-lock fix the multi-mission suite needs). The Unreal panel adapter is written on
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

**Document** (`relay-project-brain.v1`, `buildProjectBrainDocument`): twenty sections —
objective, missions, architecture, requirements, constraints, acceptanceCriteria, decisions, research, findings,
handoffs, repairs, activity, evidence, evals, trace, provenance, governance, memory, companions, cards.
It also carries `componentsInstalled` (false on a store without migration 034) and `coherence` (section 10). Every item carries
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
  their run. Scope is enforced by the SQL and again in the projection, before any ranking (mutation M10 vs control
  M11).
* **Julius's own carry (corrected, founder ruling 2026-10-04):** at bootstrap, after the task graph exists and only
  while the run is still CREATED, `JuliusClaimPostgresRepository.carryProjectKnowledge` reads the earlier runs of the
  SAME project and the SAME mission (never this run; newest first; at most `JULIUS_CARRY_SOURCE_RUN_LIMIT`) and the
  pure rule `planJuliusKnowledgeCarry` (`julius-claim-ledger.ts`) decides what travels. Two sources only, each from
  durable state: a **verified repair finding** — a blocking reviewer finding that cites evidence, that a repair
  ADDRESSED and an independent re-review RESOLVED, as the finding's own lifecycle (`foldJuliusFindings`) says; and
  the **accepted architecture** in force (`foldJuliusArchitecture`) when the newest COMPLETED source run ended.
  NOT carried, each excluded by a named reason on the record: verification-verdict mirrors (`brain:decision:*`),
  architecture proposals and superseded revisions, designs of runs that did not complete, unresolved / superseded /
  non-blocking / uncited findings, handoffs an accepted review promoted, and copies of copies. Every carried row is
  scoped to the new run's `plan` task (the Prompt Architect) — task-scoped sources stay task-scoped, a run-wide design
  is narrowed to the plan, nothing is widened — under the id `carried:<sourceRun>:<sourceRef>:into:<run>`, with a
  text header naming its source run, source task and type and (for a finding) its severity, category, criterion,
  reviewer, repair and resolving review, and a standing recorded with reason `CARRIED_FROM:<sourceRun>` (a finding's
  is derived exactly as admission derives a cited FINDING; the design keeps its source standing). The whole decision
  is one `knowledge.carried` event written in the same transaction (or `FAILED` with a closed reason), and every
  dispatch owed carried rows writes `knowledge.consumed` (owed / admitted / evicted). Both are dumped to
  `knowledge-carry.tsv`. A registered learning arm WITH must inherit at least one row from its own arm WITHOUT or
  its bootstrap is refused (`carried_knowledge_required`) before the run is READY. Not carried (P2): a prior
  mission's UNRESOLVED findings and a summary of the project's mission history.
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

**The panel's five sections (founder canon, 2026-10-06; contract `PB_UI_CONTRACT_04_05.r1`).**

| | section key | label | what it is |
|---|---|---|---|
| 01 | `memory_core` | MEMORY CORE | semantic, episodic and procedural memory; `skills` here is **Learned Skills**: what agents demonstrated (`trace` / `SUBAGENT_SUCCEEDED`) |
| 02 | `brain_systems` | PROJECT BRAIN SYSTEMS | scratchpads, memory synthesis, auto-generated memories, context handoffs, agent state |
| 03 | `llm_components` | LARGE LANGUAGE MODEL COMPONENTS | where the compound agent is **configured**: its roles (Prompt Architect, Coding Agent, Independent Reviewer), shared context, model/provider assignment, composition |
| 04 | `skills_mods` | SKILLS & MODS | what **extends** the configured agent, never its configuration: SKILL.md, skills, workflows (with any routing inside them), packs, Julius Mods, deterministic and fuzzy modules, permissions and versions |
| 05 | `card` | C.A.R.D. | the loadout, and **MASCOT & VISUAL MODS**: how it all looks (the mascot, its skins, Shadow Flame) |

- **Placement is the client's table.** The view stays `relay-wonderland-project-brain.v1`. Additions are additive: a surface the panel does not define is ignored and logged once, never rendered and never defaulted into a section.
- **The mission-context surfaces left the panel.** The view may still serve `objective` … `governance`; mission context travels with the Mission Contract.
- **Beta has no source for 04 except `workflows`** (the owner's WORKFLOW records). The other 04 surfaces are empty, and nothing in 04 is proposable or installable.
- **After Beta** a 04 item carries kind, id, version, creator, license, permissions and provenance. A fuzzy mod also carries its baseline, typed interface, candidate and Julius Eval, and nothing behavioural installs without that evaluation.

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

## 9. Components: C.A.R.D., Mission Handoff, evals (migration `034_project_brain_components.sql`)

Written through the SAME mutation log, advisory lock, idempotency namespace and event stream as the records, by
`ProjectBrainComponentStore.mutateComponent` (`src/relay/persistence/project-brain-components-postgres.ts`), which
re-parses every command it is handed, so a caller inside the process cannot skip validation. Doors:
`POST /relay-api/project-brain/projects/<id>/components` and `POST /relay-api/wonderland/brain/components`.

* **C.A.R.D.** (the fifth Project Brain component): a typed loadout mirroring Wonderland's `FWonderlandCard`.
  - Fields: the Mission Handoff form, skin/outfit/primary, companions in slots 0 = LEFT and 1 = RIGHT, MCP/API/SKILL capabilities by id.
  - Closed keys at every level. Every string is screened: credential shapes, random-looking 20+ character runs and invisible characters are REFUSED, never redacted.
  - Versioned (CARD_CREATE/UPDATE/DELETE, `expectedVersion`). Deletion is a final DELETED version.
  - `pbcard:default` is the built-in card: always present, version 1, never edited or deleted.
  - CARD_SELECT sets the NEXT mission's card (`expectedSelectionVersion`). Deleting the selected card returns the selection to the default in the same write.
  - **MISSION_PIN_CARD** (runtime/operator only, once per run) records the card version a mission started under, as `pbcard:<id>@v<n>` plus its content hash. A pin never moves, and deleted cards still resolve (`pinnedCard`). Switching cards mid-mission never rewrites a running mission's envelope.
* **Mission Handoff** (`/handoff`): a presentation state BESIDE the run, HANDED_OFF or RETURNED, versioned. It never writes a Julius row.
  - ENTER refuses a finished mission and a repeated handoff. EXIT refuses without a handoff.
  - A stale `expectedVersion` refuses; a duplicated event is answered from the log.
  - The form comes from the mission's pinned card.
* **Evals**: one subject at one exact revision against one criterion, with evidence refs (a PASS must cite some, and every ref of a run-scoped eval must be held BY that run: another mission's, a project-wide statement, a card or an event is refused `evidence_from_another_run`, fail closed), recorded only by an evaluator (operator/runtime).
  - The next eval of the same subject and criterion SUPERSEDES the current one in the same transaction.
  - An owner may INVALIDATE.
  - `projectBrainEvalQualifies` admits only a CURRENT PASS of exactly the revision asked about, so an old PASS never qualifies changed code.
* The database holds the invariants too: forward-only versions, immutable identity and judgements, append-only history, run-in-project triggers, deferred mutation references checked before COMMIT.
* **Deployment:** 034 is a post-030 migration. On the persistent store it is applied ONLY by the founder's explicit reviewed apply procedure after the verified live bootstrap (founder ruling 2026-10-04), never by an ordinary entry point.
  - The procedure is `docs/julius-migrations/034/RUNBOOK.md`: a verified backup, `precheck.sql`, the explicit `psql` apply, `postcheck.sql`, and `down.sql` for a rollback before the first component write.
  - 034's own guard refuses, changing nothing, unless 033 is applied and is the ledger's last stamp, 034 is not, and none of the names it creates is taken.
  - It is applied by the role that owns 029's tables, because it ALTERs one of them and puts a TRUNCATE guard on four.

## 10. Coherence and corruption (read path)

* `projectBrainCoherence` (`project-brain-coherence.ts`) reports, by reference, every impossible combination the rows show:
  - COMPLETED with live work;
  - COMPLETED with an open blocking finding;
  - a duplicated completion;
  - a repeated run version in the transitions, or a state without its transition;
  - an orphan repair;
  - evidence cited but not held, or held by another mission;
  - a component on an unknown mission.
  A truncated read SKIPS the rules that need the whole set and says so; it never passes them.
* A record or card whose stored content no longer matches its `content_hash` is CORRUPT. Reads fail closed and name the row, and writes refuse `project_brain_corrupt`.
* JSON read from a row is read STRICTLY. A mission snapshot, an event payload, an evidence/finding id list, claim evidence or a stored replay result that is missing, unparseable or the wrong shape is CORRUPT, named by table, key and column. It is never read as an empty list or object. An optional key inside a snapshot or payload that is absent or null is "not stated". An idempotent replay whose stored result is corrupt refuses `project_brain_corrupt`.
* A store NEWER than the code (its `schema_migrations` ledger holds a version this build does not carry) is neither read nor written. Every read path throws `project_brain_schema_newer` naming the versions: the document, the feed and its head, Julius's mission context, the components and a pinned card. Writes refuse with the same code. A build whose migrations were not packaged says `wonderland_migration_not_packaged`, never "newer" (`projectBrainSchema`, `project-brain-pg-shared.ts`). A store without 034 reports `componentsInstalled: false` and refuses component writes with `project_brain_components_not_installed`.

## 11. Membership: who may use a project's Brain (multiplayer)

`relay_wonderland.project_members` (migration 001) stays the one membership record every door reads. The roles are founder decisions 4 and 5 (2026-09-27):

| role | world (wonderland-authorization.ts) | Brain (project-brain.ts) |
|---|---|---|
| OWNER (the mission seed; permanent) | read world, results, cost; create missions | read, write, adopt, manage members |
| ADMIN | what OWNER holds | what OWNER holds |
| MEMBER | read world and results; never cost; never create | read; propose; write and edit its own statements; never adopt, acknowledge governance, manage members, or resolve/supersede another's statement |

The MEMBER row is the FOUNDER'S DECISION of 2026-10-04: a contributing role whose every write still passes the project's authorisation, the revision check, the audit and normal conflict handling. OWNER and ADMIN keep canonical management and governance.

* **Changes:** MEMBER_SET / MEMBER_REMOVE (`project-brain-members.ts`, `ProjectBrainMembersStore`).
  - Doors: `GET|POST /relay-api/project-brain/projects/<id>/members` and `GET|POST /relay-api/wonderland/brain/members`.
  - Every change goes through the Brain's mutation log: the project's lock, idempotency, the request hash, a `project_brain.member.*` event. It leaves an append-only row in `project_brain_member_versions` (034): who changed whom, from what role to what, when, by which mutation.
* **Rules:**
  - Only `brain:members` changes membership, and never one's own row.
  - The OWNER is never changed.
  - Only an OWNER grants, changes or removes an ADMIN.
  - Every change names the role the caller saw (`expectedRole`), so two concurrent changes cannot both apply (`member_conflict`).
  - The store re-reads the caller's own role under the lock, so a revoked admin's stale grant is worth nothing.
  - A removal takes effect on the next request at every door.
* A MEMBER holds `read_world_state`, so it can pair a desktop client; that is what makes a multiplayer Project Brain in Wonderland possible.

## 12. Proof

* Pure: 32 domain/view cases; 5 wake-up cases; 8 route cases.
* Real PostgreSQL: 13 store cases (atomicity, idempotency, versions, 12 concurrent writers, racing changes, duplicate
  keys, isolation, DB-enforced immutability, exactly-once feed, NOTIFY only after COMMIT, interrupted write, unknown
  COMMIT then safe retry, restart) and 11 end-to-end cases A–O through a real bridge server.
* Mutation: 15/15 mutants killed (+1 defence-in-depth control survives as designed).
* Real processes: `npm run project-brain:proof` with `PROJECT_BRAIN_PROOF_DATABASE_URL` (throwaway) and
  `PROJECT_BRAIN_PROOF_OUT` — 11/11 steps, evidence in `_qa_handoff/julius_project_brain/` (re-run 11/11 on the
  `88b8b1d0` + #306 stack: `proof-stack306-20261001-105904`).
* With the stack: every `*.real-postgres` suite 16 files / 92 cases, 0 todo; the two-loop six-mission suite 8/8.
