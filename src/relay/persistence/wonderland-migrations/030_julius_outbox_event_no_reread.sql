BEGIN;
-- ROW 13 (i), THE SECOND CONTENTION SOURCE: the outbox's foreign key to events.
--
-- A foreign-key check is a SELECT on the referenced table, and under SERIALIZABLE it is a predicate read. On a small
-- events table (a fresh database: every CI job, a new install) the planner runs it as a sequential scan, which locks
-- the whole relation and reads every other run's event that this snapshot cannot see. Two appends of two runs that
-- share no row then formed a read/write cycle, and one was cancelled at its outbox INSERT ("Canceled on conflict out
-- to pivot, during read"). Measured on a throwaway database with the planner state pinned
-- (_qa_handoff/julius_readiness/row13i/iso-*.jsonl): with this constraint every append variant aborted in the
-- small-table state, and without it every one committed, in both plan states.
--
-- The constraint is replaced by what it guaranteed, enforced by the database, and WITHOUT READING ANY RELATION, so
-- that no plan the planner may pick can turn the guarantee back into a predicate read:
--   1. every events INSERT remembers, for the rest of its transaction only, the ids it wrote (a transaction-local
--      setting fed from the statement's transition table; a ROLLBACK TO SAVEPOINT forgets them with the rows);
--   2. an outbox row is refused unless its event was written earlier IN THE SAME TRANSACTION. That is stronger than
--      the foreign key it replaces: the five writers always write both in one transaction, and the database now
--      refuses anything else (a new writer, a backfill, manual SQL);
--   3. an event's id never changes, and an outbox row's event id never changes (the foreign key covered updates);
--   4. deleting an event still deletes its outbox row: the ON DELETE CASCADE it had, by a trigger that WRITES on a
--      delete and never reads on an insert;
--   5. a TRUNCATE of events is refused. The foreign key refused it while outbox rows referenced it, and row triggers
--      never see a TRUNCATE, so without this it would orphan every outbox row silently. The ledger is append-only and
--      nothing truncates it.
-- What the registry is, and is not: it guards against ACCIDENTAL orphans (a writer that forgot its event, a backfill,
-- a typo), not against hostile SQL. A session that can run `SET relay_wonderland.events_written = ...` can pre-seed
-- it, exactly as anyone with DDL rights could drop the foreign key or these triggers. Ids are delimited by chr(31) on
-- both sides, and an outbox row whose event id is empty or contains chr(31) is refused, so no id can match across two
-- registered ones.
-- FOUNDER GATES (2026-10-02): drop ONLY this constraint, and STOP if the database is not what 030 was written for.
-- Before anything changes, inside this transaction: the constraint must be exactly the foreign key being replaced
-- (outbox.event_id -> events.event_id, ON DELETE CASCADE), and NO outbox row may already name a missing event. Either
-- refusal raises, so the whole migration rolls back and nothing is dropped. The counts are reported as a NOTICE for the
-- deploy record (docs/julius-migrations/030/RUNBOOK.md).
DO $$
DECLARE
  orphans bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'outbox_event_id_fkey' AND c.contype = 'f'
       AND c.conrelid = 'relay_wonderland.outbox'::regclass AND c.confrelid = 'relay_wonderland.events'::regclass
       AND c.confdeltype = 'c' AND c.confupdtype = 'a' AND c.confmatchtype = 's'
       AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.outbox'::regclass AND attname = 'event_id')]::int2[]
       AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'relay_wonderland.events'::regclass AND attname = 'event_id')]::int2[]
  ) THEN
    RAISE EXCEPTION 'migration_030_refused: outbox_event_id_fkey is not the foreign key 030 was written to replace (outbox.event_id -> events.event_id ON DELETE CASCADE)';
  END IF;
  SELECT count(*) INTO orphans FROM relay_wonderland.outbox o
   WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id);
  IF orphans > 0 THEN
    RAISE EXCEPTION 'migration_030_refused: % outbox row(s) already name a missing event; integrity is violated before the migration', orphans;
  END IF;
  RAISE NOTICE 'migration_030_precheck: outbox_event_id_fkey verified; orphan outbox rows 0; events %; outbox %',
    (SELECT count(*) FROM relay_wonderland.events), (SELECT count(*) FROM relay_wonderland.outbox);
END
$$;

ALTER TABLE relay_wonderland.outbox DROP CONSTRAINT outbox_event_id_fkey;

CREATE FUNCTION relay_wonderland.events_written_remember() RETURNS trigger LANGUAGE plpgsql AS $$
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
$$;
CREATE TRIGGER events_written_remember AFTER INSERT ON relay_wonderland.events
  REFERENCING NEW TABLE AS written_events FOR EACH STATEMENT
  EXECUTE FUNCTION relay_wonderland.events_written_remember();

CREATE FUNCTION relay_wonderland.outbox_requires_event_written() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_id = '' OR position(chr(31) IN NEW.event_id) > 0 THEN
    RAISE EXCEPTION 'outbox_event_id_malformed: an outbox event id may not be empty or contain the registry delimiter'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF position(chr(31) || NEW.event_id || chr(31) IN coalesce(current_setting('relay_wonderland.events_written', true), '')) = 0 THEN
    RAISE EXCEPTION 'outbox_event_not_written: % was not written by an events INSERT earlier in this transaction', NEW.event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outbox_requires_event_written BEFORE INSERT ON relay_wonderland.outbox
  FOR EACH ROW EXECUTE FUNCTION relay_wonderland.outbox_requires_event_written();

CREATE FUNCTION relay_wonderland.event_id_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'event_id_immutable: % may not become %', OLD.event_id, NEW.event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER events_event_id_immutable BEFORE UPDATE OF event_id ON relay_wonderland.events
  FOR EACH ROW EXECUTE FUNCTION relay_wonderland.event_id_immutable();
CREATE TRIGGER outbox_event_id_immutable BEFORE UPDATE OF event_id ON relay_wonderland.outbox
  FOR EACH ROW EXECUTE FUNCTION relay_wonderland.event_id_immutable();

CREATE FUNCTION relay_wonderland.outbox_follows_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER outbox_follows_event_delete AFTER DELETE ON relay_wonderland.events
  FOR EACH ROW EXECUTE FUNCTION relay_wonderland.outbox_follows_event_delete();

CREATE FUNCTION relay_wonderland.events_truncate_refused() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events_truncate_refused: the event ledger is append-only, and a TRUNCATE would orphan its outbox rows'
    USING ERRCODE = 'feature_not_supported';
END;
$$;
CREATE TRIGGER events_truncate_refused BEFORE TRUNCATE ON relay_wonderland.events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.events_truncate_refused();

-- POST-CHECK, still inside the transaction: the constraint is gone, nothing else was dropped with it (the other foreign
-- keys of outbox and events are counted before and after by the deploy scripts), and still no orphan exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_event_id_fkey' AND conrelid = 'relay_wonderland.outbox'::regclass) THEN
    RAISE EXCEPTION 'migration_030_postcheck: outbox_event_id_fkey still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) THEN
    RAISE EXCEPTION 'migration_030_postcheck: an outbox row names a missing event';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('030_julius_outbox_event_no_reread');
COMMIT;
