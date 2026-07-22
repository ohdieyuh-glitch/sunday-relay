import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { createRandomIdFactory, type IdFactory, type WorkspaceRefId } from '../protocol/ids';
import type { EvidenceRecord } from '../protocol/contracts';
import type { EventDraft } from '../protocol/envelopes';
import { normalizeRepoPath } from '../coordination/claims';
import type {
  ChangeAssessment, CleanupResult, PrepareWorkspaceRequest, RelayWorkspace,
  SourceInspection, WorkspaceCommandRequest, WorkspaceCommandResult,
  WorkspaceInspection, WorkspaceOperationOutput, WorkspacePolicyInput,
  WorkspaceService, WorkspaceCommandPolicy,
} from './contracts';
import {
  inspectSourceRepository, isWithin, readWorkingTreeStatus, runGit,
  type SourceRepositoryInfo,
} from './repository-inspector';
import {
  createWorktree, defaultBranchForRun, defaultWorkspaceRootFor,
  ensureApprovedRoot, removeWorktree, validateBranchName,
} from './worktree-manager';
import { classifyChangedPath, normalizePolicy, withBaselineProtection } from './protected-paths';
import {
  buildChildEnvironment, DEFAULT_WORKSPACE_COMMAND_POLICY, evaluateCommandRequest,
} from './command-policy';
import { createCommandRunner, type CommandRunner } from './command-runner';
import { sanitizeOutput } from './output-sanitizer';
import {
  buildWorkspaceEvent, buildWorkspaceEvidence, shortRevision,
  type WorkspaceEvidenceContext,
} from './workspace-evidence';
import { decideCleanup } from './cleanup';

/**
 * Workspace composition root (Prompt 7) — the ONLY module that assembles
 * Node process/filesystem operations behind the provider-neutral ports.
 * Registry is in-memory (volatile, truthfully labeled): workspaces die with
 * the process; the worktrees themselves persist on disk per cleanup policy.
 */

export * from './contracts';
export { DEFAULT_WORKSPACE_COMMAND_POLICY } from './command-policy';
export { defaultWorkspaceRootFor } from './worktree-manager';
export { workspaceDoctorReport } from './doctor';
export { runWorkspaceVerificationHarness } from './verify-harness';

export interface LocalWorkspaceServiceOptions {
  /** Absolute approved root; default: sibling `.relay-workspaces` of the source. */
  workspaceRoot?: string;
  commandPolicy?: WorkspaceCommandPolicy;
  ids?: IdFactory;
  now?: () => string;
}

interface RegisteredWorkspace {
  workspace: RelayWorkspace;
  source: SourceRepositoryInfo;
  workspaceRealPath: string;
  rootRealPath: string;
  requestKey: string;
}

const requestKeyOf = (sourceRealPath: string, request: PrepareWorkspaceRequest): string =>
  `${sourceRealPath}::${request.runId}::${request.taskId}`;

export function createLocalWorkspaceService(options: LocalWorkspaceServiceOptions = {}): WorkspaceService {
  const ids = options.ids ?? createRandomIdFactory();
  const now = options.now ?? (() => new Date().toISOString());
  const commandPolicy = options.commandPolicy ?? DEFAULT_WORKSPACE_COMMAND_POLICY;
  const runner: CommandRunner = createCommandRunner({ now });

  const registry = new Map<string, RegisteredWorkspace>(); // by workspaceId
  const byRequestKey = new Map<string, string>();
  const byBranch = new Map<string, string>();
  const commandCache = new Map<string, WorkspaceCommandResult>();

  const evidenceLog: EvidenceRecord[] = [];
  const eventLog: EventDraft[] = [];

  const ctxFor = (cwd: string): WorkspaceEvidenceContext => ({
    ids,
    now,
    environment: { os: process.platform, node: process.version, cwd },
  });

  const record = (evidence: EvidenceRecord[], events: EventDraft[]) => {
    evidenceLog.push(...evidence);
    eventLog.push(...events);
  };

  const entryOf = (workspaceId: WorkspaceRefId): RegisteredWorkspace | null => registry.get(workspaceId) ?? null;

  /* ------------------------- prepare ------------------------------- */

  function prepareWorkspace(request: PrepareWorkspaceRequest):
    RelayResult<WorkspaceOperationOutput<{ workspace: RelayWorkspace; idempotent: boolean }>> {
    const inspected = inspectSourceRepository(request.sourceRepositoryPath);
    if (!inspected.ok) return inspected;
    const source = inspected.value;
    const ctx = ctxFor(source.rootPath);

    const branchRequested = request.branchName ?? defaultBranchForRun(request.runId);
    const branchChecked = validateBranchName(branchRequested);
    if (!branchChecked.ok) return branchChecked;
    const branchName = branchChecked.value;

    /* idempotency: the same valid request returns the same workspace */
    const key = requestKeyOf(source.rootPath, request);
    const existingId = byRequestKey.get(key);
    if (existingId) {
      const existing = registry.get(existingId)!;
      if (existing.workspace.branchName !== branchName) {
        return fail(relayError('duplicate-task', 'This run/task already owns a workspace on a different branch — conflicting reuse is refused.'));
      }
      const events = [buildWorkspaceEvent(ctx, {
        projectId: request.projectId, runId: request.runId, taskId: request.taskId,
        kind: 'workspace.reused', workspaceId: existing.workspace.workspaceId,
        safeSummary: `Workspace reused (idempotent request) on ${existing.workspace.branchName} at ${shortRevision(existing.workspace.sourceRevision)}.`,
      })];
      record([], events);
      return ok({ value: { workspace: { ...existing.workspace }, idempotent: true }, events, evidence: [] });
    }

    const branchOwner = byBranch.get(branchName);
    if (branchOwner) {
      return fail(relayError('duplicate-task', `Branch "${branchName}" is assigned to another active workspace.`));
    }

    const root = ensureApprovedRoot(options.workspaceRoot ?? defaultWorkspaceRootFor(source.rootPath), source.rootPath);
    if (!root.ok) return root;

    const evidence: EvidenceRecord[] = [];
    const events: EventDraft[] = [];
    const workspaceId = ids.next('wsp');

    evidence.push(buildWorkspaceEvidence(ctx, {
      runId: request.runId, taskId: request.taskId, evidenceType: 'health-check',
      outputExcerpt: `Source repository validated; revision pinned at ${source.revision}; base branch ${source.branch}; source dirty=${source.dirty} (uncommitted source changes are never copied).`,
      repoRevision: source.revision, passed: true,
    }));
    events.push(buildWorkspaceEvent(ctx, {
      projectId: request.projectId, runId: request.runId, taskId: request.taskId,
      kind: 'workspace.validated', workspaceId,
      safeSummary: `Source repository validated; revision pinned at ${shortRevision(source.revision)} (base ${source.branch}).`,
      evidenceIds: [evidence[0].evidenceId],
    }));

    const created = createWorktree({
      source, rootRealPath: root.value.rootRealPath,
      projectToken: request.projectId, runToken: request.runId, taskToken: request.taskId,
      branchName,
    });
    if (!created.ok) {
      record(evidence, events);
      return created;
    }

    const workspace: RelayWorkspace = {
      workspaceId,
      projectId: request.projectId,
      runId: request.runId,
      taskId: request.taskId,
      sourceRepositoryPath: source.rootPath,
      sourceRevision: source.revision,
      baseBranch: source.branch,
      sourceDirtyAtPin: source.dirty,
      workspacePath: created.value.workspacePath,
      branchName,
      status: 'ready',
      createdAt: now(),
      cleanupPolicy: request.cleanupPolicy ?? 'preserve_on_failure',
      provenance: 'live',
    };

    evidence.push(buildWorkspaceEvidence(ctx, {
      runId: request.runId, taskId: request.taskId, evidenceType: 'health-check',
      outputExcerpt: `Isolated worktree created on branch ${branchName} at pinned revision ${source.revision}; verified to point at the expected repository, revision, and branch; path confined to the approved workspace root.`,
      repoRevision: source.revision, passed: true,
    }));
    events.push(buildWorkspaceEvent(ctx, {
      projectId: request.projectId, runId: request.runId, taskId: request.taskId,
      kind: 'workspace.created', workspaceId,
      safeSummary: `Isolated worktree created on ${branchName} at ${shortRevision(source.revision)} (live local — SIMULATED agents are unaffected).`,
      evidenceIds: [evidence[1].evidenceId],
      payload: { branch: branchName, revision: source.revision },
    }));

    registry.set(workspaceId, {
      workspace, source,
      workspaceRealPath: created.value.workspaceRealPath,
      rootRealPath: root.value.rootRealPath,
      requestKey: key,
    });
    byRequestKey.set(key, workspaceId);
    byBranch.set(branchName, workspaceId);
    record(evidence, events);
    return ok({ value: { workspace: { ...workspace }, idempotent: false }, events, evidence });
  }

  /* ---------------------- source protection ------------------------ */

  function verifySourceUnchanged(workspaceId: WorkspaceRefId):
    RelayResult<WorkspaceOperationOutput<SourceInspection>> {
    const entry = entryOf(workspaceId);
    if (!entry) return fail(relayError('not-found', 'Unknown workspace.', { entityIds: { workspaceId } }));
    const ctx = ctxFor(entry.source.rootPath);
    const current = inspectSourceRepository(entry.workspace.sourceRepositoryPath);
    if (!current.ok) return current;
    const changed =
      current.value.revision !== entry.workspace.sourceRevision ||
      current.value.branch !== entry.workspace.baseBranch;
    const inspection: SourceInspection = {
      revision: current.value.revision,
      branch: current.value.branch,
      dirty: current.value.dirty,
      changed,
      inspectedAt: now(),
    };
    const evidence = [buildWorkspaceEvidence(ctx, {
      runId: entry.workspace.runId, taskId: entry.workspace.taskId, evidenceType: 'health-check',
      outputExcerpt: changed
        ? `Source repository CHANGED under the pinned workspace: pinned ${entry.workspace.sourceRevision} (${entry.workspace.baseBranch}), now ${current.value.revision} (${current.value.branch}). Revalidation required.`
        : `Source worktree unchanged: still at pinned ${entry.workspace.sourceRevision} on ${entry.workspace.baseBranch}.`,
      repoRevision: current.value.revision, passed: !changed,
    })];
    const events = [buildWorkspaceEvent(ctx, {
      projectId: entry.workspace.projectId, runId: entry.workspace.runId, taskId: entry.workspace.taskId,
      kind: changed ? 'workspace.source_changed' : 'workspace.inspected', workspaceId,
      safeSummary: changed
        ? `Source repository changed under the pinned run (now ${shortRevision(current.value.revision)}) — automatic work must stop for revalidation.`
        : `Source repository verified unchanged at ${shortRevision(current.value.revision)}.`,
      evidenceIds: [evidence[0].evidenceId],
    })];
    if (changed) entry.workspace.status = 'checkpoint_required';
    record(evidence, events);
    return ok({ value: inspection, events, evidence });
  }

  /* ------------------------- inspection ----------------------------- */

  const symlinkEscapesOf = (entry: RegisteredWorkspace, relPaths: string[]): string[] => {
    const escapes: string[] = [];
    for (const rel of relPaths) {
      const full = join(entry.workspaceRealPath, rel);
      let parentReal: string;
      try {
        parentReal = realpathSync(dirname(full));
      } catch {
        escapes.push(rel); // unresolvable containing directory
        continue;
      }
      if (!isWithin(entry.workspaceRealPath, parentReal)) {
        escapes.push(rel);
        continue;
      }
      // lstat (never follow): a deleted file is fine, a symlink is judged
      // by its target — dangling links are judged by their textual target.
      let isSymlink = false;
      try {
        isSymlink = lstatSync(full).isSymbolicLink();
      } catch {
        continue; // path deleted in this change — not an escape
      }
      if (!isSymlink) continue;
      const target = resolvePath(dirname(full), readlinkSync(full));
      let targetReal = target;
      try {
        targetReal = realpathSync(target);
      } catch {
        /* dangling symlink: keep the textual target */
      }
      if (!isWithin(entry.workspaceRealPath, targetReal)) escapes.push(rel);
    }
    return escapes;
  };

  function inspectWorkspace(workspaceId: WorkspaceRefId, policyInput: WorkspacePolicyInput):
    RelayResult<WorkspaceOperationOutput<WorkspaceInspection>> {
    const entry = entryOf(workspaceId);
    if (!entry) return fail(relayError('not-found', 'Unknown workspace.', { entityIds: { workspaceId } }));
    const ctx = ctxFor(entry.workspaceRealPath);
    const normalized = normalizePolicy({
      protectedPaths: withBaselineProtection(policyInput.protectedPaths),
      claimedWritePaths: policyInput.claimedWritePaths,
    });
    if (!normalized.ok) {
      return fail(relayError('validation-failed', 'Workspace policy input is invalid.', { details: normalized.errors }));
    }

    const head = runGit(['rev-parse', 'HEAD'], entry.workspaceRealPath);
    const ref = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], entry.workspaceRealPath);
    const status = readWorkingTreeStatus(entry.workspaceRealPath);
    if (!head.ok || !ref.ok || !status.ok) {
      const inspection: WorkspaceInspection = {
        workspaceId, revision: head.ok ? head.stdout.trim() : 'unknown',
        branch: ref.ok ? ref.stdout.trim() : 'unknown',
        clean: false, changedFiles: [], untrackedFiles: [], claimedChanges: [],
        unclaimedChanges: [], protectedChanges: [], symlinkEscapes: [],
        conflictState: 'unknown', assessment: 'unsupported_inspection', inspectedAt: now(),
      };
      return ok({ value: inspection, events: [], evidence: [] });
    }

    const allPaths = [...status.value.changedFiles, ...status.value.untrackedFiles];
    const claimedChanges: string[] = [];
    const unclaimedChanges: string[] = [];
    const protectedChanges: string[] = [];
    for (const raw of allPaths) {
      const { path, classification } = classifyChangedPath(raw, normalized.policy);
      if (classification === 'protected') protectedChanges.push(path);
      else if (classification === 'claimed') claimedChanges.push(path);
      else unclaimedChanges.push(path); // invalid shapes are never "allowed"
    }
    const validForSymlinkCheck = allPaths
      .map((p) => normalizeRepoPath(p))
      .filter((r): r is { ok: true; value: string } => r.ok)
      .map((r) => r.value);
    const symlinkEscapes = symlinkEscapesOf(entry, validForSymlinkCheck);

    const clean = allPaths.length === 0;
    const assessment: ChangeAssessment =
      symlinkEscapes.length > 0 ? 'symlink_escape'
        : protectedChanges.length > 0 ? 'protected_change'
          : unclaimedChanges.length > 0 ? 'unclaimed_change'
            : clean ? 'clean' : 'allowed';

    const inspection: WorkspaceInspection = {
      workspaceId,
      revision: head.stdout.trim(),
      branch: ref.stdout.trim(),
      clean,
      changedFiles: status.value.changedFiles,
      untrackedFiles: status.value.untrackedFiles,
      claimedChanges, unclaimedChanges, protectedChanges, symlinkEscapes,
      conflictState: status.value.conflicted ? 'merge-conflict' : 'none',
      assessment,
      inspectedAt: now(),
    };

    const flagged = assessment === 'protected_change' || assessment === 'unclaimed_change' || assessment === 'symlink_escape';
    const summary = clean
      ? 'Workspace clean at the pinned revision.'
      : `Workspace inspection: ${claimedChanges.length} claimed, ${unclaimedChanges.length} unclaimed, ${protectedChanges.length} protected change(s), ${symlinkEscapes.length} symlink escape(s).`;
    const evidence = [buildWorkspaceEvidence(ctx, {
      runId: entry.workspace.runId, taskId: entry.workspace.taskId, evidenceType: 'diff',
      outputExcerpt: `${summary} Files: ${allPaths.slice(0, 20).join(', ') || '(none)'}`,
      repoRevision: inspection.revision, passed: !flagged,
    })];
    const events = [buildWorkspaceEvent(ctx, {
      projectId: entry.workspace.projectId, runId: entry.workspace.runId, taskId: entry.workspace.taskId,
      kind: 'workspace.inspected', workspaceId,
      safeSummary: summary, evidenceIds: [evidence[0].evidenceId],
      payload: { assessment },
    })];
    if (flagged) {
      entry.workspace.status = 'checkpoint_required';
      events.push(buildWorkspaceEvent(ctx, {
        projectId: entry.workspace.projectId, runId: entry.workspace.runId, taskId: entry.workspace.taskId,
        kind: 'workspace.change_flagged', workspaceId,
        safeSummary: `Workspace change flagged (${assessment}) — automatic work must stop; claims are never expanded automatically.`,
        payload: { assessment, protectedChanges: protectedChanges.slice(0, 10), unclaimedChanges: unclaimedChanges.slice(0, 10) },
      }));
    } else if (!clean) {
      entry.workspace.status = 'active';
    } else if (entry.workspace.status === 'active' || entry.workspace.status === 'dirty') {
      entry.workspace.status = 'ready';
    }
    entry.workspace.lastInspectedAt = inspection.inspectedAt;
    record(evidence, events);
    return ok({ value: inspection, events, evidence });
  }

  /* ------------------------- execution ------------------------------ */

  async function executeCommand(request: WorkspaceCommandRequest):
    Promise<RelayResult<WorkspaceOperationOutput<WorkspaceCommandResult>>> {
    const entry = entryOf(request.workspaceId);
    if (!entry) return fail(relayError('not-found', 'Unknown workspace.', { entityIds: { workspaceId: request.workspaceId } }));
    const ctx = ctxFor(entry.workspaceRealPath);
    const ws = entry.workspace;

    const cached = commandCache.get(request.commandId);
    if (cached) return ok({ value: cached, events: [], evidence: [] });

    const finishRejected = (reasons: string[]): RelayResult<WorkspaceOperationOutput<WorkspaceCommandResult>> => {
      const at = now();
      const result: WorkspaceCommandResult = {
        commandId: request.commandId, workspaceId: request.workspaceId, status: 'rejected',
        executableLabel: String(request.executable).slice(0, 100),
        redactedArgs: (Array.isArray(request.args) ? request.args : []).map((a) => sanitizeOutput(String(a)).text.slice(0, 100)),
        exitCode: null, signal: null, stdout: '', stderr: '',
        startedAt: at, completedAt: at, durationMs: 0,
        timedOut: false, cancelled: false, truncated: false,
        termination: 'not_required', grantedEnvironmentKeys: [],
        rejectionReasons: reasons.slice(0, 10),
        provenance: 'live', enforcement: 'enforced', evidenceRefs: [],
      };
      const evidence = [buildWorkspaceEvidence(ctx, {
        runId: ws.runId, taskId: ws.taskId, evidenceType: 'command',
        command: result.executableLabel,
        outputExcerpt: `Command REJECTED by policy: ${reasons.join('; ')}`,
        repoRevision: ws.sourceRevision, passed: false,
      })];
      result.evidenceRefs = [evidence[0].evidenceId];
      const events = [buildWorkspaceEvent(ctx, {
        projectId: ws.projectId, runId: ws.runId, taskId: ws.taskId,
        kind: 'workspace.command_rejected', workspaceId: ws.workspaceId,
        safeSummary: `Command "${result.executableLabel}" rejected by the approved-command policy.`,
        evidenceIds: [evidence[0].evidenceId],
      })];
      commandCache.set(request.commandId, result);
      record(evidence, events);
      return ok({ value: result, events, evidence });
    };

    if (ws.status === 'checkpoint_required' || ws.status === 'cancelled' || ws.status === 'removed' || ws.status === 'failed') {
      return finishRejected([`workspace is ${ws.status} — automatic execution is stopped`]);
    }

    const approval = evaluateCommandRequest(commandPolicy, request);
    if (!approval.approved) return finishRejected(approval.reasons);

    /* working directory: inside the workspace, symlink-resolved */
    let cwd = entry.workspaceRealPath;
    if (request.relativeWorkingDirectory !== undefined) {
      const rel = normalizeRepoPath(request.relativeWorkingDirectory);
      if (!rel.ok) return finishRejected([`working directory: ${rel.error.message}`]);
      const candidate = join(entry.workspaceRealPath, rel.value);
      try {
        const real = realpathSync(candidate);
        if (!isWithin(entry.workspaceRealPath, real) || !lstatSync(real).isDirectory()) {
          return finishRejected(['working directory escapes the approved workspace']);
        }
        cwd = real;
      } catch {
        return finishRejected(['working directory does not exist inside the workspace']);
      }
    }

    const env = buildChildEnvironment(process.env, approval.grantedEnvironmentKeys);
    const startEvent = buildWorkspaceEvent(ctx, {
      projectId: ws.projectId, runId: ws.runId, taskId: ws.taskId,
      kind: 'workspace.command_started', workspaceId: ws.workspaceId,
      safeSummary: `Approved command started: ${request.executable} ${request.args.join(' ')}`.slice(0, 200),
    });
    record([], [startEvent]);

    const outcome = await runner.execute({
      commandId: request.commandId,
      executable: request.executable,
      args: request.args,
      cwd, env,
      timeoutMs: approval.timeoutMs,
      outputLimitBytes: approval.outputLimitBytes,
    });

    const stdout = sanitizeOutput(outcome.stdout).text;
    const stderr = sanitizeOutput(outcome.stderr).text;
    const result: WorkspaceCommandResult = {
      commandId: request.commandId, workspaceId: request.workspaceId,
      status: outcome.status,
      executableLabel: request.executable,
      redactedArgs: request.args.map((a) => sanitizeOutput(a).text),
      exitCode: outcome.exitCode, signal: outcome.signal,
      stdout, stderr,
      startedAt: outcome.startedAt, completedAt: outcome.completedAt, durationMs: outcome.durationMs,
      timedOut: outcome.timedOut, cancelled: outcome.cancelled, truncated: outcome.truncated,
      termination: outcome.termination,
      grantedEnvironmentKeys: approval.grantedEnvironmentKeys,
      provenance: 'live', enforcement: 'enforced', evidenceRefs: [],
    };
    const evidence = [buildWorkspaceEvidence(ctx, {
      runId: ws.runId, taskId: ws.taskId, evidenceType: 'command',
      command: `${request.executable} ${result.redactedArgs.join(' ')}`.slice(0, 300),
      exitCode: outcome.exitCode ?? undefined,
      outputExcerpt: `status=${outcome.status} exit=${outcome.exitCode ?? '-'} signal=${outcome.signal ?? '-'} timedOut=${outcome.timedOut} cancelled=${outcome.cancelled} truncated=${outcome.truncated} termination=${outcome.termination}\n${stdout.slice(0, 500)}\n${stderr.slice(0, 300)}`,
      repoRevision: ws.sourceRevision,
      passed: outcome.status === 'completed',
    })];
    result.evidenceRefs = [evidence[0].evidenceId];
    const events = [buildWorkspaceEvent(ctx, {
      projectId: ws.projectId, runId: ws.runId, taskId: ws.taskId,
      kind: outcome.cancelled ? 'workspace.cancelled' : 'workspace.command_completed',
      workspaceId: ws.workspaceId,
      safeSummary: `Command ${outcome.status}: ${request.executable} (exit=${outcome.exitCode ?? '-'}, ${outcome.durationMs}ms${outcome.truncated ? ', output truncated' : ''}).`,
      evidenceIds: [evidence[0].evidenceId],
      payload: { status: outcome.status },
    })];
    commandCache.set(request.commandId, result);
    record(evidence, events);
    return ok({ value: result, events, evidence });
  }

  /* -------------------------- cleanup ------------------------------- */

  function cleanupWorkspace(workspaceId: WorkspaceRefId, cleanupOptions?: { authorizeRemoval?: boolean }):
    RelayResult<WorkspaceOperationOutput<CleanupResult>> {
    const refuse = (detail: string, ctxCwd: string, entry?: RegisteredWorkspace):
      RelayResult<WorkspaceOperationOutput<CleanupResult>> => {
      const result: CleanupResult = { workspaceId, outcome: 'cleanup_refused', detail, at: now() };
      if (entry) {
        const events = [buildWorkspaceEvent(ctxFor(ctxCwd), {
          projectId: entry.workspace.projectId, runId: entry.workspace.runId, taskId: entry.workspace.taskId,
          kind: 'workspace.cleanup_refused', workspaceId,
          safeSummary: `Workspace cleanup refused: ${detail}`,
        })];
        record([], events);
        return ok({ value: result, events, evidence: [] });
      }
      return ok({ value: result, events: [], evidence: [] });
    };

    const entry = entryOf(workspaceId);
    if (!entry) return refuse('unknown workspace — only registered Relay workspaces can be cleaned', process.cwd());
    const ws = entry.workspace;
    const ctx = ctxFor(entry.source.rootPath);

    /* identity + path safety before ANY destructive step */
    if (!isWithin(entry.rootRealPath, entry.workspaceRealPath)) {
      return refuse('workspace path is outside the approved root', entry.source.rootPath, entry);
    }
    if (entry.workspaceRealPath === entry.source.rootPath || isWithin(entry.workspaceRealPath, entry.source.rootPath)) {
      return refuse('refusing to touch the source worktree', entry.source.rootPath, entry);
    }
    if (ws.status === 'removed') {
      return ok({ value: { workspaceId, outcome: 'cleanup_complete', detail: 'workspace already removed', at: now() }, events: [], evidence: [] });
    }

    const decision = decideCleanup({
      policy: ws.cleanupPolicy,
      status: ws.status,
      authorizeRemoval: cleanupOptions?.authorizeRemoval === true,
    });

    if (decision.action === 'preserve') {
      ws.status = 'preserved';
      const evidence = [buildWorkspaceEvidence(ctx, {
        runId: ws.runId, taskId: ws.taskId, evidenceType: 'health-check',
        outputExcerpt: `Workspace preserved for inspection: ${decision.reason}. Branch ${ws.branchName}, revision ${ws.sourceRevision}.`,
        repoRevision: ws.sourceRevision, passed: true,
      })];
      const events = [buildWorkspaceEvent(ctx, {
        projectId: ws.projectId, runId: ws.runId, taskId: ws.taskId,
        kind: 'workspace.preserved', workspaceId,
        safeSummary: `Workspace preserved (${decision.reason}).`,
        evidenceIds: [evidence[0].evidenceId],
      })];
      record(evidence, events);
      return ok({ value: { workspaceId, outcome: 'preserved', detail: decision.reason, at: now() }, events, evidence });
    }

    const removed = removeWorktree(entry.source.rootPath, entry.workspaceRealPath);
    if (!removed.ok) {
      const evidence = [buildWorkspaceEvidence(ctx, {
        runId: ws.runId, taskId: ws.taskId, evidenceType: 'health-check',
        outputExcerpt: `Workspace cleanup failed (worktree not removed; dirty worktrees are never force-removed): ${removed.error.message}`,
        repoRevision: ws.sourceRevision, passed: false,
      })];
      record(evidence, []);
      return ok({ value: { workspaceId, outcome: 'cleanup_failed', detail: removed.error.message, at: now() }, events: [], evidence });
    }
    ws.status = 'removed';
    byBranch.delete(ws.branchName);
    const evidence = [buildWorkspaceEvidence(ctx, {
      runId: ws.runId, taskId: ws.taskId, evidenceType: 'health-check',
      outputExcerpt: `Relay-created worktree removed (${decision.reason}). The run branch ${ws.branchName} is retained in the source repository for history.`,
      repoRevision: ws.sourceRevision, passed: true,
    })];
    const events = [buildWorkspaceEvent(ctx, {
      projectId: ws.projectId, runId: ws.runId, taskId: ws.taskId,
      kind: 'workspace.cleaned', workspaceId,
      safeSummary: `Relay-created worktree removed (${decision.reason}).`,
      evidenceIds: [evidence[0].evidenceId],
    })];
    record(evidence, events);
    return ok({ value: { workspaceId, outcome: 'cleanup_complete', detail: decision.reason, at: now() }, events, evidence });
  }

  return {
    prepareWorkspace,
    getWorkspace: (workspaceId) => {
      const entry = entryOf(workspaceId);
      return entry ? { ...entry.workspace } : null;
    },
    listWorkspaces: () => [...registry.values()].map((entry) => ({ ...entry.workspace })),
    cleanupWorkspace,
    inspectWorkspace,
    verifySourceUnchanged,
    executeCommand,
    cancelCommand: (commandId) => runner.cancel(commandId),
    collectEvidence: () => [...evidenceLog],
    collectEvents: () => [...eventLog],
  };
}
