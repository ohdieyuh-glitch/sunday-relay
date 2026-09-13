BEGIN;
-- GOVERNED PYTHON EXECUTIONS.
--
-- One row per requested execution, idempotent per project. `record` is the
-- exact document the domain reads and writes; the typed columns beside it are
-- the constraints and indexes over it. Settlement updates this row and commits
-- the execution's Project Brain records in the SAME transaction, under this
-- row's lock and then the Brain row's lock, so a terminal state and its Brain
-- records exist together or not at all.
--
-- There is deliberately no foreign key to julius_brains: a request naming a
-- Brain that does not exist is still a durable fact (it is DENIED), and must
-- be recordable.
CREATE TABLE relay_wonderland.julius_python_executions(
 execution_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 brain_id text NOT NULL,
 mission_id text NOT NULL,
 run_id text,
 task_id text NOT NULL,
 idempotency_key text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 script_hash text NOT NULL CHECK(script_hash ~ '^sha256:[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN('REQUESTED','RUNNING','CANCEL_REQUESTED','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','DENIED','DISCONNECTED')),
 host_instance_id text,
 requested_at timestamptz NOT NULL,
 started_at timestamptz,
 completed_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 record jsonb NOT NULL,
 UNIQUE(project_id,idempotency_key),
 CHECK((state IN('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','DENIED','DISCONNECTED'))=(completed_at IS NOT NULL)),
 CHECK(state NOT IN('RUNNING','CANCEL_REQUESTED') OR started_at IS NOT NULL)
);
CREATE INDEX julius_python_executions_in_flight ON relay_wonderland.julius_python_executions(started_at) WHERE state IN('RUNNING','CANCEL_REQUESTED');
CREATE INDEX julius_python_executions_by_task ON relay_wonderland.julius_python_executions(project_id,mission_id,task_id,requested_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('025_julius_python_executions');
COMMIT;
