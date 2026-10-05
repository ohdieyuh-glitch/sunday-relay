-- MIGRATION 034 (RESERVED FOR THE PROJECT BRAIN; PREPARED, NOT CHOSEN): POST-DEPLOY CHECK. READ-ONLY; run AFTER 034 and
-- compare with the pre-check. (RUNBOOK.md, step 4.)
-- PASS only if: migration_034_applied = t, stamps_034 = 1, ledger_last = 034_julius_project_brain_reserved, and
--   relay_wonderland_tables and players_rows equal the pre-check's. 034 writes its own ledger row and nothing else, so the
--   window also requires the catalog fingerprint to be IDENTICAL before and after it.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_julius_project_brain_reserved') AS migration_034_applied,
       (SELECT count(*) FROM relay_wonderland.schema_migrations WHERE version LIKE '034\_%') AS stamps_034,
       (SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1) AS ledger_last,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'relay_wonderland') AS relay_wonderland_tables,
       (SELECT count(*) FROM relay_wonderland.players) AS players_rows;
COMMIT;
