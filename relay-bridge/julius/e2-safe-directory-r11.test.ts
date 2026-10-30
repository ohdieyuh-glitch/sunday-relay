/* Round 6 H1 (Skywalker f4575efc): every gate git call carries -c safe.directory=<exact realpath of the workspace>
   (never `*`). A truly foreign-owned workspace cannot be made on this box (no root, no newuidmap), so the
   foreign-owner case is simulated with git's own GIT_TEST_ASSUME_DIFFERENT_OWNER=1 by replaying the RECORDED argv. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as G from './e2-evidence-gate';
import { makeRepo } from './e2-test-kit';

let root = ''; let repo = ''; let link = ''; let base = ''; let head = '';
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r11sd-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  ({ base, head } = makeRepo(repo, { 'a.txt': 'one\n', 'ok.mjs': 'process.exit(0)\n' }, { 'a.txt': 'two\n' }, (p, c) => writeFileSync(p, c)));
  link = join(root, 'link'); symlinkSync(repo, link);
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const replay = (argv: readonly string[], cwd: string) => spawnSync(argv[0] as string, argv.slice(1), {
  cwd, env: { PATH: process.env.PATH, HOME: root, ...G.E2_GIT_ENV, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
describe('H1: pinned safe.directory on gate git calls', () => {
  it('e2GitPins pins the exact realpath (a symlinked path resolves), never *', () => {
    const pins = G.e2GitPins(link);
    expect(pins).toContain(`safe.directory=${repo}`);
    expect(pins.join(' ')).not.toMatch(/safe\.directory=\*/u);
  });
  it('the recorded diff argv carries the pin and succeeds for an assumed-foreign owner; without the pin git refuses (dubious ownership)', async () => {
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const ev = await G.recordGitDiff({ base, head, cwd: repo, runner });
    expect(ev?.argv).toContain(`safe.directory=${repo}`);
    const ok = replay(ev!.argv, repo);
    expect(ok.status).toBe(0);
    const i = ev!.argv.indexOf(`safe.directory=${repo}`);
    const stripped = [...ev!.argv.slice(0, i - 1), ...ev!.argv.slice(i + 1)];
    const no = replay(stripped, repo);
    expect(no.status).not.toBe(0);
    expect(no.stderr.toString()).toMatch(/dubious ownership|Not a git repository/u);
  });
  it('a pin for a different path does not help (dubious ownership)', async () => {
    const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
    const ev = await G.recordGitDiff({ base, head, cwd: repo, runner });
    const argv = ev!.argv.map((a) => (a === `safe.directory=${repo}` ? `safe.directory=${root}/other` : a));
    const no = replay(argv, repo);
    expect(no.status).not.toBe(0);
    expect(no.stderr.toString()).toMatch(/dubious ownership|Not a git repository/u);
  });
});
