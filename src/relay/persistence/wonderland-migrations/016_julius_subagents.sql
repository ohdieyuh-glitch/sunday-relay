BEGIN;
-- Sub-agents were authorized by a pure function and never recorded, so no
-- depth, count or permission bound could survive a restart and no child ever
-- entered the durable task graph.
CREATE TABLE relay_wonderland.julius_subagents(
 request_id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 parent_task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 child_task_id text NOT NULL UNIQUE REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 -- Depth is STORED rather than recomputed by walking parents: the walk is a
 -- recursive query on the hot spawn path, and a stored depth is what the
 -- max-depth bound is actually checked against.
 depth integer NOT NULL CHECK(depth>0),
 capability text NOT NULL,
 -- Narrowed at authorization time. A child never holds a permission its
 -- parent did not, and the row is the record of what it was granted.
 permissions jsonb NOT NULL DEFAULT '[]',
 budget_reservation_id text NOT NULL,
 state text NOT NULL CHECK(state IN('AUTHORIZED','ACTIVE','SUCCEEDED','FAILED','CANCELLED')),
 denial_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,request_id)
);
-- The two counting bounds read this index: active children of one parent, and
-- total children of one run.
CREATE INDEX julius_subagent_parent ON relay_wonderland.julius_subagents(parent_task_id,state);
CREATE INDEX julius_subagent_run ON relay_wonderland.julius_subagents(run_id,state,created_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('016_julius_subagents');
COMMIT;
