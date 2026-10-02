# Migration 030 on the LIVE Julius database: runbook (founder gates, 2026-10-02)

Migration `030_julius_outbox_event_no_reread` drops ONE foreign key, `relay_wonderland.outbox.outbox_event_id_fkey` (outbox.event_id → events.event_id ON DELETE CASCADE). That key's check was the second source of the row 13 (i) serialization failures.

The guarantee the key gave is kept by triggers that read no relation:
- an outbox row only for an event written earlier in the same transaction;
- event and outbox ids immutable;
- deletes cascade;
- a TRUNCATE of events is refused.

**Founder gates:**
- drop only this key;
- prove zero orphans first;
- record the constraint and the counts;
- back up, with a restore path;
- STOP if integrity is already violated;
- re-verify after;
- drop no other constraint.

**If any step below fails, STOP THE DEPLOY.**

## ORDER: steps 0–2 happen BEFORE the PR is landed

Landing changes nothing in the local container by itself. But every entry point of a checkout that CONTAINS 030 (this branch, its PR, the landed main) migrates the database its environment names, and every workstation shell inherits the LIVE `DATABASE_URL`. These all call `migrate()` when they start:
- `relay-bridge/julius-live-mission.ts`;
- `scripts/julius-live-preflight-identity.ts`;
- `scripts/julius-recovery-drill.ts`;
- `scripts/julius-failure-recovery-drill.ts`;
- `scripts/julius-repair-loop-drill.ts`;
- `scripts/julius-sibling-support.ts`;
- `scripts/project-brain-proof-main.ts`.

So the first local run of any of them, from such a checkout, would apply 030 to the live store BEFORE a backup and a recorded pre-check existed. 030's own guard would still keep integrity, but the founder's order would be broken. Therefore:
1. **Until step 3 is recorded, from ANY checkout that contains 030:** run none of those entry points against the live store. Any local run sets BOTH `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database (or unsets them). The test suites already read only `JULIUS_TEST_DATABASE_URL`.
2. **Before landing:** step 0 (quiesce), step 1 (verified backup, sha256 recorded), step 2 (pre-check recorded). The founder's landing block refuses unless the backup's `.sha256` file and the pre-check record exist at the paths it is given.
3. **The writers stay stopped from step 0 until step 6.** If they must run again before step 3 (for example, the landing slips), redo steps 1 and 2 before step 3, so the counts the post-check compares are the ones the migration met.
4. **Step 3** applies 030 explicitly (the `psql` path below), and its record is kept. Only then may the bridge, the mission job or the scripts run against the live store again.

## The live store

- **What it is:** the Docker container `julius-postgres` on the workstation, published on `127.0.0.1:5432`, database `julius`, role `julius`. Every workstation shell's inherited `DATABASE_URL` points here.
- **What it is not:** the paid mission job's database. That job runs on a fresh GitHub-hosted `ubuntu-24.04` runner, where `.github/julius-live-executor.sh` starts its own container, also named `julius-postgres`, with no volume. It is created empty for each run, so 030 applies there to an empty store and needs no runbook. This workstation container is the only persistent Julius store.
- **Confirm before anything else:** `docker ps --filter name=julius-postgres`, then `docker exec julius-postgres psql -U julius -d julius -c "SELECT current_database(), current_user, version();"`.
- **Never point a test at this database.**
  - Tests read `JULIUS_TEST_DATABASE_URL` only.
  - The real-PostgreSQL evidence in step 5 runs on throwaway databases.

## Steps

**0. Quiesce the writers.** Stop the bridge and any mission job that writes this store. The counts in steps 2 and 4 must be comparable ("no lost writes").

**1. Back up and verify.** Do not continue without a verified dump.
```
docker exec julius-postgres pg_dump -U julius -d julius -Fc -f /tmp/julius-pre-030.dump
docker exec julius-postgres pg_restore --list /tmp/julius-pre-030.dump > julius-pre-030.toc   # must list relay_wonderland objects
docker cp julius-postgres:/tmp/julius-pre-030.dump <backup-dir>/julius-pre-030-<UTC>.dump
sha256sum <backup-dir>/julius-pre-030-<UTC>.dump > <backup-dir>/julius-pre-030-<UTC>.dump.sha256
```

**2. Pre-check (read-only). Save the output.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/030/precheck.sql > precheck-<UTC>.txt
```
STOP unless:
- `fk_matches = t`;
- `orphan_outbox_rows = 0`;
- `migration_029_applied = t`;
- `migration_030_applied = f`.

**3. Apply 030, explicitly (after landing, before any entry point of the new main touches the live store):**
```
docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/030_julius_outbox_event_no_reread.sql > apply-030-<UTC>.txt 2>&1; echo "exit $?" >> apply-030-<UTC>.txt
```
- `exit 0` is required. Any other exit means 030 refused or failed and rolled back: rollback (a).
- The migration checks itself inside its one transaction.
  - It raises `migration_030_refused` (and drops NOTHING) unless the key is exactly the one described above and no orphan exists.
  - It raises `migration_030_postcheck` if, after the drop, the key remains or an orphan appears.
- Keep its `NOTICE migration_030_precheck: …` line, which carries the counts, with the deploy record.

**4. Post-check (read-only). Compare it with step 2.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/030/postcheck.sql > postcheck-<UTC>.txt
```
PASS only if all of these hold:
- `fk_present = f`;
- the constraint listing equals step 2's minus exactly `outbox_event_id_fkey` (gate F);
- the trigger listing adds exactly `events_written_remember`, `outbox_requires_event_written`, `events_event_id_immutable`, `outbox_event_id_immutable`, `outbox_follows_event_delete` and `events_truncate_refused`;
- `orphan_outbox_rows = 0`;
- `events_rows` and `outbox_rows` equal step 2's;
- `migration_030_applied = t`.

**5. Rerun the evidence. NOT on this database.**
- The real-PostgreSQL settlement and concurrency suites (`julius-event-append-contention`, `julius-event-append`, `julius-handoff-fence`, `julius-handed-recovery`, `julius-multi-mission`, `julius-live-preflight-identity`) on the deployed commit, in julius-real-infra CI and/or on the portable throwaway server.

**6. Restart the writers.** Watch the first appends for a `23503 outbox_event_not_written` or `outbox_event_id_malformed`. Either would mean a writer outside the five pinned ones, so STOP.

## Rollback

**(a) 030 refused in step 3.** Nothing changed (one transaction). Investigate; do not retry until step 2 passes.

**(b) The post-check fails, or a decision reverses the change.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/030/down.sql
```
- It restores the identical foreign key, removes 030's triggers and functions, and deletes the stamp, in one transaction.
- It refuses, changing nothing, if an orphan exists.
- **Then deploy code that no longer lists 030;** otherwise the next `migrate()` re-applies it.
- Re-run step 2's check: the constraint listing must equal the original pre-check's.

**(c) Last resort: restore the backup.** Restore into a NEW database first and inspect it before replacing anything:
```
docker exec julius-postgres createdb -U julius julius_restore_030
docker exec julius-postgres pg_restore -U julius -d julius_restore_030 /tmp/julius-pre-030.dump
```
- Then repoint the runtime (`JULIUS_DATABASE_URL`) at it, or rename the databases while the writers are stopped.
- Do not `pg_restore --clean` over the live database without the founder.
