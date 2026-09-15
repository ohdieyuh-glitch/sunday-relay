/** Entry point for the Brain + Python drill; split so the drill can be imported without running. */
import { runBrainPythonFlowDrill } from './julius-brain-python-flow-drill';

runBrainPythonFlowDrill({
  argv: process.argv.slice(2),
  databaseUrl: process.env.JULIUS_BRAIN_DATABASE_URL,
  restartCommand: process.env.JULIUS_BRAIN_DRILL_RESTART,
  self: process.argv[1]!,
}).then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stderr.write(`julius_brain_python_drill_threw: ${error instanceof Error ? error.stack ?? error.message : 'unknown'}\n`);
  process.exitCode = 8;
});
