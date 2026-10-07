# Migration 033 on the LIVE Julius database: runbook (CANDIDATE, 2026-10-07)

Migration `033_wonderland_social` creates the Wonderland social store (R16) inside `relay_wonderland`. It creates 47 relations, writes NO row and changes no existing row:
- 17 tables: `social_privacy`, `social_friendships`, `social_friend_requests`, `social_blocks`, `social_mutes`, `social_reports`, `social_recent_players`, `social_conversations`, `social_conversation_members`, `social_messages`, `social_parties`, `social_party_members`, `social_party_invites`, `social_profiles`, `social_presence`, `social_meta`, `social_events`;
- 1 sequence, `social_events_seq_seq` (behind `social_events.seq bigserial`);
- 29 indexes: the 17 primary keys, `social_messages_conversation_id_sequence_key` (its UNIQUE constraint) and 11 named ones, 4 of them unique;
- 25 foreign keys: 21 reference `relay_wonderland.players` (001), 2 `social_conversations` and 2 `social_parties`;
- NO row: a bootstrap leaves every table empty (Julius's `julius-bootstrap-empty-store` holds it). `social_meta`'s `next_serial`, where the social ids start, is written by the store with its first minted id (an upsert).

The one existing table it touches is `players`:
- each of the 21 foreign keys gives it two internal RI triggers (42 in all);
- so a `players` DELETE now cascades into the social tables, and is refused (23503) for a player who leads a party (`social_parties.leader_id` has no ON DELETE action);
- none of its rows, columns, indexes or non-internal triggers changes.

Why: R16 counts only once the social backend has landed on main and reaches its store by an explicit apply (founder ruling, 2026-10-04 ~17:00Z, (B)). The bridge is NOT a migration entry point: it opens the social store on the Julius pool lazily and assumes 033 is applied (`relay-bridge/server.ts`). Without 033, every social route and the desktop sign-in answer 503 and write nothing.

It is the same discipline as 030, 031 and 032:
- the guard and the post-check run inside the migration's one transaction;
- the writers are stopped; a verified backup and a recorded pre-check exist first;
- a post-check is compared with the pre-check;
- there is a down script.

What is kept from 032's runbook, and why. That discipline is the chain's, not Julius's (030 set it; 031 and 032 restate it), and 033 needs every part of it:
- **writers stopped:** each `CREATE TABLE ... REFERENCES players` locks `players` until COMMIT; the post-check compares `players_rows` with the pre-check's; and a social bridge running against the store would write the moment 033 commits, which fails the post-check and makes the down refuse;
- **backup, recorded pre-check, compared post-check, down script:** as 032;
- **left out, as Julius's own:** the outbox and registry checks, the 031-then-032 window, the HOT counters.

**If any step below fails, STOP THE DEPLOY.**

## THE WINDOW: 033 after 032 (founder ruling, 2026-10-04 16:30Z)

- 033 is applied in its OWN reviewed window, after 031's and 032's post-checks have PASSED and their window has closed.
  - Never before 032: 033's guard refuses unless `032_julius_outbox_event_delete_forgets` is the ledger's last stamp.
  - Never folded into another migration: one file, one stamp, one record.
  - Before 034 (Project Brain) and 035 (voice): each follows by its own explicit apply, in numeric order.
- It is LANDED before it is applied. An unlanded migration is never applied.
- **Explicit apply only:** the `psql` path in step 3. Never through an ordinary `migrate()` entry point (below) on the live store.
- **`DATABASE_URL` stays PARKED** (founder ruling R-6) for the whole window. This runbook never restores it.
- The writers stay stopped from step 0 to step 6. "The writers" includes every bridge started with `WONDERLAND_SOCIAL_ENABLED=1` against this store.
- If 033 refuses, or its post-check fails, the store stays at 032 (as 032's post-check verified it), the writers stay stopped, and the migration-order owner decides. A checkout that lists 033 would apply it implicitly the moment one of its entry points reached the store.

## ORDER: what happens before landing

Every entry point of a checkout that CONTAINS 033 migrates the database its environment names when it starts. These are the same eight entry points as for 030, 031 and 032 (`docs/julius-migrations/030/RUNBOOK.md`):
- `relay-bridge/julius-live-mission.ts`;
- `scripts/julius-live-preflight.ts` (the zero-dispatch preflight, `npm run relay:julius:preflight`), through `migrateIfNeeded`;
- `scripts/julius-live-preflight-identity.ts`;
- `scripts/julius-recovery-drill.ts`;
- `scripts/julius-failure-recovery-drill.ts`;
- `scripts/julius-repair-loop-drill.ts`;
- `scripts/julius-sibling-support.ts`;
- `scripts/project-brain-proof-main.ts`.

The social branch adds two more, if the landed checkout carries them:
- `relay-bridge/dev-social-server.ts --pg <url>` runs `migrate()`, but only on a URL `isThrowawayDatabaseUrl` admits (`relay-bridge/wonderland-github-stub-seam.ts`): `127.0.0.1`, the throwaway port (`R16_THROWAWAY_PG_PORT`, default 54329, never 5432) and a database not named `julius`. It cannot reach the live store. Do not start it with `--pg` in this window anyway.
- `scripts/r16-migrate-throwaway.ts` runs `migrate()`, but only on `postgresql://postgres@127.0.0.1:<the throwaway port>/sw_r16_<n>` (or `sw2_r16_<n>`), the same port rule. It cannot reach the live store.

`relay-bridge/server.ts` is not a migration entry point. With `WONDERLAND_SOCIAL_ENABLED=1` it is a WRITER: of `players` at sign-in, and of every social table.

Therefore:
1. **Until step 3 is recorded, from ANY checkout that contains 033:** run none of them against the live store. Any local run sets BOTH `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database (or unsets them). The test suites read only `JULIUS_TEST_DATABASE_URL`.
2. **Before landing:** step 0 (quiesce), step 1 (a verified backup, sha256 recorded), step 2 (a recorded pre-check).
3. **The writers stay stopped from step 0 until step 6.** If they must run before step 3 (the landing slips), redo steps 1 and 2 first.
4. **Step 3** applies 033 explicitly (the `psql` path below), and its record is kept.

## The live store

- It is the Docker container `julius-postgres` on the workstation: `127.0.0.1:5432`, database `julius`, role `julius`, as for 031 and 032.
- The paid mission job's database is a fresh container per GitHub-hosted run. 033 applies there to an empty store, through `migrate()`, and needs no runbook.
- Any other PERSISTENT store that carries this chain (the approved hosted database of the founder's 2026-10-04 deploy ruling included) gets 033 only by its own run of these steps, with its own connection, backup and records, after its own 032.
  - An EMPTY one is initialised only by the reviewed EMPTY path (`docs/julius-migrations/030/RUNBOOK.md`), never by an entry point.
  - Its connection comes from the hosted deploy plan, not from this file.
- **Never point a test at the live store.**

## Steps

**0. Quiesce the writers.** Stop the bridge (with or without `WONDERLAND_SOCIAL_ENABLED`) and any mission job that writes this store. Confirm, before step 1, that no writer process and no other session is connected; step 2 records it as `other_client_sessions`.

**1. Back up and verify, at 032.** Do not continue without a verified dump. It holds the state 032's post-check verified, so rollback (c) returns to 032.
```
docker exec julius-postgres pg_dump -U julius -d julius -Fc -f /tmp/julius-pre-033.dump
docker exec julius-postgres pg_restore --list /tmp/julius-pre-033.dump > julius-pre-033.toc   # must list relay_wonderland objects, and no social_* object
docker cp julius-postgres:/tmp/julius-pre-033.dump <backup-dir>/julius-pre-033-<UTC>.dump
sha256sum <backup-dir>/julius-pre-033-<UTC>.dump > <backup-dir>/julius-pre-033-<UTC>.dump.sha256
```

**2. Pre-check (read-only). Save the output.** Every block is ONE row under a fixed header: with `-A -F '|'`, psql prints the header line, the row and `(1 row)`.
```
docker exec -i julius-postgres psql -U julius -d julius -A -F '|' < docs/julius-migrations/033/precheck.sql > precheck-033-<UTC>.txt
```
STOP unless:
- `other_client_sessions = 0`;
- `relations_033_expected = 47`, `relations_033_present = 0`, `relations_033_as_created = 0` and `social_relations_other = 0`;
- every relation column, `social_privacy` to `social_events_at`, is `f`;
- every `*_rows` column and `catalog_033_md5` are empty (NULL: nothing exists to count);
- `social_fk_constraints = 0`;
- `migration_031_applied = t`, `migration_032_applied = t` and `migration_033_applied = f`;
- `ledger_last = 032_julius_outbox_event_delete_forgets` (nothing after 032 is applied).

Record `players_rows`, `players_referenced_by_fks` and `ledger_count`; step 4 compares with them.

**3. Apply 033, explicitly (after landing, before any entry point of the new main touches the live store):**
```
docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/033_wonderland_social.sql > apply-033-<UTC>.txt 2>&1; echo "exit $?" >> apply-033-<UTC>.txt
```
- `exit 0` is required. Any other exit means 033 refused or failed and rolled back: rollback (a).
- It raises `migration_033_refused`, changing NOTHING, unless:
  - 032 is applied and is the ledger's last stamp, and 033 is not applied;
  - none of the 47 relations exists, and no other relation named `social_*` is in `relay_wonderland`.
- A taken IMPLICIT name (`social_privacy_pkey`, `social_messages_conversation_id_sequence_key`, `social_events_seq_seq`) is not an error to PostgreSQL, which would quietly create `social_privacy_pkey1`. Only the guard refuses it.
- It raises `migration_033_postcheck` if, after the CREATEs:
  - a relation is not exactly as 033 creates it (its kind; the sequence owned by `social_events.seq`; each index on its table, primary or unique as written, valid);
  - another `social_*` relation exists;
  - the social tables do not carry exactly 25 foreign keys, 21 of them on `players`;
  - `social_meta` holds a row (033 writes none).
- Locks: each `CREATE TABLE ... REFERENCES players` takes SHARE ROW EXCLUSIVE on `players` until COMMIT.
  - Every `players` INSERT, UPDATE and DELETE waits behind it, and the apply waits behind any open transaction that wrote `players`.
  - Every other lock is on a table this transaction creates.
  - The writers are stopped, so nothing waits.
- Apply from a clean checkout of the landed head. The file must begin with `BEGIN;` at byte 0 (the chain test and the fake-pool test require it). Line endings change nothing 033 creates.
- Keep its `NOTICE migration_033_precheck: ...` line with the deploy record.

**4. Post-check (read-only). Compare it with step 2.**
```
docker exec -i julius-postgres psql -U julius -d julius -A -F '|' < docs/julius-migrations/033/postcheck.sql > postcheck-033-<UTC>.txt
```
PASS only if all of these hold:
- the same blocks as step 2, header line for header line (only the first differs: `checked_at|database`);
- `other_client_sessions = 0`;
- `relations_033_expected = 47`, `relations_033_present = 47`, `relations_033_as_created = 47` and `social_relations_other = 0`;
- every relation column, `social_privacy` to `social_events_at`, is `t`;
- every `*_rows` column is `0` (033 writes no row);
- `players_rows` equals step 2's, `players_referenced_by_fks` = step 2's + 21, and `social_fk_constraints = 25`;
- `migration_031_applied = t`, `migration_032_applied = t` and `migration_033_applied = t`;
- `ledger_count` = step 2's + 1, and `ledger_last = 033_wonderland_social`.

`catalog_033_md5` is recorded, not gated here. The record's verification compares it with the value the same post-check prints on a throwaway database the landed head's `migrate()` built (same PostgreSQL major). The suite's DOCS case proves the two paths print the same value.

**5. Rerun the evidence. NOT on this database.** On the deployed commit, in julius-real-infra CI and/or on the portable throwaway server:
- `wonderland-migration-033`, `social-postgres`;
- `julius-migration-032` (its H case probes a later stamp);
- `julius-migration-chain` and `wonderland-postgres` (static).

**6. Restart the writers** only when 033's post-check has PASSED, Second has verified the record, and `DATABASE_URL` is restored intentionally by the founder, as the explicit approved procedure says.
- Only then may a bridge run with `WONDERLAND_SOCIAL_ENABLED=1` against this store.
- Watch the first sign-in and the first social write.
- A `players` DELETE refused with 23503 on `social_parties_leader_id_fkey` is 033's rule (the player leads a party), not a fault. Report it.

## Classifying the store in this window

If the window's wrapper classifies the store with the R1 classifier (`docs/julius-migrations/030/classify-store.sql`), it keeps 030's variable names. For 033, both lists are generated by command from the landed checkout, never typed, versions sorted:
- `want_029` = the chain's stamped versions THROUGH 032 (the state 033 starts from);
- `want_030` = the chain THROUGH 033.

Before step 3 it must say `STATE=AT_029` (rule 6: exactly through 032). After step 4 it must say `STATE=AT_TARGET` (rule 7: exactly through 033). Anything else, `PARTIAL` included, is a STOP. 033 creates no extension, no schema and nothing in `public`, so rules 1-3 read as before.

If later migrations (034 Project Brain, 035 voice) are already in the checkout, the chain is cut at 033 explicitly. They reach this store only by their own explicit applies, in numeric order, so the ledger never shows a gap (classifier rule 10).

## Rollback

**(a) 033 refused in step 3.** Nothing changed (one transaction): the store is at 032. Investigate; do not retry until step 2 passes. The writers stay stopped.

**(b) The post-check fails, or a decision reverses the change.**
```
docker exec -i julius-postgres psql -U julius -d julius < docs/julius-migrations/033/down.sql
```
- It drops the 17 tables, newest first (dependency order), and with them their 29 indexes, the sequence, the 25 foreign keys and the 42 RI triggers on `players`. It deletes the 033 stamp, in one transaction.
- It refuses, changing nothing, unless:
  - 033 is applied, and nothing after 033 is applied;
  - each of the 47 relations is exactly as 033 created it, and no other `social_*` relation exists;
  - the social tables hold no data: no row in any social table (a `next_serial` row in `social_meta` included: ids were minted), and `social_events_seq_seq` never used.
- **This script never drops social data.** 030's down refuses where its restore would be invalid, and 031's and 032's change no row; 033's refuses where it would lose a row. Once players have used the store, the way back is a founder decision: a fresh verified dump first, then rollback (c), or a deliberate, recorded removal of the rows before this script.
- Locks: dropping the foreign keys removes their triggers from `players` under ACCESS EXCLUSIVE until COMMIT, so even reads of `players` wait. The writers are stopped anyway.
- An object outside 033 that depends on a social table (a view, a later lane's foreign key) makes its DROP fail (2BP01), and the whole script rolls back.
- **Then deploy code that no longer lists 033;** otherwise the next `migrate()` re-applies it. A social bridge then answers 503 again.
- Re-run step 2's check. It must pass step 2's STOP list again, with `players_referenced_by_fks` and `ledger_count` equal to the original pre-check's.
- **Rollback order:** 033's down BEFORE 032's, and both before 031's and 030's. 032's down refuses while 033 is stamped (its later-migration guard). 031's and 030's down scripts do not look for 033.

**(c) Last resort: restore the pre-033 backup** into a NEW database first and inspect it before replacing anything, as in 030's rollback (c). It holds the verified 032 state. Do not `pg_restore --clean` over the live database without the founder.
