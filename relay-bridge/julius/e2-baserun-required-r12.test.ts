/* Round 7 PILOT R6-4: e2Gate accepted a spec built WITHOUT the base run (alias `t`: static floor 1, so one test passed
   a mission whose base registers 3). The gate now requires a spec produced by pinVerifierSpecWithBaseRun
   (e2_verifier_spec_no_base_run otherwise). The spec-minimum fallback when the base cannot load stays inside
   pinVerifierSpecWithBaseRun (baseRegistered null). Plus PILOT's surviving mutant BR7 (unreadable base tree). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = ''; let n = 0;
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r12b-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
/* Base registers 3 tests through the alias `t` (static count 0); the coder's data cuts it to 1. */
const T = "const t = require('node:test'); const k = JSON.parse(require('node:fs').readFileSync(__dirname + '/k.json', 'utf8')); for (let i = 0; i < k; i += 1) t('c' + i, () => {});\n";
async function gate(baseRun: boolean): Promise<readonly string[]> {
  n += 1; const repo = join(root, `b${n}`); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 'k.json': '3', 't.test.js': T }, { 'a.txt': '2\n', 'k.json': '1' }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const input = { testCommand: 'node --test t.test.js', workspace: repo, base };
  const spec = (baseRun ? await G.pinVerifierSpecWithBaseRun(input, runner) : G.pinVerifierSpec(input)) as G.E2VerifierSpec;
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `b${n}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return g.ok ? [] : g.reasons;
}
describe('R6-4: the gate requires a base-run spec', () => {
  it('PILOT V11b: a spec without the base run is refused by the gate', async () => {
    expect(await gate(false)).toEqual(['e2_verifier_spec_no_base_run']);
  }, 60_000);
  it('the same case with the base run is refused on the floor (3 registered at base)', async () => {
    expect(await gate(true)).toEqual(['e2_verifier_tests_below_minimum']);
  }, 60_000);
  it('BR7: an unreadable base tree is a refusal, never the static spec', async () => {
    const repo = join(root, 'br7'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 'a.txt': '1\n', 'other.txt': 'x\n', 't.test.js': "require('node:test')('x', () => {});\n" }, {}, W);
    const oid = execFileSync('git', ['-C', repo, 'rev-parse', `${base}:other.txt`]).toString().trim();
    unlinkSync(join(repo, '.git/objects', oid.slice(0, 2), oid.slice(2)));
    expect(await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.js', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))).toEqual({ refused: 'spec_base_tree_unreadable' });
  }, 60_000);
});
