# Migration 031 on the LIVE Julius database: runbook (CANDIDATE, 2026-10-03)

Migration `031_julius_run_transition_hot` replaces ONE index on `relay_wonderland.julius_runs`:
- dropped: `julius_run_project_state (project_id, state, created_at)`;
- created: `julius_run_project_created (project_id, created_at)`.

No row changes. Afterwards no index holds a column that a product UPDATE of `julius_runs` changes (`state`, `version`, `updated_at`, the three `lifecycle_*` columns, `project_brain_revision`). So PostgreSQL can apply a run's transition as a HOT update that writes no index entry. Under SERIALIZABLE, that index write was what made two different runs' transitions cancel each other on a small table (row 13 (i), the residual after 030 and the plan pin).

It is the same discipline as 030:
- the guard and the post-check run inside the migration's one transaction;
- the writers are stopped; a verified backup and a recorded pre-check exist first;
- a post-check is compared with the pre-check;
- there is a down script.

**If any step below fails, STOP THE DEPLOY.**

## ORDER: steps 0–2 happen BEFORE the PR is landed

Every entry point of a checkout that CONTAINS 031 migrates the database its environment names when it starts, and every workstation shell inherits the LIVE `DATABASE_URL`. These are the same eight entry points as for 030 (`docs/julius-migrations/030/RUNBOOK.md`):
- `relay-bridge/julius-live-mission.ts`;
- `scripts/julius-live-preflight.ts` (the zero-dispatch preflight, `npm run relay:julius:preflight`), through `migrateIfNeeded`;
- `scripts/julius-live-preflight-identity.ts`;
- `scripts/julius-recovery-drill.ts`;
- `scripts/julius-failure-recovery-drill.ts`;
- `scripts/julius-repair-loop-drill.ts`;
- `scripts/julius-sibling-support.ts`;
- `scripts/project-brain-proof-main.ts`.

Therefore:
1. **Until step 3 is recorded, from ANY checkout that contains 031:** run none of them against the live store. Any local run sets BOTH `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database (or unsets them). The test suites read only `JULIUS_TEST_DATABASE_URL`.
2. **Before landing:** step 0 (quiesce), step 1 (a verified backup, sha256 recorded), step 2 (a recorded pre-check).
3. **The writers stay stopped from step 0 until step 6.** If they must run before step 3, redo steps 1 and 2 first.
4. **Step 3** applies 031 explicitly (the `psql` path below), and its record is kept.

## The live store

- It is the Docker container `julius-postgres` on the workstation: `127.0.0.1:5432`, database `julius`, role `julius`.
- The paid mission job's database is a fresh container per GitHub-hosted run. 031 applies there to an empty store and needs no runbook.
- **Never point a test at the live store.**

## Steps

**0. Quiesce the writers.** Stop the bridge and any mission job that writes this store.

**1. Back up and verify.** Do not continue without a verified dump.
```
docker exec julius-postgres pg_dump -U julius -d julius -Fc -f /tmp/julius-pre-031.dump
docker exec julius-postgres pg_restore --list /tmp/julius-pre-031.dump > julius-pre-031.toc   # must list relay_wonderland objects
docker cp julius-postgres:/tmp/julius-pre-031.dump <backup-dir>/julius-pre-031-<UTC>.dump
sha256sum <backup-dir>/julius-pre-031-<UTC>.dump > <backup-dir>/julius-pre-031-<UTC>.dump.sha256
```

**2. Pre-check (read-only). Save the output.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/031/precheck.sql > precheck-031-<UTC>.txt
```
STOP unless:
- `old_index_matches = t`;
- `new_name_free = t`;
- `migration_030_applied = t`;
- `migration_031_applied = f`.

**3. Apply 031, explicitly (after landing, before any entry point of the new main touches the live store):**
```
docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/031_julius_run_transition_hot.sql > apply-031-<UTC>.txt 2>&1; echo "exit $?" >> apply-031-<UTC>.txt
```
- `exit 0` is required. Any other exit means 031 refused or failed and rolled back: rollback (a).
- It raises `migration_031_refused`, changing NOTHING, unless the old index is exactly `btree (project_id, state, created_at)` and the new name is free.
- It raises `migration_031_postcheck` if, after the change, the old index remains, the new one is not exactly `btree (project_id, created_at)`, or any index on `julius_runs` holds a column a run update changes.
- `DROP INDEX` holds an exclusive lock on `julius_runs` and `CREATE INDEX` a share lock, for the moment of the transaction. The writers are stopped, so nothing waits.
- Keep its `NOTICE migration_031_precheck: …` line with the deploy record.

**4. Post-check (read-only). Compare it with step 2.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/031/postcheck.sql > postcheck-031-<UTC>.txt
```
PASS only if all of these hold:
- `old_index_present = f` and `new_index_matches = t`;
- the index listing equals step 2's with exactly `julius_run_project_state` replaced by `julius_run_project_created`;
- `update_columns_indexed` is empty;
- `runs_rows` equals step 2's;
- `migration_031_applied = t`.

**5. Rerun the evidence. NOT on this database.** On the deployed commit, in julius-real-infra CI and/or on the portable throwaway server:
- `julius-migration-031`, `julius-plan-pin`;
- `julius-event-append-contention`, `julius-multi-mission`;
- the pre-registered row 13 (i) stress and census.

**6. Restart the writers.** After the first run transitions, run step 4's counter line again: `n_tup_hot_upd` must have grown by as much as `n_tup_upd` since step 4. A non-HOT run update means an index holds a column it changed, or the page had no room. Report it; it is not a data fault.

## Rollback

**(a) 031 refused in step 3.** Nothing changed (one transaction). Investigate; do not retry until step 2 passes.

**(b) The post-check fails, or a decision reverses the change.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/031/down.sql
```
- It re-creates the identical old index, drops 031's, and deletes the stamp, in one transaction.
- It refuses, changing nothing, unless 031 is applied, its index exists and the old name is free.
- **Then deploy code that no longer lists 031;** otherwise the next `migrate()` re-applies it.
- Re-run step 2's check: the index listing must equal the original pre-check's.

**(c) Last resort: restore the backup** into a NEW database first and inspect it before replacing anything, as in 030's rollback (c). Do not `pg_restore --clean` over the live database without the founder.
