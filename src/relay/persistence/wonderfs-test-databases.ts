import type { Pool } from 'pg';

/**
 * WONDERFS REAL-POSTGRESQL SUITES: THEIR THROWAWAY DATABASES, AND THE ONE ORDER THEY ARE TORN DOWN IN (R2-r4). Test support only:
 * imported by `*.real-postgres.test.ts` files and its own unit test, never by the product.
 *
 * THE DEFECT (CI r1.16 e838a8c3, both topologies: "Errors 3 errors", each an uncaught `terminating connection due to administrator
 * command`, FATAL 57P01, raised from pg-protocol's parser on a socket's data, originating in wonderfs-write.real-postgres.test.ts).
 * That suite opens a SECOND pool on a database it already made -- a restarted bridge, three times: T-PERSIST once, T-CRASH twice --
 * so its teardown list named those databases twice. Its afterAll took the list in order: the FIRST pool got its 'error' listener and
 * ended, then every backend of its database was terminated and the database dropped -- while the reopened pool on that database
 * still held an idle client and had no listener yet (the loop would have attached one on reaching it). pg-pool re-emits an idle
 * client's FATAL as the pool's 'error'; with no listener, node raises it as an uncaught exception. One per reopened pool: the r2 file
 * (two reopens) had 2 such Errors in CI, the r3 file (three) had 3; the file ran in 5.2 s / 7.0 s, inside pg-pool's 10 s idle
 * timeout, so each reopened pool's client was still there.
 *
 * THE ORDER, here and nowhere else. Every pool is TRACKED from birth (a reopened one too), with an 'error' listener that RECORDS
 * what it hears -- never a bare `() => undefined`. Teardown ends EVERY pool (every database's, every sibling's) and waits until
 * each client it held has CLOSED, because pg-pool 3.14's end() resolves before that (its _remove() does not await client.end());
 * it then checks that no pool still holds a client, and only after that terminates and drops each database, once. What a pool hears
 * DURING a case is that case's failure (`takeCaseErrors`, asserted by the suite's afterEach); what it hears during teardown is
 * recorded and returned, not thrown.
 */

/** What a tracked pool reported: the database it is on, the SQLSTATE (57P01: an administrator's terminate), and when. */
export interface WfsHeardPoolError {
  readonly database: string;
  readonly code: string | null;
  readonly message: string;
  readonly during: 'case' | 'teardown';
}

/** What teardown needs of a pool: a pg Pool (the unit test's fake has the same surface). */
export type WfsTrackedPool = Pick<Pool, 'on' | 'end' | 'totalCount'>;

export interface WfsTeardownResult {
  /** The databases dropped, each once, in the order they were first tracked. */
  readonly dropped: readonly string[];
  /** What the pools heard while being torn down (recorded, never thrown). */
  readonly heard: readonly WfsHeardPoolError[];
}

export interface WfsThrowawayDatabases {
  /** Track `pool`, on throwaway database `database`, from now on: a pool made for a new database and a REOPENED one alike. */
  track<P extends WfsTrackedPool>(database: string, pool: P): P;
  /** The database a tracked pool is on (null: not tracked). */
  databaseOf(pool: WfsTrackedPool): string | null;
  /** What the pools heard during the cases since the last call, taken (a suite's afterEach expects none). */
  takeCaseErrors(): WfsHeardPoolError[];
  /**
   * END EVERY POOL, THEN DROP. Every tracked pool is ended and its clients awaited (each within `closeWithinMs`); if any pool still
   * holds a client after that, this throws and NOTHING is terminated or dropped. Then, once per database: its remaining backends
   * are terminated and it is dropped.
   */
  teardown(admin: Pick<Pool, 'query'>, options?: { readonly closeWithinMs?: number }): Promise<WfsTeardownResult>;
}

/** A database name this helper interpolates into DROP DATABASE: lower-case letters, digits and '_' only (what the suites make). */
const THROWAWAY_NAME = /^[a-z][a-z0-9_]{0,62}$/u;

export function wfsThrowawayDatabases(): WfsThrowawayDatabases {
  const tracked: Array<{ readonly database: string; readonly pool: WfsTrackedPool }> = [];
  const caseErrors: WfsHeardPoolError[] = [];
  const teardownErrors: WfsHeardPoolError[] = [];
  let tearingDown = false;

  return {
    track(database, pool) {
      if (!THROWAWAY_NAME.test(database)) throw new Error(`wonderfs test databases: '${database}' is not a throwaway database name`);
      pool.on('error', (error: Error) => {
        const code = (error as { code?: unknown }).code;
        const heard: WfsHeardPoolError = { database, code: typeof code === 'string' ? code : null, message: error.message, during: tearingDown ? 'teardown' : 'case' };
        (tearingDown ? teardownErrors : caseErrors).push(heard);
      });
      tracked.push({ database, pool });
      return pool;
    },
    databaseOf(pool) {
      return tracked.find((t) => t.pool === pool)?.database ?? null;
    },
    takeCaseErrors() {
      return caseErrors.splice(0);
    },
    async teardown(admin, options = {}) {
      tearingDown = true;
      const closeWithinMs = options.closeWithinMs ?? 15_000;
      // 1. EVERY pool ends -- every database's, every reopened sibling's -- and every client it held finishes closing
      await Promise.all(tracked.map(({ pool }) => endAndClose(pool, closeWithinMs)));
      const holding = tracked.filter(({ pool }) => pool.totalCount !== 0);
      if (holding.length > 0) {
        throw new Error(`wonderfs test databases: ${holding.length} pool(s) still hold a client (${[...new Set(holding.map((h) => h.database))].join(', ')}); nothing was terminated or dropped`);
      }
      // 2. only then, ONCE per database: what is left of it (a backend still exiting) is terminated, and it is dropped
      const dropped: string[] = [];
      for (const database of new Set(tracked.map((t) => t.database))) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]).catch(() => undefined);
        if (await admin.query(`DROP DATABASE IF EXISTS ${database}`).then(() => true, () => false)) dropped.push(database);
      }
      return { dropped, heard: [...teardownErrors] };
    },
  };
}

/** End a pool and wait until every client it held has closed (pg-pool's 'remove', emitted after client.end()), within `ms`. */
async function endAndClose(pool: WfsTrackedPool, ms: number): Promise<void> {
  let open = pool.totalCount;
  const closed = new Promise<void>((resolve) => {
    if (open === 0) {
      resolve();
      return;
    }
    pool.on('remove', () => {
      open -= 1;
      if (open <= 0) resolve();
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([Promise.all([pool.end().catch(() => undefined), closed]), bound]);
  clearTimeout(timer);
}
