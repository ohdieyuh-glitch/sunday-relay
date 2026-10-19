-- R1 STATE CLASSIFIER (r3, MAIN JUJU 2026-10-03; Second's review R-1, R-2 and its two r2 notes). READ-ONLY: one REPEATABLE READ READ ONLY
-- transaction. Decides the store's state BEFORE any table-specific query, so a missing table is a named state, never an
-- SQL error. TOTAL and ORDERED: the first matching rule wins, and the last rule catches everything.
--   1. an extension other than plpgsql, or an event trigger                   -> UNEXPECTED
--   2. non-system schemas other than {public} or {public, relay_wonderland}   -> UNEXPECTED
--   3. any object in public: relation, function, type, operator, collation, -> UNEXPECTED
--      conversion, text-search config/dictionary/parser/template, operator class/family, statistics object
--   4. no relay_wonderland (so public only, holding nothing)                  -> EMPTY
--   5. relay_wonderland without a ledger                                      -> UNEXPECTED
--   6. ledger = exactly want_029                                              -> AT_029
--   7. ledger = exactly want_030                                              -> AT_TARGET
--   8. an empty ledger (migrate() can never leave one: 001 stamps in its own   -> UNEXPECTED
--      transaction)
--   9. ledger = a non-empty STRICT PREFIX of the chain (a mid-chain failure)  -> PARTIAL
--  10. ledger = a subset of the chain that is not a prefix (a gap)            -> UNEXPECTED
--  11. anything else (a version the chain does not have)                      -> UNEXPECTED
-- ORDER DEPENDENCY: rules 6, 7 and 9 compare the ledger sorted by version with the chain as a sorted list. That is the
-- chain's real order only because the chain applies its files in filename order and every stamp equals its filename;
-- the bootstrap driver (scripts/julius-bootstrap-empty-store.ts) refuses to run unless both hold, entry for entry.
-- psql variables, generated from the reviewed checkout by command (never typed), versions sorted = the chain's order:
--   want_029: accepted main's stamped versions, comma-joined;  want_030: the candidate's, comma-joined.
-- Prints one line:  STATE=<EMPTY|AT_029|AT_TARGET|PARTIAL|UNEXPECTED>|RULE=<n>|REASON=<text>|<facts>
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT
  (SELECT coalesce(string_agg(nspname, ',' ORDER BY nspname), '') FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_(toast|temp_|toast_temp_)') AS schema_list,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_collation o JOIN pg_namespace n ON n.oid = o.collnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_conversion o JOIN pg_namespace n ON n.oid = o.connamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_config o JOIN pg_namespace n ON n.oid = o.cfgnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_dict o JOIN pg_namespace n ON n.oid = o.dictnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_parser o JOIN pg_namespace n ON n.oid = o.prsnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_ts_template o JOIN pg_namespace n ON n.oid = o.tmplnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_opfamily o JOIN pg_namespace n ON n.oid = o.opfnamespace WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_statistic_ext o JOIN pg_namespace n ON n.oid = o.stxnamespace WHERE n.nspname = 'public') AS public_objects,
  (SELECT coalesce(string_agg(extname, ',' ORDER BY extname), '') FROM pg_extension WHERE extname <> 'plpgsql') AS extra_extensions,
  (SELECT count(*) FROM pg_event_trigger) AS event_triggers,
  (to_regnamespace('relay_wonderland') IS NOT NULL) AS has_rw,
  (to_regclass('relay_wonderland.schema_migrations') IS NOT NULL) AS has_ledger
\gset
\if :has_ledger
SELECT coalesce(string_agg(version, ',' ORDER BY version), '') AS ledger, count(*) AS ledger_count,
       coalesce(max(version), '') AS ledger_last
  FROM relay_wonderland.schema_migrations
\gset
\else
\set ledger ''
\set ledger_count 0
\set ledger_last ''
\endif
WITH v AS (
  SELECT string_to_array(:'ledger', ',') AS led, string_to_array(:'want_030', ',') AS chain
), r AS (
  SELECT CASE
    WHEN :'extra_extensions' <> '' OR :'event_triggers' <> '0'                                  THEN 1
    WHEN :'schema_list' NOT IN ('public', 'public,relay_wonderland')                             THEN 2
    WHEN :'public_objects' <> '0'                                                                THEN 3
    WHEN :'has_rw' = 'f'                                                                         THEN 4
    WHEN :'has_ledger' = 'f'                                                                     THEN 5
    WHEN :'ledger' = :'want_029'                                                                 THEN 6
    WHEN :'ledger' = :'want_030'                                                                 THEN 7
    WHEN :'ledger_count' = '0'                                                                   THEN 8
    WHEN left(:'want_030', length(:'ledger') + 1) = :'ledger' || ','                             THEN 9
    WHEN (SELECT led <@ chain FROM v)                                                            THEN 10
    ELSE 11
  END AS rule
)
SELECT 'STATE=' || CASE r.rule WHEN 4 THEN 'EMPTY' WHEN 6 THEN 'AT_029' WHEN 7 THEN 'AT_TARGET' WHEN 9 THEN 'PARTIAL'
                               ELSE 'UNEXPECTED' END
       || '|RULE=' || r.rule
       || '|REASON=' || CASE r.rule
         WHEN 1 THEN 'extension(s) [' || :'extra_extensions' || '] / event trigger(s) ' || :'event_triggers'
         WHEN 2 THEN 'schemas are [' || :'schema_list' || ']'
         WHEN 3 THEN :'public_objects' || ' object(s) in public'
         WHEN 4 THEN 'no relay_wonderland, no ledger, public only and holding nothing'
         WHEN 5 THEN 'relay_wonderland exists without a migration ledger'
         WHEN 6 THEN 'ledger is exactly accepted main''s ' || :'ledger_count' || ' versions'
         WHEN 7 THEN 'ledger is exactly the candidate''s ' || :'ledger_count' || ' versions (030 already applied)'
         WHEN 8 THEN 'the migration ledger is empty'
         WHEN 9 THEN 'ledger is a strict prefix of the chain: ' || :'ledger_count' || ' versions, last ''' || :'ledger_last' || ''''
         WHEN 10 THEN 'ledger has a gap: first missing ''' || (SELECT c FROM v, unnest(v.chain) WITH ORDINALITY AS u(c, i)
                        WHERE c <> ALL (v.led) ORDER BY i LIMIT 1) || ''''
         ELSE 'ledger holds version(s) the chain does not have: ' || (SELECT string_agg(l, ',' ORDER BY l) FROM v, unnest(v.led) AS l
                        WHERE l <> ALL (v.chain))
       END
       || '|schemas=' || :'schema_list' || '|public_objects=' || :'public_objects' || '|extensions=' || :'extra_extensions'
       || '|event_triggers=' || :'event_triggers' || '|relay_wonderland=' || :'has_rw' || '|ledger=' || :'has_ledger'
       || '|ledger_count=' || :'ledger_count' || '|ledger_last=' || :'ledger_last'
  FROM r;
COMMIT;
