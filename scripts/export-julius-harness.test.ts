import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  JULIUS_SCHEMA_MIGRATIONS_BY_NAME, JULIUS_SCHEMA_MIGRATION_REASONS, NON_JULIUS_MIGRATION_DESCRIPTIONS,
  describeNonJuliusMigrations, isJuliusSchemaMigration, juliusSchemaListProblems,
} from './julius-harness-migrations.mjs';

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

/**
 * WHICH MIGRATIONS ARE JULIUS'S, AND WHAT THE MAP SAYS ABOUT THE OTHERS.
 *
 * 034_project_brain_components.sql is not named "julius", but it alters
 * 029_julius_project_brain's tables. It is Julius's schema by an EXPLICIT list,
 * pinned here, never by a wider pattern. Every other migration is described by
 * its own line. The old shared sentence credited 033 with a voice table it
 * does not create (voice is 035), and a shared line would have said the same
 * thing about 034. The describer now refuses a migration it has no line for.
 */
const MIGRATION_DIR = 'src/relay/persistence/wonderland-migrations/';
const PRE_JULIUS = [
  '001_wonderland_runtime.sql', '002_wonderland_outbox.sql', '003_wonderland_budget_reservations.sql', '004_wonderland_ratings.sql',
  '005_wonderland_inventory.sql', '006_wonderland_eval_runtime.sql', '007_wonderland_provider_operations.sql',
  '008_wonderland_swarm_scheduler.sql', '009_wonderland_gve_runs.sql', '010_wonderland_hidden_fixtures.sql',
];
const LINE_PRE = `- **pre-Julius schema** — ${PRE_JULIUS.map((name) => `\`${name}\``).join(', ')} under \`${MIGRATION_DIR}\`: registered by the same migration runner and applied in order before the Julius migrations; Julius tables reference \`relay_wonderland.projects\`, \`mission_contracts\` and \`budget_reservations\` defined there.`;
const LINE_017 = `- **non-Julius schema** — \`017_gauntlet_command.sql\` under \`${MIGRATION_DIR}\`: registered by the same migration runner, which applies every migration in numeric order; the Gauntlet Loop's own storage (\`relay_wonderland.gauntlet_runs\` and \`gauntlet_rounds\`). Its foreign keys point at \`julius_runs\` and \`julius_tasks\`, and no Julius migration references it; deliberately not Julius's.`;
const LINE_033 = `- **non-Julius schema** — \`033_wonderland_social.sql\` under \`${MIGRATION_DIR}\`: registered by the same migration runner, which applies every migration in numeric order; Wonderland Social's own storage: 17 additive \`relay_wonderland.social_*\` tables referencing only \`relay_wonderland.players\` and each other; deliberately not Julius's.`;
const LINE_035 = `- **non-Julius schema** — \`035_wonderland_voice.sql\` under \`${MIGRATION_DIR}\`: registered by the same migration runner, which applies every migration in numeric order; Wonderland party voice's own storage: 1 additive \`relay_wonderland.voice_puid_binding\` table referencing only \`relay_wonderland.players\`; deliberately not Julius's.`;
const LINE_036 = `- **non-Julius schema** — \`036_wonderfs.sql\` under \`${MIGRATION_DIR}\`: registered by the same migration runner, which applies every migration in numeric order; WonderFS's own storage (the project file system, contract r1.4): 16 additive \`relay_wonderland.wfs_*\` tables, referencing only \`relay_wonderland.projects\` outside them; deliberately not Julius's.`;
const LINE_037 = `- **non-Julius schema** — \`037_wonderland_lff.sql\` under \`${MIGRATION_DIR}\`: registered by the same migration runner, which applies every migration in numeric order; Wonderland LFF's own storage (the "Looking For Feed", a PROVISIONAL number): 4 additive \`relay_wonderland.lff_*\` tables (posts, join requests, the creation record behind the creation cap, and moderation-evidence snapshots) whose keys reference only \`relay_wonderland.players\` outside them, and 1 read-only moderation view over them and \`relay_wonderland.social_reports\`; deliberately not Julius's.`;
const MIGRATION_034 = '034_project_brain_components.sql';
/** A synthetic registration in the real shape: Julius from 011 on (034 by the list), 017, 033, 035 (voice), 036 (WonderFS) and 037 (LFF) not Julius's. */
const SHAPE = {
  julius: ['011_julius_runtime.sql', '016_julius_subagents.sql', '018_julius_lifecycle.sql', '032_julius_outbox_event_delete_forgets.sql', MIGRATION_034],
  excluded: [...PRE_JULIUS, '017_gauntlet_command.sql', '033_wonderland_social.sql', '035_wonderland_voice.sql', '036_wonderfs.sql', '037_wonderland_lff.sql'],
  dir: MIGRATION_DIR,
};

describe('the Julius schema migrations, and one true manifest line for every other migration', () => {
  it('034 is Julius schema by an explicit list of exactly one name, never by a wider pattern', () => {
    expect([...JULIUS_SCHEMA_MIGRATIONS_BY_NAME]).toEqual(['034_project_brain_components.sql']);
    expect(Object.keys(JULIUS_SCHEMA_MIGRATION_REASONS)).toEqual(['034_project_brain_components.sql']);
    expect(isJuliusSchemaMigration(MIGRATION_034)).toBe(true);
    expect(isJuliusSchemaMigration('029_julius_project_brain.sql'), 'named julius').toBe(true);
    for (const name of ['033_wonderland_social.sql', '017_gauntlet_command.sql', '035_wonderland_voice.sql', '036_wonderfs.sql', '037_wonderland_lff.sql',
      '035_project_brain_components.sql', '134_project_brain_components.sql', '034_project_brain_components_v2.sql', '034_project_brain.sql']) {
      expect(isJuliusSchemaMigration(name), name).toBe(false);
    }
    expect(juliusSchemaListProblems([...SHAPE.julius, ...SHAPE.excluded])).toEqual([]);
    expect(juliusSchemaListProblems([...PRE_JULIUS, '033_wonderland_social.sql'])).toEqual([
      'listed as a Julius schema migration but not registered by the migration runner: 034_project_brain_components.sql',
    ]);
  });

  it('every list guard fires on its own synthetic non-compliant input, and a compliant synthetic list passes', () => {
    const listed = '090_probe_components.sql';
    // CONTROL: compliant, registered, with its one reason.
    expect(juliusSchemaListProblems([listed], [listed], { [listed]: 'probe' })).toEqual([]);
    expect(juliusSchemaListProblems([], [listed], { [listed]: 'probe' })).toEqual([
      `listed as a Julius schema migration but not registered by the migration runner: ${listed}`,
    ]);
    expect(juliusSchemaListProblems(['091_julius_probe.sql'], ['091_julius_probe.sql'], { '091_julius_probe.sql': 'probe' })).toEqual([
      'listed as a Julius schema migration although its name already says "julius": 091_julius_probe.sql',
    ]);
    expect(juliusSchemaListProblems([listed], [listed], {})).toEqual([
      `listed as a Julius schema migration with no reason: ${listed}`,
    ]);
    expect(juliusSchemaListProblems([listed], [], { [listed]: 'probe' })).toEqual([
      `a Julius schema reason for a migration that is not listed: ${listed}`,
    ]);
  });

  it('the exporter CALLS the list check inside trace(), and a non-empty problems list FAILS the run (a static source binding)', () => {
    // The real tree's list is compliant, so deleting the call changes no output. Only the source can show the
    // call, and the branch that turns a problem into a failed run, are still there. Bind both, not just the name.
    const source = readFileSync(GENERATOR, 'utf8');
    const body = (name: string): string => {
      const start = source.indexOf(`\nfunction ${name}(`);
      expect(start, `function ${name} exists`).toBeGreaterThan(0);
      const next = source.indexOf('\nfunction ', start + 1);
      return source.slice(start, next < 0 ? source.indexOf('\ntry {\n', start) : next);
    };
    expect(source).toContain("  JULIUS_SCHEMA_MIGRATION_REASONS, describeNonJuliusMigrations, isJuliusSchemaMigration, juliusSchemaListProblems,\n} from './julius-harness-migrations.mjs';\n");
    expect(typeof juliusSchemaListProblems).toBe('function');
    const traced = body('trace');
    expect(traced).toContain('\n  const problems = [];\n');
    expect(traced).toContain('\n    problems.push(...juliusSchemaListProblems(names));\n');
    expect(traced.split('juliusSchemaListProblems(').length - 1, 'called exactly once, in trace()').toBe(1);
    expect(traced, 'trace() returns that same problems list').toContain('\n    files, crossings, exclusionHits, externals, problems, ');
    const main = body('main');
    expect(main).toContain('\n  const result = trace();\n');
    expect(main, 'a non-empty problems list is exit 1').toContain('\n  return result.problems.length === 0 ? 0 : 1;\n}');
    expect(source).toContain('\ntry {\n  process.exitCode = main(process.argv.slice(2));\n} catch (error) {\n');
  });

  it('the generated run carries 034 as a Julius schema asset in the file table, and the map lists it with the Julius migrations', () => {
    const path = `${MIGRATION_DIR}${MIGRATION_034}`;
    const entry = report.files.find((file) => file.path === path);
    expect(entry, '034 is in the harness file table').toBeDefined();
    expect(entry!.role).toBe('asset');
    expect(entry!.subsystem).toBe('PERSISTENCE');
    expect(entry!.sha256).toBe(createHash('sha256').update(readFileSync(join(REPO_ROOT, path))).digest('hex'));
    expect(readFileSync(manifestPath, 'utf8'))
      .toContain(`| \`${path}\` | asset (path-loaded) | \`src/relay/persistence/wonderland-postgres.ts\` |`);
    expect(reconstruct(readFileSync(exportPath)).find((file) => file.path === path), '034 reconstructs byte-for-byte from the export')
      .toEqual({ path, matches: true });
    expect(readFileSync(exportPath, 'utf8'), 'the export says why a migration not named "julius" is in it')
      .toContain(`# PATH:      ${path}\n# SUBSYSTEM: 18 PERSISTENCE\n# ROLE:      asset — ${JULIUS_SCHEMA_MIGRATION_REASONS[MIGRATION_034]}\n`);
  });

  it('the generated map: pre-Julius is 001-010 only, 017, 033, 035, 036 and 037 each get their own true line, and 034 is in neither sentence', () => {
    const lines = readFileSync(manifestPath, 'utf8').split('\n')
      .filter((line) => line.startsWith('- **pre-Julius schema**') || line.startsWith('- **non-Julius schema'));
    expect(lines).toEqual([LINE_PRE, LINE_017, LINE_033, LINE_035, LINE_036, LINE_037]);
    for (const line of lines) {
      expect(line, 'a Julius schema migration is never described as not Julius').not.toContain('034_');
      if (line !== LINE_035) expect(line, 'no voice storage exists before 035, and only 035\'s line says voice').not.toContain('voice');
      if (line !== LINE_036) expect(line, 'only 036\'s line says WonderFS').not.toContain('WonderFS');
      if (line !== LINE_037) expect(line, 'only 037\'s line says LFF').not.toContain('LFF');
    }
  });

  it('the describer gives 033, 035, 036 and 037 their exact lines, and the K2 knock-on cannot pull 033 into "pre-Julius"', () => {
    // 034 is the LAST Julius migration. The split anchors on the FIRST one, so 033 (< 034) and 035 (> 034) each keep their own line.
    expect(describeNonJuliusMigrations(SHAPE)).toEqual([LINE_PRE, LINE_017, LINE_033, LINE_035, LINE_036, LINE_037]);
    expect(NON_JULIUS_MIGRATION_DESCRIPTIONS['033_wonderland_social.sql'])
      .toBe("Wonderland Social's own storage: 17 additive `relay_wonderland.social_*` tables referencing only `relay_wonderland.players` and each other");
    expect(NON_JULIUS_MIGRATION_DESCRIPTIONS['035_wonderland_voice.sql'])
      .toBe("Wonderland party voice's own storage: 1 additive `relay_wonderland.voice_puid_binding` table referencing only `relay_wonderland.players`");
    expect(NON_JULIUS_MIGRATION_DESCRIPTIONS['036_wonderfs.sql'])
      .toBe("WonderFS's own storage (the project file system, contract r1.4): 16 additive `relay_wonderland.wfs_*` tables, referencing only `relay_wonderland.projects` outside them");
    expect(NON_JULIUS_MIGRATION_DESCRIPTIONS['037_wonderland_lff.sql'])
      .toBe('Wonderland LFF\'s own storage (the "Looking For Feed", a PROVISIONAL number): 4 additive `relay_wonderland.lff_*` tables (posts, join requests, the creation record behind the creation cap, and moderation-evidence snapshots) whose keys reference only `relay_wonderland.players` outside them, and 1 read-only moderation view over them and `relay_wonderland.social_reports`');
  });

  it('fails closed: an undescribed later migration, a stale line, no Julius anchor and an unnumbered name each throw', () => {
    // CONTROL: a later migration (a synthetic 039) with its OWN line is accepted, and printed as its own line; without one it throws.
    const withLater = { ...SHAPE, excluded: [...SHAPE.excluded, '039_wonderland_later_probe.sql'] };
    expect(describeNonJuliusMigrations({ ...withLater, descriptions: { ...NON_JULIUS_MIGRATION_DESCRIPTIONS, '039_wonderland_later_probe.sql': 'probe' } }).at(-1))
      .toBe(`- **non-Julius schema** — \`039_wonderland_later_probe.sql\` under \`${MIGRATION_DIR}\`: registered by the same migration runner, which applies every migration in numeric order; probe; deliberately not Julius's.`);
    expect(() => describeNonJuliusMigrations(withLater)).toThrow(/no manifest description .*: 039_wonderland_later_probe\.sql$/);
    // A stale line: 033's description with no 033 registered (035, 036 and 037 kept, so 033 is the only stale name).
    expect(() => describeNonJuliusMigrations({ ...SHAPE, excluded: [...PRE_JULIUS, '017_gauntlet_command.sql', '035_wonderland_voice.sql', '036_wonderfs.sql', '037_wonderland_lff.sql'] }))
      .toThrow(/none is registered under that name .*: 033_wonderland_social\.sql$/);
    expect(() => describeNonJuliusMigrations({ ...SHAPE, julius: [] })).toThrow(/no Julius schema migration is registered/);
    expect(() => describeNonJuliusMigrations({ ...SHAPE, excluded: [...SHAPE.excluded, 'wonderland_voice.sql'] }))
      .toThrow(/does not start with its number: wonderland_voice\.sql/);
  });
});
