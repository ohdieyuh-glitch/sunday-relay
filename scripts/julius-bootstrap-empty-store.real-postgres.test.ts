import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { WONDERLAND_MIGRATIONS, migrationVersion } from '../src/relay/persistence/wonderland-postgres';
import { main } from './julius-bootstrap-empty-store';

/**
 * THE FIRST-TIME BOOTSTRAP OF AN EMPTY STORE, AGAINST REAL POSTGRESQL (migration 030 deploy, path R1).
 *
 * Each case is its OWN database on the THROWAWAY server JULIUS_TEST_DATABASE_URL names (never DATABASE_URL), created
 * and dropped here; `todo` elsewhere. The cases are the driver's whole contract: an EMPTY store bootstraps and the
 * ledger proves the chain in order; everything else is REFUSED with nothing written; a failure mid-chain is reported
 * as FAILED and PARTIAL, never as OK.
 */
const injected = vi.hoisted(() => ({ failAfter: null as number | null }));
vi.mock('./julius-live-preflight-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./julius-live-preflight-identity')>();
  return {
    ...actual,
    // The real migrateIfNeeded, except in the one case that injects a failure after N migrations committed.
    migrateIfNeeded: async (pool: Pool) => {
      if (injected.failAfter === null) return actual.migrateIfNeeded(pool);
      for (const sql of WONDERLAND_MIGRATIONS.slice(0, injected.failAfter)) await pool.query(sql);
      throw new Error(`injected failure after ${injected.failAfter} migrations`);
    },
  };
});

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const ROOT = resolve(__dirname, '..');
const VERSIONS = WONDERLAND_MIGRATIONS.map((sql) => migrationVersion(sql) as string);

suite('the EMPTY-store bootstrap against real PostgreSQL', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  let systemId: string;
  const made: string[] = [];

  const urlOf = (name: string): string => { const url = new URL(databaseUrl!); url.pathname = `/${name}`; return url.toString(); };
  const fresh = async (label: string): Promise<string> => {
    const name = `jboot${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    made.push(name);
    return name;
  };
  /** Runs SQL on a case database in a pool that is CLOSED again, so the driver's other-session gate sees nobody. */
  const onDb = async <T>(name: string, work: (pool: Pool) => Promise<T>): Promise<T> => {
    const pool = new Pool({ connectionString: urlOf(name), max: 1 });
    try { return await work(pool); } finally { await pool.end(); }
  };
  const bootstrap = async (name: string, overrides: { database?: string; systemId?: string } = {}) => {
    const lines: string[] = [];
    const code = await main(
      ['--expect-database', overrides.database ?? name, '--expect-system-identifier', overrides.systemId ?? systemId],
      { JULIUS_BOOTSTRAP_DATABASE_URL: urlOf(name) }, ROOT, (line) => lines.push(line));
    return { code, text: lines.join('\n') };
  };
  const hasSchema = (name: string) => onDb(name, async (pool) =>
    (await pool.query<{ present: boolean }>("SELECT to_regnamespace('relay_wonderland') IS NOT NULL AS present")).rows[0].present);
  const ledger = (name: string) => onDb(name, async (pool) =>
    (await pool.query<{ version: string; applied_at: string }>(
      'SELECT version, applied_at::text FROM relay_wonderland.schema_migrations ORDER BY applied_at, version')).rows);

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    systemId = (await admin.query<{ sid: string }>('SELECT system_identifier::text AS sid FROM pg_control_system()')).rows[0].sid;
  });
  afterAll(async () => {
    for (const name of made) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it('bootstraps an EMPTY store: BOOTSTRAP OK, the ledger is the build in order, and no row is written', async () => {
    const name = await fresh('ok');
    const result = await bootstrap(name);
    expect(result.code, result.text).toBe(0);
    expect(result.text).toMatch(/^BOOTSTRAP OK: \d+ migrations applied in order/mu);
    expect((await ledger(name)).map((row) => row.version)).toEqual(VERSIONS);
    const nonEmpty = await onDb(name, async (pool) => (await pool.query<{ t: string }>(`
      SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'relay_wonderland' AND table_type = 'BASE TABLE'
         AND table_name <> 'schema_migrations'
         AND (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text <> '0'`)).rows);
    expect(nonEmpty).toEqual([]);

    // A rerun touches nothing: refused as ALREADY INITIALIZED, the ledger byte-identical.
    const before = await ledger(name);
    const again = await bootstrap(name);
    expect(again.code, again.text).toBe(3);
    expect(again.text).toMatch(/^BOOTSTRAP REFUSED: ALREADY INITIALIZED .*; nothing written$/mu);
    expect(await ledger(name)).toEqual(before);
  }, 120_000);

  it('refuses the wrong store (database or system identifier) and writes nothing', async () => {
    const name = await fresh('who');
    const wrongId = await bootstrap(name, { systemId: '1' });
    expect(wrongId.code, wrongId.text).toBe(3);
    expect(wrongId.text).toMatch(/^BOOTSTRAP REFUSED: connected to .*, expected .*\/1; nothing written$/mu);
    const wrongDb = await bootstrap(name, { database: 'julius' });
    expect(wrongDb.code, wrongDb.text).toBe(3);
    expect(await hasSchema(name)).toBe(false);
  }, 60_000);

  it('refuses while another session is connected, and writes nothing', async () => {
    const name = await fresh('busy');
    const other = new Pool({ connectionString: urlOf(name), max: 1 });
    const held = await other.connect();
    try {
      const result = await bootstrap(name);
      expect(result.code, result.text).toBe(3);
      expect(result.text).toMatch(/^BOOTSTRAP REFUSED: 1 other session\(s\) on .*; stop every writer; nothing written$/mu);
    } finally { held.release(); await other.end(); }
    expect(await hasSchema(name)).toBe(false);
  }, 60_000);

  it('refuses a store that is not EMPTY: an object in public, or a PARTIAL chain', async () => {
    const stray = await fresh('stray');
    await onDb(stray, (pool) => pool.query('CREATE TABLE public.t(x int)'));
    const a = await bootstrap(stray);
    expect(a.code, a.text).toBe(3);
    expect(a.text).toMatch(/^BOOTSTRAP REFUSED: the store is not EMPTY: \d+ object\(s\) in public; nothing written$/mu);
    expect(await hasSchema(stray)).toBe(false);

    const partial = await fresh('partial');
    await onDb(partial, (pool) => pool.query(WONDERLAND_MIGRATIONS[0]));
    const b = await bootstrap(partial);
    expect(b.code, b.text).toBe(3);
    expect(b.text).toMatch(/^BOOTSTRAP REFUSED: the store is not EMPTY: schemas are \[public,relay_wonderland\], not \[public\]; schema relay_wonderland exists; a migration ledger exists; nothing written$/mu);
    expect(b.text).not.toMatch(/ALREADY INITIALIZED/u);
    expect((await ledger(partial)).map((row) => row.version)).toEqual([VERSIONS[0]]);
  }, 60_000);

  it('a failure mid-chain is FAILED and PARTIAL, never OK', async () => {
    const name = await fresh('fail');
    injected.failAfter = 15;
    try {
      const result = await bootstrap(name);
      expect(result.code, result.text).toBe(2);
      expect(result.text).toContain(`BOOTSTRAP FAILED at ${VERSIONS[15]}: 15 of ${VERSIONS.length} migrations committed; the store is PARTIAL and is not initialized.`);
      expect(result.text).not.toMatch(/^BOOTSTRAP OK/mu);
      expect(result.text).not.toMatch(/^BOOTSTRAP_RECORD/mu);
    } finally { injected.failAfter = null; }
    expect((await ledger(name)).map((row) => row.version)).toEqual(VERSIONS.slice(0, 15));
  }, 120_000);
});
