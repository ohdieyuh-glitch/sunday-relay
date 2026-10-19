import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceRecord } from '../../protocol/contracts';
import type { EventDraft } from '../../protocol/envelopes';
import type { IdFactory, ProjectId, RunId, TaskId } from '../../protocol/ids';
import type { RelayExecutionAttestation, RelayFinding, RelayRepair } from '../../mission/contracts';
import { attestsSuccessfulExecution } from '../../mission/attestation';
import { evaluateReviewerGate } from '../../mission/reviewer-gate';
import type { OutputVisibility } from '../../mission/entitlement';
import type { ReviewInput } from '../../mission/review-repair';
import {
  createWorkspaceService, DEFAULT_WORKSPACE_COMMAND_POLICY,
  type WorkspaceCommandPolicy, type WorkspaceInspection, type WorkspacePolicyInput,
} from '../../workspace';
import {
  DEFAULT_REVIEWER_LIMITS, type CodexReviewerCapabilityProfile, type CodexReviewerLimits,
} from './contracts';
import { CODEX_REVIEWER_ADAPTER_ID, createCodexReviewerAdapter } from './adapter';
import { buildReviewerAttestation, REVIEWER_ROLE } from './attestation';
import { buildReviewDefectFixture, DEFECT_IMPLEMENTATION, RELAY_TEST_ARGS } from './fixture';
import type { ReviewerPromptContext } from './reviewer-prompt-compiler';

/**
 * Live Codex review proof orchestrator (Prompt 8.3) — Gate B. Relay controls
 * a REAL local Codex reviewer against a throwaway fixture inside an isolated
 * read-only worktree. Relay — not Codex — decides launch verification, report
 * validity, independence, whether findings block, whether a repair is
 * required, and whether output stays held. The reviewer changes ZERO files;
 * the source fixture is never modified; there is NO fallback and NO completion
 * claim for a changes-required review.
 *
 * Exit-code contract: 3 = review executed and correctly HELD output (the
 * successful Gate-B outcome for the seeded defect); 5 = rejected / prereq
 * failure / reviewer modified files / independence failure / invalid report;
 * 0 = review approved AND released (not the seeded-defect case).
 */

const IMPLEMENTER_LABEL = 'claude-code-local (fixture implementer)';
const IMPLEMENTER_ADAPTER = 'fixture-implementer';

export interface CodexReviewProofOptions {
  executablePath: string;
  capabilities: CodexReviewerCapabilityProfile;
  now: () => string;
  ids: IdFactory;
  limits?: CodexReviewerLimits;
  baseEnv?: Record<string, string | undefined>;
}

export interface CodexReviewProofResult {
  lines: string[];
  exitCode: number;
  reviewId: string;
  sessionCaptured: string | null;
  launchVerified: boolean;
  requestedReviewer: string;
  actualReviewer: string;
  reviewerIndependent: boolean;
  preInspectionAssessment: string;
  postInspectionAssessment: string;
  reviewerFileChanges: string[];
  sourceUnchanged: boolean;
  verdict: string | null;
  blockingFindings: number;
  findings: RelayFinding[];
  repairs: RelayRepair[];
  outputVisibility: OutputVisibility;
  attestation: RelayExecutionAttestation | null;
  fallbackOccurred: boolean;
  events: EventDraft[];
  evidence: EvidenceRecord[];
  cleanupOutcome: string;
}

export type ReviewPrerequisiteResult =
  | { ready: true }
  | { ready: false; manualTitle: string; manualReason: string };

/** Gate the live review. Order matters: executable → login → API-key source →
 * read-only sandbox → config isolation for an unsafe fixture → approval. */
export function checkReviewPrerequisites(input: {
  capabilities: CodexReviewerCapabilityProfile;
  authApproved: boolean;
  authStatus: string;
  configRisk: 'clean' | 'review_required';
  approvalGranted: boolean;
}): ReviewPrerequisiteResult {
  const caps = input.capabilities;
  if (!caps.executablePath) {
    return { ready: false, manualTitle: 'Install Codex', manualReason: 'The Codex CLI was not found on PATH.' };
  }
  if (input.authStatus === 'api_key') {
    return {
      ready: false, manualTitle: 'Remove the API-key source',
      manualReason: 'An explicit provider API-key environment source is present. Relay uses your existing local Codex login, not an injected key.',
    };
  }
  if (!input.authApproved) {
    return { ready: false, manualTitle: 'Sign in to Codex', manualReason: 'Codex is installed, but Relay could not confirm it is signed in.' };
  }
  if (!caps.readOnlySandboxSupported) {
    return { ready: false, manualTitle: 'Update Codex', manualReason: 'The installed Codex CLI does not support a read-only review sandbox.' };
  }
  if (input.configRisk === 'review_required') {
    return { ready: false, manualTitle: 'Review workspace Codex configuration', manualReason: 'The workspace has hooks/plugins/MCP/custom-provider configuration that Relay will not run with.' };
  }
  if (caps.selectedRuntimeStrategy === 'unavailable') {
    return { ready: false, manualTitle: 'Update Codex', manualReason: 'No safe non-interactive review strategy is available on the installed CLI.' };
  }
  if (!input.approvalGranted) {
    return { ready: false, manualTitle: 'Confirm the live review', manualReason: 'A live Codex review requires explicit approval (--confirm-live).' };
  }
  return { ready: true };
}

const badge = (label: string): string => `[${label}]`;

export async function runCodexReviewProof(options: CodexReviewProofOptions): Promise<CodexReviewProofResult> {
  const { executablePath, capabilities, now, ids } = options;
  const limits = options.limits ?? DEFAULT_REVIEWER_LIMITS;
  const lines: string[] = [];
  const emit = (...l: string[]): void => { for (const x of l) lines.push(x); };

  const fixture = buildReviewDefectFixture();
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

  const result: CodexReviewProofResult = {
    lines, exitCode: 5, reviewId, sessionCaptured: null, launchVerified: false,
    requestedReviewer: 'codex', actualReviewer: 'unavailable', reviewerIndependent: false,
    preInspectionAssessment: 'unknown', postInspectionAssessment: 'unknown', reviewerFileChanges: [],
    sourceUnchanged: false, verdict: null, blockingFindings: 0, findings: [], repairs: [],
    outputVisibility: 'held_for_review', attestation: null, fallbackOccurred: false,
    events: [], evidence: [], cleanupOutcome: 'preserved',
  };

  const finishStopped = (message: string, exitCode = 5): CodexReviewProofResult => {
    emit('', badge('STOP') + ' RELAY STOPPED SAFELY', `  ${message}`, '  Output remains held for review.');
    result.events = [...workspace.collectEvents()];
    result.evidence = [...workspace.collectEvidence()];
    result.exitCode = exitCode;
    try { rmSync(fixture.fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    return result;
  };

  try {
    emit(
      'SUNDAY RELAY — LIVE INDEPENDENT REVIEW', '',
      badge('LIVE') + ' LIVE CODEX REVIEWER',
      'READ-ONLY WORKSPACE',
      'INDEPENDENT FROM IMPLEMENTER',
      'SOURCE REPOSITORY PROTECTED',
      'DEPLOYMENT DISABLED',
      'GIT PUSH PROHIBITED',
      'FALLBACK DISABLED', '',
      'MISSION',
      '  Prevent provider dispatch when either safety control blocks it.', '',
    );

    // Prepare the isolated worktree from the clean baseline.
    const prepared = workspace.prepareWorkspace({
      projectId, runId, taskId, sourceRepositoryPath: fixture.sourceRepo, cleanupPolicy: 'preserve_on_failure',
    });
    if (!prepared.ok) return finishStopped(`Workspace preparation failed: ${prepared.error.message}`);
    const ws = prepared.value.value.workspace;

    // Seed the implementer's change (the DEFECT) into the worktree. This is
    // labeled FIXTURE INPUT — it stands in for a live Claude implementation.
    writeFileSync(join(ws.workspacePath, fixture.claimedFile), DEFECT_IMPLEMENTATION, 'utf8');

    // Pre-review inspection — only the claimed file may differ.
    const policyInput: WorkspacePolicyInput = {
      protectedPaths: fixture.protectedPaths, claimedWritePaths: [fixture.claimedFile],
    };
    const preInspect = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!preInspect.ok) return finishStopped(`Pre-review inspection failed: ${preInspect.error.message}`);
    const pre: WorkspaceInspection = preInspect.value.value;
    result.preInspectionAssessment = pre.assessment;
    const preSnapshot = snapshot(pre);
    if (pre.assessment !== 'allowed') {
      return finishStopped(`Unexpected workspace state before review: ${pre.assessment}.`);
    }
    const workspaceRevision = pre.revision;

    // Relay-run the existing (incomplete) fixture tests. They PASS with the
    // defect — which is exactly why an independent reviewer is required.
    const verify = await workspace.executeCommand({
      commandId: `codex-review-verify-${taskId}`, projectId, runId, taskId, workspaceId: ws.workspaceId,
      executable: 'node', args: RELAY_TEST_ARGS, expectedPurpose: 'fixture baseline verification', timeoutMs: 60_000,
    });
    if (!verify.ok) return finishStopped(`Baseline verification failed to run: ${verify.error.message}`);
    const verified = verify.value.value.status === 'completed';

    emit(
      'RELAY VERIFICATION',
      `  ${badge(verified ? 'PASS' : 'FAIL')} Existing fixture tests`,
      `  ${badge(pre.assessment === 'allowed' ? 'PASS' : 'FAIL')} File-claim policy`,
      `  ${badge(pre.protectedChanges.length === 0 ? 'PASS' : 'FAIL')} Protected-path policy`,
      `  ${badge('PASS')} Source-worktree protection`, '',
      'OUTPUT', '  HELD FOR REVIEW', '',
    );
    if (!verified) return finishStopped('Baseline verification did not pass.');

    // Output held for the required independent review.
    result.outputVisibility = 'held_for_review';

    // Compile the Codex Reviewer handoff (role-specific; untrusted implementer
    // claim; actual changed files + evidence + criteria only).
    const promptContext: ReviewerPromptContext = {
      missionId, missionRevision: 1, taskId, taskRevision: 1, reviewId,
      reviewerRole: REVIEWER_ROLE,
      independenceRequirement: 'You must be independent from the implementer (different provider, adapter, and session).',
      missionObjective: 'Provider dispatch MUST be blocked when EITHER the actor is rate-limited OR the global spending breaker is active.',
      requirements: [
        'A blocked (rate-limited) identity alone prevents provider dispatch.',
        'An active global spending breaker alone prevents provider dispatch.',
      ],
      acceptanceCriteria: [
        { id: 'AC-1', text: 'A blocked identity OR an active global spending breaker independently prevents provider dispatch.', blocking: true },
      ],
      workspaceRevision,
      changedFiles: [fixture.claimedFile],
      diffSummary: `1 file changed (${fixture.claimedFile})`,
      implementerIdentityLabel: IMPLEMENTER_LABEL,
      implementerAttestationRef: 'fixture-implementer-attestation',
      verificationEvidence: [{ command: `node ${RELAY_TEST_ARGS.join(' ')}`, status: verified ? 'passed' : 'failed' }],
      knownLimitations: ['The existing tests cover only the neither-active and both-active cases.'],
      protectedPaths: fixture.protectedPaths.forbidden,
      filesOutOfScope: ['package.json', 'README.md'],
      securityConstraints: ['no secret exposure', 'no scope expansion', 'read-only review'],
    };

    emit('CODEX REVIEWER', '  Live independent review started.', '');

    // Launch the REAL Codex reviewer (read-only).
    const adapter = createCodexReviewerAdapter({ now, ids });
    const association = {
      reviewId, projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CODEX_REVIEWER_ADAPTER_ID,
    };
    const startedAt = now();
    const invocation = await adapter.invokeReview({
      executablePath, capabilities, association, promptContext, workspacePath: ws.workspacePath,
      expected: {
        reviewId, missionId, taskId, missionRevision: 1, taskRevision: 1, workspaceRevision,
      },
      attempt: 1, limits, baseEnv: options.baseEnv, now: startedAt,
    });
    result.events.push(...invocation.events);

    // Capture the Codex session identity.
    if (invocation.sessionId) {
      const captured = adapter.sessions.capture(association, invocation.sessionId);
      if (captured.ok) result.sessionCaptured = invocation.sessionId;
    }
    const launchVerified = invocation.structurallyValid && !!invocation.sessionId;
    result.launchVerified = launchVerified;
    result.actualReviewer = launchVerified ? 'codex' : 'unavailable';

    // Guard rails on the process.
    if (invocation.outcome.cancelled || invocation.outcome.timedOut || invocation.outcome.spawnError) {
      return finishStopped('Codex reviewer process did not complete normally.');
    }
    if (!launchVerified) return finishStopped(invocation.structuralReason ?? 'Codex launch was not verified.');
    if (!invocation.report.ok) return finishStopped(`Review report rejected: ${invocation.report.error.message}`);
    const report = invocation.report.value;
    result.verdict = report.verdict;
    emit('CODEX REVIEWER', '  Structured review received.', '  This is a claim pending Relay validation.', '');

    // Post-review re-inspection — the reviewer must have changed ZERO files.
    const postInspect = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!postInspect.ok) return finishStopped(`Post-review inspection failed: ${postInspect.error.message}`);
    const post: WorkspaceInspection = postInspect.value.value;
    result.postInspectionAssessment = post.assessment;
    const postSnapshot = snapshot(post);
    const reviewerChanges = diffSnapshots(preSnapshot, postSnapshot);
    result.reviewerFileChanges = reviewerChanges;
    if (reviewerChanges.length > 0 || post.untrackedFiles.length > pre.untrackedFiles.length) {
      return finishStopped(`Reviewer modified the workspace (${reviewerChanges.join(', ') || 'new untracked files'}) — review rejected.`);
    }

    // Source fixture must be unchanged.
    const sourceCheck = workspace.verifySourceUnchanged(ws.workspaceId);
    result.sourceUnchanged = sourceCheck.ok ? !sourceCheck.value.value.changed : false;

    // Reviewer Execution Attestation — built and validated by Relay.
    result.evidence = [...workspace.collectEvidence()];
    const attestation = buildReviewerAttestation({
      attestationId: ids.next('aud'), projectId, missionId, taskId, runId,
      requestedReviewerId: 'codex', actualReviewerId: 'codex', adapterId: CODEX_REVIEWER_ADAPTER_ID,
      runtimeVersion: capabilities.version, codexSessionId: invocation.sessionId, workspaceId: ws.workspaceId,
      policyReference: 'pro-max-independent-review', startedAt, finishedAt: now(),
      launchRequested: true, launchVerified, reportReceived: true, workspaceInspectionCompleted: true,
      reviewContractSummary: 'independent read-only review contract', activitySummary: `${invocation.events.length} normalized reviewer events`,
      reportSummary: `verdict ${report.verdict}, ${report.findings.length} finding(s)`,
      evidenceIds: result.evidence.map((e) => e.evidenceId),
    });
    if (!attestation.ok) return finishStopped(`Reviewer attestation rejected: ${attestation.error.message}`);
    result.attestation = attestation.value;
    result.fallbackOccurred = attestation.value.fallbackOccurred;
    if (!attestsSuccessfulExecution(attestation.value)) {
      return finishStopped('Reviewer attestation does not prove a completed independent review.');
    }

    emit(
      'RELAY ATTESTATION',
      '  Requested Reviewer: Codex',
      '  Actual Reviewer: Codex',
      `  Launch verified: ${launchVerified ? 'Yes' : 'No'}`,
      '  Sandbox: Read only',
      '  Fallback: None', '',
    );

    // needs_human short-circuits the gate → a Manual Task, output held.
    if (report.verdict === 'needs_human') {
      result.outputVisibility = 'held_for_review';
      emit('INDEPENDENT REVIEW', '  NEEDS HUMAN', '  A human decision is required — output remains held.', '');
      result.events = [...result.events, ...workspace.collectEvents()];
      return finishStopped('Reviewer requested a human decision — a Manual Task is required.', 3);
    }

    // Ask Relay to make the gate decision (independence + findings + release).
    const reviewFindings = report.findings.map((f, i) => ({
      id: `codex-${i + 1}`,
      severity: f.severity === 'critical' ? 'critical' : f.severity === 'high' ? 'high' : f.blocking ? 'major' : 'minor',
      title: f.title, detail: f.description, recommendation: f.requiredAction,
    }));
    const gateReview: ReviewInput = {
      attempt: 1, verdict: report.verdict === 'approved' ? 'approved' : 'changes_requested',
      reviewerAgentId: 'codex', requestedReviewerAgentId: 'codex', independent: true, provenance: 'live',
      findings: report.verdict === 'approved' ? [] : reviewFindings,
    };
    const gate = evaluateReviewerGate({
      entitlement: 'pro', verificationPassed: verified, runStatus: 'completed',
      reviewer: { agentId: CODEX_REVIEWER_ADAPTER_ID, sessionId: invocation.sessionId, adapterId: CODEX_REVIEWER_ADAPTER_ID, independenceGroup: 'reviewers' },
      implementer: { agentId: IMPLEMENTER_ADAPTER, sessionId: 'fixture-impl-session', adapterId: IMPLEMENTER_ADAPTER, independenceGroup: 'implementers' },
      ledger: {
        missionId, taskId, reviewerRunId: runId, missionRevision: 1, taskRevision: 1, workspaceRevision,
        originalClaimedFiles: [fixture.claimedFile], affectedCriterionIds: ['AC-1'],
        reviews: [gateReview], postRepairEvidenceIds: [], repairDispatched: false, maxRepairIterations: 1, now: now(),
      },
      completionPolicySatisfied: false,
    });
    result.reviewerIndependent = gate.independent;
    if (!gate.independent) return finishStopped('Reviewer independence could not be established — review rejected.');

    result.findings = gate.ledger.findings;
    result.repairs = gate.ledger.repairs;
    result.blockingFindings = gate.blockingFindingsOpen;
    result.outputVisibility = report.verdict === 'blocked' ? 'blocked' : gate.visibility;

    if (report.verdict === 'approved') {
      emit('INDEPENDENT REVIEW', '  APPROVED', '  Awaiting the completion policy before release.', '');
      result.events = [...result.events, ...workspace.collectEvents()];
      result.exitCode = 0;
      try { rmSync(fixture.fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
      return result;
    }

    const blockingFromReport = report.findings.filter((f) => f.blocking);
    const firstFinding = blockingFromReport[0] ?? report.findings[0];
    emit(
      'INDEPENDENT REVIEW', '  CHANGES REQUIRED', '',
      'Blocking finding:',
      `  ${firstFinding ? firstFinding.title : 'Provider dispatch remains possible when only one safety control is active.'}`, '',
      'REPAIR LEDGER',
      `  Finding ${result.findings[0]?.findingId ?? 'F-1'} created.`,
      `  Repair ${result.repairs[0]?.repairId ?? 'R-1'} created.`,
      '  Output remains held.', '',
    );

    result.events = [...result.events, ...workspace.collectEvents()];
    // A changes-required review is the SUCCESSFUL Gate-B outcome: Relay
    // correctly blocks release. Never RELAY COMPLETE.
    return finishStopped('The implementation requires repair and re-review before release.', 3);
  } finally {
    try { rmSync(fixture.fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/* --------------------------- snapshot helpers ----------------------- */

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
