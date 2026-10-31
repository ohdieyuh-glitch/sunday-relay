import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';
import { pinT, recordGitDiffT } from './e2-test-kit';

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
    'a.txt': 'one\n', 'package.json': PKG, 'tsconfig.json': '{}\n', 'ok.mjs': "import test from 'node:test'; test('ok', () => {});\n",
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
  it('allows only the node forms (round 5 R4-1 dropped npm/npx/tsc: Skywalker M2 loses npm test / npm run test)', () => {
    for (const a of [['node', '--test', 'test/a.test.mjs'], ['node', 'ok.mjs'], [process.execPath, 'ok.mjs']]) {
      expect(G.isVerifierCommandAllowed(a, repo), a.join(' ')).toBe(true);
    }
    for (const a of [['npm', 'test'], ['npm', 'run', 'test'], ['npx', 'vitest', 'run'], ['tsc', '--noEmit'], ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json']]) {
      expect(G.isVerifierCommandAllowed(a, repo), a.join(' ')).toBe(false);
    }
  });
});

describe('R3-2: pinVerifierSpec maps the mission testCommand to argv and pins its files at base', () => {
  it('maps the string, pins the script and configs', () => {
    const s = G.pinVerifierSpec({ testCommand: 'node --test test/a.test.mjs', additionalChecks: ['node ok.mjs'], minTests: 1, workspace: repo, base });
    expect('refused' in s).toBe(false);
    const spec = s as G.E2VerifierSpec;
    expect(spec.commands).toEqual([['node', '--test', '--test-reporter=tap', 'test/a.test.mjs'], ['node', '--test-reporter=tap', 'ok.mjs']]);
    expect(spec.minTests).toEqual([1, 1]);
    expect(Object.keys(spec.pins)).toContain('test/a.test.mjs');
    expect(spec.pins['package.json']).toMatch(/^[0-9a-f]{64}$/u);
  });
  it('refuses with a named cause', () => {
    const r = (testCommand: string, b = base) => (G.pinVerifierSpec({ testCommand, minTests: 1, workspace: repo, base: b }) as { refused?: string }).refused;
    expect(r('node ok.mjs && rm -rf .')).toBe('spec_shell_syntax');
    expect(r('node "ok.mjs"')).toBe('spec_shell_syntax');
    expect(r('node $X')).toBe('spec_shell_syntax');
    expect(r('node ../evil.mjs')).toBe('path_outside_workspace');
    expect(r('node /proc/self/environ')).toBe('path_outside_workspace');
    expect(r('/usr/bin/node ok.mjs')).toBe('program_not_allowed');
    expect(r('git status')).toBe('program_not_allowed');
    expect(r('npx vitest --version')).toBe('spec_program_untrusted');
    expect(r('npm test --prefix /tmp')).toBe('spec_program_untrusted');
    expect(r('node --version')).toBe('shape_not_allowed');
    expect(r('node new.mjs')).toBe('spec_file_not_at_base');
    expect(r('node ok.mjs', 'z'.repeat(40))).toBe('spec_base_invalid');
  });
});

describe('R3-2: re-exec refuses when pinned content changed since base, and the gate binds the spec', () => {
  it('a changed script or package.json runs nothing: refusal pin_changed', async () => {
    const r = join(root, 'pc'); mkdirSync(r);
    const b = makeRepo(r, { 'package.json': PKG, 'test/a.test.mjs': "import test from 'node:test'; test('a', () => {});\n", 'ok.mjs': "import test from 'node:test'; test('ok', () => {});\n" }, {}, write).base;
    let ran = 0;
    const runner: G.VerifierRunner = async () => { ran += 1; return { exitCode: 0, stdout: '', stderr: '' }; };
    const spec = G.pinVerifierSpec({ testCommand: 'node --test test/a.test.mjs', additionalChecks: ['node ok.mjs'], minTests: 1, workspace: r, base: b }) as G.E2VerifierSpec;
    expect((await G.recordVerifierReexec({ spec, cwd: r, runner }))?.refusal).toBeNull();
    expect(ran).toBe(2);
    for (const [f, c] of [['test/a.test.mjs', 'process.exit(0)\n'], ['package.json', JSON.stringify({ scripts: { test: 'node --test', pretest: 'x' } })]] as const) {
      const before = ran;
      write(join(r, f), c);
      const ev = await G.recordVerifierReexec({ spec, cwd: r, runner });
      expect(ev?.refusal, f).toBe('pin_changed');
      expect(ev?.commands).toEqual([]);
      expect(ran).toBe(before);
      write(join(r, f), f === 'package.json' ? PKG : "import test from 'node:test'; test('a', () => {});\n");
    }
  });
  it('gate: spec present and honoured passes; legacy argv, another spec, a pin change, no spec or a spec for another base are refused', async () => {
    const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
    const spec = (await pinT({ testCommand: 'node --test test/a.test.mjs', additionalChecks: ['node ok.mjs'], minTests: 1, workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    const { lines, evidence } = await liveCapture(root, 'g.jsonl', GOOD());
    const g = { streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), diff: await recordGitDiffT({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL };
    const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
    expect(reexec?.commands.map((c) => c.exitCode)).toEqual([0, 0]);
    expect(reasons(G.e2Gate({ ...g, reexec, verifierSpec: spec }))).toEqual([]);
    const legacy = await G.recordVerifierReexec({ commands: [['node', 'ok.mjs']], cwd: repo, runner });
    expect(reasons(G.e2Gate({ ...g, reexec: legacy, verifierSpec: spec }))).toEqual(['e2_verifier_not_from_spec']);
    const other = (await pinT({ testCommand: 'node ok.mjs', minTests: 1, workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    expect(reasons(G.e2Gate({ ...g, reexec: await G.recordVerifierReexec({ spec: other, cwd: repo, runner }), verifierSpec: spec }))).toEqual(['e2_verifier_not_from_spec']);
    expect(reasons(G.e2Gate({ ...g, reexec, verifierSpec: undefined }))).toEqual(['e2_verifier_spec_absent']);
    expect(reasons(G.e2Gate({ ...g, reexec, verifierSpec: { ...spec } }))).toEqual(['e2_verifier_spec_absent']);
    const atHead = (await pinT({ testCommand: 'node --test test/a.test.mjs', workspace: repo, base: head }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    expect(reasons(G.e2Gate({ ...g, reexec: await G.recordVerifierReexec({ spec: atHead, cwd: repo, runner }), verifierSpec: atHead }))).toEqual(['e2_objects_untrusted', 'e2_verifier_not_from_spec']); // Round 10: spec store != diff store
    write(join(repo, 'test/a.test.mjs'), 'process.exit(0)\n');
    try {
      expect(reasons(G.e2Gate({ ...g, reexec: await G.recordVerifierReexec({ spec, cwd: repo, runner }), verifierSpec: spec }))).toEqual(['e2_verifier_pin_changed']);
    } finally { write(join(repo, 'test/a.test.mjs'), "import test from 'node:test'; test('a', () => {});\n"); }
  }, 60_000);
});
