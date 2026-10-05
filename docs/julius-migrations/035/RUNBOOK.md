# Migration 035 (Wonderland voice): runbook (in the chain after the reserved 034: PREPARED, NOT CHOSEN, 2026-10-05)

`035_wonderland_voice` creates three `relay_wonderland.voice_*` tables:
- `voice_identities`: one row per player, holding the EOS ProductUserId that player PROVED with a verified Connect ID token. The PUID is `UNIQUE`.
- `voice_identity_history`: every binding, kept.
- `voice_issuances`: which player was given a voice-room token for which room, as which EOS identity (the one the token admits), and when, and when the trusted server took it back. **Never the token**: the post-check refuses any column named like a token or a secret.

It is additive only.

## In the chain, after the reserved 034 (PREPARED, NOT CHOSEN)

The founder's order is 031 → 032 → 033 social → **034 Project Brain** → 035 voice, and 034's content is not specified. Option 4 of `docs/JULIUS_MIGRATION_034_OPTIONS.md` (#337) reserves the number: `034_julius_project_brain_reserved` writes only its own ledger row. **This change is prepared on that option and is not chosen.** If the founder chooses another 034, that 034 takes the reserved file's place, and everything below stands.

What the prepared change does, the "when 034 lands" list this runbook kept:
1. **Done:** the file moved to `src/relay/persistence/wonderland-migrations/035_wonderland_voice.sql`.
2. **Done:** it is registered in `WONDERLAND_MIGRATIONS` after 034.
3. **Done (the window branch, on #338 and #324):** 034 and 035 are in `docs/julius-migrations/window/window.sh`, with their PASS conditions read from `precheck.sql` and `postcheck.sql`, and rehearsed on Docker through 035 (R1–R5 PASS).
4. **Done:** the test-only placeholder stamp is gone. The suite holds both guards against the real 034:
   - 035 refuses without 033 and without a 034;
   - 034 refuses without 033, and when any 034 is already in the ledger;
   - 034 changes no table.

**Still true:**
- **Its guard refuses** unless 033 is applied AND a `034_*` stamp is in the ledger.
- **The voice routes answer 503** (`voice_store_unavailable`) on any store without `035_wonderland_voice` in its ledger.
- **On the hosted store,** the bootstrap tool (#332) applies 034 and 035 as pending to a store it left at 033, and changes nothing else (`wonderland-hosted-store.real-postgres.test.ts`).

## Steps (after 034 is landed and applied, in the same discipline as 033)

0. Stop the writers.
1. Take a verified backup.
2. **Pre-check** (`docs/julius-migrations/035/precheck.sql`; STOP unless):
   - `migration_033_applied = t`;
   - `migration_034_applied = t` (a 034 of any kind);
   - `migration_035_applied = f`;
   - `voice_tables_present = 0`;
   - `ledger_last` is the 034 stamp that was applied.
3. Apply explicitly:
   ```
   docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < src/relay/persistence/wonderland-migrations/035_wonderland_voice.sql
   ```
   It must exit 0. It raises one of these, changing nothing, when its guard fails:
   - `migration_035_requires_033`;
   - `migration_035_requires_034`;
   - `migration_035_tables_exist`.
4. **Post-check** (`docs/julius-migrations/035/postcheck.sql`; PASS only if):
   - `migration_035_applied = t` and `ledger_last = 035_wonderland_voice`;
   - `voice_tables_present = 3` and `voice_rows = 0`;
   - `token_columns = 0`: no column named like a token or a secret;
   - `players_rows` equals the pre-check's, and every pre-existing table's row count is unchanged (the window checks this for every table).
5. Rerun the evidence, NOT on this database: `wonderland-voice.real-postgres`, `wonderland-social.real-postgres`, and the migration chain suites.
6. Restart the writers. Only then configure `WONDERLAND_EOS_*` on the backend that should serve voice.

**`DATABASE_URL` stays PARKED** (ruling R-6). The live-store apply is a **local** operation: READY FOR LOCAL QUALIFICATION, after 034.

## Rollback

`docs/julius-migrations/035/down.sql`:
- It refuses, changing nothing, unless 035 is applied and nothing later is.
- It refuses while voice data exists, unless `SET relay.migration_035_down_accepts_data_loss = 'yes'` is issued in the same session.
- **Before running it:** revoke open voice memberships with the bridge's reconcile, or wait out the tokens' expiry. The down script removes the record of issuances, not the issuances themselves.
