BEGIN;
CREATE TABLE relay_wonderland.provider_operations(
 operation_id text PRIMARY KEY,execution_id text NOT NULL REFERENCES relay_wonderland.execution_sessions ON DELETE CASCADE,worker_id text,idempotency_key text NOT NULL,provider text NOT NULL,model text NOT NULL,state text NOT NULL CHECK(state IN('PLANNED','RESERVED','DISPATCHED','RECEIPT_RECEIVED','COMMITTED','RELEASED','EXPIRED','FAILED')),reservation_id text REFERENCES relay_wonderland.budget_reservations,provider_request_id text,requested jsonb NOT NULL,receipt jsonb,failure_reason text,overage_dimensions jsonb NOT NULL DEFAULT '[]',version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(execution_id,idempotency_key),UNIQUE(provider,provider_request_id)
);
CREATE INDEX wonderland_provider_operation_recovery ON relay_wonderland.provider_operations(state,updated_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('007_wonderland_provider_operations');
COMMIT;
