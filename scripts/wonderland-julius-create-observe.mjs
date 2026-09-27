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
 *
 * E08 RETIRED, 2026-09-27. The founder's decision 3 (an accidental duplicate
 * must not start another paid execution; an explicit rerun must stay possible)
 * superseded it, and Julius 80b91478 implements it: a changed contract for a
 * mission whose run is still active is now REFUSED. Its intent lives on in
 * D02 (refused, nothing created) and D04 (an explicit rerun is a distinct run
 * and the first is untouched).
 *
 * ONE ACTIVE RUN PER MISSION (D01-D11), on a FRESH mission per walk so the
 * guard is measured rather than this database's history: refusal naming the
 * live run, the exact-word rerun intent, the identical replay, the world
 * following each runId as itself, terminal release, and two real races --
 * identical twins, and different contracts for one mission -- each counted in
 * the database, not inferred from the answers.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

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
/** The website a test player signs in from. It only has to be an origin this bridge admits. */
const SITE = 'https://wonderland-e2e.invalid';
/** The test player, in the shape GitHub sign-in encodes an identity. */
const PLAYER = 'ghu-e2e-player';

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/API_KEY|SECRET|PASSWORD|_TOKEN$|^ANTHROPIC|^OPENAI|^XAI|^GROK|^HERMES_HOME|^CLAUDE_CODE/i.test(k)) continue;
  // EVERY inherited database variable, not only DATABASE_URL: since Julius 6d960b03 the runtime reads
  // JULIUS_DATABASE_URL FIRST, so one set in the environment later would take the bridge -- and this drill's
  // writes -- straight past the isolated database.
  if (/DATABASE_URL/i.test(k)) continue;
  env[k] = v;
}
Object.assign(env, {
  DATABASE_URL: DB,
  JULIUS_DATABASE_URL: DB,
  RELAY_BRIDGE_API_TOKEN: TOKEN,
  RELAY_BRIDGE_PORT: String(PORT),
  RELAY_BRIDGE_HOST: '127.0.0.1',
  RELAY_HERMES_PROVIDER: 'hermes_local',
  // The website origin the test player signs in from. Not a real site: it only
  // has to be an origin this bridge admits, so the operator can mint the player.
  RELAY_ALLOWED_ORIGINS: SITE,
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

  // E08 RETIRED -- superseded by founder decision 3 and Julius 80b91478; see the
  // header. What it protected is proven below on a fresh mission (D02, D04).

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

  /* ================================================================
   * THE NATIVE CLIENT, OVER THE WIRE -- the exact calls the Unreal
   * transport makes, so the only unknown left for PIE is the C++.
   * ================================================================ */

  // A signed-in player. GitHub sign-in cannot run here, so the operator mints
  // a CONTROL session bound to a named player -- the same session shape
  // GitHub sign-in produces -- and the "website" redeems it from its Origin.
  const minted = await call('POST', '/relay-api/browser/pair', {
    headers: operator, body: JSON.stringify({ origin: SITE, scope: 'control', participantId: PLAYER }),
  });
  const grant = minted.json?.data ?? {};
  const signedIn = await call('POST', '/relay-api/browser/session', {
    headers: { Origin: SITE }, body: JSON.stringify({ grantId: grant.grantId, grantSecret: grant.grantSecret }),
  });
  const playerToken = signedIn.json?.data?.sessionToken ?? null;
  clause('N01', 'a signed-in player exists: a control session bound to the player, from the website',
    signedIn.status === 200 && typeof playerToken === 'string',
    { mintStatus: minted.status, sessionStatus: signedIn.status, participantId: signedIn.json?.data?.participantId ?? 'absent' });

  // The player is a MEMBER of the project, which is what lets the world route
  // answer at all: project scoping is this row.
  const members = new pg.Pool({ connectionString: DB });
  try {
    await members.query('INSERT INTO relay_wonderland.players(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [PLAYER]);
    await members.query(
      "INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES ($1, $2, 'OWNER') ON CONFLICT DO NOTHING",
      [CONTRACT.projectId, PLAYER]);
  } finally {
    await members.end();
  }

  const byOperator = await call('POST', '/relay-api/wonderland/native/pair', { headers: { ...operator, Origin: SITE } });
  clause('N02', 'the operator credential cannot pair a native client: an operator is not a player',
    byOperator.status === 403 && byOperator.json?.error?.kind === 'operator_is_not_a_player',
    { status: byOperator.status, refusal: byOperator.json?.error?.kind ?? 'none' });

  const paired = await call('POST', '/relay-api/wonderland/native/pair', {
    headers: { Authorization: `Relay-Session ${playerToken}`, Origin: SITE },
  });
  const code = paired.json?.data?.code ?? null;
  clause('N03', 'the signed-in player pairs their own desktop client and gets a single-use code',
    paired.status === 200 && typeof code === 'string' && paired.json?.data?.participantId === PLAYER,
    { status: paired.status, participantId: paired.json?.data?.participantId ?? 'absent' });

  // The desktop client redeems it. No Origin header: it is not a web page.
  const redeemed = await call('POST', '/relay-api/wonderland/native/session', { body: JSON.stringify({ code }) });
  const nativeToken = redeemed.json?.data?.token ?? null;
  clause('N04', 'the desktop client redeems the code for its own native session',
    redeemed.status === 200 && typeof nativeToken === 'string',
    { status: redeemed.status, audience: redeemed.json?.data?.audience ?? 'absent' });

  const reused = await call('POST', '/relay-api/wonderland/native/session', { body: JSON.stringify({ code }) });
  clause('N05', 'the same code a second time fails closed', reused.status === 401,
    { status: reused.status, refusal: reused.json?.error?.kind ?? 'none' });

  const native = { Authorization: `Relay-Session ${nativeToken}` };
  const worldQuery = `projectId=${encodeURIComponent(CONTRACT.projectId)}&runId=${runId}&cursor=0`;

  // THE WORLD'S OWN HYDRATE, as the native client -- what AdoptHydration will receive.
  const hydrate = await call('GET', `/relay-api/wonderland/julius/hydrate?${worldQuery}`, { headers: native });
  const hydrated = hydrate.json?.data ?? null;
  const worldProjection = projectJuliusTaskState(hydrated?.run?.state ?? null);
  clause('N06', 'the native client hydrates the SAME run from the world route, READY, shown Queued',
    hydrate.status === 200 && hydrated?.run?.runId === runId && hydrated?.run?.missionId === CONTRACT.missionId
      && hydrated?.run?.state === 'READY' && worldProjection?.kind === 'state' && worldProjection.state === 'Queued',
    { status: hydrate.status, runId: hydrated?.run?.runId ?? 'absent', missionId: hydrated?.run?.missionId ?? 'absent',
      state: hydrated?.run?.state ?? 'absent', projection: worldProjection ?? 'unknown' });

  // THE WORLD'S OWN EVENTS, one page at a time -- what ApplyEnvelope will receive.
  const firstPage = await call('GET', `/relay-api/wonderland/julius/events?mode=page&${worldQuery}`, { headers: native });
  const deliveries = firstPage.json?.data?.deliveries ?? null;
  const sequences = Array.isArray(deliveries) ? deliveries.map((d) => Number(d?.envelope?.sequence)) : [];
  clause('N07', 'the native client reads the run\'s envelopes as one page, oldest first by sequence',
    firstPage.status === 200 && sequences.length > 0 && sequences.every(Number.isFinite)
      && sequences.every((s, i) => i === 0 || s > sequences[i - 1])
      && deliveries.every((d) => d?.envelope?.runId === runId),
    { status: firstPage.status, delivered: sequences.length, sequences: sequences.slice(0, 12),
      nextCursor: firstPage.json?.data?.nextCursor ?? 'absent' });

  const nextCursor = firstPage.json?.data?.nextCursor ?? 0;
  const secondPage = await call('GET',
    `/relay-api/wonderland/julius/events?mode=page&projectId=${encodeURIComponent(CONTRACT.projectId)}&runId=${runId}&cursor=${nextCursor}`,
    { headers: native });
  clause('N08', 'reading on from nextCursor sends nothing twice',
    secondPage.status === 200 && (secondPage.json?.data?.deliveries ?? []).length === 0,
    { status: secondPage.status, redelivered: (secondPage.json?.data?.deliveries ?? []).length, from: nextCursor });

  // THE COPY GUARD, end to end: the player's BROWSER session carried into a
  // native client (no Origin) is refused by the very route it would unlock.
  const copied = await call('GET', `/relay-api/wonderland/julius/hydrate?${worldQuery}`, {
    headers: { Authorization: `Relay-Session ${playerToken}` },
  });
  // THE CONTROL, without which a 401 above proves nothing: the SAME browser
  // session, from its own website, is admitted. The first draft of this clause
  // passed while the token it "copied" was null.
  const fromSite = await call('GET', `/relay-api/wonderland/julius/hydrate?${worldQuery}`, {
    headers: { Authorization: `Relay-Session ${playerToken}`, Origin: SITE },
  });
  clause('N09', 'a browser session copied into a native client is refused, while the same session from its website is admitted',
    typeof playerToken === 'string' && copied.status === 401 && fromSite.status === 200,
    { copiedStatus: copied.status, fromItsWebsiteStatus: fromSite.status });

  const unsigned = await call('GET', `/relay-api/wonderland/julius/hydrate?${worldQuery}`);
  clause('N10', 'no session at all is refused', unsigned.status === 401, { status: unsigned.status });

  /* ================================================================
   * ONE ACTIVE RUN PER MISSION -- founder decision 3, Julius 80b91478.
   * An accidental duplicate must not start a second paid execution; an
   * EXPLICIT rerun must stay possible; runId is the run and missionId the
   * broader mission; the world follows exactly the runId it is given.
   *
   * A FRESH mission per walk, so what is measured is the guard and not this
   * database's history: the E-walk's contract is the same every time on
   * purpose, and a run the retired E08 made before the guard existed is still
   * here. Nothing is dispatched: creation never dispatches (E02).
   * ================================================================ */
  const walkId = randomBytes(6).toString('hex');
  const fresh = (label) => ({
    ...CONTRACT,
    missionId: `mission:wonderland-dup-${walkId}-${label}`,
    objective: `${CONTRACT.objective} [duplicate-run walk ${walkId}, ${label}]`,
  });
  const edited = (contract, note) => ({ ...contract, objective: `${contract.objective} (${note})` });
  // The rerun INTENT and the rerun KEY are separate headers (Julius 52df8e63), each sent only when given, so a clause
  // can send either without the other.
  const create = (contract, { rerun, key } = {}) => call('POST', '/relay-api/julius/missions', {
    headers: {
      ...operator,
      ...(rerun === undefined ? {} : { 'x-relay-julius-rerun': rerun }),
      ...(key === undefined ? {} : { 'x-relay-julius-rerun-key': key }),
    },
    body: JSON.stringify(contract),
  });
  const rerunKey = (label) => `rerun-${walkId}-${label}`;
  const brief = (r) => `${r.status}${r.json?.error?.kind ? ` ${r.json.error.kind}` : ''}${r.json?.data ? ` ${r.json.data.runId} rerun:${r.json.data.rerun}` : ''}`;
  const db = new pg.Pool({ connectionString: DB });
  // Counted in the DATABASE, not inferred from the answers: "exactly one run" is a row count.
  const runsOf = async (missionId) => (await db.query(
    'SELECT run_id, state FROM relay_wonderland.julius_runs WHERE mission_id = $1 AND project_id = $2 ORDER BY created_at',
    [missionId, CONTRACT.projectId])).rows;
  // FIXTURE, stated wherever it is used: a run is ended by writing its state in THIS isolated database. The guard
  // reads julius_runs.state, and driving a real run to an end would need a worker -- which this drill never starts.
  const endRuns = (missionId) => db.query(
    "UPDATE relay_wonderland.julius_runs SET state = 'CANCELLED' WHERE mission_id = $1 AND project_id = $2",
    [missionId, CONTRACT.projectId]);
  try {
    const m = fresh('guard');
    const first = await create(m);
    const runA = first.json?.data?.runId ?? null;
    clause('D01', 'a fresh mission gets its run: 201, READY, not dispatched -- an ACTIVE run',
      first.status === 201 && typeof runA === 'string' && first.json?.data?.state === 'READY'
        && first.json?.data?.dispatched === false,
      { status: first.status, runId: runA, state: first.json?.data?.state ?? 'absent' });

    const accidental = await create(edited(m, 'edited draft'));
    const afterAccident = await runsOf(m.missionId);
    clause('D02', 'an accidental changed resubmission is refused 409 mission_run_already_active, NAMING the live run, and creates nothing',
      accidental.status === 409 && accidental.json?.error?.kind === 'mission_run_already_active'
        && typeof runA === 'string' && String(accidental.json?.error?.message ?? '').includes(runA)
        && afterAccident.length === 1 && afterAccident[0].run_id === runA,
      { status: accidental.status, refusal: accidental.json?.error ?? accidental.text, runsForMission: afterAccident });

    // "Anything but the exact word `explicit` is no intent at all" -- so a near miss is refused EVEN WITH a key, and a
    // key with no intent header is not an intent either.
    const nearMisses = [];
    for (const word of ['yes', 'true', 'explicitly', 'explicit rerun', '']) {
      const r = await create(edited(m, 'edited draft'), { rerun: word, key: rerunKey(`near-${word || 'empty'}`) });
      nearMisses.push({ header: word, status: r.status, kind: r.json?.error?.kind ?? null });
    }
    const keyAlone = await create(edited(m, 'edited draft'), { key: rerunKey('key-alone') });
    nearMisses.push({ header: '(none: a key alone)', status: keyAlone.status, kind: keyAlone.json?.error?.kind ?? null });
    const afterNearMisses = await runsOf(m.missionId);
    clause('D03', 'only the exact word is a rerun intent: every near miss -- key or no key, or a key alone -- is still refused, and creates nothing',
      nearMisses.every((n) => n.status === 409 && n.kind === 'mission_run_already_active') && afterNearMisses.length === 1,
      { nearMisses, runsForMission: afterNearMisses.length });

    // THE KEY IS REQUIRED. Without it a retried rerun could buy a second execution, so the intent alone is refused.
    const keyless = await create(edited(m, 'edited draft'), { rerun: 'explicit' });
    const afterKeyless = await runsOf(m.missionId);
    clause('D03b', 'an explicit rerun WITHOUT a key is refused 400 rerun_key_required, and creates nothing',
      keyless.status === 400 && keyless.json?.error?.kind === 'rerun_key_required' && afterKeyless.length === 1,
      { answer: brief(keyless), refusal: keyless.json?.error ?? keyless.text, runsForMission: afterKeyless.length });

    // Case-insensitive intent, per Julius. (Surrounding spaces cannot be tested over fetch: it trims header values.)
    const keyB = rerunKey('edited-draft');
    const rerun = await create(edited(m, 'edited draft'), { rerun: 'Explicit', key: keyB });
    const runB = rerun.json?.data?.runId ?? null;
    const afterRerun = await runsOf(m.missionId);
    clause('D04', 'an EXPLICIT rerun with its key starts a DISTINCT run, says so (rerun: true), dispatches nothing, and leaves the first run as it was',
      rerun.status === 201 && typeof runB === 'string' && runB !== runA && rerun.json?.data?.rerun === true
        && rerun.json?.data?.dispatched === false
        && afterRerun.length === 2 && afterRerun.some((r) => r.run_id === runA && r.state === 'READY'),
      { status: rerun.status, runA, runB, rerunFlag: rerun.json?.data?.rerun ?? 'absent', runsForMission: afterRerun });

    // THE SAME RERUN, RETRIED: one key is one rerun however many times it is sent -- and the retry is told the TRUTH,
    // that it made nothing (rerun reports the outcome).
    const rerunAgain = await create(edited(m, 'edited draft'), { rerun: 'explicit', key: keyB });
    const afterRetriedRerun = await runsOf(m.missionId);
    clause('D04b', 'retrying that rerun with the SAME key returns the SAME run, reports rerun: false, and makes no third run',
      rerunAgain.status === 201 && rerunAgain.json?.data?.runId === runB && rerunAgain.json?.data?.rerun === false
        && afterRetriedRerun.length === 2,
      { answer: brief(rerunAgain), runB, runsForMission: afterRetriedRerun.length });

    const replay = await create(m);
    clause('D05', 'the IDENTICAL contract is never refused: it resumes its own run, and is not told it got a rerun',
      replay.status === 201 && replay.json?.data?.runId === runA && replay.json?.data?.rerun === false,
      { status: replay.status, runId: replay.json?.data?.runId ?? 'absent', rerunFlag: replay.json?.data?.rerun ?? 'absent' });

    // THE WORLD FOLLOWS THE EXACT runId: one mission, two live runs, each hydrated by its own id, as the native client.
    const hydrateRun = (id) => call('GET',
      `/relay-api/wonderland/julius/hydrate?projectId=${encodeURIComponent(CONTRACT.projectId)}&runId=${id}&cursor=0`,
      { headers: native });
    const seenA = await hydrateRun(runA);
    const seenB = await hydrateRun(runB);
    clause('D06', 'the world follows the exact runId it is given: each of one mission\'s two runs hydrates as itself, never as the other',
      seenA.status === 200 && seenB.status === 200
        && seenA.json?.data?.run?.runId === runA && seenB.json?.data?.run?.runId === runB
        && seenA.json?.data?.run?.missionId === m.missionId && seenB.json?.data?.run?.missionId === m.missionId,
      { a: { status: seenA.status, runId: seenA.json?.data?.run?.runId ?? 'absent' },
        b: { status: seenB.status, runId: seenB.json?.data?.run?.runId ?? 'absent' } });

    // AN EXPLICIT RERUN OF THE UNCHANGED CONTRACT, while its run is live -- the case a content-derived identity
    // could not serve (it resolved to the run already made, and was labelled a rerun). With its own key it is a
    // distinct run; retried with that key it is the same one, and the retry is told it made nothing.
    const keyC = rerunKey('unchanged-live');
    const unchanged = await create(m, { rerun: 'explicit', key: keyC });
    const runC = unchanged.json?.data?.runId ?? null;
    const unchangedAgain = await create(m, { rerun: 'explicit', key: keyC });
    const afterUnchanged = await runsOf(m.missionId);
    clause('D07', 'rerun: true is reported only when a DISTINCT run was made: the unchanged contract, rerun with a key, is a new run (true), and its retry is that run (false)',
      unchanged.status === 201 && typeof runC === 'string' && runC !== runA && runC !== runB
        && unchanged.json?.data?.rerun === true
        && unchangedAgain.status === 201 && unchangedAgain.json?.data?.runId === runC && unchangedAgain.json?.data?.rerun === false
        && afterUnchanged.length === 3,
      { first: brief(unchanged), retry: brief(unchangedAgain), runA, runB, runsForMission: afterUnchanged.length });

    // TERMINALITY RELEASES THE MISSION -- FIXTURE: every run written CANCELLED in this isolated database.
    await endRuns(m.missionId);
    const afterEnd = await create(edited(m, 'after every run ended'));
    const runD = afterEnd.json?.data?.runId ?? null;
    clause('D08', 'once every run of the mission has ended, a changed contract needs no rerun intent: a distinct run, rerun: false',
      afterEnd.status === 201 && typeof runD === 'string' && ![runA, runB, runC].includes(runD)
        && afterEnd.json?.data?.rerun === false,
      { fixture: 'runs written CANCELLED directly in the isolated database', answer: brief(afterEnd) });

    // THE COMMONEST RERUN THERE IS: the same mission, unchanged, after its only run ended -- a retry after a failure.
    // Founder decision 3: "Preserve an EXPLICIT rerun path." FIXTURE: the run written CANCELLED.
    const r2 = fresh('retry');
    const onlyRun = (await create(r2)).json?.data?.runId ?? null;
    await endRuns(r2.missionId);
    const retryPlain = await create(r2);
    const plainNext = String(retryPlain.json?.data?.next ?? '');
    const keyR = rerunKey('after-end');
    const retryExplicit = await create(r2, { rerun: 'explicit', key: keyR });
    const newRun = retryExplicit.json?.data?.runId ?? null;
    const retryExplicitAgain = await create(r2, { rerun: 'explicit', key: keyR });
    const afterRetry = await runsOf(r2.missionId);
    clause('D09', 'the UNCHANGED contract after its run ended: a plain re-post is the ended run, SAID to be final; an explicit rerun with a key is a new READY run; its retry is that run',
      retryPlain.status === 201 && retryPlain.json?.data?.runId === onlyRun && retryPlain.json?.data?.rerun === false
        && /already ended/i.test(plainNext) && !/driven by the Julius mission job/i.test(plainNext)
        && retryExplicit.status === 201 && typeof newRun === 'string' && newRun !== onlyRun
        && retryExplicit.json?.data?.rerun === true && retryExplicit.json?.data?.state === 'READY'
        && retryExplicitAgain.json?.data?.runId === newRun && retryExplicitAgain.json?.data?.rerun === false
        && afterRetry.length === 2,
      { fixture: 'the run written CANCELLED directly in the isolated database', endedRun: onlyRun,
        plainRepost: { answer: brief(retryPlain), state: retryPlain.json?.data?.state ?? 'absent', next: plainNext },
        explicitRerun: { answer: brief(retryExplicit), state: retryExplicit.json?.data?.state ?? 'absent' },
        retriedRerun: brief(retryExplicitAgain), runsForMission: afterRetry });

    // RACE 1: identical twins. Julius's guarantee, precisely: EXACTLY ONE run; a loser may be answered 503
    // bootstrap_persistence_failure, and its retry returns the one run. Not "every request gets 201".
    const twins = fresh('race-identical');
    const burst = await Promise.all(Array.from({ length: 8 }, () => create(twins)));
    const retried = await Promise.all(burst.map((r) => (r.status === 201 ? r : create(twins))));
    const twinRuns = await runsOf(twins.missionId);
    const twinIds = new Set(retried.map((r) => r.json?.data?.runId ?? null));
    clause('D10', 'eight identical creates at once make EXACTLY ONE run; every non-201 is a 503 bootstrap_persistence_failure whose retry returns that run',
      twinRuns.length === 1 && burst.every((r) => r.status === 201
        || (r.status === 503 && r.json?.error?.kind === 'bootstrap_persistence_failure'))
        && retried.every((r) => r.status === 201) && twinIds.size === 1 && twinIds.has(twinRuns[0]?.run_id),
      { runsInDatabase: twinRuns, firstAnswers: burst.map((r) => `${r.status}${r.json?.error?.kind ? ` ${r.json.error.kind}` : ''}`),
        contended: burst.some((r) => r.status !== 201), afterRetry: retried.map((r) => r.status) });

    // RACE 2: different contracts for ONE mission, at once, no rerun intent: two creates cannot both find it free.
    const rivals = fresh('race-different');
    const variants = Array.from({ length: 6 }, (_, i) => edited(rivals, `variant ${i}`));
    const clash = await Promise.all(variants.map((v) => create(v)));
    const settled = await Promise.all(clash.map((r, i) => (r.status === 503 ? create(variants[i]) : r)));
    const rivalRuns = await runsOf(rivals.missionId);
    const winners = settled.filter((r) => r.status === 201);
    clause('D11', 'six DIFFERENT contracts for one mission at once make EXACTLY ONE run; every other answer is mission_run_already_active naming it',
      rivalRuns.length === 1 && winners.length === 1 && winners[0].json?.data?.runId === rivalRuns[0].run_id
        && settled.filter((r) => r.status !== 201).every((r) => r.status === 409
          && r.json?.error?.kind === 'mission_run_already_active'
          && String(r.json?.error?.message ?? '').includes(rivalRuns[0].run_id)),
      // NOT "contended": createRun retries a serialization failure once, which turns a LOST race into a plain 409,
      // so whether these transactions overlapped is not observable from outside. Only a 503 would show it.
      { runsInDatabase: rivalRuns, firstAnswers: clash.map((r) => `${r.status}${r.json?.error?.kind ? ` ${r.json.error.kind}` : ''}`),
        sawRetryable503: clash.some((r) => r.status === 503), settled: settled.map((r) => r.status) });

    // RACE 3: ONE intended rerun sent six times at once -- a double-click, a client retrying on a timeout. This is the
    // double-bill the key exists to close. One key is one rerun: exactly one new run in the database; every settled
    // answer is that run; and AT MOST one answer may say it made it. (Not "exactly one": rerun reports what THIS call
    // did, and the call that inserted the run can still lose a later bootstrap write, answer 503, and have its retry
    // truthfully report false. Two calls both claiming the rerun would be the defect.)
    const r3 = fresh('race-rerun');
    const liveRun = (await create(r3)).json?.data?.runId ?? null;
    const oneKey = rerunKey('race');
    const storm = await Promise.all(Array.from({ length: 6 }, () => create(r3, { rerun: 'explicit', key: oneKey })));
    const calmed = await Promise.all(storm.map((r) => (r.status === 503 ? create(r3, { rerun: 'explicit', key: oneKey }) : r)));
    const r3Runs = await runsOf(r3.missionId);
    const rerunRuns = r3Runs.filter((r) => r.run_id !== liveRun);
    const claims = calmed.filter((r) => r.json?.data?.rerun === true).length;
    clause('D12', 'one rerun key sent six times at once makes EXACTLY ONE new run; every answer is that run, and no two claim to have made it',
      typeof liveRun === 'string' && r3Runs.length === 2 && rerunRuns.length === 1
        && storm.every((r) => r.status === 201 || (r.status === 503 && r.json?.error?.kind === 'bootstrap_persistence_failure'))
        && calmed.every((r) => r.status === 201 && r.json?.data?.runId === rerunRuns[0]?.run_id)
        && claims <= 1,
      { liveRun, runsInDatabase: r3Runs, firstAnswers: storm.map(brief), settled: calmed.map(brief), claimsOfRerun: claims,
        contended: storm.some((r) => r.status === 503) });
  } finally {
    await db.end();
  }
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
