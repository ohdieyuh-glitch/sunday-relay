-- MIGRATION 035 (WONDERLAND VOICE): POST-DEPLOY CHECK. READ-ONLY; run AFTER 035 and compare with the pre-check.
-- (RUNBOOK.md, step 4.)
-- PASS only if: migration_035_applied = t, ledger_last = 035_wonderland_voice, voice_tables_present = 3, voice_rows = 0,
--   token_columns = 0, and players_rows equals the pre-check's.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by;
SELECT tablename FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'voice\_%' ORDER BY 1;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') AS migration_035_applied,
       (SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1) AS ledger_last,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'voice\_%') AS voice_tables_present,
       (SELECT (SELECT count(*) FROM relay_wonderland.voice_identities) + (SELECT count(*) FROM relay_wonderland.voice_identity_history)
             + (SELECT count(*) FROM relay_wonderland.voice_issuances)) AS voice_rows,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'relay_wonderland' AND table_name LIKE 'voice\_%'
           AND (column_name ILIKE '%token%' OR column_name ILIKE '%secret%')) AS token_columns,
       (SELECT count(*) FROM relay_wonderland.players) AS players_rows;
COMMIT;
