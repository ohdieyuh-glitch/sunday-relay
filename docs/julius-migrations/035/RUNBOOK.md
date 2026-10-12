# Migration 035 on a PERSISTENT store: runbook (CANDIDATE, SECOND WONDERLAND, 2026-10-07; the 033 runbook's discipline, scaled; re-scoped by MAIN WONDERLAND, 2026-10-11, to the founder's ruling below)

> **THE FOUNDER'S RULING (2026-10-11, "ONE CHAIN, FULL REVIEW") GOVERNS THIS RUNBOOK.**
> - 035 reaches the **Wonderland hosted database** through its own reviewed run of these steps. That is where voice data lives.
> - The **Julius live store** receives 035 ONLY after ALL of the following:
>   - the independent review of 035 passes;
>   - the 035 rehearsal passes;
>   - MAIN JUJU confirms compatibility;
>   - the exact live apply is presented for the founder's explicit approval;
>   - a protected JULIUS HEAVY window is opened.
> - On the Julius live store the voice table stays **EMPTY**. No social or voice writer is ever pointed at that store, and no voice session or player voice record is ever written there.
> - No automatic runner may apply 035 there. `migrate()` REFUSES the Julius live store (`src/relay/persistence/protected-store.ts`), so step 3's explicit apply is the ONLY path.

Migration `035_wonderland_voice` creates the Wonderland party-voice binding inside `relay_wonderland`. It creates 3 relations, writes
NO row and changes no existing row:
- 1 table: `voice_puid_binding` (which EOS ProductUserId belongs to which signed-in player; `src/relay/social/voice-binding.ts`);
- 2 indexes: its primary key `voice_puid_binding_pkey` (user_id) and its UNIQUE `voice_puid_binding_puid_key` (puid);
- 1 foreign key: `user_id` → `relay_wonderland.players` (001), ON DELETE CASCADE; 2 CHECKs (the puid shape, the session id length);
- NO row. What it changes on an existing table:
  - its foreign key gives `players` two internal RI triggers;
  - a `players` DELETE now cascades into `voice_puid_binding`;
  - `CREATE TABLE … REFERENCES players` takes SHARE ROW EXCLUSIVE on `players` until COMMIT (milliseconds of DDL; readers are not blocked).

Why: R16 needs REAL EOS Voice (founder ruling, 10-04), and the hosted backend binds each PUID to exactly one signed-in player, durably.
The bridge is NOT a migration entry point; 035 reaches a persistent store only by this explicit, reviewed apply (FOUNDER_035_APPLY,
derived from the approved FOUNDER_033_APPLY r2 set).

## THE WINDOW: 035 after 034 (founder ruling, 2026-10-04 16:30Z)
- 035 is applied in its OWN reviewed window, after 034's post-check has PASSED and its window has closed.
- Never before 034: 035's guard refuses unless `034_project_brain_components` is applied AND is the ledger's last stamp (gapless).
- If 035 refuses, or its post-check fails, the store stays at 034, the writers stay stopped, and the migration-order owner decides.

## ORDER: what happens before landing
Every entry point of a checkout that CONTAINS 035 migrates the database its environment names when it starts: the same eight entry
points as for 030-034 (`docs/julius-migrations/030/RUNBOOK.md`), plus the dev social server's `--pg` (throwaway URLs only).
1. **Until step 3 is recorded, from ANY checkout that contains 035:** run none of them against the live store. A local run sets BOTH
   `JULIUS_DATABASE_URL` and `DATABASE_URL` to a throwaway database (or unsets them).
2. **Before landing:** step 0 (quiesce), step 1 (a verified backup, sha256 recorded), step 2 (a recorded pre-check).
3. **The writers stay stopped from step 0 until step 6.**
4. **Step 3** applies 035 explicitly (the `psql` path), and its record is kept.

## The stores
- **The Julius live store:** the Docker container `julius-postgres` on the workstation (`127.0.0.1:5432`, database `julius`, role
  `julius`), as for 031-034. It gets 035 only under the ruling above, and its voice table stays empty forever.
- **The Wonderland hosted store** (O1, Railway project wonderland-beta): it gets 035 by its own run of these steps, after #346 lands.
  This is the only store a social / voice writer uses.
- Any other PERSISTENT store that carries this chain gets 035 only by its own run of these steps.

## How code recognises the Julius live store (src/relay/persistence/protected-store.ts)
`migrate()` refuses to run anything on the Julius live store if ANY ONE of these holds:
- **S1, the marker:** the database's own catalog comment carries the token `relay-store-role=julius-live`. Written by step 4m.
- **S2, the pin:** sha256("<system identifier>/<database>") equals the pin taken BY COMMAND from the live store's 034 apply record.
- **S3:** the system identifier cannot be read AND the database is named `julius`.

Only S1 survives a restore into a NEW cluster (a new system identifier) or under a new name. That is why step 4m writes it, and rollback (c) re-writes it.

## Steps
**0. Quiesce.** Stop every writer of THIS store. No other client session may be connected.
- On the Julius live store, those are the Julius writers. No social or voice writer may be pointed at it, ever: if one is found connected, STOP. That is an incident, not a step.
- On the Wonderland hosted store, they include the bridge with `WONDERLAND_SOCIAL_ENABLED=1`, a writer of `players` and of `voice_puid_binding`.

**1. Back up and verify, at 034.** A `pg_dump -Fc` of the store, its sha256 recorded, its TOC listing the relay_wonderland objects and NO
`voice_*` object. It holds the state 034's post-check verified, so rollback (c) returns to 034.

**2. Pre-check** (`precheck.sql`, `psql -A -F '|'`, saved). STOP unless:
- `other_client_sessions = 0`;
- `relations_035_expected = 3`, `relations_035_present = 0`, `relations_035_as_created = 0`, `voice_relations_other = 0`;
- `voice_puid_binding`, `voice_puid_binding_pkey`, `voice_puid_binding_puid_key` all `f`; `voice_puid_binding_rows` and
  `catalog_035_md5` empty;
- `voice_fk_constraints = 0`;
- `migration_034_applied = t`, `migration_035_applied = f`, `ledger_last = 034_project_brain_components`.
Record `players_rows`, `players_referenced_by_fks`, `ledger_count`.

**3. Apply 035 explicitly**, in one transaction (`psql -v ON_ERROR_STOP=1 -f 035_wonderland_voice.sql`). Its own guard refuses, and
changes nothing, unless 034 is applied and last, 035 is not, and none of its 3 relations nor any other `voice_*` relation exists. Its
own post-check rolls everything back unless each relation is exactly as created, the table carries exactly 1 foreign key (on
`players`), and it holds no row. Expect exactly ONE `NOTICE: migration_035_precheck: …` and ONE `COMMIT`.

**4. Post-check** (`postcheck.sql`, saved beside step 2's). PASS only if:
- `relations_035_present = 3`, `relations_035_as_created = 3`, `voice_relations_other = 0`, every relation column `t`;
- `voice_puid_binding_rows = 0`; `catalog_035_md5` = the measured digest the apply pins;
- `voice_fk_constraints = 1`; `players_rows` = step 2's; `players_referenced_by_fks` = step 2's + 1;
- `migration_035_applied = t`; `ledger_count` = step 2's + 1; `ledger_last = 035_wonderland_voice`.

**4m. (The Julius live store ONLY) Write the marker** in its own transaction, after step 4 passes:
`COMMENT ON DATABASE julius IS 'relay-store-role=julius-live'`.
- PASS only if `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = 'julius'` reads exactly `relay-store-role=julius-live`. Save that output beside step 4's.
- The marker stays, whatever happens to 035 later. Rollback (b) does not remove it.
- Never write it on any other store. A drill, a rehearsal or a throwaway carrying it would be refused by every runner (fail-closed, but wrong).

**5. Deploy** the landed code. It lists 035, so `migrate()` finds it applied and does nothing. On the Julius live store `migrate()` would REFUSE to run anything in any case (protected-store.ts).

**6. Restart the writers.**
- **The Julius live store:** restart the JULIUS writers only. `SELECT count(*) FROM relay_wonderland.voice_puid_binding` must read 0, now and at every later check. A row there is an incident: voice data belongs in the Wonderland store (the founder, 2026-10-11).
- **The Wonderland hosted store:** restart the social bridge, and watch the first `/voice/join` write one row in `voice_puid_binding` for that player.

## Classifying the store in this window
The chain classifier (FOUNDER_035_APPLY's ClassifyOn): before step 3, exactly the chain through 034 (rule 6); after step 4, exactly
through 035 (rule 7). Anything else, `PARTIAL` included, is a STOP.

## Rollback
**(a) 035 refused in step 3.** Nothing changed (one transaction): the store is at 034. Investigate; do not retry until step 2 passes.

**(b) 035 applied, then must go:** `down.sql`, on a recorded decision, through FOUNDER_035_ROLLBACK (its own ledger-lock and checks).
- It refuses, and changes nothing, unless 035 is applied, NOTHING after 035 is applied, each of the 3 relations is exactly as 035
  created it, no other `voice_*` relation exists, and `voice_puid_binding` holds no row.
- **It never drops a binding.** It takes `LOCK TABLE voice_puid_binding IN SHARE MODE` BEFORE counting, so no writer can add a row
  between the count and the DROP (the 033 review's (b), applied here from the start).
- It drops the table WITHOUT CASCADE (a dependent object outside 035 makes the DROP fail, 2BP01, and the script rolls back) and
  deletes the 035 stamp, in one transaction.
- **Then deploy code that no longer lists 035.** Otherwise the next `migrate()` re-applies it on any store that is not protected. On the Julius live store `migrate()` refuses instead (protected-store.ts), so 035 returns there only by another reviewed, founder-approved apply.
- **Rollback order:** 035's down BEFORE 034's, and both before 033's. 033's and 034's downs refuse while 035 is stamped.

**(c) Last resort:** restore the pre-035 backup into a NEW database first, inspect it, and only then replace anything.
- **A restored or replacement live store is NOT protected until its marker is written again.**
  - A restore may leave the comment behind: `pg_restore` without `--create` does not restore database-level properties.
  - A new cluster has a new system identifier, so S2 misses it.
  - A renamed database misses S2 and S3.
- **Before ANY runner, bridge or script connects to it:**
  - write the marker exactly as step 4m does, and read it back;
  - record its system identifier and name;
  - if either changed, re-pin `PROTECTED_STORES` in protected-store.ts by a reviewed revision.
- Until then its URL stays parked, and only the founder runs anything against it.
