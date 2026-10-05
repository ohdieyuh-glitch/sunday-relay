import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import {
  R16_CHECKS, pairR16Sessions, r16Players, readR16Views, runR16Scenario, summarizeR16, verifyR16Restart,
} from '../scripts/wonderland-r16-harness.mjs';

/**
 * WONDERLAND R16, SCRIPTED: THE THREE-PARTY PRIVACY SCENARIO AGAINST THE REAL BRIDGE.
 *
 * The bridge is built from `server.ts` exactly as it ships and run as its own
 * PROCESS on a throwaway PostgreSQL migrated through 033. Three players are
 * signed in through its own pairing routes, and `scripts/wonderland-r16-harness.mjs`
 * drives every privacy rule over HTTP. Then the process is KILLED and started
 * again: every browser session dies with it (they live in memory, by design),
 * the same players sign in afresh, and each must be shown exactly what was
 * stored before. Then each reconnects as a client does (its presence is a
 * lease) and must be shown the same world again. The cases where a lease runs
 * out, mid-scenario and across a restart, need a clock this suite does not
 * hold: `wonderland-r16-harness.test.ts` runs them.
 *
 * And the harness has to be able to fail: the same scenario through a fetch
 * that leaks a hidden player back into a stranger's roster, or shows a blocked
 * conversation, must report those rules FAILED.
 *
 * This is the scripted half of final R16. The real half — three real
 * identities, the hosted HTTPS backend, actual EOS voice — is the same harness
 * with `WONDERLAND_R16_SESSIONS`, run by CORE and the founder.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const OPERATOR = `op-${randomBytes(16).toString('hex')}`;
const ORIGIN = 'https://r16.relay.test';

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

suite('Wonderland R16, scripted, against the real bridge process', () => {
  const nonce = randomBytes(4).toString('hex');
  const databaseName = `r16${nonce}`;
  let admin: Pool;
  let pool: Pool;
  let databaseFor = '';
  let root = '';
  let bundle = '';
  let bridge = '';
  let child: ChildProcess | null = null;

  /** Start the shipped bridge as a process, and resolve once it says it is listening. A restart keeps its address, as a hosted backend does. */
  const start = async (reuse?: string): Promise<void> => {
    const port = reuse === undefined ? await freePort() : Number(new URL(reuse).port);
    bridge = `http://127.0.0.1:${String(port)}`;
    const env = {
      PATH: process.env.PATH ?? '', NODE_PATH: resolve(process.cwd(), 'node_modules'),
      RELAY_BRIDGE_API_TOKEN: OPERATOR, RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_PORT: String(port), RELAY_BRIDGE_HOST: '127.0.0.1',
      RELAY_DATA_DIR: join(root, 'state'), JULIUS_DATABASE_URL: databaseFor,
    };
    const started = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child = started;
    await new Promise<void>((done, fail) => {
      let output = '';
      const timer = setTimeout(() => fail(new Error(`the bridge did not start: ${output}`)), 20_000);
      const listen = (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output.includes('Relay bridge listening')) { clearTimeout(timer); done(); }
      };
      started.stdout?.on('data', listen);
      started.stderr?.on('data', listen);
      started.once('exit', (code) => { clearTimeout(timer); fail(new Error(`the bridge exited ${String(code)}: ${output}`)); });
    });
  };
  const stop = async (): Promise<void> => {
    const running = child;
    child = null;
    if (running !== null && running.exitCode === null) {
      await new Promise<void>((done) => { running.once('exit', () => done()); running.kill('SIGTERM'); });
    }
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    databaseFor = url.toString();
    pool = new Pool({ connectionString: databaseFor, max: 4 });
    pool.on('error', () => undefined);
    // The chain the hosted backend must hold for social: through 033.
    await new TransactionalWonderlandDatabase(pool).migrate();
    root = mkdtempSync(join(tmpdir(), 'r16-bridge-'));
    bundle = join(root, 'server.cjs');
    const { build } = await import('esbuild');
    await build({
      entryPoints: [resolve(process.cwd(), 'relay-bridge/server.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
      external: ['@anthropic-ai/claude-agent-sdk', 'pg'], logLevel: 'error',
    });
    await start();
  }, 120_000);

  afterAll(async () => {
    await stop();
    await pool?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`).catch(() => undefined);
    await admin?.end();
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  it('every rule holds for three players over HTTP, and what they were shown survives a restart of the process', async () => {
    const players = r16Players(nonce);
    const paired = await pairR16Sessions({ bridge, origin: ORIGIN, operatorToken: OPERATOR, playerIds: [players.a, players.b, players.c], fetch });
    expect(paired.ok, JSON.stringify(paired)).toBe(true);
    if (!paired.ok) return;
    const outcome = await runR16Scenario({ bridge, origin: ORIGIN, sessions: paired.sessions, players, nonce, fetch });
    const failures = outcome.results.filter((row) => row.result === 'FAIL');
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(summarizeR16(outcome.results)).toEqual({ passed: R16_CHECKS.length, failed: 0, missing: [], of: R16_CHECKS.length });
    const before = await readR16Views({ bridge, origin: ORIGIN, sessions: paired.sessions, players, nonce, fetch });

    // THE RESTART: the process dies, and with it every browser session.
    await stop();
    await start();
    const stale = await fetch(`${bridge}/wonderland/social/me`, { headers: { authorization: `Relay-Session ${paired.sessions[players.a]!}`, origin: ORIGIN } });
    expect(stale.status, 'a session from before the restart is gone with the process').toBe(401);
    const again = await pairR16Sessions({ bridge, origin: ORIGIN, operatorToken: OPERATOR, playerIds: [players.a, players.b, players.c], fetch });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const verified = await verifyR16Restart({ bridge, origin: ORIGIN, sessions: again.sessions, players, nonce, recorded: { views: before }, fetch });
    expect(verified.results.filter((row) => row.result === 'FAIL'), 'what was stored is shown as stored, and the world comes back').toEqual([]);
    expect(verified.results).toHaveLength(6);
    // A restart this quick is inside the lease, unless the machine is slow enough that it is not: either is a reconnect.
    expect(Object.values(verified.reconnect).every((outcome) => outcome === 'HELD' || outcome === 'REENTERED'), JSON.stringify(verified.reconnect)).toBe(true);
    // And the views are the substance, not empty answers that would trivially match.
    const viewsOfA = verified.views[players.a] as { me: { servers: unknown[] }; roster: { players: unknown[] } };
    expect(viewsOfA.me.servers).toHaveLength(1);
    expect(viewsOfA.roster.players.length).toBeGreaterThan(1);
  }, 120_000);

  it('the harness can fail: a leaked hidden player and a visible blocked conversation are reported as the rules they break', async () => {
    const leakNonce = randomBytes(4).toString('hex');
    const players = r16Players(leakNonce);
    const paired = await pairR16Sessions({ bridge, origin: ORIGIN, operatorToken: OPERATOR, playerIds: [players.a, players.b, players.c], fetch });
    if (!paired.ok) throw new Error(paired.reason);
    const tokenOf = Object.fromEntries(Object.entries(paired.sessions).map(([player, token]) => [token, player]));
    let lastConversation: unknown = null;
    /** A backend with two faults: C's roster shows the hidden A, and a conversation is shown whatever the block. */
    const leaky: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const url = String(input);
      const viewer = tokenOf[String((init?.headers as Record<string, string> | undefined)?.authorization ?? '').replace('Relay-Session ', '')];
      if (url.endsWith('/wonderland/social/roster') && viewer === players.c) {
        const body = await response.json() as { data: { available: boolean; population?: number; players?: { playerId: string }[] } };
        if (body.data.available && !body.data.players!.some((entry) => entry.playerId === players.a)) {
          body.data.players!.push({ playerId: players.a, displayName: null, dogId: 'corgi', location: null, activity: 'EXPLORING', relation: 'STRANGER', role: null } as never);
          body.data.population = body.data.players!.length;
        }
        return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/wonderland/social/conversations/')) {
        const body = await response.json() as { data: unknown[] };
        if (body.data.length > 0) lastConversation = body.data;
        else if (lastConversation !== null) body.data = lastConversation as unknown[];
        return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } });
      }
      return response;
    };
    const outcome = await runR16Scenario({ bridge, origin: ORIGIN, sessions: paired.sessions, players, nonce: leakNonce, fetch: leaky });
    const failed = outcome.results.filter((row) => row.result === 'FAIL').map((row) => row.name);
    expect(failed).toContain('P1: hidden from strangers removes the player from a stranger\'s roster and population');
    expect(failed).toContain('DM: a block hides the conversation from both sides and refuses a new message');
    // And nothing else: a fault is reported as the rule it breaks, not as noise.
    expect(failed.every((name) => name.startsWith('P1') || name.startsWith('DM') || name.startsWith('NO INFERENCE') || name.startsWith('PARTY'))).toBe(true);
  }, 120_000);

  it('the CLI runs the scenario, a real restart and the restart check, prints no credential, and exits 0', async () => {
    const state = join(root, 'r16-state.json');
    const cliNonce = randomBytes(4).toString('hex');
    const run = (args: readonly string[]) => spawnSync(process.execPath, ['scripts/wonderland-r16-harness.mjs', '--bridge', bridge, '--origin', ORIGIN, ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '', RELAY_BRIDGE_TOKEN: OPERATOR }, timeout: 60_000,
    });
    const scenario = run(['--state', state, '--nonce', cliNonce]);
    expect(scenario.status, scenario.stdout + scenario.stderr).toBe(0);
    expect(scenario.stdout).toContain(`R16 SUMMARY phase=scenario passed=${String(R16_CHECKS.length)} failed=0 of=${String(R16_CHECKS.length)}`);
    expect(scenario.stdout).toMatch(/^R16 VOICE (CONFIGURED|NOT_MOUNTED|NOT_CONFIGURED_\d+) /mu);
    // The restart the verify phase is about. Without it, its RESTART check fails: the boot id would be the scenario's.
    const address = bridge;
    await stop();
    await start(address);
    const verify = run(['--phase', 'verify', '--state', state]);
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
    expect(verify.stdout).toContain('R16 PASS RESTART');
    expect(verify.stdout).toContain('R16 SUMMARY phase=verify passed=7 failed=0 of=7 venue=REHEARSAL');
    expect(verify.stdout).toMatch(/^R16 RECONNECT (\S+=(HELD|REENTERED) ?){3}$/mu);
    for (const output of [scenario.stdout + scenario.stderr, verify.stdout + verify.stderr, readFileSync(state, 'utf8')]) {
      expect(output, 'the operator token never appears').not.toContain(OPERATOR);
      expect(output, 'no session token appears').not.toMatch(/Relay-Session|sessionToken|grantSecret/u);
    }
    const unconfigured = spawnSync(process.execPath, ['scripts/wonderland-r16-harness.mjs', '--bridge', bridge, '--origin', ORIGIN], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 30_000,
    });
    expect(unconfigured.status).toBe(2);
    expect(unconfigured.stdout).toContain('R16 BLOCKED — set RELAY_BRIDGE_TOKEN (scripted players) or WONDERLAND_R16_SESSIONS (three real players).');
  }, 180_000);

  it('the real bridge holds every player to a command budget: a flood of messages is refused past twenty, and nothing past it is stored', async () => {
    const players = r16Players(`f${nonce}`);
    const paired = await pairR16Sessions({ bridge, origin: ORIGIN, operatorToken: OPERATOR, playerIds: [players.a, players.b], fetch });
    if (!paired.ok) throw new Error(paired.reason);
    const as = (player: string) => async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${bridge}${path}`, {
        method,
        headers: { authorization: `Relay-Session ${paired.sessions[player]!}`, origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() as { data?: unknown; error?: { kind?: string } } };
    };
    const a = as(players.a);
    const b = as(players.b);
    await b('GET', '/wonderland/social/me');
    let sequence = 0;
    const send = (who: typeof a, command: unknown) => who('POST', '/wonderland/social/commands', { commandId: `flood-${nonce}-${String(++sequence)}`, command });
    await send(a, { kind: 'FRIEND_REQUEST', toId: players.b });
    await send(b, { kind: 'FRIEND_ACCEPT', fromId: players.a });
    const statuses: number[] = [];
    for (let index = 0; index < 24; index += 1) {
      const result = await send(a, { kind: 'SEND_MESSAGE', messageId: `m-${nonce}-${String(index)}`, toId: players.b, body: `n${String(index)}` });
      statuses.push(result.status);
      if (result.status === 429) {
        expect(result.body.error?.kind).toBe('rate_limited');
        expect(result.retryAfter, 'the standard header says when, for any HTTP client').toBe('3');
      }
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(20).every((status) => status === 429), JSON.stringify(statuses)).toBe(true);
    const conversation = await b('GET', `/wonderland/social/conversations/${players.a}`);
    expect(conversation.body.data as unknown[]).toHaveLength(20);
  }, 60_000);
});
