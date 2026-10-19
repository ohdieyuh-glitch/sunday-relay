import { describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../mission/julius';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusPostgresRepository } from './julius-postgres';
import { JuliusRepairPostgresRepository } from './julius-repair-postgres';
import {
  JULIUS_PLAN_PIN, JULIUS_SERIALIZABLE_ATTEMPTS, JULIUS_WRITE_LOCK, JULIUS_WRITE_UNLOCK, isJuliusSerializationFailure, juliusSerializable,
} from './julius-serializable';
import { JuliusSubagentPostgresRepository } from './julius-subagent-postgres';
import { JuliusToolPostgresRepository } from './julius-tool-postgres';

/**
 * THE SERIALIZATION RETRY, WITHOUT A DATABASE.
 *
 * The real-PostgreSQL multi-mission suite is where 40001 actually happens (two
 * run loops; six missions stranded for two minutes before this). These cases
 * pin the retry's exact contract on every run, in milliseconds: which errors
 * are retried, how often, that every attempt rolls back and releases its
 * connection, and that a conflict the CALLER must see is never absorbed.
 */

/** H3 (row 13 (i) r5): the write lock wraps every attempt. These cases are about the TRANSACTION inside it, so its two
 *  statements are answered and not recorded; the H3 case records and pins them. */
const writeLock = (sql: string): boolean => sql === JULIUS_WRITE_LOCK || sql === JULIUS_WRITE_UNLOCK;
const serialization = () => Object.assign(new Error('could not serialize access due to read/write dependencies among transactions'), { code: '40001' });

/** A pool whose transactions fail with the scripted errors, in order, then succeed. */
function flakyPool(failures: readonly unknown[]) {
  const log: string[] = [];
  let attempt = 0;
  let releases = 0;
  return {
    log,
    releases: () => releases,
    attempts: () => attempt,
    pool: {
      async connect() {
        attempt += 1;
        const failure = failures[attempt - 1];
        return {
          async query(sql: string) {
            if (writeLock(sql)) return { rows: [], rowCount: 1 };
            log.push(`${attempt}:${sql.split(/\s+/u).slice(0, 3).join(' ')}`);
            if (sql.startsWith('INSERT') && failure !== undefined) throw failure;
            if (sql.includes('stream_sequences')) return { rows: [{ sequence: '1' }], rowCount: 1 };
            if (sql.includes('FROM relay_wonderland.julius_runs WHERE run_id')) {
              return { rows: [{ ok: 1, project_id: 'prj-1', mission_id: 'm' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
          },
          release() { releases += 1; },
        };
      },
    } as never,
  };
}

const noPause = async () => undefined;

describe('a serialization failure is retried, because PostgreSQL guarantees it rolled back', () => {
  it('names only 40001 and 40P01, and never a conflict marked retryable:false', () => {
    expect(isJuliusSerializationFailure(serialization())).toBe(true);
    expect(isJuliusSerializationFailure({ code: '40P01' })).toBe(true);
    expect(isJuliusSerializationFailure({ code: '23505' }), 'a unique violation is a fact, not a race').toBe(false);
    expect(isJuliusSerializationFailure({ code: '40001', retryable: false }), 'the caller\'s stale version').toBe(false);
    expect(isJuliusSerializationFailure(new Error('julius_run_not_found'))).toBe(false);
    expect(isJuliusSerializationFailure(null)).toBe(false);
  });

  it('retries a 40001, rolling back and releasing each failed attempt, and returns the success', async () => {
    const fake = flakyPool([serialization(), serialization()]);
    const value = await juliusSerializable(fake.pool, async (client) => {
      await client.query('INSERT INTO t VALUES(1)');
      return 'written';
    }, { pause: noPause });
    expect(value).toBe('written');
    expect(fake.attempts()).toBe(3);
    expect(fake.releases(), 'every attempt gave its connection back').toBe(3);
    expect(fake.log.filter((line) => line.endsWith('ROLLBACK')), 'each failed attempt rolled back').toEqual(['1:ROLLBACK', '2:ROLLBACK']);
    expect(fake.log.at(-1)).toBe('3:COMMIT');
  });

  it('is BOUNDED: a storm of conflicts still surfaces after the last attempt', async () => {
    const fake = flakyPool(Array.from({ length: 10 }, serialization));
    await expect(juliusSerializable(fake.pool, async (client) => {
      await client.query('INSERT INTO t VALUES(1)');
    }, { pause: noPause })).rejects.toMatchObject({ code: '40001' });
    expect(fake.attempts()).toBe(JULIUS_SERIALIZABLE_ATTEMPTS);
    expect(fake.releases()).toBe(JULIUS_SERIALIZABLE_ATTEMPTS);
  });

  it('never retries anything else: a unique violation or a caller-owned conflict throws on the first attempt', async () => {
    for (const failure of [{ code: '23505' }, Object.assign(new Error('optimistic_concurrency_conflict'), { code: '40001', retryable: false })]) {
      const fake = flakyPool([failure, failure, failure]);
      await expect(juliusSerializable(fake.pool, async (client) => {
        await client.query('INSERT INTO t VALUES(1)');
      }, { pause: noPause })).rejects.toBe(failure);
      expect(fake.attempts(), JSON.stringify(failure)).toBe(1);
    }
  });

  /**
   * THE CONFLICT MOST OFTEN ARRIVES AT COMMIT. Under SERIALIZABLE, PostgreSQL
   * reports a read/write dependency cycle when the transaction tries to commit,
   * not while its statements run — so a helper that retried statement errors
   * but let COMMIT fail outside its try would never have retried the common
   * case, and would have leaked an un-rolled-back connection doing it.
   */
  it('a 40001 raised BY COMMIT is rolled back, released and retried, like one raised by a statement', async () => {
    const log: string[] = [];
    let attempt = 0;
    let releases = 0;
    const pool = {
      async connect() {
        attempt += 1;
        const mine = attempt;
        return {
          async query(sql: string) {
            if (writeLock(sql)) return { rows: [], rowCount: 1 };
            log.push(`${mine}:${sql.split(/\s+/u)[0]}`);
            if (sql === 'COMMIT' && mine === 1) throw serialization();
            return { rows: [], rowCount: 1 };
          },
          release() { releases += 1; },
        };
      },
    } as never;
    const value = await juliusSerializable(pool, async (client) => {
      await client.query('INSERT INTO t VALUES(1)');
      return 'committed on the second attempt';
    }, { pause: noPause });
    expect(value).toBe('committed on the second attempt');
    expect(attempt, 'the commit-time conflict was retried').toBe(2);
    expect(releases, 'both connections were given back').toBe(2);
    expect(log, 'attempt 1 rolled back AFTER its failed COMMIT; attempt 2 committed; each attempt pinned its plan (SET LOCAL)')
      .toEqual(['1:BEGIN', '1:SET', '1:INSERT', '1:COMMIT', '1:ROLLBACK', '2:BEGIN', '2:SET', '2:INSERT', '2:COMMIT']);
  });

  /**
   * THE PLAN PIN (row 13 (i), the third mechanism). A sequential scan under
   * SERIALIZABLE locks the whole relation, and on a fresh database the planner
   * reads the small `julius_runs` table no other way. Every attempt therefore
   * asks for index scans and per-execution plans BEFORE its body runs, so no
   * statement of the body, and no foreign-key check it triggers, is planned
   * without the pin. Whether the pin does what it asks is a real-PostgreSQL
   * question (`julius-plan-pin.real-postgres.test.ts`); these cases pin where and
   * how it is asked.
   */
  it('every attempt pins its plan right after BEGIN and before its body, a retried attempt included', async () => {
    const statements: string[][] = [];
    let attempt = 0;
    const pool = {
      async connect() {
        attempt += 1;
        const mine: string[] = [];
        statements.push(mine);
        const failing = attempt === 1;
        return {
          async query(sql: string) {
            if (writeLock(sql)) return { rows: [], rowCount: 1 };
            mine.push(sql);
            if (failing && sql.startsWith('INSERT')) throw serialization();
            return { rows: [], rowCount: 1 };
          },
          release() {},
        };
      },
    } as never;
    await juliusSerializable(pool, async (client) => { await client.query('INSERT INTO t VALUES(1)'); }, { pause: noPause });
    expect(statements, 'attempt 1 failed in its body and rolled back; attempt 2 was pinned again before it ran').toEqual([
      ['BEGIN ISOLATION LEVEL SERIALIZABLE', JULIUS_PLAN_PIN, 'INSERT INTO t VALUES(1)', 'ROLLBACK'],
      ['BEGIN ISOLATION LEVEL SERIALIZABLE', JULIUS_PLAN_PIN, 'INSERT INTO t VALUES(1)', 'COMMIT'],
    ]);
  });

  it('the pin is LOCAL to its transaction, takes no snapshot, and asks for exactly two things: index scans and a plan per execution', () => {
    const statements = JULIUS_PLAN_PIN.split(';').map((statement) => statement.trim());
    expect(statements, 'two SET LOCALs: they end with the transaction; a SET (unlike a SELECT) does not fix the snapshot')
      .toEqual(['SET LOCAL enable_seqscan = off', 'SET LOCAL plan_cache_mode = force_custom_plan']);
    expect(JULIUS_PLAN_PIN, 'nothing for the session or the pool').not.toMatch(/SET\s+SESSION|set_config|SELECT/iu);
  });

  it('a pin the server refuses fails the attempt: the body never runs unpinned, and the attempt rolls back and releases', async () => {
    const log: string[] = [];
    let releases = 0;
    let bodyRan = false;
    const pool = {
      async connect() {
        return {
          async query(sql: string) {
            if (writeLock(sql)) return { rows: [], rowCount: 1 };
            log.push(sql.split(/\s+/u)[0]!);
            if (sql === JULIUS_PLAN_PIN) throw Object.assign(new Error('unrecognized configuration parameter "plan_cache_mode"'), { code: '42704' });
            return { rows: [], rowCount: 1 };
          },
          release() { releases += 1; },
        };
      },
    } as never;
    await expect(juliusSerializable(pool, async () => { bodyRan = true; }, { pause: noPause })).rejects.toMatchObject({ code: '42704' });
    expect(bodyRan, 'no unpinned body').toBe(false);
    expect(log, 'not a serialization failure, so not retried').toEqual(['BEGIN', 'SET', 'ROLLBACK']);
    expect(releases).toBe(1);
  });

  /**
   * THE BOUND IS A MEASURED NUMBER, NOT WHATEVER THE CONSTANT HAPPENS TO SAY.
   * The storm case above counts attempts against JULIUS_SERIALIZABLE_ATTEMPTS
   * itself, so shrinking the constant to 1 (no retry at all) or growing it
   * without measurement would pass it. Six is what two run loops over six
   * missions needed (see the constant's comment); this pins it.
   */
  it('the default bound is exactly SIX attempts, and an explicit bound below one still makes one attempt', async () => {
    expect(JULIUS_SERIALIZABLE_ATTEMPTS).toBe(6);
    const storm = flakyPool(Array.from({ length: 10 }, serialization));
    await expect(juliusSerializable(storm.pool, async (client) => {
      await client.query('INSERT INTO t VALUES(1)');
    }, { pause: noPause })).rejects.toMatchObject({ code: '40001' });
    expect(storm.attempts(), 'five retries after the first attempt, then the conflict surfaces').toBe(6);
    const once = flakyPool([serialization()]);
    await expect(juliusSerializable(once.pool, async (client) => {
      await client.query('INSERT INTO t VALUES(1)');
    }, { pause: noPause, attempts: 0 })).rejects.toMatchObject({ code: '40001' });
    expect(once.attempts(), 'attempts:0 is not "never run"').toBe(1);
  });

  /**
   * THE BACKOFF DOUBLES AND IS JITTERED, so two writers that conflicted once do
   * not collide again in step. Pinned through the injected pause with
   * Math.random held: removing the doubling, the jitter or the pause itself
   * each changes this exact schedule.
   */
  it('pauses between attempts on the doubling, jittered schedule (up to 10, 20, 40, 80, 160 ms)', async () => {
    const random = Math.random;
    try {
      for (const [r, expected] of [[0.999, [9, 19, 39, 79, 159]], [0.5, [5, 10, 20, 40, 80]], [0, [0, 0, 0, 0, 0]]] as const) {
        Math.random = () => r;
        const pauses: number[] = [];
        const storm = flakyPool(Array.from({ length: 10 }, serialization));
        await expect(juliusSerializable(storm.pool, async (client) => {
          await client.query('INSERT INTO t VALUES(1)');
        }, { pause: async (ms) => { pauses.push(ms); } })).rejects.toMatchObject({ code: '40001' });
        expect(pauses, `Math.random=${r}: one pause before each retry, never after the last attempt`).toEqual(expected);
      }
    } finally {
      Math.random = random;
    }
  });

  it('THE EVENT APPEND retries a 40001 instead of throwing it into the run loop', async () => {
    const event: JuliusOperationalEvent = {
      eventId: 'event:1', runId: 'run-1', projectId: 'prj-1', type: 'verification.decided',
      taskId: 'task-1', workerId: null, correlationId: 'corr-1', causationId: null,
      occurredAt: '2099-01-01T00:00:00.000Z', facts: { action: 'ACCEPT' },
    };
    const fake = flakyPool([serialization()]);
    const outcome = await new JuliusEventPostgresRepository(fake.pool).append(event);
    expect(outcome.recorded).toBe(true);
    expect(fake.attempts(), 'one conflict, one retry').toBe(2);
    expect(fake.log.at(-1)).toBe('2:COMMIT');
  });

  it('THE RUN REPOSITORY retries its transactions too (addTask through a 40001)', async () => {
    const fake = flakyPool([serialization()]);
    const added = await new JuliusPostgresRepository(fake.pool).addTask({
      commandId: 'cmd-1', runId: 'run-1', projectId: 'prj-1',
      task: {
        taskId: 'task-1', missionId: 'm', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
        taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
      },
    });
    expect(added).toBe(true);
    expect(fake.attempts()).toBe(2);
  });
});

/**
 * THE REMAINING SERIALIZABLE WRITERS, ON THE SAME POLICY.
 *
 * Each of these opened its own SERIALIZABLE transaction. Repair scheduling and
 * sub-agent admission threw a 40001 straight into the pipeline. Tool requests
 * carried a private loop that knew 40001 and not 40P01. A repair is the one
 * write that attempt 2's catch-and-repair credit depends on, so it is the case
 * that matters most.
 */
function scriptedPool(failures: readonly unknown[], respond: (sql: string) => { rows: unknown[]; rowCount: number } | undefined) {
  let attempt = 0;
  let releases = 0;
  const log: string[] = [];
  return {
    log,
    attempts: () => attempt,
    releases: () => releases,
    pool: {
      async connect() {
        attempt += 1;
        const failure = failures[attempt - 1];
        let failed = false;
        return {
          async query(sql: string) {
            if (writeLock(sql)) return { rows: [], rowCount: 1 };
            log.push(`${attempt}:${sql.split(/\s+/u).slice(0, 3).join(' ')}`);
            // The scripted conflict lands on the attempt's first write, as PostgreSQL's would.
            if (!failed && failure !== undefined && sql.startsWith('INSERT')) { failed = true; throw failure; }
            return respond(sql) ?? { rows: [], rowCount: 1 };
          },
          release() { releases += 1; },
        };
      },
      async query() { return { rows: [], rowCount: 0 }; },
    } as never,
  };
}

const TOOL_REQUEST = {
  invocationId: 'inv', idempotencyKey: 'key', requestDigest: 'a'.repeat(64), tenantId: 'tenant', projectId: 'project', runId: 'run',
  taskId: 'task', workerId: 'worker', leaseGeneration: 3, policyRevision: 'card', toolId: 'fs.write' as const, toolVersion: '1',
  mutationClass: 'WORKSPACE' as const, requestedAt: '2026-08-30T00:00:00Z',
};
const toolTask = (leaseGeneration: string) => ({
  lease_generation: leaseGeneration, state: 'ACTIVE', worker_id: 'worker', lease_owner: 'scheduler', lease_valid: true, card_revision: 'card', tenant_member: true,
});

describe('the remaining SERIALIZABLE writers retry on the shared policy', () => {
  it('REPAIR SCHEDULING survives a 40001: the round is created once, on the second attempt', async () => {
    const fake = scriptedPool([serialization()], (sql) => {
      if (sql.startsWith('SELECT state')) return { rows: [{ state: 'REPAIRING' }], rowCount: 1 };
      if (sql.includes('RETURNING next_sequence')) return { rows: [{ sequence: '7' }], rowCount: 1 };
      return undefined;
    });
    const plan = {
      repairId: 'repair-1', round: 1, findingIds: ['finding-1'], evidenceIds: ['evidence-1'], budgetReservationId: 'reservation-1',
      task: { taskId: 'repair-task-1', role: 'CODING_AGENT', taskType: 'repair:build', ordinal: 3, requiredEvidenceTypes: ['TEST'] },
    };
    const outcome = await new JuliusRepairPostgresRepository(fake.pool).schedule({
      commandId: 'cmd-repair-1', runId: 'run-1', projectId: 'prj-1', originalTaskId: 'task-1', plan: plan as never, occurredAt: '2099-01-01T00:00:00.000Z',
    });
    expect(outcome).toEqual({ created: true, repairId: 'repair-1' });
    expect(fake.attempts(), 'one conflict, one retry').toBe(2);
    expect(fake.releases()).toBe(2);
    expect(fake.log.filter((line) => line.endsWith('ROLLBACK'))).toEqual(['1:ROLLBACK']);
    expect(fake.log.at(-1)).toBe('2:COMMIT');
  });

  it('SUB-AGENT ADMISSION survives a 40P01 under its advisory lock, and admits once', async () => {
    const fake = scriptedPool([{ code: '40P01' }], (sql) => {
      if (sql.includes('parent_depth')) return { rows: [{ parent_depth: '0', active_children: '0', total_children: '0' }], rowCount: 1 };
      if (sql.startsWith('SELECT 1 FROM relay_wonderland.julius_subagents')) return { rows: [], rowCount: 0 };
      return undefined;
    });
    const outcome = await new JuliusSubagentPostgresRepository(fake.pool).recordSubagentAndTaskWithinLimits({
      record: {
        requestId: 'sub-1', runId: 'run-1', projectId: 'prj-1', parentTaskId: 'task-1', childTaskId: 'child-1', depth: 1,
        capability: 'research', permissions: ['read'], budgetReservationId: 'reservation-1', state: 'REQUESTED',
      } as never,
      task: {
        taskId: 'child-1', missionId: 'm', parentTaskId: 'task-1', dependencyIds: [], requiredEvidenceTypes: [],
        taskType: 'research', role: 'PROMPT_ARCHITECT', ordinal: 4, state: 'RUNNABLE',
      } as never,
      maxActive: 2, maxTotal: 5, maxDepth: 2,
    });
    expect(outcome).toEqual({ recorded: true, duplicate: false, denialReason: null });
    expect(fake.attempts()).toBe(2);
    expect(fake.log.filter((line) => line.includes('pg_advisory_xact_lock')).length, 'the lock is taken again on the retry').toBe(2);
    expect(fake.log.at(-1)).toBe('2:COMMIT');
  });

  it('TOOL REQUESTS now retry a 40P01 too, which the private loop did not', async () => {
    const row = {
      invocation_id: 'inv', idempotency_key: 'key', request_digest: 'a'.repeat(64), tenant_id: 'tenant', project_id: 'project', run_id: 'run',
      task_id: 'task', worker_id: 'worker', lease_generation: '3', policy_revision: 'card', tool_id: 'fs.write', tool_version: '1',
      mutation_class: 'WORKSPACE', state: 'REQUESTED', sandbox_id: null, budget_reservation_id: null, exit_code: null, safe_summary: null,
      stdout_preview: '', stdout_artifact_id: null, stderr_preview: '', stderr_artifact_id: null, evidence_ids: [], artifact_ids: [],
      duration_ms: null, requested_at: '2026-08-30T00:00:00Z', authorized_at: null, started_at: null, completed_at: null,
    };
    const fake = scriptedPool([{ code: '40P01' }], (sql) => {
      if (sql.includes('SELECT t.lease_generation')) return { rows: [toolTask('3')], rowCount: 1 };
      if (sql.includes('SELECT * FROM relay_wonderland.julius_tool_invocations')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO relay_wonderland.julius_tool_invocations')) return { rows: [row], rowCount: 1 };
      return undefined;
    });
    const outcome = await new JuliusToolPostgresRepository(fake.pool).request(TOOL_REQUEST);
    expect(outcome.created).toBe(true);
    expect(fake.attempts(), 'a deadlock victim is retried, not thrown').toBe(2);
    expect(fake.log.at(-1)).toBe('2:COMMIT');
  });

  it('a stale lease is still a refusal: never retried, and rolled back', async () => {
    const fake = scriptedPool([], (sql) => (sql.includes('SELECT t.lease_generation') ? { rows: [toolTask('4')], rowCount: 1 } : undefined));
    await expect(new JuliusToolPostgresRepository(fake.pool).request(TOOL_REQUEST)).rejects.toThrow('tool_stale_authority');
    expect(fake.attempts()).toBe(1);
    expect(fake.log.at(-1)).toBe('1:ROLLBACK');
  });
});

/**
 * H3 (row 13 (i) candidate r5, founder ruling 2026-10-04): ONE JULIUS WRITER AT A TIME. The cases above are about the
 * transaction; these record EVERY statement, the write lock's included, and pin where the lock sits and that it always
 * comes back.
 */
describe('H3: every attempt holds the Julius write lock around its own transaction', () => {
  const recording = (fail: (sql: string, attempt: number) => unknown) => {
    const statements: string[][] = [];
    const released: unknown[] = [];
    let attempt = 0;
    const pool = {
      async connect() {
        attempt += 1;
        const mine: string[] = [];
        const at = attempt;
        statements.push(mine);
        return {
          async query(sql: string) {
            mine.push(sql);
            const failure = fail(sql, at);
            if (failure !== undefined) throw failure;
            return { rows: [], rowCount: 1 };
          },
          release(destroy?: unknown) { released.push(destroy); },
        };
      },
    } as never;
    return { pool, statements, released };
  };
  const BEGIN = 'BEGIN ISOLATION LEVEL SERIALIZABLE';
  const noPause = { pause: async () => undefined };

  it('takes the lock BEFORE BEGIN and gives it back AFTER COMMIT or ROLLBACK, on every attempt, a retried one included', async () => {
    const fake = recording((sql, at) => (at === 1 && sql.startsWith('INSERT') ? serialization() : undefined));
    expect(await juliusSerializable(fake.pool, async (client) => { await client.query('INSERT INTO t VALUES (1)'); return 7; }, noPause)).toBe(7);
    expect(fake.statements).toEqual([
      [JULIUS_WRITE_LOCK, BEGIN, JULIUS_PLAN_PIN, 'INSERT INTO t VALUES (1)', 'ROLLBACK', JULIUS_WRITE_UNLOCK],
      [JULIUS_WRITE_LOCK, BEGIN, JULIUS_PLAN_PIN, 'INSERT INTO t VALUES (1)', 'COMMIT', JULIUS_WRITE_UNLOCK],
    ]);
    expect(fake.released, 'a lock that came back keeps its connection pooled').toEqual([undefined, undefined]);
  });

  it('gives the lock back when the body fails for any other reason, and does not retry', async () => {
    const fake = recording(() => undefined);
    await expect(juliusSerializable(fake.pool, async () => { throw new Error('julius_task_not_found'); }, noPause)).rejects.toThrow('julius_task_not_found');
    expect(fake.statements).toEqual([[JULIUS_WRITE_LOCK, BEGIN, JULIUS_PLAN_PIN, 'ROLLBACK', JULIUS_WRITE_UNLOCK]]);
  });

  it('a nested call inside the body does not take the lock again (it would wait on its own caller)', async () => {
    const outer = recording(() => undefined);
    const inner = recording(() => undefined);
    await juliusSerializable(outer.pool, async (client) => {
      await juliusSerializable(inner.pool, async (nested) => { await nested.query('SELECT 1'); }, noPause);
      await client.query('SELECT 2');
    }, noPause);
    expect(outer.statements).toEqual([[JULIUS_WRITE_LOCK, BEGIN, JULIUS_PLAN_PIN, 'SELECT 2', 'COMMIT', JULIUS_WRITE_UNLOCK]]);
    expect(inner.statements).toEqual([[BEGIN, JULIUS_PLAN_PIN, 'SELECT 1', 'COMMIT']]);
  });

  it('an unlock that fails destroys the connection instead of pooling it with the lock still held', async () => {
    const fake = recording((sql) => (sql === JULIUS_WRITE_UNLOCK ? new Error('connection reset') : undefined));
    expect(await juliusSerializable(fake.pool, async () => 'ok', noPause)).toBe('ok');
    expect(fake.released).toEqual([true]);
  });
});
