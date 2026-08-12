import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { createRepositoryRegistrationStore } from '../src/relay/persistence';

/**
 * THE PRIVATE-BETA JOURNEY, driven by a FRESH PARTICIPANT over the real HTTP
 * boundary — no operator token, no founder terminal.
 *
 * This proves the authorization spine end to end as a beta user experiences it:
 *   sign in with GitHub  →  authorize an app installation  →  register a repo
 *   they own  →  target that repo in a mission start  →  and be REFUSED any repo
 *   they do not own.
 *
 * GitHub is mocked at the `fetch` seam; the mission engine is a stub here (the
 * REAL three-role pipeline is proven to reach verified_complete in
 * orchestrator.test.ts, and the config/limits flow through registry.start in
 * mission-auth.test.ts). What this file adds is the one thing neither proves: a
 * fresh, non-operator, GitHub-verified participant driving the product API from
 * sign-in through authorized mission targeting, with ownership enforced.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const CALLBACK = 'https://bridge.example/relay-api/auth/github/callback';
const INSTALL_URL = 'https://github.com/apps/relay/installations/new';
const OPERATOR = 'operator-secret-for-tests-0123456789abcdef';

const realFetch = globalThis.fetch.bind(globalThis);
const servers: Array<{ close: (cb: () => void) => void }> = [];
const roots: string[] = [];
/** What the stub registry was asked to start — proof the target reached it. */
let lastStart: { repositoryTarget?: { repositoryKey?: string }; config?: unknown } | null = null;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  lastStart = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A GitHub that returns a chosen identity for the sign-in exchange, and passes
    localhost through so the test's own requests still reach the bridge. */
function stubGitHub(identity: { login: string; id: number }): void {
  vi.stubGlobal('fetch', (async (url: string, init?: unknown) => {
    const u = String(url);
    if (u.includes('/login/oauth/access_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ghu_user_token', token_type: 'bearer' }) };
    }
    if (u.includes('api.github.com/user')) {
      return { ok: true, status: 200, json: async () => ({ ...identity, type: 'User' }) };
    }
    return realFetch(url as never, init as never);
  }) as never);
}

async function boot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-journey-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  vi.stubEnv('RELAY_GITHUB_APP_CLIENT_ID', 'Iv1.public_client_id');
  vi.stubEnv('RELAY_GITHUB_APP_CLIENT_SECRET', 'fixture-secret-never-surfaces');
  vi.stubEnv('RELAY_GITHUB_APP_CALLBACK_URL', CALLBACK);
  vi.stubEnv('RELAY_GITHUB_APP_INSTALL_URL', INSTALL_URL);
  const config = loadBridgeConfig(process.env);
  const registry = {
    start: (input: unknown) => { lastStart = input as typeof lastStart; return { state: 'ready', missionId: 'm' } as never; },
    get: () => ({ state: 'ready' }) as never,
    cancel: () => undefined,
    retry: () => undefined,
  };
  const server = createBridgeServer(
    config, registry as never,
    null, null, null, null, () => false, null, [], null, null,
    createRepositoryRegistrationStore({ root }),
  );
  servers.push(server as never);
  await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

const asUser = (token: string) => ({ Authorization: `Relay-Session ${token}`, Origin: ORIGIN });
const getJson = async (res: Response) => ({ status: res.status, body: await res.json() as Record<string, unknown> });

/** Sign a fresh participant in and return their session token — no operator. */
async function signIn(base: string, identity: { login: string; id: number }): Promise<string> {
  stubGitHub(identity);
  const start = await getJson(await realFetch(`${base}/relay-api/auth/github/start`, { headers: { Origin: ORIGIN } }));
  const state = (start.body.data as { state: string }).state;
  const cb = await getJson(await realFetch(`${base}/relay-api/auth/github/callback?code=c&state=${state}`));
  return (cb.body.data as { sessionToken: string }).sessionToken;
}

/** Prove control of an installation the way GitHub's post-install redirect does. */
async function authorizeInstallation(base: string, token: string, installationId: string): Promise<void> {
  const started = await getJson(await realFetch(`${base}/relay-api/auth/github/install/start`, { method: 'POST', headers: asUser(token) }));
  const state = (started.body.data as { state: string }).state;
  const cb = await realFetch(`${base}/relay-api/auth/github/install/callback?installation_id=${installationId}&state=${state}`);
  expect(cb.status).toBe(200);
}

function remoteRepoDraft(owner: string, name: string, installationId: string) {
  return {
    identity: { provider: 'github', host: 'github.com', owner, name, defaultBranch: 'main' },
    location: { kind: 'remote_clone', cloneUrl: `https://github.com/${owner}/${name}.git` },
    scope: { read: ['**'], write: ['src/**'] },
    grants: ['read', 'write_worktree', 'commit', 'push_feature_branch'].map((permission) => ({
      permission, authorizedBy: owner, authorizedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, note: null,
    })),
    ceilings: { maxFilesChanged: 20, maxLinesRemoved: 500, allowDeletions: false },
    registeredBy: owner,
    credential: { installationId },
  };
}

const register = (base: string, token: string, draft: unknown) =>
  realFetch(`${base}/relay-api/repository/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...asUser(token) }, body: JSON.stringify(draft),
  });

const startMission = (base: string, token: string, body: unknown) =>
  realFetch(`${base}/relay-api/mission/start`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...asUser(token) }, body: JSON.stringify(body),
  });

describe('a fresh participant signs in, authorizes an installation, and connects their own repo', () => {
  it('drives sign-in → install → register → target, all without the operator token', async () => {
    const base = await boot();

    // 1. SIGN IN. A fresh GitHub identity becomes a session — no operator token.
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });
    expect(typeof token).toBe('string');

    // 2. AUTHORIZE AN INSTALLATION (proven by GitHub's redirect, not a claim).
    await authorizeInstallation(base, token, '55550001');

    // 3. REGISTER A REPO THEY OWN. Bound to the participant, using the granted
    //    installation — never a founder env var.
    const reg = await getJson(await register(base, token, remoteRepoDraft('beta-alice', 'their-app', '55550001')));
    expect(reg.status).toBe(200);
    const registered = reg.body.data as { key: string; ownerParticipant: string };
    expect(registered.ownerParticipant).toBe('ghu-4242');

    // 4. TARGET IT in a mission start, with a PSP config. The ownership gate
    //    admits the owner; the target reaches the engine.
    const started = await startMission(base, token, {
      missionId: 'm-alice', objective: 'Implement the util',
      repositoryKey: registered.key, workingBranch: 'relay/feature',
      permissions: ['read', 'write_worktree', 'commit'],
      config: { mode: 'autonomous', review: 'independent', limits: { agentCalls: 6, spendUsd: 2 } },
    });
    expect(started.status).toBe(200);
    expect(lastStart?.repositoryTarget?.repositoryKey).toBe(registered.key);
  }, 30_000);

  it('REFUSES a different participant targeting a repo they do not own', async () => {
    const base = await boot();

    // Alice registers her repo.
    const alice = await signIn(base, { login: 'beta-alice', id: 4242 });
    await authorizeInstallation(base, alice, '55550001');
    const reg = await getJson(await register(base, alice, remoteRepoDraft('beta-alice', 'their-app', '55550001')));
    const key = (reg.body.data as { key: string }).key;

    // Mallory signs in as a different participant and tries to target Alice's repo.
    const mallory = await signIn(base, { login: 'beta-mallory', id: 9999 });
    const attempt = await getJson(await startMission(base, mallory, {
      missionId: 'm-mallory', objective: 'sneak in', repositoryKey: key, workingBranch: 'relay/x',
    }));
    expect(attempt.status).toBe(403);
    expect((attempt.body.error as { kind: string }).kind).toBe('repository_not_yours');
    expect(lastStart).toBeNull(); // the engine was never reached
  }, 30_000);

  it('REFUSES registering with an installation the participant never authorized', async () => {
    const base = await boot();
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });
    // No install/callback for 55550001 — the grant does not exist.
    const reg = await getJson(await register(base, token, remoteRepoDraft('beta-alice', 'their-app', '55550001')));
    expect(reg.status).toBe(403);
    expect((reg.body.error as { kind: string }).kind).toBe('installation_not_authorized');
  }, 30_000);

  it('REFUSES a repo registration from an anonymous caller', async () => {
    const base = await boot();
    const reg = await realFetch(`${base}/relay-api/repository/register`, {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(remoteRepoDraft('x', 'y', '1')),
    });
    expect(reg.status).toBe(401);
  }, 30_000);
});
