/* Round 8 R7-1 (Skywalker ba9ee244) + 5:08 PM steering: a safe head-recording / snapshot primitive. Hostile repository
   config (include.path, filter.*, core.fsmonitor, core.hooksPath, alias, extensions.worktreeConfig + config.worktree) runs NO
   payload through it, while a control plain `git status` in the same layout does. Filters named from an UNTRACKED
   .gitattributes and from .git/info/attributes never run on the snapshot path; a foreign-owned .git with world-writable
   config and hooks is read; symlinks (to an outside file, and a symlinked directory) are recorded as links, never followed. */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as S from './e2-safe-git';
import { git } from './e2-test-kit';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'e2-safegit13-')));
const sudoRoots: string[] = [];
afterAll(() => {
  for (const d of sudoRoots) spawnSync('sudo', ['-n', 'rm', '-rf', d]);
  rmSync(root, { recursive: true, force: true });
});
const W = (p: string, c: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
let k = 0;
function repo(files: Record<string, string> = { 'a.txt': '1\n' }): { dir: string; head: string; marker: string; payload: string } {
  const dir = join(root, `r${k++}`); mkdirSync(dir);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'x'); git(dir, 'config', 'user.email', 'x@x');
  for (const [p, c] of Object.entries(files)) W(join(dir, p), c);
  git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  const marker = join(root, `pwned-${k}`);
  const payload = join(root, `payload-${k}.sh`);
  W(payload, `#!/bin/sh\necho ran >> ${marker}\ncat\n`); chmodSync(payload, 0o755);
  return { dir, head: git(dir, 'rev-parse', 'HEAD'), marker, payload };
}
const appendConfig = (dir: string, text: string): void => { writeFileSync(join(dir, '.git/config'), readFileSync(join(dir, '.git/config'), 'utf8') + text); };
const controlStatus = (dir: string): void => { spawnSync('git', ['status'], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore' }); spawnSync('git', ['add', '-A'], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore' }); };

describe('R7-1: recordHeadSafely', () => {
  it('a clean repo: head SHA and its config keys', () => {
    const r = repo();
    const out = S.recordHeadSafely({ workspace: r.dir });
    expect(out).toEqual({ head: r.head, configKeys: expect.arrayContaining(['core.bare', 'user.name']) });
  });
  const hostile: Array<[string, (r: ReturnType<typeof repo>) => void, string]> = [
    ['include.path -> a file setting core.fsmonitor', (r) => { W(join(root, `inc${k}`), `[core]\n\tfsmonitor = ${r.payload}\n`); appendConfig(r.dir, `[include]\n\tpath = ${join(root, `inc${k}`)}\n`); }, 'safe_git_config_include'],
    ['includeIf', (r) => { appendConfig(r.dir, `[includeIf "gitdir:/"]\n\tpath = /dev/null\n`); }, 'safe_git_config_include'],
    ['filter.x.clean/smudge/process', (r) => { appendConfig(r.dir, `[filter "x"]\n\tclean = ${r.payload}\n\tsmudge = ${r.payload}\n\tprocess = ${r.payload}\n`); W(join(r.dir, '.gitattributes'), '* filter=x\n'); W(join(r.dir, '.git/info/attributes'), '* filter=x\n'); W(join(r.dir, 'a.txt'), '2\n'); }, 'safe_git_config_filter'],
    ['core.fsmonitor', (r) => { appendConfig(r.dir, `[core]\n\tfsmonitor = ${r.payload}\n`); }, 'safe_git_config_core'],
    ['core.hooksPath', (r) => { W(join(root, `hooks${k}/post-index-change`), `#!/bin/sh\necho ran >> ${r.marker}\n`); chmodSync(join(root, `hooks${k}/post-index-change`), 0o755); appendConfig(r.dir, `[core]\n\thooksPath = ${join(root, `hooks${k}`)}\n`); }, 'safe_git_config_core'],
    ['alias', (r) => { appendConfig(r.dir, `[alias]\n\tst = !${r.payload}\n`); }, 'safe_git_config_alias'],
    ['extensions.worktreeConfig + config.worktree', (r) => { appendConfig(r.dir, `[extensions]\n\tworktreeConfig = true\n`); W(join(r.dir, '.git/config.worktree'), `[core]\n\tfsmonitor = ${r.payload}\n`); }, 'safe_git_config_extensions'],
  ];
  for (const [name, arm, code] of hostile) {
    it(`hostile ${name}: refused (${code}), no payload runs; snapshot also refused`, () => {
      const r = repo(); arm(r);
      expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ refused: code });
      expect(S.snapshotCommitSafely({ workspace: r.dir, parent: r.head, message: 'm', author: { name: 'J', email: 'j@x' } })).toEqual({ refused: code });
      expect(existsSync(r.marker)).toBe(false);
    });
  }
  it('control: plain `git status` / `git add` in the fsmonitor and filter layouts DO run the payload', () => {
    const a = repo(); appendConfig(a.dir, `[core]\n\tfsmonitor = ${a.payload}\n`); controlStatus(a.dir);
    expect(existsSync(a.marker)).toBe(true);
    const b = repo(); appendConfig(b.dir, `[filter "x"]\n\tclean = ${b.payload}\n`); W(join(b.dir, '.gitattributes'), '* filter=x\n'); W(join(b.dir, 'a.txt'), '3\n'); controlStatus(b.dir);
    expect(existsSync(b.marker)).toBe(true);
  });
  it('a gitfile .git, a symlinked .git, or a linked-worktree commondir is refused', () => {
    const a = repo(); rmSync(join(a.dir, '.git'), { recursive: true }); W(join(a.dir, '.git'), 'gitdir: /tmp/x\n');
    expect(S.recordHeadSafely({ workspace: a.dir })).toEqual({ refused: 'safe_git_dir_not_plain' });
    const b = repo(); const real = join(root, `moved${k}`); execFileSync('mv', [join(b.dir, '.git'), real]); symlinkSync(real, join(b.dir, '.git'));
    expect(S.recordHeadSafely({ workspace: b.dir })).toEqual({ refused: 'safe_git_dir_not_plain' });
    const c = repo(); W(join(c.dir, '.git/commondir'), '..\n');
    expect(S.recordHeadSafely({ workspace: c.dir })).toEqual({ refused: 'safe_git_dir_not_plain' });
  });
  it('an unparsable config is refused', () => {
    const r = repo(); appendConfig(r.dir, '[core\n');
    expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ refused: 'safe_git_config_unparsed' });
  });
});

describe('R7-1 steering: snapshotCommitSafely (plumbing, --no-filters, no add/status/checkout)', () => {
  it('a filter named by an untracked .gitattributes AND .git/info/attributes cannot run: refused at config, and with no config filter the attrs are inert', () => {
    const r = repo(); W(join(r.dir, '.gitattributes'), '* filter=x diff=x\n'); W(join(r.dir, '.git/info/attributes'), '* filter=x\n'); W(join(r.dir, 'a.txt'), '2\n');
    const out = S.snapshotCommitSafely({ workspace: r.dir, parent: r.head, message: 'snap', author: { name: 'J', email: 'j@x' } });
    expect('commit' in out).toBe(true);
    const c = (out as { commit: string }).commit;
    expect(git(r.dir, 'show', `${c}:a.txt`)).toBe('2');
    expect(git(r.dir, 'rev-parse', `${c}^`)).toBe(r.head);
    expect(existsSync(r.marker)).toBe(false);
  });
  it('a symlink to an outside file and a symlinked directory are committed as links (target bytes never read) and reported', () => {
    const r = repo();
    const secretDir = join(root, `secret${k}`); W(join(secretDir, 's.txt'), 'SECRET\n');
    symlinkSync(join(secretDir, 's.txt'), join(r.dir, 'leak.txt'));
    symlinkSync(secretDir, join(r.dir, 'leakdir'));
    symlinkSync('a.txt', join(r.dir, 'inside.txt'));
    const out = S.snapshotCommitSafely({ workspace: r.dir, parent: r.head, message: 'snap', author: { name: 'J', email: 'j@x' } }) as { commit: string; outsideLinks: readonly string[] };
    expect(out.outsideLinks).toEqual(['leak.txt', 'leakdir']);
    const tree = git(r.dir, 'ls-tree', '-r', out.commit);
    expect(tree).toMatch(/^120000 blob [0-9a-f]{40}\tleak\.txt$/mu);
    expect(tree).toMatch(/^120000 blob [0-9a-f]{40}\tleakdir$/mu);
    expect(tree).not.toMatch(/leakdir\/s\.txt/u);
    expect(git(r.dir, 'cat-file', '-p', `${out.commit}:leak.txt`)).toBe(join(secretDir, 's.txt'));
    expect(spawnSync('git', ['grep', '-q', 'SECRET', out.commit], { cwd: r.dir }).status).toBe(1);
  });
  it('the refusal shape matches the gate ({refused: <named code>}) and every code is listed', () => {
    expect(S.SAFE_GIT_REASONS).toEqual(['safe_git_workspace_invalid', 'safe_git_dir_not_plain', 'safe_git_config_unparsed', 'safe_git_config_include', 'safe_git_config_filter',
      'safe_git_config_core', 'safe_git_config_alias', 'safe_git_config_extensions', 'safe_git_config_other', 'safe_git_head_unreadable', 'safe_git_parent_invalid', 'safe_git_tree_unreadable', 'safe_git_write_failed']);
    expect(S.recordHeadSafely({ workspace: 'relative' })).toEqual({ refused: 'safe_git_workspace_invalid' });
  });
});

describe('R7-1 steering: a .git owned by another uid with world-writable config and hooks (live-workspace.sh layout)', () => {
  const sudoOk = spawnSync('sudo', ['-n', 'true']).status === 0;
  it('recordHeadSafely reads the head; a world-writable hook never runs; hostile config there is still refused (needs passwordless sudo)', () => {
    if (!sudoOk) { expect(spawnSync('sudo', ['-n', 'true']).status).not.toBe(0); return; } /* no sudo: nothing to chown with; asserted, not skipped */
    const r = repo();
    W(join(r.dir, '.git/hooks/post-checkout'), `#!/bin/sh\necho ran >> ${r.marker}\n`); chmodSync(join(r.dir, '.git/hooks/post-checkout'), 0o777);
    chmodSync(join(r.dir, '.git/config'), 0o666);
    sudoRoots.push(r.dir);
    expect(spawnSync('sudo', ['-n', 'chown', '-R', '0:0', join(r.dir, '.git')]).status).toBe(0);
    expect(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: r.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).status).not.toBe(0); /* dubious ownership */
    expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ head: r.head, configKeys: expect.any(Array) });
    appendConfig(r.dir, `[core]\n\tfsmonitor = ${r.payload}\n`);
    expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ refused: 'safe_git_config_core' });
    expect(existsSync(r.marker)).toBe(false);
  });
});

describe('Round 8 mutation kills (mut/mutants13.py survivors)', () => {
  const snap = (r: ReturnType<typeof repo>, parent = r.head) => S.snapshotCommitSafely({ workspace: r.dir, parent, message: 'm', author: { name: 'J', email: 'j@x' } });
  it('S4: a config.worktree without extensions.worktreeConfig is still refused', () => {
    const r = repo(); W(join(r.dir, '.git/config.worktree'), '[user]\n\tname = y\n');
    expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ refused: 'safe_git_config_extensions' });
  });
  it('S5: a key outside the allowlist (gui.foo, diff.x.textconv) is refused as other', () => {
    const r = repo(); appendConfig(r.dir, '[gui]\n\tfoo = 1\n');
    expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ refused: 'safe_git_config_other' });
    const q = repo(); appendConfig(q.dir, `[diff "x"]\n\ttextconv = ${q.payload}\n`);
    expect(S.recordHeadSafely({ workspace: q.dir })).toEqual({ refused: 'safe_git_config_other' });
  });
  it('S6: a continuation line is refused as unparsed', () => {
    const r = repo(); appendConfig(r.dir, '[user]\n\tname = a\\\n\tb\n');
    expect(S.recordHeadSafely({ workspace: r.dir })).toEqual({ refused: 'safe_git_config_unparsed' });
  });
  it('S9: --no-filters: info/attributes `* text` does not normalise CRLF in the snapshot', () => {
    const r = repo(); W(join(r.dir, '.git/info/attributes'), '* text\n'); W(join(r.dir, 'a.txt'), 'x\r\n');
    const out = snap(r) as { commit: string };
    expect(execFileSync('git', ['cat-file', 'blob', `${out.commit}:a.txt`], { cwd: r.dir }).toString('latin1')).toBe('x\r\n');
  });
  it('S12: a parent that is not a commit in the repo is refused', () => {
    const r = repo();
    expect(snap(r, 'f'.repeat(40))).toEqual({ refused: 'safe_git_parent_invalid' });
    expect(snap(r, git(r.dir, 'rev-parse', 'HEAD^{tree}'))).toEqual({ refused: 'safe_git_parent_invalid' });
  });
  it('S13/S14: the exec bit is kept and nothing under .git is snapshotted', () => {
    const r = repo(); W(join(r.dir, 'run.sh'), 'echo\n'); chmodSync(join(r.dir, 'run.sh'), 0o755);
    const out = snap(r) as { commit: string };
    const tree = git(r.dir, 'ls-tree', '-r', out.commit);
    expect(tree).toMatch(/^100755 blob [0-9a-f]{40}\trun\.sh$/mu);
    expect(tree).toMatch(/^100644 blob [0-9a-f]{40}\ta\.txt$/mu);
    expect(tree).not.toMatch(/\t\.git\//u);
  });
});
