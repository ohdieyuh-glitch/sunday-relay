BEGIN;
-- C.A.R.D. could return REQUIRE_APPROVAL and the runtime had nowhere to put
-- the request, no way to wait for an answer, and no way to resume — so a gated
-- operation could only ever be refused, which is not the same thing.
CREATE TABLE relay_wonderland.julius_approvals(
 approval_id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 -- Nullable: an approval can gate a run-level operation as well as a task.
 task_id text REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 operation text NOT NULL,
 policy_revision text NOT NULL,
 reason_code text NOT NULL,
 safe_rationale text NOT NULL,
 state text NOT NULL CHECK(state IN('PENDING','APPROVED','DENIED','CANCELLED')),
 requested_at timestamptz NOT NULL,
 decided_at timestamptz,
 -- WHO decided, recorded. An approval nobody can be named for is not an
 -- approval, and the runtime refuses to record one.
 decided_by text,
 decision_reason text,
 idempotency_key text NOT NULL,
 CHECK((state='PENDING')=(decided_at IS NULL)),
 CHECK((state='PENDING')=(decided_by IS NULL)),
 UNIQUE(run_id,idempotency_key)
);
-- ONE PENDING APPROVAL PER GATED OPERATION. Two workers reaching the same gate
-- must produce one request for a human, not two — and this is a schema fact
-- rather than a code convention. `COALESCE` because NULL never equals NULL and
-- a run-level gate would otherwise be duplicable.
CREATE UNIQUE INDEX julius_approval_one_pending
  ON relay_wonderland.julius_approvals(run_id,COALESCE(task_id,''),operation)
  WHERE state='PENDING';
CREATE INDEX julius_approval_inbox ON relay_wonderland.julius_approvals(project_id,state,requested_at);

-- Pause, resume and cancel were states in the transition table with no
-- operation behind them. These columns record WHO asked and WHY, so a paused
-- run can say why it is paused rather than merely that it is.
ALTER TABLE relay_wonderland.julius_runs
  ADD COLUMN lifecycle_reason text,
  ADD COLUMN lifecycle_actor text,
  ADD COLUMN lifecycle_at timestamptz;
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('018_julius_lifecycle');
COMMIT;
