/* Round 5, Skywalker 44c062b9 M3: unknown tool names stay fail-closed, but the refusal lists ALL of them in one cause,
   and the mission/wiring (never the coder) can declare extra read-only names on the pinned spec. No names guessed here. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { MODEL, RUN, START, anchorOf, call, liveCapture, makeRepo, tail } from './e2-test-kit';

let root = ''; let repo = ''; let base = ''; let head = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r10u-')));
  repo = join(root, 'r'); mkdirSync(repo);
  ({ base, head } = makeRepo(repo, { 'a.txt': '1\n', 'ok.mjs': 'process.exit(0)\n' }, { 'a.txt': '2\n' }, W));
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

async function run(names: string[], extra?: readonly string[]) {
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const spec = G.pinVerifierSpec({ testCommand: 'node ok.mjs', workspace: repo, base, ...(extra === undefined ? {} : { extraKnownNonEditTools: extra }) }) as G.E2VerifierSpec;
  const sse = START + call('c0', 'edit_file') + names.map((n, i) => call(`u${i}`, n, {})).join('') + tail();
  const { lines, evidence } = await liveCapture(root, `u${Math.random()}.jsonl`, sse);
  return G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec: spec, reexec: await G.recordVerifierReexec({ spec, cwd: repo, runner }),
    diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
}

describe('M3: unknown tools', () => {
  it('one cause, every unknown name listed (sorted, unique)', async () => {
    const g = await run(['zeta_tool', 'alpha_tool', 'zeta_tool']);
    expect(g.ok).toBe(false);
    expect(g.ok ? null : g.reasons).toEqual(['e2_tool_unknown']);
    expect(g.ok ? null : g.unknownTools).toEqual(['alpha_tool', 'zeta_tool']);
  }, 60_000);
  it('spec-declared extraKnownNonEditTools pass; undeclared ones still refuse', async () => {
    expect((await run(['alpha_tool'], ['alpha_tool'])).ok).toBe(true);
    const g = await run(['alpha_tool', 'zeta_tool'], ['alpha_tool']);
    expect(g.ok ? null : g.unknownTools).toEqual(['zeta_tool']);
  }, 60_000);
  it('extras cannot redeclare an edit tool, and must be non-empty strings', () => {
    for (const bad of [['edit_file'], [''], [3 as unknown as string], 'x' as unknown as string[]]) {
      expect(G.pinVerifierSpec({ testCommand: 'node ok.mjs', workspace: repo, base, extraKnownNonEditTools: bad }), String(bad)).toEqual({ refused: 'spec_invalid' });
    }
  });
});
