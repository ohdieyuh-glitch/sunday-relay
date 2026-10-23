import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { betaWaveZeroState } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';

/**
 * LOOKING FOR FEED on the real bridge, 127.0.0.1.
 *
 * A native social session is minted only by the desktop sign-in, and that
 * path needs a database. This file does not mint one and does not invent a
 * session back door. The handler's own post is AC-18 in
 * wonderland-lff-routes.test.ts.
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

  it('returns 400 for a malformed body and for an oversized body, and keeps answering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-lff-dir-'));
    roots.push(dir);
    const base = await boot({ ...ON, WONDERLAND_LFF_DIR: dir });
    const malformed = await call(base, 'POST', '/relay-api/wonderland/social/lff/posts', { body: '{' });
    expect(malformed).toEqual({
      status: 400,
      body: { ok: false, error: { code: 'invalid_body', message: 'request body is not valid JSON' } },
    });
    const oversized = await call(base, 'POST', '/relay-api/wonderland/social/lff/posts', { body: 'x'.repeat(64 * 1024 + 1) });
    expect(oversized.status).toBe(400);
    expect(oversized.body).toEqual({ ok: false, error: { code: 'body_too_large', message: 'request body is too large' } });
    const readable = await call(base, 'POST', '/relay-api/wonderland/social/lff/posts', { body: '{}' });
    expect(readable.status).toBe(401);
    const health = await realFetch(`${base}/health`);
    expect(health.status).toBe(200);
  });
});
