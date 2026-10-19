BEGIN;
CREATE TABLE relay_wonderland.julius_runs(
 run_id text PRIMARY KEY,mission_id text NOT NULL REFERENCES relay_wonderland.mission_contracts,project_id text NOT NULL REFERENCES relay_wonderland.projects,
 state text NOT NULL CHECK(state IN('CREATED','PLANNING','READY','EXECUTING','WAITING','REVIEWING','REPAIRING','VERIFYING','BLOCKED','PAUSED','FAILED','COMPLETED','CANCELLED')),
 runtime_version text NOT NULL,card_revision text NOT NULL,mission_contract_revision bigint NOT NULL CHECK(mission_contract_revision>0),project_brain_revision bigint NOT NULL CHECK(project_brain_revision>=0),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(mission_id,run_id)
);
CREATE INDEX julius_run_project_state ON relay_wonderland.julius_runs(project_id,state,created_at);
CREATE TABLE relay_wonderland.julius_tasks(
 task_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,parent_task_id text REFERENCES relay_wonderland.julius_tasks,
 role text NOT NULL,task_type text NOT NULL,state text NOT NULL CHECK(state IN('BLOCKED','RUNNABLE','ACTIVE','SUCCEEDED','FAILED','CANCELLED','SKIPPED')),
 ordinal integer NOT NULL CHECK(ordinal>=0),required_evidence_types jsonb NOT NULL DEFAULT '[]',worker_id text,
 lease_owner text,lease_generation bigint NOT NULL DEFAULT 0,lease_expires_at timestamptz,last_heartbeat timestamptz,attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),next_attempt_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='ACTIVE')=(lease_owner IS NOT NULL)),UNIQUE(run_id,ordinal,task_id)
);
CREATE TABLE relay_wonderland.julius_task_dependencies(task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,dependency_task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,PRIMARY KEY(task_id,dependency_task_id),CHECK(task_id<>dependency_task_id));
CREATE INDEX julius_task_claim ON relay_wonderland.julius_tasks(state,next_attempt_at,lease_expires_at,created_at);
CREATE INDEX julius_task_run_state ON relay_wonderland.julius_tasks(run_id,state,ordinal);
CREATE INDEX julius_dependency_reverse ON relay_wonderland.julius_task_dependencies(dependency_task_id,task_id);
CREATE TABLE relay_wonderland.julius_transitions(
 transition_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,from_state text NOT NULL,to_state text NOT NULL,reason_code text NOT NULL,safe_summary text NOT NULL,evidence_ids jsonb NOT NULL DEFAULT '[]',runtime_version text NOT NULL,occurred_at timestamptz NOT NULL,sequence bigint NOT NULL,UNIQUE(run_id,sequence)
);
CREATE INDEX julius_transition_timeline ON relay_wonderland.julius_transitions(run_id,sequence);
CREATE TABLE relay_wonderland.julius_evidence(
 evidence_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,worker_id text NOT NULL,evidence_type text NOT NULL,status text NOT NULL CHECK(status IN('PASSED','FAILED','INCONCLUSIVE')),safe_summary text NOT NULL,artifact_ref text,integrity_hash text,occurred_at timestamptz NOT NULL,idempotency_key text NOT NULL,UNIQUE(run_id,idempotency_key)
);
CREATE INDEX julius_evidence_task ON relay_wonderland.julius_evidence(task_id,occurred_at,evidence_id);
CREATE TABLE relay_wonderland.julius_verification_decisions(
 decision_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,action text NOT NULL CHECK(action IN('ACCEPT','REPAIR','REROUTE','RETRY','ESCALATE','HALT','COMPLETE')),reason_code text NOT NULL,safe_summary text NOT NULL,evidence_ids jsonb NOT NULL DEFAULT '[]',policy_revision text NOT NULL,occurred_at timestamptz NOT NULL,idempotency_key text NOT NULL,UNIQUE(run_id,idempotency_key)
);
CREATE INDEX julius_decision_task ON relay_wonderland.julius_verification_decisions(task_id,occurred_at);
CREATE TABLE relay_wonderland.julius_context_snapshots(
 context_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,worker_id text NOT NULL,compiler_version text NOT NULL,mission_contract_revision bigint NOT NULL,card_revision text NOT NULL,project_brain_revision bigint NOT NULL,source_entry_ids jsonb NOT NULL,content_hash text NOT NULL,character_count integer NOT NULL CHECK(character_count>=0),truncated boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(task_id,worker_id,content_hash)
);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('011_julius_runtime');
COMMIT;
