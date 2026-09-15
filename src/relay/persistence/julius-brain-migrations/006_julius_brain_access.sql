BEGIN;
-- WHAT THE BRAIN SERVICE MUST NOT FORGET ACROSS A RESTART.
--
-- A GitHub-hosted run reaches the Brain only through the controlled service.
-- The protections that service gives are only as durable as what it remembers:
--
--   access_token_claims   every exchanged OIDC token, by digest (never the
--                         token, never its id): a replay after a restart is
--                         still a replay
--   access_registrations  the project, mission, state-mode policy and
--                         environment an attempt registered with: a restart
--                         cannot re-open an attempt's mode
--   access_sessions       sessions by the digest of their token (never the
--                         token); expiry is inside the session
--   access_audit          every decision, hash-chained; appended only
--
-- All four are append-only: no UPDATE, DELETE or TRUNCATE. Pruning expired
-- claims and sessions is an owner's administrative act, outside the service.
CREATE TABLE julius_brain.access_token_claims (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE julius_brain.access_registrations (
  brain_run_id text PRIMARY KEY,
  project_id text NOT NULL,
  mission_id text NOT NULL,
  policy_hash text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  registered_at timestamptz NOT NULL
);
CREATE TABLE julius_brain.access_sessions (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  session jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE julius_brain.access_audit (
  sequence bigint PRIMARY KEY CHECK (sequence > 0),
  event jsonb NOT NULL,
  previous_hash text,
  hash text NOT NULL UNIQUE
);
CREATE TRIGGER access_token_claims_immutable BEFORE UPDATE OR DELETE ON julius_brain.access_token_claims FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_token_claims_not_truncated BEFORE TRUNCATE ON julius_brain.access_token_claims FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_registrations_immutable BEFORE UPDATE OR DELETE ON julius_brain.access_registrations FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_registrations_not_truncated BEFORE TRUNCATE ON julius_brain.access_registrations FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_sessions_immutable BEFORE UPDATE OR DELETE ON julius_brain.access_sessions FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_sessions_not_truncated BEFORE TRUNCATE ON julius_brain.access_sessions FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_audit_immutable BEFORE UPDATE OR DELETE ON julius_brain.access_audit FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER access_audit_not_truncated BEFORE TRUNCATE ON julius_brain.access_audit FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
INSERT INTO julius_brain.schema_migrations(version) VALUES('006_julius_brain_access');
COMMIT;
