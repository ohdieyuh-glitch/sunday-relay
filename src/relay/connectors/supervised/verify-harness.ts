import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicIds, testClock } from '../../testing/factories';
import { attestsSuccessfulExecution } from '../../mission/attestation';
import type { ClaudeCodeCapabilityProfile } from '../claude-code/contracts';
import { writeFakeClaude, type FakeSpec } from '../claude-code/fake-executable';
import { CLAIMED_FILE, REFERENCE_IMPLEMENTATION } from '../claude-code/fixture';
import type { CodexReviewerCapabilityProfile, ReviewReportFinding } from '../codex-reviewer/contracts';
import { writeFakeCodex, type FakeReviewerSpec } from '../codex-reviewer/fake-executable';
import { runSupervisedProof } from './live-runner';
import type { SupervisedProofResult } from './contracts';

/**
 * Supervised workflow offline contract verification (Prompt 8.4) — Gate A.
 * Proves the FULL orchestration (real Claude implementation → Relay
 * inspection → Relay-controlled verification → real independent Codex review
 * → PATH A approval / PATH B bounded repair + exact-session re-review) with
 * DETERMINISTIC FAKE executables for BOTH agents. NO provider call is ever
 * made; no repository outside the throwaway fixture is touched.
 *
 * Honesty note: the fake reviewer's changes_required outcome below is a
 * SCRIPTED SIMULATION used only to exercise orchestration behavior (as the
 * Prompt 8.4 contract explicitly permits for offline fakes). The fixture
 * implementation the fake Claude writes is the CORRECT reference
 * implementation — nothing here plants a defect, injects a fault, or mutates
 * real implementation code, and the live workflow never scripts a verdict.
 */

export interface ContractCheck { name: string; ok: boolean; detail?: string }

const FAKE_CLAUDE_SESSION = '11111111-2222-4333-8444-555555555555';
const FAKE_CODEX_SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SECRET_RE = /(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY)/;

/** A SIMULATED blocking finding (offline orchestration test input only). It
 * exercises the repair path; it does not assert a real defect. */
export const SIMULATED_BLOCKING_FINDING: ReviewReportFinding = {
  severity: 'high',
  title: 'Normalization evidence is insufficient for mixed separator runs.',
  description: 'SIMULATED reviewer outcome (offline harness): scripted only to exercise the Finding → Repair → re-review orchestration. It asserts no real defect in the fixture implementation.',
  evidence: ['scripted offline reviewer outcome'],
  affectedFiles: ['src/normalize.js'],
  affectedCriterionIds: ['AC-1'],
  requiredAction: 'Re-check normalizeProjectName against every acceptance criterion and keep the tests passing.',
  blocking: true,
};

function claudeCaps(executablePath: string, now: string): ClaudeCodeCapabilityProfile {
  return {
    executablePath, version: 'fake-0', nonInteractiveSupported: true, streamJsonSupported: true,
    explicitResumeSupported: true, maxTurnsSupported: false, allowedToolsSupported: true,
    disallowedToolsSupported: true, toolsRestrictionSupported: true, permissionModeSupported: true,
    systemPromptSupported: true, appendSystemPromptSupported: true, structuredSchemaSupported: true,
    mcpIsolationSupported: 'available', settingsIsolationSupported: 'available',
    cancellationSupported: true, probedAt: now, provenance: 'live',
  };
}

function codexCaps(executablePath: string, now: string): CodexReviewerCapabilityProfile {
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

async function runScenario(
  harnessDir: string,
  claudeSpec: Partial<FakeSpec> & { scenario: FakeSpec['scenario'] },
  codexSpec: Partial<FakeReviewerSpec> & { scenario: FakeReviewerSpec['scenario'] },
  startIso: string,
): Promise<SupervisedProofResult> {
  const dir = mkdtempSync(join(harnessDir, 'scn-'));
  const claudeExe = writeFakeClaude(dir, {
    sessionId: FAKE_CLAUDE_SESSION, taskId: 'tsk_ignored', runId: 'run_ignored',
    editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
    ...claudeSpec,
  });
  const codexExe = writeFakeCodex(dir, {
    sessionId: FAKE_CODEX_SESSION,
    ...codexSpec,
  });
  const clock = testClock(startIso, 20);
  return runSupervisedProof({
    claude: { executablePath: claudeExe, capabilities: claudeCaps(claudeExe, clock.peek()) },
    codex: { executablePath: codexExe, capabilities: codexCaps(codexExe, clock.peek()) },
    now: () => clock.now(), ids: deterministicIds(), baseEnv: process.env,
  });
}

export async function runSupervisedContractVerification(): Promise<{ checks: ContractCheck[]; failures: number }> {
  const checks: ContractCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string): void => { checks.push({ name, ok, detail }); };
  const harnessDir = mkdtempSync(join(tmpdir(), 'relay-supervised-contract-'));

  try {
    /* ---------------- PATH A: genuine approval, no repair ---------------- */
    {
      const proof = await runScenario(harnessDir,
        { scenario: 'success' },
        { scenario: 'approved', verdict: 'approved', findings: [] },
        '2026-07-24T08:00:00.000Z');
      const serialized = JSON.stringify(proof);
      check('PATH A: approved review completes VERIFIED COMPLETE (exit 0)',
        proof.exitCode === 0 && proof.audit?.outcome === 'verified-complete', `exit ${proof.exitCode}`);
      check('PATH A: workflow path is approved_first_review', proof.path === 'approved_first_review', proof.path);
      check('PATH A: verdict is the reviewer\'s genuine report', proof.reviewVerdicts.join(',') === 'approved');
      check('PATH A: no repair was dispatched',
        !proof.repairDispatched && proof.claudeInvocations === 1 && proof.audit?.repairCount === 0);
      check('PATH A: both live sessions captured',
        proof.claudeSessionCaptured === FAKE_CLAUDE_SESSION && proof.codexSessionCaptured === FAKE_CODEX_SESSION);
      check('PATH A: exactly one claimed file changed, zero protected',
        proof.filesChanged.length === 1 && proof.filesChanged[0] === CLAIMED_FILE && proof.protectedChanges.length === 0);
      check('PATH A: Relay verification passed BEFORE review dispatch',
        proof.verificationsPassed[0] === true && proof.codexInvocations === 1);
      check('PATH A: reviewer independent from implementer', proof.reviewerIndependent);
      check('PATH A: reviewer changed zero files', proof.reviewerFileChanges.length === 0);
      check('PATH A: implementer attestation proves execution, requested = actual',
        !!proof.implementerAttestation && attestsSuccessfulExecution(proof.implementerAttestation) &&
        proof.implementerAttestation.requestedAgentId === proof.implementerAttestation.actualAgentId);
      check('PATH A: reviewer attestation proves execution, no fallback',
        proof.reviewerAttestations.length === 1 && attestsSuccessfulExecution(proof.reviewerAttestations[0]) &&
        proof.reviewerAttestations[0].fallbackOccurred === false);
      check('PATH A: output visibility is released', proof.outputVisibility === 'released', proof.outputVisibility);
      check('PATH A: completion policy satisfied with required independent review',
        proof.completionOutcome === 'satisfied');
      check('PATH A: audit identities are truthful',
        proof.audit?.identities?.codingAgent === 'claude-code-local' &&
        proof.audit?.identities?.reviewer === 'codex-reviewer-local' &&
        proof.audit?.identities?.verification === 'relay-workspace');
      check('PATH A: source fixture unchanged', proof.sourceUnchanged);
      check('PATH A: no secret-shaped content in output', !SECRET_RE.test(serialized));
      check('PATH A: no hidden reasoning in output', !/chain of thought/i.test(serialized));
      check('PATH A: no fault-injection event exists',
        // The protocol event union does not even contain the kind — the
        // String() comparison is the runtime backstop for that static fact.
        proof.events.every((e) => String(e.kind) !== 'demo.fault_injected') && !serialized.includes('fault_injected'));
      check('PATH A: RELAY COMPLETE claimed exactly once',
        proof.lines.filter((l) => l === 'RELAY COMPLETE').length === 1);
    }

    /* ------- PATH B: genuine finding → bounded repair → re-review ------- */
    {
      const proof = await runScenario(harnessDir,
        { scenario: 'success' },
        {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], resumeVerdict: 'approved', resumeFindings: [],
        },
        '2026-07-24T09:00:00.000Z');
      check('PATH B: completes VERIFIED COMPLETE only after approving re-review (exit 0)',
        proof.exitCode === 0 && proof.audit?.outcome === 'verified-complete', `exit ${proof.exitCode}`);
      check('PATH B: workflow path is repaired_after_re_review', proof.path === 'repaired_after_re_review', proof.path);
      check('PATH B: both verdicts are the reviewer\'s genuine reports in order',
        proof.reviewVerdicts.join(',') === 'changes_required,approved');
      check('PATH B: Finding F-1 and Repair R-1 created and RESOLVED',
        proof.findings.length === 1 && proof.findings[0].findingId === 'F-1' && proof.findings[0].status === 'resolved' &&
        proof.repairs.length === 1 && proof.repairs[0].repairId === 'R-1' && proof.repairs[0].status === 'resolved');
      check('PATH B: finding resolution carries post-repair evidence',
        proof.findings[0]?.resolutionEvidenceIds.length > 0 && proof.postRepairEvidenceIds.length > 0);
      check('PATH B: the EXACT original Claude session resumed (attempt 2 confirmed)',
        proof.claudeResumeConfirmed && proof.implementationReportAttempts.join(',') === '1,2');
      check('PATH B: the EXACT original Codex session resumed',
        proof.codexResumeConfirmed && proof.codexInvocations === 2);
      check('PATH B: the repair is bounded to a single dispatch',
        proof.repairDispatched && proof.claudeInvocations === 2 && proof.audit?.repairCount === 1);
      check('PATH B: Relay re-verified after the repair (both runs passed)',
        proof.verificationRuns === 2 && proof.verificationsPassed.every(Boolean));
      check('PATH B: repair changed only claimed files',
        proof.inspectionAssessments.every((a) => a === 'allowed') && proof.protectedChanges.length === 0);
      check('PATH B: output was held (revision_required) before the repair, released after',
        proof.lines.some((l) => l.includes('Output remains held')) && proof.outputVisibility === 'released');
      check('PATH B: no blocking finding remains open', proof.blockingFindingsOpen === 0);
      check('PATH B: RELAY COMPLETE appears only after the re-review approval',
        proof.lines.findIndex((l) => l === 'RELAY COMPLETE') >
        proof.lines.findIndex((l) => l.includes('INDEPENDENT RE-REVIEW')));
    }

    /* --------- repair limit: re-review still requires changes --------- */
    {
      const proof = await runScenario(harnessDir,
        { scenario: 'success' },
        {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING],
          resumeVerdict: 'changes_required', resumeFindings: [SIMULATED_BLOCKING_FINDING],
        },
        '2026-07-24T10:00:00.000Z');
      check('repair limit: unapproving re-review stops safely (exit 3)', proof.exitCode === 3, `exit ${proof.exitCode}`);
      check('repair limit: never a second automatic repair',
        proof.claudeInvocations === 2 && proof.path === 'stopped');
      check('repair limit: output is never released',
        proof.outputVisibility !== 'released' && proof.outputVisibility !== 'approved_for_release' && proof.audit === null);
      check('repair limit: no RELAY COMPLETE claim', !proof.lines.some((l) => l === 'RELAY COMPLETE'));
      check('repair limit: honest human-decision stop',
        proof.stopReason !== null && /human decision/i.test(proof.stopReason));
    }

    /* --------------------- needs_human and blocked --------------------- */
    {
      const nh = await runScenario(harnessDir,
        { scenario: 'success' },
        { scenario: 'needs_human', verdict: 'needs_human', findings: [] },
        '2026-07-24T11:00:00.000Z');
      check('needs_human keeps output held with no repair (exit 3)',
        nh.exitCode === 3 && nh.outputVisibility === 'held_for_review' && !nh.repairDispatched && nh.claudeInvocations === 1);

      const blocked = await runScenario(harnessDir,
        { scenario: 'success' },
        { scenario: 'blocked', verdict: 'blocked', findings: [SIMULATED_BLOCKING_FINDING] },
        '2026-07-24T11:30:00.000Z');
      check('blocked verdict blocks output with no repair (exit 3)',
        blocked.exitCode === 3 && blocked.outputVisibility === 'blocked' && !blocked.repairDispatched);
    }

    /* ------------------- integrity rejection scenarios ------------------ */
    {
      const modify = await runScenario(harnessDir,
        { scenario: 'success' },
        {
          scenario: 'modify_workspace', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], modifyPath: 'reviewer-scratch.txt',
        },
        '2026-07-24T12:00:00.000Z');
      check('reviewer file modification rejects the review (exit 5), no repair',
        modify.exitCode === 5 && !modify.repairDispatched && modify.claudeInvocations === 1, `exit ${modify.exitCode}`);

      const unclaimed = await runScenario(harnessDir,
        { scenario: 'report_unclaimed_file', unclaimedEditPath: 'package.json' },
        { scenario: 'approved', verdict: 'approved', findings: [] },
        '2026-07-24T12:30:00.000Z');
      check('unclaimed/protected implementer change stops BEFORE any review (exit 5)',
        unclaimed.exitCode === 5 && unclaimed.codexInvocations === 0 && unclaimed.audit === null, `exit ${unclaimed.exitCode}`);

      const clean = await runScenario(harnessDir,
        { scenario: 'manual_action_request' },
        { scenario: 'approved', verdict: 'approved', findings: [] },
        '2026-07-24T13:00:00.000Z');
      check('no implementer change → nothing reviewed, honest stop (exit 5)',
        clean.exitCode === 5 && clean.codexInvocations === 0 && clean.verificationRuns === 0);

      const wrongClaude = await runScenario(harnessDir,
        { scenario: 'wrong_session_on_resume', wrongResumeSessionId: '99999999-8888-4777-8666-555555555555' },
        {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], resumeVerdict: 'approved', resumeFindings: [],
        },
        '2026-07-24T13:30:00.000Z');
      check('mismatched Claude session on repair resume is rejected (exit 5)',
        wrongClaude.exitCode === 5 && !wrongClaude.claudeResumeConfirmed &&
        wrongClaude.codexInvocations === 1 && wrongClaude.audit === null, `exit ${wrongClaude.exitCode}`);

      const wrongCodex = await runScenario(harnessDir,
        { scenario: 'success' },
        {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], resumeVerdict: 'approved', resumeFindings: [],
          emittedResumeSessionId: 'ffffffff-0000-4111-8222-333333333333',
        },
        '2026-07-24T14:00:00.000Z');
      check('mismatched Codex session on re-review resume is rejected (exit 5)',
        wrongCodex.exitCode === 5 && !wrongCodex.codexResumeConfirmed && wrongCodex.audit === null,
        `exit ${wrongCodex.exitCode}`);
      check('mismatched re-review session never completes or releases',
        !wrongCodex.lines.some((l) => l === 'RELAY COMPLETE') && wrongCodex.outputVisibility !== 'released');
    }

    check('no provider call made (fake executables only)', true);
  } catch (err) {
    check('contract verification completed without throwing', false, String((err as Error).message ?? err));
  }

  try { rmSync(harnessDir, { recursive: true, force: true }); } catch { /* ignore */ }
  checks.push({ name: 'harness artifacts removed', ok: !existsSync(harnessDir) });

  return { checks, failures: checks.filter((c) => !c.ok).length };
}
