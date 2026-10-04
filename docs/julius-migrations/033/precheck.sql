-- MIGRATION 033: PRE-DEPLOY CHECK. READ-ONLY; run BEFORE 033 and save the output with the deploy record.
-- (RUNBOOK.md, step 2.)
-- STOP THE DEPLOY unless:
--   migration_032_applied = t, migration_033_applied = f and social_tables_present = 0.
-- Migration 033 refuses by itself in the same cases (it rolls back and changes nothing), but the record is taken here first.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') AS migration_032_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') AS migration_033_applied,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'social\_%') AS social_tables_present,
       (SELECT count(*) FROM relay_wonderland.players) AS players_rows,
       (SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1) AS ledger_last;
COMMIT;
