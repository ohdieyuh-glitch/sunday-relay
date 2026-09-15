/**
 * The export conformance check's entry point. Split so the check can be
 * imported by tests without running.
 */
import { readFileSync } from 'node:fs';

import { runArchiveExportConformance } from './julius-archive-export-conformance';

process.exitCode = runArchiveExportConformance(process.argv.slice(2), {
  readText: (path) => readFileSync(path, 'utf8'),
  readBytes: (path) => new Uint8Array(readFileSync(path)),
  write: (text) => { process.stdout.write(text); },
});
