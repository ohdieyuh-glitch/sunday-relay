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
  wfsBlobIntegrity,
  wfsBlobsNamed,
  wfsBoundPage,
  wfsCheckChangesQuery,
  wfsCheckConflictsQuery,
  wfsCheckEventsQuery,
  wfsCheckHistoryQuery,
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
  type WfsConflictStatus,
  type WfsConflictSummary,
  type WfsConflictView,
  type WfsEventRecord,
  type WfsEventsPage,
  type WfsFileVersion,
  type WfsHistoryPage,
  type WfsProjectHead,
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
 * blob anything still names (N-MAJOR-1).
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
 */
export async function loadWfsProject(db: Queryable, projectId: string): Promise<{ state: WfsProjectState; seq: number } | null> {
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
  const commits = await db.query<{ branch_id: string; record: WfsCommit }>(
    'SELECT branch_id, record FROM relay_wonderland.wfs_commits WHERE project_id = $1 ORDER BY branch_id, rev',
    [projectId],
  );
  const conflicts = await db.query<{ record: WfsConflict }>('SELECT record FROM relay_wonderland.wfs_conflicts WHERE project_id = $1', [projectId]);
  const requests = await db.query<{ request_id: string; payload_hash: string; outcome: WfsCommitOutcome }>(
    'SELECT request_id, payload_hash, outcome FROM relay_wonderland.wfs_requests WHERE project_id = $1',
    [projectId],
  );

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
    const seen = new Set<string>();
    for (const e of touched) {
      if (seen.has(e.fileId)) continue;
      seen.add(e.fileId);
      await insertEntry(db, 'wfs_entries', projectId, branchId, e);
    }
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
}

const outage = (what: string): RelayResult<never> => fail(relayError('stale-ledger-version', `WonderFS could not save ${what}; nothing was changed.`, { retryable: true }));
const readOutage = (): RelayResult<never> => fail(relayError('stale-ledger-version', 'WonderFS could not read the project just now; try again.', { retryable: true }));
const noProject = (): RelayResult<never> => fail(relayError('not-found', 'No such project.', { details: ['wonderfs: unknown project'] }));

type EventRow = { seq: string; kind: string; body: Record<string, unknown>; at: Date };

export function openWfsPostgresStore(pool: Pool, options: WfsPostgresOptions = {}): WfsPostgresStore {
  const refuseProtectedStore = protectedStoreWriterGuard(pool, 'WonderFS');
  const limits = options.limits ?? WFS_ALPHA_LIMITS;
  const newId = options.newId ?? ((kind) => `${kind}_${randomUUID()}`);
  const cache = new Map<string, CachedProject>();
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

  /** The member's role NOW, through the ONE product -> WonderFS mapping (r1.4 §8.2): OWNER / ADMIN / MEMBER; anything else is none. */
  const ROLE_SQL = 'SELECT role FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = $2';
  const roleNow = async (db: Queryable, projectId: string, playerId: string): Promise<WfsHumanRole | null> =>
    wfsHumanRoleFromMembership((await db.query<{ role: string }>(ROLE_SQL, [projectId, playerId])).rows[0]?.role);

  /**
   * F4: ONE consistent read. Every statement `work` runs sees the same committed state (REPEATABLE READ: the snapshot is taken at
   * its first statement and held to the end; READ ONLY: it can write nothing). An outage is a retryable refusal, never "not found".
   */
  const snapshot = async <T>(work: (db: Queryable) => Promise<RelayResult<T>>): Promise<RelayResult<T>> => {
    await refuseProtectedStore();
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = await work(client);
      await client.query('COMMIT');
      return out;
    } catch {
      await client?.query('ROLLBACK').catch(() => undefined);
      return readOutage();
    } finally {
      client?.release();
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
   * next state (the SAME object when nothing changed: a replay), the caller's answer, and the event to record.
   */
  const mutate = <T>(
    projectId: string,
    nowIso: string,
    what: string,
    blobShas: readonly string[],
    decide: (state: WfsProjectState, ctx: WfsEngineContext, db: Queryable) => Promise<RelayResult<{ state: WfsProjectState; value: T; event: WfsStoreEvent | null; after?: (db: Queryable) => Promise<void> }>>,
  ): Promise<RelayResult<T>> =>
    serial(projectId, async () => {
      await refuseProtectedStore();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query<{ next_event_seq: string }>(
          'SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL FOR UPDATE',
          [projectId],
        );
        if (locked.rows.length === 0) {
          await client.query('ROLLBACK');
          return noProject();
        }
        const seq = Number(locked.rows[0].next_event_seq);
        let current = cache.get(projectId);
        if (current === undefined || current.seq !== seq) {
          const loaded = await loadWfsProject(client, projectId);
          if (loaded === null) {
            await client.query('ROLLBACK');
            return noProject();
          }
          current = loaded;
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
          cache.set(projectId, current);
          return decided;
        }
        const { state: next, value, event } = decided.value;
        if (next === current.state && event === null) {
          await client.query('ROLLBACK'); // a replay: nothing to write
          cache.set(projectId, current);
          return ok(value);
        }
        await persistWfsChange(client, projectId, current.state, next, nowIso);
        if (decided.value.after !== undefined) await decided.value.after(client);
        if (event !== null) {
          await client.query('INSERT INTO relay_wonderland.wfs_events(project_id, seq, kind, body, at) VALUES($1,$2,$3,$4,$5)', [projectId, seq, event.kind, JSON.stringify(event.body), nowIso]);
        }
        await client.query('UPDATE relay_wonderland.wfs_projects SET next_event_seq = $2 WHERE project_id = $1', [projectId, seq + 1]);
        await client.query('COMMIT');
        cache.set(projectId, { state: next, seq: seq + 1 });
        return ok(value);
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        cache.delete(projectId);
        return outage(what);
      } finally {
        client.release();
      }
    });

  return {
    async createProject(projectId, nowIso) {
      await refuseProtectedStore();
      const client = await pool.connect();
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
        client.release();
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
          'SELECT seq::text AS seq, kind, body, at FROM relay_wonderland.wfs_events WHERE project_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
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
        const r = await db.query<{ size: string; referenced: boolean }>(
          `SELECT b.size::text AS size,
                  (EXISTS (SELECT 1 FROM relay_wonderland.wfs_versions v WHERE v.project_id = b.project_id AND v.sha256 = b.sha256)
                   OR EXISTS (SELECT 1 FROM relay_wonderland.wfs_entries e WHERE e.project_id = b.project_id AND e.sha256 = b.sha256)
                   OR EXISTS (SELECT 1 FROM relay_wonderland.wfs_branch_base x WHERE x.project_id = b.project_id AND x.sha256 = b.sha256)
                   OR EXISTS (SELECT 1 FROM relay_wonderland.wfs_conflict_blobs c WHERE c.project_id = b.project_id AND c.sha256 = b.sha256)) AS referenced
             FROM relay_wonderland.wfs_blobs b WHERE b.project_id = $1 AND b.sha256 = $2`,
          [projectId, sha.value],
        );
        const row = r.rows[0];
        return ok(row === undefined ? null : { sha256: sha.value, size: Number(row.size), referenced: row.referenced });
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
    commit: (projectId, req, nowIso) =>
      mutate(projectId, nowIso, 'the change', requestedBlobs(req.ops, limits), async (state, ctx) => {
        const r = applyWfsCommit(state, req, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: r.value.outcome, event: wfsOutcomeEvent(r.value.outcome, 'commit') });
      }),
    fork: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the branch', [], async (state, ctx) => {
        const r = forkWfsBranch(state, input, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: { branchId: r.value.branchId }, event: { kind: 'branch.fork', body: { branchId: r.value.branchId, fromBranchId: input.fromBranchId } } });
      }),
    mergeBack: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the merge', [], async (state, ctx, db) => {
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
      mutate(projectId, nowIso, 'the approval', [], async (state, _ctx, db) => {
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
      mutate(projectId, nowIso, 'the branch', [], async (state) => {
        const r = discardWfsBranch(state, branchId, nowIso);
        if (!r.ok) return r;
        return ok({ state: r.value, value: null, event: { kind: 'branch.discard', body: { branchId } } });
      }),
    async putBlob(projectId, bytes) {
      await refuseProtectedStore();
      if (bytes.byteLength > limits.maxFileBytes) return fail(relayError('validation-failed', 'That file is larger than a project allows.', { details: ['wonderfs: file_too_large'] }));
      const sha256 = sha256Bytes(bytes);
      const size = bytes.byteLength;
      return serial(projectId, async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const live = await client.query('SELECT 1 FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL FOR SHARE', [projectId]);
          if (live.rows.length === 0) {
            await client.query('ROLLBACK');
            return noProject();
          }
          const made = await client.query(
            "INSERT INTO relay_wonderland.wfs_blobs(project_id, sha256, size, store) VALUES($1,$2,$3,'pg') ON CONFLICT(project_id, sha256) DO NOTHING",
            [projectId, sha256, size],
          );
          if ((made.rowCount ?? 0) === 1) {
            await client.query('INSERT INTO relay_wonderland.wfs_blob_bytes(project_id, sha256, bytes) VALUES($1,$2,$3)', [projectId, sha256, Buffer.from(bytes)]);
          }
          await client.query('COMMIT');
          return ok({ sha256, size });
        } catch {
          await client.query('ROLLBACK').catch(() => undefined);
          return outage('the file');
        } finally {
          client.release();
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
