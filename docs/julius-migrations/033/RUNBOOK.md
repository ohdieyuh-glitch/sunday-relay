# Migration 033 on the LIVE store: runbook (CANDIDATE, 2026-10-04)

Migration `033_wonderland_social` creates the durable state of the hosted Wonderland social layer, in 15 new `relay_wonderland.social_*` tables plus one sequence:
- profiles and settings;
- friendships and friend requests;
- blocks;
- parties, party members and party invitations;
- private servers, server members and server invitations;
- presence;
- Recent Players encounters;
- direct messages;
- the social command ledger.

The rules those tables hold are decided in `src/relay/mission/wonderland-social` (the privacy wall P1–P5, party, DM, no inference).

**It is additive only.** No existing table, row, index, function or trigger changes. Julius's write paths, which row 13 (i) governs, are not touched. Social writes take their own advisory lock (`WONDERLAND_SOCIAL_LOCK_KEY`), never Julius's.

It is the same discipline as 030, 031 and 032:
- the guard and the post-check run inside the migration's one transaction;
- the writers are stopped; a verified backup and a recorded pre-check exist first;
- a post-check is compared with the pre-check;
- there is a down script.

**If any step below fails, STOP THE DEPLOY.**

## Ownership and order

- **Migrations, the live store and deployment sequencing: JUJU.**
- **Backend and privacy correctness: SECOND Wonderland.** 033 does not land before SECOND Wonderland's verdict on the social backend.
- **The founder's migration order:** 031 Julius → 032 the 030 repair → **033 social** → 034 Project Brain → 035 voice. There are no gaps and no reordering.
- **033 never reaches the live store before 031 and 032 are LANDED and APPLIED.** Its guard refuses unless `032_julius_outbox_event_delete_forgets` is in the ledger.
- **An unlanded migration is never applied.** This file and the migration are on a stacked draft branch over #321 until #321 lands.
- **`DATABASE_URL` stays PARKED** (founder ruling R-6). This runbook never restores it.

**Explicit apply only:** the `psql` path in step 3. Never apply through an ordinary `migrate()` entry point on the live store. A checkout that lists 033 applies it implicitly the moment one of its entry points reaches a store. These are the same eight entry points listed for 030, 031 and 032 in `docs/julius-migrations/032/RUNBOOK.md`. So:
- **Until step 3 is recorded, from ANY checkout that contains 033:** run none of them against the live store.
- Any local run sets BOTH `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database, or unsets them.
- The test suites read only `JULIUS_TEST_DATABASE_URL`.

## The live store

- It is the Docker container `julius-postgres` on the founder's workstation: `127.0.0.1:5432`, database `julius`, role `julius`.
- Applying 033 there is a **local operation**: it is READY FOR LOCAL QUALIFICATION, and a cloud session never substitutes for it.
- The hosted backend's store (for R16) is decided by the deployment sequencing. It gets the same steps against its own database, with its own backup.
- A paid mission job's database is a fresh container per GitHub-hosted run. 033 applies there to an empty store, through `migrate()`, and needs no runbook.
- **Never point a test at a live store.**

## Steps

**0. Quiesce.** Stop the bridge and every writer, as for 031/032. If 033 is applied in the same window as 031/032, the writers stay stopped from 031's step 0 until this runbook's step 6.

**1. Verified backup.** Use the same command and verification as 030's step 1 (`pg_dump -Fc`, then restore into a scratch database and compare row counts). Record the file and its sha256.

**2. Pre-check (read-only):**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/033/precheck.sql > precheck-033-<UTC>.txt
```
PASS only if all of these hold:
- `migration_032_applied = t`;
- `migration_033_applied = f`;
- `social_tables_present = 0`;
- `ledger_last = 032_julius_outbox_event_delete_forgets`.

**3. Apply 033, explicitly:**
```
docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/033_wonderland_social.sql > apply-033-<UTC>.txt 2>&1; echo "exit $?" >> apply-033-<UTC>.txt
```
- `exit 0` is required. Any other exit means 033 refused or failed and rolled back: rollback (a).
- It raises `migration_033_requires_032` or `migration_033_tables_exist`, changing NOTHING, when its guard fails.
- It raises `migration_033_postcheck_tables` or `migration_033_postcheck_p3` if the result is not exactly the 15 tables with no Recent Players column.

**4. Post-check (read-only). Compare it with step 2:**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/033/postcheck.sql > postcheck-033-<UTC>.txt
```
PASS only if all of these hold:
- `migration_033_applied = t`;
- `ledger_last = 033_wonderland_social`;
- `social_tables_present = 15`;
- `social_rows = 0`;
- `recent_players_columns = 0`;
- `players_rows` equals step 2's.

**5. Rerun the evidence. NOT on this database.** On the deployed commit, in julius-real-infra CI and/or on a throwaway server, rerun:
- `wonderland-social.real-postgres`, the store contract and migration 033 suite;
- `julius-migration-031` and `julius-migration-032`, the chain still holds;
- the row 13 (i) concurrency suites. 033 is additive, so they must not move.

**6. Restart the writers.**

## Rollback

**(a) 033 refused in step 3.** Nothing changed (one transaction). Investigate; do not retry until step 2 passes.

**(b) The post-check fails, or a decision reverses the change.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/033/down.sql
```
- It drops the 15 tables and the sequence, and deletes the stamp, in one transaction.
- It refuses, changing nothing, in any of these cases:
  - 033 is not applied;
  - a later migration is applied;
  - any social table holds a row, unless `SET relay.migration_033_down_accepts_data_loss = 'yes'` was issued in the same session. **Social data is destroyed by design**: a founder decision.
- **Then deploy code that no longer lists 033;** otherwise the next `migrate()` re-applies it.

**(c) Last resort: restore the backup** into a NEW database first and inspect it before replacing anything, as in 030's rollback (c).
