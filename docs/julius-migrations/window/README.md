# The migration window: 031 then 032, as one recorded procedure

#321 owes two things before it lands: the combined 031+032 apply procedure, and its Docker rehearsal. This directory holds both.
- **The procedure is `window.sh`.** It runs exactly the steps of `docs/julius-migrations/031/RUNBOOK.md` and then `032/RUNBOOK.md`, in one window, and stops on any condition those runbooks say to STOP on.
- **The rehearsal is `rehearse.sh`.** It runs that same script against a throwaway `postgres:16` container. **What is rehearsed is what runs.**

Status: **AWAITING INDEPENDENT REVIEW (SECOND JUJU).** The cloud rehearsal below PASSED. The live window is a local operation on the founder's workstation: **READY FOR LOCAL QUALIFICATION**.

## What `window.sh` does, per migration

For each migration M in the window (031, 032, and 033 with `--through 033`):

| Runbook step | What the script does | STOP when |
|---|---|---|
| 0 | Counts the other client sessions | any other session is connected (the writers are not stopped) |
| 1 | Once, before the first migration: `pg_dump -Fc`, checks the TOC, `docker cp` with sha256, restores into a scratch database and compares the R1 row counts | the TOC lists no `relay_wonderland` objects, or the restored row counts differ |
| 2 | `M/precheck.sql`, every PASS condition read back from its own output | any condition differs from the runbook's |
| 3 | The landed migration file, `ON_ERROR_STOP`, keeping its `NOTICE migration_M_precheck` line | the exit is not 0 (rollback (a)) |
| 4 | `M/postcheck.sql`: every PASS condition, plus the values the runbook says equal step 2's | any condition fails, or a "same as step 2" value changed |
| ledger | The count of `schema_migrations` | the count is not +1, or the last stamp is not M's |
| rows | R1 row counts (`030/rowcounts-store.sql`), before and after, the ledger's own table aside | any table's count changed (033: anything but new empty `social_*` tables) |
| catalog | The R1 fingerprint (`030/fingerprint-store.sql`) after M, recorded | (recorded for Second to compare with an independently built reference) |

**Refusals:**
- a checkout with tracked changes, or a migration file with CRLF line endings;
- the live container `julius-postgres`, unless given `--live "APPLY THE WINDOW TO THE LIVE STORE"` on a recorded decision.

**What it never does:** read or set `DATABASE_URL` (ruling R-6), restart a writer, or apply anything not landed. **Its exit codes:** 0 PASS, 2 STOP (the record says which), 1 usage.

## The live window (local, after #321 lands)

From a clean LF checkout of the landed head, after the writers are stopped (031's step 0):
```
docs/julius-migrations/window/window.sh --container julius-postgres --through 032 \
  --record <backup-dir>/window-031-032-<UTC> --live "APPLY THE WINDOW TO THE LIVE STORE"
```
Then:
- **Step 5 of each runbook:** rerun the evidence NOT on this database.
- **Step 6, the writers:** restart them only after Second has verified the record, and only when `DATABASE_URL` is restored by the founder, as the explicit approved procedure says.

## The rehearsal

```
docs/julius-migrations/window/rehearse.sh --through 032 --record <dir>
```
1. It builds the 030 store from this checkout's own migration files.
2. It seeds the live store's shapes (`seed-at-030.sql`): 3 projects, 12 runs in six states, 36 tasks, 48 brain entries, and 300 events with their 300 outbox rows, each run's written in one transaction as 030 requires.
3. It then runs:

| Step | What it proves |
|---|---|
| R1 | 032 at 030 is refused (`migration_032_refused`); catalog and rows unchanged |
| R2 | the window, by `window.sh` |
| R3 | 031 a second time is refused (`migration_031_refused`); catalog unchanged |
| R4 | 032's DOWN, then 031's DOWN, return the catalog fingerprint AND every row count to the pre-window store exactly |
| R5 | the window applied again reaches the same catalog fingerprint as R2 (deterministic) |

### Cloud rehearsal of record: `rehearsals/2026-10-04-cloud-031-032/`

Run on the cloud container's Docker, `postgres:16` = 16.15 (image `sha256:1a6ab3f5…`).

| | |
|---|---|
| Checkout | `acae9166`, which is #321's reviewed head `aeba8b2c` plus this tooling |
| 031 file sha256 | `db5ced21dd49ede02923913e2630885306a31f17c5980c49be695a77fcf302ad` |
| 032 file sha256 | `12cf67261ce0486883fb54e498829fcc73d0bd631319f979206975771f84d362` |
| Pre-window catalog | `FINGERPRINT sha256=6040e517…8249 lines=1534` |
| After 031 | `a7fb4199…284d lines=1534` |
| After 032 | `6b59133d…b641 lines=1534` |
| Window conditions | 35, all ok |
| Result | R1–R5 PASS |

**The backup dump is not committed**; its sha256 is, in `window/backup.dump.sha256`. Every committed artifact is listed in `ARTIFACTS.sha256`.

**The same rehearsal through 033** was also run, on a throwaway combination of this tooling with the social branch (#323). It passed R1–R5 with 47 conditions, post-window `FINGERPRINT sha256=ebd0261d…a4b9 lines=1718`. That proves 033's guard, post-check, runbook conditions and DOWN in the window. It is recorded on #323, not here, because 033 is not in #321.

### What this rehearsal is not

- It is not the frozen 13 (i) rerun.
- It is not Second's independent reference fingerprint. Second builds that by its own method from the same SHA, and compares it.
- It is not the live window.
