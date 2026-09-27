#!/usr/bin/env node
/**
 * THE FIRST PIE ACCEPTANCE OF WONDERLAND <-> JULIUS -- the half that runs outside the editor.
 *
 *   node scripts/wonderland-julius-pie-acceptance.mjs                    (dry run: prepares, drops nothing)
 *   node scripts/wonderland-julius-pie-acceptance.mjs --drop --channel <editor channel dir>
 *
 * Needs WONDERLAND_E2E_DATABASE_URL (an isolated, migrated PostgreSQL) and a built bridge
 * (npm run wonderland:julius:e2e:build). The editor it drops into must be running a build that contains
 * UWonderlandJuliusStreamSubsystem.
 *
 * WHAT IT DOES
 *   1. starts the production bridge against the ISOLATED database, every provider credential stripped
 *   2. creates the zero-spend run (the drill's contract, so the same durable run every time) -- READY, undispatched
 *   3. signs a test player in and makes them a member of the project
 *   4. writes generated/pie-acceptance/params.json for the editor job
 *   5. with --drop only: drops zc_julius_live_acceptance.py into the channel inbox ATOMICALLY
 *   6. answers the job's two requests for a pairing code, each minted at the moment it is asked for, because a code
 *      lives 120 s and PIE can take longer than that to start
 *   7. after the job, checks from Julius's side what the world cannot see: the run was never dispatched, nothing
 *      drove it, and it is still the one run
 *
 * THE CHANNEL IS WONDERLAND CORE'S. Without --drop this prepares everything and drops nothing, so it can be run to
 * check the bridge side at any time; the job goes into the inbox only on purpose, with the channel named.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/* ------------------------------------------------ guards before anything else */

const DB = process.env.WONDERLAND_E2E_DATABASE_URL;
if (!DB) {
  console.error('WONDERLAND_E2E_DATABASE_URL is not set. This never falls back to DATABASE_URL.');
  process.exit(2);
}
const dbUrl = new URL(DB);
if (dbUrl.port === '5432' || dbUrl.pathname === '/julius') {
  console.error('REFUSED: that URL looks like the live julius database.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const DROP = argv.includes('--drop');
const channelIndex = argv.indexOf('--channel');
const CHANNEL = channelIndex >= 0 ? argv[channelIndex + 1] : null;
if (DROP && !CHANNEL) {
  console.error('--drop needs --channel <editor channel dir>. The inbox is never guessed.');
  process.exit(2);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANDSHAKE = join(ROOT, 'generated', 'pie-acceptance');
const JOB = join(ROOT, 'wonderland', 'Tools', 'editor_jobs', 'zc_julius_live_acceptance.py');
const TOKEN = randomBytes(24).toString('hex');
const PORT = Number(process.env.WONDERLAND_E2E_PORT ?? 8796);
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = 'https://wonderland-e2e.invalid';
const PLAYER = 'ghu-e2e-player';
const CONTRACT = {
  missionId: 'mission:wonderland-integration-e2e-1',
  markerNamespace: 'wonderland-integration-e2e',
  projectId: 'prj-wonderland-integration-e2e',
  tenantId: 'tenant-wonderland-integration-e2e',
  objective:
    'Integration probe: a mission created over the bridge and read back by the world. It is never driven and no worker ever runs.',
  requirements: ['This mission exists only to prove the create and read path between Wonderland and Julius.'],
  constraints: ['Never dispatch. No provider may be called on its behalf.'],
  acceptanceCriteria: [
    { id: 'criterion-created', text: 'The run exists durably in READY with dispatched false.', blocking: true },
    { id: 'criterion-observed', text: 'The world reads the same run back and shows it as Queued.', blocking: false },
  ],
  testCommand: '',
  workspacePath: '/tmp/wonderland-integration-e2e/ws',
  limits: { spendUsd: 1, repairCycles: 0 },
};

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/API_KEY|SECRET|PASSWORD|_TOKEN$|^ANTHROPIC|^OPENAI|^XAI|^GROK|^HERMES_HOME|^CLAUDE_CODE/i.test(k)) continue;
  if (k === 'DATABASE_URL' || k === 'WONDERLAND_E2E_DATABASE_URL') continue;
  env[k] = v;
}
Object.assign(env, {
  DATABASE_URL: DB, RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_BRIDGE_PORT: String(PORT),
  RELAY_BRIDGE_HOST: '127.0.0.1', RELAY_HERMES_PROVIDER: 'hermes_local', RELAY_ALLOWED_ORIGINS: SITE,
});

const operator = { Authorization: `Bearer ${TOKEN}` };
const scoped = { ...operator, 'X-Relay-Tenant': CONTRACT.tenantId, 'X-Relay-Project': CONTRACT.projectId };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(`[acceptance] ${line}`);

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

/* ------------------------------------------------------------------- run */

mkdirSync(HANDSHAKE, { recursive: true });
for (const stale of readdirSync(HANDSHAKE)) rmSync(join(HANDSHAKE, stale), { force: true });

const log = createWriteStream(join(HANDSHAKE, 'bridge.log'));
const bridge = spawn('node', ['dist-relay-bridge/server.cjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
bridge.stdout.pipe(log);
bridge.stderr.pipe(log);
let exited = null;
bridge.on('exit', (code) => { exited = code; });
const summary = { started: new Date().toISOString(), dropped: false, pairingCodesServed: 0, job: null, julius: null };

try {
  let healthy = false;
  for (let i = 0; i < 60 && exited === null && !healthy; i += 1) {
    try { healthy = (await fetch(BASE + '/health')).ok; } catch { /* not up yet */ }
    if (!healthy) await sleep(500);
  }
  if (!healthy) throw new Error('the bridge did not start; see generated/pie-acceptance/bridge.log');
  say(`bridge up on ${BASE}, database ${dbUrl.hostname}:${dbUrl.port}${dbUrl.pathname}`);

  const created = await call('POST', '/relay-api/julius/missions', { headers: operator, body: JSON.stringify(CONTRACT) });
  const runId = created.json?.data?.runId;
  if (created.status !== 201 || !runId) throw new Error(`could not create the run: ${created.status} ${created.text}`);
  say(`run ${runId} -- ${created.json.data.state}, dispatched ${created.json.data.dispatched}`);

  const minted = await call('POST', '/relay-api/browser/pair', {
    headers: operator, body: JSON.stringify({ origin: SITE, scope: 'control', participantId: PLAYER }),
  });
  const signedIn = await call('POST', '/relay-api/browser/session', {
    headers: { Origin: SITE },
    body: JSON.stringify({ grantId: minted.json?.data?.grantId, grantSecret: minted.json?.data?.grantSecret }),
  });
  const playerToken = signedIn.json?.data?.sessionToken;
  if (!playerToken) throw new Error(`could not sign the test player in: ${signedIn.status} ${signedIn.text}`);
  const members = new pg.Pool({ connectionString: DB });
  try {
    await members.query('INSERT INTO relay_wonderland.players(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [PLAYER]);
    await members.query(
      "INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES ($1, $2, 'OWNER') ON CONFLICT DO NOTHING",
      [CONTRACT.projectId, PLAYER]);
  } finally {
    await members.end();
  }
  say(`player ${PLAYER} signed in and a member of ${CONTRACT.projectId}`);

  writeFileSync(join(HANDSHAKE, 'params.json'), JSON.stringify({
    bridge: BASE, projectId: CONTRACT.projectId, runId, missionId: CONTRACT.missionId,
  }, null, 1));

  if (!DROP) {
    say('DRY RUN: bridge, run, player and params are ready. Nothing was dropped into any channel.');
    say(`to run the editor half: --drop --channel <editor channel dir>   (job: ${JOB})`);
  } else {
    // ATOMIC, per the channel's own rule: it polls every 0.25 s and would run a half-written file.
    const inbox = join(CHANNEL, 'inbox');
    if (!existsSync(inbox)) throw new Error(`no inbox at ${inbox}`);
    const target = join(inbox, 'zc_julius_live_acceptance.py');
    copyFileSync(JOB, `${target}.tmp`);
    renameSync(`${target}.tmp`, target);
    summary.dropped = true;
    say(`job dropped into ${inbox}`);

    // Serve the two pairing codes the job asks for, each minted when asked.
    for (const n of [1, 2]) {
      const flag = join(HANDSHAKE, `ready-${n}.flag`);
      const deadline = Date.now() + 20 * 60_000;
      while (!existsSync(flag) && Date.now() < deadline) await sleep(500);
      if (!existsSync(flag)) throw new Error(`the job never asked for pairing code ${n}`);
      const paired = await call('POST', '/relay-api/wonderland/native/pair', {
        headers: { Authorization: `Relay-Session ${playerToken}`, Origin: SITE },
      });
      if (paired.status !== 200) throw new Error(`could not mint pairing code ${n}: ${paired.status} ${paired.text}`);
      const codePath = join(HANDSHAKE, `code-${n}.txt`);
      writeFileSync(`${codePath}.tmp`, paired.json.data.code);
      renameSync(`${codePath}.tmp`, codePath);
      summary.pairingCodesServed = n;
      say(`served pairing code ${n}`);
    }

    const done = join(CHANNEL, 'done', 'zc_julius_live_acceptance.json');
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      if (existsSync(done)) {
        const result = JSON.parse(readFileSync(done, 'utf8'));
        if (result.status && result.status !== 'running') { summary.job = result; break; }
      }
      await sleep(1000);
    }
    if (summary.job === null) throw new Error('the job did not finish within 20 minutes');
    say(`job: ${summary.job.status}`);
  }

  // WHAT THE WORLD CANNOT SEE, checked from Julius's side: never dispatched, never driven, still one run.
  const run = await call('GET', `/relay-api/julius/runs/${runId}/run`, { headers: scoped });
  const slots = await call('GET', `/relay-api/julius/runs/${runId}/slots`, { headers: scoped });
  const again = await call('POST', '/relay-api/julius/missions', { headers: operator, body: JSON.stringify(CONTRACT) });
  summary.julius = {
    runId,
    stateAfter: run.json?.data?.state ?? 'absent',
    slotsAfter: (slots.json?.data ?? []).map((s) => `${s.role}:${s.state}`),
    neverDispatched: (slots.json?.data ?? []).length === 3 && slots.json.data.every((s) => s.state === 'NEVER_DISPATCHED'),
    stillTheOneRun: again.json?.data?.runId === runId,
  };
  say(`julius after: ${summary.julius.stateAfter}; never dispatched ${summary.julius.neverDispatched}; one run ${summary.julius.stillTheOneRun}`);
} catch (err) {
  summary.error = String(err?.message ?? err);
  console.error(`[acceptance] ${summary.error}`);
  process.exitCode = 1;
} finally {
  bridge.kill();
  writeFileSync(join(ROOT, 'generated', 'wl_julius_pie_acceptance.json'), JSON.stringify(summary, null, 1));
}
