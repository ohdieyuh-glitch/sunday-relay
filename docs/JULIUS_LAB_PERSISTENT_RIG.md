# Julius lab — a persistent evaluation rig (design, not built)

**Status:** design only, recorded 2026-09-12 by the live evaluation lab. Nothing in
this document is implemented, and nothing here may be implemented while the
formal continuous-worker qualification campaign is still landing and running.

**Purpose.** Three capabilities Julius has not proven on a paid path need state
that outlives one GitHub Actions job:

1. **Mission resumption after a job interruption.** A paid run stopped in one job
   and continued in another, by the same durable run.
2. **Project Brain continuity.** What one run recorded, read by a later one.
3. **Durable state across executions.** Leases, tool settlements and contract
   revisions that a second process finds where the first left them.

The per-job rig cannot test any of them, by design: every paid dispatch creates
its own PostgreSQL container and destroys it at the end of the job.

---

## 1. What the current rig does, and why that blocks these tests

| Fact | Where |
|---|---|
| PostgreSQL is `docker run … postgres:16-bookworm`, loopback only, with a password minted per job | `.github/julius-live-executor.sh`, `.github/julius-live-identity.sh` |
| `DATABASE_URL` is assembled from parts and handed to later steps and to the executor container, which is a second database client | `.github/julius-live-executor.sh` |
| The last step removes `julius-postgres`, `julius-executor`, the receipt root and the workspace tmpfs, so every dispatch meets an empty database | `.github/workflows/julius-first-live-mission.yml`, destroy step |
| A run's id is derived from the parsed contract only: re-running the same contract resumes the same durable run | `compileBootstrapRequest` in `relay-bridge/julius-live-mission.ts`; `run:<idempotencyKey>` in `relay-bridge/julius/bootstrap.ts` |
| A replayed bootstrap reports the durable state instead of creating a second run | `relay-bridge/julius/bootstrap.ts` |
| Migrations are version-based and safe on an existing database | `TransactionalWonderlandDatabase.migrate()` |
| The recovery sweep runs inside every tick, before claims, and is fenced on lease generation | `julius-run-loop.ts`; `julius-recovery-postgres.ts` |
| The recovery drill proves restart recovery with two processes and a real lease expiry — against fake providers, inside one job | `scripts/julius-recovery-drill.ts` |

**Project Brain rows are run-scoped.** Every read goes through
`brainEntriesForRun(runId, projectId)`; the revision counter lives on the run row;
brain rows cascade-delete with their run; and every mission fixture has its own
`projectId`. Nothing reads brain entries across runs today. **Project Brain
continuity across missions is therefore a product change — a cross-run read path
and a shared project — and not a rig change.** A persistent database buys the
honest first step: a resumed run's own brain survives its interruption.

## 2. What a naive "point `DATABASE_URL` somewhere else" breaks

| # | Gap | Consequence |
|---|---|---|
| G1 | The evidence dump queries whole tables, unscoped by run | a bundle carries other runs' rows |
| G2 | The dump reaches PostgreSQL only through `docker exec julius-postgres psql` | with no local container every file reads `unavailable` |
| G3 | The capability drills create their own databases with `createdb` and refuse a pre-existing run | they cannot share the experiment's database |
| G4 | The credential scan matches the exact secrets the job holds | a long-lived database password must be added to it |
| G5 | `mission_contracts` is written `ON CONFLICT DO NOTHING` | a persistent database freezes the first dispatch's snapshot |
| G6 | `migrate()` takes no lock | two jobs first-migrating one empty database would race |
| G7 | The executor's runtime id is a constant, so a second job presents the same id | orphaned sandbox rows from a destroyed job take a reconciliation path that has never run |
| G8 | The workspace tmpfs is rebuilt from the seed every job | a run resumed after its build finds the seed tree, not the edited one |

## 3. Options

**A — a persistent managed PostgreSQL in a new lab-only workflow (recommended).**
A separate `julius-lab-mission.yml`, a near-copy of the paid workflow, in its own
GitHub Environment (for example `julius-lab-validation`) holding the database URL
as a secret, with its own concurrency group. One database per lab experiment, not
a shared schema: every repository hard-codes the `relay_wonderland` schema, and a
separate database also keeps the drills' isolation property. Shared scripts gain
only optional parameters whose defaults reproduce today's behaviour byte for byte
(an external-database mode for the executor script; a direct `psql` path and run
scoping for the evidence dump). The URL must state its TLS mode deliberately: the
installed `pg` treats `sslmode=require` as full verification.

**B — per-job PostgreSQL restored from a `pg_dump` artifact (rejected as an input
to paid runs).** A dump is every row, including worker output the evidence
pipeline exists to keep out of artifacts; restoring "the latest dump" has no guard
against the wrong contract or commit; and a failed restore can silently start a
second full paid run under the belief that it is a resumption. Acceptable only as
a short-retention forensic backup of Option A's database.

**C — a self-hosted runner with a long-lived container (rejected).** It dissolves
the receipt-transport and "what the job creates, the job destroys" properties the
paid workflow is built on, and places the provider credentials on a machine the
founder must operate. The state that must persist is rows, not a host.

## 4. The interruption experiment

The minimal deterministic interruption is a **clean stop**, not a kill:
dispatch 1 runs with a small tick ceiling, the drive returns non-terminal, and a
finished tick holds no lease. Dispatch 2 re-runs the same contract, which resolves
to the same run id, and continues from the durable state.

- The paid workflow's inputs gate refuses `max_ticks` below 8, and at 8 a run may
  already be past its build, where G8 applies. A lab workflow may set its own
  lower floor for a deliberately truncated run; the smallest honest first
  experiment stops after the plan and before the build.
- Dispatch 2 needs `acknowledge_rerun`, because dispatch 1 wrote an attempt
  marker. Do not weaken that gate. A lab-only `-interrupted` marker carrying the
  durable run id lets the operator verify the resumption before typing the phrase.
- **Two dispatches arm two spend ceilings for one run.** State it in every
  dispatch description.
- Success is read from rows, not logs: the same run id; a non-created starting
  state; at least one task that succeeded before dispatch 2 and was never
  re-dispatched; and a final `COMPLETED`. Capture the pre-dispatch-2 state as
  evidence before dispatch 2 runs.
- The harder variant, a real kill mid-dispatch, is the paid analogue of the
  recovery drill: it leaves a live lease that dispatch 2 must wait out before the
  sweep requeues it. Run it only after the clean stop has proven the plumbing.

## 5. Decisions only the founder can make

| # | Decision |
|---|---|
| D1 | Approve a managed PostgreSQL instance and its cost. Whether the existing Railway project already has a Postgres service is not knowable from this repository. |
| D2 | Approve a new GitHub Environment holding a long-lived database credential, and whether it requires reviewers. |
| D3 | One database per lab experiment (recommended) or one shared lab database. |
| D4 | Accept that a resumption experiment is two paid dispatches with two spend ceilings. |
| D5 | A lab-only tick floor below 8, or the larger work of persisting the workspace too. |
| D6 | Typing the rerun phrase for a planned resumption, or a lab-only interruption marker checked first. |

## 6. What must not happen before the qualification campaign completes

- No change to `.github/workflows/julius-first-live-mission.yml`, its concurrency
  group, its tick floor, its marker gate or its destroy step.
- No change to `.github/julius-live-identity.sh` or the credential scan.
- No change to the default behaviour of any shared script; new parameters only.
- No lab workflow in the formal campaign's concurrency group, and no lab dispatch
  while a formal one is in flight.
- No lab `DATABASE_URL` pointing at a database a formal run has touched.
- No `pg_dump` artifact as an input to any paid path.
- No edit to `scripts/julius-first-live-mission.test.ts` to accommodate a lab
  workflow; a lab workflow gets its own test file.

## 7. Open uncertainties

- Whether the GitHub-hosted Ubuntu image ships a `psql` client.
- Whether sandbox reconciliation handles a destroyed job's orphaned rows without
  refusing (G7); the path has never executed in that shape.
- Whether the advance path that resumes verifications behaves identically when the
  interruption spans a job rather than a process.
