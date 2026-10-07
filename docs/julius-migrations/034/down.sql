-- MIGRATION 034: DOWN. Drops everything 034 created -- its 9 tables, and with them their 12 indexes, 69 named constraints
-- (24 foreign keys and the internal RI triggers those keys put on projects, julius_runs and project_brain_mutations) and
-- 21 of its triggers; the 4 TRUNCATE triggers it put on 029's tables; its 3 functions -- restores 029's operation CHECK on
-- project_brain_mutations (CREATE, REVISE, SET_STATUS, LINK) and removes the 034 stamp. (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 034 is applied, nothing
-- after 034 is applied (roll a later migration back first, newest first, so the ledger never shows a gap: 035 included),
-- every relation, trigger and function 034 creates is exactly as 034 created it and no other project_brain_* relation
-- (beyond 029's) exists, and NO Project Brain component data exists: no row in any of 034's tables, and no component or
-- membership operation in the mutation log. That last rule is not caution: project_brain_mutations is append-only (029's
-- trigger) and refuses TRUNCATE (034's), so once ONE component or member operation is logged, 029's narrower CHECK can never
-- be restored over it. After the first component write, the way back is a founder decision (RUNBOOK.md, rollback (c)).
-- The tables are dropped newest first, which is dependency order, and WITHOUT CASCADE: an object outside 034 that
-- depends on one (a view, a later lane's foreign key) makes its DROP fail (2BP01), and the whole script rolls back.
-- Locks: ACCESS EXCLUSIVE on project_brain_mutations (the CHECK, and the RI triggers its 9 deferred references put there),
-- on 029's records, record_versions and links (their TRUNCATE triggers), and on projects and julius_runs (the RI triggers
-- of 034's references), until COMMIT. The writers are stopped.
-- AFTER RUNNING IT the deployed code must no longer list 034, or the next migrate() re-applies it; a PB build then reports
-- componentsInstalled false and refuses component writes (project_brain_components_not_installed).
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  wrong text;
  holding text;
  tbl text;
  cnt bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_project_brain_components') THEN
    RAISE EXCEPTION 'migration_034_down_refused: 034 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '034') THEN
    RAISE EXCEPTION 'migration_034_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '034');
  END IF;
  -- Each relation, trigger and function exactly as 034 created it, and no other project_brain_* relation beyond 029's: the
  -- lists, and the tests, of precheck.sql and postcheck.sql.
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
  SELECT string_agg(w.name, ', ' ORDER BY w.name COLLATE "C") INTO wrong
    FROM (
      SELECT coalesce(r.name, r.relname) AS name
        FROM (
          SELECT e.name, a.relname,
                 coalesce(a.oid IS NOT NULL AND a.relkind = e.kind AND a.relpersistence = 'p'
                   AND (e.kind <> 'i' OR EXISTS (
                         SELECT 1 FROM pg_index i
                          WHERE i.indexrelid = a.oid AND i.indrelid = to_regclass('relay_wonderland.' || e.on_table)
                            AND i.indisprimary = (e.flag = 'p') AND i.indisunique = (e.flag IN ('p', 'u')) AND i.indisvalid)), false) AS as_created
            FROM e_rel AS e
            FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                         FROM pg_class c
                        WHERE c.relnamespace = 'relay_wonderland'::regnamespace
                          AND (c.relname::text IN (SELECT name FROM e_rel) OR (c.relname LIKE 'project\_brain\_%' AND c.relname::text NOT IN (SELECT name FROM e_rel)
                    AND NOT (c.relkind = 'r' AND c.relname::text IN ('project_brain_records', 'project_brain_mutations', 'project_brain_record_versions', 'project_brain_links'))
                    AND NOT (c.relkind = 'i' AND EXISTS (SELECT 1 FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
                                                       WHERE x.indexrelid = c.oid AND t.relnamespace = c.relnamespace
                                                         AND t.relname::text IN ('project_brain_records', 'project_brain_mutations', 'project_brain_record_versions', 'project_brain_links')))))) AS a
              ON a.relname = e.name
        ) AS r
       WHERE NOT r.as_created
      UNION ALL
      SELECT e.name FROM e_tg AS e
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal AND t.tgname::text = e.name AND c.relname::text = e.on_table
            AND p.proname::text = e.fn AND p.pronamespace = 'relay_wonderland'::regnamespace AND t.tgtype::int = e.tgtype)
      UNION ALL
      SELECT e.name FROM e_fn AS e
       WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'relay_wonderland'::regnamespace AND p.proname::text = e.name
                            AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0)
    ) AS w;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_034_down_refused: object(s) not exactly as 034 created them, or not 034''s (%)', wrong;
  END IF;
  -- NO COMPONENT DATA: all 9 tables empty (034 writes no row), and no operation outside 029's four in the mutation log.
  FOR tbl IN SELECT unnest(ARRAY['project_brain_cards', 'project_brain_card_versions', 'project_brain_card_selection', 'project_brain_mission_cards', 'project_brain_handoffs', 'project_brain_handoff_versions', 'project_brain_evals', 'project_brain_eval_versions', 'project_brain_member_versions']) LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', tbl) INTO cnt;
    IF cnt > 0 THEN
      holding := concat_ws(', ', holding, tbl || ' ' || cnt);
    END IF;
  END LOOP;
  SELECT concat_ws(', ', holding, string_agg('operation ' || o.operation || ' ' || o.n, ', ' ORDER BY o.operation COLLATE "C")) INTO holding
    FROM (SELECT m.operation, count(*) AS n FROM relay_wonderland.project_brain_mutations m
           WHERE m.operation NOT IN ('CREATE', 'REVISE', 'SET_STATUS', 'LINK') GROUP BY m.operation) AS o;
  IF holding IS NOT NULL AND holding <> '' THEN
    RAISE EXCEPTION 'migration_034_down_refused: Project Brain component data exists (%); the mutation log is append-only, so 029''s operation CHECK cannot be restored over it, and no down script of this chain loses data', holding;
  END IF;
END
$$;
DROP TRIGGER project_brain_records_truncate_refused ON relay_wonderland.project_brain_records;
DROP TRIGGER project_brain_mutations_truncate_refused ON relay_wonderland.project_brain_mutations;
DROP TRIGGER project_brain_record_versions_truncate_refused ON relay_wonderland.project_brain_record_versions;
DROP TRIGGER project_brain_links_truncate_refused ON relay_wonderland.project_brain_links;
DROP TABLE relay_wonderland.project_brain_member_versions;
DROP TABLE relay_wonderland.project_brain_eval_versions;
DROP TABLE relay_wonderland.project_brain_evals;
DROP TABLE relay_wonderland.project_brain_handoff_versions;
DROP TABLE relay_wonderland.project_brain_handoffs;
DROP TABLE relay_wonderland.project_brain_mission_cards;
DROP TABLE relay_wonderland.project_brain_card_selection;
DROP TABLE relay_wonderland.project_brain_card_versions;
DROP TABLE relay_wonderland.project_brain_cards;
DROP FUNCTION relay_wonderland.project_brain_truncate_refused();
DROP FUNCTION relay_wonderland.project_brain_run_in_project();
DROP FUNCTION relay_wonderland.project_brain_component_guard();
ALTER TABLE relay_wonderland.project_brain_mutations DROP CONSTRAINT project_brain_mutations_operation_check;
ALTER TABLE relay_wonderland.project_brain_mutations ADD CONSTRAINT project_brain_mutations_operation_check CHECK(operation IN('CREATE', 'REVISE', 'SET_STATUS', 'LINK'));
-- Nothing 034 named remains (no relation, function, trigger or constraint name of its lists), no deferred reference to
-- the mutation log is left, and the operation CHECK admits exactly 029's four again.
DO $$
DECLARE
  left_over text;
BEGIN
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
  SELECT string_agg(o.name, ', ' ORDER BY o.name COLLATE "C") INTO left_over
    FROM (
      SELECT c.relname::text AS name FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel)
      UNION
      SELECT p.proname::text FROM pg_proc p WHERE p.pronamespace = 'relay_wonderland'::regnamespace AND p.proname::text IN (SELECT name FROM e_fn)
      UNION
      SELECT t.tgname::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal AND t.tgname::text IN (SELECT name FROM e_tg)
      UNION
      SELECT k.conname::text FROM pg_constraint k WHERE k.connamespace = 'relay_wonderland'::regnamespace AND k.conname::text IN (SELECT name FROM e_con)
    ) AS o;
  IF left_over IS NOT NULL THEN
    RAISE EXCEPTION 'migration_034_down_postcheck: name(s) 034 created remain (%)', left_over;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.project_brain_mutations'::regclass
               AND k.condeferrable) THEN
    RAISE EXCEPTION 'migration_034_down_postcheck: a deferrable reference to project_brain_mutations remains';
  END IF;
  IF (SELECT string_agg(m.op, ',' ORDER BY m.op COLLATE "C")
        FROM (SELECT (regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g'))[1] AS op
                FROM pg_constraint k
               WHERE k.conrelid = 'relay_wonderland.project_brain_mutations'::regclass
                 AND k.conname = 'project_brain_mutations_operation_check') AS m) IS DISTINCT FROM 'CREATE,LINK,REVISE,SET_STATUS' THEN
    RAISE EXCEPTION 'migration_034_down_postcheck: project_brain_mutations_operation_check does not admit exactly 029''s operations';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '034_project_brain_components';
COMMIT;
