-- MIGRATION 031: PRE-DEPLOY CHECK. READ-ONLY; run BEFORE 031 and save the output with the deploy record.
-- (RUNBOOK.md, step 2.)
-- STOP THE DEPLOY unless:
--   old_index_matches = t, new_name_free = t, migration_030_applied = t and migration_031_applied = f.
-- Migration 031 refuses by itself in the same cases (it rolls back and changes nothing), but the record is taken here first.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
-- Every index on julius_runs, by definition; the post-check must list the same lines with exactly
-- julius_run_project_state replaced by julius_run_project_created.
SELECT c.relname AS index_name, pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE i.indrelid = 'relay_wonderland.julius_runs'::regclass
 ORDER BY 1;
SELECT EXISTS (
  SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
   WHERE c.relname = 'julius_run_project_state' AND c.relnamespace = 'relay_wonderland'::regnamespace
     AND i.indrelid = 'relay_wonderland.julius_runs'::regclass
     AND am.amname = 'btree' AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
     AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
     AND i.indnatts = 3 AND i.indnkeyatts = 3
     AND i.indkey::int2[] = ARRAY[
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'project_id'),
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'state'),
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'created_at')
         ]::int2[]
     AND i.indoption::int2[] = ARRAY[0, 0, 0]::int2[]
) AS old_index_matches,
       to_regclass('relay_wonderland.julius_run_project_created') IS NULL AS new_name_free;
SELECT (SELECT count(*) FROM relay_wonderland.julius_runs) AS runs_rows;
-- The update counters as they stand; after the writers restart (step 6) the HOT counter must grow with the total.
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relid = 'relay_wonderland.julius_runs'::regclass;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') AS migration_030_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot') AS migration_031_applied;
COMMIT;
