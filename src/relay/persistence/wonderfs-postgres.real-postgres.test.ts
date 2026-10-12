import { createHash, randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyWfsCommit,
  canonicalJson,
  emptyWfsProject,
  forkWfsBranch,
  verifyWfsChain,
  wfsEntriesAt,
  wfsGenesisHash,
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
import { loadWfsProject, openWfsPostgresStore } from './wonderfs-postgres';
import { WFS_STORE_CASES, type WfsStoreHarness } from './wonderfs-store-conformance';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * THE WONDERFS STORE ON REAL POSTGRESQL (migration 036; contract r1.4 §10). The reference engine is the ORACLE: the same scripted
 * operations run through the in-memory engine and through the store, with the same ids and the same clock, and the state the store
 * READS BACK FROM ITS ROWS (a fresh store: a restart) must equal the engine's, its hash chain must verify (§19.M7), and:
 *   EQUIV    commits, a conflict kept whole with its author, a resolution, a fork, a merge-back: rows == engine;
 *   REPLAY   an idempotent replay writes nothing (INV-8); a request id reused with another payload is refused;
 *   RACE     two stores (two bridges) committing to one branch at once: every commit lands, revisions gapless, nothing lost;
 *   APPROVE  an approval is the STORED one (by id), bound to the head; a forged object is never consulted; the approver's role
 *            is what the PRODUCT writes (OWNER / ADMIN / MEMBER) through the one mapping, and a lower-case legacy value is no role;
 *   BLOB     a blob's address is computed here; a commit naming an unheld blob is refused; a referenced blob cannot be deleted;
 *   ATOMIC   a failure inside the write rolls everything back (the version does not move, nothing half-written).
 * R0b adds:
 *   CONTRACT  the store-interface cases (wonderfs-store-conformance.ts) the in-memory store passes on every run, here on rows;
 *   TORN-READ a commit landing BETWEEN a read's statements (deterministically: the read's client pauses right after its first
 *             look at wfs_branches while another bridge commits) is invisible to project() and tree(); CONTROL: the same
 *             statements outside one snapshot tear;
 *   CACHE     a store whose remembered state is stale reads, and builds on, the rows;
 *   CREATE-IN-TX createProjectIn joins the CALLER's transaction: rolled back with it, nothing is left; CONTROL: committed, it works;
 *   VERIFY    changed, short and missing bytes are each named; an untouched blob is intact.
 * R1 adds:
 *   PROJECTS  a soft-deleted project leaves its member's list (H1); restored, it is back.
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

/** The store harness for the shared contract cases: stores over ONE database, its product rows written as the product writes them. */
function pgHarness(pool: Pool): WfsStoreHarness {
  const member = async (projectId: string, playerId: string, role: string) => {
    await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [playerId]);
    await pool.query('INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES($1,$2,$3)', [projectId, playerId, role]);
  };
  return {
    open: (options = {}) => openWfsPostgresStore(pool, options),
    async seed(projectId, members) {
      await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [projectId]);
      for (const [playerId, role] of Object.entries(members)) await member(projectId, playerId, role);
    },
    async setRole(projectId, playerId, productRole) {
      await pool.query('DELETE FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = $2', [projectId, playerId]);
      if (productRole !== null) await member(projectId, playerId, productRole);
    },
  };
}

/**
 * A pool whose clients, right after the FIRST statement matching `after`, run `land` -- another bridge's whole commit -- before
 * the caller's next statement goes out. Deterministic interleaving: no timing, no retries.
 */
function interleaved(pool: Pool, after: RegExp, land: () => Promise<void>): Pool {
  let fired = false;
  const passThrough = <T extends object>(target: T, prop: string | symbol): unknown => {
    const v: unknown = Reflect.get(target, prop);
    return typeof v === 'function' ? v.bind(target) : v;
  };
  const wrap = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, prop) {
      if (prop !== 'query') return passThrough(target, prop);
      return async (text: unknown, values?: unknown) => {
        const result: unknown = await (target.query as unknown as (t: unknown, v?: unknown) => Promise<unknown>).call(target, text, values);
        if (!fired && typeof text === 'string' && after.test(text)) {
          fired = true;
          await land();
        }
        return result;
      };
    },
  });
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === 'connect') return async () => wrap(await target.connect());
      return passThrough(target, prop);
    },
  });
}

/** One committed state: main's commits are gapless up to its head, the head hash is the last commit's, and the entries are what the commits make. */
function consistent(s: WfsProjectState): boolean {
  const main = s.branches.get(WFS_MAIN_BRANCH)!;
  const sorted = (m: ReadonlyMap<string, unknown>) => canonicalJson([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return main.commits.length === main.headRev
    && main.commits.every((c, i) => c.rev === i + 1)
    && (main.commits.at(-1)?.commitHash ?? main.anchorHash) === main.headCommitHash
    && sorted(main.entries) === sorted(wfsEntriesAt(main));
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
    await pool.query("INSERT INTO relay_wonderland.players(player_id) VALUES('usr_owner'), ('usr_admin'), ('usr_member'), ('usr_legacy_owner'), ('usr_legacy_editor')");
    await pool.query("INSERT INTO relay_wonderland.projects(project_id) VALUES('prj-1')");
    // the roles the PRODUCT writes (the mission seed: OWNER; Project Brain's membership change: ADMIN / MEMBER -- pinned by
    // wonderland-authorization.test.ts), plus two LOWER-CASE legacy rows no product writer produces: they must read as NO role
    await pool.query(`INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES('prj-1','usr_owner','OWNER'), ('prj-1','usr_admin','ADMIN'),
      ('prj-1','usr_member','MEMBER'), ('prj-1','usr_legacy_owner','owner'), ('prj-1','usr_legacy_editor','editor')`);
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
    const conflict = await both({ requestId: 'req-00000003', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: who('usr_member'), ops: [{ op: 'update', fileId, expectContentVersion: 1, ...a }] });
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
    // T-CRASH "after COMMIT, before the response" (INV-11): the bridge restarts (a NEW store, its rows only) and the player signs
    // in again, so the journal's replay carries a new session ref and build. It is answered with the ORIGINAL revision.
    await store.commit('prj-1', { ...req, requestId: 'req-replay-02', baseRev: 1, ops: [{ op: 'create', path: 'later', kind: 'dir' }] }, NOW);
    const restarted = openWfsPostgresStore(pool, { newId: idSource() });
    const resignedIn: WfsCommitRequest = { ...req, principal: { ...req.principal, sessionId: 'sref-after-restart', clientBuild: 'build-2' } };
    const eventsBeforeReplay = await events();
    const replayed = await restarted.commit('prj-1', resignedIn, NOW);
    expect(replayed.ok && replayed.value).toEqual(first.ok && { ...first.value, replay: true });
    expect(await events(), 'a replay after a restart writes nothing').toBe(eventsBeforeReplay);
    // CONTROLS: the same key from ANOTHER player, or with other content, is still refused
    const otherPlayer = await restarted.commit('prj-1', { ...resignedIn, principal: who('usr_member') }, NOW);
    expect(otherPlayer.ok === false && otherPlayer.error.code).toBe('duplicate-idempotency-key');
    const otherContent = await restarted.commit('prj-1', { ...resignedIn, ops: [{ op: 'create', path: 'other', kind: 'dir' }] }, NOW);
    expect(otherContent.ok === false && otherContent.error.code).toBe('duplicate-idempotency-key');
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

  it('APPROVE: only an editor/owner approves (the PRODUCT role read NOW from project_members, through the one mapping); a lower-case legacy value is no role; the merge uses the STORED approval by id', async () => {
    const pool = await fresh('approve');
    const store = openWfsPostgresStore(pool);
    await store.createProject('prj-1', NOW);
    const agent = who('agent-1', 'imported_agent');
    const fork = await store.fork('prj-1', { fromBranchId: WFS_MAIN_BRANCH, owner: agent }, NOW);
    if (!fork.ok) throw new Error(fork.error.message);
    const branchId = fork.value.branchId;
    await store.commit('prj-1', { requestId: 'req-agent-0001', branchId, baseRev: 0, principal: agent, ops: [{ op: 'create', path: 'agent', kind: 'dir' }] }, NOW);
    // r1.4 §8.2: each role the product writes may approve -- OWNER -> owner, ADMIN -> editor, MEMBER -> editor
    for (const approver of ['usr_owner', 'usr_admin', 'usr_member']) {
      const r = await store.approve('prj-1', { branchId, principal: who(approver) }, NOW);
      expect(r.ok, `${approver} approves`).toBe(true);
    }
    // NOT SILENTLY ELEVATED: a lower-case legacy 'owner' / 'editor' row is no role, refused exactly as a non-member is; and the
    // agent itself never approves (CONTROL for the three above: a case-insensitive mapping would let the legacy rows approve)
    for (const approver of ['usr_legacy_owner', 'usr_legacy_editor', 'usr_not_a_member']) {
      const r = await store.approve('prj-1', { branchId, principal: who(approver) }, NOW);
      expect(r.ok === false && r.error.details, `${approver} is refused`).toEqual(['wonderfs: approval_forbidden']);
    }
    expect((await store.approve('prj-1', { branchId, principal: agent }, NOW)).ok).toBe(false);
    const approved = await store.approve('prj-1', { branchId, principal: who('usr_member') }, NOW);
    if (!approved.ok) throw new Error(approved.error.message);
    const mergeWith = (requestId: string) => store.mergeBack('prj-1', { requestId, branchId, principal: agent, approvalId: approved.value.approvalId, reviewVerdict: null }, NOW);
    // the MEMBER is removed before the merge: the approval no longer carries (r1.4 N-minor-1)
    await pool.query("DELETE FROM relay_wonderland.project_members WHERE project_id = 'prj-1' AND player_id = 'usr_member'");
    const removed = await mergeWith('req-merge-0001');
    expect(removed.ok === false && removed.error.details).toEqual(['wonderfs: approval_stale']);
    // re-added with a LOWER-CASE legacy value: still no role at merge time, still refused
    await pool.query("INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES('prj-1','usr_member','editor')");
    const legacy = await mergeWith('req-merge-0002');
    expect(legacy.ok === false && legacy.error.details).toEqual(['wonderfs: approval_stale']);
    // CONTROL: back to what the product writes, the same stored approval merges
    await pool.query("UPDATE relay_wonderland.project_members SET role = 'MEMBER' WHERE project_id = 'prj-1' AND player_id = 'usr_member'");
    const merged = await mergeWith('req-merge-0003');
    expect(merged.ok && merged.value.status).toBe('committed');
    // an approval id that was never stored is no approval at all
    const fork2 = await store.fork('prj-1', { fromBranchId: WFS_MAIN_BRANCH, owner: agent }, NOW);
    if (!fork2.ok) throw new Error(fork2.error.message);
    await store.commit('prj-1', { requestId: 'req-agent-0002', branchId: fork2.value.branchId, baseRev: 0, principal: agent, ops: [{ op: 'create', path: 'agent2', kind: 'dir' }] }, NOW);
    const forged = await store.mergeBack('prj-1', { requestId: 'req-merge-0004', branchId: fork2.value.branchId, principal: agent, approvalId: 'approval_forged', reviewVerdict: null }, NOW);
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

  // R0b: THE STORE CONTRACT -- the same cases the in-memory store passes on every run (wonderfs-memory-store.test.ts), here on rows
  let contract: WfsStoreHarness | null = null;
  const contractHarness = async (): Promise<WfsStoreHarness> => {
    if (contract === null) contract = pgHarness(await fresh('contract'));
    return contract;
  };
  for (const c of WFS_STORE_CASES) {
    it(`CONTRACT ${c.name}`, async () => c.run(await contractHarness()), 300_000);
  }

  const dir = (i: number, baseRev = 0): WfsCommitRequest => ({
    requestId: `req-dir-${String(i).padStart(5, '0')}`, branchId: WFS_MAIN_BRANCH, baseRev, principal: who('usr_owner'), ops: [{ op: 'create', path: `d${i}`, kind: 'dir' }],
  });

  it('TORN-READ (F4): a commit landing BETWEEN a read\'s statements is invisible to it -- project() and tree() each show ONE committed state; CONTROL: outside one snapshot the same statements tear', async () => {
    const pool = await fresh('torn');
    const writer = openWfsPostgresStore(pool);
    await writer.createProject('prj-1', NOW);
    for (let i = 1; i <= 3; i += 1) expect((await writer.commit('prj-1', dir(i), NOW)).ok).toBe(true);
    let landed = 0;
    const land = async (): Promise<void> => {
      landed += 1;
      const r = await writer.commit('prj-1', dir(100 + landed), NOW);
      expect(r.ok && r.value.status, 'the interleaved commit lands').toBe('committed');
    };
    const AFTER_BRANCHES = /FROM relay_wonderland\.wfs_branches/u;
    const headNow = async () => (await openWfsPostgresStore(pool).project('prj-1'))!.branches.get(WFS_MAIN_BRANCH)!;

    // CONTROL: the whole-state read's statements, one by one outside a transaction (READ COMMITTED autocommit), with a commit
    // landing after the branches were read: the head says 3, the commits and entries say 4 -- a state that never existed
    const tearing = await interleaved(pool, AFTER_BRANCHES, land).connect();
    const torn = await loadWfsProject(tearing, 'prj-1').finally(() => tearing.release());
    expect(landed).toBe(1);
    expect(torn!.state.branches.get(WFS_MAIN_BRANCH)!.headRev).toBe(3);
    expect(torn!.state.branches.get(WFS_MAIN_BRANCH)!.commits.length, 'CONTROL: outside one snapshot the read mixes two states').toBe(4);
    expect(consistent(torn!.state), 'CONTROL: the torn state fails the check').toBe(false);

    // project(): ONE snapshot -- the commit that lands mid-read (rev 5) is invisible; the read is exactly the rev-4 state
    const atFour = await openWfsPostgresStore(pool).project('prj-1');
    expect(atFour!.branches.get(WFS_MAIN_BRANCH)!.headRev).toBe(4);
    const seen = await openWfsPostgresStore(interleaved(pool, AFTER_BRANCHES, land)).project('prj-1');
    expect(landed, 'a commit landed DURING the read').toBe(2);
    expect(consistent(seen!)).toBe(true);
    expect(plain(seen!), 'the read is the state at its start').toEqual(plain(atFour!));
    expect((await headNow()).headRev, 'and the commit did land').toBe(5);

    // tree(): the head is read, a commit lands (rev 6), the entries are read -- still the rev-5 tree, nothing of rev 6
    const page = await openWfsPostgresStore(interleaved(pool, AFTER_BRANCHES, land)).tree('prj-1', { branchId: WFS_MAIN_BRANCH });
    expect(landed).toBe(3);
    const main = await headNow();
    expect(main.headRev).toBe(6);
    expect(page.ok && [page.value.rev, page.value.headRev]).toEqual([5, 5]);
    expect(page.ok && page.value.entries.map((e) => e.path)).toEqual(wfsTreeAt(main, 5).map((e) => e.path));
    expect(wfsTreeAt(main, 6).length, 'CONTROL: the mid-read commit added an entry the page must not show').toBe(wfsTreeAt(main, 5).length + 1);
  }, 120_000);

  it('CACHE: a store whose remembered state is stale (another bridge committed since) reads, and builds on, the rows', async () => {
    const pool = await fresh('cache');
    const one = openWfsPostgresStore(pool);
    const two = openWfsPostgresStore(pool);
    await one.createProject('prj-1', NOW);
    expect((await one.commit('prj-1', dir(1), NOW)).ok).toBe(true); // one remembers the project at this version
    expect((await two.commit('prj-1', dir(2, 1), NOW)).ok).toBe(true); // the rows move on without it
    const seen = await one.project('prj-1');
    expect(seen!.branches.get(WFS_MAIN_BRANCH)!.headRev).toBe(2);
    expect(plain(seen!)).toEqual(plain((await openWfsPostgresStore(pool).project('prj-1'))!));
    const head = await one.head('prj-1');
    expect(head.ok && head.value.main.headRev).toBe(2);
    const next = await one.commit('prj-1', dir(3, 2), NOW);
    expect(next.ok && next.value.status === 'committed' && next.value.rev, 'built on the rows, not on a stale memory').toBe(3);
  }, 120_000);

  it('CREATE-IN-TX: createProjectIn joins the CALLER\'s transaction -- rolled back with it, nothing is left; CONTROL: committed with it, the project works', async () => {
    const pool = await fresh('createin');
    const store = openWfsPostgresStore(pool);
    const count = async (table: string, projectId: string) => Number((await pool.query(`SELECT count(*) AS n FROM relay_wonderland.${table} WHERE project_id = $1`, [projectId])).rows[0].n);
    const inCallerTx = async (projectId: string, end: 'COMMIT' | 'ROLLBACK') => {
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        await tx.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [projectId]);
        const made = await store.createProjectIn(tx, projectId, NOW);
        expect(made).toEqual({ genesisHash: wfsGenesisHash(projectId, sha), created: true });
        expect(Number((await tx.query("SELECT count(*) AS n FROM relay_wonderland.wfs_branches WHERE project_id = $1 AND branch_id = 'main'", [projectId])).rows[0].n), 'inside the caller\'s transaction: main exists').toBe(1);
        expect(await count('wfs_projects', projectId), 'outside it, before it ends: nothing (it is the caller\'s transaction, not one of its own)').toBe(0);
        await tx.query(end);
      } finally {
        tx.release();
      }
    };
    await inCallerTx('prj-rolled-back', 'ROLLBACK');
    expect([await count('wfs_projects', 'prj-rolled-back'), await count('wfs_branches', 'prj-rolled-back'), await count('projects', 'prj-rolled-back')]).toEqual([0, 0, 0]);
    const gone = await store.head('prj-rolled-back');
    expect(gone.ok === false && gone.error.code).toBe('not-found');
    // CONTROL: the same steps, committed, leave a working project
    await inCallerTx('prj-committed', 'COMMIT');
    const first = await store.commit('prj-committed', dir(1), NOW);
    expect(first.ok && first.value.status === 'committed' && first.value.rev).toBe(1);
    // a second createProjectIn for it keeps the one it has
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      expect(await store.createProjectIn(tx, 'prj-committed', NOW)).toEqual({ genesisHash: wfsGenesisHash('prj-committed', sha), created: false });
      await tx.query('COMMIT');
    } finally {
      tx.release();
    }
    const head = await store.head('prj-committed');
    expect(head.ok && head.value.main.headRev).toBe(1);
  }, 120_000);

  it('VERIFY: a blob\'s stored bytes are re-hashed against its address and size -- changed, short and missing bytes are each named; an untouched blob is intact', async () => {
    const pool = await fresh('verify');
    const store = openWfsPostgresStore(pool);
    await store.createProject('prj-1', NOW);
    const put = async (text: string): Promise<string> => {
      const r = await store.putBlob('prj-1', new TextEncoder().encode(text));
      if (!r.ok) throw new Error(r.error.message);
      return r.value.sha256;
    };
    const intact = await put('intact');
    const changed = await put('changed');
    const short = await put('short');
    const gone = await put('gone');
    await pool.query('UPDATE relay_wonderland.wfs_blob_bytes SET bytes = $2 WHERE sha256 = $1', [changed, Buffer.from('chanGed')]);
    await pool.query('UPDATE relay_wonderland.wfs_blob_bytes SET bytes = $2 WHERE sha256 = $1', [short, Buffer.from('shor')]);
    await pool.query('DELETE FROM relay_wonderland.wfs_blob_bytes WHERE sha256 = $1', [gone]);
    expect(await store.verifyBlob('prj-1', intact)).toEqual({ ok: true, value: { status: 'intact', size: 6 } });
    expect(await store.verifyBlob('prj-1', changed)).toEqual({ ok: true, value: { status: 'corrupt', reason: 'hash_mismatch' } });
    expect(await store.verifyBlob('prj-1', short)).toEqual({ ok: true, value: { status: 'corrupt', reason: 'size_mismatch' } });
    expect(await store.verifyBlob('prj-1', gone)).toEqual({ ok: true, value: { status: 'corrupt', reason: 'bytes_missing' } });
  }, 120_000);

  it('PROJECTS (R1, H1) soft delete: a soft-deleted project leaves the member\'s list at once; CONTROL: restored, it is back', async () => {
    const pool = await fresh('projects');
    const store = openWfsPostgresStore(pool);
    await pool.query("INSERT INTO relay_wonderland.projects(project_id) VALUES('prj-2')");
    await pool.query("INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES('prj-2','usr_owner','OWNER')");
    expect((await store.createProject('prj-1', NOW)).ok).toBe(true);
    expect((await store.createProject('prj-2', NOW)).ok).toBe(true);
    const mine = async () => {
      const r = await store.projectsOf('usr_owner', {});
      if (!r.ok) throw new Error(r.error.message);
      return r.value.projects.map((p) => p.projectId);
    };
    expect(await mine()).toEqual(['prj-1', 'prj-2']);
    await pool.query("UPDATE relay_wonderland.wfs_projects SET deleted_at = now(), purge_after = now() + interval '30 days' WHERE project_id = 'prj-2'");
    expect(await mine(), 'a soft-deleted project is hidden from its members').toEqual(['prj-1']);
    await pool.query("UPDATE relay_wonderland.wfs_projects SET deleted_at = NULL, purge_after = NULL WHERE project_id = 'prj-2'");
    expect(await mine(), 'CONTROL: restored, it is listed again').toEqual(['prj-1', 'prj-2']);
    // the legacy lower-case rows of the fixture (usr_legacy_owner 'owner') list nothing
    const legacy = await store.projectsOf('usr_legacy_owner', {});
    expect(legacy.ok && legacy.value).toEqual({ projects: [], next: null });
  }, 120_000);
});
