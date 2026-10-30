/* Round 6 kill tests from the round-6 mutation run: stdout past E2_TAP_MAX_BYTES cannot be checked whole, so it is not a
   test result (mutants R3/R22), and the base run needs the trusted spawn runner (mutant R5). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = '';
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r11cap-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
describe('TAP size cap and base-run runner', () => {
  it('three real passing tests with 9 MiB of logged output are e2_verifier_synthetic_result (stdout too large to check)', async () => {
    const repo = join(root, 'cap'); mkdirSync(repo);
    const T = "const test = require('node:test');\ntest('a', () => { process.stdout.write('x'.repeat(9 * 1024 * 1024) + '\\n'); });\ntest('b', () => {});\ntest('c', () => {});\n";
    const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 't.test.js': T }, { 'a.txt': '2\n' }, W);
    const runner = G.spawnVerifierRunner({ timeoutMs: 60_000 });
    const verifierSpec = (await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.js', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    const reexec = await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner });
    expect(reexec?.commands[0]?.exitCode).toBe(0);
    expect(reexec?.commands[0]?.tapComplete).toBe(false);
    const { lines, evidence } = await liveCapture(root, 'cap.jsonl', GOOD());
    const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL } as Parameters<typeof G.e2Gate>[0]);
    expect(g.ok ? [] : g.reasons).toEqual(['e2_verifier_synthetic_result']);
  }, 60_000);
  it('the base run refuses a runner that is not the trusted spawn runner', async () => {
    const repo = join(root, 'br'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 't.test.js': "require('node:test')('x', () => {});\n" }, { 'a.txt': '2\n' }, W);
    const fake: G.VerifierRunner = async () => ({ exitCode: 0, stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64), stdoutBytes: 0, stderrBytes: 0 });
    expect(await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.js', workspace: repo, base }, fake)).toEqual({ refused: 'spec_base_run_untrusted' });
  });
});
