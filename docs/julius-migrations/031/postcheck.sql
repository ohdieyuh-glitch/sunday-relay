-- MIGRATION 031: POST-DEPLOY CHECK. READ-ONLY; run right AFTER 031 and compare with the pre-check's output.
-- (RUNBOOK.md, step 4.)
-- PASS only if ALL of:
--   old_index_present = f and new_index_matches = t;
--   the index listing equals the pre-check's, line for line, with exactly julius_run_project_state replaced by
--   julius_run_project_created (nothing else dropped or added);
--   update_columns_indexed is empty (no index holds a column a run update changes);
--   runs_rows EQUALS the pre-check's (the writers were stopped for the deploy);
--   migration_031_applied = t.
-- On ANY difference: STOP, and follow RUNBOOK.md's rollback.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database;
SELECT c.relname AS index_name, pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE i.indrelid = 'relay_wonderland.julius_runs'::regclass
 ORDER BY 1;
SELECT to_regclass('relay_wonderland.julius_run_project_state') IS NOT NULL AS old_index_present,
       EXISTS (
         SELECT 1 FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_am am ON am.oid = c.relam
          WHERE c.relname = 'julius_run_project_created' AND c.relnamespace = 'relay_wonderland'::regnamespace
            AND i.indrelid = 'relay_wonderland.julius_runs'::regclass
            AND am.amname = 'btree' AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
            AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
            AND i.indnatts = 2 AND i.indnkeyatts = 2
            -- int2vector is 0-based; cast to int2[] it keeps lower bound 0, and array = compares bounds: compare each element.
            AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'project_id')
            AND i.indkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'created_at')
            AND i.indoption[0] = 0 AND i.indoption[1] = 0
       ) AS new_index_matches;
SELECT string_agg(DISTINCT held.index_column, ', ' ORDER BY held.index_column) AS update_columns_indexed
  FROM (
    SELECT c.relname || '.' || a.attname AS index_column, a.attname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])
     WHERE i.indrelid = 'relay_wonderland.julius_runs'::regclass
    UNION
    SELECT c.relname || '.' || a.attname, a.attname
      FROM pg_depend d
      JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'i'
      JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
       AND d.refobjid = 'relay_wonderland.julius_runs'::regclass AND d.refobjsubid > 0
  ) held
 WHERE held.attname IN ('state', 'version', 'updated_at', 'lifecycle_reason', 'lifecycle_actor', 'lifecycle_at', 'project_brain_revision');
SELECT (SELECT count(*) FROM relay_wonderland.julius_runs) AS runs_rows;
SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relid = 'relay_wonderland.julius_runs'::regclass;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot') AS migration_031_applied;
COMMIT;
