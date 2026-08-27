BEGIN;
-- #172 modelled a gauntlet as a mutable JavaScript object. Nothing persisted
-- it, so a round could not survive a restart, two schedulers could both start
-- "round 2", and a cleared gauntlet had no record of what cleared it.
CREATE TABLE relay_wonderland.julius_gauntlets(
 gauntlet_id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 -- The task the gauntlet is run FOR. One gauntlet per task, so a second
 -- /gauntletloop on the same task resumes rather than forking.
 task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN('READY','RUNNING','VERIFYING','REPAIRING','CLEARED','HALTED','CANCELLED')),
 round integer NOT NULL DEFAULT 0 CHECK(round>=0),
 retries integer NOT NULL DEFAULT 0 CHECK(retries>=0),
 max_rounds integer NOT NULL CHECK(max_rounds>0),
 max_retries integer NOT NULL CHECK(max_retries>=0),
 max_duration_ms bigint NOT NULL CHECK(max_duration_ms>0),
 max_usd_micros bigint NOT NULL CHECK(max_usd_micros>=0),
 used_duration_ms bigint NOT NULL DEFAULT 0 CHECK(used_duration_ms>=0),
 used_usd_micros bigint NOT NULL DEFAULT 0 CHECK(used_usd_micros>=0),
 halt_reason text,
 -- Optimistic concurrency, matching `advanceGauntlet`'s own expectedVersion
 -- check so the durable guard and the in-memory guard are the same guard.
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,task_id)
);
CREATE INDEX julius_gauntlet_run ON relay_wonderland.julius_gauntlets(run_id,state);

CREATE TABLE relay_wonderland.julius_gauntlet_rounds(
 gauntlet_id text NOT NULL REFERENCES relay_wonderland.julius_gauntlets ON DELETE CASCADE,
 round integer NOT NULL CHECK(round>0),
 -- The ordinary task that carries the round's work. A round is not a special
 -- execution path; it is a row in julius_tasks like everything else.
 task_id text NOT NULL UNIQUE REFERENCES relay_wonderland.julius_tasks ON DELETE CASCADE,
 phase text NOT NULL CHECK(phase IN('EXECUTE','REVIEW','REPAIR')),
 outcome text CHECK(outcome IS NULL OR outcome IN('PASSED','FAILED','HALTED','CANCELLED')),
 duration_ms bigint CHECK(duration_ms IS NULL OR duration_ms>=0),
 usd_micros bigint CHECK(usd_micros IS NULL OR usd_micros>=0),
 evidence_ids jsonb NOT NULL DEFAULT '[]',
 started_at timestamptz NOT NULL,
 completed_at timestamptz,
 -- DUPLICATE ROUND SCHEDULING IS A SCHEMA IMPOSSIBILITY, not a code
 -- convention: two schedulers both deciding to start round 2 produce one row.
 PRIMARY KEY(gauntlet_id,round,phase)
);
CREATE INDEX julius_gauntlet_round_timeline ON relay_wonderland.julius_gauntlet_rounds(gauntlet_id,round,started_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('017_julius_gauntlet');
COMMIT;
