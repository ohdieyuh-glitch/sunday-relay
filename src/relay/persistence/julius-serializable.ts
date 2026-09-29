import type { Pool, PoolClient } from 'pg';

/**
 * A SERIALIZATION FAILURE IS RETRIED, BECAUSE POSTGRESQL GUARANTEES IT ROLLED
 * BACK.
 *
 * WHAT IT WAS. Every Julius write that runs SERIALIZABLE surfaced SQLSTATE 40001
 * ("could not serialize access due to read/write dependencies among
 * transactions") straight into the run loop. Two writers are the ordinary case
 * — two run loops, or one mission job beside the bridge's lifecycle and
 * approval routes — and the real-PostgreSQL multi-mission suite measured what
 * one such conflict did: `JuliusRunLoop.tick` threw, every task that tick had
 * claimed stayed ACTIVE under a lease nobody was renewing, and six missions sat
 * in EXECUTING for two minutes. The in-memory store cannot conflict, which is
 * why nothing caught it.
 *
 * WHY A RETRY IS SAFE HERE, AND WHERE IT IS NOT. A 40001 or 40P01 abort means
 * the transaction's writes were rolled back — none of them happened. The bodies
 * this wraps are SQL over inputs their callers fixed before the call (ids,
 * command ids, idempotency keys, timestamps), so running the same body again is
 * running the same write again, which is PostgreSQL's documented answer to a
 * serialization failure. What a retry must NOT absorb is a conflict the CALLER
 * has to see: `JuliusPostgresRepository.transition` raises its own
 * `optimistic_concurrency_conflict` with code 40001 and `retryable: false`
 * when the caller's expected version is stale — re-reading cannot fix that, so
 * it is thrown on the first attempt. A body that performed an effect outside
 * the database would not be safe to re-run; none of the ones wrapped here does,
 * and a new one must not.
 */

/**
 * Attempts, including the first. Bounded: a storm of conflicts still surfaces.
 * SIX, measured rather than guessed: with two run loops advancing six missions
 * on one database, three attempts were exhausted on the event append (SSI
 * reports read/write dependencies between an append's lookup-by-id and a
 * concurrent writer's insert even when the rows differ, and those resolve on a
 * retry); the backoff doubles per attempt, so six attempts wait at most ~0.6 s.
 */
export const JULIUS_SERIALIZABLE_ATTEMPTS = 6;

/** PostgreSQL's serialization failure or deadlock, and not a caller-owned conflict. */
export function isJuliusSerializationFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code: unknown }).code);
  if (code !== '40001' && code !== '40P01') return false;
  return (error as { retryable?: unknown }).retryable !== false;
}

/**
 * Run `effect` in one SERIALIZABLE transaction, retrying a serialization
 * failure up to `attempts` times with a short jittered pause. Every attempt
 * gets its own connection, rolls back on failure and releases the connection.
 */
export async function juliusSerializable<T>(
  pool: Pick<Pool, 'connect'>,
  effect: (client: PoolClient) => Promise<T>,
  options: { readonly attempts?: number; readonly pause?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? JULIUS_SERIALIZABLE_ATTEMPTS);
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const value = await effect(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!isJuliusSerializationFailure(error) || attempt >= attempts) throw error;
    } finally {
      client.release();
    }
    // Exponential and jittered, so two writers that conflicted once do not
    // collide again in step: up to 10, 20, 40, 80, 160 ms before attempts 2-6.
    await pause(Math.floor(Math.random() * 10 * 2 ** (attempt - 1)));
  }
}
