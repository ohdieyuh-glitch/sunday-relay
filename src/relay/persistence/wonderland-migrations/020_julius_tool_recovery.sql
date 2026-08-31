BEGIN;
ALTER TABLE relay_wonderland.julius_tool_invocations
 ADD COLUMN effect_classification text NOT NULL DEFAULT 'NON_IDEMPOTENT_MUTATION'
  CHECK(effect_classification IN('READ_ONLY','IDEMPOTENT_MUTATION','NON_IDEMPOTENT_MUTATION','PROCESS_WITH_EXTERNAL_EFFECT')),
 ADD COLUMN recovery_state text NOT NULL DEFAULT 'NONE'
  CHECK(recovery_state IN('NONE','RECONCILING','UNKNOWN_OUTCOME','AWAITING_DECISION','RECONCILED')),
 ADD COLUMN recovery_claimed_by text,
 ADD COLUMN recovery_claimed_until timestamptz;

CREATE TABLE relay_wonderland.julius_sandboxes(
 sandbox_id text PRIMARY KEY,
 tenant_id text NOT NULL,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 invocation_id text NOT NULL,
 lease_generation bigint NOT NULL CHECK(lease_generation>0),
 runtime_instance_id text NOT NULL,
 container_id text,
 image_digest text NOT NULL CHECK(image_digest LIKE 'sha256:%'),
 workspace_snapshot text NOT NULL,
 policy_revision text NOT NULL,
 resource_limits jsonb NOT NULL,
 state text NOT NULL CHECK(state IN('CREATING','READY','ACTIVE','RECONCILING','DESTROYING','DESTROYED','LOST')),
 created_at timestamptz NOT NULL,
 last_heartbeat_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 recovery_claim_generation bigint NOT NULL DEFAULT 0,
 recovery_claimed_until timestamptz,
 UNIQUE(project_id,sandbox_id),
 UNIQUE(project_id,sandbox_id,invocation_id),
 UNIQUE(invocation_id),
 FOREIGN KEY(tenant_id,project_id,run_id,task_id,invocation_id) REFERENCES relay_wonderland.julius_tool_invocations(tenant_id,project_id,run_id,task_id,invocation_id) ON DELETE CASCADE
);
CREATE INDEX julius_sandbox_recovery ON relay_wonderland.julius_sandboxes(state,expires_at,last_heartbeat_at);

CREATE TABLE relay_wonderland.julius_tool_execution_receipts(
 invocation_id text NOT NULL,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 dispatch_generation bigint NOT NULL CHECK(dispatch_generation>0),
 sandbox_id text NOT NULL,
 execution_token_hash text NOT NULL CHECK(length(execution_token_hash)=64),
 request_digest text NOT NULL CHECK(length(request_digest)=64),
 effect_classification text NOT NULL CHECK(effect_classification IN('READ_ONLY','IDEMPOTENT_MUTATION','NON_IDEMPOTENT_MUTATION','PROCESS_WITH_EXTERNAL_EFFECT')),
 state text NOT NULL CHECK(state IN('NEVER_STARTED','STARTED_UNKNOWN_OUTCOME','STILL_RUNNING','COMPLETED_WITH_RESULT','FAILED_WITH_RESULT','SANDBOX_GONE')),
 started_at timestamptz,
 completed_at timestamptz,
 result_digest text CHECK(result_digest IS NULL OR length(result_digest)=64),
 before_state_digest text CHECK(before_state_digest IS NULL OR length(before_state_digest)=64),
 after_state_digest text CHECK(after_state_digest IS NULL OR length(after_state_digest)=64),
 result jsonb,
 PRIMARY KEY(invocation_id,dispatch_generation),
 UNIQUE(execution_token_hash),
 FOREIGN KEY(project_id,invocation_id) REFERENCES relay_wonderland.julius_tool_invocations(project_id,invocation_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,sandbox_id,invocation_id) REFERENCES relay_wonderland.julius_sandboxes(project_id,sandbox_id,invocation_id) ON DELETE RESTRICT,
 CHECK((state IN('COMPLETED_WITH_RESULT','FAILED_WITH_RESULT'))=(completed_at IS NOT NULL)),
 CHECK(state NOT IN('COMPLETED_WITH_RESULT','FAILED_WITH_RESULT') OR result IS NOT NULL)
);

CREATE TABLE relay_wonderland.julius_tool_settlements(
 invocation_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 budget_reservation_id text NOT NULL REFERENCES relay_wonderland.budget_reservations,
 receipt_digest text NOT NULL CHECK(length(receipt_digest)=64),
 resource_usage jsonb NOT NULL,
 settlement_state text NOT NULL CHECK(settlement_state IN('COMMITTED','RELEASED')),
 settled_at timestamptz NOT NULL,
 FOREIGN KEY(project_id,invocation_id) REFERENCES relay_wonderland.julius_tool_invocations(project_id,invocation_id) ON DELETE CASCADE
);

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('020_julius_tool_recovery');
COMMIT;
