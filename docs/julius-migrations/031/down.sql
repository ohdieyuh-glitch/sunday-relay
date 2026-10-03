-- MIGRATION 031: DOWN. Restores the index 031 replaced, exactly, and removes the one it created.
-- (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 031 is applied, its index
-- exists and the old name is free.
-- AFTER RUNNING IT, the deployed code must no longer list 031, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot') THEN
    RAISE EXCEPTION 'migration_031_down_refused: 031 is not applied here';
  END IF;
  IF to_regclass('relay_wonderland.julius_run_project_created') IS NULL THEN
    RAISE EXCEPTION 'migration_031_down_refused: julius_run_project_created is missing';
  END IF;
  IF to_regclass('relay_wonderland.julius_run_project_state') IS NOT NULL THEN
    RAISE EXCEPTION 'migration_031_down_refused: julius_run_project_state already exists';
  END IF;
END
$$;
DROP INDEX relay_wonderland.julius_run_project_created;
CREATE INDEX julius_run_project_state ON relay_wonderland.julius_runs(project_id,state,created_at);
DELETE FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot';
COMMIT;
