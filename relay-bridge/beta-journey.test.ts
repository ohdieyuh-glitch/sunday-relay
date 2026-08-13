import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { createMissionRegistry } from './mission';
import { journeyRoleDeps } from './mission-journey-harness';
import {
  createRepositoryRegistrationStore, createBrainMemoryStore, type BrainMemoryStore,
} from '../src/relay/persistence';
import {
  createRepositoryRegistration, resolveRepositoryTarget,
  type MissionRepositoryTarget, type RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * THE PRIVATE-BETA JOURNEY, driven by a FRESH PARTICIPANT over the real HTTP
 * boundary — no operator token, no founder terminal.
 *
 * This proves the beta journey end to end as a user experiences it:
 *   sign in with GitHub  →  authorize an app installation  →  register a repo
 *   they own  →  target that repo in a mission start  →  (and be REFUSED any
 *   repo they do not own)  →  start a real Mission  →  watch the actual
 *   three-role pipeline reach verified_complete  →  reconnect without losing it.
 *
 * GitHub is mocked at the `fetch` seam, and the three role BOUNDARIES are fake
 * (see mission-journey-harness) so no provider is contacted — but the pipeline
 * driving them is the one and only real `mission.ts` running behind a real
 * `createBridgeServer`. What this file proves that no other does: a fresh,
 * non-operator, GitHub-verified participant driving the whole product API from
 * sign-in through a completed mission, with ownership and spend enforced.
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

/** Sign a fresh participant in and return their session token — no operator. The
    callback redirects the browser back with a one-time CLAIM (never the token in
    a URL); the frontend redeems it over POST for the session token. */
async function signIn(base: string, identity: { login: string; id: number }): Promise<string> {
  stubGitHub(identity);
  const start = await getJson(await realFetch(`${base}/relay-api/auth/github/start`, { headers: { Origin: ORIGIN } }));
  const state = (start.body.data as { state: string }).state;
  const cb = await realFetch(`${base}/relay-api/auth/github/callback?code=c&state=${state}`, { redirect: 'manual' });
  const claim = decodeURIComponent(new URL(cb.headers.get('location') ?? '').hash.replace('#relay_claim=', ''));
  const claimed = await realFetch(`${base}/relay-api/auth/github/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ claim }),
  });
  return ((await claimed.json()) as { data: { sessionToken: string } }).data.sessionToken;
}

/** Prove control of an installation the way GitHub's post-install redirect does.
    The callback redirects the browser back to the frontend with the (public)
    installation id in the fragment. */
async function authorizeInstallation(base: string, token: string, installationId: string): Promise<void> {
  const started = await getJson(await realFetch(`${base}/relay-api/auth/github/install/start`, { method: 'POST', headers: asUser(token) }));
  const state = (started.body.data as { state: string }).state;
  const cb = await realFetch(`${base}/relay-api/auth/github/install/callback?installation_id=${installationId}&state=${state}`, { redirect: 'manual' });
  expect(cb.status).toBe(302);
  expect(cb.headers.get('location') ?? '').toContain(`#relay_installation=${installationId}`);
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

/** Boot with the REAL mission registry (fake role deps) so a mission actually
    runs the three-role pipeline through the HTTP surface. */
function bootReal(): { start: () => Promise<string>; calls: ReturnType<typeof journeyRoleDeps>['calls'] } {
  const journey = journeyRoleDeps();
  const start = async (): Promise<string> => {
    const root = mkdtempSync(join(tmpdir(), 'relay-journey-real-'));
    roots.push(root);
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
    vi.stubEnv('RELAY_DATA_DIR', root);
    vi.stubEnv('RELAY_GITHUB_APP_CLIENT_ID', 'Iv1.public_client_id');
    vi.stubEnv('RELAY_GITHUB_APP_CLIENT_SECRET', 'fixture-secret-never-surfaces');
    vi.stubEnv('RELAY_GITHUB_APP_CALLBACK_URL', CALLBACK);
    vi.stubEnv('RELAY_GITHUB_APP_INSTALL_URL', INSTALL_URL);
    // The LIVE three-role path (architect → coding → independent reviewer). The
    // OpenAI key is a synthetic fixture that is never served — the architect dep
    // is injected, so nothing reaches a provider — but its PRESENCE selects the
    // live path so the reviewer runs (the fusion path is review-less by design).
    const liveEnv = {
      RELAY_PROMPT_ARCHITECT_MODE: 'live',
      OPENAI_API_KEY: 'sk-FAKETESTNOTREAL-never-served',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
    } as NodeJS.ProcessEnv;
    vi.stubEnv('RELAY_PROMPT_ARCHITECT_MODE', 'live');
    const config = loadBridgeConfig(process.env);
    const registry = createMissionRegistry({
      fusionBaseUrl: 'http://127.0.0.1:3999',
      sundayMode: 'fast',
      claudeMode: 'fake',
      confirmLive: true,
      architectEnv: liveEnv,
      hermesEnv: liveEnv,
      deps: journey.deps,
    });
    const server = createBridgeServer(
      config, registry,
      null, null, null, null, () => false, null, [], null, null,
      createRepositoryRegistrationStore({ root }),
    );
    servers.push(server as never);
    await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
    const address = (server as never as { address: () => { port: number } | null }).address();
    return `http://127.0.0.1:${address === null ? 0 : address.port}`;
  };
  return { start, calls: journey.calls };
}

const TERMINAL = new Set(['verified_complete', 'failed', 'cancelled']);
async function settleMission(base: string, token: string, missionId: string, tries = 300): Promise<Record<string, unknown>> {
  for (let i = 0; i < tries; i++) {
    const res = await realFetch(`${base}/relay-api/mission/${missionId}`, { headers: asUser(token) });
    if (res.status === 200) {
      const view = ((await res.json()) as { view: Record<string, unknown> }).view;
      if (TERMINAL.has(view.state as string)) return view;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('mission did not settle');
}

describe('a fresh participant runs a real three-role mission end to end over HTTP', () => {
  it('signs in, starts a mission, and watches it reach verified_complete with truthful evidence', async () => {
    const real = bootReal();
    const base = await real.start();

    // Fresh participant, no operator token.
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });

    // Give Relay an objective + a PSP config, and start a real Mission.
    const started = await getJson(await startMission(base, token, {
      missionId: 'm-run', objective: 'Implement the project-name normalizer.',
      config: { mode: 'autonomous', review: 'independent', limits: { agentCalls: 6, spendUsd: 3 } },
    }));
    expect(started.status).toBe(200);

    // Watch truthful live state to completion — the REAL pipeline ran.
    const view = await settleMission(base, token, 'm-run');
    expect(view.state).toBe('verified_complete');
    // Each of the three roles actually ran: architect + coding + independent reviewer.
    expect(real.calls.architect + real.calls.fusion).toBe(1);
    expect(real.calls.coding).toBe(1);
    expect(real.calls.reviewer).toBe(1);
    // The config the user set is visible on the mission.
    expect((view.config as { mode: string }).mode).toBe('autonomous');
    // Actor/model evidence is present — attestations for the roles that executed.
    expect(Array.isArray(view.attestations)).toBe(true);
    expect((view.attestations as unknown[]).length).toBeGreaterThan(0);
  }, 45_000);

  it('survives a browser reconnect: a NEW poll with the same session sees the same mission', async () => {
    const real = bootReal();
    const base = await real.start();
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });
    await getJson(await startMission(base, token, { missionId: 'm-reconnect', objective: 'Normalize names.' }));
    const settled = await settleMission(base, token, 'm-reconnect');
    expect(settled.state).toBe('verified_complete');

    // "Refresh the browser": a brand-new request with only the session + missionId
    // (the two things a reconnecting tab still holds) recovers the whole mission.
    const reconnect = await getJson(await realFetch(`${base}/relay-api/mission/m-reconnect`, { headers: asUser(token) }));
    expect(reconnect.status).toBe(200);
    expect((reconnect.body.view as { state: string }).state).toBe('verified_complete');
    expect((reconnect.body.view as { missionRevision?: string }).missionRevision).toBe((settled as { missionRevision?: string }).missionRevision);
  }, 45_000);
});

const savePsp = (base: string, token: string, body: unknown) =>
  realFetch(`${base}/relay-api/psp`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...asUser(token) }, body: JSON.stringify(body),
  });

describe('a fresh participant creates and selects a PSP (criterion 4)', () => {
  it('saves a PSP, lists it, loads it, and starts a mission under it', async () => {
    const base = await boot();
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });

    // CREATE a PSP — a named configuration bundle.
    const save = await getJson(await savePsp(base, token, {
      pspId: 'strict-autonomous', name: 'Strict Autonomous',
      config: { mode: 'autonomous', review: 'independent', limits: { agentCalls: 6, spendUsd: 2 } },
    }));
    expect(save.status).toBe(200);

    // SELECT: it appears in the participant's own list.
    const list = await getJson(await realFetch(`${base}/relay-api/psp`, { headers: asUser(token) }));
    expect((list.body.data as { psps: { pspId: string }[] }).psps.map((p) => p.pspId)).toContain('strict-autonomous');

    // LOAD the full config back.
    const loaded = await getJson(await realFetch(`${base}/relay-api/psp/strict-autonomous`, { headers: asUser(token) }));
    const config = (loaded.body.data as { config: { mode: string; limits: { spendUsd: number } } }).config;
    expect(config.mode).toBe('autonomous');
    expect(config.limits.spendUsd).toBe(2);

    // START a mission UNDER the loaded PSP — the config reaches the engine.
    const started = await getJson(await startMission(base, token, { missionId: 'm-psp', objective: 'Do the thing', config }));
    expect(started.status).toBe(200);
    expect((lastStart?.config as { mode: string }).mode).toBe('autonomous');
  }, 30_000);

  it('one participant cannot load another participant’s PSP', async () => {
    const base = await boot();
    const alice = await signIn(base, { login: 'alice', id: 4242 });
    await savePsp(base, alice, { pspId: 'private', name: 'Alice private', config: { mode: 'guided' } });

    const mallory = await signIn(base, { login: 'mallory', id: 9999 });
    const load = await realFetch(`${base}/relay-api/psp/private`, { headers: asUser(mallory) });
    expect(load.status).toBe(404); // Mallory sees nothing of Alice's
    const list = await getJson(await realFetch(`${base}/relay-api/psp`, { headers: asUser(mallory) }));
    expect((list.body.data as { psps: unknown[] }).psps).toHaveLength(0);
  }, 30_000);

  it('refuses a PSP with a malformed spend limit, and an anonymous save', async () => {
    const base = await boot();
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });
    const bad = await savePsp(base, token, { pspId: 'bad', name: 'Bad', config: { limits: { spendUsd: -1 } } });
    expect(bad.status).toBe(422);
    const anon = await realFetch(`${base}/relay-api/psp`, {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ pspId: 'x', name: 'x', config: {} }),
    });
    expect(anon.status).toBe(401);
  }, 30_000);
});

/* ------------------------------------------------- ship leg (criterion 9) --- */

const NOW = '2026-08-12T10:00:00.000Z';
const SHIP_LADDER = ['read', 'write_worktree', 'commit', 'deploy_staging'] as const;
const GIT_ENV = (home: string) => ({
  PATH: process.env.PATH ?? '', HOME: home,
  GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x', GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
});

/** A real local git repo + a retained worktree with an in-scope edit, plus a
    registration OWNED BY a participant — the state a verified real-target mission
    leaves for that participant to ship. */
function participantVerifiedMission(owner: string): {
  target: MissionRepositoryTarget; reg: RepositoryRegistration; worktreePath: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), 'relay-jship-src-'));
  roots.push(repoRoot);
  const git = (a: string[], cwd = repoRoot) => execFileSync('git', a, { cwd, env: GIT_ENV(repoRoot) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'app.js'), 'export const v = 1;\n');
  git(['add', '--', '.']); git(['commit', '-m', 'initial']);
  const worktreePath = mkdtempSync(join(tmpdir(), 'relay-jship-wt-'));
  roots.push(worktreePath);
  rmSync(worktreePath, { recursive: true, force: true });
  git(['worktree', 'add', '-b', 'relay/mission-1', worktreePath, 'main']);
  writeFileSync(join(worktreePath, 'src', 'app.js'), 'export const v = 2;\n');

  const built = createRepositoryRegistration({
    draft: {
      identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
      location: { kind: 'local_path', path: repoRoot },
      scope: { read: ['**'], write: ['src/**'] },
      grants: SHIP_LADDER.map((permission) => ({ permission, authorizedBy: owner, authorizedAt: NOW, expiresAt: null, note: null })),
      ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
      registeredBy: owner,
      ownerParticipant: owner, // OWNED BY THE PARTICIPANT — the ship ownership gate reads this.
    },
    now: NOW,
  });
  if (!built.ok) throw new Error(built.error.message);
  const resolved = resolveRepositoryTarget({
    registration: built.value,
    request: { repositoryKey: built.value.key, selectedBy: owner, selectedAt: NOW, workingBranch: 'relay/mission-1', permissions: [...SHIP_LADDER] },
    now: NOW,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return { target: resolved.target, reg: built.value, worktreePath };
}

async function bootShip(m: { target: MissionRepositoryTarget; reg: RepositoryRegistration; worktreePath: string }):
  Promise<{ base: string; brain: BrainMemoryStore }> {
  const root = mkdtempSync(join(tmpdir(), 'relay-jship-')); roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  vi.stubEnv('RELAY_GITHUB_APP_CLIENT_ID', 'Iv1.public_client_id');
  vi.stubEnv('RELAY_GITHUB_APP_CLIENT_SECRET', 'fixture-secret-never-surfaces');
  vi.stubEnv('RELAY_GITHUB_APP_CALLBACK_URL', CALLBACK);
  vi.stubEnv('RELAY_GITHUB_APP_INSTALL_URL', INSTALL_URL);
  const config = loadBridgeConfig(process.env);
  const repoStore = createRepositoryRegistrationStore({ root });
  repoStore.save(m.reg);
  const brain = createBrainMemoryStore({ root });
  const registry = {
    start: () => ({ state: 'ready' }) as never,
    get: () => ({ state: 'verified_complete', missionId: 'm-ship' }) as never,
    cancel: () => undefined, retry: () => undefined,
    shipContext: () => ({ target: m.target, worktreePath: m.worktreePath }),
    recordShipOutcome: () => {}, beginShip: () => true, endShip: () => {},
  };
  const server = createBridgeServer(
    config, registry as never,
    null, null, null, null, () => false, null, [], null, null,
    repoStore, brain,
  );
  servers.push(server as never);
  await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return { base: `http://127.0.0.1:${address === null ? 0 : address.port}`, brain };
}

const ship = (base: string, token: string, missionId: string) =>
  realFetch(`${base}/relay-api/mission/${missionId}/ship`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...asUser(token) }, body: JSON.stringify({}),
  });

describe('a fresh participant SHIPS their own verified mission over HTTP (criterion 9)', () => {
  it('commits the retained worktree and writes a Project Brain episode', async () => {
    const m = participantVerifiedMission('ghu-4242');
    const { base, brain } = await bootShip(m);
    const token = await signIn(base, { login: 'beta-alice', id: 4242 });

    const res = await getJson(await ship(base, token, 'm-ship'));
    expect(res.status).toBe(200);
    expect((res.body.data as { stage: string }).stage).toBe('committed');
    // The commit really landed on the working branch.
    const log = execFileSync('git', ['log', '--oneline', 'relay/mission-1'], {
      cwd: (m.target.location as { path: string }).path, encoding: 'utf8', env: GIT_ENV((m.target.location as { path: string }).path),
    });
    expect(log).toContain('Relay mission');
    // The retained worktree was disposed by the ship.
    expect(existsSync(m.worktreePath)).toBe(false);
    // The Project Brain recorded the ship as a verified episode (WP-6).
    expect(brain.load(m.reg.key).entries.length).toBeGreaterThan(0);
  }, 45_000);

  it('REFUSES a different participant shipping a mission they do not own', async () => {
    const m = participantVerifiedMission('ghu-4242');
    const { base } = await bootShip(m);
    const mallory = await signIn(base, { login: 'mallory', id: 9999 });
    const res = await getJson(await ship(base, mallory, 'm-ship'));
    expect(res.status).toBe(403);
    expect((res.body.error as { kind: string }).kind).toBe('repository_not_yours');
    // The worktree is untouched — a refused ship ships nothing.
    expect(existsSync(m.worktreePath)).toBe(true);
  }, 45_000);
});
