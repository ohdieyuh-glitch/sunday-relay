BEGIN;
CREATE TABLE relay_wonderland.budget_reservations(
  reservation_id text PRIMARY KEY,
  execution_id text NOT NULL REFERENCES relay_wonderland.execution_sessions ON DELETE CASCADE,
  worker_id text,
  operation_key text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL CHECK(state IN('RESERVED','COMMITTED','RELEASED','EXPIRED','DENIED')),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0),
  cached_tokens bigint NOT NULL DEFAULT 0 CHECK(cached_tokens>=0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
  usd_micros bigint NOT NULL DEFAULT 0 CHECK(usd_micros>=0),
  tool_calls bigint NOT NULL DEFAULT 0 CHECK(tool_calls>=0),
  compute_ms bigint NOT NULL DEFAULT 0 CHECK(compute_ms>=0),
  runtime_ms bigint NOT NULL DEFAULT 0 CHECK(runtime_ms>=0),
  swarm_workers bigint NOT NULL DEFAULT 0 CHECK(swarm_workers>=0),
  committed_amounts jsonb,
  receipt_id text REFERENCES relay_wonderland.provider_receipts,
  denial_reason text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id,idempotency_key),
  CHECK((state='DENIED')=(denial_reason IS NOT NULL)),
  CHECK((state='COMMITTED')=(committed_amounts IS NOT NULL))
);
CREATE INDEX wonderland_budget_active ON relay_wonderland.budget_reservations(execution_id,state,expires_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('003_wonderland_budget_reservations');
COMMIT;
