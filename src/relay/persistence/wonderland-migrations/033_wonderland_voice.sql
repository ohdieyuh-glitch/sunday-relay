BEGIN;
-- WONDERLAND PARTY VOICE (R16, founder ruling 10-04: real voice is EOS Voice). Which EOS ProductUserId (PUID) belongs to which
-- signed-in player. A PUID is a TRANSPORT identity (EOS Connect, device id); who may talk to whom is decided by the bridge from
-- the GitHub-authenticated session, so a PUID is bound to exactly one player (src/relay/social/voice-binding.ts):
--   the first /voice/join binds; a PUID already bound to another player is refused; a player's own different PUID re-binds
--   only from a new session (a fresh sign-in) -- session_id is the bridge's opaque session id, never a token.
-- The party room's id is derived (an HMAC of the party id), so no room is stored here.
--
-- NUMBER 033: the next free number after Wonderland Social's 032 (Julius holds 030 and 031 by agreement). Registered in
-- wonderland-postgres.ts like every other file here (julius-migration-chain.test.ts holds the directory and the list equal).
-- ADDITIVE ONLY: one new table referencing relay_wonderland.players (001); it touches no existing table or row. Written to the
-- chain's own rules: one transaction, and it stamps schema_migrations with its own version.
--
-- WHAT IS NEVER HERE: EOS credentials, access tokens, room tokens, the media server address.
CREATE TABLE relay_wonderland.voice_puid_binding(
  user_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
  puid text NOT NULL UNIQUE CHECK(puid ~ '^[0-9a-f]{32}$'),
  session_id text NOT NULL CHECK(char_length(session_id) BETWEEN 1 AND 128),
  bound_at timestamptz NOT NULL
);

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('033_wonderland_voice');
COMMIT;
