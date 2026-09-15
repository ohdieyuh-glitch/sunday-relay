import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * THE PAID-RUN ARCHIVE SHAPE-DRIFT DIAGNOSTIC. READ-ONLY. IT ESTABLISHES NOTHING.
 *
 * Formal's temporary archive (`julius_archive`, schema `paid_runs`) keeps each
 * run's TSV dumps as JSON rows beside the column list the dump carried. Its
 * `archive_version` label has stayed `julius-paid-run-archive.v1` while the
 * physical shapes under it changed (research.tsv: 17 → 21 → 34 columns). So a
 * label is not a schema, and a shape is not a contract.
 *
 * This reports what physically exists, against the shapes seen before:
 *   - the catalog: tables and columns missing, unexpected or changed;
 *   - per source file: every distinct column set, its fingerprint, whether it
 *     is known, which runs carry it, and the columns missing or unexpected
 *     against the nearest known shape; files that appeared or disappeared;
 *   - every label, and how many shapes it covers;
 *   - ambiguity: the archive records that an empty dump field is a SQL NULL or
 *     an empty string indistinguishably, so every empty cell is counted as
 *     AMBIGUOUS — never read as Unknown, never as empty.
 *
 * Every report says COMPATIBILITY: NOT ESTABLISHED. Compatibility is established
 * only by a document that passes the `julius-paid-run-archive-export.v1`
 * conformance kit — never by a label, a column count or a matching fingerprint.
 *
 * Every query runs inside `BEGIN TRANSACTION READ ONLY` and is rolled back.
 */

export const ARCHIVE_KNOWN_SHAPES_FORMAT = 'julius-archive-known-shapes.v1' as const;
export const COMPATIBILITY_NOT_ESTABLISHED = 'NOT ESTABLISHED' as const;
export const COMPATIBILITY_BASIS = 'Only a julius-paid-run-archive-export.v1 document that passes the conformance kit establishes compatibility. An archive label, a column count or a matching shape fingerprint establishes nothing.';

export interface ArchiveCatalogColumn { readonly name: string; readonly type: string; readonly nullable: boolean }
export interface ArchiveCatalogTable { readonly schema: string; readonly table: string; readonly columns: readonly ArchiveCatalogColumn[] }
export interface ArchiveFileShape {
  readonly path: string;
  readonly kind: string;
  readonly status: string | null;
  readonly columns: readonly string[] | null;
  readonly malformedRows: number | null;
  readonly rows: number;
  readonly emptyCells: number;
  readonly emptyByColumn: Readonly<Record<string, number>>;
}
export interface ArchiveRunShape {
  readonly workflowRunId: string;
  readonly workflowRunAttempt: number;
  readonly label: string;
  readonly nullRendering: string | null;
  readonly files: readonly ArchiveFileShape[];
}
export interface ArchiveShapeSnapshot {
  readonly catalog: readonly ArchiveCatalogTable[];
  /** null when the catalog no longer has what the per-run read needs. */
  readonly runs: readonly ArchiveRunShape[] | null;
  readonly runsUnreadable: string | null;
}
export interface ArchiveKnownShapes {
  readonly format: typeof ARCHIVE_KNOWN_SHAPES_FORMAT;
  readonly recordedFrom: string;
  readonly catalog: { readonly fingerprint: string; readonly tables: readonly ArchiveCatalogTable[] };
  readonly files: Readonly<Record<string, readonly { readonly fingerprint: string; readonly columns: readonly string[]; readonly firstSeen: string; readonly labels: readonly string[] }[]>>;
}

const sha256 = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const shapeFingerprint = (columns: readonly string[]): string => sha256(JSON.stringify(columns));
export const catalogFingerprint = (tables: readonly ArchiveCatalogTable[]): string =>
  sha256(JSON.stringify([...tables].sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`)).map((t) => [t.schema, t.table, t.columns.map((c) => [c.name, c.type, c.nullable])])));
const runKey = (run: Pick<ArchiveRunShape, 'workflowRunId' | 'workflowRunAttempt'>) => `${run.workflowRunId}/${run.workflowRunAttempt}`;
const byRun = (a: ArchiveRunShape, b: ArchiveRunShape) => (BigInt(a.workflowRunId) === BigInt(b.workflowRunId) ? a.workflowRunAttempt - b.workflowRunAttempt : BigInt(a.workflowRunId) < BigInt(b.workflowRunId) ? -1 : 1);

/* ------------------------------------------------------------------- reading */

/** Runs SQL inside a read-only transaction and returns the single JSON value the statement selects. */
export type ReadOnlyJsonQuery = (sql: string) => Promise<unknown>;

/** Each statement in its own `BEGIN TRANSACTION READ ONLY`, always rolled back: a write cannot happen here, whatever the SQL says. */
export function createPgReadOnlyJsonQuery(pool: Pool): ReadOnlyJsonQuery {
  return async (sql) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout = '30s'");
      const result = await client.query<{ value: unknown }>(`select (${sql}) as value`);
      return result.rows[0]!.value;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  };
}

const CATALOG_SQL = `select coalesce(json_agg(t order by t.schema, t."table"), '[]'::json) from (
  select table_schema as schema, table_name as "table",
         json_agg(json_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable = 'YES') order by ordinal_position) as columns
  from information_schema.columns
  where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg_toast%'
  group by table_schema, table_name) t`;

const RUNS_SQL = `select coalesce(json_agg(r order by r.workflow_run_id, r.workflow_run_attempt), '[]'::json) from (
  select workflow_run_id::text as workflow_run_id, workflow_run_attempt, archive_version, null_rendering from paid_runs.runs) r`;

const FILES_SQL = `select coalesce(json_agg(f order by f.workflow_run_id, f.workflow_run_attempt, f.path), '[]'::json) from (
  select workflow_run_id::text as workflow_run_id, workflow_run_attempt, path, kind, table_status, columns, malformed_rows from paid_runs.files) f`;

const CELLS_SQL = `select coalesce(json_agg(c), '[]'::json) from (
  select tr.workflow_run_id::text as workflow_run_id, tr.workflow_run_attempt, tr.source_file, e.key as column_name,
         count(*) as cells, count(*) filter (where e.value = to_jsonb(''::text)) as empty
  from paid_runs.table_rows tr cross join lateral jsonb_each(tr.row) e
  group by 1, 2, 3, 4) c`;

/** What the per-run read needs from the catalog. Anything missing is itself the finding. */
export const ARCHIVE_READ_REQUIRES: Readonly<Record<string, readonly string[]>> = {
  'paid_runs.runs': ['workflow_run_id', 'workflow_run_attempt', 'archive_version', 'null_rendering'],
  'paid_runs.files': ['workflow_run_id', 'workflow_run_attempt', 'path', 'kind', 'table_status', 'columns', 'malformed_rows'],
  'paid_runs.table_rows': ['workflow_run_id', 'workflow_run_attempt', 'source_file', 'row'],
};

export async function readArchiveShapeSnapshot(query: ReadOnlyJsonQuery): Promise<ArchiveShapeSnapshot> {
  const catalog = (await query(CATALOG_SQL)) as ArchiveCatalogTable[];
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(ARCHIVE_READ_REQUIRES)) {
    const found = catalog.find((t) => `${t.schema}.${t.table}` === table);
    if (found === undefined) { missing.push(table); continue; }
    for (const column of columns) if (!found.columns.some((c) => c.name === column)) missing.push(`${table}.${column}`);
  }
  if (missing.length > 0) return { catalog, runs: null, runsUnreadable: `the catalog no longer has ${missing.join(', ')}` };

  const runs = (await query(RUNS_SQL)) as { workflow_run_id: string; workflow_run_attempt: number; archive_version: string; null_rendering: string | null }[];
  const files = (await query(FILES_SQL)) as { workflow_run_id: string; workflow_run_attempt: number; path: string; kind: string; table_status: string | null; columns: unknown; malformed_rows: number | null }[];
  const cells = (await query(CELLS_SQL)) as { workflow_run_id: string; workflow_run_attempt: number; source_file: string; column_name: string; cells: number; empty: number }[];
  return {
    catalog,
    runsUnreadable: null,
    runs: runs.map((run) => {
      const key = `${run.workflow_run_id}/${run.workflow_run_attempt}`;
      return {
        workflowRunId: run.workflow_run_id, workflowRunAttempt: run.workflow_run_attempt, label: run.archive_version, nullRendering: run.null_rendering,
        files: files.filter((file) => `${file.workflow_run_id}/${file.workflow_run_attempt}` === key).map((file) => {
          const mine = cells.filter((cell) => `${cell.workflow_run_id}/${cell.workflow_run_attempt}` === key && cell.source_file === file.path);
          const emptyByColumn: Record<string, number> = {};
          for (const cell of mine) if (Number(cell.empty) > 0) emptyByColumn[cell.column_name] = Number(cell.empty);
          return {
            path: file.path, kind: file.kind, status: file.table_status,
            columns: Array.isArray(file.columns) && file.columns.every((c) => typeof c === 'string') ? file.columns as string[] : null,
            malformedRows: file.malformed_rows,
            rows: mine.reduce((max, cell) => Math.max(max, Number(cell.cells)), 0),
            emptyCells: mine.reduce((sum, cell) => sum + Number(cell.empty), 0),
            emptyByColumn,
          };
        }),
      };
    }),
  };
}

/* ------------------------------------------------------------------ analysis */

export interface ArchiveShapeDriftReport {
  readonly compatibility: typeof COMPATIBILITY_NOT_ESTABLISHED;
  readonly compatibilityBasis: typeof COMPATIBILITY_BASIS;
  readonly drift: 'NO_UNKNOWN_SHAPES' | 'UNKNOWN_SHAPES' | 'RUN_SHAPES_UNREADABLE';
  readonly catalog: {
    readonly fingerprint: string; readonly known: boolean;
    readonly missingTables: readonly string[]; readonly unexpectedTables: readonly string[];
    readonly missingColumns: readonly string[]; readonly unexpectedColumns: readonly string[]; readonly changedColumns: readonly string[];
  };
  readonly runsUnreadable: string | null;
  readonly runs: readonly string[];
  readonly labels: readonly { readonly label: string; readonly runs: readonly string[]; readonly filesWithSeveralShapes: Readonly<Record<string, number>> }[];
  readonly files: readonly {
    readonly path: string;
    readonly known: boolean;
    readonly missingInRuns: readonly string[];
    readonly shapes: readonly { readonly fingerprint: string; readonly columnCount: number; readonly known: boolean; readonly runs: readonly string[]; readonly labels: readonly string[]; readonly missingColumns: readonly string[]; readonly unexpectedColumns: readonly string[] }[];
    readonly changes: readonly { readonly from: string; readonly to: string; readonly added: readonly string[]; readonly removed: readonly string[] }[];
  }[];
  readonly textFiles: readonly string[];
  readonly ambiguity: {
    readonly nullRenderings: readonly string[];
    readonly ambiguousCells: number;
    readonly byFile: readonly { readonly path: string; readonly ambiguousCells: number; readonly malformedRows: number; readonly columns: readonly { readonly column: string; readonly ambiguousCells: number }[] }[];
  };
}

function columnDiff(actual: readonly string[], reference: readonly string[]) {
  return { missing: reference.filter((c) => !actual.includes(c)), unexpected: actual.filter((c) => !reference.includes(c)) };
}

export function diagnoseArchiveShapeDrift(snapshot: ArchiveShapeSnapshot, known: ArchiveKnownShapes | null): ArchiveShapeDriftReport {
  // The catalog.
  const tableKey = (t: ArchiveCatalogTable) => `${t.schema}.${t.table}`;
  const knownTables = known?.catalog.tables ?? [];
  const missingTables = knownTables.filter((t) => !snapshot.catalog.some((s) => tableKey(s) === tableKey(t))).map(tableKey);
  const unexpectedTables = known === null ? [] : snapshot.catalog.filter((s) => !knownTables.some((t) => tableKey(t) === tableKey(s))).map(tableKey);
  const missingColumns: string[] = [];
  const unexpectedColumns: string[] = [];
  const changedColumns: string[] = [];
  for (const table of snapshot.catalog) {
    const reference = knownTables.find((t) => tableKey(t) === tableKey(table));
    if (reference === undefined) continue;
    for (const column of reference.columns) {
      const now = table.columns.find((c) => c.name === column.name);
      if (now === undefined) missingColumns.push(`${tableKey(table)}.${column.name}`);
      else if (now.type !== column.type || now.nullable !== column.nullable) {
        changedColumns.push(`${tableKey(table)}.${column.name}: ${column.type}${column.nullable ? ' NULL' : ' NOT NULL'} → ${now.type}${now.nullable ? ' NULL' : ' NOT NULL'}`);
      }
    }
    for (const column of table.columns) if (!reference.columns.some((c) => c.name === column.name)) unexpectedColumns.push(`${tableKey(table)}.${column.name}`);
  }
  const fingerprint = catalogFingerprint(snapshot.catalog);
  const catalog = { fingerprint, known: known !== null && known.catalog.fingerprint === fingerprint, missingTables, unexpectedTables, missingColumns, unexpectedColumns, changedColumns };

  const base = { compatibility: COMPATIBILITY_NOT_ESTABLISHED, compatibilityBasis: COMPATIBILITY_BASIS, catalog } as const;
  if (snapshot.runs === null) {
    return { ...base, drift: 'RUN_SHAPES_UNREADABLE', runsUnreadable: snapshot.runsUnreadable, runs: [], labels: [], files: [], textFiles: [], ambiguity: { nullRenderings: [], ambiguousCells: 0, byFile: [] } };
  }

  const runs = [...snapshot.runs].sort(byRun);
  const tablePaths = [...new Set([...runs.flatMap((run) => run.files.filter((f) => f.kind === 'table').map((f) => f.path)), ...Object.keys(known?.files ?? {})])].sort();
  const files = tablePaths.map((path) => {
    const knownShapes = known?.files[path] ?? [];
    const shapes = new Map<string, { columns: readonly string[]; runs: string[]; labels: Set<string> }>();
    const missingInRuns: string[] = [];
    const changes: { from: string; to: string; added: string[]; removed: string[] }[] = [];
    let previous: { run: string; columns: readonly string[] } | null = null;
    for (const run of runs) {
      const file = run.files.find((f) => f.path === path && f.kind === 'table');
      if (file === undefined || file.columns === null) { missingInRuns.push(runKey(run)); continue; }
      const print = shapeFingerprint(file.columns);
      const entry = shapes.get(print) ?? { columns: file.columns, runs: [], labels: new Set<string>() };
      entry.runs.push(runKey(run));
      entry.labels.add(run.label);
      shapes.set(print, entry);
      if (previous !== null && shapeFingerprint(previous.columns) !== print) {
        const diff = columnDiff(file.columns, previous.columns);
        changes.push({ from: previous.run, to: runKey(run), added: diff.unexpected, removed: diff.missing });
      }
      previous = { run: runKey(run), columns: file.columns };
    }
    return {
      path,
      known: knownShapes.length > 0,
      missingInRuns: shapes.size === 0 && knownShapes.length > 0 ? runs.map(runKey) : missingInRuns,
      shapes: [...shapes.entries()].map(([print, entry]) => {
        const isKnown = knownShapes.some((shape) => shape.fingerprint === print);
        // Against the nearest known shape: the one sharing the most columns.
        const nearest = [...knownShapes].sort((a, b) => b.columns.filter((c) => entry.columns.includes(c)).length - a.columns.filter((c) => entry.columns.includes(c)).length)[0];
        const diff = isKnown || nearest === undefined ? { missing: [], unexpected: [] } : columnDiff(entry.columns, nearest.columns);
        return { fingerprint: print, columnCount: entry.columns.length, known: isKnown, runs: entry.runs, labels: [...entry.labels].sort(), missingColumns: diff.missing, unexpectedColumns: diff.unexpected };
      }),
      changes,
    };
  });

  const labels = [...new Set(runs.map((run) => run.label))].sort().map((label) => {
    const labelled = runs.filter((run) => run.label === label);
    const filesWithSeveralShapes: Record<string, number> = {};
    for (const path of tablePaths) {
      const prints = new Set(labelled.flatMap((run) => run.files.filter((f) => f.path === path && f.columns !== null).map((f) => shapeFingerprint(f.columns!))));
      if (prints.size > 1) filesWithSeveralShapes[path] = prints.size;
    }
    return { label, runs: labelled.map(runKey), filesWithSeveralShapes };
  });

  const byFile = tablePaths.map((path) => {
    const all = runs.flatMap((run) => run.files.filter((f) => f.path === path));
    const columns = new Map<string, number>();
    for (const file of all) for (const [column, count] of Object.entries(file.emptyByColumn)) columns.set(column, (columns.get(column) ?? 0) + count);
    return {
      path,
      ambiguousCells: all.reduce((sum, file) => sum + file.emptyCells, 0),
      malformedRows: all.reduce((sum, file) => sum + (file.malformedRows ?? 0), 0),
      columns: [...columns.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([column, ambiguousCells]) => ({ column, ambiguousCells })),
    };
  }).filter((file) => file.ambiguousCells > 0 || file.malformedRows > 0);

  const unknownShapes = files.some((file) => file.shapes.some((shape) => !shape.known)) || !catalog.known || files.some((file) => file.known && file.shapes.length === 0);
  return {
    ...base,
    drift: unknownShapes ? 'UNKNOWN_SHAPES' : 'NO_UNKNOWN_SHAPES',
    runsUnreadable: null,
    runs: runs.map(runKey),
    labels,
    files,
    textFiles: [...new Set(runs.flatMap((run) => run.files.filter((f) => f.kind !== 'table').map((f) => f.path)))].sort(),
    ambiguity: {
      nullRenderings: [...new Set(runs.map((run) => run.nullRendering ?? 'Unknown (not recorded)'))].sort(),
      ambiguousCells: byFile.reduce((sum, file) => sum + file.ambiguousCells, 0),
      byFile,
    },
  };
}

/** The shapes a snapshot carries, as the baseline later snapshots are compared against. */
export function recordArchiveKnownShapes(snapshot: ArchiveShapeSnapshot, recordedFrom: string): ArchiveKnownShapes {
  if (snapshot.runs === null) throw new Error(`archive_shapes_unreadable: ${snapshot.runsUnreadable}`);
  const files: Record<string, { fingerprint: string; columns: readonly string[]; firstSeen: string; labels: string[] }[]> = {};
  for (const run of [...snapshot.runs].sort(byRun)) {
    for (const file of run.files) {
      if (file.kind !== 'table' || file.columns === null) continue;
      const shapes = (files[file.path] ??= []);
      const print = shapeFingerprint(file.columns);
      const existing = shapes.find((shape) => shape.fingerprint === print);
      if (existing === undefined) shapes.push({ fingerprint: print, columns: file.columns, firstSeen: runKey(run), labels: [run.label] });
      else if (!existing.labels.includes(run.label)) existing.labels.push(run.label);
    }
  }
  const tables = [...snapshot.catalog].sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`));
  return { format: ARCHIVE_KNOWN_SHAPES_FORMAT, recordedFrom, catalog: { fingerprint: catalogFingerprint(tables), tables }, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
}

/* ----------------------------------------------------------------- rendering */

export function renderArchiveShapeDrift(report: ArchiveShapeDriftReport): string {
  const lines: string[] = [];
  lines.push(`COMPATIBILITY: ${report.compatibility}`);
  lines.push(`  ${report.compatibilityBasis}`);
  lines.push(`DRIFT: ${report.drift}`);
  const c = report.catalog;
  lines.push(`CATALOG: ${c.known ? 'known shape' : 'UNKNOWN SHAPE'} (${c.fingerprint.slice(0, 19)}…)`);
  for (const [name, list] of [['missing tables', c.missingTables], ['unexpected tables', c.unexpectedTables], ['missing columns', c.missingColumns], ['unexpected columns', c.unexpectedColumns], ['changed columns', c.changedColumns]] as const) {
    if (list.length > 0) lines.push(`  ${name}: ${list.join(', ')}`);
  }
  if (report.runsUnreadable !== null) { lines.push(`RUN SHAPES: UNREADABLE — ${report.runsUnreadable}`); return `${lines.join('\n')}\n`; }
  lines.push(`RUNS: ${report.runs.length} (${report.runs.join(', ')})`);
  for (const label of report.labels) {
    const several = Object.entries(label.filesWithSeveralShapes);
    lines.push(`LABEL ${label.label}: ${label.runs.length} run(s); ${several.length === 0 ? 'one shape per file' : `covers several shapes of ${several.map(([path, n]) => `${path} (${n})`).join(', ')} — the label does not identify a shape`}`);
  }
  for (const file of report.files) {
    const unknown = file.shapes.filter((shape) => !shape.known);
    if (file.shapes.length === 1 && unknown.length === 0 && file.missingInRuns.length === 0) continue;
    lines.push(`FILE ${file.path}: ${file.shapes.length} shape(s)${file.known ? '' : ' — NOT IN THE KNOWN SHAPES'}${file.missingInRuns.length > 0 ? `; absent in ${file.missingInRuns.join(', ')}` : ''}`);
    for (const shape of file.shapes) {
      lines.push(`  ${shape.known ? 'known  ' : 'UNKNOWN'} ${shape.columnCount} columns ${shape.fingerprint.slice(7, 19)} in ${shape.runs.join(', ')}`);
      if (shape.missingColumns.length > 0) lines.push(`    missing vs nearest known: ${shape.missingColumns.join(', ')}`);
      if (!shape.known && shape.unexpectedColumns.length > 0) lines.push(`    unexpected vs nearest known: ${shape.unexpectedColumns.join(', ')}`);
    }
    for (const change of file.changes) lines.push(`  ${change.from} → ${change.to}: +${change.added.length} [${change.added.join(', ')}] -${change.removed.length} [${change.removed.join(', ')}]`);
  }
  lines.push(`AMBIGUOUS NULL/EMPTY: ${report.ambiguity.ambiguousCells} cell(s); recorded rendering: ${report.ambiguity.nullRenderings.join(' | ')}`);
  for (const file of report.ambiguity.byFile) {
    lines.push(`  ${file.path}: ${file.ambiguousCells} ambiguous${file.malformedRows > 0 ? `, ${file.malformedRows} malformed row(s)` : ''}; ${file.columns.slice(0, 6).map((col) => `${col.column} ${col.ambiguousCells}`).join(', ')}${file.columns.length > 6 ? ', …' : ''}`);
  }
  lines.push('Each ambiguous cell is neither Unknown nor empty until an exporter says which: julius-paid-run-archive-export.v1 requires explicit nulls.');
  return `${lines.join('\n')}\n`;
}

/* ----------------------------------------------------------------------- CLI */

export interface ShapeDriftCliIo {
  readonly query: ReadOnlyJsonQuery | null;
  readonly readText: (path: string) => string;
  readonly writeText: (path: string, text: string) => void;
  readonly write: (text: string) => void;
}

const USAGE = 'usage: julius-archive-shape-drift [--known <known-shapes.json>] [--json] [--record-known <file>]';

/** exit 0: read, no unknown shapes (compatibility still NOT ESTABLISHED); 1: drift or unreadable run shapes; 2: usage or the archive could not be read. */
export async function runArchiveShapeDrift(argv: readonly string[], io: ShapeDriftCliIo): Promise<number> {
  let knownPath: string | null = null;
  let recordPath: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--known' && argv[i + 1] !== undefined) knownPath = argv[i += 1]!;
    else if (arg === '--record-known' && argv[i + 1] !== undefined) recordPath = argv[i += 1]!;
    else { io.write(`${USAGE}\n`); return 2; }
  }
  if (io.query === null) { io.write(`COMPATIBILITY: ${COMPATIBILITY_NOT_ESTABLISHED}\nthe archive could not be reached: set JULIUS_ARCHIVE_DATABASE_URL, or JULIUS_ARCHIVE_CONTAINER for a local container\n`); return 2; }
  let known: ArchiveKnownShapes | null = null;
  if (knownPath !== null) {
    try {
      known = JSON.parse(io.readText(knownPath)) as ArchiveKnownShapes;
      if (known.format !== ARCHIVE_KNOWN_SHAPES_FORMAT) throw new Error(`not ${ARCHIVE_KNOWN_SHAPES_FORMAT}`);
    } catch (error) { io.write(`cannot read known shapes ${knownPath}: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`); return 2; }
  }
  let snapshot: ArchiveShapeSnapshot;
  try { snapshot = await readArchiveShapeSnapshot(io.query); } catch (error) {
    io.write(`COMPATIBILITY: ${COMPATIBILITY_NOT_ESTABLISHED}\nthe archive could not be read: ${error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'unknown'}\n`);
    return 2;
  }
  if (recordPath !== null) {
    if (snapshot.runs === null) { io.write(`COMPATIBILITY: ${COMPATIBILITY_NOT_ESTABLISHED}\nnothing recorded: ${snapshot.runsUnreadable}\n`); return 1; }
    const recorded = recordArchiveKnownShapes(snapshot, `${snapshot.runs.length} run(s): ${snapshot.runs.map(runKey).join(', ')}`);
    io.writeText(recordPath, `${JSON.stringify(recorded, null, 2)}\n`);
    known ??= recorded;
  }
  const report = diagnoseArchiveShapeDrift(snapshot, known);
  io.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderArchiveShapeDrift(report));
  return report.drift === 'NO_UNKNOWN_SHAPES' ? 0 : 1;
}
