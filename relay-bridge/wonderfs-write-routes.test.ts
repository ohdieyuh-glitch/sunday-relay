import { createHash } from 'node:crypto';
import { createServer, request as httpRequest, type ClientRequest, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '../src/relay/protocol/errors';
import type { WfsHumanRole } from '../src/relay/wonderfs/wonderfs-authz';
import { WFS_ALPHA_LIMITS, type WfsConflict, type WfsLimits, type WfsOp } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH, wfsTreeAt, type WfsBranchState } from '../src/relay/wonderfs/wonderfs-engine';
import { openWfsMemoryStore, wfsMemoryBacking, type WfsMemoryBacking, type WfsMemoryStore } from '../src/relay/wonderfs/wonderfs-memory-store';
import { normalizeWfsPath } from '../src/relay/wonderfs/wonderfs-paths';
import { WFS_CONFLICT_RETENTION_MS, WFS_PROJECT_FULL_MESSAGE, type WfsStore } from '../src/relay/wonderfs/wonderfs-store';
import { createBrowserSessionStore, type BrowserSessionStore } from './browser-session/grants';
import { readWonderfsJson, readWonderfsOctets, wonderfsUploadDeclared, type WonderfsBodySource } from './wonderfs-body';
import { wonderfsNotFound, wonderfsSessionVerifier } from './wonderfs-gate';
import { answerWonderfs, wonderfsRequestOf, writeWonderfsAnswer, type WonderfsRouteDeps } from './wonderfs-routes';
import { WONDERFS_OPERATIONS } from './wonderfs-scope';
import {
  createWonderfsWriteBudgets,
  wonderfsCommitBody,
  wonderfsCommitNeeds,
  wonderfsCompactUtc,
  wonderfsKeepBoth,
  wonderfsKeepBothPath,
  wonderfsKeepMine,
  wonderfsKeepTheirs,
  wonderfsUploadDeadlineMs,
  type WonderfsWriteBudgets,
} from './wonderfs-write-routes';

/**
 * WONDERFS R2 -- THE HUMAN WRITE ROUTES (H11 upload, H12 commit) over the in-memory store, through a REAL loopback HTTP server
 * (node:http + fetch, and raw node:http where a test needs a body fetch will not send: a partial one, a lying Content-Length, an
 * abort). The same routes run on real PostgreSQL in wonderfs-write.real-postgres.test.ts (CI), where the transaction-level crashes
 * and the role locked FOR SHARE are proven on rows.
 *
 * Contract r1.4 §14 rows covered here, each with a CONTROL that turns it red: T-CONFLICT (+ the three resolutions), T-ATOMIC,
 * T-IDEMPOTENT, T-MOVE-EDIT, T-DIR-MOVE, T-DELETE-EDIT, T-PATH-TAKEN, T-UNDELETE, T-PATH, T-LIMITS, T-PERSIST, T-CRASH rows 1-4,
 * §10.1's 422, T-ORPHAN's counting half (§19.m3, N-MAJOR-1), the keep-both name, and every authorization rule.
 *
 * Players: ghu-1 OWNER, ghu-2 ADMIN, ghu-3 MEMBER, ghu-9 a lower-case legacy 'owner' row (no role), ghu-5 a stranger here (OWNER of
 * prj-beta). A "restart" is a new store object over the same backing and a NEW sign-in (a new session store: new tokens, new
 * session_refs), as a bridge restart signs every player out (§8.1).
 */

const T0 = Date.parse('2026-10-12T12:00:00.000Z');
const NOW_ISO = new Date(T0).toISOString();
/** What the routes stamp a change with: the boot clock is T0 + 1 ms. */
const AT_UTC = '20261012T120000Z';
const PROJECT = 'prj-alpha';
const MEMBERS = { 'ghu-1': 'OWNER', 'ghu-2': 'ADMIN', 'ghu-3': 'MEMBER', 'ghu-9': 'owner' };
const NOT_FOUND = { error: { kind: 'not_found', message: 'Not found.' } };
const SMALL: WfsLimits = { ...WFS_ALPHA_LIMITS, maxFileBytes: 64, maxProjectBytes: 100, maxFiles: 3, maxOpsPerCommit: 5 };
const realFetch = globalThis.fetch.bind(globalThis);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => {
    s.closeAllConnections();
    s.close(() => r());
  })));
  vi.unstubAllEnvs();
});

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).digest('hex');
let counter = 0;
/** A fresh request id (the engine's format: 8-128 of [A-Za-z0-9_-]). */
const rid = (label: string): string => `req-${label}-${String((counter += 1)).padStart(5, '0')}`;

async function world(options: { limits?: WfsLimits; backing?: WfsMemoryBacking } = {}): Promise<{ backing: WfsMemoryBacking; store: WfsMemoryStore }> {
  const backing = options.backing ?? wfsMemoryBacking();
  const store = openWfsMemoryStore({ backing, limits: options.limits });
  if (options.backing === undefined) {
    store.seedProject(PROJECT, MEMBERS);
    store.seedProject('prj-beta', { 'ghu-5': 'OWNER' });
    for (const p of [PROJECT, 'prj-beta']) expect((await store.createProject(p, NOW_ISO)).ok).toBe(true);
  }
  return { backing, store };
}

/** A sign-in for each player. Calling it again is a NEW sign-in: new tokens and new session_refs (a bridge restart). */
function signIn(players: readonly string[], at = T0): { sessions: BrowserSessionStore; tokens: Record<string, string>; refOf: (player: string) => string } {
  const sessions = createBrowserSessionStore();
  const tokens: Record<string, string> = {};
  for (const p of players) {
    const m = sessions.mintNativeSocialSession({ now: at, participantId: p });
    if (!m.ok) throw new Error('not minted');
    tokens[p] = m.session.token;
  }
  const refOf = (player: string): string => {
    const v = sessions.verifyNativeSocialSession({ token: tokens[player], now: at + 1 });
    if (!v.ok) throw new Error('no session');
    return sessions.nativeSocialSessionRef({ sessionId: v.sessionId, now: at + 1 }) as string;
  };
  return { sessions, tokens, refOf };
}

const depsOf = (store: WfsStore, sessions: BrowserSessionStore, extra: Partial<WonderfsRouteDeps> = {}): WonderfsRouteDeps =>
  ({ verifySession: wonderfsSessionVerifier(sessions), store, budgets: null, writeBudgets: null, ...extra });

/** A loopback server over the routes; every request it answers is stamped `now` (the clock is the test's, never the wall's). */
async function boot(deps: WonderfsRouteDeps, now = T0 + 1): Promise<string> {
  const server = createServer((req, res) => {
    void (async () => {
      const answer = await answerWonderfs(wonderfsRequestOf(req, now), deps);
      writeWonderfsAnswer(res, answer ?? wonderfsNotFound());
    })();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
}

/** A store with some of its methods replaced (a planted defect, a crash at the seam, a revocation mid-request). */
function proxied(store: WfsStore, overrides: Partial<WfsStore>): WfsStore {
  return new Proxy(store, {
    get: (target, prop) => (Object.prototype.hasOwnProperty.call(overrides, prop) ? (overrides as Record<PropertyKey, unknown>)[prop] : Reflect.get(target, prop)),
  });
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bytes: Buffer;
  readonly json: any;
}

async function send(base: string, path: string, init: { method?: string; token?: string; headers?: Record<string, string>; body?: Uint8Array | string } = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token !== undefined) headers.authorization = `Relay-Session ${init.token}`;
  // a copy on its own ArrayBuffer: fetch's BodyInit takes no view of a shared or pooled buffer
    const body = init.body === undefined || typeof init.body === 'string' ? init.body : new Uint8Array(init.body);
    const response = await realFetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body });
  const bytes = Buffer.from(await response.arrayBuffer());
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { out[key] = value; });
  const json: unknown = (out['content-type'] ?? '').startsWith('application/json') ? JSON.parse(bytes.toString('utf8')) : null;
  return { status: response.status, headers: out, bytes, json };
}

const BLOBS = (project = PROJECT) => `/wonderfs/v1/projects/${project}/blobs`;
const COMMITS = (project = PROJECT) => `/wonderfs/v1/projects/${project}/branches/main/commits`;

const upload = (base: string, token: string, bytes: Uint8Array | string, extra: { project?: string; sha?: string; type?: string } = {}) =>
  send(base, BLOBS(extra.project), {
    method: 'POST',
    token,
    headers: { 'content-type': extra.type ?? 'application/octet-stream', ...(extra.sha === undefined ? {} : { 'x-wonderfs-sha256': extra.sha }) },
    body: typeof bytes === 'string' ? utf8(bytes) : bytes,
  });

const commit = (base: string, token: string, body: unknown, extra: { project?: string; type?: string; build?: string } = {}) =>
  send(base, COMMITS(extra.project), {
    method: 'POST',
    token,
    headers: { 'content-type': extra.type ?? 'application/json', ...(extra.build === undefined ? {} : { 'x-wonderland-build': extra.build }) },
    body: JSON.stringify(body),
  });

/** Upload, expecting 200; the blob's address and size. */
async function uploaded(base: string, token: string, bytes: Uint8Array | string, project = PROJECT): Promise<{ sha256: string; size: number }> {
  const a = await upload(base, token, bytes, { project });
  expect(a.status, JSON.stringify(a.json)).toBe(200);
  return { sha256: a.json.data.sha256, size: a.json.data.size };
}

/** Commit, expecting 200; the new revision. */
async function committed(base: string, token: string, baseRev: number, ops: WfsOp[], resolvesConflictId?: string): Promise<number> {
  const a = await commit(base, token, { requestId: rid('ok'), baseRev, ops, ...(resolvesConflictId === undefined ? {} : { resolvesConflictId }) });
  expect(a.status, JSON.stringify(a.json)).toBe(200);
  return a.json.data.rev;
}

/** A raw POST whose body the test writes by hand (fetch always sends a whole, honest body). */
function rawPost(base: string, path: string, headers: Record<string, string>): { req: ClientRequest; answer: Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: any } | null> } {
  const url = new URL(base);
  const req = httpRequest({ host: url.hostname, port: url.port, path, method: 'POST', headers });
  const answer = new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: any } | null>((resolve) => {
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null)); // an abort the test made
  });
  req.flushHeaders();
  return { req, answer };
}

const mainOf = async (store: WfsStore): Promise<WfsBranchState> => {
  const state = await store.project(PROJECT);
  if (state === null) throw new Error('no project');
  return state.branches.get(WFS_MAIN_BRANCH) as WfsBranchState;
};
const liveTree = async (store: WfsStore) => wfsTreeAt(await mainOf(store));
const entryAt = async (store: WfsStore, path: string) => (await liveTree(store)).find((e) => e.path === path);
const headRev = async (store: WfsStore) => (await mainOf(store)).headRev;
const blobCount = (store: WfsMemoryStore, project = PROJECT) => store.backing.projects.get(project)?.blobs.size ?? 0;
const conflictRecord = async (store: WfsStore, conflictId: string): Promise<WfsConflict> => {
  const v = await store.conflict(PROJECT, conflictId);
  if (!v.ok) throw new Error('no conflict');
  return v.value.record;
};
const contentOf = async (base: string, token: string, fileId: string) => (await send(base, `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${fileId}/content`, { token })).bytes.toString('utf8');
/** An answer as a client could compare two of them: status, body and every header but Date (§19.m2). */
const comparable = (a: Answer) => ({ status: a.status, body: a.bytes.toString('base64'), headers: Object.fromEntries(Object.entries(a.headers).filter(([k]) => k !== 'date')) });

/** rev 1: docs/ and docs/readme.txt ("first words"), and notes.txt; their ids. */
async function seed(base: string, token: string, store: WfsStore): Promise<{ docs: string; readme: string; notes: string; first: { sha256: string; size: number } }> {
  const first = await uploaded(base, token, 'first words');
  const notes = await uploaded(base, token, 'notes');
  await committed(base, token, 0, [
    { op: 'create', path: 'docs', kind: 'dir' },
    { op: 'create', path: 'docs/readme.txt', kind: 'file', ...first },
    { op: 'create', path: 'notes.txt', kind: 'file', ...notes },
  ]);
  const id = async (path: string) => (await entryAt(store, path))?.fileId as string;
  return { docs: await id('docs'), readme: await id('docs/readme.txt'), notes: await id('notes.txt'), first };
}

/* =========================================================================================================== authorization */

describe('WonderFS R2 writes: who may write (§8.2, §9.1, §19.m2)', () => {
  it('OWNER, ADMIN and MEMBER upload and commit; a stranger, a legacy lower-case row and an unknown project get ONE identical 404 and nothing is kept; no session 401, an Origin 403, the agent scheme 401', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2', 'ghu-3', 'ghu-5', 'ghu-9']);
    const base = await boot(depsOf(w.store, sessions));
    for (const [i, player] of ['ghu-1', 'ghu-2', 'ghu-3'].entries()) {
      const up = await upload(base, tokens[player], `by ${player}`);
      expect([up.status, up.json.data]).toEqual([200, { schema: 'wonderfs.blob.v1', sha256: sha(`by ${player}`), size: 8 }]);
      expect([up.headers['cache-control'], up.headers.pragma]).toEqual(['no-store', 'no-cache']);
      const c = await commit(base, tokens[player], { requestId: rid('who'), baseRev: i, ops: [{ op: 'create', path: `f-${player}.txt`, kind: 'file', sha256: up.json.data.sha256, size: 8 }] });
      expect([c.status, c.json.data.schema, c.json.data.rev, c.json.data.replay, c.headers['cache-control']]).toEqual([200, 'wonderfs.commit_result.v1', i + 1, false, 'no-store']);
    }
    const blobs = blobCount(w.store);
    const strangerUp = await upload(base, tokens['ghu-5'], 'x');
    const strangerCommit = await commit(base, tokens['ghu-5'], { requestId: rid('who'), baseRev: 3, ops: [{ op: 'create', path: 'z', kind: 'dir' }] });
    expect([strangerUp.status, strangerUp.json, strangerCommit.json]).toEqual([404, NOT_FOUND, NOT_FOUND]);
    // a POST refused at the gate leaves its body unread: the socket is closed, never drained for reuse (R2-r2); a GET is not
    const at = (method: string, url: string) => answerWonderfs({ method, url, authorization: `Relay-Session ${tokens['ghu-5']}`, origin: undefined, clientBuild: undefined, range: undefined, now: T0 + 1 }, depsOf(w.store, sessions));
    expect([(await at('POST', COMMITS()))?.headers.connection, (await at('POST', BLOBS()))?.headers.connection, (await at('GET', `/wonderfs/v1/projects/${PROJECT}`))?.headers.connection]).toEqual(['close', 'close', undefined]);
    for (const [label, a] of [
      ['legacy row, upload', await upload(base, tokens['ghu-9'], 'x')],
      ['unknown project, upload', await upload(base, tokens['ghu-1'], 'x', { project: 'prj-nowhere' })],
      ['not a member, upload', await upload(base, tokens['ghu-1'], 'x', { project: 'prj-beta' })],
    ] as const) expect(comparable(a), label).toEqual(comparable(strangerUp));
    for (const [label, a] of [
      ['legacy row, commit', await commit(base, tokens['ghu-9'], { requestId: rid('who'), baseRev: 3, ops: [{ op: 'create', path: 'z', kind: 'dir' }] })],
      ['unknown project, commit', await commit(base, tokens['ghu-1'], { requestId: rid('who'), baseRev: 3, ops: [{ op: 'create', path: 'z', kind: 'dir' }] }, { project: 'prj-nowhere' })],
    ] as const) expect(comparable(a), label).toEqual(comparable(strangerCommit));
    expect([blobCount(w.store), await headRev(w.store), blobCount(w.store, 'prj-beta')], 'nothing kept').toEqual([blobs, 3, 0]);
    // the gates before the role: no session, a browser, the agent scheme
    const anonymous = await send(base, COMMITS(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect([anonymous.status, anonymous.json.error.kind]).toEqual([401, 'session_required']);
    const page = await send(base, BLOBS(), { method: 'POST', token: tokens['ghu-1'], headers: { origin: 'https://example.com', 'content-type': 'application/octet-stream' }, body: 'x' });
    expect([page.status, page.json.error.kind]).toEqual([403, 'desktop_only']);
    const agent = await send(base, COMMITS(), { method: 'POST', headers: { authorization: 'WonderFS-Grant abcdef', 'content-type': 'application/json' }, body: '{}' });
    expect([agent.status, agent.json.error.kind]).toEqual([401, 'grant_not_accepted']);
    expect([blobCount(w.store), await headRev(w.store)]).toEqual([blobs, 3]);
  });

  it('the table admits exactly two writes, POST .../blobs and POST .../branches/main/commits; another verb, path or branch, or any query string, is refused before the body is read (CONTROL: the right request lands)', async () => {
    const writes = WONDERFS_OPERATIONS.filter((o) => o.method === 'POST').map((o) => [o.id, o.template, o.action, o.query.length]);
    expect(writes).toEqual([['blob.upload', '/v1/projects/:project/blobs', 'write', 0], ['commit.create', '/v1/projects/:project/branches/main/commits', 'write', 0]]);
    expect(WONDERFS_OPERATIONS.filter((o) => o.method === 'GET').map((o) => o.action).every((a) => a !== 'write'), 'no read is a write').toBe(true);
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const body = JSON.stringify({ requestId: rid('table'), baseRev: 0, ops: [{ op: 'create', path: 'd', kind: 'dir' }] });
    const json = { 'content-type': 'application/json' };
    const refusals: Array<[string, Answer]> = [
      ['GET commits', await send(base, COMMITS(), { token: tokens['ghu-1'] })],
      ['POST tree', await send(base, `/wonderfs/v1/projects/${PROJECT}/branches/main/tree`, { method: 'POST', token: tokens['ghu-1'], headers: json, body })],
      ['POST a blob address', await send(base, `${BLOBS()}/${sha('x')}`, { method: 'POST', token: tokens['ghu-1'], headers: { 'content-type': 'application/octet-stream' }, body: 'x' })],
      ['another branch', await send(base, `/wonderfs/v1/projects/${PROJECT}/branches/agent-1/commits`, { method: 'POST', token: tokens['ghu-1'], headers: json, body })],
      ['PUT', await send(base, COMMITS(), { method: 'PUT', token: tokens['ghu-1'], headers: json, body })],
    ];
    for (const [label, a] of refusals) expect([a.status, a.json.error.kind], label).toEqual([403, 'not_permitted']);
    const query = await send(base, `${COMMITS()}?branch=main`, { method: 'POST', token: tokens['ghu-1'], headers: json, body });
    expect([query.status, query.json.error.kind]).toEqual([400, 'invalid_request']);
    expect(await headRev(w.store)).toBe(0);
    const control = await send(base, COMMITS(), { method: 'POST', token: tokens['ghu-1'], headers: json, body });
    expect([control.status, control.json.data.rev], 'CONTROL').toEqual([200, 1]);
  });

  it('a commit never names who makes it: a principal, an actor or a server-set field, at the top or in an op, is refused whole and nothing is kept; the RECORD carries the session\'s player and session_ref (CONTROL: the same body without it lands)', async () => {
    const w = await world();
    const { sessions, tokens, refOf } = signIn(['ghu-3']);
    const base = await boot(depsOf(w.store, sessions));
    const op = { op: 'create', path: 'mine', kind: 'dir' };
    const planted: Array<Record<string, unknown>> = [
      { principal: { kind: 'human', id: 'ghu-1' } },
      { actor: 'ghu-1' },
      { playerId: 'ghu-1' },
      { branchId: 'main' },
      { ops: [{ ...op, assignedFileId: 'file_forged' }] },
      { ops: [{ ...op, principal: 'ghu-1' }] },
      { ops: [{ op: 'merge_put', fileId: 'f', kind: 'file', base: null, changes: {} }] },
    ];
    for (const extra of planted) {
      const a = await commit(base, tokens['ghu-3'], { requestId: rid('actor'), baseRev: 0, ops: [op], ...extra });
      expect([a.status, a.json.error.kind], JSON.stringify(extra)).toEqual([400, 'invalid_request']);
    }
    expect(await headRev(w.store), 'nothing kept').toBe(0);
    const control = await commit(base, tokens['ghu-3'], { requestId: rid('actor'), baseRev: 0, ops: [op] }, { build: '1.2.3+wl' });
    expect(control.status, 'CONTROL').toBe(200);
    const record = (await mainOf(w.store)).commits[0];
    expect(record.principal).toEqual({ kind: 'human', id: 'ghu-3', onBehalfOf: null, grantId: null, sessionId: refOf('ghu-3'), clientBuild: '1.2.3+wl', tool: 'wonderland-client', missionId: null, attemptId: null });
    expect(record.principal.sessionId, 'the session_ref, never the token').not.toBe(tokens['ghu-3']);
  });

  it('the reserved root (.wonderfs, any case, the new end of a move) is a §6.6 refusal: 400 invalid_request, never a conflict, nothing kept (R2-r2, correctness MINOR-7); the STORE refuses it too; CONTROL: a name beside it lands', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const { notes } = await seed(base, tokens['ghu-1'], w.store);
    for (const ops of [
      [{ op: 'create', path: '.wonderfs', kind: 'dir' }],
      [{ op: 'create', path: '.WonderFS/x', kind: 'dir' }],
      [{ op: 'move', fileId: notes, expectPathVersion: 1, newPath: '.wonderfs/notes.txt' }],
    ]) {
      const a = await commit(base, tokens['ghu-1'], { requestId: rid('reserved'), baseRev: 1, ops });
      expect([a.status, a.json.error.kind], JSON.stringify(ops)).toEqual([400, 'invalid_request']);
    }
    expect(await headRev(w.store)).toBe(1);
    const none = await w.store.conflicts(PROJECT, { status: 'all' });
    expect(none.ok && none.value.conflicts.length, 'not a conflict').toBe(0);
    // the store's own check, inside the change, for any caller that skipped the route's
    const owner = { kind: 'human' as const, id: 'ghu-1', onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null };
    const direct = await w.store.commit(PROJECT, { requestId: rid('reserved'), branchId: WFS_MAIN_BRANCH, baseRev: 1, principal: owner, ops: [{ op: 'create', path: 'x', kind: 'dir' }] }, NOW_ISO, { playerId: 'ghu-1', needs: [{ action: 'write', paths: ['.wonderfs/x'] }] });
    expect(direct.ok ? 'written' : [direct.error.code, direct.error.message]).toEqual(['not-found', 'Not found.']);
    expect(await committed(base, tokens['ghu-1'], 1, [{ op: 'create', path: 'wonderfs', kind: 'dir' }]), 'CONTROL').toBe(2);
  });
  it('IN THE TRANSACTION: a membership removed or demoted after the gate let the request in writes NOTHING (upload and commit) and answers the one 404; CONTROL: the same store asked WITHOUT the authority would have written', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-3']);
    const revokedMidway = (to: string | null): WfsStore => proxied(w.store, {
      putBlob: (p, bytes, options) => {
        w.store.setMemberRole(PROJECT, 'ghu-3', to);
        return w.store.putBlob(p, bytes, options);
      },
      commit: (p, req, now, authority) => {
        w.store.setMemberRole(PROJECT, 'ghu-3', to);
        return w.store.commit(p, req, now, authority);
      },
    });
    for (const to of [null, 'VIEWER', 'member']) {
      const base = await boot(depsOf(revokedMidway(to), sessions));
      w.store.setMemberRole(PROJECT, 'ghu-3', 'MEMBER');
      const up = await upload(base, tokens['ghu-3'], `revoked ${to}`);
      w.store.setMemberRole(PROJECT, 'ghu-3', 'MEMBER');
      const c = await commit(base, tokens['ghu-3'], { requestId: rid('revoked'), baseRev: 0, ops: [{ op: 'create', path: 'late', kind: 'dir' }] });
      expect([up.status, up.json, c.status, c.json], `demoted to ${to}`).toEqual([404, NOT_FOUND, 404, NOT_FOUND]);
      expect([blobCount(w.store), await headRev(w.store)], 'nothing kept').toEqual([0, 0]);
    }
    // CONTROL: a store asked without the authority (the route's check alone, then a revocation) writes
    const careless = proxied(w.store, {
      putBlob: (p, bytes) => {
        w.store.setMemberRole(PROJECT, 'ghu-3', null);
        return w.store.putBlob(p, bytes);
      },
      commit: (p, req, now) => {
        w.store.setMemberRole(PROJECT, 'ghu-3', null);
        return w.store.commit(p, req, now);
      },
    });
    const base = await boot(depsOf(careless, sessions));
    w.store.setMemberRole(PROJECT, 'ghu-3', 'MEMBER');
    const up = await upload(base, tokens['ghu-3'], 'careless');
    w.store.setMemberRole(PROJECT, 'ghu-3', 'MEMBER');
    const c = await commit(base, tokens['ghu-3'], { requestId: rid('revoked'), baseRev: 0, ops: [{ op: 'create', path: 'late', kind: 'dir' }] });
    expect([up.status, c.status, blobCount(w.store), await headRev(w.store)]).toEqual([200, 200, 1, 1]);
  });

  it('authorization comes BEFORE the replay: a removed member re-sending a request id it used gets the one 404, never its stored answer; CONTROLS: a member gets the original back, and each of the two checks is what refuses', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-3']);
    const body = { requestId: rid('replay'), baseRev: 0, ops: [{ op: 'create', path: 'mine', kind: 'dir' }] };
    const base = await boot(depsOf(w.store, sessions));
    const first = await commit(base, tokens['ghu-3'], body);
    expect([first.status, first.json.data.rev]).toEqual([200, 1]);
    w.store.setMemberRole(PROJECT, 'ghu-3', null);
    const removed = await commit(base, tokens['ghu-3'], body);
    const unknown = await commit(base, tokens['ghu-3'], body, { project: 'prj-nowhere' });
    expect(comparable(removed), 'the gate: identical to an unknown project').toEqual(comparable(unknown));
    // the gate fooled (it reads a role the player no longer has): the store's own check, inside the change, still refuses
    const fooled = proxied(w.store, { memberRole: async () => ok<WfsHumanRole | null>('editor') });
    const inside = await commit(await boot(depsOf(fooled, sessions)), tokens['ghu-3'], body);
    expect([inside.status, inside.json], 'the in-transaction check').toEqual([404, NOT_FOUND]);
    // CONTROL: with the gate fooled AND the authority dropped, the stored answer leaks -- what the two checks prevent
    const both = proxied(w.store, { memberRole: async () => ok<WfsHumanRole | null>('editor'), commit: (p, req, now) => w.store.commit(p, req, now) });
    const leaked = await commit(await boot(depsOf(both, sessions)), tokens['ghu-3'], body);
    expect([leaked.status, leaked.json.data.replay, leaked.json.data.rev]).toEqual([200, true, 1]);
    // CONTROL: a member again gets the original answer
    w.store.setMemberRole(PROJECT, 'ghu-3', 'MEMBER');
    const again = await commit(base, tokens['ghu-3'], body);
    expect([again.status, again.json.data]).toEqual([200, { ...first.json.data, replay: true }]);
    expect(await headRev(w.store)).toBe(1);
  });
});

/* =============================================================================================================== the change */

describe('WonderFS R2 H12: one atomic change to main (§6.2, INV-2, INV-3, INV-8)', () => {
  it('T-ATOMIC: a 3-op commit with one failing precondition changes NOTHING and the conflict holds all 3 ops as given (CONTROL: the right counters land all three)', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const { readme, notes } = await seed(base, tokens['ghu-1'], w.store);
    const two = await uploaded(base, tokens['ghu-1'], 'second words');
    const ops = (stale: boolean): WfsOp[] => [
      { op: 'create', path: 'docs/new.txt', kind: 'file', ...two },
      { op: 'update', fileId: readme, expectContentVersion: stale ? 7 : 1, ...two },
      { op: 'move', fileId: notes, expectPathVersion: 1, newPath: 'docs/notes.txt' },
    ];
    const before = await liveTree(w.store);
    const refused = await commit(base, tokens['ghu-1'], { requestId: rid('atomic'), baseRev: 1, ops: ops(true) });
    expect([refused.status, refused.json.error.kind, refused.json.error.failures.map((f: { opIndex: number; kind: string }) => [f.opIndex, f.kind])]).toEqual([409, 'conflict', [[1, 'content']]]);
    expect([await headRev(w.store), await liveTree(w.store)], 'nothing applied').toEqual([1, before]);
    const record = await conflictRecord(w.store, refused.json.error.conflictId);
    expect(record.ops, 'all three, as given').toEqual(ops(true));
    expect(await committed(base, tokens['ghu-1'], 1, ops(false)), 'CONTROL').toBe(2);
    expect((await liveTree(w.store)).map((e) => e.path)).toEqual(['docs', 'docs/new.txt', 'docs/notes.txt', 'docs/readme.txt']);
  });

  it('every number in a commit is a whole number 0..2^31-1, refused before anything is decided -- a record is hashed and kept forever (§19.M7; R2-r2, security MAJOR-1); CONTROL: the largest allowed lands', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const { docs, readme } = await seed(base, tokens['ghu-1'], w.store);
    const raw = (body: string) => send(base, COMMITS(), { method: 'POST', token: tokens['ghu-1'], headers: { 'content-type': 'application/json' }, body });
    for (const n of ['9007199254740993', '2147483648', '1e300', '1.5', '-1']) {
      const bodies = [
        `{"requestId":"${rid('num')}","baseRev":${n},"ops":[{"op":"create","path":"x","kind":"dir"}]}`,
        `{"requestId":"${rid('num')}","baseRev":1,"ops":[{"op":"update","fileId":"${readme}","expectContentVersion":${n},"sha256":"${sha('first words')}","size":11}]}`,
        // the one an unbounded engine counter would LET THROUGH: a folder delete passes when nothing changed after the given revision
        `{"requestId":"${rid('num')}","baseRev":1,"ops":[{"op":"delete","fileId":"${docs}","expectSubtreeRev":${n}}]}`,
      ];
      for (const body of bodies) {
        const a = await raw(body);
        expect([a.status, a.json.error.kind], `${n}: ${body.slice(0, 70)}`).toEqual([400, 'invalid_request']);
      }
    }
    expect(await headRev(w.store), 'nothing decided, nothing kept').toBe(1);
    const largest = await raw(`{"requestId":"${rid('num')}","baseRev":2147483647,"ops":[{"op":"delete","fileId":"${docs}","expectSubtreeRev":2147483647}]}`);
    expect([largest.status, largest.json.data?.rev], 'CONTROL: 2^31-1 lands (and that delete does pass the engine)').toEqual([200, 2]);
    const record = (await mainOf(w.store)).commits[1];
    expect([record.baseRev, Number.isSafeInteger(record.baseRev)]).toEqual([2147483647, true]);
  });

  it('T-IDEMPOTENT: the same id and change answers the same forever (a conflict too); the same id with another change, or from another player, is 409 duplicate_idempotency_key', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2']);
    const base = await boot(depsOf(w.store, sessions));
    const { readme } = await seed(base, tokens['ghu-1'], w.store);
    const body = { requestId: rid('idem'), baseRev: 1, ops: [{ op: 'create', path: 'once', kind: 'dir' }] };
    const first = await commit(base, tokens['ghu-1'], body);
    const again = await commit(base, tokens['ghu-1'], body);
    expect([first.status, again.status, again.json.data]).toEqual([200, 200, { ...first.json.data, replay: true }]);
    expect(await headRev(w.store), 'applied once').toBe(2);
    const other = await commit(base, tokens['ghu-1'], { ...body, ops: [{ op: 'create', path: 'twice', kind: 'dir' }] });
    expect([other.status, other.json.error]).toEqual([409, { kind: 'duplicate_idempotency_key', message: 'That request id was already used for a different change.' }]);
    const stranger = await commit(base, tokens['ghu-2'], body);
    expect([stranger.status, stranger.json.error.kind], 'CONTROL: the id is the player\'s, not anyone\'s').toEqual([409, 'duplicate_idempotency_key']);
    // a conflict replays as the SAME conflict
    const stale = { requestId: rid('idem'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: 9, sha256: sha('first words'), size: 11 }] };
    const c1 = await commit(base, tokens['ghu-1'], stale);
    const c2 = await commit(base, tokens['ghu-1'], stale);
    expect([c1.status, c2.status, c2.json.error.conflictId, c2.json.error.replay]).toEqual([409, 409, c1.json.error.conflictId, true]);
    const conflicts = await w.store.conflicts(PROJECT, { status: 'all' });
    expect(conflicts.ok && conflicts.value.conflicts.length, 'one conflict kept').toBe(1);
  });

  it('T-MOVE-EDIT: a move and an edit of one file at once both land (per-aspect counters); CONTROL: an edit at a stale content version is a conflict', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-2', 'ghu-3']);
    const base = await boot(depsOf(w.store, sessions));
    const { readme } = await seed(base, tokens['ghu-2'], w.store);
    const edit = await uploaded(base, tokens['ghu-3'], 'edited words');
    const [moved, edited] = await Promise.all([
      commit(base, tokens['ghu-2'], { requestId: rid('me'), baseRev: 1, ops: [{ op: 'move', fileId: readme, expectPathVersion: 1, newPath: 'readme.md' }] }),
      commit(base, tokens['ghu-3'], { requestId: rid('me'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: 1, ...edit }] }),
    ]);
    expect([moved.status, edited.status]).toEqual([200, 200]);
    const now = (await mainOf(w.store)).entries.get(readme);
    expect([now?.path, now?.sha256, now?.contentVersion, now?.pathVersion]).toEqual(['readme.md', edit.sha256, 2, 2]);
    const stale = await commit(base, tokens['ghu-3'], { requestId: rid('me'), baseRev: 3, ops: [{ op: 'update', fileId: readme, expectContentVersion: 1, ...edit }] });
    expect([stale.status, stale.json.error.failures[0].kind], 'CONTROL').toEqual([409, 'content']);
  });

  it('T-DIR-MOVE: a folder moves its live descendants in the same commit, keeping their ids; into itself is a cycle, past 200 characters is path_too_long (nothing applied)', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const { docs, readme } = await seed(base, tokens['ghu-1'], w.store);
    await committed(base, tokens['ghu-1'], 1, [{ op: 'create', path: 'docs/deep', kind: 'dir' }, { op: 'create', path: 'archive', kind: 'dir' }]);
    const cycle = await commit(base, tokens['ghu-1'], { requestId: rid('dir'), baseRev: 2, ops: [{ op: 'move', fileId: docs, expectPathVersion: 1, newPath: 'docs/deep/docs' }] });
    expect([cycle.status, cycle.json.error.failures[0].kind]).toEqual([409, 'cycle']);
    const longName = `${'n'.repeat(190)}`;
    const tooLong = await commit(base, tokens['ghu-1'], { requestId: rid('dir'), baseRev: 2, ops: [{ op: 'move', fileId: docs, expectPathVersion: 1, newPath: longName }] });
    expect([tooLong.status, tooLong.json.error.failures[0].kind]).toEqual([409, 'path_too_long']);
    expect(await headRev(w.store)).toBe(2);
    expect(await committed(base, tokens['ghu-1'], 2, [{ op: 'move', fileId: docs, expectPathVersion: 1, newPath: 'archive/docs' }])).toBe(3);
    const tree = await liveTree(w.store);
    expect(tree.filter((e) => e.path.startsWith('archive/docs')).map((e) => e.path)).toEqual(['archive/docs', 'archive/docs/deep', 'archive/docs/readme.txt']);
    expect(tree.find((e) => e.path === 'archive/docs/readme.txt')?.fileId, 'the same file, the same id').toBe(readme);
    expect((await mainOf(w.store)).commits[2].touched.length, 'one commit moved the folder and both descendants').toBe(3);
  });

  it('T-DELETE-EDIT: deleting what was edited is delete_edited, editing what was deleted is edit_deleted, a folder deleted after a change beneath it is delete_edited (CONTROL: at the current counters both land)', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const { docs, readme, notes } = await seed(base, tokens['ghu-1'], w.store);
    const two = await uploaded(base, tokens['ghu-1'], 'second words');
    await committed(base, tokens['ghu-1'], 1, [{ op: 'update', fileId: readme, expectContentVersion: 1, ...two }]);
    const delEdited = await commit(base, tokens['ghu-1'], { requestId: rid('de'), baseRev: 1, ops: [{ op: 'delete', fileId: readme, expectContentVersion: 1 }] });
    expect([delEdited.status, delEdited.json.error.failures[0].kind]).toEqual([409, 'delete_edited']);
    const dirStale = await commit(base, tokens['ghu-1'], { requestId: rid('de'), baseRev: 1, ops: [{ op: 'delete', fileId: docs, expectSubtreeRev: 1 }] });
    expect([dirStale.status, dirStale.json.error.failures[0].kind]).toEqual([409, 'delete_edited']);
    await committed(base, tokens['ghu-1'], 2, [{ op: 'delete', fileId: notes, expectContentVersion: 1 }]);
    const editDeleted = await commit(base, tokens['ghu-1'], { requestId: rid('de'), baseRev: 2, ops: [{ op: 'update', fileId: notes, expectContentVersion: 1, ...two }] });
    expect([editDeleted.status, editDeleted.json.error.failures[0].kind]).toEqual([409, 'edit_deleted']);
    expect(await committed(base, tokens['ghu-1'], 3, [{ op: 'delete', fileId: docs, expectSubtreeRev: 2 }]), 'CONTROL: the folder at its subtree revision now').toBe(4);
    expect((await liveTree(w.store)).map((e) => e.path), 'the folder and what was in it').toEqual([]);
  });

  it('T-PATH-TAKEN: a path is taken case-insensitively and across NFC / NFD spellings (CONTROL: a distinct name lands)', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    await seed(base, tokens['ghu-1'], w.store);
    await committed(base, tokens['ghu-1'], 1, [{ op: 'create', path: 'café', kind: 'dir' }]);
    for (const path of ['DOCS/README.TXT', 'Docs/Readme.txt', 'café', 'CAFÉ']) {
      const a = await commit(base, tokens['ghu-1'], { requestId: rid('taken'), baseRev: 2, ops: [{ op: 'create', path, kind: 'dir' }] });
      expect([a.status, a.json.error.failures[0].kind], path).toEqual([409, 'path_taken']);
    }
    expect(await committed(base, tokens['ghu-1'], 2, [{ op: 'create', path: 'docs/readme2.txt', kind: 'dir' }]), 'CONTROL').toBe(3);
  });

  it('T-UNDELETE: an undelete is a new version; over a taken path it is path_taken, at a stale version a conflict (CONTROL: at its version it lands)', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const { notes } = await seed(base, tokens['ghu-1'], w.store);
    await committed(base, tokens['ghu-1'], 1, [{ op: 'delete', fileId: notes, expectContentVersion: 1 }]);
    const stale = await commit(base, tokens['ghu-1'], { requestId: rid('un'), baseRev: 2, ops: [{ op: 'undelete', fileId: notes, expectVersion: 1 }] });
    expect([stale.status, stale.json.error.failures[0].kind]).toEqual([409, 'content']);
    expect(await committed(base, tokens['ghu-1'], 2, [{ op: 'undelete', fileId: notes, expectVersion: 2 }]), 'CONTROL').toBe(3);
    const back = (await mainOf(w.store)).entries.get(notes);
    expect([back?.deleted, back?.version, back?.path]).toEqual([false, 3, 'notes.txt']);
    await committed(base, tokens['ghu-1'], 3, [{ op: 'delete', fileId: notes, expectContentVersion: 1 }]);
    await committed(base, tokens['ghu-1'], 4, [{ op: 'create', path: 'NOTES.TXT', kind: 'dir' }]);
    const taken = await commit(base, tokens['ghu-1'], { requestId: rid('un'), baseRev: 5, ops: [{ op: 'undelete', fileId: notes, expectVersion: 4 }] });
    expect([taken.status, taken.json.error.failures[0].kind]).toEqual([409, 'path_taken']);
  });

  it('T-PATH: every §6.6 refusal is 400 BEFORE anything changes (not a conflict), and no answer or log line echoes the path; CONTROL: the keep-both name with an ISO time\'s colons is refused too', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const logs: string[] = [];
    const base = await boot(depsOf(w.store, sessions, { log: (l) => logs.push(l) }));
    const { readme } = await seed(base, tokens['ghu-1'], w.store);
    const refused = [
      'CON.txt', 'docs/nul', 'com¹.log', 'x\u0000y', 'x\u0085y', 'x y', 'evil‮txt.exe', 'zero​width', '../escape', 'docs/../x', 'a//b', '/abs', 'trail.', 'trail ',
      ' lead', 'q?.txt', 'a:b', 'pipe|x', `${'p'.repeat(201)}`, `${'é'.repeat(128)}`, `docs/readme (conflict, ghu-1, 2026-10-12T12:00:00.001Z).txt`,
    ];
    for (const path of refused) {
      for (const ops of [[{ op: 'create', path, kind: 'dir' }], [{ op: 'move', fileId: readme, expectPathVersion: 1, newPath: path }]]) {
        const a = await commit(base, tokens['ghu-1'], { requestId: rid('path'), baseRev: 1, ops });
        expect([a.status, a.json.error.kind], JSON.stringify(path)).toEqual([400, 'invalid_request']);
        const text = a.bytes.toString('utf8');
        expect(text.includes(path) || text.includes(JSON.stringify(path).slice(1, -1)), `${JSON.stringify(path)} echoed`).toBe(false);
      }
    }
    expect([await headRev(w.store), (await w.store.conflicts(PROJECT, { status: 'all' })).ok], 'nothing changed, no conflict kept').toEqual([1, true]);
    const none = await w.store.conflicts(PROJECT, { status: 'all' });
    expect(none.ok && none.value.conflicts.length).toBe(0);
    for (const path of refused) expect(logs.join('\n').includes(path), `${JSON.stringify(path)} logged`).toBe(false);
    expect(logs.length, 'CONTROL: the refusals were logged').toBeGreaterThan(0);
  });

  it('a commit body is bounded and well-formed: over 1 MiB is 413 (judged on Content-Length before reading, and while reading without one), malformed JSON or UTF-8 is 400, another media type 415, more ops than §11 allows 400 (nothing kept)', async () => {
    const w = await world({ limits: SMALL });
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions, { limits: SMALL }));
    const auth = { authorization: `Relay-Session ${tokens['ghu-1']}` };
    // a declared 2 MiB: refused at once, nothing sent
    const declared = rawPost(base, COMMITS(), { ...auth, 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) });
    const big = await declared.answer;
    expect([big?.status, big?.json.error.kind, big?.headers.connection]).toEqual([413, 'request_too_large', 'close']);
    declared.req.destroy();
    // chunked, past the cap: refused while reading
    const chunked = rawPost(base, COMMITS(), { ...auth, 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
    for (let i = 0; i < 17; i += 1) chunked.req.write(Buffer.alloc(64 * 1024, 0x20));
    const over = await chunked.answer;
    expect([over?.status, over?.json.error.kind]).toEqual([413, 'request_too_large']);
    chunked.req.destroy();
    const json = { 'content-type': 'application/json' };
    for (const [body, kind, status] of [['{"requestId":', 'invalid_request', 400], [Buffer.from([0x7b, 0xff, 0x7d]), 'invalid_request', 400], ['[]', 'invalid_request', 400]] as const) {
      const a = await send(base, COMMITS(), { method: 'POST', token: tokens['ghu-1'], headers: json, body: typeof body === 'string' ? body : new Uint8Array(body) });
      expect([a.status, a.json.error.kind]).toEqual([status, kind]);
    }
    const text = await send(base, COMMITS(), { method: 'POST', token: tokens['ghu-1'], headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect([text.status, text.json.error.kind]).toEqual([415, 'unsupported_media_type']);
    const six = Array.from({ length: 6 }, (_, i): WfsOp => ({ op: 'create', path: `d${i}`, kind: 'dir' }));
    const many = await commit(base, tokens['ghu-1'], { requestId: rid('many'), baseRev: 0, ops: six });
    expect([many.status, many.json.error.message]).toEqual([400, 'WonderFS refused the request: a commit has more than 5 operations.']);
    const empty = await commit(base, tokens['ghu-1'], { requestId: rid('empty'), baseRev: 0, ops: [] });
    expect([empty.status, empty.json.error.message]).toEqual([400, 'WonderFS refused the request: a commit has no operations.']);
    expect(await headRev(w.store)).toBe(0);
    expect(await committed(base, tokens['ghu-1'], 0, six.slice(0, 3)), 'CONTROL: within the limits').toBe(1);
  });
});

/* =============================================================================================== conflicts and resolutions */

describe('WonderFS R2 H12: conflicts and their three resolutions (§6.4, INV-2)', () => {
  /** Two players update docs/readme.txt at once; the statuses, and the loser's player, conflict id and bytes. */
  async function race(store: WfsStore, base: string, tokens: Record<string, string>, readme: string) {
    const mine: Record<string, { sha256: string; size: number }> = {
      'ghu-2': await uploaded(base, tokens['ghu-2'], 'from the ADMIN'),
      'ghu-3': await uploaded(base, tokens['ghu-3'], 'from the MEMBER'),
    };
    const players = ['ghu-2', 'ghu-3'];
    const answers = await Promise.all(players.map((p) => commit(base, tokens[p], { requestId: rid('race'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: 1, ...mine[p] }] })));
    const lost = answers.findIndex((a) => a.status === 409);
    return { statuses: answers.map((a) => a.status).sort(), loser: players[lost], winner: players[1 - lost], refusal: answers[lost]?.json?.error, mine, store };
  }

  it('T-CONFLICT: two players change one file at once -- exactly one lands; the other is a 409 (no path in it) whose conflict keeps its ops, author and EXACT bytes; CONTROL: a last-writer-wins store lets both land', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2', 'ghu-3']);
    const base = await boot(depsOf(w.store, sessions));
    const { readme } = await seed(base, tokens['ghu-1'], w.store);
    const r = await race(w.store, base, tokens, readme);
    expect(r.statuses).toEqual([200, 409]);
    expect(r.refusal).toEqual({
      kind: 'conflict', message: expect.stringContaining('Nothing was applied'), conflictId: expect.any(String), branchId: 'main', headRev: 2, replay: false,
      failures: [{ opIndex: 0, kind: 'content', fileId: readme, detail: 'the file changed (version 2, expected 1)' }], failureCount: 1,
    });
    expect(JSON.stringify(r.refusal)).not.toContain('readme');
    // the record (what H10 will serve once contract r1.5 bounds it): the ops as given, the author, open
    const view = await w.store.conflict(PROJECT, r.refusal.conflictId);
    expect(view.ok && [view.value.status, view.value.record.principal.id, view.value.record.ops]).toEqual(['open', r.loser, [{ op: 'update', fileId: readme, expectContentVersion: 1, ...r.mine[r.loser] }]]);
    // its exact bytes stay readable by address while the conflict is retained (H7)
    const held = await send(base, `${BLOBS()}/${r.mine[r.loser].sha256}`, { token: tokens['ghu-1'] });
    expect([held.status, held.bytes.toString('utf8')]).toEqual([200, r.loser === 'ghu-2' ? 'from the ADMIN' : 'from the MEMBER']);
    expect(await contentOf(base, tokens['ghu-1'], readme), 'the winner\'s bytes').toBe(r.winner === 'ghu-2' ? 'from the ADMIN' : 'from the MEMBER');
    const events = await w.store.events(PROJECT, { afterSeq: 0 });
    expect(events.ok && events.value.events.map((e) => e.kind)).toEqual(['commit', 'commit', 'conflict']);
    // CONTROL: last writer wins (each update re-aimed at the counters the file has when it lands) -- both land, the test above goes red
    const lww = await world();
    let tail: Promise<unknown> = Promise.resolve();
    const lastWriterWins = proxied(lww.store, {
      commit: (p, req, now, authority) => {
        const run = tail.then(async () => {
          const main = await mainOf(lww.store);
          const ops = req.ops.map((op) => (op.op === 'update' ? { ...op, expectContentVersion: main.entries.get(op.fileId)?.contentVersion ?? 1 } : op));
          return lww.store.commit(p, { ...req, ops }, now, authority);
        });
        tail = run.catch(() => undefined);
        return run;
      },
    });
    const lwwBase = await boot(depsOf(lastWriterWins, sessions));
    const seeded = await seed(lwwBase, tokens['ghu-1'], lww.store);
    expect((await race(lww.store, lwwBase, tokens, seeded.readme)).statuses, 'CONTROL').toEqual([200, 200]);
  });

  it('the three resolutions: keep theirs dismisses (nothing changes), keep mine re-applies at today\'s counters, keep both keeps the content at the colon-free conflict name; each is recorded, and a closed conflict is not resolved twice', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2', 'ghu-3']);
    const base = await boot(depsOf(w.store, sessions));
    const { readme } = await seed(base, tokens['ghu-1'], w.store);
    /** ghu-2 edits the readme; ghu-3, still at the old version, is refused: the conflict's id. */
    let version = 1;
    const conflicted = async (label: string): Promise<{ id: string; bytes: string }> => {
      const theirs = await uploaded(base, tokens['ghu-2'], `theirs ${label}`);
      await committed(base, tokens['ghu-2'], await headRev(w.store), [{ op: 'update', fileId: readme, expectContentVersion: version, ...theirs }]);
      const mine = await uploaded(base, tokens['ghu-3'], `mine ${label}`);
      const a = await commit(base, tokens['ghu-3'], { requestId: rid('res'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: version, ...mine }] });
      version += 1;
      expect(a.status).toBe(409);
      return { id: a.json.error.conflictId, bytes: `mine ${label}` };
    };
    const now = async () => {
      const main = await mainOf(w.store);
      return { entries: main.entries, headRev: main.headRev };
    };
    // KEEP THEIRS
    const a = await conflicted('A');
    const theirs = await commit(base, tokens['ghu-3'], wonderfsKeepTheirs(a.id, rid('res'), (await now()).headRev));
    expect(theirs.status).toBe(200);
    const dismissed = await w.store.conflict(PROJECT, a.id);
    expect(dismissed.ok && [dismissed.value.status, Date.parse(dismissed.value.retainUntilIso as string) - Date.parse(dismissed.value.closedAtIso as string)]).toEqual(['dismissed', WFS_CONFLICT_RETENTION_MS]);
    expect(await contentOf(base, tokens['ghu-1'], readme), 'nothing changed').toBe('theirs A');
    const twice = await commit(base, tokens['ghu-3'], wonderfsKeepTheirs(a.id, rid('res'), (await now()).headRev));
    expect([twice.status, twice.json.error.kind]).toEqual([409, 'conflict_closed']);
    // KEEP MINE
    const b = await conflicted('B');
    const mine = wonderfsKeepMine(await conflictRecord(w.store, b.id), await now(), rid('res'));
    // the readme is at content version 3 now (seed 1, A's edit 2, keep-theirs changed nothing, B's edit 3)
    expect(mine?.ops).toEqual([{ op: 'update', fileId: readme, expectContentVersion: 3, sha256: sha('mine B'), size: 6 }]);
    expect((await commit(base, tokens['ghu-3'], mine)).status).toBe(200);
    const resolved = await w.store.conflict(PROJECT, b.id);
    expect(resolved.ok && resolved.value.status).toBe('resolved');
    expect(await contentOf(base, tokens['ghu-1'], readme)).toBe('mine B');
    // KEEP BOTH
    version += 1; // keep mine moved the readme on
    const c = await conflicted('C');
    const both = wonderfsKeepBoth(await conflictRecord(w.store, c.id), await now(), rid('res'));
    expect(both?.ops).toEqual([{ op: 'create', path: `docs/readme (conflict, ghu-3, ${AT_UTC}).txt`, kind: 'file', sha256: sha('mine C'), size: 6 }]);
    expect((await commit(base, tokens['ghu-3'], both)).status).toBe(200);
    const kept = await entryAt(w.store, `docs/readme (conflict, ghu-3, ${AT_UTC}).txt`);
    expect([await contentOf(base, tokens['ghu-1'], kept?.fileId as string), await contentOf(base, tokens['ghu-1'], readme)]).toEqual(['mine C', 'theirs C']);
    const closed = await w.store.conflict(PROJECT, c.id);
    expect(closed.ok && closed.value.status).toBe('resolved');
    // an unknown conflict id is the one 404
    const unknown = await commit(base, tokens['ghu-3'], wonderfsKeepTheirs('conflict_nope', rid('res'), (await now()).headRev));
    expect([unknown.status, unknown.json]).toEqual([404, NOT_FOUND]);
  });

  it('resolution helpers (R2-r2, correctness MINOR-6): keep mine over a file deleted meanwhile brings it back first and lands; keep both picks a name no live file has (a counter after the time) and lands twice', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2', 'ghu-3']);
    const base = await boot(depsOf(w.store, sessions));
    const { readme, notes } = await seed(base, tokens['ghu-1'], w.store);
    const now = async () => {
      const main = await mainOf(w.store);
      return { entries: main.entries, headRev: main.headRev };
    };
    // KEEP MINE over edit_deleted
    await committed(base, tokens['ghu-2'], 1, [{ op: 'delete', fileId: notes, expectContentVersion: 1 }]);
    const mine = await uploaded(base, tokens['ghu-3'], 'my notes');
    const lost = await commit(base, tokens['ghu-3'], { requestId: rid('help'), baseRev: 1, ops: [{ op: 'update', fileId: notes, expectContentVersion: 1, ...mine }] });
    expect([lost.status, lost.json.error.failures[0].kind]).toEqual([409, 'edit_deleted']);
    const keepMine = wonderfsKeepMine(await conflictRecord(w.store, lost.json.error.conflictId), await now(), rid('help'));
    expect(keepMine?.ops).toEqual([{ op: 'undelete', fileId: notes, expectVersion: 2 }, { op: 'update', fileId: notes, expectContentVersion: 1, ...mine }]);
    expect((await commit(base, tokens['ghu-3'], keepMine)).status).toBe(200);
    expect(await contentOf(base, tokens['ghu-1'], notes)).toBe('my notes');
    // KEEP BOTH, twice on one file at one second: the second name takes a counter
    for (const [i, expected] of [[1, `docs/readme (conflict, ghu-3, ${AT_UTC}).txt`], [2, `docs/readme (conflict, ghu-3, ${AT_UTC}, 2).txt`]] as const) {
      const cur = (await mainOf(w.store)).entries.get(readme);
      const theirs = await uploaded(base, tokens['ghu-2'], `theirs ${i}`);
      await committed(base, tokens['ghu-2'], (await now()).headRev, [{ op: 'update', fileId: readme, expectContentVersion: cur?.contentVersion as number, ...theirs }]);
      const late = await uploaded(base, tokens['ghu-3'], `late ${i}`);
      const refused = await commit(base, tokens['ghu-3'], { requestId: rid('help'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: cur?.contentVersion as number, ...late }] });
      const both = wonderfsKeepBoth(await conflictRecord(w.store, refused.json.error.conflictId), await now(), rid('help'));
      expect(both?.ops.map((o) => (o.op === 'create' ? o.path : o.op))).toEqual([expected]);
      expect((await commit(base, tokens['ghu-3'], both)).status, expected).toBe(200);
    }
  });

  it('keep-both NAMES: colon-free UTC, the author, the extension kept, the stem shortened to 200 characters and 255 bytes, every one a legal path; CONTROL: the ISO time\'s colons are refused (§6.6)', () => {
    expect(wonderfsCompactUtc('2026-10-12T17:12:28.123Z')).toBe('20261012T171228Z');
    expect(wonderfsCompactUtc('not a time')).toBeNull();
    const at = '2026-10-12T17:12:28.123Z';
    const cases: Array<[string, string, string | null]> = [
      ['docs/readme.txt', 'ghu-3', 'docs/readme (conflict, ghu-3, 20261012T171228Z).txt'],
      ['archive.tar.gz', 'ghu-3', 'archive.tar (conflict, ghu-3, 20261012T171228Z).gz'],
      ['.env', 'ghu-3', '.env (conflict, ghu-3, 20261012T171228Z)'],
      ['Makefile', 'ghu-3', 'Makefile (conflict, ghu-3, 20261012T171228Z)'],
      ['a.md', 'agent:x/y z', 'a (conflict, agent-x-y-z, 20261012T171228Z).md'],
      [`${'d'.repeat(170)}/e.txt`, 'ghu-3', null],
    ];
    for (const [path, who, expected] of cases) expect(wonderfsKeepBothPath(path, who, at), path).toBe(expected);
    const shortened = [`a/${'b'.repeat(190)}.txt`, `${'é'.repeat(120)}.md`, `${'\u{1F600}'.repeat(60)}.txt`, `x/${'y'.repeat(150)}`];
    for (const path of shortened) {
      const named = wonderfsKeepBothPath(path, 'ghu-3', at) as string;
      const leaf = named.split('/').pop() as string;
      expect([named.length <= 200, Buffer.byteLength(leaf, 'utf8') <= 255, named.includes(':'), normalizeWfsPath(named).ok], path.slice(0, 12)).toEqual([true, true, false, true]);
      expect(Buffer.from(named, 'utf8').toString('utf8'), 'no half of a surrogate pair').toBe(named);
      expect(named).toContain(` (conflict, ghu-3, 20261012T171228Z)`);
    }
    // a stem is cut by whole grapheme clusters: x + U+0301 has no precomposed form, so NFC keeps it two code points, and a cut by
    // code point would leave a bare x (R2-r2, correctness MINOR-6). '.mdx' puts the first fitting code-point cut mid-cluster.
    const accented = wonderfsKeepBothPath(`${'x\u0301'.repeat(80)}.mdx`, 'ghu-3', at) as string;
    expect([accented.includes('x (conflict'), accented.includes('x\u0301 (conflict'), Buffer.byteLength(accented, 'utf8') <= 255]).toEqual([false, true, true]);
    // taken names get a counter; every counter taken, no name
    expect(wonderfsKeepBothPath('a.md', 'ghu-3', at, (key) => key === 'a (conflict, ghu-3, 20261012t171228z).md')).toBe('a (conflict, ghu-3, 20261012T171228Z, 2).md');
    expect(wonderfsKeepBothPath('a.md', 'ghu-3', at, () => true)).toBeNull();
    // CONTROL: the ISO spelling is not a legal name
    expect(normalizeWfsPath(`docs/readme (conflict, ghu-3, ${at}).txt`).ok).toBe(false);
  });
});

/* ======================================================================================================================= H11 */

describe('WonderFS R2 H11: uploads (§6.2 put_blob, §10.1, §19.m3)', () => {
  it('the address is the server\'s: 200 {sha256, size}; the same bytes again keep nothing new; a matching X-WonderFS-Sha256 lands, a mismatching one is 422 and NOTHING is kept (CONTROL), a malformed one 400', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions));
    const bytes = utf8('exact bytes');
    expect(await uploaded(base, tokens['ghu-1'], bytes)).toEqual({ sha256: sha(bytes), size: 11 });
    expect(await uploaded(base, tokens['ghu-1'], bytes), 'idempotent').toEqual({ sha256: sha(bytes), size: 11 });
    expect(blobCount(w.store)).toBe(1);
    const claimed = await upload(base, tokens['ghu-1'], 'claimed bytes', { sha: sha('claimed bytes') });
    expect(claimed.status, 'CONTROL: the right address').toBe(200);
    const lie = await upload(base, tokens['ghu-1'], 'other bytes', { sha: sha('not these') });
    expect([lie.status, lie.json.error.kind]).toEqual([422, 'hash_mismatch']);
    const bad = await upload(base, tokens['ghu-1'], 'other bytes', { sha: 'ABC' });
    expect([bad.status, bad.json.error.kind]).toEqual([400, 'invalid_request']);
    expect(blobCount(w.store), 'nothing kept for either').toBe(2);
    const info = await w.store.blobInfo(PROJECT, sha('other bytes'));
    expect(info.ok && info.value).toBeNull();
    // the STORE's own check, for any caller that skips the route's: nothing kept
    const direct = await w.store.putBlob(PROJECT, utf8('direct'), { claimedSha256: sha('elsewhere') });
    expect(direct.ok ? 'kept' : [direct.error.code, direct.error.details]).toEqual(['validation-failed', ['wonderfs: hash_mismatch']]);
    expect(blobCount(w.store)).toBe(2);
    const fine = await w.store.putBlob(PROJECT, utf8('direct'), { claimedSha256: sha('direct') });
    expect(fine.ok, 'CONTROL').toBe(true);
  });

  it('the body is judged before a byte is read -- 415 another media type, 411 no Content-Length, 413 file_too_large past §11\'s per-file limit (Connection: close) -- and while reading: a body that stops is 408 and keeps nothing, an abort keeps nothing and frees its slot', async () => {
    const w = await world({ limits: SMALL });
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions, { limits: SMALL, writeBudgets: createWonderfsWriteBudgets(), bodyTimeouts: { upload: { idleMs: 100, deadlineMs: 5_000 } } }));
    const auth = { authorization: `Relay-Session ${tokens['ghu-1']}` };
    const text = await upload(base, tokens['ghu-1'], 'x', { type: 'text/plain' });
    expect([text.status, text.json.error.kind]).toEqual([415, 'unsupported_media_type']);
    const chunked = rawPost(base, BLOBS(), { ...auth, 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' });
    chunked.req.write('abc');
    const noLength = await chunked.answer;
    expect([noLength?.status, noLength?.json.error.kind]).toEqual([411, 'length_required']);
    chunked.req.destroy();
    const declared = rawPost(base, BLOBS(), { ...auth, 'content-type': 'application/octet-stream', 'content-length': '65' });
    const tooBig = await declared.answer; // nothing was sent: judged on the declaration
    expect([tooBig?.status, tooBig?.json.error.kind, tooBig?.headers.connection]).toEqual([413, 'file_too_large', 'close']);
    declared.req.destroy();
    const sent = await upload(base, tokens['ghu-1'], 'z'.repeat(65));
    expect([sent.status, sent.json.error.kind]).toEqual([413, 'file_too_large']);
    // a body that stops arriving
    const stalled = rawPost(base, BLOBS(), { ...auth, 'content-type': 'application/octet-stream', 'content-length': '10' });
    stalled.req.write('12345');
    const slow = await stalled.answer;
    expect([slow?.status, slow?.json.error.kind]).toEqual([408, 'request_timeout']);
    stalled.req.destroy();
    // a client that goes away mid-upload (T-CRASH row 1, "during an upload"): no blob, and its slot comes back
    const gone = rawPost(base, BLOBS(), { ...auth, 'content-type': 'application/octet-stream', 'content-length': '10' });
    gone.req.write('12345');
    await new Promise<void>((r) => setImmediate(r));
    gone.req.destroy();
    expect(await gone.answer).toBeNull();
    expect(blobCount(w.store), 'nothing kept').toBe(0);
    await vi.waitFor(async () => expect((await upload(base, tokens['ghu-1'], 'after')).status).toBe(200), { timeout: 10_000, interval: 5 });
    expect(blobCount(w.store), 'CONTROL: the retry lands').toBe(1);
  }, 30_000);

  it('T-ORPHAN, its counting half (§19.m3; R2-r2, security MAJOR-3): every upload no file\'s history names -- an orphan, or one only a conflict names -- counts as PENDING: to the limit, then 413 project_full before a byte is kept; a held blob grows nothing; a file taking it makes it live, deleting that file frees the room', async () => {
    const w = await world({ limits: SMALL });
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions, { limits: SMALL }));
    const a60 = await uploaded(base, tokens['ghu-1'], 'a'.repeat(60));
    const b40 = await uploaded(base, tokens['ghu-1'], 'b'.repeat(40)); // exactly at the limit: the boundary CONTROL
    const full = await upload(base, tokens['ghu-1'], 'c');
    expect([full.status, full.json.error]).toEqual([413, { kind: 'project_full', message: WFS_PROJECT_FULL_MESSAGE }]);
    expect(blobCount(w.store), 'nothing kept (and live is 0: only PENDING bytes refused it)').toBe(2);
    expect((await upload(base, tokens['ghu-1'], 'a'.repeat(60))).status, 'held: grows nothing').toBe(200);
    // a pending blob is invisible by address
    expect((await send(base, `${BLOBS()}/${a60.sha256}`, { token: tokens['ghu-1'] })).status).toBe(404);
    await committed(base, tokens['ghu-1'], 0, [{ op: 'create', path: 'a.txt', kind: 'file', ...a60 }]);
    expect((await send(base, `${BLOBS()}/${a60.sha256}`, { token: tokens['ghu-1'] })).status, 'named now').toBe(200);
    expect((await upload(base, tokens['ghu-1'], 'c')).status, 'live 60 + pending 40: still full').toBe(413);
    const aFile = (await entryAt(w.store, 'a.txt'))?.fileId as string;
    await committed(base, tokens['ghu-1'], 1, [{ op: 'delete', fileId: aFile, expectContentVersion: 1 }]);
    const c1 = await uploaded(base, tokens['ghu-1'], 'c'); // live 0 + pending 40 + 1: the deleted file's bytes are history, not pending
    const d59 = await uploaded(base, tokens['ghu-1'], 'd'.repeat(59)); // pending 100
    // a conflict naming d (an edit of the deleted file): d is READABLE while the conflict is retained, but it is still room taken
    const refused = await commit(base, tokens['ghu-1'], { requestId: rid('orphan'), baseRev: 2, ops: [{ op: 'update', fileId: aFile, expectContentVersion: 1, ...d59 }] });
    expect([refused.status, refused.json.error.failures[0].kind]).toEqual([409, 'edit_deleted']);
    expect((await upload(base, tokens['ghu-1'], 'e')).status, 'conflict-held d is still pending: full').toBe(413);
    expect((await commit(base, tokens['ghu-1'], wonderfsKeepTheirs(refused.json.error.conflictId, rid('orphan'), 2))).status).toBe(200);
    const info = await w.store.blobInfo(PROJECT, d59.sha256);
    expect([info.ok && info.value?.referenced, (await send(base, `${BLOBS()}/${d59.sha256}`, { token: tokens['ghu-1'] })).status], 'dismissed, retained: still named and served').toEqual([true, 200]);
    expect((await upload(base, tokens['ghu-1'], 'e')).status, 'and still pending').toBe(413);
    // CONTROL: once a FILE names d it is live, not pending; deleting that file leaves it history, and the room comes back
    await committed(base, tokens['ghu-1'], 3, [{ op: 'create', path: 'd.txt', kind: 'file', ...d59 }]);
    const dFile = (await entryAt(w.store, 'd.txt'))?.fileId as string;
    await committed(base, tokens['ghu-1'], 4, [{ op: 'delete', fileId: dFile, expectContentVersion: 1 }]);
    expect((await upload(base, tokens['ghu-1'], 'e'.repeat(59))).status, 'live 0 + pending 41 + 59').toBe(200);
    const orphan = await w.store.blobInfo(PROJECT, sha('e'.repeat(59)));
    expect(orphan.ok && orphan.value?.referenced, 'e, uploaded and never named, is an orphan').toBe(false);
    expect([b40.size, c1.size]).toEqual([40, 1]);
  });
  it('upload room (§8.4; R2-r2, security MINOR-1): one upload in flight per player, DECLARED bytes in flight per process (429 + Retry-After 1) -- a small upload fits beside two held ones, a larger one does not; bytes per (player, project) per day, Retry-After N = the body\'s N (CONTROLS: the room comes back; another project has its own)', async () => {
    const w = await world();
    w.store.seedProject('prj-beta', { 'ghu-1': 'OWNER' });
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2', 'ghu-3']);
    const real = createWonderfsWriteBudgets({ uploadBytes: { burstBytes: 100, perMinuteBytes: 60 }, maxUploadBytesInFlight: 25 });
    let held = 0;
    const counted: WonderfsWriteBudgets = {
      ...real,
      startUpload: (player, declared) => {
        const end = real.startUpload(player, declared);
        if (end === null) return null;
        held += 1;
        let ended = false;
        return () => {
          if (!ended) held -= 1;
          ended = true;
          end();
        };
      },
    };
    const base = await boot(depsOf(w.store, sessions, { writeBudgets: counted }));
    const auth = (p: string) => ({ authorization: `Relay-Session ${tokens[p]}`, 'content-type': 'application/octet-stream', 'content-length': '10' });
    const first = rawPost(base, BLOBS(), auth('ghu-1'));
    first.req.write('12345');
    await vi.waitFor(() => expect(held).toBe(1), { timeout: 10_000, interval: 5 });
    const mineAgain = await upload(base, tokens['ghu-1'], 'second');
    expect([mineAgain.status, mineAgain.headers['retry-after'], mineAgain.json.error.message]).toEqual([429, '1', 'Too many requests; try again in 1 s.']);
    const second = rawPost(base, BLOBS(), auth('ghu-2'));
    second.req.write('12345');
    await vi.waitFor(() => expect(held).toBe(2), { timeout: 10_000, interval: 5 });
    // 20 of 25 declared bytes are in flight: 5 more fit, 6 do not
    expect((await upload(base, tokens['ghu-3'], 'fives')).status, 'CONTROL: a small upload fits beside two held ones').toBe(200);
    const larger = await upload(base, tokens['ghu-3'], 'sixsix');
    expect([larger.status, larger.headers['retry-after']], 'the process\'s declared bytes are taken').toEqual([429, '1']);
    first.req.end('67890');
    second.req.end('67890');
    expect([(await first.answer)?.status, (await second.answer)?.status]).toEqual([200, 200]);
    await vi.waitFor(() => expect(held).toBe(0), { timeout: 10_000, interval: 5 });
    expect((await upload(base, tokens['ghu-3'], 'sixsix')).status, 'CONTROL: the room came back').toBe(200);
    // bytes per (player, project) per day (budgets of their own: the 25-byte room above admits no larger upload at all)
    const daily = await boot(depsOf(w.store, sessions, { writeBudgets: createWonderfsWriteBudgets({ uploadBytes: { burstBytes: 100, perMinuteBytes: 60 } }) }));
    expect((await upload(daily, tokens['ghu-1'], 'x'.repeat(80))).status).toBe(200);
    const over = await upload(daily, tokens['ghu-1'], 'y'.repeat(30));
    const n = Number(over.headers['retry-after']);
    expect([over.status, over.json.error.message]).toEqual([429, `Too many requests; try again in ${n} s.`]);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await upload(daily, tokens['ghu-1'], 'z'.repeat(20))).status, 'CONTROL: what is left still fits').toBe(200);
    expect((await upload(daily, tokens['ghu-1'], 'y'.repeat(30), { project: 'prj-beta' })).status, 'CONTROL: another project has its own').toBe(200);
  }, 30_000);

  it('upload budgets (R2-r3): the STORED-bytes budget is given back when nothing new is kept -- bytes the project holds, a 413 -- but never after a 422 or an abort; the per-player INGRESS budget is never given back, so a re-upload of held bytes or a lying upload still costs its sender; a stalled small upload holds its room for seconds', async () => {
    const w = await world({ limits: SMALL });
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-2']);
    const real = createWonderfsWriteBudgets({ uploadBytes: { burstBytes: 1_000, perMinuteBytes: 60 }, uploadIngress: { burstBytes: 1_000, perMinuteBytes: 60 } });
    const refunds: number[] = [];
    const counted: WonderfsWriteBudgets = { ...real, refundUploadBytes: (player, project, bytes, now) => { refunds.push(bytes); real.refundUploadBytes(player, project, bytes, now); } };
    const base = await boot(depsOf(w.store, sessions, { limits: SMALL, writeBudgets: counted }));
    expect((await upload(base, tokens['ghu-1'], 'a'.repeat(30))).status).toBe(200);
    expect(refunds, 'CONTROL: a new blob is paid for').toEqual([]);
    expect((await upload(base, tokens['ghu-1'], 'a'.repeat(30))).status).toBe(200);
    expect(refunds, 'held bytes: the stored budget given back').toEqual([30]);
    expect((await upload(base, tokens['ghu-1'], 'c'.repeat(10), { sha: sha('not these') })).status).toBe(422);
    expect(refunds, 'a 422 is NOT given back').toEqual([30]);
    expect((await upload(base, tokens['ghu-1'], 'b'.repeat(64))).status).toBe(200); // pending 94
    expect((await upload(base, tokens['ghu-1'], 'f'.repeat(10))).status).toBe(413);
    expect(refunds, 'a 413: given back').toEqual([30, 10]);
    const gone = rawPost(base, BLOBS(), { authorization: `Relay-Session ${tokens['ghu-1']}`, 'content-type': 'application/octet-stream', 'content-length': '20' });
    gone.req.write('12345');
    await new Promise<void>((r) => setImmediate(r));
    gone.req.destroy();
    expect(await gone.answer).toBeNull();
    await vi.waitFor(async () => expect((await upload(base, tokens['ghu-1'], 'a'.repeat(30))).status).toBe(200), { timeout: 10_000, interval: 5 });
    expect(refunds, 'an abort (20 declared) is not given back; the held re-upload after it is').toEqual([30, 10, 30]);
    // the INGRESS budget, per player, never given back: 30 + 30 + 10 + 64 + 10 + 20 + 30 = 194 of ghu-1's 1000 are spent
    const ingress = createWonderfsWriteBudgets({ uploadBytes: { burstBytes: 1_000, perMinuteBytes: 60 }, uploadIngress: { burstBytes: 100, perMinuteBytes: 60 } });
    const tight = await boot(depsOf(w.store, sessions, { limits: SMALL, writeBudgets: ingress }));
    for (let i = 0; i < 3; i += 1) expect((await upload(tight, tokens['ghu-1'], 'a'.repeat(30))).status, `held re-upload ${i + 1}: lands, nothing stored`).toBe(200);
    const spent = await upload(tight, tokens['ghu-1'], 'a'.repeat(30));
    const n = Number(spent.headers['retry-after']);
    expect([spent.status, spent.json.error.message], 'the 4th: 90 of 100 ingress spent on bytes the project already held').toEqual([429, `Too many requests; try again in ${n} s.`]);
    expect((await upload(tight, tokens['ghu-1'], 'g'.repeat(10))).status, 'CONTROL: 10 bytes are still within the ingress -- they reach the ROOM check (413), not the budget (429)').toBe(413);
    for (let i = 0; i < 3; i += 1) expect((await upload(tight, tokens['ghu-2'], 'z'.repeat(30), { sha: sha('lies') })).status, 'CONTROL: another player has its own; a lie is 422').toBe(422);
    expect((await upload(tight, tokens['ghu-2'], 'z'.repeat(30), { sha: sha('lies') })).status, 'lying uploads spend ingress too: the 4th is refused before a byte is read').toBe(429);
    // the bucket arithmetic: take, refuse, give back STORED bytes, take
    const b = createWonderfsWriteBudgets({ uploadBytes: { burstBytes: 100, perMinuteBytes: 60 }, uploadIngress: { burstBytes: 1_000, perMinuteBytes: 60 } });
    expect([b.takeUploadBytes('p', 'q', 60, T0).ok, b.takeUploadBytes('p', 'q', 50, T0).ok]).toEqual([true, false]);
    b.refundUploadBytes('p', 'q', 60, T0);
    expect(b.takeUploadBytes('p', 'q', 100, T0).ok, 'stored bytes given back in full').toBe(true);
    // the deadline follows the declared size: a 30-byte upload stalls for ~10 s at most, a 64 MiB one for 300 s
    expect([wonderfsUploadDeadlineMs(30), wonderfsUploadDeadlineMs(64 * 1024 * 1024), wonderfsUploadDeadlineMs(1024 * 1024)]).toEqual([10_001, 300_000, 26_000]);
  }, 30_000);
});

/* ================================================================================================================== budgets */

describe('WonderFS R2: commit budgets (§8.4)', () => {
  it('the commit rate: 429 + Retry-After N with the body\'s N, nothing kept (CONTROL: the burst lands; another project is charged apart)', async () => {
    const w = await world();
    w.store.seedProject('prj-beta', { 'ghu-1': 'OWNER' });
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions, { writeBudgets: createWonderfsWriteBudgets({ commit: { burst: 2, everyMs: 30_000 } }) }));
    expect(await committed(base, tokens['ghu-1'], 0, [{ op: 'create', path: 'a', kind: 'dir' }])).toBe(1);
    expect(await committed(base, tokens['ghu-1'], 1, [{ op: 'create', path: 'b', kind: 'dir' }])).toBe(2);
    const third = await commit(base, tokens['ghu-1'], { requestId: rid('rate'), baseRev: 2, ops: [{ op: 'create', path: 'c', kind: 'dir' }] });
    const n = Number(third.headers['retry-after']);
    expect([third.status, third.json.error.kind, third.json.error.message, n]).toEqual([429, 'rate_limited', `Too many requests; try again in ${n} s.`, 30]);
    expect(await headRev(w.store)).toBe(2);
    const beta = await commit(base, tokens['ghu-1'], { requestId: rid('rate'), baseRev: 0, ops: [{ op: 'create', path: 'c', kind: 'dir' }] }, { project: 'prj-beta' });
    expect(beta.status, 'CONTROL').toBe(200);
  });

  it('commit bodies are a daily BYTES budget per (player, project) (R2-r2, security MAJOR-2(c)): past it, 429 with the body\'s N and nothing kept; CONTROL: within it they land', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1']);
    const bodies = [0, 1, 2].map((i) => ({ requestId: rid('bytes'), baseRev: i, ops: [{ op: 'create', path: `${'d'.repeat(60)}${i}`, kind: 'dir' }] }));
    const sizes = bodies.map((b) => Buffer.byteLength(JSON.stringify(b), 'utf8'));
    const base = await boot(depsOf(w.store, sessions, { writeBudgets: createWonderfsWriteBudgets({ commitBytes: { burstBytes: sizes[0] + sizes[1], perMinuteBytes: 60 } }) }));
    expect([(await commit(base, tokens['ghu-1'], bodies[0])).status, (await commit(base, tokens['ghu-1'], bodies[1])).status], 'CONTROL').toEqual([200, 200]);
    const third = await commit(base, tokens['ghu-1'], bodies[2]);
    const n = Number(third.headers['retry-after']);
    expect([third.status, third.json.error.message]).toEqual([429, `Too many requests; try again in ${n} s.`]);
    expect(await headRev(w.store)).toBe(2);
  });

  it('two honest conflict limits (R2-r3): the OPEN limit (§8.4) answers 429 rate_limited / too_many_open_conflicts, "resolve some", Retry-After 60 -- and resolving lifts it; the RETAINED storage limit answers 429 conflict_storage_full / retained_conflicts, no "resolve", Retry-After = until the oldest closed one expires (none when none is closed) -- and resolving does NOT lift it; a change that lands is never refused (CONTROLS)', async () => {
    const w = await world();
    const { sessions, tokens } = signIn(['ghu-1', 'ghu-3']);
    const { readme } = await seed(await boot(depsOf(w.store, sessions)), tokens['ghu-1'], w.store);
    const stale = (extra: Record<string, unknown> = {}) => ({ requestId: rid('lim'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: 9, sha256: sha('first words'), size: 11 }], ...extra });
    const conflictCount = async () => {
      const all = await w.store.conflicts(PROJECT, { status: 'all' });
      return all.ok ? all.value.conflicts.length : -1;
    };
    // THE OPEN LIMIT: 2
    const open = await boot(depsOf(w.store, sessions, { writeBudgets: createWonderfsWriteBudgets({ maxOpenConflicts: 2, maxRetainedConflicts: 100 }) }));
    const one = await commit(open, tokens['ghu-3'], stale());
    expect((await commit(open, tokens['ghu-3'], stale())).status).toBe(409);
    const capped = await commit(open, tokens['ghu-3'], stale());
    expect([capped.status, capped.json.error.kind, capped.json.error.reason, capped.headers['retry-after'], capped.json.error.message])
      .toEqual([429, 'rate_limited', 'too_many_open_conflicts', '60', 'You have too many unresolved conflicts in this project: resolve some, then try again in 60 s.']);
    expect(await conflictCount(), 'nothing kept').toBe(2);
    expect((await commit(open, tokens['ghu-3'], { requestId: rid('lim'), baseRev: 1, ops: [{ op: 'create', path: 'clean', kind: 'dir' }] })).status, 'CONTROL: a change that lands').toBe(200);
    expect((await commit(open, tokens['ghu-3'], stale({ resolvesConflictId: one.json.error.conflictId }))).json.error.reason, 'a failing resolution would open one more').toBe('too_many_open_conflicts');
    expect((await commit(open, tokens['ghu-3'], wonderfsKeepTheirs(one.json.error.conflictId, rid('lim'), 2))).status).toBe(200);
    expect((await commit(open, tokens['ghu-3'], stale())).status, 'CONTROL: resolving LIFTED it -- the message was true').toBe(409);
    // THE RETAINED STORAGE LIMIT: ghu-3 now has 3 retained (1 dismissed, 2 open); a limit of 3
    const kept = await boot(depsOf(w.store, sessions, { writeBudgets: createWonderfsWriteBudgets({ maxOpenConflicts: 100, maxRetainedConflicts: 3 }) }));
    const full = await commit(kept, tokens['ghu-3'], stale());
    const thirtyDays = 30 * 24 * 3600;
    expect([full.status, full.json.error.kind, full.json.error.reason, full.headers['retry-after']]).toEqual([429, 'conflict_storage_full', 'retained_conflicts', String(thirtyDays)]);
    expect(full.json.error.message).toBe(`This project keeps each of your conflicts for 30 days after it closes, and it holds as many of yours as it keeps; the next one frees in ${thirtyDays} s. A change that does not conflict still lands.`);
    expect(full.json.error.message, 'no false "resolve"').not.toMatch(/resolve/iu);
    const open2 = (await w.store.conflicts(PROJECT, { status: 'open' }));
    const someOpen = open2.ok ? open2.value.conflicts[0].conflictId : '';
    expect((await commit(kept, tokens['ghu-3'], wonderfsKeepTheirs(someOpen, rid('lim'), 3))).status).toBe(200);
    expect((await commit(kept, tokens['ghu-3'], stale())).json.error?.reason, 'CONTROL: resolving does NOT lift the storage limit').toBe('retained_conflicts');
    expect((await commit(kept, tokens['ghu-1'], stale())).status, 'CONTROL: per player').toBe(409);
    const later = T0 + 31 * 24 * 3600 * 1000;
    const s2 = signIn(['ghu-3'], later);
    const afterwards = await boot(depsOf(w.store, s2.sessions, { writeBudgets: createWonderfsWriteBudgets({ maxOpenConflicts: 100, maxRetainedConflicts: 3 }) }), later + 1);
    expect((await commit(afterwards, s2.tokens['ghu-3'], stale())).status, 'CONTROL: 31 days on, the closed ones expired').toBe(409);
    // only OPEN conflicts retained, none closed: no wait would help, so no Retry-After is sent
    const s3 = signIn(['ghu-1'], later);
    const strict = await boot(depsOf(w.store, s3.sessions, { writeBudgets: createWonderfsWriteBudgets({ maxOpenConflicts: 100, maxRetainedConflicts: 1 }) }), later + 1);
    const noWait = await commit(strict, s3.tokens['ghu-1'], stale());
    expect([noWait.status, noWait.json.error.reason, noWait.headers['retry-after']], 'ghu-1 holds one OPEN conflict and nothing closed').toEqual([429, 'retained_conflicts', undefined]);
  });
});

/* ===================================================================================================================== §11 */

describe('WonderFS R2: T-LIMITS (§11: scale is limited, integrity never; grow-only)', () => {
  it('a commit that would GROW a project past its files or bytes is 413 project_full in §11\'s words and changes nothing; one that SHRINKS an over-limit project lands (CONTROL), and growing it again is refused', async () => {
    const w = await world({ limits: SMALL });
    const { sessions, tokens } = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, sessions, { limits: SMALL }));
    const one = await uploaded(base, tokens['ghu-1'], '1');
    await committed(base, tokens['ghu-1'], 0, ['f1', 'f2', 'f3'].map((path): WfsOp => ({ op: 'create', path, kind: 'file', ...one })));
    const fourth = await commit(base, tokens['ghu-1'], { requestId: rid('lim'), baseRev: 1, ops: [{ op: 'create', path: 'f4', kind: 'file', ...one }] });
    expect([fourth.status, fourth.json.error]).toEqual([413, { kind: 'project_full', message: WFS_PROJECT_FULL_MESSAGE }]);
    expect(await headRev(w.store)).toBe(1);
    // the same backing under a tighter limit (one file): the project is over it now
    const tight = await world({ backing: w.backing, limits: { ...SMALL, maxFiles: 1 } });
    const tightBase = await boot(depsOf(tight.store, sessions, { limits: { ...SMALL, maxFiles: 1 } }));
    const f3 = (await entryAt(w.store, 'f3'))?.fileId as string;
    expect(await committed(tightBase, tokens['ghu-1'], 1, [{ op: 'delete', fileId: f3, expectContentVersion: 1 }]), 'CONTROL: shrinking lands').toBe(2);
    const grow = await commit(tightBase, tokens['ghu-1'], { requestId: rid('lim'), baseRev: 2, ops: [{ op: 'create', path: 'f5', kind: 'file', ...one }] });
    expect(grow.status).toBe(413);
    // bytes (files unlimited here): a 60-byte file is 60 live; a second copy of it would be 120 > 100
    const roomy = { ...SMALL, maxFiles: 100 };
    const wb = await world({ limits: roomy });
    const bytesBase = await boot(depsOf(wb.store, sessions, { limits: roomy }));
    const sixty = await uploaded(bytesBase, tokens['ghu-1'], 's'.repeat(60));
    expect(await committed(bytesBase, tokens['ghu-1'], 0, [{ op: 'create', path: 'big1', kind: 'file', ...sixty }]), 'CONTROL: within the bytes').toBe(1);
    const copy = await commit(bytesBase, tokens['ghu-1'], { requestId: rid('lim'), baseRev: 1, ops: [{ op: 'create', path: 'big2', kind: 'file', ...sixty }] });
    expect([copy.status, copy.json.error]).toEqual([413, { kind: 'project_full', message: WFS_PROJECT_FULL_MESSAGE }]);
    expect(await headRev(wb.store)).toBe(1);
  });
});

/* =========================================================================================================== T-PERSIST/CRASH */

describe('WonderFS R2: T-PERSIST and T-CRASH (§10.3; INV-1, INV-8, INV-11)', () => {
  it('T-PERSIST: committed files and their bytes are identical by sha256 after a restart and a new sign-in (CONTROL: a store that dropped the writes has none)', async () => {
    const w = await world();
    const before = signIn(['ghu-1']);
    const base = await boot(depsOf(w.store, before.sessions));
    const { readme, first } = await seed(base, before.tokens['ghu-1'], w.store);
    const tree = await send(base, `/wonderfs/v1/projects/${PROJECT}/branches/main/tree`, { token: before.tokens['ghu-1'] });
    // the restart: a new store object over the same backing, new sessions
    const restarted = await world({ backing: w.backing });
    const after = signIn(['ghu-1']);
    const again = await boot(depsOf(restarted.store, after.sessions));
    const treeAfter = await send(again, `/wonderfs/v1/projects/${PROJECT}/branches/main/tree`, { token: after.tokens['ghu-1'] });
    expect([treeAfter.status, treeAfter.json.data.entries]).toEqual([200, tree.json.data.entries]);
    const bytes = await send(again, `/wonderfs/v1/projects/${PROJECT}/branches/main/files/${readme}/content`, { token: after.tokens['ghu-1'] });
    expect([bytes.status, sha(bytes.bytes)]).toEqual([200, first.sha256]);
    expect((await send(again, `/wonderfs/v1/projects/${PROJECT}/branches/main/tree`, { token: before.tokens['ghu-1'] })).status, 'the old sign-in is gone').toBe(401);
    // CONTROL (R2-r2, correctness MINOR-5): a store that ANSWERS every write 200 but keeps it elsewhere -- the client cannot tell, the
    // restart can: the assertion above would go red
    const kept = await world();
    const elsewhere = await world();
    const dropping = proxied(kept.store, {
      commit: (p, req, now, authority) => elsewhere.store.commit(p, req, now, authority),
      putBlob: (p, bytes, options) => elsewhere.store.putBlob(p, bytes, options),
    });
    const s3 = signIn(['ghu-1']);
    await seed(await boot(depsOf(dropping, s3.sessions)), s3.tokens['ghu-1'], elsewhere.store); // every write answered 200
    const s4 = signIn(['ghu-1']);
    const lostBase = await boot(depsOf((await world({ backing: kept.backing })).store, s4.sessions));
    const none = await send(lostBase, `/wonderfs/v1/projects/${PROJECT}/branches/main/tree`, { token: s4.tokens['ghu-1'] });
    expect([none.status, none.json.data.entries], 'the dropped writes are not there after the restart').toEqual([200, []]);
  });

  it('T-CRASH rows 2-4 at the store SEAM -- what the ROUTE answers (the rollback inside a transaction is proven on rows, wonderfs-write.real-postgres.test.ts): after the blob (an invisible orphan; the commit lands on retry), a store that dies before keeping the change (503; once on retry), after COMMIT before the answer (503; the retry after a NEW sign-in returns the ORIGINAL revision)', async () => {
    const w = await world();
    const s1 = signIn(['ghu-3']);
    const base1 = await boot(depsOf(w.store, s1.sessions));
    // ROW 2: after the blob, before the commit -- the bridge dies; the bytes are an orphan nobody can read by address
    const blob = await uploaded(base1, s1.tokens['ghu-3'], 'journaled bytes');
    const s2 = signIn(['ghu-3']);
    const base2 = await boot(depsOf((await world({ backing: w.backing })).store, s2.sessions));
    expect((await send(base2, `${BLOBS()}/${blob.sha256}`, { token: s2.tokens['ghu-3'] })).status, 'an orphan is invisible').toBe(404);
    // ROW 3: inside the commit -- the change dies before it is kept: 503, nothing applied
    const body = { requestId: rid('crash'), baseRev: 0, ops: [{ op: 'create', path: 'kept.txt', kind: 'file', ...blob }] };
    const dying = proxied(w.store, { commit: async () => { throw new Error('killed inside the commit'); } });
    const inside = await commit(await boot(depsOf(dying, s2.sessions)), s2.tokens['ghu-3'], body);
    expect([inside.status, inside.json.error.kind, await headRev(w.store)]).toEqual([503, 'wonderfs_unavailable', 0]);
    // ROW 4: after COMMIT, before the answer -- the change is kept, the answer is lost
    const afterCommit = proxied(w.store, {
      commit: async (p, req, now, authority) => {
        const kept = await w.store.commit(p, req, now, authority);
        expect(kept.ok && kept.value.status).toBe('committed');
        throw new Error('killed after COMMIT');
      },
    });
    const lostAnswer = await commit(await boot(depsOf(afterCommit, s2.sessions)), s2.tokens['ghu-3'], body);
    expect([lostAnswer.status, lostAnswer.json.error.kind, await headRev(w.store)]).toEqual([503, 'wonderfs_unavailable', 1]);
    const original = (await mainOf(w.store)).commits[0];
    // the journal replays after a NEW sign-in (a new session_ref): the ORIGINAL revision, applied once
    const s3 = signIn(['ghu-3']);
    expect(s3.refOf('ghu-3')).not.toBe(s2.refOf('ghu-3'));
    const base3 = await boot(depsOf((await world({ backing: w.backing })).store, s3.sessions));
    const retried = await commit(base3, s3.tokens['ghu-3'], body);
    expect([retried.status, retried.json.data]).toEqual([200, { schema: 'wonderfs.commit_result.v1', branchId: 'main', rev: 1, commitId: original.commitId, commitHash: original.commitHash, replay: true }]);
    expect([await headRev(w.store), (await mainOf(w.store)).commits[0].principal.sessionId], 'once; the record keeps the session that made it').toEqual([1, s2.refOf('ghu-3')]);
    expect((await send(base3, `${BLOBS()}/${blob.sha256}`, { token: s3.tokens['ghu-3'] })).status, 'named now').toBe(200);
    // CONTROLS: the replay path is real -- the same id with another change, or from another player, is refused
    const changed = await commit(base3, s3.tokens['ghu-3'], { ...body, ops: [{ op: 'create', path: 'other.txt', kind: 'file', ...blob }] });
    expect([changed.status, changed.json.error.kind]).toEqual([409, 'duplicate_idempotency_key']);
    const s4 = signIn(['ghu-1']);
    const owner = await commit(await boot(depsOf(w.store, s4.sessions)), s4.tokens['ghu-1'], body);
    expect([owner.status, owner.json.error.kind]).toEqual([409, 'duplicate_idempotency_key']);
  });
});

/* =========================================================================================================== body readers */

/** A hand-fed body: headers, and a stream the test writes. */
function source(headers: Record<string, string>): PassThrough & WonderfsBodySource {
  return Object.assign(new PassThrough(), { headers }) as PassThrough & WonderfsBodySource;
}

describe('WonderFS R2 body readers (wonderfs-body.ts): bounded, abort-safe, timeout-safe', () => {
  it('JSON: a declared size past the cap is refused before ANY byte is read; an undeclared body is refused the moment it passes the cap and nothing past it is taken', async () => {
    const declared = source({ 'content-type': 'application/json', 'content-length': '2000' });
    const early = await readWonderfsJson(declared, { maxBytes: 1000 });
    expect([early.ok, !early.ok && early.answer.status, declared.listenerCount('data')]).toEqual([false, 413, 0]);
    const flowing = source({ 'content-type': 'application/json; charset=utf-8' });
    const reading = readWonderfsJson(flowing, { maxBytes: 1000 });
    flowing.write(Buffer.alloc(600, 0x20));
    flowing.write(Buffer.alloc(600, 0x20));
    const over = await reading;
    expect([over.ok, !over.ok && over.answer.status, !over.ok && over.answer.headers.connection, flowing.listenerCount('data'), flowing.isPaused()]).toEqual([false, 413, 'close', 0, true]);
    // CONTROL: within the cap it parses
    const fine = source({ 'content-type': 'application/json' });
    const parsing = readWonderfsJson(fine, { maxBytes: 1000 });
    fine.end('{"a":[1,2]}');
    const parsed = await parsing;
    expect(parsed.ok && parsed.value).toEqual({ value: { a: [1, 2] }, size: 11 });
  });

  it('a body that ends early, a client gone (an error, a close, or already destroyed), and a stall each settle ONCE, with every listener removed', async () => {
    const short = source({ 'content-type': 'application/octet-stream', 'content-length': '10' });
    const s = readWonderfsOctets(short, 10, { maxBytes: 64 });
    short.end('12345');
    const ended = await s;
    expect([ended.ok, !ended.ok && ended.answer.status]).toEqual([false, 400]);
    const errored = source({ 'content-type': 'application/octet-stream' });
    const e = readWonderfsOctets(errored, 10, { maxBytes: 64 });
    errored.write('123');
    errored.destroy(new Error('ECONNRESET'));
    const gone = await e;
    expect([gone.ok, !gone.ok && gone.answer.status, errored.listenerCount('data'), errored.listenerCount('close')]).toEqual([false, 400, 0, 0]);
    const destroyed = source({ 'content-type': 'application/octet-stream' });
    destroyed.destroy();
    const already = await readWonderfsOctets(destroyed, 10, { maxBytes: 64 });
    expect([already.ok, !already.ok && already.answer.status]).toEqual([false, 400]);
    const stalled = source({ 'content-type': 'application/octet-stream' });
    const t = readWonderfsOctets(stalled, 10, { maxBytes: 64, idleMs: 20, deadlineMs: 5_000 });
    stalled.write('12');
    const slow = await t;
    expect([slow.ok, !slow.ok && slow.answer.status, stalled.listenerCount('data')]).toEqual([false, 408, 0]);
    const lying = source({ 'content-type': 'application/octet-stream' });
    const l = readWonderfsOctets(lying, 4, { maxBytes: 64 });
    lying.write('123456');
    const overrun = await l;
    expect([overrun.ok, !overrun.ok && overrun.answer.status]).toEqual([false, 400]);
    // CONTROL: the whole body, hashed while it arrived
    const whole = source({ 'content-type': 'application/octet-stream' });
    const w = readWonderfsOctets(whole, 10, { maxBytes: 64 });
    whole.write('12345');
    whole.end('67890');
    const done = await w;
    expect(done.ok && [Buffer.from(done.value.bytes).toString('utf8'), done.value.size, done.value.sha256]).toEqual(['1234567890', 10, sha('1234567890')]);
    expect(wonderfsUploadDeclared(source({ 'content-type': 'application/octet-stream', 'content-length': '65' }), 64).ok).toBe(false);
  });
});

/* =============================================================================================================== helpers */

describe('WonderFS R2 helpers', () => {
  it('wonderfsCommitBody takes exactly {requestId, baseRev, ops, resolvesConflictId}; wonderfsCommitNeeds names every action a commit does, with the paths it names', () => {
    expect(wonderfsCommitBody({ requestId: 'req-00000001', baseRev: 0, ops: [{ op: 'create', path: 'a', kind: 'dir' }] }, WFS_ALPHA_LIMITS).ok).toBe(true);
    expect(wonderfsCommitBody({ requestId: 'req-00000001', baseRev: 0, ops: [], resolvesConflictId: 'conflict_1' }, WFS_ALPHA_LIMITS).ok, 'keep theirs').toBe(true);
    for (const bad of [null, [], 'x', { requestId: 'r', baseRev: -1, ops: [] }, { requestId: 'r', baseRev: 0, ops: {} }, { requestId: 'r', baseRev: 0, ops: [], resolvesConflictId: 'a b' }, JSON.parse('{"requestId":"r","baseRev":0,"ops":[],"__proto__":{}}')]) {
      expect(wonderfsCommitBody(bad, WFS_ALPHA_LIMITS).ok, JSON.stringify(bad)).toBe(false);
    }
    const ops: WfsOp[] = [
      { op: 'create', path: 'a', kind: 'dir' },
      { op: 'update', fileId: 'f', expectContentVersion: 1, sha256: sha('x'), size: 1 },
      { op: 'move', fileId: 'f', expectPathVersion: 1, newPath: 'b' },
      { op: 'delete', fileId: 'f', expectContentVersion: 1 },
      { op: 'undelete', fileId: 'f', expectVersion: 1 },
    ];
    expect(wonderfsCommitNeeds(ops, 'conflict_1')).toEqual([
      { action: 'write', paths: ['a'] }, { action: 'move', paths: ['b'] }, { action: 'delete', paths: [] }, { action: 'resolve', paths: [] },
    ]);
    expect(wonderfsCommitNeeds([], 'conflict_1')).toEqual([{ action: 'resolve', paths: [] }]);
  });
});
