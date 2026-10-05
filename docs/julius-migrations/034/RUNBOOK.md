# Migration 034 (reserved for the Project Brain): runbook (PREPARED, NOT CHOSEN, 2026-10-05)

`034_julius_project_brain_reserved` writes its own ledger row and **nothing else**. It is option 4 of `docs/JULIUS_MIGRATION_034_OPTIONS.md` (#337):
- the number and the order stay the Project Brain's;
- its v2 content lands later, at a later number, with its own qualification.

If the founder chooses another 034, that 034 takes this file's place, and its runbook replaces this one.

## Why it exists

The founder's order is 031 → 032 → 033 social → **034 Project Brain** → 035 voice, and 034 has no specification. 035's guard requires a `034_*` stamp, so the ledger never shows a gap. This stamp lets 035 follow without inventing Project Brain content.

## Steps (after 033 is applied, in the same discipline as 033)

0. Stop the writers.
1. Take a verified backup.
2. **Pre-check** (`docs/julius-migrations/034/precheck.sql`; STOP unless):
   - `migration_033_applied = t`;
   - `any_034_applied = f`;
   - `ledger_last = 033_wonderland_social`.
3. Apply explicitly:
   ```
   docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/034_julius_project_brain_reserved.sql
   ```
   It must exit 0. It raises one of these, changing nothing, when its guard fails:
   - `migration_034_requires_033`;
   - `migration_034_already_numbered`.
4. **Post-check** (`docs/julius-migrations/034/postcheck.sql`; PASS only if):
   - `migration_034_applied = t`, `stamps_034 = 1`, `ledger_last = 034_julius_project_brain_reserved`;
   - `relay_wonderland_tables` and `players_rows` equal the pre-check's.

   **The window also requires the catalog fingerprint to be IDENTICAL before and after 034**, since it may write only its ledger row.
5. Continue with 035 in the same window, or restart the writers.

**`DATABASE_URL` stays PARKED** (ruling R-6). The live-store apply is a **local** operation: READY FOR LOCAL QUALIFICATION, after 033 lands and is applied, and only if option 4 is chosen.

In the migration window, `window.sh --through 034` (or `035`) runs these steps (`docs/julius-migrations/window/README.md`).

## Rollback

`docs/julius-migrations/034/down.sql` deletes the stamp, which is all 034 wrote. It refuses, changing nothing:
- unless 034 is applied;
- while any later migration is (035's guard needs a 034, so reverse 035 first).

After running it, the deployed code must no longer list 034, or the next `migrate()` re-applies it.
