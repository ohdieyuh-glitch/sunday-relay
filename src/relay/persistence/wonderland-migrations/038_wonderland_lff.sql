BEGIN;
-- WONDERLAND LFF, the "Looking For Feed" (the private-Alpha launch gate, founder 2026-10-12; contract
-- _qa_handoff/lff/LFF_ALPHA_CONTRACT_r1_20261012.md with its AMENDMENT r2 / r2.1, persistence per LFF_DEPENDENCY_AUDIT_20261012.md
-- section 4). A player posts what they are looking for (a team, builders, AI engineers, designers, competitors, collaborators); other
-- players ask to join; the owner accepts or declines. The RULES live in src/relay/social/social-lff.ts (pure) and social-commands.ts
-- (input validation); these three tables PERSIST what those rules decide, so that no bridge restart loses a post, a request or a cap:
--   - lff_posts: one row per post, owned by a player. A hard delete (the owner's delete) cascades its requests.
--   - lff_join_requests: one row per request to join a post. At most ONE live (PENDING or ACCEPTED) request per (post, requester).
--     Requests carry NO version column (contract r2); posts keep theirs.
--   - lff_post_creations: one row per post a player CREATED, kept after the post is closed or deleted (its post_id has NO foreign
--     key, so a post delete leaves it), so the creation cap (r2: 10 posts per rolling 24 h per player, deleted and closed ones
--     counted) survives a delete and a restart. The domain prunes rows older than 24 h when it writes; a player delete cascades.
-- EVERY CHECK MIRRORS A DOMAIN RULE AND IS A BACKSTOP: the domain refuses first (a class-23 refusal here surfaces as
-- validation-failed), so these never replace the server's own validation.
--   - Text: lengths in CODE POINTS (char_length), and none of the characters the domain refuses (social-commands.ts
--     hasControlCharacter + hasC1Control): C0 U+0001-U+001F, DEL U+007F, C1 U+0080-U+009F, and the line / paragraph separators
--     U+2028 / U+2029 -- line breaks included, in the description too (the contract: "control characters are refused everywhere",
--     the 10-07 log-injection rule). The set is written as an EXPLICIT class of code points, never the POSIX cntrl class, whose
--     meaning follows the database's locale (under C it misses C1 and U+2028/9; under ICU it also refuses format characters such
--     as U+200D ZWJ, which every multi-person emoji holds and the domain accepts). U+0000 cannot occur in PostgreSQL text.
--   - Skills: 0-8 items, each 1-32 code points, none of those characters, no NULL item, one dimension. A CHECK may not read a
--     subquery or a set-returning function (no unnest), so the rule is two whole-array regexes over array_to_string: joined with
--     NO separator and NULL items written as U+0001, the text must hold no refused character (so no item holds one, and no item
--     is NULL); joined with U+001F, a refused character no item can now hold, it must be 1-32 allowed characters between
--     separators (so each item is 1-32 code points, the empty item included). Case and duplicates are the domain's.
--   - Statuses are EXACTLY what social-lff.ts stores. A post: OPEN or CLOSED (LffStoredPostStatus). EXPIRED is NEVER stored: the
--     domain derives it at read from the server's time (lffPostStatusAt), and only STRICTLY AFTER expires_at -- at exactly
--     expires_at a stored OPEN post still reads OPEN. A request: PENDING, ACCEPTED, DECLINED, WITHDRAWN or CANCELLED
--     (LFF_REQUEST_STATUSES; CANCELLED = crossed by a block, which survives an unblock, may cancel an ACCEPTED request and so free
--     its slot, and is shown to nobody). The requester's NO_LONGER_AVAILABLE is a view, never stored.
--   - Time is the SERVER's. The 14-day expiry is PROPOSED (founder decision D-L2) and lives in social-lff.ts (LFF_POST_TTL_MS),
--     never here: the schema holds only a SANITY bound (expires_at more than 0 and at most 30 days after created_at), as 037
--     holds its Free window to sanity bounds.
--   - The caps (5 open posts, 10 creations per rolling 24 h, 20 pending out per player, 50 pending per post) and the 10-minute
--     re-request window after a withdraw are PROPOSED and the domain's alone; the schema keeps only the facts they are read from.
-- WHAT NO PLAIN CHECK CAN SAY, ENFORCED BY THE DOMAIN ONLY: a requester is never the post's owner (a rule across two tables), a
-- request is made only to an OPEN post, and a block either way hides a post and cancels the requests it crosses.
-- PREFIX lff_, NEVER social_: 033's committed postcheck and down scripts match every social\_% relation and count its foreign keys.
-- No other relay_wonderland relation is named lff_*.
--
-- NUMBER 038, PROVISIONAL (037 calls 038 "Project Brain file-memory"; no 038 exists in any ref. Each number is claimed AT LANDING,
-- in order; whichever of LFF and the Julius file-memory lands second renumbers: the file name, the guard strings, the stamp, the
-- constant, the docs folder and the test file. Founder decision D-L4). Applied to a persistent store only after 037, by its own
-- reviewed apply. It reaches the Julius live store only under the founder's protections, and then only as the EMPTY schema
-- (protected-store.ts refuses every runner there).
-- ADDITIVE ONLY: 3 new tables. Each references relay_wonderland.players (001) once; lff_join_requests also references lff_posts. It
-- changes no existing column, constraint, index or row. Its three keys to players add internal RI triggers on players, and a
-- players DELETE now cascades into all three tables.
-- DDL ONLY: it writes no row but its own ledger stamp. One transaction: the guard, the tables, the post-check and the stamp, or nothing.

-- THE GUARD (the 035 / 036 / 037 template's shape).
DO $$
DECLARE
  present text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '037_wonderland_private_servers') THEN
    RAISE EXCEPTION 'migration_038_refused: 037 is not applied here; 038 comes after it on the chain';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '038_wonderland_lff') THEN
    RAISE EXCEPTION 'migration_038_refused: 038 is already applied here';
  END IF;
  IF (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) <> '037_wonderland_private_servers' THEN
    RAISE EXCEPTION 'migration_038_refused: the ledger''s last stamp is %, not 037; 038 follows 037 directly, so nothing later may be applied before it (the ledger would show a gap)',
      (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations);
  END IF;
  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") INTO present
    FROM pg_class c
   WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%';
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'migration_038_refused: relation(s) named lff_* already exist in relay_wonderland (%); 038 creates all 13 or nothing', present;
  END IF;
  RAISE NOTICE 'migration_038_precheck: 037 applied and the ledger''s last, 038 not; no lff_* relation exists; players %; ledger %',
    (SELECT count(*) FROM relay_wonderland.players), (SELECT count(*) FROM relay_wonderland.schema_migrations);
END
$$;

-- One post: what its owner is looking for, the owner's own words, and its lifecycle in server time.
CREATE TABLE relay_wonderland.lff_posts(
  post_id text NOT NULL,
  owner_id text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  project_label text NOT NULL,
  skills text[] NOT NULL,
  open_slots integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL,
  CONSTRAINT lff_posts_pkey PRIMARY KEY(post_id),
  CONSTRAINT lff_posts_owner_fk FOREIGN KEY(owner_id) REFERENCES relay_wonderland.players(player_id) ON DELETE CASCADE,
  -- `lffp_<serial>`: social-state.ts mintId over the social serial (social_meta.next_serial), a positive integer.
  CONSTRAINT lff_posts_post_id_shape CHECK(post_id ~ '^lffp_[1-9][0-9]{0,17}$'),
  CONSTRAINT lff_posts_category CHECK(category IN ('TEAMS', 'BUILDERS', 'AI_ENGINEERS', 'DESIGNERS', 'COMPETITORS', 'COLLABORATORS')),
  CONSTRAINT lff_posts_title CHECK(char_length(title) BETWEEN 1 AND 80 AND title !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'),
  CONSTRAINT lff_posts_description CHECK(char_length(description) <= 1000 AND description !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'),
  CONSTRAINT lff_posts_project_label CHECK(char_length(project_label) <= 80 AND project_label !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'),
  CONSTRAINT lff_posts_skills CHECK(
    cardinality(skills) <= 8
    AND coalesce(array_ndims(skills), 1) = 1
    AND array_to_string(skills, '', E'\x01') !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'
    AND (cardinality(skills) = 0
         OR array_to_string(skills, E'\x1f') ~ '^[^\u0001-\u001f\u007f-\u009f\u2028\u2029]{1,32}(\u001f[^\u0001-\u001f\u007f-\u009f\u2028\u2029]{1,32})*$')
  ),
  CONSTRAINT lff_posts_open_slots CHECK(open_slots BETWEEN 1 AND 20),
  -- EXPIRED is never stored: it is read, strictly after expires_at (social-lff.ts lffPostStatusAt; OPEN at exactly expires_at).
  CONSTRAINT lff_posts_status CHECK(status IN ('OPEN', 'CLOSED')),
  CONSTRAINT lff_posts_version CHECK(version >= 1),
  -- A SANITY bound, not policy: the 14-day expiry is PROPOSED and lives in social-lff.ts (LFF_POST_TTL_MS).
  CONSTRAINT lff_posts_times CHECK(updated_at >= created_at AND expires_at > created_at AND expires_at - created_at <= interval '30 days')
);
-- The chronological feed (newest first), the feed by category, and an owner's own posts (which also serves the players cascade).
CREATE INDEX lff_posts_feed ON relay_wonderland.lff_posts(created_at DESC, post_id);
CREATE INDEX lff_posts_category_feed ON relay_wonderland.lff_posts(category, created_at DESC);
CREATE INDEX lff_posts_owner ON relay_wonderland.lff_posts(owner_id, status);

-- One request to join a post. An accept changes ONLY this row (and, when it fills the post, the post's status): LFF grants nothing.
-- No version column (contract r2): a request changes only its status and updated_at, through the store's single serial queue.
CREATE TABLE relay_wonderland.lff_join_requests(
  request_id text NOT NULL,
  post_id text NOT NULL,
  requester_id text NOT NULL,
  message text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT lff_join_requests_pkey PRIMARY KEY(request_id),
  CONSTRAINT lff_join_requests_post_fk FOREIGN KEY(post_id) REFERENCES relay_wonderland.lff_posts(post_id) ON DELETE CASCADE,
  CONSTRAINT lff_join_requests_requester_fk FOREIGN KEY(requester_id) REFERENCES relay_wonderland.players(player_id) ON DELETE CASCADE,
  -- `lffr_<serial>` (mintId), as a post's id.
  CONSTRAINT lff_join_requests_request_id_shape CHECK(request_id ~ '^lffr_[1-9][0-9]{0,17}$'),
  CONSTRAINT lff_join_requests_message CHECK(char_length(message) <= 200 AND message !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'),
  -- EXACTLY social-lff.ts LFF_REQUEST_STATUSES. CANCELLED: a request a block crossed (it survives an unblock, may cancel an ACCEPTED
  -- request, freeing its slot, and is shown to nobody). NO_LONGER_AVAILABLE is the requester's VIEW, never stored.
  CONSTRAINT lff_join_requests_status CHECK(status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED')),
  CONSTRAINT lff_join_requests_times CHECK(updated_at >= created_at)
);
-- At most ONE LIVE request per (post, requester): PENDING or ACCEPTED, the domain's own rule (social-lff.ts createLffRequest refuses
-- a new request while the pair holds a PENDING one, or an ACCEPTED one; acceptedCount counts ACCEPTED rows, so a duplicate would
-- fill two slots with one person). A declined, withdrawn or cancelled request does not hold the slot, so the same player may ask
-- again (after the domain's re-request window). The social_friend_requests_one_pending precedent (033), widened to ACCEPTED.
CREATE UNIQUE INDEX lff_join_requests_one_live ON relay_wonderland.lff_join_requests(post_id, requester_id) WHERE status IN ('PENDING', 'ACCEPTED');
CREATE INDEX lff_join_requests_requester ON relay_wonderland.lff_join_requests(requester_id, status);
CREATE INDEX lff_join_requests_post ON relay_wonderland.lff_join_requests(post_id, status);

-- One row per post a player created, for the creation cap (r2.1). post_id has NO foreign key: the post may be closed or deleted and
-- still counts. Written with the post, in the same store transaction; pruned by the domain after 24 h; a player delete cascades.
CREATE TABLE relay_wonderland.lff_post_creations(
  owner_id text NOT NULL,
  post_id text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT lff_post_creations_pkey PRIMARY KEY(owner_id, post_id),
  CONSTRAINT lff_post_creations_owner_fk FOREIGN KEY(owner_id) REFERENCES relay_wonderland.players(player_id) ON DELETE CASCADE,
  CONSTRAINT lff_post_creations_post_id_shape CHECK(post_id ~ '^lffp_[1-9][0-9]{0,17}$')
);
-- A player's creations in the window, newest last.
CREATE INDEX lff_post_creations_recent ON relay_wonderland.lff_post_creations(owner_id, created_at);

-- POST-CHECK, still inside the transaction: each of the 13 relations exactly as 038 creates it (a permanent table; each index on its
-- table, primary / unique-and-partial / plain, valid) and no other relay_wonderland relation named lff_*; each of the 22 constraints
-- exactly as written (kind, table, validated; each foreign key to its table ON DELETE CASCADE) and no other on the lff_* tables;
-- and no row in any of the three tables (038 writes none). Any failure rolls back everything.
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
                        AND i.indisprimary = (e.flag = 'p') AND i.indisunique = (e.flag IN ('p', 'u'))
                        AND (i.indpred IS NOT NULL) = (e.flag = 'u') AND i.indisvalid)), false) AS as_created
        FROM (VALUES
          ('lff_posts', 'r', NULL, '-'), ('lff_posts_pkey', 'i', 'lff_posts', 'p'),
          ('lff_posts_feed', 'i', 'lff_posts', '-'), ('lff_posts_category_feed', 'i', 'lff_posts', '-'), ('lff_posts_owner', 'i', 'lff_posts', '-'),
          ('lff_join_requests', 'r', NULL, '-'), ('lff_join_requests_pkey', 'i', 'lff_join_requests', 'p'),
          ('lff_join_requests_one_live', 'i', 'lff_join_requests', 'u'),
          ('lff_join_requests_requester', 'i', 'lff_join_requests', '-'), ('lff_join_requests_post', 'i', 'lff_join_requests', '-'),
          ('lff_post_creations', 'r', NULL, '-'), ('lff_post_creations_pkey', 'i', 'lff_post_creations', 'p'),
          ('lff_post_creations_recent', 'i', 'lff_post_creations', '-')
        ) AS e(name, kind, on_table, flag)
        FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                     FROM pg_class c
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%') AS a
          ON a.relname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_038_postcheck: relation(s) not exactly as 038 creates them, or not 038''s (%)', wrong;
  END IF;
  -- contype 'n' (a NOT NULL catalogued as a constraint, PostgreSQL 18+) is a column property here, read by no rule below.
  SELECT string_agg(coalesce(r.name, r.conname), ', ' ORDER BY coalesce(r.name, r.conname) COLLATE "C") INTO wrong
    FROM (
      SELECT e.name, a.conname,
             coalesce(a.oid IS NOT NULL AND a.contype = e.kind AND a.convalidated
               AND a.conrelid = to_regclass('relay_wonderland.' || e.on_table)
               AND (e.kind <> 'f' OR (a.confrelid = to_regclass('relay_wonderland.' || e.refs) AND a.confdeltype = 'c')), false) AS as_created
        FROM (VALUES
          ('lff_posts_pkey', 'p', 'lff_posts', NULL), ('lff_posts_owner_fk', 'f', 'lff_posts', 'players'),
          ('lff_posts_post_id_shape', 'c', 'lff_posts', NULL), ('lff_posts_category', 'c', 'lff_posts', NULL),
          ('lff_posts_title', 'c', 'lff_posts', NULL), ('lff_posts_description', 'c', 'lff_posts', NULL),
          ('lff_posts_project_label', 'c', 'lff_posts', NULL), ('lff_posts_skills', 'c', 'lff_posts', NULL),
          ('lff_posts_open_slots', 'c', 'lff_posts', NULL), ('lff_posts_status', 'c', 'lff_posts', NULL),
          ('lff_posts_version', 'c', 'lff_posts', NULL), ('lff_posts_times', 'c', 'lff_posts', NULL),
          ('lff_join_requests_pkey', 'p', 'lff_join_requests', NULL),
          ('lff_join_requests_post_fk', 'f', 'lff_join_requests', 'lff_posts'),
          ('lff_join_requests_requester_fk', 'f', 'lff_join_requests', 'players'),
          ('lff_join_requests_request_id_shape', 'c', 'lff_join_requests', NULL), ('lff_join_requests_message', 'c', 'lff_join_requests', NULL),
          ('lff_join_requests_status', 'c', 'lff_join_requests', NULL), ('lff_join_requests_times', 'c', 'lff_join_requests', NULL),
          ('lff_post_creations_pkey', 'p', 'lff_post_creations', NULL),
          ('lff_post_creations_owner_fk', 'f', 'lff_post_creations', 'players'),
          ('lff_post_creations_post_id_shape', 'c', 'lff_post_creations', NULL)
        ) AS e(name, kind, on_table, refs)
        FULL JOIN (SELECT k.oid, k.conname::text AS conname, k.contype::text AS contype, k.conrelid, k.confrelid, k.confdeltype, k.convalidated
                     FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%' AND k.contype <> 'n') AS a
          ON a.conname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_038_postcheck: constraint(s) not exactly as 038 creates them, or not 038''s (%)', wrong;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\_%'
     AND k.confrelid = 'relay_wonderland.players'::regclass AND k.confdeltype = 'c';
  IF n <> 3 THEN
    RAISE EXCEPTION 'migration_038_postcheck: % foreign key(s) of the lff_* tables reference players ON DELETE CASCADE; 038 writes exactly 3', n;
  END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'lff\_%' LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'migration_038_postcheck: % holds % row(s), and 038 writes none', t, n;
    END IF;
  END LOOP;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('038_wonderland_lff');
COMMIT;
