BEGIN;
-- WHAT THE CONTEXT INTEGRITY LAYER DECIDED, MADE DURABLE.
--
-- A context snapshot could say which entries reached a worker and nothing about
-- what was kept OUT or what disagreed, so a run where a stale memory was
-- excluded and a run where it was never offered left identical rows.
--
-- EVERY COLUMN IS NULLABLE WITH NO DEFAULT, deliberately. NULL means "no
-- integrity decision was made for this packet" — a caller that supplied no
-- claims — and it must stay distinguishable from "ranked, and nothing was
-- excluded", which is an empty array. A DEFAULT '[]' here would turn every
-- pre-integrity row into a claim that its context was checked.
ALTER TABLE relay_wonderland.julius_context_snapshots
 ADD COLUMN integrity_version text,
 ADD COLUMN integrity_conflicts jsonb,
 ADD COLUMN integrity_excluded_entry_ids jsonb,
 ADD COLUMN integrity_evicted_entry_ids jsonb;
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('025_julius_context_integrity');
COMMIT;
