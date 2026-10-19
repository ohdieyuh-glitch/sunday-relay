import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { handleJuliusLifecycleRoute, type JuliusLifecycleRouteRequest } from './julius-lifecycle-routes';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import { composeJuliusStateApi, handleJuliusStateRoute, type JuliusStateRoutePorts } from './julius-state-routes';

/**
 * THE OPERATOR LIFECYCLE CHANNEL, AGAINST A REAL POSTGRESQL.
 *
 * `julius-lifecycle-routes.test.ts` drives the live run loop over the memory
 * store. This says the other half against the database itself, through the
 * PRODUCTION compositions exactly as the server builds them: a mission created
 * by `composeJuliusMissionBootstrap`, controlled through
 * `handleJuliusLifecycleRoute` over `composeJuliusStateApi(pool)` — the same
 * ports object the read routes use — and then:
 *
 *   - the run row, the transition row, the actor/reason columns (migration 018)
 *     and the `julius.run.*` event are what the database holds;
 *   - the real claim query (`JuliusPostgresRepository.claimRunnable`, the run
 *     loop's first act every tick) offers nothing from a PAUSED or CANCELLED
 *     run and offers the work again after a resume;
 *   - a fresh pool and a freshly composed API — a restarted bridge — read the
 *     same state and the same announcement back.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every other real-postgres suite, and
 * `todo` without it, so an absent database is a skipped proof rather than a
 * passing one. Every mission carries a random identity.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

const nonce = () => randomBytes(4).toString('hex');

function contractFor(id: string) {
  return {
    missionId: `mission:lifecycle-${id}`, markerNamespace: `lifecycle-${id}`, projectId: `prj-lifecycle-${id}`, tenantId: `tenant-lifecycle-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/lifecycle',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };
const envelope = (result: { body: unknown } | null): Envelope => result?.body as Envelope;

suite('the operator lifecycle channel over a real PostgreSQL', () => {
  let pool: Pool;
  let ports: JuliusStateRoutePorts;
  let runs: JuliusPostgresRepository;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    // THE PRODUCTION COMPOSITIONS, exactly as the server builds them.
    const bootstrap = composeJuliusMissionBootstrap(pool);
    ports = { api: composeJuliusStateApi(pool), missingConfig: [] };
    runs = new JuliusPostgresRepository(pool);
    const missionPorts = { bootstrap, missingConfig: [], reviewerProvider: 'xai', cardRevision: 'card:lifecycle:1' };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, missionPorts);
  });
  afterAll(async () => pool?.end());

  async function created(): Promise<{ runId: string; contract: ReturnType<typeof contractFor> }> {
    const contract = contractFor(nonce());
    const result = await create(JSON.stringify(contract));
    const data = envelope(result).data as { runId: string; state: string };
    expect(data.state).toBe('READY');
    return { runId: data.runId, contract };
  }

  const control = (
    runId: string, contract: { projectId: string; tenantId: string }, body: unknown, over: Partial<JuliusLifecycleRouteRequest> = {},
  ) => handleJuliusLifecycleRoute({
    method: 'POST', path: `/julius/runs/${encodeURIComponent(runId)}/lifecycle`, operator: true,
    projectId: contract.projectId, tenantId: contract.tenantId, body: JSON.stringify(body), ...over,
  }, ports);

  /** The run loop's own claim, scoped to this mission's project. */
  const claim = (projectId: string) => {
    const now = new Date().toISOString();
    return runs.claimRunnable({
      owner: `lifecycle-proof-${nonce()}`, now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 4, projectId,
    });
  };

  it('refuses without the operator Bearer and for an unknown or foreign run, and writes nothing', async () => {
    const { runId, contract } = await created();
    expect((await control(runId, contract, { action: 'pause', reason: 'x' }, { operator: false }))?.status).toBe(401);
    const unknown = await control('run:does-not-exist', contract, { action: 'pause', reason: 'x' });
    expect(unknown?.status).toBe(404);
    expect(envelope(unknown).error?.kind).toBe('run_not_found');
    const foreign = await control(runId, { projectId: 'prj-someone-else', tenantId: contract.tenantId }, { action: 'cancel', reason: 'x' });
    expect(foreign?.status).toBe(404);
    const row = await pool.query<{ state: string; lifecycle_reason: string | null }>(
      'SELECT state, lifecycle_reason FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId]);
    expect(row.rows[0]).toEqual({ state: 'READY', lifecycle_reason: null });
  });

  it('pause is durable in all three places, the claim query honours it, and a restarted bridge reads it back', async () => {
    const { runId, contract } = await created();
    const paused = await control(runId, contract, { action: 'pause', reason: 'Founder review of the plan.' });
    expect(paused?.status).toBe(200);
    expect(envelope(paused).data).toMatchObject({ state: 'PAUSED', from: 'READY', duplicate: false, dispatched: false });

    // THE RUN ROW: state, and who asked and why (migration 018).
    const row = await pool.query<{ state: string; lifecycle_reason: string; lifecycle_actor: string }>(
      'SELECT state, lifecycle_reason, lifecycle_actor FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId]);
    expect(row.rows[0]).toEqual({ state: 'PAUSED', lifecycle_reason: 'Founder review of the plan.', lifecycle_actor: 'operator' });
    // THE TRANSITION ROW, with the operator's reason code.
    const transitions = await pool.query<{ from_state: string; to_state: string; reason_code: string }>(
      'SELECT from_state, to_state, reason_code FROM relay_wonderland.julius_transitions WHERE run_id=$1 AND to_state=$2', [runId, 'PAUSED']);
    expect(transitions.rows).toEqual([{ from_state: 'READY', to_state: 'PAUSED', reason_code: 'OPERATOR_PAUSED' }]);
    // THE LEDGER: one announcement.
    const events = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.run.paused'`, [runId]);
    expect(events.rows[0]!.n).toBe(1);

    // THE LOOP'S CLAIM offers nothing from a paused run.
    expect(await claim(contract.projectId), 'a paused run offers no work').toEqual([]);

    // A RESTARTED BRIDGE: a new pool, a freshly composed API, the same answer.
    const reloaded = new Pool({ connectionString: databaseUrl! });
    try {
      const fresh: JuliusStateRoutePorts = { api: composeJuliusStateApi(reloaded), missingConfig: [] };
      const read = (view: string) => handleJuliusStateRoute(
        { method: 'GET', path: `/julius/runs/${runId}/${view}`, operator: true, projectId: contract.projectId, tenantId: contract.tenantId }, fresh);
      expect((envelope(await read('run')).data as { state: string }).state).toBe('PAUSED');
      const timeline = envelope(await read('timeline')).data as { entries: Array<{ type: string; facts: Record<string, unknown> }> };
      const announced = timeline.entries.filter((entry) => entry.type === 'run.paused');
      expect(announced).toHaveLength(1);
      expect(announced[0]!.facts).toMatchObject({ actor: 'operator', reason: 'Founder review of the plan.', from: 'READY' });
    } finally {
      await reloaded.end();
    }
  });

  it('resume returns the work to the claim query, and a second pause is a duplicate', async () => {
    const { runId, contract } = await created();
    await control(runId, contract, { action: 'pause', reason: 'hold' });
    const again = await control(runId, contract, { action: 'pause', reason: 'hold again' });
    expect(envelope(again).data).toMatchObject({ state: 'PAUSED', duplicate: true });
    expect(await claim(contract.projectId)).toEqual([]);

    const resumed = await control(runId, contract, { action: 'resume', reason: 'Plan reviewed.' });
    expect(resumed?.status).toBe(200);
    expect(envelope(resumed).data).toMatchObject({ from: 'PAUSED', state: 'READY', dispatched: false });
    const offered = await claim(contract.projectId);
    expect(offered.map((task) => task.taskType), 'the plan is claimable again').toEqual(['plan']);
  });

  it('cancel ends the run CANCELLED with its reason, cancels its tasks, is idempotent, and refuses a resume', async () => {
    const { runId, contract } = await created();
    const cancelled = await control(runId, contract, { action: 'cancel', reason: 'Wrong repository targeted.' });
    expect(cancelled?.status).toBe(200);
    expect(envelope(cancelled).data).toMatchObject({ state: 'CANCELLED', duplicate: false });
    expect(envelope(cancelled).data!.cancelledTasks as number).toBeGreaterThanOrEqual(2);

    const tasks = await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_tasks WHERE run_id=$1', [runId]);
    expect(tasks.rows.every((task) => task.state === 'CANCELLED'), JSON.stringify(tasks.rows)).toBe(true);
    expect(await claim(contract.projectId), 'a cancelled run offers no work').toEqual([]);

    const second = await control(runId, contract, { action: 'cancel', reason: 'again' });
    expect(envelope(second).data).toMatchObject({ state: 'CANCELLED', duplicate: true });
    const resume = await control(runId, contract, { action: 'resume', reason: 'changed my mind' });
    expect(resume?.status).toBe(409);
    expect(envelope(resume).error?.kind).toBe('run_not_paused');

    const row = await pool.query<{ state: string; lifecycle_reason: string }>(
      'SELECT state, lifecycle_reason FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId]);
    expect(row.rows[0]).toEqual({ state: 'CANCELLED', lifecycle_reason: 'Wrong repository targeted.' });
    const events = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.run.cancelled'`, [runId]);
    expect(events.rows[0]!.n, 'one announcement for one cancellation').toBe(1);
  });
});
