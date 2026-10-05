-- MIGRATION 034 (RESERVED FOR THE PROJECT BRAIN; PREPARED, NOT CHOSEN): DOWN. Deletes 034's ledger row, which is all
-- 034 wrote. (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 034 is applied and no later
-- migration is (035's guard needs a 034, so 035 is reversed first).
-- AFTER RUNNING IT, the deployed code must no longer list 034, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_julius_project_brain_reserved') THEN
    RAISE EXCEPTION 'migration_034_down_refused: 034_julius_project_brain_reserved is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version > '034_julius_project_brain_reserved') THEN
    RAISE EXCEPTION 'migration_034_down_refused: a later migration is applied; reverse it first';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '034_julius_project_brain_reserved';
COMMIT;
