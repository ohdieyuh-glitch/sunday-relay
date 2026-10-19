-- R1 CATALOG FINGERPRINT (r1, MAIN JUJU 2026-10-03). READ-ONLY: one REPEATABLE READ READ ONLY transaction.
-- A canonical, OID-free listing of every user-schema object, then its sha256. Two databases built from the same
-- migration set must print the same lines; the BOOTSTRAP postcheck compares the live digest with the rehearsal's
-- reference digest (built by an independent method from the same SHA).
-- Prints the lines (sorted) and a final line:  FINGERPRINT sha256=<hex> lines=<n>
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
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
), digest AS (
  SELECT encode(sha256(convert_to(string_agg(l, chr(10) ORDER BY l COLLATE "C"), 'UTF8')), 'hex') AS h, count(*) AS n FROM lines
)
SELECT l FROM (
  SELECT 0 AS k, l FROM lines
  UNION ALL
  SELECT 1, 'FINGERPRINT sha256=' || h || ' lines=' || n FROM digest
) q ORDER BY k, l COLLATE "C";
COMMIT;
