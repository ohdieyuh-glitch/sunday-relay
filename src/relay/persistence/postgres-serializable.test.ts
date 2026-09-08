import { describe, expect, it } from 'vitest';

import {
  CommitOutcomeUnknownError,
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

/**
 * THE COMMIT BOUNDARY, which is where exactly-once lives.
 *
 * `julius-tool-settlement-postgres` instruments its commit with
 * `fault('BEFORE_COMMIT')` and `fault('AFTER_COMMIT')` so a crash can be
 * simulated on either side of durability. A retrying helper that owned the
 * commit and offered no hooks would move the commit out from between them and
 * turn an exactly-once drill into a false proof — which is why that repository
 * stayed outside this helper. These cases are the semantics that let it in.
 */
describe('the commit boundary', () => {
  const fakePool = (commitFails?: () => unknown) => {
    const statements: string[] = [];
    let released = 0;
    const client = {
      query: async (sql: string) => {
        const head = sql.split(' ').slice(0, 2).join(' ');
        statements.push(head);
        if (head === 'COMMIT' && commitFails) {
          const failure = commitFails();
          // A null means "this attempt commits cleanly", so the fake can script
          // a commit that fails twice and then succeeds.
          if (failure !== null) throw failure;
        }
        return { rows: [] };
      },
      release: () => { released += 1; },
    };
    return { statements, releases: () => released, pool: { connect: async () => client } as never };
  };
  const noSleep = { sleep: async () => undefined };
  const transient = () => Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' });

  it('runs the hooks around the REAL commit, in order', async () => {
    const { pool, statements } = fakePool();
    const order: string[] = [];
    await serializableTransaction(pool, async () => { order.push('effect'); return 'v'; }, {
      ...noSleep,
      beforeCommit: async () => { order.push(`before:${statements.includes('COMMIT')}`); },
      afterCommit: async () => { order.push(`after:${statements.includes('COMMIT')}`); },
    });
    // The hook names are only meaningful if the COMMIT really is between them.
    expect(order).toEqual(['effect', 'before:false', 'after:true']);
  });

  it('a BEFORE_COMMIT failure rolls back, commits nothing, and is not retried', async () => {
    const { pool, statements } = fakePool();
    let effects = 0;
    await expect(serializableTransaction(pool, async () => { effects += 1; }, {
      ...noSleep, beforeCommit: async () => { throw new Error('fault:BEFORE_COMMIT'); },
    })).rejects.toThrow('fault:BEFORE_COMMIT');
    expect(statements, 'never committed').not.toContain('COMMIT');
    expect(statements.at(-1), 'and the drill still sees ROLLBACK last').toBe('ROLLBACK');
    expect(effects, 'a caller refusal is not a database race').toBe(1);
  });

  it('an AFTER_COMMIT failure NEVER retries — the work is already durable', async () => {
    const { pool, statements } = fakePool();
    let effects = 0;
    await expect(serializableTransaction(pool, async () => { effects += 1; }, {
      ...noSleep, afterCommit: async () => { throw new Error('fault:AFTER_COMMIT'); },
    })).rejects.toThrow('fault:AFTER_COMMIT');
    expect(effects, 'exactly once').toBe(1);
    expect(statements.filter((s) => s === 'COMMIT'), 'committed once').toHaveLength(1);
    expect(statements, 'and no rollback of a finished transaction').not.toContain('ROLLBACK');
  });

  it('and not even when the AFTER_COMMIT error is serialization-SHAPED', async () => {
    // THE HOLE THIS CLOSES, found while writing the helper: deciding by the
    // error's shape rather than by what happened would replay a committed
    // transaction whenever a post-commit hook threw something 40001-shaped.
    const { pool, statements } = fakePool();
    let effects = 0;
    await expect(serializableTransaction(pool, async () => { effects += 1; }, {
      ...noSleep, afterCommit: async () => { throw transient(); },
    })).rejects.toThrow('could not serialize');
    expect(effects, 'durability is a fact, not an error shape').toBe(1);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(1);
  });

  it('a serialization failure AT COMMIT means nothing was committed, so it retries', async () => {
    // PostgreSQL raises 40001 for a transaction IT aborted. Definitely nothing
    // durable, so running it again is safe and is the whole point.
    let commits = 0;
    const { pool, statements } = fakePool(() => { commits += 1; return commits < 3 ? transient() : null; });
    let effects = 0;
    const value = await serializableTransaction(pool, async () => { effects += 1; return 'committed'; }, noSleep);
    expect(value).toBe('committed');
    expect(effects, 'the effect ran again each time').toBe(3);
    expect(statements.filter((s) => s === 'ROLLBACK'), 'each aborted attempt rolled back').toHaveLength(2);
  });

  it('any OTHER commit failure is UNKNOWN, and unknown never retries', async () => {
    // A connection lost mid-flush: the server may have committed and been
    // unable to say so. Retrying is how exactly-once becomes twice; reporting a
    // plain failure is how a settlement that DID happen gets re-attempted.
    const { pool } = fakePool(() => Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
    let effects = 0;
    const error = await serializableTransaction(pool, async () => { effects += 1; }, noSleep)
      .then(() => null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommitOutcomeUnknownError);
    expect((error as CommitOutcomeUnknownError).message).toBe('commit_outcome_unknown');
    expect((error as CommitOutcomeUnknownError).commitError, 'the cause is kept, not swallowed')
      .toMatchObject({ code: 'ECONNRESET' });
    expect(effects, 'asked exactly once — the caller decides, by identity').toBe(1);
  });

  it('distinguishes definitely-aborted from unknown, which is the whole distinction', async () => {
    let commits = 0;
    const { pool } = fakePool(() => { commits += 1; return commits === 1 ? transient() : Object.assign(new Error('boom'), { code: '08006' }); });
    const error = await serializableTransaction(pool, async () => 'v', noSleep).then(() => null).catch((e: unknown) => e);
    // First commit: definitely aborted, so it ran again. Second: unknown, so it stopped.
    expect(commits).toBe(2);
    expect(error).toBeInstanceOf(CommitOutcomeUnknownError);
  });
});
