# Migration 035 (Wonderland voice): runbook (STAGED, 2026-10-04)

`035_wonderland_voice` creates three `relay_wonderland.voice_*` tables:
- `voice_identities`: one row per player, holding the EOS ProductUserId that player PROVED with a verified Connect ID token. The PUID is `UNIQUE`.
- `voice_identity_history`: every binding, kept.
- `voice_issuances`: which player was given a voice-room token for which room and when, and when the trusted server took it back. **Never the token**: the post-check refuses any column named like a token or a secret.

It is additive only.

## STAGED: why it is not in the migration chain yet

The founder's order is 031 → 032 → 033 social → **034 Project Brain** → 035 voice. 034 does not exist yet. So:
- **The file lives here**, at `docs/julius-migrations/035/035_wonderland_voice.sql`, not in `src/relay/persistence/wonderland-migrations/`, and it is **not** listed in `WONDERLAND_MIGRATIONS`. No `migrate()` entry point can apply it.
- **Its guard refuses** unless 033 is applied AND a `034_*` stamp is in the ledger. Applying it early is impossible, not merely discouraged.
- **Its tests** (`src/relay/persistence/wonderland-voice.real-postgres.test.ts`) apply it on a throwaway database after a TEST-ONLY stamp, `034_test_placeholder_not_a_migration`. They also prove the guard refuses without that stamp.
- **When 034 lands:**
  1. move the file into the chain directory;
  2. register it after 034;
  3. add `035` to `docs/julius-migrations/window/window.sh`, with its PASS conditions from this runbook;
  4. remove the placeholder from the tests.

  That is one reviewed change.
- **Until then the voice routes answer 503** (`voice_store_unavailable`). The bridge offers the identity store only when `035_wonderland_voice` is in the ledger.

## Steps (after 034 is landed and applied, in the same discipline as 033)

0. Stop the writers.
1. Take a verified backup.
2. **Pre-check:**
   - `033_wonderland_social` is applied;
   - a `034_*` stamp is last in the ledger;
   - no `voice_*` tables exist.
3. Apply explicitly:
   ```
   docker exec -i julius-postgres psql -U julius -d julius -v ON_ERROR_STOP=1 < <the landed 035 file>
   ```
   It must exit 0. It raises one of these, changing nothing, when its guard fails:
   - `migration_035_requires_033`;
   - `migration_035_requires_034`;
   - `migration_035_tables_exist`.
4. **Post-check:**
   - exactly 3 `voice_*` tables;
   - no column named like a token or a secret;
   - `035_wonderland_voice` is last in the ledger;
   - every pre-existing table's row count is unchanged.
5. Rerun the evidence, NOT on this database: `wonderland-voice.real-postgres`, `wonderland-social.real-postgres`, and the migration chain suites.
6. Restart the writers. Only then configure `WONDERLAND_EOS_*` on the backend that should serve voice.

**`DATABASE_URL` stays PARKED** (ruling R-6). The live-store apply is a **local** operation: READY FOR LOCAL QUALIFICATION, after 034.

## Rollback

`docs/julius-migrations/035/down.sql`:
- It refuses, changing nothing, unless 035 is applied and nothing later is.
- It refuses while voice data exists, unless `SET relay.migration_035_down_accepts_data_loss = 'yes'` is issued in the same session.
- **Before running it:** revoke open voice memberships with the bridge's reconcile, or wait out the tokens' expiry. The down script removes the record of issuances, not the issuances themselves.
