/**
 * The Julius restart/recovery drill's entry point, and the only place that
 * knows where the drill sits on disk.
 *
 * Split from the drill itself so the drill can be imported — by the parity
 * test that holds its attestation columns to the Beta Gate's — without running
 * a mission at import time.
 */
import { resolve } from 'node:path';

import { runRecoveryDrill } from './julius-recovery-drill';

runRecoveryDrill({
  argv: process.argv.slice(2),
  repoRoot: resolve(__dirname, '..'),
  // Accepted only when it names a THROWAWAY: a drill database by name, or the
  // one JULIUS_TEST_DATABASE_URL names. `…/julius` is refused before connecting.
  databaseUrl: process.env.DATABASE_URL,
  testDatabaseUrl: process.env.JULIUS_TEST_DATABASE_URL,
}).then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stderr.write(`julius_recovery_drill_threw: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`);
  process.exitCode = 8;
});
