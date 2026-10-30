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
const T2 = "require('./h.js'); const test = require('node:test'); test('a', () => {}); test('b', () => {});\n";
const FAKE_SUMMARY = "process.stdout.write('# tests 99\\n# suites 0\\n# pass 99\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1\\n'); process.exit(0);\n";

async function gate(name: string, headH: string, opts: { minTests?: number; testCommand?: string } = {}): Promise<{ reasons: readonly string[]; spec: G.E2VerifierSpec; reexec: G.E2ReexecEvidence | null }> {
  const repo = join(root, name); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 'h.js': 'module.exports = 1;\n', 't.test.js': T2 }, { 'a.txt': '2\n', 'h.js': headH }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = G.pinVerifierSpec({ testCommand: opts.testCommand ?? 'node --test t.test.js', workspace: repo, base, ...(opts.minTests === undefined ? {} : { minTests: opts.minTests }) }) as G.E2VerifierSpec;
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
  it('a helper that exits 0 before any test runs is refused (exit 0 is not enough)', async () => {
    const r = await gate('exit0', 'process.exit(0);\n');
    expect(r.reexec?.commands[0]?.exitCode).toBe(0);
    expect(r.reasons).toEqual(['e2_verifier_tests_below_minimum']);
  }, 60_000);
  it('coder-controlled output printing a fake summary cannot raise the count or lower the floor', async () => {
    const r = await gate('fake', FAKE_SUMMARY);
    expect(r.reexec?.commands[0]?.testSummary?.tests).toBe(1);
    expect(r.reasons).toEqual(['e2_verifier_tests_below_minimum']);
  }, 60_000);
  it('the floor is max(1, mission minTests, base-pinned test count); a declared 0 cannot lower it', async () => {
    expect((await gate('m0', 'module.exports = 2;\n', { minTests: 0 })).spec.minTests).toEqual([2]);
    expect((await gate('m5', 'module.exports = 2;\n', { minTests: 5 })).reasons).toEqual(['e2_verifier_tests_below_minimum']);
    const plain = await gate('plain', 'module.exports = 2;\n', { testCommand: 'node t.test.js', minTests: 0 });
    expect(plain.spec.minTests).toEqual([null]);
    expect(plain.reasons).toEqual([]);
    for (const bad of [-1, 1.5, Number.NaN, '3' as unknown as number]) {
      expect((G.pinVerifierSpec({ testCommand: 'node --test t.test.js', workspace: join(root, 'ok'), base: 'a'.repeat(40), minTests: bad }) as { refused?: string }).refused).toBe('spec_invalid');
    }
  }, 120_000);
  it('a failing or absent summary refuses (parser unit)', () => {
    const tail = (t: number, p: number, f: number): string => `1..${t}\n# tests ${t}\n# suites 0\n# pass ${p}\n# fail ${f}\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 5.1\n`;
    expect(G.parseNodeTestSummary(tail(3, 3, 0))).toEqual({ tests: 3, pass: 3, fail: 0 });
    expect(G.parseNodeTestSummary(tail(3, 2, 1))).toEqual({ tests: 3, pass: 2, fail: 1 });
    expect(G.parseNodeTestSummary(`${tail(3, 3, 0)}trailing coder text\n`)).toBeNull();
    expect(G.parseNodeTestSummary('')).toBeNull();
    expect(G.parseNodeTestSummary(tail(3, 3, 0).replaceAll('#', 'ℹ'))).toEqual({ tests: 3, pass: 3, fail: 0 });
  });
});
