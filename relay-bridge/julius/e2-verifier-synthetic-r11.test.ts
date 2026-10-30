/* Round 6 R5-1 (PILOT f4575efc): when a test file's process ends before node gets its test events (a coder module calls
   process.exit(0) on import or inside a test, or the file is empty), node --test reports ONE synthetic test named after
   the FILE, `ok 1 - t.test.js`, with summary `tests 1 pass 1`. With the alias `t(...)` the base count is 0, so the floor
   is 1 and the round-5 gate passed. The gate now refuses any run whose top-level TAP points include a point named after
   a test file the spec ran. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r11s-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const LIB = 'module.exports = (x) => x + 1;\n';
const T3 = "const t = require('node:test'); const a = require('assert'); const f = require('./lib.js');\nt('c0', () => a.strictEqual(f(0), 1)); t('c1', () => a.strictEqual(f(1), 2)); t('c2', () => a.strictEqual(f(2), 3));\n";

async function gate(name: string, baseFiles: Record<string, string>, headFiles: Record<string, string>, testCommand = 'node --test t.test.js'): Promise<{ reasons: readonly string[]; reexec: G.E2ReexecEvidence | null }> {
  const repo = join(root, name); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', ...baseFiles }, { 'a.txt': '2\n', ...headFiles }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = G.pinVerifierSpec({ testCommand, workspace: repo, base }) as G.E2VerifierSpec;
  expect('refused' in spec).toBe(false);
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `${name}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return { reasons: g.ok ? [] : g.reasons, reexec };
}

describe('R5-1: a file-level synthetic pass is not a test result', () => {
  it('control: an honest run with the t() alias passes (3/3)', async () => {
    const r = await gate('ok', { 'lib.js': 'module.exports = () => 0;\n', 't.test.js': T3 }, { 'lib.js': LIB });
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 3, pass: 3, fail: 0 });
    expect(r.reasons).toEqual([]);
  }, 60_000);
  it('a coder module that calls process.exit(0) on import is refused', async () => {
    const r = await gate('exit-import', { 'lib.js': LIB, 't.test.js': T3 }, { 'lib.js': 'process.exit(0);\n' });
    expect(r.reexec?.commands[0]?.exitCode).toBe(0);
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 1, pass: 1, fail: 0 });
    expect(r.reasons).toEqual(['e2_verifier_synthetic_result']);
  }, 60_000);
  it('a coder module that calls process.exit(0) inside the second test is refused', async () => {
    const r = await gate('exit-mid', { 'lib.js': LIB, 't.test.js': T3 }, { 'lib.js': 'let n = 0; module.exports = (x) => { if (++n === 2) process.exit(0); return x + 1; };\n' });
    expect(r.reasons).toEqual(['e2_verifier_synthetic_result']);
  }, 60_000);
  it('an empty pinned test file is refused', async () => {
    const r = await gate('empty', { 'e.test.js': '' }, {}, 'node --test e.test.js');
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 1, pass: 1, fail: 0 });
    expect(r.reasons).toEqual(['e2_verifier_synthetic_result']);
  }, 60_000);
  it('a coder module that prints a fake TAP block and summary, then exits 0, is refused', async () => {
    const fake = "process.stdout.write('ok 1 - c0\\nok 2 - c1\\nok 3 - c2\\n1..3\\n# tests 3\\n# suites 0\\n# pass 3\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1\\n'); process.exit(0);\n";
    const r = await gate('fake', { 'lib.js': LIB, 't.test.js': T3 }, { 'lib.js': fake });
    expect(r.reasons).toEqual(['e2_verifier_synthetic_result']);
  }, 60_000);
  it('the synthetic point is found for one file among several, and for a nested path', async () => {
    const r = await gate('multi', { 'lib.js': LIB, 't.test.js': T3, 'test/u.test.js': "require('../lib.js'); require('node:test')('u', () => {});\n" },
      { 'lib.js': 'let n = 0; module.exports = (x) => { if (++n === 1) process.exit(0); return x + 1; };\n' }, 'node --test test/u.test.js t.test.js');
    expect(r.reasons).toEqual(['e2_verifier_synthetic_result']);
  }, 60_000);
  it('unit: fileLevelPoints reads only top-level points named after the run files', () => {
    const tap = 'TAP version 13\n# ok 1 - t.test.js\n    ok 1 - t.test.js\n# Subtest: t.test.js\nok 1 - t.test.js\n  ---\n  ...\nok 2 - other\n1..2\n';
    expect(G.fileLevelPoints(tap, ['t.test.js'])).toEqual(['t.test.js']);
    expect(G.fileLevelPoints(tap.replace('ok 1 - t.test.js\n  ---', 'ok 1 - c0\n  ---'), ['t.test.js'])).toEqual([]);
    expect(G.fileLevelPoints('not ok 1 - a/b.test.js\n', ['a/b.test.js'])).toEqual(['a/b.test.js']);
  });
});
