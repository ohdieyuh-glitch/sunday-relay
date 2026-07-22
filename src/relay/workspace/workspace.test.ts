import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkspaceService } from './index';
import { DEFAULT_WORKSPACE_COMMAND_POLICY } from './command-policy';
import { inspectSourceRepository } from './repository-inspector';
import { parseEvent } from '../protocol/envelopes';
import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../protocol/ids';
import type { WorkspaceCommandPolicy, WorkspacePolicyInput } from './contracts';

/**
 * Workspace integration tests — REAL git worktrees against TEMPORARY
 * fixture repositories under the OS tmpdir (never the Sunday repository).
 * Every fixture directory is removed after the suite.
 */

const cleanupDirs: string[] = [];
afterAll(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  tmpRoot: string;
  sourceDir: string;
  revision: string;
  git(args: string[]): string;
}

function makeFixture(): Fixture {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'relay-ws-test-'));
  cleanupDirs.push(tmpRoot);
  const sourceDir = join(tmpRoot, 'repo');
  mkdirSync(sourceDir);
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: sourceDir, encoding: 'utf8', timeout: 15_000, windowsHide: true,
      env: { PATH: process.env.PATH ?? '', HOME: tmpRoot, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: join(tmpRoot, 'no-cfg'), GIT_CONFIG_SYSTEM: join(tmpRoot, 'no-cfg') },
    });
  git(['init', '--initial-branch', 'fixture-main']);
  mkdirSync(join(sourceDir, 'src'));
  mkdirSync(join(sourceDir, 'secrets'));
  writeFileSync(join(sourceDir, 'README.md'), 'fixture\n');
  writeFileSync(join(sourceDir, 'src', 'app.js'), 'module.exports = 1;\n');
  writeFileSync(join(sourceDir, 'secrets', 'prod.env'), 'placeholder-value\n');
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=f@relay.invalid', 'commit', '-m', 'baseline']);
  return { tmpRoot, sourceDir, revision: git(['rev-parse', 'HEAD']).trim(), git };
}

const POLICY: WorkspacePolicyInput = {
  protectedPaths: { forbidden: ['secrets'], readOnly: ['README.md'] },
  claimedWritePaths: ['src'],
};

const RUNNER_POLICY: WorkspaceCommandPolicy = {
  ...DEFAULT_WORKSPACE_COMMAND_POLICY,
  rules: [
    { executable: 'node', description: 'test probes', allowedFirstArgs: ['--version', '-e'] },
    { executable: 'git', description: 'read-only inspection' },
  ],
  environmentAllowlist: [...DEFAULT_WORKSPACE_COMMAND_POLICY.environmentAllowlist, 'RELAY_WS_TEST_PLAIN'],
};

let token = 0;
const idsOf = () => {
  token += 1;
  return {
    projectId: 'prj_wstest' as ProjectId,
    runId: `run_wst-${token}` as RunId,
    taskId: `tsk_wst-${token}` as TaskId,
  };
};

const serviceFor = (fixture: Fixture, policy: WorkspaceCommandPolicy = RUNNER_POLICY) =>
  createLocalWorkspaceService({ workspaceRoot: join(fixture.tmpRoot, '.relay-workspaces'), commandPolicy: policy });

const prepare = (fixture: Fixture, service = serviceFor(fixture), extra: Record<string, unknown> = {}) => {
  const ids = idsOf();
  const result = service.prepareWorkspace({ ...ids, sourceRepositoryPath: fixture.sourceDir, ...extra });
  if (!result.ok) throw new Error(result.error.message);
  return { service, ids, workspace: result.value.value.workspace };
};

describe('repository validation', () => {
  it('rejects non-repositories, null bytes, and missing paths', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'relay-ws-nonrepo-'));
    cleanupDirs.push(tmpRoot);
    expect(inspectSourceRepository(tmpRoot).ok).toBe(false);
    expect(inspectSourceRepository(join(tmpRoot, 'missing')).ok).toBe(false);
    expect(inspectSourceRepository('bad\0path').ok).toBe(false);
    expect(inspectSourceRepository('').ok).toBe(false);
  });

  it('rejects commitless repositories and pins full revisions otherwise', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'relay-ws-unborn-'));
    cleanupDirs.push(tmpRoot);
    execFileSync('git', ['init', tmpRoot], { encoding: 'utf8', windowsHide: true, env: { PATH: process.env.PATH ?? '', HOME: tmpRoot } });
    expect(inspectSourceRepository(tmpRoot).ok).toBe(false);

    const fixture = makeFixture();
    const info = inspectSourceRepository(fixture.sourceDir);
    expect(info.ok).toBe(true);
    if (info.ok) {
      expect(info.value.revision).toBe(fixture.revision);
      expect(info.value.branch).toBe('fixture-main');
      expect(info.value.dirty).toBe(false);
    }
  });
});

describe('worktree lifecycle', () => {
  it('creates a pinned isolated worktree with live evidence and valid events', () => {
    const fixture = makeFixture();
    const { service, workspace } = prepare(fixture);
    expect(workspace.sourceRevision).toBe(fixture.revision);
    expect(workspace.baseBranch).toBe('fixture-main');
    expect(workspace.status).toBe('ready');
    expect(workspace.provenance).toBe('live');
    expect(workspace.workspacePath.startsWith(join(fixture.tmpRoot, '.relay-workspaces'))).toBe(true);
    expect(existsSync(join(workspace.workspacePath, 'src', 'app.js'))).toBe(true);

    const evidence = service.collectEvidence();
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence.every((e) => e.provenance === 'live' && e.verifier === 'relay-workspace')).toBe(true);
    const events = service.collectEvents();
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['workspace.validated', 'workspace.created']));
    events.forEach((draft, i) => {
      const parsed = parseEvent({ ...draft, eventId: `evt_wst${String(i + 1).padStart(4, '0')}`, sequence: i + 1 });
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    });
    // No absolute paths leak into user-facing event summaries.
    expect(events.some((e) => e.safeSummary.includes(fixture.tmpRoot))).toBe(false);
  });

  it('is idempotent for the same request and refuses conflicting reuse', () => {
    const fixture = makeFixture();
    const service = serviceFor(fixture);
    const ids = idsOf();
    const first = service.prepareWorkspace({ ...ids, sourceRepositoryPath: fixture.sourceDir });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = service.prepareWorkspace({ ...ids, sourceRepositoryPath: fixture.sourceDir });
    expect(again.ok && again.value.value.idempotent).toBe(true);
    if (again.ok) expect(again.value.value.workspace.workspaceId).toBe(first.value.value.workspace.workspaceId);

    const conflictingBranch = service.prepareWorkspace({ ...ids, sourceRepositoryPath: fixture.sourceDir, branchName: 'relay/run/other' });
    expect(conflictingBranch.ok).toBe(false);

    const otherRun = service.prepareWorkspace({ ...idsOf(), sourceRepositoryPath: fixture.sourceDir, branchName: first.value.value.workspace.branchName });
    expect(otherRun.ok).toBe(false); // branch assigned to another active run
  });

  it('rejects branch injection and pre-existing branches', () => {
    const fixture = makeFixture();
    const service = serviceFor(fixture);
    for (const branchName of ['bad;rm', 'bad`x`', '-flag', 'a..b', 'x@{1}']) {
      const result = service.prepareWorkspace({ ...idsOf(), sourceRepositoryPath: fixture.sourceDir, branchName });
      expect(result.ok, branchName).toBe(false);
    }
    fixture.git(['branch', 'taken-branch']);
    const taken = service.prepareWorkspace({ ...idsOf(), sourceRepositoryPath: fixture.sourceDir, branchName: 'taken-branch' });
    expect(taken.ok).toBe(false);
  });

  it('rejects a symlinked workspace root', () => {
    const fixture = makeFixture();
    const realRoot = join(fixture.tmpRoot, 'real-root');
    mkdirSync(realRoot);
    const linkRoot = join(fixture.tmpRoot, 'link-root');
    symlinkSync(realRoot, linkRoot);
    const service = createLocalWorkspaceService({ workspaceRoot: linkRoot, commandPolicy: RUNNER_POLICY });
    const result = service.prepareWorkspace({ ...idsOf(), sourceRepositoryPath: fixture.sourceDir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('symlink');
  });

  it('never modifies the source worktree and detects unexpected source changes', () => {
    const fixture = makeFixture();
    const { service, workspace } = prepare(fixture);
    expect(fixture.git(['status', '--porcelain']).trim()).toBe('');
    expect(fixture.git(['rev-parse', 'HEAD']).trim()).toBe(fixture.revision);

    const unchanged = service.verifySourceUnchanged(workspace.workspaceId);
    expect(unchanged.ok && !unchanged.value.value.changed).toBe(true);

    writeFileSync(join(fixture.sourceDir, 'src', 'app.js'), 'module.exports = 99;\n');
    fixture.git(['add', '.']);
    fixture.git(['-c', 'user.name=User', '-c', 'user.email=u@x.invalid', 'commit', '-m', 'user work']);
    const changed = service.verifySourceUnchanged(workspace.workspaceId);
    expect(changed.ok && changed.value.value.changed).toBe(true);
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('checkpoint_required');
    const kinds = service.collectEvents().map((e) => e.kind);
    expect(kinds).toContain('workspace.source_changed');
  });
});

describe('inspection and file-claim enforcement', () => {
  it('walks clean → allowed → unclaimed → protected → symlink escape, without expanding claims', () => {
    const fixture = makeFixture();
    const { service, workspace } = prepare(fixture);
    const policySnapshot = JSON.stringify(POLICY);

    const clean = service.inspectWorkspace(workspace.workspaceId, POLICY);
    expect(clean.ok && clean.value.value.assessment).toBe('clean');

    writeFileSync(join(workspace.workspacePath, 'src', 'app.js'), 'module.exports = 2;\n');
    const allowed = service.inspectWorkspace(workspace.workspaceId, POLICY);
    expect(allowed.ok && allowed.value.value.assessment).toBe('allowed');
    if (allowed.ok) expect(allowed.value.value.claimedChanges).toContain('src/app.js');
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('active');

    writeFileSync(join(workspace.workspacePath, 'stray.md'), 'unclaimed\n');
    const unclaimed = service.inspectWorkspace(workspace.workspaceId, POLICY);
    expect(unclaimed.ok && unclaimed.value.value.assessment).toBe('unclaimed_change');
    if (unclaimed.ok) expect(unclaimed.value.value.unclaimedChanges).toContain('stray.md');
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('checkpoint_required');

    writeFileSync(join(workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    const protectedChange = service.inspectWorkspace(workspace.workspaceId, POLICY);
    expect(protectedChange.ok && protectedChange.value.value.assessment).toBe('protected_change');
    if (protectedChange.ok) expect(protectedChange.value.value.protectedChanges).toContain('secrets/prod.env');

    symlinkSync(join(fixture.tmpRoot, 'outside'), join(workspace.workspacePath, 'src', 'link-out'));
    const escape = service.inspectWorkspace(workspace.workspaceId, POLICY);
    expect(escape.ok && escape.value.value.assessment).toBe('symlink_escape');
    if (escape.ok) expect(escape.value.value.symlinkEscapes).toContain('src/link-out');

    expect(JSON.stringify(POLICY)).toBe(policySnapshot); // claims never expanded
    expect(service.collectEvents().map((e) => e.kind)).toContain('workspace.change_flagged');
  });

  it('read-only paths are protected against writes', () => {
    const fixture = makeFixture();
    const { service, workspace } = prepare(fixture);
    writeFileSync(join(workspace.workspacePath, 'README.md'), 'rewritten\n');
    const inspection = service.inspectWorkspace(workspace.workspaceId, POLICY);
    expect(inspection.ok && inspection.value.value.assessment).toBe('protected_change');
    if (inspection.ok) expect(inspection.value.value.protectedChanges).toContain('README.md');
  });
});

describe('safe command execution', () => {
  it('runs approved commands with bounded output and live evidence', async () => {
    const fixture = makeFixture();
    const { service, ids, workspace } = prepare(fixture);
    const result = await service.executeCommand({
      commandId: 'cmd-version', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['--version'], expectedPurpose: 'proof',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.status).toBe('completed');
    expect(result.value.value.exitCode).toBe(0);
    expect(result.value.value.stdout).toContain('v');
    expect(result.value.value.provenance).toBe('live');
    expect(result.value.value.enforcement).toBe('enforced');
    // Idempotent replay by commandId.
    const replay = await service.executeCommand({
      commandId: 'cmd-version', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['--version'], expectedPurpose: 'proof',
    });
    expect(replay.ok && replay.value.value.startedAt).toBe(result.value.value.startedAt);
  });

  it('rejects unapproved executables, dangerous git, metacharacters, and cwd escapes', async () => {
    const fixture = makeFixture();
    const { service, ids, workspace } = prepare(fixture);
    const run = (over: Record<string, unknown>, id: string) =>
      service.executeCommand({
        commandId: id, ...ids, workspaceId: workspace.workspaceId,
        executable: 'node', args: ['--version'], expectedPurpose: 'reject', ...over,
      });
    for (const [i, over] of [
      { executable: 'bash', args: ['-c', 'ls'] },
      { executable: 'git', args: ['push', '--force'] },
      { executable: 'git', args: ['reset', '--hard'] },
      { executable: 'git', args: ['clean', '-fd'] },
      { executable: 'git', args: ['status', ';rm'] },
      { relativeWorkingDirectory: '../..' },
      { relativeWorkingDirectory: 'does-not-exist' },
    ].entries()) {
      const result = await run(over, `cmd-reject-${i}`);
      expect(result.ok, JSON.stringify(over)).toBe(true);
      if (result.ok) expect(result.value.value.status, JSON.stringify(over)).toBe('rejected');
    }
    const kinds = service.collectEvents().map((e) => e.kind);
    expect(kinds).toContain('workspace.command_rejected');
  });

  it('never inherits provider-secret environment variables', async () => {
    const fixture = makeFixture();
    const { service, ids, workspace } = prepare(fixture);
    process.env.RELAY_WS_TEST_FAKE_TOKEN = 'sk-FAKETESTNOTREAL0005';
    process.env.RELAY_WS_TEST_PLAIN = 'plain-ok';
    try {
      const result = await service.executeCommand({
        commandId: 'cmd-env', ...ids, workspaceId: workspace.workspaceId,
        executable: 'node',
        args: ['-e', "console.log(String(process.env.RELAY_WS_TEST_FAKE_TOKEN), String(process.env.RELAY_WS_TEST_PLAIN))"],
        environmentKeys: ['RELAY_WS_TEST_FAKE_TOKEN', 'RELAY_WS_TEST_PLAIN'],
        expectedPurpose: 'environment isolation proof',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value.stdout).toContain('undefined plain-ok');
        expect(result.value.value.grantedEnvironmentKeys).not.toContain('RELAY_WS_TEST_FAKE_TOKEN');
      }
    } finally {
      delete process.env.RELAY_WS_TEST_FAKE_TOKEN;
      delete process.env.RELAY_WS_TEST_PLAIN;
    }
  });

  it('enforces timeouts, cancellation, output limits, and sanitization', async () => {
    const fixture = makeFixture();
    const { service, ids, workspace } = prepare(fixture);
    const slow = 'setTimeout(function(){}, 30000)';

    const timedOut = await service.executeCommand({
      commandId: 'cmd-timeout', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['-e', slow], timeoutMs: 400, expectedPurpose: 'timeout',
    });
    expect(timedOut.ok && timedOut.value.value.status).toBe('timed_out');
    if (timedOut.ok) {
      expect(timedOut.value.value.timedOut).toBe(true);
      expect(timedOut.value.value.termination).toBe('termination_confirmed');
      expect(timedOut.value.value.signal).toBeTruthy();
    }

    const pending = service.executeCommand({
      commandId: 'cmd-cancel', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['-e', slow], timeoutMs: 30_000, expectedPurpose: 'cancel',
    });
    setTimeout(() => {
      expect(service.cancelCommand('cmd-cancel')).toBe(true);
    }, 150);
    const cancelled = await pending;
    expect(cancelled.ok && cancelled.value.value.status).toBe('cancelled');
    expect(service.cancelCommand('cmd-cancel')).toBe(false); // nothing active

    const noisy = await service.executeCommand({
      commandId: 'cmd-noisy', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['-e', "process.stdout.write('y'.repeat(200000))"],
      outputLimitBytes: 2048, expectedPurpose: 'bound',
    });
    expect(noisy.ok).toBe(true);
    if (noisy.ok) {
      expect(noisy.value.value.truncated).toBe(true);
      expect(noisy.value.value.stdout.length).toBeLessThan(10_000);
    }

    const secret = await service.executeCommand({
      commandId: 'cmd-secret', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['-e', "console.log('sk-' + 'FAKETESTNOTREAL0006')"], expectedPurpose: 'sanitize',
    });
    expect(secret.ok).toBe(true);
    if (secret.ok) {
      expect(secret.value.value.stdout).not.toContain('sk-FAKETESTNOTREAL0006');
      expect(secret.value.value.stdout).toContain('[REDACTED');
    }
  });

  it('stops executing once the workspace is flagged', async () => {
    const fixture = makeFixture();
    const { service, ids, workspace } = prepare(fixture);
    writeFileSync(join(workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    service.inspectWorkspace(workspace.workspaceId, POLICY);
    const blocked = await service.executeCommand({
      commandId: 'cmd-blocked', ...ids, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['--version'], expectedPurpose: 'must not run',
    });
    expect(blocked.ok && blocked.value.value.status).toBe('rejected');
  });
});

describe('conservative cleanup', () => {
  it('preserves without authorization, removes clean workspaces with it, and refuses unknowns', () => {
    const fixture = makeFixture();
    const { service, workspace } = prepare(fixture, serviceFor(fixture), { cleanupPolicy: 'manual_cleanup' });

    const preserved = service.cleanupWorkspace(workspace.workspaceId);
    expect(preserved.ok && preserved.value.value.outcome).toBe('preserved');
    expect(existsSync(workspace.workspacePath)).toBe(true);

    const removed = service.cleanupWorkspace(workspace.workspaceId, { authorizeRemoval: true });
    expect(removed.ok && removed.value.value.outcome).toBe('cleanup_complete');
    expect(existsSync(workspace.workspacePath)).toBe(false);
    expect(service.getWorkspace(workspace.workspaceId)?.status).toBe('removed');
    expect(fixture.git(['status', '--porcelain']).trim()).toBe('');

    const unknown = service.cleanupWorkspace('wsp_never-registered' as WorkspaceRefId);
    expect(unknown.ok && unknown.value.value.outcome).toBe('cleanup_refused');
  });

  it('never force-removes a dirty worktree and preserves flagged workspaces', () => {
    const fixture = makeFixture();
    const { service, workspace } = prepare(fixture, serviceFor(fixture), { cleanupPolicy: 'manual_cleanup' });
    writeFileSync(join(workspace.workspacePath, 'src', 'app.js'), 'dirty\n');
    const failed = service.cleanupWorkspace(workspace.workspaceId, { authorizeRemoval: true });
    expect(failed.ok && failed.value.value.outcome).toBe('cleanup_failed');
    expect(existsSync(workspace.workspacePath)).toBe(true);

    const flaggedFixture = makeFixture();
    const flagged = prepare(flaggedFixture, serviceFor(flaggedFixture), { cleanupPolicy: 'preserve_on_checkpoint' });
    writeFileSync(join(flagged.workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    flagged.service.inspectWorkspace(flagged.workspace.workspaceId, POLICY);
    const kept = flagged.service.cleanupWorkspace(flagged.workspace.workspaceId, { authorizeRemoval: true });
    expect(kept.ok && kept.value.value.outcome).toBe('preserved');
    expect(existsSync(flagged.workspace.workspacePath)).toBe(true);
  });
});
