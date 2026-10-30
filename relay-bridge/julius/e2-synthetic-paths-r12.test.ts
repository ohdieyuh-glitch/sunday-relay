/* Round 7 R6-2 (Skywalker 70f96cfe): node names its synthetic file-level point after the file as NORMALISED by node
   (`./t.test.js` -> `t.test.js`, `sub/../t.test.js` -> `t.test.js`), so comparing the raw argv let an exit-on-load run
   pass. Both sides are now normalised. Each case runs through the FULL gate; the pinned test file exits on load. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = ''; let n = 0;
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r12p-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const EXIT = "process.exit(0);\nrequire('node:test')('never', () => {});\n";
async function gate(testCommand: string): Promise<readonly string[] | string> {
  n += 1; const repo = join(root, `p${n}`); mkdirSync(repo);
  const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 't.test.js': EXIT, 'sub/t.test.js': EXIT }, { 'a.txt': '2\n' }, W);
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = G.pinVerifierSpec({ testCommand, workspace: repo, base });
  if ('refused' in spec) return spec.refused;
  const reexec = await G.recordVerifierReexec({ spec, cwd: repo, runner });
  const { lines, evidence } = await liveCapture(root, `p${n}.jsonl`, GOOD());
  const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
  return g.ok ? [] : g.reasons;
}
describe('R6-2: synthetic point names are compared after normalisation', () => {
  for (const tc of ['node --test t.test.js', 'node --test ./t.test.js', 'node --test .//t.test.js', 'node --test sub/../t.test.js', 'node --test ./sub/t.test.js', 'node --test sub//t.test.js', 'node --test ./sub/./t.test.js']) {
    it(`${tc}: exit on load is refused (spec refusal or synthetic_result, never a pass)`, async () => {
      const r = await gate(tc);
      if (typeof r === 'string') expect(r).not.toBe('');
      else expect(r).toContain('e2_verifier_synthetic_result');
    }, 60_000);
  }
  it('a path escaping the workspace is refused at spec time', async () => {
    expect(await gate('node --test ../t.test.js')).toBe('path_outside_workspace');
  });
  it('unit: fileLevelPoints normalises both sides', () => {
    const tap = 'ok 1 - t.test.js\nok 2 - sub/t.test.js\nok 3 - other\n';
    expect(G.fileLevelPoints(tap, ['./t.test.js', 'sub//./t.test.js'])).toEqual(['t.test.js', 'sub/t.test.js']);
    expect(G.fileLevelPoints('ok 1 - sub\\t.test.js\n', ['sub/t.test.js'])).toEqual(['sub\\t.test.js']);
  });
});
