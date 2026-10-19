import { rmSync } from 'node:fs';
import { RELAY_PROTOCOL_VERSION } from '../../protocol/version';
import type {
  AgentHandoffPackage, CompletionPolicy, EvidenceRecord, FinalAuditReport, RelayTask,
} from '../../protocol/contracts';
import type {
  AuditId, ContextVersion, IdFactory, LedgerVersion, PackageId, PolicyId,
  ProjectId, RunId, TaskId,
} from '../../protocol/ids';
import type { EventDraft } from '../../protocol/envelopes';
import { createWorkspaceService, type WorkspaceCommandPolicy, type WorkspacePolicyInput } from '../../workspace';
import { DEFAULT_WORKSPACE_COMMAND_POLICY } from '../../workspace';
import { sanitizeOutput } from '../../workspace/output-sanitizer';
import { runGit } from '../../workspace/repository-inspector';
import { evaluateCompletionPolicy } from '../../verification/completion';
import {
  CLAUDE_ADAPTER_ID, claudePromptFor, claudeToolPolicyFor, createClaudeCodeAdapter,
} from './adapter';
import { DEFAULT_LIVE_LIMITS, type ClaudeCodeCapabilityProfile, type ClaudeLiveLimits } from './contracts';
import {
  buildSafeEditFixture, RELAY_TEST_ARGS, TEST_FILE,
} from './fixture';
import { auditToolScope, type ScopeAuditResult } from './scope-auditor';

/**
 * Live Claude proof orchestrator (Prompt 8). Runs the full low-risk proof
 * against a THROWAWAY fixture repo: isolated workspace -> real Claude edit
 * -> Relay-independent inspection -> Relay-run verification -> live audit.
 * Used by `relay claude run --confirm-live` with the real executable and by
 * the offline contract harness with the fake executable (same pipeline, no
 * provider call). The Agent report is never trusted over inspection, and no
 * reviewer is claimed (the low-risk policy does not require one).
 *
 * It also produces the RECEIPT for one live proof. Three properties make that
 * receipt worth trusting:
 *
 *   - OBSERVED IDENTITY. The model that answered is read off the runtime's own
 *     stream and reported separately from the model that was requested. There
 *     is no fallback between them: an alias like `sonnet` resolves to a dated
 *     id, and a runtime that names nothing yields Unknown.
 *   - MEASURED SCOPE. Every tool target the runtime reported is classified
 *     against the workspace root. One escape stops the run — a clean process
 *     exit is not permitted to mean the work stayed inside its boundary.
 *   - PRESERVED EVIDENCE. Under `preserveEvidence` the workspace and fixture
 *     survive the run so a founder can inspect what actually happened, and
 *     the proof reports exactly where they are.
 */

/** Diff bound: enough to review one fixture edit, never an unbounded blob. */
const MAX_DIFF_BYTES = 64 * 1024;

export interface ClaudeProofOptions {
  executablePath: string;
  capabilities: ClaudeCodeCapabilityProfile;
  now: () => string;
  ids: IdFactory;
  limits?: ClaudeLiveLimits;
  baseEnv?: Record<string, string | undefined>;
  /** A model to genuinely request. Omitted = the account default is used. */
  requestedModel?: string | null;
  /**
   * Keep the isolated workspace and throwaway fixture after the run so the
   * work can be inspected. The caller is then responsible for removal — which
   * is the point: cleanup becomes a decision, not a side effect.
   */
  preserveEvidence?: boolean;
}

/**
 * The runtime identity Relay OBSERVED for this run. Every `actual*` field
 * comes from the process; `null` means the runtime never said, and renders
 * as Unknown rather than falling back to the requested value.
 */
export interface ObservedRuntimeIdentity {
  readonly requestedModel: string | null;
  readonly actualModel: string | null;
  /** Set only once a stream from the launched process was parsed. */
  readonly actualRuntime: string | null;
  /** The installed CLI version the probe read before launching. */
  readonly runtimeVersion: string | null;
  readonly launchVerified: boolean;
  /** Redacted tail of the provider session id — never the whole value. */
  readonly sessionRefRedacted: string | null;
  readonly turns: number | null;
  readonly durationMs: number | null;
  readonly reportedCostUsd: number | null;
}

export interface ClaudeProofResult {
  lines: string[];
  exitCode: number;
  audit: FinalAuditReport | null;
  sessionCaptured: string | null;
  filesChanged: string[];
  protectedChanges: string[];
  inspectionAssessment: string;
  sourceUnchanged: boolean;
  verificationPassed: boolean;
  completionOutcome: string;
  events: EventDraft[];
  evidence: EvidenceRecord[];
  /** Requested vs actual runtime identity, kept strictly separate. */
  identity: ObservedRuntimeIdentity;
  /** Tool targets classified against the workspace root. */
  scope: ScopeAuditResult;
  /** The real resulting diff, read by Relay from the worktree, bounded. */
  unifiedDiff: string | null;
  /** Where the preserved work is, when `preserveEvidence` was set. */
  preservedWorkspacePath: string | null;
  preservedFixturePath: string | null;
  /** Process facts, so a receipt need not re-derive them. */
  exitCodeObserved: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  terminationConfirmed: boolean;
  spawnFailed: boolean;
  startedAt: string | null;
  endedAt: string | null;
  /** Exactly why Relay refused the run, when it did. */
  stopReason: string | null;
}

/** Nothing observed yet — the honest starting point for every field. */
const UNOBSERVED_IDENTITY: ObservedRuntimeIdentity = Object.freeze({
  requestedModel: null, actualModel: null, actualRuntime: null, runtimeVersion: null,
  launchVerified: false, sessionRefRedacted: null,
  turns: null, durationMs: null, reportedCostUsd: null,
});

/** Keep only a short tail of a session id: enough to correlate, not to reuse. */
export function redactSessionRef(sessionId: string | null): string | null {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  return `…${sessionId.slice(-6)}`;
}

const LIVE_COMPLETION_POLICY: CompletionPolicy = {
  policyId: 'pol_claude-live-lowrisk' as PolicyId,
  riskLevel: 'low',
  requiredEvidence: [{ evidenceType: 'command', command: `node ${RELAY_TEST_ARGS.join(' ')}`, mustPass: true }],
  requiresIndependentReview: false,
  requiresHumanApproval: false,
  enforcementRequirements: [],
  acceptedProvenance: ['live'],
};

function buildHandoff(input: {
  ids: IdFactory; now: string; projectId: ProjectId; runId: RunId; taskId: TaskId;
  baseRevision: string; claimedFile: string; protectedPaths: { forbidden: string[]; readOnly: string[] };
}): AgentHandoffPackage {
  return {
    packageId: input.ids.next('pkg') as PackageId,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    projectId: input.projectId, runId: input.runId, taskId: input.taskId,
    targetAdapterId: CLAUDE_ADAPTER_ID, role: 'coding-agent',
    objective: 'Implement the missing normalizeProjectName function so the existing tests pass.',
    responsibilityBoundary: `Edit only ${input.claimedFile} to make the existing tests pass. Change nothing else.`,
    contextRefs: [`baseRevision:${input.baseRevision}`],
    requiredInputs: [input.claimedFile, TEST_FILE],
    permittedTools: [
      { value: 'Read', enforcement: 'advisory' },
      { value: 'Glob', enforcement: 'advisory' },
      { value: 'Grep', enforcement: 'advisory' },
      { value: 'Edit', enforcement: 'advisory' },
    ],
    permittedFiles: [{ value: input.claimedFile, enforcement: 'advisory' }],
    prohibitedActions: [
      ...input.protectedPaths.forbidden.map((p) => ({ value: `protected:${p}`, enforcement: 'enforced' as const })),
      { value: 'protected:.git', enforcement: 'enforced' as const },
      { value: 'bash', enforcement: 'enforced' as const },
      { value: 'network-egress', enforcement: 'enforced' as const },
      { value: 'git-push', enforcement: 'enforced' as const },
      { value: 'deploy', enforcement: 'enforced' as const },
    ],
    dependencies: [],
    acceptanceCriteria: ['The existing test suite passes when Relay runs it.', 'Only the claimed file changed.'],
    requiredEvidence: [`node ${RELAY_TEST_ARGS.join(' ')}`],
    budget: { maxRuntimeMs: (input as { limitMs?: number }).limitMs ?? DEFAULT_LIVE_LIMITS.maxRuntimeMs },
    stoppingCondition: { description: 'Stop as soon as the tests would pass; do not broaden the change.' },
    expectedReportType: 'implementation',
    contextVersion: 0 as ContextVersion,
    ledgerVersion: 0 as LedgerVersion,
    baseRevision: input.baseRevision,
    createdAt: input.now,
    idempotencyKey: `claude-live-${input.taskId}` as AgentHandoffPackage['idempotencyKey'],
  };
}

const badge = (label: string) => `[${label}]`;

export async function runClaudeProof(options: ClaudeProofOptions): Promise<ClaudeProofResult> {
  const { executablePath, capabilities, now, ids } = options;
  const limits = options.limits ?? DEFAULT_LIVE_LIMITS;
  const lines: string[] = [];
  const emit = (...l: string[]) => lines.push(...l);

  const fixture = buildSafeEditFixture();
  const projectId = ids.next('prj') as ProjectId;
  const runId = ids.next('run') as RunId;
  const taskId = ids.next('tsk') as TaskId;

  const verifyPolicy: WorkspaceCommandPolicy = {
    ...DEFAULT_WORKSPACE_COMMAND_POLICY,
    rules: [
      { executable: 'node', description: 'fixture test runner', allowedFirstArgs: ['--version', '--test'] },
      { executable: 'git', description: 'read-only inspection' },
    ],
  };
  const workspace = createWorkspaceService({ ids, now, commandPolicy: verifyPolicy });

  const preserve = options.preserveEvidence === true;
  const requestedModel =
    typeof options.requestedModel === 'string' && options.requestedModel.trim() !== ''
      ? options.requestedModel.trim()
      : null;

  const result: ClaudeProofResult = {
    lines, exitCode: 1, audit: null, sessionCaptured: null, filesChanged: [], protectedChanges: [],
    inspectionAssessment: 'unsupported_inspection', sourceUnchanged: true, verificationPassed: false,
    completionOutcome: 'unsatisfied', events: [], evidence: [],
    identity: { ...UNOBSERVED_IDENTITY, requestedModel },
    scope: { filesInspected: [], escapes: [], toolsUsed: [], contained: true },
    unifiedDiff: null, preservedWorkspacePath: null, preservedFixturePath: null,
    exitCodeObserved: null, signal: null, timedOut: false, cancelled: false,
    terminationConfirmed: false, spawnFailed: false, startedAt: null, endedAt: null,
    stopReason: null,
  };

  /**
   * The isolated workspace is created UNDER the fixture root
   * (`<fixtureRoot>/.relay-workspaces/…`), so removing the fixture removes the
   * workspace with it. Both paths are therefore disposed of — or kept —
   * together, and the run says which of the two actually happened rather than
   * announcing a preservation it did not perform.
   */
  let workspacePath: string | null = null;

  const disposeFixture = (): void => {
    if (preserve) {
      result.preservedFixturePath = fixture.fixtureRoot;
      result.preservedWorkspacePath = workspacePath;
      return;
    }
    try { rmSync(fixture.fixtureRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    result.preservedFixturePath = null;
    result.preservedWorkspacePath = null;
  };

  /** State what became of the evidence — never a claim, always the outcome. */
  const evidenceDisposition = (): string =>
    preserve
      ? `Work preserved for inspection at ${result.preservedWorkspacePath ?? result.preservedFixturePath ?? 'the throwaway fixture'}.`
      : 'Throwaway workspace and fixture removed (re-run with evidence preservation to keep them).';

  const finishStopped = (message: string): ClaudeProofResult => {
    result.stopReason = message;
    result.events = [...workspace.collectEvents()];
    result.evidence = [...workspace.collectEvidence()];
    result.exitCode = 5;
    disposeFixture();
    emit('', `${badge('STOP')} ${message}`, evidenceDisposition(),
      'RELAY STOPPED SAFELY — no completion is claimed.');
    return result;
  };

  try {
    emit(
      '', 'SUNDAY RELAY — LIVE LOCAL PROOF', '',
      `${badge('LIVE')} LIVE CLAUDE CODE AGENT`,
      'ISOLATED WORKTREE', 'SOURCE REPOSITORY PROTECTED', 'DEPLOYMENT DISABLED',
      'GIT PUSH PROHIBITED', 'DURABLE RESUME UNAVAILABLE',
      '', 'OBJECTIVE', 'Implement the missing project-name normalizer.',
    );

    const prepared = workspace.prepareWorkspace({
      projectId, runId, taskId, sourceRepositoryPath: fixture.sourceRepo, cleanupPolicy: 'remove_on_success',
    });
    if (!prepared.ok) return finishStopped(`Workspace preparation failed: ${prepared.error.message}`);
    const ws = prepared.value.value.workspace;
    workspacePath = ws.workspacePath;
    emit('', 'PROJECT BRAIN', 'Task requirements and constraints loaded.',
      '', 'TASK OWNER', 'Claude Code',
      '', 'HANDOFF', 'One claimed file.', 'All other files protected.',
      'Relay will run verification independently.');

    const pkg = buildHandoff({
      ids, now: now(), projectId, runId, taskId,
      baseRevision: fixture.baselineRevision, claimedFile: fixture.claimedFile, protectedPaths: fixture.protectedPaths,
    });
    const toolPolicy = claudeToolPolicyFor(pkg, capabilities);
    const prompt = claudePromptFor({
      pkg, runId, taskId, workspaceRelativeRoot: '.',
      readOnlyFiles: fixture.protectedPaths.readOnly, protectedFiles: [...fixture.protectedPaths.forbidden, '.git'],
      relayVerificationCommands: [`node ${RELAY_TEST_ARGS.join(' ')}`], limits,
    });

    const adapter = createClaudeCodeAdapter({ now, ids });
    emit('', 'CLAUDE CODE', 'Live session started.');
    const invocation = await adapter.invoke({
      executablePath, capabilities,
      association: { projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CLAUDE_ADAPTER_ID },
      pkg, workspacePath: ws.workspacePath, toolPolicy, prompt, attempt: 1,
      requestedModel, limits, baseEnv: options.baseEnv, now: now(),
    });
    result.events.push(...invocation.events);

    /* ---- Everything below is OBSERVED, and is recorded even when the run is
     * about to be refused: a failed proof still owes an honest receipt. ---- */
    const parsed = invocation.outcome.parsed;
    result.exitCodeObserved = invocation.outcome.exitCode;
    result.signal = invocation.outcome.signal;
    result.timedOut = invocation.outcome.timedOut;
    result.cancelled = invocation.outcome.cancelled;
    result.terminationConfirmed = invocation.outcome.termination === 'termination_confirmed';
    result.spawnFailed = invocation.outcome.spawnError !== undefined;
    result.startedAt = invocation.outcome.startedAt;
    result.endedAt = invocation.outcome.completedAt;
    result.identity = {
      requestedModel,
      // The model the RUNTIME named. Never the requested one, never a default.
      actualModel: parsed.model,
      // A runtime identity may be asserted only once its own stream was seen.
      actualRuntime: parsed.initSeen ? 'Claude Code' : null,
      runtimeVersion: capabilities.version,
      launchVerified: parsed.initSeen && invocation.outcome.spawnError === undefined,
      sessionRefRedacted: redactSessionRef(invocation.sessionId),
      turns: parsed.usage.numTurns,
      durationMs: parsed.usage.durationMs,
      reportedCostUsd: parsed.usage.reportedCostUsd,
    };
    result.scope = auditToolScope(parsed.toolActivity, ws.workspacePath);

    if (invocation.sessionId) {
      adapter.sessions.capture(
        { projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CLAUDE_ADAPTER_ID },
        invocation.sessionId,
      );
      result.sessionCaptured = invocation.sessionId;
    }

    if (invocation.outcome.cancelled || invocation.outcome.timedOut || invocation.outcome.spawnError) {
      return finishStopped('Claude process did not complete normally.');
    }

    /* CONTAINMENT GATE. Path scoping is advisory on this CLI, so Relay
     * measures where the run actually reached. A target outside the isolated
     * workspace stops the proof — a clean exit never certifies containment. */
    if (!result.scope.contained) {
      emit('', 'RELAY SCOPE AUDIT',
        `${result.scope.escapes.length} tool target(s) resolved outside the isolated workspace.`,
        ...result.scope.escapes.slice(0, 5).map((e) => `  ${e}`));
      return finishStopped(
        `The Coding Agent reached outside the isolated workspace (${result.scope.escapes.length} target(s)).`,
      );
    }
    if (!invocation.structurallyValid) {
      return finishStopped(`Claude output was not usable: ${invocation.structuralReason}.`);
    }
    if (!invocation.report.ok) {
      return finishStopped(`Claude report could not be trusted: ${invocation.report.error.message}`);
    }
    emit('', 'CLAUDE CODE', 'Execution report received.', 'This is a claim, not proof.');

    /* Relay independently inspects — the report cannot override this gate. */
    const policyInput: WorkspacePolicyInput = {
      protectedPaths: fixture.protectedPaths, claimedWritePaths: [fixture.claimedFile],
    };
    const inspection = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!inspection.ok) return finishStopped(`Workspace inspection failed: ${inspection.error.message}`);
    const insp = inspection.value.value;
    result.inspectionAssessment = insp.assessment;
    result.filesChanged = insp.claimedChanges;
    result.protectedChanges = insp.protectedChanges;

    /* The REAL resulting diff, read by Relay from the isolated worktree after
     * the agent exited — read-only git, bounded, and secret-sanitized. It is
     * captured BEFORE any rejection returns, so a refused run still leaves the
     * founder something to look at. */
    const diff = runGit(['diff', '--unified=3'], ws.workspacePath);
    if (diff.ok) {
      const clean = sanitizeOutput(diff.value.slice(0, MAX_DIFF_BYTES));
      result.unifiedDiff = clean.text;
    }

    if (insp.assessment !== 'allowed') {
      emit('', 'RELAY INSPECTION',
        insp.assessment === 'clean' ? 'No file changed — nothing to verify.'
          : `Unauthorized change detected (${insp.assessment}).`);
      return finishStopped(`Workspace inspection rejected the change (${insp.assessment}).`);
    }
    emit('', 'RELAY INSPECTION',
      `${insp.claimedChanges.length} claimed file changed.`,
      `${insp.protectedChanges.length} protected files changed.`, 'Source worktree unchanged.',
      `${result.scope.filesInspected.length} path(s) inspected, all inside the isolated workspace.`);

    /* Relay — not Claude — runs the deterministic verification. */
    const verify = await workspace.executeCommand({
      commandId: `claude-live-verify-${taskId}`, projectId, runId, taskId, workspaceId: ws.workspaceId,
      executable: 'node', args: RELAY_TEST_ARGS, expectedPurpose: 'fixture test verification',
      timeoutMs: 60_000,
    });
    if (!verify.ok) return finishStopped(`Verification could not run: ${verify.error.message}`);
    const verified = verify.value.value.status === 'completed';
    result.verificationPassed = verified;

    const sourceCheck = workspace.verifySourceUnchanged(ws.workspaceId);
    result.sourceUnchanged = sourceCheck.ok ? !sourceCheck.value.value.changed : false;

    result.evidence = [...workspace.collectEvidence()];
    result.events = [...result.events, ...workspace.collectEvents()];

    const task: RelayTask = {
      taskId, projectId, runId, objective: pkg.objective, category: 'implementation',
      status: 'working', ownerAssignmentId: null, dependencies: [], claimedFiles: [fixture.claimedFile],
      claimedResources: [], acceptanceCriteria: pkg.acceptanceCriteria, completionPolicyId: LIVE_COMPLETION_POLICY.policyId,
      contextVersion: 0 as ContextVersion, baseRevision: fixture.baselineRevision,
      createdAt: now(), updatedAt: now(), priority: 1,
    };
    const completion = evaluateCompletionPolicy({
      policy: LIVE_COMPLETION_POLICY, task, evidence: result.evidence,
      currentRepositoryRevision: fixture.baselineRevision, currentTime: now(),
      enforcementCapabilities: { 'worktree-isolation': 'enforced' },
    });
    result.completionOutcome = completion.outcome;

    emit('', 'RELAY VERIFICATION',
      `${badge(verified ? 'PASS' : 'FAIL')} Tests`,
      `${badge(insp.assessment === 'allowed' ? 'PASS' : 'FAIL')} File-claim policy`,
      `${badge(insp.protectedChanges.length === 0 ? 'PASS' : 'FAIL')} Protected-path policy`,
      `${badge(result.sourceUnchanged ? 'PASS' : 'FAIL')} Source-worktree protection`);

    const outcome = completion.outcome === 'satisfied' && verified ? 'verified-complete' : 'blocked';
    const audit: FinalAuditReport = {
      auditId: ids.next('aud') as AuditId, runId, projectId, at: now(), outcome,
      objective: pkg.objective, taskRefs: [taskId], verificationRefs: [], reviewRefs: [], repairCount: 0,
      evidenceBundleRefs: [], usageSummary: {}, checkpoints: [], provenanceProfile: 'live',
      unresolvedQuestions: [],
      identities: { codingAgent: CLAUDE_ADAPTER_ID, verification: 'relay-workspace' },
      baseRevision: fixture.baselineRevision,
      completionReason: outcome === 'verified-complete'
        ? 'Live Claude Code execution verified by Relay-run tests and workspace inspection.'
        : 'Live run did not satisfy the completion policy.',
      remainingIssues: outcome === 'verified-complete' ? [] : completion.missing.concat(completion.failed),
    };
    // Evidence is captured above; the workspace is torn down only when the
    // caller did NOT ask to keep it. Preservation is the founder's decision,
    // so it is never overridden by the success path.
    if (!preserve) workspace.cleanupWorkspace(ws.workspaceId, { authorizeRemoval: true });
    result.audit = audit;
    result.events = [...result.events, ...workspace.collectEvents().slice(result.evidence.length)];
    result.evidence = [...workspace.collectEvidence()];

    /* The receipt: requested and actual identity side by side, never merged. */
    emit('', 'RUNTIME IDENTITY',
      `Requested runtime: Claude Code`,
      `Actual runtime:    ${result.identity.actualRuntime ?? 'Unknown'}`,
      `Runtime version:   ${result.identity.runtimeVersion ?? 'Unknown'}`,
      `Requested model:   ${result.identity.requestedModel ?? 'Unknown (account default requested)'}`,
      `Actual model:      ${result.identity.actualModel ?? 'Unknown'}`,
      `Launch verified:   ${result.identity.launchVerified ? 'yes' : 'no'}`,
      `Session ref:       ${result.identity.sessionRefRedacted ?? 'Unknown'}`);

    emit('', 'FINAL AUDIT',
      outcome === 'verified-complete' ? 'Live Claude Code execution verified.' : 'Live run stopped — not verified.',
      'Independent reviewer:', 'Not required by the selected low-risk CompletionPolicy.');
    if (outcome === 'verified-complete') {
      emit('', 'RELAY COMPLETE');
      result.exitCode = 0;
    } else {
      emit('', 'RELAY STOPPED SAFELY');
      result.exitCode = 3;
    }
    return result;
  } finally {
    // `finishStopped` already disposed on its paths; this is the success path
    // and the safety net for a throw. `disposeFixture` is idempotent and
    // honours preservation, so nothing here can destroy kept evidence.
    disposeFixture();
    if (result.stopReason === null) emit('', evidenceDisposition());
  }
}

export type LivePrerequisiteResult =
  | { ready: true }
  | { ready: false; manualTitle: string; manualReason: string };

/** Pre-dispatch prerequisites for a live run — surfaced as Manual Task /
 * checkpoint reasons by the CLI. `ready` when a live run may proceed. */
export function checkLivePrerequisites(input: {
  capabilities: ClaudeCodeCapabilityProfile;
  authApproved: boolean;
  authLoggedIn: boolean;
  authSourceClass: string;
  settingsRisk: 'clean' | 'review_required';
  approvalGranted: boolean;
}): LivePrerequisiteResult {
  if (!input.capabilities.executablePath) {
    return { ready: false, manualTitle: 'Install Claude Code', manualReason: 'Claude Code is not installed on this machine.' };
  }
  if (!input.authLoggedIn) {
    return { ready: false, manualTitle: 'Sign in to Claude Code', manualReason: 'Claude Code is installed, but it is not signed in.' };
  }
  if (!input.authApproved) {
    return {
      ready: false, manualTitle: 'Use an approved Claude sign-in',
      manualReason: `The selected Relay profile does not permit ${input.authSourceClass}-billed execution.`,
    };
  }
  if (input.settingsRisk === 'review_required') {
    return { ready: false, manualTitle: 'Review project Claude settings', manualReason: 'This repository has Claude settings, MCP, or hooks that need review before a live run.' };
  }
  if (!input.approvalGranted) {
    return { ready: false, manualTitle: 'Confirm the live run', manualReason: 'A live Claude run requires explicit --confirm-live.' };
  }
  return { ready: true };
}
