-- R1 ROLLBACK OF A FAILED FIRST-TIME BOOTSTRAP (r1, MAIN JUJU 2026-10-03). Founder ruling R-5 (2026-10-03T18:24:19Z):
-- DROP SCHEMA relay_wonderland CASCADE is the approved rollback ONLY if the checks prove the store was EMPTY before the
-- bootstrap, every bootstrap-created object is in relay_wonderland, no extension or external object exists, nothing
-- unrelated was modified, and after the drop the database is back to the EXACT pre-bootstrap EMPTY fingerprint.
-- Otherwise STOP rather than roll back.
--
-- ONE TRANSACTION. Nothing is committed unless every check holds, including the one AFTER the drop: if the fingerprint
-- after DROP SCHEMA is not the pre-bootstrap one, the transaction is rolled back and the drop never happened.
-- The wrapper checks beforehand, from the BOOTSTRAP record: the pre-bootstrap classifier said EMPTY, the bootstrap FAILED,
-- the classifier now says PARTIAL, and the role and tablespace lists are unchanged.
--
-- psql variable (from the BOOTSTRAP record, never typed): expected_empty = the pre-bootstrap EMPTY fingerprint's sha256.
-- The view below is fingerprint-store.sql's own `lines` query, copied byte for byte; a unit test holds the two equal.
-- Exit 0 + 'ROLLBACK DONE' only on success. Every STOP raises rollback_bootstrap_stopped (psql exit 3), nothing committed.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\if :{?expected_empty}
\else
\echo 'ROLLBACK STOPPED: expected_empty (the pre-bootstrap EMPTY fingerprint sha256) was not given; nothing dropped'
DO $$ BEGIN RAISE EXCEPTION 'rollback_bootstrap_stopped'; END $$;
\endif
BEGIN;
CREATE TEMP VIEW rollback_fp_lines AS
WITH us AS (
  SELECT oid, nspname FROM pg_namespace
   WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_(toast|temp_|toast_temp_)'
), lines AS (
  SELECT 'schema ' || nspname || ' owner=' || pg_get_userbyid(n.nspowner) AS l FROM pg_namespace n WHERE n.oid IN (SELECT oid FROM us)
  UNION ALL
  SELECT 'relation ' || us.nspname || '.' || c.relname || ' kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text
         || ' rls=' || c.relrowsecurity || ' owner=' || pg_get_userbyid(c.relowner) || ' acl=' || coalesce(c.relacl::text, '-')
    FROM pg_class c JOIN us ON us.oid = c.relnamespace
  UNION ALL
  SELECT 'column ' || us.nspname || '.' || c.relname || ' #' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not-null' ELSE '' END
         || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '')
         || CASE WHEN a.attidentity <> '' THEN ' identity=' || a.attidentity::text ELSE '' END
         || CASE WHEN a.attgenerated <> '' THEN ' generated=' || a.attgenerated::text ELSE '' END
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN us ON us.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
  UNION ALL
  SELECT 'constraint ' || us.nspname || '.' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
         || CASE WHEN k.condeferrable THEN ' deferrable' ELSE '' END || CASE WHEN k.convalidated THEN '' ELSE ' not-valid' END
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN us ON us.oid = c.relnamespace
  UNION ALL
  SELECT 'index ' || pg_get_indexdef(i.indexrelid)
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN us ON us.oid = c.relnamespace
  UNION ALL
  SELECT 'trigger ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN us ON us.oid = c.relnamespace WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'function ' || us.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') returns '
         || coalesce(pg_get_function_result(p.oid), '-') || ' kind=' || p.prokind::text || ' volatile=' || p.provolatile::text
         || ' secdef=' || p.prosecdef || ' lang=' || l.lanname || ' body_md5=' || md5(coalesce(p.prosrc, ''))
         || ' config=' || coalesce(array_to_string(p.proconfig, ','), '-')
    FROM pg_proc p JOIN us ON us.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  UNION ALL
  SELECT 'sequence ' || us.nspname || '.' || c.relname || ' type=' || format_type(s.seqtypid, NULL) || ' start=' || s.seqstart
         || ' inc=' || s.seqincrement || ' min=' || s.seqmin || ' max=' || s.seqmax || ' cache=' || s.seqcache || ' cycle=' || s.seqcycle
    FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN us ON us.oid = c.relnamespace
  UNION ALL
  SELECT 'view ' || us.nspname || '.' || c.relname || ' def_md5=' || md5(pg_get_viewdef(c.oid, true))
    FROM pg_class c JOIN us ON us.oid = c.relnamespace WHERE c.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'type ' || us.nspname || '.' || t.typname || ' typtype=' || t.typtype::text
         || coalesce(' labels=' || (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid), '')
         || CASE WHEN t.typtype = 'd' THEN ' base=' || format_type(t.typbasetype, t.typtypmod) ELSE '' END
    FROM pg_type t JOIN us ON us.oid = t.typnamespace WHERE t.typtype IN ('e', 'd', 'r', 'm')
  UNION ALL
  SELECT 'policy ' || us.nspname || '.' || c.relname || ' ' || pol.polname || ' cmd=' || pol.polcmd::text || ' permissive=' || pol.polpermissive
         || ' using=' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-') || ' check=' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-')
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN us ON us.oid = c.relnamespace
  UNION ALL
  SELECT 'extension ' || extname || ' ' || extversion FROM pg_extension
)
SELECT l FROM lines;
SELECT encode(sha256(convert_to(string_agg(l, chr(10) ORDER BY l COLLATE "C"), 'UTF8')), 'hex') AS outside_before
  FROM rollback_fp_lines
 WHERE l !~ '^(schema relay_wonderland |(relation|column|constraint|function|sequence|view|type|policy) relay_wonderland\.|(index|trigger) CREATE .* ON relay_wonderland\.)'
\gset
SELECT (to_regnamespace('relay_wonderland') IS NOT NULL) AS has_rw,
       (SELECT count(*) FROM pg_event_trigger) = 0 AS no_event_triggers,
       (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql') = 0 AS no_extensions,
       (:'outside_before' = :'expected_empty') AS outside_unchanged
\gset
\if :has_rw
\else
\echo 'ROLLBACK STOPPED: there is no relay_wonderland to roll back; nothing dropped'
ROLLBACK;
DO $$ BEGIN RAISE EXCEPTION 'rollback_bootstrap_stopped'; END $$;
\endif
\if :no_event_triggers
\else
\echo 'ROLLBACK STOPPED: an event trigger exists (an object outside relay_wonderland); nothing dropped'
ROLLBACK;
DO $$ BEGIN RAISE EXCEPTION 'rollback_bootstrap_stopped'; END $$;
\endif
\if :no_extensions
\else
\echo 'ROLLBACK STOPPED: an extension other than plpgsql exists; nothing dropped'
ROLLBACK;
DO $$ BEGIN RAISE EXCEPTION 'rollback_bootstrap_stopped'; END $$;
\endif
\if :outside_unchanged
\else
\echo 'ROLLBACK STOPPED: objects outside relay_wonderland differ from the pre-bootstrap EMPTY store (outside digest ' :outside_before '); nothing dropped'
ROLLBACK;
DO $$ BEGIN RAISE EXCEPTION 'rollback_bootstrap_stopped'; END $$;
\endif
DROP SCHEMA relay_wonderland CASCADE;
SELECT encode(sha256(convert_to(string_agg(l, chr(10) ORDER BY l COLLATE "C"), 'UTF8')), 'hex') AS after_drop
  FROM rollback_fp_lines
\gset
SELECT (:'after_drop' = :'expected_empty') AS back_to_empty
\gset
\if :back_to_empty
DROP VIEW rollback_fp_lines;
COMMIT;
\echo 'ROLLBACK DONE: relay_wonderland dropped; the fingerprint is the pre-bootstrap EMPTY one (' :after_drop ')'
\else
\echo 'ROLLBACK STOPPED: after the drop the fingerprint is ' :after_drop ', not the pre-bootstrap EMPTY ' :expected_empty '; the drop was UNDONE'
ROLLBACK;
DO $$ BEGIN RAISE EXCEPTION 'rollback_bootstrap_stopped'; END $$;
\endif
