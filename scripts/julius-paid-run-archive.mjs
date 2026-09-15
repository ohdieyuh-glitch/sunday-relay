#!/usr/bin/env node
/**
 * THE TEMPORARY JULIUS PAID-RUN ARCHIVE, until Project Brain can ingest live history.
 *
 * A paid run executes on a GitHub-hosted runner whose PostgreSQL is destroyed
 * with the job. What survives is the redacted evidence artifact the workflow
 * uploads before teardown (`julius-live-evidence`: the allowlisted TSV dumps of
 * the run database plus its evidence transcripts, already refused if a
 * credential shape or a live credential value appears). This is the local half
 * of the bridge: download that artifact, validate it, scan it again, and import
 * it into the `julius_archive` database of the local `julius-postgres`
 * container, whose data lives on the named volume `julius-postgres-data`.
 *
 * IDENTITY IS THE WORKFLOW RUN AND ITS ATTEMPT, NEVER THE JULIUS RUN. The Julius
 * run id is derived from the mission contract, so qualification attempts 2 and 3
 * both carry `run:5408584e00ffb49fd1c011a1`. Every row is keyed by
 * (workflow_run_id, workflow_run_attempt), so "show me attempt 3" cannot mix in
 * attempt 2.
 *
 * STORAGE IS NOT RETRIEVAL AUTHORITY. Everything is kept; nothing here injects
 * archived state into a mission. Each run records its state mode: a GitHub-hosted
 * run starts from a freshly migrated database, so FRESH.
 *
 * DELIBERATELY TRANSITIONAL. Rows are kept as JSON beside their source file,
 * digest and provenance, so the Project Brain importer
 * (`julius-paid-run-archive-export.v1`, owned by that lane) can be fed without
 * inventing history. This schema is not the Brain's.
 *
 *   node scripts/julius-paid-run-archive.mjs import --run <github run id> [--attempt <n>] [--bundle <dir>] [--receipt <file>] [--campaign <id>] [--classification <label>]
 *   node scripts/julius-paid-run-archive.mjs list
 *   node scripts/julius-paid-run-archive.mjs show --run <github run id> [--attempt <n>]
 *   node scripts/julius-paid-run-archive.mjs scan
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARCHIVE_VERSION = 'julius-paid-run-archive.v1';
const REPO = process.env.JULIUS_ARCHIVE_REPO ?? 'ohdieyuh-glitch/sunday-relay';
const CONTAINER = process.env.JULIUS_ARCHIVE_CONTAINER ?? 'julius-postgres';
const DATABASE = process.env.JULIUS_ARCHIVE_DATABASE ?? 'julius_archive';
const ARTIFACT = 'julius-live-evidence';
export const STATE_MODES = Object.freeze(['FRESH', 'CONTINUATION', 'LEARNING', 'REGRESSION']);

/**
 * CREDENTIAL SHAPES. The workflow's own (`Refuse to publish evidence that
 * contains credential material`) plus a few more. Anything matching is refused
 * with its file named, never redacted in: a bundle that carries a credential is
 * a defect to fix upstream, not a row to store.
 */
export const CREDENTIAL_SHAPES = Object.freeze([
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/u,
  /xai-[A-Za-z0-9_-]{16,}/u,
  /gh[pousr]_[A-Za-z0-9]{16,}/u,
  /github_pat_[A-Za-z0-9_]{20,}/u,
  /BEGIN [A-Z ]*PRIVATE KEY/u,
  /Authorization:\s*(?:[A-Za-z]+\s+)?[A-Za-z0-9._-]{16,}/u,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/u,
  /PGPASSWORD=\S+/u,
]);

export const credentialShapesIn = (text) => CREDENTIAL_SHAPES.filter((shape) => shape.test(text)).map((shape) => shape.source);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Every file under a bundle, sorted by path, with its bytes and digest. */
export function bundleFiles(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(dir);
  return out.map((path) => {
    const bytes = readFileSync(path);
    return { path: relative(dir, path).split('\\').join('/'), bytes, sha256: sha256(bytes) };
  });
}

/** The artifact's identity: a digest over every (path, file digest) pair, in path order. */
export const bundleDigest = (files) => sha256(files.map((file) => `${file.path}\0${file.sha256}`).join('\n'));

/**
 * A `psql -A -F '\t'` dump: header, rows, `(N rows)` footer. An empty field stays
 * the empty string: in that output mode a SQL NULL and an empty string render
 * alike, and the archive records that it cannot tell them apart rather than
 * choosing.
 */
export function parseTsv(text) {
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line.length > 0);
  if (lines.length === 0) return { status: 'EMPTY', columns: [], rows: [], malformed: 0 };
  if (lines.length === 1 && lines[0].trim() === 'unavailable') return { status: 'UNAVAILABLE', columns: [], rows: [], malformed: 0 };
  const columns = lines[0].split('\t');
  const rows = [];
  let malformed = 0;
  for (const line of lines.slice(1)) {
    if (/^\(\d+ rows?\)$/u.test(line.trim())) continue;
    const fields = line.split('\t');
    if (fields.length !== columns.length) { malformed += 1; continue; }
    rows.push(Object.fromEntries(columns.map((column, index) => [column, fields[index]])));
  }
  return { status: 'READ', columns, rows, malformed };
}

/**
 * THE IMPORT DOCUMENT for one workflow run attempt. Refuses a bundle that is not
 * a live-evidence bundle, and refuses any credential-shaped content before a
 * single byte is persisted.
 */
export function buildDocument({ meta, bundleDir, receipt, campaign, classification }) {
  const files = bundleFiles(bundleDir);
  if (files.length === 0) throw new Error('archive_bundle_empty');
  if (!files.some((file) => file.path.endsWith('tasks.tsv'))) throw new Error('archive_bundle_invalid: no tasks.tsv, this is not a julius-live-evidence bundle');
  const leaks = [];
  const documentFiles = files.map((file) => {
    const text = file.bytes.toString('utf8');
    for (const shape of credentialShapesIn(text)) leaks.push({ path: file.path, shape });
    if (file.path.endsWith('.tsv')) {
      const table = parseTsv(text);
      return { path: file.path, sha256: file.sha256, bytes: file.bytes.length, kind: 'table', table_status: table.status, columns: table.columns, malformed_rows: table.malformed, rows: table.rows, content: null };
    }
    return { path: file.path, sha256: file.sha256, bytes: file.bytes.length, kind: 'text', table_status: null, columns: null, malformed_rows: null, rows: [], content: text };
  });
  if (receipt !== undefined) for (const shape of credentialShapesIn(receipt)) leaks.push({ path: 'receipt', shape });
  if (leaks.length > 0) {
    throw new Error(`archive_refused_credential_shaped_material: ${leaks.length} match(es) in ${[...new Set(leaks.map((leak) => leak.path))].join(', ')}`);
  }
  if (!STATE_MODES.includes(meta.state_mode)) throw new Error(`archive_state_mode_invalid: ${String(meta.state_mode)}`);
  const runs = documentFiles.find((file) => file.path.endsWith('runs.tsv'))?.rows ?? [];
  return {
    run: {
      ...meta,
      julius_run_id: runs[0]?.run_id ?? null,
      julius_mission_id: runs[0]?.mission_id ?? null,
      julius_final_state: runs[0]?.state ?? null,
      campaign_id: campaign ?? null,
      classification: classification ?? (meta.lane ?? null),
      artifact_name: ARTIFACT,
      artifact_digest: bundleDigest(files),
      file_count: files.length,
      total_bytes: files.reduce((sum, file) => sum + file.bytes.length, 0),
      null_rendering: 'psql -A -F tab: an empty field is a SQL NULL or an empty string, indistinguishably',
      receipt_markdown: receipt ?? null,
      archive_version: ARCHIVE_VERSION,
    },
    files: documentFiles,
  };
}

export const SCHEMA_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS paid_runs;
CREATE TABLE IF NOT EXISTS paid_runs.runs (
  workflow_run_id bigint NOT NULL,
  workflow_run_attempt integer NOT NULL,
  repository text NOT NULL,
  display_title text,
  mission text,
  lane text,
  mode text,
  dispatch_key text,
  classification text,
  campaign_id text,
  accepted_main_sha text NOT NULL CHECK (accepted_main_sha ~ '^[0-9a-f]{40}$'),
  julius_run_id text,
  julius_mission_id text,
  julius_final_state text,
  conclusion text,
  failed_steps jsonb NOT NULL DEFAULT '[]',
  run_created_at timestamptz,
  run_updated_at timestamptz,
  execution_mode text NOT NULL CHECK (execution_mode IN ('GITHUB_HOSTED_EXPORT_IMPORT', 'LOCAL_DIRECT')),
  state_mode text NOT NULL CHECK (state_mode IN ('FRESH', 'CONTINUATION', 'LEARNING', 'REGRESSION')),
  state_mode_basis text NOT NULL,
  artifact_name text NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
  file_count integer NOT NULL,
  total_bytes bigint NOT NULL,
  null_rendering text NOT NULL,
  receipt_markdown text,
  archive_version text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_run_id, workflow_run_attempt)
);
CREATE TABLE IF NOT EXISTS paid_runs.files (
  workflow_run_id bigint NOT NULL,
  workflow_run_attempt integer NOT NULL,
  path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('table', 'text')),
  table_status text,
  columns jsonb,
  malformed_rows integer,
  content text,
  PRIMARY KEY (workflow_run_id, workflow_run_attempt, path),
  FOREIGN KEY (workflow_run_id, workflow_run_attempt) REFERENCES paid_runs.runs ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS paid_runs.table_rows (
  workflow_run_id bigint NOT NULL,
  workflow_run_attempt integer NOT NULL,
  source_file text NOT NULL,
  row_number integer NOT NULL,
  row jsonb NOT NULL,
  PRIMARY KEY (workflow_run_id, workflow_run_attempt, source_file, row_number),
  FOREIGN KEY (workflow_run_id, workflow_run_attempt, source_file) REFERENCES paid_runs.files (workflow_run_id, workflow_run_attempt, path) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION paid_runs.ingest(document jsonb) RETURNS text LANGUAGE plpgsql AS $ingest$
DECLARE
  existing text;
  run jsonb := document->'run';
  file jsonb;
  run_id bigint := (document->'run'->>'workflow_run_id')::bigint;
  attempt integer := (document->'run'->>'workflow_run_attempt')::integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(run_id::text || ':' || attempt::text, 0));
  SELECT artifact_digest INTO existing FROM paid_runs.runs WHERE workflow_run_id = run_id AND workflow_run_attempt = attempt;
  IF existing IS NOT NULL THEN
    IF existing = run->>'artifact_digest' THEN RETURN 'ALREADY_ARCHIVED'; END IF;
    RAISE EXCEPTION 'ARCHIVE_CONFLICT: workflow run % attempt % is archived with artifact digest %, refusing a different one', run_id, attempt, existing;
  END IF;
  INSERT INTO paid_runs.runs (workflow_run_id, workflow_run_attempt, repository, display_title, mission, lane, mode, dispatch_key,
    classification, campaign_id, accepted_main_sha, julius_run_id, julius_mission_id, julius_final_state, conclusion, failed_steps,
    run_created_at, run_updated_at, execution_mode, state_mode, state_mode_basis, artifact_name, artifact_digest, file_count,
    total_bytes, null_rendering, receipt_markdown, archive_version)
  VALUES (run_id, attempt, run->>'repository', run->>'display_title', run->>'mission', run->>'lane', run->>'mode', run->>'dispatch_key',
    run->>'classification', run->>'campaign_id', run->>'accepted_main_sha', run->>'julius_run_id', run->>'julius_mission_id',
    run->>'julius_final_state', run->>'conclusion', COALESCE(run->'failed_steps', '[]'::jsonb), (run->>'run_created_at')::timestamptz,
    (run->>'run_updated_at')::timestamptz, run->>'execution_mode', run->>'state_mode', run->>'state_mode_basis', run->>'artifact_name',
    run->>'artifact_digest', (run->>'file_count')::integer, (run->>'total_bytes')::bigint, run->>'null_rendering',
    run->>'receipt_markdown', run->>'archive_version');
  FOR file IN SELECT value FROM jsonb_array_elements(document->'files') LOOP
    INSERT INTO paid_runs.files (workflow_run_id, workflow_run_attempt, path, sha256, bytes, kind, table_status, columns, malformed_rows, content)
    VALUES (run_id, attempt, file->>'path', file->>'sha256', (file->>'bytes')::bigint, file->>'kind', file->>'table_status',
      file->'columns', (file->>'malformed_rows')::integer, file->>'content');
    INSERT INTO paid_runs.table_rows (workflow_run_id, workflow_run_attempt, source_file, row_number, row)
    SELECT run_id, attempt, file->>'path', (ordinality - 1)::integer, value
      FROM jsonb_array_elements(COALESCE(file->'rows', '[]'::jsonb)) WITH ORDINALITY;
  END LOOP;
  RETURN 'ARCHIVED';
END
$ingest$;
`;

/* ------------------------------------------------------------------ effects */

const psql = (sql, { database = DATABASE, input } = {}) => {
  const args = ['exec', '-i', CONTAINER, 'psql', '-U', 'julius', '-d', database, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At'];
  const result = spawnSync('docker', input === undefined ? [...args, '-c', sql] : args, {
    input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (result.error) throw new Error(`archive_docker_unavailable: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`archive_psql_failed: ${(result.stderr || '').trim().slice(0, 500)}`);
  return result.stdout;
};

export function ensureArchive() {
  const exists = psql(`SELECT 1 FROM pg_database WHERE datname = '${DATABASE}'`, { database: 'julius' }).trim();
  if (exists !== '1') psql(`CREATE DATABASE ${DATABASE}`, { database: 'julius' });
  psql('', { input: SCHEMA_SQL });
}

/** One transaction: the document arrives base64 through COPY, so no content is ever spliced into SQL. */
export function ingest(document) {
  const payload = Buffer.from(JSON.stringify(document), 'utf8').toString('base64');
  const script = [
    'BEGIN;',
    'CREATE TEMP TABLE archive_payload (payload text) ON COMMIT DROP;',
    'COPY archive_payload (payload) FROM STDIN;',
    payload,
    '\\.',
    "SELECT paid_runs.ingest(convert_from(decode(payload, 'base64'), 'UTF8')::jsonb) FROM archive_payload;",
    'COMMIT;',
    '',
  ].join('\n');
  return psql('', { input: script }).trim();
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** What GitHub says the run was, for one attempt. */
export function githubRun(runId, attempt) {
  const run = JSON.parse(gh(['api', `repos/${REPO}/actions/runs/${runId}${attempt === undefined ? '' : `/attempts/${attempt}`}`]));
  const jobs = JSON.parse(gh(['api', `repos/${REPO}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=50`])).jobs ?? [];
  const hosted = jobs.length > 0 && jobs.every((job) => job.runner_group_name === 'GitHub Actions'
    || (job.labels ?? []).some((label) => /^(ubuntu|windows|macos)-/u.test(label)));
  const title = String(run.display_title ?? '');
  const field = (name) => (new RegExp(`${name}=(\\S+)`, 'u').exec(title) ?? [])[1] ?? null;
  return {
    workflow_run_id: run.id,
    workflow_run_attempt: run.run_attempt,
    repository: REPO,
    display_title: title,
    mission: field('mission'), lane: field('lane'), mode: field('mode'), dispatch_key: field('key'),
    accepted_main_sha: run.head_sha,
    conclusion: run.conclusion,
    failed_steps: jobs.flatMap((job) => (job.steps ?? []).filter((step) => step.conclusion === 'failure').map((step) => `${job.name}: ${step.name}`)),
    run_created_at: run.run_started_at ?? run.created_at,
    run_updated_at: run.updated_at,
    execution_mode: hosted ? 'GITHUB_HOSTED_EXPORT_IMPORT' : 'LOCAL_DIRECT',
    state_mode: 'FRESH',
    state_mode_basis: hosted
      ? 'GitHub-hosted job with a freshly migrated disposable PostgreSQL; no archived state was imported into it'
      : 'not a GitHub-hosted run; state mode unverified',
  };
}

const option = (argv, name) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; };
const integer = (value, name) => { if (!/^\d+$/u.test(value ?? '')) throw new Error(`archive_${name}_invalid`); return value; };

function main(argv) {
  const command = argv[0];
  if (command === 'import') {
    const runId = integer(option(argv, 'run'), 'run');
    const attempt = option(argv, 'attempt');
    const meta = githubRun(runId, attempt === undefined ? undefined : integer(attempt, 'attempt'));
    if (meta.execution_mode !== 'GITHUB_HOSTED_EXPORT_IMPORT') {
      throw new Error('archive_local_direct_not_supported: this run did not execute on a GitHub-hosted runner; archive its database directly rather than through an artifact');
    }
    let bundleDir = option(argv, 'bundle');
    let scratch = null;
    /**
     * A RE-RUN'S ARTIFACT CANNOT BE CHOSEN BY ATTEMPT. `gh run download` has no
     * attempt selector, so for a run with more than one attempt the bundle it
     * fetches may belong to a different attempt than the metadata recorded,
     * archiving one attempt's evidence under another's key. Refuse, and ask for
     * the bundle downloaded for that attempt.
     */
    if (bundleDir === undefined && (attempt !== undefined || meta.workflow_run_attempt > 1)) {
      throw new Error(`archive_attempt_artifact_ambiguous: workflow run ${runId} attempt ${meta.workflow_run_attempt} needs --bundle <dir> downloaded for that attempt`);
    }
    if (bundleDir === undefined) {
      scratch = mkdtempSync(join(tmpdir(), 'julius-archive-'));
      gh(['run', 'download', runId, '-R', REPO, '-n', ARTIFACT, '-D', scratch]);
      bundleDir = scratch;
    }
    try {
      if (!existsSync(join(bundleDir, 'tasks.tsv')) && existsSync(join(bundleDir, ARTIFACT, 'tasks.tsv'))) bundleDir = join(bundleDir, ARTIFACT);
      const receiptPath = option(argv, 'receipt');
      const document = buildDocument({
        meta, bundleDir,
        receipt: receiptPath === undefined ? undefined : readFileSync(receiptPath, 'utf8'),
        campaign: option(argv, 'campaign'), classification: option(argv, 'classification'),
      });
      ensureArchive();
      const outcome = ingest(document);
      const rows = document.files.reduce((sum, file) => sum + file.rows.length, 0);
      process.stdout.write([
        `ARCHIVE_OUTCOME=${outcome}`,
        `workflow_run_id=${meta.workflow_run_id} workflow_run_attempt=${meta.workflow_run_attempt} mission=${meta.mission} lane=${meta.lane} mode=${meta.mode} accepted_main=${meta.accepted_main_sha} state_mode=${meta.state_mode}`,
        `files=${document.files.length} table_rows=${rows} bytes=${document.run.total_bytes} artifact_digest=${document.run.artifact_digest}`,
        '',
      ].join('\n'));
    } finally {
      if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
    }
    return;
  }
  if (command === 'list') {
    ensureArchive();
    const header = 'workflow_run_id\tattempt\tmission\tlane\tmode\taccepted_main\tconclusion\tjulius_state\tstate_mode\tfiles\ttable_rows\timported_at\n';
    process.stdout.write(header + psql(`SELECT concat_ws(E'\\t', r.workflow_run_id, r.workflow_run_attempt, r.mission, r.lane, r.mode, left(r.accepted_main_sha, 12), r.conclusion, r.julius_final_state, r.state_mode, r.file_count, (SELECT count(*) FROM paid_runs.table_rows t WHERE t.workflow_run_id = r.workflow_run_id AND t.workflow_run_attempt = r.workflow_run_attempt), to_char(r.imported_at, 'YYYY-MM-DD HH24:MI:SS')) FROM paid_runs.runs r ORDER BY r.run_created_at, r.workflow_run_id, r.workflow_run_attempt`));
    return;
  }
  if (command === 'show') {
    const runId = integer(option(argv, 'run'), 'run');
    const attempt = integer(option(argv, 'attempt') ?? '1', 'attempt');
    ensureArchive();
    const run = psql(`SELECT concat_ws(E'\\n', 'workflow_run_id=' || workflow_run_id, 'workflow_run_attempt=' || workflow_run_attempt, 'mission=' || coalesce(mission, ''), 'lane=' || coalesce(lane, ''), 'campaign=' || coalesce(campaign_id, ''), 'accepted_main=' || accepted_main_sha, 'julius_run=' || coalesce(julius_run_id, ''), 'julius_state=' || coalesce(julius_final_state, ''), 'conclusion=' || coalesce(conclusion, ''), 'failed_steps=' || failed_steps::text, 'execution_mode=' || execution_mode, 'state_mode=' || state_mode, 'artifact_digest=' || artifact_digest, 'receipt=' || (receipt_markdown IS NOT NULL)) FROM paid_runs.runs WHERE workflow_run_id = ${runId} AND workflow_run_attempt = ${attempt}`);
    if (run.trim() === '') { process.stderr.write(`archive_run_not_found: ${runId} attempt ${attempt}\n`); process.exitCode = 1; return; }
    const files = psql(`SELECT concat_ws(E'\\t', f.path, f.kind, coalesce(f.table_status, ''), (SELECT count(*) FROM paid_runs.table_rows t WHERE t.workflow_run_id = f.workflow_run_id AND t.workflow_run_attempt = f.workflow_run_attempt AND t.source_file = f.path), f.bytes, left(f.sha256, 16)) FROM paid_runs.files f WHERE f.workflow_run_id = ${runId} AND f.workflow_run_attempt = ${attempt} ORDER BY f.path`);
    process.stdout.write(`${run.trim()}\n\nfile\tkind\ttable_status\trows\tbytes\tsha256\n${files}`);
    return;
  }
  if (command === 'scan') {
    ensureArchive();
    const dump = spawnSync('docker', ['exec', CONTAINER, 'pg_dump', '-U', 'julius', '-d', DATABASE, '--data-only', '--schema=paid_runs'], {
      encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
    if (dump.status !== 0) throw new Error(`archive_scan_dump_failed: ${(dump.stderr || '').trim().slice(0, 300)}`);
    const found = credentialShapesIn(dump.stdout);
    process.stdout.write(`ARCHIVE_SCAN bytes=${dump.stdout.length} credential_shapes_found=${found.length}${found.length > 0 ? ` (${found.join(' | ')})` : ''}\n`);
    if (found.length > 0) process.exitCode = 1;
    return;
  }
  throw new Error('usage: julius-paid-run-archive.mjs import --run <id> [--attempt <n>] [--bundle <dir>] [--receipt <file>] [--campaign <id>] | list | show --run <id> [--attempt <n>] | scan');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
