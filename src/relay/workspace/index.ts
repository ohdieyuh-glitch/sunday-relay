import { lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { EvidenceRecord } from '../protocol/contracts';
import { createRandomIdFactory, type IdFactory, type WorkspaceRefId } from '../protocol/ids';
import type { EventDraft } from '../protocol/envelopes';
import type {
  CleanupResult, PrepareWorkspaceRequest, RelayWorkspace, SourceInspection,
  WorkspaceCommandResult, WorkspaceInspection,
  WorkspaceOperationOutput, WorkspaceService,
} from './contracts';
import {
  inspectRepositoryState, listWorktreeChanges, validateSourceRepository,
} from './repository-inspector';
import {
  createWorktree, deriveRunBranch, removeWorktree, resolveWorkspacePath,
  resolveWorkspaceRoot, validateBranchName,
} from './worktree-manager';
import { classifyChangedPath, normalizePolicy, withBaselineProtection } from './protected-paths';
import {
  buildChildEnvironment, DEFAULT_WORKSPACE_COMMAND_POLICY, evaluateCommandRequest,
} from './command-policy';
import { runBoundedCommand, type RunningCommandHandle } from './command-runner';
import { makeWorkspaceEvent, makeWorkspaceEvidence, WORKSPACE_VERIFIER } from './workspace-evidence';
import { evaluateCleanup } from './cleanup';
import type { WorkspaceCommandPolicy } from './contracts';

export * from './contracts';
export { DEFAULT_WORKSPACE_COMMAND_POLICY } from './command-policy';
export { workspaceDoctorReport } from './doctor';
/* Mission-scoped worktrees — exported from the FACADE because the CLI may
   import this module and nothing deeper inside the workspace tree. */
export {
  MISSION_WORKTREE_DIRNAME, assertNotPrimaryCheckout, evaluateWorktreeCleanup,
  openMissionWorktree, removeMissionWorktree, resolveMissionWorktreePath,
  validateMissionWorktree,
} from './mission-worktree';
export type {
  OpenMissionWorktreeInput, OpenMissionWorktreeOutput,
  ValidateMissionWorktreeInput, WorktreeCleanupAssessment,
} from './mission-worktree';
export { runWorkspaceVerification } from './verify-harness';

/**
 * Workspace composition root (Prompt 7) — the ONLY place Relay composes
 * Node process/filesystem operations behind the provider-neutral ports.
 * Everything it does is recorded as live-local evidence and normalized
 * events. It never touches the source worktree, never uses a shell, and
 * never runs a provider or coding agent.
 */

interface WorkspaceInternal {
  workspace: RelayWorkspace;
  sourceStateAtPin: { revision: string; branch: string; dirty: boolean };
}

export interface CreateWorkspaceServiceOptions {
  ids?: IdFactory;
  now?: () => string;
  commandPolicy?: WorkspaceCommandPolicy;
}

export function createWorkspaceService(options: CreateWorkspaceServiceOptions = {}): WorkspaceService {
  const ids = options.ids ?? createRandomIdFactory();
  const now = options.now ?? (() => new Date().toISOString());
  const commandPolicy = options.commandPolicy ?? DEFAULT_WORKSPACE_COMMAND_POLICY;

  const registry = new Map<string, WorkspaceInternal>();
  const byRequestKey = new Map<string, WorkspaceRefId>();
  const byBranch = new Map<string, WorkspaceRefId>();
  const runningCommands = new Map<string, RunningCommandHandle>();
  const allEvidence: EvidenceRecord[] = [];
  const allEvents: EventDraft[] = [];

  const record = (events: EventDraft[], evidence: EvidenceRecord[]) => {
    allEvents.push(...events);
    allEvidence.push(...evidence);
  };

  const output = <T>(value: T, events: EventDraft[], evidence: EvidenceRecord[]): WorkspaceOperationOutput<T> => {
    record(events, evidence);
    return { value, events, evidence };
  };

  const getInternal = (workspaceId: WorkspaceRefId): WorkspaceInternal | null =>
    registry.get(workspaceId) ?? null;

  const requestKey = (r: PrepareWorkspaceRequest, sourceRoot: string) =>
    `${r.projectId}|${r.runId}|${r.taskId}|${sourceRoot}`;

  return {
    /* ------------------------- preparation ------------------------- */
    prepareWorkspace(request) {
      const source = validateSourceRepository(request.sourceRepositoryPath);
      if (!source.ok) return source;
      const sourceRoot = source.value.root;

      /* idempotency: the same valid request returns the same workspace */
      const key = requestKey(request, sourceRoot);
      const existingId = byRequestKey.get(key);
      if (existingId) {
        const existing = getInternal(existingId)!;
        const event = makeWorkspaceEvent(existing.workspace, now(), 'workspace.reused',
          'Workspace request repeated — returning the registered workspace (idempotent).');
        return ok(output({ workspace: { ...existing.workspace }, idempotent: true }, [event], []));
      }

      const pinned = inspectRepositoryState(sourceRoot);
      if (!pinned.ok) return pinned;

      const branch = request.branchName !== undefined
        ? validateBranchName(request.branchName)
        : deriveRunBranch(request.runId);
      if (!branch.ok) return branch;

      /* conflicting reuse: a branch registered to a different run fails */
      const branchOwner = byBranch.get(`${sourceRoot}|${branch.value}`);
      if (branchOwner) {
        return fail(relayError('duplicate-command',
          `Branch ${branch.value} is registered to another active workspace — conflicting reuse refused.`));
      }

      const root = resolveWorkspaceRoot(sourceRoot);
      if (!root.ok) return root;
      const path = resolveWorkspacePath(root.value, request.projectId, request.runId);
      if (!path.ok) return path;

      const created = createWorktree({
        sourceRoot, workspacePath: path.value, branchName: branch.value, revision: pinned.value.revision,
      });
      if (!created.ok) return created;

      /* source must be untouched by creation */
      const after = inspectRepositoryState(sourceRoot);
      if (!after.ok) return after;
      const sourceUntouched = after.value.revision === pinned.value.revision &&
        after.value.branch === pinned.value.branch;

      const at = now();
      const workspace: RelayWorkspace = {
        workspaceId: ids.next('wsp'),
        projectId: request.projectId,
        runId: request.runId,
        taskId: request.taskId,
        sourceRepositoryPath: sourceRoot,
        sourceRevision: pinned.value.revision,
        baseBranch: pinned.value.branch,
        sourceDirtyAtPin: pinned.value.dirty,
        workspacePath: created.value.workspacePath,
        branchName: created.value.branchName,
        status: 'ready',
        createdAt: at,
        cleanupPolicy: request.cleanupPolicy ?? 'preserve_on_failure',
        provenance: 'live',
      };
      const internal: WorkspaceInternal = {
        workspace,
        sourceStateAtPin: { revision: pinned.value.revision, branch: pinned.value.branch, dirty: pinned.value.dirty },
      };
      registry.set(workspace.workspaceId, internal);
      byRequestKey.set(key, workspace.workspaceId);
      byBranch.set(`${sourceRoot}|${branch.value}`, workspace.workspaceId);

      const events = [
        makeWorkspaceEvent(workspace, at, 'workspace.validated',
          `Source repository validated; revision pinned at ${pinned.value.revision.slice(0, 12)} on ${pinned.value.branch}.`),
        makeWorkspaceEvent(workspace, at, 'workspace.created',
          `Isolated worktree created on branch ${branch.value} (live local infrastructure).`),
      ];
      const evidence = [
        makeWorkspaceEvidence({
          ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
          label: 'source-revision-pinned', status: 'passed',
          excerpt: `revision ${pinned.value.revision} pinned from branch ${pinned.value.branch}; source dirty=${pinned.value.dirty}`,
          sourceRevision: pinned.value.revision,
        }),
        makeWorkspaceEvidence({
          ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
          label: 'worktree-created', status: 'passed',
          excerpt: `branch ${branch.value} at ${created.value.revision.slice(0, 12)}; path verified under the approved workspace root`,
          sourceRevision: pinned.value.revision,
        }),
        makeWorkspaceEvidence({
          ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
          label: 'source-worktree-untouched', status: sourceUntouched ? 'passed' : 'failed',
          excerpt: sourceUntouched
            ? 'source revision and branch unchanged by worktree creation'
            : 'source repository state changed during creation — investigate before continuing',
          sourceRevision: pinned.value.revision,
        }),
      ];
      return ok(output({ workspace: { ...workspace }, idempotent: false }, events, evidence));
    },

    getWorkspace(workspaceId) {
      const internal = getInternal(workspaceId);
      return internal ? { ...internal.workspace } : null;
    },

    listWorkspaces() {
      return [...registry.values()].map((w) => ({ ...w.workspace }));
    },

    /* -------------------------- inspection ------------------------- */
    inspectWorkspace(workspaceId, policyInput) {
      const internal = getInternal(workspaceId);
      if (!internal) return fail(relayError('not-found', 'Workspace is not registered.'));
      const { workspace } = internal;

      const normalized = normalizePolicy({
        protectedPaths: withBaselineProtection(policyInput.protectedPaths),
        claimedWritePaths: policyInput.claimedWritePaths,
      });
      if (!normalized.ok) {
        return fail(relayError('validation-failed', 'Workspace policy input is invalid.', { details: normalized.errors }));
      }

      const changes = listWorktreeChanges(workspace.workspacePath);
      if (!changes.ok) return changes;
      const revision = inspectRepositoryState(workspace.workspacePath);
      if (!revision.ok) return revision;

      const claimed: string[] = [];
      const unclaimed: string[] = [];
      const protectedChanges: string[] = [];
      const symlinkEscapes: string[] = [];
      const workspaceReal = realpathSync(workspace.workspacePath);

      const allPaths = [...changes.value.changed, ...changes.value.untracked];
      for (const raw of allPaths) {
        const { path, classification } = classifyChangedPath(raw, normalized.policy);
        /* symlink escape: a changed path that is a symlink resolving
         * outside the workspace is worse than any classification */
        try {
          const absolute = join(workspaceReal, path);
          if (lstatSync(absolute).isSymbolicLink()) {
            const target = realpathSync(absolute);
            if (target !== workspaceReal && !target.startsWith(workspaceReal + sep)) {
              symlinkEscapes.push(path);
              continue;
            }
          }
        } catch { /* deleted paths cannot escape */ }
        if (classification === 'protected' || classification === 'invalid') protectedChanges.push(path);
        else if (classification === 'claimed') claimed.push(path);
        else unclaimed.push(path);
      }

      const assessment: WorkspaceInspection['assessment'] =
        symlinkEscapes.length > 0 ? 'symlink_escape'
          : protectedChanges.length > 0 ? 'protected_change'
            : unclaimed.length > 0 ? 'unclaimed_change'
              : claimed.length > 0 ? 'allowed'
                : 'clean';

      const at = now();
      const inspection: WorkspaceInspection = {
        workspaceId: workspace.workspaceId,
        revision: revision.value.revision,
        branch: revision.value.branch,
        clean: allPaths.length === 0,
        changedFiles: changes.value.changed,
        untrackedFiles: changes.value.untracked,
        claimedChanges: claimed,
        unclaimedChanges: unclaimed,
        protectedChanges,
        symlinkEscapes,
        conflictState: changes.value.conflicted ? 'merge-conflict' : 'none',
        assessment,
        inspectedAt: at,
      };

      /* a bad change stops automatic work: dirty + flagged, never silent,
       * and the task's claims are NEVER expanded to match */
      workspace.lastInspectedAt = at;
      if (assessment === 'symlink_escape' || assessment === 'protected_change') {
        workspace.status = 'checkpoint_required';
      } else if (assessment === 'unclaimed_change') {
        workspace.status = 'dirty';
      } else if (workspace.status === 'ready' || workspace.status === 'dirty') {
        workspace.status = assessment === 'clean' ? workspace.status : 'active';
      }

      const events = [
        makeWorkspaceEvent(workspace, at, 'workspace.inspected',
          `Workspace inspected: ${assessment} (${allPaths.length} changed path(s)).`,
          { assessment, changed: allPaths.length }),
      ];
      if (assessment !== 'clean' && assessment !== 'allowed') {
        events.push(makeWorkspaceEvent(workspace, at, 'workspace.change_flagged',
          assessment === 'protected_change'
            ? 'A protected path changed — automatic work stops; claims are not expanded.'
            : assessment === 'symlink_escape'
              ? 'A symlink escaping the workspace was found — automatic work stops.'
              : 'An unclaimed path changed — flagged for review; claims are not expanded.',
          { assessment }));
      }
      const evidence = [
        makeWorkspaceEvidence({
          ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
          label: 'workspace-diff-inspection', evidenceType: 'diff',
          status: assessment === 'clean' || assessment === 'allowed' ? 'passed' : 'failed',
          excerpt: `assessment=${assessment}; claimed=${claimed.length} unclaimed=${unclaimed.length} protected=${protectedChanges.length} symlink-escapes=${symlinkEscapes.length}`,
          sourceRevision: workspace.sourceRevision,
        }),
      ];
      return ok(output(inspection, events, evidence));
    },

    verifySourceUnchanged(workspaceId) {
      const internal = getInternal(workspaceId);
      if (!internal) return fail(relayError('not-found', 'Workspace is not registered.'));
      const { workspace, sourceStateAtPin } = internal;
      const state = inspectRepositoryState(workspace.sourceRepositoryPath);
      if (!state.ok) return state;
      const at = now();
      const changed = state.value.revision !== sourceStateAtPin.revision ||
        state.value.branch !== sourceStateAtPin.branch;
      const inspection: SourceInspection = {
        revision: state.value.revision,
        branch: state.value.branch,
        dirty: state.value.dirty,
        changed,
        inspectedAt: at,
      };
      const events: EventDraft[] = [];
      if (changed) {
        /* never silently continue on a moved source */
        workspace.status = 'checkpoint_required';
        events.push(makeWorkspaceEvent(workspace, at, 'workspace.source_changed',
          'Source repository changed since the revision was pinned — revalidation required before continuing.'));
      }
      const evidence = [
        makeWorkspaceEvidence({
          ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
          label: 'source-unchanged-check', status: changed ? 'failed' : 'passed',
          excerpt: changed
            ? `source moved from ${sourceStateAtPin.revision.slice(0, 12)} to ${state.value.revision.slice(0, 12)}`
            : `source still at pinned ${sourceStateAtPin.revision.slice(0, 12)} on ${sourceStateAtPin.branch}`,
          sourceRevision: workspace.sourceRevision,
        }),
      ];
      return ok(output(inspection, events, evidence));
    },

    /* ------------------------ command execution -------------------- */
    async executeCommand(request) {
      const internal = getInternal(request.workspaceId);
      if (!internal) return fail(relayError('not-found', 'Workspace is not registered.'));
      const { workspace } = internal;
      const at = now();

      const finish = (result: WorkspaceCommandResult, events: EventDraft[], evidence: EvidenceRecord[]) =>
        ok(output(result, events, evidence));

      const approval = evaluateCommandRequest(commandPolicy, request);
      const baseResult: Omit<WorkspaceCommandResult, 'status' | 'rejectionReasons'> = {
        commandId: request.commandId,
        workspaceId: request.workspaceId,
        executableLabel: request.executable,
        redactedArgs: request.args.map((a) => (a.length > 80 ? `${a.slice(0, 77)}…` : a)),
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        startedAt: at,
        completedAt: at,
        durationMs: 0,
        timedOut: false,
        cancelled: false,
        truncated: false,
        termination: 'not_required',
        grantedEnvironmentKeys: approval.grantedEnvironmentKeys,
        provenance: 'live',
        enforcement: 'enforced',
        evidenceRefs: [],
      };

      if (!approval.approved) {
        const rejected: WorkspaceCommandResult = { ...baseResult, status: 'rejected', rejectionReasons: approval.reasons };
        const events = [
          makeWorkspaceEvent(workspace, at, 'workspace.command_rejected',
            `Command rejected by policy: ${request.executable} (${approval.reasons.length} reason(s)).`,
            { reasons: approval.reasons.slice(0, 5) }),
        ];
        const evidence = [
          makeWorkspaceEvidence({
            ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
            label: 'command-rejected', status: 'failed', evidenceType: 'command',
            command: `${request.executable} ${request.args.join(' ')}`.slice(0, 200),
            excerpt: approval.reasons.join('; ').slice(0, 500),
            sourceRevision: workspace.sourceRevision,
          }),
        ];
        rejected.evidenceRefs = evidence.map((e) => e.evidenceId);
        return finish(rejected, events, evidence);
      }

      /* validated working directory: inside the workspace, no escapes */
      let cwd = realpathSync(workspace.workspacePath);
      if (request.relativeWorkingDirectory) {
        const target = join(cwd, request.relativeWorkingDirectory);
        let real: string;
        try {
          real = realpathSync(target);
        } catch {
          return fail(relayError('validation-failed', 'Working directory does not exist inside the workspace.'));
        }
        if (real !== cwd && !real.startsWith(cwd + sep)) {
          return fail(relayError('permission-denied', 'Working directory escapes the workspace — refused.'));
        }
        cwd = real;
      }

      record([
        makeWorkspaceEvent(workspace, at, 'workspace.command_started',
          `Approved command started: ${request.executable} (purpose: ${request.expectedPurpose.slice(0, 80)}).`),
      ], []);

      const run = await runBoundedCommand(
        {
          executable: request.executable,
          args: request.args,
          cwd,
          env: buildChildEnvironment(process.env, approval.grantedEnvironmentKeys),
          timeoutMs: approval.timeoutMs,
          outputLimitBytes: approval.outputLimitBytes,
        },
        now,
        (handle) => runningCommands.set(request.commandId, handle),
      );
      runningCommands.delete(request.commandId);

      const status: WorkspaceCommandResult['status'] = run.cancelled
        ? 'cancelled'
        : run.timedOut
          ? 'timed_out'
          : run.outputLimitHit
            ? 'output_limit'
            : run.exitCode === 0
              ? 'completed'
              : 'failed';

      const result: WorkspaceCommandResult = {
        ...baseResult,
        status,
        exitCode: run.exitCode,
        signal: run.signal,
        stdout: run.stdout,
        stderr: run.stderr,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        timedOut: run.timedOut,
        cancelled: run.cancelled,
        truncated: run.truncated,
        termination: run.termination,
        ...(run.spawnError ? { rejectionReasons: [run.spawnError] } : {}),
      };
      const completedAt = now();
      const events = [
        makeWorkspaceEvent(workspace, completedAt,
          run.cancelled ? 'workspace.cancelled' : 'workspace.command_completed',
          run.cancelled
            ? `Command cancelled (${result.termination.replace(/_/g, ' ')}).`
            : `Command ${status}: ${request.executable} exit=${run.exitCode ?? '-'} in ${run.durationMs}ms.`,
          { status, exitCode: run.exitCode, timedOut: run.timedOut }),
      ];
      const evidence = [
        makeWorkspaceEvidence({
          ids, now: completedAt, runId: workspace.runId, taskId: workspace.taskId,
          label: 'command-result', evidenceType: 'command',
          status: status === 'completed' ? 'passed' : 'failed',
          command: `${request.executable} ${request.args.join(' ')}`.slice(0, 200),
          exitCode: run.exitCode ?? undefined,
          excerpt: `status=${status} exit=${run.exitCode ?? '-'} signal=${run.signal ?? '-'} timedOut=${run.timedOut} cancelled=${run.cancelled} truncated=${run.truncated} termination=${result.termination}`,
          sourceRevision: workspace.sourceRevision,
        }),
      ];
      result.evidenceRefs = evidence.map((e) => e.evidenceId);
      if (status !== 'completed' && workspace.status === 'ready') workspace.status = 'active';
      return finish(result, events, evidence);
    },

    cancelCommand(commandId) {
      const handle = runningCommands.get(commandId);
      if (!handle) return false;
      return handle.cancel();
    },

    /* ---------------------------- cleanup --------------------------- */
    cleanupWorkspace(workspaceId, options = {}) {
      const internal = getInternal(workspaceId);
      if (!internal) return fail(relayError('not-found', 'Unknown workspace — cleanup refused.'));
      const { workspace } = internal;
      const at = now();

      const refusal = (detail: string): RelayResult<WorkspaceOperationOutput<CleanupResult>> => {
        const result: CleanupResult = { workspaceId, outcome: 'cleanup_refused', detail, at };
        const events = [makeWorkspaceEvent(workspace, at, 'workspace.cleanup_refused', `Cleanup refused: ${detail}`)];
        return ok(output(result, events, []));
      };

      /* identity checks before anything destructive */
      if (workspace.workspacePath === workspace.sourceRepositoryPath) {
        return refusal('workspace path equals the source worktree.');
      }
      const root = resolveWorkspaceRoot(workspace.sourceRepositoryPath);
      if (!root.ok) return root;
      if (!workspace.workspacePath.startsWith(root.value + sep)) {
        return refusal('workspace path is outside the approved Relay workspace root.');
      }
      for (const other of registry.values()) {
        if (other.workspace.workspaceId !== workspaceId &&
            other.workspace.workspacePath === workspace.workspacePath &&
            other.workspace.status !== 'removed') {
          return refusal('another registered workspace uses this path.');
        }
      }

      const decision = evaluateCleanup(workspace, { authorizeRemoval: options.authorizeRemoval === true });
      if (decision.action === 'refuse') return refusal(decision.reason);
      if (decision.action === 'preserve') {
        workspace.status = 'preserved';
        const result: CleanupResult = { workspaceId, outcome: 'preserved', detail: decision.reason, at };
        const events = [makeWorkspaceEvent(workspace, at, 'workspace.preserved', `Workspace preserved: ${decision.reason}`)];
        const evidence = [
          makeWorkspaceEvidence({
            ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
            label: 'cleanup-decision', status: 'passed',
            excerpt: `preserved — ${decision.reason}`,
            sourceRevision: workspace.sourceRevision,
          }),
        ];
        return ok(output(result, events, evidence));
      }

      const removed = removeWorktree(workspace.sourceRepositoryPath, workspace.workspacePath);
      const outcome: CleanupResult = removed.ok
        ? { workspaceId, outcome: 'cleanup_complete', detail: decision.reason, at }
        : { workspaceId, outcome: 'cleanup_failed', detail: removed.error.message, at };
      workspace.status = removed.ok ? 'removed' : workspace.status;
      const events = [
        makeWorkspaceEvent(workspace, at, removed.ok ? 'workspace.cleaned' : 'workspace.cleanup_refused',
          removed.ok ? 'Relay-created worktree removed after verification.' : `Cleanup failed: ${removed.error.message}`),
      ];
      const evidence = [
        makeWorkspaceEvidence({
          ids, now: at, runId: workspace.runId, taskId: workspace.taskId,
          label: 'cleanup-result', status: removed.ok ? 'passed' : 'failed',
          excerpt: removed.ok ? 'worktree removed; path verified gone' : removed.error.message,
          sourceRevision: workspace.sourceRevision,
        }),
      ];
      return ok(output(outcome, events, evidence));
    },

    collectEvidence: () => [...allEvidence],
    collectEvents: () => [...allEvents],
  };
}

export { WORKSPACE_VERIFIER };
