/**
 * The Julius failure-recovery drill's entry point, and the only place that
 * knows where the drill sits on disk. Split so the drill can be imported by
 * its parity test without running two missions at import time.
 */
import { resolve } from 'node:path';

import { runFailureRecoveryDrill } from './julius-failure-recovery-drill';

runFailureRecoveryDrill({
  argv: process.argv.slice(2),
  repoRoot: resolve(__dirname, '..'),
  databaseUrl: process.env.DATABASE_URL,
}).then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stderr.write(`julius_failure_recovery_drill_threw: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`);
  process.exitCode = 8;
});
