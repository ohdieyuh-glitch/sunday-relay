-- MIGRATION 032: PRE-DEPLOY CHECK. READ-ONLY; run AFTER 031's post-check has passed and BEFORE 032, and save the output
-- with the deploy record. (RUNBOOK.md, step 2.)
-- STOP THE DEPLOY unless ALL of:
--   delete_trigger_matches = t, registry_triggers_match = t, function_is_030 = t and function_has_forget = f;
--   remember_is_030 = t and remember_has_filter = f;
--   orphan_outbox_rows = 0;
--   migration_030_applied = t, migration_031_applied = t and migration_032_applied = f;
--   ledger_last = 031_julius_run_transition_hot (032 follows 031 directly: nothing later is applied).
-- Migration 032 refuses by itself in the same cases but the last (it rolls back and changes nothing), but the record is
-- taken here first.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
-- Every trigger on the two tables, by definition and state; the post-check must list the same lines (032 replaces two
-- function bodies and creates, drops or re-creates no trigger).
SELECT c.relname AS on_table, t.tgname AS trigger_name, t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgrelid IN ('relay_wonderland.outbox'::regclass, 'relay_wonderland.events'::regclass)
 ORDER BY 1, 2;
-- The two functions as they stand, for the record: the post-check's definitions must be these, the delete function's with
-- exactly the forget added, the remember function's with exactly its SELECT line filtered.
SELECT pg_get_functiondef(p.oid) AS function_definition, md5(p.prosrc) AS function_body_md5,
       pg_get_userbyid(p.proowner) AS function_owner
  FROM pg_proc p WHERE p.oid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()');
SELECT pg_get_functiondef(p.oid) AS remember_definition, md5(p.prosrc) AS remember_body_md5,
       pg_get_userbyid(p.proowner) AS remember_owner
  FROM pg_proc p WHERE p.oid = to_regprocedure('relay_wonderland.events_written_remember()');
-- The trigger 032 keeps (AFTER DELETE FOR EACH ROW: tgtype 9), the two registry triggers (AFTER INSERT FOR EACH
-- STATEMENT with its transition table: 4; BEFORE INSERT FOR EACH ROW: 7), and each function's body against 030's and
-- 032's, each compared with every run of whitespace made one space (line endings do not count, anything else does).
WITH fn AS (
  SELECT btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) AS body
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
     AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')
     AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig IS NULL
), rem AS (
  SELECT btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) AS body
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('relay_wonderland.events_written_remember()')
     AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')
     AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig IS NULL
), expected AS (
  SELECT btrim(regexp_replace($body030$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  RETURN NULL;
END;
$body030$, '[[:space:]]+', ' ', 'g')) AS body_030,
         btrim(regexp_replace($body032$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  IF OLD.event_id <> '' AND position(chr(31) IN OLD.event_id) = 0 THEN
    PERFORM set_config('relay_wonderland.events_written',
      replace(coalesce(current_setting('relay_wonderland.events_written', true), ''), chr(31) || OLD.event_id || chr(31), chr(31)),
      true);
  END IF;
  RETURN NULL;
END;
$body032$, '[[:space:]]+', ' ', 'g')) AS body_032,
         btrim(regexp_replace($remember030$
DECLARE
  written text;
BEGIN
  SELECT string_agg(event_id, chr(31)) INTO written FROM written_events;
  IF written IS NOT NULL THEN
    PERFORM set_config('relay_wonderland.events_written',
      coalesce(current_setting('relay_wonderland.events_written', true), '') || chr(31) || written || chr(31), true);
  END IF;
  RETURN NULL;
END;
$remember030$, '[[:space:]]+', ' ', 'g')) AS remember_030,
         btrim(regexp_replace($remember032$
DECLARE
  written text;
BEGIN
  SELECT string_agg(event_id, chr(31)) INTO written FROM written_events WHERE event_id <> '' AND position(chr(31) IN event_id) = 0;
  IF written IS NOT NULL THEN
    PERFORM set_config('relay_wonderland.events_written',
      coalesce(current_setting('relay_wonderland.events_written', true), '') || chr(31) || written || chr(31), true);
  END IF;
  RETURN NULL;
END;
$remember032$, '[[:space:]]+', ' ', 'g')) AS remember_032
)
SELECT EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'relay_wonderland.events'::regclass AND t.tgname = 'outbox_follows_event_delete' AND NOT t.tgisinternal
            AND t.tgfoid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
            AND t.tgtype = 9 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgconstraint = 0
            AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
       ) AS delete_trigger_matches,
       (EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'relay_wonderland.events'::regclass AND t.tgname = 'events_written_remember' AND NOT t.tgisinternal
            AND t.tgfoid = to_regprocedure('relay_wonderland.events_written_remember()')
            AND t.tgtype = 4 AND t.tgenabled = 'O' AND t.tgnewtable = 'written_events'
       ) AND EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'relay_wonderland.outbox'::regclass AND t.tgname = 'outbox_requires_event_written' AND NOT t.tgisinternal
            AND t.tgfoid = to_regprocedure('relay_wonderland.outbox_requires_event_written()')
            AND t.tgtype = 7 AND t.tgenabled = 'O'
       )) AS registry_triggers_match,
       EXISTS (SELECT 1 FROM fn, expected WHERE fn.body = expected.body_030) AS function_is_030,
       EXISTS (SELECT 1 FROM fn, expected WHERE fn.body = expected.body_032) AS function_has_forget,
       EXISTS (SELECT 1 FROM rem, expected WHERE rem.body = expected.remember_030) AS remember_is_030,
       EXISTS (SELECT 1 FROM rem, expected WHERE rem.body = expected.remember_032) AS remember_has_filter;
SELECT (SELECT count(*) FROM relay_wonderland.events) AS events_rows,
       (SELECT count(*) FROM relay_wonderland.outbox) AS outbox_rows,
       (SELECT count(*) FROM relay_wonderland.outbox o
         WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) AS orphan_outbox_rows;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') AS migration_030_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot') AS migration_031_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') AS migration_032_applied,
       (SELECT count(*) FROM relay_wonderland.schema_migrations) AS ledger_count,
       (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) AS ledger_last;
COMMIT;
