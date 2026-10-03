BEGIN;
-- ROW 13 (i), WHAT 030 AND THE PLAN PIN LEFT: a run's update was never a HOT update.
--
-- A run moves through its states by `UPDATE julius_runs SET state=$2,version=version+1,updated_at=$3` (julius-postgres.ts).
-- The index julius_run_project_state is (project_id, state, created_at): it holds `state`, so PostgreSQL cannot apply
-- that update as a heap-only tuple (HOT) update, and every transition inserts a new entry into EVERY index of the table,
-- the primary key's included. Under SERIALIZABLE an index insert is checked against the predicate locks other
-- transactions hold on the index page it lands on, and on a small table every run's primary-key entry shares one leaf
-- page. Two transitions of two different runs that each read their run before either wrote therefore met on that page,
-- and one was cancelled with 40001 even under the plan pin (julius-plan-pin.real-postgres.test.ts, PIN-5 at 5a59f79f;
-- the judged stress at 5a59f79f read 2 and 4 conflicts, _qa_handoff/julius_readiness/row13i/runs-m3).
--
-- 031 re-keys that index without `state`. No index then holds a column that any product UPDATE of julius_runs changes
-- (state, version, updated_at; lifecycle_reason, lifecycle_actor, lifecycle_at; project_brain_revision), so each of
-- them can be HOT and write no index entry. A diagnostic that MODELLED this change on a throwaway database
-- (row13i/runs-diag031, EVALUATION-DIAG.txt) measured all 240 run transitions HOT and 0 conflicts in both stress runs.
-- That was a model, not this file: this file's evidence is pre-registered on its own.
--
-- Index-only, so reversible without data loss (docs/julius-migrations/031/down.sql re-creates the old index). No row
-- changes, and no statement names the old index. A project's runs are still found by index in creation order
-- (project_id leads both); a filter on state reads that project's rows.
--
-- GATES, as 030's: STOP, changing nothing, unless the index being replaced is exactly the one 011 created and the new
-- name is free. After the change, still inside this transaction, the result is proven; any failure rolls it all back.
DO $$
BEGIN
  IF NOT EXISTS (
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
  ) THEN
    RAISE EXCEPTION 'migration_031_refused: julius_run_project_state is not the index 031 was written to replace (btree on julius_runs (project_id, state, created_at))';
  END IF;
  IF to_regclass('relay_wonderland.julius_run_project_created') IS NOT NULL THEN
    RAISE EXCEPTION 'migration_031_refused: relay_wonderland.julius_run_project_created already exists';
  END IF;
  RAISE NOTICE 'migration_031_precheck: julius_run_project_state verified; julius_run_project_created free; runs %',
    (SELECT count(*) FROM relay_wonderland.julius_runs);
END
$$;

DROP INDEX relay_wonderland.julius_run_project_state;
CREATE INDEX julius_run_project_created ON relay_wonderland.julius_runs(project_id, created_at);

-- POST-CHECK, still inside the transaction: the old index is gone, the new one is exactly what 031 creates, and NO index
-- on julius_runs holds a column that a product UPDATE of it changes, whether as a key column, in an expression or in a
-- partial index's predicate (PostgreSQL records a dependency for each).
DO $$
DECLARE
  holders text;
BEGIN
  IF to_regclass('relay_wonderland.julius_run_project_state') IS NOT NULL THEN
    RAISE EXCEPTION 'migration_031_postcheck: julius_run_project_state still exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_am am ON am.oid = c.relam
     WHERE c.relname = 'julius_run_project_created' AND c.relnamespace = 'relay_wonderland'::regnamespace
       AND i.indrelid = 'relay_wonderland.julius_runs'::regclass
       AND am.amname = 'btree' AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
       AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnatts = 2 AND i.indnkeyatts = 2
       AND i.indkey::int2[] = ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'project_id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.julius_runs'::regclass AND attname = 'created_at')
           ]::int2[]
       AND i.indoption::int2[] = ARRAY[0, 0]::int2[]
  ) THEN
    RAISE EXCEPTION 'migration_031_postcheck: julius_run_project_created is not a btree on julius_runs (project_id, created_at)';
  END IF;
  SELECT string_agg(DISTINCT held.index_column, ', ' ORDER BY held.index_column) INTO holders
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
  IF holders IS NOT NULL THEN
    RAISE EXCEPTION 'migration_031_postcheck: an index on julius_runs holds a column a run update changes (%), so that update cannot be HOT', holders;
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('031_julius_run_transition_hot');
COMMIT;
