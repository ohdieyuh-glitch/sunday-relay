BEGIN;
-- AN OCCURRENCE TIME MAY BE UNKNOWN.
--
-- A record's `occurred_at` is when what it describes happened. Some history
-- never recorded that — a finding in the paid-run archive has no time at all —
-- and stamping it with the run's end or the import moment would be a fact
-- nobody observed. Such a record carries NULL, meaning Unknown. `recorded_at`,
-- when the Brain recorded it, stays NOT NULL.
ALTER TABLE julius_brain.records ALTER COLUMN occurred_at DROP NOT NULL;
INSERT INTO julius_brain.schema_migrations(version) VALUES('005_julius_brain_unknown_occurrence');
COMMIT;
