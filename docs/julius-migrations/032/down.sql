-- MIGRATION 032: DOWN. Restores the function 030 created, byte for byte, and removes the 032 stamp.
-- (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 032 is applied, nothing
-- after 032 is applied (roll a later migration back first, newest first, so the ledger never shows a gap), the function
-- is exactly the one 032 created and the trigger is still the one 030 created.
-- AFTER RUNNING IT the store has 030's defect again (an outbox row can name an event deleted earlier in its own
-- transaction), and the deployed code must no longer list 032, or the next migrate() re-applies it.
-- The body restored below must stay byte-identical to 030's (030_julius_outbox_event_no_reread.sql): the real-PostgreSQL
-- suite compares pg_get_functiondef before 032 with the one after this script.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') THEN
    RAISE EXCEPTION 'migration_032_down_refused: 032 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '032') THEN
    RAISE EXCEPTION 'migration_032_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '032');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
       AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')
       AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig IS NULL
       AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) = btrim(regexp_replace($body$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  IF OLD.event_id <> '' AND position(chr(31) IN OLD.event_id) = 0 THEN
    PERFORM set_config('relay_wonderland.events_written',
      replace(coalesce(current_setting('relay_wonderland.events_written', true), ''), chr(31) || OLD.event_id || chr(31), chr(31)),
      true);
  END IF;
  RETURN NULL;
END;
$body$, '[[:space:]]+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'migration_032_down_refused: relay_wonderland.outbox_follows_event_delete() is not the function 032 created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'relay_wonderland.events'::regclass AND t.tgname = 'outbox_follows_event_delete' AND NOT t.tgisinternal
       AND t.tgfoid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
       AND t.tgtype = 9 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgconstraint = 0
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
  ) THEN
    RAISE EXCEPTION 'migration_032_down_refused: the trigger outbox_follows_event_delete is not the one 030 created';
  END IF;
END
$$;
CREATE OR REPLACE FUNCTION relay_wonderland.outbox_follows_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  RETURN NULL;
END;
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets';
COMMIT;
