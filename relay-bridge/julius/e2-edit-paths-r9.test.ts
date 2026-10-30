/* Round 4 M3/R3-6: a closed tool-name table (NOT VERIFIED against live Cursor), path-less tools are not edits,
   apply_patch text and `paths` lists are parsed, a remote workspace root is stripped, outside paths are named. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { MODEL, RUN, START, call, liveCapture, makeRepo, tail, anchorOf } from './e2-test-kit';

let root = ''; let repo = ''; let base = ''; let head = '';
let P: Awaited<ReturnType<typeof parts>>;
async function parts() {
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = G.pinVerifierSpec({ testCommand: 'node ok.mjs', minTests: 1, workspace: repo, base }) as G.E2VerifierSpec;
  return {
    verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }),
    diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), modelId: MODEL,
  };
}
beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r9p-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  ({ base, head } = makeRepo(repo, { 'a.txt': 'one\n', 'ok.mjs': "import test from 'node:test'; test('ok', () => {});\n" }, { 'a.txt': 'two\n' }, (p, c) => writeFileSync(p, c)));
  P = await parts();
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
let k = 0;
async function gate(calls: readonly [string, unknown][], extra: Record<string, unknown> = {}): Promise<readonly string[]> {
  k += 1;
  const { lines, evidence } = await liveCapture(root, `p${k}.jsonl`, START + calls.map(([n, a], i) => call(`c${i}`, n, a)).join('') + tail());
  const r = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...P, binding: { runId: RUN, base, head, workspace: repo, ...extra } } as Parameters<typeof G.e2Gate>[0]);
  return r.ok ? [] : r.reasons;
}

describe('closed edit-tool table (NOT VERIFIED against live Cursor tool names)', () => {
  const EDIT = ['edit_file', 'search_replace', 'write', 'apply_patch', 'delete_file', 'MultiEdit', 'Edit', 'Write'];
  it('the exported table is exactly this list', () => { expect([...(G as unknown as { E2_EDIT_TOOL_NAMES?: readonly string[] }).E2_EDIT_TOOL_NAMES ?? []]).toEqual(EDIT); });
  for (const name of EDIT) {
    it(`${name} counts as an edit: its path must be in the diff`, async () => {
      expect(await gate([[name, { path: 'a.txt' }]])).toEqual([]);
      expect(await gate([[name, { path: 'zzz.txt' }]])).toEqual(['e2_edit_path_not_in_diff']);
    });
  }
  it('todo_write (and other known path-less tools) are not edits and do not trigger e2_edit_path_unknown', async () => {
    expect(await gate([['edit_file', { path: 'a.txt' }], ['todo_write', { todos: [{ id: '1', content: 'x' }] }], ['read_file', { path: 'zzz.txt' }], ['grep', { pattern: 'x' }]])).toEqual([]);
  });
  it('an unknown tool name is refused with a name, not guessed', async () => {
    expect(await gate([['frobnicate_files', { path: 'a.txt' }]])).toContain('e2_tool_unknown');
    expect(await gate([['edit_file', { path: 'a.txt' }], ['frobnicate_files', {}]])).toEqual(['e2_tool_unknown']);
  });
});

describe('edit-path parsing', () => {
  it('apply_patch text: every *** Update/Add/Delete File and +++ b/ path must be in the diff', async () => {
    expect(await gate([['apply_patch', { patch: '*** Begin Patch\n*** Update File: a.txt\n@@\n-one\n+two\n*** End Patch' }]])).toEqual([]);
    expect(await gate([['apply_patch', { patch: '*** Begin Patch\n*** Update File: a.txt\n*** Add File: other.txt\n+x\n*** End Patch' }]])).toEqual(['e2_edit_path_not_in_diff']);
    expect(await gate([['apply_patch', { patch: '--- a/a.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-one\n+two\n' }]])).toEqual(['e2_edit_path_not_in_diff']);
    expect(await gate([['apply_patch', { patch: 'no headers here' }]])).toEqual(['e2_edit_path_unknown']);
  });
  it('a `paths` list: every entry must be in the diff', async () => {
    expect(await gate([['edit_file', { paths: ['a.txt'] }]])).toEqual([]);
    expect(await gate([['edit_file', { paths: ['a.txt', 'nope.txt'] }]])).toEqual(['e2_edit_path_not_in_diff']);
    expect(await gate([['edit_file', { paths: [] }]])).toEqual(['e2_edit_path_unknown']);
  });
  it('a remote workspace root is stripped; an absolute path outside every root or a .. escape is named', async () => {
    expect(await gate([['edit_file', { path: '/workspace/remote/a.txt' }]], { remoteWorkspaceRoot: '/workspace/remote' })).toEqual([]);
    expect(await gate([['edit_file', { path: '/etc/passwd' }]], { remoteWorkspaceRoot: '/workspace/remote' })).toEqual(['e2_edit_path_outside_workspace']);
    expect(await gate([['edit_file', { path: '../a.txt' }]])).toEqual(['e2_edit_path_outside_workspace']);
  });
});
