/**
 * The Project Brain durability drill's entry point. Split from the drill so
 * the drill's scenario and summary can be imported by tests without running.
 */
import { runProjectBrainDrill } from './julius-project-brain-drill';

runProjectBrainDrill({
  argv: process.argv.slice(2),
  databaseUrl: process.env.DATABASE_URL,
  restartCommand: process.env.JULIUS_BRAIN_DRILL_RESTART,
  self: process.argv[1]!,
}).then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stderr.write(`julius_project_brain_drill_threw: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`);
  process.exitCode = 8;
});
