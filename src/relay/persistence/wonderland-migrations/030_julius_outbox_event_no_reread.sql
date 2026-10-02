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
--      delete and never reads on an insert.
-- What the registry is, and is not: it guards against ACCIDENTAL orphans (a writer that forgot its event, a backfill,
-- a typo), not against hostile SQL. A session that can run `SET relay_wonderland.events_written = ...` can pre-seed
-- it, exactly as anyone with DDL rights could drop the foreign key or these triggers. Ids are delimited by chr(31) on
-- both sides, and an outbox row whose event id is empty or contains chr(31) is refused, so no id can match across two
-- registered ones.
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

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('030_julius_outbox_event_no_reread');
COMMIT;
