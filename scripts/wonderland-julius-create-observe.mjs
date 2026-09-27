#!/usr/bin/env node
/**
 * WONDERLAND <-> JULIUS, END TO END, ZERO SPEND.
 *
 *   npm run wonderland:julius:e2e      (needs WONDERLAND_E2E_DATABASE_URL)
 *
 * Runs the REAL bridge binary -- dist-relay-bridge/server.cjs, production
 * main(), not a test composition -- against an ISOLATED PostgreSQL, and walks
 * the seam over real HTTP:
 *
 *   create a mission           POST /relay-api/julius/missions
 *   read it back               GET  /relay-api/julius/runs/<runId>/run | slots
 *   project it for the world   projectJuliusTaskState -> the Mission Contract
 *
 * WHY IT CANNOT SPEND. Creation never dispatches (Julius client rule 5: a run
 * created over the bridge is READY with dispatched:false until the mission job
 * drives it). As a second guarantee, every provider credential is removed from
 * the bridge's environment before it starts.
 *
 * WHY IT CANNOT TOUCH JULIUS'S DATA. The database comes ONLY from
 * WONDERLAND_E2E_DATABASE_URL, never from the inherited DATABASE_URL -- which on
 * the development laptop points at Julius's LIVE store -- and a URL on port 5432
 * or naming a database `julius` is refused outright. The database must already
 * be migrated; running the real-Postgres suites against it once does that.
 *
 * WHY ITS VERDICT IS NOT ITS OWN. It writes generated/wl_julius_create_observe.json
 * in the {name, started, status, tests[]} shape the Wonderland proof jobs use, so
 * wonderland/Tools/proof-verdict.mjs can grade it by clause. The status line is
 * derived from the clauses and never written ahead of them. It exits 0 only when
 * every clause passes.
 *
 * FIRST RUN, 2026-09-27, merged tree 706dab30: 11 of 13.
 *   E02b  a percent-encoded run id (run%3A...) was answered unknown_julius_route.
 *         Confirmed a bug by Julius, who is fixing it in julius-state-routes.
 *         Stays red here until that fix is merged into this tree.
 *   E08   first asserted that a changed payload must be refused. Julius
 *         clarified that this is INTENDED -- a changed contract is a new run and
 *         missionId is not a run identity -- so the clause now proves the
 *         intended behaviour instead: a distinct run, the original untouched.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'generated');
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- database */
/* FIRST, before any import or side effect: a guard that runs after something
   else has already happened is not a guard. */

const DB = process.env.WONDERLAND_E2E_DATABASE_URL;
if (!DB) {
  console.error('WONDERLAND_E2E_DATABASE_URL is not set. This drill never falls back to DATABASE_URL.');
  process.exit(2);
}
const dbUrl = new URL(DB);
if (dbUrl.port === '5432' || dbUrl.pathname === '/julius') {
  console.error('REFUSED: that URL looks like the live julius database. Point the drill at an isolated one.');
  process.exit(2);
}

// A string-literal specifier, so the repository boundary can read what this
// loads, and still a dynamic import, so it runs AFTER the guards above.
const { projectJuliusTaskState } = await import('../generated/wonderland-julius-task-state.mjs');

/* ------------------------------------------------------ the bridge's world */

const TOKEN = randomBytes(24).toString('hex');
const PORT = Number(process.env.WONDERLAND_E2E_PORT ?? 8796);
const BASE = `http://127.0.0.1:${PORT}`;

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/API_KEY|SECRET|PASSWORD|_TOKEN$|^ANTHROPIC|^OPENAI|^XAI|^GROK|^HERMES_HOME|^CLAUDE_CODE/i.test(k)) continue;
  if (k === 'DATABASE_URL' || k === 'WONDERLAND_E2E_DATABASE_URL') continue;
  env[k] = v;
}
Object.assign(env, {
  DATABASE_URL: DB,
  RELAY_BRIDGE_API_TOKEN: TOKEN,
  RELAY_BRIDGE_PORT: String(PORT),
  RELAY_BRIDGE_HOST: '127.0.0.1',
  RELAY_HERMES_PROVIDER: 'hermes_local',
});

/* ----------------------------------------------------------------- clauses */

const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
const tests = [];
const clause = (id, name, pass, detail) => {
  tests.push({ id, name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}`);
};

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

const operator = { Authorization: `Bearer ${TOKEN}` };
const scoped = { ...operator, 'X-Relay-Tenant': CONTRACT.tenantId, 'X-Relay-Project': CONTRACT.projectId };

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep the text */ }
  return { status: res.status, json, text: text.slice(0, 600) };
}

/* -------------------------------------------------------------------- walk */

const log = createWriteStream(join(OUT, 'wl_julius_create_observe.bridge.log'));
// A literal command, so the repository boundary can read exactly what runs.
const bridge = spawn('node', ['dist-relay-bridge/server.cjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
bridge.stdout.pipe(log);
bridge.stderr.pipe(log);
let exited = null;
bridge.on('exit', (code) => { exited = code; });

try {
  let healthy = false;
  for (let i = 0; i < 60 && exited === null; i += 1) {
    try { if ((await fetch(BASE + '/health')).ok) { healthy = true; break; } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  clause('E00', 'the real bridge binary started against the isolated database and answered /health', healthy, {
    bridge: exited === null ? 'running' : `exited with code ${exited}`,
    port: PORT,
    database: `${dbUrl.hostname}:${dbUrl.port}${dbUrl.pathname}`,
  });
  if (!healthy) throw new Error('bridge did not come up; see generated/wl_julius_create_observe.bridge.log');

  const created = await call('POST', '/relay-api/julius/missions', { headers: operator, body: JSON.stringify(CONTRACT) });
  const data = created.json?.data ?? null;
  clause('E01', 'a mission is created over the bridge (201)', created.status === 201 && data?.runId,
    { status: created.status, body: created.json ?? created.text });
  clause('E02', 'creation does not dispatch: dispatched is false', data?.dispatched === false,
    { dispatched: data?.dispatched ?? 'absent', state: data?.state ?? 'absent' });

  const runId = data?.runId;
  if (!runId) throw new Error('no runId, so nothing further can be read');

  // Run ids carry a colon. RFC 3986 allows ':' unencoded in a path segment, and
  // many clients -- Unreal's UrlEncode among them -- encode it anyway. Probe both.
  const encodedProbe = await call('GET', `/relay-api/julius/runs/${encodeURIComponent(runId)}/run`, { headers: scoped });
  clause('E02b', 'a percent-encoded run id (run%3A...) reaches the run', encodedProbe.status === 200, {
    status: encodedProbe.status, refusal: encodedProbe.json?.error?.kind ?? 'none',
  });

  const run = await call('GET', `/relay-api/julius/runs/${runId}/run`, { headers: scoped });
  const readState = (run.json?.data ?? run.json)?.state ?? null;
  clause('E03', 'the world reads the same run back from the durable store', run.status === 200 && readState !== null,
    { status: run.status, body: run.json ?? run.text });
  clause('E04', 'the state Julius reports at creation is the state the read route serves', readState === data?.state,
    { atCreate: data?.state ?? 'absent', onRead: readState ?? 'absent' });

  const slots = await call('GET', `/relay-api/julius/runs/${runId}/slots`, { headers: scoped });
  const slotList = slots.json?.data ?? slots.json;
  clause('E05', 'all three slots read NEVER_DISPATCHED, not idle (Julius client rule 3)',
    Array.isArray(slotList) && slotList.length === 3 && slotList.every((s) => s.state === 'NEVER_DISPATCHED'),
    { status: slots.status, slots: Array.isArray(slotList) ? slotList.map((s) => `${s.role}:${s.state}`) : 'absent' });

  const projection = projectJuliusTaskState(readState);
  clause('E06', 'the Mission Contract shows the created mission as Queued, never as running',
    projection?.kind === 'state' && projection.state === 'Queued',
    { juliusState: readState ?? 'absent', projection: projection ?? 'unknown' });

  const again = await call('POST', '/relay-api/julius/missions', { headers: operator, body: JSON.stringify(CONTRACT) });
  clause('E07', 're-posting the identical contract resumes the SAME run rather than paying for a second',
    again.status === 201 && again.json?.data?.runId === runId,
    { status: again.status, resumedRunId: again.json?.data?.runId ?? 'absent', original: runId });

  const changed = await call('POST', '/relay-api/julius/missions', {
    headers: operator, body: JSON.stringify({ ...CONTRACT, objective: CONTRACT.objective + ' (changed)' }),
  });
  // INTENDED, per Julius (2026-09-27): the idempotency key is a digest of the
  // contract CONTENT, so a changed contract IS a new run and missionId names a
  // mission, not a run. The world therefore correlates by runId ONLY. What must
  // hold is that the new run is distinct AND the original is left untouched --
  // a tab following the first runId must not have its mission change under it.
  const secondRunId = changed.json?.data?.runId ?? 'absent';
  const original = await call('GET', `/relay-api/julius/runs/${runId}/run`, { headers: scoped });
  const originalView = original.json?.data ?? original.json;
  clause('E08', 'a changed contract under the same missionId is a DISTINCT run, and the original run is untouched',
    changed.status === 201 && secondRunId !== 'absent' && secondRunId !== runId &&
      original.status === 200 && originalView?.state === readState &&
      originalView?.missionContractRevision === (run.json?.data ?? run.json)?.missionContractRevision,
    { status: changed.status, firstRunId: runId, secondRunId,
      originalAfter: { status: original.status, state: originalView?.state ?? 'absent',
        missionContractRevision: originalView?.missionContractRevision ?? 'absent' } });

  const anon = await call('GET', `/relay-api/julius/runs/${runId}/run`, {
    headers: { 'X-Relay-Tenant': CONTRACT.tenantId, 'X-Relay-Project': CONTRACT.projectId },
  });
  clause('E09', 'a read without the operator credential is refused (401)', anon.status === 401, { status: anon.status });

  // A bare 404 proves nothing: an earlier draft passed this clause while EVERY
  // read was 404 for another reason. So: the SPECIFIC refusal, plus a control
  // showing the owning project can read the same run.
  const foreign = await call('GET', `/relay-api/julius/runs/${runId}/run`, {
    headers: { ...operator, 'X-Relay-Tenant': CONTRACT.tenantId, 'X-Relay-Project': 'prj-someone-else' },
  });
  clause('E10', 'another project gets run_not_found, while the owning project can read the same run',
    foreign.status === 404 && foreign.json?.error?.kind === 'run_not_found' && run.status === 200,
    { foreignStatus: foreign.status, foreignRefusal: foreign.json?.error?.kind ?? 'none', owningProjectStatus: run.status });

  const unknownRun = await call('GET', '/relay-api/julius/runs/run:does-not-exist/run', { headers: scoped });
  clause('E11', 'an unknown run is run_not_found, never an empty run and never a routing miss',
    unknownRun.status === 404 && unknownRun.json?.error?.kind === 'run_not_found',
    { status: unknownRun.status, refusal: unknownRun.json?.error?.kind ?? 'none' });
} catch (err) {
  clause('EXX', 'the walk completed without an exception', false, { error: String(err?.message ?? err) });
} finally {
  bridge.kill();
  await new Promise((r) => setTimeout(r, 300));
  const failing = tests.filter((t) => !t.pass).map((t) => t.id);
  const status = failing.length === 0 ? 'all clauses pass' : `FAIL: ${failing.join(', ')}`;
  writeFileSync(join(OUT, 'wl_julius_create_observe.json'),
    JSON.stringify({ name: 'wl_julius_create_observe', started, status, tests }, null, 1));
  console.log(`\n${status}\nartifact: generated/wl_julius_create_observe.json`);
  process.exitCode = failing.length === 0 ? 0 : 1;
}
