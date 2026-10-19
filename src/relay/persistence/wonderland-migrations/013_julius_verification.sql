BEGIN;
CREATE TABLE relay_wonderland.julius_acceptance_criteria(
 criterion_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,description text NOT NULL,required_evidence_types jsonb NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,ordinal)
);
CREATE TABLE relay_wonderland.julius_criterion_evidence(
 criterion_id text NOT NULL REFERENCES relay_wonderland.julius_acceptance_criteria ON DELETE CASCADE,evidence_id text NOT NULL REFERENCES relay_wonderland.julius_evidence ON DELETE CASCADE,PRIMARY KEY(criterion_id,evidence_id)
);
CREATE TABLE relay_wonderland.julius_reviewer_findings(
 finding_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,reviewer_worker_id text NOT NULL,severity text NOT NULL CHECK(severity IN('INFO','LOW','MEDIUM','HIGH','CRITICAL')),category text NOT NULL,claim text NOT NULL,criterion_id text REFERENCES relay_wonderland.julius_acceptance_criteria,evidence_ids jsonb NOT NULL,blocking boolean NOT NULL,status text NOT NULL CHECK(status IN('OPEN','RESOLVED','DISMISSED')),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL, CHECK(jsonb_array_length(evidence_ids)>0)
);
CREATE INDEX julius_finding_gate ON relay_wonderland.julius_reviewer_findings(run_id,task_id,status,blocking);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('013_julius_verification');
COMMIT;
