/* Round 6 R5-1 (PILOT f4575efc): when a test file's process ends before node gets its test events (a coder module calls
   process.exit(0) on import or inside a test, or the file is empty), node --test reports ONE synthetic test named after
   the FILE, `ok 1 - t.test.mjs`, with summary `tests 1 pass 1`. With the alias `t(...)` the base count is 0, so the floor
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
/* Round 8 R7-3: `process` is a banned name in a pinned file, so the process-control vehicle (exit 0, raw stdout) is now
   refused at SPEC time; the honest fixtures use console.log only, and the hostile ones assert the spec refusal. The runtime
   synthetic/floor checks stay as defence in depth (unit-tested below / in fileLevelPoints). */
const LIB = '{"add":1}';
const T3X = "import __fs from 'node:fs'; import t from 'node:test'; import a from 'assert'; const L = JSON.parse(__fs.readFileSync(new URL(import.meta.url).pathname.replace(/[^/]*$/u, '') + 'lib.json', 'utf8'));\nif (L.print) process.stdout.write(L.print); if (L.exitOnLoad) process.exit(0);\nlet n = 0; const f = (x) => { if (L.exitAt && ++n === L.exitAt) process.exit(0); return x + L.add; };\nt('c0', () => a.strictEqual(f(0), 1)); t('c1', () => a.strictEqual(f(1), 2)); t('c2', () => a.strictEqual(f(2), 3));\n";

const T3 = "import __fs from 'node:fs'; import t from 'node:test'; import a from 'assert'; const L = JSON.parse(__fs.readFileSync(new URL(import.meta.url).pathname.replace(/[^/]*$/u, '') + 'lib.json', 'utf8'));\nif (L.print) console.log(L.print);\nconst f = (x) => x + L.add;\nt('c0', () => a.strictEqual(f(0), 1)); t('c1', () => a.strictEqual(f(1), 2)); t('c2', () => a.strictEqual(f(2), 3));\n";
async function specOf(name: string, files: Record<string, string>, testCommand = 'node --test t.test.mjs'): Promise<unknown> {
  const repo = join(root, name); mkdirSync(repo);
  const { base } = makeRepo(repo, { 'a.txt': '1\n', ...files }, { 'a.txt': '2\n' }, W);
  return G.pinVerifierSpecWithBaseRun({ testCommand, workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }));
}
async function gate(name: string, baseFiles: Record<string, string>, headFiles: Record<string, string>, testCommand = 'node --test t.test.mjs'): Promise<{ reasons: readonly string[]; reexec: G.E2ReexecEvidence | null }> {
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
    const r = await gate('ok', { 'lib.json': '{"add":0}', 't.test.mjs': T3 }, { 'lib.json': LIB });
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 3, pass: 3, fail: 0 });
    expect(r.reasons).toEqual([]);
  }, 60_000);
  it('a coder module that calls process.exit(0) on import is refused (now at spec time)', async () => {
    expect(await specOf('exit-import', { 'lib.json': LIB, 't.test.mjs': T3X })).toEqual({ refused: 'spec_pinned_test_dynamic_load' });
  }, 60_000);
  it('a coder module that calls process.exit(0) inside the second test is refused (now at spec time)', async () => {
    expect(await specOf('exit-mid', { 'lib.json': LIB, 't.test.mjs': T3X })).toEqual({ refused: 'spec_pinned_test_dynamic_load' });
  }, 60_000);
  it('an empty pinned test file is refused', async () => {
    const r = await gate('empty', { 'e.test.mjs': '' }, {}, 'node --test e.test.mjs');
    expect(r.reexec?.commands[0]?.testSummary).toEqual({ tests: 1, pass: 1, fail: 0 });
    expect(r.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
  it('a coder module that prints a fake TAP block and summary: exit is refused at spec time; console output alone cannot pass as tests', async () => {
    expect(await specOf('fake-x', { 'lib.json': LIB, 't.test.mjs': T3X })).toEqual({ refused: 'spec_pinned_test_dynamic_load' });
    const fake = 'ok 1 - c0\nok 2 - c1\nok 3 - c2\n1..3\n# tests 3\n# suites 0\n# pass 3\n# fail 0\n';
    const r = await gate('fake', { 'lib.json': LIB, 't.test.mjs': T3 }, { 'lib.json': JSON.stringify({ add: 5, print: fake }) });
    expect(r.reasons).not.toEqual([]);
  }, 60_000);
  it('a nested pinned file that exits on load is refused at spec time', async () => {
    expect(await specOf('multi', { 'lib.json': LIB, 't.test.mjs': T3, 'test/u.test.mjs': "import __fs from 'node:fs'; import __t from 'node:test'; if (JSON.parse(__fs.readFileSync(new URL(import.meta.url).pathname.replace(/[^/]*$/u, '') + '../lib.json', 'utf8')).exitOnLoad) process.exit(0); __t('u', () => {});\n" }, 'node --test test/u.test.mjs t.test.mjs')).toEqual({ refused: 'spec_pinned_test_dynamic_load' });
  }, 60_000);
  it('unit: fileLevelPoints reads only top-level points named after the run files', () => {
    const tap = 'TAP version 13\n# ok 1 - t.test.mjs\n    ok 1 - t.test.mjs\n# Subtest: t.test.mjs\nok 1 - t.test.mjs\n  ---\n  ...\nok 2 - other\n1..2\n';
    expect(G.fileLevelPoints(tap, ['t.test.mjs'])).toEqual(['t.test.mjs']);
    expect(G.fileLevelPoints(tap.replace('ok 1 - t.test.mjs\n  ---', 'ok 1 - c0\n  ---'), ['t.test.mjs'])).toEqual([]);
    expect(G.fileLevelPoints('not ok 1 - a/b.test.mjs\n', ['a/b.test.mjs'])).toEqual(['a/b.test.mjs']);
  });
});
