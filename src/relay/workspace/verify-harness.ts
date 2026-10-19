import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectId, RunId, TaskId } from '../protocol/ids';
import { createWorkspaceService } from './index';
import type { WorkspacePolicyInput } from './contracts';
import { DEFAULT_WORKSPACE_COMMAND_POLICY } from './command-policy';

/**
 * Deterministic workspace verification harness (Prompt 7) — proves the
 * isolated-worktree foundation end to end against a THROWAWAY fixture
 * repository under the OS temp dir (never the real Sunday repository).
 * Every fixture path is created here and removed at the end; the harness
 * asserts the source repo stays untouched throughout.
 */

export interface VerificationCheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const FIXTURE_ENV = {
  GIT_AUTHOR_NAME: 'Relay Fixture', GIT_AUTHOR_EMAIL: 'fixture@relay.local',
  GIT_COMMITTER_NAME: 'Relay Fixture', GIT_COMMITTER_EMAIL: 'fixture@relay.local',
  GIT_TERMINAL_PROMPT: '0',
};

const fixtureGit = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: 15_000,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...FIXTURE_ENV },
  });

export async function runWorkspaceVerification(): Promise<{ checks: VerificationCheckResult[]; failures: number }> {
  const checks: VerificationCheckResult[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'relay-wsverify-'));
  const sourceRepo = join(fixtureRoot, 'source');

  try {
    /* 1–2. fixture repository with a safe baseline */
    mkdirSync(join(sourceRepo, 'src'), { recursive: true });
    mkdirSync(join(sourceRepo, 'secrets'), { recursive: true });
    fixtureGit(['init', '-q', '-b', 'main'], sourceRepo);
    writeFileSync(join(sourceRepo, 'README.md'), 'fixture baseline\n');
    writeFileSync(join(sourceRepo, 'src', 'app.txt'), 'claimed content v1\n');
    writeFileSync(join(sourceRepo, 'secrets', 'prod.env'), 'placeholder=not-a-real-secret\n');
    fixtureGit(['add', '.'], sourceRepo);
    fixtureGit(['commit', '-q', '-m', 'baseline'], sourceRepo);
    const baselineRevision = fixtureGit(['rev-parse', 'HEAD'], sourceRepo).trim();
    check('fixture repository created with baseline commit', /^[0-9a-f]{40}$/.test(baselineRevision));

    const service = createWorkspaceService({
      commandPolicy: {
        ...DEFAULT_WORKSPACE_COMMAND_POLICY,
        rules: [
          ...DEFAULT_WORKSPACE_COMMAND_POLICY.rules.filter((r) => r.executable !== 'node'),
          // harness-approved configuration: -e runs HARNESS-authored code
          { executable: 'node', description: 'harness checks', allowedFirstArgs: ['--version', '-e'] },
        ],
      },
    });

    const policy: WorkspacePolicyInput = {
      protectedPaths: { forbidden: ['secrets'], readOnly: ['README.md'] },
      claimedWritePaths: ['src/app.txt'],
    };
    const identity = {
      projectId: 'prj_wsverify' as ProjectId,
      runId: 'run_wsverify1' as RunId,
      taskId: 'tsk_wsverify1' as TaskId,
      sourceRepositoryPath: sourceRepo,
    };

    /* 3. isolated worktree */
    const prepared = service.prepareWorkspace(identity);
    check('isolated worktree created', prepared.ok, prepared.ok ? prepared.value.value.workspace.branchName : prepared.error.message);
    if (!prepared.ok) throw new Error('cannot continue without a workspace');
    const workspace = prepared.value.value.workspace;
    check('workspace pinned to the baseline revision', workspace.sourceRevision === baselineRevision);
    check('workspace path is outside the source repository', !workspace.workspacePath.startsWith(sourceRepo));

    const reprepared = service.prepareWorkspace(identity);
    check('idempotent re-preparation returns the same workspace',
      reprepared.ok && reprepared.value.value.idempotent && reprepared.value.value.workspace.workspaceId === workspace.workspaceId);

    /* 4. source unchanged */
    const sourceCheck = service.verifySourceUnchanged(workspace.workspaceId);
    check('source repository unchanged after creation', sourceCheck.ok && !sourceCheck.value.value.changed);

    /* 5. approved command inside the worktree */
    const versionRun = await service.executeCommand({
      commandId: 'wsv-node-version', ...identity, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['--version'], expectedPurpose: 'runner proof',
    });
    check('approved command executed with exit 0',
      versionRun.ok && versionRun.value.value.status === 'completed' && versionRun.value.value.exitCode === 0,
      versionRun.ok ? versionRun.value.value.stdout.trim() : versionRun.error.message);

    const pushAttempt = await service.executeCommand({
      commandId: 'wsv-git-push', ...identity, workspaceId: workspace.workspaceId,
      executable: 'git', args: ['push'], expectedPurpose: 'must be rejected',
    });
    check('git push rejected by policy', pushAttempt.ok && pushAttempt.value.value.status === 'rejected');
    const shellAttempt = await service.executeCommand({
      commandId: 'wsv-bash', ...identity, workspaceId: workspace.workspaceId,
      executable: 'bash', args: ['-c', 'true'], expectedPurpose: 'must be rejected',
    });
    check('shell execution rejected by policy', shellAttempt.ok && shellAttempt.value.value.status === 'rejected');

    /* 6–7. allowed claimed change */
    writeFileSync(join(workspace.workspacePath, 'src', 'app.txt'), 'claimed content v2\n');
    const allowedInspection = service.inspectWorkspace(workspace.workspaceId, policy);
    check('claimed modification detected as allowed',
      allowedInspection.ok && allowedInspection.value.value.assessment === 'allowed' &&
      allowedInspection.value.value.claimedChanges.includes('src/app.txt'));

    /* 8–9. protected modification stops work */
    writeFileSync(join(workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    const flaggedInspection = service.inspectWorkspace(workspace.workspaceId, policy);
    check('protected modification detected and flagged',
      flaggedInspection.ok && flaggedInspection.value.value.assessment === 'protected_change' &&
      flaggedInspection.value.value.protectedChanges.includes('secrets/prod.env'));
    check('workspace stopped at checkpoint after protected change',
      service.getWorkspace(workspace.workspaceId)?.status === 'checkpoint_required');

    /* 10. timeout + cancellation */
    const timeoutRun = await service.executeCommand({
      commandId: 'wsv-timeout', ...identity, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['-e', 'setInterval(function keepAlive() {}, 1000)'],
      timeoutMs: 500, expectedPurpose: 'timeout proof',
    });
    check('runaway command timed out with confirmed termination',
      timeoutRun.ok && timeoutRun.value.value.status === 'timed_out' &&
      timeoutRun.value.value.termination === 'termination_confirmed');

    const cancelPromise = service.executeCommand({
      commandId: 'wsv-cancel', ...identity, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['-e', 'setInterval(function keepAlive() {}, 1000)'],
      timeoutMs: 30_000, expectedPurpose: 'cancellation proof',
    });
    await new Promise((r) => setTimeout(r, 300));
    const cancelIssued = service.cancelCommand('wsv-cancel');
    const cancelledRun = await cancelPromise;
    check('running command cancelled on request',
      cancelIssued && cancelledRun.ok && cancelledRun.value.value.cancelled &&
      cancelledRun.value.value.status === 'cancelled');

    /* 11. preservation per policy (checkpoint state + preserve_on_failure) */
    const preservation = service.cleanupWorkspace(workspace.workspaceId, { authorizeRemoval: true });
    check('checkpoint workspace preserved despite authorized cleanup',
      preservation.ok && preservation.value.value.outcome === 'preserved');

    /* removal path proven on a second, clean workspace */
    const second = service.prepareWorkspace({ ...identity, runId: 'run_wsverify2' as RunId, taskId: 'tsk_wsverify2' as TaskId });
    check('second isolated workspace created', second.ok);
    if (second.ok) {
      const removal = service.cleanupWorkspace(second.value.value.workspace.workspaceId, { authorizeRemoval: true });
      check('authorized cleanup removed the clean workspace',
        removal.ok && removal.value.value.outcome === 'cleanup_complete' &&
        !existsSync(second.value.value.workspace.workspacePath));
      const unauthorized = service.cleanupWorkspace(second.value.value.workspace.workspaceId, { authorizeRemoval: true });
      check('already-removed workspace cannot be cleaned twice',
        unauthorized.ok && unauthorized.value.value.outcome === 'cleanup_refused');
    }

    /* 12. source stayed pristine through everything */
    const finalStatus = fixtureGit(['status', '--porcelain'], sourceRepo);
    const finalRevision = fixtureGit(['rev-parse', 'HEAD'], sourceRepo).trim();
    check('no outside files changed (source clean at pinned revision)',
      finalStatus.trim() === '' && finalRevision === baselineRevision);

    /* evidence integrity */
    const evidence = service.collectEvidence();
    check('workspace evidence carries live provenance and association',
      evidence.length >= 8 && evidence.every((e) => e.provenance === 'live' && e.verifier === 'relay-workspace' && e.runId && e.taskId));
    const serialized = JSON.stringify({ evidence, events: service.collectEvents() });
    check('no secret-shaped content in evidence or events',
      !/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/.test(serialized));
  } catch (error) {
    check('harness completed', false, error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
  checks.push({
    name: 'fixture repositories and worktrees removed',
    ok: !existsSync(fixtureRoot),
  });

  return { checks, failures: checks.filter((c) => !c.ok).length };
}
