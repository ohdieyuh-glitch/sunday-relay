import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  createPgReadOnlyJsonQuery,
  diagnoseArchiveShapeDrift,
  readArchiveShapeSnapshot,
  recordArchiveKnownShapes,
  type ArchiveKnownShapes,
} from './julius-archive-shape-drift';

/**
 * THE DRIFT DIAGNOSTIC ON A REAL POSTGRESQL, READ-ONLY.
 *
 * A throwaway database takes the archive catalog exactly as recorded in
 * `julius-archive-known-shapes.json` — never the shared `julius_archive` — and
 * two runs whose research.tsv shapes differ under one label. The reader finds
 * the recorded catalog, both shapes and the ambiguous cells, and cannot write:
 * every statement runs in a read-only transaction.
 * `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL`; todo otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const KNOWN = JSON.parse(readFileSync(join(__dirname, 'julius-archive-known-shapes.json'), 'utf8')) as ArchiveKnownShapes;
const LABEL = 'julius-paid-run-archive.v1';

suite('paid-run archive shape drift on a real PostgreSQL', () => {
  it('reads the catalog and every run shape the recorded baseline knows, counts ambiguous cells, and cannot write', async () => {
    const name = `jbshape${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    const owner = new Pool({ connectionString: url.toString(), max: 1 });
    const reader = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      await owner.query('CREATE SCHEMA paid_runs');
      for (const table of KNOWN.catalog.tables) {
        await owner.query(`CREATE TABLE ${table.schema}.${table.table} (${table.columns.map((c) => `"${c.name}" ${c.type}${c.nullable ? '' : ' NOT NULL'}`).join(', ')})`);
      }
      await owner.query('CREATE SEQUENCE paid_runs.probe');
      const [r17, r21] = KNOWN.files['research.tsv']!;
      const runs = [{ id: '34753589938', shape: r17! }, { id: '34766115321', shape: r21! }];
      for (const run of runs) {
        const values: Record<string, unknown> = {};
        for (const column of KNOWN.catalog.tables.find((t) => t.table === 'runs')!.columns) values[column.name] = column.type === 'jsonb' ? '[]' : column.type === 'bigint' || column.type === 'integer' ? 1 : column.type.startsWith('timestamp') ? '2026-09-13T00:00:00Z' : 'x';
        Object.assign(values, { workflow_run_id: run.id, workflow_run_attempt: 1, archive_version: LABEL, null_rendering: 'psql -A -F tab: an empty field is a SQL NULL or an empty string, indistinguishably' });
        const names = Object.keys(values);
        await owner.query(`INSERT INTO paid_runs.runs (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, names.map((n) => values[n]));
        await owner.query('INSERT INTO paid_runs.files (workflow_run_id, workflow_run_attempt, path, sha256, bytes, kind, table_status, columns, malformed_rows) VALUES ($1, 1, $2, $3, 10, $4, $5, $6, 0)',
          [run.id, 'research.tsv', 'a'.repeat(64), 'table', 'READ', JSON.stringify(run.shape.columns)]);
        for (let row = 0; row < 3; row += 1) {
          const cells = Object.fromEntries(run.shape.columns.map((column) => [column, column === 'stage' ? '' : `${column}-${row}`]));
          await owner.query('INSERT INTO paid_runs.table_rows (workflow_run_id, workflow_run_attempt, source_file, row_number, "row") VALUES ($1, 1, $2, $3, $4)', [run.id, 'research.tsv', row, JSON.stringify(cells)]);
        }
      }

      const query = createPgReadOnlyJsonQuery(reader);
      const snapshot = await readArchiveShapeSnapshot(query);
      const report = diagnoseArchiveShapeDrift(snapshot, KNOWN);
      expect(report.compatibility).toBe('NOT ESTABLISHED');
      expect(report.catalog).toMatchObject({ known: true, missingTables: [], unexpectedTables: [], missingColumns: [], unexpectedColumns: [], changedColumns: [] });
      expect(report.labels).toEqual([{ label: LABEL, runs: ['34753589938/1', '34766115321/1'], filesWithSeveralShapes: { 'research.tsv': 2 } }]);
      expect(report.files.find((file) => file.path === 'research.tsv')!.shapes.map((shape) => [shape.columnCount, shape.known])).toEqual([[17, true], [21, true]]);
      // The other files the baseline knows are absent from this database: that is drift, and it is reported.
      expect(report.drift).toBe('UNKNOWN_SHAPES');
      expect(report.ambiguity.byFile).toEqual([{ path: 'research.tsv', ambiguousCells: 6, malformedRows: 0, columns: [{ column: 'stage', ambiguousCells: 6 }] }]);
      expect(diagnoseArchiveShapeDrift(snapshot, recordArchiveKnownShapes(snapshot, 'itself')).drift).toBe('NO_UNKNOWN_SHAPES');

      // Read-only, whatever the SQL: the transaction refuses a write, and nothing changed.
      expect(await query(`select current_setting('transaction_read_only')`)).toBe('on');
      await expect(query(`select nextval('paid_runs.probe')`)).rejects.toMatchObject({ code: '25006' });
      const counts = await owner.query<{ runs: string; rows: string }>('SELECT (SELECT count(*) FROM paid_runs.runs) AS runs, (SELECT count(*) FROM paid_runs.table_rows) AS rows');
      expect(counts.rows[0]).toEqual({ runs: '2', rows: '6' });
      expect((await owner.query<{ last_value: string; is_called: boolean }>('SELECT last_value, is_called FROM paid_runs.probe')).rows[0]!.is_called).toBe(false);
    } finally {
      await reader.end();
      await owner.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
      await admin.end();
    }
  }, 60_000);
});
