import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JuliusPostgresRepository } from './julius-postgres';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { JuliusTrajectoryPostgresRepository } from './julius-trajectory-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { summariseJuliusEvals, type JuliusTask, type JuliusTrajectoryEvent } from '../mission/julius';

/**
 * THE SQL SUMMARY AND THE PURE ONE, ON THE SAME ROWS.
 *
 * `JuliusTrajectoryPostgresRepository.summarize` and `summariseJuliusEvals` are
 * documented as one summary computed twice, and nothing held them to it: the
 * SQL summed cost over every kind while the TypeScript summed DISPATCH rows
 * only, so a retry's and a subagent's spend existed in one and not the other.
 * This writes one row of every DISPATCH class the runtime produces into the
 * real table (a provider completion and failure, an unattributed failure, a
 * tool step as the executor's settlement writes it, each pre-provider refusal)
 * plus RETRY, SUBAGENT and COMPLETION rows, and two edge rows for the SQL's
 * three-valued logic (no outcome; a non-string toolId). Then it asks both.
 * Every field must agree.
 *
 * The second session's eval review added three things:
 * - requeued attempts, priced and unpriced, and a requeued refusal (F1);
 * - one refusal outcome per guard of the SQL refusal clause that can change the
 *   summary, so that a clause which lost its guard disagrees by name (F3);
 * - REPAIR and RECOVERY rows, whose counts were zero on both sides.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY database (never
 * DATABASE_URL), and is `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

suite('the SQL eval summary agrees with the pure one on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-parity-${nonce}`;
  const mission = `mission-parity-${nonce}`;
  const run = `run:parity-${nonce}`;
  const runtimeVersion = `julius-runtime.parity-${nonce}`;
  const taskId = `build:parity-${nonce}`;
  // A context a row names must EXIST: `context_id` is a foreign key to the
  // compiled context snapshots, so every context the rows cite is written
  // first, scoped to this run so a shared database cannot collide.
  const ctx = (n: number): string => `ctx-${String(n)}-${nonce}`;
  let pool: Pool;

  const at = (minute: number) => `2099-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`;
  const row = (key: string, over: Partial<JuliusTrajectoryEvent> & { kind: JuliusTrajectoryEvent['kind'] }, minute: number): JuliusTrajectoryEvent => ({
    trajectoryEventId: `parity:${nonce}:${key}`, runId: run, projectId: project, taskId: null, workerId: null,
    providerId: null, contextId: null, runtimeVersion, policyVersion: 'card-r1', cardRevision: 'card-r1',
    missionContractRevision: 1, projectBrainRevision: 0, durationMs: null, usdMicros: null, inputTokens: null,
    outputTokens: null, outcome: null, safeFacts: {}, idempotencyKey: `parity:${key}`, occurredAt: at(minute), ...over,
  });
  const EVENTS: readonly JuliusTrajectoryEvent[] = [
    row('topology', { kind: 'TASK_TOPOLOGY', outcome: 'PLANNED' }, 1),
    // Provider attempts: two named, one unattributed (a failure whose provider went unrecorded).
    row('w8', { kind: 'DISPATCH', outcome: 'COMPLETED', providerId: 'anthropic', contextId: ctx(1), durationMs: 60_000, usdMicros: 0, inputTokens: 100, outputTokens: 50 }, 2),
    row('w7a', { kind: 'DISPATCH', outcome: 'TIMEOUT', providerId: 'openai', contextId: ctx(2), durationMs: 120_000 }, 3),
    row('w7b', { kind: 'DISPATCH', outcome: 'POLICY_DENIED', contextId: ctx(3) }, 4),
    // A tool step, shaped as `julius-tool-settlement-postgres` writes one.
    row('w9', {
      kind: 'DISPATCH', outcome: 'SUCCEEDED', policyVersion: 'tool-settlement.v1', durationMs: 41, usdMicros: 0, inputTokens: 0, outputTokens: 0,
      safeFacts: { toolId: 'shell.exec', invocationId: 'inv-1', evidenceCount: 1, artifactCount: 0 },
    }, 5),
    // Every pre-provider refusal outcome.
    row('w1', { kind: 'DISPATCH', outcome: 'GOVERNANCE_HELD', safeFacts: { reasonCode: 'run_paused' } }, 6),
    row('w2', { kind: 'DISPATCH', outcome: 'APPROVAL_DENIED' }, 7),
    row('w3', { kind: 'DISPATCH', outcome: 'POLICY_DENIED' }, 8),
    row('w4', { kind: 'DISPATCH', outcome: 'CONTRACT_NOT_LOCKED', safeFacts: { reasonCode: 'contract_unlocked' } }, 9),
    row('w5', { kind: 'DISPATCH', outcome: 'REVIEW_CONTRACT_MISMATCH' }, 10),
    row('w6', { kind: 'DISPATCH', outcome: 'CONTRACT_STALE' }, 11),
    // The SQL's three-valued edges: a NULL outcome, and a toolId that is not a string.
    row('bare', { kind: 'DISPATCH' }, 12),
    row('numeric-tool', { kind: 'DISPATCH', durationMs: 30_000, safeFacts: { toolId: 7 } }, 13),
    // The kinds that carry an amount without being a DISPATCH.
    row('retry', { kind: 'RETRY', outcome: 'TIMEOUT', providerId: 'openai', contextId: ctx(2), usdMicros: 250_000 }, 14),
    row('subagent', { kind: 'SUBAGENT', outcome: 'AUTHORIZED', usdMicros: 7_000 }, 15),
    row('fallback', { kind: 'FALLBACK', outcome: 'REROUTED' }, 16),
    row('completion', { kind: 'COMPLETION', outcome: 'VERIFIED' }, 17),
    // A requeued attempt that reported no cost (F1): the shape the pipeline writes for a
    // retryable TIMEOUT under automaticRetry. It is an attempt, its cost is unknown, and its
    // minutes are in the average. A requeued refusal is still a refusal.
    row('retry-unpriced', { kind: 'RETRY', outcome: 'TIMEOUT', providerId: 'openai', contextId: ctx(2), durationMs: 90_000 }, 18),
    row('retry-refusal', { kind: 'RETRY', outcome: 'GOVERNANCE_HELD' }, 19),
    // A refusal outcome that breaks exactly ONE guard of a pre-provider refusal is an attempt
    // with no cost, so a SQL clause that lost that guard would call it a refusal and disagree
    // (F3). The context guard is w7b's. A priced refusal outcome cannot change this summary
    // (its cost is known and it carries no time), so the usd guard is pinned as text instead.
    row('held-with-provider', { kind: 'DISPATCH', outcome: 'GOVERNANCE_HELD', providerId: 'anthropic' }, 20),
    row('denied-with-duration', { kind: 'DISPATCH', outcome: 'APPROVAL_DENIED', durationMs: 15_000 }, 21),
    row('stale-with-input', { kind: 'DISPATCH', outcome: 'CONTRACT_STALE', inputTokens: 10 }, 22),
    row('unlocked-with-output', { kind: 'DISPATCH', outcome: 'CONTRACT_NOT_LOCKED', outputTokens: 5 }, 23),
    // Counted on both sides, and zero on both until these rows.
    row('repair', { kind: 'REPAIR', outcome: 'REPAIR_REQUESTED' }, 24),
    row('recovery', { kind: 'RECOVERY', outcome: 'REQUEUED' }, 25),
  ];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `parity:${nonce}`],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING',$4,'card-r1',1,0)",
      [run, mission, project, runtimeVersion],
    );
    const task: JuliusTask = {
      taskId, missionId: mission, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
      taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'RUNNABLE',
    };
    await new JuliusPostgresRepository(pool).addTask({ commandId: `parity:${taskId}`, runId: run, projectId: project, task });
    for (const n of [1, 2, 3]) {
      await pool.query(
        "INSERT INTO relay_wonderland.julius_context_snapshots(context_id,run_id,task_id,worker_id,compiler_version,mission_contract_revision,card_revision,project_brain_revision,source_entry_ids,content_hash,character_count,truncated) VALUES($1,$2,$3,'worker-parity','parity.v1',1,'card-r1',0,'[]'::jsonb,$4,0,false)",
        [ctx(n), run, taskId, createHash('sha256').update(ctx(n), 'utf8').digest('hex')],
      );
    }
  });

  afterAll(async () => {
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.julius_trajectory_events WHERE project_id=$1',
      'DELETE FROM relay_wonderland.julius_context_snapshots c USING relay_wonderland.julius_runs r WHERE c.run_id=r.run_id AND r.project_id=$1',
      'DELETE FROM relay_wonderland.julius_tasks t USING relay_wonderland.julius_runs r WHERE t.run_id=r.run_id AND r.project_id=$1',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const sql of statements) await pool.query(sql, [project]).catch(() => undefined);
    await pool?.end().catch(() => undefined);
  });

  it('every field of the SQL summary equals the pure summary of the same rows', async () => {
    const trajectory = new JuliusTrajectoryPostgresRepository(pool);
    for (const event of EVENTS) expect(await trajectory.append(event), event.idempotencyKey).toBe(true);
    const sql = await trajectory.summarize({ projectId: project, runtimeVersion, from: at(0), to: at(59) });
    const pure = summariseJuliusEvals(EVENTS, runtimeVersion);
    expect(sql).toEqual(pure);
    // AND WHAT THEY AGREE ON IS THE CORRECTED READING, not a shared mistake.
    // The attempts are:
    // - w8, w7a, w7b;
    // - the bare and numeric-toolId rows;
    // - both requeued TIMEOUTs;
    // - the four refusal outcomes that each break one guard.
    // Of those, nine named no cost. Read DISPATCH-only, it would be 8 and
    // 56,250 ms.
    expect(pure.unknownCostComponents).toBe(9);
    expect(pure.knownUsdMicros, 'the retry and the subagent spend are in the sum').toBe(257_000);
    expect(pure.averageDurationMs, 'provider attempts only, the requeued one included: no tool step\'s 41 ms')
      .toBe((60_000 + 120_000 + 30_000 + 90_000 + 15_000) / 5);
    expect(pure).toMatchObject({ retries: 3, fallbacks: 1, repairs: 1, recoveries: 1, verifiedCompletions: 1 });
  });
});
