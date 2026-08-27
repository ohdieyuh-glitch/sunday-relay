BEGIN;
CREATE TABLE relay_wonderland.julius_trajectory_events(
 trajectory_event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,project_id text NOT NULL REFERENCES relay_wonderland.projects,
 event_kind text NOT NULL CHECK(event_kind IN('TASK_TOPOLOGY','WORKER_SELECTED','PROVIDER_SELECTED','CONTEXT_COMPILED','DISPATCH','RETRY','FALLBACK','SUBAGENT','GAUNTLET_ROUND','FINDING','REPAIR','VERIFICATION','RECOVERY','COMPLETION')),
 task_id text REFERENCES relay_wonderland.julius_tasks,worker_id text,provider_id text,context_id text REFERENCES relay_wonderland.julius_context_snapshots,
 runtime_version text NOT NULL,policy_version text NOT NULL,card_revision text NOT NULL,mission_contract_revision bigint NOT NULL,project_brain_revision bigint NOT NULL,
 duration_ms bigint CHECK(duration_ms IS NULL OR duration_ms>=0),usd_micros bigint CHECK(usd_micros IS NULL OR usd_micros>=0),input_tokens bigint CHECK(input_tokens IS NULL OR input_tokens>=0),output_tokens bigint CHECK(output_tokens IS NULL OR output_tokens>=0),
 outcome text,safe_facts jsonb NOT NULL DEFAULT '{}',idempotency_key text NOT NULL,occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,idempotency_key)
);
CREATE INDEX julius_trajectory_run ON relay_wonderland.julius_trajectory_events(run_id,occurred_at,trajectory_event_id);
CREATE INDEX julius_trajectory_eval ON relay_wonderland.julius_trajectory_events(project_id,runtime_version,event_kind,occurred_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('015_julius_trajectories');
COMMIT;
