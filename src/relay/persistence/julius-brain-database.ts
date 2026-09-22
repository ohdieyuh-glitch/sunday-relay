import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

/**
 * THE PROJECT BRAIN'S OWN DATABASE.
 *
 * Durable project truth outlives any run, and a paid run's Julius runtime
 * database does not: it is created for the job and destroyed with it. So the
 * Brain has its own database, and four rules keep it that way — each enforced
 * here rather than trusted to whoever wires a connection string:
 *
 *   DEDICATED   a database holding the Julius runtime schema (`relay_wonderland`)
 *               is refused, for migration and for use. The Brain is never a
 *               guest in the database that gets thrown away.
 *   IDENTIFIED  the environment is fixed at first migration, and every open says
 *               which environment it expects. Development configuration cannot
 *               open a production Brain, or the reverse.
 *   ENCRYPTED   production refuses a connection that negotiated no TLS, with no
 *               opt-out. Any other environment may require it too.
 *   CURRENT     pending migrations are refused on use — migrate first — and a
 *               database migrated by NEWER code is refused outright, because an
 *               older binary must not write into a schema it does not understand.
 *
 * Migrations apply under a session advisory lock, so two processes starting
 * together apply each migration once.
 */

export const JULIUS_BRAIN_SCHEMA = 'julius_brain';
export const JULIUS_BRAIN_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type JuliusBrainEnvironment = typeof JULIUS_BRAIN_ENVIRONMENTS[number];

const migration = (name: string): string => {
  const candidates = [join(__dirname, 'julius-brain-migrations', name), join(process.cwd(), 'src', 'relay', 'persistence', 'julius-brain-migrations', name)];
  const path = candidates.find(existsSync);
  return path === undefined ? '' : readFileSync(path, 'utf8');
};

/** The chain, in order. One squashed initial migration: there was no deployed Brain to migrate. */
export const JULIUS_BRAIN_MIGRATIONS = [migration('001_julius_brain_truth.sql')] as const;

export const juliusBrainMigrationVersion = (sql: string): string | null =>
  /INSERT INTO julius_brain\.schema_migrations\(version\) VALUES\('([^']+)'\)/.exec(sql)?.[1] ?? null;

/** A stable key for `pg_advisory_lock`: "julius_brain.migrate". */
const MIGRATION_LOCK_KEY = '7589120345118212002';

export interface JuliusBrainDatabaseIdentity {
  readonly databaseId: string;
  readonly environment: JuliusBrainEnvironment;
  readonly migrations: readonly string[];
}

function knownVersions(): readonly string[] {
  if (JULIUS_BRAIN_MIGRATIONS.some((sql) => sql === '')) throw new Error('julius_brain_migration_not_packaged');
  return JULIUS_BRAIN_MIGRATIONS.map((sql) => {
    const version = juliusBrainMigrationVersion(sql);
    if (version === null) throw new Error('julius_brain_migration_unversioned');
    return version;
  });
}

const schemaExists = async (client: Pick<PoolClient, 'query'>, schema: string): Promise<boolean> =>
  ((await client.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [schema])).rowCount ?? 0) > 0;

async function appliedVersions(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  if (!(await schemaExists(client, JULIUS_BRAIN_SCHEMA))) return [];
  const result = await client.query<{ version: string }>('SELECT version FROM julius_brain.schema_migrations ORDER BY version');
  return result.rows.map((row) => String(row.version));
}

async function refuseShared(client: Pick<PoolClient, 'query'>): Promise<void> {
  // The runtime schema's presence means this is the disposable database.
  if (await schemaExists(client, 'relay_wonderland')) throw new Error('julius_brain_database_not_dedicated');
}

async function refuseUnencrypted(client: Pick<PoolClient, 'query'>, environment: JuliusBrainEnvironment, requireTls: boolean | undefined): Promise<void> {
  if (environment !== 'production' && requireTls !== true) return;
  const tls = await client.query<{ ssl: boolean }>('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
  if (tls.rows[0]?.ssl !== true) throw new Error('julius_brain_database_connection_not_encrypted');
}

function refuseNewer(applied: readonly string[], known: readonly string[]): void {
  const unknown = applied.filter((version) => !known.includes(version));
  if (unknown.length > 0) throw new Error(`julius_brain_database_newer_than_code:${unknown.join(',')}`);
}

/** Apply what is missing. Idempotent, and safe to run from several processes at once. */
export async function migrateJuliusBrainDatabase(pool: Pool, input: { readonly environment: JuliusBrainEnvironment; readonly requireTls?: boolean }): Promise<JuliusBrainDatabaseIdentity> {
  const known = knownVersions();
  const client = await pool.connect();
  try {
    await refuseUnencrypted(client, input.environment, input.requireTls);
    await refuseShared(client);
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const before = await appliedVersions(client);
      refuseNewer(before, known);
      for (const [index, sql] of JULIUS_BRAIN_MIGRATIONS.entries()) {
        const version = known[index]!;
        if (before.includes(version)) continue;
        await client.query(sql);
      }
      // The identity is written once, by whichever process migrated first.
      await client.query(
        'INSERT INTO julius_brain.database_identity(database_id, environment) VALUES($1, $2) ON CONFLICT DO NOTHING',
        [randomUUID(), input.environment],
      );
      const identity = await readIdentity(client);
      if (identity === null) throw new Error('julius_brain_database_identity_missing');
      if (identity.environment !== input.environment) throw new Error(`julius_brain_database_environment_mismatch:${identity.environment}`);
      return { ...identity, migrations: await appliedVersions(client) };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function readIdentity(client: Pick<PoolClient, 'query'>): Promise<{ databaseId: string; environment: JuliusBrainEnvironment } | null> {
  const result = await client.query<{ database_id: string; environment: JuliusBrainEnvironment }>('SELECT database_id, environment FROM julius_brain.database_identity');
  const row = result.rows[0];
  return row === undefined ? null : { databaseId: String(row.database_id), environment: row.environment };
}

/** Open a Brain that is dedicated, identified, encrypted where required, and exactly as current as this code. */
export async function assertJuliusBrainDatabase(pool: Pool, input: { readonly environment: JuliusBrainEnvironment; readonly requireTls?: boolean }): Promise<JuliusBrainDatabaseIdentity> {
  const known = knownVersions();
  const client = await pool.connect();
  try {
    await refuseUnencrypted(client, input.environment, input.requireTls);
    await refuseShared(client);
    const applied = await appliedVersions(client);
    if (applied.length === 0) throw new Error('julius_brain_database_not_migrated');
    refuseNewer(applied, known);
    const pending = known.filter((version) => !applied.includes(version));
    if (pending.length > 0) throw new Error(`julius_brain_database_migrations_pending:${pending.join(',')}`);
    const identity = await readIdentity(client);
    if (identity === null) throw new Error('julius_brain_database_identity_missing');
    if (identity.environment !== input.environment) throw new Error(`julius_brain_database_environment_mismatch:${identity.environment}`);
    return { ...identity, migrations: applied };
  } finally {
    client.release();
  }
}
