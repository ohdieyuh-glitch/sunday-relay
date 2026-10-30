/* Round 6 R5-1 continued (PILOT f4575efc + Skywalker addendum). Inputs are PILOT's repro shapes (zz-pilot-f45.test.ts
   §2, copied read-only to tmp/pilot-repro-f4575efc): the /proc/<ppid>/fd/1 write, and tests defined by a coder-editable
   module. Plus a forgery past the 64 KiB tail: a detached escapee appends filler and a forged TAP block after node's
   own summary, so the synthetic point scrolls out of the old tail. The gate now analyses the WHOLE stdout (up to
   E2_TAP_MAX_BYTES, refused beyond), requires `# tests` to equal the number of `type: 'test'` points, and
   pinVerifierSpecWithBaseRun sets the floor from the tests that REGISTERED in a Julius-observed run of the base tree. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r11b-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const LIB = 'module.exports = (x) => x + 1;\n';
const T3 = "const t = require('node:test'); const a = require('assert'); const f = require('./lib.js');\nt('c0', () => a.strictEqual(f(0), 1)); t('c1', () => a.strictEqual(f(1), 2)); t('c2', () => a.strictEqual(f(2), 3));\n";
const SUMMARY3 = '# tests 3\\n# suites 0\\n# pass 3\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1\\n';
const FORGED = `ok 1 - c0\\n  ---\\n  duration_ms: 1\\n  type: 'test'\\n  ...\\nok 2 - c1\\n  ---\\n  duration_ms: 1\\n  type: 'test'\\n  ...\\nok 3 - c2\\n  ---\\n  duration_ms: 1\\n  type: 'test'\\n  ...\\n1..3\\n${SUMMARY3}`;

async function gate(name: string, baseFiles: Record<string, string>, headFiles: Record<string, string>, opts: { baseRun?: boolean; testCommand?: string } = {}): Promise<{ reasons: readonly string[]; spec: G.E2VerifierSpec; reexec: G.E2ReexecEvidence | null }> {
  const repo = join(root, name); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', ...baseFiles }, { 'a.txt': '2\n', ...headFiles }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const input = { testCommand: opts.testCommand ?? 'node --test t.test.js', workspace: repo, base };
  const spec = (opts.baseRun === true ? await G.pinVerifierSpecWithBaseRun(input, runner) : G.pinVerifierSpec(input)) as G.E2VerifierSpec;
  expect('refused' in spec).toBe(false);
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `${name}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return { reasons: g.ok ? [] : g.reasons, spec, reexec };
}

describe('R5-1: forged or missing test registration', () => {
  /* Round 7 R6-1/R6-3: both forgeries need the pinned test to LOAD coder code; the spec now refuses that before anything
     runs. The whole-stdout checks they exercised stay (defence in depth) and keep their unit test below. */
  it("PILOT: a module that writes a fake summary to /proc/<ppid>/fd/1 and exits 0 is refused (now at spec time)", () => {
    const repo = join(root, 'proc'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 'a.txt': '1\n', 'lib.js': LIB, 't.test.js': T3 }, { 'a.txt': '2\n' }, W);
    expect(G.pinVerifierSpec({ testCommand: 'node --test t.test.js', workspace: repo, base })).toEqual({ refused: 'spec_pinned_test_imports_untrusted' });
  });
  it('a detached escapee that appends 80 KiB and a forged TAP block is refused (now at spec time: child_process is an executing built-in)', () => {
    expect(G.scanPinnedSource("const { spawn } = require('child_process'); spawn(process.execPath, ['w.js'], { detached: true });\n")).toBe('spec_pinned_test_imports_untrusted');
    expect(FORGED.length).toBeGreaterThan(0);
  });
  it('unit: # tests must equal the type:test points, and stdout over the cap is refused', () => {
    const ok = "ok 1 - c0\n  ---\n  type: 'test'\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n";
    expect(G.analyzeTap(ok, ['t.test.js'], false)).toMatchObject({ testPoints: 1, fileLevelPoints: [], complete: true });
    expect(G.analyzeTap(ok.replace('# tests 1', '# tests 2').replace('# pass 1', '# pass 2'), ['t.test.js'], false).testPoints).toBe(1);
    expect(G.analyzeTap(ok, ['t.test.js'], true).complete).toBe(false);
  });
  it('base run: tests defined in a coder-editable module (PILOT R5-4a shape) get the floor that registered at base', async () => {
    /* Round 7: the coder-editable input is now data read with node:fs (a pinned test may not load coder code). */
    const T = "const t = require('node:test'); const fs = require('node:fs'); for (const c of JSON.parse(fs.readFileSync(__dirname + '/cases.json', 'utf8'))) t(c.n, () => require('assert').strictEqual(c.y, c.x + 1));\n";
    const cases = (n: number, ok = true): string => JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: `c${i}`, x: i, y: ok ? i + 1 : 0 })));
    const r = await gate('cases', { 'cases.json': cases(5, false), 't.test.js': T }, { 'cases.json': cases(1) }, { baseRun: true });
    expect(r.spec.minTests).toEqual([5]);
    expect(r.spec.baseRegistered).toEqual([5]);
    expect(r.reasons).toEqual(['e2_verifier_tests_below_minimum']);
    const honest = await gate('cases-ok', { 'cases.json': cases(5, false), 't.test.js': T }, { 'cases.json': cases(5) }, { baseRun: true });
    expect(honest.reasons).toEqual([]);
  }, 120_000);
  it('base run: a base file that cannot load at base (no registered tests) falls back to the static/mission floor and records null', async () => {
    const T = "const test = require('node:test'); const d = JSON.parse(require('node:fs').readFileSync(__dirname + '/out.json', 'utf8')); test('a', () => {}); test('b', () => {});\n";
    const r = await gate('noload', { 't.test.js': T }, { 'out.json': '{}' }, { baseRun: true });
    expect(r.spec.baseRegistered).toEqual([null]);
    expect(r.spec.minTests).toEqual([2]);
    expect(r.reasons).toEqual([]);
  }, 60_000);
});
