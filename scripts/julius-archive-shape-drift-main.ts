/**
 * The shape-drift diagnostic's entry point: wires a read-only query to either a
 * database URL or a local container. Every statement runs inside
 * `BEGIN TRANSACTION READ ONLY` and is rolled back.
 *
 *   JULIUS_ARCHIVE_DATABASE_URL=postgresql://… node dist-relay-bridge/julius-archive-shape-drift.cjs [--known scripts/julius-archive-known-shapes.json] [--json]
 *   JULIUS_ARCHIVE_CONTAINER=julius-postgres node dist-relay-bridge/julius-archive-shape-drift.cjs --known scripts/julius-archive-known-shapes.json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';

import { createPgReadOnlyJsonQuery, runArchiveShapeDrift, type ReadOnlyJsonQuery } from './julius-archive-shape-drift';

const url = process.env.JULIUS_ARCHIVE_DATABASE_URL ?? '';
const container = process.env.JULIUS_ARCHIVE_CONTAINER ?? '';
let pool: Pool | null = null;

function readOnlyQuery(): ReadOnlyJsonQuery | null {
  if (url !== '') {
    pool = new Pool({ connectionString: url, max: 1 });
    return createPgReadOnlyJsonQuery(pool);
  }
  if (container !== '') {
    const database = process.env.JULIUS_ARCHIVE_DATABASE ?? 'julius_archive';
    const user = process.env.JULIUS_ARCHIVE_USER ?? 'julius';
    return async (sql) => {
      const out = execFileSync('docker', ['exec', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-U', user, '-d', database,
        '-c', 'BEGIN TRANSACTION READ ONLY', '-c', "SET LOCAL statement_timeout = '30s'", '-c', sql, '-c', 'ROLLBACK'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(out);
    };
  }
  return null;
}

runArchiveShapeDrift(process.argv.slice(2), {
  query: readOnlyQuery(),
  readText: (path) => readFileSync(path, 'utf8'),
  writeText: (path, text) => writeFileSync(path, text),
  write: (text) => { process.stdout.write(text); },
}).then(async (code) => { process.exitCode = code; await pool?.end(); }, async (error: unknown) => {
  process.stderr.write(`julius_archive_shape_drift_threw: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`);
  process.exitCode = 2;
  await pool?.end();
});
