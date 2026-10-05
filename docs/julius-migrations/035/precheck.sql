-- MIGRATION 035 (WONDERLAND VOICE): PRE-DEPLOY CHECK. READ-ONLY; run BEFORE 035 and save the output with the deploy record.
-- (RUNBOOK.md, step 2.)
-- STOP THE DEPLOY unless:
--   migration_033_applied = t, migration_034_applied = t (a 034 of any kind), migration_035_applied = f,
--   voice_tables_present = 0, and ledger_last is the 034 stamp that was applied.
-- Migration 035 refuses by itself in the first, second and fourth cases (it rolls back and changes nothing), but the record
-- is taken here first.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') AS migration_033_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version LIKE '034\_%') AS migration_034_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') AS migration_035_applied,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'voice\_%') AS voice_tables_present,
       (SELECT count(*) FROM relay_wonderland.players) AS players_rows,
       (SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1) AS ledger_last;
COMMIT;
