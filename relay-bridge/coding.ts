/**
 * CODING AGENT connector (Claude Code) — the honest coding leg.
 *
 * This mirrors the proven `runClaudeProof` / live-runner pipeline exactly
 * (isolated throwaway workspace → real Claude edit → Relay-INDEPENDENT
 * inspection → Relay-run verification → completion policy), with one change:
 * the handoff's objective + acceptance come from the REAL Sunday Alcatraz
 * architect (so "the architect result becomes the coding-agent handoff"),
 * while Relay keeps the fixed safety envelope (claimed file, protected paths,
 * tools, verification command). The agent's report is a CLAIM; Relay's
 * inspection + test run are the EVIDENCE and always win.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { RELAY_PROTOCOL_VERSION } from '../src/relay/protocol/version';
import type {
  AgentHandoffPackage,
  CompletionPolicy,
  EvidenceRecord,
  RelayTask,
} from '../src/relay/protocol/contracts';
import type {
  AuditId,
  ContextVersion,
  IdFactory,
  LedgerVersion,
  PackageId,
  PolicyId,
  ProjectId,
  RunId,
  TaskId,
} from '../src/relay/protocol/ids';
import {
  createWorkspaceService,
  DEFAULT_WORKSPACE_COMMAND_POLICY,
  type WorkspaceCommandPolicy,
  type WorkspacePolicyInput,
} from '../src/relay/workspace';
import { evaluateCompletionPolicy } from '../src/relay/verification/completion';
import {
  CLAUDE_ADAPTER_ID,
  claudePromptFor,
  claudeToolPolicyFor,
  createClaudeCodeAdapter,
} from '../src/relay/connectors/claude-code/adapter';
import {
  DEFAULT_LIVE_LIMITS,
  type ClaudeCodeCapabilityProfile,
  type ClaudeLiveLimits,
} from '../src/relay/connectors/claude-code/contracts';
import { buildSafeEditFixture, RELAY_TEST_ARGS, TEST_FILE } from '../src/relay/connectors/claude-code/fixture';
import { runGit } from '../src/relay/workspace/repository-inspector';
import { buildAttestation, digest, type ExecutionAttestation } from './attestation';
import { createTerminalCapture, type TerminalCapture } from './coding-terminal';
import { safeText } from './redact';
import type { BridgeEventInput, RelayMissionState } from './types';
import type { CodingTerminalState } from '../src/relay/ui/app/contracts';

export interface CodingHandoff {
  objective: string;
  instructions: string[];
  acceptanceCriteria: string[];
  constraints: string[];
}

/** Canonical digest of a coding handoff. The mission digests the handoff it
    PERSISTED with the same function the coding leg uses on the handoff it was
    DELIVERED — equality is the proof that they are the same object. */
export function codingHandoffDigest(h: CodingHandoff): string {
  return digest(
    JSON.stringify({
      objective: h.objective,
      instructions: h.instructions,
      acceptanceCriteria: h.acceptanceCriteria,
      constraints: h.constraints,
    }),
  );
}

export interface CodingClaim {
  summary: string;
  filesChanged: string[];
  checksRun: string[];
}

/**
 * The deterministic, Relay-produced evidence for this coding leg. Everything
 * here was read or executed by Relay AFTER the agent exited — none of it comes
 * from the agent's report. It is also the exact artifact the independent
 * reviewer is given, bound by `artifactDigest`.
 */
export interface DeterministicEvidence {
  baseRevision: string;
  allowedFiles: string[];
  prohibitedFiles: string[];
  changedFiles: string[];
  protectedChanges: string[];
  sourceUnchanged: boolean;
  inspectionAssessment: string;
  testCommand: string;
  testPassed: boolean;
  testExitCode: number | null;
  testOutput: string;
  unifiedDiff: string;
  /** Resulting content of the changed files, bounded. */
  changedFileContents: string;
  /** Digest over (changed files + diff + resulting content). The reviewer's
      verdict is bound to this exact value. */
  artifactDigest: string;
  relayEvidence: string[];
}

export interface CodingOutcome {
  /** Verified by Relay AND the coding-leg completion policy satisfied. When
      the policy requires an independent review this is FALSE until the
      reviewer has run — the coding leg alone can never complete a mission. */
  verifiedComplete: boolean;
  verificationPassed: boolean;
  /** Relay's own deterministic result: scope preserved AND tests passed. This
      is what gates the reviewer, and it is never the agent's claim. */
  deterministicPassed: boolean;
  inspectionAssessment: string;
  filesChanged: string[]; // REAL — from Relay inspection, not the claim
  protectedChanges: string[];
  sourceUnchanged: boolean;
  completionOutcome: string;
  cancelled: boolean;
  stopped: boolean;
  stopReason: string | null;
  /** The agent's CLAIM (from its report) — pending, never trusted as truth. */
  claim: CodingClaim | null;
  /** Present once the agent process has been observed (launched or failed). */
  attestation: ExecutionAttestation | null;
  /** Present once Relay has inspected + verified the resulting workspace. */
  evidence: DeterministicEvidence | null;
  /** Digest of the handoff package actually compiled for this invocation —
      proof that the persisted handoff is the delivered handoff. */
  deliveredHandoffDigest: string | null;
}

/** Cancellation handle exposed to the mission so a browser Stop can abort a
    live Claude process (SIGTERM → SIGKILL). */
export interface CancelHandle {
  cancel(): boolean;
}

/**
 * The coding leg's completion policy.
 *
 * The three-role live mission passes `requiresIndependentReview: true`, so
 * this evaluation can never report `satisfied` on the strength of passing
 * tests alone — the reviewer verdict is supplied to the mission-level
 * completion authority (`decideCompletion`), which is the single authority
 * for `verified_complete`.
 */
function buildCompletionPolicy(requiresIndependentReview: boolean): CompletionPolicy {
  return {
    policyId: (requiresIndependentReview ? 'pol_bridge-live-reviewed' : 'pol_bridge-live-lowrisk') as PolicyId,
    riskLevel: requiresIndependentReview ? 'high' : 'low',
    requiredEvidence: [{ evidenceType: 'command', command: `node ${RELAY_TEST_ARGS.join(' ')}`, mustPass: true }],
    requiresIndependentReview,
    requiresHumanApproval: false,
    enforcementRequirements: [],
    acceptedProvenance: ['live'],
  };
}

const MAX_ARTIFACT_FILE_BYTES = 64 * 1024;

/** Read the resulting content of the files Relay itself observed as changed.
    Paths come from Relay's inspection (never the agent) and are re-checked to
    stay inside the isolated workspace before anything is read. */
function readChangedFileContents(workspacePath: string, files: readonly string[]): string {
  const blocks: string[] = [];
  for (const file of files.slice(0, 8)) {
    const target = normalize(join(workspacePath, file));
    if (!target.startsWith(workspacePath + sep)) continue;
    try {
      const raw = readFileSync(target, 'utf8');
      blocks.push(`----- ${file} -----\n${raw.slice(0, MAX_ARTIFACT_FILE_BYTES)}`);
    } catch {
      /* a file Relay saw as changed but cannot read is simply not included */
    }
  }
  return blocks.join('\n\n');
}

function buildHandoff(input: {
  ids: IdFactory;
  now: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  baseRevision: string;
  claimedFile: string;
  protectedPaths: { forbidden: string[]; readOnly: string[] };
  handoff: CodingHandoff;
}): AgentHandoffPackage {
  // The architect's objective + plan are folded into pkg.objective, which the
  // prompt compiler renders verbatim — so the Coding Agent literally receives
  // the Sunday Alcatraz handoff. The rest is Relay's fixed safety envelope.
  const plan =
    input.handoff.instructions.length > 0
      ? `\n\nImplementation plan from Sunday Alcatraz (Prompt Architect):\n${input.handoff.instructions
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n')}`
      : '';
  return {
    packageId: input.ids.next('pkg') as PackageId,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    projectId: input.projectId,
    runId: input.runId,
    taskId: input.taskId,
    targetAdapterId: CLAUDE_ADAPTER_ID,
    role: 'coding-agent',
    objective: `${input.handoff.objective}${plan}`,
    responsibilityBoundary: `Edit only ${input.claimedFile} to satisfy the acceptance criteria. Change nothing else.`,
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
    acceptanceCriteria:
      input.handoff.acceptanceCriteria.length > 0
        ? input.handoff.acceptanceCriteria
        : ['The existing test suite passes when Relay runs it.', 'Only the claimed file changed.'],
    requiredEvidence: [`node ${RELAY_TEST_ARGS.join(' ')}`],
    budget: { maxRuntimeMs: DEFAULT_LIVE_LIMITS.maxRuntimeMs },
    stoppingCondition: { description: 'Stop as soon as the tests would pass; do not broaden the change.' },
    expectedReportType: 'implementation',
    contextVersion: 0 as ContextVersion,
    ledgerVersion: 0 as LedgerVersion,
    baseRevision: input.baseRevision,
    createdAt: input.now,
    idempotencyKey: `bridge-live-${input.taskId}` as AgentHandoffPackage['idempotencyKey'],
  };
}

export async function runCodingMission(input: {
  handoff: CodingHandoff;
  executablePath: string;
  capabilities: ClaudeCodeCapabilityProfile;
  now: () => string;
  ids: IdFactory;
  baseEnv?: Record<string, string | undefined>;
  limits?: ClaudeLiveLimits;
  /** Emit a normalized progress event (mission assigns sequence + at). */
  emit: (e: BridgeEventInput) => void;
  /** Report a coding-internal state transition so the mission phase advances. */
  onState?: (s: RelayMissionState) => void;
  /** Receives the cancel handle as soon as the process starts. */
  registerHandle?: (h: CancelHandle) => void;
  /** True if a cancellation was requested before/while running. */
  isCancelRequested?: () => boolean;
  /** Receives every Coding Agent terminal snapshot as it changes. The mission
      stores the latest and the browser polls for it. */
  publishTerminal?: (t: CodingTerminalState) => void;
  /** Display label for the controlled project the agent may touch. */
  projectLabel?: string;
  /** The live three-role mission passes TRUE — the coding leg then cannot
      self-complete and the reviewer becomes mandatory. Defaults to the
      previous low-risk behaviour so existing offline flows are unchanged. */
  requiresIndependentReview?: boolean;
  /** Mission identity carried into the execution attestation. */
  missionId?: string;
  missionRevision?: string;
}): Promise<CodingOutcome> {
  const { executablePath, capabilities, now, ids, emit } = input;
  const limits = input.limits ?? DEFAULT_LIVE_LIMITS;
  const requiresIndependentReview = input.requiresIndependentReview ?? false;

  const outcome: CodingOutcome = {
    verifiedComplete: false,
    verificationPassed: false,
    deterministicPassed: false,
    inspectionAssessment: 'unsupported_inspection',
    filesChanged: [],
    protectedChanges: [],
    sourceUnchanged: true,
    completionOutcome: 'unsatisfied',
    cancelled: false,
    stopped: false,
    stopReason: null,
    claim: null,
    attestation: null,
    evidence: null,
    deliveredHandoffDigest: null,
  };

  const fixture = buildSafeEditFixture();
  const projectId = ids.next('prj') as ProjectId;
  const runId = ids.next('run') as RunId;
  const taskId = ids.next('tsk') as TaskId;
  const cleanup = () => {
    try {
      rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  // The terminal capture is created as soon as the permission envelope is
  // known; until then there is nothing truthful to show.
  let terminal: TerminalCapture | null = null;

  const stop = (reason: string): CodingOutcome => {
    outcome.stopped = true;
    outcome.stopReason = safeText(reason);
    if (terminal) {
      terminal.note({
        kind: 'notice',
        truth: 'system_notice',
        text: `Relay stopped this run: ${outcome.stopReason}`,
      });
      terminal.markEnded();
      terminal.setStatus(outcome.cancelled ? 'cancelled' : 'failed');
    }
    return outcome;
  };

  const verifyPolicy: WorkspaceCommandPolicy = {
    ...DEFAULT_WORKSPACE_COMMAND_POLICY,
    rules: [
      { executable: 'node', description: 'fixture test runner', allowedFirstArgs: ['--version', '--test'] },
      { executable: 'git', description: 'read-only inspection' },
    ],
  };
  const workspace = createWorkspaceService({ ids, now, commandPolicy: verifyPolicy });

  try {
    if (input.isCancelRequested?.()) {
      outcome.cancelled = true;
      return stop('Mission cancelled before the coding agent started.');
    }

    const prepared = workspace.prepareWorkspace({
      projectId,
      runId,
      taskId,
      sourceRepositoryPath: fixture.sourceRepo,
      cleanupPolicy: 'remove_on_success',
    });
    if (!prepared.ok) return stop(`Workspace preparation failed: ${prepared.error.message}`);
    const ws = prepared.value.value.workspace;

    const pkg = buildHandoff({
      ids,
      now: now(),
      projectId,
      runId,
      taskId,
      baseRevision: fixture.baselineRevision,
      claimedFile: fixture.claimedFile,
      protectedPaths: fixture.protectedPaths,
      handoff: input.handoff,
    });
    const toolPolicy = claudeToolPolicyFor(pkg, capabilities);
    const prompt = claudePromptFor({
      pkg,
      runId,
      taskId,
      workspaceRelativeRoot: '.',
      readOnlyFiles: fixture.protectedPaths.readOnly,
      protectedFiles: [...fixture.protectedPaths.forbidden, '.git'],
      relayVerificationCommands: [`node ${RELAY_TEST_ARGS.join(' ')}`],
      limits,
    });

    // Delivery proof: the handoff Relay was given is the handoff compiled into
    // the prompt this one invocation receives. A prompt that does not carry the
    // architect's objective is a wiring defect, not something to paper over.
    outcome.deliveredHandoffDigest = codingHandoffDigest(input.handoff);
    if (input.handoff.objective.trim() && !prompt.includes(input.handoff.objective.trim())) {
      return stop('The compiled prompt did not carry the Prompt Architect handoff.');
    }

    emit({
      role: 'coding_agent',
      category: 'coding_agent',
      truth: 'system_notice',
      headline: 'Claude Code session started.',
      detail: 'Working in an isolated throwaway workspace. Source repository protected.',
    });

    // Terminal capture — the permission envelope below is the one actually
    // compiled for this invocation, not a description of it.
    terminal = createTerminalCapture({
      executionId: String(runId).slice(-8),
      projectLabel: input.projectLabel ?? 'Relay controlled fixture (throwaway repository)',
      runtime: 'Claude Code (local CLI)',
      permissions: {
        allowedTools: toolPolicy.allowedTools.length ? toolPolicy.allowedTools : toolPolicy.availableTools,
        allowedFiles: [fixture.claimedFile],
        protectedPaths: [...fixture.protectedPaths.forbidden, ...fixture.protectedPaths.readOnly, '.git'],
        deniedCapabilities: ['Bash', 'network egress', 'git push', 'deploy'],
      },
      now,
      publish: (t) => input.publishTerminal?.(t),
    });
    terminal.note({
      kind: 'session',
      truth: 'system_notice',
      text: 'Claude Code session started in an isolated throwaway workspace. Source repository protected.',
    });
    terminal.markStarted();
    terminal.setStatus('live');

    const adapter = createClaudeCodeAdapter({ now, ids });
    const invocation = await adapter.invoke(
      {
        executablePath,
        capabilities,
        association: { projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CLAUDE_ADAPTER_ID },
        pkg,
        workspacePath: ws.workspacePath,
        toolPolicy,
        prompt,
        attempt: 1,
        limits,
        baseEnv: input.baseEnv,
        now: now(),
      },
      (h) => input.registerHandle?.(h),
    );

    if (invocation.sessionId) {
      adapter.sessions.capture(
        { projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CLAUDE_ADAPTER_ID },
        invocation.sessionId,
      );
    }

    // The connector's own normalized lifecycle events are the terminal body:
    // real session records, real observed tool activity with real targets,
    // and the real process outcome. Hidden reasoning was already dropped by
    // the stream parser and is never reconstructed here.
    terminal.setExternalSession(invocation.sessionId);
    terminal.ingestConnectorEvents(invocation.events);
    terminal.markEnded(invocation.outcome.completedAt);

    // One attestation for the one process that actually ran. Claude Code is
    // authenticated by the local subscription login — never an API bill.
    const codingAttestation = buildAttestation({
      missionId: input.missionId ?? String(taskId),
      missionRevision: input.missionRevision,
      role: 'coding_agent',
      requestedActor: 'Claude Code',
      actualActor: 'Claude Code',
      requestedRuntime: 'claude-code-local',
      actualRuntime: 'claude-code-local',
      billingPath: 'subscription',
      launchVerified: !invocation.outcome.spawnError,
      completionVerified:
        !invocation.outcome.spawnError &&
        !invocation.outcome.timedOut &&
        !invocation.outcome.cancelled &&
        invocation.structurallyValid &&
        invocation.report.ok,
      fallbackOccurred: false,
      inputDigest: digest(prompt),
      startedAt: invocation.outcome.startedAt,
      completedAt: invocation.outcome.completedAt,
    });
    outcome.attestation = codingAttestation;
    terminal.setAttestation({
      attestationId: codingAttestation.attestationId,
      launchVerified: codingAttestation.launchVerified,
      completionVerified: codingAttestation.completionVerified,
      fallbackOccurred: codingAttestation.fallbackOccurred,
      billingPath: 'subscription',
    });

    if (invocation.outcome.cancelled) {
      outcome.cancelled = true;
      return stop('The coding agent was cancelled.');
    }
    if (invocation.outcome.timedOut) return stop('The coding agent timed out.');
    if (invocation.outcome.spawnError) return stop('The coding agent could not start.');
    if (!invocation.structurallyValid) {
      return stop(`The coding agent output was not usable: ${invocation.structuralReason ?? 'unknown'}.`);
    }
    if (!invocation.report.ok) {
      return stop(`The coding agent report could not be trusted: ${invocation.report.error.message}`);
    }

    // The agent's CLAIM (never trusted over inspection).
    const report = invocation.report.value;
    const claimChecks: string[] = [];
    if (Array.isArray(report.testsClaimed) && report.testsClaimed.length) {
      claimChecks.push(`Reported ${report.testsClaimed.length} test check(s)`);
    }
    if (Array.isArray(report.commandsClaimed) && report.commandsClaimed.length) {
      claimChecks.push(`Reported ${report.commandsClaimed.length} command(s)`);
    }
    if (!claimChecks.length) claimChecks.push('Reported completing the task');
    outcome.claim = {
      summary: safeText(report.summary || 'Coding agent reported completion.'),
      filesChanged: (report.filesChanged ?? []).map((f) => safeText(f)),
      checksRun: claimChecks,
    };
    emit({
      role: 'coding_agent',
      category: 'coding_agent',
      truth: 'agent_claim',
      headline: 'Work submitted — pending Relay verification.',
      detail: outcome.claim.summary,
      meta: outcome.claim.filesChanged[0] ? `CLAIM ${outcome.claim.filesChanged[0]}` : undefined,
      done: true,
    });
    terminal.setClaim(outcome.claim);
    terminal.note({
      kind: 'claim',
      truth: 'agent_claim',
      text: `Claim submitted — ${outcome.claim.summary}`,
      target: outcome.claim.filesChanged[0],
    });
    input.onState?.('claim_submitted');

    // Relay independently inspects — the report cannot override this.
    const policyInput: WorkspacePolicyInput = {
      protectedPaths: fixture.protectedPaths,
      claimedWritePaths: [fixture.claimedFile],
    };
    const inspection = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!inspection.ok) return stop(`Workspace inspection failed: ${inspection.error.message}`);
    const insp = inspection.value.value;
    outcome.inspectionAssessment = insp.assessment;
    outcome.filesChanged = insp.claimedChanges.map((f) => safeText(f));
    outcome.protectedChanges = insp.protectedChanges.map((f) => safeText(f));

    terminal.setChangedFiles(outcome.filesChanged);

    if (insp.assessment !== 'allowed') {
      terminal.note({
        kind: 'inspection',
        truth: 'relay_evidence',
        text:
          insp.assessment === 'clean'
            ? 'Relay inspection: no file changed — nothing to verify.'
            : `Relay inspection: unauthorized change detected (${insp.assessment}).`,
      });
      emit({
        role: 'relay',
        category: 'workspace_inspection',
        truth: 'relay_evidence',
        headline:
          insp.assessment === 'clean'
            ? 'Relay inspection: no file changed — nothing to verify.'
            : `Relay inspection: unauthorized change detected (${safeText(insp.assessment)}).`,
      });
      return stop(`Workspace inspection rejected the change (${insp.assessment}).`);
    }
    emit({
      role: 'relay',
      category: 'workspace_inspection',
      truth: 'relay_evidence',
      headline: 'Claimed files match changed files. No protected files touched.',
      detail: `${insp.claimedChanges.length} claimed file changed · source worktree unchanged.`,
    });
    terminal.note({
      kind: 'inspection',
      truth: 'relay_evidence',
      text: `Relay inspection: claimed files match changed files (${insp.claimedChanges.length}); no protected file touched.`,
      target: outcome.filesChanged[0],
    });

    // The REAL resulting diff, read by Relay from the isolated worktree after
    // the agent exited. Read-only git, bounded and sanitized before display.
    const diffResult = runGit(['diff', '--unified=3'], ws.workspacePath);
    terminal.setDiff(diffResult.ok ? diffResult.value : null);

    input.onState?.('relay_verifying');

    // Relay — not Claude — runs the deterministic verification.
    const verify = await workspace.executeCommand({
      commandId: `bridge-live-verify-${taskId}`,
      projectId,
      runId,
      taskId,
      workspaceId: ws.workspaceId,
      executable: 'node',
      args: RELAY_TEST_ARGS,
      expectedPurpose: 'fixture test verification',
      timeoutMs: 60_000,
    });
    if (!verify.ok) return stop(`Verification could not run: ${verify.error.message}`);
    const verifyResult = verify.value.value;
    outcome.verificationPassed = verifyResult.status === 'completed';

    const verifyCommand = `node ${RELAY_TEST_ARGS.join(' ')}`;
    terminal.note({
      kind: 'command',
      truth: 'relay_evidence',
      text: `Relay ran the required verification: ${verifyCommand}`,
    });
    terminal.setTest({
      command: verifyCommand,
      status: outcome.verificationPassed ? 'passed' : 'failed',
      exitCode: verifyResult.exitCode,
      // Already bounded + secret-sanitized by the workspace runner; the
      // terminal sanitizer bounds and scrubs it again before display.
      output: [verifyResult.stdout, verifyResult.stderr].filter((s) => s.trim().length > 0).join('\n'),
    });

    const sourceCheck = workspace.verifySourceUnchanged(ws.workspaceId);
    outcome.sourceUnchanged = sourceCheck.ok ? !sourceCheck.value.value.changed : false;

    // ---- The reviewed artifact. Captured by Relay from the isolated
    // workspace after the agent exited, BEFORE the workspace is cleaned up,
    // and digested so a reviewer verdict can be bound to this exact result.
    const unifiedDiff = diffResult.ok ? safeText(diffResult.value) : '';
    const changedFileContents = safeText(readChangedFileContents(ws.workspacePath, outcome.filesChanged));
    const testOutput = safeText(
      [verifyResult.stdout, verifyResult.stderr].filter((s) => s.trim().length > 0).join('\n'),
    );
    const relayEvidence = [
      `Relay inspection assessment: ${insp.assessment}`,
      `Changed files (Relay-observed): ${outcome.filesChanged.join(', ') || '(none)'}`,
      `Protected files changed: ${outcome.protectedChanges.join(', ') || '(none)'}`,
      `Source worktree unchanged: ${outcome.sourceUnchanged ? 'yes' : 'NO'}`,
      `Relay ran ${verifyCommand} → exit ${verifyResult.exitCode ?? 'unknown'} (${
        outcome.verificationPassed ? 'passed' : 'failed'
      })`,
    ];
    outcome.deterministicPassed =
      outcome.verificationPassed && insp.assessment === 'allowed' && outcome.protectedChanges.length === 0 && outcome.sourceUnchanged;
    outcome.evidence = {
      baseRevision: fixture.baselineRevision,
      allowedFiles: [fixture.claimedFile],
      prohibitedFiles: [...fixture.protectedPaths.forbidden, ...fixture.protectedPaths.readOnly, '.git'],
      changedFiles: [...outcome.filesChanged],
      protectedChanges: [...outcome.protectedChanges],
      sourceUnchanged: outcome.sourceUnchanged,
      inspectionAssessment: insp.assessment,
      testCommand: verifyCommand,
      testPassed: outcome.verificationPassed,
      testExitCode: verifyResult.exitCode,
      testOutput,
      unifiedDiff,
      changedFileContents,
      artifactDigest: digest(
        JSON.stringify({
          baseRevision: fixture.baselineRevision,
          changedFiles: outcome.filesChanged,
          unifiedDiff,
          changedFileContents,
        }),
      ),
      relayEvidence,
    };

    const evidence: EvidenceRecord[] = [...workspace.collectEvidence()];

    const task: RelayTask = {
      taskId,
      projectId,
      runId,
      objective: pkg.objective,
      category: 'implementation',
      status: 'working',
      ownerAssignmentId: null,
      dependencies: [],
      claimedFiles: [fixture.claimedFile],
      claimedResources: [],
      acceptanceCriteria: pkg.acceptanceCriteria,
      completionPolicyId: buildCompletionPolicy(requiresIndependentReview).policyId,
      contextVersion: 0 as ContextVersion,
      baseRevision: fixture.baselineRevision,
      createdAt: now(),
      updatedAt: now(),
      priority: 1,
    };
    const completion = evaluateCompletionPolicy({
      policy: buildCompletionPolicy(requiresIndependentReview),
      task,
      evidence,
      currentRepositoryRevision: fixture.baselineRevision,
      currentTime: now(),
      enforcementCapabilities: { 'worktree-isolation': 'enforced' },
    });
    outcome.completionOutcome = completion.outcome;
    outcome.verifiedComplete = completion.outcome === 'satisfied' && outcome.verificationPassed;

    emit({
      role: 'relay',
      category: 'verification',
      truth: 'relay_evidence',
      headline: outcome.verificationPassed
        ? 'Required tests passed under Relay verification.'
        : 'Relay verification did not pass.',
      detail: `Tests ${outcome.verificationPassed ? 'passed' : 'failed'} · file-claim policy ${
        insp.assessment === 'allowed' ? 'passed' : 'failed'
      } · protected-path policy ${outcome.protectedChanges.length === 0 ? 'passed' : 'failed'} · source-worktree ${
        outcome.sourceUnchanged ? 'protected' : 'MODIFIED'
      }.`,
      done: true,
    });
    terminal.note({
      kind: 'verification',
      truth: 'relay_evidence',
      text: outcome.verificationPassed
        ? 'Required tests passed under Relay verification.'
        : 'Relay verification did not pass.',
    });
    // The TERMINAL reports the Coding Agent's own execution, which is finished
    // and deterministically verified at this point. Mission completion is a
    // separate authority (the reviewer has not run yet) and is never implied
    // here — the terminal never claims the mission is complete.
    terminal.setStatus(outcome.deterministicPassed ? 'complete' : 'failed');

    // Void the audit id so ids stay monotonic in parity with the CLI proof.
    void (ids.next('aud') as AuditId);
    workspace.cleanupWorkspace(ws.workspaceId, { authorizeRemoval: true });
    return outcome;
  } finally {
    cleanup();
  }
}
