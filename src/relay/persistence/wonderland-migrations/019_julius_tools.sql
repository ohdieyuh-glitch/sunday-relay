BEGIN;
CREATE TABLE relay_wonderland.julius_tool_invocations(
 invocation_id text PRIMARY KEY,
 idempotency_key text NOT NULL,
 request_digest text NOT NULL CHECK(length(request_digest)=64),
 tenant_id text NOT NULL,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 worker_id text NOT NULL,
 lease_generation bigint NOT NULL CHECK(lease_generation>0),
 policy_revision text NOT NULL,
 tool_id text NOT NULL,
 tool_version text NOT NULL,
 mutation_class text NOT NULL CHECK(mutation_class IN('NONE','WORKSPACE')),
 state text NOT NULL CHECK(state IN('REQUESTED','AUTHORIZED','DISPATCHING','RUNNING','SUCCEEDED','FAILED','DENIED','CANCELLED','TIMED_OUT')),
 sandbox_id text,
 budget_reservation_id text,
 exit_code integer,
 safe_summary text,
 stdout_preview text NOT NULL DEFAULT '', stdout_artifact_id text,
 stderr_preview text NOT NULL DEFAULT '', stderr_artifact_id text,
 evidence_ids jsonb NOT NULL DEFAULT '[]', artifact_ids jsonb NOT NULL DEFAULT '[]',
 duration_ms bigint CHECK(duration_ms>=0),
 requested_at timestamptz NOT NULL, authorized_at timestamptz, started_at timestamptz, completed_at timestamptz,
 dispatch_generation bigint NOT NULL DEFAULT 0,
 dispatch_claimed_by text, dispatch_claimed_until timestamptz,
 UNIQUE(project_id,run_id,idempotency_key),
 UNIQUE(project_id,invocation_id), UNIQUE(tenant_id,project_id,run_id,task_id,invocation_id),
 CHECK((state IN('SUCCEEDED','FAILED','DENIED','CANCELLED','TIMED_OUT'))=(completed_at IS NOT NULL))
);
CREATE INDEX julius_tool_run ON relay_wonderland.julius_tool_invocations(project_id,run_id,requested_at);
CREATE TABLE relay_wonderland.julius_tool_outbox(
 invocation_id text PRIMARY KEY REFERENCES relay_wonderland.julius_tool_invocations ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','DELIVERED','DEAD')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_by text, claimed_until timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
 CHECK((state='CLAIMED')=(claimed_by IS NOT NULL))
);
CREATE INDEX julius_tool_outbox_claim ON relay_wonderland.julius_tool_outbox(state,next_attempt_at,claimed_until,created_at);
CREATE TABLE relay_wonderland.julius_artifacts(
 artifact_id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL REFERENCES relay_wonderland.projects,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE, task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 invocation_id text NOT NULL,
 kind text NOT NULL, content_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size>=0), content_hash text NOT NULL CHECK(length(content_hash)=64),
 storage_ref text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz,
 UNIQUE(tenant_id,project_id,artifact_id),
 FOREIGN KEY(tenant_id,project_id,run_id,task_id,invocation_id) REFERENCES relay_wonderland.julius_tool_invocations(tenant_id,project_id,run_id,task_id,invocation_id) ON DELETE CASCADE
);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('019_julius_tools');
COMMIT;
