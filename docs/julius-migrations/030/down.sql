-- MIGRATION 030: DOWN. Restores the foreign key 030 replaced, exactly, and removes everything 030 added.
-- (RUNBOOK.md, rollback (b); founder gate B, 2026-10-02.)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, if any outbox row already names a
-- missing event, because the constraint could not be valid then.
-- AFTER RUNNING IT, the deployed code must no longer list 030, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') THEN
    RAISE EXCEPTION 'migration_030_down_refused: 030 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) THEN
    RAISE EXCEPTION 'migration_030_down_refused: an outbox row names a missing event, so the foreign key cannot be restored as valid';
  END IF;
END
$$;
DROP TRIGGER events_written_remember ON relay_wonderland.events;
DROP TRIGGER outbox_requires_event_written ON relay_wonderland.outbox;
DROP TRIGGER events_event_id_immutable ON relay_wonderland.events;
DROP TRIGGER outbox_event_id_immutable ON relay_wonderland.outbox;
DROP TRIGGER outbox_follows_event_delete ON relay_wonderland.events;
DROP TRIGGER events_truncate_refused ON relay_wonderland.events;
DROP FUNCTION relay_wonderland.events_written_remember();
DROP FUNCTION relay_wonderland.outbox_requires_event_written();
DROP FUNCTION relay_wonderland.event_id_immutable();
DROP FUNCTION relay_wonderland.outbox_follows_event_delete();
DROP FUNCTION relay_wonderland.events_truncate_refused();
ALTER TABLE relay_wonderland.outbox
  ADD CONSTRAINT outbox_event_id_fkey FOREIGN KEY (event_id) REFERENCES relay_wonderland.events(event_id) ON DELETE CASCADE;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread';
COMMIT;
