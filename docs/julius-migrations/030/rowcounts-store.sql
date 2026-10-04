-- R1 ROW COUNTS (r1, MAIN JUJU 2026-10-03; Second's review R-4). READ-ONLY: one REPEATABLE READ READ ONLY transaction.
-- The exact count(*) of every base table in every non-system schema, one line per table, sorted. The BOOTSTRAP postcheck
-- compares the live output with the rehearsal's psql-built reference, line for line, so a migration that seeds rows
-- stays covered without a hard-coded expectation. Prints:  rows <schema>.<table> = <n>  ...  then  ROWCOUNTS tables=<n>
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH t AS (
  SELECT table_schema AS s, table_name AS n,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text AS c
    FROM information_schema.tables
   WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
     AND table_schema !~ '^pg_(toast|temp_|toast_temp_)'
)
SELECT l FROM (
  SELECT 0 AS k, 'rows ' || s || '.' || n || ' = ' || c AS l FROM t
  UNION ALL
  SELECT 1, 'ROWCOUNTS tables=' || count(*) FROM t
) q ORDER BY k, l COLLATE "C";
COMMIT;
