-- MIGRATION 030: POST-DEPLOY CHECK. READ-ONLY; run right AFTER 030 and compare with the pre-check's output.
-- (RUNBOOK.md, step 4; founder gate E, 2026-10-02.)
-- PASS only if ALL of:
--   fk_present = f;
--   the constraint listing equals the pre-check's, line for line, minus outbox_event_id_fkey (gate F: nothing else
--   was dropped);
--   the trigger listing adds exactly the six 030 triggers to the pre-check's;
--   orphan_outbox_rows = 0;
--   events_rows and outbox_rows EQUAL the pre-check's (no lost writes; the writers were stopped for the deploy);
--   migration_030_applied = t.
-- On ANY difference: STOP, and follow RUNBOOK.md's rollback.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database;
SELECT c.conrelid::regclass::text AS on_table, c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
 WHERE c.conrelid IN ('relay_wonderland.outbox'::regclass, 'relay_wonderland.events'::regclass)
 ORDER BY 1, 2;
SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_event_id_fkey' AND conrelid = 'relay_wonderland.outbox'::regclass) AS fk_present;
SELECT c.relname AS on_table, t.tgname AS trigger_name
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgrelid IN ('relay_wonderland.outbox'::regclass, 'relay_wonderland.events'::regclass)
 ORDER BY 1, 2;
SELECT (SELECT count(*) FROM relay_wonderland.events) AS events_rows,
       (SELECT count(*) FROM relay_wonderland.outbox) AS outbox_rows,
       (SELECT count(*) FROM relay_wonderland.outbox o
         WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) AS orphan_outbox_rows;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') AS migration_030_applied;
COMMIT;
