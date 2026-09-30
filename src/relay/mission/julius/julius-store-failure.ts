/**
 * WHAT KIND OF FAILURE A THROWN ERROR IS, WHEN JULIUS'S OWN STORE THREW IT.
 *
 * The execution coordinator used to turn every throw that was not a
 * `JuliusDispatchError` into a non-retryable `WORKER_EXECUTION_FAILURE`. Its
 * own writes were among them: events, evidence, result acceptance and
 * settlement. So a database race was recorded as the worker failing. The
 * real-PostgreSQL multi-mission suite measured it: one mission in four FAILED
 * on a 40001 its worker never saw.
 *
 * This names the class from the driver's own code, and never from a message a
 * provider could have written. The two exceptions are pg's two fixed driver
 * strings, matched exactly. It answers null for anything that is not a store
 * error at all, so a domain refusal (`stale_worker_result`) or a dispatch error
 * keeps its own meaning.
 *
 * TRANSIENT means that repeating the same statements can succeed. Only those
 * classes may be retried, and a retry means repeating Julius's BOOKKEEPING,
 * never a paid dispatch. Integrity errors (a violated constraint, a value the
 * column refuses, a missing relation) are a bug or bad data. They fail on
 * every attempt, so they are never transient.
 */

export const JULIUS_STORE_ERROR_CLASSES = ['serialization', 'connection', 'resources', 'lock', 'integrity', 'unknown'] as const;
export type JuliusStoreErrorClass = (typeof JULIUS_STORE_ERROR_CLASSES)[number];

/**
 * A SQLSTATE, and only that. The class is two characters: `00`-`58`, or one of
 * `F0`, `HV`, `P0`, `XX`. So a Node errno of the same length (`EPERM`, `EBUSY`)
 * is not mistaken for one.
 */
const SQLSTATE = /^(?:[0-5][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/u;

/** Socket-level failures Node reports on the connection a query was using. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
]);

/**
 * pg and pg-pool raise these with NO code. They are the driver's own fixed strings
 * (pg 8.23 `lib/client.js`, pg-pool `index.js`), compared whole.
 *
 * The first one is what a lost connection actually looks like. A real
 * PostgreSQL case terminated a pooled client's backend and queried the client:
 * the driver answered "Client has encountered a connection error and is not
 * queryable" with no code at all. That string was not in this set, so a lost
 * acknowledgement was called non-transient and a mission FAILED for it. The set
 * is now taken from the driver's source, not guessed. SSL and protocol-state
 * errors are left out: repeating them cannot help.
 */
const DRIVER_CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Query read timeout',
  'timeout expired',
  'timeout exceeded when trying to connect',
]);

export function juliusStoreErrorClass(error: unknown): JuliusStoreErrorClass | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (NETWORK_CODES.has(code)) return 'connection';
    if (SQLSTATE.test(code)) {
      const family = code.slice(0, 2);
      if (family === '40') return 'serialization';
      // 57P01-57P03: the server went away (admin shutdown, crash shutdown, cannot connect now).
      if (family === '08' || code === '57P01' || code === '57P02' || code === '57P03') return 'connection';
      if (family === '53') return 'resources';
      if (code === '55P03') return 'lock';
      if (family === '22' || family === '23' || family === '42') return 'integrity';
      return 'unknown';
    }
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && DRIVER_CONNECTION_MESSAGES.has(message)) return 'connection';
  return null;
}

/**
 * A POSTGRESQL ERROR, by the driver's own shape: a SQLSTATE and a `severity`.
 *
 * The provider router uses this where an error can come from EITHER side: an
 * adapter's provider call, or a write the adapter made for Julius (the
 * executor's tool settlement). A socket errno cannot tell those two apart, so
 * it is left to the provider taxonomy. A SQLSTATE with the driver's severity
 * beside it is only ever Julius's store.
 */
export function isJuliusPostgresError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === 'string' && SQLSTATE.test(code) && typeof severity === 'string' && severity.trim() !== '';
}

/** Whether repeating Julius's own statements could succeed where they just failed. */
export function juliusStoreErrorIsTransient(storeClass: JuliusStoreErrorClass | null): boolean {
  return storeClass === 'serialization' || storeClass === 'connection' || storeClass === 'resources' || storeClass === 'lock';
}
