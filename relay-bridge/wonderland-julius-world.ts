/**
 * THE WORLD'S READS, AND THE TRANSACTION THAT MAKES THEM READ-ONLY (row 12, R1).
 *
 * The Julius world routes (`wonderland-julius-routes.ts`) read three things for a
 * request: who belongs to the project, the run as a world draws it, and Julius's
 * own result. This module is where those reads meet the database, and the one
 * rule it exists for is that NONE OF THEM CAN WRITE:
 *
 *   ONE TRANSACTION PER REQUEST, OPENED READ ONLY. PostgreSQL refuses any write
 *   inside it with SQLSTATE 25006, so even a coding error in a repository this
 *   bridge reuses -- a stray UPDATE in a read path -- cannot change a row. That is
 *   enforced by the server, not by this file's good intentions.
 *
 *   REPEATABLE READ, so every statement of the request sees ONE snapshot: the
 *   membership row that authorises a read and the read itself, the run row and
 *   the events folded beside it. A READ ONLY transaction at this level never
 *   fails with a serialisation error and takes no predicate locks, so it can
 *   neither block nor abort a Julius writer (SERIALIZABLE would take SIREAD
 *   locks and could turn a writer's commit into a 40001).
 *
 *   A QUERY-ONLY FACADE. The repositories are handed an object with `query` and
 *   nothing else: no `connect`, so nothing they call can open a second connection
 *   outside the transaction. And a statement that is not a read is refused before
 *   it is sent -- the database would refuse it anyway; this makes the refusal
 *   name itself.
 *
 *   ONE POOL. The world reads where Julius writes: the bridge's one Julius pool
 *   (`juliusRuntimeDatabaseUrl`: JULIUS_DATABASE_URL, then DATABASE_URL), the same
 *   one the Project Brain and native pairing read membership from.
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { composeJuliusStateApi } from './julius-state-routes';
import { wonderlandJuliusResultsFrom } from './wonderland-julius-routes';
import type { WonderlandJuliusReadScope, WonderlandJuliusWorld } from './wonderland-julius-routes';
import { juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { WonderlandJuliusReaderPostgres } from '../src/relay/persistence/wonderland-julius-reader-postgres';
import { WonderlandMembershipPostgres } from '../src/relay/persistence/wonderland-membership-postgres';

/**
 * THE STATEMENT EVERY WORLD READ BEGINS WITH. Exported so the real-PostgreSQL
 * suite can prove, against a real server, that this exact text makes a write
 * fail -- the unit suite proves every read goes through it.
 */
export const WONDERLAND_JULIUS_READ_ONLY_BEGIN = 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY';

/** A read, and only a read: SELECT, or WITH ... SELECT (a data-modifying WITH is refused by the server). */
const READ_STATEMENT = /^\s*(?:SELECT|WITH)\b/iu;

/** What a repository is handed inside the transaction: `query`, and nothing that could leave it. */
export interface WonderlandJuliusReadOnlyQueryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * Run `work` inside one READ ONLY transaction on one pooled connection.
 *
 * COMMIT on success, ROLLBACK on failure, and the connection is DESTROYED rather
 * than returned when its state is unknown (BEGIN, COMMIT or ROLLBACK failed), so
 * the pool never hands a later request a connection still inside this
 * transaction.
 */
export async function withWonderlandJuliusReadOnlyTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  work: (db: WonderlandJuliusReadOnlyQueryable) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  let discard = false;
  try {
    try {
      await client.query(WONDERLAND_JULIUS_READ_ONLY_BEGIN);
    } catch (error) {
      discard = true;
      throw error;
    }
    const db: WonderlandJuliusReadOnlyQueryable = {
      query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> => {
        if (typeof text !== 'string' || !READ_STATEMENT.test(text)) {
          return Promise.reject(new Error('a read-only Wonderland world refused a statement that is not a read'));
        }
        return values === undefined ? client.query<R>(text) : client.query<R>(text, values);
      },
    };
    let value: T;
    try {
      value = await work(db);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    }
    try {
      await client.query('COMMIT');
    } catch (error) {
      discard = true;
      throw error;
    }
    return value;
  } finally {
    client.release(discard);
  }
}

/**
 * THE DATABASE THE WORLD READS: the Julius runtime's own choice, unchanged.
 *
 * Kept as a named function so the agreement is tested directly, including when
 * the two variables differ: a world reader that followed DATABASE_URL while
 * Julius wrote through JULIUS_DATABASE_URL would hydrate another database's
 * runs, or none. The server composes the world over its one Julius pool, which
 * is built from exactly this URL.
 */
export const wonderlandJuliusDatabaseUrl = (env: NodeJS.ProcessEnv): string | null =>
  juliusRuntimeDatabaseUrl(env);

/**
 * ALL THREE READS, FROM ONE POOL, IN ONE READ-ONLY TRANSACTION PER REQUEST.
 *
 * `composeApi` is Julius's own read API over a pool -- `composeJuliusStateApi`,
 * the composition the operator's state routes answer from -- and it is given the
 * transaction's query-only facade rather than the pool, so the result read is in
 * the same transaction (and the same snapshot) as the membership row that
 * authorised it. Injectable only so a test can prove the wiring.
 */
export function wonderlandJuliusWorld(
  pool: Pick<Pool, 'connect'>,
  options: { readonly composeApi?: (pool: Pool) => Parameters<typeof wonderlandJuliusResultsFrom>[0] } = {},
): WonderlandJuliusWorld {
  const composeApi = options.composeApi ?? composeJuliusStateApi;
  return {
    read: <T>(work: (scope: WonderlandJuliusReadScope) => Promise<T>): Promise<T> =>
      withWonderlandJuliusReadOnlyTransaction(pool, (db) => {
        // A Pool in name only: `query` is all the read repositories ever call, and
        // anything else they reached for would be undefined -- a TypeError, a 503,
        // and never a statement outside this transaction.
        const facade = db as unknown as Pool;
        return work({
          membership: new WonderlandMembershipPostgres(facade),
          reader: new WonderlandJuliusReaderPostgres(facade),
          results: wonderlandJuliusResultsFrom(composeApi(facade)),
        });
      }),
  };
}
