import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo } from './e2-test-kit';

/*
 * PILOT 5366ad30 R3-2 / R3-4 and Skywalker 5366ad30 M1 / M2, failing-first: verifier commands come from a pinned mission
 * spec, file arguments stay in the workspace, no-op and git verifiers are refused, and real forms (`node --test`, `npm run
 * test`) are allowed.
 */
let root = ''; let repo = ''; let base = ''; let head = ''; let outside = '';
const write = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const PKG = JSON.stringify({ name: 'w', private: true, scripts: { test: 'node --test' } });
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r9v-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  outside = join(root, 'evil.mjs'); writeFileSync(outside, 'process.exit(0)\n');
  ({ base, head } = makeRepo(repo, {
    'a.txt': 'one\n', 'package.json': PKG, 'tsconfig.json': '{}\n', 'ok.mjs': 'process.exit(0)\n',
    'test/a.test.mjs': "import test from 'node:test'; test('a', () => {});\n",
  }, { 'a.txt': 'two\n' }, write));
  symlinkSync(outside, join(repo, 'link.mjs'));
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const reasons = (r: ReturnType<typeof G.e2Gate>): readonly string[] => (r.ok ? [] : r.reasons);

describe('R3-2 / M1 / R3-4: isVerifierCommandAllowed', () => {
  it('refuses files outside the workspace, no-op forms, redirecting flags and every git verifier', () => {
    for (const a of [['node', '/proc/self/environ'], ['node', '../evil.mjs'], ['node', outside], ['node', 'link.mjs'], ['node', '--test', outside],
      ['npm', 'test', '--prefix', '/tmp'], ['npm', 'test', '--userconfig=/tmp/x'], ['npm', 'run', 'anything'], ['npm', '--version'],
      ['npx', 'vitest', '--config', outside], ['npx', 'vitest', '--version'], ['npx', 'vitest', 'run', '--config', outside], ['npx', 'tsc', '--version'],
      ['tsc', '--version'], ['tsc', '--help'], ['tsc', '-p', '/tmp/evil/tsconfig.json'], ['tsc', '--noEmit', '-p', '/tmp/evil/tsconfig.json'], ['tsc', '-p', '.'],
      ['git', 'status'], ['git', 'log', '-p'], ['git', 'show'], ['git', 'diff', '--ext-diff'], ['git', 'diff', '--textconv'], ['git', 'ls-files'], ['git', 'rev-parse', 'HEAD']]) {
      expect(G.isVerifierCommandAllowed(a, repo), a.join(' ')).toBe(false);
    }
  });
  it('allows the forms missions really use (Skywalker M2): node --test, npm run test, npm test, npx vitest run, tsc --noEmit', () => {
    for (const a of [['node', '--test', 'test/a.test.mjs'], ['node', 'ok.mjs'], [process.execPath, 'ok.mjs'], ['npm', 'test'], ['npm', 'run', 'test'], ['npx', 'vitest', 'run'], ['npx', 'vitest', 'run', 'test/a.test.mjs'],
      ['tsc', '--noEmit'], ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json']]) {
      expect(G.isVerifierCommandAllowed(a, repo), a.join(' ')).toBe(true);
    }
  });
});

describe('R3-2: pinVerifierSpec maps the mission testCommand to argv and pins its files at base', () => {
  it('maps the string, pins the script and configs', () => {
    const s = G.pinVerifierSpec({ testCommand: 'node --test test/a.test.mjs', additionalChecks: ['npm run test'], workspace: repo, base });
    expect('refused' in s).toBe(false);
    const spec = s as G.E2VerifierSpec;
    expect(spec.commands).toEqual([['node', '--test', 'test/a.test.mjs'], ['npm', 'run', 'test']]);
    expect(Object.keys(spec.pins)).toContain('test/a.test.mjs');
    expect(spec.pins['package.json']).toMatch(/^[0-9a-f]{64}$/u);
    expect(spec.pins['vitest.config.ts']).toBe('absent');
  });
  it('refuses with a named cause', () => {
    const r = (testCommand: string, b = base) => (G.pinVerifierSpec({ testCommand, workspace: repo, base: b }) as { refused?: string }).refused;
    expect(r('npm test && rm -rf .')).toBe('spec_shell_syntax');
    expect(r('node "ok.mjs"')).toBe('spec_shell_syntax');
    expect(r('node $X')).toBe('spec_shell_syntax');
    expect(r('node ../evil.mjs')).toBe('path_outside_workspace');
    expect(r('node /proc/self/environ')).toBe('path_outside_workspace');
    expect(r('/usr/bin/node ok.mjs')).toBe('program_not_allowed');
    expect(r('git status')).toBe('program_not_allowed');
    expect(r('npx vitest --version')).toBe('shape_not_allowed');
    expect(r('npm test --prefix /tmp')).toBe('shape_not_allowed');
    expect(r('node new.mjs')).toBe('spec_file_not_at_base');
    expect(r('node ok.mjs', 'z'.repeat(40))).toBe('spec_base_invalid');
  });
  it('npm test runs only an allowlisted, pinned script body', () => {
    const r2 = join(root, 'r2'); mkdirSync(r2);
    const b = makeRepo(r2, { 'package.json': JSON.stringify({ scripts: { test: 'node evil.js' } }) }, {}, write).base;
    expect((G.pinVerifierSpec({ testCommand: 'npm test', workspace: r2, base: b }) as { refused?: string }).refused).toBe('spec_npm_script_not_allowlisted');
    const r3 = join(root, 'r3'); mkdirSync(r3);
    const b3 = makeRepo(r3, { 'package.json': JSON.stringify({ scripts: { test: 'node --test', pretest: 'node x.js' } }) }, {}, write).base;
    expect((G.pinVerifierSpec({ testCommand: 'npm test', workspace: r3, base: b3 }) as { refused?: string }).refused).toBe('spec_npm_script_not_allowlisted');
    expect(G.E2_NPM_TEST_BODIES.has('node --test')).toBe(true);
  });
});

describe('R3-2: re-exec refuses when pinned content changed since base, and the gate binds the spec', () => {
  it('a changed script, package.json or a new vitest config runs nothing: refusal pin_changed', async () => {
    const r = join(root, 'pc'); mkdirSync(r);
    const b = makeRepo(r, { 'package.json': PKG, 'test/a.test.mjs': "import test from 'node:test'; test('a', () => {});\n", 'ok.mjs': 'process.exit(0)\n' }, {}, write).base;
    let ran = 0;
    const runner: G.VerifierRunner = async () => { ran += 1; return { exitCode: 0, stdout: '', stderr: '' }; };
    const spec = G.pinVerifierSpec({ testCommand: 'node --test test/a.test.mjs', additionalChecks: ['npm test'], workspace: r, base: b }) as G.E2VerifierSpec;
    expect((await G.recordVerifierReexec({ spec, cwd: r, runner }))?.refusal).toBeNull();
    expect(ran).toBe(2);
    for (const [f, c] of [['test/a.test.mjs', 'process.exit(0)\n'], ['package.json', JSON.stringify({ scripts: { test: 'node --test', pretest: 'x' } })], ['vitest.config.ts', 'export default {}\n']] as const) {
      const before = ran;
      write(join(r, f), c);
      const ev = await G.recordVerifierReexec({ spec, cwd: r, runner });
      expect(ev?.refusal, f).toBe('pin_changed');
      expect(ev?.commands).toEqual([]);
      expect(ran).toBe(before);
      if (f === 'vitest.config.ts') rmSync(join(r, f)); else write(join(r, f), f === 'package.json' ? PKG : "import test from 'node:test'; test('a', () => {});\n");
    }
  });
  it('gate: spec present and honoured passes; legacy argv, another spec, a pin change, no spec or a spec for another base are refused', async () => {
    const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
    const spec = G.pinVerifierSpec({ testCommand: 'node --test test/a.test.mjs', additionalChecks: ['npm run test'], workspace: repo, base }) as G.E2VerifierSpec;
    const { lines, evidence } = await liveCapture(root, 'g.jsonl', GOOD());
    const g = { streamLines: lines, anchor: G.externalAnchor('workflow_output', evidence.finalHash), diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL };
    const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
    expect(reexec?.commands.map((c) => c.exitCode)).toEqual([0, 0]);
    expect(reasons(G.e2Gate({ ...g, reexec, verifierSpec: spec }))).toEqual([]);
    const legacy = await G.recordVerifierReexec({ commands: [['node', 'ok.mjs']], cwd: repo, runner });
    expect(reasons(G.e2Gate({ ...g, reexec: legacy, verifierSpec: spec }))).toEqual(['e2_verifier_not_from_spec']);
    const other = G.pinVerifierSpec({ testCommand: 'node ok.mjs', workspace: repo, base }) as G.E2VerifierSpec;
    expect(reasons(G.e2Gate({ ...g, reexec: await G.recordVerifierReexec({ spec: other, cwd: repo, runner }), verifierSpec: spec }))).toEqual(['e2_verifier_not_from_spec']);
    expect(reasons(G.e2Gate({ ...g, reexec, verifierSpec: undefined }))).toEqual(['e2_verifier_spec_absent']);
    expect(reasons(G.e2Gate({ ...g, reexec, verifierSpec: { ...spec } }))).toEqual(['e2_verifier_spec_absent']);
    const atHead = G.pinVerifierSpec({ testCommand: 'node --test test/a.test.mjs', workspace: repo, base: head }) as G.E2VerifierSpec;
    expect(reasons(G.e2Gate({ ...g, reexec: await G.recordVerifierReexec({ spec: atHead, cwd: repo, runner }), verifierSpec: atHead }))).toEqual(['e2_verifier_not_from_spec']);
    write(join(repo, 'test/a.test.mjs'), 'process.exit(0)\n');
    try {
      expect(reasons(G.e2Gate({ ...g, reexec: await G.recordVerifierReexec({ spec, cwd: repo, runner }), verifierSpec: spec }))).toEqual(['e2_verifier_pin_changed']);
    } finally { write(join(repo, 'test/a.test.mjs'), "import test from 'node:test'; test('a', () => {});\n"); }
  }, 60_000);
});
