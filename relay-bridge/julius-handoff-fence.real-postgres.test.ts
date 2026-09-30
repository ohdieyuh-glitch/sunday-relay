import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../src/relay/mission/julius';
import { JuliusEventPostgresRepository } from '../src/relay/persistence/julius-event-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusReadPostgresRepository } from '../src/relay/persistence/julius-read-postgres';
import { JuliusRecoveryPostgresRepository } from '../src/relay/persistence/julius-recovery-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';

/**
 * (a2) THE HANDOFF IS FENCED BY THE LEASE, AGAINST A REAL POSTGRESQL, IN BOTH LOCK ORDERS.
 *
 * `worker.dispatched` is written only while the attempt owns its task: the task row is read FOR
 * SHARE in the same serializable transaction as the insert. Recovery takes its candidates
 * `FOR UPDATE OF t SKIP LOCKED` and reads "handed" in the same statement. So:
 *   - a fence that holds the row first makes recovery SKIP the task (it reads it handed next sweep);
 *   - a recovery that holds the row first makes the fence WAIT, then see the cleared lease and
 *     answer LEASE_LOST, with nothing written and nothing dispatched.
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const nonce = () => randomBytes(4).toString('hex');

suite('(a2) the fenced handoff against a real PostgreSQL', () => {
  let pool: Pool;
  let runs: JuliusPostgresRepository;
  let events: JuliusEventPostgresRepository;
  let recovery: JuliusRecoveryPostgresRepository;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    runs = new JuliusPostgresRepository(pool);
    events = new JuliusEventPostgresRepository(pool);
    recovery = new JuliusRecoveryPostgresRepository(pool);
    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision: 'card:fence:1' };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
  });
  afterAll(async () => pool?.end());

  /** A fresh mission, its plan claimed by `owner`: ACTIVE under a lease. */
  async function claimed(): Promise<{ runId: string; projectId: string; taskId: string; owner: string; leaseGeneration: number }> {
    const id = nonce();
    const projectId = `prj-fence-${id}`;
    const result = await create(JSON.stringify({
      missionId: `mission:fence-${id}`, markerNamespace: `fence-${id}`, projectId, tenantId: `tenant-fence-${id}`,
      objective: 'Write a comparison of the three candidate save-file formats.', requirements: ['Compare them.'],
      constraints: ['Touch only docs/.'], acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists.', blocking: true }],
      testCommand: '', workspacePath: '/workspace/fence', limits: { spendUsd: 2, repairCycles: 1 },
    }));
    const runId = ((result?.body as { data?: { runId: string } }).data)!.runId;
    const owner = `fence-owner-${id}`;
    const now = new Date().toISOString();
    const [task] = await runs.claimRunnable({ owner, now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 1, projectId });
    expect(task, 'the plan is claimed').toBeDefined();
    // Admitted, as the coordinator's handoff always is: the attempt the handoff names (1) is this one.
    expect(await runs.admitTask({ taskId: task!.taskId, owner, leaseGeneration: task!.leaseGeneration, now })).toBe(1);
    return { runId, projectId, taskId: task!.taskId, owner, leaseGeneration: task!.leaseGeneration };
  }

  const handoff = (claim: { runId: string; projectId: string; taskId: string }, id = nonce()): JuliusOperationalEvent => ({
    eventId: `event:worker.dispatched:${id}`, runId: claim.runId, projectId: claim.projectId, type: 'worker.dispatched',
    taskId: claim.taskId, workerId: 'architect-openai', correlationId: claim.runId, causationId: null,
    occurredAt: new Date().toISOString(), facts: { workerId: 'architect-openai', attempt: 1, runId: claim.runId },
  });
  const dispatchedCount = async (runId: string) => Number((await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.worker.dispatched'`, [runId])).rows[0]!.n);

  it('DEFECT A CONFORMANCE: a SUCCEEDED task reads back the generation of the attempt that was accepted', async () => {
    const claim = await claimed();
    expect(await runs.finishTask({ taskId: claim.taskId, owner: claim.owner, leaseGeneration: claim.leaseGeneration, state: 'SUCCEEDED', now: new Date().toISOString() })).toBe(true);
    const tasks = await new JuliusReadPostgresRepository(pool).tasksForRun(claim.runId, claim.projectId);
    const task = tasks.find((row) => row.taskId === claim.taskId)!;
    expect(task.state).toBe('SUCCEEDED');
    expect(task.leaseGeneration, 'the store names the accepted attempt, so the heuristic is never reached').toBe(claim.leaseGeneration);
  });

  it('a handoff under a held lease is RECORDED once, and its replay is a DUPLICATE', async () => {
    const claim = await claimed();
    const event = handoff(claim);
    expect(await events.appendHandoff({ event, owner: claim.owner, leaseGeneration: claim.leaseGeneration })).toBe('RECORDED');
    expect(await events.appendHandoff({ event, owner: claim.owner, leaseGeneration: claim.leaseGeneration })).toBe('DUPLICATE');
    expect(await dispatchedCount(claim.runId)).toBe(1);
  });

  it('RECOVERY FIRST: a fence that meets a requeue still being written WAITS for it, then answers LEASE_LOST and writes nothing', async () => {
    const claim = await claimed();
    const operator = await pool.connect();
    let fence: Promise<string> | null = null;
    try {
      await operator.query('BEGIN');
      await operator.query('SELECT 1 FROM relay_wonderland.julius_tasks WHERE task_id=$1 FOR UPDATE', [claim.taskId]);
      await operator.query(
        `UPDATE relay_wonderland.julius_tasks SET state='RUNNABLE',lease_owner=NULL,lease_expires_at=NULL,version=version+1 WHERE task_id=$1`, [claim.taskId]);
      fence = events.appendHandoff({ event: handoff(claim), owner: claim.owner, leaseGeneration: claim.leaseGeneration });
      const early = await Promise.race([fence.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
      expect(early, 'the fence waits on the row the recovery is writing').toBe('waiting');
      await operator.query('COMMIT');
    } catch (error) {
      await operator.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      operator.release();
    }
    expect(await fence, 'the requeue committed first, so this attempt no longer owns the task').toBe('LEASE_LOST');
    expect(await dispatchedCount(claim.runId), 'and no handoff was written').toBe(0);
  });

  it('RE-CLAIMED: once another owner holds the task under a newer generation, the old attempt’s handoff is refused', async () => {
    const claim = await claimed();
    const now = new Date().toISOString();
    await pool.query(
      `UPDATE relay_wonderland.julius_tasks SET state='RUNNABLE',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=$2,version=version+1 WHERE task_id=$1`, [claim.taskId, now]);
    const [again] = await runs.claimRunnable({ owner: `fence-other-${nonce()}`, now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 1, projectId: claim.projectId });
    expect(again?.leaseGeneration, 'ACTIVE again, under a newer generation').toBe(claim.leaseGeneration + 1);
    expect(await events.appendHandoff({ event: handoff(claim), owner: claim.owner, leaseGeneration: claim.leaseGeneration })).toBe('LEASE_LOST');
    expect(await dispatchedCount(claim.runId)).toBe(0);
  });

  it('FENCE FIRST: a recovery that meets a handoff still being written skips the task, and then reads it handed', async () => {
    const claim = await claimed();
    await pool.query(`UPDATE relay_wonderland.julius_tasks SET lease_expires_at=now()-interval '1 minute' WHERE task_id=$1`, [claim.taskId]);
    const writer = await pool.connect();
    try {
      // The fence's own first step, held open: the task row read FOR SHARE, the event not yet written.
      await writer.query('BEGIN');
      await writer.query(
        `SELECT 1 FROM relay_wonderland.julius_tasks WHERE task_id=$1 AND state='ACTIVE' AND lease_owner=$2 AND lease_generation=$3 FOR SHARE`,
        [claim.taskId, claim.owner, claim.leaseGeneration]);
      const swept = await recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId);
      expect(swept.filter((action) => action.taskId === claim.taskId), 'the locked task is skipped, not requeued under a live handoff').toEqual([]);
      await writer.query('ROLLBACK');
    } finally {
      writer.release();
    }
    // The handoff lands for real, and the next sweep reads the task as handed: never requeued.
    expect(await events.appendHandoff({ event: handoff(claim), owner: claim.owner, leaseGeneration: claim.leaseGeneration })).toBe('RECORDED');
    const next = await recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId);
    expect(next.filter((action) => action.taskId === claim.taskId).map((action) => action.reasonCode)).toEqual(['HANDED_OUTCOME_UNKNOWN']);
  });
});
