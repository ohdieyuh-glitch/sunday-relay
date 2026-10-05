-- MIGRATION 034 (RESERVED FOR THE PROJECT BRAIN; PREPARED, NOT CHOSEN): PRE-DEPLOY CHECK. READ-ONLY; run BEFORE 034 and
-- save the output with the deploy record. (RUNBOOK.md, step 2.)
-- STOP THE DEPLOY unless:
--   migration_033_applied = t, any_034_applied = f and ledger_last = 033_wonderland_social.
-- Migration 034 refuses by itself in the first two cases (it rolls back and changes nothing), but the record is taken here first.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') AS migration_033_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version LIKE '034\_%') AS any_034_applied,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'relay_wonderland') AS relay_wonderland_tables,
       (SELECT count(*) FROM relay_wonderland.players) AS players_rows,
       (SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1) AS ledger_last;
COMMIT;
