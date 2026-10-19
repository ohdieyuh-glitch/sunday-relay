import type { Pool, PoolClient } from 'pg';

/**
 * A JULIUS STORE'S DATABASE CONNECTION THAT DIES MUST NOT TAKE THE PROCESS DOWN (WONDERLAND_DEV's finding on the Julius
 * stores, mailbox M20261013T141845Z-WONDERLAND_DEV-7f8abe, 2026-10-13; the pattern of its own pg-held-client.ts and of
 * Project Brain's `checkout()` in project-brain-pg-shared.ts).
 *
 * node-postgres emits `error` on a client whose backend goes away: a PostgreSQL restart, a terminated backend
 * (57P01/57P02/57P03), a dropped socket. pg-pool listens for that only while the client is IDLE in the pool. While a
 * store HOLDS a client (its transaction, its advisory lock, its one fresh-snapshot read), nobody listens, and the event
 * is an uncaught exception: the bridge exits and signs every player out, or a paid arm's entrypoint dies without its
 * RESULT line and its learning record.
 *
 * `checkoutJuliusHeld` listens for the hold time. Each checkout writes ONE fixed line at most: the store's name and the
 * SQLSTATE, never the error's message, a statement or a value. Nothing is retried here and nothing is swallowed: the
 * operation in flight fails through its own error path (its statement rejects, or the next one is refused as not
 * queryable), and the client goes back WITH the error, so the pool destroys it instead of handing it out again.
 *
 * `listenJuliusPool` is the same for a pool's IDLE clients: pg-pool re-emits an idle client's error on the POOL, and a
 * pool nobody listens to turns that into the same uncaught exception. It returns the pool, so it wraps the constructor.
 *
 * A stand-in client or pool without `on` (the scripted pools of the unit tests) is used exactly as before.
 */

/** Where the one line goes. Fixed text only: callers pass a store NAME, never a value. */
export type JuliusStoreLog = (line: string) => void;
const warn: JuliusStoreLog = (line) => { console.warn(line); };

export interface JuliusHeldClient {
  readonly client: PoolClient;
  /**
   * Hands the client back to the pool. If its connection was lost while held, or the caller says so (`destroy`, e.g. an
   * unlock that failed), the pool destroys it. Call exactly once; a second call does nothing.
   */
  release(destroy?: boolean): void;
}

interface Listenable {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  removeListener(event: 'error', listener: (error: unknown) => void): unknown;
}
const listenable = (value: unknown): value is Listenable =>
  typeof (value as { on?: unknown }).on === 'function' && typeof (value as { removeListener?: unknown }).removeListener === 'function';

export async function checkoutJuliusHeld(pool: Pick<Pool, 'connect'>, store: string, log: JuliusStoreLog = warn): Promise<JuliusHeldClient> {
  const client = await pool.connect();
  let lost: Error | undefined;
  const heard = (error: unknown): void => {
    // a dying connection emits more than once (the server's FATAL, then the closed socket): one line
    if (lost !== undefined) return;
    lost = error instanceof Error ? error : new Error('julius_store_connection_lost');
    log(`[julius-store] ${store}: a held database connection was lost (${juliusSqlStateOf(error)}); the operation in flight fails`);
  };
  const listens = listenable(client);
  if (listens) client.on('error', heard);
  let released = false;
  return {
    client,
    release: (destroy = false) => {
      if (released) return;
      released = true;
      if (listens) client.removeListener('error', heard);
      const reason = lost ?? (destroy ? true : undefined);
      if (reason === undefined) client.release();
      else client.release(reason);
    },
  };
}

/** Listens to a pool's idle-client errors, and returns the pool. */
export function listenJuliusPool<P extends Pick<Pool, 'on'>>(pool: P, store: string, log: JuliusStoreLog = warn): P {
  if (listenable(pool)) {
    pool.on('error', (error: unknown) => {
      log(`[julius-store] ${store}: an idle database connection was lost (${juliusSqlStateOf(error)}); the pool discards it`);
    });
  }
  return pool;
}

/**
 * Only the server's SQLSTATE is ever logged. pg puts it in `code` on an error the server sent, which also carries
 * `severity`. A socket error's `code` (ECONNRESET, EPIPE) is not a SQLSTATE, and nothing else of an error is read.
 */
export function juliusSqlStateOf(error: unknown): string {
  const { code, severity } = (error ?? {}) as { code?: unknown; severity?: unknown };
  return typeof severity === 'string' && typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? `SQLSTATE ${code}` : 'no SQLSTATE';
}
