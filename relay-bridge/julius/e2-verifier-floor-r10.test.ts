/* Round 5 R4-3 (PILOT 44c062b9): `node --test` must show a TAP summary with at least the floor of passing tests and no
   failures. The floor comes ONLY from the mission (`minTests`) and from the base-pinned test files (count of test()/it()
   calls at base), never below 1, never from run-time output or the coder (Skywalker round-5 steering). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r10f-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
/* Round 7 R6-1/R6-3: a pinned test may not load coder code, so the coder-editable helper is DATA (h.json) that the base
   test acts on: `exit` ends the process before any test, `print` writes coder-chosen text first. */
/* Round 8 R7-3: `process` is a banned name in a pinned file, so the process-control vehicle (exit 0, raw stdout) is now
   refused at SPEC time; the honest fixtures use console.log only, and the hostile ones assert the spec refusal. The runtime
   synthetic/floor checks stay as defence in depth (unit-tested below / in fileLevelPoints). */
const T2X = "import __fs from 'node:fs'; import __t from 'node:test'; const h = JSON.parse(__fs.readFileSync(new URL(import.meta.url).pathname.replace(/[^/]*$/u, '') + 'h.json', 'utf8')); if (h.print) process.stdout.write(h.print); if (h.exit) process.exit(0);\nconst test = __t; test('a', () => {}); test('b', () => {});\n";
const T2 = "import __fs from 'node:fs'; import __t from 'node:test'; const h = JSON.parse(__fs.readFileSync(new URL(import.meta.url).pathname.replace(/[^/]*$/u, '') + 'h.json', 'utf8')); if (h.print) console.log(h.print);\nconst test = __t; test('a', () => {}); test('b', () => {});\n";
const asData = (headH: string): string => JSON.stringify(headH === 'process.exit(0);\n' ? { exit: true } : headH === FAKE_SUMMARY ? { exit: true, print: '# tests 99\n# suites 0\n# pass 99\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n' } : { v: 2 });
const FAKE_SUMMARY = "process.stdout.write('# tests 99\\n# suites 0\\n# pass 99\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1\\n'); process.exit(0);\n";

async function specOf(name: string, t: string): Promise<unknown> {
  const repo = join(root, name); mkdirSync(repo);
  const { base } = makeRepo(repo, { 'a.txt': '1\n', 'h.json': '{"v":1}', 't.test.mjs': t }, { 'a.txt': '2\n' }, W);
  return G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }));
}
async function gate(name: string, headH: string, opts: { minTests?: number; testCommand?: string } = {}): Promise<{ reasons: readonly string[]; spec: G.E2VerifierSpec; reexec: G.E2ReexecEvidence | null }> {
  const repo = join(root, name); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 'h.json': '{"v":1}', 't.test.mjs': T2 }, { 'a.txt': '2\n', 'h.json': asData(headH) }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = (await G.pinVerifierSpecWithBaseRun({ testCommand: opts.testCommand ?? 'node --test t.test.mjs', workspace: repo, base, ...(opts.minTests === undefined ? {} : { minTests: opts.minTests }) }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
  expect('refused' in spec).toBe(false);
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `${name}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return { reasons: g.ok ? [] : g.reasons, spec, reexec };
}

describe('R4-3: node --test vacuous passes', () => {
  it('an honest run passes with its TAP summary recorded', async () => {
    const r = await gate('ok', 'module.exports = 2;\n');
    expect(r.reasons).toEqual([]);
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 2, pass: 2, fail: 0 });
  }, 60_000);
  it('a helper that exits 0 before any test runs is refused (exit 0 is not enough): now at spec time', async () => {
    expect(await specOf('exit0', T2X)).toEqual({ refused: 'spec_pinned_test_dynamic_load' });
  }, 60_000);
  it('coder-controlled output printing a fake summary cannot raise the count or lower the floor', async () => {
    const r = await gate('fake', FAKE_SUMMARY);
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 2, pass: 2, fail: 0 });
    expect(r.reasons).toEqual([]);
    expect(FAKE_SUMMARY).toContain('process.exit');
  }, 60_000);
  it('the floor is max(1, mission minTests, base-pinned test count); a declared 0 cannot lower it', async () => {
    expect((await gate('m0', 'module.exports = 2;\n', { minTests: 0 })).spec.minTests).toEqual([2]);
    expect((await gate('m5', 'module.exports = 2;\n', { minTests: 5 })).reasons).toEqual(['e2_verifier_tests_below_minimum']);
    /* Round 7 R6-3: plain `node <file>` needs a mission floor; with one it is enforced (was: floor null, exit code only). */
    const plain = await gate('plain', 'module.exports = 2;\n', { testCommand: 'node t.test.mjs', minTests: 2 });
    expect(plain.spec.minTests).toEqual([2]);
    expect(plain.reasons).toEqual([]);
    for (const bad of [-1, 1.5, Number.NaN, '3' as unknown as number]) {
      expect((G.pinVerifierSpec({ testCommand: 'node --test t.test.mjs', workspace: join(root, 'ok'), base: 'a'.repeat(40), minTests: bad }) as { refused?: string }).refused).toBe('spec_invalid');
    }
  }, 120_000);
  it('a failing or absent summary refuses (parser unit)', () => {
    const tail = (t: number, p: number, f: number): string => `1..${t}\n# tests ${t}\n# suites 0\n# pass ${p}\n# fail ${f}\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 5.1\n`;
    expect(G.parseNodeTestSummary(tail(3, 3, 0))).toEqual({ tests: 3, pass: 3, fail: 0 });
    expect(G.parseNodeTestSummary(tail(3, 2, 1))).toEqual({ tests: 3, pass: 2, fail: 1 });
    expect(G.parseNodeTestSummary(tail(3, 3, 0).replace('# cancelled 0', '# cancelled 2'))).toEqual({ tests: 3, pass: 3, fail: 2 });
    expect(G.parseNodeTestSummary(`${tail(3, 3, 0)}trailing coder text\n`)).toBeNull();
    expect(G.parseNodeTestSummary('')).toBeNull();
    expect(G.parseNodeTestSummary(tail(3, 3, 0).replaceAll('#', 'ℹ'))).toEqual({ tests: 3, pass: 3, fail: 0 });
  });
  it('mutation kills: a failure with passes above the floor, and a summary lost to an output overrun, are both refused', async () => {
    const repo = join(root, 'loop'); mkdirSync(repo);
    const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 't.test.mjs': "import __fs from 'node:fs'; import test from 'node:test'; for (const n of [1, 2, 3]) test('t' + n, () => { if (n === 3 && JSON.parse(__fs.readFileSync(new URL(import.meta.url).pathname.replace(/[^/]*$/u, '') + 'f.json', 'utf8'))) throw new Error('x'); });\n", 'f.json': 'false' },
      { 'a.txt': '2\n', 'f.json': 'true' }, W);
    const spec = (await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    expect(spec.minTests).toEqual([3]); // base run: 3 passing tests at base (round 7 R6-4 brand)
    const { lines, evidence } = await liveCapture(root, 'loop.jsonl', GOOD());
    const g = async (runner: G.VerifierRunner) => G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec: await G.recordVerifierReexec({ spec, cwd: repo, runner }),
      diff: await G.recordGitDiff({ base, head, cwd: repo, runner: G.spawnVerifierRunner({ timeoutMs: 30_000 }) }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
    const failed = await g(G.spawnVerifierRunner({ timeoutMs: 30_000 }));
    expect(failed.ok ? [] : failed.reasons).toEqual(['e2_reexec_failed', 'e2_verifier_tests_below_minimum']);
    const cut = await g(G.spawnVerifierRunner({ timeoutMs: 30_000, maxOutputBytes: 40 }));
    expect(cut.ok ? [] : cut.reasons).toContain('e2_verifier_tests_below_minimum');
  }, 60_000);
});
