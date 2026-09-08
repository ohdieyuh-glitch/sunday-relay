import { describe, expect, it } from 'vitest';

import {
  SERIALIZABLE_MAX_ATTEMPTS,
  isTransientSerializationFailure,
  serializableTransaction,
} from './postgres-serializable';

/**
 * The classifier decides whether a transaction is run again, so it is the whole
 * safety of the retry. Its counterpart against a real PostgreSQL — which is the
 * only thing that can produce a genuine serialization failure — lives in
 * `real-infra-julius.test.ts` behind `JULIUS_REAL_POSTGRES=1`.
 */
describe('what counts as a transient serialization failure', () => {
  it('accepts what PostgreSQL actually raises, by code AND by its own words', () => {
    for (const [code, message] of [
      ['40001', 'could not serialize access due to read/write dependencies among transactions'],
      ['40001', 'could not serialize access due to concurrent update'],
      ['40P01', 'deadlock detected'],
    ] as const) {
      expect(isTransientSerializationFailure(Object.assign(new Error(message), { code })), message).toBe(true);
    }
  });

  it('REFUSES the stale-version sentinel, whatever code it wears', () => {
    // The one that must never be retried: a second attempt reads the same stale
    // `expectedVersion` and fails identically, so a retry loop would spin. It
    // has its own code now; this is the second line, for an impostor that
    // still claims PostgreSQL's.
    for (const code of ['julius_stale_version', '40001', '40P01', undefined]) {
      const sentinel = Object.assign(new Error('optimistic_concurrency_conflict'), { code });
      expect(isTransientSerializationFailure(sentinel), String(code)).toBe(false);
    }
  });

  it('refuses every other shape rather than guessing', () => {
    expect(isTransientSerializationFailure(null)).toBe(false);
    expect(isTransientSerializationFailure(undefined)).toBe(false);
    expect(isTransientSerializationFailure('could not serialize')).toBe(false);
    expect(isTransientSerializationFailure({ code: '40001' }), 'a code with no message').toBe(false);
    expect(isTransientSerializationFailure({ message: 'could not serialize' }), 'words with no code').toBe(false);
    expect(isTransientSerializationFailure(Object.assign(new Error('could not serialize'), { code: '23505' })),
      'a unique violation is not a serialization failure').toBe(false);
  });
});

describe('the retry loop itself, with a fake pool', () => {
  /** A pool that records the statements it was given and never touches a database. */
  const fakePool = () => {
    const statements: string[] = [];
    let released = 0;
    const client = {
      query: async (sql: string) => { statements.push(sql.split(' ').slice(0, 2).join(' ')); return { rows: [] }; },
      release: () => { released += 1; },
    };
    return {
      statements,
      releases: () => released,
      pool: { connect: async () => client } as never,
    };
  };
  const noSleep = { sleep: async () => undefined };
  const transient = () => Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' });

  it('commits once when the effect succeeds, and releases the client', async () => {
    const { pool, statements, releases } = fakePool();
    await expect(serializableTransaction(pool, async () => 'value', noSleep)).resolves.toBe('value');
    expect(statements).toEqual(['BEGIN ISOLATION', 'COMMIT']);
    expect(releases(), 'released exactly once').toBe(1);
  });

  it('retries a transient failure and stops at the bound', async () => {
    const { pool, statements, releases } = fakePool();
    let attempts = 0;
    await expect(serializableTransaction(pool, async () => { attempts += 1; throw transient(); }, noSleep))
      .rejects.toThrow('could not serialize');
    expect(attempts, 'bounded, so contention this layer cannot resolve stays visible').toBe(SERIALIZABLE_MAX_ATTEMPTS);
    expect(statements.filter((s) => s === 'ROLLBACK')).toHaveLength(SERIALIZABLE_MAX_ATTEMPTS);
    // RELEASED EXACTLY ONCE PER ATTEMPT. `pg` throws on a second release, and an
    // earlier draft released in both the retry path and `finally` — the first
    // concurrent pair it met failed on that rather than on serialization.
    expect(releases(), 'one release per attempt, never two').toBe(SERIALIZABLE_MAX_ATTEMPTS);
  });

  it('succeeds on a later attempt without the caller seeing anything', async () => {
    const { pool, releases } = fakePool();
    let attempts = 0;
    const value = await serializableTransaction(pool, async () => {
      attempts += 1;
      if (attempts < 3) throw transient();
      return 'committed';
    }, noSleep);
    expect(value).toBe('committed');
    expect(attempts).toBe(3);
    expect(releases()).toBe(3);
  });

  it('a throwing effect ROLLS BACK and never commits', async () => {
    // THE INVARIANT CALLERS LEAN ON when they leave by throwing rather than
    // returning — `julius-subagent-postgres` does exactly that to refuse a
    // sub-agent without committing. It belongs here, where a fake pool can see
    // the statements; a database test cannot distinguish COMMIT from ROLLBACK
    // when the transaction wrote nothing, which is how an earlier version of
    // that check passed while proving nothing.
    const { pool, statements } = fakePool();
    await expect(serializableTransaction(pool, async () => { throw new Error('refused'); }, noSleep))
      .rejects.toThrow('refused');
    expect(statements).toEqual(['BEGIN ISOLATION', 'ROLLBACK']);
    expect(statements, 'no COMMIT follows a throw').not.toContain('COMMIT');
  });

  it('never retries something the database did not raise', async () => {
    const { pool } = fakePool();
    let attempts = 0;
    await expect(serializableTransaction(pool, async () => { attempts += 1; throw new Error('julius_run_not_found'); }, noSleep))
      .rejects.toThrow('julius_run_not_found');
    expect(attempts, 'a domain error is the caller‑s answer, not a race').toBe(1);
  });

  it('backs off between attempts, and hands the connection back BEFORE sleeping', async () => {
    // Holding a pooled client across the backoff is how a retry storm becomes
    // pool exhaustion, so the release must precede the sleep.
    const { pool, releases } = fakePool();
    const order: string[] = [];
    const delays: number[] = [];
    let attempts = 0;
    await expect(serializableTransaction(pool, async () => { attempts += 1; order.push(`attempt:${releases()}`); throw transient(); }, {
      sleep: async (ms) => { delays.push(ms); order.push(`sleep:${releases()}`); },
    })).rejects.toThrow('could not serialize');
    expect(delays, 'increasing, and bounded by the attempt limit').toEqual([5, 10, 15, 20]);
    expect(order[1], 'the client was already back in the pool when the first sleep began').toBe('sleep:1');
  });
});
