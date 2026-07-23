import { rmSync } from 'node:fs';
import { RELAY_PROTOCOL_VERSION } from '../../protocol/version';
import type {
  AgentHandoffPackage, CompletionPolicy, FinalAuditReport, RelayTask, RevisionContract,
  ReviewerVerdictRecord,
} from '../../protocol/contracts';
import type {
  AssignmentId, AuditId, ContextVersion, IdFactory, LedgerVersion, PackageId, PolicyId,
  ProjectId, ReportId, RunId, TaskId,
} from '../../protocol/ids';
import type { EventDraft } from '../../protocol/envelopes';
import {
  createWorkspaceService, DEFAULT_WORKSPACE_COMMAND_POLICY,
  type WorkspaceCommandPolicy, type WorkspaceInspection, type WorkspacePolicyInput,
} from '../../workspace';
import { evaluateCompletionPolicy } from '../../verification/completion';
import { attestsSuccessfulExecution, buildExecutionAttestation } from '../../mission/attestation';
import { evaluateReviewerGate, type ReviewerGateResult } from '../../mission/reviewer-gate';
import type { ReviewInput } from '../../mission/review-repair';
import {
  CLAUDE_ADAPTER_ID, claudePromptFor, claudeRevisionPromptFor, claudeToolPolicyFor,
  createClaudeCodeAdapter,
} from '../claude-code/adapter';
import { DEFAULT_LIVE_LIMITS } from '../claude-code/contracts';
import {
  buildSafeEditFixture, RELAY_TEST_ARGS, TEST_FILE,
} from '../claude-code/fixture';
import { checkLivePrerequisites } from '../claude-code/live-runner';
import type { ClaudeCodeCapabilityProfile } from '../claude-code/contracts';
import {
  CODEX_REVIEWER_ADAPTER_ID, createCodexReviewerAdapter,
} from '../codex-reviewer/adapter';
import { DEFAULT_REVIEWER_LIMITS, type RelayReviewReport } from '../codex-reviewer/contracts';
import type { CodexReviewerCapabilityProfile } from '../codex-reviewer/contracts';
import { buildReviewerAttestation, REVIEWER_ROLE } from '../codex-reviewer/attestation';
import { checkReviewPrerequisites } from '../codex-reviewer/live-runner';
import type { ReviewerPromptContext } from '../codex-reviewer/reviewer-prompt-compiler';
import type {
  SupervisedPersistenceBoundary, SupervisedProofOptions, SupervisedProofResult,
} from './contracts';

/**
 * Live supervised workflow orchestrator (Prompt 8.4). Closes the workforce
 * loop against REAL agents on a THROWAWAY genuine fixture (no seeded defect):
 *
 *   real Claude implementation → Relay inspection → Relay-controlled
 *   verification → real independent Codex review → either
 *   PATH A: genuine approval → CompletionPolicy → VERIFIED COMPLETE, or
 *   PATH B: genuine validated finding → Finding + Repair records → the EXACT
 *   original Claude session resumes for ONE bounded repair → Relay
 *   re-verifies → the EXACT original Codex session resumes for re-review →
 *   VERIFIED COMPLETE only after a genuine approval.
 *
 * Prohibitions (permanent, boundary-tested): this runner NEVER writes
 * implementation content into the workspace, never plants a defect, never
 * injects a fault, never forces or manufactures a verdict or finding, and
 * never instructs an agent to make a mistake. Every verdict below is read
 * from the reviewer's parsed report; every changed file is read from Relay's
 * own workspace inspection. There is no fallback for either agent, no
 * deployment, no push, and no credential access.
 *
 * Exit-code contract: 0 = VERIFIED COMPLETE (either path, genuinely);
 * 3 = stopped safely with output held (failed verification, needs_human,
 * blocked, unapproving re-review — the single repair is never exceeded);
 * 5 = rejected (prerequisite, integrity, session-identity, or reviewer
 * misbehavior failures).
 */

const IMPLEMENTER_ROLE = 'coding-agent';
const RELAY_VERIFY_COMMAND = `node ${RELAY_TEST_ARGS.join(' ')}`;

const SUPERVISED_COMPLETION_POLICY: CompletionPolicy = {
  policyId: 'pol_supervised-live' as PolicyId,
  riskLevel: 'low',
  requiredEvidence: [{ evidenceType: 'command', command: RELAY_VERIFY_COMMAND, mustPass: true }],
  requiresIndependentReview: true,
  requiresHumanApproval: false,
  enforcementRequirements: [],
  acceptedProvenance: ['live'],
};

const MISSION_OBJECTIVE =
  'Implement the missing normalizeProjectName function so the existing tests pass.';

const ACCEPTANCE_CRITERIA = [
  { id: 'AC-1', text: 'The existing normalization tests pass when Relay runs them.', blocking: true },
  { id: 'AC-2', text: 'Only the claimed file (src/normalize.js) changed.', blocking: true },
];

const REVIEW_REQUIREMENTS = [
  'Project names become lowercase and trimmed.',
  'Spaces and underscores become single hyphens; separators collapse.',
  'No leading or trailing hyphens remain.',
];

function buildImplementationHandoff(input: {
  ids: IdFactory; now: string; projectId: ProjectId; runId: RunId; taskId: TaskId;
  baseRevision: string; claimedFile: string; protectedPaths: { forbidden: string[]; readOnly: string[] };
}): AgentHandoffPackage {
  return {
    packageId: input.ids.next('pkg') as PackageId,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    projectId: input.projectId, runId: input.runId, taskId: input.taskId,
    targetAdapterId: CLAUDE_ADAPTER_ID, role: 'coding-agent',
    objective: MISSION_OBJECTIVE,
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
    acceptanceCriteria: ACCEPTANCE_CRITERIA.map((c) => `${c.id}: ${c.text}`),
    requiredEvidence: [RELAY_VERIFY_COMMAND],
    budget: { maxRuntimeMs: DEFAULT_LIVE_LIMITS.maxRuntimeMs },
    stoppingCondition: { description: 'Stop as soon as the tests would pass; do not broaden the change.' },
    expectedReportType: 'implementation',
    contextVersion: 0 as ContextVersion,
    ledgerVersion: 0 as LedgerVersion,
    baseRevision: input.baseRevision,
    createdAt: input.now,
    idempotencyKey: `supervised-live-${input.taskId}` as AgentHandoffPackage['idempotencyKey'],
  };
}

/* -------------------- combined live prerequisites -------------------- */

export type SupervisedPrerequisiteResult =
  | { ready: true }
  | { ready: false; agent: 'claude' | 'codex'; manualTitle: string; manualReason: string };

/** Both live agents must independently pass their own prerequisite gates
 * before a supervised run may launch. One --confirm-live approval covers the
 * whole founder-initiated workflow (it is a single supervised mission). */
export function checkSupervisedPrerequisites(input: {
  claude: Parameters<typeof checkLivePrerequisites>[0];
  codex: Parameters<typeof checkReviewPrerequisites>[0];
}): SupervisedPrerequisiteResult {
  const claude = checkLivePrerequisites(input.claude);
  if (!claude.ready) return { ready: false, agent: 'claude', manualTitle: claude.manualTitle, manualReason: claude.manualReason };
  const codex = checkReviewPrerequisites(input.codex);
  if (!codex.ready) return { ready: false, agent: 'codex', manualTitle: codex.manualTitle, manualReason: codex.manualReason };
  return { ready: true };
}

/* ------------------------------ helpers ------------------------------ */

const badge = (label: string): string => `[${label}]`;

function snapshot(inspection: WorkspaceInspection): string {
  return JSON.stringify({
    revision: inspection.revision,
    changed: [...inspection.changedFiles].sort(),
    untracked: [...inspection.untrackedFiles].sort(),
    protected: [...inspection.protectedChanges].sort(),
  });
}

function diffSnapshots(before: string, after: string): string[] {
  if (before === after) return [];
  try {
    const b = JSON.parse(before) as { changed: string[]; untracked: string[] };
    const a = JSON.parse(after) as { changed: string[]; untracked: string[] };
    const beforeSet = new Set([...b.changed, ...b.untracked]);
    return [...new Set([...a.changed, ...a.untracked])].filter((f) => !beforeSet.has(f));
  } catch {
    return ['<workspace state changed>'];
  }
}

/** Map a parsed reviewer report to the neutral gate review input. The verdict
 * is ALWAYS the reviewer's own — never synthesized by Relay. */
function toGateReview(report: RelayReviewReport, attempt: number): ReviewInput {
  return {
    attempt,
    verdict: report.verdict === 'approved' ? 'approved' : 'changes_requested',
    reviewerAgentId: 'codex', requestedReviewerAgentId: 'codex',
    independent: true, provenance: 'live',
    findings: report.verdict === 'approved' ? [] : report.findings.map((f, i) => ({
      id: `codex-${i + 1}`,
      severity: f.severity === 'critical' ? 'critical' : f.severity === 'high' ? 'high' : f.blocking ? 'major' : 'minor',
      title: f.title, detail: f.description, recommendation: f.requiredAction,
    })),
  };
}

/* ------------------------------ the proof ---------------------------- */

export async function runSupervisedProof(options: SupervisedProofOptions): Promise<SupervisedProofResult> {
  const { now, ids } = options;
  const claudeLimits = options.claude.limits ?? DEFAULT_LIVE_LIMITS;
  const codexLimits = options.codex.limits ?? DEFAULT_REVIEWER_LIMITS;
  const lines: string[] = [];
  const emit = (...l: string[]): void => { for (const x of l) lines.push(x); };
  /** Durable-persistence boundary recording (Prompt 8.5) — no-op when no
   * hooks are attached (Prompt 8.4 behavior unchanged). A throwing hook
   * aborts the run: persistence failures are never silently ignored. */
  const persist = (boundary: SupervisedPersistenceBoundary, payload: Record<string, unknown>): void => {
    options.persistence?.record(boundary, payload);
  };

  const fixture = buildSafeEditFixture();
  const projectId = ids.next('prj') as ProjectId;
  const runId = ids.next('run') as RunId;
  const taskId = ids.next('tsk') as TaskId;
  const missionId = ids.next('pkg');
  const reviewId = `rvw_${ids.next('pkg')}`;

  const verifyPolicy: WorkspaceCommandPolicy = {
    ...DEFAULT_WORKSPACE_COMMAND_POLICY,
    rules: [
      { executable: 'node', description: 'fixture test runner', allowedFirstArgs: ['--version', '--test'] },
      { executable: 'git', description: 'read-only inspection' },
    ],
  };
  const workspace = createWorkspaceService({ ids, now, commandPolicy: verifyPolicy });
  const adapterEvents: EventDraft[] = [];

  const result: SupervisedProofResult = {
    lines, exitCode: 5, path: 'stopped', stopReason: null,
    claudeSessionCaptured: null, claudeResumeConfirmed: false, claudeInvocations: 0,
    implementationReportAttempts: [], filesChanged: [], protectedChanges: [],
    inspectionAssessments: [], implementerAttestation: null,
    verificationRuns: 0, verificationsPassed: [], postRepairEvidenceIds: [], sourceUnchanged: false,
    reviewId, codexSessionCaptured: null, codexResumeConfirmed: false, codexInvocations: 0,
    reviewVerdicts: [], reviewerFileChanges: [], reviewerIndependent: false, reviewerAttestations: [],
    findings: [], repairs: [], blockingFindingsOpen: 0, repairDispatched: false,
    outputVisibility: 'working',
    completionOutcome: 'unsatisfied', audit: null, events: [], evidence: [],
  };

  const finish = (): void => {
    result.events = [...adapterEvents, ...workspace.collectEvents()];
    result.evidence = [...workspace.collectEvidence()];
  };
  const finishStopped = (message: string, exitCode = 5): SupervisedProofResult => {
    emit('', badge('STOP') + ' RELAY STOPPED SAFELY', `  ${message}`, '  Output remains held.');
    result.stopReason = message;
    result.path = 'stopped';
    result.exitCode = exitCode;
    persist('stopped_safely', {
      stopReason: message, exitCode, lifecycleAfter: 'stopped_safely', phase: 'stopped',
      visibilityAfter: result.outputVisibility,
    });
    finish();
    return result;
  };

  try {
    persist('run_initialized', {
      runId, projectId, missionId, taskId,
      displayName: 'Supervised safe-edit mission',
      objective: MISSION_OBJECTIVE,
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
      policyRefs: [SUPERVISED_COMPLETION_POLICY.policyId],
      requestedWorkforce: [CLAUDE_ADAPTER_ID, CODEX_REVIEWER_ADAPTER_ID],
      owner: CLAUDE_ADAPTER_ID,
      mode: 'guided', phase: 'initialized',
      maxCalls: claudeLimits.maxLiveCallsPerRun + codexLimits.maxLiveCallsPerRun,
      providerBudgets: { claude: claudeLimits.maxLiveCallsPerRun, codex: codexLimits.maxLiveCallsPerRun },
      claimedFiles: [fixture.claimedFile],
      protectedPaths: fixture.protectedPaths.forbidden,
    });
    emit(
      'SUNDAY RELAY — LIVE SUPERVISED WORKFLOW', '',
      badge('LIVE') + ' LIVE CLAUDE IMPLEMENTER',
      badge('LIVE') + ' LIVE CODEX INDEPENDENT REVIEWER',
      'ISOLATED WORKTREE',
      'SOURCE REPOSITORY PROTECTED',
      'DEPLOYMENT DISABLED',
      'GIT PUSH PROHIBITED',
      'FALLBACK DISABLED',
      'NO FAULT INJECTION — every verdict is the reviewer\'s genuine report',
      'SINGLE BOUNDED REPAIR (Guided)', '',
      'OBJECTIVE',
      `  ${MISSION_OBJECTIVE}`, '',
    );

    /* ---------------- 1. isolated workspace ---------------- */
    const prepared = workspace.prepareWorkspace({
      projectId, runId, taskId, sourceRepositoryPath: fixture.sourceRepo, cleanupPolicy: 'preserve_on_failure',
    });
    if (!prepared.ok) return finishStopped(`Workspace preparation failed: ${prepared.error.message}`);
    const ws = prepared.value.value.workspace;
    persist('workspace_created', {
      workspaceId: ws.workspaceId, canonicalPath: ws.workspacePath,
      sourceRepositoryPath: fixture.sourceRepo, sourceRevision: fixture.baselineRevision,
      worktreeBranch: ws.branchName ?? '', claimedFiles: [fixture.claimedFile],
      protectedPaths: fixture.protectedPaths.forbidden,
    });

    const claudeAdapter = createClaudeCodeAdapter({ now, ids });
    const codexAdapter = createCodexReviewerAdapter({ now, ids });
    const claudeAssoc = {
      projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CLAUDE_ADAPTER_ID,
    };
    const codexAssoc = {
      reviewId, projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CODEX_REVIEWER_ADAPTER_ID,
    };
    const policyInput: WorkspacePolicyInput = {
      protectedPaths: fixture.protectedPaths, claimedWritePaths: [fixture.claimedFile],
    };

    /* ---------------- 2. real Claude implementation ---------------- */
    const pkg = buildImplementationHandoff({
      ids, now: now(), projectId, runId, taskId,
      baseRevision: fixture.baselineRevision, claimedFile: fixture.claimedFile,
      protectedPaths: fixture.protectedPaths,
    });
    const toolPolicy = claudeToolPolicyFor(pkg, options.claude.capabilities);
    const implementPrompt = claudePromptFor({
      pkg, runId, taskId, workspaceRelativeRoot: '.',
      readOnlyFiles: fixture.protectedPaths.readOnly,
      protectedFiles: [...fixture.protectedPaths.forbidden, '.git'],
      relayVerificationCommands: [RELAY_VERIFY_COMMAND], limits: claudeLimits,
    });

    emit('CLAUDE CODE', '  Live implementation session started.', '');
    const implStartedAt = now();
    result.claudeInvocations += 1;
    // Budget consumption is persisted BEFORE the launch — a crash between
    // this record and the process start can never produce an unaccounted call.
    persist('provider_launch_authorized', {
      provider: 'claude', attempt: 1, purpose: 'implementation',
      lifecycleAfter: 'implementation_running', phase: 'implementation',
    });
    const implementation = await claudeAdapter.invoke({
      executablePath: options.claude.executablePath, capabilities: options.claude.capabilities,
      association: claudeAssoc, pkg, workspacePath: ws.workspacePath, toolPolicy,
      prompt: implementPrompt, attempt: 1, limits: claudeLimits, baseEnv: options.baseEnv, now: implStartedAt,
    });
    adapterEvents.push(...implementation.events);

    if (implementation.sessionId) {
      const captured = claudeAdapter.sessions.capture(claudeAssoc, implementation.sessionId);
      if (captured.ok) result.claudeSessionCaptured = implementation.sessionId;
      persist('implementer_initialization_verified', {
        sessionRef: {
          provider: 'claude', adapterId: CLAUDE_ADAPTER_ID, relayRef: `claude-${runId}`,
          providerSessionId: implementation.sessionId, attempt: 1,
          executionAuthor: 'claude-code', independenceGroup: 'implementers',
          initializationVerified: true, resumeEligible: true,
        },
      });
    }
    if (implementation.outcome.cancelled || implementation.outcome.timedOut || implementation.outcome.spawnError) {
      return finishStopped('Claude process did not complete normally.');
    }
    if (!implementation.structurallyValid) {
      return finishStopped(`Claude output was not usable: ${implementation.structuralReason}.`);
    }
    if (!implementation.report.ok) {
      return finishStopped(`Claude report could not be trusted: ${implementation.report.error.message}`);
    }
    result.implementationReportAttempts.push(implementation.report.value.attempt);
    persist('implementer_report_received', {
      attempt: implementation.report.value.attempt, reportStatus: implementation.report.value.status,
      lifecycleAfter: 'held_for_inspection', phase: 'inspection',
    });
    emit('CLAUDE CODE', '  Execution report received.', '  This is a claim, not proof.', '');

    /* ---------------- 3. Relay inspection ---------------- */
    const inspect1 = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!inspect1.ok) return finishStopped(`Workspace inspection failed: ${inspect1.error.message}`);
    const insp1: WorkspaceInspection = inspect1.value.value;
    result.inspectionAssessments.push(insp1.assessment);
    result.filesChanged = insp1.claimedChanges;
    result.protectedChanges = insp1.protectedChanges;
    if (insp1.assessment !== 'allowed') {
      emit('RELAY INSPECTION',
        insp1.assessment === 'clean' ? '  No file changed — nothing to verify or review.'
          : `  Unauthorized change detected (${insp1.assessment}).`, '');
      return finishStopped(`Workspace inspection rejected the change (${insp1.assessment}). Workspace preserved.`);
    }
    emit('RELAY INSPECTION',
      `  ${insp1.claimedChanges.length} claimed file changed.`,
      `  ${insp1.protectedChanges.length} protected files changed.`,
      '  Source worktree unchanged.', '');
    result.outputVisibility = 'held_for_verification';
    persist('workspace_inspected', {
      revision: insp1.revision, assessment: insp1.assessment,
      claimedChanges: insp1.claimedChanges, protectedChanges: insp1.protectedChanges,
      workspacePath: ws.workspacePath, claimedFiles: [fixture.claimedFile],
      lifecycleAfter: 'held_for_verification', phase: 'verification',
      visibilityAfter: 'held_for_verification',
    });

    /* ---------------- 4. Relay-controlled verification ---------------- */
    result.verificationRuns += 1;
    const verify1 = await workspace.executeCommand({
      commandId: `supervised-verify-1-${taskId}`, projectId, runId, taskId, workspaceId: ws.workspaceId,
      executable: 'node', args: RELAY_TEST_ARGS, expectedPurpose: 'fixture test verification', timeoutMs: 60_000,
    });
    if (!verify1.ok) return finishStopped(`Verification could not run: ${verify1.error.message}`);
    const verified1 = verify1.value.value.status === 'completed';
    result.verificationsPassed.push(verified1);
    persist('verification_completed', {
      command: RELAY_VERIFY_COMMAND, passed: verified1, exitStatus: verified1 ? 0 : 1,
      workspaceRevision: insp1.revision, criterionIds: ['AC-1'],
      sourceActor: 'relay-workspace', verificationAuthority: 'relay-workspace',
      ...(verified1 ? { lifecycleAfter: 'held_for_review' as const, visibilityAfter: 'held_for_review' as const, phase: 'review' } : {}),
    });
    emit('RELAY VERIFICATION',
      `  ${badge(verified1 ? 'PASS' : 'FAIL')} ${RELAY_VERIFY_COMMAND}`,
      `  ${badge('PASS')} File-claim policy`,
      `  ${badge('PASS')} Protected-path policy`, '');
    if (!verified1) {
      return finishStopped('Relay verification did not pass — no review is dispatched for a failing implementation.', 3);
    }

    /* Implementer Execution Attestation — truthful requested vs actual. */
    const implementerAttestation = buildExecutionAttestation({
      attestationId: ids.next('aud'), projectId, missionId, taskId, runId,
      requestedAgentId: 'claude-code', requestedAgentType: 'claude-code', requestedRole: IMPLEMENTER_ROLE,
      actualAgentId: 'claude-code', actualAgentType: 'claude-code', actualRole: IMPLEMENTER_ROLE,
      adapterId: CLAUDE_ADAPTER_ID, runtimeVersion: options.claude.capabilities.version,
      externalSessionId: implementation.sessionId, workspaceId: ws.workspaceId,
      startedAt: implStartedAt, finishedAt: now(),
      launchRequested: true, launchVerified: true, completionSignalReceived: true,
      workspaceInspectionCompleted: true, verificationCompleted: true,
      outputSummary: `implementation report attempt 1, ${insp1.claimedChanges.length} claimed change(s)`,
      activitySummary: `${implementation.events.length} normalized implementer events`,
      evidenceIds: workspace.collectEvidence().map((e) => e.evidenceId),
      provenance: 'live',
    });
    if (!implementerAttestation.ok) {
      return finishStopped(`Implementer attestation rejected: ${implementerAttestation.error.message}`);
    }
    result.implementerAttestation = implementerAttestation.value;

    /* ---------------- 5. output held; independent review ---------------- */
    result.outputVisibility = 'held_for_review';
    emit('OUTPUT', '  HELD FOR REVIEW', '');

    const reviewContext: ReviewerPromptContext = {
      missionId, missionRevision: 1, taskId, taskRevision: 1, reviewId,
      reviewerRole: REVIEWER_ROLE,
      independenceRequirement: 'You must be independent from the implementer (different provider, adapter, and session).',
      missionObjective: MISSION_OBJECTIVE,
      requirements: REVIEW_REQUIREMENTS,
      acceptanceCriteria: ACCEPTANCE_CRITERIA,
      workspaceRevision: insp1.revision,
      changedFiles: insp1.claimedChanges,
      diffSummary: `${insp1.claimedChanges.length} file changed (${insp1.claimedChanges.join(', ')})`,
      implementerIdentityLabel: `${CLAUDE_ADAPTER_ID} (live implementer)`,
      implementerAttestationRef: implementerAttestation.value.attestationId,
      verificationEvidence: [{ command: RELAY_VERIFY_COMMAND, status: 'passed' }],
      knownLimitations: ['Relay verification covers only the existing fixture tests.'],
      protectedPaths: fixture.protectedPaths.forbidden,
      filesOutOfScope: ['package.json', 'README.md'],
      securityConstraints: ['no secret exposure', 'no scope expansion', 'read-only review'],
    };

    emit('CODEX REVIEWER', '  Live independent review started.', '');
    const preReview1 = snapshot(insp1);
    const review1StartedAt = now();
    result.codexInvocations += 1;
    persist('provider_launch_authorized', {
      provider: 'codex', attempt: 1, purpose: 'independent review', phase: 'review',
    });
    const review1 = await codexAdapter.invokeReview({
      executablePath: options.codex.executablePath, capabilities: options.codex.capabilities,
      association: codexAssoc, promptContext: reviewContext, workspacePath: ws.workspacePath,
      expected: { reviewId, missionId, taskId, missionRevision: 1, taskRevision: 1, workspaceRevision: insp1.revision },
      attempt: 1, limits: codexLimits, baseEnv: options.baseEnv, now: review1StartedAt,
    });
    adapterEvents.push(...review1.events);

    if (review1.sessionId) {
      const captured = codexAdapter.sessions.capture(codexAssoc, review1.sessionId);
      if (captured.ok) result.codexSessionCaptured = review1.sessionId;
      persist('reviewer_initialization_verified', {
        sessionRef: {
          provider: 'codex', adapterId: CODEX_REVIEWER_ADAPTER_ID, relayRef: reviewId,
          providerSessionId: review1.sessionId, attempt: 1,
          executionAuthor: 'codex', independenceGroup: 'reviewers',
          initializationVerified: true, resumeEligible: true,
        },
      });
    }
    const launchVerified1 = review1.structurallyValid && !!review1.sessionId;
    if (review1.outcome.cancelled || review1.outcome.timedOut || review1.outcome.spawnError) {
      return finishStopped('Codex reviewer process did not complete normally.');
    }
    if (!launchVerified1) return finishStopped(review1.structuralReason ?? 'Codex launch was not verified.');
    if (!review1.report.ok) return finishStopped(`Review report rejected: ${review1.report.error.message}`);
    const report1 = review1.report.value;
    result.reviewVerdicts.push(report1.verdict);

    /* Reviewer must have changed ZERO files; source must be untouched. */
    const postInspect1 = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!postInspect1.ok) return finishStopped(`Post-review inspection failed: ${postInspect1.error.message}`);
    const post1 = postInspect1.value.value;
    result.inspectionAssessments.push(post1.assessment);
    const reviewerChanges1 = diffSnapshots(preReview1, snapshot(post1));
    result.reviewerFileChanges = reviewerChanges1;
    if (reviewerChanges1.length > 0 || post1.untrackedFiles.length > insp1.untrackedFiles.length) {
      return finishStopped(`Reviewer modified the workspace (${reviewerChanges1.join(', ') || 'new untracked files'}) — review rejected.`);
    }
    const sourceCheck1 = workspace.verifySourceUnchanged(ws.workspaceId);
    result.sourceUnchanged = sourceCheck1.ok ? !sourceCheck1.value.value.changed : false;
    if (!result.sourceUnchanged) return finishStopped('Source repository changed during the workflow — stopped.');

    const reviewerAttestation1 = buildReviewerAttestation({
      attestationId: ids.next('aud'), projectId, missionId, taskId, runId,
      requestedReviewerId: 'codex', actualReviewerId: 'codex', adapterId: CODEX_REVIEWER_ADAPTER_ID,
      runtimeVersion: options.codex.capabilities.version, codexSessionId: review1.sessionId,
      workspaceId: ws.workspaceId, policyReference: 'supervised-independent-review',
      startedAt: review1StartedAt, finishedAt: now(),
      launchRequested: true, launchVerified: launchVerified1, reportReceived: true,
      workspaceInspectionCompleted: true,
      reviewContractSummary: 'independent read-only review contract',
      activitySummary: `${review1.events.length} normalized reviewer events`,
      reportSummary: `verdict ${report1.verdict}, ${report1.findings.length} finding(s)`,
      evidenceIds: workspace.collectEvidence().map((e) => e.evidenceId),
    });
    if (!reviewerAttestation1.ok) return finishStopped(`Reviewer attestation rejected: ${reviewerAttestation1.error.message}`);
    if (!attestsSuccessfulExecution(reviewerAttestation1.value)) {
      return finishStopped('Reviewer attestation does not prove a completed independent review.');
    }
    result.reviewerAttestations.push(reviewerAttestation1.value);

    emit('RELAY ATTESTATION',
      '  Requested Implementer: Claude Code   Actual: Claude Code',
      '  Requested Reviewer: Codex            Actual: Codex',
      '  Reviewer sandbox: Read only',
      '  Fallback: None', '');

    /* needs_human short-circuits — a human decision is required. */
    if (report1.verdict === 'needs_human') {
      persist('review_received', { verdict: 'needs_human', attempt: 1 });
      emit('INDEPENDENT REVIEW', '  NEEDS HUMAN', '  A human decision is required — output remains held.', '');
      return finishStopped('Reviewer requested a human decision — a Manual Task is required.', 3);
    }

    /* Relay — not Codex — makes the gate decision. */
    const independence = {
      reviewer: { agentId: CODEX_REVIEWER_ADAPTER_ID, sessionId: review1.sessionId, adapterId: CODEX_REVIEWER_ADAPTER_ID, independenceGroup: 'reviewers' },
      implementer: { agentId: CLAUDE_ADAPTER_ID, sessionId: implementation.sessionId, adapterId: CLAUDE_ADAPTER_ID, independenceGroup: 'implementers' },
    };
    const gateLedgerBase = {
      missionId, taskId, reviewerRunId: runId, missionRevision: 1, taskRevision: 1,
      workspaceRevision: insp1.revision,
      originalClaimedFiles: [fixture.claimedFile],
      affectedCriterionIds: ACCEPTANCE_CRITERIA.filter((c) => c.blocking).map((c) => c.id),
      maxRepairIterations: 1,
    };
    const gate1: ReviewerGateResult = evaluateReviewerGate({
      entitlement: 'pro', verificationPassed: verified1, runStatus: 'completed',
      reviewer: independence.reviewer, implementer: independence.implementer,
      ledger: {
        ...gateLedgerBase,
        reviews: [toGateReview(report1, 1)],
        postRepairEvidenceIds: [], repairDispatched: false, now: now(),
      },
      completionPolicySatisfied: false,
    });
    result.reviewerIndependent = gate1.independent;
    if (!gate1.independent) return finishStopped('Reviewer independence could not be established — review rejected.');
    result.findings = gate1.ledger.findings;
    result.repairs = gate1.ledger.repairs;
    result.blockingFindingsOpen = gate1.blockingFindingsOpen;
    result.outputVisibility = report1.verdict === 'blocked' ? 'blocked' : gate1.visibility;
    persist('review_received', {
      verdict: report1.verdict, attempt: 1,
      findings: gate1.ledger.findings, repairs: gate1.ledger.repairs,
      attestation: reviewerAttestation1.value,
      visibilityAfter: result.outputVisibility,
      ...(report1.verdict === 'approved'
        ? { lifecycleAfter: 'approved_for_release' as const, phase: 'completion' }
        : report1.verdict === 'changes_required'
          ? { lifecycleAfter: 'revision_required' as const, phase: 'repair-decision' }
          : {}),
    });

    const task: RelayTask = {
      taskId, projectId, runId, objective: MISSION_OBJECTIVE, category: 'implementation',
      status: 'working', ownerAssignmentId: null, dependencies: [], claimedFiles: [fixture.claimedFile],
      claimedResources: [], acceptanceCriteria: pkg.acceptanceCriteria,
      completionPolicyId: SUPERVISED_COMPLETION_POLICY.policyId,
      contextVersion: 0 as ContextVersion, baseRevision: fixture.baselineRevision,
      createdAt: now(), updatedAt: now(), priority: 1,
    };

    const completeVerified = (input: {
      reviews: ReviewInput[];
      repairDispatched: boolean;
      postRepairEvidenceIds: string[];
      repairCount: 0 | 1;
    }): SupervisedProofResult => {
      const resolvedIds = result.findings.filter((f) => f.status === 'resolved').map((f) => f.findingId);
      const reviewerVerdict: ReviewerVerdictRecord = {
        reportId: `rpt_${reviewId}` as ReportId,
        reviewerAssignmentId: `asg_${reviewId}` as AssignmentId,
        verdict: 'approved',
        findings: result.findings.map((f) => ({
          id: f.findingId,
          severity: f.severity === 'critical' ? 'critical' : f.severity === 'minor' ? 'minor' : 'major',
          title: f.title, detail: f.description, recommendation: f.requiredAction,
        })),
        independent: gate1.independent,
        provenance: 'live',
      };
      const completion = evaluateCompletionPolicy({
        policy: SUPERVISED_COMPLETION_POLICY, task, evidence: workspace.collectEvidence(),
        reviewerVerdict, resolvedFindingIds: resolvedIds,
        currentRepositoryRevision: fixture.baselineRevision, currentTime: now(),
        enforcementCapabilities: { 'worktree-isolation': 'enforced' },
      });
      result.completionOutcome = completion.outcome;
      persist('completion_evaluated', { outcome: completion.outcome, safeSummary: completion.safeSummary });
      if (completion.outcome !== 'satisfied') {
        emit('COMPLETION POLICY', `  ${completion.safeSummary}`, '');
        return finishStopped('The completion policy is not satisfied — output is not released.', 3);
      }
      const finalGate = evaluateReviewerGate({
        entitlement: 'pro', verificationPassed: true, runStatus: 'completed',
        reviewer: independence.reviewer, implementer: independence.implementer,
        ledger: {
          ...gateLedgerBase,
          reviews: input.reviews,
          postRepairEvidenceIds: input.postRepairEvidenceIds,
          repairDispatched: input.repairDispatched, now: now(),
        },
        completionPolicySatisfied: true,
      });
      result.outputVisibility = finalGate.visibility;
      result.findings = finalGate.ledger.findings;
      result.repairs = finalGate.ledger.repairs;
      result.blockingFindingsOpen = finalGate.blockingFindingsOpen;

      const audit: FinalAuditReport = {
        auditId: ids.next('aud') as AuditId, runId, projectId, at: now(), outcome: 'verified-complete',
        objective: MISSION_OBJECTIVE, taskRefs: [taskId], verificationRefs: [],
        reviewRefs: [`rpt_${reviewId}` as ReportId], repairCount: input.repairCount,
        evidenceBundleRefs: [], usageSummary: {}, checkpoints: [], provenanceProfile: 'live',
        unresolvedQuestions: [],
        identities: { codingAgent: CLAUDE_ADAPTER_ID, reviewer: CODEX_REVIEWER_ADAPTER_ID, verification: 'relay-workspace' },
        baseRevision: fixture.baselineRevision,
        completionPolicyId: SUPERVISED_COMPLETION_POLICY.policyId,
        completionReason: input.repairCount === 0
          ? 'Live Claude implementation verified by Relay and genuinely approved by the live independent Codex review.'
          : 'Live Claude repair re-verified by Relay and genuinely approved by the resumed live independent Codex re-review.',
        remainingIssues: [],
      };
      workspace.cleanupWorkspace(ws.workspaceId, { authorizeRemoval: true });
      persist('cleanup_completed', { workspaceId: ws.workspaceId });
      persist('verified_complete', {
        repairCount: input.repairCount, auditOutcome: 'verified-complete',
        lifecycleAfter: 'verified_complete', visibilityAfter: 'released', phase: 'complete',
      });
      result.audit = audit;
      emit('FINAL AUDIT',
        '  Outcome: verified-complete',
        `  Implementer: Claude Code (live)   Reviewer: Codex (live, independent)`,
        `  Repairs used: ${input.repairCount} of 1`, '',
        'RELAY COMPLETE');
      result.exitCode = 0;
      finish();
      return result;
    };

    /* ---------------- PATH A: genuine approval ---------------- */
    if (report1.verdict === 'approved') {
      emit('INDEPENDENT REVIEW', '  APPROVED', '  Genuine reviewer approval — evaluating the completion policy.', '');
      result.path = 'approved_first_review';
      return completeVerified({
        reviews: [toGateReview(report1, 1)],
        repairDispatched: false, postRepairEvidenceIds: [], repairCount: 0,
      });
    }

    if (report1.verdict === 'blocked') {
      emit('INDEPENDENT REVIEW', '  BLOCKED', '  The reviewer blocked this work — a human decision is required.', '');
      return finishStopped('Reviewer blocked the work — output remains blocked.', 3);
    }

    /* ---------------- PATH B: genuine validated finding ---------------- */
    const blockingFromReport = report1.findings.filter((f) => f.blocking);
    const firstFinding = blockingFromReport[0] ?? report1.findings[0];
    emit('INDEPENDENT REVIEW', '  CHANGES REQUIRED', '',
      'Blocking finding (reviewer\'s own words):',
      `  ${firstFinding ? firstFinding.title : 'A blocking finding was reported.'}`, '',
      'REPAIR LEDGER',
      `  Finding ${result.findings[0]?.findingId ?? 'F-1'} created.`,
      `  Repair ${result.repairs[0]?.repairId ?? 'R-1'} created.`,
      '  Output remains held.', '');
    persist('finding_created', { findings: result.findings });
    persist('repair_created', { repairs: result.repairs });

    /* -- 6. bounded repair: the EXACT original Claude session resumes -- */
    const resumePlan = claudeAdapter.sessions.prepareResume(claudeAssoc);
    if (!resumePlan.ok) return finishStopped(`Cannot resume the implementer session: ${resumePlan.error.message}`);

    const revisionContract: RevisionContract = {
      packageId: ids.next('pkg') as PackageId,
      parentPackageId: pkg.packageId,
      findingsTargeted: result.findings.map((f) => f.findingId),
      narrowScope: { sameTask: true, sameFiles: true, sameAssignment: true },
      conditionsChecked: [],
      taskId,
      requiredCorrection: firstFinding?.requiredAction ?? 'Address the reviewer finding within the original scope.',
      allowedFiles: [fixture.claimedFile],
      verificationToRerun: [RELAY_VERIFY_COMMAND],
      baseRevision: fixture.baselineRevision,
    };
    const repairPrompt = claudeRevisionPromptFor({
      revision: revisionContract, runId, taskId,
      findingSummaries: result.findings.map((f) => `${f.findingId}: ${f.title} — ${f.requiredAction}`),
      relayVerificationCommands: [RELAY_VERIFY_COMMAND],
    });

    emit('CLAUDE CODE', '  Exact original session resumed for ONE bounded repair.', '');
    result.claudeInvocations += 1;
    result.repairDispatched = true;
    // Resume authorization + budget consumption persist BEFORE the launch.
    persist('session_resume_authorized', {
      provider: 'claude', attempt: 2, purpose: 'bounded repair',
      lifecycleAfter: 'repair_authorized', phase: 'repair',
    });
    const repair = await claudeAdapter.invoke({
      executablePath: options.claude.executablePath, capabilities: options.claude.capabilities,
      association: claudeAssoc, pkg, workspacePath: ws.workspacePath, toolPolicy,
      prompt: repairPrompt, attempt: 2, resumeSessionId: resumePlan.value.claudeSessionId,
      limits: claudeLimits, baseEnv: options.baseEnv, now: now(),
    });
    adapterEvents.push(...repair.events);

    const confirmed = claudeAdapter.sessions.confirmResume(claudeAssoc, repair.sessionId);
    if (!confirmed.ok) return finishStopped(`Resumed implementer session rejected: ${confirmed.error.message}`);
    result.claudeResumeConfirmed = true;
    persist('implementer_initialization_verified', {
      sessionRef: {
        provider: 'claude', adapterId: CLAUDE_ADAPTER_ID, relayRef: `claude-${runId}`,
        providerSessionId: repair.sessionId, attempt: 2,
        executionAuthor: 'claude-code', independenceGroup: 'implementers',
        initializationVerified: true, resumeEligible: false,
      },
      lifecycleAfter: 'repair_running', phase: 'repair',
    });
    if (repair.outcome.cancelled || repair.outcome.timedOut || repair.outcome.spawnError) {
      return finishStopped('Claude repair process did not complete normally.');
    }
    if (!repair.structurallyValid) return finishStopped(`Claude repair output was not usable: ${repair.structuralReason}.`);
    if (!repair.report.ok) return finishStopped(`Claude repair report could not be trusted: ${repair.report.error.message}`);
    result.implementationReportAttempts.push(repair.report.value.attempt);
    if (repair.report.value.attempt !== 2) {
      return finishStopped('Repair report did not acknowledge attempt 2 — refusing to continue.');
    }
    persist('repair_received', {
      attempt: 2, reportStatus: repair.report.value.status,
      lifecycleAfter: 'held_for_inspection', phase: 're-inspection',
    });

    /* -- 7. Relay re-inspection + re-verification -- */
    const inspect2 = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!inspect2.ok) return finishStopped(`Post-repair inspection failed: ${inspect2.error.message}`);
    const insp2 = inspect2.value.value;
    result.inspectionAssessments.push(insp2.assessment);
    result.filesChanged = insp2.claimedChanges;
    result.protectedChanges = insp2.protectedChanges;
    if (insp2.assessment !== 'allowed') {
      return finishStopped(`Post-repair inspection rejected the change (${insp2.assessment}). Workspace preserved.`);
    }
    persist('workspace_inspected', {
      revision: insp2.revision, assessment: insp2.assessment,
      claimedChanges: insp2.claimedChanges, protectedChanges: insp2.protectedChanges,
      workspacePath: ws.workspacePath, claimedFiles: [fixture.claimedFile],
      lifecycleAfter: 'held_for_reverification', phase: 're-verification',
    });

    const preRepairEvidenceIds = new Set(workspace.collectEvidence().map((e) => e.evidenceId));
    result.verificationRuns += 1;
    const verify2 = await workspace.executeCommand({
      commandId: `supervised-verify-2-${taskId}`, projectId, runId, taskId, workspaceId: ws.workspaceId,
      executable: 'node', args: RELAY_TEST_ARGS, expectedPurpose: 'post-repair test verification', timeoutMs: 60_000,
    });
    if (!verify2.ok) return finishStopped(`Re-verification could not run: ${verify2.error.message}`);
    const verified2 = verify2.value.value.status === 'completed';
    result.verificationsPassed.push(verified2);
    const postRepairEvidenceIds = workspace.collectEvidence()
      .map((e) => e.evidenceId).filter((id) => !preRepairEvidenceIds.has(id));
    result.postRepairEvidenceIds = postRepairEvidenceIds;
    persist('re_verification_completed', {
      command: RELAY_VERIFY_COMMAND, passed: verified2, exitStatus: verified2 ? 0 : 1,
      workspaceRevision: insp2.revision, criterionIds: ['AC-1'],
      sourceActor: 'relay-workspace', verificationAuthority: 'relay-workspace',
      postRepairEvidenceIds,
      ...(verified2 ? { lifecycleAfter: 'held_for_rereview' as const, visibilityAfter: 'held_for_review' as const, phase: 're-review' } : {}),
    });
    emit('RELAY RE-VERIFICATION',
      `  ${badge(verified2 ? 'PASS' : 'FAIL')} ${RELAY_VERIFY_COMMAND}`, '');
    if (!verified2) {
      return finishStopped('Post-repair verification did not pass — output remains held.', 3);
    }

    /* -- 8. re-review: the EXACT original Codex session resumes -- */
    const reviewResume = codexAdapter.sessions.prepareResume(codexAssoc);
    if (!reviewResume.ok) return finishStopped(`Cannot resume the reviewer session: ${reviewResume.error.message}`);

    const reReviewContext: ReviewerPromptContext = {
      ...reviewContext,
      workspaceRevision: insp2.revision,
      changedFiles: insp2.claimedChanges,
      diffSummary: `re-review after repair ${result.repairs[0]?.repairId ?? 'R-1'} (${insp2.claimedChanges.length} file(s))`,
      verificationEvidence: [{ command: RELAY_VERIFY_COMMAND, status: 'passed' }],
      knownLimitations: ['This is the re-review of the single bounded Guided repair.'],
    };

    emit('CODEX REVIEWER', '  Exact original session resumed for re-review.', '');
    const review2StartedAt = now();
    result.codexInvocations += 1;
    persist('session_resume_authorized', {
      provider: 'codex', attempt: 2, purpose: 're-review', phase: 're-review',
    });
    const review2 = await codexAdapter.invokeReview({
      executablePath: options.codex.executablePath, capabilities: options.codex.capabilities,
      association: codexAssoc, promptContext: reReviewContext, workspacePath: ws.workspacePath,
      expected: { reviewId, missionId, taskId, missionRevision: 1, taskRevision: 1, workspaceRevision: insp2.revision },
      attempt: 2, resumeSessionId: reviewResume.value.codexSessionId,
      limits: codexLimits, baseEnv: options.baseEnv, now: review2StartedAt,
    });
    adapterEvents.push(...review2.events);

    const reviewConfirmed = codexAdapter.sessions.confirmResume(codexAssoc, review2.sessionId);
    if (!reviewConfirmed.ok) return finishStopped(`Resumed reviewer session rejected: ${reviewConfirmed.error.message}`);
    result.codexResumeConfirmed = true;
    if (review2.outcome.cancelled || review2.outcome.timedOut || review2.outcome.spawnError) {
      return finishStopped('Codex re-review process did not complete normally.');
    }
    if (!(review2.structurallyValid && review2.sessionId)) {
      return finishStopped(review2.structuralReason ?? 'Codex re-review launch was not verified.');
    }
    if (!review2.report.ok) return finishStopped(`Re-review report rejected: ${review2.report.error.message}`);
    const report2 = review2.report.value;
    result.reviewVerdicts.push(report2.verdict);

    const preReview2 = snapshot(insp2);
    const postInspect2 = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!postInspect2.ok) return finishStopped(`Post-re-review inspection failed: ${postInspect2.error.message}`);
    const post2 = postInspect2.value.value;
    result.inspectionAssessments.push(post2.assessment);
    const reviewerChanges2 = diffSnapshots(preReview2, snapshot(post2));
    if (reviewerChanges2.length > 0 || post2.untrackedFiles.length > insp2.untrackedFiles.length) {
      return finishStopped(`Reviewer modified the workspace during re-review (${reviewerChanges2.join(', ') || 'new untracked files'}) — re-review rejected.`);
    }
    const sourceCheck2 = workspace.verifySourceUnchanged(ws.workspaceId);
    result.sourceUnchanged = sourceCheck2.ok ? !sourceCheck2.value.value.changed : false;
    if (!result.sourceUnchanged) return finishStopped('Source repository changed during the workflow — stopped.');

    const reviewerAttestation2 = buildReviewerAttestation({
      attestationId: ids.next('aud'), projectId, missionId, taskId, runId,
      requestedReviewerId: 'codex', actualReviewerId: 'codex', adapterId: CODEX_REVIEWER_ADAPTER_ID,
      runtimeVersion: options.codex.capabilities.version, codexSessionId: review2.sessionId,
      workspaceId: ws.workspaceId, policyReference: 'supervised-independent-review',
      startedAt: review2StartedAt, finishedAt: now(),
      launchRequested: true, launchVerified: true, reportReceived: true,
      workspaceInspectionCompleted: true,
      reviewContractSummary: 'independent read-only re-review contract',
      activitySummary: `${review2.events.length} normalized reviewer events`,
      reportSummary: `verdict ${report2.verdict}, ${report2.findings.length} finding(s)`,
      evidenceIds: workspace.collectEvidence().map((e) => e.evidenceId),
    });
    if (!reviewerAttestation2.ok) return finishStopped(`Re-review attestation rejected: ${reviewerAttestation2.error.message}`);
    if (!attestsSuccessfulExecution(reviewerAttestation2.value)) {
      return finishStopped('Re-review attestation does not prove a completed independent review.');
    }
    result.reviewerAttestations.push(reviewerAttestation2.value);

    if (report2.verdict === 'needs_human') {
      persist('re_review_received', { verdict: 'needs_human', attempt: 2 });
      emit('INDEPENDENT RE-REVIEW', '  NEEDS HUMAN', '  A human decision is required — output remains held.', '');
      return finishStopped('Re-reviewer requested a human decision — a Manual Task is required.', 3);
    }

    const reviews = [toGateReview(report1, 1), toGateReview(report2, 2)];
    const gate2 = evaluateReviewerGate({
      entitlement: 'pro', verificationPassed: verified2, runStatus: 'completed',
      reviewer: independence.reviewer, implementer: independence.implementer,
      ledger: {
        ...gateLedgerBase,
        reviews, postRepairEvidenceIds, repairDispatched: true, now: now(),
      },
      completionPolicySatisfied: false,
    });
    result.findings = gate2.ledger.findings;
    result.repairs = gate2.ledger.repairs;
    result.blockingFindingsOpen = gate2.blockingFindingsOpen;
    result.outputVisibility = report2.verdict === 'blocked' ? 'blocked' : gate2.visibility;
    persist('re_review_received', {
      verdict: report2.verdict, attempt: 2,
      findings: gate2.ledger.findings, repairs: gate2.ledger.repairs,
      attestation: reviewerAttestation2.value,
      visibilityAfter: result.outputVisibility,
      ...(report2.verdict === 'approved' && gate2.blockingFindingsOpen === 0
        ? { lifecycleAfter: 'approved_for_release' as const, phase: 'completion' }
        : {}),
    });

    if (report2.verdict === 'approved' && gate2.blockingFindingsOpen === 0) {
      emit('INDEPENDENT RE-REVIEW', '  APPROVED',
        `  Finding ${result.findings[0]?.findingId ?? 'F-1'} resolved by post-repair evidence + approving re-review.`, '');
      result.path = 'repaired_after_re_review';
      return completeVerified({
        reviews, repairDispatched: true, postRepairEvidenceIds, repairCount: 1,
      });
    }

    /* The single Guided repair is exhausted — never a second repair. */
    emit('INDEPENDENT RE-REVIEW',
      report2.verdict === 'blocked' ? '  BLOCKED' : '  CHANGES STILL REQUIRED', '',
      'REPAIR LIMIT',
      '  The single bounded Guided repair has been used.',
      '  Relay will not dispatch a second automatic repair.',
      '  A human decision is required — output remains held.', '');
    return finishStopped('Re-review did not approve and the single repair is exhausted — a human decision is required.', 3);
  } finally {
    try { rmSync(fixture.fixtureRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export type { ClaudeCodeCapabilityProfile, CodexReviewerCapabilityProfile };
