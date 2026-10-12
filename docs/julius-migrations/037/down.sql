-- MIGRATION 037: DOWN. Drops everything 037 created -- its 2 private_server* tables, and with them their 2 indexes, their 2 foreign keys
-- and the internal RI triggers those keys put on relay_wonderland.players -- and removes the 037 stamp.
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 037 is applied, nothing after 037 is applied
-- (roll a later migration back first, newest first, so the ledger never shows a gap), each of the 4 relations is exactly as 037 created
-- it and no other relay_wonderland relation is named private_server*, and BOTH tables are empty. Dropping a lifecycle row would let its
-- owner's Free window start again (the very bypass 037 exists to prevent), and dropping a tier row would lose a paid entitlement: no
-- down script of this chain loses data. With rows present, the way back is a founder decision.
-- THE COUNT CANNOT RACE THE DROP: both tables are locked IN SHARE MODE before they are counted, which blocks every write until COMMIT.
-- The tables are dropped in ONE statement WITHOUT CASCADE: an object outside 037 that depends on one of them makes the DROP fail (2BP01),
-- and the whole script rolls back.
-- AFTER RUNNING IT the deployed code must no longer list 037, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '037_wonderland_private_servers') THEN
    RAISE EXCEPTION 'migration_037_down_refused: 037 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '037') THEN
    RAISE EXCEPTION 'migration_037_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '037');
  END IF;
END
$$;
LOCK TABLE relay_wonderland.private_server_entitlements, relay_wonderland.private_servers IN SHARE MODE;
DO $$
DECLARE
  wrong text;
  t text;
  n bigint;
  data text := '';
BEGIN
  -- Each of the 4 exactly as 037 created it, and no other private_server* relation: the list, and the test, of the migration's post-check.
  SELECT string_agg(coalesce(r.name, r.relname), ', ' ORDER BY coalesce(r.name, r.relname) COLLATE "C") INTO wrong
    FROM (
      SELECT e.name, a.relname,
             coalesce(a.oid IS NOT NULL AND a.relkind = e.kind AND a.relpersistence = 'p'
               AND (e.kind <> 'i' OR EXISTS (
                     SELECT 1 FROM pg_index i
                      WHERE i.indexrelid = a.oid AND i.indrelid = to_regclass('relay_wonderland.' || e.on_table)
                        AND i.indisprimary = (e.flag = 'p') AND i.indisunique = (e.flag IN ('p', 'u')) AND i.indisvalid)), false) AS as_created
        FROM (VALUES
          ('private_server_entitlements', 'r', NULL, '-'), ('private_server_entitlements_pkey', 'i', 'private_server_entitlements', 'p'),
          ('private_servers', 'r', NULL, '-'), ('private_servers_pkey', 'i', 'private_servers', 'p')
        ) AS e(name, kind, on_table, flag)
        FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                     FROM pg_class c
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%') AS a
          ON a.relname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_037_down_refused: relation(s) not exactly as 037 created them, or not 037''s (%)', wrong;
  END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'private\_server%' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n > 0 THEN data := data || CASE WHEN data = '' THEN '' ELSE ', ' END || t || ' ' || n; END IF;
  END LOOP;
  IF data <> '' THEN
    RAISE EXCEPTION 'migration_037_down_refused: private-server data exists (%); dropping it would lose it, and no down script of this chain loses data', data;
  END IF;
END
$$;
DROP TABLE relay_wonderland.private_servers, relay_wonderland.private_server_entitlements;
-- Nothing named private_server* remains, and no private-server foreign key still references players.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%') THEN
    RAISE EXCEPTION 'migration_037_down_postcheck: private_server* relation(s) remain (%)',
      (SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") FROM pg_class c
        WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.players'::regclass AND k.conname LIKE 'private\_server%') THEN
    RAISE EXCEPTION 'migration_037_down_postcheck: a private-server foreign key still references players';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '037_wonderland_private_servers';
COMMIT;
