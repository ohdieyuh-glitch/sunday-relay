import { Pool } from 'pg';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';

/**
 * R16 LOCAL REHEARSAL: migrate the THROWAWAY database the local bridge will use, and nothing else.
 *
 * The bridge itself is never a migration entry point; this helper is, for exactly one kind of database: the portable test
 * PostgreSQL on 127.0.0.1:54329, a database named sw_r16_<n>. It re-checks that itself (scripts/r16-local-bridge.mjs checks
 * it too), reads ONLY JULIUS_DATABASE_URL, and prints the versions applied -- never a connection string's credentials.
 *
 *   built by scripts/r16-local-bridge.mjs into dist-relay-bridge/r16-migrate-throwaway.cjs; run from the repository root
 */

export const R16_THROWAWAY_DATABASE = /^postgresql:\/\/postgres@127\.0\.0\.1:54329\/sw_r16_\d{1,6}$/;

async function run(): Promise<void> {
  const url = process.env.JULIUS_DATABASE_URL ?? '';
  if (!R16_THROWAWAY_DATABASE.test(url)) {
    console.error('r16-migrate: refusing -- JULIUS_DATABASE_URL is not postgresql://postgres@127.0.0.1:54329/sw_r16_<n>');
    process.exitCode = 3;
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const database = new TransactionalWonderlandDatabase(pool);
    await database.migrate();
    const applied = [...(await database.appliedMigrationVersions())].sort();
    console.log(`r16-migrate: ${url.slice(url.lastIndexOf('/') + 1)} at ${applied.length} versions; social 032 ${applied.includes('032_wonderland_social') ? 'APPLIED' : 'MISSING'}`);
    if (!applied.includes('032_wonderland_social')) process.exitCode = 4;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    console.error(`r16-migrate: failed (${error instanceof Error ? error.message : 'unknown error'})`);
    process.exitCode = 1;
  });
}
