import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from './index';
import { validateSourceRepository } from './repository-inspector';
import type { WorkspacePolicyInput, WorkspaceService } from './contracts';
import type { ProjectId, RunId, TaskId } from '../protocol/ids';
import { deterministicIds, testClock } from '../testing/factories';

/**
 * Workspace integration tests (Prompt 7): REAL git worktrees against
 * throwaway fixture repositories under the OS temp dir. Every fixture is
 * removed after each test; the suite asserts source repositories stay
 * untouched throughout.
 */

const FIXTURE_ENV = {
  GIT_AUTHOR_NAME: 'Relay Test', GIT_AUTHOR_EMAIL: 'test@relay.local',
  GIT_COMMITTER_NAME: 'Relay Test', GIT_COMMITTER_EMAIL: 'test@relay.local',
  GIT_TERMINAL_PROMPT: '0',
};
const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: 15_000,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...FIXTURE_ENV },
  });

let fixtureRoot: string;
let sourceRepo: string;
let service: WorkspaceService;

const identity = (run = 'run_wtest1', task = 'tsk_wtest1') => ({
  projectId: 'prj_wtest' as ProjectId,
  runId: run as RunId,
  taskId: task as TaskId,
  sourceRepositoryPath: sourceRepo,
});

const policy: WorkspacePolicyInput = {
  protectedPaths: { forbidden: ['secrets'], readOnly: [] },
  claimedWritePaths: ['src/app.txt'],
};

const prepare = () => {
  const prepared = service.prepareWorkspace(identity());
  if (!prepared.ok) throw new Error(prepared.error.message);
  return prepared.value.value.workspace;
};

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'relay-wtest-'));
  sourceRepo = join(fixtureRoot, 'source');
  mkdirSync(join(sourceRepo, 'src'), { recursive: true });
  mkdirSync(join(sourceRepo, 'secrets'), { recursive: true });
  git(['init', '-q', '-b', 'main'], sourceRepo);
  writeFileSync(join(sourceRepo, 'src', 'app.txt'), 'v1\n');
  writeFileSync(join(sourceRepo, 'secrets', 'prod.env'), 'placeholder\n');
  git(['add', '.'], sourceRepo);
  git(['commit', '-q', '-m', 'baseline'], sourceRepo);
  const clock = testClock('2026-07-22T16:00:00.000Z', 1000);
  service = createWorkspaceService({ ids: deterministicIds(), now: () => clock.now() });
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('repository validation', () => {
  it('accepts a repository root and rejects non-repos, subdirectories, and hostile paths', () => {
    expect(validateSourceRepository(sourceRepo).ok).toBe(true);
    expect(validateSourceRepository(join(fixtureRoot, 'nope')).ok).toBe(false);
    expect(validateSourceRepository(fixtureRoot).ok).toBe(false); // not a repo
    expect(validateSourceRepository(join(sourceRepo, 'src')).ok).toBe(false); // subdirectory
    expect(validateSourceRepository('path\0null').ok).toBe(false);
    expect(validateSourceRepository('').ok).toBe(false);
  });
});

describe('worktree lifecycle', () => {
  it('creates an isolated worktree pinned to the source revision on a run branch', () => {
    const baseline = git(['rev-parse', 'HEAD'], sourceRepo).trim();
    const workspace = prepare();
    expect(workspace.sourceRevision).toBe(baseline);
    expect(workspace.branchName).toBe('relay/run/wtest1');
    expect(workspace.baseBranch).toBe('main');
    expect(workspace.status).toBe('ready');
    expect(workspace.provenance).toBe('live');
    expect(workspace.workspacePath).toContain('.relay-workspaces');
    expect(workspace.workspacePath.startsWith(sourceRepo)).toBe(false);
    expect(git(['rev-parse', 'HEAD'], workspace.workspacePath).trim()).toBe(baseline);
    // source untouched: same branch, same revision, clean
    expect(git(['branch', '--show-current'], sourceRepo).trim()).toBe('main');
    expect(git(['status', '--porcelain'], sourceRepo).trim()).toBe('');
  });

  it('is idempotent for the same request and refuses conflicting branch reuse', () => {
    const first = prepare();
    const again = service.prepareWorkspace(identity());
    expect(again.ok && again.value.value.idempotent).toBe(true);
    expect(again.ok && again.value.value.workspace.workspaceId).toBe(first.workspaceId);
    // different run, same branch → conflicting reuse fails safely
    const conflicting = service.prepareWorkspace({ ...identity('run_wtest2', 'tsk_wtest2'), branchName: first.branchName });
    expect(conflicting.ok).toBe(false);
  });

  it('rejects branch injection and dirty-source pinning stays commit-based', () => {
    expect(service.prepareWorkspace({ ...identity('run_x', 'tsk_x'), branchName: '-D' }).ok).toBe(false);
    expect(service.prepareWorkspace({ ...identity('run_x', 'tsk_x'), branchName: 'a..b' }).ok).toBe(false);
    // dirty source: workspace still starts from the COMMIT, never the dirty tree
    writeFileSync(join(sourceRepo, 'src', 'app.txt'), 'uncommitted\n');
    const workspace = service.prepareWorkspace(identity('run_dirty', 'tsk_dirty'));
    expect(workspace.ok).toBe(true);
    if (workspace.ok) {
      expect(workspace.value.value.workspace.sourceDirtyAtPin).toBe(true);
      const inWorkspace = join(workspace.value.value.workspace.workspacePath, 'src', 'app.txt');
      expect(existsSync(inWorkspace)).toBe(true);
      expect(git(['status', '--porcelain'], workspace.value.value.workspace.workspacePath).trim()).toBe('');
    }
  });

  it('detects an unexpected source change and requires revalidation', () => {
    const workspace = prepare();
    const unchanged = service.verifySourceUnchanged(workspace.workspaceId);
    expect(unchanged.ok && !unchanged.value.value.changed).toBe(true);
    writeFileSync(join(sourceRepo, 'src', 'app.txt'), 'moved\n');
    git(['add', '.'], sourceRepo);
    git(['commit', '-q', '-m', 'source moved'], sourceRepo);
    const moved = service.verifySourceUnchanged(workspace.workspaceId);
    expect(moved.ok && moved.value.value.changed).toBe(true);
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('checkpoint_required');
    const events = service.collectEvents().map((e) => e.kind);
    expect(events).toContain('workspace.source_changed');
  });
});

describe('inspection and file-claim enforcement', () => {
  it('classifies claimed, unclaimed, and protected changes; claims never expand', () => {
    const workspace = prepare();
    const clean = service.inspectWorkspace(workspace.workspaceId, policy);
    expect(clean.ok && clean.value.value.assessment).toBe('clean');

    writeFileSync(join(workspace.workspacePath, 'src', 'app.txt'), 'claimed edit\n');
    const allowed = service.inspectWorkspace(workspace.workspaceId, policy);
    expect(allowed.ok && allowed.value.value.assessment).toBe('allowed');

    writeFileSync(join(workspace.workspacePath, 'unclaimed.txt'), 'stray\n');
    const unclaimed = service.inspectWorkspace(workspace.workspaceId, policy);
    expect(unclaimed.ok && unclaimed.value.value.assessment).toBe('unclaimed_change');
    expect(unclaimed.ok && unclaimed.value.value.unclaimedChanges).toContain('unclaimed.txt');
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('dirty');
    rmSync(join(workspace.workspacePath, 'unclaimed.txt'));

    writeFileSync(join(workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    const flagged = service.inspectWorkspace(workspace.workspaceId, policy);
    expect(flagged.ok && flagged.value.value.assessment).toBe('protected_change');
    expect(flagged.ok && flagged.value.value.protectedChanges).toContain('secrets/prod.env');
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('checkpoint_required');
    const kinds = service.collectEvents().map((e) => e.kind);
    expect(kinds).toContain('workspace.change_flagged');
  });

  it('detects a symlink escaping the workspace', () => {
    const workspace = prepare();
    symlinkSync(fixtureRoot, join(workspace.workspacePath, 'escape-link'));
    const inspected = service.inspectWorkspace(workspace.workspaceId, policy);
    expect(inspected.ok && inspected.value.value.assessment).toBe('symlink_escape');
    expect(inspected.ok && inspected.value.value.symlinkEscapes).toContain('escape-link');
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('checkpoint_required');
  });
});

describe('command execution', () => {
  it('runs an approved command with live provenance and bounded evidence', async () => {
    const workspace = prepare();
    const result = await service.executeCommand({
      commandId: 'c1', ...identity(), workspaceId: workspace.workspaceId,
      executable: 'git', args: ['rev-parse', 'HEAD'], expectedPurpose: 'revision proof',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value.value;
    expect(value.status).toBe('completed');
    expect(value.exitCode).toBe(0);
    expect(value.stdout.trim()).toBe(workspace.sourceRevision);
    expect(value.provenance).toBe('live');
    expect(value.enforcement).toBe('enforced');
    expect(value.evidenceRefs.length).toBeGreaterThan(0);
  });

  it('rejects unapproved commands with recorded evidence and no execution', async () => {
    const workspace = prepare();
    for (const [executable, args] of [
      ['bash', ['-c', 'true']], ['git', ['push']], ['git', ['reset', '--hard']],
      ['git', ['clean', '-fd']], ['rm', ['-rf', '.']], ['npm', ['publish']],
    ] as Array<[string, string[]]>) {
      const result = await service.executeCommand({
        commandId: `rej-${executable}-${args[0]}`, ...identity(), workspaceId: workspace.workspaceId,
        executable, args, expectedPurpose: 'must reject',
      });
      expect(result.ok && result.value.value.status, `${executable} ${args.join(' ')}`).toBe('rejected');
      expect(result.ok && (result.value.value.rejectionReasons ?? []).length).toBeGreaterThan(0);
    }
    const kinds = service.collectEvents().map((e) => e.kind);
    expect(kinds).toContain('workspace.command_rejected');
  });

  it('validates the working directory and refuses escapes', async () => {
    const workspace = prepare();
    const inside = await service.executeCommand({
      commandId: 'wd1', ...identity(), workspaceId: workspace.workspaceId,
      executable: 'git', args: ['rev-parse', 'HEAD'], relativeWorkingDirectory: 'src',
      expectedPurpose: 'cwd proof',
    });
    expect(inside.ok && inside.value.value.status).toBe('completed');
    const escape = await service.executeCommand({
      commandId: 'wd2', ...identity(), workspaceId: workspace.workspaceId,
      executable: 'git', args: ['rev-parse', 'HEAD'], relativeWorkingDirectory: '../..',
      expectedPurpose: 'must refuse',
    });
    expect(escape.ok).toBe(false);
  });

  it('never inherits provider secrets into child processes', async () => {
    const workspace = prepare();
    process.env.RELAY_TEST_FAKE_SECRET_TOKEN = 'sk-FAKETESTNOTREAL0008';
    try {
      const result = await service.executeCommand({
        commandId: 'env1', ...identity(), workspaceId: workspace.workspaceId,
        executable: 'git', args: ['rev-parse', 'HEAD'],
        environmentKeys: ['RELAY_TEST_FAKE_SECRET_TOKEN'],
        expectedPurpose: 'env proof',
      });
      expect(result.ok && result.value.value.grantedEnvironmentKeys).not.toContain('RELAY_TEST_FAKE_SECRET_TOKEN');
    } finally {
      delete process.env.RELAY_TEST_FAKE_SECRET_TOKEN;
    }
  });

  it('unknown workspace and unregistered ids fail safely', async () => {
    const result = await service.executeCommand({
      commandId: 'x', ...identity(), workspaceId: 'wsp_unknown' as never,
      executable: 'git', args: ['rev-parse', 'HEAD'], expectedPurpose: 'must fail',
    });
    expect(result.ok).toBe(false);
  });
});

describe('cleanup safety', () => {
  it('preserves without authorization; removes a clean workspace only when authorized', () => {
    const workspace = prepare();
    const unauthorized = service.cleanupWorkspace(workspace.workspaceId);
    expect(unauthorized.ok && unauthorized.value.value.outcome).toBe('preserved');
    expect(existsSync(workspace.workspacePath)).toBe(true);
    const authorized = service.cleanupWorkspace(workspace.workspaceId, { authorizeRemoval: true });
    expect(authorized.ok && authorized.value.value.outcome).toBe('cleanup_complete');
    expect(existsSync(workspace.workspacePath)).toBe(false);
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('removed');
    // source survives
    expect(git(['status', '--porcelain'], sourceRepo).trim()).toBe('');
  });

  it('refuses unknown workspaces and preserves flagged ones', () => {
    expect(service.cleanupWorkspace('wsp_unknown' as never, { authorizeRemoval: true }).ok).toBe(false);
    const workspace = prepare();
    writeFileSync(join(workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    service.inspectWorkspace(workspace.workspaceId, policy); // → checkpoint_required
    const preserved = service.cleanupWorkspace(workspace.workspaceId, { authorizeRemoval: true });
    expect(preserved.ok && preserved.value.value.outcome).toBe('preserved');
    expect(existsSync(workspace.workspacePath)).toBe(true);
  });
});

describe('evidence integrity', () => {
  it('associates live evidence with run/task/revisions and stays secret-free', () => {
    const workspace = prepare();
    service.inspectWorkspace(workspace.workspaceId, policy);
    const evidence = service.collectEvidence();
    expect(evidence.length).toBeGreaterThanOrEqual(4);
    for (const record of evidence) {
      expect(record.provenance).toBe('live');
      expect(record.verifier).toBe('relay-workspace');
      expect(record.runId).toBe(identity().runId);
      expect(record.taskId).toBe(identity().taskId);
      expect(record.repoRevision).toBe(workspace.sourceRevision);
    }
    const labels = evidence.map((e) => e.outputExcerpt);
    expect(labels.some((l) => l.startsWith('source-revision-pinned'))).toBe(true);
    expect(labels.some((l) => l.startsWith('worktree-created'))).toBe(true);
    expect(labels.some((l) => l.startsWith('source-worktree-untouched'))).toBe(true);
    const serialized = JSON.stringify({ evidence, events: service.collectEvents() });
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/);
  });
});
