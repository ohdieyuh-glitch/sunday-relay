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
 *   name itself. Since the internal review (M1) it also:
 *     - sends every statement over the EXTENDED protocol, where PostgreSQL refuses
 *       a text holding more than one command (42601) -- so `SELECT 1; COMMIT;
 *       UPDATE ...` cannot end the transaction and write after it, which the
 *       simple protocol would allow and a check of the statement's first word
 *       cannot see;
 *     - is CLOSED before COMMIT or ROLLBACK, and refuses every call after it: a
 *       straggler (one branch of a Promise.all whose sibling already failed) can
 *       never send a statement after the transaction ended;
 *     - DESTROYS the connection whenever the work rejects, rather than returning
 *       a connection that may still be busy to a pool.
 *
 *   ITS OWN POOL (review M1+M2). The world reads where Julius writes -- the same
 *   database (`juliusRuntimeDatabaseUrl`: JULIUS_DATABASE_URL, then DATABASE_URL)
 *   -- but through a SECOND pool of its own, built by
 *   `createWonderlandJuliusWorldPool`: at most four connections, every session
 *   opened with `default_transaction_read_only=on`, and a statement and an
 *   idle-in-transaction timeout. So a world that polls can take four connections
 *   at most and hold none of them long, and a Julius writer's pool never waits
 *   behind it; and a session-level setting a world statement could leave behind
 *   stays on a read-only connection nothing else uses.
 */

import { Pool } from 'pg';
import type { PoolClient, PoolConfig, QueryConfig, QueryResult, QueryResultRow } from 'pg';

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

/**
 * A statement on the EXTENDED query protocol. `pg` (8.23) honours `queryMode` on a
 * query config; `@types/pg` does not declare it, so it is declared here.
 */
interface ExtendedQueryConfig extends QueryConfig {
  readonly queryMode: 'extended';
}

/** What a repository is handed inside the transaction: `query`, and nothing that could leave it. */
export interface WonderlandJuliusReadOnlyQueryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * Run `work` inside one READ ONLY transaction on one pooled connection.
 *
 * COMMIT on success. When the work REJECTS, ROLLBACK is attempted and the
 * connection is DESTROYED whatever ROLLBACK answers: a rejected work may still
 * have a statement in flight (one branch of a Promise.all whose sibling failed),
 * and a connection in that state is not handed to a later request. A connection
 * whose BEGIN or COMMIT failed is destroyed too.
 *
 * The facade is CLOSED before COMMIT or ROLLBACK is sent, and refuses every call
 * after that: nothing a straggler asks for can be sent after the transaction
 * ended. Every statement it does send goes over the extended protocol, which
 * carries exactly one command -- so a text that smuggles `; COMMIT; UPDATE ...`
 * behind a SELECT is refused by PostgreSQL (42601) instead of ending the
 * transaction and writing outside it.
 */
export async function withWonderlandJuliusReadOnlyTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  work: (db: WonderlandJuliusReadOnlyQueryable) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  let discard = false;
  let closed = false;
  try {
    try {
      await client.query(WONDERLAND_JULIUS_READ_ONLY_BEGIN);
    } catch (error) {
      discard = true;
      throw error;
    }
    const db: WonderlandJuliusReadOnlyQueryable = {
      query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> => {
        if (closed) {
          return Promise.reject(new Error('a read-only Wonderland world refused a statement after its transaction ended'));
        }
        if (typeof text !== 'string' || !READ_STATEMENT.test(text)) {
          return Promise.reject(new Error('a read-only Wonderland world refused a statement that is not a read'));
        }
        const statement: ExtendedQueryConfig = { text, values: values ?? [], queryMode: 'extended' };
        return client.query<R>(statement);
      },
    };
    let value: T;
    try {
      value = await work(db);
    } catch (error) {
      closed = true;
      discard = true;
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is destroyed below either way; the work's own error is the one worth reporting.
      }
      throw error;
    }
    closed = true;
    try {
      await client.query('COMMIT');
    } catch (error) {
      discard = true;
      throw error;
    }
    return value;
  } finally {
    closed = true;
    client.release(discard);
  }
}

/* ------------------------------------------------- the world's own pool */

/** At most this many world reads hold a connection at once (review M2). */
export const WONDERLAND_JULIUS_WORLD_POOL_MAX = 4;
/** Every world session starts READ ONLY, outside any BEGIN too (review M1). */
export const WONDERLAND_JULIUS_WORLD_SESSION_OPTIONS = '-c default_transaction_read_only=on';
/** No world statement runs longer than this (review M2). */
export const WONDERLAND_JULIUS_WORLD_STATEMENT_TIMEOUT_MS = 5_000;
/** A world transaction left open and idle is ended by the server after this (review M2). */
export const WONDERLAND_JULIUS_WORLD_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000;
/** Waiting for a connection, or for the server to accept one, gives up after this. */
export const WONDERLAND_JULIUS_WORLD_CONNECT_TIMEOUT_MS = 5_000;

/**
 * The world pool's configuration: the Julius connection string, as `juliusPool()`
 * uses it, plus the bounds above. Every key is one `pg` 8.23 reads: `options` and
 * the two timeouts go into the startup message (Client#getStartupConf), `max` is
 * pg-pool's, `connectionTimeoutMillis` bounds both the pool wait and the connect.
 */
export function wonderlandJuliusWorldPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: WONDERLAND_JULIUS_WORLD_POOL_MAX,
    options: WONDERLAND_JULIUS_WORLD_SESSION_OPTIONS,
    statement_timeout: WONDERLAND_JULIUS_WORLD_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: WONDERLAND_JULIUS_WORLD_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    connectionTimeoutMillis: WONDERLAND_JULIUS_WORLD_CONNECT_TIMEOUT_MS,
  };
}

/**
 * The connection-level settings this pool fixes, which a connection string may
 * ALSO carry as query parameters -- and `pg` lets the URL's win: ConnectionParameters
 * merges `parse(connectionString)` OVER the config object.
 */
const WORLD_SETTINGS_A_URL_COULD_REPLACE = ['options', 'statement_timeout', 'idle_in_transaction_session_timeout'] as const;

/** The query parameters of a connection string, read the way pg-connection-string 2.x reads them. */
function connectionStringParameters(connectionString: string): URLSearchParams {
  if (connectionString.startsWith('/')) return new URLSearchParams();
  let text = connectionString;
  if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/iu.test(text)) text = encodeURI(text).replace(/%25(\d\d)/gu, '%$1');
  try {
    return new URL(text, 'postgres://base').searchParams;
  } catch {
    try {
      return new URL(text.replace('@/', '@___DUMMY___/'), 'postgres://base').searchParams;
    } catch {
      // pg cannot parse it either; the pool's first connect fails and the route answers 503.
      return new URLSearchParams();
    }
  }
}

/**
 * THE WORLD'S OWN POOL, or null when there is no database -- or when the connection
 * string itself names a setting this pool fixes. `pg` would let the URL replace it
 * (an `options=` parameter would drop `default_transaction_read_only`), so a URL
 * that tries is refused with one log line naming the KEY, never the URL: the world
 * is then unconfigured (503) rather than weaker than it says.
 */
export function createWonderlandJuliusWorldPool(
  connectionString: string | null,
  log: (line: string) => void = () => undefined,
): Pool | null {
  if (connectionString === null) return null;
  const parameters = connectionStringParameters(connectionString);
  const replaced = WORLD_SETTINGS_A_URL_COULD_REPLACE.filter((key) => parameters.has(key));
  if (replaced.length > 0) {
    log(`julius world pool refused: the database URL sets ${replaced.join(', ')}, which would replace the world's read-only session settings`);
    return null;
  }
  return new Pool(wonderlandJuliusWorldPoolConfig(connectionString));
}

/**
 * THE DATABASE THE WORLD READS: the Julius runtime's own choice, unchanged.
 *
 * Kept as a named function so the agreement is tested directly, including when
 * the two variables differ: a world reader that followed DATABASE_URL while
 * Julius wrote through JULIUS_DATABASE_URL would hydrate another database's
 * runs, or none. The server composes the world over its own read-only pool
 * (`createWonderlandJuliusWorldPool`), which is built from exactly this URL.
 */
export const wonderlandJuliusDatabaseUrl = (env: NodeJS.ProcessEnv): string | null =>
  juliusRuntimeDatabaseUrl(env);

/**
 * ALL THREE READS, FROM ONE POOL, IN ONE READ-ONLY TRANSACTION PER REQUEST.
 * In production the pool is the world's own (`createWonderlandJuliusWorldPool`).
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
