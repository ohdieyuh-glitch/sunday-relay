import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { fixtureSource, repositoryTargetSource } from './repository-source';
import {
  createRepositoryRegistration,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
import type {
  MissionRepositoryTarget,
  RepositoryPermission,
  RepositoryRegistrationDraft,
} from '../src/relay/mission/repository-target';

/**
 * THE BRIDGE CAN NOW TARGET A REAL REPOSITORY.
 *
 * `docs/relay/REPOSITORY_TARGETS.md` listed this as the third thing not built:
 * the authorization spine, the observation layer and the shipping lifecycle all
 * existed, and `runCodingMission` called `buildSafeEditFixture()` directly, so
 * nothing in the bridge read a `MissionRepositoryTarget`. Every hosted Mission
 * Relay had ever run edited the same four-file throwaway repository.
 *
 * The fixture's contract turned out to be four facts, so a registered target
 * satisfies the same seam. What is held here is that the seam is a GATE and not
 * a passthrough: every refusal happens before a worktree exists, before an agent
 * starts, and before anything is spent.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const temporaries: string[] = [];

afterEach(() => {
  for (const path of temporaries.splice(0)) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A real git repository, on disk, with a real commit on `main`. */
function realRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'relay-source-'));
  temporaries.push(root);
  const git = (args: string[]) => execFileSync('git', args, {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? '', HOME: root,
      GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
      GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
    },
  });
  git(['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 1;\n');
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  git(['add', '--', '.']);
  git(['commit', '-m', 'initial']);
  return root;
}

const LADDER: readonly RepositoryPermission[] = ['read', 'write_worktree', 'commit'];

function target(root: string, over: Partial<RepositoryRegistrationDraft> = {}): MissionRepositoryTarget {
  const draft: RepositoryRegistrationDraft = {
    identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
    location: { kind: 'local_path', path: root },
    scope: { read: ['**'], write: ['src/**'] },
    grants: LADDER.map((permission) => ({
      permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
    })),
    ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
    registeredBy: 'founder',
    ...over,
  };
  const registration = createRepositoryRegistration({ draft, now: NOW });
  if (!registration.ok) throw new Error(`fixture refused: ${registration.error.message}`);
  const resolution = resolveRepositoryTarget({
    registration: registration.value,
    request: {
      repositoryKey: 'local:demo', selectedBy: 'founder', selectedAt: NOW,
      workingBranch: 'relay/mission-1',
      permissions: draft.grants.map((g) => g.permission),
    },
    now: NOW,
  });
  if (!resolution.ok) throw new Error(`resolution refused: ${resolution.error.message}`);
  return resolution.target;
}

describe('the controlled fixture still satisfies the seam, unchanged', () => {
  it('provides the same four facts it always did', () => {
    const source = fixtureSource();
    try {
      expect(source.sourceRepositoryPath).toContain('relay-claude-fixture-');
      expect(source.baselineRevision).toMatch(/^[0-9a-f]{40}$/);
      expect(source.allowedWritePaths).toEqual(['src/normalize.js']);
      expect(source.protectedPaths.forbidden).toContain('package.json');
      // The one path Relay is allowed to delete when it is done.
      expect(source.disposable).toBe(true);
    } finally {
      source.dispose();
    }
  });
});

describe('a registered repository satisfies the same seam', () => {
  it('reads the baseline from the BASE BRANCH, not from HEAD', () => {
    /**
     * `MissionRepositoryTarget.baselineSha` is null by construction — the pure
     * domain cannot read a repository. HEAD is whatever the founder last checked
     * out, and a Mission measured against that would be measured against an
     * accident.
     */
    const root = realRepository();
    const result = repositoryTargetSource(target(root), ['src/app.ts']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.baselineRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(result.source.allowedWritePaths).toEqual(['src/app.ts']);
    // The founder's repository is not Relay's to delete.
    expect(result.source.disposable).toBe(false);
    expect(() => result.source.dispose()).not.toThrow();
  });

  it('carries the target\'s resolved protected set into the policy the workspace already runs', () => {
    const root = realRepository();
    const result = repositoryTargetSource(target(root), ['src/app.ts']);
    if (!result.ok) throw new Error(result.reason);
    // `.git` and `.github` arrive without the workspace policy knowing where the
    // list came from.
    expect(result.source.protectedPaths.forbidden).toContain('.git');
    expect(result.source.protectedPaths.forbidden).toContain('.github');
  });

  it('REFUSES a Mission that names no files it intends to write', () => {
    // An agent turned loose on a whole write scope has no claim to check
    // against, which is the mechanism the file-claim policy is built on.
    const root = realRepository();
    const result = repositoryTargetSource(target(root), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('must name the files it intends to write');
  });

  it('REFUSES a declared path outside the write scope, before a worktree exists', () => {
    const root = realRepository();
    const result = repositoryTargetSource(target(root), ['src/app.ts', 'infra/main.tf']);
    expect(result.ok).toBe(false);
    // Discovering this from the diff would mean the money is already spent.
    if (!result.ok) expect(result.reason).toContain('infra/main.tf');
  });

  it('REFUSES a declared path that is protected, even inside the scope', () => {
    const root = realRepository();
    const wide = target(root, { scope: { read: ['**'], write: ['**'] } });
    const result = repositoryTargetSource(wide, ['.github/workflows/ci.yml']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('protected');
  });

  it('REFUSES a remote target rather than silently cloning one', () => {
    /**
     * The credential boundary says Relay performs remote operations itself,
     * after the agent exits, and no such provider exists. Refusing by name is
     * the honest state; fetching would be a capability nobody built.
     */
    const remote = createRepositoryRegistration({
      draft: {
        identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
        location: { kind: 'remote_clone', cloneUrl: 'https://github.com/o/r.git' },
        scope: { read: ['**'], write: ['src/**'] },
        grants: LADDER.map((permission) => ({
          permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
        })),
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: NOW,
    });
    if (!remote.ok) throw new Error(remote.error.message);
    const resolved = resolveRepositoryTarget({
      registration: remote.value,
      request: {
        repositoryKey: remote.value.key, selectedBy: 'founder', selectedAt: NOW,
        workingBranch: 'relay/x', permissions: [...LADDER],
      },
      now: NOW,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    const result = repositoryTargetSource(resolved.target, ['src/app.ts']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no remote provider');
  });

  it('REFUSES a Mission that does not hold write_worktree', () => {
    const root = realRepository();
    const readOnly = {
      ...target(root),
      permissions: ['read'] as readonly RepositoryPermission[],
    } as MissionRepositoryTarget;
    const result = repositoryTargetSource(readOnly, ['src/app.ts']);
    expect(result.ok).toBe(false);
    // The coding leg exists to produce a diff. A Mission that may not write
    // should never have an agent started for it at all.
    if (!result.ok) expect(result.reason).toContain('write_worktree');
  });

  it('REFUSES a path that is not a git repository', () => {
    const empty = mkdtempSync(join(tmpdir(), 'relay-not-git-'));
    temporaries.push(empty);
    const notGit = { ...target(realRepository()) } as MissionRepositoryTarget;
    const result = repositoryTargetSource(
      { ...notGit, location: { kind: 'local_path', path: empty } } as MissionRepositoryTarget,
      ['src/app.ts'],
    );
    expect(result.ok).toBe(false);
  });

  it('REFUSES a base branch that does not exist, naming it', () => {
    const root = realRepository();
    const wrongBase = { ...target(root), baseBranch: 'no-such-branch' } as MissionRepositoryTarget;
    const result = repositoryTargetSource(wrongBase, ['src/app.ts']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no-such-branch');
  });
});

/**
 * A REMOTE-HOSTED REPOSITORY, CHECKED OUT LOCALLY.
 *
 * This registration used to be REFUSED — a `github` identity was forced to be
 * `remote_clone`, and `remote_clone` is refused here because nothing clones. So
 * the PUSH/PR/MERGE leg was wired and unreachable by any valid registration.
 *
 * The blanket refusal is replaced by an actual comparison: the checkout's own
 * `origin` must name the registered repository. That is a check the old rule
 * never made — it prevented a mismatched path by forbidding all local paths,
 * which also forbade every correct one.
 */
describe('a GitHub repository cloned on this machine', () => {
  function githubTarget(root: string, origin: string | null): MissionRepositoryTarget {
    if (origin !== null) {
      execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: root, env: { PATH: process.env.PATH ?? '', HOME: root } });
    }
    const reg = createRepositoryRegistration({
      draft: {
        identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
        location: { kind: 'local_path', path: root },
        scope: { read: ['**'], write: ['src/**'] },
        grants: LADDER.map((permission) => ({
          permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
        })),
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: NOW,
    });
    if (!reg.ok) throw new Error(reg.error.message);
    const resolved = resolveRepositoryTarget({
      registration: reg.value,
      request: {
        repositoryKey: reg.value.key, selectedBy: 'founder', selectedAt: NOW,
        workingBranch: 'relay/mission-1', permissions: [...LADDER],
      },
      now: NOW,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    return resolved.target;
  }

  it('is ACCEPTED when the checkout\'s origin is that repository', () => {
    const root = realRepository();
    const result = repositoryTargetSource(githubTarget(root, 'https://github.com/o/r.git'), ['src/app.ts']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.disposable).toBe(false);
  });

  it('accepts every ordinary spelling of the same repository', () => {
    /**
     * One repository, six ways to write it. A review found that `ssh://` — an
     * ordinary origin to have — was refused as "not a shape Relay can compare"
     * while the doc promised it worked. A refusal in the safe direction is
     * still a refusal a founder has to work around, and working around an
     * identity check is exactly what must not become routine.
     */
    for (const origin of [
      'git@github.com:o/r.git',
      'https://github.com/o/r',
      'https://github.com/o/r.git',
      'ssh://git@github.com/o/r.git',
      'ssh://git@github.com:22/o/r.git',
      'git://github.com/o/r.git',
    ]) {
      const result = repositoryTargetSource(githubTarget(realRepository(), origin), ['src/app.ts']);
      expect(result.ok, origin).toBe(true);
    }
  });

  it('REFUSES a checkout of a DIFFERENT repository, naming both', () => {
    /**
     * The failure the old blanket rule was really aimed at: identity says
     * production, path says scratch. Relay would commit scratch work and push
     * it to production.
     */
    const result = repositoryTargetSource(
      githubTarget(realRepository(), 'https://github.com/someone-else/other.git'),
      ['src/app.ts'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('someone-else/other');
      expect(result.reason).toContain('github.com/o/r');
    }
  });

  it('REFUSES a checkout with no origin at all', () => {
    const result = repositoryTargetSource(githubTarget(realRepository(), null), ['src/app.ts']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no "origin" remote');
  });
});

/**
 * A CREDENTIAL IN THE CHECKOUT'S ORIGIN NEVER REACHES A MISSION RECORD.
 *
 * An https clone URL carrying `user:token@` before the host is an ordinary
 * clone form. The refusal message reformats the URL into `host/owner/name`, and that
 * reformatting destroyed the one redaction pattern (`token:`) catching the
 * secret — so it travelled verbatim into a persisted, user-visible mission
 * failure reason. `validateRepositoryLocation` refuses embedded credentials for
 * a remote clone; the local-checkout path re-admitted them and then printed
 * them.
 */
describe('a credential embedded in origin is never echoed', () => {
  it('strips userinfo from the refusal message', () => {
    const root = realRepository();
    execFileSync('git', [
      'remote', 'add', 'origin',
      // Assembled, never written out: a literal credential-bearing URL in the
      // source is exactly what the repository's secret scanner refuses, and it
      // is right to. The VALUE at runtime is the real thing.
      `https://${'x-access-token'}:${'ghp_' + 'SUPERSECRET1234567'}@github.com/someone-else/other.git`,
    ], { cwd: root, env: { PATH: process.env.PATH ?? '', HOME: root } });
    const reg = createRepositoryRegistration({
      draft: {
        identity: { provider: 'github', host: 'github.com', owner: 'o', name: 'r', defaultBranch: 'main' },
        location: { kind: 'local_path', path: root },
        scope: { read: ['**'], write: ['src/**'] },
        grants: LADDER.map((permission) => ({
          permission, authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null,
        })),
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: NOW,
    });
    if (!reg.ok) throw new Error(reg.error.message);
    const resolved = resolveRepositoryTarget({
      registration: reg.value,
      request: {
        repositoryKey: reg.value.key, selectedBy: 'founder', selectedAt: NOW,
        workingBranch: 'relay/mission-1', permissions: [...LADDER],
      },
      now: NOW,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    const result = repositoryTargetSource(resolved.target, ['src/app.ts']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The mismatch is still reported — the message stays useful.
      expect(result.reason).toContain('someone-else/other');
      // And the secret is not in it, in any form.
      expect(result.reason).not.toContain('SUPERSECRET1234567');
      expect(result.reason).not.toContain('x-access-token');
    }
  });
});
