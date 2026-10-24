import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { openWfsPostgresStore } from '../src/relay/persistence/wonderfs-postgres';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { WFS_MAIN_BRANCH } from '../src/relay/wonderfs/wonderfs-engine';
import type { WfsPrincipal } from '../src/relay/wonderfs/wonderfs-contracts';
import type { WfsStore } from '../src/relay/wonderfs/wonderfs-store';
import { createBrowserSessionStore } from './browser-session/grants';
import { createWonderfsBudgets } from './wonderfs-budgets';
import { wonderfsSessionVerifier } from './wonderfs-gate';
import { answerWonderfs, type WonderfsRouteDeps } from './wonderfs-routes';

/**
 * WONDERFS R1 READ ROUTES ON REAL POSTGRESQL (migration 036; CI). The same routes wonderfs-routes.test.ts drives over the memory
 * store, here over ROWS: the roles the PRODUCT writes in project_members (OWNER / ADMIN / MEMBER, and lower-case legacy rows that
 * must read as no role), the uniform 404 for a non-member and an unknown project, H1 without a soft-deleted project, bytes re-hashed
 * from wfs_blob_bytes, the bound tree cursor, and an outage answered 503 (never "not found").
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const T0 = Date.parse('2026-10-12T12:00:00.000Z');
const NOW = new Date(T0).toISOString();
const P = 'prj-alpha';
const human = (id: string): WfsPrincipal => ({ kind: 'human', id, onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null });

suite('WonderFS R1 read routes on real PostgreSQL', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const fresh = async (label: string): Promise<Pool> => {
    const name = `wfsroutes${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 4 });
    made.push({ name, pool });
    await new TransactionalWonderlandDatabase(pool).migrate();
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

  /** The product's rows, as the product writes them, then a file environment with history. */
  const seeded = async (pool: Pool) => {
    for (const p of ['ghu-1', 'ghu-2', 'ghu-3', 'ghu-5', 'ghu-8', 'ghu-9']) await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [p]);
    for (const p of [P, 'prj-beta', 'prj-unfiled']) await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [p]);
    const members: Array<[string, string, string]> = [
      [P, 'ghu-1', 'OWNER'], [P, 'ghu-2', 'ADMIN'], [P, 'ghu-3', 'MEMBER'], [P, 'ghu-8', 'editor'], [P, 'ghu-9', 'owner'],
      ['prj-beta', 'ghu-1', 'OWNER'], ['prj-unfiled', 'ghu-1', 'OWNER'],
    ];
    for (const [project, player, role] of members) await pool.query('INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES($1,$2,$3)', [project, player, role]);
    const store = openWfsPostgresStore(pool);
    for (const p of [P, 'prj-beta']) expect((await store.createProject(p, NOW)).ok).toBe(true);
    const put = async (text: string) => {
      const r = await store.putBlob(P, new TextEncoder().encode(text));
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const v1 = await put('first words');
    const v2 = await put('second words');
    const c1 = await store.commit(P, { requestId: 'req-pgroute-01', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human('ghu-1'), ops: [
      { op: 'create', path: 'docs', kind: 'dir' }, { op: 'create', path: 'docs/readme.txt', kind: 'file', ...v1 }, { op: 'create', path: 'a', kind: 'dir' }, { op: 'create', path: 'b', kind: 'dir' },
    ] }, NOW);
    expect(c1.ok && c1.value.status).toBe('committed');
    const tree = await store.tree(P, { branchId: WFS_MAIN_BRANCH });
    const readme = tree.ok ? tree.value.entries.find((e) => e.path === 'docs/readme.txt')!.fileId : '';
    const c2 = await store.commit(P, { requestId: 'req-pgroute-02', branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: human('ghu-1'), ops: [{ op: 'update', fileId: readme, expectContentVersion: 1, ...v2 }] }, NOW);
    expect(c2.ok && c2.value.status).toBe('committed');
    const sessions = createBrowserSessionStore();
    const tokens: Record<string, string> = {};
    for (const p of ['ghu-1', 'ghu-2', 'ghu-3', 'ghu-5', 'ghu-8', 'ghu-9']) {
      const m = sessions.mintNativeSocialSession({ now: T0, participantId: p });
      if (!m.ok) throw new Error('not minted');
      tokens[p] = m.session.token;
    }
    return { store, sessions, tokens, readme, v1, v2 };
  };

  const ask = async (deps: WonderfsRouteDeps, token: string, url: string, range?: string) => {
    const a = await answerWonderfs({ method: 'GET', url, authorization: `Relay-Session ${token}`, origin: undefined, clientBuild: undefined, range, now: T0 + 1 }, deps);
    if (a === null) throw new Error(`not a WonderFS route: ${url}`);
    a.release?.();
    const isJson = (a.headers['content-type'] ?? '').startsWith('application/json');
    return { status: a.status, headers: a.headers, bytes: a.body, json: isJson ? JSON.parse(a.body.toString('utf8')) : null };
  };
  const same = (a: { status: number; headers: Record<string, string>; bytes: Buffer }) => ({ status: a.status, headers: a.headers, body: a.bytes.toString('base64') });

  it('ROLES ON ROWS: OWNER, ADMIN and MEMBER read every route; legacy lower-case rows, a stranger, an unknown project and a project with no file environment get ONE identical 404', async () => {
    const pool = await fresh('roles');
    const f = await seeded(pool);
    const deps: WonderfsRouteDeps = { verifySession: wonderfsSessionVerifier(f.sessions), store: f.store, budgets: createWonderfsBudgets() };
    const routes = (p: string) => [
      `/wonderfs/v1/projects/${p}`, `/wonderfs/v1/projects/${p}/branches/main/tree`, `/wonderfs/v1/projects/${p}/branches/main/files/${f.readme}`,
      `/wonderfs/v1/projects/${p}/branches/main/files/${f.readme}/content`, `/wonderfs/v1/projects/${p}/blobs/${f.v2.sha256}`, `/wonderfs/v1/projects/${p}/events?after=0`,
    ];
    for (const [index, url] of routes(P).entries()) {
      for (const player of ['ghu-1', 'ghu-2', 'ghu-3']) expect((await ask(deps, f.tokens[player], url)).status, `${url} for ${player}`).toBe(200);
      const stranger = await ask(deps, f.tokens['ghu-5'], url);
      expect(stranger.json).toEqual({ error: { kind: 'not_found', message: 'Not found.' } });
      for (const other of [await ask(deps, f.tokens['ghu-8'], url), await ask(deps, f.tokens['ghu-9'], url), await ask(deps, f.tokens['ghu-1'], routes('prj-nowhere')[index]), await ask(deps, f.tokens['ghu-1'], routes('prj-unfiled')[index])]) {
        expect(same(other), url).toEqual(same(stranger));
      }
    }
    const content = await ask(deps, f.tokens['ghu-3'], `/wonderfs/v1/projects/${P}/branches/main/files/${f.readme}/content`);
    expect([content.bytes.toString('utf8'), content.headers.etag]).toEqual(['second words', `"${f.v2.sha256}"`]);
    const atOne = await ask(deps, f.tokens['ghu-3'], `/wonderfs/v1/projects/${P}/branches/main/files/${f.readme}/content?rev=1`);
    expect(atOne.bytes.toString('utf8')).toBe('first words');
    const part = await ask(deps, f.tokens['ghu-3'], `/wonderfs/v1/projects/${P}/blobs/${f.v2.sha256}`, 'bytes=0-5');
    expect([part.status, part.bytes.toString('utf8'), part.headers['content-range']]).toEqual([206, 'second', 'bytes 0-5/12']);
  }, 180_000);

  it('H1 ON ROWS: the caller\'s live projects with their roles; a soft-deleted one leaves the list, CONTROL: restored, it is back; legacy rows list nothing', async () => {
    const pool = await fresh('list');
    const f = await seeded(pool);
    const deps: WonderfsRouteDeps = { verifySession: wonderfsSessionVerifier(f.sessions), store: f.store, budgets: createWonderfsBudgets() };
    const list = async (player: string) => (await ask(deps, f.tokens[player], '/wonderfs/v1/projects')).json.data.projects;
    expect(await list('ghu-1')).toEqual([{ projectId: P, role: 'owner' }, { projectId: 'prj-beta', role: 'owner' }]);
    expect(await list('ghu-2')).toEqual([{ projectId: P, role: 'editor' }]);
    for (const p of ['ghu-5', 'ghu-8', 'ghu-9']) expect(await list(p), p).toEqual([]);
    await pool.query("UPDATE relay_wonderland.wfs_projects SET deleted_at = now(), purge_after = now() + interval '30 days' WHERE project_id = 'prj-beta'");
    expect(await list('ghu-1')).toEqual([{ projectId: P, role: 'owner' }]);
    expect((await ask(deps, f.tokens['ghu-1'], '/wonderfs/v1/projects/prj-beta')).status, 'and it reads as not found').toBe(404);
    await pool.query("UPDATE relay_wonderland.wfs_projects SET deleted_at = NULL, purge_after = NULL WHERE project_id = 'prj-beta'");
    expect((await list('ghu-1')).length, 'CONTROL: restored').toBe(2);
  }, 120_000);

  it('PAGES AND BYTES ON ROWS: the tree cursor chains and is bound to its project; bytes that fail their check are never served', async () => {
    const pool = await fresh('bytes');
    const f = await seeded(pool);
    const deps: WonderfsRouteDeps = { verifySession: wonderfsSessionVerifier(f.sessions), store: f.store, budgets: createWonderfsBudgets() };
    const tree = (p: string, q: string) => ask(deps, f.tokens['ghu-1'], `/wonderfs/v1/projects/${p}/branches/main/tree${q}`);
    const page1 = (await tree(P, '?limit=2')).json.data;
    const page2 = (await tree(P, `?limit=2&after=${page1.next}`)).json.data;
    const all = (await tree(P, '?limit=1000')).json.data.entries.map((e: { path: string }) => e.path);
    expect([...page1.entries, ...page2.entries].map((e: { path: string }) => e.path)).toEqual(all.slice(0, 4));
    expect((await tree('prj-beta', `?limit=2&after=${page1.next}`)).status, 'another project\'s cursor').toBe(400);
    const blob = `/wonderfs/v1/projects/${P}/blobs/${f.v1.sha256}`;
    expect((await ask(deps, f.tokens['ghu-1'], blob)).status, 'CONTROL: intact').toBe(200);
    await pool.query('UPDATE relay_wonderland.wfs_blob_bytes SET bytes = $2 WHERE sha256 = $1', [f.v1.sha256, Buffer.from('first wordZ')]);
    const changed = await ask(deps, f.tokens['ghu-1'], blob);
    expect([changed.status, changed.json.error.kind]).toEqual([503, 'wonderfs_unavailable']);
  }, 120_000);

  it('AN OUTAGE is 503 wonderfs_unavailable, never "not found" and never a stack', async () => {
    const pool = await fresh('outage');
    const f = await seeded(pool);
    const gone = new Pool({ connectionString: new URL(databaseUrl!).toString(), max: 1 });
    await gone.end();
    const deadStore: WfsStore = openWfsPostgresStore(gone);
    const deps: WonderfsRouteDeps = { verifySession: wonderfsSessionVerifier(f.sessions), store: deadStore, budgets: createWonderfsBudgets() };
    for (const url of [`/wonderfs/v1/projects/${P}`, '/wonderfs/v1/projects']) {
      const a = await ask(deps, f.tokens['ghu-1'], url);
      expect([a.status, a.json.error.kind], url).toEqual([503, 'wonderfs_unavailable']);
    }
  }, 120_000);
});
