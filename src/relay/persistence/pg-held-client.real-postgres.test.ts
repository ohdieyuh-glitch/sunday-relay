import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from '../../../relay-bridge/wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from '../../../relay-bridge/wonderland-social-scope';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { openSocialPostgresStore } from './social-postgres';
import { createPostgresVoiceBindings } from './voice-binding-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * MW-B-001 ON REAL POSTGRESQL: A BACKEND TERMINATED UNDER A HELD CLIENT, IN THE MIDDLE OF A TRANSACTION.
 *
 * pg_terminate_backend ends the backend of the client a store holds between its BEGIN and its first write, which is what a
 * PostgreSQL restart does to every held client. Before the fix, pg emitted that client's 'error' with nobody listening: an
 * uncaught exception, so the bridge exited and signed every player out. Now the store hears it. The process lives, the social
 * route answers 503 with the store's retryable error, nothing is saved, and the next call saves. The same holds for the voice
 * bindings and the Wonderland store. The pool carries the bridge's own pool-level listener (server.ts juliusPool), which hears
 * only IDLE clients, and it must hear nothing here: the held client's listener is what heard the death.
 *
 * Each death is checked twice. `killed[].listeners` is how many 'error' listeners the dying client had once pg had emitted
 * every 'error' (read at its 'end'). `uncaught` is what process 'uncaughtException' saw. Without the fix, they are 0 and 1+
 * (and vitest reports the uncaught error, failing the run).
 *
 * Runs only where JULIUS_TEST_DATABASE_URL names a THROWAWAY server. Its own database is created here, migrated by the chain's
 * migrate(), and dropped after every pool on it has ended. `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

type Death = 'between-statements' | 'during-statement';

suite('MW-B-001 on real PostgreSQL: a backend terminated under a held client mid-transaction', () => {
  const nonce = randomBytes(5).toString('hex');
  const name = `wonderland_pgheld_${nonce}`;
  const KAI = `usr_kai_${nonce}`;
  const PUID = randomBytes(16).toString('hex');
  let admin: Pool;
  let pool: Pool;
  const poolErrors: string[] = [];
  const uncaught: string[] = [];
  const onUncaught = (error: unknown): void => { uncaught.push(error instanceof Error ? error.message : String(error)); };

  beforeAll(async () => {
    process.prependListener('uncaughtException', onUncaught);
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    // the bridge's pool-level listener (relay-bridge/server.ts juliusPool): it hears an IDLE client's death
    pool.on('error', (error) => { poolErrors.push(error.message); });
    await new TransactionalWonderlandDatabase(pool).migrate();
    await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [KAI]);
  }, 120_000);

  // END EVERY POOL BEFORE THE DROP. A pool being torn down gets an 'error' listener first: pool.end() resolves before its idle
  // clients have closed, and a forced drop that reaches one re-emits 57P01 on the pool (#347). The terminate is this suite's own.
  afterAll(async () => {
    process.removeListener('uncaughtException', onUncaught);
    if (pool !== undefined) {
      pool.on('error', () => undefined);
      await pool.end();
    }
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const terminate = async (pid: number): Promise<boolean> =>
    (await admin.query<{ ok: boolean }>('SELECT pg_terminate_backend($1) AS ok', [pid])).rows[0]?.ok === true;
  /** Until the backend runs the statement (pg_stat_activity says active), so the kill lands DURING it. */
  const untilActive = async (pid: number): Promise<boolean> => {
    for (let i = 0; i < 250; i += 1) {
      const row = await admin.query<{ state: string | null }>('SELECT state FROM pg_stat_activity WHERE pid = $1', [pid]);
      if (row.rows[0]?.state === 'active') return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

  /** One death, as it happened. Recorded, never asserted inside the store's call: a store's catch would swallow a failed expect. */
  interface Killed {
    readonly active: boolean;
    readonly terminated: boolean;
    /** How many 'error' listeners the dying client had, read at its 'end', after pg had emitted every 'error'. */
    readonly listeners: number;
    /** What the pg_sleep running when the backend died answered (during-statement only). */
    readonly sleeping: string | null;
  }

  /**
   * The pool a store is given: the real one, with ONE armed checkout instrumented. At the first statement after its BEGIN, that
   * client's backend is terminated, in one of two ways:
   *  - between-statements: terminated while idle in transaction. The statement is sent only after pg has emitted every 'error'
   *    for it (its 'end'), so it is refused as not queryable.
   *  - during-statement: a pg_sleep is sent ahead of the statement on the same backend and terminated while it runs. The
   *    statement, queued behind it, fails with the connection.
   */
  const instrumented = () => {
    let armed: Death | null = null;
    const killed: Killed[] = [];
    const wrapped = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client: PoolClient = await pool.connect();
        const death = armed;
        if (death === null) return client;
        armed = null;
        const original = client.query.bind(client) as (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
        const pid = Number((await original('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
        let begun = false;
        let fired = false;
        (client as unknown as { query: unknown }).query = async (sql: string, values?: unknown[]) => {
          if (fired || !begun) {
            if (sql.trim().startsWith('BEGIN')) begun = true;
            return original(sql, values);
          }
          fired = true;
          const ended = new Promise<void>((resolve) => { client.once('end', () => resolve()); });
          if (death === 'between-statements') {
            const terminated = await terminate(pid);
            await ended;
            killed.push({ active: false, terminated, listeners: client.listenerCount('error'), sleeping: null });
            return original(sql, values);
          }
          const sleeping = original('SELECT pg_sleep(30)').then(() => 'slept', (error: { code?: string }) => error.code ?? 'no code');
          const active = await untilActive(pid);
          const statement = original(sql, values);
          statement.catch(() => undefined); // it rejects at the socket's close, before it is returned to the store, which awaits it
          const terminated = await terminate(pid);
          await ended;
          killed.push({ active, terminated, listeners: client.listenerCount('error'), sleeping: await sleeping });
          return statement;
        };
        return client;
      },
    } as unknown as Pool;
    return { pool: wrapped, killed, arm: (death: Death) => { armed = death; } };
  };
  /** What a death of each kind must have recorded: the kill landed, and the held client was listening when pg emitted. */
  const heard = (death: Death): Killed[] => [death === 'between-statements'
    ? { active: false, terminated: true, listeners: 1, sleeping: null }
    : { active: true, terminated: true, listeners: 1, sleeping: '57P01' }];

  for (const death of ['between-statements', 'during-statement'] as const) {
    it(`the social store, killed ${death}: the bridge lives, the route answers 503 retryable, nothing is saved, and the next call saves`, async () => {
      const db = instrumented();
      const store = await openSocialPostgresStore(db.pool);
      const facts: SocialSessionFacts = { sessionId: `s-${death}`, participantId: KAI, issuedAtMs: Date.now(), capabilities: [NATIVE_SOCIAL_CAPABILITY] };
      const deps: SocialRouteDeps = {
        verifySession: (token) => (token === 'kai' ? facts : null),
        sessionIssuedAt: null,
        identify: async (id) => ({ userId: id, displayName: 'Kai', handle: `@kai_${nonce}` }),
        store,
      };
      const presence = async (availability: string) => {
        const result = await handleSocialRoute({ method: 'POST', path: '/wonderland/social/presence', authorization: 'Relay-Session kai', origin: undefined, body: { availability }, now: Date.now() }, deps);
        return result as { status: number; body: { error?: { kind: string } } };
      };
      const saved = async () => (await pool.query<{ availability: string }>('SELECT availability FROM relay_wonderland.social_presence WHERE player_id = $1', [KAI])).rows[0]?.availability;

      // healthy: the player's record exists and says AWAY
      expect((await presence('AWAY')).status).toBe(200);
      expect(await saved()).toBe('AWAY');

      db.arm(death);
      const refused = await presence('BUSY');
      expect(db.killed, 'the kill landed, and the held client had a listener when pg emitted its error').toEqual(heard(death));
      expect(uncaught, 'no uncaught exception: the process lives').toEqual([]);
      expect([refused.status, refused.body.error?.kind]).toEqual([503, 'stale-ledger-version']);
      expect(await saved(), 'the write that lost its connection saved nothing').toBe('AWAY');

      // THE NEXT CALL SAVES, on a fresh connection: the dead one was destroyed, and the pool is whole
      expect((await presence('BUSY')).status).toBe(200);
      expect(await saved()).toBe('BUSY');
      expect(poolErrors, 'the pool-level listener heard nothing: the held client was heard where it was held').toEqual([]);
    }, 60_000);
  }

  it('the voice bindings, killed between statements: bind throws (the voice route answers 503), then binds', async () => {
    const db = instrumented();
    const bindings = createPostgresVoiceBindings(db.pool);
    const bind = () => bindings.bind({ userId: KAI, puid: PUID, sessionId: 'sv', sessionIssuedAtIso: null, sessionIssuedAtOf: null, nowIso: new Date().toISOString() });
    db.arm('between-statements');
    await expect(bind()).rejects.toThrow();
    expect(db.killed).toEqual(heard('between-statements'));
    expect(uncaught).toEqual([]);
    expect(await bindings.bindingOf(KAI), 'nothing was bound').toBeNull();
    expect(await bind()).toBe('bound');
    expect(poolErrors).toEqual([]);
  }, 60_000);

  it('the Wonderland store, killed during a statement: the transaction throws and is not retried, then replays', async () => {
    const db = instrumented();
    const wonderland = new TransactionalWonderlandDatabase(db.pool);
    db.arm('during-statement');
    await expect(wonderland.replayEvents(`prj-${nonce}`, 0, 10)).rejects.toThrow();
    expect(db.killed).toEqual(heard('during-statement'));
    expect(uncaught).toEqual([]);
    expect(await wonderland.replayEvents(`prj-${nonce}`, 0, 10)).toEqual([]);
    expect(poolErrors).toEqual([]);
  }, 60_000);
});
