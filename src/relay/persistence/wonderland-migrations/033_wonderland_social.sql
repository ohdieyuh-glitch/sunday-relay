BEGIN;
-- WONDERLAND SOCIAL (033): the durable state behind the hosted social layer and its privacy wall.
--
-- Friends, friend requests, blocks, parties and their invitations, private servers and their invitations, presence in a
-- world instance, Recent Players encounters, direct messages, the profile name the account supplies, the one setting a
-- player controls (visibility), and the command ledger that makes every social write idempotent. The rules live in
-- src/relay/mission/wonderland-social (pure, decided once); this file only holds what they decide, and holds it in a
-- shape that refuses the states the rules forbid:
--   - one party per player (UNIQUE player_id on party members), a friendship stored once (player_low < player_high),
--     nobody befriends, blocks, invites or messages themselves (CHECK a <> b);
--   - visibility and activity are closed vocabularies (CHECK ... IN), so no free text reaches another player's screen;
--   - there is NO "appear in Recent Players" column (P3): Recent Players follows visibility and blocks, at read time.
--
-- ADDITIVE ONLY: new tables, indexes and one sequence in relay_wonderland. No existing table, row, function or trigger
-- is touched, so Julius's write paths (row 13 (i)) are unchanged. Social writes take their own transaction-level
-- advisory lock (key 0x534f4349414c = 'SOCIAL'), never Julius's.
--
-- ORDER, by the founder's migration ruling: 031 Julius, 032 the 030 repair, 033 social, 034 Project Brain, 035 voice.
-- GATES: STOP, changing nothing, unless 032 is in the ledger and none of these tables exists yet. After the change, still
-- inside this transaction, the result is proven; any failure rolls it all back. Reversal: docs/julius-migrations/033/down.sql
-- (it drops the social tables and REFUSES while any of them holds a row, unless the operator states the data loss).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '032_julius_outbox_event_delete_forgets') THEN
    RAISE EXCEPTION 'migration_033_requires_032: 033 is applied only after 032 is in the ledger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'social\_%') THEN
    RAISE EXCEPTION 'migration_033_tables_exist: a relay_wonderland.social_* table already exists; nothing was changed';
  END IF;
END
$$;

CREATE SEQUENCE relay_wonderland.social_join_order;

CREATE TABLE relay_wonderland.social_profiles(
 player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
 display_name text CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 64),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE relay_wonderland.social_settings(
 player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
 visibility text NOT NULL CHECK(visibility IN('EVERYONE','HIDDEN_FROM_STRANGERS')),
 updated_at timestamptz NOT NULL
);
CREATE TABLE relay_wonderland.social_friendships(
 player_low text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 player_high text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(player_low,player_high), CHECK(player_low < player_high)
);
CREATE INDEX social_friendships_high ON relay_wonderland.social_friendships(player_high);
CREATE TABLE relay_wonderland.social_friend_requests(
 from_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 to_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(from_id,to_id), CHECK(from_id <> to_id)
);
CREATE INDEX social_friend_requests_to ON relay_wonderland.social_friend_requests(to_id);
CREATE TABLE relay_wonderland.social_blocks(
 blocker_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 blocked_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE INDEX social_blocks_blocked ON relay_wonderland.social_blocks(blocked_id);
CREATE TABLE relay_wonderland.social_parties(
 party_id text PRIMARY KEY CHECK(party_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 leader_id text NOT NULL REFERENCES relay_wonderland.players,
 created_at timestamptz NOT NULL
);
CREATE TABLE relay_wonderland.social_party_members(
 party_id text NOT NULL REFERENCES relay_wonderland.social_parties ON DELETE CASCADE,
 player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 join_order bigint NOT NULL DEFAULT nextval('relay_wonderland.social_join_order'),
 PRIMARY KEY(party_id,player_id), UNIQUE(player_id)
);
CREATE TABLE relay_wonderland.social_party_invites(
 party_id text NOT NULL REFERENCES relay_wonderland.social_parties ON DELETE CASCADE,
 invitee_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 inviter_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(party_id,invitee_id), CHECK(invitee_id <> inviter_id)
);
CREATE INDEX social_party_invites_invitee ON relay_wonderland.social_party_invites(invitee_id);
CREATE TABLE relay_wonderland.social_servers(
 server_id text PRIMARY KEY CHECK(server_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 owner_id text NOT NULL REFERENCES relay_wonderland.players,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
 created_at timestamptz NOT NULL
);
CREATE INDEX social_servers_owner ON relay_wonderland.social_servers(owner_id);
CREATE TABLE relay_wonderland.social_server_members(
 server_id text NOT NULL REFERENCES relay_wonderland.social_servers ON DELETE CASCADE,
 player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 join_order bigint NOT NULL DEFAULT nextval('relay_wonderland.social_join_order'),
 PRIMARY KEY(server_id,player_id)
);
CREATE INDEX social_server_members_player ON relay_wonderland.social_server_members(player_id);
CREATE TABLE relay_wonderland.social_server_invites(
 server_id text NOT NULL REFERENCES relay_wonderland.social_servers ON DELETE CASCADE,
 invitee_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(server_id,invitee_id)
);
CREATE INDEX social_server_invites_invitee ON relay_wonderland.social_server_invites(invitee_id);
CREATE TABLE relay_wonderland.social_presence(
 player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
 instance_id text NOT NULL CHECK(instance_id ~ '^(public|server):[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$'),
 location jsonb,
 activity text NOT NULL CHECK(activity IN('IDLE','EXPLORING','BUILDING','IN_BATTLE','IN_MISSION','AWAY')),
 dog_id text CHECK(dog_id IS NULL OR dog_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 updated_at timestamptz NOT NULL
);
CREATE INDEX social_presence_instance ON relay_wonderland.social_presence(instance_id);
CREATE TABLE relay_wonderland.social_encounters(
 player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 other_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 instance_id text NOT NULL,
 at timestamptz NOT NULL,
 PRIMARY KEY(player_id,other_id), CHECK(player_id <> other_id)
);
CREATE INDEX social_encounters_recent ON relay_wonderland.social_encounters(player_id,at DESC);
CREATE TABLE relay_wonderland.social_messages(
 message_id text PRIMARY KEY CHECK(message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 from_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 to_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 sent_at timestamptz NOT NULL,
 CHECK(from_id <> to_id)
);
CREATE INDEX social_messages_from ON relay_wonderland.social_messages(from_id,to_id,sent_at);
CREATE INDEX social_messages_to ON relay_wonderland.social_messages(to_id,from_id,sent_at);
CREATE TABLE relay_wonderland.social_commands(
 command_id text PRIMARY KEY CHECK(command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 actor_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 command_kind text NOT NULL,
 outcome jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- POST-CHECK, inside the transaction: exactly the fifteen tables, and none of them can hold the removed P3 switch.
DO $$
DECLARE
  found integer;
BEGIN
  SELECT count(*) INTO found FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'social\_%';
  IF found <> 15 THEN RAISE EXCEPTION 'migration_033_postcheck_tables: expected 15 social tables, found %', found; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'relay_wonderland' AND table_name LIKE 'social\_%'
       AND column_name ILIKE '%recent%'
  ) THEN
    RAISE EXCEPTION 'migration_033_postcheck_p3: a social column names Recent Players';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('033_wonderland_social');
COMMIT;
