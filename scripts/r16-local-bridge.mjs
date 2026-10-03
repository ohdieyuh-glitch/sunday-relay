#!/usr/bin/env node
/**
 * R16 LOCAL REHEARSAL: the MAIN-LINE bridge on loopback, on a THROWAWAY database, with Wonderland social switched on.
 *
 *   node scripts/r16-local-bridge.mjs --db postgresql://postgres@127.0.0.1:54329/sw_r16_<n> --port <p>
 *        ( --client-id-file <path>  |  --github-stub http://127.0.0.1:<port> )  [--tap <file>] [--no-build]
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
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const R16_THROWAWAY_DATABASE = /^postgresql:\/\/postgres@127\.0\.0\.1:54329\/sw_r16_\d{1,6}$/;
const STUB_URL = /^http:\/\/127\.0\.0\.1:(\d{4,5})\/?$/;

export function parseArgs(argv) {
  const out = { db: null, port: null, clientIdFile: null, githubStub: null, tap: null, build: true };
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
    else throw new Error(`unknown argument ${flag}`);
  }
  if (out.db === null || !R16_THROWAWAY_DATABASE.test(out.db)) {
    throw new Error('--db must be postgresql://postgres@127.0.0.1:54329/sw_r16_<n> (the throwaway rehearsal database, nothing else)');
  }
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535 || out.port === 54329) throw new Error('--port must be 1024-65535 (not the database port)');
  if ((out.clientIdFile === null) === (out.githubStub === null)) throw new Error('give exactly one of --client-id-file or --github-stub');
  if (out.githubStub !== null && !STUB_URL.test(out.githubStub)) throw new Error('--github-stub must be http://127.0.0.1:<port>');
  return out;
}

/** The child's environment: nothing database- or credential-shaped is inherited; the rehearsal's own values are set. */
export function childEnv(parent, settings) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/DATABASE_URL/i.test(key) || /^PG[A-Z_]*$/.test(key)) continue;
    if (key === 'RELAY_GITHUB_APP_CLIENT_SECRET' || key === 'RELAY_BRIDGE_API_TOKEN' || key === 'NODE_ENV') continue;
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
  return env;
}

function readClientId(path) {
  const id = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(id)) throw new Error('the client id file does not hold one GitHub App client id');
  return id;
}

async function ensureDatabase(db) {
  const name = db.slice(db.lastIndexOf('/') + 1);
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/postgres' });
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
  const env = childEnv(process.env, { db: args.db, port: args.port, clientId, githubStub: args.githubStub, tap: args.tap, dataDir: mkdtempSync(join(tmpdir(), 'r16-bridge-')) });
  await ensureDatabase(args.db);
  if (args.build) {
    const esbuild = join('node_modules', 'esbuild', 'bin', 'esbuild');
    step('bridge build', process.execPath, [esbuild, 'relay-bridge/server.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=dist-relay-bridge/server.cjs', '--external:@anthropic-ai/claude-agent-sdk', '--external:pg', '--log-level=warning'], env);
    step('migrate helper build', process.execPath, [esbuild, 'scripts/r16-migrate-throwaway.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=dist-relay-bridge/r16-migrate-throwaway.cjs', '--external:pg', '--log-level=warning'], env);
  }
  step('migrate', process.execPath, ['dist-relay-bridge/r16-migrate-throwaway.cjs'], env);
  console.log(`r16: MAIN-LINE BRIDGE on http://127.0.0.1:${args.port} | database ${args.db.slice(args.db.lastIndexOf('/') + 1)} (throwaway) | social ON | sign-in ${args.githubStub ? 'GITHUB STUB (identities NOT real)' : 'GitHub device flow'}${args.tap ? ' | tap ON' : ''}`);
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
