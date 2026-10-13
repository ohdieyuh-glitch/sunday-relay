import { describe, expect, it } from 'vitest';
import { MIGRATION_PINNED_STORES, migrationPinnedStoreRole, PROTECTED_STORES, ProtectedStoreMigrationRefused, protectedStoreRole, storeIdentitySha256 } from './protected-store';
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
  /** Only the Nth S1 catalog read (1-based) fails, 08006: the reads before it succeed. */
  readonly markerReadFailsOn?: number;
  /** Only the Nth system identifier read (1-based) fails, 08006. */
  readonly sidReadFailsOn?: number;
}

const brokenConnection = () => Object.assign(new Error('server closed the connection unexpectedly'), { code: '08006' });

class FakePool {
  readonly executed: string[] = [];
  /** EVERY statement this pool was asked to run, the ledger and identity reads included, in order. */
  readonly issued: string[] = [];
  private markerReads = 0;
  private sidReads = 0;
  constructor(private readonly s: FakeStore) {}
  connect(): void {
    throw new Error('not used');
  }
  async query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.issued.push(sql);
    if (sql.includes('information_schema.tables') && sql.includes('schema_migrations')) {
      return this.s.ledger === null ? { rows: [], rowCount: 0 } : { rows: [{ present: 1 }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT version FROM relay_wonderland.schema_migrations')) {
      const rows = (this.s.ledger ?? []).map((version) => ({ version }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('shobj_description')) {
      this.markerReads += 1;
      if (this.s.markerReadFails === true || this.markerReads === this.s.markerReadFailsOn) throw brokenConnection();
      return { rows: [{ c: this.s.marker ?? null }], rowCount: 1 };
    }
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: this.s.db }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) {
      this.sidReads += 1;
      if (this.sidReads === this.s.sidReadFailsOn) throw brokenConnection();
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

async function refusal(store: FakeStore, options?: Parameters<TransactionalWonderlandDatabase['migrate']>[0]): Promise<{ error: ProtectedStoreMigrationRefused; executed: string[]; issued: string[] }> {
  const { pool, database } = databaseOn(store);
  const error = await database.migrate(options).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ProtectedStoreMigrationRefused);
  if (!(error instanceof ProtectedStoreMigrationRefused)) throw new Error('not refused');
  expect(error.code).toBe('migration_refused_protected_store');
  return { error, executed: pool.executed, issued: pool.issued };
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

  it('an ordinary database (CI, a drill, a throwaway, a `railway` database of ANOTHER cluster) still migrates exactly what it lacks', async () => {
    expect(await migrated({ ledger: null, db: 'julius_ci_1234', sid: '7000000000000000001' })).toHaveLength(WONDERLAND_MIGRATIONS.length);
    expect(await migrated({ ledger: without(V035), db: 'railway', sid: '7111111111111111111' })).toEqual([WONDERLAND_MIGRATION_035]);
  });
});

/**
 * O1 (MW-B-005 / MW-X-005; MIGRATE_GUARD_O1_PROPOSAL.md option A): migrate() REFUSES the hosted Wonderland database too, by a
 * MIGRATION-ONLY pin, and executes nothing there; only its reviewed per-version windows migrate it. It is not a protected store:
 * protectedStoreRole never names it, so the social / voice writer guard keeps allowing it (protected-store-writer-guard.test.ts).
 * Same FakePool; each refusal has a control that differs in ONE fact and DOES migrate.
 */

/** O1's identity, from its bootstrap RECORD.json `.oids` (database `railway`, this system identifier). */
const O1_SID = '7695365722645385278';
const O1: FakeStore = { ledger: without(V035), db: 'railway', sid: O1_SID };
const O1_MARKER = 'relay-store-role=wonderland-o1';
/** A FakePool handed straight to an identity function (it answers only the statements those functions issue). */
const identityOf = (store: FakeStore) => new FakePool(store) as never;
/** Nothing but reads were issued (the ledger probe and the identity reads): no migration statement reached the pool. */
const onlyReads = (issued: readonly string[]): void => {
  expect(issued.length).toBeGreaterThan(0);
  expect(issued.filter((sql) => !/^SELECT\b/u.test(sql))).toEqual([]);
  expect(issued.filter((sql) => WONDERLAND_MIGRATIONS.includes(sql))).toEqual([]);
};

describe('O1: migrate() refuses the hosted Wonderland store (a migration-only pin) and executes nothing there', () => {
  it('the migration pin names O1: sha256("<its system identifier>/railway"), apart from the live pin, never in PROTECTED_STORES', () => {
    expect(MIGRATION_PINNED_STORES.map((s) => s.role)).toEqual(['wonderland-o1']);
    expect(MIGRATION_PINNED_STORES[0].identitySha256).toBe(storeIdentitySha256(O1_SID, 'railway'));
    expect(MIGRATION_PINNED_STORES[0].identitySha256).toBe('186bed84722c5dec6989a9920911848bd2e8ddd51b60027feeba21835ac2dfbf');
    // the two tables share no role and no identity
    const protectedKeys = new Set(PROTECTED_STORES.flatMap((s) => [s.role, s.identitySha256]));
    expect(MIGRATION_PINNED_STORES.filter((s) => protectedKeys.has(s.role) || protectedKeys.has(s.identitySha256))).toEqual([]);
  });

  it('O1-1: O1 at 034 is REFUSED 035 and no migration statement is issued (control: one digit off the sid migrates exactly 035)', async () => {
    const { error, executed, issued } = await refusal(O1);
    expect(error.storeRole).toBe('wonderland-o1');
    expect(error.missingVersions).toEqual([V035]);
    expect(executed).toEqual([]);
    onlyReads(issued);
    expect(await migrated({ ...O1, sid: '7695365722645385279' })).toEqual([WONDERLAND_MIGRATION_035]);
  });

  it("O1-2 (MW-X-005, the bulk case): O1 missing the chain's last THREE versions is REFUSED all three, and runs none of them", async () => {
    const lastThree = ALL.slice(-3); // 033, 034, 035 at this base; 035-037 once 036 / 037 land
    const behind: FakeStore = { ...O1, ledger: ALL.slice(0, -3) };
    const { error, executed, issued } = await refusal(behind);
    expect(error.storeRole).toBe('wonderland-o1');
    expect(error.missingVersions).toEqual(lastThree);
    expect(executed).toEqual([]);
    onlyReads(issued);
    // CONTROL: the same ledger on another cluster migrates exactly those three, in order
    expect(await migrated({ ...behind, sid: '7695365722645385279' })).toEqual(WONDERLAND_MIGRATIONS.slice(-3));
  });

  it('O1-3: O1 with nothing missing is never refused, and no identity is read (steady state)', async () => {
    const { pool, database } = databaseOn({ ...O1, ledger: ALL });
    await database.migrate();
    expect(pool.executed).toEqual([]);
    expect(pool.issued.filter((sql) => /shobj_description|pg_control_system|current_database/u.test(sql))).toEqual([]);
    expect(await migrated({ ...O1, ledger: ALL, sid: 'BROKEN', markerReadFails: true })).toEqual([]);
  });

  it('O1-4: per DATABASE, not per cluster: the O1 sid with another database name migrates; with `railway` it does not', async () => {
    expect(await migrated({ ...O1, db: 'railway_restore' })).toEqual([WONDERLAND_MIGRATION_035]);
    await refusal(O1);
  });

  it('O1-5 (S1): the O1 marker refuses on its own (sid denied, or a NEW cluster), parsed exactly; without it the same store migrates', async () => {
    const NEW_SID = '7999999999999999999';
    const stores: readonly FakeStore[] = [
      { ...O1, sid: 'DENIED' },
      { ...O1, sid: NEW_SID },
      { ...O1, db: 'railway_restored', sid: NEW_SID },
    ];
    for (const store of stores) {
      const { error, executed } = await refusal({ ...store, marker: O1_MARKER });
      expect(error.storeRole).toBe('wonderland-o1');
      expect(executed).toEqual([]);
      // CONTROL: the same store without the marker (S2 misses or is unreadable; there is no name rule for `railway`)
      expect(await migrated(store)).toEqual([WONDERLAND_MIGRATION_035]);
      // CONTROL: an exact token, not a prefix
      expect(await migrated({ ...store, marker: 'relay-store-role=wonderland-o1x' })).toEqual([WONDERLAND_MIGRATION_035]);
    }
    // the marker is found inside a longer comment, as a whole token
    await refusal({ ...O1, sid: 'DENIED', marker: `Wonderland hosted store (O1) ${O1_MARKER}` });
  });

  it('O1-6 (the separation): protectedStoreRole never names O1, and the migration pin never names the live store', async () => {
    const o1Stores: readonly FakeStore[] = [O1, { ...O1, sid: 'DENIED', marker: O1_MARKER }];
    for (const store of o1Stores) {
      expect(await protectedStoreRole(identityOf(store))).toBeNull();
      expect(await migrationPinnedStoreRole(identityOf(store))).toBe('wonderland-o1');
    }
    const liveStores: readonly FakeStore[] = [
      { ledger: without(V035), db: 'julius', sid: LIVE_SID },
      { ledger: without(V035), db: 'julius', sid: 'DENIED' },
      { ledger: without(V035), db: 'julius_restored', sid: '7999999999999999999', marker: 'relay-store-role=julius-live' },
    ];
    for (const store of liveStores) {
      expect(await protectedStoreRole(identityOf(store))).toBe('julius-live');
      expect(await migrationPinnedStoreRole(identityOf(store))).toBeNull();
    }
  });

  it('O1-7 (MINOR-1 parity): a FAILED read in the migration pin is an error, never "not pinned" -- nothing executes', async () => {
    const failedWith08006 = async (call: Promise<unknown>): Promise<void> => {
      const error = await call.then(() => null, (e: unknown) => e);
      expect((error as { code?: unknown } | null)?.code).toBe('08006');
    };
    await failedWith08006(migrationPinnedStoreRole(identityOf({ ...O1, markerReadFails: true })));
    await failedWith08006(migrationPinnedStoreRole(identityOf({ ...O1, sid: 'BROKEN' })));
    // through migrate(): protectedStoreRole's own reads succeed, and the pin's read (the SECOND of its kind) fails
    const stores: readonly FakeStore[] = [
      // a store whose ONLY protection is the O1 marker (a new cluster, a new name): the pin's catalog read fails
      { ...O1, db: 'railway_restored', sid: '7999999999999999999', marker: O1_MARKER, markerReadFailsOn: 2 },
      // O1 by its identity alone: the pin's system identifier read fails
      { ...O1, sidReadFailsOn: 2 },
    ];
    for (const store of stores) {
      const { pool, database } = databaseOn(store);
      await failedWith08006(database.migrate());
      expect(pool.executed).toEqual([]);
    }
    // CONTROL: privilege (42501) is the one failure that means "unreadable": the pin abstains (no name rule for `railway`)
    expect(await migrationPinnedStoreRole(identityOf({ ...O1, sid: 'DENIED' }))).toBeNull();
    expect(await migrated({ ...O1, sid: 'DENIED' })).toEqual([WONDERLAND_MIGRATION_035]);
  });

  it('O1-8: the reviewed-bootstrap override naming O1 does not open a NON-empty O1: it is for a verified EMPTY store only', async () => {
    const { executed } = await refusal(O1, { reviewedBootstrap: { database: 'railway', systemIdentifier: O1_SID } });
    expect(executed).toEqual([]);
  });

  it('the Julius live store is refused exactly as before: same role, same message, and the migration pin is never asked', async () => {
    const { error, executed, issued } = await refusal({ ledger: without(V035), db: 'julius', sid: LIVE_SID });
    expect(error.storeRole).toBe('julius-live');
    expect(error.message).toBe(new ProtectedStoreMigrationRefused('julius-live', [V035]).message);
    expect(executed).toEqual([]);
    // ONE catalog read and ONE system identifier read, protectedStoreRole's: the migration pin never ran
    expect(issued.filter((sql) => sql.includes('shobj_description'))).toHaveLength(1);
    expect(issued.filter((sql) => sql.includes('pg_control_system()'))).toHaveLength(1);
  });
});
