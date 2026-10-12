import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { WFS_ALPHA_LIMITS, type WfsBranchId, type WfsCommit, type WfsCommitOutcome, type WfsCommitRequest, type WfsConflict, type WfsEntry, type WfsLimits, type WfsMergeApproval, type WfsPrincipal, type WfsRecordedOp, type WfsReviewVerdict } from '../wonderfs/wonderfs-contracts';
import type { WfsHumanRole } from '../wonderfs/wonderfs-authz';
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
import { protectedStoreWriterGuard } from './protected-store-writer-guard';

/**
 * WONDERFS ON POSTGRESQL (migration 036; contract r1.4 §10): the reference engine (wonderfs-engine.ts) decides; this store
 * PERSISTS what it decided, so a project's files, history, branches, conflicts and idempotency answers outlive every process.
 *
 * ONE MUTATION = ONE TRANSACTION (§10.1):
 *   1. the project row is locked (`SELECT ... FOR UPDATE` on wfs_projects): every change to one project is serialised across
 *      every bridge, and its `next_event_seq` is the project's version. A DELIBERATE DEVIATION from §6.3's per-branch head lock,
 *      on the stricter side: D-5's events need ONE gapless sequence per project, and the engine decides on the whole project's
 *      state, so two branches of one project never commit in parallel here (still READ COMMITTED, never SERIALIZABLE). Alpha's
 *      scale (§11) makes the lost parallelism immaterial; per-branch locking is a post-Alpha optimisation, for review;
 *   2. the project's state is the cached one only if that version still matches, else it is READ BACK from the rows, inside the
 *      same transaction;
 *   3. the engine runs (time is the server's; ids are random; blob sizes are the project's recorded blobs);
 *   4. exactly the rows the change made are written -- new commits with their versions, the entries they touched, new or moved
 *      branches, new or closed conflicts (with the blobs they hold), the request's answer, ONE event -- and the version moves;
 *   5. COMMIT, and only then is the new state adopted. Anything failing rolls it all back: nothing half-written, ever.
 *   An idempotent REPLAY (the same request id and payload) changes nothing and writes nothing (INV-8).
 *
 * BLOBS (§10.1, §10.2): `putBlob` hashes the bytes HERE, so a blob's address is never the client's word; the Alpha / test store is
 * PostgreSQL `bytea` (wfs_blob_bytes) behind this interface, until the Railway bucket passes T-STORE. A commit names only blobs this
 * project holds (the engine refuses others), and the schema refuses deleting a blob anything still names (N-MAJOR-1).
 *
 * WHAT IS NEVER HERE: the Julius live store. Like every Wonderland writer, this refuses a PROTECTED store before its first read or
 * write (protected-store-writer-guard.ts): WonderFS data lives in the Wonderland database only.
 */

/** A closed conflict's record (and the blobs it holds) is kept this long after its resolution or dismissal (§11, N-MAJOR-1). */
export const WFS_CONFLICT_RETENTION_MS = 30 * 24 * 3600 * 1000;

type Queryable = Pick<PoolClient, 'query'>;

interface CachedProject {
  readonly state: WfsProjectState;
  /** wfs_projects.next_event_seq when this state was read or written: the project's version. */
  readonly seq: number;
  /** sha256 -> size, every blob the project holds (blobs are immutable, so this only grows). */
  readonly blobs: Map<string, number>;
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
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

/** A project's whole state, read back from its rows (or null: no such project, or deleted). */
export async function loadWfsProject(db: Queryable, projectId: string): Promise<{ state: WfsProjectState; seq: number; blobs: Map<string, number> } | null> {
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
  const columns = 'branch_id, file_id, kind, path, path_key, sha256, size::text AS size, deleted, version, content_version, path_version, created_rev, updated_rev';
  const entries = await db.query<EntryRow>(`SELECT ${columns} FROM relay_wonderland.wfs_entries WHERE project_id = $1`, [projectId]);
  const bases = await db.query<EntryRow>(`SELECT ${columns} FROM relay_wonderland.wfs_branch_base WHERE project_id = $1`, [projectId]);
  const commits = await db.query<{ branch_id: string; record: WfsCommit }>(
    'SELECT branch_id, record FROM relay_wonderland.wfs_commits WHERE project_id = $1 ORDER BY branch_id, rev',
    [projectId],
  );
  const conflicts = await db.query<{ record: WfsConflict }>('SELECT record FROM relay_wonderland.wfs_conflicts WHERE project_id = $1', [projectId]);
  const requests = await db.query<{ request_id: string; payload_hash: string; outcome: WfsCommitOutcome }>(
    'SELECT request_id, payload_hash, outcome FROM relay_wonderland.wfs_requests WHERE project_id = $1',
    [projectId],
  );
  const blobRows = await db.query<{ sha256: string; size: string }>('SELECT sha256, size::text AS size FROM relay_wonderland.wfs_blobs WHERE project_id = $1', [projectId]);

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
  return { state, seq: Number(project.rows[0].next_event_seq), blobs: new Map(blobRows.rows.map((r) => [r.sha256, Number(r.size)])) };
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

/** The blob addresses an op set names (what a conflict holds while it is retained: N-MAJOR-1). */
function blobsNamed(ops: readonly WfsRecordedOp[]): string[] {
  const out = new Set<string>();
  for (const op of ops) {
    if ((op.op === 'create' || op.op === 'update') && typeof op.sha256 === 'string') out.add(op.sha256);
    if (op.op === 'merge_put' && typeof op.changes.content?.sha256 === 'string') out.add(op.changes.content.sha256);
  }
  return [...out].sort();
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
    // 036's statuses: an engine "resolved" with no ops in its resolving commit is a DISMISSAL (keep theirs); either way it is
    // retained for WFS_CONFLICT_RETENTION_MS, its blobs with it
    const resolving = c.resolvedByCommitId === null ? undefined : [...after.branches.values()].flatMap((b) => b.commits).find((x) => x.commitId === c.resolvedByCommitId);
    const status = c.status === 'open' ? 'open' : resolving !== undefined && resolving.ops.length === 0 ? 'dismissed' : 'resolved';
    const closedAt = c.status === 'open' ? null : resolving?.atIso ?? nowIso;
    const retainUntil = closedAt === null ? null : new Date(Date.parse(closedAt) + WFS_CONFLICT_RETENTION_MS).toISOString();
    if (was === undefined) {
      await db.query(
        `INSERT INTO relay_wonderland.wfs_conflicts(project_id, conflict_id, branch_id, request_id, status, record, opened_at, closed_at, resolved_by_commit_id, retain_until)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projectId, conflictId, c.branchId, c.requestId, status, JSON.stringify(c), c.atIso, closedAt, c.resolvedByCommitId, retainUntil],
      );
      for (const sha of blobsNamed(c.ops)) {
        await db.query('INSERT INTO relay_wonderland.wfs_conflict_blobs(project_id, conflict_id, sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [projectId, conflictId, sha]);
      }
    } else {
      await db.query(
        `UPDATE relay_wonderland.wfs_conflicts SET status=$3, record=$4, closed_at=$5, resolved_by_commit_id=$6, retain_until=$7 WHERE project_id=$1 AND conflict_id=$2`,
        [projectId, conflictId, status, JSON.stringify(c), closedAt, c.resolvedByCommitId, retainUntil],
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

/* ----------------------------------------------------------------------------------------------------------------- store */

export interface WfsStoreEvent {
  /** e.g. commit, conflict, branch.fork, branch.merge, branch.discard, approval */
  readonly kind: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface WfsPostgresStore {
  /** A project's file environment, created with its Project Avatar's project (INV-10: always on; there is no "off"). */
  createProject(projectId: string, nowIso: string): Promise<RelayResult<{ readonly genesisHash: string }>>;
  /** The project's state as committed (never a half-written one), or null. */
  project(projectId: string): Promise<WfsProjectState | null>;
  commit(projectId: string, req: WfsCommitRequest, nowIso: string): Promise<RelayResult<WfsCommitOutcome>>;
  fork(projectId: string, input: { readonly fromBranchId: WfsBranchId; readonly owner: WfsPrincipal }, nowIso: string): Promise<RelayResult<{ readonly branchId: WfsBranchId }>>;
  /**
   * The approval is the one STORED by `approve` (wfs_approvals), looked up by its id -- never an object the caller built -- and the
   * approver's CURRENT role is read here from project_members (r1.4 N-minor-1). The review verdict is checked against the
   * reviewer's recorded verdict by the Julius layer before it reaches here (TJ-3; MAIN JUJU's side).
   */
  mergeBack(projectId: string, input: { readonly requestId: string; readonly branchId: WfsBranchId; readonly principal: WfsPrincipal; readonly approvalId: string | null; readonly reviewVerdict: WfsReviewVerdict | null }, nowIso: string): Promise<RelayResult<WfsCommitOutcome>>;
  /** The human's CURRENT role is read here from project_members (r1.4 N-minor-1); the approval is kept (wfs_approvals). */
  approve(projectId: string, input: { readonly branchId: WfsBranchId; readonly principal: WfsPrincipal }, nowIso: string): Promise<RelayResult<WfsMergeApproval>>;
  discard(projectId: string, branchId: WfsBranchId, nowIso: string): Promise<RelayResult<null>>;
  /** Stores bytes under the sha256 computed HERE; idempotent. */
  putBlob(projectId: string, bytes: Uint8Array): Promise<RelayResult<{ readonly sha256: string; readonly size: number }>>;
  readBlob(projectId: string, sha256: string): Promise<Uint8Array | null>;
}

export interface WfsPostgresOptions {
  readonly limits?: WfsLimits;
  /** Ids for files, commits, conflicts, branches and approvals (default: random UUIDs, prefixed by kind). */
  readonly newId?: (kind: 'file' | 'commit' | 'conflict' | 'branch' | 'approval') => string;
}

const outage = (what: string): RelayResult<never> => fail(relayError('stale-ledger-version', `WonderFS could not save ${what}; nothing was changed.`, { retryable: true }));
const noProject = (): RelayResult<never> => fail(relayError('not-found', 'No such project.', { details: ['wonderfs: unknown project'] }));

const roleOf = (role: string | undefined): WfsHumanRole | null => (role === 'owner' || role === 'editor' || role === 'viewer' ? role : null);

export function openWfsPostgresStore(pool: Pool, options: WfsPostgresOptions = {}): WfsPostgresStore {
  const refuseProtectedStore = protectedStoreWriterGuard(pool, 'WonderFS');
  const limits = options.limits ?? WFS_ALPHA_LIMITS;
  const newId = options.newId ?? ((kind) => `${kind}_${randomUUID()}`);
  const cache = new Map<string, CachedProject>();
  // ONE AT A TIME PER PROJECT in this process (the row lock serialises across processes)
  const tails = new Map<string, Promise<unknown>>();
  const serial = <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const next = (tails.get(projectId) ?? Promise.resolve()).then(work, work);
    tails.set(projectId, next.catch(() => undefined));
    return next;
  };

  const roleNow = async (db: Queryable, projectId: string, playerId: string): Promise<WfsHumanRole | null> =>
    roleOf((await db.query<{ role: string }>('SELECT role FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = $2', [projectId, playerId])).rows[0]?.role);

  /**
   * One mutation: lock, (re)load, decide, write through, commit, adopt. `decide` returns the next state (the SAME object when
   * nothing changed: a replay), the caller's answer, and the event to record.
   */
  const mutate = <T>(
    projectId: string,
    nowIso: string,
    what: string,
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
        const blobs = current.blobs;
        const ctx: WfsEngineContext = { nowIso, newId: (kind) => newId(kind), sha256Hex, blobSize: (sha) => blobs.get(sha) ?? null, limits };
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
        cache.set(projectId, { state: next, seq: seq + 1, blobs });
        return ok(value);
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        cache.delete(projectId);
        return outage(what);
      } finally {
        client.release();
      }
    });

  const outcomeEvent = (outcome: WfsCommitOutcome, kind: string): WfsStoreEvent | null =>
    outcome.replay ? null
    : outcome.status === 'committed' ? { kind, body: { branchId: outcome.branchId, rev: outcome.rev, commitId: outcome.commitId } }
    : { kind: 'conflict', body: { branchId: outcome.branchId, conflictId: outcome.conflictId } };

  return {
    async createProject(projectId, nowIso) {
      await refuseProtectedStore();
      const fresh = emptyWfsProject(projectId, sha256Hex);
      const main = fresh.branches.get(WFS_MAIN_BRANCH) as WfsBranchState;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const made = await client.query(
          'INSERT INTO relay_wonderland.wfs_projects(project_id, genesis_hash, created_at) VALUES($1,$2,$3) ON CONFLICT(project_id) DO NOTHING',
          [projectId, main.anchorHash, nowIso],
        );
        if ((made.rowCount ?? 0) === 1) {
          await client.query(
            `INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, head_rev, head_commit_hash, anchor_hash, created_at) VALUES($1,'main','main',0,$2,$2,$3)`,
            [projectId, main.anchorHash, nowIso],
          );
        }
        await client.query('COMMIT');
        return ok({ genesisHash: main.anchorHash });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        // a project the Wonderland runtime does not know (23503) is a refusal, not an outage
        if ((error as { code?: string }).code === '23503') return fail(relayError('not-found', 'No such project to give a file environment.', { details: ['wonderfs: unknown project'] }));
        return outage('the new project');
      } finally {
        client.release();
      }
    },
    async project(projectId) {
      await refuseProtectedStore();
      const client = await pool.connect();
      try {
        return (await loadWfsProject(client, projectId))?.state ?? null;
      } finally {
        client.release();
      }
    },
    commit: (projectId, req, nowIso) =>
      mutate(projectId, nowIso, 'the change', async (state, ctx) => {
        const r = applyWfsCommit(state, req, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: r.value.outcome, event: outcomeEvent(r.value.outcome, 'commit') });
      }),
    fork: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the branch', async (state, ctx) => {
        const r = forkWfsBranch(state, input, ctx);
        if (!r.ok) return r;
        return ok({ state: r.value.project, value: { branchId: r.value.branchId }, event: { kind: 'branch.fork', body: { branchId: r.value.branchId, fromBranchId: input.fromBranchId } } });
      }),
    mergeBack: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the merge', async (state, ctx, db) => {
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
        return ok({ state: r.value.project, value: r.value.outcome, event: outcomeEvent(r.value.outcome, 'branch.merge') });
      }),
    approve: (projectId, input, nowIso) =>
      mutate(projectId, nowIso, 'the approval', async (state, _ctx, db) => {
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
      mutate(projectId, nowIso, 'the branch', async (state) => {
        const r = discardWfsBranch(state, branchId, nowIso);
        if (!r.ok) return r;
        return ok({ state: r.value, value: null, event: { kind: 'branch.discard', body: { branchId } } });
      }),
    async putBlob(projectId, bytes) {
      await refuseProtectedStore();
      if (bytes.byteLength > limits.maxFileBytes) return fail(relayError('validation-failed', 'That file is larger than a project allows.', { details: ['wonderfs: file_too_large'] }));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
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
          cache.get(projectId)?.blobs.set(sha256, size);
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
