BEGIN;
-- ROW 13 (i), 030 REPAIRED: the written-event registry no longer lets an outbox row name a missing event, by either of
-- the two paths 030 left open.
--
-- THE REGISTRY (030). 030 replaced the outbox's foreign key with a REGISTRY: every events INSERT appends the ids it wrote
-- to the transaction-local setting relay_wonderland.events_written (chr(31) on both sides of each id), and an outbox row
-- is refused unless its event id is registered. Two paths still let an outbox row commit naming a missing event, which the
-- foreign key refused:
--   1. A DELETE (Codex finding (1) on #313, confirmed by Second Julius on 2026-10-04,
--      _qa_handoff/julius_readiness/landing/SECOND_JUDGEMENT_CODEX_030_P1_20261004.md). Nothing ever took an id out of the
--      registry: deleting an event deleted the outbox rows that existed at that moment and left its id registered, so in
--      ONE transaction  INSERT event E -> DELETE event E -> INSERT outbox(E)  committed an orphan.
--   2. AN EVENT ID HOLDING chr(31) (found while drafting this repair; the independent reviewer ruled it folded in here).
--      The INSERT trigger registered every written id whole, so an event id that itself holds chr(31) registered each of
--      its parts: in ONE transaction  INSERT event 'r' || chr(31) || 's' -> INSERT outbox('r')  committed an orphan naming
--      the missing event 'r'.
-- 030's claim 2 ("stronger than the foreign key it replaces") is false for both, and an orphan committed either way would
-- also make 030's down (re-adding the key) fail. The exposure was nil (no production path does either, no writer is known
-- to write an id holding chr(31), and the writers are stopped), but the guarantee is the database's, so it is repaired in
-- the database. 030 itself is applied and stays byte for byte as it is; this header is the correction.
--
-- THE TWO FIXES, AGAIN WITHOUT READING ANY RELATION, so that 030's purpose stands (no plan the planner may pick can turn the
-- guarantee back into a predicate read):
--   1. outbox_follows_event_delete, the AFTER DELETE row trigger function that already carries the cascade, also rewrites
--      the registry with chr(31) || OLD.event_id || chr(31) replaced by a single chr(31). It reads the setting and the
--      deleted row, nothing else.
--   2. events_written_remember, the AFTER INSERT statement trigger function, registers only well-formed ids: an id that is
--      empty or holds chr(31) is left out. It still reads only the statement's transition table. No outbox row can name
--      such an id anyway (030 refuses it as an outbox event id), so leaving it out loses nothing; and a statement that
--      wrote only such ids registers nothing at all (string_agg over no row is NULL, and 030's IF written IS NOT NULL
--      skips the write).
-- So, in one transaction:
--   - INSERT E -> DELETE E -> INSERT outbox(E) is refused (23503 outbox_event_not_written), as the foreign key refused it;
--   - INSERT 'r' || chr(31) || 's' -> INSERT outbox('r') is refused the same way;
--   - INSERT E -> DELETE E -> INSERT E -> INSERT outbox(E) is accepted: the second INSERT registers E again;
--   - a DELETE rolled back to a savepoint takes its forget with it: set_config(..., true) is SET LOCAL, which ROLLBACK TO
--     SAVEPOINT reverts, so the row and its registration come back together;
--   - the ids one statement wrote are separated by a single chr(31), and the replacement leaves one, so a deleted id's
--     neighbours stay delimited and registered.
-- One replace is enough: while an event exists its id is registered at most once (event_id is the primary key, so E is
-- registered again only after a DELETE, and that DELETE removed the earlier entry). The DELETE never forgets an id that is
-- empty or holds chr(31): fix 2 never registers one, and a pattern holding chr(31) could erase two well-formed ids that one
-- statement wrote side by side.
--
-- ONLY THE TWO FUNCTIONS' BODIES CHANGE. CREATE OR REPLACE keeps each function's oid, so the triggers 030 created (AFTER
-- DELETE ON relay_wonderland.events FOR EACH ROW, and AFTER INSERT ON relay_wonderland.events FOR EACH STATEMENT) run the
-- new bodies without being dropped or re-created: no lock on events, no moment without the cascade or the registry, and
-- the same trigger listing before and after. No table, index, constraint, trigger or row changes.
-- docs/julius-migrations/032/down.sql restores both of 030's bodies byte for byte.
--
-- What the registry is, and is not (030's caveat stands): it guards against ACCIDENTAL orphans, not hostile SQL; a
-- session that can run `SET relay_wonderland.events_written = ...` can pre-seed it, exactly as anyone with DDL rights
-- could drop these triggers.
--
-- 032 BY THE FOUNDER'S RULING (2026-10-04): applied right after 031, in the same reviewed window, never before it and
-- never folded into it. GATES, as 030's and 031's: STOP, changing nothing, unless 030 and 031 are applied and 032 is
-- not, the delete trigger and the two registry triggers are exactly 030's, both functions are exactly 030's (each body
-- compared with every run of whitespace made one space, so a checkout's line endings are no refusal and any other change
-- is), and NO outbox row already names a missing event. After the change, still inside this transaction, the result is
-- proven; any failure rolls it all back. The counts are reported as a NOTICE for the deploy record
-- (docs/julius-migrations/032/RUNBOOK.md).
DO $$
DECLARE
  orphans bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') THEN
    RAISE EXCEPTION 'migration_032_refused: 030 is not applied here';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot') THEN
    RAISE EXCEPTION 'migration_032_refused: 031 is not applied here; 032 comes after it on the chain (founder ruling 2026-10-04)';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') THEN
    RAISE EXCEPTION 'migration_032_refused: 032 is already applied here';
  END IF;
  -- The trigger 032 leaves in place: exactly AFTER DELETE ON events FOR EACH ROW (tgtype 9 = ROW | DELETE), enabled,
  -- calling this function, with no arguments, condition, transition table or constraint.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'relay_wonderland.events'::regclass AND t.tgname = 'outbox_follows_event_delete' AND NOT t.tgisinternal
       AND t.tgfoid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
       AND t.tgtype = 9 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgconstraint = 0
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
  ) THEN
    RAISE EXCEPTION 'migration_032_refused: the trigger outbox_follows_event_delete is not the one 030 created (AFTER DELETE ON events FOR EACH ROW, enabled, calling its function)';
  END IF;
  -- The registry the forget edits means something only beside the triggers that fill it and read it, both as 030 made
  -- them and enabled: tgtype 4 = AFTER INSERT FOR EACH STATEMENT, with its transition table; 7 = BEFORE INSERT FOR EACH ROW.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'relay_wonderland.events'::regclass AND t.tgname = 'events_written_remember' AND NOT t.tgisinternal
       AND t.tgfoid = to_regprocedure('relay_wonderland.events_written_remember()')
       AND t.tgtype = 4 AND t.tgenabled = 'O' AND t.tgnewtable = 'written_events'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'relay_wonderland.outbox'::regclass AND t.tgname = 'outbox_requires_event_written' AND NOT t.tgisinternal
       AND t.tgfoid = to_regprocedure('relay_wonderland.outbox_requires_event_written()')
       AND t.tgtype = 7 AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'migration_032_refused: the registry triggers are not the ones 030 created (events_written_remember, outbox_requires_event_written)';
  END IF;
  -- The first function 032 replaces: plpgsql, returning trigger, no settings, not SECURITY DEFINER, and 030's body,
  -- compared with every run of whitespace made one space.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
       AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')
       AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig IS NULL
       AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) = btrim(regexp_replace($body$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  RETURN NULL;
END;
$body$, '[[:space:]]+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'migration_032_refused: relay_wonderland.outbox_follows_event_delete() is not the function 030 created (its body, language, return type or settings differ)';
  END IF;
  -- The second, the registry's writer: the same attributes, and 030's body compared the same way.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = to_regprocedure('relay_wonderland.events_written_remember()')
       AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')
       AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig IS NULL
       AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) = btrim(regexp_replace($body$
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
$body$, '[[:space:]]+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'migration_032_refused: relay_wonderland.events_written_remember() is not the function 030 created (its body, language, return type or settings differ)';
  END IF;
  SELECT count(*) INTO orphans FROM relay_wonderland.outbox o
   WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id);
  IF orphans > 0 THEN
    RAISE EXCEPTION 'migration_032_refused: % outbox row(s) already name a missing event; integrity is violated before the migration', orphans;
  END IF;
  RAISE NOTICE 'migration_032_precheck: 030 and 031 applied, 032 not; triggers and functions as 030 made them; orphan outbox rows 0; events %; outbox %',
    (SELECT count(*) FROM relay_wonderland.events), (SELECT count(*) FROM relay_wonderland.outbox);
END
$$;

CREATE OR REPLACE FUNCTION relay_wonderland.outbox_follows_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  IF OLD.event_id <> '' AND position(chr(31) IN OLD.event_id) = 0 THEN
    PERFORM set_config('relay_wonderland.events_written',
      replace(coalesce(current_setting('relay_wonderland.events_written', true), ''), chr(31) || OLD.event_id || chr(31), chr(31)),
      true);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION relay_wonderland.events_written_remember() RETURNS trigger LANGUAGE plpgsql AS $$
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
$$;

-- POST-CHECK, still inside the transaction: the delete trigger is still the one 030 created (it now runs the new body),
-- each function carries exactly the body written above, and still no outbox row names a missing event.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'relay_wonderland.events'::regclass AND t.tgname = 'outbox_follows_event_delete' AND NOT t.tgisinternal
       AND t.tgfoid = to_regprocedure('relay_wonderland.outbox_follows_event_delete()')
       AND t.tgtype = 9 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgconstraint = 0
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
  ) THEN
    RAISE EXCEPTION 'migration_032_postcheck: the trigger outbox_follows_event_delete is no longer the one 030 created';
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
    RAISE EXCEPTION 'migration_032_postcheck: relay_wonderland.outbox_follows_event_delete() does not carry exactly the forget 032 writes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = to_regprocedure('relay_wonderland.events_written_remember()')
       AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')
       AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig IS NULL
       AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) = btrim(regexp_replace($body$
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
$body$, '[[:space:]]+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'migration_032_postcheck: relay_wonderland.events_written_remember() does not carry exactly the filter 032 writes';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) THEN
    RAISE EXCEPTION 'migration_032_postcheck: an outbox row names a missing event';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('032_julius_outbox_event_delete_forgets');
COMMIT;
