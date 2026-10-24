import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { NATIVE_WORLD_AUDIENCE, type BrowserSessionStore } from './browser-session/grants';
import { loadBridgeConfig } from './config';
import { createBridgeServer } from './server';

/**
 * The server builds its own session store. This test keeps that store so it
 * can redeem a real native session into it. Pairing over HTTP needs the Julius
 * database, which this proof does not.
 */
const holder = vi.hoisted(() => ({ store: null as BrowserSessionStore | null }));

vi.mock('./browser-session/grants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browser-session/grants')>();
  return {
    ...actual,
    createBrowserSessionStore() {
      const store = actual.createBrowserSessionStore();
      holder.store = store;
      return store;
    },
  };
});

const PROJECT = 'project-1';
const FOUNDER = 'founder';
const LOG = 'ab'.repeat(32);
const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';

const FORWARDING_HEADERS = [
  ['x-forwarded-for', '203.0.113.4'],
  ['x-forwarded-host', 'proxy.example'],
  ['forwarded', 'for=203.0.113.4;host=proxy.example'],
  ['x-real-ip', '203.0.113.4'],
] as const;

function nativeToken(playerId: string, projectId: string): string {
  const store = holder.store;
  if (store === null) throw new Error('the server has no session store');
  const now = Date.now();
  const grant = store.createGrant({
    origin: NATIVE_WORLD_AUDIENCE,
    now,
    scope: 'native_world',
    participantId: playerId,
    projectId,
  });
  const redeemed = store.consumeGrant({
    grantId: grant.grantId,
    secret: grant.secret,
    origin: NATIVE_WORLD_AUDIENCE,
    now,
  });
  if (!redeemed.ok) throw new Error('native session was not redeemed');
  return redeemed.session.token;
}

async function post(
  base: string,
  path: string,
  token: string,
  over: { runId?: string; key?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: { data?: { state?: string; dispatched?: boolean; serverRunId?: string; replayed?: boolean }; error?: { kind?: string } | string } }> {
  const response = await fetch(`${base}/relay-api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Relay-Session ${token}`,
      'x-relay-idempotency-key': over.key ?? KEY,
      ...over.headers,
    },
    body: JSON.stringify({
      runId: over.runId ?? RUN,
      clientTriggerId: 'trigger_01',
      clientLogSha256: LOG,
      clientUiActionUtc: '2026-10-23T16:15:00.000Z',
    }),
  });
  return { status: response.status, body: await response.json() as { data?: { state?: string; dispatched?: boolean; serverRunId?: string; replayed?: boolean }; error?: { kind?: string } | string } };
}

async function stop(running: Server): Promise<void> {
  running.closeAllConnections?.();
  await new Promise<void>((resolve) => running.close(() => resolve()));
}

describe('admission through createBridgeServer', () => {
  let base = '';
  let port = 0;
  let server: Server | null = null;
  let founderToken = '';
  let otherToken = '';
  let storePath = '';
  let storeDir = '';

  beforeAll(async () => {
    storeDir = mkdtempSync(join(tmpdir(), 'wonderland-admission-server-'));
    storePath = join(storeDir, 'admission.json');
    vi.stubEnv('JULIUS_WONDERLAND_ADMISSION', '1');
    vi.stubEnv('JULIUS_J1_FOUNDER_PLAYER_ID', FOUNDER);
    vi.stubEnv('JULIUS_J1_PROJECT_ID', PROJECT);
    vi.stubEnv('JULIUS_WONDERLAND_MISSION', 'julius-inworld-data-1');
    vi.stubEnv('JULIUS_J1_DAILY_CAP', '20');
    vi.stubEnv('JULIUS_WONDERLAND_ADMISSION_STORE', storePath);
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-only');
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', 'https://sunday-relay.vercel.app');
    server = createBridgeServer(loadBridgeConfig(process.env), {
      start: () => ({}) as never,
      get: () => undefined,
      cancel: () => undefined,
      retry: () => undefined,
    } as never);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
    founderToken = nativeToken(FOUNDER, PROJECT);
    otherToken = nativeToken('other-player', PROJECT);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    const running = server;
    if (running === null) {
      if (storeDir !== '') rmSync(storeDir, { recursive: true, force: true });
      throw new Error('admission server was not started');
    }
    await stop(running);
    if (storeDir !== '') rmSync(storeDir, { recursive: true, force: true });
  });

  it('POST /wonderland/julius/dispatch?projectId= admits on the real server', async () => {
    const result = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, founderToken);
    expect(result.status).toBe(202);
    expect(result.body.data?.state).toBe('ADMISSION_HELD');
    expect(result.body.data?.dispatched).toBe(false);
    expect(result.body.error).toBeUndefined();
  });

  it('a wrong projectId is julius_dispatch_wrong_project from admission', async () => {
    const result = await post(base, '/wonderland/julius/dispatch?projectId=other-project', founderToken, {
      runId: 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      key: '99999999-8888-4777-a666-555555555555',
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toEqual({
      kind: 'julius_dispatch_wrong_project',
      message: 'This session was not paired for that project.',
    });
  });

  it('a non-founder native session is founder_only', async () => {
    const result = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, otherToken, {
      runId: 'wlj_bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      key: '22222222-3333-4444-8555-666666666666',
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toMatchObject({ kind: 'julius_dispatch_founder_only' });
  });

  it('each forwarding header is not_loopback', async () => {
    for (const [index, [name, value]] of FORWARDING_HEADERS.entries()) {
      const result = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, founderToken, {
        runId: `wlj_ccccccc${index}-dddd-4eee-8fff-aaaaaaaaaaaa`,
        key: `3333333${index}-4444-4555-8666-777777777777`,
        headers: { [name]: value },
      });
      expect(result.status, name).toBe(403);
      expect(result.body.error, name).toMatchObject({ kind: 'julius_dispatch_not_loopback' });
    }
  });

  it('a trailing slash, a different case, and a child path stay on the catch-all', async () => {
    const paths = [
      `/wonderland/julius/dispatch/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Dispatch?projectId=${PROJECT}`,
      `/wonderland/julius/dispatch/x?projectId=${PROJECT}`,
    ];
    for (const path of paths) {
      const result = await post(base, path, founderToken, {
        key: '44444444-5555-4666-8777-888888888888',
      });
      expect(result.status, path).toBe(403);
      expect(result.body, path).toEqual({ error: 'a native Wonderland session reaches only the Julius world stream' });
    }
  });

  function storeBytes(): string {
    return readFileSync(storePath, 'utf8');
  }

  function httpExchange(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, body: text === '' ? null : JSON.parse(text) as unknown });
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  it('GET status on 127.0.0.1 reads the held file and each guard leaves it unchanged', async () => {
    const admitted = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, founderToken, {
      runId: 'wlj_dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb',
      key: '55555555-6666-4777-8888-999999999999',
    });
    expect(admitted.status).toBe(202);
    const serverRunId = (admitted.body.data as { serverRunId?: string } | undefined)?.serverRunId ?? '';
    expect(serverRunId).toMatch(/^run:[0-9a-f]{24}$/);
    const held = storeBytes();
    const heldDocument = JSON.parse(held) as { schemaVersion?: number };
    expect(heldDocument.schemaVersion).toBe(2);
    expect(heldDocument).not.toHaveProperty('claims');

    const statusPath = `/relay-api/wonderland/julius/status?projectId=${PROJECT}&runId=${encodeURIComponent(serverRunId)}`;
    const ok = await httpExchange('GET', statusPath, {
      host: `127.0.0.1:${port}`,
      authorization: `Relay-Session ${founderToken}`,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      wljRunId: 'wlj_dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb',
      serverRunId,
      state: 'held',
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(ok.body)).not.toMatch(/gh|operator-claim|child_process|api_key|token/i);
    expect(storeBytes()).toBe(held);

    const notFound = { error: { kind: 'not_found', message: 'Not found.' } };
    const mutations: Array<{ name: string; status: number; body: unknown; run: () => Promise<{ status: number; body: unknown }> }> = [
      {
        name: 'x-forwarded-for',
        status: 403,
        body: { error: { kind: 'julius_dispatch_not_loopback', message: 'Mission dispatch is only served to the same machine.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
          'x-forwarded-for': '203.0.113.4',
        }),
      },
      {
        name: 'x-forwarded-host',
        status: 403,
        body: { error: { kind: 'julius_dispatch_not_loopback', message: 'Mission dispatch is only served to the same machine.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
          'x-forwarded-host': 'proxy.example',
        }),
      },
      {
        name: 'forwarded',
        status: 403,
        body: { error: { kind: 'julius_dispatch_not_loopback', message: 'Mission dispatch is only served to the same machine.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
          forwarded: 'for=203.0.113.4;host=proxy.example',
        }),
      },
      {
        name: 'x-real-ip',
        status: 403,
        body: { error: { kind: 'julius_dispatch_not_loopback', message: 'Mission dispatch is only served to the same machine.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
          'x-real-ip': '203.0.113.4',
        }),
      },
      {
        name: 'host',
        status: 403,
        body: { error: { kind: 'julius_dispatch_not_loopback', message: 'Mission dispatch is only served to the same machine.' } },
        run: () => httpExchange('GET', statusPath, {
          host: 'example.com',
          authorization: `Relay-Session ${founderToken}`,
        }),
      },
      {
        name: 'missing session',
        status: 401,
        body: { error: { kind: 'sign_in_required', message: 'Mission dispatch needs a paired Wonderland session.' } },
        run: () => httpExchange('GET', statusPath, { host: `127.0.0.1:${port}` }),
      },
      {
        name: 'operator credential',
        status: 403,
        body: { error: { kind: 'julius_dispatch_operator_is_not_the_game', message: 'The in-game trigger must come from the paired game client.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: 'Bearer operator-token-for-tests-only',
        }),
      },
      {
        name: 'browser origin',
        status: 403,
        body: { error: { kind: 'julius_dispatch_browser_refused', message: 'Only the paired game client may use this route.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
          origin: 'https://sunday-relay.vercel.app',
        }),
      },
      {
        name: 'wrong project',
        status: 403,
        body: { error: { kind: 'julius_dispatch_wrong_project', message: 'This session was not paired for that project.' } },
        run: () => httpExchange('GET', `/relay-api/wonderland/julius/status?projectId=other-project&runId=${encodeURIComponent(serverRunId)}`, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
        }),
      },
      {
        name: 'non-founder',
        status: 403,
        body: { error: { kind: 'julius_dispatch_founder_only', message: 'Only the founder player may admit a Wonderland mission.' } },
        run: () => httpExchange('GET', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${otherToken}`,
        }),
      },
      {
        name: 'POST',
        status: 405,
        body: { error: { kind: 'method_not_allowed', message: 'Status is a GET.' } },
        run: () => httpExchange('POST', statusPath, {
          host: `127.0.0.1:${port}`,
          authorization: `Relay-Session ${founderToken}`,
          'content-type': 'application/json',
        }, '{}'),
      },
    ];

    for (const mutation of mutations) {
      const result = await mutation.run();
      expect(result.status, mutation.name).toBe(mutation.status);
      expect(result.body, mutation.name).toEqual(mutation.body);
      expect(storeBytes(), mutation.name).toBe(held);
    }

    const malformed = await httpExchange('GET', `/relay-api/wonderland/julius/status?projectId=${PROJECT}&runId=nope`, {
      host: `127.0.0.1:${port}`,
      authorization: `Relay-Session ${founderToken}`,
    });
    const unknown = await httpExchange('GET', `/relay-api/wonderland/julius/status?projectId=${PROJECT}&runId=${encodeURIComponent(`run:${'c'.repeat(24)}`)}`, {
      host: `127.0.0.1:${port}`,
      authorization: `Relay-Session ${founderToken}`,
    });
    const journalPath = `${storePath}.operator.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { owners: Record<string, string>; progress: unknown[] };
    journal.owners[serverRunId] = 'other-player';
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
    const foreign = readFileSync(journalPath, 'utf8');
    const otherOwner = await httpExchange('GET', statusPath, {
      host: `127.0.0.1:${port}`,
      authorization: `Relay-Session ${founderToken}`,
    });
    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(otherOwner.status).toBe(404);
    expect(malformed.body).toEqual(notFound);
    expect(unknown.body).toEqual(notFound);
    expect(otherOwner.body).toEqual(notFound);
    expect(storeBytes()).toBe(held);
    expect(readFileSync(journalPath, 'utf8')).toBe(foreign);

    const progressedJournal = JSON.parse(foreign) as { owners: Record<string, string>; progress: unknown[] };
    progressedJournal.owners[serverRunId] = FOUNDER;
    progressedJournal.progress = [{
      serverRunId,
      state: 'providers_running',
      cause: 'watch',
      updatedAt: '2026-10-23T18:00:00.000Z',
    }];
    writeFileSync(journalPath, `${JSON.stringify(progressedJournal)}\n`);
    const progressed = readFileSync(journalPath, 'utf8');
    const running = await httpExchange('GET', statusPath, {
      host: `127.0.0.1:${port}`,
      authorization: `Relay-Session ${founderToken}`,
    });
    expect(running.status).toBe(200);
    expect(running.body).toEqual({
      wljRunId: 'wlj_dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb',
      serverRunId,
      state: 'unknown',
      updatedAt: '2026-10-23T18:00:00.000Z',
    });
    expect(running.body).not.toHaveProperty('cause');
    expect(JSON.stringify(running.body)).not.toContain('providers_running');
    expect(JSON.stringify(running.body)).not.toContain('watch');
    expect(storeBytes()).toBe(held);
    expect(readFileSync(journalPath, 'utf8')).toBe(progressed);
    expect(JSON.parse(storeBytes())).not.toHaveProperty('claims');
  });

  it('a status slash, a different case, and a child path stay on the catch-all', async () => {
    const before = storeBytes();
    const paths = [
      `/wonderland/julius/status/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Status?projectId=${PROJECT}`,
      `/wonderland/julius/status/x?projectId=${PROJECT}`,
    ];
    for (const path of paths) {
      const result = await httpExchange('GET', `/relay-api${path}`, {
        host: `127.0.0.1:${port}`,
        authorization: `Relay-Session ${founderToken}`,
      });
      expect(result.status, path).toBe(403);
      expect(result.body, path).toEqual({ error: 'a native Wonderland session reaches only the Julius world stream' });
      expect(storeBytes(), path).toBe(before);
    }
  });
});

describe('admission restarts on the same store file', () => {
  it('replays the same serverRunId and state, and the cap still holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wonderland-admission-restart-'));
    const file = join(dir, 'admission.json');
    vi.stubEnv('JULIUS_WONDERLAND_ADMISSION_STORE', file);
    vi.stubEnv('JULIUS_WONDERLAND_ADMISSION', '1');
    vi.stubEnv('JULIUS_J1_FOUNDER_PLAYER_ID', FOUNDER);
    vi.stubEnv('JULIUS_J1_PROJECT_ID', PROJECT);
    vi.stubEnv('JULIUS_WONDERLAND_MISSION', 'julius-inworld-data-1');
    vi.stubEnv('JULIUS_J1_DAILY_CAP', '1');
    vi.stubEnv('JULIUS_J1_MAX_RUNS_PER_MISSION', '1');
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-only');
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', 'https://sunday-relay.vercel.app');
    const registry = {
      start: () => ({}) as never,
      get: () => undefined,
      cancel: () => undefined,
      retry: () => undefined,
    } as never;
    let first: Server | null = null;
    let second: Server | null = null;
    try {
      first = createBridgeServer(loadBridgeConfig(process.env), registry);
      await new Promise<void>((resolve) => first?.listen(0, '127.0.0.1', () => resolve()));
      const firstAddress = first.address();
      const firstPort = typeof firstAddress === 'object' && firstAddress !== null ? firstAddress.port : 0;
      const firstBase = `http://127.0.0.1:${firstPort}`;
      const admitted = await post(firstBase, `/wonderland/julius/dispatch?projectId=${PROJECT}`, nativeToken(FOUNDER, PROJECT));
      expect(admitted.status).toBe(202);
      const serverRunId = admitted.body.data?.serverRunId;
      expect(serverRunId).toMatch(/^run:[0-9a-f]{24}$/);
      expect(admitted.body.data?.state).toBe('ADMISSION_HELD');
      const written = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; rows: { serverRunId: string }[] };
      expect(written.schemaVersion).toBe(2);
      expect(written.rows.map((row) => row.serverRunId)).toEqual([serverRunId]);
      await stop(first);
      first = null;

      second = createBridgeServer(loadBridgeConfig(process.env), registry);
      await new Promise<void>((resolve) => second?.listen(0, '127.0.0.1', () => resolve()));
      const secondAddress = second.address();
      const secondPort = typeof secondAddress === 'object' && secondAddress !== null ? secondAddress.port : 0;
      const replay = await post(
        `http://127.0.0.1:${secondPort}`,
        `/wonderland/julius/dispatch?projectId=${PROJECT}`,
        nativeToken(FOUNDER, PROJECT),
      );
      expect(replay.status).toBe(200);
      expect(replay.body.data?.serverRunId).toBe(serverRunId);
      expect(replay.body.data?.state).toBe('ADMISSION_HELD');
      expect(replay.body.data?.replayed).toBe(true);
      expect(replay.body.data?.dispatched).toBe(false);
      const still = JSON.parse(readFileSync(file, 'utf8')) as { rows: unknown[] };
      expect(still.rows).toHaveLength(1);
      const capped = await post(
        `http://127.0.0.1:${secondPort}`,
        `/wonderland/julius/dispatch?projectId=${PROJECT}`,
        nativeToken(FOUNDER, PROJECT),
        {
          runId: 'wlj_dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb',
          key: '55555555-6666-4777-8888-999999999999',
        },
      );
      expect(capped.status).toBe(429);
      expect(capped.body.error).toMatchObject({ kind: 'julius_dispatch_cap_reached' });
      const afterCap = JSON.parse(readFileSync(file, 'utf8')) as { rows: unknown[] };
      expect(afterCap.rows).toHaveLength(1);
    } finally {
      if (first !== null) await stop(first);
      if (second !== null) await stop(second);
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
