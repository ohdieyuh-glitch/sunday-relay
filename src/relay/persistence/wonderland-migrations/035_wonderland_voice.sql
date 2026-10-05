BEGIN;
-- WONDERLAND VOICE (035): which EOS product user each Wonderland player PROVED to be, the history of those bindings,
-- and the record of every voice-room token the trusted server issued and took back. NEVER A TOKEN: the issuance row
-- says who was given a token for which room and when, and the post-check refuses any column that could hold one.
--
-- IN THE CHAIN AFTER 034, by the founder's order (034 Project Brain, then 035 voice). It was staged in
-- docs/julius-migrations/035/ until a 034 existed; its runbook and DOWN stay there (docs/julius-migrations/035/).
--
-- ADDITIVE ONLY: three voice_* tables in relay_wonderland. Nothing existing changes.
-- GATES: STOP, changing nothing, unless 033 is applied, a 034 stamp is in the ledger, and no voice_* table exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_035_requires_033: voice binds players the social layer knows; apply 033 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version LIKE '034\_%') THEN
    RAISE EXCEPTION 'migration_035_requires_034: 034 comes before 035, and the ledger never shows a gap';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'voice\_%') THEN
    RAISE EXCEPTION 'migration_035_tables_exist: a relay_wonderland.voice_* table already exists; nothing was changed';
  END IF;
END
$$;

CREATE TABLE relay_wonderland.voice_identities(
 player_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
 product_user_id text NOT NULL UNIQUE CHECK(product_user_id ~ '^[0-9a-f]{32}$'),
 bound_at timestamptz NOT NULL
);
CREATE TABLE relay_wonderland.voice_identity_history(
 binding_seq bigserial PRIMARY KEY,
 player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 product_user_id text NOT NULL CHECK(product_user_id ~ '^[0-9a-f]{32}$'),
 bound_at timestamptz NOT NULL
);
CREATE INDEX voice_identity_history_player ON relay_wonderland.voice_identity_history(player_id, binding_seq);
CREATE TABLE relay_wonderland.voice_issuances(
 player_id text NOT NULL REFERENCES relay_wonderland.players ON DELETE CASCADE,
 room_id text NOT NULL CHECK(room_id ~ '^wl_[0-9a-f]{32}$'),
 -- The EOS identity the token ADMITS: a removal takes out this identity, whatever the player is bound to by then.
 product_user_id text NOT NULL CHECK(product_user_id ~ '^[0-9a-f]{32}$'),
 issued_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(player_id, room_id),
 CHECK(revoked_at IS NULL OR revoked_at >= issued_at)
);
CREATE INDEX voice_issuances_open ON relay_wonderland.voice_issuances(player_id) WHERE revoked_at IS NULL;

-- POST-CHECK, inside the transaction: exactly the three tables, and no column that could hold a token or a secret.
DO $$
DECLARE
  found integer;
BEGIN
  SELECT count(*) INTO found FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'voice\_%';
  IF found <> 3 THEN RAISE EXCEPTION 'migration_035_postcheck_tables: expected 3 voice tables, found %', found; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'relay_wonderland' AND table_name LIKE 'voice\_%'
       AND (column_name ILIKE '%token%' OR column_name ILIKE '%secret%')
  ) THEN
    RAISE EXCEPTION 'migration_035_postcheck_no_token: a voice column could hold a token or a secret';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('035_wonderland_voice');
COMMIT;
