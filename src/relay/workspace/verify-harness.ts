import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectId, RunId, TaskId } from '../protocol/ids';
import { parseEvent } from '../protocol/envelopes';
import { createLocalWorkspaceService } from './index';
import { DEFAULT_WORKSPACE_COMMAND_POLICY } from './command-policy';
import type { WorkspaceCommandPolicy, WorkspacePolicyInput } from './contracts';

/**
 * Deterministic workspace verification harness (Prompt 7) — proves the
 * isolated-worktree foundation end to end against a TEMPORARY fixture
 * repository (never the real Sunday repository). The harness plays the
 * role of the future agent/user by writing files directly; Relay's job is
 * to detect and stop what policy forbids. All fixture material lives under
 * one tmp directory and is removed at the end.
 */

const FIXTURE_POLICY: WorkspacePolicyInput = {
  protectedPaths: { forbidden: ['secrets'], readOnly: ['README.md'] },
  claimedWritePaths: ['src'],
};

/** Harness command policy: adds `node -e` so timeout/cancel/output paths
 * can be exercised deterministically — explicitly approved configuration
 * for the fixture only, never a default. */
const HARNESS_COMMAND_POLICY: WorkspaceCommandPolicy = {
  ...DEFAULT_WORKSPACE_COMMAND_POLICY,
  rules: [
    { executable: 'node', description: 'fixture probes', allowedFirstArgs: ['--version', '-e'] },
    { executable: 'git', description: 'read-only repository inspection' },
  ],
};

export interface WorkspaceVerificationOutcome {
  lines: string[];
  failures: string[];
}

export async function runWorkspaceVerificationHarness(): Promise<WorkspaceVerificationOutcome> {
  const lines: string[] = ['RELAY WORKSPACE VERIFICATION (temporary fixture repository)'];
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    lines.push(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(name);
  };

  const tmpRoot = mkdtempSync(join(tmpdir(), 'relay-workspace-verify-'));
  try {
    /* 1–2. fixture repository with a safe baseline commit */
    const sourceDir = join(tmpRoot, 'fixture-repo');
    mkdirSync(sourceDir, { recursive: true });
    const fixtureGit = (args: string[]) =>
      execFileSync('git', args, {
        cwd: sourceDir, encoding: 'utf8', timeout: 15_000, windowsHide: true,
        env: { PATH: process.env.PATH ?? '', HOME: tmpRoot, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: join(tmpRoot, 'no-gitconfig'), GIT_CONFIG_SYSTEM: join(tmpRoot, 'no-gitconfig') },
      });
    fixtureGit(['init', '--initial-branch', 'fixture-main']);
    mkdirSync(join(sourceDir, 'src'));
    mkdirSync(join(sourceDir, 'secrets'));
    writeFileSync(join(sourceDir, 'README.md'), 'Fixture repository (read-only by policy).\n');
    writeFileSync(join(sourceDir, 'src', 'app.js'), 'module.exports = 1;\n');
    writeFileSync(join(sourceDir, 'secrets', 'prod.env'), 'placeholder-not-a-real-secret\n');
    fixtureGit(['add', '.']);
    fixtureGit(['-c', 'user.name=Relay Fixture', '-c', 'user.email=fixture@relay.invalid', 'commit', '-m', 'baseline']);
    const baselineRevision = fixtureGit(['rev-parse', 'HEAD']).trim();
    check('fixture repository created with baseline commit', /^[0-9a-f]{40}$/.test(baselineRevision));

    const service = createLocalWorkspaceService({
      workspaceRoot: join(tmpRoot, '.relay-workspaces'),
      commandPolicy: HARNESS_COMMAND_POLICY,
    });
    const idsOf = (token: string) => ({
      projectId: 'prj_wsverify' as ProjectId,
      runId: `run_wsv-${token}` as RunId,
      taskId: `tsk_wsv-${token}` as TaskId,
    });

    /* 3. isolated worktree */
    const main = idsOf('main');
    const prepared = service.prepareWorkspace({ ...main, sourceRepositoryPath: sourceDir, cleanupPolicy: 'preserve_on_checkpoint' });
    check('isolated worktree created', prepared.ok);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const workspace = prepared.value.value.workspace;
    check('revision pinned to baseline', workspace.sourceRevision === baselineRevision);
    check('run-specific branch created', workspace.branchName === 'relay/run/wsv-main');
    check('workspace confined to approved root', workspace.workspacePath.startsWith(join(tmpRoot, '.relay-workspaces')));

    const again = service.prepareWorkspace({ ...main, sourceRepositoryPath: sourceDir, cleanupPolicy: 'preserve_on_checkpoint' });
    check('idempotent reuse returns the same workspace', again.ok && again.value.value.idempotent && again.value.value.workspace.workspaceId === workspace.workspaceId);

    /* 4. source unchanged */
    const sourceCheck = service.verifySourceUnchanged(workspace.workspaceId);
    check('source repository unchanged after creation', sourceCheck.ok && !sourceCheck.value.value.changed);

    /* 5. approved command inside the worktree */
    const versionCmd = await service.executeCommand({
      commandId: 'wsv-cmd-version', ...main, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['--version'], expectedPurpose: 'runner proof',
    });
    check('approved command executed (node --version)', versionCmd.ok && versionCmd.value.value.status === 'completed' && versionCmd.value.value.exitCode === 0);

    const pushCmd = await service.executeCommand({
      commandId: 'wsv-cmd-push', ...main, workspaceId: workspace.workspaceId,
      executable: 'git', args: ['push', 'origin', 'HEAD'], expectedPurpose: 'must be rejected',
    });
    check('git push rejected by policy', pushCmd.ok && pushCmd.value.value.status === 'rejected');

    /* 6–7. allowed claimed change */
    writeFileSync(join(workspace.workspacePath, 'src', 'app.js'), 'module.exports = 2;\n');
    const allowedInspect = service.inspectWorkspace(workspace.workspaceId, FIXTURE_POLICY);
    check('claimed change detected as allowed', allowedInspect.ok && allowedInspect.value.value.assessment === 'allowed' && allowedInspect.value.value.claimedChanges.includes('src/app.js'));

    /* 8–9. protected change detected and stopped */
    writeFileSync(join(workspace.workspacePath, 'secrets', 'prod.env'), 'tampered\n');
    const protectedInspect = service.inspectWorkspace(workspace.workspaceId, FIXTURE_POLICY);
    check('protected change detected', protectedInspect.ok && protectedInspect.value.value.assessment === 'protected_change' && protectedInspect.value.value.protectedChanges.includes('secrets/prod.env'));
    check('automatic work stopped (checkpoint_required)', service.getWorkspace(workspace.workspaceId)?.status === 'checkpoint_required');
    const blockedCmd = await service.executeCommand({
      commandId: 'wsv-cmd-blocked', ...main, workspaceId: workspace.workspaceId,
      executable: 'node', args: ['--version'], expectedPurpose: 'must be stopped at checkpoint',
    });
    check('no execution while stopped', blockedCmd.ok && blockedCmd.value.value.status === 'rejected');

    /* 10. timeout + cancellation on a second, clean workspace */
    const aux = idsOf('aux');
    const auxPrepared = service.prepareWorkspace({ ...aux, sourceRepositoryPath: sourceDir, cleanupPolicy: 'manual_cleanup' });
    check('second workspace created for runner proofs', auxPrepared.ok);
    if (auxPrepared.ok) {
      const auxWs = auxPrepared.value.value.workspace;
      const slowScript = 'setTimeout(function(){}, 30000)';
      const timedOut = await service.executeCommand({
        commandId: 'wsv-cmd-timeout', ...aux, workspaceId: auxWs.workspaceId,
        executable: 'node', args: ['-e', slowScript], timeoutMs: 500, expectedPurpose: 'timeout proof',
      });
      check('timeout enforced and terminated', timedOut.ok && timedOut.value.value.status === 'timed_out' && timedOut.value.value.termination === 'termination_confirmed');

      const cancelPromise = service.executeCommand({
        commandId: 'wsv-cmd-cancel', ...aux, workspaceId: auxWs.workspaceId,
        executable: 'node', args: ['-e', slowScript], timeoutMs: 30_000, expectedPurpose: 'cancellation proof',
      });
      setTimeout(() => service.cancelCommand('wsv-cmd-cancel'), 150);
      const cancelled = await cancelPromise;
      check('cancellation terminated the process', cancelled.ok && cancelled.value.value.status === 'cancelled' && cancelled.value.value.termination === 'termination_confirmed');

      const noisy = await service.executeCommand({
        commandId: 'wsv-cmd-noisy', ...aux, workspaceId: auxWs.workspaceId,
        executable: 'node', args: ['-e', "process.stdout.write('x'.repeat(100000))"], outputLimitBytes: 4096, expectedPurpose: 'output bound proof',
      });
      check('output limit enforced', noisy.ok && (noisy.value.value.status === 'output_limit' || noisy.value.value.truncated));

      const secretEcho = await service.executeCommand({
        commandId: 'wsv-cmd-secret', ...aux, workspaceId: auxWs.workspaceId,
        executable: 'node', args: ['-e', "console.log('sk-' + 'FAKEVERIFY1234567890')"], expectedPurpose: 'sanitizer proof',
      });
      check('secret-shaped output sanitized', secretEcho.ok && !secretEcho.value.value.stdout.includes('sk-FAKEVERIFY') && secretEcho.value.value.stdout.includes('[REDACTED'));

      /* 11. cleanup: clean workspace removable only with authorization */
      const unauthorized = service.cleanupWorkspace(auxWs.workspaceId);
      check('cleanup without authorization preserves', unauthorized.ok && unauthorized.value.value.outcome === 'preserved');
      const authorized = service.cleanupWorkspace(auxWs.workspaceId, { authorizeRemoval: true });
      check('authorized cleanup removes the aux worktree', authorized.ok && authorized.value.value.outcome === 'cleanup_complete');
    }

    /* symlink escape proof on the flagged main workspace */
    symlinkSync(join(tmpRoot, 'outside-target'), join(workspace.workspacePath, 'src', 'escape-link'));
    const symlinkInspect = service.inspectWorkspace(workspace.workspaceId, FIXTURE_POLICY);
    check('symlink escape detected', symlinkInspect.ok && symlinkInspect.value.value.assessment === 'symlink_escape');

    /* 11. flagged workspace preserved per policy */
    const preserved = service.cleanupWorkspace(workspace.workspaceId, { authorizeRemoval: true });
    check('flagged workspace preserved for inspection', preserved.ok && preserved.value.value.outcome === 'preserved');
    const unknownCleanup = service.cleanupWorkspace('wsp_unknown-fixture' as never);
    check('unknown workspace cleanup refused', unknownCleanup.ok && unknownCleanup.value.value.outcome === 'cleanup_refused');

    /* 12. source repository still untouched; events/evidence valid */
    const finalRevision = fixtureGit(['rev-parse', 'HEAD']).trim();
    const finalStatus = fixtureGit(['status', '--porcelain']).trim();
    check('source revision unchanged end-to-end', finalRevision === baselineRevision);
    check('source working tree unchanged end-to-end', finalStatus === '');
    check('source README intact', readFileSync(join(sourceDir, 'README.md'), 'utf8').includes('Fixture repository'));

    const events = service.collectEvents();
    const parsedOk = events.every((draft, i) => parseEvent({ ...draft, eventId: `evt_wsv${String(i + 1).padStart(4, '0')}`, sequence: i + 1 }).ok);
    check('all workspace events are protocol-valid', events.length > 0 && parsedOk);
    const evidence = service.collectEvidence();
    check('all workspace evidence is live-local provenance', evidence.length > 0 && evidence.every((e) => e.provenance === 'live' && e.verifier === 'relay-workspace'));
    const serialized = JSON.stringify({ events, evidence });
    check('no secret-shaped content in events or evidence', !/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/.test(serialized));
    check('no provider environment consumed', !process.env.RELAY_TEST_FAKE_PROVIDER_CALL);
  } catch (err) {
    check('harness completed without unexpected errors', false, err instanceof Error ? err.message : String(err));
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  lines.push('', failures.length === 0
    ? 'WORKSPACE VERIFICATION PASSED — isolated worktree foundation is enforced.'
    : `WORKSPACE VERIFICATION FAILED: ${failures.length} check(s): ${failures.join('; ')}`);
  return { lines, failures };
}
