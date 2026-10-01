import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTaskContractBindingDigest, scriptedAdapter } from '../src/relay/mission/julius';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JULIUS_SERIALIZABLE_ATTEMPTS } from '../src/relay/persistence/julius-serializable';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import { architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, reviewerWorker } from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * A CONTENDED CONTRACT LOCK, REPRODUCED ON PURPOSE — the two-loop race of
 * real-infra run 36855148392 attempt 1 (PR #305, 2026-10-01), made
 * deterministic.
 *
 * What CI saw, with two run loops and six missions on one database: loop-a's
 * `lockTaskContract` hit SQLSTATE 40001 and answered `lock_contended` with
 * nothing locked; the accepting plan decision was recorded anyway and released
 * the build onto a contract still in DRAFT; loop-b claimed that build and the
 * dispatch gate failed it closed with `contract_not_locked`; the mission ended
 * FAILED. A rerun passed, which is how a race hides.
 *
 * THE INSTRUMENT. A pool that, while armed, makes the lock's own candidate read
 * (`SELECT … FOR UPDATE` on the contract row) lose a real race: a second
 * connection takes the row with a no-op UPDATE first, the lock's read queues
 * behind it, and the second connection COMMITS only once PostgreSQL reports
 * the lock's backend waiting on that row lock (`pg_stat_activity`). A
 * SERIALIZABLE transaction whose snapshot predates a committed update of the
 * row it waited for is aborted with 40001 — every time, not when the scheduler
 * happens to interleave two loops that way. Nothing is mocked: the conflict,
 * the abort and the rollback are PostgreSQL's.
 *
 *   0. CONTROL: the instrument really produces 40001 against a bare
 *      SERIALIZABLE transaction — so a green below cannot be a vacuous one.
 *   1. STORE, one conflict: the lock is retried and LANDS (before: answered
 *      `lock_contended`, nothing locked).
 *   2. STORE, a storm past the bound: every attempt conflicts; the answer is
 *      `lock_contended` with nothing locked — honest exhaustion, not a throw.
 *   3. PIPELINE, the CI failure itself: a mission whose plan-acceptance lock
 *      meets that storm still COMPLETES — the decision is held, nothing is
 *      released onto the DRAFT, the resume sweep locks, the build runs once
 *      (before: the build FAILED `contract_not_locked`, and the run with it).
 *   4. PIPELINE CONTROL: a STANDING refusal (the terms changed under the lock)
 *      is not held — the decision stands and the gate refuses the build, as
 *      designed. Holding every refusal survived every other suite; this kills it.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo`
 * without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:contract-lock-contention:1';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const nonce = () => randomBytes(4).toString('hex');

const PLAN = [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'Plan written.' }];
const BUILD = [
  { type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'Suite green.' },
  { type: 'DIFF' as const, status: 'PASSED' as const, safeSummary: 'The change set.' },
];
const REVIEW = [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'No blocking findings.' }];

function contractFor(id: string) {
  return {
    missionId: `mission:lock-${id}`, markerNamespace: `lock-${id}`, projectId: `prj-lock-${id}`, tenantId: `tenant-lock-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/lock',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

/** The lock's candidate read, exactly as `JuliusContractPostgresRepository` sends it. */
const CANDIDATE = /FROM relay_wonderland\.julius_task_contracts\s+WHERE contract_id=\$1 AND contract_revision=\$2 AND project_id=\$3 FOR UPDATE/u;

/** How many candidate reads to make lose, and how many really did. */
type Storm = { armed: number; forced: number };

async function waitUntilBlocked(pool: Pool, pid: number): Promise<void> {
  for (let poll = 0; poll < 1_000; poll += 1) {
    const row = await pool.query<{ wait_event_type: string | null }>(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid]);
    if (row.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`instrument: backend ${String(pid)} never waited on the contract row`);
}

/** The candidate read, made to lose a real race to a committed update of the same row. */
async function loseTheRace(pool: Pool, victim: PoolClient, text: string, values: readonly unknown[]): Promise<unknown> {
  const adversary = await pool.connect();
  let pending: Promise<unknown>;
  try {
    await adversary.query('BEGIN');
    // A no-op UPDATE is still a new row version, which is all a 40001 needs.
    await adversary.query(
      'UPDATE relay_wonderland.julius_task_contracts SET locked_at = locked_at WHERE contract_id = $1 AND contract_revision = $2',
      [values[0], values[1]],
    );
    pending = victim.query(text, values as unknown[]);
    pending.catch(() => undefined);
    await waitUntilBlocked(pool, (victim as unknown as { processID: number }).processID);
    await adversary.query('COMMIT');
  } catch (error) {
    await adversary.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    adversary.release();
  }
  return pending;
}

/** `pool`, except that the lock's candidate read goes through `intercept` whenever it answers non-null. */
function intercepting(
  pool: Pool,
  intercept: (client: PoolClient, text: string, values: readonly unknown[]) => Promise<unknown> | null,
): Pool {
  const wrap = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, property) {
      if (property === 'query') {
        return (text: unknown, values?: unknown[]) => {
          const intercepted = typeof text === 'string' && CANDIDATE.test(text) ? intercept(target, text, values ?? []) : null;
          return intercepted ?? (target.query as (t: unknown, v?: unknown[]) => unknown)(text, values);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') return async () => wrap(await target.connect());
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** `pool`, except that while `storm.armed` is positive the lock's candidate read loses its race. */
function contending(pool: Pool, storm: Storm): Pool {
  return intercepting(pool, (client, text, values) => {
    if (storm.armed <= 0) return null;
    storm.armed -= 1;
    storm.forced += 1;
    return loseTheRace(pool, client, text, values);
  });
}

/**
 * `pool`, except that the first time the lock reads its candidate, the terms it is about to lock were changed and
 * committed a moment earlier — so the digest the caller computed from the terms it ACCEPTED no longer describes the
 * stored row, and the store answers with a standing refusal (`binding_digest_mismatch`), not a contention.
 */
function alteringTermsOnce(pool: Pool, altered: { count: number }): Pool {
  return intercepting(pool, (client, text, values) => {
    if (altered.count > 0) return null;
    altered.count += 1;
    return (async () => {
      await pool.query(
        `UPDATE relay_wonderland.julius_task_contracts
            SET safe_terms = jsonb_set(safe_terms, '{objective}', to_jsonb((safe_terms->>'objective') || ' (changed after it was accepted)'))
          WHERE contract_id = $1 AND contract_revision = $2`,
        [values[0], values[1]],
      );
      return client.query(text, values as unknown[]);
    })();
  });
}

suite('a contended task-contract lock, against a real PostgreSQL', () => {
  let pool: Pool;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 10 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision: CARD };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
  });
  afterAll(async () => pool?.end());

  /** A fresh mission and the DRAFT contract its bootstrap seeded. */
  async function mission() {
    const contract = contractFor(nonce());
    const created = await create(JSON.stringify(contract));
    const runId = ((created?.body as { data: { runId: string } }).data).runId;
    const row = (await pool.query<{ task_id: string }>(
      'SELECT task_id FROM relay_wonderland.julius_task_contracts WHERE run_id = $1', [runId])).rows[0]!;
    const draft = await new JuliusContractPostgresRepository(pool).loadTaskContract({ projectId: contract.projectId, taskId: row.task_id });
    expect(draft?.state, 'the bootstrap seeded a DRAFT contract').toBe('DRAFT');
    return { runId, projectId: contract.projectId, draft: draft! };
  }

  const lockInput = (projectId: string, draft: Awaited<ReturnType<typeof mission>>['draft']) => ({
    projectId, contractId: draft.contractId, contractRevision: draft.contractRevision,
    bindingDigest: juliusTaskContractBindingDigest(draft), lockedAt: new Date().toISOString(), evaluatorId: 'reviewer-lock-test',
  });

  const stateOf = async (contractId: string) => (await pool.query<{ state: string }>(
    'SELECT state FROM relay_wonderland.julius_task_contracts WHERE contract_id = $1 ORDER BY contract_revision', [contractId])).rows.map((row) => row.state);

  it('CONTROL: the instrument makes a bare SERIALIZABLE candidate read fail with 40001', async () => {
    const { projectId, draft } = await mission();
    const storm: Storm = { armed: 1, forced: 0 };
    const client = await contending(pool, storm).connect();
    let code: unknown = null;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query(
        `SELECT * FROM relay_wonderland.julius_task_contracts
          WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3 FOR UPDATE`,
        [draft.contractId, draft.contractRevision, projectId],
      );
    } catch (error) {
      code = (error as { code?: unknown }).code;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect(storm.forced, 'the race was forced').toBe(1);
    expect(code, 'PostgreSQL aborted the read with a serialization failure').toBe('40001');
  });

  it('STORE, one lost race: the serialization failure is retried and the lock lands', async () => {
    const { projectId, draft } = await mission();
    const storm: Storm = { armed: 1, forced: 0 };
    const result = await new JuliusContractPostgresRepository(contending(pool, storm)).lockTaskContract(lockInput(projectId, draft));
    expect(storm.forced, 'the first attempt really lost a race').toBe(1);
    expect(result, JSON.stringify(result)).toMatchObject({ locked: true, supersededRevision: null });
    expect(await stateOf(draft.contractId)).toEqual(['LOCKED']);
  });

  it('STORE, a storm past the bound: every attempt loses, and the answer is lock_contended with nothing locked', async () => {
    const { projectId, draft } = await mission();
    const storm: Storm = { armed: JULIUS_SERIALIZABLE_ATTEMPTS, forced: 0 };
    const result = await new JuliusContractPostgresRepository(contending(pool, storm)).lockTaskContract(lockInput(projectId, draft));
    expect(storm.forced, 'every bounded attempt lost a race').toBe(JULIUS_SERIALIZABLE_ATTEMPTS);
    expect(result).toEqual({ locked: false, reasonCode: 'lock_contended', lockedRevision: null });
    expect(await stateOf(draft.contractId), 'an exhausted lock wrote nothing').toEqual(['DRAFT']);
    // And the storm is weather, not a verdict: the next lock lands.
    const after = await new JuliusContractPostgresRepository(pool).lockTaskContract(lockInput(projectId, draft));
    expect(after.locked).toBe(true);
  });

  /** One mission, driven by one run loop through the production composition over `storePool`, until it is terminal. */
  async function runMission(storePool: (pool: Pool) => Pool) {
    const { runId, projectId, draft } = await mission();
    const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN, usdMicros: null }]);
    const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }]);
    const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: REVIEW, usdMicros: null }]);
    const runtime = assembleLiveJuliusRuntime({
      store: createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(storePool(pool))).store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1, owner: 'lock-loop',
    });
    const state = async () => (await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId])).rows[0]!.state;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !TERMINAL.has(await state())) {
      const report = await runtime.loop.tick({ projectId });
      if (report.claimed === 0) await runtime.loop.advanceRun(runId, projectId);
    }
    const events = (await pool.query<{ sequence: number; event_type: string; task_id: string | null; facts: Record<string, unknown> | null }>(
      `SELECT sequence::int AS sequence, event_type, payload->>'taskId' AS task_id, payload->'facts' AS facts
         FROM relay_wonderland.events WHERE stream_id = $1 ORDER BY sequence`, [runId])).rows;
    const refusals = events.filter((row) => row.event_type === 'julius.contract.refused').map((row) => String(row.facts?.reasonCode));
    const dispatched = [...architect.dispatches, ...coder.dispatches, ...reviewer.dispatches].map((item) => item.taskId);
    return { runId, draft, events, refusals, state: await state(), dispatched, coder };
  }

  it('PIPELINE: a plan acceptance whose lock meets that storm holds its decision, and the mission still COMPLETES with the build run once', async () => {
    const storm: Storm = { armed: JULIUS_SERIALIZABLE_ATTEMPTS, forced: 0 };
    const { draft, events, refusals, state, dispatched, coder } = await runMission((base) => contending(base, storm));
    const explained = JSON.stringify({ forced: storm.forced, refusals, failures: events.filter((row) => /failed/u.test(row.event_type)).map((row) => row.facts) });

    expect(storm.forced, 'the plan acceptance\'s lock really lost a race').toBeGreaterThan(0);
    expect(refusals, 'the contended lock is on the record, as the refusal it was').toContain('lock_contended');
    expect(refusals, explained).not.toContain('contract_not_locked');
    expect(state, explained).toBe('COMPLETED');
    expect(storm.forced, 'and it met the whole storm, every bounded attempt').toBe(JULIUS_SERIALIZABLE_ATTEMPTS);

    // THE LOCK PRECEDES THE RELEASE: the build became runnable only after its terms were locked.
    const lockedAt = events.find((row) => row.event_type === 'julius.contract.locked')?.sequence;
    const releasedAt = events.find((row) => row.event_type === 'julius.task.runnable' && row.task_id === draft.taskId)?.sequence;
    expect(lockedAt, 'the contract was locked').toBeDefined();
    expect(releasedAt, 'the build was released').toBeDefined();
    expect(lockedAt!).toBeLessThan(releasedAt!);
    expect(await stateOf(draft.contractId)).toEqual(['LOCKED']);

    // EVERYTHING ONCE: no task dispatched twice, the build exactly once, and the evaluator's answer recorded once.
    expect(new Set(dispatched).size, 'no task was dispatched twice').toBe(dispatched.length);
    expect(coder.dispatches.map((item) => item.taskId), 'the build ran exactly once').toEqual([draft.taskId]);
    const dispositions = events.filter((row) => row.event_type === 'julius.contract.disposition'
      && row.facts?.contractId === draft.contractId && Number(row.facts?.contractRevision) === draft.contractRevision);
    expect(dispositions.map((row) => row.facts?.disposition), 'one NO_CHALLENGE for the revision, however often it was decided').toEqual(['NO_CHALLENGE']);
    const claimed = events.find((row) => row.event_type === 'julius.task.claimed' && row.task_id === draft.taskId);
    expect(claimed?.facts?.contractId, 'the build was dispatched under the locked contract').toBe(draft.contractId);
  }, 120_000);

  /**
   * THE HOLD IS FOR CONTENTION ONLY. A standing refusal is a fact about the terms, and the design is unchanged for it:
   * the decision stands, the build is released, and the dispatch gate refuses it loudly with its own reason. Holding
   * here instead would re-decide on the next sweep, re-read the CHANGED terms as if they were the accepted ones, and
   * lock them — agreeing to a document nobody reviewed.
   */
  it('PIPELINE CONTROL: a standing refusal is not held — the decision stands and the gate refuses the build loudly', async () => {
    const altered = { count: 0 };
    const { draft, events, refusals, state, coder } = await runMission((base) => alteringTermsOnce(base, altered));
    const explained = JSON.stringify({ refusals, failures: events.filter((row) => /failed/u.test(row.event_type)).map((row) => row.facts) });

    expect(altered.count, 'the terms really changed under the lock').toBe(1);
    expect(refusals, explained).toContain('binding_digest_mismatch');
    expect(refusals, 'a standing refusal is not a contention').not.toContain('lock_contended');
    const decided = events.filter((row) => row.event_type === 'julius.verification.decided').map((row) => row.facts?.action);
    expect(decided, 'the accepting decision was recorded despite the refusal').toContain('ACCEPT');
    expect(refusals, 'and the gate refused the build on the unlocked terms').toContain('contract_not_locked');
    expect(coder.dispatches, 'no coder ran against terms nobody locked').toEqual([]);
    expect(state, explained).toBe('FAILED');
    expect(await stateOf(draft.contractId), 'the changed terms were never locked').toEqual(['DRAFT']);
  }, 120_000);
});
