import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLiveMissionContract } from '../relay-bridge/julius-live-mission';

/**
 * OFFICIAL MISSION 6 — THE LEARNING LOOP — HELD TO WHAT IT CLAIMS.
 *
 * The mission asks the three workers to build Julius's learning loop in its own
 * kernel: lineage-complete repair context, resolution of the findings an accepted
 * lineage closed, one Project Brain lesson per resolution, delivery counted on
 * every compiled context, recurrence by exact key, and a store that cannot resolve
 * findings reported rather than skipped. Its fixture claims five things, and each
 * means something only if proven here:
 *
 *   1. the ceilings, the research grant and the lab lane are this mission's own;
 *   2. the slice is tracked repository files closed under their runtime imports,
 *      six of them editable and the rest the kernel the specifications run;
 *   3. the must-not-change specification is green against the committed slice,
 *      and the new one fails against it for the feature's reasons, under the
 *      contract's own test command;
 *   4. the stub is reached only through the kernel barrel, so the repository's
 *      tests stay green while the module is unimplemented;
 *   5. the command runs where a paid run will run it, which
 *      `scripts/julius-live-mission-6-sandbox-proof.sh` checks inside the sandbox
 *      image, reading the same test command.
 *
 * A private reference implementation passed both specifications and a held-out
 * grader, on the host and inside `node:22-bookworm-slim`; an implementation that
 * resolves findings without protecting verdicts passed every new case and failed
 * the must-not-change one. That measurement is recorded in the mission's commit
 * and design note. Neither the reference nor the grader is committed: the
 * deliverable is the mission's to produce.
 */

const ROOT = join(import.meta.dirname, '..');
const MISSION = 'julius-live-mission-6';
const MISSION_DIR = join(ROOT, '.github/julius-missions', MISSION);
const J = 'src/relay/mission/julius';
const STUB = `${J}/julius-learning-loop.ts`;
const EXISTING_SPEC = `${J}/julius-learning-loop.existing.test.ts`;
const NEW_SPEC = `${J}/julius-learning-loop.test.ts`;
const BRIEF = `${J}/LEARNING_LOOP_BRIEF.md`;
const CHECK = 'scripts/julius-live-contract-check.mjs';
const EDITABLE = [
  `${J}/julius-events.ts`, `${J}/julius-learning-loop.ts`, `${J}/julius-memory-store.ts`,
  `${J}/julius-runtime-ports.ts`, `${J}/julius-task-pipeline.ts`, `${J}/julius-verification-runtime.ts`,
];

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const contractSource = readFileSync(join(MISSION_DIR, 'contract.json'), 'utf8');
const contract = JSON.parse(contractSource) as Record<string, unknown> & { testCommand: string; objective: string; requirements: string[]; constraints: string[] };

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const sliceLines = (): readonly string[] => readFileSync(join(MISSION_DIR, 'slice.txt'), 'utf8').split('\n');
const slicePaths = (): readonly string[] => sliceLines()
  .map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line.length > 0);

/* ------------------------------------------------ 1. bounds, grant, lane */

describe('the mission asks for what a deployment granted it, and nobody else gets it', () => {
  const runCheck = (document: unknown, lane = 'lab'): { code: number; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-m6-'));
    scratch.push(dir);
    const path = join(dir, 'contract.json');
    writeFileSync(path, JSON.stringify(document, null, 2));
    try {
      return { code: 0, output: execFileSync(process.execPath, [join(ROOT, CHECK), path, '--lane', lane], { encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  it('parses through the live entrypoint and states its own ceilings', () => {
    const parsed = parseLiveMissionContract(contractSource);
    expect(parsed.ok, parsed.ok ? '' : parsed.problem).toBe(true);
    expect(contract.markerNamespace).toBe(MISSION);
    expect(contract.limits).toEqual({ spendUsd: 60, repairCycles: 3, architectMaxOutputTokens: 20_000 });
    expect(contract.testCommand).toBe(`node --experimental-transform-types --import ./.julius/loader.mjs --test ${EXISTING_SPEC} ${NEW_SPEC}`);
  });

  it('passes the real checker as committed, in the lab lane and no other', () => {
    expect(runCheck(contract).code).toBe(0);
    for (const lane of ['qualification', 'qualification-repair', 'regression']) {
      expect(runCheck(contract, lane).code, `lane ${lane}`).toBe(1);
    }
  });

  it('the identical document under an ungranted namespace is refused on spend, repairs AND research', () => {
    const outcome = runCheck({ ...contract, markerNamespace: 'julius-live-mission-6-copy', missionId: 'mission:julius-live-mission-6-copy', projectId: 'prj-julius-live-mission-6-copy' });
    expect(outcome.code).toBe(1);
    expect(outcome.output).toContain('above the 5 ceiling');
    expect(outcome.output).toContain('above the 1 allowed');
    expect(outcome.output.toLowerCase()).toContain('research');
  });
});

/* ------------------------------------------------------------ 2. the slice */

const RUNTIME_IMPORT = /^(?:import|export)\s+(?!type\b)([\s\S]*?)\sfrom\s+'([^']+)';?/gmu;

/** The relative modules a file loads at runtime: type-only imports are erased and load nothing. */
function runtimeImports(path: string): readonly string[] {
  const source = read(path);
  const found: string[] = [];
  for (const match of source.matchAll(RUNTIME_IMPORT)) {
    const clause = match[1]!.trim();
    const braces = /^\{([\s\S]*)\}$/u.exec(clause);
    if (braces !== null) {
      const names = braces[1]!.split(',').map((value) => value.trim()).filter(Boolean);
      if (names.length > 0 && names.every((name) => name.startsWith('type '))) continue;
    }
    const specifier = match[2]!;
    if (!specifier.startsWith('.')) { found.push(specifier); continue; }
    const base = normalize(join(dirname(path), specifier)).replaceAll('\\', '/');
    const resolved = [`${base}.ts`, `${base}/index.ts`, base].find((candidate) => existsSync(join(ROOT, candidate)));
    found.push(resolved ?? `${base} (unresolved)`);
  }
  return found;
}

describe('the slice is the real kernel, closed, with six files to edit', () => {
  it('names only files this repository tracks, each once', () => {
    const paths = slicePaths();
    expect(new Set(paths).size).toBe(paths.length);
    const tracked = execFileSync('git', ['ls-files', '--', ...paths], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect([...tracked].sort()).toEqual([...paths].sort());
  });

  it('is closed under runtime imports, reaching nothing outside Node itself', () => {
    const paths = new Set(slicePaths());
    for (const path of paths) {
      for (const target of runtimeImports(path)) {
        if (target.startsWith('node:')) continue;
        expect(paths.has(target), `${path} loads ${target}, which the slice does not carry`).toBe(true);
      }
    }
  });

  it('lists exactly the six editable files first, and the contract names them as the only ones', () => {
    const lines = sliceLines();
    const firstSection = lines.slice(0, lines.findIndex((line, index) => index > 0 && line.trim() === ''))
      .map((line) => line.replace(/#.*$/u, '').trim()).filter(Boolean);
    expect([...firstSection].sort()).toEqual([...EDITABLE].sort());
    const editConstraint = contract.constraints[0]!;
    for (const path of EDITABLE) expect(editConstraint).toContain(`\`${path.slice(path.lastIndexOf('/') + 1)}\``);
    expect(editConstraint.startsWith('Edit only')).toBe(true);
  });

  it('fits the workspace a paid run provisions', () => {
    const bytes = slicePaths().reduce((sum, path) => sum + readFileSync(join(ROOT, path)).length, 0);
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
  });
});

/* --------------------------------------------- 3. the specifications, run */

function provision(): string {
  const dir = mkdtempSync(join(tmpdir(), 'julius-m6-ws-'));
  scratch.push(dir);
  for (const path of slicePaths()) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    cpSync(join(ROOT, path), join(dir, path));
  }
  cpSync(join(MISSION_DIR, 'seed'), dir, { recursive: true });
  mkdirSync(join(dir, '.julius'), { recursive: true });
  for (const name of ['resolve.mjs', 'loader.mjs']) cpSync(join(ROOT, '.github/julius-mission-slice', name), join(dir, '.julius', name));
  return dir;
}

const tap = (output: string, key: 'tests' | 'pass' | 'fail'): number => {
  const match = new RegExp(`^# ${key} (\\d+)$`, 'mu').exec(output);
  return match === null ? Number.NaN : Number(match[1]);
};

describe('against the committed slice: what must not change is green, and the loop is not built', () => {
  const [command, ...args] = contract.testCommand.split(' ');
  const workspace = provision();

  it('the must-not-change specification passes in full', () => {
    const existingArgs = args.filter((arg) => arg !== NEW_SPEC);
    const result = spawnSync(process.execPath, existingArgs, { cwd: workspace, encoding: 'utf8', timeout: 240_000 });
    const output = `${result.stdout}${result.stderr}`;
    expect(command).toBe('node');
    expect(result.status, output.slice(-2000)).toBe(0);
    expect(tap(output, 'fail')).toBe(0);
    expect(tap(output, 'pass')).toBeGreaterThanOrEqual(12);
  }, 300_000);

  it('the contract’s command fails, and the new specification fails on the stub’s sentinel and on missing behaviour — not on loading', () => {
    const result = spawnSync(process.execPath, args, { cwd: workspace, encoding: 'utf8', timeout: 240_000 });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, 'completion is not free').not.toBe(0);
    expect(output).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
    expect(output).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(tap(output, 'fail')).toBeGreaterThanOrEqual(19);
    expect(output).toContain('learning_loop_not_implemented');
    expect(output).toContain('the finding round one was repairing');
  }, 300_000);

  it('the kernel does not load under plain type stripping, which is why the contract passes the flag', () => {
    const plain = args.filter((arg) => arg !== '--experimental-transform-types' && arg !== NEW_SPEC);
    const result = spawnSync(process.execPath, plain, { cwd: workspace, encoding: 'utf8', timeout: 240_000 });
    expect(`${result.stdout}${result.stderr}`).toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
  }, 300_000);
});

/* ------------------------------------------------ 4. the stub on main */

describe('the stub is reached only through the kernel barrel', () => {
  it('every exported function throws the sentinel, and nothing but the barrel imports it', () => {
    const stub = read(STUB);
    expect(stub.match(/learning_loop_not_implemented/gu)?.length).toBeGreaterThanOrEqual(1);
    for (const name of ['juliusFindingRecurrenceKey', 'juliusLineageFindings', 'juliusResolvableFindings', 'juliusLessonAppend', 'juliusRecurrenceOf', 'juliusLessonNotHeldAppend', 'juliusLessonDelivery']) {
      expect(stub, name).toContain(`export function ${name}(`);
    }
    const importers = execFileSync('git', ['grep', '-l', "julius-learning-loop'", '--', 'src', 'relay-bridge', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((path) => !path.startsWith('.github/'));
    expect([...importers].sort()).toEqual(['scripts/julius-live-mission-6.test.ts', `${J}/index.ts`].sort());
  });
});

/* ----------------------------------------- 5. honest about what it builds */

describe('the mission says what it does and does not claim', () => {
  it('builds the module and does not claim paid runs already learn', () => {
    expect(contract.objective).toContain('It does not claim that paid runs already learn');
    const brief = readFileSync(join(MISSION_DIR, 'seed', BRIEF), 'utf8');
    expect(brief).toContain('does **not** claim that paid runs already learn');
  });

  it('the sandbox proof reads the contract’s command rather than retyping it, in the image the rig builds', () => {
    const proof = read('scripts/julius-live-mission-6-sandbox-proof.sh');
    expect(proof).toContain('IMAGE=node:22-bookworm-slim');
    expect(proof).toContain('.testCommand');
    expect(proof).not.toContain('--experimental-transform-types --import');
    expect(read('.github/julius-live-images.sh')).toContain("'FROM node:22-bookworm-slim'");
  });
});
