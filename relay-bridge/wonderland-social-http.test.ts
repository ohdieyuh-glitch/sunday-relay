import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { betaWaveZeroState } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';

/**
 * WONDERLAND SOCIAL AND THE DESKTOP SIGN-IN, over the REAL bridge HTTP surface (R16): what each request reaches.
 *
 * The bridge dispatches by prefix, and two families claim more than their own: native pairing answers 404 for every
 * `/wonderland/native/` path it does not serve, and the Wonderland family claims every `/wonderland/` path. So these tests
 * prove the ORDER: each answer below carries the error SHAPE only its own handler gives. No database here: the full
 * sign-in through a durable store is the real-PostgreSQL suite's (wonderland-social-r16.real-postgres.test.ts).
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const realFetch = globalThis.fetch.bind(globalThis);
const servers: Array<{ close: (cb: () => void) => void }> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** GitHub's device flow, approved on the first poll; localhost passes through to the test server. */
function stubGitHubDeviceFlow(): void {
  vi.stubGlobal('fetch', (async (url: string, init?: unknown) => {
    const u = String(url);
    if (u === 'https://github.com/login/device/code') {
      return { ok: true, status: 200, json: async () => ({ device_code: 'd'.repeat(40), user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }) };
    }
    if (u === 'https://github.com/login/oauth/access_token') {
      return { ok: true, status: 200, json: async () => ({ access_token: `ghu_${'x'.repeat(10)}`, token_type: 'bearer' }) };
    }
    if (u === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ login: 'stub-alpha', id: 9001, type: 'User' }) };
    return realFetch(url as never, init as never);
  }) as never);
}

function build(env: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'relay-social-http-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-0123456789abcdef');
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  // no database in this file, whatever the shell carries
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('JULIUS_DATABASE_URL', '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const config = loadBridgeConfig(process.env);
  return () => createBridgeServer(
    config,
    { start: () => ({ state: 'ready' }) as never, get: () => ({ state: 'ready', missionId: 'm' }) as never, cancel: () => undefined, retry: () => undefined } as never,
    null, null, null, null,
    () => false,
    createBetaEnrolmentStore({ root }),
    [{ wave: 'wave_0', state: betaWaveZeroState(process.env), seats: 100 }],
  );
}

async function boot(env: Record<string, string>): Promise<string> {
  const server = build(env)();
  servers.push(server as never);
  await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

async function call(base: string, method: string, path: string, opts: { body?: unknown; token?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token !== undefined) headers.authorization = `Relay-Session ${opts.token}`;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  const response = await realFetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: response.status, body: (await response.json()) as any };
}

describe('social and the desktop sign-in: OFF by default', () => {
  it('both answer 503 by their own name -- not native pairing\'s 404, not the Wonderland family\'s 401', async () => {
    const base = await boot({ RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public' });
    expect(await call(base, 'POST', '/relay-api/wonderland/native/signin/start', { body: {} })).toEqual({
      status: 503, body: { error: { kind: 'signin_unavailable', message: expect.any(String) } },
    });
    expect(await call(base, 'GET', '/relay-api/wonderland/social/snapshot', { token: 'whatever' })).toEqual({
      status: 503, body: { error: { kind: 'social_unavailable', message: 'Social is not available on this server.' } },
    });
  });
});

describe('social and the desktop sign-in: ON', () => {
  const ON = { WONDERLAND_SOCIAL_ENABLED: '1', RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public' };

  it('without a database (so without the social schema) sign-in answers 503 by its own name -- GitHub is never asked, nothing is minted', async () => {
    // ef7e96bb's schema gate (socialReady): a bridge whose store cannot open answers before the device flow begins. This case
    // used to expect a started sign-in (200) here and was left red by that commit.
    stubGitHubDeviceFlow();
    const asked: string[] = [];
    const stubbed = globalThis.fetch;
    vi.stubGlobal('fetch', (async (url: string, init?: unknown) => {
      if (String(url).startsWith('https://github.com') || String(url).startsWith('https://api.github.com')) asked.push(String(url));
      return (stubbed as never as (u: string, i?: unknown) => Promise<unknown>)(url, init);
    }) as never);
    const base = await boot(ON);
    const started = await call(base, 'POST', '/relay-api/wonderland/native/signin/start', { body: {} });
    expect(started).toEqual({ status: 503, body: { error: { kind: 'signin_unavailable', message: expect.any(String) } } });
    const polled = await call(base, 'POST', '/relay-api/wonderland/native/signin/poll', { body: { handle: 'h'.repeat(43) } });
    expect(polled.status).toBe(503);
    expect(polled.body.error.kind).toBe('signin_unavailable');
    expect(JSON.stringify(polled.body)).not.toContain('token');
    expect(asked).toEqual([]);
  });

  it('refuses a web page at the sign-in and at social', async () => {
    const base = await boot(ON);
    expect((await call(base, 'POST', '/relay-api/wonderland/native/signin/start', { body: {}, origin: ORIGIN })).body.error.kind).toBe('native_client_only');
    expect((await call(base, 'GET', '/relay-api/wonderland/social/snapshot', { token: 't', origin: ORIGIN })).body.error.kind).toBe('desktop_only');
  });

  it('social answers by its own gate, with the query string kept: an unknown session is 401 session_required', async () => {
    const base = await boot(ON);
    const r = await call(base, 'GET', '/relay-api/wonderland/social/events?after=7', { token: 'not-a-session' });
    expect(r).toEqual({ status: 401, body: { error: { kind: 'session_required', message: 'Sign in to Wonderland to use social.' } } });
  });

  it('native pairing still owns its own paths', async () => {
    const base = await boot(ON);
    const r = await call(base, 'POST', '/relay-api/wonderland/native/session', { body: { code: 'nope' } });
    expect(r.status).toBe(401);
    expect(r.body.error.kind).toBe('pairing_failed');
  });
});

describe('the test instruments refuse production', () => {
  it('the delivery tap refuses to start under NODE_ENV=production', () => {
    const make = build({ WONDERLAND_SOCIAL_ENABLED: '1', WONDERLAND_SOCIAL_TAP: join(tmpdir(), 'tap.jsonl'), NODE_ENV: 'production' });
    expect(make).toThrow(/WONDERLAND_SOCIAL_TAP/);
  });

  it('the GitHub stub refuses to start under NODE_ENV=production, and without the throwaway database', () => {
    expect(build({ WONDERLAND_SOCIAL_GITHUB_STUB: 'http://127.0.0.1:8899', NODE_ENV: 'production' })).toThrow(/production/);
    expect(build({ WONDERLAND_SOCIAL_GITHUB_STUB: 'http://127.0.0.1:8899', NODE_ENV: 'test' })).toThrow(/throwaway/);
  });
});

describe('every social answer is never stored on the way (the bridge passes the route\'s headers on)', () => {
  it('a refusal over real HTTP carries Cache-Control: no-store and Pragma: no-cache -- the EOS client config path and any other', async () => {
    const base = await boot({ WONDERLAND_SOCIAL_ENABLED: '1', RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public' });
    for (const path of ['/relay-api/wonderland/social/voice/eos-client-config', '/relay-api/wonderland/social/snapshot']) {
      const response = await realFetch(`${base}${path}`, { headers: { authorization: 'Relay-Session not-a-session' } });
      expect(response.status, path).toBe(401);
      expect(response.headers.get('cache-control'), path).toBe('no-store');
      expect(response.headers.get('pragma'), path).toBe('no-cache');
      expect(response.headers.get('etag'), path).toBeNull();
    }
  });
});

describe("the GAME client's EOS config at the bridge (founder 10-04): read once at start, never printed", () => {
  const ON = { WONDERLAND_SOCIAL_ENABLED: '1', RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public' };
  const capture = () => {
    const printed: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
        printed.push(a.map(String).join(' '));
      });
    }
    return printed;
  };
  const fileWith = (lines: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-eos-game-'));
    roots.push(dir);
    const file = join(dir, 'eos-game.env');
    writeFileSync(file, `${lines.join('\r\n')}\r\n`);
    return { dir, file };
  };

  it('the start line says only "loaded (5 keys)"; the route is gated like every social route; no value or path is printed or answered', async () => {
    const v = { id: `p${randomBytes(8).toString('hex')}`, client: `c${randomBytes(8).toString('hex')}`, secret: `planted-${randomBytes(16).toString('hex')}` };
    const { dir, file } = fileWith([`EOS_PRODUCT_ID=${v.id}`, `EOS_SANDBOX_ID=${v.id}`, `EOS_DEPLOYMENT_ID=${v.id}`, `EOS_GAME_CLIENT_ID=${v.client}`, `EOS_GAME_CLIENT_SECRET=${v.secret}`]);
    const printed = capture();
    const base = await boot({ ...ON, WONDERLAND_EOS_GAME_CONFIG: file });
    const route = '/relay-api/wonderland/social/voice/eos-client-config';
    const answers = [await call(base, 'GET', route), await call(base, 'GET', route, { token: 'not-a-session' }), await call(base, 'GET', route, { token: 't', origin: ORIGIN })];
    vi.restoreAllMocks();
    expect(answers.map((a) => [a.status, a.body.error?.kind])).toEqual([[401, 'session_required'], [401, 'session_required'], [403, 'desktop_only']]);
    expect(printed.filter((l) => l.includes('eos game config'))).toEqual(['[relay-bridge] eos game config: loaded (5 keys)']);
    for (const line of [...printed, ...answers.map((a) => JSON.stringify(a))]) {
      for (const value of Object.values(v)) expect(line).not.toContain(value);
      expect(line).not.toContain(dir);
    }
  });

  it("a file holding only the Trusted Server's pair is refused at start, by key name, and nothing of it is printed", async () => {
    const id = `p${randomBytes(8).toString('hex')}`;
    const secret = `planted-${randomBytes(16).toString('hex')}`;
    const { dir, file } = fileWith([`EOS_PRODUCT_ID=${id}`, `EOS_SANDBOX_ID=${id}`, `EOS_DEPLOYMENT_ID=${id}`, `EOS_SERVER_CLIENT_ID=${id}`, `EOS_SERVER_CLIENT_SECRET=${secret}`]);
    const printed = capture();
    await boot({ ...ON, WONDERLAND_EOS_GAME_CONFIG: file });
    vi.restoreAllMocks();
    expect(printed.filter((l) => l.includes('eos game config'))).toEqual([
      '[relay-bridge] eos game config: the EOS game config file is missing EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET -- the client config route answers 503',
    ]);
    for (const line of printed) {
      expect(line).not.toContain(secret);
      expect(line).not.toContain(id);
      expect(line).not.toContain(dir);
    }
  });
});
