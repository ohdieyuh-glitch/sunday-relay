-- MIGRATION 033: DOWN. Drops everything 033 created -- its 17 tables, and with them their 29 indexes, the sequence behind
-- social_events.seq, the 25 foreign keys and the 42 internal RI triggers those keys put on relay_wonderland.players --
-- and removes the 033 stamp. (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 033 is applied, nothing
-- after 033 is applied (roll a later migration back first, newest first, so the ledger never shows a gap), each of the
-- 47 relations is exactly as 033 created it and no other relay_wonderland relation is named social_*, and the social
-- tables hold no data: no row in any of them (a next_serial row in social_meta included: ids were minted), and the
-- event sequence never used. DROPPING SOCIAL DATA WOULD LOSE IT, and no down script of this chain loses data (030's refuses
-- where its restore would be invalid; 031's and 032's change no row). With social data, the way back is a founder
-- decision (RUNBOOK.md, rollback (b)).
-- The tables are dropped newest first, which is dependency order, and WITHOUT CASCADE: an object outside 033 that
-- depends on one (a view, a later lane's foreign key) makes its DROP fail (2BP01), and the whole script rolls back.
-- Dropping the foreign keys removes their triggers from players under ACCESS EXCLUSIVE until COMMIT.
-- AFTER RUNNING IT the deployed code must no longer list 033, or the next migrate() re-applies it; a bridge with
-- WONDERLAND_SOCIAL_ENABLED=1 then answers 503 again (no schema, no store).
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  wrong text;
  holding text;
  t text;
  n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_033_down_refused: 033 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '033') THEN
    RAISE EXCEPTION 'migration_033_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '033');
  END IF;
  -- Each of the 47 exactly as 033 created it, and no other social_* relation: the list, and the test, of the migration's
  -- own post-check.
  SELECT string_agg(coalesce(r.name, r.relname), ', ' ORDER BY coalesce(r.name, r.relname) COLLATE "C") INTO wrong
    FROM (
      SELECT e.name, a.relname,
             coalesce(a.oid IS NOT NULL AND a.relkind = e.kind AND a.relpersistence = 'p'
               AND (e.kind <> 'i' OR EXISTS (
                     SELECT 1 FROM pg_index i
                      WHERE i.indexrelid = a.oid AND i.indrelid = to_regclass('relay_wonderland.' || e.on_table)
                        AND i.indisprimary = (e.flag = 'p') AND i.indisunique = (e.flag IN ('p', 'u')) AND i.indisvalid))
               AND (e.kind <> 'S' OR EXISTS (
                     SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = a.oid AND d.refclassid = 'pg_class'::regclass
                        AND d.refobjid = to_regclass('relay_wonderland.' || e.on_table) AND d.deptype = 'a')), false) AS as_created
        FROM (VALUES
          ('social_privacy', 'r', NULL, '-'),
          ('social_friendships', 'r', NULL, '-'),
          ('social_friend_requests', 'r', NULL, '-'),
          ('social_blocks', 'r', NULL, '-'),
          ('social_mutes', 'r', NULL, '-'),
          ('social_reports', 'r', NULL, '-'),
          ('social_recent_players', 'r', NULL, '-'),
          ('social_conversations', 'r', NULL, '-'),
          ('social_conversation_members', 'r', NULL, '-'),
          ('social_messages', 'r', NULL, '-'),
          ('social_parties', 'r', NULL, '-'),
          ('social_party_members', 'r', NULL, '-'),
          ('social_party_invites', 'r', NULL, '-'),
          ('social_profiles', 'r', NULL, '-'),
          ('social_presence', 'r', NULL, '-'),
          ('social_meta', 'r', NULL, '-'),
          ('social_events', 'r', NULL, '-'),
          ('social_events_seq_seq', 'S', 'social_events', '-'),
          ('social_privacy_pkey', 'i', 'social_privacy', 'p'),
          ('social_friendships_pkey', 'i', 'social_friendships', 'p'),
          ('social_friendships_b', 'i', 'social_friendships', '-'),
          ('social_friend_requests_pkey', 'i', 'social_friend_requests', 'p'),
          ('social_friend_requests_one_pending', 'i', 'social_friend_requests', 'u'),
          ('social_friend_requests_inbox', 'i', 'social_friend_requests', '-'),
          ('social_blocks_pkey', 'i', 'social_blocks', 'p'),
          ('social_blocks_blocked', 'i', 'social_blocks', '-'),
          ('social_mutes_pkey', 'i', 'social_mutes', 'p'),
          ('social_reports_pkey', 'i', 'social_reports', 'p'),
          ('social_recent_players_pkey', 'i', 'social_recent_players', 'p'),
          ('social_recent_players_recent', 'i', 'social_recent_players', '-'),
          ('social_conversations_pkey', 'i', 'social_conversations', 'p'),
          ('social_conversation_members_pkey', 'i', 'social_conversation_members', 'p'),
          ('social_conversation_members_player', 'i', 'social_conversation_members', '-'),
          ('social_messages_pkey', 'i', 'social_messages', 'p'),
          ('social_messages_conversation_id_sequence_key', 'i', 'social_messages', 'u'),
          ('social_parties_pkey', 'i', 'social_parties', 'p'),
          ('social_party_members_pkey', 'i', 'social_party_members', 'p'),
          ('social_party_members_one_party', 'i', 'social_party_members', 'u'),
          ('social_party_invites_pkey', 'i', 'social_party_invites', 'p'),
          ('social_party_invites_one_pending', 'i', 'social_party_invites', 'u'),
          ('social_profiles_pkey', 'i', 'social_profiles', 'p'),
          ('social_profiles_handle', 'i', 'social_profiles', 'u'),
          ('social_presence_pkey', 'i', 'social_presence', 'p'),
          ('social_meta_pkey', 'i', 'social_meta', 'p'),
          ('social_events_pkey', 'i', 'social_events', 'p'),
          ('social_events_audience', 'i', 'social_events', '-'),
          ('social_events_at', 'i', 'social_events', '-')
        ) AS e(name, kind, on_table, flag)
        FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                     FROM pg_class c
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%') AS a
          ON a.relname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_033_down_refused: relation(s) not exactly as 033 created them, or not 033''s (%)', wrong;
  END IF;
  -- NO SOCIAL DATA: all 17 tables empty (033 writes no row; a next_serial row means ids were minted), the event
  -- sequence unused.
  FOR t IN SELECT unnest(ARRAY['social_privacy', 'social_friendships', 'social_friend_requests', 'social_blocks', 'social_mutes',
                               'social_reports', 'social_recent_players', 'social_conversations', 'social_conversation_members',
                               'social_messages', 'social_parties', 'social_party_members', 'social_party_invites',
                               'social_profiles', 'social_presence', 'social_meta', 'social_events']) LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n > 0 THEN
      holding := concat_ws(', ', holding, t || ' ' || n);
    END IF;
  END LOOP;
  IF (SELECT is_called FROM relay_wonderland.social_events_seq_seq) THEN
    holding := concat_ws(', ', holding, 'social_events_seq_seq used');
  END IF;
  IF holding IS NOT NULL THEN
    RAISE EXCEPTION 'migration_033_down_refused: social data exists (%); dropping it would lose it, and no down script of this chain loses data', holding;
  END IF;
END
$$;
DROP TABLE relay_wonderland.social_events;
DROP TABLE relay_wonderland.social_meta;
DROP TABLE relay_wonderland.social_presence;
DROP TABLE relay_wonderland.social_profiles;
DROP TABLE relay_wonderland.social_party_invites;
DROP TABLE relay_wonderland.social_party_members;
DROP TABLE relay_wonderland.social_parties;
DROP TABLE relay_wonderland.social_messages;
DROP TABLE relay_wonderland.social_conversation_members;
DROP TABLE relay_wonderland.social_conversations;
DROP TABLE relay_wonderland.social_recent_players;
DROP TABLE relay_wonderland.social_reports;
DROP TABLE relay_wonderland.social_mutes;
DROP TABLE relay_wonderland.social_blocks;
DROP TABLE relay_wonderland.social_friend_requests;
DROP TABLE relay_wonderland.social_friendships;
DROP TABLE relay_wonderland.social_privacy;
-- Nothing named social_* remains (the sequence went with social_events, which owned it), and no foreign key from a
-- social table still references players.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%') THEN
    RAISE EXCEPTION 'migration_033_down_postcheck: social_* relation(s) remain (%)',
      (SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") FROM pg_class c
        WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.players'::regclass AND k.conname LIKE 'social\_%') THEN
    RAISE EXCEPTION 'migration_033_down_postcheck: a social foreign key still references players';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social';
COMMIT;
