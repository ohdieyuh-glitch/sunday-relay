BEGIN;
-- THE TASK/SPRINT CONTRACT — what a worker was charged with, agreed before it
-- started and identical for the worker and its reviewer.
--
-- WHY A TABLE RATHER THAN A BRAIN ENTRY. `julius_brain_entries` is prose
-- compiled into a context packet; it has no revision-per-subject, no lock, and
-- no way to refuse a second one. The two invariants that make a contract worth
-- having are exactly the ones only a table can hold:
--
--   * a REVISION IS IMMUTABLE — inserted, never updated in place, so a party
--     already holding revision N cannot have it changed underneath them;
--   * AT MOST ONE REVISION IS LOCKED — enforced below by a partial unique
--     index, so two workers racing to lock two revisions cannot both succeed
--     and leave the coder and the reviewer holding different agreements.
--
-- ONE CONTRACT PER TASK. `(task_id, contract_revision)` is unique, so a second
-- contract_id for the same task collides at revision 1 rather than quietly
-- coexisting. A task with two contracts has two answers to "what was this
-- charged with", which is the condition this table exists to remove.
--
-- THE TERMS ARE A DOCUMENT, and `binding_digest` is a hash of them computed by
-- `julius-task-contract.ts`. The repository re-derives that digest on read and
-- refuses a row that disagrees, so this column is a checkable claim rather than
-- a label: an edit made outside that code, or a value a storage layer
-- normalised, is caught instead of being handed to a caller as current.
--
-- `safe_terms` says what it holds. The document is worker-authored prose and is
-- persisted verbatim, exactly as `julius_brain_entries.safe_content` is; the
-- caller owns its safety, because redaction the store performed would be
-- redaction nobody could audit.
CREATE TABLE relay_wonderland.julius_task_contracts(
 contract_id text NOT NULL,
 contract_revision integer NOT NULL CHECK(contract_revision>0),
 run_id text NOT NULL REFERENCES relay_wonderland.julius_runs ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 task_id text NOT NULL REFERENCES relay_wonderland.julius_tasks,
 mission_contract_revision integer NOT NULL CHECK(mission_contract_revision>0),
 state text NOT NULL CHECK(state IN('DRAFT','CHALLENGED','LOCKED','SUPERSEDED')),
 safe_terms jsonb NOT NULL,
 binding_digest text,
 locked_at timestamptz,
 locked_by_evaluator_id text,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(contract_id,contract_revision),
 -- A LOCKED OR SUPERSEDED ROW CARRIES ITS BINDING; AN UNLOCKED ONE MUST NOT.
 -- Superseding keeps the digest deliberately: work was dispatched under those
 -- terms and the record has to keep explaining what it was. A draft carrying a
 -- digest is the dangerous direction — a downstream dispatch could cite a
 -- binding no evaluator ever accepted — so the database refuses it.
 CONSTRAINT julius_task_contract_binding CHECK(
   (state IN('DRAFT','CHALLENGED') AND binding_digest IS NULL AND locked_at IS NULL AND locked_by_evaluator_id IS NULL)
   OR
   (state IN('LOCKED','SUPERSEDED') AND binding_digest IS NOT NULL AND locked_at IS NOT NULL AND locked_by_evaluator_id IS NOT NULL)
 )
);
-- THE LOCK IS A DATABASE INVARIANT, not an application check. Two ticks that
-- both read "nothing locked yet" and both write would otherwise both succeed.
CREATE UNIQUE INDEX julius_task_contract_single_lock ON relay_wonderland.julius_task_contracts(contract_id) WHERE state='LOCKED';
-- ONE CONTRACT PER TASK, by making a second contract_id collide at revision 1.
CREATE UNIQUE INDEX julius_task_contract_one_per_task ON relay_wonderland.julius_task_contracts(task_id,contract_revision);
CREATE INDEX julius_task_contract_by_run ON relay_wonderland.julius_task_contracts(run_id,contract_revision);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('023_julius_task_contracts');
COMMIT;
