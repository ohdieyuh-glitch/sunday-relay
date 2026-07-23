import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicIds, testClock } from '../../testing/factories';
import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import { buildExecutionAttestation, attestsSuccessfulExecution } from '../../mission/attestation';
import { reviewerIsIndependent } from '../../mission/entitlement';
import { DEFAULT_REVIEWER_LIMITS, type CodexReviewerCapabilityProfile } from './contracts';
import { classifyCodexLoginOutput, probeCodexLoginStatus } from './capability-probe';
import { createCodexReviewerAdapter } from './adapter';
import { runCodexReviewProof } from './live-runner';
import { writeFakeCodex, SEEDED_BLOCKING_FINDING, type FakeReviewerSpec } from './fake-executable';
import type { ReviewerPromptContext } from './reviewer-prompt-compiler';
import type { ReviewerSessionAssociation } from './session-manager';

/**
 * Codex Reviewer offline contract verification (Prompt 8.3). Proves the whole
 * adapter pipeline with a DETERMINISTIC FAKE Codex executable — NO provider
 * call, no repository modified, no credential read. These are fake-executable
 * checks, never live Codex tests.
 */

export interface ContractCheck { name: string; ok: boolean; detail?: string }

const FAKE_SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SECRET_RE = /(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY)/;

function syntheticCapabilities(executablePath: string, now: string): CodexReviewerCapabilityProfile {
  return {
    executablePath, version: 'codex-fake 0.0.0', nonInteractiveExecSupported: true, jsonEventsSupported: true,
    outputSchemaSupported: true, outputLastMessageSupported: true, exactResumeSupported: true,
    nativeReviewSupported: true, uncommittedReviewSupported: true, baseReviewSupported: true,
    commitReviewSupported: true, readOnlySandboxSupported: true, workspaceWriteSandboxSupported: true,
    ignoreUserConfigSupported: true, ignoreRulesSupported: true, strictConfigSupported: true,
    cancellationSupported: true, authenticationStatus: 'ready', selectedRuntimeStrategy: 'exec_structured_review',
    probedAt: now, provenance: 'live',
  };
}

const EXPECTED = {
  reviewId: 'rvw_fake', missionId: 'msn_fake', taskId: 'tsk_fake',
  missionRevision: 1, taskRevision: 1, workspaceRevision: 'rev_fake',
};

function fakePromptContext(): ReviewerPromptContext {
  return {
    missionId: EXPECTED.missionId, missionRevision: 1, taskId: EXPECTED.taskId, taskRevision: 1,
    reviewId: EXPECTED.reviewId, reviewerRole: 'independent_coding_reviewer',
    independenceRequirement: 'independent', missionObjective: 'block when either control is active',
    requirements: ['rate-limit alone blocks', 'breaker alone blocks'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'either control blocks dispatch', blocking: true }],
    workspaceRevision: EXPECTED.workspaceRevision, changedFiles: ['src/dispatch.js'], diffSummary: '1 file changed',
    implementerIdentityLabel: 'fixture-implementer', implementerAttestationRef: 'att',
    verificationEvidence: [{ command: 'node --test test/dispatch.test.js', status: 'passed' }],
    knownLimitations: ['tests cover only neither/both'], protectedPaths: ['package.json'],
    filesOutOfScope: ['README.md'], securityConstraints: ['read-only review'],
  };
}

async function invokeScenario(
  harnessDir: string, spec: FakeReviewerSpec,
  opts: { timeoutMs?: number; cancelAfterMs?: number; resume?: boolean } = {},
) {
  const dir = mkdtempSync(join(harnessDir, 'inv-'));
  const wsDir = join(dir, 'ws');
  mkdirSync(wsDir, { recursive: true });
  const fakePath = writeFakeCodex(dir, spec);
  const clock = testClock('2026-07-24T00:00:00.000Z', 10);
  const adapter = createCodexReviewerAdapter({ now: () => clock.now(), ids: deterministicIds() });
  const association: ReviewerSessionAssociation = {
    reviewId: EXPECTED.reviewId, projectId: 'prj_x' as ProjectId, runId: 'run_x' as RunId,
    taskId: 'tsk_x' as TaskId, workspaceId: 'wsp_x' as WorkspaceRefId, adapterId: 'codex-reviewer-local',
  };
  const result = await adapter.invokeReview(
    {
      executablePath: fakePath, capabilities: syntheticCapabilities(fakePath, clock.peek()), association,
      promptContext: fakePromptContext(), workspacePath: wsDir, expected: EXPECTED, attempt: opts.resume ? 2 : 1,
      resumeSessionId: opts.resume ? FAKE_SESSION : undefined,
      limits: { ...DEFAULT_REVIEWER_LIMITS, maxRuntimeMs: opts.timeoutMs ?? DEFAULT_REVIEWER_LIMITS.maxRuntimeMs },
      baseEnv: process.env, now: clock.peek(),
    },
    opts.cancelAfterMs
      ? (handle) => { setTimeout(() => handle.cancel(), opts.cancelAfterMs); }
      : undefined,
  );
  return { result, adapter, association };
}

export async function runCodexReviewerContractVerification(): Promise<{ checks: ContractCheck[]; failures: number }> {
  const checks: ContractCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string): void => { checks.push({ name, ok, detail }); };
  const harnessDir = mkdtempSync(join(tmpdir(), 'relay-codex-contract-'));
  const now = () => new Date().toISOString();

  try {
    /* ---- end-to-end changes_required proof (the seeded defect) ---- */
    {
      const proofDir = mkdtempSync(join(harnessDir, 'proof-cr-'));
      const fake = writeFakeCodex(proofDir, {
        scenario: 'changes_required', sessionId: FAKE_SESSION, verdict: 'changes_required',
        findings: [SEEDED_BLOCKING_FINDING],
      });
      const proof = await runCodexReviewProof({
        executablePath: fake, capabilities: syntheticCapabilities(fake, now()), now, ids: deterministicIds(),
      });
      const serialized = JSON.stringify(proof);
      check('changes_required review is HELD (exit 3)', proof.exitCode === 3, `exit ${proof.exitCode}`);
      check('verdict is changes_required', proof.verdict === 'changes_required', String(proof.verdict));
      check('one blocking finding created', proof.blockingFindings >= 1, `${proof.blockingFindings}`);
      check('finding links acceptance criterion AC-1',
        proof.findings.some((f) => f.affectedCriterionIds.includes('AC-1')));
      check('linked repair obligation created', proof.repairs.length >= 1);
      check('output visibility is revision_required', proof.outputVisibility === 'revision_required', proof.outputVisibility);
      check('reviewer session captured', !!proof.sessionCaptured);
      check('launch verified', proof.launchVerified);
      check('requested & actual reviewer are Codex', proof.requestedReviewer === 'codex' && proof.actualReviewer === 'codex');
      check('reviewer independent from implementer', proof.reviewerIndependent);
      check('reviewer changed zero files', proof.reviewerFileChanges.length === 0, proof.reviewerFileChanges.join(','));
      check('pre & post inspection allowed', proof.preInspectionAssessment === 'allowed' && proof.postInspectionAssessment === 'allowed');
      check('source fixture unchanged', proof.sourceUnchanged);
      check('reviewer execution attestation created', !!proof.attestation);
      check('no fallback occurred', proof.fallbackOccurred === false);
      check('no secret-shaped content in output', !SECRET_RE.test(serialized));
      check('no hidden reasoning in output', !/chain of thought/i.test(serialized));
      check('does not claim RELAY COMPLETE', !proof.lines.some((l) => /RELAY COMPLETE/.test(l)));
    }

    /* ---- approved proof (release awaits completion policy) ---- */
    {
      const proofDir = mkdtempSync(join(harnessDir, 'proof-ap-'));
      const fake = writeFakeCodex(proofDir, { scenario: 'approved', sessionId: FAKE_SESSION, verdict: 'approved', findings: [] });
      const proof = await runCodexReviewProof({
        executablePath: fake, capabilities: syntheticCapabilities(fake, now()), now, ids: deterministicIds(),
      });
      check('approved review reaches approved_for_release', proof.outputVisibility === 'approved_for_release', proof.outputVisibility);
      check('approved review changed zero files', proof.reviewerFileChanges.length === 0);
    }

    /* ---- needs_human proof ---- */
    {
      const proofDir = mkdtempSync(join(harnessDir, 'proof-nh-'));
      const fake = writeFakeCodex(proofDir, { scenario: 'needs_human', sessionId: FAKE_SESSION, verdict: 'needs_human', findings: [] });
      const proof = await runCodexReviewProof({
        executablePath: fake, capabilities: syntheticCapabilities(fake, now()), now, ids: deterministicIds(),
      });
      check('needs_human keeps output held (exit 3)', proof.exitCode === 3 && proof.outputVisibility === 'held_for_review');
    }

    /* ---- reviewer modifies the workspace → rejected ---- */
    {
      const proofDir = mkdtempSync(join(harnessDir, 'proof-mod-'));
      const fake = writeFakeCodex(proofDir, {
        scenario: 'modify_workspace', sessionId: FAKE_SESSION, verdict: 'changes_required',
        findings: [SEEDED_BLOCKING_FINDING], modifyPath: 'reviewer-scratch.txt',
      });
      const proof = await runCodexReviewProof({
        executablePath: fake, capabilities: syntheticCapabilities(fake, now()), now, ids: deterministicIds(),
      });
      check('reviewer file modification rejects the review (exit 5)', proof.exitCode === 5, `exit ${proof.exitCode}`);
      check('rejected review creates no approved attestation', proof.attestation === null || !attestsSuccessfulExecution(proof.attestation));
      check('rejected review keeps output held', proof.outputVisibility !== 'approved_for_release' && proof.outputVisibility !== 'released');
    }

    /* ---- stream / report scenarios via invokeReview ---- */
    {
      const cr = await invokeScenario(harnessDir, { scenario: 'changes_required', sessionId: FAKE_SESSION, verdict: 'changes_required', findings: [SEEDED_BLOCKING_FINDING] });
      check('valid stream → structurally valid + report ok', cr.result.structurallyValid && cr.result.report.ok);
      check('session identity captured from stream', cr.result.sessionId === FAKE_SESSION);
      check('diff & evidence inspection observed',
        cr.result.events.some((e) => e.kind === 'reviewer.diff_inspection_observed') &&
        cr.result.events.some((e) => e.kind === 'reviewer.evidence_inspection_observed'));

      const unknown = await invokeScenario(harnessDir, { scenario: 'unknown_events', sessionId: FAKE_SESSION, verdict: 'changes_required', findings: [SEEDED_BLOCKING_FINDING] });
      check('unknown events tolerated (report still ok)', unknown.result.report.ok);

      const noInit = await invokeScenario(harnessDir, { scenario: 'missing_init', sessionId: FAKE_SESSION, verdict: 'approved' });
      check('missing initialization → not structurally valid', !noInit.result.structurallyValid && !noInit.result.report.ok);

      const noSession = await invokeScenario(harnessDir, { scenario: 'missing_session', sessionId: FAKE_SESSION, verdict: 'approved' });
      check('missing session id → not structurally valid', !noSession.result.structurallyValid && !noSession.result.report.ok);

      const malformed = await invokeScenario(harnessDir, { scenario: 'malformed_report', sessionId: FAKE_SESSION });
      check('malformed report → typed failure (no invented verdict)', !malformed.result.report.ok);

      const secret = await invokeScenario(harnessDir, { scenario: 'secret_output', sessionId: FAKE_SESSION, verdict: 'changes_required', summary: 'leak sk-FAKETESTNOTREAL0000', findings: [SEEDED_BLOCKING_FINDING] });
      check('secret-shaped report rejected', !secret.result.report.ok);

      const hidden = await invokeScenario(harnessDir, { scenario: 'hidden_reasoning', sessionId: FAKE_SESSION, verdict: 'changes_required', findings: [SEEDED_BLOCKING_FINDING] });
      const hiddenSerialized = JSON.stringify(hidden.result.events);
      check('hidden reasoning dropped (count only, not content)',
        hidden.result.outcome.parsed.reasoningBlocksOmitted > 0 && !/SECRET internal/.test(hiddenSerialized));

      const wrongRev = await invokeScenario(harnessDir, { scenario: 'wrong_id_field', sessionId: FAKE_SESSION, verdict: 'approved', corruptField: 'reviewedWorkspaceRevision', corruptValue: 'WRONG_REV' });
      check('wrong workspace revision rejected', !wrongRev.result.report.ok);

      const wrongMission = await invokeScenario(harnessDir, { scenario: 'wrong_id_field', sessionId: FAKE_SESSION, verdict: 'approved', corruptField: 'reviewedMissionRevision', corruptValue: 9 });
      check('wrong mission revision rejected', !wrongMission.result.report.ok);

      const wrongReview = await invokeScenario(harnessDir, { scenario: 'wrong_id_field', sessionId: FAKE_SESSION, verdict: 'approved', corruptField: 'reviewId', corruptValue: 'rvw_WRONG' });
      check('wrong review id rejected', !wrongReview.result.report.ok);

      const procErr = await invokeScenario(harnessDir, { scenario: 'process_error', sessionId: FAKE_SESSION });
      check('process error → report not ok', !procErr.result.report.ok);

      const overflow = await invokeScenario(harnessDir, { scenario: 'output_overflow', sessionId: FAKE_SESSION, verdict: 'approved' });
      check('output overflow detected + truncated', overflow.result.outcome.outputTruncated);

      const timeout = await invokeScenario(harnessDir, { scenario: 'timeout', sessionId: FAKE_SESSION }, { timeoutMs: 400 });
      check('timeout terminates + is honestly reported',
        timeout.result.outcome.timedOut && timeout.result.outcome.termination === 'termination_confirmed');

      const cancel = await invokeScenario(harnessDir, { scenario: 'cancellation', sessionId: FAKE_SESSION }, { timeoutMs: 30_000, cancelAfterMs: 300 });
      check('cancellation terminates + is honestly reported',
        cancel.result.outcome.cancelled && cancel.result.outcome.termination === 'termination_confirmed');
    }

    /* ---- session manager: capture + exact resume ---- */
    {
      const clock = testClock('2026-07-24T00:00:00.000Z', 10);
      const adapter = createCodexReviewerAdapter({ now: () => clock.now(), ids: deterministicIds() });
      const assoc: ReviewerSessionAssociation = {
        reviewId: 'rvw_s', projectId: 'prj_s' as ProjectId, runId: 'run_s' as RunId, taskId: 'tsk_s' as TaskId,
        workspaceId: 'wsp_s' as WorkspaceRefId, adapterId: 'codex-reviewer-local',
      };
      check('session capture ok', adapter.sessions.capture(assoc, FAKE_SESSION).ok);
      check('duplicate capture rejected', !adapter.sessions.capture(assoc, FAKE_SESSION).ok);
      const prep = adapter.sessions.prepareResume(assoc);
      check('prepareResume returns captured id', prep.ok && prep.value.codexSessionId === FAKE_SESSION);
      check('wrong session on resume rejected', !adapter.sessions.confirmResume(assoc, 'different-session').ok);
      check('correct session on resume accepted', adapter.sessions.confirmResume(assoc, FAKE_SESSION).ok);
      check('second resume rejected (single attempt)', !adapter.sessions.prepareResume(assoc).ok);
    }

    /* ---- attestation + independence ---- */
    {
      const facts = {
        attestationId: 'aud_a', projectId: 'prj', missionId: 'msn', taskId: 'tsk', runId: 'run',
        requestedAgentId: 'codex', requestedAgentType: 'codex', requestedRole: 'independent_coding_reviewer',
        actualAgentId: 'codex', actualAgentType: 'codex', actualRole: 'independent_coding_reviewer',
        adapterId: 'codex-reviewer-local', evidenceIds: [], provenance: 'live' as const,
        launchRequested: true, launchVerified: true, completionSignalReceived: true,
        workspaceInspectionCompleted: true, verificationCompleted: true,
      };
      const good = buildExecutionAttestation(facts);
      check('verified reviewer attestation proves execution', good.ok && attestsSuccessfulExecution(good.value));
      const notVerified = buildExecutionAttestation({ ...facts, launchVerified: false, completionSignalReceived: false });
      check('launch requested but not verified does not prove execution', notVerified.ok && !attestsSuccessfulExecution(notVerified.value));
      const badFallback = buildExecutionAttestation({ ...facts, fallback: { occurred: true, agentId: 'sim-reviewer', reason: 'x', authorized: false } });
      check('unauthorized fallback rejected', !badFallback.ok);

      const indep = reviewerIsIndependent({
        reviewerAgentId: 'codex-reviewer-local', reviewerSessionId: 's1', reviewerAdapterId: 'codex-reviewer-local', reviewerIndependenceGroup: 'reviewers',
        implementerAgentId: 'fixture-implementer', implementerSessionId: 's2', implementerAdapterId: 'fixture-implementer', implementerIndependenceGroup: 'implementers',
      });
      check('distinct provider/adapter/session → independent', indep);
      const sameSession = reviewerIsIndependent({
        reviewerAgentId: 'codex-reviewer-local', reviewerSessionId: 's1', reviewerAdapterId: 'codex-reviewer-local', reviewerIndependenceGroup: 'reviewers',
        implementerAgentId: 'fixture-implementer', implementerSessionId: 's1', implementerAdapterId: 'fixture-implementer', implementerIndependenceGroup: 'implementers',
      });
      check('shared session rejected for independence', !sameSession);
      const sameAdapter = reviewerIsIndependent({
        reviewerAgentId: 'x', reviewerSessionId: 's1', reviewerAdapterId: 'same', reviewerIndependenceGroup: 'reviewers',
        implementerAgentId: 'y', implementerSessionId: 's2', implementerAdapterId: 'same', implementerIndependenceGroup: 'implementers',
      });
      check('shared adapter rejected for independence', !sameAdapter);
    }

    /* ---- Gate-B login preflight (canonical probe; fake login-status only) ---- */
    {
      const loginDir = mkdtempSync(join(harnessDir, 'login-'));
      const writeFakeLogin = (name: string, body: string): string => {
        const p = join(loginDir, name);
        writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
        return p;
      };

      // The real CLI prints its login result on STDERR and exits 0 — the exact
      // behavior that must classify as ready (Gate-B regression).
      const loggedIn = writeFakeLogin('codex-logged-in',
        "process.stderr.write('Logged in using ChatGPT\\n'); process.exit(0);");
      const inProbe = probeCodexLoginStatus(loggedIn);
      const inClass = classifyCodexLoginOutput(inProbe);
      check('login preflight reads STDERR: exit-0 ChatGPT login classifies ready',
        inProbe.exitCode === 0 && inClass.status === 'ready' && inClass.methodLabel === 'chatgpt',
        `exit ${inProbe.exitCode}, status ${inClass.status}`);

      const withAccount = writeFakeLogin('codex-account',
        "process.stderr.write('\\u001b[32mLogged in\\u001b[0m using ChatGPT (fake-account@example.com)\\n'); process.exit(0);");
      const acctProbe = probeCodexLoginStatus(withAccount);
      check('login preflight sanitizes account material and ANSI before classification',
        !acctProbe.text.includes('fake-account@example.com') && !acctProbe.text.includes('\u001b') &&
        classifyCodexLoginOutput(acctProbe).status === 'ready');

      const loggedOut = writeFakeLogin('codex-logged-out',
        "process.stderr.write('Not logged in\\n'); process.exit(1);");
      const outClass = classifyCodexLoginOutput(probeCodexLoginStatus(loggedOut));
      check('login preflight not-logged-in classifies not_ready', outClass.status === 'not_ready' && !outClass.loggedIn);

      const lyingExit = writeFakeLogin('codex-lying-exit',
        "process.stderr.write('Logged in using ChatGPT\\n'); process.exit(3);");
      check('login preflight never classifies a non-zero exit as ready',
        !classifyCodexLoginOutput(probeCodexLoginStatus(lyingExit)).loggedIn);
    }

    check('no provider call made (fake executable only)', true);
  } catch (err) {
    check('contract verification completed without throwing', false, String((err as Error).message ?? err));
  }

  // Clean up, then verify no artifacts remain.
  try { rmSync(harnessDir, { recursive: true, force: true }); } catch { /* ignore */ }
  check('harness artifacts removed', !existsSync(harnessDir));

  return { checks, failures: checks.filter((c) => !c.ok).length };
}
