#!/usr/bin/env node
/**
 * R16 LOCAL REHEARSAL: the MAIN-LINE bridge on loopback, on a THROWAWAY database, with Wonderland social switched on.
 *
 *   node scripts/r16-local-bridge.mjs --db postgresql://postgres@127.0.0.1:<pg port>/sw_r16_<n> --port <p>
 *        ( --client-id-file <path>  |  --github-stub http://127.0.0.1:<port> )  [--tap <file>] [--no-build]
 *        [--eos-config <path to the founder's EOS .env>] [--room-salt-file <path outside the checkout>]
 *        [--eos-game-config <path to the founder's eos-game.env>]
 *   The PostgreSQL port is R16_THROWAWAY_PG_PORT (default 54329), as the stub fence and the migrate helper read it.
 *   --eos-config is passed to the bridge as WONDERLAND_EOS_VOICE_CONFIG: only its existence is checked here, never its content,
 *   and a path under .iwonder-secrets is never printed. --room-salt-file is created once (32 random bytes, hex) if absent,
 *   never overwritten, refused inside this checkout, and passed as WONDERLAND_EOS_ROOM_SALT_FILE.
 *   --eos-game-config is passed as WONDERLAND_EOS_GAME_CONFIG, checked the same way (existence only; a founder path is never
 *   printed): the bridge hands the GAME client's five EOS values to signed-in clients (GET .../social/voice/eos-client-config).
 *
 * What it refuses, before anything runs:
 *   - any database but the portable test PostgreSQL's sw_r16_<n> on 127.0.0.1:54329 -- never Julius's live store;
 *   - every inherited *DATABASE_URL* and PG* variable is dropped from the child's environment, and so are the GitHub App's
 *     client secret and the operator token (the device flow needs neither); NODE_ENV is `development`;
 *   - the bridge binds 127.0.0.1 only.
 * The GitHub App client id (public, but the founder's) is READ from the file named, and never printed. With --github-stub
 * the bridge talks to the loopback stub instead (scripts/github-device-stub.mjs) and its identities are NOT REAL: progress
 * evidence only, never R16's.
 *
 * Steps: create the database if absent -> build the bridge and the migrate helper (esbuild, unless --no-build) -> migrate
 * that database (scripts/r16-migrate-throwaway.ts) -> run the bridge in the foreground until Ctrl+C.
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The checkout this launcher lives in: nothing it generates may be written inside it. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The throwaway PostgreSQL port: R16_THROWAWAY_PG_PORT (unset or empty = 54329, CORE's default), the same rule as the stub
 * fence (relay-bridge/wonderland-github-stub-seam.ts) and the migrate helper -- an unprivileged port, never 5432.
 */
export function throwawayPgPort(env = process.env) {
  const raw = (env.R16_THROWAWAY_PG_PORT ?? '').trim();
  if (raw === '') return 54329;
  const port = /^\d{4,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
    throw new Error('R16_THROWAWAY_PG_PORT must be an unprivileged loopback port other than 5432');
  }
  return port;
}

/** The only database the rehearsal may use: 127.0.0.1 on the throwaway port, a database named sw_r16_<n>. */
export function throwawayDatabase(env = process.env) {
  return new RegExp(`^postgresql://postgres@127\\.0\\.0\\.1:${throwawayPgPort(env)}/sw_r16_\\d{1,6}$`);
}

/** CORE's default fence, unchanged: 127.0.0.1:54329, sw_r16_<n>. */
export const R16_THROWAWAY_DATABASE = throwawayDatabase({});
const STUB_URL = /^http:\/\/127\.0\.0\.1:(\d{4,5})\/?$/;

export function parseArgs(argv, env = process.env) {
  const out = { db: null, port: null, clientIdFile: null, githubStub: null, tap: null, build: true, eosConfig: null, eosGameConfig: null, roomSaltFile: null, pgPort: throwawayPgPort(env) };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
      i += 1;
      return next;
    };
    if (flag === '--db') out.db = value();
    else if (flag === '--port') out.port = Number.parseInt(value(), 10);
    else if (flag === '--client-id-file') out.clientIdFile = value();
    else if (flag === '--github-stub') out.githubStub = value();
    else if (flag === '--tap') out.tap = value();
    else if (flag === '--no-build') out.build = false;
    else if (flag === '--eos-config') out.eosConfig = value();
    else if (flag === '--eos-game-config') out.eosGameConfig = value();
    else if (flag === '--room-salt-file') out.roomSaltFile = value();
    else throw new Error(`unknown argument ${flag}`);
  }
  if (out.db === null || !throwawayDatabase(env).test(out.db)) {
    throw new Error(`--db must be postgresql://postgres@127.0.0.1:${out.pgPort}/sw_r16_<n> (the throwaway rehearsal database, nothing else)`);
  }
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535 || out.port === out.pgPort) throw new Error('--port must be 1024-65535 (not the database port)');
  if ((out.clientIdFile === null) === (out.githubStub === null)) throw new Error('give exactly one of --client-id-file or --github-stub');
  if (out.githubStub !== null && !STUB_URL.test(out.githubStub)) throw new Error('--github-stub must be http://127.0.0.1:<port>');
  return out;
}

/**
 * Never inherited from the parent: anything database-, store- or credential-shaped -- every EOS_* variable (the founder's EOS
 * values must reach the bridge only through the FILE it is pointed at), every secret, token, password or API key, the live
 * Julius store, and the launcher's own path variables (set below by exact name from the arguments, never passed through).
 */
const NEVER_INHERITED = [
  /DATABASE_URL/i, /STORE_URL/i, /^JULIUS_/i, /^PG[A-Z_]*$/i, /^EOS_/i, /SECRET/i, /TOKEN/i, /PASSWORD/i, /API_KEY/i,
  /^ANTHROPIC/i, /^OPENAI/i, /^XAI/i, /^CLAUDE_CODE_OAUTH/i, /^WONDERLAND_EOS_/i, /^R16_THROWAWAY_PG_PORT$/i,
];

/** The child's environment: nothing database- or credential-shaped is inherited; the rehearsal's own values are set. */
export function childEnv(parent, settings) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (NEVER_INHERITED.some((re) => re.test(key))) continue;
    if (key === 'NODE_ENV') continue;
    if (/^WONDERLAND_SOCIAL_/.test(key) || /^RELAY_(GITHUB_APP_CLIENT_ID|BRIDGE_HOST|BRIDGE_PORT|DATA_DIR|STATE_HOME)$/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: 'development',
    JULIUS_DATABASE_URL: settings.db,
    WONDERLAND_SOCIAL_ENABLED: '1',
    RELAY_BRIDGE_HOST: '127.0.0.1',
    RELAY_BRIDGE_PORT: String(settings.port),
    RELAY_GITHUB_APP_CLIENT_ID: settings.clientId,
    RELAY_DATA_DIR: settings.dataDir,
    // a fresh operator token nobody knows: the rehearsal never needs operator routes
    RELAY_BRIDGE_API_TOKEN: randomBytes(32).toString('base64url'),
  });
  if (settings.githubStub) env.WONDERLAND_SOCIAL_GITHUB_STUB = settings.githubStub;
  if (settings.tap) env.WONDERLAND_SOCIAL_TAP = settings.tap;
  // BY EXACT NAME, from the arguments only: the fences' port, and the EOS PATHS (never an EOS value)
  env.R16_THROWAWAY_PG_PORT = String(settings.pgPort ?? 54329);
  if (settings.eosConfig) env.WONDERLAND_EOS_VOICE_CONFIG = settings.eosConfig;
  if (settings.eosGameConfig) env.WONDERLAND_EOS_GAME_CONFIG = settings.eosGameConfig;
  if (settings.roomSaltFile) env.WONDERLAND_EOS_ROOM_SALT_FILE = settings.roomSaltFile;
  return env;
}

const SECRETS_DIR = /[\\/]\.iwonder-secrets([\\/]|$)/i;

/**
 * --eos-config: only that the file EXISTS is checked -- it is never opened, read or printed here (the bridge reads it). A path
 * under the founder's .iwonder-secrets folder is never printed either.
 */
export function checkEosConfig(path, exists = existsSync, what = 'EOS config') {
  const secret = SECRETS_DIR.test(path);
  if (!exists(path)) throw new Error(secret ? `the ${what} file is missing` : `the ${what} file is missing: ${path}`);
  return secret ? `${what}: the founder's file (path not printed)` : `${what}: ${path}`;
}

/**
 * --room-salt-file: created ONCE (32 random bytes as hex, mode 0o600 best effort) and never overwritten; refused inside this
 * checkout. Not a founder credential; its content is never read or printed here.
 */
export function ensureRoomSaltFile(path, repoRoot = REPO_ROOT) {
  const abs = resolve(path);
  const rel = relative(resolve(repoRoot), abs);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('--room-salt-file must be outside the repository checkout');
  if (existsSync(abs)) return { path: abs, created: false };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  return { path: abs, created: true };
}

function readClientId(path) {
  const id = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(id)) throw new Error('the client id file does not hold one GitHub App client id');
  return id;
}

/** The admin connection that creates the rehearsal database: loopback, on the throwaway port only. */
export function adminDatabaseUrl(pgPort) {
  return `postgresql://postgres@127.0.0.1:${pgPort}/postgres`;
}

async function ensureDatabase(db, pgPort) {
  const name = db.slice(db.lastIndexOf('/') + 1);
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: adminDatabaseUrl(pgPort) });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name}"`); // the name was matched to sw_r16_<digits> above
      console.log(`r16: created ${name}`);
    } else console.log(`r16: ${name} exists (reused)`);
  } finally {
    await admin.end();
  }
}

function step(label, command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, cwd: process.cwd() });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args.githubStub !== null ? 'stub-client-id' : readClientId(resolve(args.clientIdFile));
  let eosConfig = null;
  let roomSaltFile = null;
  if (args.eosConfig !== null) {
    console.log(`r16: ${checkEosConfig(args.eosConfig)}`);
    eosConfig = resolve(args.eosConfig);
  }
  let eosGameConfig = null;
  if (args.eosGameConfig !== null) {
    console.log(`r16: ${checkEosConfig(args.eosGameConfig, existsSync, 'EOS game config')}`);
    eosGameConfig = resolve(args.eosGameConfig);
  }
  if (args.roomSaltFile !== null) {
    const salt = ensureRoomSaltFile(args.roomSaltFile);
    roomSaltFile = salt.path;
    console.log(`r16: room salt file ${salt.created ? 'created' : 'kept'}: ${salt.path}`);
  }
  const env = childEnv(process.env, { db: args.db, port: args.port, clientId, githubStub: args.githubStub, tap: args.tap, dataDir: mkdtempSync(join(tmpdir(), 'r16-bridge-')), pgPort: args.pgPort, eosConfig, eosGameConfig, roomSaltFile });
  await ensureDatabase(args.db, args.pgPort);
  if (args.build) {
    const esbuild = join('node_modules', 'esbuild', 'bin', 'esbuild');
    step('bridge build', process.execPath, [esbuild, 'relay-bridge/server.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=dist-relay-bridge/server.cjs', '--external:@anthropic-ai/claude-agent-sdk', '--external:pg', '--log-level=warning'], env);
    step('migrate helper build', process.execPath, [esbuild, 'scripts/r16-migrate-throwaway.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=dist-relay-bridge/r16-migrate-throwaway.cjs', '--external:pg', '--log-level=warning'], env);
  }
  step('migrate', process.execPath, ['dist-relay-bridge/r16-migrate-throwaway.cjs'], env);
  console.log(`r16: MAIN-LINE BRIDGE on http://127.0.0.1:${args.port} | database ${args.db.slice(args.db.lastIndexOf('/') + 1)} (throwaway) | social ON | sign-in ${args.githubStub ? 'GITHUB STUB (identities NOT real)' : 'GitHub device flow'}${args.tap ? ' | tap ON' : ''} | EOS voice ${eosConfig !== null ? 'configured' : 'off (503)'} | EOS client config ${eosGameConfig !== null ? 'configured' : 'off (503)'}`);
  const bridge = spawn(process.execPath, ['dist-relay-bridge/server.cjs'], { stdio: 'inherit', env, cwd: process.cwd() });
  const stop = () => bridge.kill('SIGINT');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  bridge.on('exit', (code) => process.exit(code ?? 0));
}

const entry = process.argv[1] === undefined ? '' : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(`r16: ${error instanceof Error ? error.message : 'failed'}`);
    process.exit(2);
  });
}
