/**
 * THE PROJECT BRAIN, PROVEN END TO END WITH REAL PROCESSES.
 *
 * Not a test: a run with evidence. A real bridge PROCESS (the esbuild bundle,
 * `node dist-relay-bridge/server.cjs`) on a real PostgreSQL, Julius's own
 * production compositions driving a mission with scripted (provider-free)
 * workers, a Wonderland desktop client speaking the exact protocol the Unreal
 * link speaks (native session, no Origin), a website session for pairing, and
 * a bridge RESTART in the middle. Every step is recorded with what it proved,
 * and the whole record is written to the evidence directory.
 *
 *   PROJECT_BRAIN_PROOF_DATABASE_URL  a THROWAWAY database (required). Refused if
 *                                     it names the database the inherited
 *                                     DATABASE_URL names, or one called `julius`.
 *   PROJECT_BRAIN_PROOF_OUT           where the evidence goes (required).
 *
 * No provider is called; no paid path exists in this process. Exit 0 only when
 * every step passed.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { ProjectBrainPostgresStore } from '../src/relay/persistence/project-brain-postgres';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, reviewerWorker,
} from '../relay-bridge/julius/live-composition';
import { createJuliusPostgresRuntimeStore } from '../relay-bridge/julius/postgres-store';

type Json = { data?: any; error?: { kind: string; message: string; durable?: unknown } };
interface Step { readonly step: string; readonly proved: string; readonly passed: boolean; readonly facts: Record<string, unknown>; readonly at: string }

const ORIGIN = 'https://wonderland.proof.invalid';
const steps: Step[] = [];
/** What a failure must tear down, so a failed proof exits instead of holding a bridge and a pool open. */
const cleanup: Array<() => Promise<void>> = [];
const fail = (message: string): never => { throw new Error(message); };

function record(step: string, proved: string, passed: boolean, facts: Record<string, unknown>): void {
  steps.push({ step, proved, passed, facts, at: new Date().toISOString() });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${step} — ${proved}`);
  if (!passed) fail(`${step} failed: ${JSON.stringify(facts)}`);
}

const freePort = () => new Promise<number>((done) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const port = (probe.address() as { port: number }).port; probe.close(() => done(port)); });
});

interface Bridge { readonly base: string; readonly child: ChildProcess; readonly log: string[] }

async function startBridge(input: { databaseUrl: string; operatorToken: string; root: string; label: string }): Promise<Bridge> {
  const port = await freePort();
  // THE BRIDGE'S ENVIRONMENT IS BUILT, NOT INHERITED: every *DATABASE_URL* the shell carries is dropped and BOTH runtime
  // variables are pinned to the proof database, so nothing can reach the persistent Julius store.
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!/DATABASE_URL/u.test(name)) env[name] = value;
  Object.assign(env, {
    JULIUS_DATABASE_URL: input.databaseUrl, DATABASE_URL: input.databaseUrl,
    RELAY_BRIDGE_API_TOKEN: input.operatorToken, RELAY_ALLOWED_ORIGINS: ORIGIN,
    RELAY_BRIDGE_HOST: '127.0.0.1', RELAY_BRIDGE_PORT: String(port), RELAY_DATA_DIR: input.root,
    RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_EXECUTABLE: '/nonexistent/relay-hermes-proof',
    // NO PROVIDER PATH AT ALL: even the bridge's legacy mission registry runs its fake Claude in this process.
    RELAY_BRIDGE_FAKE_CLAUDE: '1',
  });
  for (const name of Object.keys(env)) if (/^(ANTHROPIC|OPENAI|XAI|CLAUDE_CODE_OAUTH)/u.test(name)) delete env[name];
  const child = spawn(process.execPath, [resolve('dist-relay-bridge/server.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.push(async () => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const log: string[] = [];
  const scrub = (line: string) => line.split(input.operatorToken).join('[operator-token]');
  child.stdout?.on('data', (chunk: Buffer) => log.push(...chunk.toString('utf8').split('\n').filter(Boolean).map((line) => `[${input.label}] ${scrub(line)}`)));
  child.stderr?.on('data', (chunk: Buffer) => log.push(...chunk.toString('utf8').split('\n').filter(Boolean).map((line) => `[${input.label}!] ${scrub(line)}`)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) fail(`bridge ${input.label} exited: ${log.join('\n')}`);
    try { if ((await fetch(`${base}/health`)).status === 200) return { base, child, log }; } catch { /* not yet */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  return fail(`bridge ${input.label} did not come up`);
}

async function stopBridge(bridge: Bridge): Promise<void> {
  if (bridge.child.exitCode !== null) return;
  const exited = new Promise<void>((done) => bridge.child.once('exit', () => done()));
  bridge.child.kill('SIGTERM');
  const timer = setTimeout(() => bridge.child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

async function call(base: string, method: string, path: string, options: { body?: unknown; auth?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.auth === undefined ? {} : { authorization: options.auth }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.PROJECT_BRAIN_PROOF_DATABASE_URL?.trim() || fail('PROJECT_BRAIN_PROOF_DATABASE_URL is required (a throwaway database).');
  const out = process.env.PROJECT_BRAIN_PROOF_OUT?.trim() || fail('PROJECT_BRAIN_PROOF_OUT is required.');
  const target = new URL(databaseUrl);
  const inherited = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (target.pathname.replace('/', '') === 'julius'
    || (inherited !== null && inherited.host === target.host && inherited.pathname === target.pathname)) {
    fail('Refusing: the proof database is the persistent Julius store.');
  }
  mkdirSync(out, { recursive: true });
  const operatorToken = randomBytes(24).toString('hex');
  const root = mkdtempSync(join(tmpdir(), 'project-brain-proof-'));
  const id = randomBytes(4).toString('hex');
  const tenant = `founder-${id}`;
  const projectId = `prj-brain-proof-${id}`;
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', () => undefined);
  cleanup.push(async () => { await pool.end().catch(() => undefined); });
  await new TransactionalWonderlandDatabase(pool).migrate();
  const operator = { auth: `Bearer ${operatorToken}`, headers: { 'x-relay-tenant': tenant } };

  let bridge = await startBridge({ databaseUrl, operatorToken, root, label: 'bridge#1' });
  record('BRIDGE', 'a real bridge process is up on the proof database', true, { base: bridge.base, pid: bridge.child.pid });

  // 1. MISSION CREATED, through Julius's own creation route.
  const created = await call(bridge.base, 'POST', '/relay-api/julius/missions', { auth: operator.auth, body: {
    missionId: `mission:brain-proof-${id}`, markerNamespace: `brain-proof-${id}`, projectId, tenantId: tenant,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'], constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '', workspacePath: `/workspace/brain-proof-${id}`, limits: { spendUsd: 2, repairCycles: 1 },
  } });
  const runId = created.json.data?.runId as string;
  const row = await pool.query('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [runId, projectId]);
  record('1 MISSION CREATED', 'Julius created the mission and it is durable at once', created.status === 201 && row.rows[0]?.state === 'READY',
    { status: created.status, runId, durableState: row.rows[0]?.state });

  // 2. WONDERLAND SIGNS IN: the website session pairs the desktop client, which redeems the code with no Origin.
  const minted = await call(bridge.base, 'POST', '/relay-api/browser/pair', { auth: operator.auth, body: { origin: ORIGIN, scope: 'control', participantId: tenant } });
  const website = await call(bridge.base, 'POST', '/relay-api/browser/session', { origin: ORIGIN, body: { grantId: minted.json.data.grantId, grantSecret: minted.json.data.grantSecret } });
  const websiteSession = { auth: `Relay-Session ${website.json.data.sessionToken}`, origin: ORIGIN };
  const pairDesktop = async (base: string, session: { auth: string; origin: string }) => {
    const paired = await call(base, 'POST', '/relay-api/wonderland/native/pair', { ...session, body: { projectId } });
    const redeemed = await call(base, 'POST', '/relay-api/wonderland/native/session', { body: { code: paired.json.data?.code } });
    return { paired, redeemed, desktop: { auth: `Relay-Session ${redeemed.json.data?.token}` } };
  };
  let { paired, redeemed, desktop } = await pairDesktop(bridge.base, websiteSession);
  record('2 DESKTOP PAIRED', 'a Wonderland desktop session exists, bound to this project and this player', paired.status === 200 && redeemed.status === 200
    && redeemed.json.data.projectId === projectId && redeemed.json.data.participantId === tenant, { pair: paired.status, redeem: redeemed.status });

  // 3. WONDERLAND READS IT, as the desktop client does.
  const view1 = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, desktop);
  const surface = (view: Json, name: string) => (view.data.surfaces as Array<{ id: string; entryCount: number; entries: Array<{ line: string; ref: string }>; proposals: Array<{ line: string; ref: string }> }>).find((s) => s.id === name)!;
  record('3 WONDERLAND READS', 'the panel view is real: the mission\'s objective, requirements and constraints, 29 surfaces, no sample data',
    view1.status === 200 && view1.json.data.surfaces.length === 29
      && surface(view1.json, 'objective').entries.some((e) => e.line.includes('three candidate save-file formats'))
      && surface(view1.json, 'requirements').entries.some((e) => e.line.includes('forward compatibility'))
      && !JSON.stringify(view1.json).includes('SAMPLE'),
    { status: view1.status, sourceLine: view1.json.data?.sourceLine, revision: view1.json.data?.brainRevision });

  // 4. A LIVE FEED IS OPEN while Wonderland writes back.
  const feedStarted = Date.now();
  const feed = call(bridge.base, 'GET', `/relay-api/wonderland/brain/events?projectId=${projectId}&cursor=${encodeURIComponent(view1.json.data.cursor)}&waitMs=20000`, desktop);
  await new Promise((done) => setTimeout(done, 300));
  const proposal = await call(bridge.base, 'POST', '/relay-api/wonderland/brain/proposals', { ...desktop, body: {
    projectId, surfaceId: 'requirements', runId, idempotencyKey: `wl-proof-${id}-1`, text: 'The comparison must include a table of load times in milliseconds.',
  } });
  const instruction = await call(bridge.base, 'POST', '/relay-api/wonderland/brain/proposals', { ...desktop, body: {
    projectId, surfaceId: 'instructions', idempotencyKey: `wl-proof-${id}-2`, text: 'Cite the source for every load-time figure.',
  } });
  const proposalRef = proposal.json.data?.recordRef as string;
  const stored = await pool.query('SELECT status, author_kind, author_id, deliverer_kind FROM relay_wonderland.project_brain_records WHERE record_id=$1 AND project_id=$2', [proposalRef, projectId]);
  record('4 WONDERLAND WRITES BACK', 'a desktop proposal is durable, authored by the paired player and delivered by the Wonderland client',
    proposal.status === 201 && instruction.status === 201 && stored.rows[0]?.status === 'PROPOSED' && stored.rows[0]?.author_id === tenant
      && stored.rows[0]?.author_kind === 'WONDERLAND_PLAYER' && stored.rows[0]?.deliverer_kind === 'WONDERLAND_CLIENT',
    { proposal: proposal.json.data, durableRow: stored.rows[0] });
  const woke = await feed;
  record('5 LIVE EVENT', 'the open long poll was answered by the write itself (LISTEN/NOTIFY), not by a timer',
    woke.status === 200 && woke.json.data.events.some((e: { type: string }) => e.type === 'project_brain.record.created') && Date.now() - feedStarted < 15_000,
    { latencyMs: Date.now() - feedStarted, events: woke.json.data.events.map((e: { type: string; refs: string[] }) => ({ type: e.type, refs: e.refs })) });

  // 6. JULIUS READS THE PROJECT BRAIN during the mission: its next packet carries what the player said.
  const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool));
  const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]);
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: architect },
      { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, []) },
      { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), []) },
    ],
    cardRevision: 'card:brain-proof:1', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
  });
  await runtime.loop.tick({ projectId });
  // JULIUS JUDGES WHAT CAME BACK on its next advance: the plan's verification decision is made there, not in the tick.
  await runtime.loop.advanceRun(runId, projectId);
  const packet = architect.dispatches[0] === undefined ? '' : (handoffs.contexts.snapshotFor(architect.dispatches[0].contextId)?.packet.blocks.map((b) => b.text).join('\n') ?? '');
  const snapshotIds = architect.dispatches[0] === undefined ? [] : (await pool.query<{ ids: string[] }>('SELECT source_entry_ids AS ids FROM relay_wonderland.julius_context_snapshots WHERE context_id=$1', [architect.dispatches[0].contextId])).rows[0]?.ids ?? [];
  record('6 JULIUS READS', 'the plan worker\'s compiled context carries the player\'s proposal and instruction, as a proposal, and the durable snapshot names the record versions',
    packet.includes('table of load times in milliseconds') && packet.includes('[a proposal, not a term of the contract]') && packet.includes('Cite the source')
      && snapshotIds.includes(`${proposalRef}@v1`),
    { contextId: architect.dispatches[0]?.contextId, sourceEntryIds: snapshotIds.filter((value) => value.startsWith('pbr:')) });

  // 7. JULIUS UPDATES IT: the plan's evidence and decision are durable; the reviewer's finding goes through Julius's ports.
  const store = createJuliusPostgresRuntimeStore(pool);
  const evidence = await pool.query<{ evidence_id: string; task_id: string }>('SELECT evidence_id, task_id FROM relay_wonderland.julius_evidence WHERE run_id=$1 LIMIT 1', [runId]);
  const view2Before = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, desktop);
  const feed2 = call(bridge.base, 'GET', `/relay-api/wonderland/brain/events?projectId=${projectId}&cursor=${encodeURIComponent(view2Before.json.data.cursor)}&waitMs=20000`, desktop);
  await new Promise((done) => setTimeout(done, 300));
  const findingId = `finding:brain-proof-${id}`;
  const now = new Date().toISOString();
  await store.recordFinding({ projectId, finding: {
    findingId, runId, taskId: evidence.rows[0]!.task_id, reviewerWorkerId: 'reviewer-hermes', severity: 'HIGH', category: 'completeness',
    claim: 'Load time is not measured for the third format.', criterionId: 'AC-1', evidenceIds: [evidence.rows[0]!.evidence_id],
    blocking: true, status: 'OPEN', createdAt: now, updatedAt: now,
  } as never });
  await store.appendEvent({ eventId: `event:brain-proof:${id}:finding`, runId, projectId, type: 'finding.recorded', taskId: evidence.rows[0]!.task_id,
    workerId: 'reviewer-hermes', correlationId: findingId, causationId: null, occurredAt: now, facts: { findingId } });
  const woke2 = await feed2;
  const view2 = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, desktop);
  const reviewTask = await pool.query<{ state: string }>(`SELECT t.state FROM relay_wonderland.julius_tasks t WHERE t.run_id=$1 AND t.task_type LIKE 'review%'`, [runId]);
  const activityTypes = (view2.json.data.surfaces as Array<{ id: string; entries: Array<{ line: string }> }>).find((s) => s.id === 'past_actions')!.entries.map((e) => e.line);
  // THE PLAN IS NOW WITH THE INDEPENDENT REVIEWER: Julius's own next step. A verification decision follows the
  // reviewer's verdict, which this provider-free proof does not script, so none is claimed here.
  record('7 JULIUS UPDATES → WONDERLAND', "Julius's plan evidence, the review it opened and the reviewer's finding are in the durable Brain, the finding arrived live, and all three read back on the panel",
    evidence.rowCount === 1 && (reviewTask.rowCount ?? 0) > 0
      && woke2.json.data.events.some((e: { type: string }) => e.type === 'project_brain.finding.created')
      && surface(view2.json, 'evaluations').entries.some((e) => e.ref === `finding:${findingId}`)
      && surface(view2.json, 'evidence').entryCount > 0 && activityTypes.length > 0,
    { liveEvents: woke2.json.data.events.map((e: { type: string }) => e.type), evidenceCount: surface(view2.json, 'evidence').entryCount,
      reviewTasks: reviewTask.rows.map((r) => r.state), pastActions: activityTypes.slice(0, 5), revision: view2.json.data.brainRevision,
      decision: 'not driven: a verification decision follows the reviewer verdict, which this proof does not script' });

  // 8. AN AUTHORIZED WONDERLAND CHANGE, AND JULIUS READS THE NEW STATE: the owner adopts the proposal.
  const adopted = await call(bridge.base, 'POST', `/relay-api/wonderland/brain/mutations?projectId=${projectId}`, { ...desktop, body: {
    operation: 'SET_STATUS', idempotencyKey: `wl-proof-${id}-adopt`, recordId: proposalRef, expectedVersion: 1, status: 'ADOPTED',
  } });
  const juliusSees = await new ProjectBrainPostgresStore(pool).contextEntriesForRun(runId, projectId);
  const adoptedLine = juliusSees.find((entry) => entry.entryId === `${proposalRef}@v2`)?.text ?? '';
  record('8 AUTHORIZED CHANGE → JULIUS', 'the owner\'s adoption is a new durable version Julius reads; the old version no longer reaches its context',
    adopted.status === 201 && adopted.json.data.version === 2 && adoptedLine.includes('REQUIREMENT ADOPTED') && !juliusSees.some((entry) => entry.entryId === `${proposalRef}@v1`),
    { adopted: adopted.json.data, juliusReads: adoptedLine });

  // 9. RESTART / RECONNECT: a new bridge process on the same database.
  const beforeRestart = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator);
  const cursorBeforeRestart = beforeRestart.json.data.cursor as string;
  await stopBridge(bridge);
  const firstLog = bridge.log;
  bridge = await startBridge({ databaseUrl, operatorToken, root, label: 'bridge#2' });
  const stale = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, desktop);
  const minted2 = await call(bridge.base, 'POST', '/relay-api/browser/pair', { auth: operator.auth, body: { origin: ORIGIN, scope: 'control', participantId: tenant } });
  const website2 = await call(bridge.base, 'POST', '/relay-api/browser/session', { origin: ORIGIN, body: { grantId: minted2.json.data.grantId, grantSecret: minted2.json.data.grantSecret } });
  ({ paired, redeemed, desktop } = await pairDesktop(bridge.base, { auth: `Relay-Session ${website2.json.data.sessionToken}`, origin: ORIGIN }));
  const afterRestart = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator);
  const same = JSON.stringify({ ...afterRestart.json.data, observedAt: null, sections: { ...afterRestart.json.data.sections, governance: null } })
    === JSON.stringify({ ...beforeRestart.json.data, observedAt: null, sections: { ...beforeRestart.json.data.sections, governance: null } });
  const resumed = await call(bridge.base, 'GET', `/relay-api/wonderland/brain/events?projectId=${projectId}&cursor=${encodeURIComponent(cursorBeforeRestart)}`, desktop);
  const afterWrite = await call(bridge.base, 'POST', '/relay-api/wonderland/brain/proposals', { ...desktop, body: {
    projectId, surfaceId: 'scratchpads', idempotencyKey: `wl-proof-${id}-after`, text: 'Written after the restart.',
  } });
  const resumedAgain = await call(bridge.base, 'GET', `/relay-api/wonderland/brain/events?projectId=${projectId}&cursor=${encodeURIComponent(cursorBeforeRestart)}`, desktop);
  record('9 RESTART', 'after a bridge process restart the Brain is identical, the old desktop session is refused (fail-closed), the client re-pairs, and the feed resumes from the old cursor with exactly the new write',
    stale.status === 401 && redeemed.status === 200 && same && resumed.json.data.events.length === 0 && afterWrite.status === 201
      && resumedAgain.json.data.events.length === 1 && resumedAgain.json.data.events[0].type === 'project_brain.record.created',
    { staleSession: stale.status, documentIdentical: same, revisionBefore: beforeRestart.json.data.revision, revisionAfter: afterRestart.json.data.revision,
      eventsAfterOldCursorBeforeWrite: resumed.json.data.events.length, eventsAfterOldCursorAfterWrite: resumedAgain.json.data.events.length });

  // 10. ISOLATION: another project's player sees none of it.
  const otherTenant = `other-${id}`;
  const otherProject = `prj-brain-proof-other-${id}`;
  await call(bridge.base, 'POST', '/relay-api/julius/missions', { auth: operator.auth, body: {
    missionId: `mission:brain-proof-other-${id}`, markerNamespace: `brain-proof-other-${id}`, projectId: otherProject, tenantId: otherTenant,
    objective: 'Another project entirely.', requirements: ['x'], constraints: ['y'], acceptanceCriteria: [{ id: 'AC-1', text: 'z', blocking: true }],
    testCommand: '', workspacePath: `/workspace/brain-proof-other-${id}`, limits: { spendUsd: 1, repairCycles: 1 },
  } });
  const minted3 = await call(bridge.base, 'POST', '/relay-api/browser/pair', { auth: operator.auth, body: { origin: ORIGIN, scope: 'control', participantId: otherTenant } });
  const other = await call(bridge.base, 'POST', '/relay-api/browser/session', { origin: ORIGIN, body: { grantId: minted3.json.data.grantId, grantSecret: minted3.json.data.grantSecret } });
  const otherSession = { auth: `Relay-Session ${other.json.data.sessionToken}`, origin: ORIGIN };
  const intrude = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, otherSession);
  const theirs = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${otherProject}&view=document`, otherSession);
  record('10 ISOLATION', 'a player of another project gets "not found" for this Brain and sees none of its records in their own',
    intrude.status === 404 && theirs.status === 200 && !JSON.stringify(theirs.json).includes('table of load times'),
    { intrude: intrude.status, theirs: theirs.status });

  await stopBridge(bridge);
  await pool.end();
  cleanup.length = 0;
  const evidence_ = {
    schemaVersion: 'relay-project-brain-proof.v1', ranAt: new Date().toISOString(), projectId, runId,
    database: `${target.hostname}:${target.port}${target.pathname}`, providerCalls: 0,
    steps, bridgeLog: [...firstLog, ...bridge.log],
  };
  writeFileSync(join(out, 'project-brain-proof.json'), `${JSON.stringify(evidence_, null, 2)}\n`);
  console.log(`\nPROJECT BRAIN PROOF: ${steps.filter((s) => s.passed).length}/${steps.length} steps passed · evidence ${join(out, 'project-brain-proof.json')}`);
}

main().catch(async (error) => {
  console.error(`PROJECT BRAIN PROOF FAILED: ${error instanceof Error ? error.message : String(error)}`);
  for (const undo of cleanup.splice(0).reverse()) await undo().catch(() => undefined);
  const out = process.env.PROJECT_BRAIN_PROOF_OUT?.trim();
  if (out) {
    try {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'project-brain-proof.FAILED.json'), `${JSON.stringify({ steps, error: String(error) }, null, 2)}\n`);
    } catch { /* the console line above is the record */ }
  }
  process.exit(1);
});
