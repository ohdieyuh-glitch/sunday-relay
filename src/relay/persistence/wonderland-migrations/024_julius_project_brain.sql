BEGIN;
-- PROJECT BRAIN v2: THE LEDGER AND ITS MATERIALISED STATE.
--
-- julius_brain_records is the authority: immutable, gap-free per Brain, hash
-- chained. julius_brain_entities is current state, written in the same
-- transaction as the records that changed it, by exactly the rows the domain
-- planner produced, so a rebuild from the ledger reproduces it byte for byte.
-- julius_brain_links keeps every edge that ever existed, for provenance.
--
-- NOTHING CASCADES. v1 entries are deleted with their run; v2 memory outlives
-- runs and missions by design, so no foreign key here deletes a record when
-- something it mentions goes away. A project that still owns a Brain cannot be
-- deleted at all.
--
-- The exact record lives in `record` (jsonb). The typed columns beside it are
-- indexes and constraints over that document, never a second source of truth.
CREATE TABLE relay_wonderland.julius_brains(
 brain_id text PRIMARY KEY,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 512),
 schema_version text NOT NULL,
 created_by jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 identity jsonb NOT NULL,
 head_sequence bigint NOT NULL DEFAULT 0 CHECK(head_sequence>=0),
 head_chain_hash text NOT NULL CHECK(head_chain_hash ~ '^sha256:[0-9a-f]{64}$'),
 UNIQUE(brain_id,project_id)
);
CREATE INDEX julius_brains_by_project ON relay_wonderland.julius_brains(project_id,brain_id);
CREATE TABLE relay_wonderland.julius_brain_records(
 brain_id text NOT NULL,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
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
 FOREIGN KEY(brain_id,project_id) REFERENCES relay_wonderland.julius_brains(brain_id,project_id),
 CHECK((principal_kind IN('TOOL','ENVIRONMENT'))=(grant_id IS NOT NULL))
);
CREATE INDEX julius_brain_records_entity ON relay_wonderland.julius_brain_records(brain_id,entity_id,sequence);
CREATE INDEX julius_brain_records_kind ON relay_wonderland.julius_brain_records(brain_id,kind,sequence);
CREATE INDEX julius_brain_records_grant ON relay_wonderland.julius_brain_records(brain_id,grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX julius_brain_records_mission ON relay_wonderland.julius_brain_records(brain_id,mission_id,sequence);
CREATE TABLE relay_wonderland.julius_brain_links(
 brain_id text NOT NULL,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 sequence bigint NOT NULL,
 source_entity_id text NOT NULL,
 relation text NOT NULL CHECK(relation IN('SUPERSEDES','CONTRADICTS','SUPPORTS','DERIVED_FROM','RESOLVES','REPAIRS','EVIDENCED_BY','ANSWERS','PRODUCED_BY','RELATES_TO')),
 target_entity_id text NOT NULL,
 target_version bigint CHECK(target_version IS NULL OR target_version>0),
 PRIMARY KEY(brain_id,sequence,relation,target_entity_id),
 FOREIGN KEY(brain_id,sequence) REFERENCES relay_wonderland.julius_brain_records(brain_id,sequence)
);
CREATE INDEX julius_brain_links_target ON relay_wonderland.julius_brain_links(brain_id,target_entity_id,relation,sequence);
CREATE TABLE relay_wonderland.julius_brain_entities(
 brain_id text NOT NULL,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
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
 FOREIGN KEY(brain_id,project_id) REFERENCES relay_wonderland.julius_brains(brain_id,project_id),
 FOREIGN KEY(brain_id,updated_sequence) REFERENCES relay_wonderland.julius_brain_records(brain_id,sequence)
);
CREATE INDEX julius_brain_entities_kind ON relay_wonderland.julius_brain_entities(brain_id,kind,lifecycle,mission_id);
CREATE INDEX julius_brain_entities_task ON relay_wonderland.julius_brain_entities(brain_id,task_id) WHERE task_id IS NOT NULL;
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('024_julius_project_brain');
COMMIT;
