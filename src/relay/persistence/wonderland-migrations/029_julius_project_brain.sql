BEGIN;
-- THE PROJECT BRAIN'S HUMAN-AUTHORED TRUTH, IN JULIUS'S OWN DATABASE.
--
-- Julius already keeps the Brain it acts on in this schema: julius_brain_entries,
-- the acceptance criteria, the reviewer's findings, evidence, verification
-- decisions, repair cycles, approvals, task contracts and the trajectory. What it
-- had nowhere to put was what a PERSON states about a project -- a requirement
-- proposed from Wonderland, a standing instruction, an accepted or declined
-- memory -- so every such statement either died in a client or lived in a second,
-- in-memory "brain" that Julius never read. These tables are that place, beside
-- Julius's rows and read by the same runtime, so there is still exactly one
-- Project Brain.
--
-- Nothing here is Julius's authority. A record is a statement with an author; a
-- requirement proposed here is a PROPOSAL to the contract, never a term of it.

CREATE TABLE relay_wonderland.project_brain_records(
 record_id text PRIMARY KEY CHECK(record_id ~ '^pbr:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 run_id text REFERENCES relay_wonderland.julius_runs,
 scope text NOT NULL CHECK(scope IN('PROJECT','MISSION')),
 domain text NOT NULL CHECK(domain IN('USER_FACT','PREFERENCE','IDENTITY','INSTRUCTION','WORKFLOW','SCRATCHPAD','SHARED_CONTEXT','OBJECTIVE_NOTE','REQUIREMENT','CONSTRAINT','ACCEPTANCE_CRITERION','ARCHITECTURE_NOTE','DECISION','RESEARCH_NOTE','MISSION_INPUT','MEMORY_REVIEW','FINDING_RESPONSE','GOVERNANCE_ACK','COMPANION_RESULT')),
 status text NOT NULL CHECK(status IN('PROPOSED','ACTIVE','ADOPTED','ACCEPTED','DECLINED','RESOLVED','ACKNOWLEDGED','WITHDRAWN','SUPERSEDED')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 body text NOT NULL CHECK(length(body)<=4000),
 subject_ref text CHECK(subject_ref IS NULL OR length(subject_ref) BETWEEN 1 AND 300),
 version bigint NOT NULL CHECK(version>0),
 content_hash text NOT NULL CHECK(length(content_hash)=64),
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 last_mutation_id text NOT NULL,
 CHECK((scope='MISSION')=(run_id IS NOT NULL))
);
CREATE INDEX project_brain_records_project ON relay_wonderland.project_brain_records(project_id,domain,status,updated_at);
CREATE INDEX project_brain_records_run ON relay_wonderland.project_brain_records(run_id) WHERE run_id IS NOT NULL;

-- ONE ROW PER ACCEPTED MUTATION, with the answer it was given, so a retried
-- request is answered from here and never applied twice. Mutations of one
-- project are serialised by a transaction-scoped advisory lock; the unique key
-- is the backstop if anything ever writes without it.
CREATE TABLE relay_wonderland.project_brain_mutations(
 mutation_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 operation text NOT NULL CHECK(operation IN('CREATE','REVISE','SET_STATUS','LINK')),
 record_id text,
 resulting_version bigint CHECK(resulting_version IS NULL OR resulting_version>0),
 run_id text REFERENCES relay_wonderland.julius_runs,
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 event_id text NOT NULL,
 result jsonb NOT NULL,
 occurred_at timestamptz NOT NULL,
 UNIQUE(project_id,idempotency_key)
);
CREATE INDEX project_brain_mutations_record ON relay_wonderland.project_brain_mutations(record_id,occurred_at);

-- EVERY VERSION A RECORD EVER HAD, exactly as it was. The record row is the
-- current version; this is its history, and it is never rewritten.
CREATE TABLE relay_wonderland.project_brain_record_versions(
 record_id text NOT NULL REFERENCES relay_wonderland.project_brain_records,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 version bigint NOT NULL CHECK(version>0),
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations,
 status text NOT NULL,
 title text NOT NULL,
 body text NOT NULL,
 subject_ref text,
 content_hash text NOT NULL CHECK(length(content_hash)=64),
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(record_id,version)
);

-- TYPED RELATIONSHIPS between any two Project Brain references -- a record, a
-- Julius finding, a criterion, a piece of evidence, a mission. Both ends are
-- references, never copies.
CREATE TABLE relay_wonderland.project_brain_links(
 link_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 from_ref text NOT NULL CHECK(length(from_ref) BETWEEN 1 AND 300),
 relation text NOT NULL CHECK(relation IN('SATISFIES','REFINES','RESPONDS_TO','SUPPORTS','CONTRADICTS','SUPERSEDES','DERIVED_FROM','CONCERNS','ACKNOWLEDGES','REVIEWS')),
 to_ref text NOT NULL CHECK(length(to_ref) BETWEEN 1 AND 300),
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations,
 created_at timestamptz NOT NULL,
 UNIQUE(project_id,from_ref,relation,to_ref),
 CHECK(from_ref<>to_ref)
);
CREATE INDEX project_brain_links_to ON relay_wonderland.project_brain_links(project_id,to_ref);

-- APPEND-ONLY HISTORY. The mutation log, the version history and the links are
-- facts about what was said; correcting one is a new mutation, never an edit.
CREATE FUNCTION relay_wonderland.project_brain_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project_brain_immutable: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER project_brain_mutations_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_mutations FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();
CREATE TRIGGER project_brain_versions_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_record_versions FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();
CREATE TRIGGER project_brain_links_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_links FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();

-- THE CURRENT ROW MAY ONLY MOVE FORWARD, ONE VERSION AT A TIME, and never
-- change whose record it is. Enforced here as well as in the store, because the
-- store is not the only thing that will ever hold a connection.
CREATE FUNCTION relay_wonderland.project_brain_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project_brain_immutable: DELETE on project_brain_records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'project_brain_version_skip: % -> %', OLD.version, NEW.version USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.record_id <> OLD.record_id OR NEW.domain <> OLD.domain
     OR NEW.scope <> OLD.scope OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.author_kind <> OLD.author_kind OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'project_brain_identity_change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_brain_records_guard BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_records FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_record_guard();

-- LIVE UPDATES WITHOUT POLLING. Every durable Julius or Project Brain event
-- wakes the bridges listening for its project. pg_notify is transactional: the
-- wake-up is delivered only when the row it announces has COMMITTED, so a
-- listener can never be told about a record that does not exist. The payload is
-- the project id and nothing else; listeners re-read the durable log.
CREATE FUNCTION relay_wonderland.project_brain_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('relay_project_brain', NEW.project_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER project_brain_event_notify AFTER INSERT ON relay_wonderland.events FOR EACH ROW
 WHEN (NEW.visibility = 'PROJECT' AND (NEW.event_type LIKE 'julius.%' OR NEW.event_type LIKE 'project_brain.%'))
 EXECUTE FUNCTION relay_wonderland.project_brain_notify();

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('029_julius_project_brain');
COMMIT;
