/* Round 5 lows: PILOT 44c062b9 R4-6/R4-7 and Skywalker 44c062b9 L1/L3/L5. Failing-first where the code changes; the rest
   kill mutants Skywalker reported as surviving (Move to, /dev/null, the one-argument-form rule). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redactSecrets } from './cursor-cloud-agents-transport';
import * as G from './e2-evidence-gate';
import { MODEL, RUN, START, anchorOf, call, ev, liveCapture, makeRepo, tail } from './e2-test-kit';

let root = ''; let repo = ''; let base = ''; let head = '';
let P: { verifierSpec: G.E2VerifierSpec; reexec: G.E2ReexecEvidence | null; diff: G.E2DiffEvidence | null; modelId: string };
beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r10l-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  ({ base, head } = makeRepo(repo, { 'a.txt': 'one\n', 'ok.mjs': 'process.exit(0)\n' }, { 'a.txt': 'two\n' }, (p, c) => writeFileSync(p, c)));
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = G.pinVerifierSpec({ testCommand: 'node ok.mjs', workspace: repo, base }) as G.E2VerifierSpec;
  P = { verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }), diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), modelId: MODEL };
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
let k = 0;
async function gate(calls: readonly [string, unknown][], extra: Record<string, unknown> = {}): Promise<readonly string[]> {
  k += 1;
  const { lines, evidence } = await liveCapture(root, `l${k}.jsonl`, START + calls.map(([n, a], i) => call(`c${i}`, n, a)).join('') + tail());
  const r = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...P, binding: { runId: RUN, base, head, workspace: repo, ...extra } } as Parameters<typeof G.e2Gate>[0]);
  return r.ok ? [] : r.reasons;
}

describe('apply_patch headers (R4-6, Move to, /dev/null, one argument form)', () => {
  it('R4-6: an indented *** Update File: header is read', async () => {
    expect(await gate([['apply_patch', { patch: '*** Begin Patch\n  *** Update File: zzz.txt\n@@\n-a\n+b\n*** End Patch\n' }]])).toEqual(['e2_edit_path_not_in_diff']);
    expect(await gate([['apply_patch', { patch: '*** Begin Patch\n\t*** Update File: a.txt\n*** End Patch\n' }]])).toEqual([]);
  });
  it('*** Move to: names a path that must be in the diff', async () => {
    expect(await gate([['apply_patch', { patch: '*** Update File: a.txt\n*** Move to: zzz.txt\n' }]])).toEqual(['e2_edit_path_not_in_diff']);
  });
  it('/dev/null is not a path (unknown, not outside-workspace)', async () => {
    expect(await gate([['edit_file', { paths: ['a.txt', '/dev/null'] }]])).toEqual(['e2_edit_path_unknown']);
  });
  it('exactly one argument form: path plus paths is unknown', async () => {
    expect(await gate([['edit_file', { path: 'a.txt', paths: ['a.txt'] }]])).toEqual(['e2_edit_path_unknown']);
  });
});

describe('Skywalker L3: remoteWorkspaceRoot must be absolute, normalised and not /', () => {
  it('a bad root is refused with a name', async () => {
    for (const r of ['/', 'rel/dir', '/x/../y', '/x/./y', '', '/x/']) {
      expect(await gate([['edit_file', { path: 'a.txt' }]], { remoteWorkspaceRoot: r }), JSON.stringify(r)).toEqual(['e2_binding_remote_root_invalid']);
    }
    expect(await gate([['edit_file', { path: '/agent/ws/a.txt' }]], { remoteWorkspaceRoot: '/agent/ws' })).toEqual([]);
  });
});

describe('R4-7 / Skywalker L5: more encodings fail closed, and the stream stops on residue', () => {
  const XAI = `xai-${'Zq9'.repeat(8)}`;
  it('a Cyrillic homoglyph prefix and space-separated hex are residue', () => {
    expect(redactSecrets(`v ${XAI.replace('x', '\u0445')} w`).residue).toBe(true);
    expect(redactSecrets(`v ${Buffer.from(XAI).toString('hex').match(/../gu)!.join(' ')} w`).residue).toBe(true);
    expect(redactSecrets('plain words with хорошо and 0a 0b').residue).toBeUndefined();
  });
  it('both stay linear on 1 MiB', () => {
    for (const unit of ['\u0445ai-', '78 61 69 2d ']) {
      const t0 = performance.now();
      redactSecrets(unit.repeat(Math.ceil((1024 * 1024) / unit.length)));
      expect(performance.now() - t0, unit).toBeLessThan(5000);
    }
  });
  it('stream level: an encoded secret stops the capture with e2_stream_secret_residue and is never stored', async () => {
    const b64 = Buffer.from(XAI).toString('base64');
    const { lines, evidence } = await liveCapture(root, 'res.jsonl', START + call('c1', 'edit_file') + ev('assistant', { text: `here ${b64} done` }, '1713033005000-0') + tail());
    expect((evidence as { cause?: unknown }).cause).toBe('e2_stream_secret_residue');
    expect(lines.join('\n')).not.toContain(b64);
    expect(lines.join('\n')).not.toContain(XAI);
  });
});
