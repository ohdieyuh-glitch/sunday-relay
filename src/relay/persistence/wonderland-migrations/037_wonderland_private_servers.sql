BEGIN;
-- WONDERLAND PRIVATE SERVERS: when a player's private server is open, and on which tier (the founder's private-server rules,
-- 2026-10-11). The DECISIONS live in src/relay/social/private-server-lifecycle.ts, which is pure; these two tables PERSIST what they
-- decide from, so that no restart, reconnect, sign-out or second device can start a Free window again or skip a cooldown.
--   - private_server_entitlements: a player's PRO or MAX for a period. The TRUSTED tier: no social route writes it (an operator,
--     or a future billing service, does). No row = FREE, the product's default. There is no TEAM tier (the founder), and FREE is
--     never a row.
--   - private_servers: one lifecycle row per owner (one private server each, `priv_<owner>`). It holds the server's own name (its
--     configuration, kept across restarts), the tier and policy its current cycle opened under, and the cycle's three times fixed
--     AT ACTIVATION from server time. A FREE cycle's window and cooldown are held to the founder's APPROVED RANGES here too (6-8 h,
--     then 4-5 h), so no writer can store a longer window, a shorter cooldown or times out of order. Updates are compare-and-set
--     on `version`.
-- NOTHING HERE DELETES USER DATA. A window ending closes a session; it touches no WonderFS, Project Brain or social row (rule F).
--
-- NUMBER 037, PROVISIONAL (agreed with MAIN JUJU 10-11: 036 WonderFS, 037 this file, 038 Project Brain file-memory; each claimed
-- at landing, in order, and whichever lands later renumbers). Applied to a persistent store only after 036, by its own reviewed
-- apply. It reaches the Julius live store only under the founder's protections, and then only as the EMPTY schema
-- (protected-store.ts refuses every runner there).
-- ADDITIVE ONLY: 2 new tables, each referencing relay_wonderland.players (001) once. It changes no existing column, constraint,
-- index or row. Its two foreign keys add internal RI triggers on players, and a players DELETE now cascades into both tables.
-- DDL ONLY: it writes no row but its own ledger stamp. One transaction: the guard, the tables, the post-check and the stamp, or nothing.

-- THE GUARD (the 035 / 036 template's shape).
DO $$
DECLARE
  present text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '036_wonderfs') THEN
    RAISE EXCEPTION 'migration_037_refused: 036 is not applied here; 037 comes after it on the chain';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '037_wonderland_private_servers') THEN
    RAISE EXCEPTION 'migration_037_refused: 037 is already applied here';
  END IF;
  IF (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) <> '036_wonderfs' THEN
    RAISE EXCEPTION 'migration_037_refused: the ledger''s last stamp is %, not 036; 037 follows 036 directly, so nothing later may be applied before it (the ledger would show a gap)',
      (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations);
  END IF;
  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") INTO present
    FROM pg_class c
   WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%';
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'migration_037_refused: relation(s) named private_server* already exist in relay_wonderland (%); 037 creates all 4 or nothing', present;
  END IF;
  RAISE NOTICE 'migration_037_precheck: 036 applied and the ledger''s last, 037 not; no private_server* relation exists; players %; ledger %',
    (SELECT count(*) FROM relay_wonderland.players), (SELECT count(*) FROM relay_wonderland.schema_migrations);
END
$$;

-- A player's paid server tier for a period: the only source of PRO / MAX. Written by an operator or billing, never by a social route.
CREATE TABLE relay_wonderland.private_server_entitlements(
  player_id text NOT NULL,
  tier text NOT NULL CHECK(tier IN ('PRO', 'MAX')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  source text NOT NULL CHECK(source IN ('operator', 'billing')),
  note text CHECK(note IS NULL OR char_length(note) <= 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_server_entitlements_pkey PRIMARY KEY(player_id),
  CONSTRAINT private_server_entitlements_player_fk FOREIGN KEY(player_id) REFERENCES relay_wonderland.players(player_id) ON DELETE CASCADE,
  CONSTRAINT private_server_entitlements_period CHECK(valid_until IS NULL OR valid_until > valid_from)
);

-- One owner's private server: its name, and the cycle it is in, fixed at activation from server time.
CREATE TABLE relay_wonderland.private_servers(
  owner_id text NOT NULL,
  server_name text NOT NULL CHECK(char_length(server_name) BETWEEN 1 AND 60 AND server_name !~ '[[:cntrl:]]'),
  status text NOT NULL CHECK(status IN ('READY', 'ACTIVE', 'COOLDOWN', 'CONTINUOUS')),
  cycle_tier text NOT NULL CHECK(cycle_tier IN ('FREE', 'PRO', 'MAX')),
  policy_id text NOT NULL CHECK(policy_id ~ '^[a-z0-9-]{1,60}$'),
  activated_at timestamptz,
  active_until timestamptz,
  cooldown_until timestamptz,
  version bigint NOT NULL CHECK(version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT private_servers_pkey PRIMARY KEY(owner_id),
  CONSTRAINT private_servers_owner_fk FOREIGN KEY(owner_id) REFERENCES relay_wonderland.players(player_id) ON DELETE CASCADE,
  -- A FREE row: never opened (no times, READY), or a cycle inside the founder's approved ranges, its times in order.
  CONSTRAINT private_servers_free_cycle CHECK(
    cycle_tier <> 'FREE'
    OR (activated_at IS NULL AND active_until IS NULL AND cooldown_until IS NULL AND status = 'READY')
    OR (activated_at IS NOT NULL AND active_until IS NOT NULL AND cooldown_until IS NOT NULL
        AND active_until - activated_at BETWEEN interval '6 hours' AND interval '8 hours'
        AND cooldown_until - active_until BETWEEN interval '4 hours' AND interval '5 hours'
        AND status IN ('READY', 'ACTIVE', 'COOLDOWN'))
  ),
  -- A PRO / MAX row: continuous, opened at a time, with no window and no cooldown.
  CONSTRAINT private_servers_continuous_cycle CHECK(
    cycle_tier = 'FREE'
    OR (activated_at IS NOT NULL AND active_until IS NULL AND cooldown_until IS NULL AND status = 'CONTINUOUS')
  ),
  CONSTRAINT private_servers_times CHECK(updated_at >= created_at AND (activated_at IS NULL OR activated_at <= updated_at))
);

-- POST-CHECK, still inside the transaction: each of the 4 relations exactly as 037 creates it (a permanent table; each index on its
-- table, primary, valid), no other relay_wonderland relation named private_server*, exactly the 2 foreign keys written (both to
-- players), and no row in either table (037 writes none). Any failure rolls back everything.
DO $$
DECLARE
  wrong text;
  n integer;
  t text;
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
          ('private_server_entitlements', 'r', NULL, '-'), ('private_server_entitlements_pkey', 'i', 'private_server_entitlements', 'p'),
          ('private_servers', 'r', NULL, '-'), ('private_servers_pkey', 'i', 'private_servers', 'p')
        ) AS e(name, kind, on_table, flag)
        FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                     FROM pg_class c
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%') AS a
          ON a.relname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_037_postcheck: relation(s) not exactly as 037 creates them, or not 037''s (%)', wrong;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'migration_037_postcheck: the private_server* tables carry % foreign keys, not the 2 037 writes', n;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\_server%'
     AND k.confrelid = 'relay_wonderland.players'::regclass AND k.confdeltype = 'c';
  IF n <> 2 THEN
    RAISE EXCEPTION 'migration_037_postcheck: % of the 2 foreign keys reference players ON DELETE CASCADE; 037 writes exactly 2', n;
  END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'private\_server%' LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'migration_037_postcheck: % holds % row(s), and 037 writes none', t, n;
    END IF;
  END LOOP;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('037_wonderland_private_servers');
COMMIT;
