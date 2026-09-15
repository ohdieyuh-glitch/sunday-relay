import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_KNOWN_SHAPES_FORMAT,
  catalogFingerprint,
  diagnoseArchiveShapeDrift,
  readArchiveShapeSnapshot,
  recordArchiveKnownShapes,
  renderArchiveShapeDrift,
  runArchiveShapeDrift,
  shapeFingerprint,
  type ArchiveCatalogTable,
  type ArchiveFileShape,
  type ArchiveKnownShapes,
  type ArchiveRunShape,
  type ArchiveShapeSnapshot,
} from './julius-archive-shape-drift';

const LABEL = 'julius-paid-run-archive.v1';
const RENDERING = 'psql -A -F tab: an empty field is a SQL NULL or an empty string, indistinguishably';
const col = (name: string, type = 'text', nullable = true) => ({ name, type, nullable });
const CATALOG: ArchiveCatalogTable[] = [
  { schema: 'paid_runs', table: 'files', columns: [col('workflow_run_id', 'bigint', false), col('workflow_run_attempt', 'integer', false), col('path', 'text', false), col('kind', 'text', false), col('table_status'), col('columns', 'jsonb'), col('malformed_rows', 'integer'), col('content')] },
  { schema: 'paid_runs', table: 'runs', columns: [col('workflow_run_id', 'bigint', false), col('workflow_run_attempt', 'integer', false), col('archive_version', 'text', false), col('null_rendering', 'text', false)] },
  { schema: 'paid_runs', table: 'table_rows', columns: [col('workflow_run_id', 'bigint', false), col('workflow_run_attempt', 'integer', false), col('source_file', 'text', false), col('row_number', 'integer', false), col('row', 'jsonb', false)] },
];
const R17 = ['run_id', 'request_key', 'outcome', 'stage', 'occurred_at'];
const R21 = [...R17.slice(0, 3), 'reach_refusal', 'requested_host', ...R17.slice(3)];
const table = (path: string, columns: readonly string[], empty: Record<string, number> = {}, malformedRows = 0): ArchiveFileShape => ({
  path, kind: 'table', status: 'READ', columns, malformedRows, rows: 10, emptyCells: Object.values(empty).reduce((a, b) => a + b, 0), emptyByColumn: empty,
});
const run = (id: string, files: ArchiveFileShape[], label = LABEL): ArchiveRunShape => ({ workflowRunId: id, workflowRunAttempt: 1, label, nullRendering: RENDERING, files });
const snapshot = (runs: ArchiveRunShape[], catalog = CATALOG): ArchiveShapeSnapshot => ({ catalog, runs, runsUnreadable: null });

describe('paid-run archive shape drift: read-only, and it never establishes compatibility', () => {
  it('no unknown shape is still NOT ESTABLISHED, and the label is shown covering several shapes', () => {
    const observed = snapshot([
      run('34753589938', [table('research.tsv', R17, { stage: 3 }), table('tasks.tsv', ['task_id', 'parent_task_id'], { parent_task_id: 2 })]),
      run('34766115321', [table('research.tsv', R21, { reach_refusal: 4, stage: 1 }), table('tasks.tsv', ['task_id', 'parent_task_id'])]),
    ]);
    const known = recordArchiveKnownShapes(observed, 'two runs');
    const report = diagnoseArchiveShapeDrift(observed, known);
    expect(report).toMatchObject({ compatibility: 'NOT ESTABLISHED', drift: 'NO_UNKNOWN_SHAPES', catalog: { known: true } });
    expect(report.labels).toEqual([{ label: LABEL, runs: ['34753589938/1', '34766115321/1'], filesWithSeveralShapes: { 'research.tsv': 2 } }]);
    const research = report.files.find((file) => file.path === 'research.tsv')!;
    expect(research.shapes.map((shape) => [shape.columnCount, shape.known, shape.runs])).toEqual([[5, true, ['34753589938/1']], [7, true, ['34766115321/1']]]);
    expect(research.changes).toEqual([{ from: '34753589938/1', to: '34766115321/1', added: ['reach_refusal', 'requested_host'], removed: [] }]);
    // Every empty cell is ambiguous: neither Unknown nor empty.
    expect(report.ambiguity).toEqual({
      nullRenderings: [RENDERING], ambiguousCells: 10,
      byFile: [
        { path: 'research.tsv', ambiguousCells: 8, malformedRows: 0, columns: [{ column: 'reach_refusal', ambiguousCells: 4 }, { column: 'stage', ambiguousCells: 4 }] },
        { path: 'tasks.tsv', ambiguousCells: 2, malformedRows: 0, columns: [{ column: 'parent_task_id', ambiguousCells: 2 }] },
      ],
    });
    const text = renderArchiveShapeDrift(report);
    expect(text.split('\n')[0]).toBe('COMPATIBILITY: NOT ESTABLISHED');
    expect(text).toContain('the label does not identify a shape');
    expect(text).not.toMatch(/\bCOMPATIBLE\b|compatibility: established/i);
  });

  it('a new shape under the same label: its missing and unexpected columns against the nearest known shape', () => {
    const known = recordArchiveKnownShapes(snapshot([run('1', [table('research.tsv', R21), table('tasks.tsv', ['task_id'])])]), 'baseline');
    const renamed = R21.map((name) => (name === 'requested_host' ? 'host' : name));
    const report = diagnoseArchiveShapeDrift(snapshot([run('2', [table('research.tsv', [...renamed, 'content_digest']), table('evidence.tsv', ['evidence_id'])])]), known);
    expect(report.drift).toBe('UNKNOWN_SHAPES');
    const research = report.files.find((file) => file.path === 'research.tsv')!;
    expect(research.shapes).toEqual([expect.objectContaining({ known: false, labels: [LABEL], missingColumns: ['requested_host'], unexpectedColumns: ['host', 'content_digest'] })]);
    // A file the baseline never saw, and a known file this archive no longer has.
    expect(report.files.find((file) => file.path === 'evidence.tsv')).toMatchObject({ known: false, shapes: [{ known: false }] });
    expect(report.files.find((file) => file.path === 'tasks.tsv')).toMatchObject({ known: true, shapes: [], missingInRuns: ['2/1'] });
    expect(renderArchiveShapeDrift(report).split('\n')[0]).toBe('COMPATIBILITY: NOT ESTABLISHED');
  });

  it('catalog drift: changed columns are named, and when the per-run read is no longer possible the report says so instead of guessing', async () => {
    const known = recordArchiveKnownShapes(snapshot([run('1', [table('tasks.tsv', ['task_id'])])]), 'baseline');
    // files.columns renamed to column_names, files.content dropped, files.kind made nullable.
    const files = CATALOG[0]!;
    const drifted: ArchiveCatalogTable[] = [
      { ...files, columns: [...files.columns.filter((c) => c.name !== 'columns' && c.name !== 'content').map((c) => (c.name === 'kind' ? { ...c, nullable: true } : c)), col('column_names', 'jsonb')] },
      ...CATALOG.slice(1),
    ];
    const queries: string[] = [];
    const read = await readArchiveShapeSnapshot(async (sql) => { queries.push(sql); return drifted; });
    expect(read).toEqual({ catalog: drifted, runs: null, runsUnreadable: 'the catalog no longer has paid_runs.files.columns' });
    expect(queries).toHaveLength(1);
    const report = diagnoseArchiveShapeDrift(read, known);
    expect(report).toMatchObject({
      compatibility: 'NOT ESTABLISHED', drift: 'RUN_SHAPES_UNREADABLE',
      catalog: { known: false, missingColumns: ['paid_runs.files.columns', 'paid_runs.files.content'], unexpectedColumns: ['paid_runs.files.column_names'], changedColumns: ['paid_runs.files.kind: text NOT NULL → text NULL'] },
    });
    expect(renderArchiveShapeDrift(report)).toContain('RUN SHAPES: UNREADABLE — the catalog no longer has paid_runs.files.columns');
  });

  it('the CLI: exit 0 only with no unknown shapes, 1 on drift, 2 when nothing could be read; never a compatibility claim', async () => {
    const observed = snapshot([run('1', [table('research.tsv', R17)])]);
    const known = recordArchiveKnownShapes(observed, 'baseline');
    const serve = (value: ArchiveShapeSnapshot) => async (sql: string) => {
      if (sql.includes('information_schema.columns')) return value.catalog;
      if (sql.includes('from paid_runs.runs')) return value.runs!.map((r) => ({ workflow_run_id: r.workflowRunId, workflow_run_attempt: r.workflowRunAttempt, archive_version: r.label, null_rendering: r.nullRendering }));
      if (sql.includes('from paid_runs.files')) return value.runs!.flatMap((r) => r.files.map((f) => ({ workflow_run_id: r.workflowRunId, workflow_run_attempt: r.workflowRunAttempt, path: f.path, kind: f.kind, table_status: f.status, columns: f.columns, malformed_rows: f.malformedRows })));
      return value.runs!.flatMap((r) => r.files.flatMap((f) => f.columns!.map((c) => ({ workflow_run_id: r.workflowRunId, workflow_run_attempt: r.workflowRunAttempt, source_file: f.path, column_name: c, cells: f.rows, empty: f.emptyByColumn[c] ?? 0 }))));
    };
    const cli = async (argv: string[], query: ((sql: string) => Promise<unknown>) | null, files: Record<string, string> = {}) => {
      let out = '';
      const written: Record<string, string> = {};
      const code = await runArchiveShapeDrift(argv, { query, readText: (p) => { if (files[p] === undefined) throw new Error('ENOENT'); return files[p]!; }, writeText: (p, t) => { written[p] = t; }, write: (t) => { out += t; } });
      return { code, out, written };
    };
    const same = await cli(['--known', 'k.json'], serve(observed), { 'k.json': JSON.stringify(known) });
    expect(same.code).toBe(0);
    expect(same.out.split('\n')[0]).toBe('COMPATIBILITY: NOT ESTABLISHED');
    const moved = await cli(['--known', 'k.json', '--json'], serve(snapshot([run('2', [table('research.tsv', R21)])])), { 'k.json': JSON.stringify(known) });
    expect(moved.code).toBe(1);
    expect(JSON.parse(moved.out)).toMatchObject({ compatibility: 'NOT ESTABLISHED', drift: 'UNKNOWN_SHAPES' });
    const recorded = await cli(['--record-known', 'new.json'], serve(observed));
    expect(recorded.code).toBe(0);
    expect(JSON.parse(recorded.written['new.json']!)).toMatchObject({ format: ARCHIVE_KNOWN_SHAPES_FORMAT, files: { 'research.tsv': [{ fingerprint: shapeFingerprint(R17), firstSeen: '1/1' }] } });
    expect((await cli([], null)).out).toMatch(/^COMPATIBILITY: NOT ESTABLISHED\n/);
    expect((await cli([], null)).code).toBe(2);
    expect((await cli([], async () => { throw new Error('connection refused'); })).code).toBe(2);
    expect((await cli(['--known', 'missing.json'], serve(observed))).code).toBe(2);
    expect((await cli(['--compatible'], serve(observed))).code).toBe(2);
  });

  it('the recorded baseline: the archive label covers three research.tsv shapes, and the catalog fingerprint re-derives', () => {
    const known = JSON.parse(readFileSync(join(__dirname, 'julius-archive-known-shapes.json'), 'utf8')) as ArchiveKnownShapes;
    expect(known.format).toBe(ARCHIVE_KNOWN_SHAPES_FORMAT);
    expect(catalogFingerprint(known.catalog.tables)).toBe(known.catalog.fingerprint);
    expect(known.files['research.tsv']!.map((shape) => [shape.columns.length, shape.labels])).toEqual([[17, [LABEL]], [21, [LABEL]], [34, [LABEL]]]);
    for (const shapes of Object.values(known.files)) for (const shape of shapes) expect(shapeFingerprint(shape.columns)).toBe(shape.fingerprint);
  });
});
