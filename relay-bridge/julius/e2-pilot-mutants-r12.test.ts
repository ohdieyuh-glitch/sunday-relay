/* Round 7 (PILOT 70f96cfe R6-6): kill tests for her surviving mutants S3, BR3, BR4 and SP3 (S5 and BR5 are equivalent). */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as G from './e2-evidence-gate';
import { anchorOf, GOOD, liveCapture, makeRepo, MODEL, RUN } from './e2-test-kit';

const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };

const root = mkdtempSync(join(tmpdir(), 'e2-pm12-'));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const SUMMARY = (n: number) => `# tests ${n}\n# suites 0\n# pass ${n}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 5\n`;
const POINT = (i: number, name: string) => `# Subtest: ${name}\nok ${i} - ${name}\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n`;
const TAP = (points: number, summary: number) => `TAP version 13\n${Array.from({ length: points }, (_, i) => POINT(i + 1, `t${i + 1}`)).join('')}1..${points}\n${SUMMARY(summary)}`;

describe('BR3/BR4: what a base run registers', () => {
  it('a sane base run registers its count', () => {
    expect(G.baseRegisteredCount(G.analyzeTap(TAP(3, 3), ['t.test.js'], false))).toBe(3);
  });
  it('BR3: a summary that is not the number of test points registers nothing', () => {
    expect(G.baseRegisteredCount(G.analyzeTap(TAP(2, 3), ['t.test.js'], false))).toBeNull();
  });
  it('BR4: truncated (incomplete) TAP registers nothing even with a summary', () => {
    const tap = G.analyzeTap(TAP(3, 3), ['t.test.js'], true);
    expect(tap.summary).not.toBeNull();
    expect(G.baseRegisteredCount(tap)).toBeNull();
  });
});

describe('S3: a head run whose summary count is not its test points is synthetic', () => {
  it('2 points with a summary of 3 is e2_verifier_synthetic_result', async () => {
    const repo = join(root, 's3'); mkdirSync(repo);
    const { base, head } = makeRepo(repo, { 'a.txt': '1\n', 't.test.js': "const test = require('node:test');\ntest('a', () => {});\n" }, { 'a.txt': '2\n' }, W);
    const verifierSpec = (await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.js', workspace: repo, base }, G.spawnVerifierRunner({ timeoutMs: 30_000 }))) as G.E2VerifierSpec;
    const out = TAP(2, 3);
    const fake: G.VerifierRunner = async () => ({ exitCode: 0, stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64), stdoutBytes: out.length, stderrBytes: 0, stdoutTail: out, stdoutTruncated: false });
    const reexec = await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner: fake });
    expect(reexec?.commands[0]?.testPoints).toBe(2);
    expect(reexec?.commands[0]?.testSummary?.tests).toBe(3);
    const { lines, evidence } = await liveCapture(root, 's3.jsonl', GOOD());
    const g = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), verifierSpec, reexec, diff: await G.recordGitDiff({ base, head, cwd: repo, runner: G.spawnVerifierRunner({ timeoutMs: 30_000 }) }), binding: { runId: RUN, base, head, workspace: repo }, modelId: MODEL });
    expect(g.ok ? [] : g.reasons).toContain('e2_verifier_synthetic_result');
  }, 60_000);
});

describe('SP3: bare node --test discovery skips node_modules in any case', () => {
  it('a tracked Node_Modules/x.test.js is not pinned', () => {
    const repo = join(root, 'sp3'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 'a.txt': '1\n', 't.test.js': "const test = require('node:test');\ntest('a', () => {});\n", 'Node_Modules/x.test.js': "const test = require('node:test');\ntest('n', () => {});\n" }, { 'a.txt': '2\n' }, W);
    const s = G.pinVerifierSpec({ testCommand: 'node --test', workspace: repo, base });
    expect('refused' in s ? s.refused : s.commands).toEqual([['node', '--test', '--test-reporter=tap', 't.test.js']]);
  });
});
