BEGIN;
-- THE CLAIM STORE, AT ITS MINIMUM: A MEMORY'S STANDING, DURABLE, WITH ITS HISTORY.
--
-- `JuliusMemoryClaim` had no table. A brain entry's trust was derived at every
-- compile from its kind and whether it cited evidence, so nothing durable could
-- record that a reviewer later VERIFIED what a coder asserted, and a memory
-- promoted in one tick was unpromoted again the next. This table records each
-- standing a claim has held, in order; the current standing is the highest
-- revision, and the earlier rows are the history a reader needs to ask "who
-- promoted this, on what, and when".
--
-- APPEND-ONLY BY DESIGN. A standing is never updated in place: a promotion is
-- a new row citing the evidence it was granted on, and a replayed promotion
-- that would repeat the latest row writes nothing (the repository compares
-- content before inserting). `supersedes` and `contradicts` are recorded only
-- when a writer ASSERTS them; nothing here infers lineage from text.
CREATE TABLE relay_wonderland.julius_claim_standings (
  claim_id          text NOT NULL,
  standing_revision integer NOT NULL,
  project_id        text NOT NULL REFERENCES relay_wonderland.projects(project_id),
  run_id            text NOT NULL REFERENCES relay_wonderland.julius_runs(run_id),
  entry_id          text NOT NULL,
  provenance        text NOT NULL,
  trust             text NOT NULL,
  asserted_by       text NOT NULL,
  asserted_at       timestamptz NOT NULL,
  evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes        text,
  contradicts       jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason            text NOT NULL,
  recorded_at       timestamptz NOT NULL,
  PRIMARY KEY (claim_id, standing_revision),
  CONSTRAINT julius_claim_standings_trust_check CHECK (trust IN ('UNVERIFIED','SUPPORTED','VERIFIED','APPROVED','CONTRADICTED','SUPERSEDED'))
);
CREATE INDEX julius_claim_standings_run_idx ON relay_wonderland.julius_claim_standings(run_id, project_id);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('026_julius_claim_standings');
COMMIT;
