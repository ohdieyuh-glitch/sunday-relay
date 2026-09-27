#!/usr/bin/env node
/**
 * THE FIRST PIE ACCEPTANCE OF WONDERLAND <-> JULIUS -- the half that runs outside the editor.
 *
 *   node scripts/wonderland-julius-pie-acceptance.mjs                    (dry run: prepares, drops nothing)
 *   node scripts/wonderland-julius-pie-acceptance.mjs --drop --channel <editor channel dir> [--wait-minutes 45]
 *
 * Needs WONDERLAND_E2E_DATABASE_URL (an isolated, migrated PostgreSQL) and a built bridge
 * (npm run wonderland:julius:e2e:build). The editor it drops into must be running a build that contains
 * UWonderlandJuliusStreamSubsystem.
 *
 * WHAT IT DOES
 *   1. starts the production bridge against the ISOLATED database, every provider credential stripped
 *   2. creates the zero-spend run (the drill's contract, so the same durable run every time) -- READY, undispatched
 *   3. signs a test player in and makes them a member of the project
 *   4. writes generated/pie-acceptance/params.json for the editor job, with a NONCE naming this attempt
 *   5. with --drop only: drops zc_julius_live_acceptance.py into the channel inbox ATOMICALLY
 *   6. answers EVERY request the job makes for a pairing code, each minted at the moment it is asked for. A code lives
 *      120 s and PIE takes 40-90 s to start, and the job retries a pairing that does not complete (Wonderland Core's
 *      review), so requests are answered by name for as long as the job runs -- not counted to two. A player session
 *      that expired while the job waited in the inbox is renewed rather than failing the acceptance.
 *   7. takes the job's result ONLY if it is this attempt's. The channel keeps earlier results, and an earlier run's
 *      PASS read as this run's would be a false acceptance.
 *   8. checks from Julius's side what the world cannot see -- still READY, never dispatched, still the one run -- and
 *      writes ONE graded artifact, generated/wl_julius_pie_acceptance.json: the job's clauses plus these, its status
 *      derived from the clauses. A dry run writes generated/pie-acceptance/dry-run.json instead, so a dry run can
 *      never be mistaken for an acceptance.
 *
 * THE CHANNEL IS WONDERLAND CORE'S. Without --drop this prepares everything and drops nothing, so it can be run to
 * check the bridge side at any time; the job goes into the inbox only on purpose, with the channel named.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
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
const waitIndex = argv.indexOf('--wait-minutes');
const WAIT_MINUTES = waitIndex >= 0 ? Number(argv[waitIndex + 1]) : 45;
if (!Number.isFinite(WAIT_MINUTES) || WAIT_MINUTES <= 0) {
  console.error('--wait-minutes needs a positive number.');
  process.exit(2);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANDSHAKE = join(ROOT, 'generated', 'pie-acceptance');
const JOB = join(ROOT, 'wonderland', 'Tools', 'editor_jobs', 'zc_julius_live_acceptance.py');
const ARTIFACT = DROP ? join(ROOT, 'generated', 'wl_julius_pie_acceptance.json') : join(HANDSHAKE, 'dry-run.json');
const TOKEN = randomBytes(24).toString('hex');
const NONCE = randomBytes(8).toString('hex');
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
// Every clause the editor half declares, its own completeness clause (A12) included. One that never ran is not a pass.
// Clause ids: A = the editor job's, O = this orchestrator's view of the job, J = Julius's side.
const JOB_CLAUSES = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A06b', 'A06e', 'A06c', 'A06d', 'A07', 'A08', 'A09', 'A10', 'A10b', 'A11', 'A12'];
// The key for the SECOND run the job switches to. Fixed, so every attempt resolves to the same run and no attempt
// makes a new one (Julius 52df8e63: one key is one rerun).
const SWITCH_RERUN_KEY = 'pie-acceptance-switch-v1';

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/API_KEY|SECRET|PASSWORD|_TOKEN$|^ANTHROPIC|^OPENAI|^XAI|^GROK|^HERMES_HOME|^CLAUDE_CODE/i.test(k)) continue;
  // EVERY inherited database variable: the runtime reads JULIUS_DATABASE_URL before DATABASE_URL (Julius 6d960b03).
  if (/DATABASE_URL/i.test(k)) continue;
  env[k] = v;
}
Object.assign(env, {
  DATABASE_URL: DB, JULIUS_DATABASE_URL: DB, RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_BRIDGE_PORT: String(PORT),
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

/** A browser session for the test player: what the website holds after they sign in. */
async function signIn() {
  const minted = await call('POST', '/relay-api/browser/pair', {
    headers: operator, body: JSON.stringify({ origin: SITE, scope: 'control', participantId: PLAYER }),
  });
  const signedIn = await call('POST', '/relay-api/browser/session', {
    headers: { Origin: SITE },
    body: JSON.stringify({ grantId: minted.json?.data?.grantId, grantSecret: minted.json?.data?.grantSecret }),
  });
  const token = signedIn.json?.data?.sessionToken;
  if (!token) throw new Error(`could not sign the test player in: ${signedIn.status} ${signedIn.text}`);
  return token;
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

const started = new Date().toISOString();
const clauses = [];
const clause = (id, name, pass, detail) => clauses.push({ id, name, pass: Boolean(pass), detail });
const summary = { dropped: false, nonce: NONCE, pairing: [], job: null, julius: null, error: null };

let playerToken = null;

/** Mint a pairing code as the signed-in player, renewing their session if it expired while the job waited. */
async function mintCode() {
  const ask = () => call('POST', '/relay-api/wonderland/native/pair', {
    headers: { Authorization: `Relay-Session ${playerToken}`, Origin: SITE },
  });
  let res = await ask();
  if (res.status === 401) {
    playerToken = await signIn();
    res = await ask();
  }
  return res;
}

/** Answer every request the job has made and not yet had answered. A failed mint is recorded, not fatal: the job asks again. */
async function serveCodes(served) {
  for (const name of readdirSync(HANDSHAKE)) {
    const request = /^ready-(.+)\.flag$/.exec(name);
    if (!request || served.has(request[1])) continue;
    served.add(request[1]);
    const res = await mintCode();
    if (res.status !== 200 || typeof res.json?.data?.code !== 'string') {
      summary.pairing.push({ request: request[1], served: false, status: res.status, body: res.text });
      say(`could NOT mint a code for ${request[1]}: ${res.status}`);
      continue;
    }
    const codePath = join(HANDSHAKE, `code-${request[1]}.txt`);
    writeFileSync(`${codePath}.tmp`, res.json.data.code);
    renameSync(`${codePath}.tmp`, codePath);
    summary.pairing.push({ request: request[1], served: true });
    say(`served a pairing code for ${request[1]}`);
  }
}

/** This attempt's result, or null. An earlier run's result is never this run's evidence. */
function thisAttemptsResult(path, droppedAt) {
  if (!existsSync(path)) return null;
  let result;
  try { result = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!result.status || result.status === 'running') return null;
  if (result.acceptance_nonce === NONCE) return result;
  // A job that died before it could read params.json carries no nonce; only a result written after THIS drop counts.
  if (result.acceptance_nonce === undefined && statSync(path).mtimeMs >= droppedAt) return result;
  return null;
}

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

  // A SECOND RUN OF THE SAME MISSION, so the job can prove a run SWITCH on the Mission Contract (Wonderland Core:
  // the automatic clear on a run change had no gate). An explicit rerun of the UNCHANGED contract with a FIXED key:
  // the same key returns the same run every attempt (Julius 52df8e63), and creation never dispatches it.
  const switched = await call('POST', '/relay-api/julius/missions', {
    headers: { ...operator, 'x-relay-julius-rerun': 'explicit', 'x-relay-julius-rerun-key': SWITCH_RERUN_KEY },
    body: JSON.stringify(CONTRACT),
  });
  const switchRunId = switched.json?.data?.runId;
  if (switched.status !== 201 || !switchRunId || switchRunId === runId) {
    throw new Error(`could not create the second run to switch to: ${switched.status} ${switched.text}`);
  }
  say(`switch run ${switchRunId} -- ${switched.json.data.state}, dispatched ${switched.json.data.dispatched}`);

  playerToken = await signIn();
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
    bridge: BASE, projectId: CONTRACT.projectId, runId, switchRunId, missionId: CONTRACT.missionId, nonce: NONCE,
  }, null, 1));

  if (!DROP) {
    say('DRY RUN: bridge, run, player and params are ready. Nothing was dropped into any channel.');
    say(`to run the editor half: --drop --channel <editor channel dir>   (job: ${JOB})`);
  } else {
    // ATOMIC, per the channel's own rule: it polls every 0.25 s and would run a half-written file.
    const inbox = join(CHANNEL, 'inbox');
    if (!existsSync(inbox)) throw new Error(`no inbox at ${inbox}`);
    const target = join(inbox, 'zc_julius_live_acceptance.py');
    const droppedAt = Date.now();
    copyFileSync(JOB, `${target}.tmp`);
    renameSync(`${target}.tmp`, target);
    summary.dropped = true;
    say(`job dropped into ${inbox} (attempt ${NONCE}); waiting up to ${WAIT_MINUTES} min`);

    const done = join(CHANNEL, 'done', 'zc_julius_live_acceptance.json');
    const served = new Set();
    const deadline = droppedAt + WAIT_MINUTES * 60_000;
    while (Date.now() < deadline && exited === null) {
      await serveCodes(served);
      summary.job = thisAttemptsResult(done, droppedAt);
      if (summary.job !== null) break;
      await sleep(250);
    }
    const jobTests = summary.job?.tests ?? [];
    clause('O00', 'the editor half ran, and this is THIS attempt\'s result',
      summary.job !== null && summary.job.status !== 'error',
      summary.job === null
        ? { reason: exited !== null ? `the bridge exited (${exited}) while the job ran` : `no result within ${WAIT_MINUTES} min` }
        : { status: summary.job.status, error: summary.job.error ?? null, seconds: summary.job.seconds });
    clauses.push(...jobTests);
    const ran = new Set(jobTests.map((t) => t.id));
    const missing = JOB_CLAUSES.filter((id) => !ran.has(id));
    clause('O01', 'every clause of the editor half ran -- one that never ran is not a pass', missing.length === 0,
      { missing });
    say(`job: ${summary.job?.status ?? 'no result'}`);
  }

  // WHAT THE WORLD CANNOT SEE, checked from Julius's side: still READY, never dispatched, still one run.
  const run = await call('GET', `/relay-api/julius/runs/${runId}/run`, { headers: scoped });
  const slots = await call('GET', `/relay-api/julius/runs/${runId}/slots`, { headers: scoped });
  const again = await call('POST', '/relay-api/julius/missions', { headers: operator, body: JSON.stringify(CONTRACT) });
  const slotList = Array.isArray(slots.json?.data) ? slots.json.data : null;
  summary.julius = {
    runId,
    stateAfter: run.json?.data?.state ?? null,
    slotsAfter: slotList?.map((s) => `${s.role}:${s.state}`) ?? null,
    resubmission: { status: again.status, runId: again.json?.data?.runId ?? null, dispatched: again.json?.data?.dispatched ?? null },
  };
  clause('J01', 'Julius still holds the run READY -- nothing the world did advanced it',
    summary.julius.stateAfter === 'READY', { state: summary.julius.stateAfter, http: run.status });
  clause('J02', 'no slot was ever dispatched: no worker ran and no provider was called for it',
    slotList !== null && slotList.length === 3 && slotList.every((s) => s.state === 'NEVER_DISPATCHED'),
    { slots: summary.julius.slotsAfter, http: slots.status });
  clause('J03', 'an identical resubmission is the SAME run, still undispatched -- no duplicate execution',
    summary.julius.resubmission.runId === runId && summary.julius.resubmission.dispatched === false,
    summary.julius.resubmission);
  // The run the job SWITCHED to is held to the same standard: following it did not drive it either.
  const switchRun = await call('GET', `/relay-api/julius/runs/${switchRunId}/run`, { headers: scoped });
  const switchSlots = await call('GET', `/relay-api/julius/runs/${switchRunId}/slots`, { headers: scoped });
  const switchSlotList = Array.isArray(switchSlots.json?.data) ? switchSlots.json.data : null;
  clause('J04', 'the run the world switched to is still READY and was never dispatched either',
    switchRun.json?.data?.state === 'READY' && switchSlotList !== null && switchSlotList.length === 3
      && switchSlotList.every((s) => s.state === 'NEVER_DISPATCHED'),
    { switchRunId, state: switchRun.json?.data?.state ?? null, slots: switchSlotList?.map((s) => `${s.role}:${s.state}`) ?? null });
  say(`julius after: ${summary.julius.stateAfter}; slots ${JSON.stringify(summary.julius.slotsAfter)}; ` +
    `resubmission ${summary.julius.resubmission.runId === runId ? 'the same run' : 'NOT the same run'}`);
} catch (err) {
  summary.error = String(err?.message ?? err);
  clause('X00', 'the orchestrator completed', false, { error: summary.error });
  console.error(`[acceptance] ${summary.error}`);
} finally {
  bridge.kill();
  const failing = clauses.filter((c) => !c.pass).map((c) => c.id);
  const status = clauses.length === 0 ? 'no clause ran' : failing.length ? `FAIL: ${failing.join(', ')}` : 'all clauses pass';
  writeFileSync(ARTIFACT, JSON.stringify({
    name: DROP ? 'wl_julius_pie_acceptance' : 'wl_julius_pie_acceptance DRY RUN (bridge side only; not an acceptance)',
    started, status, tests: clauses, ...summary,
  }, null, 1));
  say(`${status} -> ${ARTIFACT}`);
  if (failing.length || clauses.length === 0) process.exitCode = 1;
}
