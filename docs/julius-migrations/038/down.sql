-- MIGRATION 038: DOWN. Drops everything 038 created -- its moderation evidence view, its 4 lff_* tables, and with them their 12
-- indexes, their 5 foreign keys and the internal RI triggers those keys put on relay_wonderland.players -- and removes the 038 stamp.
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 038 is applied, nothing after 038 is applied
-- (roll a later migration back first, newest first, so the ledger never shows a gap), each of the 17 relations is exactly as 038 created
-- it and no other relay_wonderland relation is named lff_*, and ALL FOUR tables are empty. Dropping a post or a join request would lose
-- a player's own words and an owner's answer, dropping a creation record would reset a player's creation cap, and dropping a HELD post
-- or a snapshot would destroy moderation evidence (founder decision D-L5: each is a row like any other, so each is counted here): no
-- down script of this chain loses data. With rows present, the way back is a founder decision.
-- THE COUNT CANNOT RACE THE DROP: the tables are locked IN SHARE MODE before they are counted, which blocks every write until COMMIT.
-- The view goes first (it reads the tables). The tables are dropped in ONE statement WITHOUT CASCADE: the key from lff_join_requests
-- to lff_posts goes with them, and an object outside 038 that depends on any of them makes the DROP fail (2BP01), and the whole script
-- rolls back.
-- AFTER RUNNING IT the deployed code must no longer list 038, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '038_wonderland_lff') THEN
    RAISE EXCEPTION 'migration_038_down_refused: 038 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '038') THEN
    RAISE EXCEPTION 'migration_038_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '038');
  END IF;
END
$$;
LOCK TABLE relay_wonderland.lff_posts, relay_wonderland.lff_join_requests, relay_wonderland.lff_post_creations, relay_wonderland.lff_post_snapshots IN SHARE MODE;
DO $$
DECLARE
  wrong text;
  t text;
  n bigint;
  data text := '';
BEGIN
  -- Each of the 17 exactly as 038 created it, and no other lff_* relation: the list, and the test, of the migration's post-check.
  SELECT string_agg(coalesce(r.name, r.relname), ', ' ORDER BY coalesce(r.name, r.relname) COLLATE "C") INTO wrong
    FROM (
      SELECT e.name, a.relname,
             coalesce(a.oid IS NOT NULL AND a.relkind = e.kind AND a.relpersistence = 'p'
               AND (e.kind <> 'i' OR EXISTS (
                     SELECT 1 FROM pg_index i
                      WHERE i.indexrelid = a.oid AND i.indrelid = to_regclass('relay_wonderland.' || e.on_table)
                        AND i.indisprimary = (e.flag = 'p') AND i.indisunique = (e.flag IN ('p', 'u'))
                        AND (i.indpred IS NOT NULL) = (e.flag IN ('u', 'w')) AND i.indisvalid)), false) AS as_created
        FROM (VALUES
          ('lff_posts', 'r', NULL, '-'), ('lff_posts_pkey', 'i', 'lff_posts', 'p'),
          ('lff_posts_feed', 'i', 'lff_posts', '-'), ('lff_posts_category_feed', 'i', 'lff_posts', '-'), ('lff_posts_owner', 'i', 'lff_posts', '-'),
          ('lff_posts_held', 'i', 'lff_posts', 'w'),
          ('lff_join_requests', 'r', NULL, '-'), ('lff_join_requests_pkey', 'i', 'lff_join_requests', 'p'),
          ('lff_join_requests_one_live', 'i', 'lff_join_requests', 'u'),
          ('lff_join_requests_requester', 'i', 'lff_join_requests', '-'), ('lff_join_requests_post', 'i', 'lff_join_requests', '-'),
          ('lff_post_creations', 'r', NULL, '-'), ('lff_post_creations_pkey', 'i', 'lff_post_creations', 'p'),
          ('lff_post_creations_recent', 'i', 'lff_post_creations', '-'),
          ('lff_post_snapshots', 'r', NULL, '-'), ('lff_post_snapshots_pkey', 'i', 'lff_post_snapshots', 'p'),
          ('lff_moderation_evidence', 'v', NULL, '-')
        ) AS e(name, kind, on_table, flag)
        FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                     FROM pg_class c
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%') AS a
          ON a.relname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_038_down_refused: relation(s) not exactly as 038 created them, or not 038''s (%)', wrong;
  END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'lff\_%' ORDER BY c.relname::text COLLATE "C" LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n > 0 THEN data := data || CASE WHEN data = '' THEN '' ELSE ', ' END || t || ' ' || n; END IF;
  END LOOP;
  IF data <> '' THEN
    RAISE EXCEPTION 'migration_038_down_refused: LFF data exists (%); dropping it would lose it, and no down script of this chain loses data', data;
  END IF;
END
$$;
DROP VIEW relay_wonderland.lff_moderation_evidence;
DROP TABLE relay_wonderland.lff_post_snapshots, relay_wonderland.lff_post_creations, relay_wonderland.lff_join_requests, relay_wonderland.lff_posts;
-- Nothing named lff_* remains, and no LFF foreign key still references players.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%') THEN
    RAISE EXCEPTION 'migration_038_down_postcheck: lff_* relation(s) remain (%)',
      (SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") FROM pg_class c
        WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.players'::regclass AND k.conname LIKE 'lff\_%') THEN
    RAISE EXCEPTION 'migration_038_down_postcheck: an LFF foreign key still references players';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '038_wonderland_lff';
COMMIT;
