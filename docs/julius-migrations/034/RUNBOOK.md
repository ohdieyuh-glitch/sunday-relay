# Migration 034 on the LIVE Julius database: runbook (CANDIDATE, 2026-10-07)

Migration `034_project_brain_components` gives three Project Brain components a durable home inside `relay_wonderland`: C.A.R.D., Mission Handoff and evals, plus the membership history (`docs/relay/PROJECT_BRAIN.md`, section 9). It writes NO row. What it creates:
- 9 tables: `project_brain_cards`, `project_brain_card_versions`, `project_brain_card_selection`, `project_brain_mission_cards`, `project_brain_handoffs`, `project_brain_handoff_versions`, `project_brain_evals`, `project_brain_eval_versions`, `project_brain_member_versions`;
- 12 indexes: the 9 primary keys, `project_brain_cards_project`, `project_brain_evals_subject` and the unique partial `project_brain_evals_one_current` (at most one CURRENT eval per project, subject and criterion);
- 69 named constraints on those tables (60 named by PostgreSQL), among them 24 foreign keys: 9 reference `project_brain_mutations` DEFERRABLE INITIALLY DEFERRED, 9 reference `projects`, 3 reference `julius_runs` and 3 reference a parent table of 034's own;
- 3 functions: `project_brain_component_guard`, `project_brain_run_in_project` and `project_brain_truncate_refused`;
- 25 triggers: 21 on its own tables, and 4 TRUNCATE guards on 029's `project_brain_records`, `project_brain_mutations`, `project_brain_record_versions` and `project_brain_links`.

What it changes that already exists:
- **029's `project_brain_mutations_operation_check`** is replaced under the same name. It admitted 4 operations (CREATE, REVISE, SET_STATUS, LINK) and now admits 15: the 4, CARD_CREATE, CARD_UPDATE, CARD_DELETE, CARD_SELECT, MISSION_PIN_CARD, HANDOFF_ENTER, HANDOFF_EXIT, EVAL_RECORD, EVAL_INVALIDATE, MEMBER_SET and MEMBER_REMOVE.
  - The new CHECK is validated against every existing row, with a full scan of `project_brain_mutations`, under ACCESS EXCLUSIVE until COMMIT.
- **029's 4 tables** each gain a statement-level TRUNCATE guard.
- **`projects`, `julius_runs` and `project_brain_mutations`** gain the internal RI triggers of the foreign keys that reference them: 18, 6 and 18.
  - None of their rows, columns or indexes changes.
  - No index is added to `julius_runs`, so 031's HOT premise is untouched.

Why: the Project Brain components count only once PB has landed on main and its store carries 034. Without 034, a PB build reports `componentsInstalled: false` and refuses every component write by name (`project_brain_components_not_installed`). It never shows an empty C.A.R.D. list.

It is the same discipline as 030, 031, 032 and 033:
- the guard runs inside the migration's one transaction;
- the writers are stopped;
- a verified backup and a recorded pre-check exist first;
- a post-check is compared with the pre-check;
- there is a down script.

What is kept from 033's runbook, and why. That discipline is the chain's, not Julius's (030 set it; 031, 032 and 033 restate it), and 034 needs every part of it:
- **writers stopped:**
  - the ALTER holds ACCESS EXCLUSIVE on `project_brain_mutations`, which every Brain write takes;
  - the foreign keys lock `projects` and `julius_runs` until COMMIT;
  - a Brain write arriving the moment 034 commits fails the post-check's row comparison and makes the down refuse.
- **backup, recorded pre-check, compared post-check, down script:** as 033.
- **added for 034, its own:** the apply role. 034 ALTERs 029's table and creates triggers on four of 029's tables, so it must be applied by the role that OWNS 029's tables (step 2 checks it).
  - A superuser could apply it too. It would then own 034's tables while the bridge connects as 029's owner, and every component read would be refused.
- **left out, as 033's own:** the `players` checks and the social tables.

**If any step below fails, STOP THE DEPLOY.**

## THE WINDOW: 034 after 033 (founder ruling, 2026-10-04 16:30Z)

- 034 is applied in its OWN reviewed window, after 033's post-check has PASSED and its window has closed.
  - **Never before 033:** 034's guard refuses unless `033_wonderland_social` is the ledger's last stamp.
    - Without that guard, a psql apply on a store at 032 would SUCCEED. 033's guard would then refuse forever, because the ledger's last stamp would be 034 and not 032.
  - **Never folded into another migration:** one file, one stamp, one record.
  - **Before 035 (voice):** 035 follows by its own explicit apply.
- It is LANDED before it is applied. An unlanded migration is never applied.
- **Explicit apply only:** the `psql` path in step 3. Never through an ordinary `migrate()` entry point (below) on the live store.
- **`DATABASE_URL` stays PARKED** (founder ruling R-6) for the whole window. This runbook never restores it.
- **The writers stay stopped from step 0 to step 6.** "The writers" includes every bridge that serves Project Brain routes (`relay-bridge/project-brain-routes.ts`, composed by `relay-bridge/server.ts`) against this store.
- **If 034 refuses:**
  - the store stays at 033, as 033's post-check verified it;
  - the writers stay stopped;
  - the migration-order owner decides.
  - A checkout that lists 034 would apply it implicitly the moment one of its entry points reached the store.

## ORDER: what happens before landing

Every entry point of a checkout that CONTAINS 034 migrates the database its environment names when it starts. These are the same entry points as for 030 to 033 (`docs/julius-migrations/030/RUNBOOK.md`, `docs/julius-migrations/033/RUNBOOK.md`):
- `relay-bridge/julius-live-mission.ts`;
- `scripts/julius-live-preflight.ts` (the zero-dispatch preflight, `npm run relay:julius:preflight`), through `migrateIfNeeded`;
- `scripts/julius-live-preflight-identity.ts`;
- `scripts/julius-recovery-drill.ts`;
- `scripts/julius-failure-recovery-drill.ts`;
- `scripts/julius-repair-loop-drill.ts`;
- `scripts/julius-sibling-support.ts`;
- `scripts/project-brain-proof-main.ts` (`npm run project-brain:proof`), which runs `migrate()` on the database it is given;
- `relay-bridge/dev-social-server.ts --pg <url>` and `scripts/r16-migrate-throwaway.ts`. They run `migrate()` only on a throwaway URL (`isThrowawayDatabaseUrl`), so they cannot reach the live store.

`relay-bridge/server.ts` is not a migration entry point. Serving Project Brain routes, it is a WRITER of every `project_brain_*` table.

Therefore:
1. **Until step 3 is recorded, from ANY checkout that contains 034:** run none of them against the live store. Any local run sets BOTH `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database (or unsets them). The test suites read only `JULIUS_TEST_DATABASE_URL`.
2. **Before landing:** step 0 (quiesce), step 1 (a verified backup, sha256 recorded), step 2 (a recorded pre-check).
3. **The writers stay stopped from step 0 until step 6.** If they must run before step 3 (the landing slips), redo steps 1 and 2 first.
4. **Step 3** applies 034 explicitly (the `psql` path below), and its record is kept.

## The live store

- It is the Docker container `julius-postgres` on the workstation: `127.0.0.1:5432`, database `julius`, role `julius`, as for 031, 032 and 033.
- The paid mission job's database is a fresh container per GitHub-hosted run. 034 applies there to an empty store through `migrate()`, and needs no runbook.
- Any other PERSISTENT store that carries this chain (the approved hosted database of the founder's 2026-10-04 deploy ruling included) gets 034 only by its own run of these steps, after its own 033:
  - with its own connection, backup and records;
  - with its own apply role checked in step 2;
  - an EMPTY one is initialised only by the reviewed EMPTY path (`docs/julius-migrations/030/RUNBOOK.md`), never by an entry point;
  - its connection comes from the hosted deploy plan, not from this file.
- **Never point a test at the live store.**

## Steps

**0. Quiesce the writers.** Stop the bridge and any mission job that writes this store. Confirm, before step 1, that no writer process and no other session is connected; step 2 records it as `other_client_sessions`.

**1. Back up and verify, at 033.** Do not continue without a verified dump. It holds the state 033's post-check verified, so rollback (c) returns to 033.
```
docker exec julius-postgres pg_dump -U julius -d julius -Fc -f /tmp/julius-pre-034.dump
docker exec julius-postgres pg_restore --list /tmp/julius-pre-034.dump > julius-pre-034.toc   # must list project_brain_records and project_brain_mutations, and none of 034's 9 tables
docker cp julius-postgres:/tmp/julius-pre-034.dump <backup-dir>/julius-pre-034-<UTC>.dump
sha256sum < <backup-dir>/julius-pre-034-<UTC>.dump > <backup-dir>/julius-pre-034-<UTC>.dump.sha256
```

**2. Pre-check (read-only), AS THE ROLE STEP 3 APPLIES WITH. Save the output.** Every block is ONE row under a fixed header: with `-A -F '|'`, psql prints the header line, the row and `(1 row)`.
```
docker exec -i julius-postgres psql -U julius -d julius -A -F '|' < docs/julius-migrations/034/precheck.sql > precheck-034-<UTC>.txt
```
STOP unless:
- `other_client_sessions = 0`;
- `relations_034_expected = 21`, `relations_034_present = 0`, `relations_034_as_created = 0`, `project_brain_relations_other = 0`;
- every relation column, `project_brain_cards` to `project_brain_member_versions_pkey`, is `f`;
- `functions_034_expected = 3` and `functions_034_present = 0`;
- `triggers_034_expected = 25`, `triggers_034_present = 0`, `triggers_034_as_created = 0` and `project_brain_triggers_other = 0`;
- every trigger column is `f`;
- `constraints_034_expected = 69`, `constraints_034_present = 0`, `constraints_034_as_created = 0`;
- `constraints_034_wrong_names` is empty, `constraints_on_034_tables_other = 0`, `fk_constraints_034 = 0` and `deferred_fks_to_project_brain_mutations = 0`;
- `project_brain_mutations_operations = CREATE,LINK,REVISE,SET_STATUS` and `project_brain_mutations_operation_count = 4` (029's CHECK, unchanged);
- every `*_rows` column and `catalog_034_md5` are empty (NULL: nothing exists to count);
- `component_operations_in_log = 0`;
- **`apply_role_owns_029 = t`**, and `apply_role` is the role step 3 uses (`julius` here). `owner_034_tables` is empty;
- `migration_033_applied = t` and `migration_034_applied = f`;
- `ledger_last = 033_wonderland_social` (nothing after 033 is applied).

Record `project_brain_mutations_rows`, `owner_029_tables` and `ledger_count`. Step 4 compares with them.

**3. Apply 034, explicitly** (after landing, before any entry point of the new main touches the live store):
```
docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/034_project_brain_components.sql > apply-034-<UTC>.txt 2>&1; echo "exit $?" >> apply-034-<UTC>.txt
```
- `exit 0` is required. Any other exit means 034 refused or failed and rolled back: rollback (a).
- It raises `migration_034_refused`, changing NOTHING, unless:
  - 033 is applied and is the ledger's last stamp;
  - 034 is not applied;
  - none of the names 034 creates is taken in `relay_wonderland`: the 21 relations, the 3 functions, the 25 trigger names and the 69 constraint names.
- A taken IMPLICIT name (`project_brain_cards_pkey`, `project_brain_evals_check`) is not an error to PostgreSQL. It would quietly create `project_brain_cards_pkey1`, or name the constraint `project_brain_evals_check2`. Only the guard refuses it.
- A role that does not own 029's tables fails at the ALTER (42501) and rolls back. Step 2 should have stopped it first.
- **Locks, all until COMMIT:**
  - ACCESS EXCLUSIVE on `project_brain_mutations`, for the CHECK swap and its full validation scan;
  - SHARE ROW EXCLUSIVE on 029's other three tables (their TRUNCATE triggers), on `projects` and `julius_runs` (the foreign keys referencing them) and on `project_brain_mutations`.
  - Every Julius run INSERT, UPDATE and DELETE waits behind it. The apply waits behind any open transaction on those tables.
  - The writers are stopped, so nothing waits.
- Apply from a clean checkout of the landed head. The file must begin with `BEGIN;` at byte 0 (the chain test requires it). Line endings change nothing 034 creates.
- Keep its `NOTICE migration_034_precheck: ...` line with the deploy record.
- Unlike 033, 034 has no in-transaction post-check. Step 4 is the post-check, and the real-PostgreSQL suite holds 034's exact catalog (`wonderland-migration-034`, case CAT).

**4. Post-check (read-only). Compare it with step 2.**
```
docker exec -i julius-postgres psql -U julius -d julius -A -F '|' < docs/julius-migrations/034/postcheck.sql > postcheck-034-<UTC>.txt
```
PASS only if all of these hold:
- the same blocks as step 2, header line for header line (only the first differs: `checked_at|database`);
- `other_client_sessions = 0`;
- `relations_034_expected = 21`, `relations_034_present = 21`, `relations_034_as_created = 21` and `project_brain_relations_other = 0`;
- every relation column is `t`;
- `functions_034_present = 3`;
- `triggers_034_present = 25`, `triggers_034_as_created = 25` and `project_brain_triggers_other = 0`;
- every trigger column is `t`;
- `constraints_034_present = 69` and `constraints_034_as_created = 69`;
- `constraints_034_wrong_names` is empty and `constraints_on_034_tables_other = 0`;
- `fk_constraints_034 = 24` and `deferred_fks_to_project_brain_mutations = 9`;
- `project_brain_mutations_operation_count = 15`, and `project_brain_mutations_operations` lists the 15 above;
- every `*_rows` column is `0` (034 writes no row);
- `project_brain_mutations_rows` equals step 2's, and `component_operations_in_log = 0`;
- `apply_role_owns_029 = t`, and `owner_034_tables` equals `owner_029_tables` (one role owns both);
- `migration_033_applied = t` and `migration_034_applied = t`;
- `ledger_count` = step 2's + 1, and `ledger_last = 034_project_brain_components`.

`catalog_034_md5` is recorded, not gated here:
- the record's verification compares it with the value the same post-check prints on a throwaway database built by the landed head's `migrate()` (same PostgreSQL major);
- the suite's DOCS case proves the two paths print the same value.

**5. Rerun the evidence. NOT on this database.** On the deployed commit, in julius-real-infra CI and/or on the portable throwaway server:
- `wonderland-migration-034`, `project-brain-components`, `project-brain` (real-PostgreSQL);
- `wonderland-migration-033` (its H case probes a later stamp);
- `julius-migration-chain` and `wonderland-postgres` (static).

**6. Restart the writers** only when all of these hold:
- 034's post-check has PASSED;
- Second has verified the record;
- `DATABASE_URL` is restored intentionally by the founder, as the explicit approved procedure says.

Then watch the first Brain read, which must report `componentsInstalled: true`, and the first component write.

## Classifying the store in this window

If the window's wrapper classifies the store with the R1 classifier (`docs/julius-migrations/030/classify-store.sql`), it keeps 030's variable names. For 034, both lists are generated by command from the landed checkout, never typed, with versions sorted:
- `want_029` = the chain's stamped versions THROUGH 033 (the state 034 starts from);
- `want_030` = the chain THROUGH 034.

Before step 3 it must say `STATE=AT_029` (rule 6: exactly through 033). After step 4 it must say `STATE=AT_TARGET` (rule 7: exactly through 034). Anything else, `PARTIAL` included, is a STOP. 034 creates no extension, no schema and nothing in `public`, so rules 1-3 read as before.

If a later migration (035 voice) is already in the checkout, the chain is cut at 034 explicitly. 035 reaches this store only by its own explicit apply, so the ledger never shows a gap (classifier rule 10).

## Rollback

**(a) 034 refused in step 3.** Nothing changed (one transaction), and the store is at 033. Investigate. Do not retry until step 2 passes. The writers stay stopped.

**(b) The post-check fails, or a decision reverses the change, BEFORE any component write.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/034/down.sql
```
- **What it removes, in one transaction:**
  - the 4 TRUNCATE triggers on 029's tables;
  - the 9 tables, newest first (dependency order), and with them their indexes, constraints, triggers and internal RI triggers;
  - the 3 functions.
- **What it restores, in the same transaction:**
  - 029's operation CHECK (the 4 operations);
  - the ledger: it deletes the 034 stamp.
- **It refuses, changing nothing, unless all of these hold:**
  - 034 is applied, and nothing after 034 is applied (`left(version, 3) > '034'`: 035 is rolled back first);
  - every relation, trigger and function 034 creates is exactly as 034 created it;
  - no other `project_brain_*` relation beyond 029's exists;
  - **no Project Brain component data exists:** no row in any of 034's 9 tables, and no operation outside 029's four in the mutation log.
- **This script never drops component data, and after the first component or member write it can never run.** The mutation log is append-only (029's trigger) and refuses TRUNCATE (034's trigger). So once one CARD_*, HANDOFF_*, EVAL_*, MISSION_PIN_CARD or MEMBER_* row is logged, 029's narrower CHECK cannot be restored over it. From then on the way back is a founder decision: rollback (c).
- Locks: ACCESS EXCLUSIVE on `project_brain_mutations`, 029's other three tables, `projects` and `julius_runs` until COMMIT. The writers are stopped anyway.
- An object outside 034 that depends on one of its tables or functions (a view, a later lane's foreign key) makes its DROP fail (2BP01), and the whole script rolls back.
- **Then deploy code that no longer lists 034.** Otherwise the next `migrate()` re-applies it. A PB build that still lists 034 then reports `componentsInstalled: false`.
- **Re-run step 2's check.** It must pass step 2's STOP list again, with `ledger_count` equal to the original pre-check's. The real-PostgreSQL suite's H case proves that the down restores the catalog EXACTLY.
- **Rollback order:** 034's down BEFORE 033's, and both before 032's, 031's and 030's. 033's down refuses while 034 is stamped (its later-migration guard).

**(c) Last resort: restore the pre-034 backup** into a NEW database first, and inspect it before replacing anything, as in 030's rollback (c). It holds the verified 033 state, and it loses every component write made since. Do not `pg_restore --clean` over the live database without the founder.
