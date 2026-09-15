# Project Brain v2 and the governed Python tool

Branch `local/project-brain-python`, built on `main` at `8afb872d`. Nothing
here is composed by the live Julius root yet; every module is declared in
`scripts/export-julius-harness.mjs` as "not composed", so the qualification
lane's wiring is untouched. The files sliced into paid regression missions
(`julius-runtime.ts`, `julius-memory-trust.ts`, `julius-context-integrity.ts`,
`julius-context-snapshot.ts`, `julius-repair-lineage.ts`,
`julius-bundle-cell.ts`) are not modified.

## What Project Brain is

The durable memory and state of Julius: what it knows, did, decided,
observed, proved, changed and left unresolved, across missions. It belongs to
Julius; a mission uses it. It is not an agent.

```
USER ── JULIUS (authority) ── Project Brain (ledger + current state + evidence)
                 │                      ▲
                 ├─ Prompt Architect ───┤  governed handles, one principal each
                 ├─ Coding Agent ───────┤
                 ├─ Independent Reviewer┤
                 └─ Python tool ────────┘  staged proposals, admitted at settlement
```

**Shape.** An append-only, hash-chained ledger of typed records
(`julius_brain_records`) and a current state that is a pure projection of it
(`julius_brain_entities`). A change of truth is a new record — a revision, a
supersession, a retirement, a contradiction — never an overwrite. One planner
(`planJuliusBrainAppend`) and one fold (`applyJuliusBrainRecord`) are shared by
the in-memory model and PostgreSQL, so the materialised rows are the
projection by construction, and `verifyJuliusBrainLedger` checks it anyway.

**Language-independent.** Records are canonical JSON with explicit schemas,
sha256 content hashes and a chain. The schema ships as
`relay-python/julius/brain_schema.json`, generated from the domain
(`npm run julius:brain:schema:export`) and held current by a test.

## Record kinds (23)

| Section | Kinds |
|---|---|
| Mission / state | MISSION, OBJECTIVE, MISSION_STATE, CHECKPOINT |
| Requirements | REQUIREMENT, ACCEPTANCE_CRITERION, CONSTRAINT, PROHIBITION, ASSUMPTION, OPEN_QUESTION |
| Architecture | ARCHITECTURE_COMPONENT, ARCHITECTURE_INTERFACE |
| Knowledge | DECISION, RESEARCH, MEMORY_FACT |
| Proof | EVIDENCE (13 evidence classes), EVAL (with reproducibility), ARTIFACT (content-addressed) |
| Quality | FINDING, REPAIR |
| Flow | HANDOFF, TRACE, PYTHON_EXECUTION |

Links: SUPERSEDES, CONTRADICTS, SUPPORTS, DERIVED_FROM, RESOLVES, REPAIRS,
EVIDENCED_BY, ANSWERS, PRODUCED_BY, RELATES_TO.

## Memory classes

| Class | How it is represented |
|---|---|
| Current state | ACTIVE entities (latest version) |
| History | every record, gap-free per Brain, hash-chained |
| Decisions | DECISION entities with rationale, alternatives, evidence links |
| Evidence | EVIDENCE / EVAL entities, verification status, provenance |
| Working memory | `retention: WORKING`; excluded from context once expired or once the mission is terminal |
| Durable memory | `retention: DURABLE` |
| Superseded / invalidated | lifecycle SUPERSEDED (with `supersededBy`) or RETIRED (with reason and disposition); content and history kept |

## Governance, in brief

- **Julius** holds mission truth; **users** edit only USER_EDITABLE kinds.
- **Prompt Architect** records architecture, research, questions, and
  ARCHITECTURE decisions; it may only *propose* requirements.
- **Coding Agent** records evidence, artifacts, IMPLEMENTATION decisions and
  repair progress; it cannot verify its own evidence.
- **Independent Reviewer** records findings and evals, may set evidence
  `verification` and repair disposition, and can never revise, retire or
  supersede mission truth.
- **TOOL / ENVIRONMENT** principals write observation kinds only, under a
  scoped, bounded, expiring grant; UNVERIFIED only; never a blocking finding.
- Credential-shaped content is refused on write; exports redact and count.
- Memory: auto-generate is allowed, auto-trust is not (VERIFIED/APPROVED
  needs mission authority and an evidence link).

## The Python tool

`python.run` is a capability of Julius, not a tier. Flow:
request → C.A.R.D. authorisation (python + process capabilities, reads,
network only as an allowlist the card permits, `secret:<id>` per secret, a
verified CPython 3.11+ environment satisfying exact pins) → sandboxed run →
**atomic settlement** (execution state + Julius's PYTHON_EXECUTION record +
the tool's proposals, one transaction).

- The child environment is built from nothing; host secrets never reach it.
- stdout/stderr are hashed as produced, bounded, and redacted.
- Artifacts are size-bounded, symlink-refused, secret-quarantined and stored
  content-addressed (`cas://sha256/<hex>`).
- The runner applies OS limits (Windows Job Object with a memory limit and a
  single active process; POSIX rlimits), watches the host's liveness, then
  installs a permanent audit hook for network, process creation, native
  loading and file access.
- **Limit, stated plainly:** the audit hook governs cooperative and buggy
  code; it is not a boundary against code written to escape it. Executions
  record `PYTHON_AUDIT_HOOK` accordingly. Hostile workloads need OS isolation
  (a container with no network and a read-only root).
- Environments: `materializeJuliusPythonEnvironment` builds a spec-hash-named
  venv offline from a wheelhouse with exact pins, probes and locks it.
- States: REQUESTED, DENIED, RUNNING, CANCEL_REQUESTED, SUCCEEDED, FAILED,
  TIMED_OUT, CANCELLED, DISCONNECTED. A result after cancellation never
  reaches the Brain; a host that vanished is settled DISCONNECTED and never
  rerun.

## Paid-run history: the archive import boundary

Paid runs are archived by the Formal lane into a **temporary** schema of its
own. The Brain never reads that schema. What crosses is one versioned, typed,
self-hashed JSON document per workflow attempt,
`julius-paid-run-archive-export.v1` (`julius-brain-archive-import.ts`). An
adapter on Formal's side produces it; only that adapter follows their tables.

```
Formal's archive tables ──(Formal's adapter)──▶ julius-paid-run-archive-export.v1
   ──strict validation──▶ preservation of the attempt ──▶ refuse | reconcile | reconstruct
   ──▶ plan (pure translation) ──▶ ONE guarded group commit ──▶ Project Brain
```

### The contract

**Null, empty and Unknown are explicit.**
- **Never `''`.** Every string is non-empty, because a source that cannot tell
  NULL from `''` must decide which it means.
- **Unknown is listed.** Each item names, in `unknown`, the nullable fields
  whose null means "not recorded". A null not listed means "recorded as absent".
- **Lists.** A list is `[]` when recorded empty, and null (listed) when Unknown.

**Sections:**

| Section | What it carries (nullable where the source may not know) |
|---|---|
| identity | workflow run id and attempt; repository; Julius run id (provenance only); mission id and label; campaign; project; classification; accepted main SHA; state mode and basis; outcome and reason; start and end |
| tasks | task id, type, role, worker, state, ordinal, parent, dependency ids |
| research | request key, attempt key, ordinal, role, task, host, path, bytes, digest, delivery range, handoff ref, SERVED/REFUSED/UNKNOWN, refusal reason, purpose, evidence, time |
| evidence | id, task, type, status, source verification, summary, artifact refs, integrity hash, time |
| findings | id, task, severity (only where recorded), blocking, status, claim, rationale, evidence ids (only where recorded), time |
| reviews | id, reviewer, verdict, target task, reason code, rationale, evidence ids, source ref, time |
| repairs | id, round, target task, repair task, reason, outcome, finding ids, time |
| usage | component, task, role, provider, model, requests, tokens, amount, cost basis, estimate, time |
| brainEntries | the v1 Brain entry ids the run wrote: kind, worker, task, revision, time (never content) |
| events | event id, sequence (optional), type, task, time, scalar facts |
| toolInvocations | id, task, tool, execution type, state, result, requested and completed, artifact refs |
| artifacts | id, name, content type, size, content hash, storage ref |

**Refused before anything is written:**
- another version of the format (`unsupported_export_version`), or another
  format (`not_an_archive_export`);
- a missing, extra, mistyped or empty field, with its location;
- a malformed `unknown` list;
- an identity or section hash, or the content hash, that does not match. The
  accepted main, state mode and attempt are all bound by the identity hash;
- duplicate ids, or references that do not resolve;
- a reported cost with no amount, or an UNKNOWN cost carrying one;
- supplied artifact bytes that do not match their digest;
- credential-shaped content.

### Translation

The translation invents nothing.

| Archive | Brain record |
|---|---|
| the export's own bytes | ARTIFACT (content-addressed), the anchor every record `DERIVED_FROM` |
| identity | TRACE `LIFECYCLE`, facts carry the full identity and archive hash |
| artifacts | ARTIFACT: verified bytes held `cas://`, otherwise `archive-ref:` |
| tasks | TRACE `WORKER_ACTION` |
| evidence | EVIDENCE, class mapped from both runtime vocabularies, **always UNVERIFIED** |
| reviews | DECISION `VERIFICATION`; a missing rationale says Unknown |
| findings | FINDING `REVIEWER_FINDING`; severity `UNKNOWN` when not recorded; rationale appended to the claim when recorded |
| repairs | REPAIR; status and verification `UNKNOWN` when the outcome was not recorded |
| research | RESEARCH, plus a companion TRACE carrying the delivery facts (bytes, digest, range, disposition) |
| usage | EVIDENCE `MEASUREMENT`, cost basis preserved |
| run accounting | EVIDENCE: the known total is a **floor** while any component is unknown |
| brainEntries | TRACE "written; content not archived", unless a review or the live mirror already represents it |
| events / tools | TRACE, with Unknown fields listed |
| (import report) | EVIDENCE `MEASUREMENT`: the complete Unknown-by-field breakdown and what was already represented |

**Unknown times stay Unknown.** A record whose time was not recorded has
`occurredAt: null` (migration 005).

**Every imported record carries:**
- **Scope:** the run is **always** `workflow:<id>/<attempt>`. The Julius run id
  repeats across attempts, so it is a fact only.
- **Provenance:** `commit` is the accepted main;
  `externalRef = julius-paid-run-archive:<run>/<attempt>#<section>/<id>`.
- **Principal:** `JULIUS julius:archive-importer`.
- **Idempotency key:** `archive:<run>/<attempt>:<section>:<id>`.

### One attempt, one history: preservation and reconciliation

A live attempt leaves durable evidence written by Julius
(`julius-brain-preservation.ts`):
- **`run-opened:<run>`**, after bootstrap verified the Brain;
- **`run-sealed:<run>`**, counting how many of the run's v1 entries the Brain
  holds with the right content, and naming which are missing;
- **a `run-preserved:<run>` checkpoint.**

| Status | Derived when |
|---|---|
| PRESERVED | opened, sealed with nothing missing, and a checkpoint covering the seal that re-derives from the ledger |
| PARTIALLY_PRESERVED | some live evidence exists, but not all of the above |
| NOT_PRESERVED | nothing of the live run is durable |

**What does not count:**
- A marker a worker or tool wrote.
- Records an import wrote.
- A recovery. It is listed beside the status and never makes a run PRESERVED.

**The import derives the attempt's status first:**

| Before | Import |
|---|---|
| PRESERVED | refused (`attempt_already_preserved`); nothing written |
| PARTIALLY_PRESERVED | **RECONCILED**. Live v1 entries (by id) and verification decisions (by task, verdict, reason) are linked, not recorded again; only the missing history is added |
| NOT_PRESERVED | **RECONSTRUCTED** in full |

**Refused as `conflicting_history`:**
- the open marker's mission, Julius run or accepted main disagrees with the
  export;
- the live run holds a v1 entry the export does not list;
- the seal counted a different number of entries.

**Every recovery is recorded.** It writes a RECOVERY trace: mode, prior status,
what was added and what was already represented, linked to the export and to
the live records it relied on.

**Guarantees:**
- **Idempotent.** Repeating a recovery writes nothing.
- **No overwrite.** A different history of the same attempt is refused.
- **Deterministic.** The commit carries a run guard: the attempt's record count
  when the plan was made, checked under the Brain row lock. A write to the same
  attempt in between makes the import plan again.

## State modes: retention is not retrieval authority

A paid run can live in the Brain permanently — in history, in exports, in
audits — and still be unavailable to a run that must not be shaped by it. A
read grant says what a principal may see. A state mode says what **this run**
may draw on (`julius-brain-state-modes.ts`).

| Mode | Admits besides the current run and run-less authority (mission, objective, active requirements, criteria, constraints, prohibitions) |
|---|---|
| FRESH | nothing |
| CONTINUATION | the mission's run-less state and the runs it names in `resumes` |
| LEARNING | from the named runs (or all), only the named learnable kinds, ACTIVE, and verified when `requireVerified` |
| REGRESSION | nothing; the pinned baseline run is returned **separately** for comparison, never as guidance, and refused if it moved |

**Selection:**

- Selection is by scope. Other missions are always excluded.
- Every exclusion is counted by reason: `PRIOR_RUN_STATE`,
  `MISSION_LEVEL_STATE`, `OTHER_MISSION`, `NOT_LEARNABLE`, `UNVERIFIED`,
  `NOT_ACTIVE`.
- The policy is hashed. A policy naming a run id that imported archive history
  holds is refused (`current_run_is_archived_history`), because the current
  run is admitted whole.

**Python obeys the same selection.** `brainRead.stateMode` must name the
request's own mission and run. The snapshot records
`{mode, policyHash, excluded}`, the SDK exposes it as `brain.state_mode()`, and
`PYTHON_EXECUTION.stateMode` records the mode.

**A snapshot holds no edge to an entity it does not hold.** Links and inbound
edges pointing outside are removed and counted (`withheldEdges`). Otherwise a
withheld prior run's `CONTRADICTS` would reach the script as
`contradicted_by()`.

**The proof** (`julius-brain-state-modes.test.ts`,
`python-state-modes.test.ts`, `scripts/julius-brain-archive-postgres.test.ts`):
with the real paid run 34739303313 imported, FRESH admits none of it.

- **Worker context:** none of it appears.
- **Keyword retrieval:** it finds the archived finding over the whole Brain, and
  nothing over the FRESH set.
- **Real interpreter:** `brain.findings()` is empty and `contradicted_by()` is
  empty. The same script with no mode sees both.
- **Retained:** the archive is still in history and in the export.
- **Cold connection:** on PostgreSQL the selection is the same.
- **LEARNING** admits exactly the archived finding when asked for findings, and
  archived evidence only once it is verified.

## Formal's archive (`julius-paid-run-archive.v1`) against this contract

This is a read-only inspection as of 2026-09-15: `origin/main` `ad03df90` and the
local `julius_archive` database, with four qualification attempts archived.
**The archive is not frozen**, and the adapter is not written: `research.tsv`
carries 17 columns in two attempts and 21 in the other two.

**What already agrees:**
- **Identity** is the workflow run and attempt.
- **State mode** is recorded as FRESH, with its basis.
- **Cost honesty:** unknown settlements carry no amount.
- **Credentials** are refused at archive time.

**How the export represents what the archive does not record.** Nothing here
asks Formal to change its tables:

| Section | Archive carries today | In the export |
|---|---|---|
| findings | `finding_id, blocking, status, claim` | task, severity, rationale, evidence ids and time listed Unknown |
| evidence | `evidence_id, evidence_type, status, safe_summary, occurred_at` | task, artifact refs, integrity hash, source verification listed Unknown |
| reviews | `decision_id, task_id, action, reason_code, occurred_at` | reviewer, rationale Unknown; evidence ids `[]` only if recorded as none |
| repairs | no table; repair tasks carry a parent task | an item only where a repair is recorded; finding ids, reason and outcome Unknown otherwise |
| tool invocations | `invocation_id, tool_id, state, requested_at` | task, execution type, result, completion Unknown |
| usage | settlements: role, amount, basis, estimate | provider, model, requests, tokens Unknown (never joined by guess from diagnostics) |
| events | sequenced event dumps; `trajectory` has no sequence | `eventId` for every row; `sequence` Unknown for trajectory |
| brainEntries | `project-brain.tsv`: entry id, kind, worker, task, revision, time | as recorded; content is never exported |
| all tables | `psql -A` text: NULL and `''` indistinguishable; times like `2026-09-13 11:10:45.942+00` | the adapter must decide: `''` is refused at the boundary; times must be ISO |

## Migrating paid history into the Brain

1. **Wait for the freeze.** Formal's archive is temporary. Their adapter
   produces `julius-paid-run-archive-export.v1` against its final shape. The
   Brain never reads their tables.
2. **Seal each attempt** with `sealJuliusPaidRunArchiveExport`, and keep the
   sealed bytes: they are the anchor artifact.
3. **Import each attempt** with `importJuliusPaidRunArchive`. It refuses a
   preserved attempt, reconciles a partial one, and reconstructs one never
   preserved.
   - `REJECTED` lists every located error: fix the adapter, not the export.
   - `conflicting_history` means the export is not the live run's history:
     investigate, do not force.
4. **Verify.**
   - Run `verifyJuliusBrainLedger`.
   - Re-import: expect `ALREADY_IMPORTED`.
   - Read the import report's Unknown-by-field breakdown.
   - Compare `accounting` with the paid-run ledger (a floor while any component
     is unknown).
5. **Nothing imported is guidance by default.** Every live run declares its
   state mode. Qualification and lab evaluations run FRESH, and LEARNING names
   what it learns from.

## Proofs and how to run them

| Proof | Command |
|---|---|
| Domain, governance, projection, export, retrieval, API, sessions | `npx vitest run src/relay/mission/julius/julius-brain` |
| Python with real processes (15), SDK (11), pinned venv (3) | `npx vitest run src/relay/workspace/julius-tools/python-` |
| Integrated mission, in memory, real Python | `npx vitest run scripts/julius-brain-python-flow.test.ts` |
| PostgreSQL store, contention, restore, process A/B drill | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-project-brain-drill.test.ts` |
| Brain + Python across processes, restart, cross-process cancel, host crash | `JULIUS_BRAIN_DATABASE_URL=… npm run julius:brain:python-drill` (a dedicated Brain database) |
| The dedicated database: dedicated, identified, encrypted, current, concurrent migration, immutable, artifact bytes | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-brain-database-postgres.test.ts` (the server must offer TLS) |
| Least-privilege roles, running the whole Brain + Python flow as the service role | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-brain-roles-postgres.test.ts` (a server role that may create roles) |
| The temporary carry: seal, open, lineage, rollback, journal | `npx vitest run src/relay/mission/julius/julius-brain-carry.test.ts` |
| Archive export contract, import, state modes (domain) | `npx vitest run src/relay/mission/julius/julius-brain-archive-import.test.ts src/relay/mission/julius/julius-brain-state-modes.test.ts` |
| Preservation status, reconciliation with the live mirror, recovery under every state mode | `npx vitest run src/relay/mission/julius/julius-brain-preservation.test.ts src/relay/mission/julius/julius-brain-archive-reconciliation.test.ts` |
| The Brain service access contract (OIDC, sessions, per-call authorization, audit) | `npx vitest run src/relay/mission/julius/julius-brain-access.test.ts` |
| State modes with a real interpreter | `npx vitest run src/relay/workspace/julius-tools/python-state-modes.test.ts` |
| Archive import on PostgreSQL: parity, cold read, 6-way concurrent import, reconciliation and run guard, multi-group atomicity | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-brain-archive-postgres.test.ts` |
| Prepared live binding (bootstrap, mirror, typed context, seal and derived preservation) | `npx vitest run relay-bridge/julius/project-brain-binding.test.ts`; on PostgreSQL with the live v1 repositories: `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-brain-live-binding-postgres.test.ts` |

In the tests, `DATABASE_URL` names a **server** to create throwaway databases on.
The drills themselves write only to `JULIUS_BRAIN_DATABASE_URL`, never to the
runtime's `DATABASE_URL`.

Set `JULIUS_BRAIN_DRILL_RESTART` (e.g. `docker restart <container>`) to also
restart the PostgreSQL server between processes; a restart is reported only
when `pg_postmaster_start_time()` actually moved.

## Schema: a dedicated database

The Brain lives in a dedicated PostgreSQL database, never the Julius runtime
database. It has its own schema `julius_brain` and its own migration chain in
`src/relay/persistence/julius-brain-migrations/`, applied by
`migrateJuliusBrainDatabase`. The runtime chain (`wonderland-migrations/`) is
unchanged by this branch. See `docs/JULIUS_BRAIN_PERSISTENCE.md`.

- `001_julius_brain_ledger`:
  - `schema_migrations` and `database_identity` (environment);
  - the `projects` registry;
  - `brains`, `records`, `links`, `entities`.

  Nothing cascades.
- `002_julius_brain_python_executions`: `python_executions`, in the same
  database, because settlement is one transaction with the Brain.
- `003_julius_brain_content`: artifact bytes, content addressed.
- `004_julius_brain_immutability`: the database refuses to change history.
- `005_julius_brain_unknown_occurrence`: a record's occurrence time may be
  Unknown (NULL); when the Brain recorded it never is.

## Not yet done (the private-beta gaps)

1. **Composition.** The live root does not yet mirror v1 writes, compile v2
   context for workers, or expose `python.run` to worker turns. Deliberately
   deferred until the continuous-worker qualification lands. The binding for
   steps 1-5 is prepared and proven but not composed
   (`relay-bridge/julius/project-brain-binding.ts`); the exact sequence is
   `docs/JULIUS_BRAIN_LIVE_INTEGRATION_PLAN.md`.
2. **Production isolation for Python.** The executor sandbox image has no
   Python and the Docker path runs bash only; `python.run` is not in
   `JuliusToolId`. Hostile-code isolation requires that path. The design and
   its gate: `docs/JULIUS_PYTHON_ISOLATION_DESIGN.md`.
3. **Budget.** The service reserves and commits tool budget through
   `JuliusBudgetPort` when given one; the live ledger is not yet passed in.
4. **Bridge routes.** `handleJuliusBrainApi` is not mounted in `relay-bridge`.
5. **The production Brain database and its service.** The home is decided: a
   dedicated persistent PostgreSQL. The code-side rules are enforced and proven:
   dedicated, identified, encrypted, current, immutable, least privilege.
   The Brain service's access contract is written and proven locally
   (`julius-brain-access.ts`: OIDC verification, sessions bound to one attempt,
   mission and mode, per-call authorization, server-side retrieval, audit).
   Nothing is provisioned or deployed. The deployment proposal and its
   acceptance tests come after the qualification, per
   `docs/JULIUS_BRAIN_PERSISTENCE.md`.
6. **Semantic retrieval.** Evaluated and available; on the labelled fixture
   no candidate beat the keyword baseline on MRR, so it is not adopted.
7. **The archive adapter.** The import contract is built and proven; the
   adapter from the Formal lane's archive tables is not, because that schema is
   temporary. Written against its final shape.
8. **Windows venvs.** The host names its pid for liveness because a venv
   `python.exe` is a redirector; crash-orphan termination was proven with the
   system interpreter, not inside a venv.
