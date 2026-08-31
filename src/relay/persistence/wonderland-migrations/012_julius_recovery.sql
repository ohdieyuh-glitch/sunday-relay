BEGIN;
CREATE TABLE relay_wonderland.julius_worker_results(
 result_id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 lease_generation bigint NOT NULL CHECK(lease_generation>0),
 worker_id text NOT NULL,
 status text NOT NULL CHECK(status IN('SUCCEEDED','FAILED','CANCELLED')),
 safe_summary text NOT NULL,
 evidence_ids jsonb NOT NULL DEFAULT '[]',
 provider_receipt_ids jsonb NOT NULL DEFAULT '[]',
 idempotency_key text NOT NULL,
 occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,idempotency_key),
 UNIQUE(task_id,lease_generation)
);
CREATE INDEX julius_result_run_timeline ON relay_wonderland.julius_worker_results(run_id,occurred_at,result_id);
CREATE TABLE relay_wonderland.julius_repair_cycles(
 repair_id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 original_task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks,
 repair_task_id text NOT NULL UNIQUE REFERENCES relay_wonderland.julius_tasks,
 round integer NOT NULL CHECK(round>0),
 finding_ids jsonb NOT NULL DEFAULT '[]',
 evidence_ids jsonb NOT NULL DEFAULT '[]',
 budget_reservation_id text NOT NULL,
 state text NOT NULL CHECK(state IN('SCHEDULED','ACTIVE','VERIFIED','FAILED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(original_task_id,round)
);
CREATE INDEX julius_repair_recovery ON relay_wonderland.julius_repair_cycles(run_id,state,round);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('012_julius_recovery');
COMMIT;
