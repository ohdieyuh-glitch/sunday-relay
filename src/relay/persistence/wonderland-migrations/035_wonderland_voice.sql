BEGIN;
-- WONDERLAND PARTY VOICE (R16, founder ruling 10-04: real voice is EOS Voice). Which EOS ProductUserId (PUID) belongs to which
-- signed-in player. A PUID is a TRANSPORT identity (EOS Connect, device id); who may talk to whom is decided by the bridge from
-- the GitHub-authenticated session, so a PUID is bound to exactly one player (src/relay/social/voice-binding.ts):
--   the first /voice/join binds; a PUID already bound to another player is refused; a player's own different PUID re-binds
--   only from a new session (a fresh sign-in) -- session_id is the bridge's opaque session id, never a token.
-- The party room's id is derived (an HMAC of the party id), so no room is stored here.
--
-- NUMBER 035 (the founder's canonical ruling, 2026-10-04 16:30Z: 031 Julius 13(i), 032 the 030 trigger fix, 033 Wonderland Social,
-- 034 Project Brain, 035 this file). Applied to a persistent store only after 034, by its own explicit reviewed apply
-- (FOUNDER_035_APPLY, on the 033 r2 template). Registered in wonderland-postgres.ts like every other file here.
-- ADDITIVE ONLY: one new table referencing relay_wonderland.players (001); it touches no existing table or row. DDL ONLY: it
-- writes no row but its own ledger stamp. One transaction: the guard, the table, the post-check and the stamp, or nothing.
--
-- WHAT IS NEVER HERE: EOS credentials, access tokens, room tokens, the media server address.

-- THE GUARD (the 033 template's shape). The list below is the one docs/julius-migrations/035/precheck.sql, postcheck.sql and
-- down.sql carry, entry for entry: (name, relkind, the table it belongs to, p = primary key / u = unique / - = neither).
DO $$
DECLARE
  present text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '034_project_brain_components') THEN
    RAISE EXCEPTION 'migration_035_refused: 034 is not applied here; 035 comes after it on the chain (founder ruling 2026-10-04 16:30Z)';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') THEN
    RAISE EXCEPTION 'migration_035_refused: 035 is already applied here';
  END IF;
  IF (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) <> '034_project_brain_components' THEN
    RAISE EXCEPTION 'migration_035_refused: the ledger''s last stamp is %, not 034; 035 follows 034 directly, so nothing later may be applied before it (the ledger would show a gap)',
      (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations);
  END IF;
  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") INTO present
    FROM pg_class c
   WHERE c.relnamespace = 'relay_wonderland'::regnamespace
     AND (c.relname LIKE 'voice\_%' OR c.relname::text IN (SELECT e.name FROM (VALUES
       ('voice_puid_binding', 'r', NULL, '-'),
       ('voice_puid_binding_pkey', 'i', 'voice_puid_binding', 'p'),
       ('voice_puid_binding_puid_key', 'i', 'voice_puid_binding', 'u')
     ) AS e(name, kind, on_table, flag)));
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'migration_035_refused: relation(s) 035 creates, or named voice_*, already exist in relay_wonderland (%); 035 creates all 3 or nothing', present;
  END IF;
  RAISE NOTICE 'migration_035_precheck: 034 applied and the ledger''s last, 035 not; none of its 3 relations, and no voice_* relation, exists; players %; ledger %',
    (SELECT count(*) FROM relay_wonderland.players), (SELECT count(*) FROM relay_wonderland.schema_migrations);
END
$$;

CREATE TABLE relay_wonderland.voice_puid_binding(
  user_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,
  puid text NOT NULL UNIQUE CHECK(puid ~ '^[0-9a-f]{32}$'),
  session_id text NOT NULL CHECK(char_length(session_id) BETWEEN 1 AND 128),
  bound_at timestamptz NOT NULL
);

-- POST-CHECK, still inside the transaction: each of the 3 relations exactly as 035 creates it (a permanent table; each index on its
-- table, primary or unique as written, valid), no other relay_wonderland relation named voice_*, exactly ONE foreign key (on
-- players), and no row (035 writes none). Any failure rolls back everything above.
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
    RAISE EXCEPTION 'migration_035_postcheck: relation(s) not exactly as 035 creates them, or not 035''s (%)', wrong;
  END IF;
  IF (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
       WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%') <> 1
     OR (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
          WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\_%'
            AND k.confrelid = 'relay_wonderland.players'::regclass) <> 1 THEN
    RAISE EXCEPTION 'migration_035_postcheck: voice_puid_binding does not carry exactly the 1 foreign key 035 writes (on players)';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.voice_puid_binding) THEN
    RAISE EXCEPTION 'migration_035_postcheck: voice_puid_binding holds a row, and 035 writes none';
  END IF;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('035_wonderland_voice');
COMMIT;
