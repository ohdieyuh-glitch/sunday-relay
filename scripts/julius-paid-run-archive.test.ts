import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error — a plain ESM script without declarations; its exports are exercised directly.
import * as archive from './julius-paid-run-archive.mjs';

/**
 * THE PAID-RUN ARCHIVE, HELD TO WHAT IT CLAIMS WITHOUT A DATABASE.
 *
 * The importer's database effects were proven against the real local
 * `julius-postgres` (named volume `julius-postgres-data`) when attempts 1–4
 * were imported: a duplicate import answered ALREADY_ARCHIVED with no new row, a
 * conflicting bundle for the same workflow run attempt was refused
 * ARCHIVE_CONFLICT, a restart and a container recreate kept all four runs, and
 * the scan of the stored archive found no credential shape. What CI can hold
 * without Docker is here: the parsing, the identity, the refusals that happen
 * before anything is persisted, and the workflow export the importer depends on.
 */

const ROOT = resolve(import.meta.dirname, '..');
const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const bundle = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'julius-archive-test-'));
  scratch.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
};

const META = {
  workflow_run_id: 34774471909, workflow_run_attempt: 1, repository: 'ohdieyuh-glitch/sunday-relay',
  display_title: 'julius mission=julius-continuous-1 lane=qualification mode=paid key=k', mission: 'julius-continuous-1',
  lane: 'qualification', mode: 'paid', dispatch_key: 'k', accepted_main_sha: '44fd503a72993a34cd73c5cf948021cab4349218',
  conclusion: 'failure', failed_steps: [], run_created_at: '2026-09-13T18:20:00Z', run_updated_at: '2026-09-13T19:12:00Z',
  execution_mode: 'GITHUB_HOSTED_EXPORT_IMPORT', state_mode: 'FRESH', state_mode_basis: 'fresh disposable database',
};
const TASKS = 'task_id\ttask_type\trole\tstate\nrun:x:plan\tplan\tPROMPT_ARCHITECT\tSUCCEEDED\n(1 row)\n';
const RUNS = 'run_id\tmission_id\tstate\nrun:e6814f7ce2167785052595c6\tmission:julius-continuous-1\tREADY\n(1 row)\n';

describe('the bundle is read truthfully', () => {
  it('parses a psql unaligned dump: header, rows, footer dropped, blank kept blank', () => {
    const table = archive.parseTsv('a\tb\tc\n1\t\t3\n(1 row)\n');
    expect(table).toEqual({ status: 'READ', columns: ['a', 'b', 'c'], rows: [{ a: '1', b: '', c: '3' }], malformed: 0 });
  });

  it('counts a malformed row rather than padding it, and names an unavailable dump', () => {
    expect(archive.parseTsv('a\tb\n1\n2\t3\n').malformed).toBe(1);
    expect(archive.parseTsv('unavailable\n').status).toBe('UNAVAILABLE');
    expect(archive.parseTsv('').status).toBe('EMPTY');
  });

  it('keys identity on the workflow run attempt and the bundle digest, never the Julius run id', () => {
    const dir = bundle({ 'tasks.tsv': TASKS, 'runs.tsv': RUNS, 'live-mission.evidence.txt': 'RESULT: READY\n' });
    const document = archive.buildDocument({ meta: META, bundleDir: dir });
    expect(document.run.workflow_run_id).toBe(34774471909);
    expect(document.run.workflow_run_attempt).toBe(1);
    expect(document.run.julius_run_id).toBe('run:e6814f7ce2167785052595c6');
    expect(document.run.artifact_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(document.run.state_mode).toBe('FRESH');
    // The same bytes give the same digest; one changed byte gives another.
    expect(archive.buildDocument({ meta: META, bundleDir: dir }).run.artifact_digest).toBe(document.run.artifact_digest);
    const changed = bundle({ 'tasks.tsv': TASKS, 'runs.tsv': RUNS, 'live-mission.evidence.txt': 'RESULT: FAILED\n' });
    expect(archive.buildDocument({ meta: META, bundleDir: changed }).run.artifact_digest).not.toBe(document.run.artifact_digest);
    // Tables become rows; text is kept whole.
    const tasks = document.files.find((file: { path: string }) => file.path === 'tasks.tsv');
    expect(tasks.rows).toHaveLength(1);
    const text = document.files.find((file: { path: string }) => file.path === 'live-mission.evidence.txt');
    expect(text.content).toBe('RESULT: READY\n');
  });
});

describe('nothing is persisted that should not be', () => {
  it('refuses a bundle that is not live evidence', () => {
    expect(() => archive.buildDocument({ meta: META, bundleDir: bundle({ 'notes.txt': 'hello' }) })).toThrow('archive_bundle_invalid');
  });

  it('refuses credential-shaped content anywhere, naming the file and never the value', () => {
    const key = ['sk', 'ant', 'A'.repeat(24)].join('-');
    const dir = bundle({ 'tasks.tsv': TASKS, 'executor-diagnostics.txt': `leaked=${key}\n` });
    let message = '';
    try { archive.buildDocument({ meta: META, bundleDir: dir }); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('archive_refused_credential_shaped_material');
    expect(message).toContain('executor-diagnostics.txt');
    expect(message).not.toContain(key);
  });

  it.each([
    ['an Anthropic key', ['sk', 'ant', 'x'.repeat(20)].join('-')],
    ['an xAI key', ['xai', 'y'.repeat(20)].join('-')],
    ['a GitHub token', `ghp_${'z'.repeat(20)}`],
    ['a bearer header', `Authorization: Bearer ${'q'.repeat(24)}`],
    // Assembled at runtime, so the repository's own secret scanner stays useful.
    ['a connection string with a password', ['postgresql:', '', 'julius:FAKETESTNOTREAL@127.0.0.1:5432', 'julius'].join('/')],
    ['a private key', ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ')],
  ])('recognises %s', (_label, value) => {
    expect(archive.credentialShapesIn(value).length).toBeGreaterThan(0);
  });

  it('refuses an undeclared state mode', () => {
    const dir = bundle({ 'tasks.tsv': TASKS });
    expect(() => archive.buildDocument({ meta: { ...META, state_mode: 'WHATEVER' }, bundleDir: dir })).toThrow('archive_state_mode_invalid');
    expect(archive.STATE_MODES).toEqual(['FRESH', 'CONTINUATION', 'LEARNING', 'REGRESSION']);
  });

  it('the schema keys every table on the workflow run attempt and refuses a different artifact for the same key', () => {
    const sql = archive.SCHEMA_SQL as string;
    expect(sql).toContain('PRIMARY KEY (workflow_run_id, workflow_run_attempt)');
    expect(sql).toContain('PRIMARY KEY (workflow_run_id, workflow_run_attempt, path)');
    expect(sql).toContain('PRIMARY KEY (workflow_run_id, workflow_run_attempt, source_file, row_number)');
    expect(sql).toContain("RETURN 'ALREADY_ARCHIVED'");
    expect(sql).toContain('ARCHIVE_CONFLICT');
    expect(sql).not.toMatch(/PRIMARY KEY \(julius_run_id/u);
  });
});

describe('the workflow exports before it destroys, and says whether it did', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/julius-first-live-mission.yml'), 'utf8');
  const upload = workflow.indexOf('name: julius-live-evidence\n');
  const marker = workflow.indexOf("name: \"Archive export: say whether this run's state was preserved\"");
  const destroy = workflow.indexOf('- name: Destroy everything this job created');

  it('uploads the evidence with a 90-day retention, always', () => {
    const block = workflow.slice(workflow.lastIndexOf('- uses: actions/upload-artifact', upload), upload + 200);
    expect(block).toContain('id: evidence_upload');
    expect(block).toContain('if: always()');
    expect(block).toContain('retention-days: 90');
  });

  it('records PRESERVED or PAID_RUN_ARCHIVE_FAILED after the upload and before teardown', () => {
    expect(upload).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(upload);
    expect(destroy).toBeGreaterThan(marker);
    const step = workflow.slice(marker, destroy);
    expect(step).toContain('if: always()');
    expect(step).toContain('steps.evidence_upload.outcome');
    expect(step).toContain('PAID_RUN_ARCHIVE_EXPORTED');
    expect(step).toContain('PAID_RUN_ARCHIVE_FAILED');
    // An upload of nothing succeeds, so success alone is never called preservation.
    expect(step).toContain('julius-live-evidence/tasks.tsv');
  });
});
