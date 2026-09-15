BEGIN;
-- GOVERNED PYTHON EXECUTIONS, IN THE PROJECT BRAIN DATABASE.
--
-- They live beside the Brain because settlement is one transaction: this row's
-- terminal state and the execution's Project Brain records commit together or
-- not at all, under this row's lock and then the Brain row's lock.
--
-- One row per requested execution, idempotent per project. `record` is the
-- exact document the domain reads and writes; the typed columns beside it are
-- the constraints and indexes over it.
--
-- There is deliberately no foreign key to brains or projects: a request naming
-- a Brain or project that does not exist is still a durable fact (it is
-- DENIED), and must be recordable.
CREATE TABLE julius_brain.python_executions(
 execution_id text PRIMARY KEY,
 project_id text NOT NULL CHECK(length(project_id) BETWEEN 1 AND 256),
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
CREATE INDEX python_executions_in_flight ON julius_brain.python_executions(started_at) WHERE state IN('RUNNING','CANCEL_REQUESTED');
CREATE INDEX python_executions_by_task ON julius_brain.python_executions(project_id,mission_id,task_id,requested_at);
INSERT INTO julius_brain.schema_migrations(version) VALUES('002_julius_brain_python_executions');
COMMIT;
