-- MIGRATION 033: POST-DEPLOY CHECK. READ-ONLY; run AFTER 033 and compare with the pre-check.
-- (RUNBOOK.md, step 4.)
-- PASS only if: migration_033_applied = t, ledger_last = 033_wonderland_social, social_tables_present = 15,
--   social_rows = 0, recent_players_columns = 0, and players_rows equals the pre-check's.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by;
SELECT tablename FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'social\_%' ORDER BY 1;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') AS migration_033_applied,
       (SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1) AS ledger_last,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'social\_%') AS social_tables_present,
       (SELECT (SELECT count(*) FROM relay_wonderland.social_profiles) + (SELECT count(*) FROM relay_wonderland.social_settings)
             + (SELECT count(*) FROM relay_wonderland.social_blocks) + (SELECT count(*) FROM relay_wonderland.social_messages)
             + (SELECT count(*) FROM relay_wonderland.social_commands)) AS social_rows,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'relay_wonderland' AND table_name LIKE 'social\_%'
           AND column_name ILIKE '%recent%') AS recent_players_columns,
       (SELECT count(*) FROM relay_wonderland.players) AS players_rows;
COMMIT;
