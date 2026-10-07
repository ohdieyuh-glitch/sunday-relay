-- MIGRATION 033: POST-DEPLOY CHECK. READ-ONLY; run right AFTER 033 and compare with the pre-check's output.
-- (RUNBOOK.md, step 4.)
-- Every result below is ONE row under a FIXED header: run with psql -A -F '|', each block prints its header line, its
-- row and "(1 row)". These are precheck.sql's blocks, header for header, but the first (checked_at|database).
-- PASS only if ALL of:
--   other_client_sessions = 0 (the writers are still stopped);
--   relations_033_expected = 47, relations_033_present = 47, relations_033_as_created = 47 and social_relations_other = 0;
--   every relation column, social_privacy to social_events_at, = t;
--   every *_rows column = 0 (033 writes no row; the store writes next_serial with its first id);
--   players_rows EQUALS the pre-check's (the writers were stopped for the deploy), players_referenced_by_fks = the
--   pre-check's + 21, and social_fk_constraints = 25;
--   migration_031_applied = t, migration_032_applied = t, migration_033_applied = t, ledger_count = the pre-check's + 1
--   and ledger_last = 033_wonderland_social.
-- catalog_033_md5 is RECORDED, not gated here: it must equal the value this script prints on a throwaway database the
-- landed head's migrate() built (same PostgreSQL major); that comparison belongs to the record's verification.
-- On ANY difference: STOP, and follow RUNBOOK.md's rollback.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() AS checked_at, current_database() AS database;
-- Every other client session on this database. The writers are stopped, and nothing else may be connected.
SELECT count(*) AS other_client_sessions
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
-- THE 47 RELATIONS 033 CREATES (033_wonderland_social.sql: 17 tables, the sequence behind social_events.seq and 29
-- indexes, the 17 primary keys and social_messages' unique key included), each as 033 creates it: a permanent table;
-- the sequence owned by social_events.seq; each index on its table, primary or unique as written, valid. And every
-- OTHER relay_wonderland relation named social_*, which must not exist: a taken implicit name is not an error to
-- PostgreSQL (it would quietly create social_privacy_pkey1). The list is the one the migration and down.sql carry.
SELECT count(r.name) AS relations_033_expected,
       count(r.name) FILTER (WHERE r.relname IS NOT NULL) AS relations_033_present,
       count(r.name) FILTER (WHERE r.as_created) AS relations_033_as_created,
       count(*) FILTER (WHERE r.name IS NULL) AS social_relations_other,
       string_agg(r.relname, ',' ORDER BY r.relname COLLATE "C") FILTER (WHERE r.name IS NULL) AS social_relations_other_names,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_privacy') AS social_privacy,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friendships') AS social_friendships,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friend_requests') AS social_friend_requests,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_blocks') AS social_blocks,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_mutes') AS social_mutes,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_reports') AS social_reports,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_recent_players') AS social_recent_players,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_conversations') AS social_conversations,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_conversation_members') AS social_conversation_members,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_messages') AS social_messages,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_parties') AS social_parties,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_party_members') AS social_party_members,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_party_invites') AS social_party_invites,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_profiles') AS social_profiles,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_presence') AS social_presence,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_meta') AS social_meta,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_events') AS social_events,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_events_seq_seq') AS social_events_seq_seq,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_privacy_pkey') AS social_privacy_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friendships_pkey') AS social_friendships_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friendships_b') AS social_friendships_b,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friend_requests_pkey') AS social_friend_requests_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friend_requests_one_pending') AS social_friend_requests_one_pending,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_friend_requests_inbox') AS social_friend_requests_inbox,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_blocks_pkey') AS social_blocks_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_blocks_blocked') AS social_blocks_blocked,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_mutes_pkey') AS social_mutes_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_reports_pkey') AS social_reports_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_recent_players_pkey') AS social_recent_players_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_recent_players_recent') AS social_recent_players_recent,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_conversations_pkey') AS social_conversations_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_conversation_members_pkey') AS social_conversation_members_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_conversation_members_player') AS social_conversation_members_player,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_messages_pkey') AS social_messages_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_messages_conversation_id_sequence_key') AS social_messages_conversation_id_sequence_key,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_parties_pkey') AS social_parties_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_party_members_pkey') AS social_party_members_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_party_members_one_party') AS social_party_members_one_party,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_party_invites_pkey') AS social_party_invites_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_party_invites_one_pending') AS social_party_invites_one_pending,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_profiles_pkey') AS social_profiles_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_profiles_handle') AS social_profiles_handle,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_presence_pkey') AS social_presence_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_meta_pkey') AS social_meta_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_events_pkey') AS social_events_pkey,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_events_audience') AS social_events_audience,
       bool_or(r.as_created) FILTER (WHERE r.name = 'social_events_at') AS social_events_at
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
  ) AS r;
-- THE 17 TABLES' EXACT ROW COUNTS, counted only where the table exists (NULL where it does not, never an SQL error;
-- counted as 030's rowcounts-store.sql counts).
SELECT max(t.n) FILTER (WHERE t.name = 'social_privacy') AS social_privacy_rows,
       max(t.n) FILTER (WHERE t.name = 'social_friendships') AS social_friendships_rows,
       max(t.n) FILTER (WHERE t.name = 'social_friend_requests') AS social_friend_requests_rows,
       max(t.n) FILTER (WHERE t.name = 'social_blocks') AS social_blocks_rows,
       max(t.n) FILTER (WHERE t.name = 'social_mutes') AS social_mutes_rows,
       max(t.n) FILTER (WHERE t.name = 'social_reports') AS social_reports_rows,
       max(t.n) FILTER (WHERE t.name = 'social_recent_players') AS social_recent_players_rows,
       max(t.n) FILTER (WHERE t.name = 'social_conversations') AS social_conversations_rows,
       max(t.n) FILTER (WHERE t.name = 'social_conversation_members') AS social_conversation_members_rows,
       max(t.n) FILTER (WHERE t.name = 'social_messages') AS social_messages_rows,
       max(t.n) FILTER (WHERE t.name = 'social_parties') AS social_parties_rows,
       max(t.n) FILTER (WHERE t.name = 'social_party_members') AS social_party_members_rows,
       max(t.n) FILTER (WHERE t.name = 'social_party_invites') AS social_party_invites_rows,
       max(t.n) FILTER (WHERE t.name = 'social_profiles') AS social_profiles_rows,
       max(t.n) FILTER (WHERE t.name = 'social_presence') AS social_presence_rows,
       max(t.n) FILTER (WHERE t.name = 'social_meta') AS social_meta_rows,
       max(t.n) FILTER (WHERE t.name = 'social_events') AS social_events_rows
  FROM (
    SELECT e.name,
           CASE WHEN c.relkind = 'r'
                THEN (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM relay_wonderland.%I', e.name), false, true, '')))[1]::text::bigint
           END AS n
      FROM unnest(ARRAY['social_privacy', 'social_friendships', 'social_friend_requests', 'social_blocks', 'social_mutes',
                        'social_reports', 'social_recent_players', 'social_conversations', 'social_conversation_members',
                        'social_messages', 'social_parties', 'social_party_members', 'social_party_invites', 'social_profiles',
                        'social_presence', 'social_meta', 'social_events']) AS e(name)
      LEFT JOIN pg_class c ON c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname = e.name
  ) AS t;
-- THE SOCIAL CATALOG, by definition and free of oids: every column, constraint and index of every relay_wonderland
-- relation named social_*, and the sequence. NULL while none exists. RECORDED, not gated: a throwaway database migrated
-- by the landed head prints the same digest (the real-PostgreSQL suite's DOCS case proves the two paths agree).
SELECT md5(string_agg(l.line, chr(10) ORDER BY l.line COLLATE "C")) AS catalog_033_md5
  FROM (
    SELECT 'relation ' || c.relname || ' kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text AS line
      FROM pg_class c
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%'
    UNION ALL
    SELECT 'column ' || c.relname || ' #' || a.attnum::text || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' not-null' ELSE '' END || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%' AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint ' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%'
    UNION ALL
    SELECT 'index ' || pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%'
    UNION ALL
    SELECT 'sequence ' || c.relname || ' ' || format_type(s.seqtypid, NULL) || ' start=' || s.seqstart::text
           || ' inc=' || s.seqincrement::text || ' min=' || s.seqmin::text || ' max=' || s.seqmax::text
           || ' cache=' || s.seqcache::text || ' cycle=' || s.seqcycle::text
      FROM pg_sequence s
      JOIN pg_class c ON c.oid = s.seqrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%'
  ) AS l;
-- THE ONE EXISTING TABLE 033 TOUCHES: players' rows (they must not change), the foreign keys that reference it (033 adds
-- 21), and the foreign keys the social tables carry (033 writes 25).
SELECT (SELECT count(*) FROM relay_wonderland.players) AS players_rows,
       (SELECT count(*) FROM pg_constraint k
         WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.players'::regclass) AS players_referenced_by_fks,
       (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
         WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%') AS social_fk_constraints;
SELECT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot') AS migration_031_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') AS migration_032_applied,
       EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') AS migration_033_applied,
       (SELECT count(*) FROM relay_wonderland.schema_migrations) AS ledger_count,
       (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) AS ledger_last;
COMMIT;
