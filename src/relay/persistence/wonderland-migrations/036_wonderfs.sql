BEGIN;
-- WONDERFS: the project file system's METADATA (contract r1.4, frozen 2026-10-11: WONDERFS_CONTRACT.r1.4.md 6aaa424d, §10.2). Every Project
-- Avatar's project has one WonderFS project (INV-10, always on: no table, column or row here turns it off). The semantics live in the
-- reviewed reference engine (src/relay/wonderfs/wonderfs-engine.ts); these tables PERSIST its state, and the constraints below repeat its
-- invariants as defence in depth (INV-4 linear revisions, INV-8 idempotency, INV-9 case-insensitive path uniqueness, INV-7 every
-- version kept, and §19.m3 / N-MAJOR-1 no blob deleted while a version or a retained conflict names it).
--
-- NUMBER 036, PROVISIONAL: the next number after 035 (voice). The founder orders it relative to 035 before it is claimed (contract §13), and
-- whichever lane reaches main second renumbers (the founder's 10-04 rule). Applied to a persistent store only after 035, by its own reviewed
-- apply; it reaches the Julius live store only under the founder's five protections, and then as the EMPTY schema only (no WonderFS data
-- ever lives there; protected-store.ts refuses every runner there).
-- ADDITIVE ONLY: 16 new tables, all named wfs_*, referencing relay_wonderland.projects (001) once. It changes no existing column,
-- constraint, index or row. Its one foreign key out of wfs_* adds the two internal RI triggers on projects and makes a projects DELETE
-- fail while a WonderFS project exists (a project is soft-deleted, never deleted under its files).
-- DDL ONLY: it writes no row but its own ledger stamp. One transaction: the guard, the tables, the post-check and the stamp, or nothing.
--
-- DEFERRED KEYS: the six foreign keys a project PURGE crosses mid-cascade (a blob a version, an entry, a base entry or a retained
-- conflict names; a parent branch; a resolving commit) are DEFERRABLE INITIALLY DEFERRED. PostgreSQL checks an immediate NO ACTION key
-- when its trigger fires, i.e. when the cascade deletes the blob, before it reaches the versions that name it; deferred, the check runs
-- at COMMIT, after the whole cascade. Outside a purge nothing changes: deleting a blob something names is still REFUSED (at commit,
-- the transaction rolled back whole), so no history is ever lost (the real-PG suite's case C proves both).
-- BLOBS: wfs_blobs records every blob a project holds (its size, where its bytes are). The bytes live in wfs_blob_bytes (bytea: the dev /
-- test store, and the Alpha store until the bucket passes T-STORE, §10.2) or in the Railway bucket. WHAT IS NEVER HERE: bucket or backup
-- credentials, grant tokens in clear (only their sha256), player sessions (a commit's session id is a non-authenticating reference, §19.m1).

-- THE GUARD (the 035 template's shape). The list below is the one docs/julius-migrations/036/precheck.sql, postcheck.sql and down.sql
-- carry, entry for entry: (name, relkind, the table it belongs to, p = primary key / u = unique / - = neither).
DO $$
DECLARE
  present text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') THEN
    RAISE EXCEPTION 'migration_036_refused: 035 is not applied here; 036 comes after it on the chain';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '036_wonderfs') THEN
    RAISE EXCEPTION 'migration_036_refused: 036 is already applied here';
  END IF;
  IF (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations) <> '035_wonderland_voice' THEN
    RAISE EXCEPTION 'migration_036_refused: the ledger''s last stamp is %, not 035; 036 follows 035 directly, so nothing later may be applied before it (the ledger would show a gap)',
      (SELECT max(version COLLATE "C") FROM relay_wonderland.schema_migrations);
  END IF;
  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") INTO present
    FROM pg_class c
   WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\_%';
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'migration_036_refused: relation(s) named wfs_* already exist in relay_wonderland (%); 036 creates all 37 or nothing', present;
  END IF;
  RAISE NOTICE 'migration_036_precheck: 035 applied and the ledger''s last, 036 not; no wfs_* relation exists; projects %; ledger %',
    (SELECT count(*) FROM relay_wonderland.projects), (SELECT count(*) FROM relay_wonderland.schema_migrations);
END
$$;

-- A WonderFS project: its main chain's genesis (§19.M7) and its gapless event counter (D-5). Soft delete only (§3, §11).
CREATE TABLE relay_wonderland.wfs_projects(
  project_id text NOT NULL,
  genesis_hash text NOT NULL CHECK(genesis_hash ~ '^[0-9a-f]{64}$'),
  next_event_seq bigint NOT NULL DEFAULT 1 CHECK(next_event_seq >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  CONSTRAINT wfs_projects_pkey PRIMARY KEY(project_id),
  CONSTRAINT wfs_projects_project_fk FOREIGN KEY(project_id) REFERENCES relay_wonderland.projects(project_id),
  CONSTRAINT wfs_projects_soft_delete CHECK((deleted_at IS NULL) = (purge_after IS NULL))
);

-- A branch: main (exactly one per project, id 'main') or an agent branch forked from a parent at a revision (§6.5, §19.M7).
CREATE TABLE relay_wonderland.wfs_branches(
  project_id text NOT NULL,
  branch_id text NOT NULL CHECK(branch_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  kind text NOT NULL CHECK(kind IN ('main', 'agent')),
  parent_branch_id text,
  fork_rev integer CHECK(fork_rev >= 0),
  owner jsonb,
  head_rev integer NOT NULL DEFAULT 0 CHECK(head_rev >= 0),
  head_commit_hash text NOT NULL CHECK(head_commit_hash ~ '^[0-9a-f]{64}$'),
  anchor_hash text NOT NULL CHECK(anchor_hash ~ '^[0-9a-f]{64}$'),
  closed_how text CHECK(closed_how IN ('merged', 'discarded')),
  closed_at timestamptz,
  closed_target_rev integer CHECK(closed_target_rev >= 1),
  closed_reason text CHECK(char_length(closed_reason) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfs_branches_pkey PRIMARY KEY(project_id, branch_id),
  CONSTRAINT wfs_branches_project_fk FOREIGN KEY(project_id) REFERENCES relay_wonderland.wfs_projects(project_id) ON DELETE CASCADE,
  CONSTRAINT wfs_branches_parent_fk FOREIGN KEY(project_id, parent_branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT wfs_branches_main_is_main CHECK((kind = 'main') = (branch_id = 'main')),
  CONSTRAINT wfs_branches_main_has_no_parent CHECK((kind = 'main') = (parent_branch_id IS NULL)),
  CONSTRAINT wfs_branches_fork_point CHECK((parent_branch_id IS NULL) = (fork_rev IS NULL)),
  CONSTRAINT wfs_branches_agent_has_owner CHECK((kind = 'main') = (owner IS NULL)),
  CONSTRAINT wfs_branches_closed CHECK((closed_how IS NULL) = (closed_at IS NULL) AND (kind = 'agent' OR closed_how IS NULL))
);

-- Every blob a project holds (§10.1: re-hashed server-side; per-project addressing, INV-5). 64 MiB per file (§11).
CREATE TABLE relay_wonderland.wfs_blobs(
  project_id text NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  size bigint NOT NULL CHECK(size >= 0 AND size <= 67108864),
  store text NOT NULL CHECK(store IN ('pg', 'bucket')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfs_blobs_pkey PRIMARY KEY(project_id, sha256),
  CONSTRAINT wfs_blobs_project_fk FOREIGN KEY(project_id) REFERENCES relay_wonderland.wfs_projects(project_id) ON DELETE CASCADE
);

-- The bytes of a blob whose store is 'pg' (the WfsBlobStore's Postgres implementation).
CREATE TABLE relay_wonderland.wfs_blob_bytes(
  project_id text NOT NULL,
  sha256 text NOT NULL,
  bytes bytea NOT NULL,
  CONSTRAINT wfs_blob_bytes_pkey PRIMARY KEY(project_id, sha256),
  CONSTRAINT wfs_blob_bytes_blob_fk FOREIGN KEY(project_id, sha256) REFERENCES relay_wonderland.wfs_blobs(project_id, sha256) ON DELETE CASCADE
);

-- The CURRENT entry of every file and directory a branch can see, tombstones included (the engine's `entries`). A live path is unique
-- per branch on the fold key lower(upper(NFC(path))) (INV-9, enforced by the database). A file names a blob the project holds.
CREATE TABLE relay_wonderland.wfs_entries(
  project_id text NOT NULL,
  branch_id text NOT NULL,
  file_id text NOT NULL CHECK(file_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  kind text NOT NULL CHECK(kind IN ('file', 'dir')),
  path text NOT NULL CHECK(char_length(path) BETWEEN 1 AND 200),
  path_key text NOT NULL CHECK(char_length(path_key) >= 1),
  sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  size bigint CHECK(size >= 0),
  deleted boolean NOT NULL,
  version integer NOT NULL CHECK(version >= 1),
  content_version integer NOT NULL CHECK(content_version >= 1),
  path_version integer NOT NULL CHECK(path_version >= 1),
  created_rev integer NOT NULL CHECK(created_rev >= 0),
  updated_rev integer NOT NULL,
  CONSTRAINT wfs_entries_pkey PRIMARY KEY(project_id, branch_id, file_id),
  CONSTRAINT wfs_entries_branch_fk FOREIGN KEY(project_id, branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) ON DELETE CASCADE,
  CONSTRAINT wfs_entries_blob_fk FOREIGN KEY(project_id, sha256) REFERENCES relay_wonderland.wfs_blobs(project_id, sha256) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT wfs_entries_content CHECK((kind = 'file' AND sha256 IS NOT NULL AND size IS NOT NULL) OR (kind = 'dir' AND sha256 IS NULL AND size IS NULL)),
  CONSTRAINT wfs_entries_revs CHECK(updated_rev >= created_rev)
);
CREATE UNIQUE INDEX wfs_entries_live_path ON relay_wonderland.wfs_entries(project_id, branch_id, path_key) WHERE NOT deleted;

-- An agent branch's base: its parent's entries at the fork (what merge-back judges against, D-6).
CREATE TABLE relay_wonderland.wfs_branch_base(
  project_id text NOT NULL,
  branch_id text NOT NULL,
  file_id text NOT NULL CHECK(file_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  kind text NOT NULL CHECK(kind IN ('file', 'dir')),
  path text NOT NULL CHECK(char_length(path) BETWEEN 1 AND 200),
  path_key text NOT NULL CHECK(char_length(path_key) >= 1),
  sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  size bigint CHECK(size >= 0),
  deleted boolean NOT NULL,
  version integer NOT NULL CHECK(version >= 1),
  content_version integer NOT NULL CHECK(content_version >= 1),
  path_version integer NOT NULL CHECK(path_version >= 1),
  created_rev integer NOT NULL CHECK(created_rev >= 0),
  updated_rev integer NOT NULL,
  CONSTRAINT wfs_branch_base_pkey PRIMARY KEY(project_id, branch_id, file_id),
  CONSTRAINT wfs_branch_base_branch_fk FOREIGN KEY(project_id, branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) ON DELETE CASCADE,
  CONSTRAINT wfs_branch_base_blob_fk FOREIGN KEY(project_id, sha256) REFERENCES relay_wonderland.wfs_blobs(project_id, sha256) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT wfs_branch_base_content CHECK((kind = 'file' AND sha256 IS NOT NULL AND size IS NOT NULL) OR (kind = 'dir' AND sha256 IS NULL AND size IS NULL)),
  CONSTRAINT wfs_branch_base_revs CHECK(updated_rev >= created_rev)
);

-- The commit records: one per revision per branch (INV-4), hash-chained (§9.2, §19.M7). `record` is the WHOLE record the hash covers; the
-- columns repeat its identity, and the checks hold them equal.
CREATE TABLE relay_wonderland.wfs_commits(
  project_id text NOT NULL,
  branch_id text NOT NULL,
  rev integer NOT NULL CHECK(rev >= 1),
  commit_id text NOT NULL CHECK(commit_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  prev_commit_hash text NOT NULL CHECK(prev_commit_hash ~ '^[0-9a-f]{64}$'),
  commit_hash text NOT NULL CHECK(commit_hash ~ '^[0-9a-f]{64}$'),
  record jsonb NOT NULL,
  at timestamptz NOT NULL,
  CONSTRAINT wfs_commits_pkey PRIMARY KEY(project_id, branch_id, rev),
  CONSTRAINT wfs_commits_commit_id UNIQUE(commit_id),
  CONSTRAINT wfs_commits_hash UNIQUE(project_id, commit_hash),
  CONSTRAINT wfs_commits_branch_fk FOREIGN KEY(project_id, branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) ON DELETE CASCADE,
  -- IS NOT DISTINCT FROM, never `=`: a CHECK passes on NULL, so a record MISSING a key must read false, not unknown
  CONSTRAINT wfs_commits_record_identity CHECK(
    record->>'projectId' IS NOT DISTINCT FROM project_id AND record->>'branchId' IS NOT DISTINCT FROM branch_id
    AND record->>'rev' IS NOT DISTINCT FROM rev::text AND record->>'commitId' IS NOT DISTINCT FROM commit_id
    AND record->>'requestId' IS NOT DISTINCT FROM request_id AND record->>'prevCommitHash' IS NOT DISTINCT FROM prev_commit_hash
    AND record->>'commitHash' IS NOT DISTINCT FROM commit_hash)
);

-- EVERY version of every entry, as the commit that made it left it (INV-7; `tree(branch, rev)` and `file(file_id)` history, §6.1). The
-- blob foreign key is what keeps a blob any version names (§19.m3).
CREATE TABLE relay_wonderland.wfs_versions(
  project_id text NOT NULL,
  branch_id text NOT NULL,
  file_id text NOT NULL CHECK(file_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  version integer NOT NULL CHECK(version >= 1),
  rev integer NOT NULL CHECK(rev >= 1),
  kind text NOT NULL CHECK(kind IN ('file', 'dir')),
  path text NOT NULL CHECK(char_length(path) BETWEEN 1 AND 200),
  path_key text NOT NULL CHECK(char_length(path_key) >= 1),
  sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  size bigint CHECK(size >= 0),
  deleted boolean NOT NULL,
  content_version integer NOT NULL CHECK(content_version >= 1),
  path_version integer NOT NULL CHECK(path_version >= 1),
  created_rev integer NOT NULL CHECK(created_rev >= 0),
  updated_rev integer NOT NULL,
  CONSTRAINT wfs_versions_pkey PRIMARY KEY(project_id, branch_id, file_id, version),
  CONSTRAINT wfs_versions_commit_fk FOREIGN KEY(project_id, branch_id, rev) REFERENCES relay_wonderland.wfs_commits(project_id, branch_id, rev) ON DELETE CASCADE,
  CONSTRAINT wfs_versions_blob_fk FOREIGN KEY(project_id, sha256) REFERENCES relay_wonderland.wfs_blobs(project_id, sha256) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT wfs_versions_content CHECK((kind = 'file' AND sha256 IS NOT NULL AND size IS NOT NULL) OR (kind = 'dir' AND sha256 IS NULL AND size IS NULL)),
  CONSTRAINT wfs_versions_made_by_its_commit CHECK(updated_rev = rev AND updated_rev >= created_rev)
);
CREATE INDEX wfs_versions_by_rev ON relay_wonderland.wfs_versions(project_id, branch_id, rev);

-- A request id answers the same way forever (INV-8): what it was (its payload hash) and how it was answered.
CREATE TABLE relay_wonderland.wfs_requests(
  project_id text NOT NULL,
  request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  outcome jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfs_requests_pkey PRIMARY KEY(project_id, request_id),
  CONSTRAINT wfs_requests_project_fk FOREIGN KEY(project_id) REFERENCES relay_wonderland.wfs_projects(project_id) ON DELETE CASCADE
);

-- A refused changeset, stored WHOLE in the transaction that refuses it (INV-2, §6.4); kept for 30 days after it closes (§11).
CREATE TABLE relay_wonderland.wfs_conflicts(
  project_id text NOT NULL,
  conflict_id text NOT NULL CHECK(conflict_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  branch_id text NOT NULL,
  request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  status text NOT NULL CHECK(status IN ('open', 'resolved', 'dismissed', 'superseded')),
  record jsonb NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  resolved_by_commit_id text,
  superseded_by text CHECK(char_length(superseded_by) BETWEEN 1 AND 128),
  retain_until timestamptz,
  CONSTRAINT wfs_conflicts_pkey PRIMARY KEY(project_id, conflict_id),
  CONSTRAINT wfs_conflicts_branch_fk FOREIGN KEY(project_id, branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) ON DELETE CASCADE,
  CONSTRAINT wfs_conflicts_resolution_fk FOREIGN KEY(resolved_by_commit_id) REFERENCES relay_wonderland.wfs_commits(commit_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT wfs_conflicts_closing CHECK((status = 'open') = (closed_at IS NULL) AND (status = 'open' OR retain_until IS NOT NULL)),
  CONSTRAINT wfs_conflicts_record_identity CHECK(record->>'conflictId' IS NOT DISTINCT FROM conflict_id
    AND record->>'branchId' IS NOT DISTINCT FROM branch_id AND record->>'requestId' IS NOT DISTINCT FROM request_id)
);
CREATE INDEX wfs_conflicts_open ON relay_wonderland.wfs_conflicts(project_id, branch_id) WHERE status = 'open';

-- The blobs a conflict's preserved changeset names: held while the record is retained, open or closed (N-MAJOR-1).
CREATE TABLE relay_wonderland.wfs_conflict_blobs(
  project_id text NOT NULL,
  conflict_id text NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wfs_conflict_blobs_pkey PRIMARY KEY(project_id, conflict_id, sha256),
  CONSTRAINT wfs_conflict_blobs_conflict_fk FOREIGN KEY(project_id, conflict_id) REFERENCES relay_wonderland.wfs_conflicts(project_id, conflict_id) ON DELETE CASCADE,
  CONSTRAINT wfs_conflict_blobs_blob_fk FOREIGN KEY(project_id, sha256) REFERENCES relay_wonderland.wfs_blobs(project_id, sha256) DEFERRABLE INITIALLY DEFERRED
);

-- D-5: a per-project gapless sequence of lifecycle events (the counter is wfs_projects.next_event_seq, in the same transaction).
CREATE TABLE relay_wonderland.wfs_events(
  project_id text NOT NULL,
  seq bigint NOT NULL CHECK(seq >= 1),
  kind text NOT NULL CHECK(kind ~ '^[a-z][a-z_.]{0,63}$'),
  body jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfs_events_pkey PRIMARY KEY(project_id, seq),
  CONSTRAINT wfs_events_project_fk FOREIGN KEY(project_id) REFERENCES relay_wonderland.wfs_projects(project_id) ON DELETE CASCADE
);

-- Grants (§8.3, §19.M2): every non-human action runs under exactly one. `main_and_own` is NOT issuable in Alpha (r1.1 F1): the column
-- cannot hold it. A service principal reads only; a clone's grant is cut from a grant, every other one is issued by a person.
CREATE TABLE relay_wonderland.wfs_grants(
  project_id text NOT NULL,
  grant_id text NOT NULL CHECK(grant_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  principal_id text NOT NULL CHECK(char_length(principal_id) BETWEEN 1 AND 128),
  principal_kind text NOT NULL CHECK(principal_kind IN ('julius', 'imported_agent', 'clone', 'service')),
  issued_by jsonb NOT NULL,
  branches text NOT NULL CHECK(branches = 'own'),
  ops text[] NOT NULL CHECK(cardinality(ops) BETWEEN 1 AND 5 AND ops <@ ARRAY['read', 'write', 'delete', 'move', 'merge']::text[]),
  paths text[] NOT NULL CHECK(cardinality(paths) BETWEEN 1 AND 64),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfs_grants_pkey PRIMARY KEY(project_id, grant_id),
  CONSTRAINT wfs_grants_project_fk FOREIGN KEY(project_id) REFERENCES relay_wonderland.wfs_projects(project_id) ON DELETE CASCADE,
  CONSTRAINT wfs_grants_service_reads CHECK(principal_kind <> 'service' OR ops = ARRAY['read']::text[]),
  CONSTRAINT wfs_grants_issuer CHECK(coalesce(issued_by->>'kind', '') IN ('human', 'grant')
    AND (principal_kind = 'clone') = (coalesce(issued_by->>'kind', '') = 'grant'))
);

-- A grant's bearer tokens, by their sha256 only (J-18: authority validates from DURABLE state, never bridge memory).
CREATE TABLE relay_wonderland.wfs_grant_tokens(
  token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
  project_id text NOT NULL,
  grant_id text NOT NULL,
  attempt_id text CHECK(char_length(attempt_id) BETWEEN 1 AND 128),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT wfs_grant_tokens_pkey PRIMARY KEY(token_sha256),
  CONSTRAINT wfs_grant_tokens_grant_fk FOREIGN KEY(project_id, grant_id) REFERENCES relay_wonderland.wfs_grants(project_id, grant_id) ON DELETE CASCADE
);

-- A person's approval of an imported agent's merge, bound to the exact head it approved (§19.M1, N-minor-1).
CREATE TABLE relay_wonderland.wfs_approvals(
  project_id text NOT NULL,
  approval_id text NOT NULL CHECK(approval_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  branch_id text NOT NULL,
  approved_by text NOT NULL CHECK(char_length(approved_by) BETWEEN 1 AND 128),
  approved_head_commit_hash text NOT NULL CHECK(approved_head_commit_hash ~ '^[0-9a-f]{64}$'),
  approved_base_rev integer NOT NULL CHECK(approved_base_rev >= 0),
  approved_at timestamptz NOT NULL,
  CONSTRAINT wfs_approvals_pkey PRIMARY KEY(project_id, approval_id),
  CONSTRAINT wfs_approvals_branch_fk FOREIGN KEY(project_id, branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) ON DELETE CASCADE
);

-- Named snapshots (§5): a name on a branch revision. Julius makes `julius: before <mission_id>` before a merge into main (J-11).
CREATE TABLE relay_wonderland.wfs_snapshots(
  project_id text NOT NULL,
  snapshot_id text NOT NULL CHECK(snapshot_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  branch_id text NOT NULL,
  rev integer NOT NULL CHECK(rev >= 0),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 200),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfs_snapshots_pkey PRIMARY KEY(project_id, snapshot_id),
  CONSTRAINT wfs_snapshots_branch_fk FOREIGN KEY(project_id, branch_id) REFERENCES relay_wonderland.wfs_branches(project_id, branch_id) ON DELETE CASCADE
);

-- POST-CHECK, still inside the transaction: each of the 37 relations exactly as 036 creates it (a permanent table; each index on its
-- table, primary or unique as written, valid), no other relay_wonderland relation named wfs_*, exactly the 22 foreign keys written (one
-- of them, and only one, leaving wfs_*: to projects), and no row in any wfs_* table (036 writes none). Any failure rolls back everything.
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
          ('wfs_projects', 'r', NULL, '-'), ('wfs_projects_pkey', 'i', 'wfs_projects', 'p'),
          ('wfs_branches', 'r', NULL, '-'), ('wfs_branches_pkey', 'i', 'wfs_branches', 'p'),
          ('wfs_blobs', 'r', NULL, '-'), ('wfs_blobs_pkey', 'i', 'wfs_blobs', 'p'),
          ('wfs_blob_bytes', 'r', NULL, '-'), ('wfs_blob_bytes_pkey', 'i', 'wfs_blob_bytes', 'p'),
          ('wfs_entries', 'r', NULL, '-'), ('wfs_entries_pkey', 'i', 'wfs_entries', 'p'), ('wfs_entries_live_path', 'i', 'wfs_entries', 'u'),
          ('wfs_branch_base', 'r', NULL, '-'), ('wfs_branch_base_pkey', 'i', 'wfs_branch_base', 'p'),
          ('wfs_commits', 'r', NULL, '-'), ('wfs_commits_pkey', 'i', 'wfs_commits', 'p'),
          ('wfs_commits_commit_id', 'i', 'wfs_commits', 'u'), ('wfs_commits_hash', 'i', 'wfs_commits', 'u'),
          ('wfs_versions', 'r', NULL, '-'), ('wfs_versions_pkey', 'i', 'wfs_versions', 'p'), ('wfs_versions_by_rev', 'i', 'wfs_versions', '-'),
          ('wfs_requests', 'r', NULL, '-'), ('wfs_requests_pkey', 'i', 'wfs_requests', 'p'),
          ('wfs_conflicts', 'r', NULL, '-'), ('wfs_conflicts_pkey', 'i', 'wfs_conflicts', 'p'), ('wfs_conflicts_open', 'i', 'wfs_conflicts', '-'),
          ('wfs_conflict_blobs', 'r', NULL, '-'), ('wfs_conflict_blobs_pkey', 'i', 'wfs_conflict_blobs', 'p'),
          ('wfs_events', 'r', NULL, '-'), ('wfs_events_pkey', 'i', 'wfs_events', 'p'),
          ('wfs_grants', 'r', NULL, '-'), ('wfs_grants_pkey', 'i', 'wfs_grants', 'p'),
          ('wfs_grant_tokens', 'r', NULL, '-'), ('wfs_grant_tokens_pkey', 'i', 'wfs_grant_tokens', 'p'),
          ('wfs_approvals', 'r', NULL, '-'), ('wfs_approvals_pkey', 'i', 'wfs_approvals', 'p'),
          ('wfs_snapshots', 'r', NULL, '-'), ('wfs_snapshots_pkey', 'i', 'wfs_snapshots', 'p')
        ) AS e(name, kind, on_table, flag)
        FULL JOIN (SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relpersistence
                     FROM pg_class c
                    WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\_%') AS a
          ON a.relname = e.name
    ) AS r
   WHERE NOT r.as_created;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration_036_postcheck: relation(s) not exactly as 036 creates them, or not 036''s (%)', wrong;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\_%';
  IF n <> 22 THEN
    RAISE EXCEPTION 'migration_036_postcheck: the wfs_* tables carry % foreign keys, not the 22 036 writes', n;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class f ON f.oid = k.confrelid
   WHERE k.contype = 'f' AND c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\_%' AND f.relname NOT LIKE 'wfs\_%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conname = 'wfs_projects_project_fk' AND k.confrelid = 'relay_wonderland.projects'::regclass) THEN
    RAISE EXCEPTION 'migration_036_postcheck: % foreign key(s) leave wfs_*; 036 writes exactly 1, wfs_projects -> projects', n;
  END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'wfs\_%' LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'migration_036_postcheck: % holds % row(s), and 036 writes none', t, n;
    END IF;
  END LOOP;
END
$$;

INSERT INTO relay_wonderland.schema_migrations(version) VALUES('036_wonderfs');
COMMIT;
