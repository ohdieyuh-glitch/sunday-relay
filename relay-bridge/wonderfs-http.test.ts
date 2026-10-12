import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { betaWaveZeroState } from './beta-routes';
import { loadBridgeConfig } from './config';
import { createBridgeServer } from './server';
import { createBetaEnrolmentStore } from '../src/relay/persistence';

/**
 * WONDERFS ON THE REAL BRIDGE (R1): what a /relay-api/wonderfs/v1 request reaches through `createBridgeServer`, with NO database.
 *
 * The bridge dispatches by prefix and several families claim more than their own (`/wonderland/` is claimed whole). So each answer
 * below carries the error SHAPE only WonderFS's gate gives -- `{error:{kind:'session_required'}}` with no-store -- never the
 * fallback's `{error:'not found'}`, never social's 503. Behind the session gate (a store, roles, pages, bytes) is
 * wonderfs-routes.test.ts; this file cannot mint a desktop session on the bridge without the sign-in, which needs a database.
 *
 * ALWAYS ON (INV-10, §19.m6): the same answers with WONDERLAND_SOCIAL_ENABLED unset, '0' and '1'; CONTROL: that flag DOES switch
 * social. And the static half of T-ALWAYS-ON (server side, plan R1): the WonderFS files and server.ts's WonderFS blocks read no
 * setting; CONTROL: the scanner catches a planted WONDERFS_DISABLED.
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

async function boot(env: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-wonderfs-http-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-0123456789abcdef');
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  // no database in this file, whatever the shell carries
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('JULIUS_DATABASE_URL', '');
  vi.stubEnv('WONDERLAND_SOCIAL_ENABLED', '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
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
  await new Promise<void>((r) => (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

async function call(base: string, path: string, opts: { auth?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  const response = await realFetch(`${base}${path}`, { headers });
  return { status: response.status, body: (await response.json()) as any, cacheControl: response.headers.get('cache-control'), pragma: response.headers.get('pragma') };
}

const SESSION_REQUIRED = { error: { kind: 'session_required', message: 'Sign in to Wonderland to use your project files.' } };

describe('WonderFS on the real bridge: its own family, its own gate', () => {
  it('every WonderFS path, with or without /relay-api, reaches WonderFS\'s gate: 401 session_required, no-store -- not the fallback 404, not another family', async () => {
    const base = await boot({});
    for (const path of ['/relay-api/wonderfs/v1/projects', '/relay-api/wonderfs/v1/projects/prj-1/branches/main/tree?limit=2', '/relay-api/wonderfs/v1/nope', '/relay-api/wonderfs', '/wonderfs/v1/projects']) {
      const a = await call(base, path);
      expect([a.status, a.body], path).toEqual([401, SESSION_REQUIRED]);
      expect([a.cacheControl, a.pragma], path).toEqual(['no-store', 'no-cache']);
      const bogus = await call(base, path, { auth: `Relay-Session ${'x'.repeat(43)}` });
      expect([bogus.status, bogus.body], `${path} with a token nobody minted`).toEqual([401, SESSION_REQUIRED]);
    }
    const grant = await call(base, '/relay-api/wonderfs/v1/projects', { auth: 'WonderFS-Grant abcdef' });
    expect([grant.status, grant.body.error.kind], 'the agent scheme is reserved').toEqual([401, 'grant_not_accepted']);
    // CONTROL: a path outside the family still gets the bridge's own fallback
    const elsewhere = await call(base, '/relay-api/wonderfsx/v1/projects');
    expect([elsewhere.status, elsewhere.body]).toEqual([404, { error: 'not found' }]);
  });

  it('desktop only: an allowed browser Origin gets WonderFS\'s 403 desktop_only; an unknown Origin never reaches a route', async () => {
    const base = await boot({});
    const page = await call(base, '/relay-api/wonderfs/v1/projects', { origin: ORIGIN, auth: `Relay-Session ${'x'.repeat(43)}` });
    expect([page.status, page.body.error.kind, page.cacheControl]).toEqual([403, 'desktop_only', 'no-store']);
    const stranger = await call(base, '/relay-api/wonderfs/v1/projects', { origin: 'https://evil.example' });
    expect([stranger.status, stranger.body]).toEqual([403, { error: 'origin not allowed' }]);
  });
});

describe('WonderFS on the real bridge: ALWAYS ON (INV-10, §19.m6)', () => {
  it('the same WonderFS answers with WONDERLAND_SOCIAL_ENABLED unset, 0 and 1 -- and with a planted WONDERFS_DISABLED; CONTROL: the flag does switch social', async () => {
    const answers: unknown[] = [];
    const social: number[] = [];
    const envs: Record<string, string>[] = [{}, { WONDERLAND_SOCIAL_ENABLED: '0' }, { WONDERLAND_SOCIAL_ENABLED: '1', RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public' }, { WONDERFS_DISABLED: '1', WONDERFS_ENABLED: '0' }];
    for (const env of envs) {
      const base = await boot(env);
      const a = await call(base, '/relay-api/wonderfs/v1/projects/prj-1/branches/main/tree');
      answers.push([a.status, a.body, a.cacheControl]);
      social.push((await call(base, '/relay-api/wonderland/social/snapshot', { auth: `Relay-Session ${'x'.repeat(43)}` })).status);
    }
    for (const a of answers) expect(a).toEqual([401, SESSION_REQUIRED, 'no-store']);
    // social: 503 when off; when on, its own session gate answers (401) -- so the switch exists for social, and not for WonderFS
    expect(social).toEqual([503, 503, 401, 503]);
  });
});

/* -------------------------------------------------------------------------------------------- the static no-toggle check */

const ROOT = resolve(__dirname, '..');
const WONDERFS_FILES = ['relay-bridge/wonderfs-scope.ts', 'relay-bridge/wonderfs-gate.ts', 'relay-bridge/wonderfs-budgets.ts', 'relay-bridge/wonderfs-routes.ts'];

/** Every way a source could switch WonderFS on configuration: an environment read, the social flag, a toggle-shaped name. */
function togglesIn(source: string): string[] {
  const found: string[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (/\bprocess\s*\.\s*env\b|\bprocess\s*\[\s*['"`]env['"`]\s*\]|\bimport\.meta\.env\b/u.test(line)) found.push(`${index + 1}: environment read`);
    if (/WONDERLAND_SOCIAL_ENABLED|\bsocialEnabled\b/u.test(line)) found.push(`${index + 1}: the social flag`);
    if (/WONDERFS_[A-Z_]*(?:ENABLE|DISABLE|BYPASS|OFF|TOGGLE)|\bwfs(?:Enabled|Disabled)\b|\bwonderfs(?:Enabled|Disabled)\b/iu.test(line)) found.push(`${index + 1}: a toggle-shaped name`);
  }
  return found;
}

/** server.ts's WonderFS regions, between the fences. */
function wonderfsBlocks(server: string): string[] {
  return [...server.matchAll(/\/\/ WONDERFS BLOCK BEGIN\n([\s\S]*?)\/\/ WONDERFS BLOCK END/gu)].map((m) => m[1]);
}

describe('T-ALWAYS-ON, the server side, statically: no route serves WonderFS conditionally on configuration', () => {
  it('the WonderFS route files and server.ts\'s WonderFS blocks read no setting and name no toggle; CONTROL: a planted switch is caught', () => {
    for (const file of WONDERFS_FILES) expect(togglesIn(readFileSync(join(ROOT, file), 'utf8')), file).toEqual([]);
    const server = readFileSync(join(ROOT, 'relay-bridge/server.ts'), 'utf8');
    const blocks = wonderfsBlocks(server);
    expect(blocks.length, 'the process-level mount and the ONE dispatch block').toBe(2);
    expect(blocks[1]).toContain('isWonderfsRoute(');
    expect(blocks[1]).toContain('await wonderfs.serve(req, res, cors);');
    for (const block of blocks) expect(togglesIn(block)).toEqual([]);
    expect(server.match(/isWonderfsRoute\(/gu)?.length, 'one dispatch, nowhere else').toBe(1);
    // CONTROLS: each planted switch is found
    expect(togglesIn("if (process.env.WONDERFS_DISABLED === '1') return;")).toEqual(['1: environment read', '1: a toggle-shaped name']);
    expect(togglesIn('if (!socialEnabled) { send(res, 503, {}); return; }')).toEqual(['1: the social flag']);
    expect(togglesIn("const off = process['env'].X;")).toEqual(['1: environment read']);
    expect(togglesIn('const wfsEnabled = cfg.wonderfs;')).toEqual(['1: a toggle-shaped name']);
    expect(wonderfsBlocks(`// WONDERFS BLOCK BEGIN\nif (process.env.WONDERFS_OFF) x();\n// WONDERFS BLOCK END\n`).flatMap(togglesIn).length, 'CONTROL: the fence extraction sees inside a block').toBe(2);
  });
});
