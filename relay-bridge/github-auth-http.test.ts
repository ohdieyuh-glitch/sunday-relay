import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { betaWaveZeroState } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';

/**
 * SIGN IN WITH GITHUB, over the REAL bridge HTTP surface.
 *
 * This is the product-boundary proof for criterion 1: a fresh user, with no
 * operator token, drives `GET /auth/github/start` -> GitHub -> `GET
 * /auth/github/callback` and comes out holding a session that authorizes a real
 * authenticated call. GitHub is mocked at the `fetch` seam (the real
 * `exchangeCodeForUser` runs); everything else is the actual server.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const CALLBACK = 'https://bridge.example/relay-api/auth/github/callback';
const OPERATOR = 'operator-secret-for-tests-0123456789abcdef';

const realFetch = globalThis.fetch.bind(globalThis);
const servers: Array<{ close: (cb: () => void) => void }> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A GitHub that hands back a fixed identity, and passes localhost through to the
    real test server so the test's own requests still work. */
function stubGitHub(identity: { login: string; id: number }): void {
  vi.stubGlobal('fetch', (async (url: string, init?: unknown) => {
    const u = String(url);
    if (u.includes('/login/oauth/access_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ghu_mock_user_token', token_type: 'bearer' }) };
    }
    if (u.includes('api.github.com/user')) {
      return { ok: true, status: 200, json: async () => ({ ...identity, type: 'User' }) };
    }
    return realFetch(url as never, init as never);
  }) as never);
}

async function boot(withGithub: boolean): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-gh-auth-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  if (withGithub) {
    vi.stubEnv('RELAY_GITHUB_APP_CLIENT_ID', 'Iv1.public_client_id');
    vi.stubEnv('RELAY_GITHUB_APP_CLIENT_SECRET', 'fixture-secret-never-surfaces');
    vi.stubEnv('RELAY_GITHUB_APP_CALLBACK_URL', CALLBACK);
  }
  const config = loadBridgeConfig(process.env);
  const server = createBridgeServer(
    config,
    {
      start: () => ({ state: 'ready' }) as never,
      get: () => ({ state: 'ready', missionId: 'm' }) as never,
      cancel: () => undefined,
      retry: () => undefined,
    } as never,
    null, null, null, null,
    () => false,
    createBetaEnrolmentStore({ root }),
    [{ wave: 'wave_0', state: betaWaveZeroState(process.env), seats: 100 }],
  );
  servers.push(server as never);
  await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

const get = (base: string, path: string, headers: Record<string, string> = {}) =>
  realFetch(`${base}${path}`, { headers: { Origin: ORIGIN, ...headers } });

describe('an unconfigured bridge offers no GitHub sign-in', () => {
  it('answers 503 on /auth/github/start', async () => {
    const base = await boot(false);
    const res = await get(base, '/relay-api/auth/github/start');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.kind).toBe('github_sign_in_unconfigured');
  }, 30_000);
});

describe('a configured bridge signs a fresh user in without the operator token', () => {
  it('start -> callback -> a session that authorizes a real mission read', async () => {
    stubGitHub({ login: 'fresh-beta-user', id: 987654 });
    const base = await boot(true);

    // 1) Begin sign-in. No operator token anywhere in this flow.
    const startRes = await get(base, '/relay-api/auth/github/start');
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json();
    const authorizeUrl: string = startBody.data.authorizeUrl;
    const state: string = startBody.data.state;
    expect(authorizeUrl).toContain('github.com/login/oauth/authorize');
    expect(authorizeUrl).toContain('client_id=Iv1.public_client_id');

    // 2) GitHub redirects back with a code + our state (a top-level navigation:
    //    no Origin header, which the bridge admits). The bridge REDIRECTS the
    //    browser back to the frontend with a one-time claim — the token is never
    //    in the URL.
    const cbRes = await realFetch(`${base}/relay-api/auth/github/callback?code=real-code&state=${state}`, { redirect: 'manual' });
    expect(cbRes.status).toBe(302);
    const location = cbRes.headers.get('location') ?? '';
    expect(location).toContain(`${ORIGIN}/#relay_claim=`);
    expect(location).not.toContain('Relay-Session');
    const claim = decodeURIComponent(new URL(location).hash.replace('#relay_claim=', ''));

    // 3) The frontend exchanges the claim for the session over POST (token in body).
    const claimRes = await realFetch(`${base}/relay-api/auth/github/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ claim }),
    });
    expect(claimRes.status).toBe(200);
    const cbBody = await claimRes.json();
    expect(cbBody.data.scope).toBe('browser_control');
    expect(cbBody.data.participantId).toBe('ghu-987654');
    expect(cbBody.data.login).toBe('fresh-beta-user');
    const sessionToken: string = cbBody.data.sessionToken;
    expect(typeof sessionToken).toBe('string');
    // No secret leaked in the whole exchange.
    expect(JSON.stringify(cbBody)).not.toContain('fixture-secret-never-surfaces');
    expect(JSON.stringify(cbBody)).not.toContain('ghu_mock_user_token');

    // 3) The session is real: it authorizes a browser-readable mission call that
    //    an anonymous caller is refused for.
    const anon = await get(base, '/relay-api/mission/some-mission');
    expect(anon.status).toBe(401);

    const authed = await get(base, '/relay-api/mission/some-mission', {
      Authorization: `Relay-Session ${sessionToken}`,
    });
    expect(authed.status).toBe(200);
  }, 30_000);

  it('a forged state is refused over HTTP and no session is issued', async () => {
    stubGitHub({ login: 'attacker', id: 1 });
    const base = await boot(true);
    const cbRes = await realFetch(`${base}/relay-api/auth/github/callback?code=x&state=forged`);
    expect(cbRes.status).toBe(401);
  }, 30_000);
});
