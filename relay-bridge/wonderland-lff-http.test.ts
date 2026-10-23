import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer, serveMountedLff } from './server';
import { loadBridgeConfig } from './config';
import { betaWaveZeroState } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';
import { createWonderlandLffFileStore } from '../src/relay/persistence/wonderland-lff-file-store';
import { WonderlandLffBoard } from '../src/relay/mission/wonderland/wonderland-lff';

/**
 * LOOKING FOR FEED on the real bridge, 127.0.0.1.
 *
 * A native social session is minted only by the desktop sign-in, and that
 * path needs a database. createBridgeServer does not expose the session
 * store, so this file cannot mint one. The oversized-body case reaches the
 * size check through serveMountedLff, the same function the bridge calls,
 * with a verifier that accepts one fixed token. The handler's own post is
 * AC-18 in wonderland-lff-routes.test.ts.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const realFetch = globalThis.fetch.bind(globalThis);
const servers: Array<{ close: (cb: () => void) => void }> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function boot(env: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-lff-http-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-0123456789abcdef');
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('JULIUS_DATABASE_URL', '');
  vi.stubEnv('WONDERLAND_LFF', '');
  vi.stubEnv('WONDERLAND_LFF_DIR', '');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const config = loadBridgeConfig(process.env);
  const server = createBridgeServer(
    config,
    { start: () => ({ state: 'ready' }) as never, get: () => ({ state: 'ready', missionId: 'm' }) as never, cancel: () => undefined, retry: () => undefined } as never,
    null, null, null, null,
    () => false,
    createBetaEnrolmentStore({ root }),
    [{ wave: 'wave_0', state: betaWaveZeroState(process.env), seats: 100 }],
  );
  servers.push(server as never);
  return new Promise((resolve) => {
    (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', () => {
      const address = (server as never as { address: () => { port: number } | null }).address();
      resolve(`http://127.0.0.1:${address === null ? 0 : address.port}`);
    });
  });
}

async function call(base: string, method: string, path: string, opts: { body?: string; origin?: string; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.token !== undefined) headers.authorization = `Relay-Session ${opts.token}`;
  const response = await realFetch(`${base}${path}`, { method, headers, body: opts.body });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* leave the text */ }
  return { status: response.status, body };
}

const ON = {
  WONDERLAND_LFF: '1',
  WONDERLAND_SOCIAL_ENABLED: '1',
};

describe('Looking for Feed on the bridge', () => {
  it('answers 503 when WONDERLAND_LFF is off, even if social is on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ WONDERLAND_SOCIAL_ENABLED: '1', WONDERLAND_LFF_DIR: dir });
    const got = await call(base, 'GET', '/relay-api/wonderland/social/lff/posts');
    expect(got).toEqual({
      status: 503,
      body: { error: { kind: 'lff_unavailable', message: 'Looking for Feed is not enabled on this server.' } },
    });
  });

  it('fails closed when the flag is on and WONDERLAND_LFF_DIR is empty', async () => {
    const base = await boot({ WONDERLAND_LFF: '1', WONDERLAND_SOCIAL_ENABLED: '1', WONDERLAND_LFF_DIR: '   ' });
    const got = await call(base, 'GET', '/relay-api/wonderland/social/lff/posts');
    expect(got.status).toBe(503);
    expect(got.body).toEqual({
      error: { kind: 'lff_unavailable', message: 'Looking for Feed storage is not configured. Set WONDERLAND_LFF_DIR.' },
    });
  });

  it('answers 403 when an Origin header is present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const got = await call(base, 'GET', '/relay-api/wonderland/social/lff/posts', { origin: ORIGIN });
    expect(got).toEqual({
      status: 403,
      body: { error: { code: 'desktop_only', message: 'Wonderland social is reached from the Wonderland desktop client.' } },
    });
  });

  it('answers 401 when no native social session is presented', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const got = await call(base, 'GET', '/relay-api/wonderland/social/lff/posts');
    expect(got).toEqual({
      status: 401,
      body: { error: { code: 'session_required', message: 'Sign in to Wonderland to use social.' } },
    });
  });

  it('does not treat /wonderland/social/lffx as a Looking for Feed path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const beside = await call(base, 'GET', '/relay-api/wonderland/social/lffx');
    const feed = await call(base, 'GET', '/relay-api/wonderland/social/lff/posts');
    expect(beside).toEqual({
      status: 401,
      body: { error: { kind: 'session_required', message: 'Sign in to Wonderland to use social.' } },
    });
    expect(feed.body).toEqual({ error: { code: 'session_required', message: 'Sign in to Wonderland to use social.' } });
  });

  it('answers 401 from the LFF block when the path has a query and no session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const got = await call(base, 'GET', '/relay-api/wonderland/social/lff?limit=5');
    expect(got).toEqual({
      status: 401,
      body: { error: { code: 'session_required', message: 'Sign in to Wonderland to use social.' } },
    });
    const beside = await call(base, 'GET', '/relay-api/wonderland/social/lffx?limit=5');
    expect(beside).toEqual({
      status: 401,
      body: { error: { kind: 'session_required', message: 'Sign in to Wonderland to use social.' } },
    });
  });

  it('keeps the LFF 503 and 403 when the path has a query', async () => {
    const off = await boot({ WONDERLAND_SOCIAL_ENABLED: '1' });
    const disabled = await call(off, 'GET', '/relay-api/wonderland/social/lff/posts?limit=5');
    expect(disabled).toEqual({
      status: 503,
      body: { error: { kind: 'lff_unavailable', message: 'Looking for Feed is not enabled on this server.' } },
    });
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const on = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const desktop = await call(on, 'GET', '/relay-api/wonderland/social/lff/posts?limit=5', { origin: ORIGIN });
    expect(desktop).toEqual({
      status: 403,
      body: { error: { code: 'desktop_only', message: 'Wonderland social is reached from the Wonderland desktop client.' } },
    });
  });

  it('answers 401 for bad JSON when no session is presented', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const malformed = await call(base, 'POST', '/relay-api/wonderland/social/lff/posts', { body: '{' });
    expect(malformed).toEqual({
      status: 401,
      body: { error: { code: 'session_required', message: 'Sign in to Wonderland to use social.' } },
    });
    const health = await realFetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it('closes the socket after 400 body_too_large when the session hop accepts the caller', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const board = new WonderlandLffBoard(
      () => 'lff_stub',
      createWonderlandLffFileStore({ root: dir }),
    );
    const server = createServer((req, res) => {
      void serveMountedLff({
        req,
        res,
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        origin: undefined,
        cors: {},
        lffEnabled: true,
        socialEnabled: true,
        board,
        verifySession: (token) => (token === 'lff-test-session' ? { participantId: 'ada' } : null),
      });
    });
    servers.push(server);
    const base = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = address !== null && typeof address === 'object' ? address.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    const oversized = await postBytes(base, '/relay-api/wonderland/social/lff/posts', Buffer.alloc(1024 * 1024, 0x78), {
      authorization: 'Relay-Session lff-test-session',
      'content-type': 'application/json',
    });
    expect(oversized.status).toBe(400);
    expect(oversized.body).toEqual({ ok: false, error: { code: 'body_too_large', message: 'request body is too large' } });
    expect(oversized.connection).toBe('close');
    expect(oversized.socketClosed).toBe(true);
    const again = await call(base, 'GET', '/relay-api/wonderland/social/lff/posts?limit=5', { token: 'lff-test-session' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true });
  });
});

function postBytes(
  base: string,
  path: string,
  body: Buffer,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown; connection: string | undefined; socketClosed: boolean }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path,
      method: 'POST',
      headers: { ...headers, 'content-length': String(body.length) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* leave the text */ }
        const socket = res.socket;
        const done = (socketClosed: boolean) => resolve({
          status: res.statusCode ?? 0,
          body: parsed,
          connection: typeof res.headers.connection === 'string' ? res.headers.connection : undefined,
          socketClosed,
        });
        if (socket === null || socket.destroyed) {
          done(true);
          return;
        }
        const timer = setTimeout(() => done(socket.destroyed), 1000);
        socket.once('close', () => {
          clearTimeout(timer);
          done(true);
        });
      });
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        return;
      }
      reject(err);
    });
    req.end(body);
  });
}
