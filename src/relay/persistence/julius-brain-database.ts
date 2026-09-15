import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

/**
 * THE PROJECT BRAIN'S OWN DATABASE.
 *
 * The Brain is canonical, durable memory; the Julius runtime database of a paid
 * run is disposable. So the Brain has a dedicated PostgreSQL database with its
 * own schema (`julius_brain`) and its own migration chain, and this module holds
 * the three rules that keep it that way:
 *
 *   DEDICATED   a database that holds the Julius runtime schema
 *               (`relay_wonderland`) is refused, for migration and for use;
 *   IDENTIFIED  the database records the environment it serves, fixed at first
 *               migration, and every open names the environment it expects —
 *               development configuration cannot open a production Brain;
 *   ENCRYPTED   production — migration and use alike — refuses a connection
 *               that is not TLS, with no way to opt out; any other environment
 *               may require it too (`requireTls`). Verifying the server's
 *               identity (CA, hostname) is the connection's configuration; this
 *               refuses the connection that was never encrypted at all;
 *   CURRENT     code opens only a database whose applied migrations are exactly
 *               the chain it knows: pending migrations are refused (migrate
 *               first), and a database migrated by NEWER code is refused (an
 *               old binary must not write into a schema it does not understand).
 *
 * Migrations are applied under a session advisory lock, so two processes that
 * start together apply each migration once.
 */

export const JULIUS_BRAIN_SCHEMA = 'julius_brain';
export const JULIUS_BRAIN_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type JuliusBrainDatabaseEnvironment = typeof JULIUS_BRAIN_ENVIRONMENTS[number];

const migration = (name: string): string => {
  const candidates = [join(__dirname, 'julius-brain-migrations', name), join(process.cwd(), 'src', 'relay', 'persistence', 'julius-brain-migrations', name)];
  const path = candidates.find(existsSync);
  return path === undefined ? '' : readFileSync(path, 'utf8');
};

export const JULIUS_BRAIN_MIGRATIONS = [
  migration('001_julius_brain_ledger.sql'),
  migration('002_julius_brain_python_executions.sql'),
  migration('003_julius_brain_content.sql'),
  migration('004_julius_brain_immutability.sql'),
  migration('005_julius_brain_unknown_occurrence.sql'),
  migration('006_julius_brain_access.sql'),
] as const;

export function juliusBrainMigrationVersion(sql: string): string | null {
  return /INSERT INTO julius_brain\.schema_migrations\(version\) VALUES\('([^']+)'\)/.exec(sql)?.[1] ?? null;
}

export interface JuliusBrainDatabaseIdentity {
  readonly databaseId: string;
  readonly environment: JuliusBrainDatabaseEnvironment;
  readonly migrations: readonly string[];
}

// A stable 64-bit key for pg_advisory_lock: "julius_brain.migrate".
const MIGRATION_LOCK_KEY = '7589120345118212001';

async function schemaExists(client: Pick<PoolClient, 'query'>, schema: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [schema]);
  return (result.rowCount ?? 0) > 0;
}

async function appliedVersions(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  if (!(await schemaExists(client, JULIUS_BRAIN_SCHEMA))) return [];
  const result = await client.query<{ version: string }>('SELECT version FROM julius_brain.schema_migrations ORDER BY version');
  return result.rows.map((row) => String(row.version));
}

async function refuseUnencrypted(client: Pick<PoolClient, 'query'>, environment: JuliusBrainDatabaseEnvironment, requireTls: boolean | undefined): Promise<void> {
  if (environment !== 'production' && requireTls !== true) return;
  const tls = await client.query<{ ssl: boolean }>('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
  if (tls.rows[0]?.ssl !== true) throw new Error('julius_brain_database_connection_not_encrypted');
}

async function refuseShared(client: Pick<PoolClient, 'query'>): Promise<void> {
  if (await schemaExists(client, 'relay_wonderland')) throw new Error('julius_brain_database_not_dedicated');
}

function knownVersions(): string[] {
  if (JULIUS_BRAIN_MIGRATIONS.some((sql) => sql === '')) throw new Error('julius_brain_migration_not_packaged');
  return JULIUS_BRAIN_MIGRATIONS.map((sql) => {
    const version = juliusBrainMigrationVersion(sql);
    if (version === null) throw new Error('julius_brain_migration_unversioned');
    return version;
  });
}

async function readIdentity(client: Pick<PoolClient, 'query'>): Promise<{ databaseId: string; environment: JuliusBrainDatabaseEnvironment } | null> {
  const result = await client.query<{ database_id: string; environment: JuliusBrainDatabaseEnvironment }>('SELECT database_id,environment FROM julius_brain.database_identity');
  const row = result.rows[0];
  return row === undefined ? null : { databaseId: String(row.database_id), environment: row.environment };
}

function refuseNewer(applied: readonly string[], known: readonly string[]): void {
  const unknown = applied.filter((version) => !known.includes(version));
  if (unknown.length > 0) throw new Error(`julius_brain_database_newer_than_code:${unknown.join(',')}`);
}

/** Bring a dedicated Brain database to the current chain, fixing its environment on first use. */
export async function migrateJuliusBrainDatabase(pool: Pool, input: { readonly environment: JuliusBrainDatabaseEnvironment; readonly requireTls?: boolean }): Promise<JuliusBrainDatabaseIdentity & { readonly applied: readonly string[] }> {
  if (!JULIUS_BRAIN_ENVIRONMENTS.includes(input.environment)) throw new Error('julius_brain_environment_invalid');
  const known = knownVersions();
  const client = await pool.connect();
  try {
    await refuseUnencrypted(client, input.environment, input.requireTls);
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    try {
      await refuseShared(client);
      const before = await appliedVersions(client);
      refuseNewer(before, known);
      const applied: string[] = [];
      for (const [index, sql] of JULIUS_BRAIN_MIGRATIONS.entries()) {
        if (before.includes(known[index]!)) continue;
        await client.query(sql);
        applied.push(known[index]!);
      }
      await client.query('INSERT INTO julius_brain.database_identity(database_id,environment) VALUES($1,$2) ON CONFLICT(singleton) DO NOTHING', [randomUUID(), input.environment]);
      const identity = (await readIdentity(client))!;
      if (identity.environment !== input.environment) throw new Error(`julius_brain_database_environment_mismatch:${identity.environment}`);
      return { ...identity, migrations: await appliedVersions(client), applied };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** What a process that only USES the Brain checks before its first read or write. Never migrates. */
export async function assertJuliusBrainDatabase(pool: Pool, input: { readonly environment: JuliusBrainDatabaseEnvironment; readonly requireTls?: boolean }): Promise<JuliusBrainDatabaseIdentity> {
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
