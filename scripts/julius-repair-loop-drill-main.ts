/**
 * The Julius repair-loop drill's entry point, and the only place that knows
 * where the drill sits on disk. Split so the drill can be imported by its
 * parity test without driving a mission at import time.
 */
import { resolve } from 'node:path';

import { runRepairLoopDrill } from './julius-repair-loop-drill';

runRepairLoopDrill({
  argv: process.argv.slice(2),
  repoRoot: resolve(__dirname, '..'),
  databaseUrl: process.env.DATABASE_URL,
}).then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stderr.write(`julius_repair_loop_drill_threw: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`);
  process.exitCode = 8;
});
