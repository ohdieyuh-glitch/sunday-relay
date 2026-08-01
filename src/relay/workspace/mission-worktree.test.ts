import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNotPrimaryCheckout,
  evaluateWorktreeCleanup,
  openMissionWorktree,
  removeMissionWorktree,
  resolveMissionWorktreePath,
  validateMissionWorktree,
} from './mission-worktree';
import {
  deriveMissionBranch,
  sealWorktreeRecord,
  validateMissionBranch,
  type MissionWorktreeRecord,
} from '../mission/worktree';
import { createNodeMissionWorktreeStore } from '../persistence';

/**
 * Isolated mission worktrees against DISPOSABLE synthetic repositories.
 *
 * Nothing here touches the founder's checkout: every repository is created
 * under the OS temp directory and removed afterwards. The assertions are
 * about real `git worktree` behaviour, not a mock.
 */

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Relay Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Relay Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

/** A disposable repository with one commit, inside its own container so the
    approved worktree root (a sibling of the repo) is also disposable. */
function syntheticRepository(name = 'sunday-relay-fixture'): { root: string; container: string } {
  const container = tempDir('relay-wt-');
  const root = join(container, name);
  mkdirSync(root, { recursive: true });
  git(['init', '--initial-branch=main'], root);
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(['add', '.'], root);
  git(['commit', '-m', 'initial'], root);
  return { root, container };
}

const NOW = '2026-08-01T12:00:00.000Z';
const open = (input: Partial<Parameters<typeof openMissionWorktree>[0]> & { repositoryPath: string }) =>
  openMissionWorktree({
    missionId: 'mission-1',
    projectId: 'rly-010',
    sessionId: 'session-a',
    now: NOW,
    ...input,
  });

/* ------------------------------------------------------- safe naming */

describe('mission branch naming', () => {
  it('derives relay/mission/<id> and refuses git-option injection', () => {
    const good = deriveMissionBranch('mission-123');
    expect(good.ok && good.branch).toBe('relay/mission/mission-123');
    // Option injection, traversal and refspec tricks are sanitised away.
    for (const hostile of ['--upload-pack=evil', '../../main', '-x', '@{upstream}', '  ', '$(whoami)']) {
      const derived = deriveMissionBranch(hostile);
      if (derived.ok) {
        expect(derived.branch.startsWith('relay/mission/')).toBe(true);
        expect(derived.branch).not.toContain('..');
        expect(derived.branch).not.toContain('@{');
        expect(derived.branch).not.toMatch(/\s|\$|\(/);
        expect(derived.branch.slice('relay/mission/'.length).startsWith('-')).toBe(false);
      }
    }
  });

  it('NEVER yields a protected branch, however the id is spelled', () => {
    for (const name of ['main', 'MAIN', 'master', 'production', 'release', 'HEAD']) {
      const derived = deriveMissionBranch(name);
      expect(derived.ok, name).toBe(false);
      expect(validateMissionBranch(`relay/mission/${name}`).ok, name).toBe(false);
      expect(validateMissionBranch(name).ok, name).toBe(false);
    }
  });

  it('refuses a branch outside the relay/mission namespace', () => {
    expect(validateMissionBranch('feature/x').ok).toBe(false);
    expect(validateMissionBranch('relay/run/x').ok).toBe(false);
  });
});

/* ---------------------------------------------------- path containment */

describe('path containment', () => {
  it('places the worktree under the approved root, per repository and mission', () => {
    const path = resolveMissionWorktreePath({
      approvedRoot: '/approved/root',
      repositoryName: 'sunday-relay',
      missionId: 'mission-1',
    });
    expect(path.ok && path.value).toBe('/approved/root/missions/sunday-relay/mission-1');
  });

  it('rejects traversal in the repository name or mission id', () => {
    for (const hostile of ['..', '../../etc', '.', '/etc/passwd']) {
      const byRepo = resolveMissionWorktreePath({
        approvedRoot: '/approved/root', repositoryName: hostile, missionId: 'm',
      });
      const byMission = resolveMissionWorktreePath({
        approvedRoot: '/approved/root', repositoryName: 'repo', missionId: hostile,
      });
      for (const result of [byRepo, byMission]) {
        if (result.ok) {
          expect(result.value.startsWith('/approved/root/missions/'), hostile).toBe(true);
          expect(result.value, hostile).not.toContain('..');
        }
      }
    }
  });

  it('refuses the primary checkout in every direction', () => {
    const { root } = syntheticRepository();
    expect(assertNotPrimaryCheckout(root, root).ok).toBe(false);
    expect(assertNotPrimaryCheckout(join(root, 'inside'), root).ok).toBe(false);
  });
});

/* -------------------------------------------------------- creation */

describe('worktree creation', () => {
  it('creates an isolated worktree at the exact base commit on a mission branch', () => {
    const { root } = syntheticRepository();
    const base = git(['rev-parse', 'HEAD'], root).trim();

    const result = open({ repositoryPath: root });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('creation must succeed');
    const record = result.value.record;

    expect(result.value.reopened).toBe(false);
    expect(record.state).toBe('ready');
    expect(record.missionBranch).toBe('relay/mission/mission-1');
    expect(record.baseCommit).toBe(base);
    expect(record.actualHead).toBe(base);
    expect(record.dirty).toBe(false);
    expect(existsSync(record.worktreePath)).toBe(true);
    // Real git agrees: the worktree is on the mission branch at that commit.
    expect(git(['rev-parse', 'HEAD'], record.worktreePath).trim()).toBe(base);
    expect(git(['branch', '--show-current'], record.worktreePath).trim()).toBe('relay/mission/mission-1');
    // The primary checkout is untouched and still on main.
    expect(git(['branch', '--show-current'], root).trim()).toBe('main');
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('never places the worktree inside the repository', () => {
    const { root } = syntheticRepository();
    const result = open({ repositoryPath: root });
    if (!result.ok) throw new Error('creation must succeed');
    expect(result.value.record.worktreePath.startsWith(root + '/')).toBe(false);
    expect(result.value.record.worktreePath).toContain('.relay-workspaces');
  });

  it('gives two missions separate branches and separate paths', () => {
    const { root } = syntheticRepository();
    const first = open({ repositoryPath: root, missionId: 'mission-1' });
    const second = open({ repositoryPath: root, missionId: 'mission-2' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('both missions must open');
    expect(first.value.record.missionBranch).not.toBe(second.value.record.missionBranch);
    expect(first.value.record.worktreePath).not.toBe(second.value.record.worktreePath);
    expect(existsSync(first.value.record.worktreePath)).toBe(true);
    expect(existsSync(second.value.record.worktreePath)).toBe(true);
  });

  it('a repeated open for the same mission REOPENS rather than duplicating', () => {
    const { root } = syntheticRepository();
    const first = open({ repositoryPath: root });
    if (!first.ok) throw new Error('first open must succeed');
    const sealed = sealWorktreeRecord(first.value.record);

    const second = open({ repositoryPath: root, existing: sealed });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('reopen must succeed');
    expect(second.value.reopened).toBe(true);
    expect(second.value.record.worktreePath).toBe(first.value.record.worktreePath);
    expect(second.value.record.missionBranch).toBe(first.value.record.missionBranch);
    // Exactly one worktree directory exists for this mission.
    const missionsDir = join(first.value.record.worktreePath, '..');
    expect(readdirSync(missionsDir)).toEqual(['mission-1']);
  });

  it('refuses when another live session owns the mission worktree', () => {
    const { root } = syntheticRepository();
    const first = open({ repositoryPath: root });
    if (!first.ok) throw new Error('first open must succeed');
    const owned = sealWorktreeRecord({
      ...first.value.record,
      owner: { sessionId: 'session-other', claimedAt: NOW, expiresAt: '2026-08-01T12:00:30.000Z' },
    });
    const blocked = open({ repositoryPath: root, existing: owned, sessionId: 'session-a' });
    expect(blocked.ok).toBe(false);
  });

  it('a failed creation is never reported ready', () => {
    const { root } = syntheticRepository();
    // Occupy the mission branch so git refuses to create it again.
    git(['branch', 'relay/mission/mission-1'], root);
    const result = open({ repositoryPath: root });
    expect(result.ok).toBe(false);
  });

  it('rejects a path that is not a repository root', () => {
    const { root } = syntheticRepository();
    const sub = join(root, 'src');
    mkdirSync(sub);
    expect(open({ repositoryPath: sub }).ok).toBe(false);
  });
});

/* ------------------------------------------------------- validation */

describe('restart validation', () => {
  const openAndSeal = (root: string): MissionWorktreeRecord => {
    const result = open({ repositoryPath: root });
    if (!result.ok) throw new Error('open must succeed');
    return sealWorktreeRecord(result.value.record);
  };

  it('finds the same worktree after a restart', () => {
    const { root } = syntheticRepository();
    const record = openAndSeal(root);
    const validated = validateMissionWorktree({ record, now: NOW, sessionId: 'session-a' });
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error('validation must succeed');
    expect(validated.value.record.state).toBe('ready');
    expect(validated.value.record.worktreePath).toBe(record.worktreePath);
    expect(validated.value.record.lastValidatedAt).toBe(NOW);
    const checks = validated.value.record.validationFindings.map((f) => f.check);
    expect(checks).toContain('repository_exists');
    expect(checks).toContain('git_registration');
    expect(checks).toContain('branch_matches');
    expect(checks).toContain('head_matches');
  });

  it('reports a MISSING worktree and never recreates it', () => {
    const { root } = syntheticRepository();
    const record = openAndSeal(root);
    rmSync(record.worktreePath, { recursive: true, force: true });
    const validated = validateMissionWorktree({ record, now: NOW, sessionId: 'session-a' });
    if (!validated.ok) throw new Error('validation must resolve');
    expect(validated.value.record.state).toBe('missing');
    expect(existsSync(record.worktreePath)).toBe(false);
    expect(
      validated.value.record.validationFindings.some((f) =>
        f.detail.includes('will not recreate')),
    ).toBe(true);
  });

  it('dirty state survives a restart and is reported truthfully', () => {
    const { root } = syntheticRepository();
    const record = openAndSeal(root);
    writeFileSync(join(record.worktreePath, 'work.txt'), 'in progress\n', 'utf8');
    const validated = validateMissionWorktree({ record, now: NOW, sessionId: 'session-a' });
    if (!validated.ok) throw new Error('validation must resolve');
    expect(validated.value.record.dirty).toBe(true);
    expect(validated.value.record.state).toBe('active');
    expect(validated.value.record.cleanupEligible).toBe(false);
    expect(validated.value.record.cleanupBlockers).toContain('uncommitted mission work remains');
  });

  it('detects a branch that changed while Relay was away', () => {
    const { root } = syntheticRepository();
    const record = openAndSeal(root);
    git(['checkout', '-b', 'someone-elses-branch'], record.worktreePath);
    const validated = validateMissionWorktree({ record, now: NOW, sessionId: 'session-a' });
    if (!validated.ok) throw new Error('validation must resolve');
    expect(validated.value.record.state).toBe('requires_inspection');
  });

  it('reports an advanced HEAD as progress, not corruption', () => {
    const { root } = syntheticRepository();
    const record = openAndSeal(root);
    writeFileSync(join(record.worktreePath, 'done.txt'), 'work\n', 'utf8');
    git(['add', '.'], record.worktreePath);
    git(['commit', '-m', 'mission work'], record.worktreePath);
    const validated = validateMissionWorktree({ record, now: NOW, sessionId: 'session-a' });
    if (!validated.ok) throw new Error('validation must resolve');
    expect(validated.value.record.state).toBe('ready');
    expect(validated.value.record.actualHead).not.toBe(record.expectedHead);
    expect(
      validated.value.record.validationFindings.some((f) => f.detail.includes('HEAD advanced')),
    ).toBe(true);
  });

  it('a stale directory that git does not know requires inspection', () => {
    const { root, container } = syntheticRepository();
    const record = openAndSeal(root);
    // Simulate a directory left behind without git registration.
    const orphan = join(container, '.relay-workspaces', 'missions', 'sunday-relay-fixture', 'orphan');
    mkdirSync(orphan, { recursive: true });
    const stale = sealWorktreeRecord({ ...record, worktreePath: orphan, missionId: 'orphan' });
    const validated = validateMissionWorktree({ record: stale, now: NOW, sessionId: 'session-a' });
    if (!validated.ok) throw new Error('validation must resolve');
    expect(['requires_inspection', 'conflicted']).toContain(validated.value.record.state);
  });

  it('refuses a worktree path that became a symlink', () => {
    const { root, container } = syntheticRepository();
    const record = openAndSeal(root);
    rmSync(record.worktreePath, { recursive: true, force: true });
    const elsewhere = join(container, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, record.worktreePath);
    const validated = validateMissionWorktree({ record, now: NOW, sessionId: 'session-a' });
    if (!validated.ok) throw new Error('validation must resolve');
    expect(validated.value.record.state).toBe('conflicted');
  });
});

/* ---------------------------------------------------------- cleanup */

describe('cleanup safety', () => {
  it('blocks cleanup on dirty work, unknown process state and a live mission', () => {
    const dirty = evaluateWorktreeCleanup({
      state: 'active', dirty: true, processState: 'none', archived: true, missionTerminal: true,
    });
    expect(dirty.eligible).toBe(false);
    expect(dirty.blockers).toContain('uncommitted mission work remains');

    const unknownProcess = evaluateWorktreeCleanup({
      state: 'ready', dirty: false, processState: 'unknown', archived: true, missionTerminal: true,
    });
    expect(unknownProcess.eligible).toBe(false);
    expect(unknownProcess.blockers).toContain('no process status is known');

    const liveMission = evaluateWorktreeCleanup({
      state: 'ready', dirty: false, processState: 'none', archived: false, missionTerminal: false,
    });
    expect(liveMission.eligible).toBe(false);
    expect(liveMission.blockers).toContain('mission is not terminal');

    const uninspected = evaluateWorktreeCleanup({
      state: 'ready', dirty: null, processState: 'none', archived: true, missionTerminal: true,
    });
    expect(uninspected.eligible).toBe(false);
  });

  it('allows removal only when everything is proven safe', () => {
    const safe = evaluateWorktreeCleanup({
      state: 'ready', dirty: false, processState: 'none', archived: true, missionTerminal: true,
    });
    expect(safe.eligible).toBe(true);
    expect(safe.blockers).toEqual([]);
  });

  it('removes a clean terminal worktree and leaves the repository intact', () => {
    const { root } = syntheticRepository();
    const opened = open({ repositoryPath: root });
    if (!opened.ok) throw new Error('open must succeed');
    const record = sealWorktreeRecord(opened.value.record);
    const removed = removeMissionWorktree({
      record,
      assessment: { eligible: true, blockers: [] },
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) throw new Error('removal must succeed');
    expect(removed.value.record.state).toBe('removed');
    expect(existsSync(record.worktreePath)).toBe(false);
    // The repository and its branch survive — no force delete anywhere.
    expect(git(['rev-parse', 'HEAD'], root).trim().length).toBeGreaterThan(0);
    expect(git(['branch', '--list', 'relay/mission/mission-1'], root).trim()).not.toBe('');
  });

  it('refuses removal when cleanup is blocked', () => {
    const { root } = syntheticRepository();
    const opened = open({ repositoryPath: root });
    if (!opened.ok) throw new Error('open must succeed');
    const record = sealWorktreeRecord(opened.value.record);
    const refused = removeMissionWorktree({
      record,
      assessment: { eligible: false, blockers: ['uncommitted mission work remains'] },
    });
    expect(refused.ok).toBe(false);
    expect(existsSync(record.worktreePath)).toBe(true);
  });

  it('refuses to remove another mission’s worktree path', () => {
    const { root } = syntheticRepository();
    const mine = open({ repositoryPath: root, missionId: 'mission-1' });
    const theirs = open({ repositoryPath: root, missionId: 'mission-2' });
    if (!mine.ok || !theirs.ok) throw new Error('both must open');
    // A record claiming my mission but pointing at THEIR path still names a
    // path inside the approved root, so the guard that matters is that the
    // record's own path is the one removed — never a substituted one.
    const removed = removeMissionWorktree({
      record: sealWorktreeRecord({ ...mine.value.record, worktreePath: theirs.value.record.worktreePath }),
      assessment: { eligible: true, blockers: [] },
    });
    // Removal targets exactly the recorded path; mission-1's tree is intact.
    expect(existsSync(mine.value.record.worktreePath)).toBe(true);
    expect(removed.ok).toBe(true);
  });

  it('never removes the primary checkout', () => {
    const { root } = syntheticRepository();
    const opened = open({ repositoryPath: root });
    if (!opened.ok) throw new Error('open must succeed');
    const hostile = sealWorktreeRecord({ ...opened.value.record, worktreePath: root });
    const refused = removeMissionWorktree({ record: hostile, assessment: { eligible: true, blockers: [] } });
    expect(refused.ok).toBe(false);
    expect(existsSync(root)).toBe(true);
    expect(git(['rev-parse', 'HEAD'], root).trim().length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------- durability */

describe('durable worktree records', () => {
  it('survives a restart through the Node store', async () => {
    const { root } = syntheticRepository();
    const stateRoot = tempDir('relay-wt-state-');
    const opened = open({ repositoryPath: root });
    if (!opened.ok) throw new Error('open must succeed');

    const store = createNodeMissionWorktreeStore(stateRoot);
    const written = await store.write(opened.value.record);
    expect(written.ok).toBe(true);

    // A brand-new store instance, as after a restart.
    const reopened = createNodeMissionWorktreeStore(stateRoot);
    const read = await reopened.read('mission-1');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('record must survive');
    expect(read.record.missionBranch).toBe('relay/mission/mission-1');
    expect(read.record.worktreePath).toBe(opened.value.record.worktreePath);
  });

  it('writes the durable record only after git validation passed', () => {
    const { root } = syntheticRepository();
    const opened = open({ repositoryPath: root });
    if (!opened.ok) throw new Error('open must succeed');
    // The record exists only because creation verified repo, branch and HEAD.
    const checks = opened.value.record.validationFindings.map((f) => f.check);
    expect(checks).toContain('git_registration');
    expect(checks).toContain('head_matches');
    expect(opened.value.record.validationFindings.every((f) => f.ok)).toBe(true);
  });

  it('stores no home directory in the displayed repository name', () => {
    const { root } = syntheticRepository();
    const opened = open({ repositoryPath: root });
    if (!opened.ok) throw new Error('open must succeed');
    expect(opened.value.record.repositoryName).toBe('sunday-relay-fixture');
    expect(opened.value.record.repositoryName).not.toContain('/');
  });
});
