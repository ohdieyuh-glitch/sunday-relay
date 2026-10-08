import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { migrationVersion, TransactionalWonderlandDatabase, WONDERLAND_MIGRATION_LOCK, WONDERLAND_MIGRATIONS } from './wonderland-postgres';

/**
 * ONE MIGRATOR AT A TIME, PER DATABASE.
 *
 * Every real-PostgreSQL suite migrates the database it is handed, and CI runs
 * them in parallel against ONE database. They only ever met a migrated store
 * there because the single-suite steps before that wave had migrated it first:
 * an ordering nobody wrote down. Pointed at an EMPTY store, two of them both saw
 * the schema missing and both ran 001's `CREATE SCHEMA IF NOT EXISTS`, which is
 * not safe against a concurrent creator: PostgreSQL refused the second at its
 * catalog (`pg_namespace_nspname_index`). These cases hold `migrate()` to
 * serialising itself, so no caller has to know who else is migrating.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const CHAIN = WONDERLAND_MIGRATIONS.map((sql) => migrationVersion(sql)).filter((version): version is string => version !== null);

suite('migrate() on one database, from many sessions at once', () => {
  const nonce = randomBytes(4).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pools: Pool[] }> = [];

  /** A fresh, EMPTY database, and `count` pools on it, so every migrator is its own session. */
  const fresh = async (label: string, count: number): Promise<Pool[]> => {
    const name = `wmigrate${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pools = Array.from({ length: count }, () => {
      const pool = new Pool({ connectionString: url.toString(), max: 2 });
      pool.on('error', () => undefined);
      return pool;
    });
    made.push({ name, pools });
    return pools;
  };
  const ledger = async (pool: Pool): Promise<string[]> => [...await new TransactionalWonderlandDatabase(pool).appliedMigrationVersions()].sort();

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl!, max: 2 }); });
  afterAll(async () => {
    for (const { name, pools } of made) {
      for (const pool of pools) await pool.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    }
    await admin?.end();
  }, 60_000);

  it('eight sessions migrating one EMPTY database at once all succeed, and the chain is applied exactly once', async () => {
    const pools = await fresh('race', 8);
    const outcomes = await Promise.allSettled(pools.map((pool) => new TransactionalWonderlandDatabase(pool).migrate()));
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => String((outcome as PromiseRejectedResult).reason));
    expect(refused, 'no migrator was refused by the catalog').toEqual([]);
    expect(await ledger(pools[0]!)).toEqual([...CHAIN].sort());
    const stamps = await pools[0]!.query<{ n: string }>('SELECT count(*)::text AS n FROM relay_wonderland.schema_migrations');
    expect(Number(stamps.rows[0]!.n), 'each stamp once').toBe(CHAIN.length);
  }, 120_000);

  it('a migrator waits for the one holding the lock, then finds nothing left to do', async () => {
    const [holder, waiter] = await fresh('wait', 2);
    // Someone else is migrating: they hold the lock on their own session.
    const held = await holder!.connect();
    await held.query('SELECT pg_advisory_lock($1)', [WONDERLAND_MIGRATION_LOCK]);
    let finished = false;
    const waiting = new TransactionalWonderlandDatabase(waiter!).migrate().then(() => { finished = true; });
    await new Promise((done) => setTimeout(done, 500));
    expect(finished, 'it waited').toBe(false);
    expect(await ledger(waiter!), 'and wrote nothing while it waited').toEqual([]);
    // The other migrator completes the chain, then lets go.
    for (const sql of WONDERLAND_MIGRATIONS) await held.query(sql);
    await held.query('SELECT pg_advisory_unlock($1)', [WONDERLAND_MIGRATION_LOCK]);
    held.release();
    await waiting;
    expect(finished).toBe(true);
    expect(await ledger(waiter!)).toEqual([...CHAIN].sort());
  }, 120_000);

  it('a migrator whose migration fails lets the lock go with its session, so the next one is not stranded', async () => {
    const [first, second] = await fresh('fail', 2);
    // A store a failing migration will meet: the ledger exists, and a table the first migration creates is in the way.
    await first!.query('CREATE SCHEMA relay_wonderland');
    await first!.query("CREATE TABLE relay_wonderland.players(not_the_column_001_creates int)");
    await expect(new TransactionalWonderlandDatabase(first!).migrate()).rejects.toBeDefined();
    // The lock did not outlive the failure: another session takes it at once.
    const probe = await second!.connect();
    try {
      const taken = await probe.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [WONDERLAND_MIGRATION_LOCK]);
      expect(taken.rows[0]!.ok).toBe(true);
      await probe.query('SELECT pg_advisory_unlock($1)', [WONDERLAND_MIGRATION_LOCK]);
    } finally {
      probe.release();
    }
  }, 120_000);
});
