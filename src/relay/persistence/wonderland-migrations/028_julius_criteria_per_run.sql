BEGIN;
-- A CRITERION ID BELONGS TO A RUN, AND UNTIL NOW IT BELONGED TO THE DATABASE.
--
-- Migration 013 made `julius_acceptance_criteria.criterion_id` the PRIMARY KEY ON
-- ITS OWN. A criterion id is chosen by the mission contract, so `criterion-test`
-- or `created-in-world` is exactly the kind of name two missions pick
-- independently — and the seed insert uses `ON CONFLICT DO NOTHING`. The result
-- was that the SECOND run to use any id got NO criteria row, silently, and the
-- run went on to report "0 of 0 criteria met" with nothing anywhere saying why.
--
-- Found by the Wonderland integration lane's fifth in-engine acceptance, against a
-- real database. Its evidence, verbatim: the mission's first run held its 2 rows;
-- an EXPLICIT RERUN of the same contract held 0; the first player run to use
-- `created-in-world` held 1 and two later runs held 0 each.
--
-- THREE REASONS THIS IS WORSE THAN A MISSING ROW.
--
--   1. EVERY EXPLICIT RERUN loses all its criteria, by definition: a rerun runs the
--      same contract, so it reuses every id.
--   2. IT CROSSES PROJECTS AND TENANTS. One project's mission could take another's
--      criteria away, which makes a global key an isolation defect and not only a
--      uniqueness one.
--   3. A run with no criteria is exactly the "unknown reported as a number" shape
--      this repository exists to refuse. "0 of 0 met" reads like an answer.
--
-- WHY ONLY A REAL DATABASE COULD FIND IT. The in-memory store keys criteria BY RUN
-- (`criteria.set(runId, values)`) and is correct. So every in-memory proof passed
-- and the two stores disagreed, which is the drift the conformance cases added
-- beside this migration exist to stop.
--
-- THE BACKFILL BELOW IS ONLY CORRECT BECAUSE THE OLD KEY WAS GLOBAL. With
-- `criterion_id` unique across the whole table, joining `julius_criterion_evidence`
-- back to its criterion to learn the run is unambiguous. After this migration that
-- join would need both columns, which is the point of the change.

-- 1. The dependent foreign keys must go before the primary key they reference.
ALTER TABLE relay_wonderland.julius_criterion_evidence
  DROP CONSTRAINT IF EXISTS julius_criterion_evidence_criterion_id_fkey;
ALTER TABLE relay_wonderland.julius_reviewer_findings
  DROP CONSTRAINT IF EXISTS julius_reviewer_findings_criterion_id_fkey;

-- 2. `julius_criterion_evidence` has no writer anywhere in the codebase, so it is
--    expected to be empty — but a migration must be correct against a database
--    that has rows, so the column is added, backfilled, and only then made NOT
--    NULL. A row whose criterion no longer exists cannot be scoped and is deleted
--    rather than carried forward with an invented run.
ALTER TABLE relay_wonderland.julius_criterion_evidence ADD COLUMN IF NOT EXISTS run_id text;
UPDATE relay_wonderland.julius_criterion_evidence ce
   SET run_id = c.run_id
  FROM relay_wonderland.julius_acceptance_criteria c
 WHERE ce.criterion_id = c.criterion_id AND ce.run_id IS NULL;
DELETE FROM relay_wonderland.julius_criterion_evidence WHERE run_id IS NULL;
ALTER TABLE relay_wonderland.julius_criterion_evidence ALTER COLUMN run_id SET NOT NULL;

-- 3. The key itself: a criterion is identified by its run and its id, together.
ALTER TABLE relay_wonderland.julius_acceptance_criteria
  DROP CONSTRAINT IF EXISTS julius_acceptance_criteria_pkey;
ALTER TABLE relay_wonderland.julius_acceptance_criteria
  ADD CONSTRAINT julius_acceptance_criteria_pkey PRIMARY KEY (run_id, criterion_id);

-- 4. Both references follow it. `julius_reviewer_findings.criterion_id` stays
--    NULLABLE and MATCH SIMPLE is what we want: a finding that names no criterion
--    satisfies the constraint rather than needing a sentinel.
ALTER TABLE relay_wonderland.julius_criterion_evidence
  DROP CONSTRAINT IF EXISTS julius_criterion_evidence_pkey;
ALTER TABLE relay_wonderland.julius_criterion_evidence
  ADD CONSTRAINT julius_criterion_evidence_pkey PRIMARY KEY (run_id, criterion_id, evidence_id);
ALTER TABLE relay_wonderland.julius_criterion_evidence
  ADD CONSTRAINT julius_criterion_evidence_criterion_fkey
  FOREIGN KEY (run_id, criterion_id)
  REFERENCES relay_wonderland.julius_acceptance_criteria (run_id, criterion_id) ON DELETE CASCADE;
ALTER TABLE relay_wonderland.julius_reviewer_findings
  ADD CONSTRAINT julius_reviewer_findings_criterion_fkey
  FOREIGN KEY (run_id, criterion_id)
  REFERENCES relay_wonderland.julius_acceptance_criteria (run_id, criterion_id);

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('028_julius_criteria_per_run');
COMMIT;
