import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { JULIUS_BRAIN_CAS_PREFIX } from '../src/relay/persistence/julius-brain-content-store';
import { PostgresJuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-postgres';
import { juliusPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';

/**
 * THE DEDICATED PROJECT BRAIN DATABASE ON A REAL POSTGRESQL: dedicated,
 * identified, current, concurrently migratable, and holding artifact bytes it
 * will not serve if they no longer hash to their key. `JULIUS_REAL_POSTGRES=1`
 * with `DATABASE_URL` (a server this test may create databases on); todo
 * otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;

const CHAIN = ['001_julius_brain_ledger', '002_julius_brain_python_executions', '003_julius_brain_content', '004_julius_brain_immutability'];

async function freshDatabase(label: string): Promise<string> {
  const name = `jbdb${label}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withPool<T>(url: string, effect: (pool: Pool) => Promise<T>, max = 4): Promise<T> {
  const pool = new Pool({ connectionString: url, max });
  try { return await effect(pool); } finally { await pool.end(); }
}

suite('the dedicated Project Brain database', () => {
  it('migrates once, fixes its environment, and refuses every other environment', async () => {
    const url = await freshDatabase('env');
    await withPool(url, async (pool) => {
      await expect(assertJuliusBrainDatabase(pool, { environment: 'development' })).rejects.toThrow('julius_brain_database_not_migrated');
      const first = await migrateJuliusBrainDatabase(pool, { environment: 'development' });
      expect(first).toMatchObject({ environment: 'development', applied: CHAIN, migrations: CHAIN });
      expect(await migrateJuliusBrainDatabase(pool, { environment: 'development' })).toMatchObject({ databaseId: first.databaseId, applied: [] });
      expect(await assertJuliusBrainDatabase(pool, { environment: 'development' })).toEqual({ databaseId: first.databaseId, environment: 'development', migrations: CHAIN });
      // Configuration for another environment cannot open this Brain.
      await expect(assertJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_environment_mismatch:development');
      await expect(migrateJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_environment_mismatch:development');
      expect((await pool.query('SELECT count(*)::int AS n FROM julius_brain.database_identity')).rows[0].n).toBe(1);
    });
  }, 120_000);

  it('refuses a database that also holds the Julius runtime schema', async () => {
    const url = await freshDatabase('shared');
    await withPool(url, async (pool) => {
      await pool.query('CREATE SCHEMA relay_wonderland');
      await expect(migrateJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_not_dedicated');
      expect((await pool.query("SELECT 1 FROM information_schema.schemata WHERE schema_name='julius_brain'")).rowCount).toBe(0);
    });
    // And a Brain database that later acquires one is refused on use.
    const later = await freshDatabase('later');
    await withPool(later, async (pool) => {
      await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      await pool.query('CREATE SCHEMA relay_wonderland');
      await expect(assertJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_not_dedicated');
    });
  }, 120_000);

  it('refuses a database with pending migrations on use, and one migrated by newer code on use and on migrate', async () => {
    const url = await freshDatabase('versions');
    await withPool(url, async (pool) => {
      await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      await pool.query("DELETE FROM julius_brain.schema_migrations WHERE version='003_julius_brain_content'");
      await pool.query('DROP TABLE julius_brain.content');
      await expect(assertJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_migrations_pending:003_julius_brain_content');
      expect(await migrateJuliusBrainDatabase(pool, { environment: 'test' })).toMatchObject({ applied: ['003_julius_brain_content'] });

      await pool.query("INSERT INTO julius_brain.schema_migrations(version) VALUES('099_from_the_future')");
      await expect(assertJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_newer_than_code:099_from_the_future');
      await expect(migrateJuliusBrainDatabase(pool, { environment: 'test' })).rejects.toThrow('julius_brain_database_newer_than_code:099_from_the_future');
    });
  }, 120_000);

  it('history cannot be changed through SQL: no update, delete or truncate of records, links or bytes, and no head rollback', async () => {
    const url = await freshDatabase('immutable');
    await withPool(url, async (pool) => {
      await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      const store = new JuliusBrainPostgresStore(pool);
      const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
      const JULIUS = juliusPrincipal('JULIUS', 'julius');
      await service.initialize({ brainId: 'brain:prj-immutable', projectId: 'prj-immutable', title: 'Immutable', principal: JULIUS });
      const julius = (await service.open({ brainId: 'brain:prj-immutable', projectId: 'prj-immutable', principal: JULIUS }))!;
      const first = await julius.create('CONSTRAINT', { statement: 'one', status: 'ACTIVE' }, { key: 'one', scope: { missionId: 'mission:x' } });
      if (first.outcome !== 'COMMITTED') throw new Error(first.detail);
      await julius.create('DECISION', { decisionClass: 'MISSION', statement: 'two', rationale: 'because', alternatives: [], status: 'ACTIVE' }, {
        key: 'two', scope: { missionId: 'mission:x' }, links: [{ relation: 'RELATES_TO', target: first.receipts[0]!.entityId, targetVersion: null }],
      });
      const refused = async (sql: string, message: string) => expect(pool.query(sql)).rejects.toThrow(message);
      await refused("UPDATE julius_brain.records SET kind='FINDING'", 'julius_brain_immutable: UPDATE on records');
      await refused('DELETE FROM julius_brain.records', 'julius_brain_immutable: DELETE on records');
      await refused('TRUNCATE julius_brain.records CASCADE', 'julius_brain_immutable');
      await refused("UPDATE julius_brain.links SET relation='SUPPORTS'", 'julius_brain_immutable: UPDATE on links');
      await refused('DELETE FROM julius_brain.links', 'julius_brain_immutable: DELETE on links');
      await refused('DELETE FROM julius_brain.entities', 'julius_brain_immutable: DELETE on entities');
      await refused('DELETE FROM julius_brain.brains', 'julius_brain_immutable: DELETE on brains');
      await refused('DELETE FROM julius_brain.projects', 'julius_brain_immutable: DELETE on projects');
      await refused('UPDATE julius_brain.brains SET head_sequence=head_sequence-1', 'a Brain head never moves backwards');
      await refused(`UPDATE julius_brain.brains SET identity=jsonb_set(identity,'{title}','"renamed"')`, 'a Brain identity never changes');
      // What the store itself does still works, and the ledger still verifies.
      expect((await julius.create('CONSTRAINT', { statement: 'three', status: 'ACTIVE' }, { key: 'three', scope: { missionId: 'mission:x' } })).outcome).toBe('COMMITTED');
      expect((await julius.verify()).ok).toBe(true);
      expect((await store.head('brain:prj-immutable', 'prj-immutable'))!.sequence).toBe(3);
    });
  }, 120_000);

  it('production refuses an unencrypted connection for migration and for use; an encrypted one is accepted', async () => {
    const url = await freshDatabase('tls');
    // Plain TCP to a server that also offers TLS.
    await withPool(url, async (plain) => {
      expect((await plain.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')).rows[0]?.ssl).toBe(false);
      await expect(migrateJuliusBrainDatabase(plain, { environment: 'production' })).rejects.toThrow('julius_brain_database_connection_not_encrypted');
      await expect(migrateJuliusBrainDatabase(plain, { environment: 'production', requireTls: false })).rejects.toThrow('julius_brain_database_connection_not_encrypted');
      expect((await plain.query("SELECT 1 FROM information_schema.schemata WHERE schema_name='julius_brain'")).rowCount).toBe(0);
    });
    // TLS negotiated. (The development certificate is self-signed; verifying the server's identity is deployment configuration.)
    const tls = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
    try {
      const negotiated = (await tls.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')).rows[0]?.ssl;
      if (negotiated !== true) throw new Error('this server did not negotiate TLS; enable ssl on the development instance to run this proof');
      expect(await migrateJuliusBrainDatabase(tls, { environment: 'production' })).toMatchObject({ environment: 'production', applied: CHAIN });
      expect(await assertJuliusBrainDatabase(tls, { environment: 'production' })).toMatchObject({ environment: 'production', migrations: CHAIN });
      // Development configuration cannot open the production Brain.
      await expect(assertJuliusBrainDatabase(tls, { environment: 'development' })).rejects.toThrow('julius_brain_database_environment_mismatch:production');
    } finally { await tls.end(); }
    await withPool(url, async (plain) => {
      await expect(assertJuliusBrainDatabase(plain, { environment: 'production', requireTls: false })).rejects.toThrow('julius_brain_database_connection_not_encrypted');
      await expect(assertJuliusBrainDatabase(plain, { environment: 'test', requireTls: true })).rejects.toThrow('julius_brain_database_connection_not_encrypted');
    });
  }, 120_000);

  it('processes that start together apply each migration exactly once', async () => {
    const url = await freshDatabase('race');
    const pools = Array.from({ length: 5 }, () => new Pool({ connectionString: url, max: 1 }));
    try {
      const results = await Promise.all(pools.map((pool) => migrateJuliusBrainDatabase(pool, { environment: 'test' })));
      expect(new Set(results.map((result) => result.databaseId)).size).toBe(1);
      expect(results.map((result) => result.applied.length).sort()).toEqual([0, 0, 0, 0, CHAIN.length]);
      expect((await pools[0]!.query('SELECT count(*)::int AS n FROM julius_brain.schema_migrations')).rows[0].n).toBe(CHAIN.length);
    } finally { await Promise.all(pools.map((pool) => pool.end())); }
  }, 120_000);

  it('artifact bytes: content addressed, deduplicated, and never served once they stop matching their hash', async () => {
    const url = await freshDatabase('content');
    await withPool(url, async (pool) => {
      await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      const content = new PostgresJuliusBrainContentStore(pool);
      const bytes = new TextEncoder().encode('{"archive":"paid run 34739303313"}');
      const hex = createHash('sha256').update(bytes).digest('hex');
      const stored = await content.put(bytes);
      expect(stored).toEqual({ contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `${JULIUS_BRAIN_CAS_PREFIX}${hex}` });
      expect(await content.put(bytes)).toEqual(stored);
      expect((await pool.query('SELECT count(*)::int AS n FROM julius_brain.content')).rows[0].n).toBe(1);
      expect(new TextDecoder().decode((await content.get(stored.storageRef))!)).toBe('{"archive":"paid run 34739303313"}');
      expect(await content.resolve(stored.storageRef, stored.contentHash)).toEqual({ status: 'RESOLVED', byteSize: bytes.byteLength });
      expect(await content.resolve(`${JULIUS_BRAIN_CAS_PREFIX}${'0'.repeat(64)}`, `sha256:${'0'.repeat(64)}`)).toEqual({ status: 'MISSING' });
      expect(await content.resolve('archive-ref:34739303313/1/art-plan', stored.contentHash)).toEqual({ status: 'UNSUPPORTED_REF' });

      // The database refuses to alter stored bytes…
      const alter = "UPDATE julius_brain.content SET bytes=overlay(bytes placing '\\x58'::bytea from 3) WHERE content_hash=$1";
      await expect(pool.query(alter, [stored.contentHash])).rejects.toThrow('julius_brain_immutable: UPDATE on content');
      // …and if storage is corrupted beneath it anyway (an owner disabling the guard stands in for that), the read refuses.
      await pool.query('ALTER TABLE julius_brain.content DISABLE TRIGGER content_immutable');
      await pool.query(alter, [stored.contentHash]);
      await pool.query('ALTER TABLE julius_brain.content ENABLE TRIGGER content_immutable');
      await expect(content.get(stored.storageRef)).rejects.toThrow('julius_brain_artifact_integrity_failure');
      expect(await content.resolve(stored.storageRef, stored.contentHash)).toEqual({ status: 'INTEGRITY_FAILURE' });
      // A size that disagrees with the bytes cannot be stored at all.
      await expect(pool.query("INSERT INTO julius_brain.content(content_hash,byte_size,bytes) VALUES($1,99,'\\x00'::bytea)", [`sha256:${'1'.repeat(64)}`])).rejects.toThrow();
    });
  }, 120_000);
});
