-- MIGRATION 034: POST-DEPLOY CHECK. READ-ONLY; run right AFTER 034 and compare with the pre-check's output.
-- (RUNBOOK.md, step 4.)
-- Every result below is ONE row under a FIXED header: run with psql -A -F '|', each block prints its header line, its
-- row and "(1 row)". These are precheck.sql's blocks, header for header, but the first (checked_at|database).
-- PASS only if ALL of:
--   other_client_sessions = 0 (the writers are still stopped);
--   relations_034_expected = 21, relations_034_present = 21, relations_034_as_created = 21, project_brain_relations_other = 0;
--   every relation column, project_brain_cards to project_brain_member_versions_pkey, = t;
--   functions_034_expected = 3, functions_034_present = 3; triggers_034_expected = 25, triggers_034_present = 25,
--   triggers_034_as_created = 25, project_brain_triggers_other = 0; every trigger column = t;
--   constraints_034_expected = 69, constraints_034_present = 69, constraints_034_as_created = 69,
--   constraints_034_wrong_names empty, constraints_on_034_tables_other = 0, fk_constraints_034 = 24,
--   deferred_fks_to_project_brain_mutations = 9;
--   project_brain_mutations_operations = the 15 of 034 (CARD_CREATE,...,SET_STATUS), project_brain_mutations_operation_count = 15;
--   every *_rows column = 0 (034 writes no row); project_brain_mutations_rows EQUALS the pre-check's and
--   component_operations_in_log = 0;
--   apply_role_owns_029 = t and owner_034_tables = owner_029_tables (one role owns 029's and 034's tables);
--   migration_033_applied = t, migration_034_applied = t, ledger_count = the pre-check's + 1,
--   ledger_last = 034_project_brain_components.
-- catalog_034_md5 is RECORDED, not gated here: it must equal the value this script prints on a throwaway database the
-- landed head's migrate() built (same PostgreSQL major); that comparison belongs to the record's verification.
-- On ANY difference: STOP, and follow RUNBOOK.md's rollback.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database;
-- Every other client session on this database. The writers are stopped, and nothing else may be connected.
SELECT count(*) AS other_client_sessions
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
-- THE 21 RELATIONS 034 CREATES (9 tables and 12 indexes, the 9 primary keys included), each as 034 creates it: a permanent
-- table; each index on its table, primary or unique as written, valid. And every OTHER relay_wonderland relation named
-- project_brain_* that is not 029's (029's 4 tables and the indexes on them), which must not exist. The list is the one the
-- migration's guard and down.sql carry.
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
SELECT count(r.name) AS relations_034_expected,
       count(r.name) FILTER (WHERE r.relname IS NOT NULL) AS relations_034_present,
       count(r.name) FILTER (WHERE r.as_created) AS relations_034_as_created,
       count(*) FILTER (WHERE r.name IS NULL) AS project_brain_relations_other,
       string_agg(r.relname, ',' ORDER BY r.relname COLLATE "C") FILTER (WHERE r.name IS NULL) AS project_brain_relations_other_names,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_cards') AS project_brain_cards,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_versions') AS project_brain_card_versions,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_selection') AS project_brain_card_selection,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_mission_cards') AS project_brain_mission_cards,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoffs') AS project_brain_handoffs,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoff_versions') AS project_brain_handoff_versions,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals') AS project_brain_evals,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_eval_versions') AS project_brain_eval_versions,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_member_versions') AS project_brain_member_versions,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_cards_pkey') AS project_brain_cards_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_cards_project') AS project_brain_cards_project,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_versions_pkey') AS project_brain_card_versions_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_selection_pkey') AS project_brain_card_selection_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_mission_cards_pkey') AS project_brain_mission_cards_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoffs_pkey') AS project_brain_handoffs_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoff_versions_pkey') AS project_brain_handoff_versions_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals_pkey') AS project_brain_evals_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals_one_current') AS project_brain_evals_one_current,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals_subject') AS project_brain_evals_subject,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_eval_versions_pkey') AS project_brain_eval_versions_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_member_versions_pkey') AS project_brain_member_versions_pkey
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
  ) AS r;
-- THE 3 FUNCTIONS AND 25 TRIGGERS 034 CREATES, each trigger as created: on its table, calling its function, of its type
-- (tgtype: ROW 1, BEFORE 2, INSERT 4, DELETE 8, UPDATE 16, TRUNCATE 32), enabled, no WHEN, no argument. Four of them are
-- on 029's tables (the TRUNCATE guards). And every OTHER trigger on a project_brain_* table that is not 029's own.
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
SELECT (SELECT count(*) FROM e_fn) AS functions_034_expected,
       (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'relay_wonderland'::regnamespace AND p.proname::text IN (SELECT name FROM e_fn)
           AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
           AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')) AS functions_034_present,
       count(r.name) AS triggers_034_expected,
       count(r.name) FILTER (WHERE r.tgname IS NOT NULL) AS triggers_034_present,
       count(r.name) FILTER (WHERE r.as_created) AS triggers_034_as_created,
       count(*) FILTER (WHERE r.name IS NULL) AS project_brain_triggers_other,
       string_agg(r.relname || '.' || r.tgname, ',' ORDER BY r.relname || '.' || r.tgname COLLATE "C") FILTER (WHERE r.name IS NULL) AS project_brain_triggers_other_names,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_versions_immutable') AS project_brain_card_versions_immutable,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_mission_cards_immutable') AS project_brain_mission_cards_immutable,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoff_versions_immutable') AS project_brain_handoff_versions_immutable,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_eval_versions_immutable') AS project_brain_eval_versions_immutable,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_cards_guard') AS project_brain_cards_guard,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_selection_guard') AS project_brain_card_selection_guard,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoffs_guard') AS project_brain_handoffs_guard,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals_guard') AS project_brain_evals_guard,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_mission_cards_project') AS project_brain_mission_cards_project,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoffs_project') AS project_brain_handoffs_project,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals_project') AS project_brain_evals_project,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_member_versions_immutable') AS project_brain_member_versions_immutable,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_records_truncate_refused') AS project_brain_records_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_mutations_truncate_refused') AS project_brain_mutations_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_record_versions_truncate_refused') AS project_brain_record_versions_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_links_truncate_refused') AS project_brain_links_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_cards_truncate_refused') AS project_brain_cards_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_versions_truncate_refused') AS project_brain_card_versions_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_card_selection_truncate_refused') AS project_brain_card_selection_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_mission_cards_truncate_refused') AS project_brain_mission_cards_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoffs_truncate_refused') AS project_brain_handoffs_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_handoff_versions_truncate_refused') AS project_brain_handoff_versions_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_evals_truncate_refused') AS project_brain_evals_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_eval_versions_truncate_refused') AS project_brain_eval_versions_truncate_refused,
       bool_or(r.as_created) FILTER (WHERE r.name = 'project_brain_member_versions_truncate_refused') AS project_brain_member_versions_truncate_refused
  FROM (
    SELECT e.name, a.tgname, a.relname,
           coalesce(a.relname = e.on_table AND a.proname = e.fn AND a.pronamespace_ok AND a.tgtype = e.tgtype
                    AND a.tgenabled = 'O' AND a.no_when AND a.tgnargs = 0, false) AS as_created
      FROM e_tg AS e
      FULL JOIN (SELECT t.tgname::text AS tgname, c.relname::text AS relname, p.proname::text AS proname,
                        p.pronamespace = 'relay_wonderland'::regnamespace AS pronamespace_ok, t.tgtype::int AS tgtype, t.tgenabled::text AS tgenabled,
                        t.tgqual IS NULL AS no_when, t.tgnargs::int AS tgnargs
                   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal
                    AND (t.tgname::text IN (SELECT name FROM e_tg)
                         OR (c.relname LIKE 'project\_brain\_%' AND t.tgname::text NOT IN ('project_brain_mutations_immutable', 'project_brain_versions_immutable', 'project_brain_links_immutable', 'project_brain_records_guard')))) AS a
        ON a.tgname = e.name
  ) AS r;
-- THE 69 CONSTRAINT NAMES ON 034's TABLES (60 chosen by PostgreSQL), each as created: on its table, of its type, validated;
-- a foreign key on the table it references, DEFERRABLE INITIALLY DEFERRED exactly where 034 says so (the 9 references to
-- the mutation log). And every OTHER constraint on 034's tables. NOT NULL constraints (PostgreSQL 18 lists them) are not
-- counted here; catalog_034_md5 holds them.
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
SELECT count(r.name) AS constraints_034_expected,
       count(r.name) FILTER (WHERE r.conname IS NOT NULL) AS constraints_034_present,
       count(r.name) FILTER (WHERE r.as_created) AS constraints_034_as_created,
       string_agg(r.name, ',' ORDER BY r.name COLLATE "C") FILTER (WHERE r.conname IS NOT NULL AND NOT r.as_created) AS constraints_034_wrong_names,
       count(*) FILTER (WHERE r.name IS NULL) AS constraints_on_034_tables_other,
       string_agg(r.conname, ',' ORDER BY r.conname COLLATE "C") FILTER (WHERE r.name IS NULL) AS constraints_on_034_tables_other_names,
       count(r.name) FILTER (WHERE r.as_created AND r.contype = 'f') AS fk_constraints_034,
       (SELECT count(*) FROM pg_constraint k
         WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.project_brain_mutations'::regclass
           AND k.condeferrable AND k.condeferred) AS deferred_fks_to_project_brain_mutations
  FROM (
    SELECT e.name, a.conname, a.contype,
           coalesce(a.relname = e.on_table AND a.contype = e.contype AND a.convalidated
                    AND (e.contype <> 'f' OR (a.confrelname = e.references_table
                         AND a.condeferrable = (e.deferral = 'd') AND a.condeferred = (e.deferral = 'd'))), false) AS as_created
      FROM e_con AS e
      FULL JOIN (SELECT k.conname::text AS conname, c.relname::text AS relname, k.contype::text AS contype, k.convalidated,
                        k.condeferrable, k.condeferred, f.relname::text AS confrelname
                   FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid LEFT JOIN pg_class f ON f.oid = k.confrelid
                  WHERE k.connamespace = 'relay_wonderland'::regnamespace AND k.contype IN ('p', 'u', 'f', 'c', 'x')
                    AND (k.conname::text IN (SELECT name FROM e_con) OR (c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel WHERE kind = 'r')))) AS a
        ON a.conname = e.name
  ) AS r;
-- THE ONE EXISTING CONSTRAINT 034 REPLACES: 029's operation CHECK on project_brain_mutations (same name), read as the
-- operations it admits: 029's 4 before 034, 034's 15 after (and after down.sql, 029's 4 again).
SELECT string_agg(m.op, ',' ORDER BY m.op COLLATE "C") AS project_brain_mutations_operations,
       count(m.op) AS project_brain_mutations_operation_count
  FROM (SELECT (regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g'))[1] AS op
          FROM pg_constraint k
         WHERE k.conrelid = 'relay_wonderland.project_brain_mutations'::regclass AND k.conname = 'project_brain_mutations_operation_check') AS m;
-- THE ROWS: each of 034's tables (NULL while it does not exist; 034 writes no row), and the one existing table whose rows
-- 034 must not change, the mutation log (no operation outside 029's four before 034; none written by 034).
SELECT
       max(t.n) FILTER (WHERE t.name = 'project_brain_cards') AS project_brain_cards_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_card_versions') AS project_brain_card_versions_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_card_selection') AS project_brain_card_selection_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_mission_cards') AS project_brain_mission_cards_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_handoffs') AS project_brain_handoffs_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_handoff_versions') AS project_brain_handoff_versions_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_evals') AS project_brain_evals_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_eval_versions') AS project_brain_eval_versions_rows,
       max(t.n) FILTER (WHERE t.name = 'project_brain_member_versions') AS project_brain_member_versions_rows
  FROM (
    SELECT e.name,
           CASE WHEN c.relkind = 'r'
                THEN (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM relay_wonderland.%I', e.name), false, true, '')))[1]::text::bigint
           END AS n
      FROM unnest(ARRAY['project_brain_cards', 'project_brain_card_versions', 'project_brain_card_selection', 'project_brain_mission_cards', 'project_brain_handoffs', 'project_brain_handoff_versions', 'project_brain_evals', 'project_brain_eval_versions', 'project_brain_member_versions']) AS e(name)
      LEFT JOIN pg_class c ON c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname = e.name
  ) AS t;
SELECT count(*) AS project_brain_mutations_rows,
       count(*) FILTER (WHERE operation NOT IN ('CREATE', 'REVISE', 'SET_STATUS', 'LINK')) AS component_operations_in_log
  FROM relay_wonderland.project_brain_mutations;
-- 034's CATALOG, by definition and free of oids: every relation, column, constraint and index of its 9 tables, its 25
-- triggers (pg_get_triggerdef, the 4 on 029's tables included) and its 3 functions (body digest). NULL while none exists.
-- RECORDED, not gated: a throwaway database migrated by the landed head prints the same digest (the real-PostgreSQL
-- suite's DOCS case proves the two paths agree).
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
SELECT md5(string_agg(l.line, chr(10) ORDER BY l.line COLLATE "C")) AS catalog_034_md5
  FROM (
    SELECT 'relation ' || c.relname || ' kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text AS line
      FROM pg_class c
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel)
    UNION ALL
    SELECT 'column ' || c.relname || ' #' || a.attnum::text || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' not-null' ELSE '' END || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel WHERE kind = 'r') AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint ' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel WHERE kind = 'r')
    UNION ALL
    SELECT 'index ' || pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname::text IN (SELECT name FROM e_rel WHERE kind = 'r')
    UNION ALL
    SELECT 'trigger ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal AND t.tgname::text IN (SELECT name FROM e_tg)
    UNION ALL
    SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') returns=' || format_type(p.prorettype, NULL)
           || ' body_md5=' || md5(p.prosrc)
      FROM pg_proc p
     WHERE p.pronamespace = 'relay_wonderland'::regnamespace AND p.proname::text IN (SELECT name FROM e_fn)
  ) AS l;
-- WHO APPLIES 034. It ALTERs 029's project_brain_mutations and creates a trigger on 4 of 029's tables, which needs their
-- OWNER (a superuser could do it too, and would then own 034's tables while the bridge connects as the owner of 029's:
-- every Brain read of 034's tables would be refused). So step 3 applies as the role that owns 029's tables, and the
-- post-check shows one role owning both.
SELECT current_user AS apply_role,
       (SELECT string_agg(o.owner, ',' ORDER BY o.owner COLLATE "C") FROM (SELECT DISTINCT pg_get_userbyid(c.relowner)::text AS owner FROM pg_class c
         WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname::text IN ('project_brain_records', 'project_brain_mutations', 'project_brain_record_versions', 'project_brain_links')) AS o) AS owner_029_tables,
       (SELECT bool_and(pg_get_userbyid(c.relowner) = current_user) FROM pg_class c
         WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname::text IN ('project_brain_records', 'project_brain_mutations', 'project_brain_record_versions', 'project_brain_links')) AS apply_role_owns_029,
       (SELECT string_agg(o.owner, ',' ORDER BY o.owner COLLATE "C") FROM (SELECT DISTINCT pg_get_userbyid(c.relowner)::text AS owner FROM pg_class c
         WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname::text IN ('project_brain_cards', 'project_brain_card_versions', 'project_brain_card_selection', 'project_brain_mission_cards', 'project_brain_handoffs', 'project_brain_handoff_versions', 'project_brain_evals', 'project_brain_eval_versions', 'project_brain_member_versions')) AS o) AS owner_034_tables;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') AS migration_033_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_project_brain_components') AS migration_034_applied,
       (SELECT count(*) FROM relay_wonderland.schema_migrations) AS ledger_count,
       (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) AS ledger_last;
COMMIT;
