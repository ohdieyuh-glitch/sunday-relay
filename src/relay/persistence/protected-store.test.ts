import { describe, expect, it } from 'vitest';
import { PROTECTED_STORES, ProtectedStoreMigrationRefused, storeIdentitySha256 } from './protected-store';
import { migrationVersion, TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_035 } from './wonderland-postgres';

/**
 * G1 (the founder, 2026-10-11: a code guard inside #346): migrate() REFUSES the Julius live store and executes nothing there,
 * whatever entry point calls it; every other database migrates as before. A fake pool answers the identity queries and records
 * every statement that is not one of them -- i.e. every migration that would have run. Each refusal case has a control that
 * differs in ONE fact and DOES migrate, so no test passes for a guard that simply refuses everything.
 */

/** The Julius live store's identity (its own apply records: database `julius`, this system identifier). */
const LIVE_SID = '7684592472855232550';
const ALL = WONDERLAND_MIGRATIONS.map((sql) => migrationVersion(sql) as string);
const V035 = migrationVersion(WONDERLAND_MIGRATION_035) as string;

interface FakeStore {
  readonly ledger: readonly string[] | null; // null = no ledger table (an EMPTY store)
  readonly db: string;
  readonly sid: string | 'DENIED';
  readonly marker?: string | null;
}

class FakePool {
  readonly executed: string[] = [];
  constructor(private readonly s: FakeStore) {}
  connect(): void {
    throw new Error('not used');
  }
  async query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    if (sql.includes('information_schema.tables') && sql.includes('schema_migrations')) {
      return this.s.ledger === null ? { rows: [], rowCount: 0 } : { rows: [{ present: 1 }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT version FROM relay_wonderland.schema_migrations')) {
      const rows = (this.s.ledger ?? []).map((version) => ({ version }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('shobj_description')) return { rows: [{ c: this.s.marker ?? null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: this.s.db }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) {
      if (this.s.sid === 'DENIED') throw Object.assign(new Error('permission denied for function pg_control_system'), { code: '42501' });
      return { rows: [{ sid: this.s.sid }], rowCount: 1 };
    }
    this.executed.push(sql);
    return { rows: [], rowCount: 0 };
  }
}

const databaseOn = (store: FakeStore) => {
  const pool = new FakePool(store);
  return { pool, database: new TransactionalWonderlandDatabase(pool as never) };
};
const without = (version: string) => ALL.filter((v) => v !== version);

async function refusal(store: FakeStore, options?: Parameters<TransactionalWonderlandDatabase['migrate']>[0]): Promise<{ error: ProtectedStoreMigrationRefused; executed: string[] }> {
  const { pool, database } = databaseOn(store);
  const error = await database.migrate(options).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ProtectedStoreMigrationRefused);
  if (!(error instanceof ProtectedStoreMigrationRefused)) throw new Error('not refused');
  expect(error.code).toBe('migration_refused_protected_store');
  return { error, executed: pool.executed };
}

async function migrated(store: FakeStore, options?: Parameters<TransactionalWonderlandDatabase['migrate']>[0]): Promise<string[]> {
  const { pool, database } = databaseOn(store);
  await database.migrate(options);
  return pool.executed;
}

describe('G1: migrate() refuses the Julius live store and executes nothing there', () => {
  it('the pin names the live store: sha256("<its system identifier>/julius")', () => {
    expect(PROTECTED_STORES.map((s) => s.role)).toEqual(['julius-live']);
    expect(PROTECTED_STORES[0].identitySha256).toBe(storeIdentitySha256(LIVE_SID, 'julius'));
  });

  it('T1: the live store at 034 is REFUSED 035, and nothing is executed (control: one digit off migrates exactly 035)', async () => {
    const { error, executed } = await refusal({ ledger: without(V035), db: 'julius', sid: LIVE_SID });
    expect(error.storeRole).toBe('julius-live');
    expect(error.missingVersions).toEqual([V035]);
    expect(executed).toEqual([]);
    const control = await migrated({ ledger: without(V035), db: 'julius', sid: '7684592472855232551' });
    expect(control).toEqual([WONDERLAND_MIGRATION_035]);
  });

  it('T2: a protected store with nothing missing is never refused (steady state); one version missing is', async () => {
    expect(await migrated({ ledger: ALL, db: 'julius', sid: LIVE_SID })).toEqual([]);
    await refusal({ ledger: without(ALL[10]), db: 'julius', sid: LIVE_SID });
  });

  it('T3: per DATABASE, not per cluster: the live sid with another database name migrates; with `julius` it does not', async () => {
    expect(await migrated({ ledger: without(V035), db: 'julius_suites', sid: LIVE_SID })).toEqual([WONDERLAND_MIGRATION_035]);
    await refusal({ ledger: without(V035), db: 'julius', sid: LIVE_SID });
  });

  it('T4 (S3): a role that may not read the system identifier is still refused on a database named `julius`; the hosted name is not', async () => {
    await refusal({ ledger: without(V035), db: 'julius', sid: 'DENIED' });
    expect(await migrated({ ledger: without(V035), db: 'railway', sid: 'DENIED' })).toEqual([WONDERLAND_MIGRATION_035]);
  });

  it('T4 (S1): the catalog marker protects on its own, and is parsed exactly', async () => {
    await refusal({ ledger: without(V035), db: 'railway', sid: 'DENIED', marker: 'relay-store-role=julius-live' });
    expect(await migrated({ ledger: without(V035), db: 'railway', sid: 'DENIED', marker: 'relay-store-role=julius-livex' })).toEqual([WONDERLAND_MIGRATION_035]);
    expect(await migrated({ ledger: without(V035), db: 'railway', sid: 'DENIED', marker: 'relay-store-role=wonderland-hosted' })).toEqual([WONDERLAND_MIGRATION_035]);
  });

  it('T7: the reviewed bootstrap of an EMPTY live store migrates the whole chain -- and the override does nothing anywhere else', async () => {
    const reviewed = { reviewedBootstrap: { database: 'julius', systemIdentifier: LIVE_SID } };
    expect(await migrated({ ledger: null, db: 'julius', sid: LIVE_SID }, reviewed)).toHaveLength(WONDERLAND_MIGRATIONS.length);
    // no override: an empty live store through any ordinary entry point is refused
    await refusal({ ledger: null, db: 'julius', sid: LIVE_SID });
    // an override naming another identity is refused
    await refusal({ ledger: null, db: 'julius', sid: LIVE_SID }, { reviewedBootstrap: { database: 'julius', systemIdentifier: '1' } });
    // an override on a NON-empty store is refused: it is for a verified EMPTY store only
    const { executed } = await refusal({ ledger: without(V035), db: 'julius', sid: LIVE_SID }, reviewed);
    expect(executed).toEqual([]);
    // an override with the identity unreadable is refused: it cannot be matched
    await refusal({ ledger: null, db: 'julius', sid: 'DENIED' }, reviewed);
  });

  it('an ordinary database (CI, a drill, a throwaway, the hosted store) still migrates exactly what it lacks', async () => {
    expect(await migrated({ ledger: null, db: 'julius_ci_1234', sid: '7000000000000000001' })).toHaveLength(WONDERLAND_MIGRATIONS.length);
    expect(await migrated({ ledger: without(V035), db: 'railway', sid: '7111111111111111111' })).toEqual([WONDERLAND_MIGRATION_035]);
  });
});
