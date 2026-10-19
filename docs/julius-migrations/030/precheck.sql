-- MIGRATION 030: PRE-DEPLOY CHECK. READ-ONLY; run BEFORE 030 and save the output with the deploy record.
-- (RUNBOOK.md, step 2; founder gates B and D, 2026-10-02.)
-- STOP THE DEPLOY unless:
--   fk_matches = t, orphan_outbox_rows = 0, migration_029_applied = t and migration_030_applied = f.
-- Migration 030 refuses by itself in the same cases (it rolls back and drops nothing), but the record is taken here first.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
-- Every constraint on the two tables, by definition; the post-check must list the same lines minus outbox_event_id_fkey.
SELECT c.conrelid::regclass::text AS on_table, c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
 WHERE c.conrelid IN ('relay_wonderland.outbox'::regclass, 'relay_wonderland.events'::regclass)
 ORDER BY 1, 2;
SELECT EXISTS (
  SELECT 1 FROM pg_constraint c
   WHERE c.conname = 'outbox_event_id_fkey' AND c.contype = 'f'
     AND c.conrelid = 'relay_wonderland.outbox'::regclass AND c.confrelid = 'relay_wonderland.events'::regclass
     AND c.confdeltype = 'c' AND c.confupdtype = 'a' AND c.confmatchtype = 's'
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.outbox'::regclass AND attname = 'event_id')]::int2[]
     AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.events'::regclass AND attname = 'event_id')]::int2[]
) AS fk_matches;
SELECT (SELECT count(*) FROM relay_wonderland.events) AS events_rows,
       (SELECT count(*) FROM relay_wonderland.outbox) AS outbox_rows,
       (SELECT count(*) FROM relay_wonderland.outbox o
         WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) AS orphan_outbox_rows;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '029_julius_project_brain') AS migration_029_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') AS migration_030_applied;
SELECT c.relname AS on_table, t.tgname AS trigger_name
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgrelid IN ('relay_wonderland.outbox'::regclass, 'relay_wonderland.events'::regclass)
 ORDER BY 1, 2;
COMMIT;
