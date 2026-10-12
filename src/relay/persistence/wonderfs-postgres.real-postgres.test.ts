import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyWfsCommit,
  emptyWfsProject,
  forkWfsBranch,
  verifyWfsChain,
  wfsTreeAt,
  WFS_ALPHA_LIMITS,
  WFS_MAIN_BRANCH,
  type WfsCommitOutcome,
  type WfsCommitRequest,
  type WfsEngineContext,
  type WfsOp,
  type WfsPrincipal,
  type WfsProjectState,
} from '../wonderfs';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { openWfsPostgresStore } from './wonderfs-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * THE WONDERFS STORE ON REAL POSTGRESQL (migration 036; contract r1.4 §10). The reference engine is the ORACLE: the same scripted
 * operations run through the in-memory engine and through the store, with the same ids and the same clock, and the state the store
 * READS BACK FROM ITS ROWS (a fresh store: a restart) must equal the engine's, its hash chain must verify (§19.M7), and:
 *   EQUIV    commits, a conflict kept whole with its author, a resolution, a fork, a merge-back: rows == engine;
 *   REPLAY   an idempotent replay writes nothing (INV-8); a request id reused with another payload is refused;
 *   RACE     two stores (two bridges) committing to one branch at once: every commit lands, revisions gapless, nothing lost;
 *   APPROVE  an approval is the STORED one (by id), bound to the head; a forged object is never consulted;
 *   BLOB     a blob's address is computed here; a commit naming an unheld blob is refused; a referenced blob cannot be deleted;
 *   ATOMIC   a failure inside the write rolls everything back (the version does not move, nothing half-written).
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const NOW = '2026-10-12T09:00:00.000Z';
const who = (id: string, kind: WfsPrincipal['kind'] = 'human'): WfsPrincipal => ({
  kind, id, onBehalfOf: kind === 'human' ? null : 'usr_owner', grantId: kind === 'human' ? null : `grant-${id}`, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null,
});

/** The same deterministic ids for the oracle and the store. */
function idSource() {
  let n = 0;
  return (kind: string) => {
    n += 1;
    return `${kind}-${String(n).padStart(5, '0')}`;
  };
}

/** A project state as comparable data (Maps become sorted entry lists). */
function plain(p: WfsProjectState): unknown {
  const sorted = <V>(m: ReadonlyMap<string, V>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    projectId: p.projectId,
    branches: sorted(p.branches).map(([id, b]) => [id, { ...b, entries: sorted(b.entries), base: sorted(b.base) }]),
    conflicts: sorted(p.conflicts),
    requests: sorted(p.requests),
  };
}

suite('the WonderFS store on real PostgreSQL: the engine is the oracle', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const fresh = async (label: string): Promise<Pool> => {
    const name = `wfsstore${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 6 });
    made.push({ name, pool });
    await new TransactionalWonderlandDatabase(pool).migrate();
    await pool.query("INSERT INTO relay_wonderland.players(player_id) VALUES('usr_owner'), ('usr_editor'), ('usr_viewer')");
    await pool.query("INSERT INTO relay_wonderland.projects(project_id) VALUES('prj-1')");
    await pool.query("INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES('prj-1','usr_owner','owner'), ('prj-1','usr_editor','editor'), ('prj-1','usr_viewer','viewer')");
    return pool;
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterAll(async () => {
    for (const { name, pool } of made) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('EQUIV: commits, a conflict kept whole, its resolution, a fork and its merge-back -- the rows read back equal the engine, and the chain verifies', async () => {
    const pool = await fresh('equiv');
    const storeIds = idSource();
    const engineIds = idSource();
    const store = openWfsPostgresStore(pool, { newId: storeIds });
    expect((await store.createProject('prj-1', NOW)).ok).toBe(true);
    const blobs = new Map<string, number>();
    const put = async (text: string) => {
      const r = await store.putBlob('prj-1', new TextEncoder().encode(text));
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.sha256).toBe(sha(text));
      blobs.set(r.value.sha256, r.value.size);
      return r.value;
    };
    const ctx: WfsEngineContext = { nowIso: NOW, newId: (k) => engineIds(k), sha256Hex: sha, blobSize: (h) => blobs.get(h) ?? null, limits: WFS_ALPHA_LIMITS };
    let oracle = emptyWfsProject('prj-1', sha);
    const both = async (req: WfsCommitRequest): Promise<WfsCommitOutcome> => {
      const e = applyWfsCommit(oracle, req, ctx);
      if (!e.ok) throw new Error(`oracle refused: ${e.error.message}`);
      oracle = e.value.project;
      const s = await store.commit('prj-1', req, NOW);
      if (!s.ok) throw new Error(`store refused: ${s.error.message}`);
      expect(s.value, 'the same answer').toEqual(e.value.outcome);
      return s.value;
    };
    const a = await put('alpha');
    const b = await put('beta');
    const human = who('usr_owner');
    await both({ requestId: 'req-00000001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human, ops: [{ op: 'create', path: 'src', kind: 'dir' }, { op: 'create', path: 'src/a.txt', kind: 'file', ...a }] });
    const fileId = wfsTreeAt(oracle.branches.get(WFS_MAIN_BRANCH)!).find((x) => x.path === 'src/a.txt')!.fileId;
    await both({ requestId: 'req-00000002', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: human, ops: [{ op: 'update', fileId, expectContentVersion: 1, ...b }] });
    // a STALE edit: kept whole as a conflict, with its author (INV-2)
    const conflict = await both({ requestId: 'req-00000003', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: who('usr_editor'), ops: [{ op: 'update', fileId, expectContentVersion: 1, ...a }] });
    expect(conflict.status).toBe('conflict');
    // resolved by keeping theirs (a dismissal: a resolving commit with no ops)
    if (conflict.status === 'conflict') await both({ requestId: 'req-00000004', branchId: WFS_MAIN_BRANCH, baseRev: 2, principal: human, ops: [], resolvesConflictId: conflict.conflictId });
    // a fork for an agent, a commit there, and its merge-back
    const forked = forkWfsBranch(oracle, { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-1', 'julius') }, ctx);
    if (!forked.ok) throw new Error(forked.error.message);
    oracle = forked.value.project;
    const sFork = await store.fork('prj-1', { fromBranchId: WFS_MAIN_BRANCH, owner: who('julius-1', 'julius') }, NOW);
    expect(sFork.ok && sFork.value.branchId).toBe(forked.value.branchId);
    const c = await put('gamma');
    await both({ requestId: 'req-00000005', branchId: forked.value.branchId, baseRev: 0, principal: who('julius-1', 'julius'), ops: [{ op: 'create', path: 'src/c.txt', kind: 'file', ...c }] });

    // RESTART: a NEW store reads the project back from its rows only
    const reread = await openWfsPostgresStore(pool).project('prj-1');
    expect(reread).not.toBeNull();
    expect(plain(reread!), 'rows == engine').toEqual(plain(oracle));
    // every branch's chain verifies from its own anchor (main: the genesis; an agent branch: the parent's hash at the fork)
    for (const [branchId, branch] of reread!.branches) expect(verifyWfsChain(branch.commits, sha, branch.anchorHash), `${branchId} chain`).toBeNull();
    // CONTROL: the same check on a tampered copy of the rows' history breaks
    const mainCommits = reread!.branches.get(WFS_MAIN_BRANCH)!.commits;
    expect(verifyWfsChain(mainCommits.map((c, i) => (i === 0 ? { ...c, atIso: '2030-01-01T00:00:00.000Z' } : c)), sha, reread!.branches.get(WFS_MAIN_BRANCH)!.anchorHash)).not.toBeNull();
    // the conflict row: retained (a dismissal), its blob held
    const conflictRow = (await pool.query('SELECT status, retain_until IS NOT NULL AS retained FROM relay_wonderland.wfs_conflicts')).rows;
    expect(conflictRow).toEqual([{ status: 'dismissed', retained: true }]);
    expect(Number((await pool.query('SELECT count(*) AS n FROM relay_wonderland.wfs_conflict_blobs')).rows[0].n)).toBe(1);
    // the event log: one per change, gapless from 1
    const seqs = (await pool.query('SELECT seq FROM relay_wonderland.wfs_events ORDER BY seq')).rows.map((r: { seq: string }) => Number(r.seq));
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  }, 180_000);

  it('REPLAY: an idempotent replay writes nothing; the same request id with another payload is refused', async () => {
    const pool = await fresh('replay');
    const store = openWfsPostgresStore(pool, { newId: idSource() });
    await store.createProject('prj-1', NOW);
    const req: WfsCommitRequest = { requestId: 'req-replay-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'notes', kind: 'dir' }] };
    const first = await store.commit('prj-1', req, NOW);
    const events = async () => Number((await pool.query('SELECT count(*) AS n FROM relay_wonderland.wfs_events')).rows[0].n);
    const before = await events();
    const again = await store.commit('prj-1', req, NOW);
    expect(again.ok && again.value).toEqual(first.ok && { ...first.value, replay: true });
    expect(await events(), 'a replay writes nothing').toBe(before);
    const reused = await store.commit('prj-1', { ...req, ops: [{ op: 'create', path: 'other', kind: 'dir' }] }, NOW);
    expect(reused.ok === false && reused.error.code).toBe('duplicate-idempotency-key');
  }, 120_000);

  it('RACE: two stores (two bridges) commit to one branch at once -- every commit lands, the revisions are gapless, nothing is lost', async () => {
    const pool = await fresh('race');
    const one = openWfsPostgresStore(pool);
    const two = openWfsPostgresStore(pool);
    await one.createProject('prj-1', NOW);
    const make = (i: number): WfsCommitRequest => ({ requestId: `req-race-${String(i).padStart(4, '0')}`, branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: `d${i}`, kind: 'dir' }] as WfsOp[] });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? one : two).commit('prj-1', make(i), NOW)));
    expect(results.every((r) => r.ok && r.value.status === 'committed'), JSON.stringify(results.filter((r) => !r.ok))).toBe(true);
    const revs = (await pool.query("SELECT rev FROM relay_wonderland.wfs_commits WHERE branch_id = 'main' ORDER BY rev")).rows.map((r: { rev: number }) => r.rev);
    expect(revs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    const tree = wfsTreeAt((await openWfsPostgresStore(pool).project('prj-1'))!.branches.get(WFS_MAIN_BRANCH)!);
    expect(tree.map((e) => e.path).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `d${i}`).sort());
  }, 120_000);

  it('APPROVE: only an editor/owner approves (role read NOW from project_members); the merge uses the STORED approval by id', async () => {
    const pool = await fresh('approve');
    const store = openWfsPostgresStore(pool);
    await store.createProject('prj-1', NOW);
    const agent = who('agent-1', 'imported_agent');
    const fork = await store.fork('prj-1', { fromBranchId: WFS_MAIN_BRANCH, owner: agent }, NOW);
    if (!fork.ok) throw new Error(fork.error.message);
    const branchId = fork.value.branchId;
    await store.commit('prj-1', { requestId: 'req-agent-0001', branchId, baseRev: 0, principal: agent, ops: [{ op: 'create', path: 'agent', kind: 'dir' }] }, NOW);
    // a viewer may not approve; neither may the agent itself
    expect((await store.approve('prj-1', { branchId, principal: who('usr_viewer') }, NOW)).ok).toBe(false);
    expect((await store.approve('prj-1', { branchId, principal: agent }, NOW)).ok).toBe(false);
    const approved = await store.approve('prj-1', { branchId, principal: who('usr_editor') }, NOW);
    if (!approved.ok) throw new Error(approved.error.message);
    // the editor is demoted before the merge: the approval no longer carries (r1.4 N-minor-1)
    await pool.query("UPDATE relay_wonderland.project_members SET role = 'viewer' WHERE player_id = 'usr_editor'");
    const refused = await store.mergeBack('prj-1', { requestId: 'req-merge-0001', branchId, principal: agent, approvalId: approved.value.approvalId, reviewVerdict: null }, NOW);
    expect(refused.ok && refused.value.status === 'committed').toBe(false);
    await pool.query("UPDATE relay_wonderland.project_members SET role = 'editor' WHERE player_id = 'usr_editor'");
    const merged = await store.mergeBack('prj-1', { requestId: 'req-merge-0002', branchId, principal: agent, approvalId: approved.value.approvalId, reviewVerdict: null }, NOW);
    expect(merged.ok && merged.value.status).toBe('committed');
    // an approval id that was never stored is no approval at all
    const fork2 = await store.fork('prj-1', { fromBranchId: WFS_MAIN_BRANCH, owner: agent }, NOW);
    if (!fork2.ok) throw new Error(fork2.error.message);
    await store.commit('prj-1', { requestId: 'req-agent-0002', branchId: fork2.value.branchId, baseRev: 0, principal: agent, ops: [{ op: 'create', path: 'agent2', kind: 'dir' }] }, NOW);
    const forged = await store.mergeBack('prj-1', { requestId: 'req-merge-0003', branchId: fork2.value.branchId, principal: agent, approvalId: 'approval_forged', reviewVerdict: null }, NOW);
    expect(forged.ok && forged.value.status === 'committed').toBe(false);
  }, 120_000);

  it('BLOB: the address is computed here; a commit naming an unheld blob is refused; a blob a version names cannot be deleted', async () => {
    const pool = await fresh('blob');
    const store = openWfsPostgresStore(pool);
    await store.createProject('prj-1', NOW);
    const held = await store.putBlob('prj-1', new TextEncoder().encode('held'));
    if (!held.ok) throw new Error(held.error.message);
    expect(held.value).toEqual({ sha256: sha('held'), size: 4 });
    expect(new TextDecoder().decode((await store.readBlob('prj-1', sha('held')))!)).toBe('held');
    const unheld = await store.commit('prj-1', { requestId: 'req-blob-0001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'x.txt', kind: 'file', sha256: sha('never uploaded'), size: 14 }] }, NOW);
    expect(unheld.ok).toBe(false);
    const ok1 = await store.commit('prj-1', { requestId: 'req-blob-0002', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'x.txt', kind: 'file', ...held.value }] }, NOW);
    expect(ok1.ok && ok1.value.status).toBe('committed');
    const deleted = await pool.query('DELETE FROM relay_wonderland.wfs_blobs WHERE sha256 = $1', [sha('held')]).then(() => null, (e: { code?: string }) => e.code);
    expect(deleted, 'a referenced blob is never deleted (refused at COMMIT)').toBe('23503');
  }, 120_000);

  it('ATOMIC: a failure inside the write rolls everything back -- the version does not move and no row is half-written', async () => {
    const pool = await fresh('atomic');
    const store = openWfsPostgresStore(pool);
    await store.createProject('prj-1', NOW);
    // the versions table refuses every insert (a planted failure mid-transaction, after the commit row went in)
    await pool.query(`CREATE FUNCTION relay_wonderland.wfs_test_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'planted'; END $$`);
    await pool.query('CREATE TRIGGER wfs_test_refuse BEFORE INSERT ON relay_wonderland.wfs_versions FOR EACH ROW EXECUTE FUNCTION relay_wonderland.wfs_test_refuse()');
    const r = await store.commit('prj-1', { requestId: 'req-atom-0001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW);
    expect(r.ok === false && r.error.retryable).toBe(true);
    const counts = (await pool.query(`SELECT (SELECT count(*) FROM relay_wonderland.wfs_commits) AS commits, (SELECT count(*) FROM relay_wonderland.wfs_requests) AS requests,
      (SELECT count(*) FROM relay_wonderland.wfs_events) AS events, (SELECT next_event_seq FROM relay_wonderland.wfs_projects) AS seq`)).rows[0];
    expect({ commits: Number(counts.commits), requests: Number(counts.requests), events: Number(counts.events), seq: Number(counts.seq) }).toEqual({ commits: 0, requests: 0, events: 0, seq: 1 });
    // CONTROL: without the planted failure the same request commits
    await pool.query('DROP TRIGGER wfs_test_refuse ON relay_wonderland.wfs_versions');
    const again = await store.commit('prj-1', { requestId: 'req-atom-0001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: who('usr_owner'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW);
    expect(again.ok && again.value.status).toBe('committed');
  }, 120_000);
});
