BEGIN;
CREATE TABLE relay_wonderland.outbox(
  outbox_id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE REFERENCES relay_wonderland.events(event_id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES relay_wonderland.projects(project_id),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','CLAIMED','DELIVERED','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  claimed_by text,
  claimed_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CHECK((status='CLAIMED')=(claimed_by IS NOT NULL))
);
CREATE INDEX wonderland_outbox_claim ON relay_wonderland.outbox(status,next_attempt_at,claimed_until,created_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('002_wonderland_outbox');
COMMIT;
