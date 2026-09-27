BEGIN;
-- THE BODIES A MISSION PRODUCED, kept rather than described.
--
-- Migration 019 already defines `julius_artifacts` for TOOL output: its scope
-- is an executor invocation, and its foreign key requires one. A plan, a diff,
-- a test output or a reviewer's packet is produced by a WORKER attempt, not by
-- a tool invocation, so it has no row to hang from there and never did — those
-- bodies lived in a process-local map and died with the process.
--
-- WHY THE LEASE GENERATION IS IN THE KEY. The map was keyed per RUN, so a
-- repair round overwrote the round before it: the diff and the test output
-- that explain WHY a repair was needed were destroyed by the attempt to fix
-- it. `lease_generation` is the fencing token that already separates one
-- attempt from another everywhere else in this schema, and `julius_tasks.attempt`
-- is NOT the discriminator — it counts execution admissions and can stall
-- across a retry.
--
-- The bytes themselves live in the content-addressed store, which hashes them
-- on write and re-hashes them on read; `content_hash` here is what a reader
-- checks that body against, and `storage_ref` is how it asks for it.
CREATE TABLE relay_wonderland.julius_work_artifacts(
 artifact_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 lease_generation bigint NOT NULL CHECK(lease_generation>=0),
 role text NOT NULL,
 kind text NOT NULL CHECK(kind IN('PLAN','GUIDANCE','DIFF','TEST_OUTPUT','BASE_REVISION','REVIEW_PACKET','RESEARCH')),
 content_type text NOT NULL,
 byte_size bigint NOT NULL CHECK(byte_size>=0),
 content_hash text NOT NULL CHECK(length(content_hash)=64),
 storage_ref text NOT NULL,
 occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 -- ONE BODY PER ATTEMPT PER KIND. Two rounds of the same task hold two rows;
 -- neither can replace the other, because nothing here updates.
 UNIQUE(run_id,task_id,lease_generation,kind)
);
-- "the latest PLAN for this task", which is what a reviewer asks for, and
-- "everything this run produced", which is what the record is read by.
CREATE INDEX julius_work_artifact_latest ON relay_wonderland.julius_work_artifacts(run_id,task_id,kind,lease_generation DESC);
CREATE INDEX julius_work_artifact_run ON relay_wonderland.julius_work_artifacts(project_id,run_id,occurred_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('024_julius_work_artifacts');
COMMIT;
