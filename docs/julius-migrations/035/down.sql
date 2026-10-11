-- MIGRATION 035: DOWN. Drops everything 035 created -- its 1 table, and with it its 2 indexes, its 1 foreign key and the internal
-- RI triggers that key put on relay_wonderland.players -- and removes the 035 stamp. (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 035 is applied, nothing after 035 is
-- applied (roll a later migration back first, newest first, so the ledger never shows a gap), each of the 3 relations is exactly as
-- 035 created it and no other relay_wonderland relation is named voice_*, and voice_puid_binding holds no row. DROPPING A BINDING
-- WOULD LOSE IT, and no down script of this chain loses data. With bindings, the way back is a founder decision.
-- THE COUNT CANNOT RACE THE DROP (the 033 review's (b), applied here from the start): the table is locked IN SHARE MODE before it
-- is counted, which blocks every insert until COMMIT, so a writer cannot add a row between the count and the DROP.
-- The table is dropped WITHOUT CASCADE: an object outside 035 that depends on it makes its DROP fail (2BP01), and the whole script
-- rolls back. Dropping the foreign key removes its triggers from players under ACCESS EXCLUSIVE until COMMIT.
-- AFTER RUNNING IT the deployed code must no longer list 035, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') THEN
    RAISE EXCEPTION 'migration_035_down_refused: 035 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '035') THEN
    RAISE EXCEPTION 'migration_035_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '035');
  END IF;
END
$$;
LOCK TABLE relay_wonderland.voice_puid_binding IN SHARE MODE;
DO $$
DECLARE
  wrong text;
  n bigint;
BEGIN
  -- Each of the 3 exactly as 035 created it, and no other voice_* relation: the list, and the test, of the migration's own post-check.
  SELECT string_agg(coalesce(r.name, r.relname), ', ' ORDER BY coalesce(r.name, r.relname) COLLATE "C") INTO wrong
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
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_035_down_refused: relation(s) not exactly as 035 created them, or not 035''s (%)', wrong;
  END IF;
  SELECT count(*) INTO n FROM relay_wonderland.voice_puid_binding;
  IF n > 0 THEN
    RAISE EXCEPTION 'migration_035_down_refused: voice data exists (voice_puid_binding %); dropping it would lose it, and no down script of this chain loses data', n;
  END IF;
END
$$;
DROP TABLE relay_wonderland.voice_puid_binding;
-- Nothing named voice_* remains, and no voice foreign key still references players.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%') THEN
    RAISE EXCEPTION 'migration_035_down_postcheck: voice_* relation(s) remain (%)',
      (SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") FROM pg_class c
        WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.players'::regclass AND k.conname LIKE 'voice\_%') THEN
    RAISE EXCEPTION 'migration_035_down_postcheck: a voice foreign key still references players';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice';
COMMIT;
