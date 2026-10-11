BEGIN;
-- THREE PROJECT BRAIN COMPONENTS THAT HAD NO DURABLE HOME: C.A.R.D., MISSION HANDOFF AND EVALS.
--
-- C.A.R.D. (the fifth Project Brain component) lived in a browser's localStorage
-- and in Wonderland's Cards.sav; a Julius run pinned a card_revision string that
-- nothing durable defined. MISSION HANDOFF is a presentation transition of a
-- running mission and had no durable state at all. An EVAL had no identity: no
-- subject revision, no evidence, no supersession, so nothing stopped an old PASS
-- from qualifying changed code. Each is a typed, versioned object here, written
-- through the same mutation log as 029's records (one idempotency namespace per
-- project, one advisory lock, one event stream), and none of them writes a
-- single row of Julius's own.
--
-- The database holds the invariants as well as the store, because the store is
-- not the only thing that will ever hold a connection: versions move forward one
-- at a time, identity never changes, history is append-only, a deletion is a
-- final version and never an erased row, and a row that names a run names a run
-- of its own project.

-- EXPLICIT APPLY, GATED AS 030 TO 033 ARE (docs/julius-migrations/034/RUNBOOK.md). Applied to a persistent store only
-- after 033, by its own explicit reviewed apply; migrate() reaches it in array order after 033.
-- THE GUARD: STOP, changing nothing, unless 033 is applied and is the ledger's last stamp, 034 is not applied, and NONE of
-- the names 034 creates is taken in relay_wonderland: its 21 relations (9 tables and 12 indexes, the 9 primary keys
-- PostgreSQL names itself included), its 3 functions, its 25 triggers (4 of them on 029's tables) and the 69 constraint
-- names on its tables (60 of them chosen by PostgreSQL). A taken IMPLICIT name is NOT an error to PostgreSQL, which would
-- quietly create project_brain_cards_pkey1 or project_brain_evals_check2, so only this guard refuses it. Without it, a
-- psql apply on a store at 032 SUCCEEDS, and 033's guard then refuses forever (the ledger's last stamp would be 034).
-- The lists are the ones docs/julius-migrations/034/precheck.sql, postcheck.sql and down.sql carry, entry for entry.
-- 034 ALTERs 029's project_brain_mutations and puts a trigger on 4 of 029's tables, so it is applied by the role that
-- owns them (RUNBOOK.md, step 2 records it); its own objects are then owned by that role too.
DO $$
DECLARE
  present text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_034_refused: 033 is not applied here; 034 comes after it on the chain (founder ruling 2026-10-04 16:30Z)';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_project_brain_components') THEN
    RAISE EXCEPTION 'migration_034_refused: 034 is already applied here';
  END IF;
  IF (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) <> '033_wonderland_social' THEN
    RAISE EXCEPTION 'migration_034_refused: the ledger''s last stamp is %, not 033; 034 follows 033 directly, so nothing later may be applied before it (the ledger would show a gap)',
      (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations);
  END IF;
  WITH e_rel(name, kind, on_table, flag) AS (VALUES
      ('project_brain_cards', 'r', NULL, '-'),
      ('project_brain_card_versions', 'r', NULL, '-'),
      ('project_brain_card_selection', 'r', NULL, '-'),
      ('project_brain_mission_cards', 'r', NULL, '-'),
      ('project_brain_handoffs', 'r', NULL, '-'),
      ('project_brain_handoff_versions', 'r', NULL, '-'),
      ('project_brain_evals', 'r', NULL, '-'),
      ('project_brain_eval_versions', 'r', NULL, '-'),
      ('project_brain_member_versions', 'r', NULL, '-'),
      ('project_brain_cards_pkey', 'i', 'project_brain_cards', 'p'),
      ('project_brain_cards_project', 'i', 'project_brain_cards', '-'),
      ('project_brain_card_versions_pkey', 'i', 'project_brain_card_versions', 'p'),
      ('project_brain_card_selection_pkey', 'i', 'project_brain_card_selection', 'p'),
      ('project_brain_mission_cards_pkey', 'i', 'project_brain_mission_cards', 'p'),
      ('project_brain_handoffs_pkey', 'i', 'project_brain_handoffs', 'p'),
      ('project_brain_handoff_versions_pkey', 'i', 'project_brain_handoff_versions', 'p'),
      ('project_brain_evals_pkey', 'i', 'project_brain_evals', 'p'),
      ('project_brain_evals_one_current', 'i', 'project_brain_evals', 'u'),
      ('project_brain_evals_subject', 'i', 'project_brain_evals', '-'),
      ('project_brain_eval_versions_pkey', 'i', 'project_brain_eval_versions', 'p'),
      ('project_brain_member_versions_pkey', 'i', 'project_brain_member_versions', 'p')
  ),
  e_fn(name) AS (VALUES
      ('project_brain_component_guard'),
      ('project_brain_run_in_project'),
      ('project_brain_truncate_refused')
  ),
  e_tg(name, on_table, fn, tgtype) AS (VALUES
      ('project_brain_card_versions_immutable', 'project_brain_card_versions', 'project_brain_refuse_change', 27),
      ('project_brain_mission_cards_immutable', 'project_brain_mission_cards', 'project_brain_refuse_change', 27),
      ('project_brain_handoff_versions_immutable', 'project_brain_handoff_versions', 'project_brain_refuse_change', 27),
      ('project_brain_eval_versions_immutable', 'project_brain_eval_versions', 'project_brain_refuse_change', 27),
      ('project_brain_cards_guard', 'project_brain_cards', 'project_brain_component_guard', 27),
      ('project_brain_card_selection_guard', 'project_brain_card_selection', 'project_brain_component_guard', 27),
      ('project_brain_handoffs_guard', 'project_brain_handoffs', 'project_brain_component_guard', 27),
      ('project_brain_evals_guard', 'project_brain_evals', 'project_brain_component_guard', 27),
      ('project_brain_mission_cards_project', 'project_brain_mission_cards', 'project_brain_run_in_project', 7),
      ('project_brain_handoffs_project', 'project_brain_handoffs', 'project_brain_run_in_project', 7),
      ('project_brain_evals_project', 'project_brain_evals', 'project_brain_run_in_project', 7),
      ('project_brain_member_versions_immutable', 'project_brain_member_versions', 'project_brain_refuse_change', 27),
      ('project_brain_records_truncate_refused', 'project_brain_records', 'project_brain_truncate_refused', 34),
      ('project_brain_mutations_truncate_refused', 'project_brain_mutations', 'project_brain_truncate_refused', 34),
      ('project_brain_record_versions_truncate_refused', 'project_brain_record_versions', 'project_brain_truncate_refused', 34),
      ('project_brain_links_truncate_refused', 'project_brain_links', 'project_brain_truncate_refused', 34),
      ('project_brain_cards_truncate_refused', 'project_brain_cards', 'project_brain_truncate_refused', 34),
      ('project_brain_card_versions_truncate_refused', 'project_brain_card_versions', 'project_brain_truncate_refused', 34),
      ('project_brain_card_selection_truncate_refused', 'project_brain_card_selection', 'project_brain_truncate_refused', 34),
      ('project_brain_mission_cards_truncate_refused', 'project_brain_mission_cards', 'project_brain_truncate_refused', 34),
      ('project_brain_handoffs_truncate_refused', 'project_brain_handoffs', 'project_brain_truncate_refused', 34),
      ('project_brain_handoff_versions_truncate_refused', 'project_brain_handoff_versions', 'project_brain_truncate_refused', 34),
      ('project_brain_evals_truncate_refused', 'project_brain_evals', 'project_brain_truncate_refused', 34),
      ('project_brain_eval_versions_truncate_refused', 'project_brain_eval_versions', 'project_brain_truncate_refused', 34),
      ('project_brain_member_versions_truncate_refused', 'project_brain_member_versions', 'project_brain_truncate_refused', 34)
  ),
  e_con(name, on_table, contype, references_table, deferral) AS (VALUES
      ('project_brain_cards_pkey', 'project_brain_cards', 'p', NULL, '-'),
      ('project_brain_cards_card_id_check', 'project_brain_cards', 'c', NULL, '-'),
      ('project_brain_cards_project_id_fkey', 'project_brain_cards', 'f', 'projects', '-'),
      ('project_brain_cards_state_check', 'project_brain_cards', 'c', NULL, '-'),
      ('project_brain_cards_name_check', 'project_brain_cards', 'c', NULL, '-'),
      ('project_brain_cards_content_check', 'project_brain_cards', 'c', NULL, '-'),
      ('project_brain_cards_content_hash_check', 'project_brain_cards', 'c', NULL, '-'),
      ('project_brain_cards_version_check', 'project_brain_cards', 'c', NULL, '-'),
      ('project_brain_cards_last_mutation_id_fkey', 'project_brain_cards', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_card_versions_pkey', 'project_brain_card_versions', 'p', NULL, '-'),
      ('project_brain_card_versions_card_id_fkey', 'project_brain_card_versions', 'f', 'project_brain_cards', '-'),
      ('project_brain_card_versions_project_id_fkey', 'project_brain_card_versions', 'f', 'projects', '-'),
      ('project_brain_card_versions_version_check', 'project_brain_card_versions', 'c', NULL, '-'),
      ('project_brain_card_versions_mutation_id_fkey', 'project_brain_card_versions', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_card_versions_state_check', 'project_brain_card_versions', 'c', NULL, '-'),
      ('project_brain_card_versions_content_hash_check', 'project_brain_card_versions', 'c', NULL, '-'),
      ('project_brain_card_selection_pkey', 'project_brain_card_selection', 'p', NULL, '-'),
      ('project_brain_card_selection_project_id_fkey', 'project_brain_card_selection', 'f', 'projects', '-'),
      ('project_brain_card_selection_card_ref_check', 'project_brain_card_selection', 'c', NULL, '-'),
      ('project_brain_card_selection_version_check', 'project_brain_card_selection', 'c', NULL, '-'),
      ('project_brain_card_selection_last_mutation_id_fkey', 'project_brain_card_selection', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_mission_cards_pkey', 'project_brain_mission_cards', 'p', NULL, '-'),
      ('project_brain_mission_cards_run_id_fkey', 'project_brain_mission_cards', 'f', 'julius_runs', '-'),
      ('project_brain_mission_cards_project_id_fkey', 'project_brain_mission_cards', 'f', 'projects', '-'),
      ('project_brain_mission_cards_card_ref_check', 'project_brain_mission_cards', 'c', NULL, '-'),
      ('project_brain_mission_cards_card_version_check', 'project_brain_mission_cards', 'c', NULL, '-'),
      ('project_brain_mission_cards_content_hash_check', 'project_brain_mission_cards', 'c', NULL, '-'),
      ('project_brain_mission_cards_mutation_id_fkey', 'project_brain_mission_cards', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_handoffs_pkey', 'project_brain_handoffs', 'p', NULL, '-'),
      ('project_brain_handoffs_run_id_fkey', 'project_brain_handoffs', 'f', 'julius_runs', '-'),
      ('project_brain_handoffs_project_id_fkey', 'project_brain_handoffs', 'f', 'projects', '-'),
      ('project_brain_handoffs_state_check', 'project_brain_handoffs', 'c', NULL, '-'),
      ('project_brain_handoffs_form_check', 'project_brain_handoffs', 'c', NULL, '-'),
      ('project_brain_handoffs_version_check', 'project_brain_handoffs', 'c', NULL, '-'),
      ('project_brain_handoffs_last_mutation_id_fkey', 'project_brain_handoffs', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_handoff_versions_pkey', 'project_brain_handoff_versions', 'p', NULL, '-'),
      ('project_brain_handoff_versions_run_id_fkey', 'project_brain_handoff_versions', 'f', 'project_brain_handoffs', '-'),
      ('project_brain_handoff_versions_project_id_fkey', 'project_brain_handoff_versions', 'f', 'projects', '-'),
      ('project_brain_handoff_versions_version_check', 'project_brain_handoff_versions', 'c', NULL, '-'),
      ('project_brain_handoff_versions_mutation_id_fkey', 'project_brain_handoff_versions', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_handoff_versions_state_check', 'project_brain_handoff_versions', 'c', NULL, '-'),
      ('project_brain_evals_pkey', 'project_brain_evals', 'p', NULL, '-'),
      ('project_brain_evals_eval_id_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_project_id_fkey', 'project_brain_evals', 'f', 'projects', '-'),
      ('project_brain_evals_run_id_fkey', 'project_brain_evals', 'f', 'julius_runs', '-'),
      ('project_brain_evals_subject_ref_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_subject_revision_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_criterion_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_result_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_evidence_refs_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_status_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_superseded_by_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_version_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_last_mutation_id_fkey', 'project_brain_evals', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_evals_check', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_evals_check1', 'project_brain_evals', 'c', NULL, '-'),
      ('project_brain_eval_versions_pkey', 'project_brain_eval_versions', 'p', NULL, '-'),
      ('project_brain_eval_versions_eval_id_fkey', 'project_brain_eval_versions', 'f', 'project_brain_evals', '-'),
      ('project_brain_eval_versions_project_id_fkey', 'project_brain_eval_versions', 'f', 'projects', '-'),
      ('project_brain_eval_versions_version_check', 'project_brain_eval_versions', 'c', NULL, '-'),
      ('project_brain_eval_versions_mutation_id_fkey', 'project_brain_eval_versions', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_eval_versions_status_check', 'project_brain_eval_versions', 'c', NULL, '-'),
      ('project_brain_member_versions_pkey', 'project_brain_member_versions', 'p', NULL, '-'),
      ('project_brain_member_versions_project_id_fkey', 'project_brain_member_versions', 'f', 'projects', '-'),
      ('project_brain_member_versions_player_id_check', 'project_brain_member_versions', 'c', NULL, '-'),
      ('project_brain_member_versions_version_check', 'project_brain_member_versions', 'c', NULL, '-'),
      ('project_brain_member_versions_role_check', 'project_brain_member_versions', 'c', NULL, '-'),
      ('project_brain_member_versions_mutation_id_fkey', 'project_brain_member_versions', 'f', 'project_brain_mutations', 'd'),
      ('project_brain_member_versions_check', 'project_brain_member_versions', 'c', NULL, '-')
  )
  SELECT string_agg(o.name, ', ' ORDER BY o.name COLLATE "C") INTO present
    FROM (
      SELECT c.relname::text AS name FROM pg_class c
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel)
      UNION
      SELECT p.proname::text FROM pg_proc p
       WHERE p.pronamespace = 'relay_wonderland'::regnamespace AND p.proname::text IN (SELECT name FROM e_fn)
      UNION
      SELECT t.tgname::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal AND t.tgname::text IN (SELECT name FROM e_tg)
      UNION
      SELECT k.conname::text FROM pg_constraint k
       WHERE k.connamespace = 'relay_wonderland'::regnamespace AND k.conname::text IN (SELECT name FROM e_con)
    ) AS o;
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'migration_034_refused: name(s) 034 creates are already taken in relay_wonderland (%); 034 creates all of them or nothing', present;
  END IF;
  RAISE NOTICE 'migration_034_precheck: 033 applied and the ledger''s last, 034 not; none of its 21 relations, 3 functions, 25 triggers or 69 constraint names is taken; project_brain_mutations %; ledger %',
    (SELECT count(*) FROM relay_wonderland.project_brain_mutations), (SELECT count(*) FROM relay_wonderland.schema_migrations);
END
$$;

-- 1. THE ONE MUTATION LOG LEARNS THE COMPONENT OPERATIONS. Every component row names
-- the mutation that wrote it. That row is written LAST in its transaction (its answer
-- is what was applied, and the log is never updated), so those references are checked
-- at the end of the transaction: DEFERRABLE INITIALLY DEFERRED. The store forces the
-- check before COMMIT (SET CONSTRAINTS ALL IMMEDIATE), so a violation is reported as
-- nothing saved, never as an unknown commit.
ALTER TABLE relay_wonderland.project_brain_mutations DROP CONSTRAINT project_brain_mutations_operation_check;
ALTER TABLE relay_wonderland.project_brain_mutations ADD CONSTRAINT project_brain_mutations_operation_check CHECK(operation IN(
 'CREATE','REVISE','SET_STATUS','LINK',
 'CARD_CREATE','CARD_UPDATE','CARD_DELETE','CARD_SELECT','MISSION_PIN_CARD',
 'HANDOFF_ENTER','HANDOFF_EXIT',
 'EVAL_RECORD','EVAL_INVALIDATE',
 'MEMBER_SET','MEMBER_REMOVE'));

-- 2. C.A.R.D. A card references providers and capabilities by id; the store
-- refuses any credential before it reaches this table.
CREATE TABLE relay_wonderland.project_brain_cards(
 card_id text PRIMARY KEY CHECK(card_id ~ '^pbcard:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 state text NOT NULL CHECK(state IN('LIVE','DELETED')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 version bigint NOT NULL CHECK(version>0),
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 last_mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX project_brain_cards_project ON relay_wonderland.project_brain_cards(project_id,state,updated_at);

CREATE TABLE relay_wonderland.project_brain_card_versions(
 card_id text NOT NULL REFERENCES relay_wonderland.project_brain_cards,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 version bigint NOT NULL CHECK(version>0),
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED,
 state text NOT NULL CHECK(state IN('LIVE','DELETED')),
 name text NOT NULL,
 content jsonb NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(card_id,version)
);

-- THE NEXT MISSION'S DEFAULT. One row per project; no row = the built-in default.
CREATE TABLE relay_wonderland.project_brain_card_selection(
 project_id text PRIMARY KEY REFERENCES relay_wonderland.projects,
 card_ref text NOT NULL CHECK(card_ref='pbcard:default' OR card_ref ~ '^pbcard:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 version bigint NOT NULL CHECK(version>0),
 updated_at timestamptz NOT NULL,
 last_mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED
);

-- THE CARD VERSION A MISSION STARTED UNDER. Written once, never moved: switching
-- cards mid-mission cannot rewrite a running mission's envelope.
CREATE TABLE relay_wonderland.project_brain_mission_cards(
 run_id text PRIMARY KEY REFERENCES relay_wonderland.julius_runs,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 card_ref text NOT NULL CHECK(card_ref='pbcard:default' OR card_ref ~ '^pbcard:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 card_version bigint NOT NULL CHECK(card_version>0),
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED,
 pinned_at timestamptz NOT NULL
);

-- 3. MISSION HANDOFF: a presentation state BESIDE the run, never a change to it.
CREATE TABLE relay_wonderland.project_brain_handoffs(
 run_id text PRIMARY KEY REFERENCES relay_wonderland.julius_runs,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 state text NOT NULL CHECK(state IN('HANDED_OFF','RETURNED')),
 form text NOT NULL CHECK(form ~ '^[A-Za-z0-9._-]{1,64}$'),
 version bigint NOT NULL CHECK(version>0),
 updated_at timestamptz NOT NULL,
 last_mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE relay_wonderland.project_brain_handoff_versions(
 run_id text NOT NULL REFERENCES relay_wonderland.project_brain_handoffs,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 version bigint NOT NULL CHECK(version>0),
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED,
 state text NOT NULL CHECK(state IN('HANDED_OFF','RETURNED')),
 form text NOT NULL,
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(run_id,version)
);

-- 4. EVALS: one subject at one exact revision against one criterion. A PASS
-- cites evidence. At most one CURRENT eval per subject and criterion: the next
-- one supersedes it in the same transaction.
CREATE TABLE relay_wonderland.project_brain_evals(
 eval_id text PRIMARY KEY CHECK(eval_id ~ '^pbeval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 run_id text REFERENCES relay_wonderland.julius_runs,
 subject_ref text NOT NULL CHECK(length(subject_ref) BETWEEN 1 AND 300),
 subject_revision text NOT NULL CHECK(subject_revision ~ '^[A-Za-z0-9._:@/+-]{1,128}$'),
 criterion text NOT NULL CHECK(length(criterion) BETWEEN 1 AND 200),
 result text NOT NULL CHECK(result IN('PASS','FAIL','INCONCLUSIVE')),
 evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='array'),
 status text NOT NULL CHECK(status IN('CURRENT','SUPERSEDED','INVALIDATED')),
 superseded_by text CHECK(superseded_by IS NULL OR superseded_by ~ '^pbeval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 version bigint NOT NULL CHECK(version>0),
 evaluator_kind text NOT NULL,
 evaluator_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 recorded_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 last_mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED,
 CHECK(result<>'PASS' OR jsonb_array_length(evidence_refs)>0),
 CHECK((status='SUPERSEDED')=(superseded_by IS NOT NULL))
);
CREATE UNIQUE INDEX project_brain_evals_one_current ON relay_wonderland.project_brain_evals(project_id,subject_ref,criterion) WHERE status='CURRENT';
CREATE INDEX project_brain_evals_subject ON relay_wonderland.project_brain_evals(project_id,subject_ref,subject_revision);

CREATE TABLE relay_wonderland.project_brain_eval_versions(
 eval_id text NOT NULL REFERENCES relay_wonderland.project_brain_evals,
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 version bigint NOT NULL CHECK(version>0),
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED,
 status text NOT NULL CHECK(status IN('CURRENT','SUPERSEDED','INVALIDATED')),
 superseded_by text,
 author_kind text NOT NULL,
 author_id text NOT NULL,
 deliverer_kind text NOT NULL,
 deliverer_id text NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(eval_id,version)
);

-- 5. APPEND-ONLY HISTORY: versions and pins are facts about what happened.
CREATE TRIGGER project_brain_card_versions_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_card_versions FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();
CREATE TRIGGER project_brain_mission_cards_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_mission_cards FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();
CREATE TRIGGER project_brain_handoff_versions_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_handoff_versions FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();
CREATE TRIGGER project_brain_eval_versions_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_eval_versions FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();

-- 6. THE CURRENT ROWS MOVE FORWARD ONLY, AND NEVER CHANGE WHOSE THEY ARE.
CREATE FUNCTION relay_wonderland.project_brain_component_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project_brain_immutable: DELETE on %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'project_brain_version_skip: % -> % on %', OLD.version, NEW.version, TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'project_brain_identity_change on %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'project_brain_cards' THEN
    IF NEW.card_id <> OLD.card_id OR NEW.author_kind <> OLD.author_kind OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'project_brain_identity_change on project_brain_cards' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state = 'DELETED' THEN
      RAISE EXCEPTION 'project_brain_card_deleted: a deleted card does not change' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'project_brain_handoffs' THEN
    IF NEW.run_id <> OLD.run_id THEN
      RAISE EXCEPTION 'project_brain_identity_change on project_brain_handoffs' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'project_brain_evals' THEN
    IF NEW.eval_id <> OLD.eval_id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.subject_ref <> OLD.subject_ref
       OR NEW.subject_revision <> OLD.subject_revision OR NEW.criterion <> OLD.criterion OR NEW.result <> OLD.result
       OR NEW.evidence_refs <> OLD.evidence_refs OR NEW.evaluator_kind <> OLD.evaluator_kind OR NEW.evaluator_id <> OLD.evaluator_id
       OR NEW.recorded_at <> OLD.recorded_at THEN
      RAISE EXCEPTION 'project_brain_eval_rewrite: an eval''s judgement never changes; record a new one' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'CURRENT' OR NEW.status = 'CURRENT' THEN
      RAISE EXCEPTION 'project_brain_eval_status: % -> % is not a move', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_brain_cards_guard BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_cards FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_component_guard();
CREATE TRIGGER project_brain_card_selection_guard BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_card_selection FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_component_guard();
CREATE TRIGGER project_brain_handoffs_guard BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_handoffs FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_component_guard();
CREATE TRIGGER project_brain_evals_guard BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_evals FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_component_guard();

-- 7. A ROW THAT NAMES A RUN NAMES A RUN OF ITS OWN PROJECT. A guessed run id
-- from another project can never carry a pin, a handoff or an eval across.
CREATE FUNCTION relay_wonderland.project_brain_run_in_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM relay_wonderland.julius_runs r WHERE r.run_id = NEW.run_id AND r.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'project_brain_cross_project: run % is not in project %', NEW.run_id, NEW.project_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_brain_mission_cards_project BEFORE INSERT ON relay_wonderland.project_brain_mission_cards FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_run_in_project();
CREATE TRIGGER project_brain_handoffs_project BEFORE INSERT ON relay_wonderland.project_brain_handoffs FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_run_in_project();
CREATE TRIGGER project_brain_evals_project BEFORE INSERT ON relay_wonderland.project_brain_evals FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_run_in_project();

-- 8. MEMBERSHIP: WHO MAY USE THIS PROJECT'S BRAIN (project-brain-members.ts; founder decisions 4 and 5, 2026-09-27).
-- project_members (001) stays THE membership record: every reader in the product already reads it. A change to it is
-- written through the mutation log above, and recorded here as an append-only version naming that mutation, who made
-- it and what the role was before: the audit a multiplayer project needs. role NULL = removed. OWNER is never written
-- here; it belongs to the mission seed and is permanent.
CREATE TABLE relay_wonderland.project_brain_member_versions(
 project_id text NOT NULL REFERENCES relay_wonderland.projects,
 player_id text NOT NULL CHECK(length(player_id) BETWEEN 1 AND 128),
 version bigint NOT NULL CHECK(version>0),
 role text CHECK(role IS NULL OR role IN('ADMIN','MEMBER')),
 previous_role text,
 mutation_id text NOT NULL REFERENCES relay_wonderland.project_brain_mutations DEFERRABLE INITIALLY DEFERRED,
 changed_by_kind text NOT NULL,
 changed_by_id text NOT NULL,
 changed_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,player_id,version),
 CHECK(role IS DISTINCT FROM previous_role)
);
CREATE TRIGGER project_brain_member_versions_immutable BEFORE UPDATE OR DELETE ON relay_wonderland.project_brain_member_versions FOR EACH ROW EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change();

-- 9. NO TRUNCATE REWRITES THE BRAIN. Every guard above is a ROW trigger, and row triggers never see a TRUNCATE: one
-- statement (with CASCADE, one statement for the whole Brain through the mutation log) would empty the history the
-- triggers refuse to edit row by row. 030 refuses it for the event ledger for the same reason. Every Brain table, 029's
-- and this migration's, refuses it here; a TRUNCATE ... CASCADE fires these for every table it would reach, before any
-- is emptied. Nothing in the product truncates the Brain: a fresh database is a new database.
CREATE FUNCTION relay_wonderland.project_brain_truncate_refused() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project_brain_truncate_refused: % is Project Brain history; a TRUNCATE would rewrite it', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER project_brain_records_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_records FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_mutations_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_mutations FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_record_versions_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_record_versions FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_links_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_links FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_cards_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_cards FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_card_versions_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_card_versions FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_card_selection_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_card_selection FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_mission_cards_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_mission_cards FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_handoffs_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_handoffs FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_handoff_versions_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_handoff_versions FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_evals_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_evals FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_eval_versions_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_eval_versions FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();
CREATE TRIGGER project_brain_member_versions_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_member_versions FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused();

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_project_brain_components');
COMMIT;
