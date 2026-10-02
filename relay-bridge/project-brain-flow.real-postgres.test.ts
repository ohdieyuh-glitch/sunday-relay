import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, reviewerWorker,
} from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * JULIUS ↔ DURABLE PROJECT BRAIN ↔ WONDERLAND BACKEND, END TO END, OVER REAL HTTP.
 *
 * A real bridge (`createBridgeServer`), a real PostgreSQL, Julius's own
 * production compositions (the mission route's bootstrap, the run loop over
 * `createJuliusPostgresRuntimeStore`), and a Wonderland player signed in through
 * the bridge's real pairing. No provider is called: the workers are scripted
 * adapters, so the only thing simulated is a model's answer.
 *
 * Steps A-O are the founder's list, in order, sharing one project's history:
 *   A mission created · B persisted · C Wonderland reads it · D Julius adds to it ·
 *   E Wonderland receives it live · F a Wonderland change persists · G Julius
 *   reads that change · H restart/reconnect preserves it · I a second mission
 *   inherits project memory · J another project cannot · K concurrent writers ·
 *   L duplicates are idempotent · M relationships hold · N governance is enforced ·
 *   O errors are truthful.
 *
 * Gated on JULIUS_TEST_DATABASE_URL (throwaway), `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
// Real processes and a real database: CI runs this file with no timeout flag, so it states its own.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const suite = databaseUrl !== null ? describe : describe.todo;
const OPERATOR = 'operator-secret-for-project-brain-0123456789';
const ORIGIN = 'https://wonderland.example.test';
const CARD = 'card:project-brain-flow:1';
const nonce = () => randomBytes(4).toString('hex');

type Json = { data?: any; error?: { kind: string; message: string; durable?: unknown } };
interface Bridge { base: string; server: Server }

const roots: string[] = [];

async function boot(env: Record<string, string | undefined>): Promise<Bridge> {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'relay-project-brain-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_HERMES_EXECUTABLE', '/nonexistent/relay-hermes-probe');
  vi.stubEnv('RELAY_HERMES_PROVIDER', 'xai');
  vi.stubEnv('RELAY_DATA_DIR', root);
  vi.stubEnv('DATABASE_URL', undefined as unknown as string);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value as string);
  const { createBridgeServer } = await import('./server');
  const { loadBridgeConfig } = await import('./config');
  const server = createBridgeServer(loadBridgeConfig(process.env), {
    start: () => ({ state: 'ready' }) as never, get: () => ({ state: 'ready' }) as never, cancel: () => undefined, retry: () => undefined,
  } as never);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { base: `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`, server };
}
const shut = (bridge: Bridge) => new Promise<void>((resolve) => { bridge.server.closeAllConnections?.(); bridge.server.close(() => resolve()); });

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
const operator = (tenantId: string, extra: Record<string, string> = {}) => ({ auth: `Bearer ${OPERATOR}`, headers: { 'x-relay-tenant': tenantId, ...extra } });

/** A Wonderland player, signed in through the bridge's real pairing: operator mints, the browser redeems. */
async function signIn(base: string, participantId: string): Promise<{ auth: string; origin: string }> {
  const minted = await call(base, 'POST', '/relay-api/browser/pair', { auth: `Bearer ${OPERATOR}`, body: { origin: ORIGIN, scope: 'control', participantId } });
  expect(minted.status, JSON.stringify(minted.json)).toBe(200);
  const redeemed = await call(base, 'POST', '/relay-api/browser/session', { origin: ORIGIN, body: { grantId: minted.json.data.grantId, grantSecret: minted.json.data.grantSecret } });
  expect(redeemed.status).toBe(200);
  return { auth: `Relay-Session ${redeemed.json.data.sessionToken}`, origin: ORIGIN };
}

function contractFor(projectId: string, tenantId: string, id: string) {
  return {
    missionId: `mission:pbflow-${id}`, markerNamespace: `pbflow-${id}`, projectId, tenantId,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '', workspacePath: `/workspace/pbflow-${id}`, limits: { spendUsd: 2, repairCycles: 1 },
  };
}

/** Read an SSE stream until `until` returns true for a parsed event, or the deadline passes. */
async function readSse(url: string, headers: Record<string, string>, until: (event: { type: string; data: any; id: string | null }) => boolean, ms: number,
  onOpen?: () => Promise<void>) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  const seen: Array<{ type: string; data: any; id: string | null }> = [];
  try {
    const response = await fetch(url, { headers, signal: abort.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let opened = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const lines = frame.split('\n');
        const type = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message';
        const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
        const id = lines.find((line) => line.startsWith('id: '))?.slice(4) ?? null;
        if (data === undefined) continue;
        const event = { type, data: JSON.parse(data), id };
        seen.push(event);
        if (!opened && type === 'project_brain.ready') { opened = true; if (onOpen) await onOpen(); }
        if (until(event)) { abort.abort(); return seen; }
      }
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }
  return seen;
}

suite('Julius ↔ Project Brain ↔ Wonderland, end to end over a real PostgreSQL', () => {
  let pool: Pool;
  let bridge: Bridge;
  const id = nonce();
  const tenant = `owner-${id}`;
  const projectId = `prj-pbflow-${id}`;
  let runId = '';
  let player: { auth: string; origin: string };
  let requirementProposal = '';
  let instructionRecord = '';
  let documentCursor = '';
  let findingId = '';
  const env = () => ({ JULIUS_DATABASE_URL: databaseUrl! });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    bridge = await boot(env());
  }, 120_000);
  afterAll(async () => {
    if (bridge) await shut(bridge);
    await pool?.end();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }, 60_000);

  const wonderland = (method: string, path: string, body?: unknown) => call(bridge.base, method, `/relay-api${path}`, { ...player, ...(body === undefined ? {} : { body }) });

  it('A-C: a mission Julius creates is durable at once, and Wonderland reads it from the one Brain', async () => {
    const created = await call(bridge.base, 'POST', '/relay-api/julius/missions', { auth: `Bearer ${OPERATOR}`, body: contractFor(projectId, tenant, id) });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    runId = created.json.data.runId;
    const row = await pool.query('SELECT state, project_id FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId]);
    expect(row.rows[0]).toEqual({ state: 'READY', project_id: projectId });

    player = await signIn(bridge.base, tenant);
    const view = await wonderland('GET', `/wonderland/brain?projectId=${projectId}`);
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    const surface = (name: string) => view.json.data.surfaces.find((s: { id: string }) => s.id === name);
    expect(view.json.data.sourceLine).toMatch(/^PROJECT BRAIN · LIVE · /u);
    expect(view.json.data.missionRef).toBe(`mission:${runId}`);
    expect(surface('objective').entries.map((e: { line: string }) => e.line).join('\n')).toContain('Write a comparison of the three candidate save-file formats.');
    expect(surface('requirements').entries.map((e: { line: string }) => e.line).join('\n')).toContain('Compare size, load time and forward compatibility.');
    expect(surface('constraints').entries.map((e: { line: string }) => e.line).join('\n')).toContain('Touch only docs/.');
    expect(surface('governance').entries.map((e: { line: string }) => e.line).join('\n')).toMatch(/Mission policy/u);
    expect(JSON.stringify(view.json)).not.toMatch(/SAMPLE|DEVELOPMENT PREVIEW/u);
    documentCursor = view.json.data.cursor;
    // The operator door reads the same document.
    const document = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator(tenant));
    expect(document.status).toBe(200);
    expect(document.json.data.missions.map((m: { runId: string }) => m.runId)).toEqual([runId]);
    // The old in-memory route now answers from the same Brain.
    const legacy = await wonderland('GET', `/wonderland/projects/${projectId}/brain`);
    expect(legacy.status).toBe(200);
    expect(legacy.json.data.schemaVersion).toBe('relay-project-brain.v1');
  });

  it('C (desktop): the Wonderland desktop client, paired from the website, reads and writes the same Brain', async () => {
    // The website pairs the desktop client for this project (membership checked in PostgreSQL)...
    const paired = await call(bridge.base, 'POST', '/relay-api/wonderland/native/pair', { ...player, body: { projectId } });
    expect(paired.status, JSON.stringify(paired.json)).toBe(200);
    // ...and the desktop client, which sends no Origin, redeems the code once.
    const redeemed = await call(bridge.base, 'POST', '/relay-api/wonderland/native/session', { body: { code: paired.json.data.code } });
    expect(redeemed.status).toBe(200);
    const desktop = { auth: `Relay-Session ${redeemed.json.data.token}` };
    const view = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, desktop);
    expect(view.status).toBe(200);
    expect(view.json.data.surfaces).toHaveLength(29);
    const note = await call(bridge.base, 'POST', '/relay-api/wonderland/brain/proposals', {
      ...desktop, body: { projectId, surfaceId: 'scratchpads', idempotencyKey: `desk-${nonce()}`, text: 'Noted from the desktop client.' },
    });
    expect(note.status, JSON.stringify(note.json)).toBe(201);
    expect(note.json.data.author).toEqual({ kind: 'WONDERLAND_PLAYER', id: tenant });
    // Bound to its project: another project is not there for it, whatever the membership says.
    expect((await call(bridge.base, 'GET', '/relay-api/wonderland/brain?projectId=prj-elsewhere', desktop)).status).toBe(404);
  });

  it('F: a Wonderland proposal and a standing instruction are durable the moment they are acknowledged', async () => {
    const proposal = await wonderland('POST', '/wonderland/brain/proposals', {
      projectId, surfaceId: 'requirements', runId, idempotencyKey: `wl-${nonce()}`, text: 'The comparison must include a table of load times in milliseconds.',
    });
    expect(proposal.status, JSON.stringify(proposal.json)).toBe(201);
    expect(proposal.json.data).toMatchObject({ durable: true, replayed: false, status: 'PROPOSED', author: { kind: 'WONDERLAND_PLAYER', id: tenant } });
    expect(proposal.json.data.deliverer.kind).toBe('WONDERLAND_CLIENT');
    requirementProposal = proposal.json.data.recordRef;
    const instruction = await wonderland('POST', '/wonderland/brain/proposals', {
      projectId, surfaceId: 'instructions', idempotencyKey: `wl-${nonce()}`, text: 'Cite the source for every load-time figure.',
    });
    expect(instruction.status).toBe(201);
    instructionRecord = instruction.json.data.recordRef;
    const rows = await pool.query(`SELECT record_id, status, author_kind, deliverer_kind FROM relay_wonderland.project_brain_records
      WHERE project_id=$1 AND domain IN ('REQUIREMENT','INSTRUCTION') ORDER BY created_at`, [projectId]);
    expect(rows.rows).toEqual([
      { record_id: requirementProposal, status: 'PROPOSED', author_kind: 'WONDERLAND_PLAYER', deliverer_kind: 'WONDERLAND_CLIENT' },
      { record_id: instructionRecord, status: 'ACTIVE', author_kind: 'WONDERLAND_PLAYER', deliverer_kind: 'WONDERLAND_CLIENT' },
    ]);
  });

  it('G: Julius reads the change in the next packet it compiles -- as a person\'s statement, below the contract', async () => {
    const handoffs = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool));
    const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]);
    const runtime = assembleLiveJuliusRuntime({
      store: handoffs.store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, []) },
        { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), []) },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
    });
    await runtime.loop.tick({ projectId });
    expect(architect.dispatches.length, 'the plan was dispatched').toBeGreaterThan(0);
    const snapshot = handoffs.contexts.snapshotFor(architect.dispatches[0]!.contextId)!;
    const packet = snapshot.packet.blocks.map((block) => block.text).join('\n');
    expect(packet).toContain('The comparison must include a table of load times in milliseconds.');
    expect(packet).toContain('[a proposal, not a term of the contract]');
    expect(packet).toContain('Cite the source for every load-time figure.');
    expect(packet).toContain('stated by WONDERLAND_PLAYER');
    // Durably: the snapshot Julius kept names the record versions it read.
    const durable = await pool.query<{ ids: string[] }>('SELECT source_entry_ids AS ids FROM relay_wonderland.julius_context_snapshots WHERE context_id=$1', [architect.dispatches[0]!.contextId]);
    expect(durable.rows[0]!.ids).toEqual(expect.arrayContaining([`${requirementProposal}@v1`, `${instructionRecord}@v1`]));
    // And the operator can see exactly what Julius reads for this run.
    const read = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}/julius-context?runId=${encodeURIComponent(runId)}`, operator(tenant));
    expect(read.json.data.entries.map((e: { entryId: string }) => e.entryId)).toEqual(expect.arrayContaining([`${requirementProposal}@v1`, `${instructionRecord}@v1`]));
  });

  it('D-E: what Julius writes reaches Wonderland live -- SSE and long-poll -- and reads back', async () => {
    const store = createJuliusPostgresRuntimeStore(pool);
    const evidence = await pool.query<{ evidence_id: string; task_id: string }>('SELECT evidence_id, task_id FROM relay_wonderland.julius_evidence WHERE run_id=$1 LIMIT 1', [runId]);
    expect(evidence.rowCount, 'the plan left evidence').toBe(1);
    findingId = `finding:pbflow-${nonce()}`;
    const writeFinding = async () => {
      expect(await store.recordFinding({ projectId, finding: {
        findingId, runId, taskId: evidence.rows[0]!.task_id, reviewerWorkerId: 'reviewer-hermes', severity: 'HIGH', category: 'completeness',
        claim: 'Load time is not measured for the third format.', criterionId: 'AC-1', evidenceIds: [evidence.rows[0]!.evidence_id],
        blocking: true, status: 'OPEN', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } as never })).toBe(true);
      expect(await store.appendEvent({ eventId: `event:pbflow:${nonce()}`, runId, projectId, type: 'finding.recorded', taskId: evidence.rows[0]!.task_id,
        workerId: 'reviewer-hermes', correlationId: findingId, causationId: null, occurredAt: new Date().toISOString(), facts: { findingId } })).toBe(true);
    };
    const events = await readSse(
      `${bridge.base}/relay-api/wonderland/brain/events?projectId=${projectId}&mode=sse&cursor=${encodeURIComponent(documentCursor)}`,
      { authorization: player.auth, origin: player.origin },
      (event) => event.type === 'project_brain.finding.created',
      10_000,
      writeFinding,
    );
    const finding = events.find((event) => event.type === 'project_brain.finding.created');
    expect(finding, `events seen: ${events.map((event) => event.type).join(', ')}`).toBeDefined();
    expect(finding!.data.refs).toEqual(expect.arrayContaining([`mission:${runId}`, `finding:${findingId}`]));
    expect(finding!.id, 'the SSE id is the resume cursor').toMatch(/^pbc1\./u);
    // The Wonderland write that happened before the stream opened was replayed from the cursor too.
    expect(events.map((event) => event.type)).toContain('project_brain.record.created');
    expect(JSON.stringify(events), 'events carry references, not content').not.toContain('Load time is not measured');

    // Long-poll: a page that is waiting is answered by the wake-up, not by a timer.
    const head = (await wonderland('GET', `/wonderland/brain/events?projectId=${projectId}&cursor=head`)).json.data.cursor;
    const started = Date.now();
    const waiting = wonderland('GET', `/wonderland/brain/events?projectId=${projectId}&cursor=${encodeURIComponent(head)}&waitMs=20000`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await store.appendEvent({ eventId: `event:pbflow:${nonce()}`, runId, projectId, type: 'evidence.recorded', taskId: evidence.rows[0]!.task_id,
      workerId: 'coder', correlationId: 'x', causationId: null, occurredAt: new Date().toISOString(), facts: { evidenceId: evidence.rows[0]!.evidence_id } });
    const page = await waiting;
    expect(page.json.data.events.map((event: { type: string }) => event.type)).toEqual(['project_brain.evidence.recorded']);
    expect(Date.now() - started, 'woken, not timed out').toBeLessThan(10_000);

    const view = await wonderland('GET', `/wonderland/brain?projectId=${projectId}`);
    const evaluations = view.json.data.surfaces.find((s: { id: string }) => s.id === 'evaluations');
    expect(evaluations.entries.map((e: { ref: string }) => e.ref)).toContain(`finding:${findingId}`);
    const evidenceSurface = view.json.data.surfaces.find((s: { id: string }) => s.id === 'evidence');
    expect(evidenceSurface.entryCount).toBeGreaterThan(0);
  });

  it('H: a restarted bridge serves the same Brain; old sessions are refused; the feed resumes from the old cursor', async () => {
    const before = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator(tenant));
    const oldPlayer = player;
    await shut(bridge);
    bridge = await boot(env());
    const stale = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, oldPlayer);
    expect(stale.status, 'browser sessions are in memory and die with the process: fail-closed').toBe(401);
    player = await signIn(bridge.base, tenant);
    const after = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator(tenant));
    expect({ ...after.json.data, observedAt: null, sections: { ...after.json.data.sections, governance: null } })
      .toEqual({ ...before.json.data, observedAt: null, sections: { ...before.json.data.sections, governance: null } });
    const resumed = await wonderland('GET', `/wonderland/brain/events?projectId=${projectId}&cursor=${encodeURIComponent(documentCursor)}`);
    const types = resumed.json.data.events.map((event: { type: string }) => event.type);
    expect(types).toEqual(expect.arrayContaining(['project_brain.record.created', 'project_brain.finding.created', 'project_brain.evidence.recorded']));
  });

  it('I-J: a second mission inherits what the project was told, and another project sees none of it', async () => {
    const second = await call(bridge.base, 'POST', '/relay-api/julius/missions', { auth: `Bearer ${OPERATOR}`, body: { ...contractFor(projectId, tenant, `${id}-2`), objective: 'Second mission: pick one format.' } });
    expect(second.status).toBe(201);
    const run2 = second.json.data.runId as string;
    const read = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}/julius-context?runId=${encodeURIComponent(run2)}`, operator(tenant));
    const ids = read.json.data.entries.map((e: { entryId: string }) => e.entryId);
    expect(ids, 'project-wide memory carries to the next mission').toContain(`${instructionRecord}@v1`);
    expect(ids, 'a statement scoped to mission 1 does not').not.toContain(`${requirementProposal}@v1`);

    const otherTenant = `other-${id}`;
    const otherProject = `prj-pbflow-other-${id}`;
    expect((await call(bridge.base, 'POST', '/relay-api/julius/missions', { auth: `Bearer ${OPERATOR}`, body: contractFor(otherProject, otherTenant, `${id}-x`) })).status).toBe(201);
    const other = await signIn(bridge.base, otherTenant);
    const theirs = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${otherProject}&view=document`, other);
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.json)).not.toMatch(/Cite the source for every load-time figure|table of load times/u);
    // Not a member: the same answer as a project that does not exist.
    expect((await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, other)).status).toBe(404);
    expect((await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=prj-does-not-exist-${id}`, other)).status).toBe(404);
    expect((await call(bridge.base, 'POST', '/relay-api/wonderland/brain/proposals', { ...other, body: { projectId, surfaceId: 'user_facts', idempotencyKey: `x-${nonce()}`, text: 'intrude' } })).status).toBe(404);
    // A guessed record id from inside their own project answers "not found".
    const guessed = await call(bridge.base, 'POST', `/relay-api/wonderland/brain/mutations?projectId=${otherProject}`, {
      ...other, body: { operation: 'SET_STATUS', idempotencyKey: `x-${nonce()}`, recordId: instructionRecord, expectedVersion: 1, status: 'WITHDRAWN' },
    });
    expect(guessed.status).toBe(404);
    expect(guessed.json.error?.kind).toBe('record_not_found');
  });

  it('K-L: concurrent writers all land or are refused by name; a duplicated request applies once', async () => {
    const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => wonderland('POST', '/wonderland/brain/proposals', {
      projectId, surfaceId: 'scratchpads', idempotencyKey: `wl-par-${nonce()}-${i}`, text: `working note ${i}`,
    })));
    expect(parallel.map((r) => r.status)).toEqual(Array(10).fill(201));
    const key = `wl-dup-${nonce()}`;
    const duplicates = await Promise.all(Array.from({ length: 5 }, () => wonderland('POST', '/wonderland/brain/proposals', {
      projectId, surfaceId: 'preferences', idempotencyKey: key, text: 'Usage labels sit below their bars.',
    })));
    expect(duplicates.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(duplicates.map((r) => r.json.data.mutationId)).size).toBe(1);
    const stored = await pool.query(`SELECT count(*)::int AS n FROM relay_wonderland.project_brain_records WHERE project_id=$1 AND domain='PREFERENCE'`, [projectId]);
    expect(stored.rows[0].n).toBe(1);
    const sameKeyDifferent = await wonderland('POST', '/wonderland/brain/proposals', { projectId, surfaceId: 'preferences', idempotencyKey: key, text: 'Something else.' });
    expect(sameKeyDifferent.status).toBe(409);
    // Two people revising one version: one wins, one is told it lost.
    await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [`editor-${id}`]);
    await pool.query(`INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,'EDITOR')`, [projectId, `editor-${id}`]);
    const editor = await signIn(bridge.base, `editor-${id}`);
    const race = await Promise.all([player, editor].map((who, i) => call(bridge.base, 'POST', `/relay-api/wonderland/brain/mutations?projectId=${projectId}`, {
      ...who, body: { operation: 'SET_STATUS', idempotencyKey: `race-${nonce()}-${i}`, recordId: instructionRecord, expectedVersion: 1, status: 'RESOLVED' },
    })));
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('M: relationships hold -- a response to a finding, a review of a memory, links to real rows', async () => {
    const response = await wonderland('POST', `/wonderland/brain/mutations?projectId=${projectId}`, {
      operation: 'CREATE', idempotencyKey: `m-${nonce()}`, domain: 'FINDING_RESPONSE', runId, title: 'Load time for the third format is now measured.',
      subjectRef: `finding:${findingId}`, links: [{ relation: 'RESPONDS_TO', toRef: `finding:${findingId}` }, { relation: 'SUPPORTS', toRef: `criterion:${runId}/AC-1` }],
    });
    expect(response.status, JSON.stringify(response.json)).toBe(201);
    const memoryEntry = `brain:research-answer:pbflow-${nonce()}`;
    const julius = createJuliusPostgresRuntimeStore(pool);
    await julius.appendBrainEntry({ runId, projectId, taskId: null, workerId: 'architect-1', entryId: memoryEntry, kind: 'HANDOFF',
      safeText: 'The vendor changelog says format B is stable.', evidenceIds: [], occurredAt: new Date().toISOString() } as never);
    const review = await wonderland('POST', '/wonderland/brain/reviews', { projectId, surfaceId: 'auto_memories', entryRef: `entry:${memoryEntry}`, verdict: 'DECLINE', idempotencyKey: `r-${nonce()}` });
    expect(review.status, JSON.stringify(review.json)).toBe(201);
    const document = (await wonderland('GET', `/wonderland/brain?projectId=${projectId}&view=document`)).json.data;
    expect(document.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromRef: response.json.data.recordRef, relation: 'RESPONDS_TO', toRef: `finding:${findingId}` }),
      expect.objectContaining({ fromRef: response.json.data.recordRef, relation: 'SUPPORTS', toRef: `criterion:${runId}/AC-1` }),
      expect.objectContaining({ fromRef: review.json.data.recordRef, relation: 'REVIEWS', toRef: `entry:${memoryEntry}` }),
    ]));
    const view = (await wonderland('GET', `/wonderland/brain?projectId=${projectId}`)).json.data;
    const auto = view.surfaces.find((s: { id: string }) => s.id === 'auto_memories');
    expect(auto.entries.find((e: { ref: string }) => e.ref === `entry:${memoryEntry}`)).toMatchObject({ reviewable: true, review: 'DECLINED' });
    // A link to something that is not in this project is refused.
    const dangling = await wonderland('POST', `/wonderland/brain/mutations?projectId=${projectId}`, {
      operation: 'LINK', idempotencyKey: `m-${nonce()}`, fromRef: response.json.data.recordRef, relation: 'CONCERNS', toRef: 'finding:not-in-this-project',
    });
    expect(dangling.status).toBe(404);
  });

  it('N: governance is enforced -- viewers read, only owners adopt, companions only return results', async () => {
    await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [`viewer-${id}`]);
    await pool.query(`INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,'VIEWER')`, [projectId, `viewer-${id}`]);
    const viewer = await signIn(bridge.base, `viewer-${id}`);
    expect((await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, viewer)).status).toBe(200);
    const denied = await call(bridge.base, 'POST', '/relay-api/wonderland/brain/proposals', { ...viewer, body: { projectId, surfaceId: 'user_facts', idempotencyKey: `n-${nonce()}`, text: 'x' } });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toMatchObject({ kind: 'write_not_permitted', durable: false });
    const editor = await signIn(bridge.base, `editor-${id}`);
    const editorAdopt = await call(bridge.base, 'POST', `/relay-api/wonderland/brain/mutations?projectId=${projectId}`, { ...editor, body: { operation: 'SET_STATUS', idempotencyKey: `n-${nonce()}`, recordId: requirementProposal, expectedVersion: 1, status: 'ADOPTED' } });
    expect(editorAdopt.status).toBe(403);
    const ownerAdopt = await wonderland('POST', `/wonderland/brain/mutations?projectId=${projectId}`, { operation: 'SET_STATUS', idempotencyKey: `n-${nonce()}`, recordId: requirementProposal, expectedVersion: 1, status: 'ADOPTED' });
    expect(ownerAdopt.status).toBe(201);
    expect(ownerAdopt.json.data).toMatchObject({ status: 'ADOPTED', version: 2 });
    // A surface the panel shows as SYSTEM accepts no proposal.
    expect((await wonderland('POST', '/wonderland/brain/proposals', { projectId, surfaceId: 'decisions', idempotencyKey: `n-${nonce()}`, text: 'I decide.' })).status).toBe(403);
    // The companion channel: one mission's context in, a proposal out -- never a term.
    const companionContext = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}/companion-context?runId=${encodeURIComponent(runId)}`, operator(tenant, { 'x-relay-companion': 'llm-companion' }));
    expect(companionContext.status).toBe(200);
    expect(companionContext.json.data.authority).toBe('julius_decides');
    expect(JSON.stringify(companionContext.json.data)).not.toMatch(/working note|Usage labels/u);
    const result = await call(bridge.base, 'POST', `/relay-api/project-brain/projects/${projectId}/companion-results`, {
      ...operator(tenant, { 'x-relay-companion': 'llm-companion' }), body: { idempotencyKey: `c-${nonce()}`, runId, title: 'Format B loads fastest in my test.' },
    });
    expect(result.status, JSON.stringify(result.json)).toBe(201);
    expect(result.json.data).toMatchObject({ status: 'PROPOSED', author: { kind: 'COMPANION', id: 'llm-companion' }, deliverer: { kind: 'COMPANION_CHANNEL' } });
    const smuggle = await call(bridge.base, 'POST', `/relay-api/project-brain/projects/${projectId}/companion-results`, {
      ...operator(tenant, { 'x-relay-companion': 'llm-companion' }), body: { idempotencyKey: `c-${nonce()}`, runId, title: 'x', domain: 'REQUIREMENT' },
    });
    expect(smuggle.status).toBe(422);
    const juliusReads = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}/julius-context?runId=${encodeURIComponent(runId)}`, operator(tenant));
    const companionLine = juliusReads.json.data.entries.find((e: { text: string }) => e.text.includes('Format B loads fastest'));
    expect(companionLine.text).toMatch(/COMPANION_RESULT PROPOSED.*stated by COMPANION llm-companion.*\[a proposal, not a term of the contract\]/u);
  });

  it('O: errors are truthful -- nothing is reported durable that is not, and nothing empty is reported for a database that is not there', async () => {
    const secret = await wonderland('POST', '/wonderland/brain/proposals', { projectId, surfaceId: 'user_facts', idempotencyKey: `o-${nonce()}`, text: 'my token is ghp_FAKETESTNOTREALFAKETESTNOTREAL' });
    expect(secret.status).toBe(422);
    expect(secret.json.error).toMatchObject({ kind: 'credential_in_content', durable: false });
    const leaked = await pool.query(`SELECT count(*)::int AS n FROM relay_wonderland.project_brain_records WHERE body LIKE '%ghp_%' OR title LIKE '%ghp_%'`);
    expect(leaked.rows[0].n).toBe(0);
    expect((await wonderland('POST', `/wonderland/brain/mutations?projectId=${projectId}`, { operation: 'CREATE', idempotencyKey: `o-${nonce()}`, domain: 'USER_FACT', title: 'x', author: { kind: 'FOUNDER', id: 'me' } })).json.error?.kind).toBe('unknown_field');
    expect((await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`)).status).toBe(401);
    // A website session copied into an originless (desktop) request is not a desktop session.
    const copied = await call(bridge.base, 'GET', `/relay-api/wonderland/brain?projectId=${projectId}`, { auth: player.auth });
    expect(copied.status).toBe(401);
    expect(copied.json.error?.kind).toBe('sign_in_required');
    expect((await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, { auth: `Bearer ${OPERATOR}` })).status).toBe(400);
    expect((await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, { headers: { 'x-relay-tenant': tenant } })).status).toBe(401);

    await shut(bridge);
    bridge = await boot({ JULIUS_DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/unreachable' });
    const down = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator(tenant));
    expect(down.status).toBe(503);
    expect(down.json.error?.kind).toBe('project_brain_read_failed');
    const downWrite = await call(bridge.base, 'POST', `/relay-api/project-brain/projects/${projectId}/mutations`, { ...operator(tenant), body: { operation: 'CREATE', idempotencyKey: `o-${nonce()}`, domain: 'USER_FACT', title: 'x' } });
    expect(downWrite.status).toBe(503);
    expect(downWrite.json.error).toMatchObject({ kind: 'project_brain_unavailable', durable: false });

    await shut(bridge);
    bridge = await boot({ JULIUS_DATABASE_URL: undefined });
    const none = await call(bridge.base, 'GET', `/relay-api/project-brain/projects/${projectId}`, operator(tenant));
    expect(none.status).toBe(503);
    expect(none.json.error?.kind).toBe('project_brain_unavailable');
    expect(none.json.error?.message).toMatch(/JULIUS_DATABASE_URL, DATABASE_URL is not set/u);
  });
});
