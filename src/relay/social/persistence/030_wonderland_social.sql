BEGIN;
-- WONDERLAND SOCIAL (founder, 2026-10-01): friends, requests, blocks, mutes,
-- reports, privacy, recent players, conversations, messages, parties, party
-- invites and the public profile showcase. The DOMAIN rules live in
-- src/relay/social/*.ts and are pure; this is where their records persist, so
-- relationships, messages and parties outlive any one Unreal process.
--
-- A PROPOSAL, NOT YET IN THE CHAIN. It sits beside the social module rather
-- than in wonderland-migrations/ because that directory is the packaged chain
-- (julius-migration-chain.test.ts): a file there is applied to every fresh
-- database. It joins the chain only after the Project Brain lane's 028/029
-- have landed, with its number confirmed then, and only with the founder's OK.
-- Written to the chain's own rules so that move is a rename: one transaction,
-- and it stamps schema_migrations with its own version.
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

-- The owner's chosen public showcase: which agents and companions a profile shows, in the owner's order. References only;
-- the public card is assembled from the agent's own public fields (allowlist), never from its configuration.
CREATE TABLE relay_wonderland.social_profile_showcase(
  player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
  slot text NOT NULL CHECK(slot IN('PRIMARY_AGENT','AGENT','ACTIVE_COMPANION','COMPANION')),
  ref_id text NOT NULL,
  position smallint NOT NULL DEFAULT 0 CHECK(position >= 0),
  PRIMARY KEY(player_id,slot,ref_id)
);
CREATE UNIQUE INDEX social_profile_showcase_one_primary ON relay_wonderland.social_profile_showcase(player_id,slot) WHERE slot IN('PRIMARY_AGENT','ACTIVE_COMPANION');

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('030_wonderland_social');
COMMIT;
