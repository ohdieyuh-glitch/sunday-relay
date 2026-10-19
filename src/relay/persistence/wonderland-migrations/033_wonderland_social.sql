BEGIN;
-- WONDERLAND SOCIAL (founder, 2026-10-01): friends, requests, blocks, mutes,
-- reports, privacy, recent players, conversations, messages, parties, party
-- invites and the public profile showcase. The DOMAIN rules live in
-- src/relay/social/*.ts and are pure; this is where their records persist, so
-- relationships, messages and parties outlive any one Unreal process.
--
-- FOUNDER DECISION (2026-10-02): the social backend lands in MAIN, and this
-- migration follows main's chain. NUMBER 033 (the founder's canonical ruling,
-- 2026-10-04 16:30Z: 031 = Julius 13(i), 032 = the 030 trigger fix, 033 = this
-- file, 034 = Project Brain, 035 = voice; it was 032 until then). Applied to a
-- persistent store only after 031 and 032, by its own explicit reviewed apply. Registered in wonderland-postgres.ts like every other file here
-- (julius-migration-chain.test.ts holds the directory and the list equal).
-- ADDITIVE AND DDL ONLY: it creates new relay_wonderland.social_* tables, their
-- indexes and one sequence, and writes NO row (a bootstrap leaves every table
-- empty; the store writes social_meta's next_serial with its first id); it
-- changes no existing row. The one existing table it touches is relay_wonderland.players
-- (001), which 21 of its 25 foreign keys reference: each CREATE TABLE that
-- references players locks it (SHARE ROW EXCLUSIVE) until COMMIT, and players
-- gains two internal RI triggers per key, so a players DELETE now cascades into
-- the social tables, and is refused for a party's leader (social_parties.leader_id
-- has no ON DELETE action). Written to the chain's own rules: one transaction,
-- and it stamps schema_migrations with its own version, last.
--
-- EXPLICIT APPLY, GATED AS 030, 031 AND 032 ARE (docs/julius-migrations/033/RUNBOOK.md).
-- STOP, changing nothing, unless 032 is applied and is the ledger's last stamp,
-- 033 is not applied, and NO relation 033 creates exists, nor any other
-- relay_wonderland relation named social_*. The 47 are its 17 tables, the
-- sequence behind social_events.seq and its 29 indexes, the 19 names PostgreSQL
-- chooses itself included (17 primary keys, the unique key, the sequence): a
-- taken implicit name is NOT an error to PostgreSQL, which would quietly create
-- social_privacy_pkey1, so only this guard refuses it. After the CREATEs, still
-- inside this transaction, the result is proven: each of the 47 exactly as
-- created, no other social_* relation, the 25 foreign keys (21 on players) and
-- no row written; any failure rolls it all back. The counts are reported as ONE
-- NOTICE for the deploy record. docs/julius-migrations/033/down.sql drops it all
-- again, and refuses while any social data exists.
--
-- WHAT A RESTART MUST GIVE BACK (founder): profiles, privacy, relationships,
-- requests, blocks, mutes, reports, conversations, messages, read positions,
-- parties, membership, invites, the status a player CHOSE (Available, Away,
-- Busy, Appear offline) and when they were last seen, the id sequence, and the
-- change events clients poll. Never "connected" (true only while a client is
-- talking), and never where a player is or what they are doing: social_presence
-- has location and activity columns, but the store starts both clean at a
-- restart, because the world is in memory and a restored location would name a
-- world that no longer exists (social-postgres.ts, 2026-10-07).
--
-- WHAT IS NEVER HERE: credentials, tokens, prompts, Project Brain content,
-- mission contracts, wallet figures (social-contracts.ts NEVER_SOCIAL_CONCERNS).
-- A message body is the only free text a person writes, and it is capped.

-- THE GUARD. The list below is the one docs/julius-migrations/033/precheck.sql, postcheck.sql and down.sql carry, entry
-- for entry: (name, relkind, the table it belongs to, p = primary key / u = unique / - = neither).
DO $$
DECLARE
  present text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') THEN
    RAISE EXCEPTION 'migration_033_refused: 032 is not applied here; 033 comes after it on the chain (founder ruling 2026-10-04 16:30Z)';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_033_refused: 033 is already applied here';
  END IF;
  IF (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) <> '032_julius_outbox_event_delete_forgets' THEN
    RAISE EXCEPTION 'migration_033_refused: the ledger''s last stamp is %, not 032; 033 follows 032 directly, so nothing later may be applied before it (the ledger would show a gap)',
      (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations);
  END IF;
  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") INTO present
    FROM pg_class c
   WHERE c.relnamespace = 'relay_wonderland'::regnamespace
     AND (c.relname LIKE 'social\_%' OR c.relname::text IN (SELECT e.name FROM (VALUES
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
     ) AS e(name, kind, on_table, flag)));
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'migration_033_refused: relation(s) 033 creates, or named social_*, already exist in relay_wonderland (%); 033 creates all 47 or nothing', present;
  END IF;
  RAISE NOTICE 'migration_033_precheck: 032 applied and the ledger''s last, 033 not; none of its 47 relations, and no social_* relation, exists; players %; ledger %',
    (SELECT count(*) FROM relay_wonderland.players), (SELECT count(*) FROM relay_wonderland.schema_migrations);
END
$$;

-- Who sees what of me. One row per player; absent = the conservative defaults.
CREATE TABLE relay_wonderland.social_privacy(
  player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
  presence_visibility text NOT NULL DEFAULT 'EVERYONE' CHECK(presence_visibility IN('EVERYONE','FRIENDS','PARTY','NOBODY')),
  activity_visibility text NOT NULL DEFAULT 'FRIENDS' CHECK(activity_visibility IN('EVERYONE','FRIENDS','PARTY','NOBODY')),
  location_visibility text NOT NULL DEFAULT 'FRIENDS' CHECK(location_visibility IN('EVERYONE','FRIENDS','PARTY','NOBODY')),
  private_server_visibility text NOT NULL DEFAULT 'NOBODY' CHECK(private_server_visibility IN('EVERYONE','FRIENDS','PARTY','NOBODY')),
  message_policy text NOT NULL DEFAULT 'FRIENDS' CHECK(message_policy IN('EVERYONE','FRIENDS','PARTY','NOBODY')),
  friend_request_policy text NOT NULL DEFAULT 'EVERYONE' CHECK(friend_request_policy IN('EVERYONE','NOBODY')),
  server_join_policy text NOT NULL DEFAULT 'FRIENDS' CHECK(server_join_policy IN('EVERYONE','FRIENDS','PARTY','NOBODY')),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A friendship exists once, as the ordered pair.
CREATE TABLE relay_wonderland.social_friendships(
  user_a text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  since timestamptz NOT NULL,
  PRIMARY KEY(user_a,user_b),
  CHECK(user_a < user_b)
);
CREATE INDEX social_friendships_b ON relay_wonderland.social_friendships(user_b);

CREATE TABLE relay_wonderland.social_friend_requests(
  request_id text PRIMARY KEY,
  from_user text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  to_user text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN('PENDING','ACCEPTED','DECLINED','CANCELLED')),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK(from_user <> to_user)
);
-- At most one PENDING request in each direction.
CREATE UNIQUE INDEX social_friend_requests_one_pending ON relay_wonderland.social_friend_requests(from_user,to_user) WHERE status='PENDING';
CREATE INDEX social_friend_requests_inbox ON relay_wonderland.social_friend_requests(to_user,status);

CREATE TABLE relay_wonderland.social_blocks(
  blocker_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  since timestamptz NOT NULL,
  PRIMARY KEY(blocker_id,blocked_id),
  CHECK(blocker_id <> blocked_id)
);
CREATE INDEX social_blocks_blocked ON relay_wonderland.social_blocks(blocked_id);

CREATE TABLE relay_wonderland.social_mutes(
  muter_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  muted_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  voice boolean NOT NULL,
  messages boolean NOT NULL,
  PRIMARY KEY(muter_id,muted_id),
  CHECK(voice OR messages)
);

-- Filed, never judged here. The content is referenced by id, never copied.
CREATE TABLE relay_wonderland.social_reports(
  report_id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  reported_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  reason text NOT NULL CHECK(reason IN('HARASSMENT','SPAM','INAPPROPRIATE_CONTENT','IMPERSONATION','CHEATING','OTHER')),
  note text NOT NULL DEFAULT '' CHECK(char_length(note) <= 1000),
  subject_ref text,
  filed_at timestamptz NOT NULL
);

-- Each person's own list; never shown to the other side.
CREATE TABLE relay_wonderland.social_recent_players(
  owner_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  context text NOT NULL CHECK(context IN('SESSION','PARTY','GVE','CHALLENGE')),
  context_label text NOT NULL CHECK(char_length(context_label) <= 80),
  met_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,user_id)
);
CREATE INDEX social_recent_players_recent ON relay_wonderland.social_recent_players(owner_id,met_at DESC);

CREATE TABLE relay_wonderland.social_conversations(
  conversation_id text PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN('DIRECT','GROUP','PARTY')),
  title text CHECK(title IS NULL OR char_length(title) <= 60),
  party_id text,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence >= 0),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE relay_wonderland.social_conversation_members(
  conversation_id text NOT NULL REFERENCES relay_wonderland.social_conversations ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  last_read_sequence bigint NOT NULL DEFAULT 0 CHECK(last_read_sequence >= 0),
  PRIMARY KEY(conversation_id,player_id)
);
CREATE INDEX social_conversation_members_player ON relay_wonderland.social_conversation_members(player_id);

-- Numbered per conversation: order and unread are arithmetic on `sequence`.
CREATE TABLE relay_wonderland.social_messages(
  message_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES relay_wonderland.social_conversations ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK(sequence > 0),
  sender_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN('TEXT','PARTY_INVITE','SERVER_INVITE','SYSTEM')),
  body text NOT NULL CHECK(char_length(body) <= 2000),
  ref text,
  sent_at timestamptz NOT NULL,
  UNIQUE(conversation_id,sequence)
);

CREATE TABLE relay_wonderland.social_parties(
  party_id text PRIMARY KEY,
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 40),
  leader_id text NOT NULL REFERENCES relay_wonderland.players,
  privacy text NOT NULL CHECK(privacy IN('OPEN_TO_FRIENDS','INVITE_ONLY','CLOSED')),
  invite_permission text NOT NULL CHECK(invite_permission IN('LEADER_ONLY','ANY_MEMBER')),
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1
);

CREATE TABLE relay_wonderland.social_party_members(
  party_id text NOT NULL REFERENCES relay_wonderland.social_parties ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN('LEADER','MEMBER')),
  joined_at timestamptz NOT NULL,
  self_muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(party_id,player_id)
);
-- One party per person.
CREATE UNIQUE INDEX social_party_members_one_party ON relay_wonderland.social_party_members(player_id);

CREATE TABLE relay_wonderland.social_party_invites(
  invite_id text PRIMARY KEY,
  party_id text NOT NULL REFERENCES relay_wonderland.social_parties ON DELETE CASCADE,
  from_user text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  to_user text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN('PENDING','ACCEPTED','DECLINED','EXPIRED','REVOKED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX social_party_invites_one_pending ON relay_wonderland.social_party_invites(party_id,to_user) WHERE status='PENDING';

-- THE PUBLIC PROFILE: who the player is to others, and the public cards the
-- profile shows. The cards are the domain's PUBLIC types (social-contracts.ts:
-- an agent's name, system, emblem, ratings; a companion's name and colours) --
-- an allowlist by construction, never an agent's configuration.
CREATE TABLE relay_wonderland.social_profiles(
  player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
  display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 40),
  handle text NOT NULL CHECK(char_length(handle) BETWEEN 1 AND 40),
  avatar_ref text NOT NULL CHECK(char_length(avatar_ref) <= 120),
  nation_id text CHECK(nation_id IS NULL OR nation_id IN('ICARUS','NOCTIS','TARTARUS')),
  clan_name text CHECK(clan_name IS NULL OR char_length(clan_name) <= 40),
  relay_dog jsonb NOT NULL,
  primary_agent jsonb,
  active_companion jsonb,
  showcase_agents jsonb NOT NULL DEFAULT '[]'::jsonb,
  showcase_companions jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '[]'::jsonb,
  member_since timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX social_profiles_handle ON relay_wonderland.social_profiles(lower(handle));

-- THE PRESENCE A PLAYER CHOSE AND LAST REPORTED. "Connected" is not stored: it is
-- true only while a client is talking, so after a restart everyone reads OFFLINE
-- until their client reports again -- with their chosen status and last-seen kept.
CREATE TABLE relay_wonderland.social_presence(
  player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
  availability text NOT NULL CHECK(availability IN('AVAILABLE','AWAY','BUSY','APPEAR_OFFLINE')),
  activity text NOT NULL,
  activity_detail text CHECK(activity_detail IS NULL OR char_length(activity_detail) <= 80),
  location jsonb,
  last_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- THE ID SEQUENCE: ids are minted from one serial, so it must outlive the process. No row here: a migration writes
-- no row (Julius's bootstrap leaves every table empty). The store reads a missing next_serial as 1 and writes it
-- with its first minted id, by an upsert (social-postgres.ts).
CREATE TABLE relay_wonderland.social_meta(
  name text PRIMARY KEY,
  value bigint NOT NULL CHECK(value >= 1)
);

-- THE CHANGE EVENTS CLIENTS POLL. An event names the operation and when, and
-- WHO it concerns -- never its content. A block, mute or report concerns only
-- its actor. Kept for a bounded time; a client further behind is told to reset.
CREATE TABLE relay_wonderland.social_events(
  seq bigserial PRIMARY KEY,
  op text NOT NULL CHECK(char_length(op) <= 40),
  at timestamptz NOT NULL,
  audience text[] NOT NULL CHECK(cardinality(audience) BETWEEN 1 AND 256)
);
CREATE INDEX social_events_audience ON relay_wonderland.social_events USING gin(audience);
CREATE INDEX social_events_at ON relay_wonderland.social_events(at);

-- POST-CHECK, still inside the transaction: each of the 47 relations exactly as 033 creates it (a permanent table; the
-- sequence owned by social_events.seq; each index on its table, primary or unique as written, valid), no other
-- relay_wonderland relation named social_*, the 25 foreign keys (21 on players), and no row in social_meta (033
-- writes none). Any failure rolls back everything above.
DO $$
DECLARE
  wrong text;
BEGIN
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
    RAISE EXCEPTION 'migration_033_postcheck: relation(s) not exactly as 033 creates them, or not 033''s (%)', wrong;
  END IF;
  IF (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
       WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%') <> 25
     OR (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
          WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\_%'
            AND k.confrelid = 'relay_wonderland.players'::regclass) <> 21 THEN
    RAISE EXCEPTION 'migration_033_postcheck: the social tables do not carry exactly the 25 foreign keys 033 writes (21 of them on players)';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.social_meta) THEN
    RAISE EXCEPTION 'migration_033_postcheck: social_meta holds a row, and 033 writes none (the store writes next_serial with its first id)';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('033_wonderland_social');
COMMIT;
