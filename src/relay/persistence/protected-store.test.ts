import { describe, expect, it } from 'vitest';
import { PROTECTED_STORES, ProtectedStoreMigrationRefused, storeIdentitySha256 } from './protected-store';
import { migrationVersion, TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_035, WONDERLAND_MIGRATION_036, WONDERLAND_MIGRATION_037 } from './wonderland-postgres';

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
  /** DENIED = this role may not read it (42501); BROKEN = the read fails for another reason (a dropped connection, 08006). */
  readonly sid: string | 'DENIED' | 'BROKEN';
  readonly marker?: string | null;
  /** The S1 catalog read fails (a dropped connection, 08006). */
  readonly markerReadFails?: boolean;
}

const brokenConnection = () => Object.assign(new Error('server closed the connection unexpectedly'), { code: '08006' });

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
    if (sql.includes('shobj_description')) {
      if (this.s.markerReadFails === true) throw brokenConnection();
      return { rows: [{ c: this.s.marker ?? null }], rowCount: 1 };
    }
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: this.s.db }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) {
      if (this.s.sid === 'DENIED') throw Object.assign(new Error('permission denied for function pg_control_system'), { code: '42501' });
      if (this.s.sid === 'BROKEN') throw brokenConnection();
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

  it('C1 (restore): the live store restored into a NEW cluster (a new sid) or under a new name is refused by its marker alone; without the marker it is not, the gap the marker closes', async () => {
    const NEW_SID = '7999999999999999999';
    for (const db of ['julius', 'julius_restored']) {
      const restored: FakeStore = { ledger: without(V035), db, sid: NEW_SID };
      const { executed } = await refusal({ ...restored, marker: 'relay-store-role=julius-live' });
      expect(executed).toEqual([]);
      // CONTROL: the same restore without its marker. S2 misses (a new sid, or a new name), and S3 needs the sid unreadable.
      expect(await migrated(restored)).toEqual([WONDERLAND_MIGRATION_035]);
    }
    // the marker is found inside a longer comment, as a whole token
    await refusal({ ledger: without(V035), db: 'julius', sid: NEW_SID, marker: 'Julius live store (restored 2026-10-11) relay-store-role=julius-live' });
  });

  it('MINOR-1: a FAILED identity read is an error, never "not protected" -- nothing executes (CONTROL: a privilege denial still lets S3 decide)', async () => {
    const failed = async (store: FakeStore): Promise<void> => {
      const { pool, database } = databaseOn(store);
      const error = await database.migrate().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: unknown }).code).toBe('08006');
      expect(pool.executed).toEqual([]);
    };
    // the marker read fails on a store whose ONLY protection is its marker (restored into a new cluster under a new name)
    await failed({ ledger: without(V035), db: 'julius_restored', sid: '7999999999999999999', marker: 'relay-store-role=julius-live', markerReadFails: true });
    // ... and on an ordinary store: the failure surfaces, it is not read as "unmarked"
    await failed({ ledger: without(V035), db: 'railway', sid: '7000000000000000001', markerReadFails: true });
    // the system identifier read fails for a reason OTHER than privilege, in an ordinary run and in the bootstrap's re-read
    await failed({ ledger: without(V035), db: 'railway', sid: 'BROKEN' });
    {
      const { pool, database } = databaseOn({ ledger: null, db: 'julius', sid: 'BROKEN' });
      const error = await database.migrate({ reviewedBootstrap: { database: 'julius', systemIdentifier: LIVE_SID } }).then(() => null, (e: unknown) => e);
      expect((error as { code?: unknown }).code).toBe('08006');
      expect(pool.executed).toEqual([]);
    }
    // a database with no name is an error too, not a store that matches nothing
    {
      const { pool, database } = databaseOn({ ledger: without(V035), db: '', sid: '7000000000000000001' });
      const error = await database.migrate().then(() => null, (e: unknown) => e);
      expect(String(error)).toContain('current_database() returned no name');
      expect(pool.executed).toEqual([]);
    }
    // CONTROL: privilege (42501) is the one failure that means "unreadable"; S3 then decides by the name
    expect(await migrated({ ledger: without(V035), db: 'railway', sid: 'DENIED' })).toEqual([WONDERLAND_MIGRATION_035]);
    await refusal({ ledger: without(V035), db: 'julius', sid: 'DENIED' });
    // the steady state reads nothing, so it cannot fail this way
    expect(await migrated({ ledger: ALL, db: 'railway', sid: 'BROKEN', markerReadFails: true })).toEqual([]);
  });

  it('036 (WonderFS): the live store at 035 is REFUSED 036 and nothing is executed, by pin, by marker after a restore, and by name; CONTROL: an ordinary database at 035 migrates exactly 036 and what follows it', async () => {
    const V036 = migrationVersion(WONDERLAND_MIGRATION_036) as string;
    const V037 = migrationVersion(WONDERLAND_MIGRATION_037) as string;
    const at035 = ALL.filter((v) => v !== V036 && v !== V037);
    for (const live of [
      { ledger: at035, db: 'julius', sid: LIVE_SID },
      { ledger: at035, db: 'julius_restored', sid: '7999999999999999999', marker: 'relay-store-role=julius-live' },
      { ledger: at035, db: 'julius', sid: 'DENIED' as const },
    ]) {
      const { error, executed } = await refusal(live);
      expect(error.missingVersions).toEqual([V036, V037]);
      expect(executed).toEqual([]);
    }
    expect(await migrated({ ledger: at035, db: 'railway', sid: '7000000000000000001' })).toEqual([WONDERLAND_MIGRATION_036, WONDERLAND_MIGRATION_037]);
  });

  it('037 (LFF): the live store at 036 is REFUSED 037 and nothing is executed, by pin, by marker after a restore, and by name; CONTROL: an ordinary database at 036 migrates exactly 037', async () => {
    const V037 = migrationVersion(WONDERLAND_MIGRATION_037) as string;
    const at036 = without(V037);
    for (const live of [
      { ledger: at036, db: 'julius', sid: LIVE_SID },
      { ledger: at036, db: 'julius_restored', sid: '7999999999999999999', marker: 'relay-store-role=julius-live' },
      { ledger: at036, db: 'julius', sid: 'DENIED' as const },
    ]) {
      const { error, executed } = await refusal(live);
      expect(error.missingVersions).toEqual([V037]);
      expect(executed).toEqual([]);
    }
    expect(await migrated({ ledger: at036, db: 'railway', sid: '7000000000000000001' })).toEqual([WONDERLAND_MIGRATION_037]);
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
