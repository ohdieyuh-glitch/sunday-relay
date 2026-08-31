BEGIN;
ALTER TABLE relay_wonderland.julius_context_snapshots ADD COLUMN worker_role text NOT NULL DEFAULT 'SPECIALIST:unknown',ADD COLUMN dependency_task_ids jsonb NOT NULL DEFAULT '[]',ADD COLUMN evidence_ids jsonb NOT NULL DEFAULT '[]',ADD COLUMN finding_ids jsonb NOT NULL DEFAULT '[]',ADD COLUMN acceptance_criterion_ids jsonb NOT NULL DEFAULT '[]',ADD COLUMN redaction_count integer NOT NULL DEFAULT 0 CHECK(redaction_count>=0);
CREATE TABLE relay_wonderland.julius_brain_entries(
 entry_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,project_id text NOT NULL REFERENCES relay_wonderland.projects,task_id text REFERENCES relay_wonderland.julius_tasks,worker_id text NOT NULL,entry_kind text NOT NULL CHECK(entry_kind IN('DECISION','FINDING','REPAIR','ARTIFACT','CONSTRAINT','RESEARCH_NOTE','HANDOFF','ACCEPTANCE_UPDATE')),safe_content text NOT NULL,evidence_ids jsonb NOT NULL DEFAULT '[]',revision bigint NOT NULL CHECK(revision>0),created_at timestamptz NOT NULL,UNIQUE(run_id,revision)
);
CREATE INDEX julius_brain_context ON relay_wonderland.julius_brain_entries(run_id,entry_kind,revision);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('014_julius_context_brain');
COMMIT;
