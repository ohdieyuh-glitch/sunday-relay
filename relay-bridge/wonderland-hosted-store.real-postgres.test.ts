import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { WONDERLAND_MIGRATIONS } from '../src/relay/persistence/wonderland-postgres';
import {
  inspectR16Host, judgeR16Venue, pairR16Sessions, r16Players, r16RestartCheck, readR16Backend, readR16Views, R16_CHECKS, runR16Scenario,
  summarizeR16, verifyR16Restart,
} from '../scripts/wonderland-r16-harness.mjs';
import {
  bootstrapWonderlandStore, classifyWonderlandStore, fingerprintWonderlandStore, WONDERLAND_STORE_BOOTSTRAP_PHRASE,
} from './wonderland-store';
import { WONDERLAND_SHIPPED_CHAIN } from './wonderland-store-readiness';

/**
 * THE HOSTED WONDERLAND STORE, REHEARSED FROM NOTHING ON REAL POSTGRESQL.
 *
 * The hosted bridge never migrates at boot, so its store is brought up by
 * `relay-bridge/wonderland-store.ts` alone. This rehearses that procedure
 * exactly as the hosted run will use it, on throwaway databases:
 *   - an EMPTY database is marked, migrated through the shipped chain, and
 *     fingerprinted, and its fingerprint equals a reference built by applying
 *     the same SQL files directly;
 *   - every database it must not touch is REFUSED by name, writing nothing: the
 *     permanent store's case (content, no marker), a gap in the ledger, a stamp
 *     ahead of this build, a foreign schema;
 *   - the real bridge PROCESS, pointed at the bootstrapped store, reports itself
 *     ready to an operator (and to nobody else), with the commit its platform
 *     attests and a boot that changes on restart; then serves the whole R16
 *     scenario, survives a restart, and passes the split restart check, while
 *     the venue is judged a REHEARSAL for exactly what makes it one;
 *   - the built CLI does the same from the command line, and never prints or
 *     records the database URL.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const ROOT = resolve(process.cwd());
const FINGERPRINT = join(ROOT, 'docs', 'julius-migrations', '030', 'fingerprint-store.sql');
const OPERATOR = `op-${randomBytes(16).toString('hex')}`;
const ORIGIN = 'https://hosted-store.relay.test';
/** The commit a platform would attest: Railway sets RAILWAY_GIT_COMMIT_SHA on a deployment it built. */
const COMMIT = 'c0ffee'.padEnd(40, '0');

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

suite('the hosted Wonderland store, from nothing, on real PostgreSQL', () => {
  const nonce = randomBytes(4).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const urls = new Map<string, string>();
  let root = '';
  let bridgeBundle = '';
  let storeBundle = '';
  const children: ChildProcess[] = [];

  /** An empty database (CREATE DATABASE and nothing else), and its own pool. */
  const empty = async (label: string): Promise<Pool> => {
    const name = `whs${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    urls.set(label, url.toString());
    const pool = new Pool({ connectionString: url.toString(), max: 4 });
    pool.on('error', () => undefined);
    made.push({ name, pool });
    return pool;
  };
  const bootstrap = (pool: Pool, over: { confirm?: string; treeClean?: boolean } = {}) => bootstrapWonderlandStore({
    pool, confirm: 'confirm' in over ? over.confirm : WONDERLAND_STORE_BOOTSTRAP_PHRASE,
    treeClean: over.treeClean ?? true, fingerprintScript: FINGERPRINT,
  });
  const marker = async (pool: Pool): Promise<string | null> => (await pool.query<{ m: string | null }>(
    "SELECT shobj_description(d.oid, 'pg_database') AS m FROM pg_database d WHERE d.datname = current_database()")).rows[0]?.m ?? null;
  const schemas = async (pool: Pool): Promise<string[]> => (await pool.query<{ nspname: string }>(
    "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname !~ '^pg_' ORDER BY 1")).rows.map((row) => row.nspname);

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    root = mkdtempSync(join(tmpdir(), 'hosted-store-'));
    bridgeBundle = join(root, 'server.cjs');
    storeBundle = join(root, 'wonderland-store.cjs');
    const { build } = await import('esbuild');
    await build({
      entryPoints: [join(ROOT, 'relay-bridge/server.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bridgeBundle,
      external: ['@anthropic-ai/claude-agent-sdk', 'pg'], logLevel: 'error',
    });
    await build({
      entryPoints: [join(ROOT, 'relay-bridge/wonderland-store.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: storeBundle,
      external: ['pg'], logLevel: 'error',
    });
  }, 120_000);

  afterAll(async () => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    for (const { name, pool } of made) {
      await pool.end().catch(() => undefined);
      await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    }
    await admin?.end();
    if (root !== '') rmSync(root, { recursive: true, force: true });
  }, 120_000);

  it('an EMPTY database is marked, migrated through the shipped chain and fingerprinted, exactly as a reference built from the same files', async () => {
    const pool = await empty('fresh');
    expect(await classifyWonderlandStore(pool)).toEqual({ kind: 'EMPTY' });

    // Refused before a write: no phrase, then a dirty tree.
    for (const over of [{ confirm: undefined }, { confirm: 'bootstrap the hosted wonderland store' }, { treeClean: false }]) {
      const refused = await bootstrap(pool, over);
      expect(refused.result, JSON.stringify(over)).toBe('REFUSED');
      expect(await marker(pool)).toBeNull();
      expect(await schemas(pool)).toEqual([]);
    }

    const done = await bootstrap(pool);
    expect(done.result, done.lines.join('\n')).toBe('PASS');
    expect(await marker(pool)).toMatch(/^relay-wonderland-hosted-store:[0-9a-f-]{36}$/u);
    const after = await classifyWonderlandStore(pool);
    expect(after.kind).toBe('HOSTED_STORE');
    expect(after.kind === 'HOSTED_STORE' && after.ledger).toMatchObject({
      applied: WONDERLAND_SHIPPED_CHAIN.length, expected: WONDERLAND_SHIPPED_CHAIN.length, through: WONDERLAND_SHIPPED_CHAIN.at(-1), gapFree: true, unknown: [],
    });

    // A second bootstrap finds nothing pending and changes nothing.
    const again = await bootstrap(pool);
    expect(again.result).toBe('PASS');
    expect(again.fingerprint).toEqual(done.fingerprint);

    // The reference: the same files applied directly, one by one, on a database this tool never touched.
    const reference = await empty('ref');
    for (const sql of WONDERLAND_MIGRATIONS) await reference.query(sql);
    const expected = await fingerprintWonderlandStore(reference, FINGERPRINT);
    expect(done.fingerprint).toEqual(expected);
    expect(done.fingerprint!.lines).toBeGreaterThan(100);
  }, 120_000);

  it('every database it must not touch is refused by name, and nothing is written', async () => {
    const migrated = async (label: string): Promise<Pool> => {
      const pool = await empty(label);
      for (const sql of WONDERLAND_MIGRATIONS) await pool.query(sql);
      return pool;
    };
    const mark = (pool: Pool) => pool.query(
      `DO $m$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'relay-wonderland-hosted-store:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}'); END $m$`);

    // THE PERMANENT STORE'S CASE: a migrated store with content, and no marker this tool wrote.
    const permanent = await migrated('perm');
    await permanent.query("INSERT INTO relay_wonderland.players(player_id) VALUES('someone-real')");
    const beforePrint = await fingerprintWonderlandStore(permanent, FINGERPRINT);
    const refusedPermanent = await bootstrap(permanent);
    expect(refusedPermanent.lines.at(-1)).toMatch(/^REFUSED NOT_EMPTY_NOT_MARKED — .+; nothing was written$/u);
    expect(await marker(permanent)).toBeNull();
    expect(await fingerprintWonderlandStore(permanent, FINGERPRINT)).toEqual(beforePrint);
    expect((await permanent.query('SELECT 1 FROM relay_wonderland.players')).rowCount).toBe(1);

    // A marked store with a gap in its ledger, one with a stamp from the future, and one holding a foreign schema.
    const gapped = await migrated('gap');
    await mark(gapped);
    await gapped.query('DELETE FROM relay_wonderland.schema_migrations WHERE version = $1', [WONDERLAND_SHIPPED_CHAIN[5]]);
    const ahead = await migrated('ahead');
    await mark(ahead);
    await ahead.query("INSERT INTO relay_wonderland.schema_migrations(version) VALUES('099_from_a_later_build')");
    const foreign = await migrated('foreign');
    await mark(foreign);
    await foreign.query('CREATE SCHEMA someone_elses');
    for (const [pool, reason] of [[gapped, 'LEDGER_NOT_A_PREFIX'], [ahead, 'AHEAD_OF_THIS_BUILD'], [foreign, 'NOT_EMPTY_NOT_MARKED']] as const) {
      const classified = await classifyWonderlandStore(pool);
      expect(classified.kind === 'REFUSED' && classified.reason).toBe(reason);
      const before = await fingerprintWonderlandStore(pool, FINGERPRINT);
      expect((await bootstrap(pool)).result).toBe('REFUSED');
      expect(await fingerprintWonderlandStore(pool, FINGERPRINT), `${reason}: nothing was written`).toEqual(before);
    }
  }, 120_000);

  it('the real bridge process on the bootstrapped store: ready to an operator only, then the whole R16 scenario, a restart and the split restart check, judged a REHEARSAL by name', async () => {
    const pool = await empty('live');
    expect((await bootstrap(pool)).result).toBe('PASS');

    let bridge = '';
    let child: ChildProcess | null = null;
    const start = async (env: Record<string, string>, reuse?: string): Promise<void> => {
      // A restart keeps its address, as a hosted backend does; a new start takes a free port.
      const port = reuse === undefined ? await freePort() : Number(new URL(reuse).port);
      bridge = `http://127.0.0.1:${String(port)}`;
      const started = spawn(process.execPath, [bridgeBundle], {
        env: {
          PATH: process.env.PATH ?? '', NODE_PATH: join(ROOT, 'node_modules'), RELAY_BRIDGE_API_TOKEN: OPERATOR, RELAY_ALLOWED_ORIGINS: ORIGIN,
          RELAY_BRIDGE_PORT: String(port), RELAY_BRIDGE_HOST: '127.0.0.1', RELAY_DATA_DIR: join(root, `state-${String(port)}`), ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(started);
      child = started;
      await new Promise<void>((done, fail) => {
        let output = '';
        const timer = setTimeout(() => fail(new Error(`the bridge did not start: ${output}`)), 20_000);
        const listen = (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.includes('Relay bridge listening')) { clearTimeout(timer); done(); } };
        started.stdout?.on('data', listen);
        started.stderr?.on('data', listen);
        started.once('exit', (code) => { clearTimeout(timer); fail(new Error(`the bridge exited ${String(code)}: ${output}`)); });
      });
    };
    const stop = async (): Promise<void> => {
      const running = child as ChildProcess | null;
      child = null;
      if (running !== null && running.exitCode === null) {
        await new Promise<void>((done) => { running.once('exit', () => done()); running.kill('SIGTERM'); });
      }
    };
    // The deploy check, as an operator runs it after a deploy: reads only. The rows it FAILED, by their check's name.
    const deployCheck = (expectCommit: string) => spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'wonderland-deploy-check.mjs'), '--bridge', bridge, '--origin', ORIGIN, '--expect-commit', expectCommit,
    ], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '', RELAY_BRIDGE_TOKEN: OPERATOR } });
    const failedChecks = (run: { stdout: string }) => run.stdout.split('\n').filter((line) => line.startsWith('DEPLOY FAIL '))
      .map((line) => line.slice('DEPLOY FAIL '.length).split(':')[0]);
    const readiness = async (authorization?: string) => {
      const response = await fetch(`${bridge}/relay-api/wonderland/readiness`, { headers: authorization === undefined ? {} : { authorization } });
      return { status: response.status, body: await response.json() as { data?: Record<string, unknown> } };
    };

    // No database: a fact, by variable name. The bridge still says which build and which start it is: no platform attested this one.
    await start({});
    expect((await readiness(`Bearer ${OPERATOR}`)).body.data).toMatchObject({
      database: { state: 'NOT_CONFIGURED', missingConfig: ['JULIUS_DATABASE_URL', 'DATABASE_URL'] }, ledger: null, surfaces: { social: 'UNKNOWN' },
      bridge: { commit: null, attestedBy: null, production: false, bootId: expect.stringMatching(/^[0-9a-f]{32}$/u) },
    });
    // A bridge with no store, no attested build and the development gates: the deploy check says exactly that.
    const bare = deployCheck(COMMIT);
    expect(failedChecks(bare)).toEqual(['HOSTED', 'BUILD', 'PRODUCTION', 'STORE', 'SOCIAL']);
    expect(bare.status).toBe(1);
    await stop();

    // A database that does not answer: a code, never the driver's text.
    const closed = new URL(urls.get('live')!);
    closed.port = String(await freePort());
    await start({ JULIUS_DATABASE_URL: closed.toString() });
    const unreachable = await readiness(`Bearer ${OPERATOR}`);
    expect(unreachable.body.data).toMatchObject({ database: { state: 'UNREACHABLE', reason: 'ECONNREFUSED' }, ledger: null });
    expect(JSON.stringify(unreachable.body)).not.toContain(closed.hostname);
    await stop();

    // The bootstrapped store, run the way Railway runs the bridge: a build its platform attests, and the production branch
    // of every gate (Railway's own marker, and NODE_ENV=production, which also arms the boot refusals).
    const live = { JULIUS_DATABASE_URL: urls.get('live')!, RAILWAY_GIT_COMMIT_SHA: COMMIT, RAILWAY_ENVIRONMENT: 'production', NODE_ENV: 'production' };
    await start(live);
    expect((await readiness()).status, 'no credential: nothing').toBe(401);
    expect((await readiness('Bearer not-the-operator')).status).toBe(401);
    const ready = await readiness(`Bearer ${OPERATOR}`);
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({
      version: 'wonderland-store-readiness.v1',
      database: { state: 'CONNECTED' },
      ledger: { applied: WONDERLAND_SHIPPED_CHAIN.length, expected: WONDERLAND_SHIPPED_CHAIN.length, through: WONDERLAND_SHIPPED_CHAIN.at(-1), gapFree: true, pending: [], unknown: [] },
      surfaces: { social: 'READY', voiceSchema: 'NOT_APPLIED', eosClientConfig: 'NOT_CONFIGURED', eosTrustedServer: 'NOT_CONFIGURED' },
      sessions: 'IN_MEMORY_REVOKED_ON_RESTART',
      bridge: { commit: COMMIT, attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: true, bootId: expect.stringMatching(/^[0-9a-f]{32}$/u) },
    });
    expect(Date.parse(String((ready.body.data!.bridge as { startedAt: string }).startedAt))).not.toBeNaN();
    expect(JSON.stringify(ready.body)).not.toContain(new URL(urls.get('live')!).password || 'no-password-in-url');

    // THE DEPLOY CHECK on the bridge as Railway runs it. Only the address keeps it from passing whole: loopback over HTTP is not a
    // hosted bridge. It writes nothing: the store's fingerprint is the same after it as before.
    const unwritten = await fingerprintWonderlandStore(pool, FINGERPRINT);
    const deployed = deployCheck(COMMIT);
    expect(failedChecks(deployed), deployed.stdout).toEqual(['HOSTED']);
    expect(deployed.stdout).toContain('DEPLOY SUMMARY passed=7 failed=1 of=8');
    expect(deployed.stdout).toContain('DEPLOY REPORTED voice_schema=NOT_APPLIED eos_client_config=NOT_CONFIGURED eos_trusted_server=NOT_CONFIGURED boot=');
    expect(deployed.status).toBe(1);
    expect(failedChecks(deployCheck('d'.repeat(40))), 'another commit is another build').toEqual(['HOSTED', 'BUILD']);
    expect(deployed.stdout + deployed.stderr).not.toContain(OPERATOR);
    expect(await fingerprintWonderlandStore(pool, FINGERPRINT), 'the deploy check wrote nothing').toEqual(unwritten);

    // The whole R16 scenario on it, a restart, and the split restart check.
    const players = r16Players(nonce);
    const paired = await pairR16Sessions({ bridge, origin: ORIGIN, operatorToken: OPERATOR, playerIds: [players.a, players.b, players.c], fetch });
    if (!paired.ok) throw new Error(paired.reason);
    const outcome = await runR16Scenario({ bridge, origin: ORIGIN, sessions: paired.sessions, players, nonce, fetch });
    expect(outcome.results.filter((row) => row.result === 'FAIL')).toEqual([]);
    expect(summarizeR16(outcome.results)).toEqual({ passed: R16_CHECKS.length, failed: 0, missing: [], of: R16_CHECKS.length });
    const before = await readR16Views({ bridge, origin: ORIGIN, sessions: paired.sessions, players, nonce, fetch });

    // THE VENUE. Every privacy check passed under the production gates, and this is still a rehearsal, for exactly these reasons:
    // the commit is attested and expected, the gates are production's, and the store is connected, current and social-ready, so
    // none of those is one. A loopback host is never looked up.
    const neverLookedUp = async (): Promise<string[]> => { throw new Error('a loopback host is never looked up'); };
    const host = await inspectR16Host(bridge, neverLookedUp);
    const backendBefore = await readR16Backend({ bridge, operatorToken: OPERATOR, fetch });
    expect(backendBefore).toMatchObject({ readable: true, commit: COMMIT, production: true, database: 'CONNECTED', social: 'READY' });
    expect(outcome.names, 'paired players carry no verified sign-in').toEqual({ [players.a]: null, [players.b]: null, [players.c]: null });
    const venue = judgeR16Venue({ phase: 'scenario', bridge, host, identities: { source: 'SCRIPTED', names: outcome.names }, backend: backendBefore, expectCommit: COMMIT });
    expect(venue).toEqual({ venue: 'REHEARSAL', reasons: ['NOT_HTTPS', 'HOST_NOT_PUBLIC', 'SCRIPTED_PLAYERS', 'PLAYERS_NOT_VERIFIED'] });
    // Not restarted: the same start answers, and the restart check says so.
    expect(r16RestartCheck(backendBefore, await readR16Backend({ bridge, operatorToken: OPERATOR, fetch }))).toMatchObject({ result: 'FAIL' });

    const address = bridge;
    await stop();
    await start(live, address);
    expect(bridge, 'the restart kept its address').toBe(address);
    const backendAfter = await readR16Backend({ bridge, operatorToken: OPERATOR, fetch });
    expect(backendAfter).toMatchObject({ readable: true, commit: COMMIT });
    expect(r16RestartCheck(backendBefore, backendAfter)).toEqual({ name: expect.any(String), result: 'PASS', detail: '' });
    const again = await pairR16Sessions({ bridge, origin: ORIGIN, operatorToken: OPERATOR, playerIds: [players.a, players.b, players.c], fetch });
    if (!again.ok) throw new Error(again.reason);
    const verified = await verifyR16Restart({ bridge, origin: ORIGIN, sessions: again.sessions, players, nonce, recorded: { views: before }, fetch });
    expect(verified.results.filter((row) => row.result === 'FAIL')).toEqual([]);
    expect(verified.results).toHaveLength(6);
    // The verify phase's venue: restarted, same build, same bridge; a rehearsal because its scenario was one.
    expect(judgeR16Venue({
      phase: 'verify', bridge, host, identities: { source: 'SCRIPTED', names: null }, backend: backendAfter, expectCommit: COMMIT,
      recorded: { bridge: new URL(address).origin, backend: backendBefore, venue },
    })).toEqual({ venue: 'REHEARSAL', reasons: ['NOT_HTTPS', 'HOST_NOT_PUBLIC', 'SCRIPTED_PLAYERS', 'SCENARIO_NOT_FINAL'] });

    // THE CLI, as an operator runs it. `--final` refuses a rehearsal however clean its checks; a verify phase with no restart fails
    // its RESTART check; after a real restart it passes, 7 of 7.
    const harness = (args: readonly string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'wonderland-r16-harness.mjs'), '--bridge', bridge, '--origin', ORIGIN, ...args], {
      encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '', RELAY_BRIDGE_TOKEN: OPERATOR },
    });
    const state = join(root, `r16-cli-${nonce}.json`);
    const scenario = harness(['--state', state, '--expect-commit', COMMIT, '--final']);
    expect(scenario.stdout).toContain(`R16 SUMMARY phase=scenario passed=${String(R16_CHECKS.length)} failed=0 of=${String(R16_CHECKS.length)} venue=REHEARSAL`);
    expect(scenario.stdout).toContain('R16 VENUE REHEARSAL reasons=NOT_HTTPS,HOST_NOT_PUBLIC,SCRIPTED_PLAYERS,PLAYERS_NOT_VERIFIED\n');
    expect(scenario.stdout).toContain(`R16 BACKEND commit=${COMMIT} attested_by=RAILWAY_GIT_COMMIT_SHA production=true`);
    expect(scenario.stdout).toContain('R16 FINAL REFUSED');
    expect(scenario.status, '--final and a rehearsal: exit 1').toBe(1);
    expect(scenario.stdout + scenario.stderr).not.toContain(OPERATOR);
    const recorded = JSON.parse(readFileSync(state, 'utf8')) as { bridge: string; backend: { bootId: string; commit: string }; venue: { venue: string } };
    expect(recorded).toMatchObject({ bridge: new URL(bridge).origin, backend: { commit: COMMIT }, venue: { venue: 'REHEARSAL' } });
    const unrestarted = harness(['--phase', 'verify', '--state', state, '--expect-commit', COMMIT]);
    expect(unrestarted.stdout).toContain('R16 FAIL RESTART');
    expect(unrestarted.stdout).toContain('this backend did not restart');
    expect(unrestarted.status).toBe(1);
    await stop();
    await start(live, address);
    const restarted = harness(['--phase', 'verify', '--state', state, '--expect-commit', COMMIT]);
    expect(restarted.stdout).toContain('R16 PASS RESTART');
    expect(restarted.stdout).toContain('R16 SUMMARY phase=verify passed=7 failed=0 of=7 venue=REHEARSAL');
    expect(restarted.stdout).toContain('reasons=NOT_HTTPS,HOST_NOT_PUBLIC,SCRIPTED_PLAYERS,SCENARIO_NOT_FINAL\n');
    expect(restarted.status, 'no --final: the checks decide').toBe(0);
    await stop();
  }, 300_000);

  it('the built CLI inspects and bootstraps from the command line, and never prints or records the database URL', async () => {
    await empty('cli');
    const url = urls.get('cli')!;
    // The checkout facts come from git; a git on PATH that reports a fixed commit and a clean or dirty tree makes them deterministic.
    const fakeGit = (dirty: boolean): string => {
      const dir = mkdtempSync(join(root, 'git-'));
      writeFileSync(join(dir, 'git'), `#!/bin/sh\ncase "$1" in\n  rev-parse) echo ${'c'.repeat(40)} ;;\n  status) ${dirty ? 'echo " M somewhere.ts"' : 'true'} ;;\nesac\n`);
      chmodSync(join(dir, 'git'), 0o755);
      return dir;
    };
    const record = join(root, 'record');
    mkdirSync(record, { recursive: true });
    const cli = (args: readonly string[], git: string) => spawnSync(process.execPath, [storeBundle, ...args], {
      encoding: 'utf8', timeout: 60_000,
      env: { PATH: `${git}:${process.env.PATH ?? ''}`, NODE_PATH: join(ROOT, 'node_modules'), HOSTED_STORE_URL: url },
    });
    const clean = fakeGit(false);

    const inspected = cli(['inspect', '--database-env', 'HOSTED_STORE_URL'], clean);
    expect(inspected.status, inspected.stdout + inspected.stderr).toBe(0);
    expect(inspected.stdout).toContain('database: CONNECTED');
    expect(inspected.stdout).toContain('classification: EMPTY');

    const dirty = cli(['bootstrap', '--database-env', 'HOSTED_STORE_URL', '--repo', ROOT, '--record', record, '--confirm', WONDERLAND_STORE_BOOTSTRAP_PHRASE], fakeGit(true));
    expect(dirty.status).toBe(2);
    expect(dirty.stdout).toContain('REFUSED TREE_DIRTY');

    const done = cli(['bootstrap', '--database-env', 'HOSTED_STORE_URL', '--repo', ROOT, '--record', record, '--confirm', WONDERLAND_STORE_BOOTSTRAP_PHRASE], clean);
    expect(done.status, done.stdout + done.stderr).toBe(0);
    expect(done.stdout).toMatch(/^RESULT: PASS /mu);
    const recorded = readFileSync(join(record, 'RECORD.txt'), 'utf8');
    expect(recorded).toContain(`commit=${'c'.repeat(40)}`);
    expect(recorded).toContain('tree_clean=true');
    expect(recorded).toMatch(/^fingerprint: sha256=[0-9a-f]{64} lines=\d+ role_neutral_sha256=[0-9a-f]{64}$/mu);
    for (const text of [inspected.stdout, dirty.stdout, done.stdout, recorded]) {
      expect(text, 'the URL is never printed or recorded').not.toContain(url);
      expect(text).not.toContain(new URL(url).host);
    }

    const unset = spawnSync(process.execPath, [storeBundle, 'inspect', '--database-env', 'NOT_SET_ANYWHERE'], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_PATH: join(ROOT, 'node_modules') },
    });
    expect(unset.status).toBe(1);
    expect(unset.stdout).toContain('BLOCKED NOT_SET_ANYWHERE is not set: no database was contacted');
  }, 120_000);
});
