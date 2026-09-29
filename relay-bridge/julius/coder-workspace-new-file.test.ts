import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  juliusAttemptStartCommand, juliusAttemptCloseCommand,
  parseJuliusAttemptStart, parseJuliusAttemptClose,
} from './coder-workspace';

/**
 * DOES A FILE THE CODER CREATED SHOW UP AS WORK IT DID?
 *
 * This looks like a question about git and it is really a question about whether
 * Julius can ever accept a mission that produces a NEW file. A no-check mission is
 * held to its `DIFF`, and `DIFF` is PASSED only when `workspace.changes` is
 * non-empty. If that change set came from `git diff` against the index, an
 * untracked new file would be INVISIBLE: the coder would write the file, the
 * executor would report no change, the run would park in VERIFYING, and nothing
 * in the record would name what was missing. I asserted that failure mode to the
 * integration lane as a real constraint before checking it. It is not one, and
 * this suite is why I can say so.
 *
 * WHAT MAKES IT WORK is `git add -A` into a TEMPORARY index followed by
 * `git write-tree`: a content-addressed tree of what the DIRECTORY holds, tracked
 * and untracked alike, with the real index untouched. So the assertions below are
 * about a real repository and real git, not about a parser reading a fixture.
 */

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A real repository with one committed file, which is the state an attempt starts from. */
const repo = (): string => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'julius-newfile-'));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'fixture@local.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'existing.ts'), 'export const existing = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  return root;
};

/**
 * WHICH BASH, AND WHY THE ANSWER IS NOT "bash" ON WINDOWS.
 *
 * `execFileSync('bash')` on Windows resolves through CreateProcess, which
 * searches System32 BEFORE the PATH -- so it runs `C:\Windows\System32\bash.exe`,
 * the WSL launcher, and every command in this suite ran in a different operating
 * system with no repository in it (measured 2026-09-28: four failures, each a
 * null tree id). The executor runs these scripts in a Linux container, where
 * `bash` is bash. On Windows the suite uses Git's own bash, found beside the git
 * it already drives; without one it cannot answer, and says so by skipping.
 */
const BASH: string | null = (() => {
  if (process.platform !== 'win32') return 'bash';
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    const candidate = resolve(execPath, '..', '..', '..', 'bin', 'bash.exe');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
})();

/** The executor runs these as one shell script; here bash stands in for it. */
const run = (cwd: string, script: string): string =>
  execFileSync(BASH ?? 'bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

/**
 * The start of an attempt, with its two tree ids NARROWED.
 *
 * `parseJuliusAttemptStart` always returns a record and every field on it is
 * nullable, because a workspace that is not a git repository parses to nulls
 * rather than throwing. Narrowing here means a parse that produced nulls fails
 * with "the attempt start must carry both tree ids" instead of every later
 * assertion failing on a type it cannot explain.
 */
const startOf = (cwd: string): { readonly baseTree: string; readonly startTree: string } => {
  const start = parseJuliusAttemptStart(run(cwd, juliusAttemptStartCommand(null)), null);
  expect(typeof start.baseTree, 'the attempt start must carry both tree ids').toBe('string');
  expect(typeof start.startTree, 'the attempt start must carry both tree ids').toBe('string');
  return { baseTree: start.baseTree as string, startTree: start.startTree as string };
};

describe.skipIf(BASH === null)('a file the coder CREATED is observable as work', () => {
  it('an untracked new file is in the attempt start snapshot, and in the close-out change set', () => {
    const root = repo();
    const start = startOf(root);

    // THE ONLY EDIT IS A CREATION. Nothing tracked is touched, which is exactly
    // the case that would have been invisible to a `git diff` of the index.
    writeFileSync(join(root, 'brand-new.ts'), 'export const created = 2;\n');

    const close = parseJuliusAttemptClose(
      run(root, juliusAttemptCloseCommand({ baseTree: start.baseTree, startTree: start.startTree })), true);

    expect(close.status.captured).toBe(true);
    const paths = close.status.changes.map((change) => change.path);
    expect(paths, `a created file must be observable: ${JSON.stringify(close.status.changes)}`)
      .toContain('brand-new.ts');

    // AND IT IS THE ATTEMPT'S OWN WORK, not inherited. The distinction is what
    // lets a reviewer be shown what THIS attempt did.
    expect(close.own?.map((change) => change.path) ?? [], 'the creation belongs to this attempt')
      .toContain('brand-new.ts');

    // The end tree differs from the tree the attempt started at, which is what
    // makes the change content-addressed rather than a status string.
    expect(close.endTree).not.toBe(start.startTree);
  });

  it('a nested created file is observable too, directories and all', () => {
    const root = repo();
    const start = startOf(root);
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    writeFileSync(join(root, 'src', 'deep', 'nested.ts'), 'export const nested = 3;\n');
    const close = parseJuliusAttemptClose(
      run(root, juliusAttemptCloseCommand({ baseTree: start.baseTree, startTree: start.startTree })), true);
    expect(close.status.changes.map((change) => change.path)).toContain('src/deep/nested.ts');
  });

  it('THE CONTROL: a workspace nobody touched reports no change, so the assertions above mean something', () => {
    const root = repo();
    const start = startOf(root);
    const close = parseJuliusAttemptClose(
      run(root, juliusAttemptCloseCommand({ baseTree: start.baseTree, startTree: start.startTree })), true);
    expect(close.status.changes, 'an untouched workspace must not look like work').toEqual([]);
    expect(close.endTree, 'and its tree must not move').toBe(start.startTree);
  });

  it('an IGNORED new file is NOT observable, which is the boundary of the claim', () => {
    // `git add -A` honours .gitignore, so a coder cannot make ignored output look
    // like a deliverable. Worth pinning: it is the one case where creating a file
    // genuinely produces no evidence, and a mission whose product lands in an
    // ignored path would park with nothing missing that anyone could name.
    const root = repo();
    writeFileSync(join(root, '.gitignore'), 'generated/\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'ignore generated');
    const start = startOf(root);
    mkdirSync(join(root, 'generated'), { recursive: true });
    writeFileSync(join(root, 'generated', 'out.js'), 'module.exports = 4;\n');
    const close = parseJuliusAttemptClose(
      run(root, juliusAttemptCloseCommand({ baseTree: start.baseTree, startTree: start.startTree })), true);
    expect(close.status.changes.map((change) => change.path), 'ignored output is not a deliverable')
      .not.toContain('generated/out.js');
  });
});
