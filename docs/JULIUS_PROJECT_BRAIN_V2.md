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

Paid runs are being archived by the Formal lane into a **temporary** schema in
the local `julius-postgres`. That schema is not the Brain's and will change.
The Brain never reads it. It reads one importer-owned, versioned export
contract, and only the adapter that produces that contract changes when the
archive does (`julius-brain-archive-import.ts`).

```
temporary archive tables ──(adapter, written against the final archive)──▶
  julius-paid-run-archive-export.v1  (sealed: per-section hashes + content hash)
    ──validate──▶ plan (pure translation) ──▶ ONE group commit ──▶ Project Brain
```

**The contract.**

- **Run identity:** `workflowRunId` (digits), `workflowRunAttempt`,
  `acceptedMainSha` (40 hex), `missionId`, `campaignId`, `juliusRunId`,
  `projectId`, `stateMode`, `classification`, the times, `outcome` and
  `outcomeReason`.
- **Sections:** tasks, evidence, reviews, findings, repairs, research, usage,
  timeline events, tool invocations, and artifact refs/hashes.

**Validation refuses:**

- a section or content hash that does not match;
- duplicate ids, or references to ids the export does not hold;
- non-ISO times;
- dishonest cost: a reported basis without an amount, or `UNKNOWN` carrying
  one;
- credential-shaped content, reported with its location.

**Translation.**

| Archive | Brain record |
|---|---|
| the export's own bytes | ARTIFACT (content-addressed), the anchor every record `DERIVED_FROM` |
| run | TRACE `LIFECYCLE`, facts carry the full identity and the archive hash |
| artifacts | ARTIFACT; `archive-ref:` when the Brain does not hold the bytes |
| tasks | TRACE `WORKER_ACTION` |
| evidence | EVIDENCE, class mapped, **UNVERIFIED** (nothing re-verified it) |
| reviews | DECISION `VERIFICATION`; a missing rationale says Unknown |
| findings | FINDING `REVIEWER_FINDING`; a missing severity is `UNKNOWN` |
| repairs | REPAIR, status mapped, `REPAIRS` links to findings |
| research | RESEARCH |
| usage | EVIDENCE `MEASUREMENT`, cost basis preserved |
| run accounting | EVIDENCE: a known total that is a **floor** when any component is unknown; estimates reported, never added |
| timeline events | TRACE, class by event type; scalar facts, dropped facts counted |
| tool invocations | TRACE `TOOL_INVOCATION` |

**Every imported record carries:**

- **Scope:** `{missionId, runId, taskId}`. The run id is **always**
  `workflow:<id>/<attempt>`, never `juliusRunId`, which is kept as a fact.
  The Julius run id is derived from the mission contract, so it repeats across
  paid attempts. In Formal's archive, one Julius run id spans three workflow
  runs, and task, evidence, finding and v1 Brain entry ids repeat between them.
  Scoped by it, three attempts would be one run to every state mode.
- **Provenance:** `run_observed`, with `commit = acceptedMainSha` and
  `externalRef = julius-paid-run-archive:<run>/<attempt>#<section>/<id>`.
- **Principal:** `JULIUS julius:archive-importer`.
- **Idempotency key:** `archive:<run>/<attempt>:<section>:<id>`.

**What that gives the import:**

- **Idempotent.** A re-import is `ALREADY_IMPORTED`.
- **Attempts are distinct runs.** Attempt 2 imports alongside attempt 1.
- **A changed history under the same identity is refused.** A re-sealed export
  with different content is refused with `idempotency_key_conflict`.
- **Atomic.** The whole run arrives in one commit (groups of 400 inside it) or
  none of it does.

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
**The archive is not frozen**, and the adapter is not written.
`research.tsv` carries 17 columns in two attempts and 21 in the other two.

**What already agrees:**
- **Identity** is the workflow run and attempt.
- **State mode** is recorded as FRESH, with its basis.
- **Cost honesty:** unknown settlements carry no amount (54 UNKNOWN, 25
  PROVIDER_REPORTED).
- **Credentials** are refused at archive time.

**What the adapter must not paper over.** These points are for the Formal lane,
when they freeze:

| Section | Archive carries | Contract needs | Honest handling until agreed |
|---|---|---|---|
| findings | `finding_id, blocking, status, claim` | taskId, severity, evidence ids, occurredAt | severity and task Unknown; **no time exists**, so either the export contract admits an Unknown time or Formal adds `created_at` |
| evidence | `evidence_id, evidence_type, status, safe_summary, occurred_at` | taskId, artifactRef, integrityHash | null (Unknown) |
| reviews | `decisions.tsv`: `decision_id, task_id, action, reason_code, occurred_at` | evidence ids, summary | none, and "Unknown — the archive recorded no rationale" |
| repairs | no table; repair tasks carry a parent task | finding ids, round, state | derived only from repair tasks, with finding links Unknown |
| tool invocations | `invocation_id, tool_id, state, requested_at` | taskId, completedAt | null |
| usage | `budget.tsv` settlements: role, amount, basis, estimate | provider, model, tokens | null. Tokens exist only per dispatch in `worker-diagnostics.tsv`, and are not joined by guess |
| events | `failures`, `budget`, `contract-events`, `research`, `participation` (sequenced); `trajectory` (no sequence) | sequence | trajectory rows need an explicit ordering rule |
| all tables | `psql -A` text, where NULL and `''` are indistinguishable; times like `2026-09-13 11:10:45.942+00` | null vs value; ISO time | `''` becomes Unknown, never an empty value; times are normalised explicitly |

**Already fixed on this branch:**
- Brain run ids are the workflow run and attempt. In the archive, one Julius run
  id spans three workflow runs, and task, evidence, finding and v1 entry ids
  repeat between attempts.
- The tool evidence vocabulary (`COMMAND_EXECUTION` and the rest) is mapped.

## Migrating paid history into the Brain

1. **Freeze the source.** The Formal lane's archive schema is temporary. Write
   the adapter (archive rows → `julius-paid-run-archive-export.v1`) only against
   its final shape, and run it read-only against `julius-postgres`.
2. **Seal each run** with `sealJuliusPaidRunArchiveExport`. Archive the sealed
   export bytes alongside the archive, since they are the anchor artifact.
3. **Import one run per commit** with `importJuliusPaidRunArchive`, into the
   project's Brain, under the importer principal. `REJECTED` lists every
   located error. Fix the adapter, not the export.
4. **Verify.**
   - Run `verifyJuliusBrainLedger` over the result.
   - Re-import: expect `ALREADY_IMPORTED`.
   - Compare the import's `accounting` against the paid-run ledger (the known
     total is a floor whenever a component was unknown).
5. **Nothing imported is guidance by default.** Every live run declares its
   state mode. Qualification and lab evaluations run FRESH, and LEARNING must
   name what it learns from.

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
| Archive import, state modes (domain) | `npx vitest run src/relay/mission/julius/julius-brain-archive-import.test.ts src/relay/mission/julius/julius-brain-state-modes.test.ts` |
| State modes with a real interpreter | `npx vitest run src/relay/workspace/julius-tools/python-state-modes.test.ts` |
| Archive import on PostgreSQL: parity, cold read, 6-way concurrent import, multi-group atomicity | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-brain-archive-postgres.test.ts` |
| Prepared live binding (bootstrap, mirror, typed context, checkpoint) | `npx vitest run relay-bridge/julius/project-brain-binding.test.ts`; on PostgreSQL with the live v1 repositories: `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-brain-live-binding-postgres.test.ts` |

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
   Nothing is provisioned. The deployment proposal, the controlled Brain
   service (OIDC, run-scoped sessions, server-side principals and state modes)
   and its acceptance tests come after the qualification, per
   `docs/JULIUS_BRAIN_PERSISTENCE.md`.
6. **Semantic retrieval.** Evaluated and available; on the labelled fixture
   no candidate beat the keyword baseline on MRR, so it is not adopted.
7. **The archive adapter.** The import contract is built and proven; the
   adapter from the Formal lane's archive tables is not, because that schema is
   temporary. Written against its final shape.
8. **Windows venvs.** The host names its pid for liveness because a venv
   `python.exe` is a redirector; crash-orphan termination was proven with the
   system interpreter, not inside a venv.
