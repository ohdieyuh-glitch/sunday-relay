import type { Pool, PoolClient } from 'pg';

/**
 * A SERIALIZABLE TRANSACTION THAT SURVIVES THE THING SERIALIZABLE DOES.
 *
 * `BEGIN ISOLATION LEVEL SERIALIZABLE` does not make concurrency disappear; it
 * makes PostgreSQL DETECT it and abort one of the transactions with
 * `40001 could not serialize access due to read/write dependencies among
 * transactions`. That abort is transient by definition — the whole point is
 * that re-running the transaction is expected to succeed — and PostgreSQL's own
 * documentation says an application using this isolation level must be prepared
 * to retry.
 *
 * Julius's repositories were not. SEVEN OF THE EIGHT that execute a
 * SERIALIZABLE `BEGIN` rolled back and rethrew, so a condition the database
 * raises to say "try again" reached the run loop as a failure.
 * `julius-tool-postgres.ts` already retried, and
 * `TransactionalWonderlandDatabase.transaction` already retried; the rest did
 * not, which made the behaviour a property of which file you happened to be in.
 *
 * `julius-context-postgres.ts` is deliberately NOT among them and must not be:
 * it takes a dedicated connection precisely so its read gets a fresh snapshot
 * OUTSIDE any caller's transaction, and it says so at length. An earlier count
 * here said "eight of nine" by matching that file's prose rather than its
 * code — the kind of error a comment can carry and a test cannot.
 *
 * Proven against a real PostgreSQL 16 rather than argued: two transactions of
 * exactly the shape these repositories use — read one task row, write another,
 * no `FOR UPDATE` between them — produce
 * `{"code":"40001","message":"could not serialize access due to read/write
 * dependencies among transactions"}`.
 *
 * WHY THE MESSAGE IS CHECKED AND NOT ONLY THE CODE. `julius-postgres.ts` throws
 * its OWN stale-version sentinel wearing `code: '40001'`, and that one must
 * never be retried: the caller's `expectedVersion` is stale, so a second
 * attempt reads the same stale value and fails identically — a retry loop that
 * could not tell them apart would spin. The sentinel has been given its own
 * code, and this guard is the second line: a serialization failure is one
 * PostgreSQL raised, and PostgreSQL says so in words this file does not invent.
 */
const SERIALIZATION_FAILURE = /could not serialize|deadlock detected/iu;

/** `40001` serialization failure and `40P01` deadlock — both transient, both retryable. */
export function isTransientSerializationFailure(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (value === null || typeof value !== 'object') return false;
  if (value.code !== '40001' && value.code !== '40P01') return false;
  return typeof value.message === 'string' && SERIALIZATION_FAILURE.test(value.message);
}

/**
 * The bound is the same one `julius-tool-postgres.ts` chose when it solved this
 * for itself: five attempts, a few milliseconds apart. A serialization failure
 * that survives five attempts is contention this layer cannot resolve, and
 * hiding it behind a longer loop would turn a visible problem into a slow one.
 *
 * THE EFFECT MUST BE PURE DATABASE WORK. It runs again on a retry, and a
 * transaction that also sent an email or spent money would send or spend twice.
 * Every caller here does `client.query` and nothing else, which is what makes
 * the retry safe rather than merely convenient.
 */
export const SERIALIZABLE_MAX_ATTEMPTS = 5;

export async function serializableTransaction<T>(
  pool: Pool,
  effect: (client: PoolClient) => Promise<T>,
  deps: { readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    // RELEASED EXACTLY ONCE. `pg` throws on a second release, and an earlier
    // draft of this function released in the retry path AND in `finally` — so
    // the very first concurrent pair it was written for failed on the double
    // release rather than on anything to do with serialization. The connection
    // is still handed back BEFORE the backoff, because holding a pooled client
    // across a sleep is how a retry storm becomes pool exhaustion.
    let released = false;
    const release = () => { if (!released) { released = true; client.release(); } };
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const value = await effect(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (attempt >= SERIALIZABLE_MAX_ATTEMPTS || !isTransientSerializationFailure(error)) throw error;
      release();
      await sleep(5 * attempt);
      continue;
    } finally {
      release();
    }
  }
}
