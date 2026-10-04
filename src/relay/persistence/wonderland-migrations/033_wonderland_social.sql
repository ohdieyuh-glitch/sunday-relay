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
-- ADDITIVE ONLY: it creates new relay_wonderland.social_* tables and indexes,
-- referencing relay_wonderland.players (001), and touches no existing table or
-- row, so it assumes no store state and is applied once by the version ledger.
-- Written to the chain's own rules: one transaction, and it stamps
-- schema_migrations with its own version.
--
-- WHAT A RESTART MUST GIVE BACK (founder): profiles, privacy, relationships,
-- requests, blocks, mutes, reports, conversations, messages, read positions,
-- parties, membership, invites, the presence a player CHOSE (status, activity,
-- place, last seen -- never "connected", which is true only while a client is
-- talking), the id sequence, and the change events clients poll.
--
-- WHAT IS NEVER HERE: credentials, tokens, prompts, Project Brain content,
-- mission contracts, wallet figures (social-contracts.ts NEVER_SOCIAL_CONCERNS).
-- A message body is the only free text a person writes, and it is capped.

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
  appear_in_recent_players boolean NOT NULL DEFAULT true,
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

-- THE ID SEQUENCE: ids are minted from one serial, so it must outlive the process.
CREATE TABLE relay_wonderland.social_meta(
  name text PRIMARY KEY,
  value bigint NOT NULL CHECK(value >= 1)
);
INSERT INTO relay_wonderland.social_meta(name, value) VALUES('next_serial', 1);

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

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('033_wonderland_social');
COMMIT;
