-- MIGRATION 036: DOWN. Drops everything 036 created -- its 16 wfs_* tables, and with them their 21 indexes, their 22 foreign keys and the
-- internal RI triggers the one key out of wfs_* put on relay_wonderland.projects -- and removes the 036 stamp. (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 036 is applied, nothing after 036 is applied
-- (roll a later migration back first, newest first, so the ledger never shows a gap), each of the 37 relations is exactly as 036 created
-- it and no other relay_wonderland relation is named wfs_*, and EVERY wfs_* table is empty. DROPPING A PROJECT'S FILES WOULD LOSE THEM,
-- and no down script of this chain loses data. With WonderFS data, the way back is a founder decision.
-- THE COUNT CANNOT RACE THE DROP: every wfs_* table is locked IN SHARE MODE before it is counted, which blocks every write until COMMIT.
-- The tables are dropped in ONE statement WITHOUT CASCADE: an object outside 036 that depends on one of them makes the DROP fail (2BP01),
-- and the whole script rolls back.
-- AFTER RUNNING IT the deployed code must no longer list 036, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '036_wonderfs') THEN
    RAISE EXCEPTION 'migration_036_down_refused: 036 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '036') THEN
    RAISE EXCEPTION 'migration_036_down_refused: a later migration is applied (%); roll it back first, newest first, so the ledger never shows a gap',
      (SELECT string_agg(version, ', ' ORDER BY version COLLATE "C") FROM relay_wonderland.schema_migrations WHERE left(version, 3) COLLATE "C" > '036');
  END IF;
END
$$;
LOCK TABLE relay_wonderland.wfs_projects, relay_wonderland.wfs_branches, relay_wonderland.wfs_blobs, relay_wonderland.wfs_blob_bytes, relay_wonderland.wfs_entries, relay_wonderland.wfs_branch_base, relay_wonderland.wfs_commits, relay_wonderland.wfs_versions, relay_wonderland.wfs_requests, relay_wonderland.wfs_conflicts, relay_wonderland.wfs_conflict_blobs, relay_wonderland.wfs_events, relay_wonderland.wfs_grants, relay_wonderland.wfs_grant_tokens, relay_wonderland.wfs_approvals, relay_wonderland.wfs_snapshots IN SHARE MODE;
DO $$
DECLARE
  wrong text;
  t text;
  n bigint;
  data text := '';
BEGIN
  -- Each of the 37 exactly as 036 created it, and no other wfs_* relation: the list, and the test, of the migration's own post-check.
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
    RAISE EXCEPTION 'migration_036_down_refused: relation(s) not exactly as 036 created them, or not 036''s (%)', wrong;
  END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'wfs\_%' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', t) INTO n;
    IF n > 0 THEN data := data || CASE WHEN data = '' THEN '' ELSE ', ' END || t || ' ' || n; END IF;
  END LOOP;
  IF data <> '' THEN
    RAISE EXCEPTION 'migration_036_down_refused: WonderFS data exists (%); dropping it would lose it, and no down script of this chain loses data', data;
  END IF;
END
$$;
DROP TABLE relay_wonderland.wfs_snapshots, relay_wonderland.wfs_approvals, relay_wonderland.wfs_grant_tokens, relay_wonderland.wfs_grants, relay_wonderland.wfs_events, relay_wonderland.wfs_conflict_blobs, relay_wonderland.wfs_conflicts, relay_wonderland.wfs_requests, relay_wonderland.wfs_versions, relay_wonderland.wfs_commits, relay_wonderland.wfs_branch_base, relay_wonderland.wfs_entries, relay_wonderland.wfs_blob_bytes, relay_wonderland.wfs_blobs, relay_wonderland.wfs_branches, relay_wonderland.wfs_projects;
-- Nothing named wfs_* remains, and no wfs foreign key still references projects.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\_%') THEN
    RAISE EXCEPTION 'migration_036_down_postcheck: wfs_* relation(s) remain (%)',
      (SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text COLLATE "C") FROM pg_class c
        WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\_%');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid = 'relay_wonderland.projects'::regclass AND k.conname LIKE 'wfs\_%') THEN
    RAISE EXCEPTION 'migration_036_down_postcheck: a wfs foreign key still references projects';
  END IF;
END
$$;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '036_wonderfs';
COMMIT;
