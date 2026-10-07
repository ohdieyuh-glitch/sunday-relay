# Migration 032 on the LIVE Julius database: runbook (CANDIDATE, 2026-10-04)

Migration `032_julius_outbox_event_delete_forgets` replaces TWO function bodies, the two of 030's written-event registry (the setting `relay_wonderland.events_written`) that can let an outbox row name a missing event:
- `relay_wonderland.outbox_follows_event_delete()`, behind 030's trigger `outbox_follows_event_delete` (`AFTER DELETE ON relay_wonderland.events FOR EACH ROW`):
  - kept: the cascade (deleting an event deletes its outbox row);
  - added: the deleted id is forgotten from the registry, by a string rewrite that reads no relation.
- `relay_wonderland.events_written_remember()`, behind 030's trigger `events_written_remember` (`AFTER INSERT ON relay_wonderland.events FOR EACH STATEMENT`):
  - kept: every well-formed id the statement wrote is registered, read from the statement's transition table only;
  - added: an id that is empty or holds chr(31) is left out, so its parts are never registered. No outbox row can name such an id anyway (030 refuses it), and a statement that wrote only such ids registers nothing.

No table, index, constraint, trigger or row changes. `CREATE OR REPLACE` keeps each function's oid, so neither trigger is dropped or re-created.

Why: under 030 alone, either of these in ONE transaction commits an outbox row naming a missing event, which the foreign key 030 replaced refused:
- `INSERT event E -> DELETE event E -> INSERT outbox(E)` (Codex finding (1) on #313, confirmed by Second Julius: `_qa_handoff/julius_readiness/landing/SECOND_JUDGEMENT_CODEX_030_P1_20261004.md`);
- `INSERT event 'r' || chr(31) || 's' -> INSERT outbox('r')` (found while drafting 032; the independent reviewer ruled it folded in).

The exposure today is nil (no production path does either); after 032 the database refuses both (`23503 outbox_event_not_written`).

It is the same discipline as 030 and 031:
- the guard and the post-check run inside the migration's one transaction;
- the writers are stopped; a verified backup and a recorded pre-check exist first;
- a post-check is compared with the pre-check;
- there is a down script.

**If any step below fails, STOP THE DEPLOY.**

## THE WINDOW: 031, then 032 (founder ruling, 2026-10-04)

- 032 is applied in the SAME reviewed pre-freeze window as 031, right after 031's step 4 (post-check) has PASSED.
  - Never before 031: 032's guard refuses while `031_julius_run_transition_hot` is not in the ledger.
  - Never folded into 031: two files, two stamps, two records.
- Both are LANDED before either is applied. An unlanded migration is never applied.
- **Explicit apply only:** the `psql` path in step 3. Never through an ordinary `migrate()` entry point (the eight below) on the live store.
- **`DATABASE_URL` stays PARKED** (founder ruling R-6) for the whole window. This runbook never restores it.
- The writers stay stopped from 031's step 0 to this runbook's step 6. Nothing restarts between 031 and 032.
- If 032 refuses, or its post-check fails, the store stays at 031 (as 031's post-check verified it), the writers stay stopped, and the founder decides. A checkout that lists 032 would apply it implicitly the moment one of its entry points reached the store.

## ORDER: what happens before landing

Every entry point of a checkout that CONTAINS 032 migrates the database its environment names when it starts. These are the same eight entry points as for 030 and 031 (`docs/julius-migrations/030/RUNBOOK.md`):
- `relay-bridge/julius-live-mission.ts`;
- `scripts/julius-live-preflight.ts` (the zero-dispatch preflight, `npm run relay:julius:preflight`), through `migrateIfNeeded`;
- `scripts/julius-live-preflight-identity.ts`;
- `scripts/julius-recovery-drill.ts`;
- `scripts/julius-failure-recovery-drill.ts`;
- `scripts/julius-repair-loop-drill.ts`;
- `scripts/julius-sibling-support.ts`;
- `scripts/project-brain-proof-main.ts`.

Therefore:
1. **Until step 3 is recorded, from ANY checkout that contains 032:** run none of them against the live store. Any local run sets BOTH `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database (or unsets them). The test suites read only `JULIUS_TEST_DATABASE_URL`.
2. **Before landing:** 031's steps 0-2 (quiesce, verified backup, recorded pre-check) open the window. 032's own pre-check (step 2 here) can only pass once 031 is applied, so it is taken after 031's step 4, never before.
3. **Step 3** applies 032 explicitly (the `psql` path below), and its record is kept.

## The live store

- It is the Docker container `julius-postgres` on the workstation: `127.0.0.1:5432`, database `julius`, role `julius`.
- The paid mission job's database is a fresh container per GitHub-hosted run. 032 applies there to an empty store, through `migrate()`, and needs no runbook.
- **Never point a test at the live store.**

## Steps

**0. The writers.** Stopped since 031's step 0, and they stay stopped. Confirm, before step 1, that no writer process and no other session is connected.

**1. Back up and verify, at 031.** Do not continue without a verified dump. It holds the state 031's post-check verified, so rollback (c) returns to 031, not to 030.
```
docker exec julius-postgres pg_dump -U julius -d julius -Fc -f /tmp/julius-pre-032.dump
docker exec julius-postgres pg_restore --list /tmp/julius-pre-032.dump > julius-pre-032.toc   # must list relay_wonderland objects, the functions outbox_follows_event_delete and events_written_remember among them
docker cp julius-postgres:/tmp/julius-pre-032.dump <backup-dir>/julius-pre-032-<UTC>.dump
sha256sum <backup-dir>/julius-pre-032-<UTC>.dump > <backup-dir>/julius-pre-032-<UTC>.dump.sha256
```

**2. Pre-check (read-only). Save the output.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/032/precheck.sql > precheck-032-<UTC>.txt
```
STOP unless:
- `delete_trigger_matches = t` and `registry_triggers_match = t`;
- `function_is_030 = t` and `function_has_forget = f`;
- `remember_is_030 = t` and `remember_has_filter = f`;
- `orphan_outbox_rows = 0`;
- `migration_030_applied = t`, `migration_031_applied = t` and `migration_032_applied = f`;
- `ledger_last = 031_julius_run_transition_hot` (nothing after 031 is applied).

**3. Apply 032, explicitly (after landing, before any entry point of the new main touches the live store):**
```
docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/032_julius_outbox_event_delete_forgets.sql > apply-032-<UTC>.txt 2>&1; echo "exit $?" >> apply-032-<UTC>.txt
```
- `exit 0` is required. Any other exit means 032 refused or failed and rolled back: rollback (a).
- It raises `migration_032_refused`, changing NOTHING, unless:
  - 030 and 031 are applied and 032 is not;
  - the trigger `outbox_follows_event_delete` is exactly 030's (AFTER DELETE FOR EACH ROW, enabled, calling the function), and so are the registry triggers `events_written_remember` and `outbox_requires_event_written`;
  - both functions, `outbox_follows_event_delete()` and `events_written_remember()`, are exactly 030's (plpgsql, returning trigger, no settings, not SECURITY DEFINER, and 030's body compared with whitespace normalized, so a checkout's line endings do not refuse it and any other change does);
  - no outbox row names a missing event.
- It raises `migration_032_postcheck` if, after the change, the delete trigger is not 030's, either function does not carry exactly the body 032 writes (the forget; the filter), or an outbox row names a missing event.
- `CREATE OR REPLACE FUNCTION` rewrites two catalog rows. It takes no lock on `events` or `outbox`, and neither trigger is ever absent. The writers are stopped anyway.
- Apply from a clean LF checkout of the landed head. The guard does not care about line endings, but the R1 catalog fingerprint hashes each function body byte for byte (`body_md5`), so a CRLF copy would not match a reference built on Linux.
- Keep its `NOTICE migration_032_precheck: ...` line with the deploy record.

**4. Post-check (read-only). Compare it with step 2.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/032/postcheck.sql > postcheck-032-<UTC>.txt
```
PASS only if all of these hold:
- `delete_trigger_matches = t` and `registry_triggers_match = t`;
- `function_is_030 = f` and `function_has_forget = t`;
- `remember_is_030 = f` and `remember_has_filter = t`;
- the trigger listing equals step 2's, line for line;
- `function_definition` equals step 2's with exactly the forget added (the `IF ... END IF` block), and nothing removed;
- `remember_definition` equals step 2's with exactly its `SELECT string_agg(...)` line changed (the filter appended), and nothing else;
- `orphan_outbox_rows = 0`;
- `events_rows` and `outbox_rows` equal step 2's;
- `migration_032_applied = t`, `ledger_count` = step 2's + 1, and `ledger_last = 032_julius_outbox_event_delete_forgets`.

**5. Rerun the evidence. NOT on this database.** On the deployed commit, in julius-real-infra CI and/or on the portable throwaway server:
- `julius-migration-032`, `julius-migration-031`, `julius-migration-030`;
- `julius-event-append-contention`, `julius-event-append`, `julius-live-preflight-identity`;
- the window's pre-registered row 13 (i) stress and census (031's step 5).

**6. Restart the writers** only when 031's AND 032's post-checks have PASSED, Second has verified the window's record, and `DATABASE_URL` is restored intentionally by the founder, as the explicit approved procedure says. Watch the first appends for `23503 outbox_event_not_written` or `outbox_event_id_malformed`. Either means a writer outside the five pinned ones, a writer that writes an outbox row after deleting its event, or one that names a part of an event id holding chr(31), so STOP.

## Classifying the store in this window

If the window's wrapper classifies the store with the R1 classifier (`docs/julius-migrations/030/classify-store.sql`), it keeps 030's variable names. For 032, both lists are generated by command from the landed checkout, never typed, versions sorted:
- `want_029` = the chain's stamped versions THROUGH 031 (the state 032 starts from);
- `want_030` = the chain THROUGH 032.

Before step 3 it must say `STATE=AT_029` (rule 6: exactly through 031). After step 4 it must say `STATE=AT_TARGET` (rule 7: exactly through 032). Anything else, `PARTIAL` included, is a STOP.

If later migrations (033 Wonderland social, 034 Project Brain, 035 voice) are already in the checkout, the chain is cut at 032 explicitly. They reach this store only by their own explicit applies, in numeric order, so the ledger never shows a gap (classifier rule 10).

## Rollback

**(a) 032 refused in step 3.** Nothing changed (one transaction): the store is at 031. Investigate; do not retry until step 2 passes. The writers stay stopped.

**(b) The post-check fails, or a decision reverses the change.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/032/down.sql
```
- It restores both of 030's function bodies byte for byte and deletes the 032 stamp, in one transaction.
- It refuses, changing nothing, unless 032 is applied, nothing after 032 is applied, both functions are exactly 032's and the delete trigger is still 030's.
- Afterwards the store has both of 030's orphan paths again.
- **Then deploy code that no longer lists 032;** otherwise the next `migrate()` re-applies it.
- Re-run step 2's check: `function_is_030 = t`, `remember_is_030 = t` and `migration_032_applied = f`, and the trigger listing, `function_definition` and `remember_definition` equal the original pre-check's.
- **Rollback order:** 032's down BEFORE 031's down, and both before 030's. 031's and 030's down scripts do not look for 032. Run out of order, they would leave the ledger holding 032 without its predecessors (a gap, classifier rule 10), and 030's would leave a 032 stamp for the two functions it dropped.

**(c) Last resort: restore the pre-032 backup** into a NEW database first and inspect it before replacing anything, as in 030's rollback (c). It holds the verified 031 state. Do not `pg_restore --clean` over the live database without the founder.
