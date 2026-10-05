BEGIN;
-- 034: RESERVED FOR THE PROJECT BRAIN. PREPARED, NOT CHOSEN: option 4 of docs/JULIUS_MIGRATION_034_OPTIONS.md (#337).
--
-- The founder's order is 031 Julius, 032 the 030 repair, 033 social, 034 Project Brain, 035 voice, and 034's content
-- has not been specified. This keeps the number and the order for the Project Brain and changes no schema: it writes
-- its own ledger row and nothing else, so 035 can follow it. The Project Brain's next content (its v2) lands at a later
-- number, with its own qualification.
--
-- GATES: STOP, changing nothing, unless 033 is applied and no 034 of any kind is.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_034_requires_033: 034 comes after 033, and the ledger never shows a gap';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version LIKE '034\_%') THEN
    RAISE EXCEPTION 'migration_034_already_numbered: a 034 is already in the ledger; nothing was changed';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_julius_project_brain_reserved');
COMMIT;
