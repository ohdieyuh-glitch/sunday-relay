import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * THE PLAN PIN: A SERIALIZABLE READ OF ONE RUN LOCKS ONE RUN, NOT THE TABLE.
 *
 * WHAT IT WAS (row 13 (i), the third mechanism, measured 2026-10-03). Under
 * SERIALIZABLE every read takes a predicate lock, and the plan decides its size:
 * an index scan locks the index page it searched and the row it returned; a
 * sequential scan locks the WHOLE relation, and reads every row in it. Every
 * Julius transaction reads `julius_runs`: the append's run-ownership read, a
 * transition's own UPDATE, and every foreign key that names a run. On a fresh
 * database — every CI job, every paid run — that table holds a few rows on one
 * page, so the planner reads it sequentially. Then any two overlapping
 * transactions on two DIFFERENT runs form a read/write cycle (each read the
 * other's row, each wrote under the other's relation lock), and one is
 * cancelled with 40001. The fixed append still lost two transitions to it under
 * the 8-writer stress (78–81 conflicts per run); with this pin, 1.
 *
 * WHAT IT IS. Before its body, each attempt's transaction asks the planner for
 * index scans (`enable_seqscan` off: a table no index can answer is still read
 * sequentially) and for a fresh plan at every execution (`plan_cache_mode`
 * force_custom_plan), so a foreign-key check's generic plan, cached earlier on
 * this pooled connection without the pin, cannot bring the relation lock back.
 * Both are SET LOCAL: they end with the transaction and never reach the pool.
 * And SET, unlike a SELECT, takes no snapshot, so the transaction's snapshot is
 * still fixed by the body's first statement, exactly as before the pin.
 * Planner settings change no result, only how rows are found.
 *
 * WHAT IT IS NOT. A transition whose read and write are separate statements can
 * still meet another run's transition on the run index's leaf page: `state` is
 * indexed, so every transition inserts index entries there. That residual is
 * measured, not assumed away (`julius-plan-pin.real-postgres.test.ts`, PIN-5).
 */
export const JULIUS_PLAN_PIN = 'SET LOCAL enable_seqscan = off; SET LOCAL plan_cache_mode = force_custom_plan';

/** PostgreSQL's serialization failure or deadlock, and not a caller-owned conflict. */
export function isJuliusSerializationFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code: unknown }).code);
  if (code !== '40001' && code !== '40P01') return false;
  return (error as { retryable?: unknown }).retryable !== false;
}

/**
 * ONE JULIUS WRITER AT A TIME (row 13 (i) H3, founder ruling 2026-10-04).
 *
 * Narrow fixes removed each conflict the census measured (031's HOT updates,
 * the task lookups by primary key, the idempotent insert), and each time the
 * next pair of overlapping writers became the pivot: under SERIALIZABLE, many
 * millisecond writers over a few small hot tables keep finding a cycle. So the
 * writers do not overlap. Every attempt takes ONE session-level advisory lock
 * BEFORE `BEGIN`: the transaction's snapshot is then taken after the previous
 * holder committed, there is nothing concurrent left to form a cycle with, and
 * a write waits ~1-5 ms in a queue instead of being cancelled and replayed. The
 * retry stays, as the guarantee for anything the lock does not cover (a reader
 * or writer outside this wrapper). SERIALIZABLE stays too: it is still what
 * makes each body's checks sound.
 *
 * The key is one constant hashed by the server, so every process on one
 * database queues on the same lock. A body that opens a nested
 * `juliusSerializable` on another connection would wait on its own caller; the
 * caller's lock is marked in the async context and the nested call does not
 * take it again. An unlock that fails destroys the connection rather than
 * returning it to the pool still holding the lock.
 */
export const JULIUS_WRITE_LOCK = "SELECT pg_advisory_lock(hashtext('relay_wonderland.julius_serializable.v1'))";
export const JULIUS_WRITE_UNLOCK = "SELECT pg_advisory_unlock(hashtext('relay_wonderland.julius_serializable.v1'))";
const writeLockHeld = new AsyncLocalStorage<true>();

/**
 * Run `effect` in one SERIALIZABLE transaction under the plan pin, retrying a
 * serialization failure up to `attempts` times with a short jittered pause.
 * Every attempt gets its own connection, holds the Julius write lock around
 * its own transaction and pin, rolls back on failure and releases the connection.
 */
export async function juliusSerializable<T>(
  pool: Pick<Pool, 'connect'>,
  effect: (client: PoolClient) => Promise<T>,
  options: { readonly attempts?: number; readonly pause?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? JULIUS_SERIALIZABLE_ATTEMPTS);
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nested = writeLockHeld.getStore() === true;
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    let locked = false;
    let destroy = false;
    try {
      if (!nested) {
        await client.query(JULIUS_WRITE_LOCK);
        locked = true;
      }
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query(JULIUS_PLAN_PIN);
      const value = await writeLockHeld.run(true, () => effect(client));
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!isJuliusSerializationFailure(error) || attempt >= attempts) throw error;
    } finally {
      if (locked) await client.query(JULIUS_WRITE_UNLOCK).catch(() => { destroy = true; });
      client.release(destroy || undefined);
    }
    // Exponential and jittered, so two writers that conflicted once do not
    // collide again in step: up to 10, 20, 40, 80, 160 ms before attempts 2-6.
    await pause(Math.floor(Math.random() * 10 * 2 ** (attempt - 1)));
  }
}
