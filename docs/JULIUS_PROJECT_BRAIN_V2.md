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

## Proofs and how to run them

| Proof | Command |
|---|---|
| Domain, governance, projection, export, retrieval, API, sessions | `npx vitest run src/relay/mission/julius/julius-brain` |
| Python with real processes (15), SDK (11), pinned venv (3) | `npx vitest run src/relay/workspace/julius-tools/python-` |
| Integrated mission, in memory, real Python | `npx vitest run scripts/julius-brain-python-flow.test.ts` |
| PostgreSQL store, contention, restore, process A/B drill | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npx vitest run scripts/julius-project-brain-drill.test.ts` |
| Brain + Python across processes, restart, cross-process cancel, host crash | `JULIUS_REAL_POSTGRES=1 DATABASE_URL=… npm run julius:brain:python-drill` |

Set `JULIUS_BRAIN_DRILL_RESTART` (e.g. `docker restart <container>`) to also
restart the PostgreSQL server between processes; a restart is reported only
when `pg_postmaster_start_time()` actually moved.

## Schema changes

- `024_julius_project_brain.sql`: `julius_brains`, `julius_brain_records`,
  `julius_brain_links`, `julius_brain_entities`. Nothing cascades.
- `025_julius_python_executions.sql`: `julius_python_executions`.

## Not yet done (the private-beta gaps)

1. **Composition.** The live root does not yet mirror v1 writes
   (`createJuliusBrainMirroringWriter`), compile v2 context for workers, or
   expose `python.run` to worker turns. Deliberately deferred until the
   continuous-worker qualification lands.
2. **Production isolation for Python.** The executor sandbox image has no
   Python and the Docker path runs bash only; `python.run` is not in
   `JuliusToolId`. Hostile-code isolation requires that path.
3. **Budget.** Python executions do not reserve tool-call budget yet.
4. **Bridge routes.** `handleJuliusBrainApi` is not mounted in `relay-bridge`.
5. **Semantic retrieval.** Evaluated and available; on the labelled fixture
   no candidate beat the keyword baseline on MRR, so it is not adopted.
6. **Windows venvs.** The host names its pid for liveness because a venv
   `python.exe` is a redirector; crash-orphan termination was proven with the
   system interpreter, not inside a venv.
