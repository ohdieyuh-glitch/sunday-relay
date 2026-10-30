/* Round 6: Skywalker f4575efc L1 (Node_Modules case), PILOT R5-6 (nested package.json `imports` redirect) and
   Skywalker L4 (a mission-declared non-edit name must not be an edit-capable name). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = ''; let n = 0;
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r11c-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
async function world(baseFiles: Record<string, string>, headFiles: Record<string, string>, tc: string) {
  n += 1;
  const repo = join(root, `w${n}`); mkdirSync(repo);
  const { base, head } = makeRepo(repo, baseFiles, headFiles, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = G.pinVerifierSpec({ testCommand: tc, workspace: repo, base }) as G.E2VerifierSpec;
  expect('refused' in verifierSpec).toBe(false);
  const p = { verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }), diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL };
  const { lines, evidence } = await liveCapture(root, `w${n}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p });
  return { g, reexec: p.reexec };
}
const T = "const test = require('node:test'); const a = require('assert'); const h = require('#h');\ntest('h', () => a.strictEqual(h(), 2));\n";
describe('L1: node_modules in the diff, any case', () => {
  for (const dir of ['Node_Modules', 'NODE_MODULES', 'sub/Node_modules']) {
    it(`${dir}/x.js in the diff is e2_verifier_binary_untrusted`, async () => {
      const { g } = await world({ 'a.txt': '1\n', 't.test.js': "require('node:test')('x', () => {});\n" }, { 'a.txt': '2\n', [`${dir}/x.js`]: 'module.exports = 1;\n' }, 'node --test t.test.js');
      expect(g.ok ? [] : g.reasons).toContain('e2_verifier_binary_untrusted');
    });
  }
});
describe('R5-6: a nested package.json in the diff', () => {
  const base = { 'a.txt': '1\n', 'test/package.json': JSON.stringify({ imports: { '#h': './h.js' } }), 'test/h.js': 'module.exports = () => 1;\n', 'test/stub.js': 'module.exports = () => 2;\n', 'test/t.test.js': T };
  /* Round 7 R6-1/R6-3: a pinned test that loads `#h` (an imports-map specifier, i.e. workspace code) is refused at spec time. */
  it('PILOT world: a pinned test that loads #h is now refused at spec time (spec_pinned_test_imports_untrusted)', async () => {
    const repo = join(root, 'pilot-h'); mkdirSync(repo);
    const { base: b } = makeRepo(repo, base, { 'a.txt': '2\n', 'test/package.json': JSON.stringify({ imports: { '#h': './stub.js' } }) }, W);
    expect(G.pinVerifierSpec({ testCommand: 'node --test test/t.test.js', workspace: repo, base: b })).toEqual({ refused: 'spec_pinned_test_imports_untrusted' });
  });
  const B2 = { 'a.txt': '1\n', 'test/t.test.js': "require('node:test')('x', () => {});\n" };
  it('PILOT world, builtin-only test: a nested package.json in the diff is still refused', async () => {
    const { g, reexec } = await world(B2, { 'a.txt': '2\n', 'test/package.json': JSON.stringify({ imports: { '#h': './stub.js' } }) }, 'node --test test/t.test.js');
    expect(reexec?.commands[0]?.exitCode).toBe(0);
    expect(g.ok ? [] : g.reasons).toContain('e2_verifier_binary_untrusted');
  });
  it('a new nested Package.JSON is refused too', async () => {
    const { g } = await world(B2, { 'a.txt': '2\n', 'test/sub/Package.JSON': '{}' }, 'node --test test/t.test.js');
    expect(g.ok ? [] : g.reasons).toContain('e2_verifier_binary_untrusted');
  });
  it('control: an unrelated diff with the same base is not refused for this', async () => {
    const { g } = await world(B2, { 'a.txt': '2\n' }, 'node --test test/t.test.js');
    expect(g.ok ? [] : g.reasons).not.toContain('e2_verifier_binary_untrusted');
  });
});
describe('L4: mission-declared non-edit names', () => {
  const repo = () => { const r = join(root, 'l4'); mkdirSync(r, { recursive: true }); return r; };
  let b = '';
  beforeAll(() => { ({ base: b } = makeRepo(repo(), { 'ok.mjs': "import test from 'node:test'; test('ok', () => {});\n" }, { 'ok.mjs': "import test from 'node:test'; test('ok', () => {});\n//\n" }, W)); });
  for (const name of ['reapply', 'str_replace_editor', 'create_file', 'EDIT_FILE', 'write_file', 'rename_file', 'move_file', 'insert_text', 'notebook_edit', 'Patch']) {
    it(`${name} is spec_invalid`, () => {
      expect(G.pinVerifierSpec({ testCommand: 'node ok.mjs', minTests: 1, workspace: repo(), base: b, extraKnownNonEditTools: [name] })).toEqual({ refused: 'spec_invalid' });
    });
  }
  for (const name of ['fetch_rules', 'grep_search', 'web_fetch', 'list_files']) {
    it(`${name} is accepted`, () => {
      const s = G.pinVerifierSpec({ testCommand: 'node ok.mjs', minTests: 1, workspace: repo(), base: b, extraKnownNonEditTools: [name] });
      expect('refused' in s ? s.refused : s.extraKnownNonEditTools).toEqual([name]);
    });
  }
});
