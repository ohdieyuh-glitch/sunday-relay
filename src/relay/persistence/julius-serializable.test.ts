import { describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../mission/julius';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusPostgresRepository } from './julius-postgres';
import { JULIUS_SERIALIZABLE_ATTEMPTS, isJuliusSerializationFailure, juliusSerializable } from './julius-serializable';

/**
 * THE SERIALIZATION RETRY, WITHOUT A DATABASE.
 *
 * The real-PostgreSQL multi-mission suite is where 40001 actually happens (two
 * run loops; six missions stranded for two minutes before this). These cases
 * pin the retry's exact contract on every run, in milliseconds: which errors
 * are retried, how often, that every attempt rolls back and releases its
 * connection, and that a conflict the CALLER must see is never absorbed.
 */

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
