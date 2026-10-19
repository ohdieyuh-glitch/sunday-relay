BEGIN;
CREATE TABLE relay_wonderland.swarm_runs(
 swarm_id text PRIMARY KEY,battle_id text NOT NULL REFERENCES relay_wonderland.battles,parent_execution_id text NOT NULL REFERENCES relay_wonderland.execution_sessions,parent_agent_id text NOT NULL REFERENCES relay_wonderland.agents,card_version_id text NOT NULL REFERENCES relay_wonderland.card_versions,mode text NOT NULL CHECK(mode IN('GOAL','EVAL')),requested_roles jsonb NOT NULL,authorized_roles jsonb NOT NULL,concurrency_ceiling integer NOT NULL CHECK(concurrency_ceiling>0),budget jsonb NOT NULL,state text NOT NULL CHECK(state IN('PENDING','RUNNING','COMPLETE','PARTIAL','FAILED','CANCELLED')),activated_at timestamptz NOT NULL,deadline timestamptz NOT NULL,cancellation_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE relay_wonderland.swarm_workers(
 worker_id text PRIMARY KEY,swarm_id text NOT NULL REFERENCES relay_wonderland.swarm_runs ON DELETE CASCADE,role text NOT NULL,execution_id text REFERENCES relay_wonderland.execution_sessions,lease_owner text,lease_generation bigint NOT NULL DEFAULT 0,lease_expires_at timestamptz,last_heartbeat timestamptz,attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),state text NOT NULL CHECK(state IN('PENDING','CLAIMED','STARTING','RUNNING','COMPLETE','FAILED','CANCELLED','TIMED_OUT','BUDGET_EXHAUSTED')),provider_operation_id text REFERENCES relay_wonderland.provider_operations,budget_reservation_id text REFERENCES relay_wonderland.budget_reservations,usage jsonb NOT NULL DEFAULT '{}',evidence_ids jsonb NOT NULL DEFAULT '[]',artifact_ids jsonb NOT NULL DEFAULT '[]',result jsonb,safe_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK((state IN('CLAIMED','STARTING','RUNNING'))=(lease_owner IS NOT NULL))
);
CREATE INDEX wonderland_swarm_worker_claim ON relay_wonderland.swarm_workers(state,lease_expires_at,created_at);
CREATE INDEX wonderland_swarm_battle ON relay_wonderland.swarm_runs(battle_id,state);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('008_wonderland_swarm_scheduler');
COMMIT;
