/* Round 6: PILOT R5-7 (the static floor counts `.test(` and test( in comments/strings) and kill tests for the surviving
   mutants PILOT R5-9 F2/B3 and Skywalker L6 (Infinity in pos()). G1 (grace min-clamp) is argued equivalent in NOTES. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, liveCapture, makeRepo, anchorOf } from './e2-test-kit';

let root = ''; let n = 0;
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r11f-'))); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const repoWith = (files: Record<string, string>, head: Record<string, string> = { 'a.txt': '2\n' }) => {
  n += 1; const repo = join(root, `r${n}`); mkdirSync(repo);
  return { repo, ...makeRepo(repo, { 'a.txt': '1\n', ...files }, head, W) };
};
describe('R5-7: static floor lexer', () => {
  it('regex .test(, comments and strings do not count; one real test gives floor 1 and passes', async () => {
    const T = "import test from 'node:test'; \n// test( one\n/* it( two test( */\nconst s = 'test(' + \"it(\" + `test(`;\nconst ok = /x/.test('x');\ntest('real', () => { if (!ok || !s) throw new Error(); });\n";
    const { repo, base } = repoWith({ 't.test.mjs': T });
    const s = G.pinVerifierSpec({ testCommand: 'node --test t.test.mjs', workspace: repo, base });
    expect('refused' in s ? s.refused : s.minTests).toEqual([1]);
  });
  it('real calls are still counted (test, it, nested in describe, after a division)', () => {
    const T = "import { test, it, describe } from 'node:test'; \nconst x = 4 / 2; test('a', () => {});\ndescribe('d', () => { it('b', () => {}); it ('c', () => {}); });\n";
    const { repo, base } = repoWith({ 't.test.mjs': T });
    const s = G.pinVerifierSpec({ testCommand: 'node --test t.test.mjs', workspace: repo, base });
    expect('refused' in s ? s.refused : s.minTests).toEqual([3]);
  });
});
describe('R5-9 F2: the floor is at least 1', () => {
  it('an all-skipped base file (static count 0) is refused: pass 0 is below the floor of 1', async () => {
    const { repo, base, head } = repoWith({ 't.test.mjs': "import test from 'node:test'; \ntest.skip('x', () => {});\n" });
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const verifierSpec = (await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    expect(verifierSpec.minTests).toEqual([1]);
    const p = { verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }), diff: await G.recordGitDiff({ base, head, cwd: repo, runner }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL };
    const { lines, evidence } = await liveCapture(root, 'f2.jsonl', GOOD());
    const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p });
    expect(g.ok ? [] : g.reasons).toContain('e2_verifier_tests_below_minimum');
  });
});
describe('R5-9 B3: a recorded diff with unknown paths', () => {
  it('exit 0 but no path list (the runner has no capture) is e2_verifier_binary_untrusted', async () => {
    const { repo, base, head } = repoWith({ 'ok.mjs': 'process.exit(0)\n' });
    const fake: G.VerifierRunner = async () => ({ exitCode: 0, stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64), stdoutBytes: 10, stderrBytes: 0 });
    const diff = await G.recordGitDiff({ base, head, cwd: repo, runner: fake });
    expect(diff?.paths).toBeNull();
    expect(diff?.exitCode).toBe(0);
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const verifierSpec = (await G.pinVerifierSpecWithBaseRun({ testCommand: 'node ok.mjs', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    const { lines, evidence } = await liveCapture(root, 'b3.jsonl', GOOD());
    const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }), diff, binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL } as Parameters<typeof G.e2Gate>[0]);
    expect(g.ok ? [] : g.reasons).toContain('e2_verifier_binary_untrusted');
  });
});
describe('Skywalker L6: Infinity in pos()', () => {
  it('exitGraceMs: Infinity falls back to the 500 ms default (held pipes end long before the 6 s deadline)', async () => {
    W(join(root, 'late.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }); writeFileSync(process.argv[2], String(c.pid)); c.unref();\n`);
    const pid = join(root, 'pinf');
    const t = Date.now();
    try {
      const r = await G.spawnVerifierRunner({ timeoutMs: 6000, exitGraceMs: Infinity })(['node', 'late.mjs', pid], root);
      expect('cause' in r ? r.cause : null).toBe('pipes_held_after_exit');
      expect(Date.now() - t).toBeLessThan(3000);
    } finally { try { if (existsSync(pid)) process.kill(Number(readFileSync(pid, 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
  });
});
