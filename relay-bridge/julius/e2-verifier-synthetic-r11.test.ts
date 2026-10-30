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
/* Round 7 R6-1/R6-3: a pinned test may not load coder code (spec refusal), so the coder-editable "module" is now DATA
   (lib.json) the base test acts on: `add` is the answer, `exitAt` exits inside the n-th call, `exitOnLoad` exits before
   any test, `print` writes coder-chosen text first. The runtime checks see the same process behaviour as before. */
const LIB = '{"add":1}';
const T3 = "const t = require('node:test'); const a = require('assert'); const L = JSON.parse(require('node:fs').readFileSync(__dirname + '/lib.json', 'utf8'));\nif (L.print) process.stdout.write(L.print); if (L.exitOnLoad) process.exit(0);\nlet n = 0; const f = (x) => { if (L.exitAt && ++n === L.exitAt) process.exit(0); return x + L.add; };\nt('c0', () => a.strictEqual(f(0), 1)); t('c1', () => a.strictEqual(f(1), 2)); t('c2', () => a.strictEqual(f(2), 3));\n";

async function gate(name: string, baseFiles: Record<string, string>, headFiles: Record<string, string>, testCommand = 'node --test t.test.js'): Promise<{ reasons: readonly string[]; reexec: G.E2ReexecEvidence | null }> {
  const repo = join(root, name); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', ...baseFiles }, { 'a.txt': '2\n', ...headFiles }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = (await G.pinVerifierSpecWithBaseRun({ testCommand, workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
  expect('refused' in spec).toBe(false);
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `${name}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return { reasons: g.ok ? [] : g.reasons, reexec };
}

describe('R5-1: a file-level synthetic pass is not a test result', () => {
  it('control: an honest run with the t() alias passes (3/3)', async () => {
    const r = await gate('ok', { 'lib.json': '{"add":0}', 't.test.js': T3 }, { 'lib.json': LIB });
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 3, pass: 3, fail: 0 });
    expect(r.reasons).toEqual([]);
  }, 60_000);
  it('a coder module that calls process.exit(0) on import is refused', async () => {
    const r = await gate('exit-import', { 'lib.json': LIB, 't.test.js': T3 }, { 'lib.json': '{"add":1,"exitOnLoad":true}' });
    expect(r.reexec?.commands[0]?.exitCode).toBe(0);
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 1, pass: 1, fail: 0 });
    expect(r.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
  it('a coder module that calls process.exit(0) inside the second test is refused', async () => {
    const r = await gate('exit-mid', { 'lib.json': LIB, 't.test.js': T3 }, { 'lib.json': '{"add":1,"exitAt":2}' });
    expect(r.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
  it('an empty pinned test file is refused', async () => {
    const r = await gate('empty', { 'e.test.js': '' }, {}, 'node --test e.test.js');
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 1, pass: 1, fail: 0 });
    expect(r.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
  it('a coder module that prints a fake TAP block and summary, then exits 0, is refused', async () => {
    const fake = 'ok 1 - c0\nok 2 - c1\nok 3 - c2\n1..3\n# tests 3\n# suites 0\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
    const r = await gate('fake', { 'lib.json': LIB, 't.test.js': T3 }, { 'lib.json': JSON.stringify({ add: 1, exitOnLoad: true, print: fake }) });
    expect(r.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
  it('the synthetic point is found for one file among several, and for a nested path', async () => {
    const r = await gate('multi', { 'lib.json': LIB, 't.test.js': T3, 'test/u.test.js': "if (JSON.parse(require('node:fs').readFileSync(__dirname + '/../lib.json', 'utf8')).exitOnLoad) process.exit(0); require('node:test')('u', () => {});\n" },
      { 'lib.json': '{"add":1,"exitOnLoad":true}' }, 'node --test test/u.test.js t.test.js');
    expect(r.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
  it('unit: fileLevelPoints reads only top-level points named after the run files', () => {
    const tap = 'TAP version 13\n# ok 1 - t.test.js\n    ok 1 - t.test.js\n# Subtest: t.test.js\nok 1 - t.test.js\n  ---\n  ...\nok 2 - other\n1..2\n';
    expect(G.fileLevelPoints(tap, ['t.test.js'])).toEqual(['t.test.js']);
    expect(G.fileLevelPoints(tap.replace('ok 1 - t.test.js\n  ---', 'ok 1 - c0\n  ---'), ['t.test.js'])).toEqual([]);
    expect(G.fileLevelPoints('not ok 1 - a/b.test.js\n', ['a/b.test.js'])).toEqual(['a/b.test.js']);
  });
});
