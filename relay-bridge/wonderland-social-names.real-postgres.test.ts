import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { loadBridgeConfig } from './config';
import { createBridgeServer } from './server';

/**
 * A PLAYER'S NAME IS THE ACCOUNT'S, END TO END, ON THE REAL SERVER.
 *
 * Two players sign in through the bridge's own GitHub sign-in (GitHub's two
 * answers stubbed at the network edge, nothing else), and stand in one
 * instance. Each sees the other's VERIFIED login, recorded at sign-in, through
 * every later social request that knows no name. A rename on GitHub reaches
 * the roster at the next sign-in, keyed by the stable account id. A player who
 * hides from strangers takes the name with them. Nothing here lets a client
 * name itself.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const ORIGIN = 'https://names.relay.test';
const OPERATOR = `op-${randomBytes(16).toString('hex')}`;
const realFetch = globalThis.fetch.bind(globalThis);

function stubGitHub(identity: { login: string; id: number }): void {
  vi.stubGlobal('fetch', (async (url: string, init?: unknown) => {
    const u = String(url);
    if (u.includes('/login/oauth/access_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ghu_mock_user_token', token_type: 'bearer' }) };
    }
    if (u.includes('api.github.com/user')) return { ok: true, status: 200, json: async () => ({ ...identity, type: 'User' }) };
    return realFetch(url as never, init as never);
  }) as never);
}

suite('a player\'s social name is the account\'s, end to end on the real server', () => {
  const nonce = randomBytes(4).toString('hex');
  const databaseName = `names${nonce}`;
  let admin: Pool;
  let pool: Pool;
  let base = '';
  let root = '';
  let server: { close: (done: () => void) => void } | null = null;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    pool.on('error', () => undefined);
    await new TransactionalWonderlandDatabase(pool).migrate();
    root = mkdtempSync(join(tmpdir(), 'relay-names-'));
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
    vi.stubEnv('RELAY_DATA_DIR', root);
    vi.stubEnv('RELAY_GITHUB_APP_CLIENT_ID', 'Iv1.public_client_id');
    vi.stubEnv('RELAY_GITHUB_APP_CLIENT_SECRET', 'fixture-secret-never-surfaces');
    vi.stubEnv('RELAY_GITHUB_APP_CALLBACK_URL', 'https://bridge.example/relay-api/auth/github/callback');
    vi.stubEnv('JULIUS_DATABASE_URL', url.toString());
    const created = createBridgeServer(loadBridgeConfig(process.env), {
      start: () => ({ state: 'ready' }) as never, get: () => ({ state: 'ready' }) as never, cancel: () => undefined, retry: () => undefined,
    } as never);
    server = created as never;
    await new Promise<void>((done) => (created as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', done));
    const address = (created as never as { address: () => { port: number } }).address();
    base = `http://127.0.0.1:${String(address.port)}`;
  }, 60_000);

  afterAll(async () => {
    if (server !== null) await new Promise<void>((done) => server!.close(() => done()));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await pool?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`).catch(() => undefined);
    await admin?.end();
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  const signIn = async (identity: { login: string; id: number }): Promise<string> => {
    stubGitHub(identity);
    const start = await (await realFetch(`${base}/relay-api/auth/github/start`, { headers: { Origin: ORIGIN } })).json() as { data: { state: string } };
    const callback = await realFetch(`${base}/relay-api/auth/github/callback?code=c&state=${start.data.state}`, { redirect: 'manual' });
    const claim = decodeURIComponent(new URL(callback.headers.get('location') ?? '').hash.replace('#relay_claim=', ''));
    const claimed = await realFetch(`${base}/relay-api/auth/github/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ claim }),
    });
    vi.unstubAllGlobals();
    return ((await claimed.json()) as { data: { sessionToken: string } }).data.sessionToken;
  };
  const as = (token: string) => ({ authorization: `Relay-Session ${token}`, origin: ORIGIN, 'content-type': 'application/json' });
  let sequence = 0;
  const command = (token: string, value: unknown) => realFetch(`${base}/relay-api/wonderland/social/commands`, {
    method: 'POST', headers: as(token), body: JSON.stringify({ commandId: `names-${nonce}-${String(++sequence)}`, command: value }),
  });
  const rosterNames = async (token: string): Promise<Record<string, string | null>> => {
    const body = await (await realFetch(`${base}/relay-api/wonderland/social/roster`, { headers: as(token) })).json() as {
      data: { players: { playerId: string; displayName: string | null }[] };
    };
    return Object.fromEntries(body.data.players.map((entry) => [entry.playerId, entry.displayName]));
  };

  it('each player is shown the other\'s verified login, a rename arrives with the next sign-in, and hiding takes the name away', async () => {
    const ann = await signIn({ login: `octo-ann-${nonce}`, id: 7_100_001 });
    const ben = await signIn({ login: `octo-ben-${nonce}`, id: 7_100_002 });
    for (const token of [ann, ben]) {
      // Requests that know no name — the player's own, many times — must not erase the recorded one.
      for (let read = 0; read < 3; read += 1) expect((await realFetch(`${base}/relay-api/wonderland/social/me`, { headers: as(token) })).status).toBe(200);
      expect((await command(token, { kind: 'ENTER_INSTANCE', instanceId: `public:names-${nonce}`, location: null, activity: 'IDLE', dogId: null })).status).toBe(200);
    }
    expect(await rosterNames(ben)).toEqual({ 'ghu-7100001': `octo-ann-${nonce}`, 'ghu-7100002': `octo-ben-${nonce}` });
    expect((await rosterNames(ann))['ghu-7100002']).toBe(`octo-ben-${nonce}`);

    // Renamed on GitHub: the stable id keeps the player, the next sign-in brings the new name.
    await signIn({ login: `octo-ann-renamed-${nonce}`, id: 7_100_001 });
    expect((await rosterNames(ben))['ghu-7100001']).toBe(`octo-ann-renamed-${nonce}`);

    // Hidden from strangers, the name goes with everything else.
    expect((await command(ann, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } })).status).toBe(200);
    const hidden = await rosterNames(ben);
    expect(hidden).toEqual({ 'ghu-7100002': `octo-ben-${nonce}` });
    expect(JSON.stringify(hidden)).not.toContain('octo-ann');
  }, 60_000);
});
