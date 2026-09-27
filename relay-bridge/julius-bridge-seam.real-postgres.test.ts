import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import { composeJuliusStateApi, handleJuliusStateRoute, type JuliusStateRoutePorts } from './julius-state-routes';

/**
 * THE WONDERLAND SEAM, AGAINST A REAL POSTGRESQL.
 *
 * `julius-mission-routes.test.ts` proves creation over a recording store and
 * `julius-state-routes.test.ts` proves observation over the in-memory API. Both
 * leave one sentence unproven: that the PRODUCTION compositions — the two
 * repositories the create route binds and the runtime store the read routes
 * bind — agree about a run in a real database. That is the sentence Wonderland
 * depends on: what a client creates is what a client then watches, and both are
 * what the database holds. This suite says it against PostgreSQL itself.
 *
 * Runs wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and DATABASE_URL
 * are set — the same gate as the other real-postgres suites — and is `todo`
 * everywhere else, so an absent database is a skipped proof rather than a
 * passing one. Every mission it creates carries a random identity, so it can be
 * re-run against a database that already holds its earlier runs.
 */

const enabled = (process.env.JULIUS_REAL_POSTGRES === '1' || process.env.JULIUS_REAL_INFRA === '1')
  && Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.todo;

const nonce = () => randomBytes(4).toString('hex');

function contractFor(id: string, testCommand = '') {
  return {
    missionId: `mission:seam-${id}`, markerNamespace: `seam-${id}`, projectId: `prj-seam-${id}`, tenantId: `tenant-seam-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand,
    workspacePath: '/workspace/seam',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: unknown; error?: { kind: string; message: string } };
const dataOf = <T,>(result: { body: unknown } | null): T => {
  const body = result?.body as Envelope;
  expect(body.error, `expected data, got ${JSON.stringify(body.error)}`).toBeUndefined();
  return body.data as T;
};

suite('the Wonderland seam over a real PostgreSQL', () => {
  let pool: Pool;
  let statePorts: JuliusStateRoutePorts;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;
  let createRerun: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await new TransactionalWonderlandDatabase(pool).migrate();
    // THE PRODUCTION COMPOSITIONS, exactly as the server builds them.
    const bootstrap = composeJuliusMissionBootstrap(pool);
    statePorts = { api: composeJuliusStateApi(pool), missingConfig: [] };
    const ports = { bootstrap, missingConfig: [], reviewerProvider: 'xai', cardRevision: 'card:seam:1' };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
    createRerun = (body) => handleJuliusMissionRoute(
      { method: 'POST', path: '/julius/missions', operator: true, body, rerun: 'explicit' }, ports);
  });
  afterAll(async () => pool?.end());

  const read = (path: string, contract: { projectId: string; tenantId: string }) =>
    handleJuliusStateRoute({ method: 'GET', path, operator: true, projectId: contract.projectId, tenantId: contract.tenantId }, statePorts);

  it('what a client creates is what a client then watches, and both are what the database holds', async () => {
    const contract = contractFor(nonce());
    const created = dataOf<{ runId: string; state: string; dispatched: boolean }>(await create(JSON.stringify(contract)));
    expect(created.state).toBe('READY');
    expect(created.dispatched).toBe(false);

    // THE DATABASE, asked directly: one run, in the state the route reported.
    const rows = await pool.query<{ state: string; mission_id: string; project_id: string }>(
      'SELECT state, mission_id, project_id FROM relay_wonderland.julius_runs WHERE run_id = $1', [created.runId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({ state: 'READY', mission_id: contract.missionId, project_id: contract.projectId });
    const contracts = await pool.query('SELECT 1 FROM relay_wonderland.julius_task_contracts WHERE run_id = $1', [created.runId]);
    expect(contracts.rowCount, 'the build’s task contract is durable before the run is READY').toBeGreaterThanOrEqual(1);

    // THE READ ROUTES, through the runtime store: the same run, the same state.
    const run = dataOf<{ runId: string; state: string; missionId: string }>(await read(`/julius/runs/${created.runId}/run`, contract));
    expect(run.runId).toBe(created.runId);
    expect(run.state).toBe('READY');
    expect(run.missionId).toBe(contract.missionId);

    const tasks = dataOf<ReadonlyArray<{ taskType: string; state: string; role: string }>>(await read(`/julius/runs/${created.runId}/tasks`, contract));
    expect(tasks.map((task) => [task.taskType, task.state])).toEqual([['plan', 'RUNNABLE'], ['build', 'BLOCKED']]);

    // THE VIEW WONDERLAND EXISTS FOR: three peers, none of them dispatched, and
    // a cost that is not pretended to be zero.
    const slots = dataOf<ReadonlyArray<{ role: string; state: string; dispatches: number; servedModel: string | null; costComplete: boolean }>>(
      await read(`/julius/runs/${created.runId}/slots`, contract));
    expect(slots.map((slot) => slot.role)).toEqual(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
    for (const slot of slots) {
      expect(slot.state, 'nobody has been driven yet').toBe('NEVER_DISPATCHED');
      expect(slot.dispatches).toBe(0);
      expect(slot.servedModel, 'no model has answered, so none may be shown').toBeNull();
    }

    const page = dataOf<{ entries: ReadonlyArray<{ sequence: number }>; hasMore: boolean }>(await read(`/julius/runs/${created.runId}/timeline`, contract));
    expect(page.entries.length, 'the bootstrap transitions are on the durable timeline').toBeGreaterThanOrEqual(1);
    // ORDERED BY SEQUENCE, the client rule the contract states — never by time.
    for (let i = 1; i < page.entries.length; i += 1) expect(page.entries[i]!.sequence).toBeGreaterThan(page.entries[i - 1]!.sequence);
  });

  it('re-posting the same contract resumes the same run instead of creating a second one', async () => {
    const contract = contractFor(nonce());
    const first = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    const second = dataOf<{ runId: string; state: string }>(await create(JSON.stringify(contract)));
    expect(second.runId).toBe(first.runId);
    expect(second.state, 'the state the store holds, not an asserted READY').toBe('READY');
    const count = await pool.query('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('refuses a second, DIFFERENT run of a mission that is still in flight — and an explicit rerun is allowed', async () => {
    // The guard where it actually has to hold: inside the run-creating
    // transaction, on the real table, with the real terminal-state list.
    const contract = contractFor(nonce());
    const first = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    const edited = JSON.stringify({ ...contract, objective: 'Compare only the two formats we ship.' });

    const refused = await create(edited);
    expect(refused?.status).toBe(409);
    expect((refused?.body as { error: { kind: string; message: string } }).error.kind).toBe('mission_run_already_active');
    expect((refused?.body as { error: { message: string } }).error.message).toContain(first.runId);
    // NOTHING WAS WRITTEN: one run for this mission, still.
    const afterRefusal = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(afterRefusal.rows[0]!.n).toBe(1);

    const rerun = dataOf<{ runId: string; rerun: boolean }>(await createRerun(edited));
    expect(rerun.runId).not.toBe(first.runId);
    expect(rerun.rerun).toBe(true);
    const afterRerun = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(afterRerun.rows[0]!.n, 'two runs, because two were asked for').toBe(2);
  });

  it('a mission whose run reached a TERMINAL state is not locked, and the guard is per mission', async () => {
    const contract = contractFor(nonce());
    const first = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    // Another mission is unaffected while this one is live.
    const other = contractFor(nonce());
    expect(dataOf<{ runId: string }>(await create(JSON.stringify(other))).runId).not.toBe(first.runId);

    // The first run ends. A new, different run of that mission is then ordinary
    // work: no rerun intent required, because nothing is in flight.
    await pool.query("UPDATE relay_wonderland.julius_runs SET state = 'COMPLETED' WHERE run_id = $1", [first.runId]);
    const next = dataOf<{ runId: string }>(await create(JSON.stringify({ ...contract, objective: 'Now compare the fourth format too.' })));
    expect(next.runId).not.toBe(first.runId);
  });

  it('two identical requests racing produce exactly one run — the loser is told to retry, never given a second', async () => {
    // A duplicate is the SAME bytes, and its idempotency key is those bytes, so
    // there is one run to be had. What the LOSER of the race is told is the
    // honest part: a whole bootstrap is many writes (the mission's base rows,
    // criteria, brain, two tasks, the task contract, two transitions), all of
    // them SERIALIZABLE, so a concurrent twin loses one of them and is answered
    // `bootstrap_persistence_failure`, retryable — not a second run, and not a
    // pretence that it created one. Its retry then finds the run and succeeds.
    const contract = contractFor(nonce());
    const body = JSON.stringify(contract);
    const [a, b] = await Promise.all([create(body), create(body)]);

    const answers = [a, b].map((result) => result?.body as Envelope);
    const created = answers.filter((answer) => answer.data !== undefined);
    expect(created.length, 'at least one caller was answered with the run').toBeGreaterThanOrEqual(1);
    for (const answer of answers) {
      if (answer.data !== undefined) continue;
      // The only failure a duplicate may be told, and it must say try again.
      expect(answer.error?.kind).toBe('bootstrap_persistence_failure');
    }
    const runIds = new Set(created.map((answer) => (answer.data as { runId: string }).runId));
    expect(runIds.size, 'one run id, whichever callers saw it').toBe(1);

    // THE DATABASE IS THE ARBITER: one run, one plan, one build. No second
    // execution exists to be dispatched, so nothing can be billed twice.
    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(rows.rows[0]!.n).toBe(1);
    const runId = [...runIds][0]!;
    const tasks = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_tasks WHERE run_id = $1', [runId]);
    expect(tasks.rows[0]!.n).toBe(2);

    // AND THE RETRY PATH WORKS: posting the same bytes again is answered with
    // the one run, so a client that lost the race recovers by doing nothing
    // cleverer than trying again.
    expect(dataOf<{ runId: string }>(await create(body)).runId).toBe(runId);
  });

  it('a created run is invisible under another project, and a no-check mission is held to its DIFF', async () => {
    const contract = contractFor(nonce());
    const created = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    const foreign = await read(`/julius/runs/${created.runId}/run`, { projectId: 'prj-someone-else', tenantId: contract.tenantId });
    expect(foreign?.status, 'scope is enforced by the store, not by the route').toBe(404);

    const build = await pool.query<{ required_evidence_types: unknown }>(
      "SELECT required_evidence_types FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'build'", [created.runId]);
    expect(build.rows[0]?.required_evidence_types).toEqual(['DIFF']);

    const checked = contractFor(nonce(), 'npm test');
    const createdChecked = dataOf<{ runId: string }>(await create(JSON.stringify(checked)));
    const checkedBuild = await pool.query<{ required_evidence_types: unknown }>(
      "SELECT required_evidence_types FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'build'", [createdChecked.runId]);
    expect(checkedBuild.rows[0]?.required_evidence_types).toEqual(['TEST']);
  });
});
