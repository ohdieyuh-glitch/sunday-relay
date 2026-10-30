/* Round 7 R6-1 / R6-3 (Skywalker 70f96cfe): a pinned test file that loads coder code lets that code speak node's
   child-v8 test protocol (or print a synthetic result) and forge passes the gate cannot tell from real ones. Closed by
   REFUSAL IN THE SPEC: every pinned file is scanned at base; anything but a (non-executing) Node built-in, a dynamic or
   computed load, or a NODE_TEST_CONTEXT reference refuses the spec. Plain `node <file>` needs a mission minTests floor. */
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = ''; let n = 0;
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r12s-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
type Out = { refused: string } | { reasons: readonly string[]; summary: unknown };
async function gate(baseFiles: Record<string, string>, headFiles: Record<string, string>, testCommand = 'node --test t.test.js', minTests?: number, seedDir?: string): Promise<Out> {
  n += 1; const repo = join(root, `s${n}`); mkdirSync(repo);
  if (seedDir !== undefined) cpSync(seedDir, repo, { recursive: true });
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', ...baseFiles }, { 'a.txt': '2\n', ...headFiles }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = await G.pinVerifierSpecWithBaseRun({ testCommand, workspace: repo, base, ...(minTests === undefined ? {} : { minTests }) }, runner);
  if ('refused' in spec) return { refused: spec.refused };
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `s${n}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return { reasons: g.ok ? [] : g.reasons, summary: reexec?.commands[0]?.testSummary ?? null };
}
const UNTRUSTED = { refused: 'spec_pinned_test_imports_untrusted' };
/* The forged-protocol case: the pinned test loads a coder module; at head that module, seeing NODE_TEST_CONTEXT, would
   write node's child protocol itself. The spec refuses before anything runs. */
const FORGE = "if (process.env.NODE_TEST_CONTEXT === 'child-v8') { /* write serialized test:pass events, then exit */ process.exit(0); }\nmodule.exports = (x) => x + 1;\n";
const T_REL = "const test = require('node:test'); const a = require('node:assert'); const f = require('./lib.js');\ntest('c0', () => a.strictEqual(f(0), 1));\n";
const T_OK = "const test = require('node:test'); const a = require('assert'); const fs = require('node:fs');\ntest('c0', () => a.strictEqual(fs.readFileSync('a.txt', 'utf8'), '2\\n'));\n";

describe('R6-1/R6-3: the spec refuses pinned test files that load anything but Node built-ins', () => {
  it('the forged-protocol case is refused at spec time through the full gate', async () => {
    expect(await gate({ 'lib.js': 'module.exports = () => 0;\n', 't.test.js': T_REL }, { 'lib.js': FORGE })).toEqual(UNTRUSTED);
  }, 60_000);
  it('a relative import (ESM, re-export, side effect, require) is refused', async () => {
    for (const src of ["import test from 'node:test'; import f from './lib.mjs';\ntest('x', () => f());\n", "export * from '../x.js';\n", "import './setup.js';\n", "const x = require(\"./x\");\n", "import test from 'node:test'; import p from 'lodash';\n"]) {
      expect(G.scanPinnedSource(src)).toBe('spec_pinned_test_imports_untrusted');
    }
    expect(await gate({ 'lib.mjs': 'export default () => 1;\n', 't.test.mjs': "import test from 'node:test'; import f from './lib.mjs';\ntest('x', () => f());\n" }, {}, 'node --test t.test.mjs')).toEqual(UNTRUSTED);
  }, 60_000);
  it('dynamic or computed loads are refused', () => {
    for (const src of ["const m = './l' + 'ib'; await import(m);\n", "require(`./${x}`);\n", "const r = require; r('./lib');\n", "eval('1');\n", "new Function('return 1')();\n", "process.binding('fs');\n", "module.require('./x');\n", "const s = `${require(x)}`;\n", "require.resolve('./x');\n"]) {
      expect([src, G.scanPinnedSource(src)]).toEqual([src, 'spec_pinned_test_dynamic_load']);
    }
  });
  it('built-ins that execute other code are refused', () => {
    for (const b of ['node:child_process', 'child_process', 'node:vm', 'node:worker_threads', 'node:module', 'node:v8', 'cluster', 'node:inspector', 'node:wasi', 'node:repl']) {
      expect([b, G.scanPinnedSource(`import x from '${b}';\n`)]).toEqual([b, 'spec_pinned_test_imports_untrusted']);
    }
  });
  it('a NODE_TEST_CONTEXT reference is refused', async () => {
    expect(G.scanPinnedSource("const c = process.env.NODE_TEST_CONTEXT;\n")).toBe('spec_pinned_test_context_reference');
    expect(G.scanPinnedSource("const c = process.env['NODE_TEST_' + 'CONTEXT'];\n")).toBe('spec_pinned_test_context_reference');
    expect(await gate({ 't.test.js': "require('node:test')('x', () => {}); delete process.env.NODE_TEST_CONTEXT;\n" }, {})).toEqual({ refused: 'spec_pinned_test_context_reference' });
  }, 60_000);
  it('a builtin-only file is accepted and passes the full gate', async () => {
    expect(G.scanPinnedSource(T_OK)).toBeNull();
    expect(G.scanPinnedSource("// require('./x') in a comment\nconst s = \"import('./y')\"; import a from 'node:assert/strict'; export {};\n")).toBeNull();
    expect(await gate({ 't.test.js': T_OK }, {})).toEqual({ reasons: [], summary: { tests: 1, pass: 1, fail: 0 } });
  }, 60_000);
  it('julius-inworld-data-1 seed fixture: accepted, 4/4 with a correct solution', async () => {
    const seed = resolve(__dirname, '../../.github/julius-missions/julius-inworld-data-1/workspace');
    const doc = { schema: 'inworld-ledger.v1', records: [], rejects: [], counts: { input_rows: 0, records: 0, rejects: 0 }, totals: { grand_total_cc: 0, by_post: [1, 2, 3, 4].map((i) => ({ post: `p${i}`, settled_total_cc: 0 })) } };
    const r = await gate({}, { 'out/normalized.json': JSON.stringify(doc) }, 'node --test format.test.mjs', undefined, seed);
    expect(r).toEqual({ reasons: [], summary: { tests: 4, pass: 4, fail: 0 } });
  }, 60_000);
  it('plain `node <file>` is refused without a mission floor, and the floor is enforced with one', async () => {
    const T2 = "const test = require('node:test');\ntest('a', () => {}); test('b', () => {});\n";
    expect(await gate({ 't.test.js': T2 }, {}, 'node t.test.js')).toEqual({ refused: 'spec_plain_node_no_floor' });
    expect(await gate({ 't.test.js': T2 }, {}, 'node t.test.js', 0)).toEqual({ refused: 'spec_plain_node_no_floor' });
    expect(await gate({ 't.test.js': T2 }, {}, 'node t.test.js', 2)).toEqual({ reasons: [], summary: { tests: 2, pass: 2, fail: 0 } });
    const r = await gate({ 't.test.js': T2 }, {}, 'node t.test.js', 3);
    expect('reasons' in r && r.reasons.length > 0).toBe(true);
    expect(await gate({ 't.test.js': "process.exit(0);\n" }, {}, 'node t.test.js', 1)).not.toEqual(expect.objectContaining({ reasons: [] }));
  }, 120_000);
});
describe('Round 7 PILOT R6-7: the pinned-source scan refuses the AST-scan forms too', () => {
  it('createRequire, module.require, mainModule.require, eval, Function, a case-changed builtin and a computed path are refused', () => {
    const forms = [
      "const { createRequire } = require('node:module'); createRequire(__filename)('x');",
      "module.require('node:fs');", "process.mainModule.require('node:fs');", "eval('1');", "new Function('1');",
      "require('Node:FS');", "const p = 'node:fs'; require(p);", "require('../outside/x.js');",
    ];
    for (const f of forms) expect(G.scanPinnedSource(f), f).not.toBeNull();
    expect(G.scanPinnedSource("const test = require('node:test'); const assert = require('node:assert');")).toBeNull();
  });
});
