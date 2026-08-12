import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { disposeRetainedWorktree } from './ship-mission';

/**
 * DISPOSING A RETAINED WORKTREE — the mechanism the High fix relies on.
 *
 * A review found a retained worktree (kept for shipping) leaked on the ordinary
 * reviewer-rejection path, because `fail()` set phase only. The fix calls
 * `disposeRetainedWorktree` from `fail()`, `cancelled()`, and the ship route's
 * `finally`. These prove the disposer; the ship-route finally is exercised by
 * `ship-route.test.ts`.
 */

const temporaries: string[] = [];
afterEach(() => {
  for (const p of temporaries.splice(0)) {
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
function temp(prefix: string): string {
  const p = mkdtempSync(join(tmpdir(), prefix));
  temporaries.push(p);
  return p;
}
const GIT_ENV = (root: string) => ({
  PATH: process.env.PATH ?? '', HOME: root,
  GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
  GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
});
function repoWithWorktree(): { root: string; worktreePath: string } {
  const root = temp('relay-disp-src-');
  const git = (a: string[], cwd = root) => execFileSync('git', a, { cwd, env: GIT_ENV(root) });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const v = 1;\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);
  const worktreePath = temp('relay-disp-wt-');
  rmSync(worktreePath, { recursive: true, force: true });
  git(['worktree', 'add', '-b', 'relay/mission-1', worktreePath, 'main']);
  writeFileSync(join(worktreePath, 'src', 'app.js'), 'export const v = 2;\n');
  return { root, worktreePath };
}

describe('disposeRetainedWorktree', () => {
  it('removes the worktree directory and prunes its admin entry', () => {
    const { root, worktreePath } = repoWithWorktree();
    expect(existsSync(worktreePath)).toBe(true);
    disposeRetainedWorktree({ worktreePath, sourceRepositoryPath: root, workingBranch: 'relay/mission-1' });
    expect(existsSync(worktreePath)).toBe(false);
    const list = execFileSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8', env: GIT_ENV(root) });
    expect(list).not.toContain(worktreePath);
  });

  it('keeps the working branch — for a local ship it IS the deliverable', () => {
    const { root, worktreePath } = repoWithWorktree();
    execFileSync('git', ['add', '--', '.'], { cwd: worktreePath, env: GIT_ENV(root) });
    execFileSync('git', ['commit', '-m', 'relay change'], { cwd: worktreePath, env: GIT_ENV(root) });
    disposeRetainedWorktree({ worktreePath, sourceRepositoryPath: root, workingBranch: 'relay/mission-1' });
    const branches = execFileSync('git', ['branch', '--list', 'relay/mission-1'], { cwd: root, encoding: 'utf8', env: GIT_ENV(root) });
    expect(branches).toContain('relay/mission-1');
  });

  it('is total: the directory goes even outside a git repo, and never throws', () => {
    const orphan = temp('relay-disp-orphan-');
    writeFileSync(join(orphan, 'f'), 'x');
    expect(() => disposeRetainedWorktree({
      worktreePath: orphan, sourceRepositoryPath: temp('relay-disp-nogit-'), workingBranch: 'x',
    })).not.toThrow();
    expect(existsSync(orphan)).toBe(false);
  });
});
