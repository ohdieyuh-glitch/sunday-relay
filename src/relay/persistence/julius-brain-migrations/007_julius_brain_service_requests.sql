BEGIN;
-- ONE REQUEST, ONE EFFECT — AND LIMITS THAT SURVIVE A RESTART.
--
--   service_requests      what a request id already did, per attempt. A client
--                         that lost a response repeats the request and is given
--                         the answer it already earned. The claim may be
--                         withdrawn while it has no answer (the work never
--                         ran); once answered, the answer never changes.
--   rate_limit_counters   fixed-window counters, when the deployment wants its
--                         limits exact across processes rather than per process.
--                         Counters are ordinary mutable rows: they hold
--                         identifiers and numbers, never content.
CREATE TABLE julius_brain.service_requests (
  key text PRIMARY KEY,
  request_digest text NOT NULL,
  operation text NOT NULL,
  response jsonb,
  started_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE FUNCTION julius_brain.service_request_answered_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key <> OLD.key OR NEW.request_digest <> OLD.request_digest OR NEW.operation <> OLD.operation OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'julius_brain_immutable: a request id keeps the request it claimed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.response IS NOT NULL AND NEW.response IS DISTINCT FROM OLD.response THEN
    RAISE EXCEPTION 'julius_brain_immutable: a request that was answered keeps its answer' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE FUNCTION julius_brain.service_request_unanswered_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.response IS NOT NULL THEN
    RAISE EXCEPTION 'julius_brain_immutable: an answered request is not deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER service_requests_answered_once BEFORE UPDATE ON julius_brain.service_requests FOR EACH ROW EXECUTE FUNCTION julius_brain.service_request_answered_once();
CREATE TRIGGER service_requests_unanswered_only BEFORE DELETE ON julius_brain.service_requests FOR EACH ROW EXECUTE FUNCTION julius_brain.service_request_unanswered_only();
CREATE TRIGGER service_requests_not_truncated BEFORE TRUNCATE ON julius_brain.service_requests FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();

CREATE TABLE julius_brain.rate_limit_counters (
  key text NOT NULL,
  window_start bigint NOT NULL,
  used integer NOT NULL CHECK (used >= 0),
  PRIMARY KEY (key, window_start)
);
INSERT INTO julius_brain.schema_migrations(version) VALUES('007_julius_brain_service_requests');
COMMIT;
