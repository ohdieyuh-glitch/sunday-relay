import type { Pool, PoolClient } from 'pg';

/**
 * A HELD CLIENT WHOSE CONNECTION DIES MUST NOT TAKE THE BRIDGE DOWN (MW-B-001, MAIN WONDERLAND's audit, 2026-10-13).
 *
 * node-postgres emits `error` on a client whose backend goes away: a PostgreSQL restart, a terminated backend
 * (57P01/57P02/57P03), a dropped socket. A pool listens for that only while the client is IDLE in the pool. While a store holds
 * the client in the middle of a transaction, nobody listens, so the event is an uncaught exception. The bridge process exits,
 * and every in-memory session, sign-in and presence lease goes with it: every player is signed out.
 *
 * This is the pattern of project-brain-pg-shared.ts `checkout()`, and it also keeps a record. Each checkout writes one fixed
 * log line, at most: the store's name and the SQLSTATE, never the error's message, a statement or a value. Nothing is swallowed
 * silently, and nothing is retried here. The operation in flight already fails by itself: its statement rejects, or the next
 * one is refused as "not queryable". Each store's own catch then answers its existing retryable error. A client that lost its
 * connection while held goes back WITH that error, so the pool destroys it and does not hand it out again.
 *
 * A stand-in client without `on` (the scripted pools of the unit tests) is held as before. Every real pg client has `on`.
 */
export interface HeldClient {
  readonly client: PoolClient;
  /** Hands the client back to the pool. If its connection was lost while held, the pool destroys it. Call exactly once. */
  release(): void;
}

export async function checkoutHeld(
  pool: Pick<Pool, 'connect'>,
  store: string,
  log: (line: string) => void = (line) => console.warn(line),
): Promise<HeldClient> {
  const client = await pool.connect();
  let lost: Error | undefined;
  const heard = (error: unknown): void => {
    if (lost !== undefined) return; // a dying connection can emit twice (the FATAL, then the closed socket): one line
    lost = error instanceof Error ? error : new Error('database connection lost');
    log(`[relay-store] ${store}: a held database connection was lost (${sqlStateOf(error)}); the operation in flight fails as retryable`);
  };
  const listens = typeof (client as { on?: unknown }).on === 'function';
  if (listens) client.on('error', heard);
  return {
    client,
    release: () => {
      if (listens) client.off('error', heard);
      client.release(lost);
    },
  };
}

/**
 * Only the server's SQLSTATE is logged. pg puts it in `code` on an error the server sent, which also carries `severity`. A
 * socket error's `code` (ECONNRESET, EPIPE) is not a SQLSTATE.
 */
function sqlStateOf(error: unknown): string {
  const { code, severity } = (error ?? {}) as { code?: unknown; severity?: unknown };
  return typeof severity === 'string' && typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? `SQLSTATE ${code}` : 'no SQLSTATE';
}
