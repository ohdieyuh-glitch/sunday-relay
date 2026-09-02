import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * JULIUS HARNESS EXPORT — contract of the generator.
 *
 * The generator (`scripts/export-julius-harness.mjs`) is read-only tooling: it
 * discovers the production source constituting Julius from the live
 * composition roots and writes an inspection export plus the canonical
 * manifest. Nothing at runtime imports it, so the only way it can be wrong
 * quietly is for its OUTPUT to drift from the tree. These cases hold it to:
 *
 *   1. a clean run — every required subsystem mapped, no problems, no test,
 *      fixture, fake or UI file included;
 *   2. byte-for-byte fidelity, verified HERE by a second, independent parser
 *      rather than by the generator's own self-check;
 *   3. determinism — two runs are identical;
 *   4. `--check` accepts what a run produced and REFUSES a tampered export;
 *   5. the committed `JULIUS_HARNESS_MANIFEST.md` is current, so a change to
 *      Julius's production file set cannot merge without regenerating the map.
 *
 * Every case runs the real script as a child process (~3–4s each on a slow
 * host), which is why the file gets the same generous budget as the other
 * scanner suites in this directory.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const REPO_ROOT = resolve(__dirname, '..');
const GENERATOR = join(REPO_ROOT, 'scripts', 'export-julius-harness.mjs');
const REQUIRED_SUBSYSTEMS = [
  'MISSION CONTRACT / BOOTSTRAP', 'DURABLE STATE / PROJECT BRAIN', 'TASK GRAPH / SCHEDULER', 'C.A.R.D. POLICY',
  'WORKER REGISTRY / ROUTING', 'PROMPT ARCHITECT', 'CODING AGENT', 'INDEPENDENT REVIEWER', 'AGENT TURN LOOP', 'TOOLS',
  'INDEPENDENT EXECUTOR', 'ARTIFACTS / EVIDENCE', 'VERIFICATION', 'REPAIR', 'RECOVERY / CONTINUATION',
  'LEASES / BUDGETS / PERMISSIONS', 'EVENTS / TRAJECTORIES', 'PERSISTENCE', 'LIVE PROVIDER COMPOSITION', 'COMPLETION AUTHORITY',
];

interface Run { code: number; stdout: string; stderr: string }
interface JsonReport {
  status: string;
  problems: string[];
  files: { path: string; subsystem: string; role: string; lines: number; bytes: number; sha256: string }[];
  subsystems: { name: string; files: number }[];
  totals: { files: number; lines: number; bytes: number };
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync('node', [GENERATOR, ...args], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Independent reconstruction: header → BYTES → slice → compare with the working tree. */
function reconstruct(exportBuffer: Buffer): { path: string; matches: boolean }[] {
  const rule = '#'.repeat(100);
  const text = exportBuffer.toString('latin1');
  const results: { path: string; matches: boolean }[] = [];
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(`${rule}\n# FILE `, cursor);
    if (start < 0) break;
    const headerEnd = text.indexOf(`\n${rule}\n`, start + rule.length + 1);
    const header = text.slice(start, headerEnd);
    const path = /\n# PATH:\s+(.+)/.exec(header)![1];
    const bytes = Number(/BYTES: (\d+)/.exec(header)![1]);
    const contentStart = headerEnd + rule.length + 2;
    const content = exportBuffer.subarray(contentStart, contentStart + bytes);
    results.push({ path, matches: content.equals(readFileSync(join(REPO_ROOT, path))) });
    cursor = contentStart + bytes;
  }
  return results;
}

let workspace: string;
let exportPath: string;
let manifestPath: string;
let report: JsonReport;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'julius-harness-export-'));
  exportPath = join(workspace, 'JULIUS_HARNESS_SOURCE.txt');
  manifestPath = join(workspace, 'JULIUS_HARNESS_MANIFEST.md');
  const first = run(['--json', '--out', exportPath, '--manifest-out', manifestPath]);
  expect(first.code, first.stdout + first.stderr).toBe(0);
  report = JSON.parse(first.stdout) as JsonReport;
});
afterAll(() => { rmSync(workspace, { recursive: true, force: true }); });

describe('export-julius-harness generates the Julius harness export from the live roots', () => {
  it('runs clean: every required subsystem maps to a real production file and nothing excluded slips in', () => {
    expect(report.status).toBe('OK');
    expect(report.problems).toEqual([]);
    const covered = report.subsystems.filter((entry) => entry.files > 0).map((entry) => entry.name);
    expect(covered).toEqual(REQUIRED_SUBSYSTEMS);
    expect(report.files.length).toBeGreaterThan(90);
    for (const file of report.files) {
      expect(existsSync(join(REPO_ROOT, file.path)), file.path).toBe(true);
      expect(file.path, 'no test file may be exported').not.toMatch(/\.(test|spec)\.[cm]?[tj]sx?$/);
      expect(file.path, 'no UI file may be exported').not.toMatch(/\.tsx$|^src\/relay\/ui\//);
      expect(file.path, 'no fixture, fake or chaos harness may be exported').not.toMatch(/runtime-fixtures|fault-injection|fake-architect|node-tool-adapter/);
      expect(REQUIRED_SUBSYSTEMS, `${file.path} maps to a known subsystem`).toContain(file.subsystem);
    }
    expect(report.files.filter((file) => file.role === 'root').map((file) => file.path)).toEqual([
      'relay-bridge/julius-live-mission.ts',
      'src/relay/workspace/julius-tools/executor-control-plane-main.ts',
    ]);
  });

  it('preserves every included file byte-for-byte, verified by an independent parser', () => {
    const exported = readFileSync(exportPath);
    const files = reconstruct(exported);
    expect(files.length).toBe(report.files.length);
    expect(files.filter((file) => !file.matches).map((file) => file.path)).toEqual([]);
    const totalBytes = report.files.reduce((sum, file) => sum + file.bytes, 0);
    expect(report.totals.bytes).toBe(totalBytes);
    for (const file of report.files) {
      expect(createHash('sha256').update(readFileSync(join(REPO_ROOT, file.path))).digest('hex'), file.path).toBe(file.sha256);
    }
  });

  it('is deterministic and --check accepts its own output', () => {
    const secondExport = join(workspace, 'second.txt');
    const secondManifest = join(workspace, 'second.md');
    const second = run(['--out', secondExport, '--manifest-out', secondManifest]);
    expect(second.code, second.stdout + second.stderr).toBe(0);
    expect(readFileSync(secondExport).equals(readFileSync(exportPath))).toBe(true);
    expect(readFileSync(secondManifest, 'utf8')).toBe(readFileSync(manifestPath, 'utf8'));
    const check = run(['--check', '--out', exportPath, '--manifest-out', manifestPath]);
    expect(check.code, check.stdout + check.stderr).toBe(0);
    expect(check.stdout).toContain('all files reconstruct byte-for-byte');
  });

  it('--check refuses an export whose content was altered by one byte', () => {
    const tampered = Buffer.from(readFileSync(exportPath));
    const marker = Buffer.from('THE SUPPORTED LIVE JULIUS MISSION ENTRYPOINT');
    const at = tampered.indexOf(marker);
    expect(at).toBeGreaterThan(0);
    tampered[at] = tampered[at] === 0x54 ? 0x74 : 0x54; // 'T' ↔ 't' inside the entrypoint's own header comment
    const tamperedPath = join(workspace, 'tampered.txt');
    writeFileSync(tamperedPath, tampered);
    const check = run(['--check', '--out', tamperedPath, '--manifest-out', manifestPath]);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('does not match its recorded SHA256');
    expect(check.stdout).toContain('relay-bridge/julius-live-mission.ts');
  });

  it('the committed JULIUS_HARNESS_MANIFEST.md is current for this tree', () => {
    const committed = readFileSync(join(REPO_ROOT, 'JULIUS_HARNESS_MANIFEST.md'), 'utf8');
    const generated = readFileSync(manifestPath, 'utf8');
    expect(committed, 'regenerate with: node scripts/export-julius-harness.mjs').toBe(generated);
    expect(committed).toContain('## Production composition roots');
    for (const name of REQUIRED_SUBSYSTEMS) expect(committed).toContain(` ${name}\n`);
  });
});
