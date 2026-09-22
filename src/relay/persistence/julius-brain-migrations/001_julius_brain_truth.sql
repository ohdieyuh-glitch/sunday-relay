BEGIN;
-- PROJECT BRAIN: DURABLE PROJECT TRUTH, IN ITS OWN DATABASE.
--
-- One squashed initial migration. There is no deployed Brain database to
-- migrate from, so the chain starts clean rather than carrying a history of
-- decisions that were taken before this schema existed.
--
--   WHERE IT LIVES. Its own schema, in its own database. The Julius runtime
--   database is disposable in a paid run; this is not. `julius-brain-database.ts`
--   refuses to migrate a database that holds the runtime schema, so the two can
--   never become one.
--
--   WHAT IT KEEPS. `records` is the ledger: every durable fact in the order it
--   was stated, each committing by hash to the one before it. Identity, author,
--   scope and evidence are columns because they are queried; the fact itself is
--   jsonb because its shape belongs to its domain.
--
--   WHAT IT REFUSES. No UPDATE, no DELETE, no TRUNCATE — the database enforces
--   it, not only the code that happens to be connected. A change of truth is a
--   new record that supersedes an older one.
CREATE SCHEMA julius_brain;

CREATE TABLE julius_brain.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Which environment this database serves, fixed at first migration. Development
-- configuration can then never open a production Brain, or the reverse.
CREATE TABLE julius_brain.database_identity (
  database_id uuid PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one row, forever.
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton)
);

CREATE TABLE julius_brain.records (
  record_id text PRIMARY KEY,
  -- The sequence is the project's own: one project's history is not interleaved
  -- with another's, and two projects both having a first record is normal.
  sequence bigint NOT NULL CHECK (sequence > 0),
  -- The truth domain, from the ownership registry. The author is checked in the
  -- domain's terms before anything reaches this table.
  domain text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('FACT', 'PROPOSAL')),
  -- Julius's own identity for the run or attempt: `run:<id>` or
  -- `attempt:<runId>/<taskId>/<leaseGeneration>`.
  scope text NOT NULL,
  run_id text NOT NULL,
  project_id text NOT NULL,
  mission_id text NOT NULL,
  author text NOT NULL,
  author_id text NOT NULL,
  payload jsonb NOT NULL,
  evidence_ids jsonb NOT NULL,
  -- When it happened. NULL is Unknown, and is never the moment it was recorded.
  occurred_at timestamptz,
  recorded_at timestamptz NOT NULL,
  -- A record this one replaces. The older row stays exactly as it was.
  supersedes text REFERENCES julius_brain.records(record_id),
  idempotency_key text NOT NULL UNIQUE,
  previous_hash text,
  hash text NOT NULL UNIQUE,
  CHECK (supersedes IS NULL OR supersedes <> record_id),
  UNIQUE (project_id, sequence)
);

CREATE INDEX julius_brain_records_scope ON julius_brain.records(scope, sequence);
CREATE INDEX julius_brain_records_run ON julius_brain.records(run_id, domain, sequence);
CREATE INDEX julius_brain_records_project ON julius_brain.records(project_id, mission_id, domain, sequence);
CREATE INDEX julius_brain_records_domain ON julius_brain.records(domain, status, sequence);

-- History is not edited. A trigger says so to whoever is connected, including
-- the service role, which is not the owner and so cannot disable it.
CREATE FUNCTION julius_brain.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'julius_brain_immutable: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER records_immutable BEFORE UPDATE OR DELETE ON julius_brain.records FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER records_not_truncated BEFORE TRUNCATE ON julius_brain.records FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER identity_immutable BEFORE UPDATE OR DELETE ON julius_brain.database_identity FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER identity_not_truncated BEFORE TRUNCATE ON julius_brain.database_identity FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER migrations_immutable BEFORE UPDATE OR DELETE ON julius_brain.schema_migrations FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();

INSERT INTO julius_brain.schema_migrations(version) VALUES('001_julius_brain_truth');
COMMIT;
