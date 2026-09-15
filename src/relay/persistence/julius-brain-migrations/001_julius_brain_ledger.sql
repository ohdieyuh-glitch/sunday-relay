BEGIN;
-- PROJECT BRAIN v2: ITS OWN DATABASE.
--
-- The Project Brain lives in a dedicated PostgreSQL database, never inside the
-- Julius runtime database (relay_wonderland). The runtime database of a paid
-- run is disposable; the Brain is not. Nothing in this chain references the
-- runtime schema, and `migrateJuliusBrainDatabase` refuses a database that
-- holds it.
--
-- database_identity names the environment the database serves, so a process
-- configured for development cannot open a production Brain by mistake.
--
-- julius_brain.records is the authority: immutable, gap-free per Brain, hash
-- chained. julius_brain.entities is current state, written in the same
-- transaction as the records that changed it, by exactly the rows the domain
-- planner produced, so a rebuild from the ledger reproduces it byte for byte.
-- julius_brain.links keeps every edge that ever existed, for provenance.
--
-- NOTHING CASCADES. Memory outlives runs and missions by design, so no foreign
-- key here deletes a record when something it mentions goes away. A project
-- that still owns a Brain cannot be removed from the registry.
--
-- The exact record lives in `record` (jsonb). The typed columns beside it are
-- indexes and constraints over that document, never a second source of truth.
CREATE SCHEMA julius_brain;
CREATE TABLE julius_brain.schema_migrations(
 version text PRIMARY KEY,
 applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE julius_brain.database_identity(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 database_id text NOT NULL CHECK(length(database_id) BETWEEN 1 AND 128),
 environment text NOT NULL CHECK(environment IN('development','test','production')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE julius_brain.projects(
 project_id text PRIMARY KEY CHECK(length(project_id) BETWEEN 1 AND 256),
 registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE julius_brain.brains(
 brain_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES julius_brain.projects,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 512),
 schema_version text NOT NULL,
 created_by jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 identity jsonb NOT NULL,
 head_sequence bigint NOT NULL DEFAULT 0 CHECK(head_sequence>=0),
 head_chain_hash text NOT NULL CHECK(head_chain_hash ~ '^sha256:[0-9a-f]{64}$'),
 UNIQUE(brain_id,project_id)
);
CREATE INDEX brains_by_project ON julius_brain.brains(project_id,brain_id);
CREATE TABLE julius_brain.records(
 brain_id text NOT NULL,
 project_id text NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 record_id text NOT NULL UNIQUE,
 entity_id text NOT NULL,
 entity_version bigint NOT NULL CHECK(entity_version>0),
 kind text NOT NULL,
 op text NOT NULL CHECK(op IN('CREATE','REVISE','RETIRE')),
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^sha256:[0-9a-f]{64}$'),
 content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[0-9a-f]{64}$'),
 chain_hash text NOT NULL CHECK(chain_hash ~ '^sha256:[0-9a-f]{64}$'),
 principal_kind text NOT NULL CHECK(principal_kind IN('JULIUS','USER','WORKER','TOOL','ENVIRONMENT','SYSTEM')),
 principal_id text NOT NULL,
 grant_id text,
 mission_id text,
 run_id text,
 task_id text,
 record jsonb NOT NULL,
 occurred_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(brain_id,sequence),
 UNIQUE(brain_id,idempotency_key),
 UNIQUE(brain_id,entity_id,entity_version),
 FOREIGN KEY(brain_id,project_id) REFERENCES julius_brain.brains(brain_id,project_id),
 CHECK((principal_kind IN('TOOL','ENVIRONMENT'))=(grant_id IS NOT NULL))
);
CREATE INDEX records_entity ON julius_brain.records(brain_id,entity_id,sequence);
CREATE INDEX records_kind ON julius_brain.records(brain_id,kind,sequence);
CREATE INDEX records_grant ON julius_brain.records(brain_id,grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX records_mission ON julius_brain.records(brain_id,mission_id,sequence);
CREATE TABLE julius_brain.links(
 brain_id text NOT NULL,
 project_id text NOT NULL,
 sequence bigint NOT NULL,
 source_entity_id text NOT NULL,
 relation text NOT NULL CHECK(relation IN('SUPERSEDES','CONTRADICTS','SUPPORTS','DERIVED_FROM','RESOLVES','REPAIRS','EVIDENCED_BY','ANSWERS','PRODUCED_BY','RELATES_TO')),
 target_entity_id text NOT NULL,
 target_version bigint CHECK(target_version IS NULL OR target_version>0),
 PRIMARY KEY(brain_id,sequence,relation,target_entity_id),
 FOREIGN KEY(brain_id,sequence) REFERENCES julius_brain.records(brain_id,sequence)
);
CREATE INDEX links_target ON julius_brain.links(brain_id,target_entity_id,relation,sequence);
CREATE TABLE julius_brain.entities(
 brain_id text NOT NULL,
 project_id text NOT NULL,
 entity_id text NOT NULL,
 kind text NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 lifecycle text NOT NULL CHECK(lifecycle IN('ACTIVE','SUPERSEDED','RETIRED')),
 status text,
 mission_id text,
 task_id text,
 created_sequence bigint NOT NULL,
 updated_sequence bigint NOT NULL,
 state jsonb NOT NULL,
 PRIMARY KEY(brain_id,entity_id),
 FOREIGN KEY(brain_id,project_id) REFERENCES julius_brain.brains(brain_id,project_id),
 FOREIGN KEY(brain_id,updated_sequence) REFERENCES julius_brain.records(brain_id,sequence)
);
CREATE INDEX entities_kind ON julius_brain.entities(brain_id,kind,lifecycle,mission_id);
CREATE INDEX entities_task ON julius_brain.entities(brain_id,task_id) WHERE task_id IS NOT NULL;
INSERT INTO julius_brain.schema_migrations(version) VALUES('001_julius_brain_ledger');
COMMIT;
