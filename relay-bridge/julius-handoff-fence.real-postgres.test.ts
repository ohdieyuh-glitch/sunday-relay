import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../src/relay/mission/julius';
import { JuliusEventPostgresRepository, appendJuliusEventWithin } from '../src/relay/persistence/julius-event-postgres';
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
 * And (a2) step 2: the sweep closes every reservation the recovered task left open, in its own
 * transaction, judged by the reservation's own attempt (released if never handed, held as unknown
 * if handed). A settlement committed while the sweep writes its close makes the sweep retry, and
 * the retry writes no second close.
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

  /* ---- (a2) step 2: the sweep closes what the lost attempt left open, in its own transaction ---- */

  const HOLD = 300_000;
  const reserved = (claim: { runId: string; projectId: string; taskId: string }, reservationId: string, attempt: number): JuliusOperationalEvent => ({
    eventId: `event:budget.reserved:${nonce()}`, runId: claim.runId, projectId: claim.projectId, type: 'budget.reserved',
    taskId: claim.taskId, workerId: null, correlationId: claim.runId, causationId: null, occurredAt: new Date().toISOString(),
    facts: { reservationId, role: 'ARCHITECT', usdMicros: HOLD, attempt, runId: claim.runId },
  });
  const settledRows = async (runId: string, reservationId: string) => (await pool.query<{ event_id: string; payload: { facts: Record<string, unknown> } }>(
    `SELECT event_id,payload FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.budget.settled' AND payload->'facts'->>'reservationId'=$2 ORDER BY sequence`,
    [runId, reservationId])).rows;
  const lapse = (taskId: string) => pool.query(`UPDATE relay_wonderland.julius_tasks SET lease_expires_at=now()-interval '1 minute' WHERE task_id=$1`, [taskId]);

  it('(a2) STEP 2: NOT HANDED, the sweep releases the dead attempt’s reservation; HANDED, it closes it as unknown and charged', async () => {
    const quiet = await claimed();
    const quietId = `reservation:quiet-${nonce()}`;
    await events.append(reserved(quiet, quietId, 1));
    await lapse(quiet.taskId);
    const [released] = (await recovery.recoverExpired(new Date().toISOString(), 10, quiet.projectId)).filter((action) => action.taskId === quiet.taskId);
    expect(released).toMatchObject({ action: 'REQUEUE', settlements: [{ reservationId: quietId, released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' }] });
    const [quietRow] = await settledRows(quiet.runId, quietId);
    expect(quietRow!.event_id).toBe(`event:budget.settled:recovered:${quietId}`);
    expect(quietRow!.payload.facts).toMatchObject({ released: true, reason: 'RECOVERED_BEFORE_HANDOFF', costBasis: 'UNKNOWN', usdMicros: null, role: 'ARCHITECT', attempt: 1 });

    const paid = await claimed();
    const paidId = `reservation:paid-${nonce()}`;
    await events.append(reserved(paid, paidId, 1));
    expect(await events.appendHandoff({ event: handoff(paid), owner: paid.owner, leaseGeneration: paid.leaseGeneration })).toBe('RECORDED');
    await lapse(paid.taskId);
    const [held] = (await recovery.recoverExpired(new Date().toISOString(), 10, paid.projectId)).filter((action) => action.taskId === paid.taskId);
    expect(held).toMatchObject({ action: 'FAIL_TASK', reasonCode: 'HANDED_OUTCOME_UNKNOWN', settlements: [{ reservationId: paidId, released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' }] });
    expect((await settledRows(paid.runId, paidId)).map((row) => row.payload.facts)).toEqual([expect.objectContaining({ released: false, reason: 'RECOVERED_HANDED_OUTCOME_UNKNOWN', usdMicros: null })]);
  });

  it('(a2) STEP 2: each reservation is judged by its OWN attempt, and a second sweep writes nothing more', async () => {
    const claim = await claimed();
    const r1 = `reservation:first-${nonce()}`;
    await events.append(reserved(claim, r1, 1));
    // Handed back without a settlement: the orphan an older build left behind.
    expect(await runs.finishTask({ taskId: claim.taskId, owner: claim.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: new Date().toISOString(), nextAttemptAt: new Date(Date.now() - 1_000).toISOString() })).toBe(true);
    const owner = `fence-second-${nonce()}`;
    const [again] = await runs.claimRunnable({ owner, now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 1, projectId: claim.projectId });
    expect(again?.taskId, 'the same task, claimed again').toBe(claim.taskId);
    expect(await runs.admitTask({ taskId: again!.taskId, owner, leaseGeneration: again!.leaseGeneration, now: new Date().toISOString() })).toBe(2);
    const r2 = `reservation:second-${nonce()}`;
    await events.append(reserved(claim, r2, 2));
    const second = { ...claim, owner, leaseGeneration: again!.leaseGeneration };
    expect(await events.appendHandoff({ event: { ...handoff(second), facts: { workerId: 'architect-openai', attempt: 2, runId: claim.runId } }, owner, leaseGeneration: second.leaseGeneration })).toBe('RECORDED');
    await lapse(claim.taskId);

    const [action] = (await recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId)).filter((row) => row.taskId === claim.taskId);
    expect(action!.settlements).toEqual([
      { reservationId: r1, released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' },
      { reservationId: r2, released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' },
    ]);
    expect(await recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId), 'nothing is ACTIVE any more').toEqual([]);
    expect((await settledRows(claim.runId, r1)).length + (await settledRows(claim.runId, r2)).length, 'one closing row each').toBe(2);
  });

  it('(a2) STEP 2: another task’s handoff in the same run, at the same attempt number, does not make this one handed', async () => {
    const claim = await claimed();
    const reservationId = `reservation:alone-${nonce()}`;
    await events.append(reserved(claim, reservationId, 1));
    // A sibling task of the same run was handed its attempt 1. This task never was.
    await events.append({ ...handoff({ ...claim, taskId: `${claim.taskId}:sibling` }), facts: { workerId: 'architect-openai', attempt: 1, runId: claim.runId } });
    await lapse(claim.taskId);
    const [action] = (await recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId)).filter((row) => row.taskId === claim.taskId);
    expect(action).toMatchObject({ action: 'REQUEUE', settlements: [{ reservationId, released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' }] });
  });

  it('(a2) STEP 2 LOCK ORDER: a settlement committed while the sweep writes its own close is never doubled by the sweep', async () => {
    const claim = await claimed();
    const reservationId = `reservation:race-${nonce()}`;
    await events.append(reserved(claim, reservationId, 1));
    await lapse(claim.taskId);
    const coordinator = await pool.connect();
    let sweep: Promise<Awaited<ReturnType<typeof recovery.recoverExpired>>> | null = null;
    try {
      // The coordinator's own release, still being written: the run row locked, the stream moved.
      await coordinator.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await appendJuliusEventWithin(coordinator, {
        eventId: `event:budget.settled:${nonce()}`, runId: claim.runId, projectId: claim.projectId, type: 'budget.settled',
        taskId: claim.taskId, workerId: null, correlationId: claim.runId, causationId: null, occurredAt: new Date().toISOString(),
        facts: { reservationId, usdMicros: null, reason: 'CANCELLED', role: 'ARCHITECT', released: true, costBasis: 'UNKNOWN', estimatedUsdMicros: null },
      });
      sweep = recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId);
      const early = await Promise.race([sweep.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
      expect(early, 'the sweep waits on the run row the release is writing').toBe('waiting');
      await coordinator.query('COMMIT');
    } catch (error) {
      await coordinator.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      coordinator.release();
    }
    const [action] = (await sweep!).filter((row) => row.taskId === claim.taskId);
    expect(action, 'the task is still recovered').toMatchObject({ action: 'REQUEUE', reasonCode: 'LEASE_EXPIRED' });
    expect(action!.settlements, 'the retried sweep read the release and closed nothing').toBeUndefined();
    expect((await settledRows(claim.runId, reservationId)).map((row) => row.payload.facts.reason), 'exactly one closing row, the coordinator’s').toEqual(['CANCELLED']);
  });

  /* ---- (a2) step 3: a late release is written only when it says something ---- */

  const releaseOf = (claim: { runId: string; projectId: string; taskId: string }, reservationId: string, facts: Record<string, string | number | boolean | null>): JuliusOperationalEvent => ({
    eventId: `event:budget.settled:${nonce()}`, runId: claim.runId, projectId: claim.projectId, type: 'budget.settled',
    taskId: claim.taskId, workerId: null, correlationId: claim.runId, causationId: null, occurredAt: new Date().toISOString(),
    facts: { reservationId, role: 'ARCHITECT', usdMicros: null, reason: 'CANCELLED', released: true, costBasis: 'UNKNOWN', estimatedUsdMicros: null, ...facts },
  });
  const contradictionsFor = async (runId: string) => (await pool.query<{ payload: { facts: Record<string, unknown> } }>(
    `SELECT payload FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.budget.settlement.contradicted' ORDER BY sequence`, [runId])).rows;
  /** A reservation of a claimed attempt that the sweep has closed, handed or not. */
  const closedBySweep = async (handed: boolean) => {
    const claim = await claimed();
    const reservationId = `reservation:late-${nonce()}`;
    await events.append(reserved(claim, reservationId, 1));
    if (handed) expect(await events.appendHandoff({ event: handoff(claim), owner: claim.owner, leaseGeneration: claim.leaseGeneration })).toBe('RECORDED');
    await lapse(claim.taskId);
    const [action] = (await recovery.recoverExpired(new Date().toISOString(), 10, claim.projectId)).filter((row) => row.taskId === claim.taskId);
    expect(action!.settlements?.[0]?.released, 'the sweep closed it').toBe(!handed);
    return { claim, reservationId };
  };

  it('(a2) STEP 3: a free release after a RELEASED close says the same thing and is not written; its replay is not written either', async () => {
    const { claim, reservationId } = await closedBySweep(false);
    const late = releaseOf(claim, reservationId, {});
    expect(await events.appendSettlement(late)).toBe('SAME_MEANING');
    expect(await events.appendSettlement(late)).toBe('SAME_MEANING');
    expect((await settledRows(claim.runId, reservationId)).map((row) => row.payload.facts.reason)).toEqual(['RECOVERED_BEFORE_HANDOFF']);
    expect(await contradictionsFor(claim.runId)).toEqual([]);
  });

  it('(a2) STEP 3: a free release after an UNKNOWN close is written and the contradiction named; a costed one is written plainly', async () => {
    const free = await closedBySweep(true);
    const late = releaseOf(free.claim, free.reservationId, {});
    expect(await events.appendSettlement(late)).toBe('CONTRADICTED');
    expect(await events.appendSettlement(late), 'its replay is the same row').toBe('DUPLICATE');
    expect((await settledRows(free.claim.runId, free.reservationId)).map((row) => row.payload.facts.reason)).toEqual(['RECOVERED_HANDED_OUTCOME_UNKNOWN', 'CANCELLED']);
    expect((await contradictionsFor(free.claim.runId)).map((row) => row.payload.facts)).toEqual([expect.objectContaining({
      reservationId: free.reservationId, closedAs: 'RECOVERED_HANDED_OUTCOME_UNKNOWN', releasedAs: 'CANCELLED',
    })]);

    const costed = await closedBySweep(true);
    expect(await events.appendSettlement(releaseOf(costed.claim, costed.reservationId, { released: false, usdMicros: 450_000, costBasis: 'PROVIDER_REPORTED', reason: 'TIMEOUT' }))).toBe('RECORDED');
    expect(await contradictionsFor(costed.claim.runId), 'money reported is never a contradiction').toEqual([]);
  });

  it('(a2) STEP 3 LOCK ORDER: a free release that meets the sweep’s close still being written WAITS for it, then says the same and writes nothing', async () => {
    const claim = await claimed();
    const reservationId = `reservation:race-late-${nonce()}`;
    await events.append(reserved(claim, reservationId, 1));
    const sweep = await pool.connect();
    let late: Promise<string> | null = null;
    try {
      // The sweep's close, still being written: the run row locked, the stream moved.
      await sweep.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await appendJuliusEventWithin(sweep, {
        eventId: `event:budget.settled:recovered:${reservationId}`, runId: claim.runId, projectId: claim.projectId, type: 'budget.settled',
        taskId: claim.taskId, workerId: null, correlationId: claim.taskId, causationId: null, occurredAt: new Date().toISOString(),
        facts: { reservationId, usdMicros: null, reason: 'RECOVERED_BEFORE_HANDOFF', role: 'ARCHITECT', released: true, costBasis: 'UNKNOWN', estimatedUsdMicros: null, attempt: 1, runId: claim.runId },
      });
      late = events.appendSettlement(releaseOf(claim, reservationId, {}));
      const early = await Promise.race([late.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
      expect(early, 'the release waits on the run row the close is writing').toBe('waiting');
      await sweep.query('COMMIT');
    } catch (error) {
      await sweep.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      sweep.release();
    }
    expect(await late, 'decided against the committed close').toBe('SAME_MEANING');
    expect((await settledRows(claim.runId, reservationId)).map((row) => row.payload.facts.reason)).toEqual(['RECOVERED_BEFORE_HANDOFF']);
  });
});
