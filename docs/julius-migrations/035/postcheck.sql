-- MIGRATION 035: POST-DEPLOY CHECK. READ-ONLY; run right AFTER 035 (RUNBOOK.md, step 4) and save it with the deploy record, beside
-- precheck.sql's output: the same blocks, compared block by block (only the first is checked_at|database).
-- PASS only if ALL of:
--   other_client_sessions = 0;
--   relations_035_expected = 3, relations_035_present = 3, relations_035_as_created = 3 and voice_relations_other = 0;
--   every relation column = t;
--   voice_puid_binding_rows = 0 (035 writes no row); catalog_035_md5 = the measured digest the apply pins;
--   voice_fk_constraints = 1, players_referenced_by_fks = the precheck's + 1, players_rows = the precheck's;
--   migration_034_applied = t, migration_035_applied = t, ledger_count = the precheck's + 1, ledger_last = 035_wonderland_voice.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database, current_user AS checked_by, version() AS server;
-- Every other client session on this database. The writers are stopped, and nothing else may be connected.
SELECT count(*) AS other_client_sessions
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
-- THE 3 RELATIONS 035 CREATES (035_wonderland_voice.sql: 1 table and its 2 indexes, the primary key and the unique puid), each as
-- 035 creates it: a permanent table; each index on its table, primary or unique as written, valid. And every OTHER
-- relay_wonderland relation named voice_*, which must not exist. The list is the one the migration and down.sql carry.
SELECT count(r.name) AS relations_035_expected,
       count(r.name) FILTER (WHERE r.relname IS NOT NULL) AS relations_035_present,
       count(r.name) FILTER (WHERE r.as_created) AS relations_035_as_created,
       count(*) FILTER (WHERE r.name IS NULL) AS voice_relations_other,
       string_agg(r.relname, ',' ORDER BY r.relname COLLATE "C") FILTER (WHERE r.name IS NULL) AS voice_relations_other_names,
       bool_or(r.as_created) FILTER (WHERE r.name = 'voice_puid_binding') AS voice_puid_binding,
       bool_or(r.as_created) FILTER (WHERE r.name = 'voice_puid_binding_pkey') AS voice_puid_binding_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'voice_puid_binding_puid_key') AS voice_puid_binding_puid_key
  FROM (
    SELECT e.name, a.relname,
           coalesce(a.oid IS NOT NULL AND a.relkind = e.kind AND a.relpersistence = 'p'
             AND (e.kind <> 'i' OR EXISTS (
                   SELECT 1 FROM pg_index i
                    WHERE i.indexrelid = a.oid AND i.indrelid = to_regclass('relay_wonderland.' || e.on_table)
                      AND i.indisprimary = (e.flag = 'p') AND i.indisunique = (e.flag IN ('p', 'u')) AND i.indisvalid)), false) AS as_created
      FROM (VALUES
        ('voice_puid_binding', 'r', NULL, '-'),
        ('voice_puid_binding_pkey', 'i', 'voice_puid_binding', 'p'),
        ('voice_puid_binding_puid_key', 'i', 'voice_puid_binding', 'u')
      ) AS e(name, kind, on_table, flag)
      FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                   FROM pg_class c
                  WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%') AS a
        ON a.relname = e.name
  ) AS r;
-- THE TABLE'S EXACT ROW COUNT, counted only where it exists (NULL where it does not, never an SQL error).
SELECT max(t.n) AS voice_puid_binding_rows
  FROM (
    SELECT CASE WHEN c.relkind = 'r'
                THEN (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM relay_wonderland.voice_puid_binding', false, true, '')))[1]::text::bigint
           END AS n
      FROM (SELECT 1) AS one
      LEFT JOIN pg_class c ON c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname = 'voice_puid_binding'
  ) AS t;
-- THE VOICE CATALOG, by definition and free of oids: every column, constraint and index of every relay_wonderland relation named
-- voice_*. NULL while none exists. RECORDED here; the apply gates it on the measured digest.
SELECT md5(string_agg(l.line, chr(10) ORDER BY l.line COLLATE "C")) AS catalog_035_md5
  FROM (
    SELECT 'relation ' || c.relname || ' kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text AS line
      FROM pg_class c
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%'
    UNION ALL
    SELECT 'column ' || c.relname || ' #' || a.attnum::text || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' not-null' ELSE '' END || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%' AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint ' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%'
    UNION ALL
    SELECT 'index ' || pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%'
  ) AS l;
-- THE ONE EXISTING TABLE 035 TOUCHES: players' rows (they must not change), the foreign keys that reference it (035 adds 1), and
-- the foreign keys the voice table carries (035 writes 1).
SELECT (SELECT count(*) FROM relay_wonderland.players) AS players_rows,
       (SELECT count(*) FROM pg_constraint k
         WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.players'::regclass) AS players_referenced_by_fks,
       (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
         WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%') AS voice_fk_constraints;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_project_brain_components') AS migration_034_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') AS migration_035_applied,
       (SELECT count(*) FROM relay_wonderland.schema_migrations) AS ledger_count,
       (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) AS ledger_last;
COMMIT;
