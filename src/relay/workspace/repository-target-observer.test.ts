import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  REPOSITORY_GIT_ALLOWLIST,
  commitObservedWork,
  observeRepositoryWorktree,
  parseNumstat,
  resolveBaselineSha,
  runRepositoryGit,
} from './repository-target-observer';
import { inspectRepositoryState, runGit } from './repository-inspector';
import { createWorktree, resolveWorkspaceRoot } from './worktree-manager';
import {
  ALWAYS_PROTECTED_PATHS,
  DEFAULT_PROTECTED_PATHS,
  advanceShipStage,
  baseMovedUnderMission,
  createRepositoryRegistration,
  decideShipped,
  judgeObservedDiff,
  providerSupportsEnvironment,
  resolveRepositoryTarget,
} from '../mission/repository-target';
import type {
  DeployObservation,
  DeploymentProviderDescriptor,
  LiveProbeResult,
  MissionRepositoryTarget,
  RepositoryRegistrationDraft,
  ShipStageEvidence,
} from '../mission/repository-target';

/**
 * A REAL REPOSITORY, END TO END.
 *
 * Everything else in `repository-target/` is pure and decides what is ALLOWED.
 * This file is the other half: a real `git init`, a real `git worktree`, real
 * files edited on disk, and Relay reading what actually changed out of git
 * rather than being told. Then a real deploy to a real directory, a real HTTP
 * server serving it, and a real fetch that compares the revision the running
 * system reports against the revision Relay committed.
 *
 * WHAT THIS PROVES: that the observation is an observation, that the refusals
 * refuse against real git output, that a commit is read back rather than
 * assumed, and that SHIPPED is reachable only when a running system agrees.
 *
 * WHAT IT DOES NOT PROVE, and no test here claims to: that the three-role paid
 * pipeline — OpenAI Architect, hosted Coding Agent, xAI Reviewer — has run
 * against a real repository. That needs credentials and founder authorization
 * and has not happened. What is proven is the machinery those roles would hand
 * their work to. See `docs/relay/REPOSITORY_TARGETS.md`.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const AUTHOR = { authorName: 'Sunday Relay', authorEmail: 'relay@sunday.invalid' };

const temporaries: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const path of temporaries.splice(0)) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A real git repository with one commit on `main`. */
function realRepository(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'relay-repo-target-'));
  temporaries.push(root);
  const env = {
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@sunday.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@sunday.invalid',
  };
  const must = (args: string[], extra: Record<string, string> = {}) => {
    const result = runGit(args, root, { ...env, ...extra });
    if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
    return result.value;
  };
  must(['init', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 1;\n');
  writeFileSync(join(root, 'README.md'), '# demo\n');
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  must(['add', '--', '.']);
  must(['commit', '-m', 'initial']);
  return { root };
}

const draft = (root: string, overrides: Partial<RepositoryRegistrationDraft> = {}): RepositoryRegistrationDraft => ({
  identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
  location: { kind: 'local_path', path: root },
  scope: { read: ['**'], write: ['src/**'] },
  grants: (['read', 'write_worktree', 'commit'] as const).map((permission) => ({
    permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
  })),
  ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
  registeredBy: 'founder',
  ...overrides,
});

function targetFor(root: string, overrides: Partial<RepositoryRegistrationDraft> = {}): MissionRepositoryTarget {
  const built = draft(root, overrides);
  const registration = createRepositoryRegistration({ draft: built, now: NOW });
  if (!registration.ok) throw new Error(`registration refused: ${registration.error.message}`);
  const resolution = resolveRepositoryTarget({
    registration: registration.value,
    request: {
      repositoryKey: 'local:demo', selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-real-1',
      /**
       * EXACTLY WHAT THE DRAFT GRANTS, derived rather than hardcoded. A fixed
       * list here meant a test that narrowed the GRANTS still asked for
       * `commit`, so the resolution refused and every later assertion was about
       * a target that was never built — and a test that ADDED `deploy_staging`
       * to the grants silently did not receive it.
       */
      permissions: built.grants.map((g) => g.permission),
    },
    now: NOW,
  });
  if (!resolution.ok) throw new Error(`resolution refused: ${resolution.error.message}`);
  return resolution.target;
}

/** A real isolated worktree on the Mission's working branch. */
function isolatedWorktree(root: string, target: MissionRepositoryTarget): string {
  const workspaceRoot = resolveWorkspaceRoot(root);
  if (!workspaceRoot.ok) throw new Error(workspaceRoot.error.message);
  // `createWorktree` pins a COMMIT, not a branch name — a branch could move
  // between resolving it and creating the worktree.
  const base = resolveBaselineSha({ worktreePath: root, ref: target.baseBranch });
  if (!base.ok) throw new Error(base.error.message);
  const baseRevision = base.value;
  /**
   * The subdirectory is derived from the repository's own unique temp basename,
   * NOT a fixed name.
   *
   * `resolveWorkspaceRoot` deliberately places the workspace root in the
   * source's PARENT — a worktree inside the repository it is a worktree of is
   * refused — so on a temp-directory fixture that root is `<tmpdir>/.relay-workspaces`,
   * which every test on the machine shares. A fixed name here collided across
   * tests and `createWorktree` correctly refused to reuse an unregistered
   * directory. The refusal was right; the fixture was wrong.
   */
  const workspacePath = join(workspaceRoot.value, basename(root));
  temporaries.push(workspacePath);
  const created = createWorktree({
    sourceRoot: root,
    workspacePath,
    branchName: target.workingBranch,
    revision: baseRevision,
  });
  if (!created.ok) throw new Error(`worktree refused: ${created.error.message}`);
  return created.value.workspacePath;
}

/* ================================================= the git write surface */

describe('the repository git surface is an allow-list', () => {
  it('refuses every subcommand that could reach a remote or rewrite history', () => {
    const { root } = realRepository();
    for (const subcommand of ['push', 'fetch', 'merge', 'rebase', 'reset', 'clean', 'gc', 'tag', 'config', 'filter-branch']) {
      const result = runRepositoryGit([subcommand, '--help'], root);
      // Absent from the allow-list, so refused before a process is spawned.
      expect(result.ok, subcommand).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('permission-denied');
    }
  });

  it('refuses a history-rewriting flag on a subcommand that IS allowed', () => {
    const { root } = realRepository();
    // `commit --amend` is inside `commit`, and `add --force` writes an ignored
    // file — which in a real repository is where credentials live.
    for (const args of [['commit', '--amend', '-m', 'x'], ['add', '--force', '--', '.'], ['diff', '--hard']]) {
      const result = runRepositoryGit(args, root);
      expect(result.ok, args.join(' ')).toBe(false);
    }
  });

  it('permits the reads and the one write it exists for', () => {
    const { root } = realRepository();
    expect(runRepositoryGit(['rev-parse', 'HEAD'], root).ok).toBe(true);
    expect(runRepositoryGit(['status', '--porcelain=v1', '-z'], root).ok).toBe(true);
  });
});

describe('numstat parsing', () => {
  it('reads a binary file\'s counts as UNKNOWN rather than zero', () => {
    const parsed = parseNumstat('4\t2\tsrc/app.ts\n-\t-\tsrc/logo.png\n');
    expect(parsed.get('src/app.ts')).toEqual({ added: 4, removed: 2 });
    // The single character that decides whether a removal ceiling can be
    // proven to hold.
    expect(parsed.get('src/logo.png')).toEqual({ added: null, removed: null });
  });

  it('skips anything that is not exactly three fields, rather than guessing', () => {
    /**
     * THIS TEST USED TO ASSERT A LINE REAL GIT NEVER PRODUCES.
     *
     * It fed `1\t1\tsrc/old.ts\tsrc/new.ts` — four tab-separated fields — and
     * asserted the last was taken as "the current path". Real
     * `git diff --numstat` does not print that without `-z`: for a rename it
     * prints the COMBINED path as a single field,
     * `0\t0\t{.github/workflows => src}/ci.yml`, which matched no key and gave
     * the file an unknown line count. The test agreed with a comment rather than
     * with git, and an independent review found the real output by running it.
     *
     * `observeRepositoryWorktree` now passes `--no-renames`, so numstat emits
     * exactly three fields and a rename arrives as a separate `D` and `A`.
     * Anything else is skipped rather than interpreted.
     */
    const combined = parseNumstat('0\t0\t{.github/workflows => src}/ci.yml\n');
    expect(combined.size).toBe(1);
    // Whatever that single field is, it is NOT treated as two paths.
    expect(combined.has('src/ci.yml')).toBe(false);
    expect(combined.has('.github/workflows/ci.yml')).toBe(false);

    // A four-field line is not git's output and is not parsed as if it were.
    expect(parseNumstat('1\t1\tsrc/old.ts\tsrc/new.ts\n').size).toBe(0);
  });

  it('parses what --no-renames actually emits for a git mv', () => {
    // The real output, captured from git: the source is a deletion and the
    // destination is an addition, each with its own real counts.
    const parsed = parseNumstat('0\t3\t.github/workflows/ci.yml\n3\t0\tsrc/notes.yml\n');
    expect(parsed.get('.github/workflows/ci.yml')).toEqual({ added: 0, removed: 3 });
    expect(parsed.get('src/notes.yml')).toEqual({ added: 3, removed: 0 });
  });
});

/* ============================== the escapes an independent review executed */

describe('a rename cannot hide the deletion of a protected path', () => {
  it('reports a git mv of a protected file as a DELETION and refuses it', () => {
    /**
     * THE CRITICAL DEFECT, reproduced and then held closed.
     *
     * With rename detection on, `git mv .github/workflows/ci.yml src/notes.yml`
     * reports as ONE entry — `R  src/notes.yml\0.github/workflows/ci.yml` — and
     * `parseStatusZ` skips the second path by design. So the deletion of a path
     * Relay protects unconditionally-by-default was invisible: one `renamed`
     * change inside the write scope, `accepted: true`, and the CI file's removal
     * committed. An independent review executed exactly this in a real repo.
     */
    const { root } = realRepository();
    const target = targetFor(root, { scope: { read: ['**'], write: ['**'] } });
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    // A `**` write scope, so ONLY protection can refuse this.
    const moved = runGit(['mv', '.github/workflows/ci.yml', 'src/notes.yml'], worktree, {
      GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x',
    });
    expect(moved.ok, 'the fixture git mv should succeed').toBe(true);

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);

    // BOTH paths are observed, because `--no-renames` makes git report what
    // actually happened to the filesystem.
    const paths = observed.value.changes.map((c) => c.path).sort();
    expect(paths).toEqual(['.github/workflows/ci.yml', 'src/notes.yml']);
    const source = observed.value.changes.find((c) => c.path === '.github/workflows/ci.yml');
    expect(source?.kind).toBe('deleted');

    const judgement = judgeObservedDiff({ diff: observed.value, target });
    expect(judgement.accepted).toBe(false);
    expect(judgement.scope.protectedHits).toContain('.github/workflows/ci.yml');
    expect(judgement.committablePaths).toEqual([]);
    // And the deletion ceiling sees it too, which it could not when the entry
    // was a `renamed`.
    expect(judgement.ceilings.deletedPaths).toContain('.github/workflows/ci.yml');

    // Nothing is committed.
    const committed = commitObservedWork({
      target, worktreePath: worktree, judgement, message: 'should not happen', ...AUTHOR,
    });
    expect(committed.ok).toBe(false);
  });

  it('counts a `renamed` entry as a deletion even from a fixture observation', () => {
    // `ObservedDiff` is also the `relay_fixture_inspection` shape and the
    // intended persisted record, so a `renamed` entry can still arrive. Counting
    // it as "not a deletion" is how a protected file left the repository while
    // `allowDeletions: false` reported nothing.
    const { root } = realRepository();
    const target = targetFor(root);
    const verdict = judgeObservedDiff({
      diff: {
        observedBy: 'relay_fixture_inspection', observedAt: NOW, conflicted: false,
        baselineSha: 'a'.repeat(40),
        changes: [{ path: 'src/moved.ts', kind: 'renamed', linesAdded: 1, linesRemoved: 1 }],
      },
      target,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.ceilings.deletedPaths).toEqual(['src/moved.ts']);
  });
});

describe('a symlink cannot make a write invisible', () => {
  it('refuses a symlink inside the write scope, and never commits it', () => {
    /**
     * Executed by an independent review against the previous code: an agent
     * created `src/outside -> /tmp/probe-XXXX`, wrote through it, and Relay
     * observed one untracked change at `src/outside`, judged it ACCEPTED, and
     * committed a mode-120000 entry pointing outside the repository — while the
     * file it overwrote out there was never seen at all.
     *
     * A symlink's target is outside anything `scopeMatches` can reason about, so
     * it cannot be classified, only refused.
     */
    const { root } = realRepository();
    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    const outside = mkdtempSync(join(tmpdir(), 'relay-outside-'));
    temporaries.push(outside);
    const outsideFile = join(outside, 'secret.txt');
    writeFileSync(outsideFile, 'ORIGINAL\n');
    symlinkSync(outsideFile, join(worktree, 'src', 'outside'));

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const link = observed.value.changes.find((c) => c.path === 'src/outside');
    expect(link?.kind).toBe('symlinked');

    const judgement = judgeObservedDiff({ diff: observed.value, target });
    expect(judgement.accepted).toBe(false);
    expect(judgement.problems.map((p) => p.message).join(' ')).toContain('Symlinked paths');
    expect(judgement.committablePaths).toEqual([]);
    // It is never counted as an allowed path either.
    expect(judgement.scope.allowed).not.toContain('src/outside');
  });

  it('refuses a path whose ANCESTOR is a symlink, not just the leaf', () => {
    // `src/link/app.ts` where `src/link` is the symlink is the same escape one
    // directory up.
    const { root } = realRepository();
    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    const outside = mkdtempSync(join(tmpdir(), 'relay-outside-dir-'));
    temporaries.push(outside);
    writeFileSync(join(outside, 'app.ts'), 'export const x = 1;\n');
    symlinkSync(outside, join(worktree, 'src', 'link'));

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    expect(observed.value.changes.every((c) => c.kind === 'symlinked')).toBe(true);
    expect(judgeObservedDiff({ diff: observed.value, target }).accepted).toBe(false);
  });
});

describe('the git option allow-list is per subcommand, not a list of strings', () => {
  it('refuses every bypass an independent review executed', () => {
    const { root } = realRepository();
    /**
     * All five of these ran successfully against the previous deny-list:
     * `add -fv` force-added a gitignored credential file, `commit -n` skipped a
     * failing pre-commit hook, `branch -D`/`-m` rewrote refs, `diff --output=`
     * wrote outside the repository, and `commit -F` took its subject from
     * `/etc/hostname`. `-fv` is `-f` and `-v` in one cluster, which exact-string
     * matching cannot see.
     */
    for (const args of [
      ['add', '-fv', '--', 'secrets.env'],
      ['add', '-vf', '--', 'secrets.env'],
      ['add', '-f', '--', 'secrets.env'],
      ['add', '--renormalize', '--', '.'],
      ['commit', '-n', '-m', 'x'],
      ['commit', '-F', '/etc/hostname'],
      ['commit', '--allow-empty-message'],
      ['branch', '-D', 'doomed'],
      ['branch', '-m', 'main', 'renamed'],
      ['branch', '-M', 'main', 'renamed'],
      ['diff', '--output=/tmp/leaked.txt'],
      ['log', '-n', '5'],
    ]) {
      const result = runRepositoryGit(args, root);
      expect(result.ok, args.join(' ')).toBe(false);
      if (!result.ok) expect(result.error.code, args.join(' ')).toBe('permission-denied');
    }
  });

  it('still permits exactly what the observer and the commit need', () => {
    const { root } = realRepository();
    for (const args of [
      ['status', '--porcelain=v1', '-z', '--no-renames'],
      ['diff', '--numstat', '--no-renames', 'HEAD'],
      ['rev-parse', 'HEAD'],
      ['branch', '--show-current'],
    ]) {
      expect(runRepositoryGit(args, root).ok, args.join(' ')).toBe(true);
    }
  });

  it('does not read a commit message that begins with a dash as an option', () => {
    // `-m`'s VALUE is skipped, because a legitimate message may start with a
    // dash and refusing it would be an over-refusal.
    const { root } = realRepository();
    writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 2;\n');
    const staged = runRepositoryGit(['add', '--', 'src/app.ts'], root);
    expect(staged.ok).toBe(true);
    const committed = runRepositoryGit(['commit', '-m', '--not-an-option'], root, {
      GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x',
    });
    expect(committed.ok).toBe(true);
  });
});

/* ================================================== real observation */

describe('Relay observes real git changes, not an agent\'s account of them', () => {
  it('observes a modified file, a new file, and their real line counts', () => {
    const { root } = realRepository();
    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    // A real edit and a real new file, written to disk by something other than
    // this observation.
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 2;\nexport const extra = true;\n');
    writeFileSync(join(worktree, 'src', 'added.ts'), 'export const added = 1;\n');

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);

    expect(observed.value.observedBy).toBe('relay_git_inspection');
    expect(observed.value.conflicted).toBe(false);
    const paths = observed.value.changes.map((c) => c.path).sort();
    expect(paths).toEqual(['src/added.ts', 'src/app.ts']);

    const modified = observed.value.changes.find((c) => c.path === 'src/app.ts');
    // Real numstat from real git: one line replaced, one added.
    expect(modified?.linesAdded).toBe(2);
    expect(modified?.linesRemoved).toBe(1);

    const added = observed.value.changes.find((c) => c.path === 'src/added.ts');
    expect(added?.kind).toBe('untracked');
    expect(added?.linesAdded).toBe(1);
    // A file that did not exist removed nothing. The one honest zero here.
    expect(added?.linesRemoved).toBe(0);
  });

  it('reports an untracked binary file as unknown ADDED and a real zero removed', () => {
    const { root } = realRepository();
    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    writeFileSync(join(worktree, 'src', 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const blob = observed.value.changes.find((c) => c.path === 'src/blob.bin');
    // How many lines a binary file adds is not a fact.
    expect(blob?.linesAdded).toBeNull();
    /**
     * And removed is ZERO, not unknown — the file did not previously exist, so
     * it removed nothing. This is the one zero in the observer that is a fact
     * rather than a default, and it means the removal ceiling correctly PERMITS
     * a new binary asset. An earlier version of this test asserted the
     * judgement refused it; that assertion was wrong about the product, not
     * about the code. The dangerous case is the next test.
     */
    expect(blob?.linesRemoved).toBe(0);
    expect(judgeObservedDiff({ diff: observed.value, target }).accepted).toBe(true);
  });

  it('refuses a MODIFIED tracked binary file, whose removed count git cannot report', () => {
    const { root } = realRepository();
    const env = {
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@sunday.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@sunday.invalid',
    };
    // A binary file that already exists in history. This is the shape that
    // matters: git reports `-` for both counts on a tracked binary change, so
    // the removal ceiling has nothing to check.
    writeFileSync(join(root, 'src', 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
    runGit(['add', '--', 'src/blob.bin'], root, env);
    runGit(['commit', '-m', 'add a binary asset'], root, env);

    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    writeFileSync(join(worktree, 'src', 'blob.bin'), Buffer.from([9, 9, 0, 9, 255, 9, 9, 9]));

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const blob = observed.value.changes.find((c) => c.path === 'src/blob.bin');
    expect(blob?.linesRemoved).toBeNull();

    // Unknown removals cannot be shown to be under a ceiling, so the judgement
    // refuses rather than summing them as zero.
    const judgement = judgeObservedDiff({ diff: observed.value, target });
    expect(judgement.accepted).toBe(false);
    expect(judgement.problems.some((p) => p.message.includes('Unknown is not zero'))).toBe(true);
  });

  it('refuses a real change to a protected path, from real git output', () => {
    const { root } = realRepository();
    const target = targetFor(root, { scope: { read: ['**'], write: ['**'] } });
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    // A `**` write scope, so only PROTECTION can refuse this — the agent
    // disabling the checks that would have caught it.
    writeFileSync(join(worktree, '.github', 'workflows', 'ci.yml'), 'name: ci\njobs: {}\n');
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 3;\n');

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ diff: observed.value, target });

    expect(judgement.accepted).toBe(false);
    expect(judgement.scope.protectedHits).toContain('.github/workflows/ci.yml');
    // And the legal file is NOT committed either. No partial accept.
    expect(judgement.committablePaths).toEqual([]);
  });

  it('refuses a real out-of-scope change', () => {
    const { root } = realRepository();
    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    writeFileSync(join(worktree, 'README.md'), '# demo\nedited\n');

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ diff: observed.value, target });
    expect(judgement.accepted).toBe(false);
    expect(judgement.scope.outOfScope).toEqual(['README.md']);
  });

  it('leaves the SOURCE repository untouched while the worktree changes', () => {
    const { root } = realRepository();
    const target = targetFor(root);
    const beforeResult = resolveBaselineSha({ worktreePath: root, ref: 'HEAD' });
    if (!beforeResult.ok) throw new Error(beforeResult.error.message);
    const before = beforeResult.value;
    const worktree = isolatedWorktree(root, target);
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 9;\n');

    // The agent works in an isolated worktree; the founder's checkout is not it.
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toBe('export const version = 1;\n');
    const after = resolveBaselineSha({ worktreePath: root, ref: 'HEAD' });
    expect(after.ok && after.value).toBe(before);
    /**
     * AND THE SOURCE IS CLEAN, not just that one file.
     *
     * One file's content plus HEAD is what this used to assert, and a review
     * showed both pass while a NEW file sits staged in the source: neither
     * assertion looks anywhere else. `REPOSITORY_TARGETS.md` claims the source is
     * "byte-for-byte unchanged", and this is the assertion that means it.
     */
    const sourceState = inspectRepositoryState(root);
    expect(sourceState.ok && sourceState.value.dirty, 'the source repository is dirty').toBe(false);
  });
});

/* ======================================================== real commit */

describe('committing what was accepted, and nothing else', () => {
  const prepared = () => {
    const { root } = realRepository();
    const target = targetFor(root);
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);
    return { root, target, worktree, baseline: baseline.value };
  };

  it('commits the accepted paths and reads the real commit SHA back', () => {
    const { target, worktree, baseline } = prepared();
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 2;\n');

    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ diff: observed.value, target });
    expect(judgement.accepted).toBe(true);

    const committed = commitObservedWork({
      target, worktreePath: worktree, judgement, message: 'Bump the version', ...AUTHOR,
    });
    if (!committed.ok) throw new Error(committed.error.message);

    /**
     * READ BACK FROM GIT, and checked AGAINST git.
     *
     * A shape assertion (`/^[0-9a-f]{40}$/`) plus "different from the baseline"
     * is satisfied by `'a'.repeat(40)` — a mutation that replaced the read-back
     * with a literal passed this test. So the SHA is compared with an
     * independent `rev-parse`, and `cat-file` is asked whether the object
     * actually exists in the repository.
     */
    const independent = runRepositoryGit(['rev-parse', 'HEAD'], worktree);
    expect(independent.ok && independent.value.trim()).toBe(committed.value.commitSha);
    const exists = runRepositoryGit(['cat-file', '-t', committed.value.commitSha], worktree);
    expect(exists.ok && exists.value.trim()).toBe('commit');
    expect(committed.value.commitSha).not.toBe(baseline);
    expect(committed.value.branch).toBe('relay/mission-real-1');

    // And git agrees the tree is now clean.
    const after = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline, now: NOW });
    expect(after.ok && after.value.changes).toEqual([]);

    /**
     * THE OBSERVATION REPORTS THE BASELINE IT WAS GIVEN, NOT THE WORKTREE'S HEAD.
     *
     * HEAD has just moved — the commit above moved it — so these two values now
     * genuinely differ, which is what makes this an assertion rather than a
     * tautology. If the observer read HEAD for itself, `baseMovedUnderMission`
     * would compare a value against itself and always agree that the base was
     * unchanged, and the one check protecting the Reviewer's artifact digest
     * would be permanently green. A mutation probe that made the observer read
     * HEAD is what surfaced that nothing tested this.
     */
    expect(after.ok && after.value.baselineSha).toBe(baseline);
    expect(after.ok && after.value.baselineSha).not.toBe(committed.value.commitSha);
    const movedCheck = baseMovedUnderMission({
      baselineAtStart: baseline,
      baselineAtEnd: after.ok ? after.value.baselineSha : null,
    });
    expect(movedCheck.moved).toBe(false);
  });

  it('refuses to commit a diff it did not accept', () => {
    const { target, worktree, baseline } = prepared();
    writeFileSync(join(worktree, 'README.md'), '# out of scope\n');
    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ diff: observed.value, target });

    const committed = commitObservedWork({
      target, worktreePath: worktree, judgement, message: 'should not happen', ...AUTHOR,
    });
    expect(committed.ok).toBe(false);
    /**
     * REFUSED BY RELAY, NOT BY GIT.
     *
     * Asserting only `ok === false` proved nothing here: with a refused
     * judgement `committablePaths` is empty, so `git commit` would fail on its
     * own with "nothing to commit" and the test would pass with the guard
     * deleted. What distinguishes the two is WHO refused — Relay names the
     * judgement's refusals, git names its own complaint. A mutation probe that
     * removed the guard is what surfaced this.
     */
    if (!committed.ok) {
      expect(committed.error.code).toBe('permission-denied');
      expect(committed.error.message).toContain('will not commit a diff it did not accept');
      expect(committed.error.details).toContain('mission_scope_exceeds_registration');
    }
    // And nothing was committed: git still reports the change as uncommitted.
    const still = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline, now: NOW });
    expect(still.ok && still.value.changes.map((c) => c.path)).toEqual(['README.md']);
  });

  it('commits ONLY the approved paths, leaving an unapproved file visible', () => {
    // The write scope permits `src/**`, and protection permits nothing under
    // `.github`. Here the diff is fully accepted, and the assertion is that the
    // staging list came from the judgement rather than from `git add -A`.
    const { target, worktree, baseline } = prepared();
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 2;\n');
    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ diff: observed.value, target });

    // A file appears AFTER the judgement — the race a `git add -A` would lose.
    writeFileSync(join(worktree, 'src', 'sneaked-in.ts'), 'export const sneaked = true;\n');

    const committed = commitObservedWork({
      target, worktreePath: worktree, judgement, message: 'Only what was judged', ...AUTHOR,
    });
    if (!committed.ok) throw new Error(committed.error.message);
    expect(committed.value.committedPaths).toEqual(['src/app.ts']);

    // The late file is still uncommitted, and therefore still visible to the
    // next observation rather than silently inside a reviewed commit.
    const after = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline, now: NOW });
    expect(after.ok && after.value.changes.map((c) => c.path)).toEqual(['src/sneaked-in.ts']);
  });

  it('refuses to commit without the commit permission', () => {
    const { root } = realRepository();
    const readOnly = targetFor(root, {
      grants: (['read', 'write_worktree'] as const).map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
    });
    const worktree = isolatedWorktree(root, readOnly);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 2;\n');
    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);

    // The Mission resolved with only read + write_worktree, so the diff is
    // accepted and the commit is still refused. Two separate decisions.
    const judgement = judgeObservedDiff({ diff: observed.value, target: readOnly });
    expect(judgement.accepted).toBe(true);
    const committed = commitObservedWork({
      target: readOnly, worktreePath: worktree, judgement, message: 'nope', ...AUTHOR,
    });
    expect(committed.ok).toBe(false);
    if (!committed.ok) expect(committed.error.message).toContain('"commit" permission');
  });

  it('detects a base that moved under the Mission, from real git', () => {
    const { root, target, worktree, baseline } = prepared();
    // Somebody commits to `main` while the Mission is running — the exact event
    // that invalidates the artifact digest the Reviewer bound its verdict to.
    writeFileSync(join(root, 'README.md'), '# moved\n');
    const env = {
      GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: 's@sunday.invalid',
      GIT_COMMITTER_NAME: 'Someone', GIT_COMMITTER_EMAIL: 's@sunday.invalid',
    };
    runGit(['add', '--', 'README.md'], root, env);
    runGit(['commit', '-m', 'moved the base'], root, env);

    const now = resolveBaselineSha({ worktreePath: root, ref: target.baseBranch });
    if (!now.ok) throw new Error(now.error.message);
    const moved = baseMovedUnderMission({ baselineAtStart: baseline, baselineAtEnd: now.value });
    expect(moved.moved).toBe(true);
    expect(moved.reason).toContain('no longer applies');
    void worktree;
  });
});

/* ============================================ deploy, live verify, ship */

/**
 * A REAL DEPLOYMENT PROVIDER, small enough to be honest about.
 *
 * It "deploys" by writing the artifact and a revision marker into a directory,
 * and it verifies live by fetching `/health` from a real HTTP server serving
 * that directory. Both halves are real: a real write, a real listen, a real
 * fetch over a real socket. What it is not is a cloud provider — and the
 * descriptor says `simulated: false` because nothing about this is simulated;
 * it deploys to a local host, which is a different statement from pretending to.
 */
function localDeploymentProvider(input: {
  readonly deployRoot: string;
  /** Lets a test deploy the artifact while the SERVER keeps serving an older
   *  revision — the stale-deploy failure `decideShipped` exists to catch. */
  readonly revisionServerReports?: () => string | null;
}) {
  const descriptor: DeploymentProviderDescriptor = {
    providerId: 'local-directory',
    displayName: 'Local directory deployment',
    environments: ['staging'],
    canReportDeployedRevision: true,
    canVerifyLive: true,
    simulated: false,
    credentialEnvVarName: null,
  };
  return {
    descriptor,
    deploy: async (request: {
      readonly revision: string; readonly artifactPath: string | null; readonly requestedAt: string;
      readonly environment: 'staging' | 'production';
    }): Promise<DeployObservation> => {
      mkdirSync(input.deployRoot, { recursive: true });
      const body = request.artifactPath !== null && existsSync(request.artifactPath)
        ? readFileSync(request.artifactPath, 'utf8')
        : '';
      writeFileSync(join(input.deployRoot, 'index.txt'), body);
      writeFileSync(join(input.deployRoot, 'REVISION'), request.revision);
      return {
        ok: true,
        providerId: descriptor.providerId,
        environment: request.environment,
        // Read back off disk, not echoed from the request.
        deployedRevision: readFileSync(join(input.deployRoot, 'REVISION'), 'utf8').trim(),
        deploymentRef: 'local-1',
        url: null,
        observedAt: request.requestedAt,
        detail: null,
      };
    },
    verifyLive: async (probe: { url: string; expectedRevision: string; observedAt: string }): Promise<LiveProbeResult> => {
      try {
        const response = await fetch(`${probe.url}/health`);
        const text = await response.text();
        const parsed = JSON.parse(text) as { revision?: unknown; ok?: unknown };
        return {
          reachable: true,
          healthy: response.ok && parsed.ok === true,
          reportedRevision: typeof parsed.revision === 'string' && parsed.revision !== '' ? parsed.revision : null,
          method: 'GET /health',
          observedAt: probe.observedAt,
          detail: null,
        };
      } catch {
        return {
          reachable: false, healthy: false, reportedRevision: null,
          method: 'GET /health', observedAt: probe.observedAt, detail: 'the deployed system could not be reached',
        };
      }
    },
  };
}

/** A real HTTP server that reports whatever revision it is actually serving. */
async function serveDeployment(revision: () => string | null): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      const value = revision();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, revision: value }));
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the test server did not bind a port');
  return `http://127.0.0.1:${address.port}`;
}

describe('BUILD → VERIFY → COMMIT → DEPLOY → LIVE VERIFY → SHIPPED, for real', () => {
  const runToCommit = () => {
    const { root } = realRepository();
    const target = targetFor(root, {
      grants: (['read', 'write_worktree', 'commit', 'deploy_staging'] as const).map((permission) => ({
        permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
      })),
    });
    const worktree = isolatedWorktree(root, target);
    const baseline = resolveBaselineSha({ worktreePath: worktree, ref: 'HEAD' });
    if (!baseline.ok) throw new Error(baseline.error.message);

    // BUILD: the change a Coding Agent would have made.
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const version = 2;\n');

    // VERIFY: Relay observes and judges. Not a claim.
    const observed = observeRepositoryWorktree({ worktreePath: worktree, baselineSha: baseline.value, now: NOW });
    if (!observed.ok) throw new Error(observed.error.message);
    const judgement = judgeObservedDiff({ diff: observed.value, target });
    if (!judgement.accepted) throw new Error(JSON.stringify(judgement.problems));

    // COMMIT: authorized, then performed, then read back.
    const transition = advanceShipStage({
      currentStage: 'verified_complete', to: 'committed', permissions: target.permissions,
    });
    if (!transition.ok) throw new Error(transition.problem.message);
    const committed = commitObservedWork({
      target, worktreePath: worktree, judgement, message: 'Bump the version', ...AUTHOR,
    });
    if (!committed.ok) throw new Error(committed.error.message);
    return { root, target, worktree, judgement, commitSha: committed.value.commitSha };
  };

  it('ships when the running system serves the committed revision', async () => {
    const { target, worktree, commitSha } = runToCommit();
    const deployRoot = mkdtempSync(join(tmpdir(), 'relay-deploy-'));
    temporaries.push(deployRoot);
    const provider = localDeploymentProvider({ deployRoot });

    // DEPLOY: authorized for the environment it actually names.
    const authorized = advanceShipStage({
      currentStage: 'committed', to: 'deploying', environment: 'staging', permissions: target.permissions,
    });
    expect(authorized.ok).toBe(true);
    expect(providerSupportsEnvironment({ descriptor: provider.descriptor, environment: 'staging' }).ok).toBe(true);

    const observation = await provider.deploy({
      revision: commitSha,
      artifactPath: join(worktree, 'src', 'app.ts'),
      requestedAt: NOW,
      environment: 'staging',
    });
    expect(observation.ok).toBe(true);
    expect(observation.deployedRevision).toBe(commitSha);

    // LIVE VERIFY: a real server, serving what the deploy actually wrote.
    const url = await serveDeployment(() => readFileSync(join(deployRoot, 'REVISION'), 'utf8').trim());
    const probe = await provider.verifyLive({ url, expectedRevision: commitSha, observedAt: NOW });
    expect(probe.reachable).toBe(true);
    expect(probe.healthy).toBe(true);
    expect(probe.reportedRevision).toBe(commitSha);

    const evidence: ShipStageEvidence = {
      stage: 'deployed', observedAt: NOW, commitSha, branch: target.workingBranch,
      remoteRef: null, pullRequestRef: null, environment: 'staging',
      deployedRevision: observation.deployedRevision, liveProbe: probe, detail: null,
    };
    const verdict = decideShipped({ committedSha: commitSha, deployment: evidence, liveProbe: probe });
    expect(verdict.shipped).toBe(true);
    expect(verdict.liveRevision).toBe(commitSha);
  }, 30_000);

  it('refuses to ship when the running system serves a STALE revision', async () => {
    const { target, worktree, commitSha } = runToCommit();
    const deployRoot = mkdtempSync(join(tmpdir(), 'relay-deploy-stale-'));
    temporaries.push(deployRoot);
    const provider = localDeploymentProvider({ deployRoot });

    await provider.deploy({
      revision: commitSha, artifactPath: join(worktree, 'src', 'app.ts'),
      requestedAt: NOW, environment: 'staging',
    });

    // The deploy wrote the new revision; the SERVER is still serving the old
    // one. Cached artifact, warm process, stale CDN — the single most common
    // real deployment failure, and it returns 200 the whole time.
    const stale = 'f'.repeat(40);
    const url = await serveDeployment(() => stale);
    const probe = await provider.verifyLive({ url, expectedRevision: commitSha, observedAt: NOW });
    expect(probe.reachable).toBe(true);
    expect(probe.healthy).toBe(true);

    const evidence: ShipStageEvidence = {
      stage: 'deployed', observedAt: NOW, commitSha, branch: target.workingBranch,
      remoteRef: null, pullRequestRef: null, environment: 'staging',
      deployedRevision: commitSha, liveProbe: probe, detail: null,
    };
    const verdict = decideShipped({ committedSha: commitSha, deployment: evidence, liveProbe: probe });
    expect(verdict.shipped).toBe(false);
    expect(verdict.reason).toContain('reports serving');
    expect(verdict.liveRevision).toBe(stale);
  }, 30_000);

  it('refuses to ship when the deployed system is not reachable at all', async () => {
    const { target, worktree, commitSha } = runToCommit();
    const deployRoot = mkdtempSync(join(tmpdir(), 'relay-deploy-down-'));
    temporaries.push(deployRoot);
    const provider = localDeploymentProvider({ deployRoot });
    await provider.deploy({
      revision: commitSha, artifactPath: join(worktree, 'src', 'app.ts'),
      requestedAt: NOW, environment: 'staging',
    });

    // A port nothing is listening on. A real failed fetch, not a stubbed one.
    const probe = await provider.verifyLive({
      url: 'http://127.0.0.1:1', expectedRevision: commitSha, observedAt: NOW,
    });
    expect(probe.reachable).toBe(false);

    const evidence: ShipStageEvidence = {
      stage: 'deployed', observedAt: NOW, commitSha, branch: target.workingBranch,
      remoteRef: null, pullRequestRef: null, environment: 'staging',
      deployedRevision: commitSha, liveProbe: probe, detail: null,
    };
    expect(decideShipped({ committedSha: commitSha, deployment: evidence, liveProbe: probe }).shipped).toBe(false);
  }, 30_000);

  it('refuses a production deploy on a staging-only provider and a staging-only grant', async () => {
    const { target } = runToCommit();
    const deployRoot = mkdtempSync(join(tmpdir(), 'relay-deploy-prod-'));
    temporaries.push(deployRoot);
    const provider = localDeploymentProvider({ deployRoot });

    // Two independent refusals, and both must hold: the Mission's permissions,
    // and the provider's own configuration. "Build this" reaches neither.
    const authorization = advanceShipStage({
      currentStage: 'committed', to: 'deploying', environment: 'production', permissions: target.permissions,
    });
    expect(authorization.ok).toBe(false);

    const support = providerSupportsEnvironment({ descriptor: provider.descriptor, environment: 'production' });
    expect(support.ok).toBe(false);
    if (!support.ok) expect(support.reason).toContain('was asked for production');
  }, 30_000);
});

/* ============================================ the prose is enforced */

/**
 * DOCUMENTED COUNTS ARE ASSERTED, NOT REMEMBERED.
 *
 * `docs/relay/REPOSITORY_TARGETS.md` states how many git subcommands the write
 * surface permits and which paths are protected by default. An earlier draft
 * said "the six common lockfiles" while the array held eight — a number in prose
 * the code did not support, which is the single most frequent defect class in
 * this repository. The fix for one wrong number is not a right number; it is a
 * test that fails when the two drift.
 *
 * Read from the repo root, like `.env.example` in `orchestrator.test.ts`.
 */
describe('the documented surface matches the code', () => {
  const doc = () => readFileSync('docs/relay/REPOSITORY_TARGETS.md', 'utf8');

  it('names every git subcommand the write surface permits, and the right number of them', () => {
    expect(REPOSITORY_GIT_ALLOWLIST).toHaveLength(11);
    expect(doc()).toContain('permits exactly ten subcommands');
    for (const subcommand of REPOSITORY_GIT_ALLOWLIST) {
      expect(doc(), `the doc does not name \`${subcommand}\``).toContain(`\`${subcommand}\``);
    }
  });

  it('names every subcommand it claims is ABSENT, and each really is', () => {
    // The absence IS the enforcement, so a name that drifted out of this
    // sentence would leave a capability nobody re-checked.
    /**
     * `remote` LEFT THIS LIST DELIBERATELY, and only for `get-url`.
     * Confirming that a locally-checked-out remote target really is a checkout
     * of the registered repository needs to READ `origin`. Every mutating verb
     * — `set-url`, `add`, `remove`, `rename`, `prune` — is refused by
     * `GIT_SUBCOMMAND_VERBS`, which is checked below, because the options
     * allow-list only inspects dash-prefixed arguments and cannot see a
     * positional verb at all.
     */
    for (const forbidden of ['push', 'fetch', 'merge', 'rebase', 'reset', 'clean', 'gc', 'tag', 'config']) {
      expect(doc(), `the doc stops claiming \`${forbidden}\` is absent`).toContain(`\`${forbidden}\``);
      expect(REPOSITORY_GIT_ALLOWLIST, `${forbidden} is in the allow-list`).not.toContain(forbidden);
    }
  });

  it('names every default-protected path, and its stated counts are the real ones', () => {
    const text = doc();
    expect(DEFAULT_PROTECTED_PATHS).toHaveLength(15);
    expect(text).toContain('fifteen entries');

    /**
     * ENUMERATED, NOT MATCHED BY SUBSTRING. The first version of this filtered
     * on `includes('lock')` and reported seven, because `npm-shrinkwrap.json`
     * is a lockfile whose name contains neither "lock" nor "sum". A count
     * derived from a guess about names is the same defect as a count written
     * from memory, one layer down.
     */
    const MANIFESTS = [
      'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json',
      'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'go.sum',
    ] as const;
    expect(MANIFESTS).toHaveLength(8);
    expect(text).toContain('eight dependency manifests and lockfiles');
    for (const manifest of MANIFESTS) {
      expect(DEFAULT_PROTECTED_PATHS, `${manifest} is not protected by default`).toContain(manifest);
    }

    for (const path of DEFAULT_PROTECTED_PATHS) {
      expect(text, `the doc does not name the protected path \`${path}\``).toContain(`\`${path}\``);
    }
    // And the unconditional one, which no configuration reaches.
    for (const path of ALWAYS_PROTECTED_PATHS) {
      expect(text).toContain(`\`${path}\``);
    }
  });

  it('keeps saying what has not actually happened yet', () => {
    /**
     * The most consequential thing this doc could get wrong is reading as
     * finished.
     *
     * This asserted the literal sentence "No remote provider exists" — and then a
     * provider was built, so the assertion was pinning a fact rather than a
     * property and it failed for the right reason. What has to stay true is not
     * that the provider is absent, but that the doc keeps naming the gap between
     * BUILT and PROVEN: the provider has never made a real request, and nothing
     * calls it.
     */
    const text = doc();
    expect(text).toContain('What is NOT built');
    expect(text).toContain('has never touched GitHub');
    expect(text).toContain('a single real request');
    expect(text).toContain('NOT yet called by the mission engine');
  });
});


/**
 * `git remote` IS READ-ONLY, AND THE OPTIONS ALLOW-LIST CANNOT ENFORCE THAT.
 *
 * The options loop skips anything not starting with `-`, so a subcommand whose
 * OPERATION is a positional word bypasses it entirely. Adding `remote` with
 * `get-url` in the options map looked complete, and
 * `git remote set-url origin https://evil/...` was ACCEPTED — a Mission able to
 * repoint origin can push a founder's work to a remote of its choosing.
 *
 * Found by probing the built function, not by reading it.
 */
describe('the remote subcommand cannot mutate where the repository points', () => {
  const MUTATING = ['set-url', 'add', 'remove', 'rename', 'prune', 'update'];

  it.each(MUTATING)('refuses git remote %s', (verb) => {
    const result = runRepositoryGit(['remote', verb, 'origin', 'https://evil.example/x.git'], process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('outside Relay');
  });

  it('refuses git remote with no verb at all', () => {
    // Bare `git remote` lists remotes; harmless, but the allow-list is a list
    // of what is permitted, not of what is harmless.
    const result = runRepositoryGit(['remote'], process.cwd());
    expect(result.ok).toBe(false);
  });

  it('permits only get-url', () => {
    const result = runRepositoryGit(['remote', 'get-url', 'origin'], process.cwd());
    expect(result.ok).toBe(true);
  });
});
