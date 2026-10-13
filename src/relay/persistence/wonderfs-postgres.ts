import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { WFS_ALPHA_LIMITS, type WfsBranchId, type WfsCommit, type WfsCommitOutcome, type WfsConflict, type WfsEntry, type WfsLimits, type WfsMergeApproval, type WfsPrincipal } from '../wonderfs/wonderfs-contracts';
import { wfsHumanRoleFromMembership, type WfsHumanRole } from '../wonderfs/wonderfs-authz';
import {
  applyWfsCommit,
  discardWfsBranch,
  emptyWfsProject,
  forkWfsBranch,
  issueWfsApproval,
  mergeBackWfsBranch,
  WFS_MAIN_BRANCH,
  type WfsBranchState,
  type WfsEngineContext,
  type WfsProjectState,
  type WfsStoredRequest,
} from '../wonderfs/wonderfs-engine';
import {
  wfsAdmitCommit,
  wfsAdmitWrite,
  wfsConflictLimits,
  wfsConflictLimitsApply,
  wfsBlobIntegrity,
  wfsBlobRoom,
  wfsBlobsNamed,
  wfsBoundPage,
  wfsCheckUpload,
  wfsHashMismatch,
  wfsSha256InSlices,
  wfsCheckChangesQuery,
  wfsCheckConflictsQuery,
  wfsCheckEventsQuery,
  wfsCheckFileAtQuery,
  wfsCheckHistoryQuery,
  wfsCheckProjectsQuery,
  wfsCheckSha256,
  wfsCheckTreeQuery,
  wfsConflictClosing,
  wfsEncodeTreeCursor,
  wfsIsSha256,
  wfsIso,
  wfsNotFound,
  wfsOutcomeEvent,
  type WfsBlobInfo,
  type WfsBlobIntegrity,
  type WfsChangesPage,
  type WfsConflictsPage,
  type WfsConflictTally,
  type WfsConflictStatus,
  type WfsConflictSummary,
  type WfsConflictView,
  type WfsEventRecord,
  type WfsEventsPage,
  type WfsFileAt,
  type WfsFileVersion,
  type WfsHistoryPage,
  type WfsMemberProject,
  type WfsProjectHead,
  type WfsProjectsPage,
  type WfsReferencedBlob,
  type WfsStore,
  type WfsStoreEvent,
  type WfsTreePage,
} from '../wonderfs/wonderfs-store';
import { protectedStoreWriterGuard } from './protected-store-writer-guard';

export { WFS_CONFLICT_RETENTION_MS, type WfsStoreEvent } from '../wonderfs/wonderfs-store';

/**
 * WONDERFS ON POSTGRESQL (migration 036; contract r1.4 §10): the reference engine (wonderfs-engine.ts) decides; this store
 * PERSISTS what it decided, so a project's files, history, branches, conflicts and idempotency answers outlive every process.
 * It implements `WfsStore` (wonderfs-store.ts), the interface the routes depend on; the in-memory store implements the same one
 * over the same engine, and one conformance suite runs against both.
 *
 * ONE MUTATION = ONE TRANSACTION (§10.1):
 *   1. the project row is locked (`SELECT ... FOR UPDATE` on wfs_projects): every change to one project is serialised across
 *      every bridge, and its `next_event_seq` is the project's version. A DELIBERATE DEVIATION from §6.3's per-branch head lock,
 *      on the stricter side: D-5's events need ONE gapless sequence per project, and the engine decides on the whole project's
 *      state, so two branches of one project never commit in parallel here (still READ COMMITTED, never SERIALIZABLE). Alpha's
 *      scale (§11) makes the lost parallelism immaterial; per-branch locking is a post-Alpha optimisation, for review;
 *   2. the project's state is the cached one only if that version still matches, else it is READ BACK from the rows, inside the
 *      same transaction;
 *   3. the engine runs (time is the server's; ids are random). BLOB PRESENCE IS READ FROM wfs_blobs INSIDE THIS TRANSACTION for
 *      exactly the addresses the request names (R0b, F5): never from a process cache, so a blob another bridge stored (a deploy
 *      overlap) counts, and a blob that is gone fails the deferred keys at COMMIT;
 *   4. exactly the rows the change made are written -- new commits with their versions, the entries they touched, new or moved
 *      branches, new or closed conflicts (with the blobs they hold), the request's answer, ONE event -- and the version moves;
 *   5. COMMIT, and only then is the new state adopted. Anything failing rolls it all back: nothing half-written, ever.
 *   An idempotent REPLAY (the same request id and payload) changes nothing and writes nothing (INV-8).
 *
 * EVERY READ IS ONE SNAPSHOT (R0b, F4): a read that takes more than one statement runs in ONE `REPEATABLE READ READ ONLY`
 * transaction, so a commit landing between its statements is invisible to it (READ COMMITTED would mix the two states: a head
 * revision from before the commit with entries from after it). The cached state is reused only when the snapshot's project
 * version equals the cache's.
 *
 * BLOBS (§10.1, §10.2): `putBlob` hashes the bytes HERE, so a blob's address is never the client's word; the Alpha / test store is
 * PostgreSQL `bytea` (wfs_blob_bytes) behind this interface, until the Railway bucket passes T-STORE. The schema refuses deleting a
 * blob anything still names (N-MAJOR-1). R2 (§19.m3): an upload takes the project's row lock FOR UPDATE -- serialised with every
 * commit and every other upload of the project, on every bridge -- so its room check (main's live bytes + the pending bytes of every
 * blob no file's history names, `PROJECT_ROOM_SQL`) is exact when it decides, and a refused upload keeps no byte.
 *
 * WRITES WITH AN AUTHORITY (R2): the member's role is read INSIDE the write's transaction, `FOR SHARE` on its project_members row
 * (`lockedRoleNow`): a removal or demotion committed before it is seen; one attempted during it waits until this write ends. It is
 * judged before the engine runs, so before the replay lookup. Every write transaction is READ COMMITTED, stated (contract §6.3; the
 * FOR SHARE re-read after a wait relies on it). LOCK ORDER: the project row first, then the membership row (wonderfs-store.ts).
 *
 * A COMMIT LOADS WHAT IT DECIDES ON, NO MORE (R2-r2, security MAJOR-2(d)): the branches with their entries and fork-time bases, the
 * ONE request row its id names and the ONE conflict it resolves -- never every commit record, conflict record and request of the
 * project (`loadWfsProject(..., { history: false })` + `askedFor`). The whole state is loaded only by `project()` (tools, the oracle)
 * and by the agent-phase changes (fork, merge, approve, discard), which no player reaches.
 *
 * TWO PASSES FOR THE ENTRIES (R2-r2, correctness B1): `wfs_entries_live_path` is a unique INDEX (not deferrable), and one commit may
 * free a path and take it again (delete + create of the same path; a rename chain). So every touched row is first taken out of the
 * live set (`deleted = true`), then each final state is written; the engine's whole-tree check guarantees the final states agree.
 *
 * WHAT IS NEVER HERE: the Julius live store. Like every Wonderland writer, this refuses a PROTECTED store before its first read or
 * write (protected-store-writer-guard.ts): WonderFS data lives in the Wonderland database only.
 */

/** Anything that runs a query: a pool, a client, or a CALLER's transaction (createProjectIn). */
export type WfsQueryable = Pick<PoolClient, 'query'>;
type Queryable = WfsQueryable;

interface CachedProject {
  readonly state: WfsProjectState;
  /** wfs_projects.next_event_seq when this state was read or written: the project's version. */
  readonly seq: number;
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const iso = (at: Date | string | null): string | null => (at === null ? null : new Date(at).toISOString());

/* ------------------------------------------------------------------------------------------------------------- read back */

interface EntryRow {
  branch_id: string;
  file_id: string;
  kind: 'file' | 'dir';
  path: string;
  path_key: string;
  sha256: string | null;
  size: string | null;
  deleted: boolean;
  version: number;
  content_version: number;
  path_version: number;
  created_rev: number;
  updated_rev: number;
}

/** The entry columns, as every entry-shaped table (wfs_entries, wfs_branch_base, wfs_versions) holds them. */
const ENTRY_COLUMNS = 'branch_id, file_id, kind, path, path_key, sha256, size::text AS size, deleted, version, content_version, path_version, created_rev, updated_rev';
/** The same columns, unconverted, for a UNION over the entry-shaped tables. */
const ENTRY_RAW = 'branch_id, file_id, kind, path, path_key, sha256, size, deleted, version, content_version, path_version, created_rev, updated_rev';

/**
 * Whether anything of project $1 names address $2 -- a version, a current or fork-time entry, a retained conflict, on any branch --
 * and the size it was stored with (null: not held). ONE row, always: the four EXISTS run whether or not the address is held, so an
 * unknown address and a held-but-unreferenced upload cost the same work (R1 security review MINOR-2).
 */
const BLOB_REFERENCE_SQL = `SELECT (SELECT b.size FROM relay_wonderland.wfs_blobs b WHERE b.project_id = $1 AND b.sha256 = $2)::text AS size,
  (EXISTS (SELECT 1 FROM relay_wonderland.wfs_versions v WHERE v.project_id = $1 AND v.sha256 = $2)
   OR EXISTS (SELECT 1 FROM relay_wonderland.wfs_entries e WHERE e.project_id = $1 AND e.sha256 = $2)
   OR EXISTS (SELECT 1 FROM relay_wonderland.wfs_branch_base x WHERE x.project_id = $1 AND x.sha256 = $2)
   OR EXISTS (SELECT 1 FROM relay_wonderland.wfs_conflict_blobs c WHERE c.project_id = $1 AND c.sha256 = $2)) AS referenced`;

/**
 * R2 (§19.m3, §11): project $1's room, in ONE row -- main's live file bytes, and the PENDING bytes of every blob it holds that no
 * file's history names: no version, current or fork-time entry, on any branch. A blob only a conflict names counts as pending too
 * (R2-r2, security MAJOR-3): it stays READABLE while the conflict is retained (BLOB_REFERENCE_SQL, N-MAJOR-1) but it is room taken.
 * Anti-joins: each table read once for the project.
 */
const PROJECT_ROOM_SQL = `SELECT
  (SELECT coalesce(sum(e.size), 0) FROM relay_wonderland.wfs_entries e
    WHERE e.project_id = $1 AND e.branch_id = 'main' AND e.kind = 'file' AND NOT e.deleted)::text AS live_bytes,
  (SELECT coalesce(sum(b.size), 0) FROM relay_wonderland.wfs_blobs b
    WHERE b.project_id = $1
      AND NOT EXISTS (SELECT 1 FROM relay_wonderland.wfs_versions v WHERE v.project_id = b.project_id AND v.sha256 = b.sha256)
      AND NOT EXISTS (SELECT 1 FROM relay_wonderland.wfs_entries x WHERE x.project_id = b.project_id AND x.sha256 = b.sha256)
      AND NOT EXISTS (SELECT 1 FROM relay_wonderland.wfs_branch_base f WHERE f.project_id = b.project_id AND f.sha256 = b.sha256))::text AS pending_bytes`;

/**
 * R2-r3: player $2's conflicts in project $1 at $3 -- how many are OPEN, how many are RETAINED (open, or closed and inside their 30
 * days), and the earliest retention end among the closed retained ones (when the next one frees). One row, always.
 */
const CONFLICT_TALLY_SQL = `SELECT count(*) FILTER (WHERE status = 'open')::text AS open,
    count(*) FILTER (WHERE status = 'open' OR retain_until > $3::timestamptz)::text AS retained,
    min(retain_until) FILTER (WHERE status <> 'open' AND retain_until > $3::timestamptz) AS next_free
  FROM relay_wonderland.wfs_conflicts
  WHERE project_id = $1 AND record->'principal'->>'kind' = 'human' AND record->'principal'->>'id' = $2`;

const entryOf = (r: EntryRow): WfsEntry => ({
  fileId: r.file_id,
  kind: r.kind,
  path: r.path,
  pathKey: r.path_key,
  sha256: r.sha256,
  size: r.size === null ? null : Number(r.size),
  deleted: r.deleted,
  version: r.version,
  contentVersion: r.content_version,
  pathVersion: r.path_version,
  createdRev: r.created_rev,
  updatedRev: r.updated_rev,
});

/**
 * A project's whole state, read back from its rows (or null: no such project, or deleted). Its statements are only consistent
 * with each other inside ONE snapshot or under the project's row lock: callers give it exactly that (`project()`, `mutate`).
 * `history: false` (R2-r2): the branches with their entries and bases only -- every branch's `commits`, and the project's conflicts and
 * requests, come back EMPTY (a commit asks for the one request and the one conflict it needs: `askedFor`).
 */
export async function loadWfsProject(db: Queryable, projectId: string, options: { readonly history?: boolean } = {}): Promise<{ state: WfsProjectState; seq: number } | null> {
  const history = options.history ?? true;
  const project = await db.query<{ next_event_seq: string }>(
    'SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL',
    [projectId],
  );
  if (project.rows.length === 0) return null;
  const branches = await db.query<{
    branch_id: string; kind: 'main' | 'agent'; parent_branch_id: string | null; fork_rev: number | null; owner: WfsPrincipal | null; head_rev: number;
    head_commit_hash: string; anchor_hash: string; closed_how: 'merged' | 'discarded' | null; closed_at: Date | null; closed_target_rev: number | null;
  }>(
    `SELECT branch_id, kind, parent_branch_id, fork_rev, owner, head_rev, head_commit_hash, anchor_hash, closed_how, closed_at, closed_target_rev
       FROM relay_wonderland.wfs_branches WHERE project_id = $1`,
    [projectId],
  );
  const entries = await db.query<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM relay_wonderland.wfs_entries WHERE project_id = $1`, [projectId]);
  const bases = await db.query<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM relay_wonderland.wfs_branch_base WHERE project_id = $1`, [projectId]);
  const commits: { rows: Array<{ branch_id: string; record: WfsCommit }> } = history
    ? await db.query<{ branch_id: string; record: WfsCommit }>('SELECT branch_id, record FROM relay_wonderland.wfs_commits WHERE project_id = $1 ORDER BY branch_id, rev', [projectId])
    : { rows: [] };
  const conflicts: { rows: Array<{ record: WfsConflict }> } = history
    ? await db.query<{ record: WfsConflict }>('SELECT record FROM relay_wonderland.wfs_conflicts WHERE project_id = $1', [projectId])
    : { rows: [] };
  const requests: { rows: Array<{ request_id: string; payload_hash: string; outcome: WfsCommitOutcome }> } = history
    ? await db.query<{ request_id: string; payload_hash: string; outcome: WfsCommitOutcome }>('SELECT request_id, payload_hash, outcome FROM relay_wonderland.wfs_requests WHERE project_id = $1', [projectId])
    : { rows: [] };

  const byBranch = <T extends { branch_id: string }>(rows: readonly T[]): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const r of rows) out.set(r.branch_id, [...(out.get(r.branch_id) ?? []), r]);
    return out;
  };
  const entriesBy = byBranch(entries.rows);
  const basesBy = byBranch(bases.rows);
  const commitsBy = byBranch(commits.rows);
  const branchStates = new Map<WfsBranchId, WfsBranchState>();
  for (const b of branches.rows) {
    branchStates.set(b.branch_id, {
      branchId: b.branch_id,
      kind: b.kind,
      parent: b.parent_branch_id === null ? null : { branchId: b.parent_branch_id, forkRev: b.fork_rev as number },
      owner: b.owner,
      headRev: b.head_rev,
      headCommitHash: b.head_commit_hash,
      anchorHash: b.anchor_hash,
      entries: new Map((entriesBy.get(b.branch_id) ?? []).map((r) => [r.file_id, entryOf(r)])),
      base: new Map((basesBy.get(b.branch_id) ?? []).map((r) => [r.file_id, entryOf(r)])),
      commits: (commitsBy.get(b.branch_id) ?? []).map((r) => r.record),
      closed: b.closed_how === null ? null : { how: b.closed_how, atIso: iso(b.closed_at) as string, targetRev: b.closed_target_rev },
    });
  }
  const state: WfsProjectState = {
    projectId,
    branches: branchStates,
    conflicts: new Map(conflicts.rows.map((r) => [r.record.conflictId, r.record])),
    requests: new Map<string, WfsStoredRequest>(requests.rows.map((r) => [r.request_id, { payloadHash: r.payload_hash, outcome: r.outcome }])),
  };
  return { state, seq: Number(project.rows[0].next_event_seq) };
}

/** R2-r2: the ONE request row `requestId` names and the ONE conflict `conflictId` names, if any (what a commit decides on besides the tree). */
async function askedFor(db: Queryable, projectId: string, requestId: unknown, conflictId: unknown): Promise<{ requests: Map<string, WfsStoredRequest>; conflicts: Map<string, WfsConflict> }> {
  const requests = new Map<string, WfsStoredRequest>();
  if (typeof requestId === 'string') {
    const r = await db.query<{ payload_hash: string; outcome: WfsCommitOutcome }>('SELECT payload_hash, outcome FROM relay_wonderland.wfs_requests WHERE project_id = $1 AND request_id = $2', [projectId, requestId]);
    if (r.rows[0] !== undefined) requests.set(requestId, { payloadHash: r.rows[0].payload_hash, outcome: r.rows[0].outcome });
  }
  const conflicts = new Map<string, WfsConflict>();
  if (typeof conflictId === 'string') {
    const c = await db.query<{ record: WfsConflict }>('SELECT record FROM relay_wonderland.wfs_conflicts WHERE project_id = $1 AND conflict_id = $2', [projectId, conflictId]);
    if (c.rows[0] !== undefined) conflicts.set(conflictId, c.rows[0].record);
  }
  return { requests, conflicts };
}

/** A state with its history dropped: every branch's commits, and the conflicts and requests (what a commit's cache may keep). */
const withoutHistory = (state: WfsProjectState): WfsProjectState => ({
  projectId: state.projectId,
  branches: new Map([...state.branches].map(([id, b]) => [id, { ...b, commits: [] }])),
  conflicts: new Map(),
  requests: new Map(),
});

/* ---------------------------------------------------------------------------------------------------------- write through */

async function insertEntry(db: Queryable, table: 'wfs_entries' | 'wfs_branch_base', projectId: string, branchId: string, e: WfsEntry): Promise<void> {
  await db.query(
    `INSERT INTO relay_wonderland.${table}(project_id, branch_id, file_id, kind, path, path_key, sha256, size, deleted, version, content_version, path_version, created_rev, updated_rev)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(project_id, branch_id, file_id) DO UPDATE SET kind=EXCLUDED.kind, path=EXCLUDED.path, path_key=EXCLUDED.path_key, sha256=EXCLUDED.sha256,
       size=EXCLUDED.size, deleted=EXCLUDED.deleted, version=EXCLUDED.version, content_version=EXCLUDED.content_version, path_version=EXCLUDED.path_version,
       created_rev=EXCLUDED.created_rev, updated_rev=EXCLUDED.updated_rev`,
    [projectId, branchId, e.fileId, e.kind, e.path, e.pathKey, e.sha256, e.size, e.deleted, e.version, e.contentVersion, e.pathVersion, e.createdRev, e.updatedRev],
  );
}

/**
 * Write exactly what `after` adds to `before` (the engine only ever ADDS commits, branches, conflicts and requests, and moves a
 * branch's head, entries and closing, and a conflict's status). Inside the caller's transaction.
 */
async function persistWfsChange(db: Queryable, projectId: string, before: WfsProjectState, after: WfsProjectState, nowIso: string): Promise<void> {
  // DEFERRED keys (036): a branch's parent, and the blobs its rows name, are checked at COMMIT, after every row here is in
  for (const [branchId, b] of after.branches) {
    const was = before.branches.get(branchId);
    if (was === undefined) {
      await db.query(
        `INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, parent_branch_id, fork_rev, owner, head_rev, head_commit_hash, anchor_hash, created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projectId, branchId, b.kind, b.parent?.branchId ?? null, b.parent?.forkRev ?? null, b.owner === null ? null : JSON.stringify(b.owner), b.headRev, b.headCommitHash, b.anchorHash, nowIso],
      );
      for (const e of b.base.values()) await insertEntry(db, 'wfs_branch_base', projectId, branchId, e);
    }
    if (was !== undefined && was === b) continue;
    const fresh = b.commits.slice(was?.commits.length ?? 0);
    for (const commit of fresh) {
      await db.query(
        `INSERT INTO relay_wonderland.wfs_commits(project_id, branch_id, rev, commit_id, request_id, prev_commit_hash, commit_hash, record, at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [projectId, branchId, commit.rev, commit.commitId, commit.requestId, commit.prevCommitHash, commit.commitHash, JSON.stringify(commit), commit.atIso],
      );
      for (const e of commit.touched) {
        await db.query(
          `INSERT INTO relay_wonderland.wfs_versions(project_id, branch_id, file_id, version, rev, kind, path, path_key, sha256, size, deleted, content_version, path_version, created_rev, updated_rev)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [projectId, branchId, e.fileId, e.version, commit.rev, e.kind, e.path, e.pathKey, e.sha256, e.size, e.deleted, e.contentVersion, e.pathVersion, e.createdRev, e.updatedRev],
        );
      }
    }
    // the entries: a new branch carries its whole fork-time tree; an existing one, the post-state of what its new commits touched
    const touched = was === undefined ? [...b.entries.values()] : fresh.flatMap((c) => c.touched).map((e) => b.entries.get(e.fileId) ?? e);
    const finals = new Map<string, WfsEntry>();
    for (const e of touched) if (!finals.has(e.fileId)) finals.set(e.fileId, e);
    // B1 (R2-r2): pass 1 takes every touched row OUT of the live-path index (not deferrable), so a path this commit frees and takes
    // again -- in any file-id order -- never meets itself mid-write; pass 2 writes the final states, which the engine checked agree
    if (was !== undefined && finals.size > 0) {
      await db.query(
        'UPDATE relay_wonderland.wfs_entries SET deleted = true WHERE project_id = $1 AND branch_id = $2 AND file_id = ANY($3::text[]) AND NOT deleted',
        [projectId, branchId, [...finals.keys()]],
      );
    }
    for (const e of finals.values()) await insertEntry(db, 'wfs_entries', projectId, branchId, e);
    if (was !== undefined && (was.headRev !== b.headRev || was.headCommitHash !== b.headCommitHash || was.closed !== b.closed)) {
      await db.query(
        `UPDATE relay_wonderland.wfs_branches SET head_rev=$3, head_commit_hash=$4, closed_how=$5, closed_at=$6, closed_target_rev=$7
          WHERE project_id=$1 AND branch_id=$2`,
        [projectId, branchId, b.headRev, b.headCommitHash, b.closed?.how ?? null, b.closed?.atIso ?? null, b.closed?.targetRev ?? null],
      );
    }
  }
  for (const [conflictId, c] of after.conflicts) {
    const was = before.conflicts.get(conflictId);
    if (was === c) continue;
    // 036's statuses (a resolution with no ops is a DISMISSAL) and the 30-day retention: the ONE rule both stores apply
    const closing = wfsConflictClosing(c, after.branches, nowIso);
    if (was === undefined) {
      await db.query(
        `INSERT INTO relay_wonderland.wfs_conflicts(project_id, conflict_id, branch_id, request_id, status, record, opened_at, closed_at, resolved_by_commit_id, retain_until)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projectId, conflictId, c.branchId, c.requestId, closing.status, JSON.stringify(c), c.atIso, closing.closedAtIso, c.resolvedByCommitId, closing.retainUntilIso],
      );
      for (const sha of wfsBlobsNamed(c.ops)) {
        await db.query('INSERT INTO relay_wonderland.wfs_conflict_blobs(project_id, conflict_id, sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [projectId, conflictId, sha]);
      }
    } else {
      await db.query(
        `UPDATE relay_wonderland.wfs_conflicts SET status=$3, record=$4, closed_at=$5, resolved_by_commit_id=$6, retain_until=$7 WHERE project_id=$1 AND conflict_id=$2`,
        [projectId, conflictId, closing.status, JSON.stringify(c), closing.closedAtIso, c.resolvedByCommitId, closing.retainUntilIso],
      );
    }
  }
  for (const [requestId, r] of after.requests) {
    if (before.requests.has(requestId)) continue;
    await db.query(
      'INSERT INTO relay_wonderland.wfs_requests(project_id, request_id, payload_hash, outcome, at) VALUES($1,$2,$3,$4,$5)',
      [projectId, requestId, r.payloadHash, JSON.stringify(r.outcome), nowIso],
    );
  }
}

/**
 * A project's file environment INSIDE THE CALLER'S TRANSACTION: no BEGIN, no COMMIT here, so it commits or rolls back with
 * whatever else the caller writes (contract §3: the project row, its OWNER, its WonderFS project and its Project Avatar record
 * in ONE transaction -- R3). Idempotent: a project that already has one keeps it (`created: false`). Errors PROPAGATE (the
 * caller's transaction is aborted and must roll back); an unknown project is 23503 (its `projects` row must exist first).
 */
async function createWfsProjectIn(tx: Queryable, projectId: string, nowIso: string): Promise<{ readonly genesisHash: string; readonly created: boolean }> {
  const main = emptyWfsProject(projectId, sha256Hex).branches.get(WFS_MAIN_BRANCH) as WfsBranchState;
  const made = await tx.query(
    'INSERT INTO relay_wonderland.wfs_projects(project_id, genesis_hash, created_at) VALUES($1,$2,$3) ON CONFLICT(project_id) DO NOTHING',
    [projectId, main.anchorHash, nowIso],
  );
  const created = (made.rowCount ?? 0) === 1;
  if (created) {
    await tx.query(
      `INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, head_rev, head_commit_hash, anchor_hash, created_at) VALUES($1,'main','main',0,$2,$2,$3)`,
      [projectId, main.anchorHash, nowIso],
    );
  }
  return { genesisHash: main.anchorHash, created };
}

/** The blob addresses a commit request names (create / update), as given: what the change reads from wfs_blobs (F5). */
function requestedBlobs(ops: unknown, limits: WfsLimits): string[] {
  // a request with more ops than allowed is refused before any blob is looked at (the engine counts first)
  if (!Array.isArray(ops) || ops.length > limits.maxOpsPerCommit) return [];
  const out = new Set<string>();
  for (const op of ops as unknown[]) {
    const sha = typeof op === 'object' && op !== null ? (op as { sha256?: unknown }).sha256 : undefined;
    if (wfsIsSha256(sha)) out.add(sha);
  }
  return [...out];
}

/* ----------------------------------------------------------------------------------------------------------------- store */

export interface WfsPostgresStore extends WfsStore {
  /**
   * R3's Project Avatar bootstrap: this project's WonderFS project created INSIDE `tx`, the caller's open transaction on this
   * store's database, so it commits or rolls back with the caller's other rows. Refuses a protected store first, like every
   * read and write here.
   */
  createProjectIn(tx: WfsQueryable, projectId: string, nowIso: string): Promise<{ readonly genesisHash: string; readonly created: boolean }>;
}

export interface WfsPostgresOptions {
  readonly limits?: WfsLimits;
  /** Ids for files, commits, conflicts, branches and approvals (default: random UUIDs, prefixed by kind). */
  readonly newId?: (kind: 'file' | 'commit' | 'conflict' | 'branch' | 'approval') => string;
  /** The server's log (the bridge's mount passes its own): where WFS_HELD_CONNECTION_LOST is written. */
  readonly log?: (line: string) => void;
}

/** R2-r4: the ONE line a connection lost while this store held it writes to the log (fixed: no server text, no SQLSTATE). */
export const WFS_HELD_CONNECTION_LOST = 'wonderfs: a database connection was lost while in use; that client is discarded and the pool kept';

const outage = (what: string): RelayResult<never> => fail(relayError('stale-ledger-version', `WonderFS could not save ${what}; nothing was changed.`, { retryable: true }));
/**
 * R2-r3 (the r2 CI finding: a 23505 on wfs_commits_commit_id read as `stale-ledger-version`): why a write failed. An INTEGRITY
 * violation (SQLSTATE class 23 -- unique, check, not-null, exclusion) is not an outage: the same change retried meets it again, so a
 * journal that retries a 503 would retry it forever (B1 was one). It is a non-retryable `illegal-transition` (the route's 500), its
 * SQLSTATE and constraint named for the server's log. A foreign-key violation (23503) stays an outage: at COMMIT it can be a race with
 * a delete, which a retry then answers cleanly. Everything else (a dropped connection, 40001 / 40P01, a timeout) is the retryable outage.
 */
const writeFailed = (error: unknown, what: string): RelayResult<never> => {
  const e = (error ?? {}) as { code?: unknown; constraint?: unknown };
  if (typeof e.code === 'string' && e.code.startsWith('23') && e.code !== '23503') {
    return fail(relayError('illegal-transition', `WonderFS could not save ${what}: it would break the store's integrity; nothing was changed.`, {
      retryable: false,
      details: [`wonderfs: integrity ${e.code}${typeof e.constraint === 'string' ? ` ${e.constraint}` : ''}`],
    }));
  }
  return outage(what);
};
const readOutage = (): RelayResult<never> => fail(relayError('stale-ledger-version', 'WonderFS could not read the project just now; try again.', { retryable: true }));
const noProject = (): RelayResult<never> => fail(relayError('not-found', 'No such project.', { details: ['wonderfs: unknown project'] }));

type EventRow = { seq: string; kind: string; body: Record<string, unknown>; at: Date };

export function openWfsPostgresStore(pool: Pool, options: WfsPostgresOptions = {}): WfsPostgresStore {
  const refuseProtectedStore = protectedStoreWriterGuard(pool, 'WonderFS');
  const limits = options.limits ?? WFS_ALPHA_LIMITS;
  const newId = options.newId ?? ((kind) => `${kind}_${randomUUID()}`);
  const cache = new Map<string, CachedProject>();
  /** R2-r2: what a commit decides on (branches + entries; no history), by project version. Never handed to a reader. */
  const changeCache = new Map<string, CachedProject>();
  const remember = (projectId: string, entry: CachedProject): void => {
    const held = cache.get(projectId);
    if (held === undefined || held.seq <= entry.seq) cache.set(projectId, entry);
  };
  // ONE AT A TIME PER PROJECT in this process (the row lock serialises across processes)
  const tails = new Map<string, Promise<unknown>>();
  const serial = <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const next = (tails.get(projectId) ?? Promise.resolve()).then(work, work);
    tails.set(projectId, next.catch(() => undefined));
    return next;
  };

  /**
   * R2-r4 (MAIN's product check after CI r1.16): A CONNECTION LOST WHILE HELD IS NOT A CRASH. pg-pool hears a client's 'error' only
   * while the client is idle in it: it takes its listener off at checkout and puts it back at release (pg-pool 3.14
   * _acquireClient / _release). So a backend ended while this store holds the client -- a database restart or failover (57P01 /
   * 57P02 / 57P03), or the socket simply ending -- is emitted on a client nobody hears: an uncaught exception that takes the whole
   * bridge down. Every checkout here goes through this: the event is HEARD (one fixed line to the log, once per client), the
   * statement in flight still rejects on its own (the caller's retryable outage, as before), and the client goes back WITH the error,
   * so the pool discards it and keeps itself. (An IDLE client's loss is the pool's own 'error': server.ts juliusPool listens.)
   */
  const holdClient = async (): Promise<{ readonly client: PoolClient; readonly release: () => void }> => {
    const client = await pool.connect();
    let lost: Error | null = null;
    const heard = (error: Error): void => {
      if (lost === null) options.log?.(WFS_HELD_CONNECTION_LOST);
      lost ??= error;
    };
    client.on('error', heard);
    return {
      client,
      release: () => {
        client.off('error', heard);
        client.release(lost ?? undefined);
      },
    };
  };

  /** The member's role NOW, through the ONE product -> WonderFS mapping (r1.4 §8.2): OWNER / ADMIN / MEMBER; anything else is none. */
  const ROLE_SQL = 'SELECT role FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = $2';
  const roleNow = async (db: Queryable, projectId: string, playerId: string): Promise<WfsHumanRole | null> =>
    wfsHumanRoleFromMembership((await db.query<{ role: string }>(ROLE_SQL, [projectId, playerId])).rows[0]?.role);
  /**
   * R2: the role INSIDE a write's transaction, its row held FOR SHARE to the end of it: a DELETE or an UPDATE of that membership
   * (both conflict with FOR SHARE) committed first is what this reads (READ COMMITTED re-reads the newest version after a wait), and
   * one that comes after waits for this write to end. No row: no role (and nothing to lock).
   */
  const lockedRoleNow = async (db: Queryable, projectId: string, playerId: string): Promise<WfsHumanRole | null> =>
    wfsHumanRoleFromMembership((await db.query<{ role: string }>(`${ROLE_SQL} FOR SHARE`, [projectId, playerId])).rows[0]?.role);
  /** R2-r3: `playerId`'s conflicts in the project at `nowIso`, inside a write (the two conflict limits' tally). */
  const tallyOf = async (db: Queryable, projectId: string, playerId: string, nowIso: string): Promise<WfsConflictTally> => {
    const row = (await db.query<{ open: string; retained: string; next_free: Date | null }>(CONFLICT_TALLY_SQL, [projectId, playerId, nowIso])).rows[0];
    return { open: Number(row.open), retained: Number(row.retained), nextFreeIso: iso(row.next_free) };
  };

  /**
   * F4: ONE consistent read. Every statement `work` runs sees the same committed state (REPEATABLE READ: the snapshot is taken at
   * its first statement and held to the end; READ ONLY: it can write nothing). An outage is a retryable refusal, never "not found".
   */
  const snapshot = async <T>(work: (db: Queryable) => Promise<RelayResult<T>>): Promise<RelayResult<T>> => {
    await refuseProtectedStore();
    let held: Awaited<ReturnType<typeof holdClient>> | null = null;
    try {
      held = await holdClient();
      await held.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = await work(held.client);
      await held.client.query('COMMIT');
      return out;
    } catch {
      await held?.client.query('ROLLBACK').catch(() => undefined);
      return readOutage();
    } finally {
      held?.release();
    }
  };

  /** The live project's version (null: no such project, or deleted), inside a read. */
  const liveSeq = async (db: Queryable, projectId: string): Promise<number | null> => {
    const r = await db.query<{ next_event_seq: string }>('SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL', [projectId]);
    return r.rows[0] === undefined ? null : Number(r.rows[0].next_event_seq);
  };

  /** A branch's head revision in a live project (null: no such project or branch), inside a read. */
  const branchHead = async (db: Queryable, projectId: string, branchId: string): Promise<number | null> => {
    const r = await db.query<{ head_rev: number }>(
      `SELECT b.head_rev FROM relay_wonderland.wfs_branches b JOIN relay_wonderland.wfs_projects p ON p.project_id = b.project_id
        WHERE b.project_id = $1 AND b.branch_id = $2 AND p.deleted_at IS NULL`,
      [projectId, branchId],
    );
    return r.rows[0]?.head_rev ?? null;
  };

  /**
   * One mutation: lock, (re)load, read the blobs the request names, decide, write through, commit, adopt. `decide` returns the
   * next state (the SAME object when nothing changed: a replay), the caller's answer, and the event to record. `scope`: 'whole' loads
   * the whole state (the agent-phase changes); a commit's scope names the one request and the one conflict it needs (R2-r2).
   */
  const mutate = <T>(
    projectId: string,
    nowIso: string,
    what: string,
    blobShas: readonly string[],
    scope: 'whole' | { readonly requestId: unknown; readonly conflictId: unknown },
    decide: (state: WfsProjectState, ctx: WfsEngineContext, db: Queryable) => Promise<RelayResult<{ state: WfsProjectState; value: T; event: WfsStoreEvent | null; after?: (db: Queryable) => Promise<void> }>>,
  ): Promise<RelayResult<T>> =>
    serial(projectId, async () => {
      await refuseProtectedStore();
      const { client, release } = await holdClient();
      /** Keep what was decided on (or became) at version `at`: the whole state only from a whole load; the tree for every commit. */
      const keep = (state: WfsProjectState, at: number): void => {
        if (scope === 'whole') cache.set(projectId, { state, seq: at });
        else cache.delete(projectId);
        changeCache.set(projectId, { state: withoutHistory(state), seq: at });
      };
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const locked = await client.query<{ next_event_seq: string }>(
          'SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL FOR UPDATE',
          [projectId],
        );
        if (locked.rows.length === 0) {
          await client.query('ROLLBACK');
          return noProject();
        }
        const seq = Number(locked.rows[0].next_event_seq);
        let current = scope === 'whole' ? cache.get(projectId) : changeCache.get(projectId);
        if (current === undefined || current.seq !== seq) {
          const loaded = await loadWfsProject(client, projectId, { history: scope === 'whole' });
          if (loaded === null) {
            await client.query('ROLLBACK');
            return noProject();
          }
          current = loaded;
        }
        if (scope !== 'whole') {
          const asked = await askedFor(client, projectId, scope.requestId, scope.conflictId);
          current = { state: { ...current.state, requests: asked.requests, conflicts: asked.conflicts }, seq };
        }
        // F5: the blobs THIS request names, as the database holds them now (any bridge may have stored them)
        const present = new Map<string, number>();
        if (blobShas.length > 0) {
          const rows = await client.query<{ sha256: string; size: string }>(
            'SELECT sha256, size::text AS size FROM relay_wonderland.wfs_blobs WHERE project_id = $1 AND sha256 = ANY($2::text[])',
            [projectId, [...blobShas]],
          );
          for (const r of rows.rows) present.set(r.sha256, Number(r.size));
        }
        const ctx: WfsEngineContext = { nowIso, newId: (kind) => newId(kind), sha256Hex, blobSize: (sha) => present.get(sha) ?? null, limits };
        const decided = await decide(current.state, ctx, client);
        if (!decided.ok) {
          await client.query('ROLLBACK');
          keep(current.state, seq);
          return decided;
        }
        const { state: next, value, event } = decided.value;
        if (next === current.state && event === null) {
          await client.query('ROLLBACK'); // a replay: nothing to write
          keep(current.state, seq);
          return ok(value);
        }
        await persistWfsChange(client, projectId, current.state, next, nowIso);
        if (decided.value.after !== undefined) await decided.value.after(client);
        if (event !== null) {
          await client.query('INSERT INTO relay_wonderland.wfs_events(project_id, seq, kind, body, at) VALUES($1,$2,$3,$4,$5)', [projectId, seq, event.kind, JSON.stringify(event.body), nowIso]);
        }
        await client.query('UPDATE relay_wonderland.wfs_projects SET next_event_seq = $2 WHERE project_id = $1', [projectId, seq + 1]);
        await client.query('COMMIT');
        keep(next, seq + 1);
        return ok(value);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        cache.delete(projectId);
        changeCache.delete(projectId);
        return writeFailed(error, what);
      } finally {
        release();
      }
    });

  return {
    async createProject(projectId, nowIso) {
      await refuseProtectedStore();
      const { client, release } = await holdClient();
      try {
        await client.query('BEGIN');
        const made = await createWfsProjectIn(client, projectId, nowIso);
        await client.query('COMMIT');
        return ok({ genesisHash: made.genesisHash });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        // a project the Wonderland runtime does not know (23503) is a refusal, not an outage
        if ((error as { code?: string }).code === '23503') return fail(relayError('not-found', 'No such project to give a file environment.', { details: ['wonderfs: unknown project'] }));
        return outage('the new project');
      } finally {
        release();
      }
    },
    async createProjectIn(tx, projectId, nowIso) {
      await refuseProtectedStore();
      return createWfsProjectIn(tx, projectId, nowIso);
    },
    async memberRole(projectId, playerId) {
      await refuseProtectedStore();
      try {
        // ONE indexed lookup of the membership, no wfs_* row: what a route asks BEFORE anything else (§19.m2)
        return ok(wfsHumanRoleFromMembership((await pool.query<{ role: string }>(ROLE_SQL, [projectId, playerId])).rows[0]?.role));
      } catch {
        return readOutage();
      }
    },
    async projectsOf(playerId, query) {
      const q = wfsCheckProjectsQuery(playerId, query);
      if (!q.ok) return q;
      const { after, limit } = q.value;
      return snapshot<WfsProjectsPage>(async (db) => {
        // the membership JOINED to a live file environment; the role through the ONE mapping (in code, never re-spelled in SQL),
        // so rows the mapping gives no role are skipped and batches are read until a page is full or nothing is left
        const found: WfsMemberProject[] = [];
        let cursor = after;
        for (;;) {
          const rows = await db.query<{ project_id: string; role: string }>(
            `SELECT m.project_id, m.role FROM relay_wonderland.project_members m
               JOIN relay_wonderland.wfs_projects p ON p.project_id = m.project_id AND p.deleted_at IS NULL
              WHERE m.player_id = $1 AND ($2::text IS NULL OR m.project_id COLLATE "C" > $2::text)
              ORDER BY m.project_id COLLATE "C" LIMIT $3`,
            [q.value.playerId, cursor, limit + 1],
          );
          for (const r of rows.rows) {
            const role = wfsHumanRoleFromMembership(r.role);
            if (role !== null) found.push({ projectId: r.project_id, role });
          }
          if (rows.rows.length < limit + 1 || found.length > limit) break;
          cursor = rows.rows[rows.rows.length - 1].project_id;
        }
        const page = wfsBoundPage(found.slice(0, limit + 1), limit);
        return ok({ projects: page.items, next: page.more ? page.items[page.items.length - 1].projectId : null });
      });
    },
    async project(projectId) {
      const read = await snapshot<WfsProjectState | null>(async (db) => {
        const seq = await liveSeq(db, projectId);
        if (seq === null) return ok(null);
        const held = cache.get(projectId);
        if (held !== undefined && held.seq === seq) return ok(held.state);
        const loaded = await loadWfsProject(db, projectId);
        if (loaded !== null) remember(projectId, loaded);
        return ok(loaded?.state ?? null);
      });
      if (!read.ok) throw new Error(read.error.message);
      return read.value;
    },
    head: (projectId) =>
      snapshot<WfsProjectHead>(async (db) => {
        const p = await db.query<{ genesis_hash: string; next_event_seq: string }>(
          'SELECT genesis_hash, next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL',
          [projectId],
        );
        if (p.rows[0] === undefined) return wfsNotFound('unknown project');
        const main = await db.query<{ head_rev: number; head_commit_hash: string }>(
          "SELECT head_rev, head_commit_hash FROM relay_wonderland.wfs_branches WHERE project_id = $1 AND branch_id = 'main'",
          [projectId],
        );
        const usage = await db.query<{ files: string; bytes: string }>(
          `SELECT count(*)::text AS files, coalesce(sum(size), 0)::text AS bytes FROM relay_wonderland.wfs_entries
            WHERE project_id = $1 AND branch_id = 'main' AND kind = 'file' AND NOT deleted`,
          [projectId],
        );
        return ok({
          projectId,
          genesisHash: p.rows[0].genesis_hash,
          main: { headRev: main.rows[0].head_rev, headCommitHash: main.rows[0].head_commit_hash },
          usage: { files: Number(usage.rows[0].files), bytes: Number(usage.rows[0].bytes) },
          lastEventSeq: Number(p.rows[0].next_event_seq) - 1,
        });
      }),
    async tree(projectId, query) {
      const q = wfsCheckTreeQuery(query);
      if (!q.ok) return q;
      const { branchId, offset, limit } = q.value;
      return snapshot<WfsTreePage>(async (db) => {
        const headRev = await branchHead(db, projectId, branchId);
        if (headRev === null) return wfsNotFound('unknown project or branch');
        const rev = q.value.rev ?? headRev;
        if (rev > headRev) return wfsNotFound('no such revision');
        // the head is the current entries; an earlier revision is rebuilt from the versions (+ an agent branch's fork-time base)
        const rows = rev === headRev
          ? await db.query<EntryRow>(
            `SELECT ${ENTRY_COLUMNS} FROM relay_wonderland.wfs_entries WHERE project_id = $1 AND branch_id = $2 AND NOT deleted
              ORDER BY path_key COLLATE "C", file_id COLLATE "C" LIMIT $3 OFFSET $4`,
            [projectId, branchId, limit + 1, offset],
          )
          : await db.query<EntryRow>(
            `SELECT ${ENTRY_COLUMNS} FROM (
               SELECT DISTINCT ON (file_id) ${ENTRY_RAW} FROM (
                 SELECT ${ENTRY_RAW} FROM relay_wonderland.wfs_versions WHERE project_id = $1 AND branch_id = $2 AND rev <= $3
                 UNION ALL
                 SELECT ${ENTRY_RAW} FROM relay_wonderland.wfs_branch_base WHERE project_id = $1 AND branch_id = $2
               ) AS h ORDER BY file_id, version DESC
             ) AS t WHERE NOT deleted ORDER BY path_key COLLATE "C", file_id COLLATE "C" LIMIT $4 OFFSET $5`,
            [projectId, branchId, rev, limit + 1, offset],
          );
        const page = wfsBoundPage(rows.rows.map(entryOf), limit);
        return ok({ branchId, rev, headRev, entries: page.items, next: page.more ? wfsEncodeTreeCursor(rev, offset + page.items.length) : null });
      });
    },
    async fileHistory(projectId, query) {
      const q = wfsCheckHistoryQuery(query);
      if (!q.ok) return q;
      const { branchId, fileId, before, limit } = q.value;
      return snapshot<WfsHistoryPage>(async (db) => {
        if ((await branchHead(db, projectId, branchId)) === null) return wfsNotFound('unknown project or branch');
        const current = await db.query<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM relay_wonderland.wfs_entries WHERE project_id = $1 AND branch_id = $2 AND file_id = $3`, [projectId, branchId, fileId]);
        if (current.rows[0] === undefined) return wfsNotFound('unknown file');
        const rows = await db.query<EntryRow & { rev: number }>(
          `SELECT rev, ${ENTRY_COLUMNS} FROM (
             SELECT rev, ${ENTRY_RAW} FROM relay_wonderland.wfs_versions WHERE project_id = $1 AND branch_id = $2 AND file_id = $3
             UNION ALL
             SELECT 0 AS rev, ${ENTRY_RAW} FROM relay_wonderland.wfs_branch_base WHERE project_id = $1 AND branch_id = $2 AND file_id = $3
           ) AS h WHERE ($4::integer IS NULL OR version < $4::integer) ORDER BY version DESC LIMIT $5`,
          [projectId, branchId, fileId, before, limit + 1],
        );
        const page = wfsBoundPage<WfsFileVersion>(rows.rows.map((r) => ({ rev: r.rev, entry: entryOf(r) })), limit);
        return ok({ branchId, fileId, current: entryOf(current.rows[0]), versions: page.items, next: page.more ? page.items[page.items.length - 1].entry.version : null });
      });
    },
    async fileAt(projectId, query) {
      const q = wfsCheckFileAtQuery(query);
      if (!q.ok) return q;
      const { branchId, fileId, rev } = q.value;
      return snapshot<WfsFileAt>(async (db) => {
        const headRev = await branchHead(db, projectId, branchId);
        if (headRev === null) return wfsNotFound('unknown project or branch');
        const current = await db.query<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM relay_wonderland.wfs_entries WHERE project_id = $1 AND branch_id = $2 AND file_id = $3`, [projectId, branchId, fileId]);
        if (current.rows[0] === undefined) return wfsNotFound('unknown file');
        if (rev === null) return ok({ headRev, rev: headRev, entry: entryOf(current.rows[0]) });
        if (rev > headRev) return wfsNotFound('no such revision');
        // the newest version at or below the revision (an agent branch's fork-time base counts as revision 0): one indexed read
        const at = await db.query<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM (
             SELECT ${ENTRY_RAW} FROM relay_wonderland.wfs_versions WHERE project_id = $1 AND branch_id = $2 AND file_id = $3 AND rev <= $4
             UNION ALL
             SELECT ${ENTRY_RAW} FROM relay_wonderland.wfs_branch_base WHERE project_id = $1 AND branch_id = $2 AND file_id = $3
           ) AS h ORDER BY version DESC LIMIT 1`,
          [projectId, branchId, fileId, rev],
        );
        if (at.rows[0] === undefined) return wfsNotFound('no version at that revision');
        return ok({ headRev, rev, entry: entryOf(at.rows[0]) });
      });
    },
    async changes(projectId, query) {
      const q = wfsCheckChangesQuery(query);
      if (!q.ok) return q;
      const { branchId, afterRev, limit } = q.value;
      return snapshot<WfsChangesPage>(async (db) => {
        const headRev = await branchHead(db, projectId, branchId);
        if (headRev === null) return wfsNotFound('unknown project or branch');
        const rows = await db.query<{ record: WfsCommit }>(
          'SELECT record FROM relay_wonderland.wfs_commits WHERE project_id = $1 AND branch_id = $2 AND rev > $3 ORDER BY rev LIMIT $4',
          [projectId, branchId, afterRev, limit + 1],
        );
        const page = wfsBoundPage(rows.rows.map((r) => r.record), limit);
        return ok({ branchId, headRev, commits: page.items, next: page.more ? page.items[page.items.length - 1].rev : null });
      });
    },
    async events(projectId, query) {
      const q = wfsCheckEventsQuery(query);
      if (!q.ok) return q;
      const { afterSeq, limit } = q.value;
      return snapshot<WfsEventsPage>(async (db) => {
        const seq = await liveSeq(db, projectId);
        if (seq === null) return wfsNotFound('unknown project');
        const rows = await db.query<EventRow>(
          // R0b-fix (CI r1.7): sorted by the bigint COLUMN, qualified as e.seq. PostgreSQL binds a BARE sort name to an output
          // column first -- here the text cast of the same name -- so pages came back in TEXT order ('10' < '2') and skipped 2..9.
          // wonderfs-store.test.ts scans this file for that shape.
          'SELECT e.seq::text AS seq, e.kind, e.body, e.at FROM relay_wonderland.wfs_events e WHERE e.project_id = $1 AND e.seq > $2 ORDER BY e.seq LIMIT $3',
          [projectId, afterSeq, limit + 1],
        );
        const page = wfsBoundPage<WfsEventRecord>(rows.rows.map((r) => ({ seq: Number(r.seq), kind: r.kind, body: r.body, atIso: wfsIso(r.at) })), limit);
        return ok({ events: page.items, lastSeq: seq - 1, next: page.more ? page.items[page.items.length - 1].seq : null });
      });
    },
    async conflicts(projectId, query) {
      const q = wfsCheckConflictsQuery(query);
      if (!q.ok) return q;
      const { branchId, all, after, limit } = q.value;
      return snapshot<WfsConflictsPage>(async (db) => {
        if ((await liveSeq(db, projectId)) === null) return wfsNotFound('unknown project');
        if (branchId !== null && (await branchHead(db, projectId, branchId)) === null) return wfsNotFound('unknown branch');
        const rows = await db.query<{
          conflict_id: string; branch_id: string; request_id: string; status: WfsConflictStatus; principal: WfsPrincipal; base_rev: number;
          head_rev_at_refusal: number; at_iso: string; merges_branch_id: string | null; op_count: number; failure_count: number;
        }>(
          `SELECT conflict_id, branch_id, request_id, status, record->'principal' AS principal, (record->>'baseRev')::integer AS base_rev,
                  (record->>'headRevAtRefusal')::integer AS head_rev_at_refusal, record->>'atIso' AS at_iso, record->>'mergesBranchId' AS merges_branch_id,
                  jsonb_array_length(record->'ops') AS op_count, jsonb_array_length(record->'failures') AS failure_count
             FROM relay_wonderland.wfs_conflicts
            WHERE project_id = $1 AND ($2::text IS NULL OR branch_id = $2::text) AND ($3::boolean OR status = 'open')
              AND ($4::text IS NULL OR conflict_id COLLATE "C" > $4::text)
            ORDER BY conflict_id COLLATE "C" LIMIT $5`,
          [projectId, branchId, all, after, limit + 1],
        );
        const page = wfsBoundPage<WfsConflictSummary>(rows.rows.map((r) => ({
          conflictId: r.conflict_id,
          branchId: r.branch_id,
          requestId: r.request_id,
          status: r.status,
          principal: r.principal,
          baseRev: r.base_rev,
          headRevAtRefusal: r.head_rev_at_refusal,
          atIso: r.at_iso,
          mergesBranchId: r.merges_branch_id,
          opCount: r.op_count,
          failureCount: r.failure_count,
        })), limit);
        return ok({ conflicts: page.items, next: page.more ? page.items[page.items.length - 1].conflictId : null });
      });
    },
    conflict: (projectId, conflictId) =>
      snapshot<WfsConflictView>(async (db) => {
        if ((await liveSeq(db, projectId)) === null) return wfsNotFound('unknown project');
        const r = await db.query<{ record: WfsConflict; status: WfsConflictStatus; closed_at: Date | null; retain_until: Date | null }>(
          'SELECT record, status, closed_at, retain_until FROM relay_wonderland.wfs_conflicts WHERE project_id = $1 AND conflict_id = $2',
          [projectId, conflictId],
        );
        const row = r.rows[0];
        if (row === undefined) return wfsNotFound('unknown conflict');
        return ok({ record: row.record, status: row.status, closedAtIso: iso(row.closed_at), retainUntilIso: iso(row.retain_until) });
      }),
    async blobInfo(projectId, sha256) {
      const sha = wfsCheckSha256(sha256);
      if (!sha.ok) return sha;
      return snapshot<WfsBlobInfo | null>(async (db) => {
        if ((await liveSeq(db, projectId)) === null) return wfsNotFound('unknown project');
        const row = (await db.query<{ size: string | null; referenced: boolean }>(BLOB_REFERENCE_SQL, [projectId, sha.value])).rows[0];
        return ok(row === undefined || row.size === null ? null : { sha256: sha.value, size: Number(row.size), referenced: row.referenced });
      });
    },
    async readReferencedBlob(projectId, sha256) {
      const sha = wfsCheckSha256(sha256);
      if (!sha.ok) return sha;
      return snapshot<WfsReferencedBlob | null>(async (db) => {
        // ONE consistent read: the project is live, something of it names the address, and its bytes (R0b MINOR-7)
        if ((await liveSeq(db, projectId)) === null) return wfsNotFound('unknown project');
        const ref = (await db.query<{ size: string | null; referenced: boolean }>(BLOB_REFERENCE_SQL, [projectId, sha.value])).rows[0];
        if (ref === undefined || ref.size === null || !ref.referenced) return ok(null);
        const held = await db.query<{ bytes: Buffer }>('SELECT bytes FROM relay_wonderland.wfs_blob_bytes WHERE project_id = $1 AND sha256 = $2', [projectId, sha.value]);
        return ok({ size: Number(ref.size), bytes: held.rows[0] === undefined ? null : new Uint8Array(held.rows[0].bytes) });
      });
    },
    async verifyBlob(projectId, sha256) {
      const sha = wfsCheckSha256(sha256);
      if (!sha.ok) return sha;
      return snapshot<WfsBlobIntegrity>(async (db) => {
        if ((await liveSeq(db, projectId)) === null) return wfsNotFound('unknown project');
        const r = await db.query<{ size: string; bytes: Buffer | null }>(
          `SELECT b.size::text AS size, x.bytes FROM relay_wonderland.wfs_blobs b
             LEFT JOIN relay_wonderland.wfs_blob_bytes x ON x.project_id = b.project_id AND x.sha256 = b.sha256
            WHERE b.project_id = $1 AND b.sha256 = $2`,
          [projectId, sha.value],
        );
        const row = r.rows[0];
        const bytes = row === undefined || row.bytes === null ? null : new Uint8Array(row.bytes);
        return ok(wfsBlobIntegrity(sha.value, row === undefined ? null : Number(row.size), bytes, sha256Bytes));
      });
    },
    commit: (projectId, req, nowIso, authority) =>
      mutate(projectId, nowIso, 'the change', requestedBlobs(req.ops, limits), { requestId: req.requestId, conflictId: req.resolvesConflictId ?? null }, async (state, ctx, db) => {
        // R2: the role NOW, in this transaction, before the engine (and its replay lookup) runs
        if (authority !== undefined) {
          const admitted = wfsAdmitCommit(await lockedRoleNow(db, projectId, authority.playerId), authority, req);
          if (!admitted.ok) return admitted;
        }
        const r = applyWfsCommit(state, req, ctx);
        if (!r.ok) return r;
        // R2-r3: a NEW conflict past its author's open limit, or past the retained storage limit, keeps nothing
        if (authority !== undefined && wfsConflictLimitsApply(r.value.outcome, authority)) {
          const limited = wfsConflictLimits(await tallyOf(db, projectId, authority.playerId, nowIso), authority);
          if (!limited.ok) return limited;
        }
        return ok({ state: r.value.project, value: r.value.outcome, event: wfsOutcomeEvent(r.value.outcome, 'commit') });
      }),
    fork: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the branch', [], 'whole', async (state, ctx) => {
        const r = forkWfsBranch(state, input, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: { branchId: r.value.branchId }, event: { kind: 'branch.fork', body: { branchId: r.value.branchId, fromBranchId: input.fromBranchId } } });
      }),
    mergeBack: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the merge', [], 'whole', async (state, ctx, db) => {
        const row = input.approvalId === null ? undefined : (await db.query<{ approval_id: string; branch_id: string; approved_by: string; approved_head_commit_hash: string; approved_base_rev: number; approved_at: Date }>(
          `SELECT approval_id, branch_id, approved_by, approved_head_commit_hash, approved_base_rev, approved_at
             FROM relay_wonderland.wfs_approvals WHERE project_id = $1 AND approval_id = $2`,
          [projectId, input.approvalId],
        )).rows[0];
        const approval: WfsMergeApproval | null = row === undefined ? null : {
          approvalId: row.approval_id,
          branchId: row.branch_id,
          approvedBy: row.approved_by,
          approvedHeadCommitHash: row.approved_head_commit_hash,
          approvedBaseRev: row.approved_base_rev,
          approvedAtIso: iso(row.approved_at) as string,
        };
        const approverRoleNow = approval === null ? null : await roleNow(db, projectId, approval.approvedBy);
        const r = mergeBackWfsBranch(state, { requestId: input.requestId, branchId: input.branchId, principal: input.principal, approval, reviewVerdict: input.reviewVerdict, approverRoleNow }, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: r.value.outcome, event: wfsOutcomeEvent(r.value.outcome, 'branch.merge') });
      }),
    approve: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the approval', [], 'whole', async (state, _ctx, db) => {
        const roleNowValue = input.principal.kind === 'human' ? await roleNow(db, projectId, input.principal.id) : null;
        const r = issueWfsApproval(state, { approvalId: newId('approval'), branchId: input.branchId, principal: input.principal, roleNow: roleNowValue }, nowIso);
        if (!r.ok) return r;
        const a = r.value;
        return ok({
          state,
          value: a,
          event: { kind: 'approval', body: { branchId: a.branchId, approvalId: a.approvalId } },
          after: async (tx) => {
            await tx.query(
              `INSERT INTO relay_wonderland.wfs_approvals(project_id, approval_id, branch_id, approved_by, approved_head_commit_hash, approved_base_rev, approved_at)
               VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [projectId, a.approvalId, a.branchId, a.approvedBy, a.approvedHeadCommitHash, a.approvedBaseRev, a.approvedAtIso],
            );
          },
        });
      }),
    discard: (projectId, branchId, nowIso) =>
      mutate(projectId, nowIso, 'the branch', [], 'whole', async (state) => {
        const r = discardWfsBranch(state, branchId, nowIso);
        if (!r.ok) return r;
        return ok({ state: r.value, value: null, event: { kind: 'branch.discard', body: { branchId } } });
      }),
    async putBlob(projectId, bytes, options = {}) {
      await refuseProtectedStore();
      const checked = wfsCheckUpload(bytes.byteLength, options.claimedSha256, limits);
      if (!checked.ok) return checked;
      // the address is computed HERE. The bytes are the caller's, handed over: no copy (R2-r2, security MINOR-5), so they must not
      // change until this resolves -- the route's upload buffer is its own and is never touched again
      const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sha256 = await wfsSha256InSlices(view, createHash('sha256'));
      if (checked.value !== null && checked.value !== sha256) return wfsHashMismatch(); // §10.1: nothing kept, nothing touched
      const size = view.byteLength;
      return serial(projectId, async () => {
        const { client, release } = await holdClient();
        try {
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          // FOR UPDATE: serialised with commits and other uploads of this project on every bridge, so the room below is exact
          const live = await client.query('SELECT 1 FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL FOR UPDATE', [projectId]);
          if (live.rows.length === 0) {
            await client.query('ROLLBACK');
            return noProject();
          }
          if (options.authority !== undefined) {
            const admitted = wfsAdmitWrite(await lockedRoleNow(client, projectId, options.authority.playerId), options.authority);
            if (!admitted.ok) {
              await client.query('ROLLBACK');
              return admitted;
            }
          }
          const held = await client.query('SELECT 1 FROM relay_wonderland.wfs_blobs WHERE project_id = $1 AND sha256 = $2', [projectId, sha256]);
          const created = held.rows.length === 0;
          if (created) {
            // §19.m3: a NEW blob must fit beside main's live bytes and every orphan's pending bytes -- before a byte is kept
            const room = (await client.query<{ live_bytes: string; pending_bytes: string }>(PROJECT_ROOM_SQL, [projectId])).rows[0];
            const fits = wfsBlobRoom({ liveBytes: Number(room.live_bytes), pendingBytes: Number(room.pending_bytes), size, limits });
            if (!fits.ok) {
              await client.query('ROLLBACK');
              return fits;
            }
            await client.query("INSERT INTO relay_wonderland.wfs_blobs(project_id, sha256, size, store) VALUES($1,$2,$3,'pg')", [projectId, sha256, size]);
          }
          // the bytes, unless they are there: a held blob whose bytes went missing is repaired (REVIEW_WONDERFS_R0B MINOR-7)
          const bytesHeld = await client.query('SELECT 1 FROM relay_wonderland.wfs_blob_bytes WHERE project_id = $1 AND sha256 = $2', [projectId, sha256]);
          if (bytesHeld.rows.length === 0) {
            await client.query('INSERT INTO relay_wonderland.wfs_blob_bytes(project_id, sha256, bytes) VALUES($1,$2,$3)', [projectId, sha256, view]);
          }
          await client.query('COMMIT');
          return ok({ sha256, size, created });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          return writeFailed(error, 'the file');
        } finally {
          release();
        }
      });
    },
    async readBlob(projectId, sha256) {
      await refuseProtectedStore();
      const r = await pool.query<{ bytes: Buffer }>('SELECT bytes FROM relay_wonderland.wfs_blob_bytes WHERE project_id = $1 AND sha256 = $2', [projectId, sha256]);
      return r.rows[0] === undefined ? null : new Uint8Array(r.rows[0].bytes);
    },
  };
}
