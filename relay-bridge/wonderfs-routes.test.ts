import { createServer, request as httpRequest, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openWfsMemoryStore, wfsMemoryBacking } from '../src/relay/wonderfs/wonderfs-memory-store';
import { WFS_MAIN_BRANCH, wfsTreeAt } from '../src/relay/wonderfs/wonderfs-engine';
import type { WfsOp, WfsPrincipal } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_PAGE_MAX_BYTES, type WfsStore } from '../src/relay/wonderfs/wonderfs-store';
import { createBrowserSessionStore, NATIVE_WORLD_AUDIENCE } from './browser-session/grants';
import { createWonderfsBudgets, type WonderfsBudgets } from './wonderfs-budgets';
import { wonderfsNotFound, wonderfsSessionVerifier } from './wonderfs-gate';
import {
  answerWonderfs,
  createWonderfsMount,
  wonderfsEncodeTreeCursor,
  wonderfsRange,
  wonderfsRequestOf,
  writeWonderfsAnswer,
  type WonderfsByteAnswer,
  type WonderfsRouteDeps,
} from './wonderfs-routes';

/**
 * WONDERFS R1 -- THE READ ROUTES over the in-memory store, through a REAL loopback HTTP server (node:http + fetch), the way the
 * desktop client meets them. No bridge seam: the bridge's own mount is proven in wonderfs-http.test.ts, and the same routes run
 * on real PostgreSQL in wonderfs-routes.real-postgres.test.ts (CI).
 *
 * Players: ghu-1 OWNER, ghu-2 ADMIN, ghu-3 MEMBER, ghu-9 a lower-case legacy 'owner' row (no role), ghu-5 a stranger.
 */

const T0 = Date.parse('2026-10-12T12:00:00.000Z');
const NOW_ISO = new Date(T0).toISOString();
const PROJECT = 'prj-alpha';
const realFetch = globalThis.fetch.bind(globalThis);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  vi.unstubAllEnvs();
});

const human = (id: string): WfsPrincipal => ({ kind: 'human', id, onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null });
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** 5 MiB that are not all one byte, so a wrong slice is visible. */
const BIG = (() => {
  const b = Buffer.alloc(5 * 1024 * 1024);
  for (let i = 0; i < b.length; i += 1) b[i] = (i * 31 + 7) & 0xff;
  return b;
})();

async function fixture() {
  const backing = wfsMemoryBacking();
  const store = openWfsMemoryStore({ backing });
  store.seedProject(PROJECT, { 'ghu-1': 'OWNER', 'ghu-2': 'ADMIN', 'ghu-3': 'MEMBER', 'ghu-9': 'owner' });
  store.seedProject('prj-beta', { 'ghu-1': 'OWNER' });
  store.seedProject('prj-unfiled', { 'ghu-1': 'OWNER' }); // a membership whose project has no file environment
  for (const p of [PROJECT, 'prj-beta']) expect((await store.createProject(p, NOW_ISO)).ok).toBe(true);
  const put = async (projectId: string, bytes: Uint8Array) => {
    const r = await store.putBlob(projectId, bytes);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const commit = async (projectId: string, baseRev: number, ops: WfsOp[]) => {
    const r = await store.commit(projectId, { requestId: `req-${projectId}-${baseRev}`, branchId: WFS_MAIN_BRANCH, baseRev, principal: human('ghu-1'), ops }, NOW_ISO);
    if (!r.ok || r.value.status !== 'committed') throw new Error(`fixture commit refused: ${JSON.stringify(r)}`);
  };
  const v1 = await put(PROJECT, utf8('readme, first words'));
  const v2 = await put(PROJECT, utf8('readme, second words'));
  const old = await put(PROJECT, utf8('soon gone'));
  const big = await put(PROJECT, BIG);
  const pending = await put(PROJECT, utf8('uploaded, never committed'));
  await commit(PROJECT, 0, [
    { op: 'create', path: 'docs', kind: 'dir' },
    { op: 'create', path: 'docs/readme.txt', kind: 'file', ...v1 },
    { op: 'create', path: 'old.txt', kind: 'file', ...old },
    { op: 'create', path: 'big.bin', kind: 'file', ...big },
  ]);
  const at = (path: string) => wfsTreeAt((store.backing.projects.get(PROJECT)!.state.branches.get(WFS_MAIN_BRANCH))!).find((e) => e.path === path)!.fileId;
  const ids = { docs: at('docs'), readme: at('docs/readme.txt'), old: at('old.txt'), big: at('big.bin') };
  await commit(PROJECT, 1, [{ op: 'update', fileId: ids.readme, expectContentVersion: 1, ...v2 }]);
  await commit(PROJECT, 2, [{ op: 'delete', fileId: ids.old, expectContentVersion: 1 }]);
  await commit('prj-beta', 0, Array.from({ length: 5 }, (_, i): WfsOp => ({ op: 'create', path: `b${i}`, kind: 'dir' })));
  for (let i = 0; i < 4; i += 1) {
    await store.commit(PROJECT, { requestId: `req-dirs-${i}x`, branchId: WFS_MAIN_BRANCH, baseRev: 3 + i, principal: human('ghu-1'), ops: [{ op: 'create', path: `d${i}`, kind: 'dir' }] }, NOW_ISO);
  }
  return { store, backing, ids, blobs: { v1, v2, old, big, pending } };
}

function sessionsFor(players: readonly string[]) {
  const sessions = createBrowserSessionStore();
  const tokens: Record<string, string> = {};
  for (const p of players) {
    const m = sessions.mintNativeSocialSession({ now: T0, participantId: p });
    if (!m.ok) throw new Error('not minted');
    tokens[p] = m.session.token;
  }
  return { sessions, tokens };
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bytes: Buffer;
  readonly json: any;
}

async function boot(deps: WonderfsRouteDeps, clock: () => number = () => T0 + 1): Promise<string> {
  const server = createServer((req, res) => {
    void (async () => {
      const answer = await answerWonderfs(wonderfsRequestOf(req, clock()), deps);
      writeWonderfsAnswer(res, answer ?? wonderfsNotFound());
    })();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
}

/** A store whose first `hold` byte reads wait until the test lets them go; later ones pass straight through. */
function slowStore(store: WfsStore, hold = Number.POSITIVE_INFINITY): { store: WfsStore; waiting: Array<() => void> } {
  const waiting: Array<() => void> = [];
  let held = 0;
  const slow: WfsStore = new Proxy(store, {
    get(t, prop) {
      if (prop !== 'readReferencedBlob') return Reflect.get(t, prop);
      return async (p: string, s: string) => {
        if (held < hold) {
          held += 1;
          await new Promise<void>((r) => waiting.push(r));
        }
        return t.readReferencedBlob(p, s);
      };
    },
  });
  return { store: slow, waiting };
}

/** Real budgets, counted: how many byte-read slots are held right now. */
function countedBudgets(real: WonderfsBudgets): { budgets: WonderfsBudgets; held: () => number } {
  let held = 0;
  return {
    held: () => held,
    budgets: {
      take: (player, project, now) => real.take(player, project, now),
      takeBytes: (player, bytes, now) => real.takeBytes(player, bytes, now),
      startByteRead: (player) => {
        const end = real.startByteRead(player);
        if (end === null) return null;
        held += 1;
        let ended = false;
        return () => {
          if (!ended) held -= 1;
          ended = true;
          end();
        };
      },
    },
  };
}

async function call(base: string, path: string, opts: { token?: string; auth?: string; origin?: string; range?: string; ifRange?: string; method?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers.authorization = `Relay-Session ${opts.token}`;
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.range !== undefined) headers.range = opts.range;
  if (opts.ifRange !== undefined) headers['if-range'] = opts.ifRange;
  const response = await realFetch(`${base}${path}`, { method: opts.method ?? 'GET', headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { out[key] = value; });
  let json: unknown = null;
  if ((out['content-type'] ?? '').startsWith('application/json')) json = JSON.parse(bytes.toString('utf8'));
  return { status: response.status, headers: out, bytes, json };
}

/** A GET with the path sent EXACTLY as written: fetch's URL parser would resolve '..' and '%2e%2e' before sending. */
function rawGet(base: string, path: string, token: string): Promise<{ status: number; json: any }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: url.hostname, port: url.port, path, method: 'GET', headers: { authorization: `Relay-Session ${token}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** An answer as a client could compare two of them: status, body and every header but Date (§19.m2). */
const comparable = (a: Answer) => ({ status: a.status, body: a.bytes.toString('base64'), headers: Object.fromEntries(Object.entries(a.headers).filter(([k]) => k !== 'date')) });

const NOT_FOUND = { error: { kind: 'not_found', message: 'Not found.' } };

/** Every project-scoped R1 route of PROJECT, and the schema (or bytes) each answers. */
function routes(ids: { readme: string }, blobSha: string): Array<{ name: string; path: (p: string) => string; schema: string | 'bytes' }> {
  return [
    { name: 'H4 project', path: (p) => `/wonderfs/v1/projects/${p}`, schema: 'wonderfs.project.v1' },
    { name: 'H5 tree', path: (p) => `/wonderfs/v1/projects/${p}/branches/main/tree`, schema: 'wonderfs.tree_page.v1' },
    { name: 'H6 file', path: (p) => `/wonderfs/v1/projects/${p}/branches/main/files/${ids.readme}`, schema: 'wonderfs.file.v1' },
    { name: 'content', path: (p) => `/wonderfs/v1/projects/${p}/branches/main/files/${ids.readme}/content`, schema: 'bytes' },
    { name: 'H7 blob', path: (p) => `/wonderfs/v1/projects/${p}/blobs/${blobSha}`, schema: 'bytes' },
    { name: 'H9 events', path: (p) => `/wonderfs/v1/projects/${p}/events?after=0&wait=0`, schema: 'wonderfs.events_page.v1' },
  ];
}

describe('WonderFS R1 reads: who may read what', () => {
  it('every route answers OWNER, ADMIN and MEMBER; a non-member, a legacy lower-case row and an unknown project get the ONE 404; no session is 401', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2', 'ghu-3', 'ghu-5', 'ghu-9']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    for (const r of routes(f.ids, f.blobs.v2.sha256)) {
      for (const player of ['ghu-1', 'ghu-2', 'ghu-3']) {
        const a = await call(base, r.path(PROJECT), { token: tokens[player] });
        expect(a.status, `${r.name} for ${player}`).toBe(200);
        expect(a.headers['cache-control'], `${r.name}: never stored on the way`).toBe('no-store');
        if (r.schema === 'bytes') expect(a.bytes.toString('utf8'), r.name).toBe('readme, second words');
        else expect(a.json.data.schema, r.name).toBe(r.schema);
      }
      const stranger = await call(base, r.path(PROJECT), { token: tokens['ghu-5'] });
      const legacy = await call(base, r.path(PROJECT), { token: tokens['ghu-9'] });
      const unknown = await call(base, r.path('prj-nowhere'), { token: tokens['ghu-1'] });
      const unfiled = await call(base, r.path('prj-unfiled'), { token: tokens['ghu-1'] });
      expect(stranger.json, `${r.name}: a stranger`).toEqual(NOT_FOUND);
      for (const other of [legacy, unknown, unfiled]) expect(comparable(other), `${r.name}: the same answer`).toEqual(comparable(stranger));
      const anonymous = await call(base, r.path(PROJECT));
      expect([anonymous.status, anonymous.json.error.kind], `${r.name} without a session`).toEqual([401, 'session_required']);
      expect(anonymous.headers['cache-control']).toBe('no-store');
    }
  }, 60_000);

  it('H1 lists exactly the caller\'s readable projects with their roles, a page at a time; a stranger lists nothing', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2', 'ghu-5', 'ghu-9']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const list = async (player: string, q = '') => (await call(base, `/wonderfs/v1/projects${q}`, { token: tokens[player] })).json.data;
    expect(await list('ghu-1')).toEqual({ schema: 'wonderfs.project_list.v1', projects: [{ projectId: PROJECT, role: 'owner' }, { projectId: 'prj-beta', role: 'owner' }], next: null });
    expect(await list('ghu-2')).toEqual({ schema: 'wonderfs.project_list.v1', projects: [{ projectId: PROJECT, role: 'editor' }], next: null });
    expect((await list('ghu-5')).projects, 'a stranger').toEqual([]);
    expect((await list('ghu-9')).projects, 'a legacy lower-case row lists nothing').toEqual([]);
    const page1 = await list('ghu-1', '?limit=1');
    expect([page1.projects, page1.next]).toEqual([[{ projectId: PROJECT, role: 'owner' }], PROJECT]);
    const page2 = await list('ghu-1', `?limit=1&after=${page1.next}`);
    expect([page2.projects, page2.next]).toEqual([[{ projectId: 'prj-beta', role: 'owner' }], null]);
  });

  it('the role is read NOW: a member removed between two requests is refused the second with the one 404; re-added, served again', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-3']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const path = `/wonderfs/v1/projects/${PROJECT}`;
    expect((await call(base, path, { token: tokens['ghu-3'] })).json.data.role).toBe('editor');
    f.store.setMemberRole(PROJECT, 'ghu-3', null);
    expect((await call(base, path, { token: tokens['ghu-3'] })).json).toEqual(NOT_FOUND);
    f.store.setMemberRole(PROJECT, 'ghu-3', 'MEMBER');
    expect((await call(base, path, { token: tokens['ghu-3'] })).status, 'CONTROL: back as the product writes it').toBe(200);
  });

  it('H4: the head, the usage, the limits and the role', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const head = await f.store.head(PROJECT);
    if (!head.ok) throw new Error(head.error.message);
    const owner = (await call(base, `/wonderfs/v1/projects/${PROJECT}`, { token: tokens['ghu-1'] })).json.data;
    expect(owner).toEqual({
      schema: 'wonderfs.project.v1', projectId: PROJECT, role: 'owner', genesisHash: head.value.genesisHash, main: head.value.main, usage: head.value.usage,
      lastEventSeq: head.value.lastEventSeq, limits: { maxFileBytes: 64 * 1024 * 1024, maxFiles: 10_000, maxProjectBytes: 2 * 1024 * 1024 * 1024, maxOpsPerCommit: 2_000, maxPathChars: 200 },
    });
    expect(owner.main.headRev).toBe(7);
    expect((await call(base, `/wonderfs/v1/projects/${PROJECT}`, { token: tokens['ghu-2'] })).json.data.role, 'an ADMIN is an editor').toBe('editor');
  });
});

describe('WonderFS R1 reads: isolation (T-ISOLATION, §19.m2 structural)', () => {
  it('a non-member\'s request for an EXISTING project and for an UNKNOWN one take the same path -- only the membership is read -- and get byte-identical answers', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-5']);
    const calls: string[] = [];
    const spied: WfsStore = new Proxy(f.store, {
      get(target, prop) {
        const v: unknown = Reflect.get(target, prop);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: spied, budgets: createWonderfsBudgets() });
    for (const r of routes(f.ids, f.blobs.v2.sha256)) {
      calls.length = 0;
      const existing = await call(base, r.path(PROJECT), { token: tokens['ghu-5'] });
      expect(calls, `${r.name}: nothing but the membership is read before the refusal`).toEqual(['memberRole']);
      calls.length = 0;
      const unknown = await call(base, r.path('prj-nowhere'), { token: tokens['ghu-5'] });
      expect(calls, `${r.name}: the same path for an unknown project`).toEqual(['memberRole']);
      expect(comparable(existing), `${r.name}: identical answers`).toEqual(comparable(unknown));
      // CONTROL: a member's request reads past the membership, and its answer differs -- the comparison can fail
      calls.length = 0;
      const member = await call(base, r.path(PROJECT), { token: tokens['ghu-1'] });
      expect(calls[0]).toBe('memberRole');
      expect(calls.length, `${r.name}: CONTROL: a member's request reads more`).toBeGreaterThan(1);
      expect(comparable(member)).not.toEqual(comparable(existing));
    }
  }, 60_000);

  it('a blob is read only through a reference in THIS project: an uploaded-but-uncommitted blob and an unknown address get the one 404; CONTROL: committed, it is served', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const blob = (sha: string, p = PROJECT) => call(base, `/wonderfs/v1/projects/${p}/blobs/${sha}`, { token: tokens['ghu-1'] });
    const pending = await blob(f.blobs.pending.sha256);
    const nowhere = await blob('0'.repeat(64));
    const elsewhere = await blob(f.blobs.v2.sha256, 'prj-beta'); // a blob of ANOTHER project the caller can read: per-project addressing (§9.1)
    expect(pending.json).toEqual(NOT_FOUND);
    expect(comparable(nowhere)).toEqual(comparable(pending));
    expect(comparable(elsewhere)).toEqual(comparable(pending));
    const committed = await f.store.commit(PROJECT, { requestId: 'req-pending-commit', branchId: WFS_MAIN_BRANCH, baseRev: 7, principal: human('ghu-1'), ops: [{ op: 'create', path: 'late.txt', kind: 'file', ...f.blobs.pending }] }, NOW_ISO);
    expect(committed.ok && committed.value.status).toBe('committed');
    const served = await blob(f.blobs.pending.sha256);
    expect([served.status, served.bytes.toString('utf8')], 'CONTROL: once a version names it').toEqual([200, 'uploaded, never committed']);
  });
});

describe('WonderFS R1 reads: the gate', () => {
  it('desktop only; the agent scheme is reserved; a browser, a world or an unknown token is no session', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const path = `/wonderfs/v1/projects/${PROJECT}`;
    const fromPage = await call(base, path, { token: tokens['ghu-1'], origin: 'https://sunday-relay.vercel.app' });
    expect([fromPage.status, fromPage.json.error.kind]).toEqual([403, 'desktop_only']);
    const grant = await call(base, path, { auth: 'WonderFS-Grant abcdef' });
    expect([grant.status, grant.json.error.kind]).toEqual([401, 'grant_not_accepted']);
    const browser = sessions.mintIdentitySession({ origin: 'https://sunday-relay.vercel.app', now: T0, participantId: 'ghu-1' });
    if (!browser.ok) throw new Error('browser session not minted');
    const g = sessions.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: T0, scope: 'native_world', participantId: 'ghu-1', projectId: PROJECT });
    const world = sessions.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: NATIVE_WORLD_AUDIENCE, now: T0 });
    if (!world.ok) throw new Error('world session not minted');
    for (const [what, token] of [['a browser session', browser.session.token], ['a native WORLD session', world.session.token], ['an unknown token', 'x'.repeat(43)]] as const) {
      const a = await call(base, path, { token });
      expect([a.status, a.json.error.kind], what).toEqual([401, 'session_required']);
    }
    expect((await call(base, path, { token: tokens['ghu-1'] })).status, 'CONTROL: the desktop session').toBe(200);
  });

  it('THE TABLE: an unlisted path or verb is 403 whatever its prefix -- the change feed and conflicts wait for r1.5 (C2); CONTROL: the listed path is served', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const p = `/wonderfs/v1/projects/${PROJECT}`;
    const refusedPaths = [
      `${p}/branches/main/changes`, `${p}/conflicts`, `${p}/conflicts/conflict-1`, `${p}/branches/main/tree/`, `${p}/branches/agent-1/tree`,
      `${p}/branches/main/files/../tree`, `${p}/branches/main/files/%2e%2e/content`, `/wonderfs/v1//projects`, '/wonderfs/v1/projectsX',
      '/wonderfs/v2/projects', '/wonderfs', `${p}/blobs/${'A'.repeat(64)}`, `${p}/snapshots`, `${p}/members`,
    ];
    for (const path of refusedPaths) {
      const a = await rawGet(base, path, tokens['ghu-1']);
      expect([a.status, a.json.error.kind], path).toEqual([403, 'not_permitted']);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const a = await call(base, `${p}/branches/main/tree`, { token: tokens['ghu-1'], method });
      expect([a.status, a.json.error.kind], method).toEqual([403, 'not_permitted']);
    }
    expect((await call(base, `${p}/branches/main/tree`, { token: tokens['ghu-1'] })).status, 'CONTROL').toBe(200);
  });

  it('a query names only the keys its route reads, once, as plain tokens: anything else is 400 and never echoed', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const p = `/wonderfs/v1/projects/${PROJECT}`;
    for (const q of ['?path=docs', '?limit=2&limit=3', '?limit=', '?limit=%31', '?limit=-1', '?limit=abc', '?rev=1.5', '?limit=0', '?limit=1001', '?after=nonsense', '?limit=2?limit=3']) {
      const a = await call(base, `${p}/branches/main/tree${q}`, { token: tokens['ghu-1'] });
      expect([a.status, a.json.error.kind], q).toEqual([400, 'invalid_request']);
      expect(a.json.error.message, `${q}: the value is never echoed`).not.toMatch(/docs|abc|nonsense|%31/u);
    }
    for (const q of ['?wait=5', '?wait=25', '?after=x', '?limit=2&before=1']) {
      expect((await call(base, `${p}/events${q}`, { token: tokens['ghu-1'] })).status, `events ${q}`).toBe(400);
    }
    expect((await call(base, `${p}?limit=1`, { token: tokens['ghu-1'] })).status, 'H4 reads no query').toBe(400);
    expect((await call(base, `${p}/events?wait=0`, { token: tokens['ghu-1'] })).status, 'CONTROL: wait=0').toBe(200);
  });

  it('without a database: 503 wonderfs_unavailable, after the session gate (an anonymous request never opens the store); a store that THROWS is 503 too, never a stack', async () => {
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    let opened = 0;
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: () => { opened += 1; return null; }, budgets: createWonderfsBudgets() });
    const anonymous = await call(base, `/wonderfs/v1/projects/${PROJECT}`);
    expect([anonymous.status, opened]).toEqual([401, 0]);
    const signedIn = await call(base, `/wonderfs/v1/projects/${PROJECT}`, { token: tokens['ghu-1'] });
    expect([signedIn.status, signedIn.json.error.kind, opened]).toEqual([503, 'wonderfs_unavailable', 1]);
    const logs: string[] = [];
    const throwing = new Proxy(openWfsMemoryStore(), { get: () => async () => { throw new Error('connect ECONNREFUSED 10.0.0.9:5432 password=hunter2'); } }) as WfsStore;
    const base2 = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: throwing, budgets: null, log: (l) => logs.push(l) });
    const thrown = await call(base2, `/wonderfs/v1/projects/${PROJECT}`, { token: tokens['ghu-1'] });
    expect([thrown.status, thrown.json.error.kind]).toEqual([503, 'wonderfs_unavailable']);
    expect(thrown.bytes.toString('utf8')).not.toMatch(/ECONNREFUSED|hunter2|stack|Error/u);
    expect(logs.join('\n'), 'the log names the error kind, never its text').not.toMatch(/ECONNREFUSED|hunter2/u);
  });
});

describe('WonderFS R1 reads: pages', () => {
  it('H5: pages bounded by limit and chained by the opaque cursor, gapless; a cursor of ANOTHER project is refused (400), CONTROL: in its own project it pages', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const tree = (p: string, q: string) => call(base, `/wonderfs/v1/projects/${p}/branches/main/tree${q}`, { token: tokens['ghu-1'] });
    const whole = (await tree(PROJECT, '?limit=1000')).json.data;
    const seen: string[] = [];
    let next: string | null = null;
    let pages = 0;
    do {
      const page: any = (await tree(PROJECT, next === null ? '?limit=2' : `?limit=2&after=${next}`)).json.data;
      expect(page.entries.length).toBeLessThanOrEqual(2);
      seen.push(...page.entries.map((e: { path: string }) => e.path));
      next = page.next;
      pages += 1;
    } while (next !== null && pages < 50);
    expect(seen, 'every entry once, in order').toEqual(whole.entries.map((e: { path: string }) => e.path));
    expect(pages).toBe(Math.ceil(whole.entries.length / 2));
    const alphaCursor = (await tree(PROJECT, '?limit=2')).json.data.next as string;
    const foreign = await tree('prj-beta', `?limit=2&after=${alphaCursor}`);
    expect([foreign.status, foreign.json.error.message]).toEqual([400, 'WonderFS refused the request: the page cursor belongs to another listing.']);
    const betaCursor = (await tree('prj-beta', '?limit=2')).json.data.next as string;
    const betaPosition = betaCursor.split('.').slice(1).join('.');
    const forged = await tree('prj-beta', `?limit=2&after=${'0'.repeat(16)}.${betaPosition}`);
    expect(forged.status, 'a forged tag').toBe(400);
    expect(wonderfsEncodeTreeCursor('prj-beta', betaPosition), 'the tag is the project\'s').toBe(betaCursor);
    const own = await tree('prj-beta', `?limit=2&after=${betaCursor}`);
    expect([own.status, own.json.data.entries.map((e: { path: string }) => e.path)], 'CONTROL: its own cursor pages on').toEqual([200, ['b2', 'b3']]);
    // a pinned revision: rev 1 has old.txt, the head does not
    const atOne = (await tree(PROJECT, '?rev=1&limit=1000')).json.data;
    expect(atOne.entries.map((e: { path: string }) => e.path)).toContain('old.txt');
    expect(whole.entries.map((e: { path: string }) => e.path)).not.toContain('old.txt');
    expect((await tree(PROJECT, '?rev=99')).json, 'a revision past the head').toEqual(NOT_FOUND);
  });

  it('H5: no page passes 1 MiB of JSON on the wire, even when limit alone would (1,000 files of 198 three-byte characters)', async () => {
    const f = await fixture();
    f.store.seedProject('prj-wide', { 'ghu-1': 'OWNER' });
    expect((await f.store.createProject('prj-wide', NOW_ISO)).ok).toBe(true);
    const blob = await f.store.putBlob('prj-wide', utf8('p'));
    if (!blob.ok) throw new Error(blob.error.message);
    const d1 = '字'.repeat(84);
    const d2 = `${d1}/${'文'.repeat(84)}`;
    const files = Array.from({ length: 1000 }, (_, i) => `${d2}/${'汉'.repeat(27)}${String.fromCharCode(0x4e00 + i)}`);
    const made = await f.store.commit('prj-wide', { requestId: 'req-wide-0001', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human('ghu-1'), ops: [
      { op: 'create', path: d1, kind: 'dir' }, { op: 'create', path: d2, kind: 'dir' }, ...files.map((path): WfsOp => ({ op: 'create', path, kind: 'file', ...blob.value })),
    ] }, NOW_ISO);
    expect(made.ok && made.value.status).toBe('committed');
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    let next: string | null = null;
    let count = 0;
    let first = true;
    for (let pages = 0; pages < 20; pages += 1) {
      const a = await call(base, `/wonderfs/v1/projects/prj-wide/branches/main/tree?limit=1000${next === null ? '' : `&after=${next}`}`, { token: tokens['ghu-1'] });
      expect(a.bytes.byteLength, 'the whole answer on the wire').toBeLessThanOrEqual(WFS_PAGE_MAX_BYTES);
      if (first) expect(a.json.data.entries.length, 'the BYTES ended page 1, not the limit').toBeLessThan(1000);
      first = false;
      count += a.json.data.entries.length;
      next = a.json.data.next;
      if (next === null) break;
    }
    expect(count).toBe(1002);
  }, 60_000);

  it('H6 pages a file\'s history by version; H9 pages the events by sequence', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const file = `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${f.ids.readme}`;
    const h1 = (await call(base, `${file}?limit=1`, { token: tokens['ghu-1'] })).json.data;
    expect([h1.current.version, h1.versions.map((v: { rev: number }) => v.rev), h1.next]).toEqual([2, [2], 2]);
    const h2 = (await call(base, `${file}?limit=1&before=${h1.next}`, { token: tokens['ghu-1'] })).json.data;
    expect([h2.versions.map((v: { rev: number }) => v.rev), h2.next]).toEqual([[1], null]);
    const events = `/wonderfs/v1/projects/${PROJECT}/events`;
    const e1 = (await call(base, `${events}?limit=3`, { token: tokens['ghu-1'] })).json.data;
    expect([e1.events.map((e: { seq: number }) => e.seq), e1.next, e1.lastSeq]).toEqual([[1, 2, 3], 3, 7]);
    const e2 = (await call(base, `${events}?limit=10&after=${e1.next}`, { token: tokens['ghu-1'] })).json.data;
    expect([e2.events.map((e: { seq: number }) => e.seq), e2.next]).toEqual([[4, 5, 6, 7], null]);
    expect(Object.keys(e2.events[0]).sort()).toEqual(['atIso', 'body', 'kind', 'seq']);
  });
});

describe('WonderFS R1 reads: bytes', () => {
  it('a file\'s content at a revision (octet-stream, nosniff, ETag = its sha256); a deleted file, a directory, a revision past the head: the one 404', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-3']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const content = (fileId: string, q = '') => call(base, `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${fileId}/content${q}`, { token: tokens['ghu-3'] });
    const head = await content(f.ids.readme);
    expect([head.status, head.bytes.toString('utf8')]).toEqual([200, 'readme, second words']);
    expect(head.headers['content-type']).toBe('application/octet-stream');
    expect(head.headers['x-content-type-options']).toBe('nosniff');
    expect(head.headers.etag).toBe(`"${f.blobs.v2.sha256}"`);
    expect(head.headers['content-length']).toBe(String(f.blobs.v2.size));
    expect((await content(f.ids.readme, '?rev=1')).bytes.toString('utf8'), 'at rev 1: the first words').toBe('readme, first words');
    expect((await content(f.ids.readme, '?rev=2')).bytes.toString('utf8')).toBe('readme, second words');
    expect((await content(f.ids.old, '?rev=2')).bytes.toString('utf8'), 'before its deletion').toBe('soon gone');
    for (const [what, a] of [['deleted at the head', await content(f.ids.old)], ['a directory', await content(f.ids.docs)], ['past the head', await content(f.ids.readme, '?rev=99')], ['an unknown file', await content('file-nope')], ['before it existed', await content(f.ids.readme, '?rev=0')]] as const) {
      expect(a.json, what).toEqual(NOT_FOUND);
    }
  });

  it('a LARGE file (5 MiB) is served whole and by Range: 206 + Content-Range, a suffix, an open end; 416 outside; several ranges ignored', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-2']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const path = `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${f.ids.big}/content`;
    const whole = await call(base, path, { token: tokens['ghu-2'] });
    expect([whole.status, whole.bytes.byteLength, whole.bytes.equals(BIG)]).toEqual([200, BIG.length, true]);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    const mid = await call(base, path, { token: tokens['ghu-2'], range: 'bytes=1000000-1000099' });
    expect([mid.status, mid.headers['content-range'], mid.bytes.equals(BIG.subarray(1_000_000, 1_000_100))]).toEqual([206, `bytes 1000000-1000099/${BIG.length}`, true]);
    const tail = await call(base, path, { token: tokens['ghu-2'], range: 'bytes=-10' });
    expect([tail.status, tail.bytes.equals(BIG.subarray(BIG.length - 10))]).toEqual([206, true]);
    const open = await call(base, path, { token: tokens['ghu-2'], range: `bytes=${BIG.length - 3}-` });
    expect([open.status, open.bytes.byteLength]).toEqual([206, 3]);
    const outside = await call(base, path, { token: tokens['ghu-2'], range: `bytes=${BIG.length}-` });
    expect([outside.status, outside.headers['content-range'], outside.json.error.kind]).toEqual([416, `bytes */${BIG.length}`, 'range_not_satisfiable']);
    const several = await call(base, path, { token: tokens['ghu-2'], range: 'bytes=0-1,5-6' });
    expect([several.status, several.bytes.byteLength], 'several ranges: the whole file').toEqual([200, BIG.length]);
    expect(wonderfsRange('bytes=5-2', 10), 'an inverted range is ignored').toEqual({ kind: 'whole' });
    expect(wonderfsRange('bytes=0-', 0), 'nothing to give of an empty file').toEqual({ kind: 'unsatisfiable' });
    // R1-r4 (CI r1.10): an OPEN end at or past the size is unsatisfiable, never "invalid, send it all"
    expect(wonderfsRange('bytes=10-', 10)).toEqual({ kind: 'unsatisfiable' });
    expect(wonderfsRange('bytes=10-20', 10)).toEqual({ kind: 'unsatisfiable' });
    expect(wonderfsRange('bytes=9-', 10)).toEqual({ kind: 'part', start: 9, end: 9 });
    expect(wonderfsRange('bytes=3-99', 10), 'a last position past the end is clamped').toEqual({ kind: 'part', start: 3, end: 9 });
    expect(wonderfsRange('bytes=-99', 10), 'a suffix longer than the file is the whole file as a part').toEqual({ kind: 'part', start: 0, end: 9 });
  }, 60_000);

  it('bytes that fail their check (address or size) are NEVER served: 503, and the log names the blob; CONTROL: intact, served', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const logs: string[] = [];
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets(), log: (l) => logs.push(l) });
    const path = `/wonderfs/v1/projects/${PROJECT}/blobs/${f.blobs.v2.sha256}`;
    expect((await call(base, path, { token: tokens['ghu-1'] })).status, 'CONTROL: intact').toBe(200);
    const held = f.backing.projects.get(PROJECT)!.blobs;
    held.set(f.blobs.v2.sha256, utf8('readme, sEcond words'));
    const changed = await call(base, path, { token: tokens['ghu-1'] });
    expect([changed.status, changed.json.error.kind]).toEqual([503, 'wonderfs_unavailable']);
    expect(changed.bytes.toString('utf8')).not.toContain('sEcond');
    held.set(f.blobs.v2.sha256, utf8('short'));
    expect((await call(base, path, { token: tokens['ghu-1'] })).status, 'a short blob').toBe(503);
    expect(logs.some((l) => l.includes(f.blobs.v2.sha256) && l.includes('failed its check'))).toBe(true);
  });
});

describe('WonderFS R1 reads: budgets (§8.4)', () => {
  it('over budget: 429 + Retry-After N and "try again in N s." with the same N; nothing runs; another player is unaffected; the budget refills', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-2', 'ghu-3']);
    let now = T0 + 1;
    const budgets = createWonderfsBudgets({ read: { burst: 3, everyMs: 10_000 }, read_any: { burst: 1000, everyMs: 1 } });
    const calls: string[] = [];
    const spied: WfsStore = new Proxy(f.store, { get: (t, prop) => { const v: unknown = Reflect.get(t, prop); return typeof v === 'function' ? (...a: unknown[]) => { calls.push(String(prop)); return (v as (...x: unknown[]) => unknown).apply(t, a); } : v; } });
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: spied, budgets }, () => now);
    const path = `/wonderfs/v1/projects/${PROJECT}`;
    for (let i = 0; i < 3; i += 1) expect((await call(base, path, { token: tokens['ghu-2'] })).status).toBe(200);
    calls.length = 0;
    const over = await call(base, path, { token: tokens['ghu-2'] });
    expect([over.status, over.json.error.kind, over.headers['retry-after']]).toEqual([429, 'rate_limited', '10']);
    expect(over.json.error.message).toBe('Too many requests; try again in 10 s.');
    expect(calls, 'a refused call reads nothing').toEqual([]);
    // the same refusal for a project that does not exist (the budget is charged before the membership is read: no oracle)
    const budgets2 = createWonderfsBudgets({ read: { burst: 1, everyMs: 10_000 }, read_any: { burst: 1000, everyMs: 1 } });
    const base2 = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: budgets2 }, () => now);
    for (const p of [PROJECT, 'prj-nowhere']) await call(base2, `/wonderfs/v1/projects/${p}`, { token: tokens['ghu-2'] });
    expect(comparable(await call(base2, `/wonderfs/v1/projects/${PROJECT}`, { token: tokens['ghu-2'] }))).toEqual(comparable(await call(base2, '/wonderfs/v1/projects/prj-nowhere', { token: tokens['ghu-2'] })));
    expect((await call(base, path, { token: tokens['ghu-3'] })).status, 'another player').toBe(200);
    now += 10_000;
    expect((await call(base, path, { token: tokens['ghu-2'] })).status, 'refilled').toBe(200);
  });

  it('spreading reads over many project ids buys nothing (read_any, per player)', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const budgets = createWonderfsBudgets({ read: { burst: 100, everyMs: 1 }, read_any: { burst: 3, everyMs: 10_000 } });
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets });
    const statuses: number[] = [];
    for (const p of ['prj-a1', 'prj-a2', 'prj-a3', 'prj-a4']) statuses.push((await call(base, `/wonderfs/v1/projects/${p}`, { token: tokens['ghu-1'] })).status);
    expect(statuses).toEqual([404, 404, 404, 429]);
  });

  it('at most two byte answers in flight per process: a third player is 429 (Retry-After 1); a slot comes back when an answer is written', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2', 'ghu-3']);
    const slow = slowStore(f.store, 2);
    const counted = countedBudgets(createWonderfsBudgets());
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: slow.store, budgets: counted.budgets });
    const path = `/wonderfs/v1/projects/${PROJECT}/blobs/${f.blobs.v1.sha256}`;
    const first = call(base, path, { token: tokens['ghu-1'] });
    const second = call(base, path, { token: tokens['ghu-2'] });
    await vi.waitFor(() => expect(slow.waiting.length).toBe(2));
    expect(counted.held()).toBe(2);
    const third = await call(base, path, { token: tokens['ghu-3'] });
    expect([third.status, third.headers['retry-after'], third.json.error.message]).toEqual([429, '1', 'Too many requests; try again in 1 s.']);
    for (const go of slow.waiting.splice(0)) go();
    expect([(await first).status, (await second).status]).toEqual([200, 200]);
    // the slots return once the two answers are written; then the next byte read is admitted
    await vi.waitFor(() => expect(counted.held()).toBe(0));
    expect((await call(base, path, { token: tokens['ghu-3'] })).status).toBe(200);
  });

  it('ONE PLAYER CANNOT HOLD ANOTHER\'S BYTE READS (security MAJOR-1(a)): a player\'s second concurrent byte read is 429 while another player is served; CONTROL: a process-only cap refuses the other player instead', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2']);
    const path = `/wonderfs/v1/projects/${PROJECT}/blobs/${f.blobs.v1.sha256}`;
    const run = async (perPlayer: number) => {
      const slow = slowStore(f.store, 2);
      const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: slow.store, budgets: createWonderfsBudgets(undefined, { maxByteReadsPerPlayer: perPlayer }) });
      // every read is either HELD at the store (its slot taken, its answer not yet possible) or already ANSWERED (refused before the
      // store); nothing is released until all three are one or the other -- R1-r4 (CI r1.10): releasing earlier let the first reads
      // finish before the other player's request reached the gate, so the control could not fail
      let settled = 0;
      const settle = (a: Promise<Answer>) => a.then((x) => { settled += 1; return x; });
      const first = settle(call(base, path, { token: tokens['ghu-1'] }));
      await vi.waitFor(() => expect(slow.waiting.length).toBe(1));
      // the player's second read, held or refused, BEFORE the other player asks: a fixed order
      const own = settle(call(base, path, { token: tokens['ghu-1'] }));
      await vi.waitFor(() => expect(slow.waiting.length + settled).toBe(2));
      const other = settle(call(base, path, { token: tokens['ghu-2'] }));
      await vi.waitFor(() => expect(slow.waiting.length + settled).toBe(3));
      expect(slow.waiting.length, 'two reads hold slots at the store; the third was refused at the gate').toBe(2);
      for (const go of slow.waiting.splice(0)) go();
      return [(await first).status, (await own).status, (await other).status];
    };
    expect(await run(1), 'one per player: the player\'s second is refused, the other player is served').toEqual([200, 429, 200]);
    expect(await run(2), 'CONTROL, a process-only cap: the first player takes both slots and the other player is refused').toEqual([200, 200, 429]);
  });

  it('a per-player BYTES budget (security MAJOR-1(b)): charged the whole blob read and verified, whatever the Range; over it, 429 + Retry-After N = the body\'s N; another player is unaffected', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2']);
    const budgets = createWonderfsBudgets(undefined, { byteBudget: { burstBytes: 30, perMinuteBytes: 30 } });
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets });
    const path = `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${f.ids.readme}/content`; // 20 bytes
    expect((await call(base, path, { token: tokens['ghu-1'] })).status).toBe(200);
    const over = await call(base, path, { token: tokens['ghu-1'], range: 'bytes=0-0' });
    const n = over.json.error.message.match(/try again in (\d+) s\./u)?.[1];
    // 10 bytes are left; 20 more are needed at 30 bytes a minute: 10 bytes take 20 s
    expect([over.status, over.headers['retry-after'], n]).toEqual([429, '20', '20']);
    expect((await call(base, path, { token: tokens['ghu-2'] })).status, 'another player').toBe(200);
  });

  it('A CLIENT THAT LEAVES DURING THE READ RETURNS ITS SLOT (security BLOCKER-1, correctness MAJOR-1): after two aborted downloads every slot is free; CONTROL: the R1-r2 writer (a late once(close)) leaks both', async () => {
    /** R1-r2's writer, kept here as the CONTROL: it listened for `close` only after the read, so a close during the read was missed. */
    const lateCloseWriter = (res: ServerResponse, answer: WonderfsByteAnswer): void => {
      if (answer.release !== undefined) res.once('close', answer.release);
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    };
    const abortTwice = async (mode: 'fixed' | 'writer-only' | 'r2-control') => {
      const f = await fixture();
      const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-2', 'ghu-3']);
      const slow = slowStore(f.store, 2);
      const counted = countedBudgets(createWonderfsBudgets());
      const deps: WonderfsRouteDeps = { verifySession: wonderfsSessionVerifier(sessions), store: slow.store, budgets: counted.budgets };
      let written = 0;
      const sockets: Socket[] = [];
      const server = createServer((req, res) => {
        void (async () => {
          const request = wonderfsRequestOf(req, T0 + 1);
          // 'writer-only' and the control do not look for a closed client: only the writer can return the slot
          const answer = (await answerWonderfs(mode === 'fixed' ? request : { ...request, closed: undefined }, deps)) ?? wonderfsNotFound();
          if (mode === 'r2-control') lateCloseWriter(res, answer);
          else writeWonderfsAnswer(res, answer);
          written += 1;
        })();
      });
      server.on('connection', (s: Socket) => sockets.push(s));
      servers.push(server);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const address = server.address();
      const base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
      const path = `/wonderfs/v1/projects/${PROJECT}/blobs/${f.blobs.v1.sha256}`;
      const aborts = [new AbortController(), new AbortController()];
      const pending = ['ghu-1', 'ghu-2'].map((p, i) => realFetch(`${base}${path}`, { headers: { authorization: `Relay-Session ${tokens[p]}` }, signal: aborts[i].signal }).then(() => 'answered', () => 'aborted'));
      await vi.waitFor(() => expect(slow.waiting.length).toBe(2));
      expect(counted.held()).toBe(2);
      for (const a of aborts) a.abort();
      expect(await Promise.all(pending)).toEqual(['aborted', 'aborted']);
      await vi.waitFor(() => expect(sockets.filter((s) => s.destroyed).length).toBe(2));
      for (const go of slow.waiting.splice(0)) go();
      await vi.waitFor(() => expect(written).toBe(2));
      // no sleeping: where a release is due, wait for it; in the control, flush the event loop once (finished / close call back on the
      // next tick) -- after that nothing queued can give the slots back, because their `close` fired before anyone listened
      if (mode === 'r2-control') await new Promise<void>((r) => setImmediate(r));
      else await vi.waitFor(() => expect(counted.held()).toBe(0));
      const held = counted.held();
      const next = await call(base, path, { token: tokens['ghu-3'] });
      return { held, next: next.status };
    };
    expect(await abortTwice('fixed'), 'the fix').toEqual({ held: 0, next: 200 });
    expect(await abortTwice('writer-only'), 'stream.finished alone returns a slot whose client had already gone').toEqual({ held: 0, next: 200 });
    expect(await abortTwice('r2-control'), 'CONTROL: the late once(close) leaks both slots and the bridge refuses every byte read').toEqual({ held: 2, next: 429 });
  }, 60_000);

  it('a byte answer that never finishes writing is destroyed at its deadline and its slot comes back (security MAJOR-1(c)); CONTROL: one that finishes returns it at once', async () => {
    let released = 0;
    // a reader that never reads: no write ever completes
    const stalled = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) { /* never called back */ } });
    const stalledRes = Object.assign(stalled, { writeHead: () => stalled, setTimeout: () => stalled }) as unknown as ServerResponse;
    writeWonderfsAnswer(stalledRes, { status: 200, headers: {}, body: Buffer.alloc(64), release: () => { released += 1; } }, {}, { deadlineMs: 50, idleMs: 60_000 });
    expect(released, 'held while it writes').toBe(0);
    await vi.waitFor(() => expect(released).toBe(1), { timeout: 2_000 });
    expect(stalled.destroyed, 'the deadline destroyed it').toBe(true);
    let releasedFast = 0;
    const flowing = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const flowingRes = Object.assign(flowing, { writeHead: () => flowing, setTimeout: () => flowing }) as unknown as ServerResponse;
    writeWonderfsAnswer(flowingRes, { status: 200, headers: {}, body: Buffer.alloc(64), release: () => { releasedFast += 1; } }, {}, { deadlineMs: 60_000, idleMs: 60_000 });
    await vi.waitFor(() => expect(releasedFast).toBe(1));
  });
});

describe('WonderFS R1 reads: If-Range (RFC 9110 §13.1.5; correctness MAJOR-2)', () => {
  it('resuming content after the file changed sends the NEW file whole (200), never spliced; a matching strong ETag resumes (206); a weak tag or a date never matches', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const path = `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${f.ids.readme}/content`;
    const before = await call(base, path, { token: tokens['ghu-1'] });
    const oldTag = before.headers.etag;
    expect(oldTag).toBe(`"${f.blobs.v2.sha256}"`);
    // the file changes
    const v3 = await f.store.putBlob(PROJECT, utf8('readme, the third words'));
    if (!v3.ok) throw new Error(v3.error.message);
    const changed = await f.store.commit(PROJECT, { requestId: 'req-if-range-01', branchId: WFS_MAIN_BRANCH, baseRev: 7, principal: human('ghu-1'), ops: [{ op: 'update', fileId: f.ids.readme, expectContentVersion: 2, ...v3.value }] }, NOW_ISO);
    expect(changed.ok && changed.value.status).toBe('committed');
    const newTag = `"${v3.value.sha256}"`;
    const stale = await call(base, path, { token: tokens['ghu-1'], range: 'bytes=8-', ifRange: oldTag });
    expect([stale.status, stale.bytes.toString('utf8'), stale.headers['content-range'], stale.headers.etag]).toEqual([200, 'readme, the third words', undefined, newTag]);
    const current = await call(base, path, { token: tokens['ghu-1'], range: 'bytes=8-', ifRange: newTag });
    expect([current.status, current.bytes.toString('utf8')], 'CONTROL: the current ETag resumes').toEqual([206, 'the third words']);
    expect((await call(base, path, { token: tokens['ghu-1'], range: 'bytes=8-', ifRange: `W/${newTag}` })).status, 'a weak tag never matches').toBe(200);
    expect((await call(base, path, { token: tokens['ghu-1'], range: 'bytes=8-', ifRange: 'Mon, 12 Oct 2026 12:00:00 GMT' })).status, 'a date never matches').toBe(200);
    expect((await call(base, path, { token: tokens['ghu-1'], range: 'bytes=8-' })).status, 'CONTROL: a Range alone is honoured').toBe(206);
    expect((await call(base, path, { token: tokens['ghu-1'], ifRange: oldTag })).status, 'If-Range without a Range: the whole file').toBe(200);
  });
});

describe('WonderFS R1 reads: gate hardening (security MINOR-5, MINOR-6)', () => {
  it('an EMPTY Origin is a browser\'s too (403); a token outside the minted shape is no session and is never looked up; CONTROL: the minted token is served', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    let looked = 0;
    const verify = wonderfsSessionVerifier(sessions);
    const deps: WonderfsRouteDeps = { verifySession: (token, now) => { looked += 1; return verify(token, now); }, store: f.store, budgets: null };
    const ask = async (authorization: string, origin?: string) => {
      const a = await answerWonderfs({ method: 'GET', url: `/wonderfs/v1/projects/${PROJECT}`, authorization, origin, clientBuild: undefined, range: undefined, now: T0 + 1 }, deps);
      return [a?.status, a === null ? null : JSON.parse(a.body.toString('utf8')).error?.kind ?? 'ok'];
    };
    expect(await ask(`Relay-Session ${tokens['ghu-1']}`, '')).toEqual([403, 'desktop_only']);
    for (const token of ['x'.repeat(5000), 'short', 'é'.repeat(43), 'a.b.c.d.e.f.g.h.i.j']) expect(await ask(`Relay-Session ${token}`), token.slice(0, 12)).toEqual([401, 'session_required']);
    expect(looked, 'no malformed token reached the session store').toBe(0);
    expect(await ask(`Relay-Session ${tokens['ghu-1']}`), 'CONTROL').toEqual([200, 'ok']);
    expect(looked).toBe(1);
  });
});

describe('WonderFS R1 reads: the bridge mount (correctness MINOR-5)', () => {
  it('createWonderfsMount without a database: a signed-in player gets 503 wonderfs_unavailable, an anonymous one 401; the pool is asked only after the session gate', async () => {
    const sessions = createBrowserSessionStore();
    const minted = sessions.mintNativeSocialSession({ now: Date.now(), participantId: 'ghu-1' });
    if (!minted.ok) throw new Error('not minted');
    let asked = 0;
    const mount = createWonderfsMount({ sessions, pool: () => { asked += 1; return null; } });
    const server = createServer((req, res) => { void mount.serve(req, res, {}); });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
    const anonymous = await call(base, `/relay-api/wonderfs/v1/projects/${PROJECT}`);
    expect([anonymous.status, anonymous.json.error.kind, asked]).toEqual([401, 'session_required', 0]);
    const signedIn = await call(base, `/relay-api/wonderfs/v1/projects/${PROJECT}`, { token: minted.session.token });
    expect([signedIn.status, signedIn.json.error.kind, asked]).toEqual([503, 'wonderfs_unavailable', 1]);
  });
});

describe('WonderFS R1 reads: always on (INV-10, §19.m6)', () => {
  it('the routes answer with social OFF, ON and unset alike: no setting is read', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1']);
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets() });
    const answers: unknown[] = [];
    for (const social of [undefined, '0', '1']) {
      vi.unstubAllEnvs();
      if (social !== undefined) vi.stubEnv('WONDERLAND_SOCIAL_ENABLED', social);
      vi.stubEnv('WONDERFS_DISABLED', '1'); // a planted switch is ignored: nothing here reads one
      const a = await call(base, `/wonderfs/v1/projects/${PROJECT}/branches/main/tree`, { token: tokens['ghu-1'] });
      expect(a.status, `social=${social ?? 'unset'}`).toBe(200);
      answers.push(a.json);
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });
});

describe('WonderFS R1 reads: what never leaves', () => {
  it('no answer and no log line carries a session token, a session ref or a file path', async () => {
    const f = await fixture();
    const { sessions, tokens } = sessionsFor(['ghu-1', 'ghu-5']);
    const logs: string[] = [];
    const base = await boot({ verifySession: wonderfsSessionVerifier(sessions), store: f.store, budgets: createWonderfsBudgets(), log: (l) => logs.push(l) });
    const refusals: string[] = [];
    for (const r of routes(f.ids, f.blobs.v2.sha256)) {
      refusals.push((await call(base, r.path(PROJECT), { token: tokens['ghu-5'] })).bytes.toString('utf8'));
      refusals.push((await call(base, `${r.path(PROJECT)}${r.path(PROJECT).includes('?') ? '&' : '?'}limit=zzz`, { token: tokens['ghu-1'] })).bytes.toString('utf8'));
    }
    const sessionRef = sessions.nativeSocialSessionRef({ sessionId: (sessions.verifyNativeSocialSession({ token: tokens['ghu-1'], now: T0 + 1 }) as { sessionId: string }).sessionId, now: T0 + 1 });
    expect(sessionRef).not.toBeNull();
    const everything = [...refusals, ...logs].join('\n');
    for (const secret of [tokens['ghu-1'], tokens['ghu-5'], sessionRef as string, 'readme', 'docs/']) expect(everything).not.toContain(secret);
    expect(logs.length, 'CONTROL: the refusals were logged').toBeGreaterThan(0);
  });
});
