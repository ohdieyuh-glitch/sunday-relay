import { Pool } from 'pg';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { throwawayPgPort } from '../relay-bridge/wonderland-github-stub-seam';

/**
 * R16 LOCAL REHEARSAL: migrate the THROWAWAY database the local bridge will use, and nothing else.
 *
 * The bridge itself is never a migration entry point; this helper is, for exactly one kind of database: the portable test
 * PostgreSQL on loopback, on the port R16_THROWAWAY_PG_PORT names (default 54329, CORE's instance; never 5432), a database
 * named sw_r16_<n> (CORE's rehearsals) or sw2_r16_<n> (Second's). It re-checks that itself (scripts/r16-local-bridge.mjs
 * checks CORE's default too), reads ONLY JULIUS_DATABASE_URL, and prints the versions applied -- never a connection string's
 * credentials.
 *
 *   built by scripts/r16-local-bridge.mjs into dist-relay-bridge/r16-migrate-throwaway.cjs; run from the repository root
 */

export function r16ThrowawayDatabase(env: NodeJS.ProcessEnv = process.env): RegExp {
  return new RegExp(`^postgresql://postgres@127\\.0\\.0\\.1:${throwawayPgPort(env)}/sw2?_r16_\\d{1,6}$`);
}

/** CORE's default fence, unchanged: 127.0.0.1:54329, sw_r16_<n> (and Second's sw2_r16_<n>). */
export const R16_THROWAWAY_DATABASE = r16ThrowawayDatabase({});

async function run(): Promise<void> {
  const url = process.env.JULIUS_DATABASE_URL ?? '';
  let fence: RegExp;
  try {
    fence = r16ThrowawayDatabase(process.env);
  } catch (error) {
    console.error(`r16-migrate: refusing -- ${error instanceof Error ? error.message : 'bad R16_THROWAWAY_PG_PORT'}`);
    process.exitCode = 3;
    return;
  }
  if (!fence.test(url)) {
    console.error(`r16-migrate: refusing -- JULIUS_DATABASE_URL is not postgresql://postgres@127.0.0.1:${throwawayPgPort(process.env)}/sw_r16_<n> (or sw2_r16_<n>)`);
    process.exitCode = 3;
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const database = new TransactionalWonderlandDatabase(pool);
    await database.migrate();
    const applied = [...(await database.appliedMigrationVersions())].sort();
    const has = (version: string) => (applied.includes(version) ? 'APPLIED' : 'MISSING');
    console.log(`r16-migrate: ${url.slice(url.lastIndexOf('/') + 1)} at ${applied.length} versions; social 033 ${has('033_wonderland_social')}`);
    if (!applied.includes('033_wonderland_social')) process.exitCode = 4;
  } finally {
    await pool.end();
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void run().catch((error: unknown) => {
    console.error(`r16-migrate: failed (${error instanceof Error ? error.message : 'unknown error'})`);
    process.exitCode = 1;
  });
}
