/* Round 8, PILOT ba9ee244 R7-5: a pinned test file that is a symlink at base was accepted at spec time; a pinned file
   under a directory the coder turns into a symlink kept its pin at gate time. Both are refused now. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as G from './e2-evidence-gate';
import { git, makeRepo } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-sym13-')));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const BODY = "import test from 'node:test'; import assert from 'node:assert/strict'; test('a', () => assert.ok(true));\n";
const R = () => G.spawnVerifierRunner({ timeoutMs: 30_000 });
describe('PILOT R7-5: symlinked pinned files', () => {
  it('a pinned test that is a symlink in the base tree is refused at spec time', async () => {
    const repo = join(root, 'a'); mkdirSync(repo);
    makeRepo(repo, { 'real/t.mjs': BODY, 'a.txt': '1\n' }, { 'a.txt': '2\n' }, W);
    symlinkSync('real/t.mjs', join(repo, 't.test.mjs'));
    git(repo, 'add', '-A'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'sym');
    const s = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test t.test.mjs', workspace: repo, base: git(repo, 'rev-parse', 'HEAD') }, R());
    expect(s).toEqual({ refused: 'spec_file_not_regular' });
  }, 60_000);
  it('a pinned file whose directory becomes a symlink (same bytes) is refused at re-exec as pin_changed', async () => {
    const repo = join(root, 'b'); mkdirSync(repo);
    const { base } = makeRepo(repo, { 'd/t.test.mjs': BODY, 'a.txt': '1\n' }, { 'a.txt': '2\n' }, W);
    const spec = await G.pinVerifierSpecWithBaseRun({ testCommand: 'node --test d/t.test.mjs', workspace: repo, base }, R());
    expect('refused' in spec).toBe(false);
    const outside = join(root, 'outside-d'); cpSync(join(repo, 'd'), outside, { recursive: true });
    rmSync(join(repo, 'd'), { recursive: true }); symlinkSync(outside, join(repo, 'd'));
    const re = await G.recordVerifierReexec({ spec: spec as G.E2VerifierSpec, cwd: repo, runner: R() });
    expect(re?.refusal).toBe('pin_changed');
    void execFileSync; void renameSync;
  }, 60_000);
});
