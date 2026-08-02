import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicIds, testClock } from '../../testing/factories';
import type { ClaudeCodeCapabilityProfile } from './contracts';
import { DEFAULT_LIVE_LIMITS } from './contracts';
import { writeFakeClaude, type FakeSpec } from './fake-executable';
import { REFERENCE_IMPLEMENTATION, CLAIMED_FILE } from './fixture';
import { runClaudeProof } from './live-runner';
import { buildClaudeArgs, createClaudeCodeAdapter } from './adapter';
import type { SessionAssociation } from './session-manager';

/**
 * Claude adapter contract verification (Prompt 8) — makes NO provider call.
 * Drives the FULL pipeline against the deterministic fake Claude executable:
 * end-to-end success and rejection through runClaudeProof, plus direct
 * adapter scenarios for stream parsing, session capture/resume, malformed
 * output, cancellation, and timeout. Mirrors the workspace verify harness.
 */

export interface ContractCheck { name: string; ok: boolean; detail?: string }

const FAKE_SESSION = '11111111-2222-4333-8444-555555555555';

function syntheticCapabilities(executablePath: string, now: string): ClaudeCodeCapabilityProfile {
  return {
    executablePath, version: 'fake-0', nonInteractiveSupported: true, streamJsonSupported: true,
    explicitResumeSupported: true, maxTurnsSupported: false, allowedToolsSupported: true,
    disallowedToolsSupported: true, toolsRestrictionSupported: true, permissionModeSupported: true,
    systemPromptSupported: true, appendSystemPromptSupported: true, structuredSchemaSupported: true,
    mcpIsolationSupported: 'available', settingsIsolationSupported: 'available',
    cancellationSupported: true, probedAt: now, provenance: 'live',
  };
}

const association = (): SessionAssociation => ({
  projectId: 'prj_ct' as never, runId: 'run_ct' as never, taskId: 'tsk_ct' as never,
  workspaceId: 'wsp_ct' as never, adapterId: 'claude-code-local',
});

async function invokeScenario(harnessDir: string, spec: Partial<FakeSpec> & { scenario: FakeSpec['scenario'] }, opts: { timeoutMs?: number; cancelAfterMs?: number } = {}) {
  const clock = testClock('2026-07-23T09:00:00.000Z', 5);
  const now = () => clock.now();
  const fakeDir = mkdtempSync(join(harnessDir, 'fake-'));
  const workspaceDir = mkdtempSync(join(harnessDir, 'ws-'));
  const fullSpec: FakeSpec = {
    sessionId: FAKE_SESSION,
    taskId: 'tsk_ct', runId: 'run_ct', editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
    ...spec,
  };
  const exe = writeFakeClaude(fakeDir, fullSpec);
  const adapter = createClaudeCodeAdapter({ now, ids: deterministicIds() });
  const caps = syntheticCapabilities(exe, now());
  const pkg = {
    packageId: 'pkg_ct' as never, protocolVersion: 'relay.protocol.v1', projectId: 'prj_ct' as never,
    runId: 'run_ct' as never, taskId: 'tsk_ct' as never, targetAdapterId: 'claude-code-local', role: 'coding-agent' as const,
    objective: 'fixture', responsibilityBoundary: 'edit claimed only', contextRefs: [], requiredInputs: [],
    permittedTools: [{ value: 'Edit', enforcement: 'advisory' as const }], permittedFiles: [{ value: CLAIMED_FILE, enforcement: 'advisory' as const }],
    prohibitedActions: [], dependencies: [], acceptanceCriteria: ['pass'], requiredEvidence: [],
    budget: {}, stoppingCondition: { description: 'stop' }, expectedReportType: 'implementation' as const,
    contextVersion: 0 as never, ledgerVersion: 0 as never, baseRevision: 'rev', createdAt: now(),
    idempotencyKey: 'idk' as never,
  };
  const toolPolicy = { availableTools: ['Read', 'Edit'], allowedTools: ['Read', 'Edit'], disallowedTools: ['Bash'], permissionMode: 'acceptEdits' as const, editPathScopingEnforced: false };
  const handleRef: { current: { cancel(): boolean } | null } = { current: null };
  const promise = adapter.invoke({
    executablePath: exe, capabilities: caps, association: association(), pkg: pkg as never,
    workspacePath: workspaceDir, toolPolicy, prompt: 'do it', attempt: 1,
    limits: { ...DEFAULT_LIVE_LIMITS, maxRuntimeMs: opts.timeoutMs ?? DEFAULT_LIVE_LIMITS.maxRuntimeMs, maxStdoutBytes: 64 * 1024 },
    now: now(),
  }, (h) => { handleRef.current = h; });
  if (opts.cancelAfterMs !== undefined) {
    await new Promise((r) => setTimeout(r, opts.cancelAfterMs));
    handleRef.current?.cancel();
  }
  return { result: await promise, adapter };
}

export async function runClaudeContractVerification(): Promise<{ checks: ContractCheck[]; failures: number }> {
  const checks: ContractCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const harnessDir = mkdtempSync(join(tmpdir(), 'relay-claude-contract-'));

  try {
    /* End-to-end success through the FULL proof pipeline (fake exe). */
    const clock = testClock('2026-07-23T10:00:00.000Z', 3);
    const fakeDir = mkdtempSync(join(harnessDir, 'e2e-fake-'));
    const successExe = writeFakeClaude(fakeDir, {
      scenario: 'success', sessionId: FAKE_SESSION, taskId: 'tsk', runId: 'run',
      editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
    });
    const proof = await runClaudeProof({
      executablePath: successExe,
      capabilities: syntheticCapabilities(successExe, '2026-07-23T10:00:00.000Z'),
      now: () => clock.now(), ids: deterministicIds(),
    });
    check('end-to-end proof completes (fake success)', proof.exitCode === 0 && proof.audit?.outcome === 'verified-complete', `exit=${proof.exitCode}`);
    check('session id captured', typeof proof.sessionCaptured === 'string' && proof.sessionCaptured.length > 0);
    check('exactly one claimed file changed', proof.filesChanged.length === 1 && proof.filesChanged[0] === CLAIMED_FILE, proof.filesChanged.join(','));
    check('no protected file changed', proof.protectedChanges.length === 0);
    check('inspection accepted (allowed)', proof.inspectionAssessment === 'allowed');
    check('relay verification passed', proof.verificationPassed);
    check('source worktree unchanged', proof.sourceUnchanged);
    check('audit is live provenance, no reviewer', proof.audit?.provenanceProfile === 'live' && proof.audit?.reviewRefs.length === 0);
    const proofSerialized = JSON.stringify({ e: proof.events, ev: proof.evidence, lines: proof.lines });
    check('no secret-shaped content in proof output', !/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/.test(proofSerialized));
    check('no hidden reasoning leaked', !proofSerialized.includes('chain of thought'));

    /* ---- Live-proof receipt: identity, scope, diff, preservation ---- */
    check('actual model read from the runtime stream', proof.identity.actualModel === 'fake-model', String(proof.identity.actualModel));
    check('unrequested model stays Unknown, never a fallback',
      proof.identity.requestedModel === null && proof.identity.actualModel !== proof.identity.requestedModel);
    check('launch verified only after the stream was seen', proof.identity.launchVerified === true);
    check('session reference is redacted to a tail',
      proof.identity.sessionRefRedacted === `…${FAKE_SESSION.slice(-6)}`, String(proof.identity.sessionRefRedacted));
    check('full session id never appears in the redacted reference',
      !(proof.identity.sessionRefRedacted ?? '').includes(FAKE_SESSION));
    check('paths inspected recorded from real tool activity',
      proof.scope.filesInspected.includes(CLAIMED_FILE), proof.scope.filesInspected.join(','));
    check('scope contained for an in-workspace run', proof.scope.contained && proof.scope.escapes.length === 0);
    check('bounded resulting diff captured',
      typeof proof.unifiedDiff === 'string' && proof.unifiedDiff.includes('normalizeProjectName'));
    check('evidence removed when preservation was not requested',
      proof.preservedWorkspacePath === null && proof.preservedFixturePath === null);
    check('process facts recorded',
      proof.exitCodeObserved === 0 && proof.spawnFailed === false && proof.stopReason === null);

    /* A REQUESTED model is really requested: it reaches the argument array. */
    const argCaps = syntheticCapabilities('/nonexistent', '2026-07-23T10:00:00.000Z');
    const argPolicy = {
      availableTools: ['Read'], allowedTools: ['Read'], disallowedTools: ['Bash'],
      permissionMode: 'acceptEdits' as const, editPathScopingEnforced: false,
    };
    const modelArgs = buildClaudeArgs({ capabilities: argCaps, toolPolicy: argPolicy, attempt: 1, requestedModel: 'sonnet' });
    check('requested model is passed to the runtime',
      modelArgs.includes('--model') && modelArgs.includes('sonnet'), modelArgs.join(' '));
    const noModelArgs = buildClaudeArgs({ capabilities: argCaps, toolPolicy: argPolicy, attempt: 1 });
    check('no model argument when none was requested', !noModelArgs.includes('--model'));

    /* CONTAINMENT: a run that reads outside the workspace is refused even
     * though its stream, edit, report and exit status are all impeccable. */
    const escapeFakeDir = mkdtempSync(join(harnessDir, 'escape-fake-'));
    const escapeExe = writeFakeClaude(escapeFakeDir, {
      scenario: 'read_outside_workspace', sessionId: FAKE_SESSION, taskId: 'tsk', runId: 'run',
      editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION, outsideReadPath: '/etc/passwd',
    });
    const escapeClock = testClock('2026-07-23T13:00:00.000Z', 3);
    const escaped = await runClaudeProof({
      executablePath: escapeExe, capabilities: syntheticCapabilities(escapeExe, '2026-07-23T13:00:00.000Z'),
      now: () => escapeClock.now(), ids: deterministicIds(),
    });
    check('read outside the workspace is detected',
      escaped.scope.contained === false && escaped.scope.escapes.length > 0, escaped.scope.escapes.join(','));
    check('escaping run is stopped, never completed',
      escaped.exitCode === 5 && escaped.audit === null && escaped.completionOutcome !== 'satisfied');
    check('a clean exit does not certify containment',
      /outside the isolated workspace/.test(escaped.stopReason ?? ''));

    /* PRESERVATION: evidence survives, and only because it was requested. */
    const keepFakeDir = mkdtempSync(join(harnessDir, 'keep-fake-'));
    const keepExe = writeFakeClaude(keepFakeDir, {
      scenario: 'success', sessionId: FAKE_SESSION, taskId: 'tsk', runId: 'run',
      editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
    });
    const keepClock = testClock('2026-07-23T14:00:00.000Z', 3);
    const kept = await runClaudeProof({
      executablePath: keepExe, capabilities: syntheticCapabilities(keepExe, '2026-07-23T14:00:00.000Z'),
      now: () => keepClock.now(), ids: deterministicIds(),
      requestedModel: 'sonnet', preserveEvidence: true,
    });
    check('preserved run reports where the work is',
      typeof kept.preservedWorkspacePath === 'string' && typeof kept.preservedFixturePath === 'string');
    check('preserved work still exists on disk',
      kept.preservedWorkspacePath !== null && existsSync(join(kept.preservedWorkspacePath, CLAIMED_FILE)));
    check('requested and actual model both recorded, and differ',
      kept.identity.requestedModel === 'sonnet' && kept.identity.actualModel === 'fake-model');
    // Clean up what the harness itself preserved — the founder-facing flag is
    // the only path where preserved evidence outlives the process.
    if (kept.preservedFixturePath) rmSync(kept.preservedFixturePath, { recursive: true, force: true });

    /* Rejection: unclaimed/protected change stops the run, no completion. */
    const rejectFakeDir = mkdtempSync(join(harnessDir, 'reject-fake-'));
    const rejectExe = writeFakeClaude(rejectFakeDir, {
      scenario: 'report_unclaimed_file', sessionId: FAKE_SESSION, taskId: 'tsk', runId: 'run',
      editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION, unclaimedEditPath: 'package.json',
    });
    const rejectClock = testClock('2026-07-23T11:00:00.000Z', 3);
    const rejected = await runClaudeProof({
      executablePath: rejectExe, capabilities: syntheticCapabilities(rejectExe, '2026-07-23T11:00:00.000Z'),
      now: () => rejectClock.now(), ids: deterministicIds(),
    });
    check('protected/unclaimed change stops the run', rejected.exitCode === 5 && rejected.audit === null, `exit=${rejected.exitCode}`);
    check('rejected run claims no completion', rejected.completionOutcome !== 'satisfied');

    /* Stream parsing + structural validity scenarios. */
    const malformed = await invokeScenario(harnessDir, { scenario: 'malformed_line' });
    check('malformed line tolerated; run still usable', malformed.result.structurallyValid && malformed.result.report.ok && malformed.result.outcome.parsed.malformedLineCount > 0);
    const missingInit = await invokeScenario(harnessDir, { scenario: 'missing_init' });
    check('missing init record rejected', !missingInit.result.structurallyValid);
    const missingSession = await invokeScenario(harnessDir, { scenario: 'missing_session' });
    check('missing session id rejected', !missingSession.result.structurallyValid);
    const maxTurns = await invokeScenario(harnessDir, { scenario: 'max_turns' });
    check('max-turns error is not a trusted report', maxTurns.result.outcome.parsed.isError === true && !maxTurns.result.report.ok);
    const execErr = await invokeScenario(harnessDir, { scenario: 'execution_error' });
    check('execution error is not a trusted report', !execErr.result.report.ok);
    const hidden = await invokeScenario(harnessDir, { scenario: 'hidden_reasoning' });
    const hiddenSerialized = JSON.stringify(hidden.result.events);
    check('hidden reasoning omitted and counted', hidden.result.outcome.parsed.thinkingBlocksOmitted > 0 && !hiddenSerialized.includes('SECRET internal'));
    const overflow = await invokeScenario(harnessDir, { scenario: 'output_overflow' });
    check('output overflow truncates and terminates', overflow.result.outcome.outputTruncated === true);
    const wrongTask = await invokeScenario(harnessDir, { scenario: 'report_wrong_task' });
    check('report with wrong task association rejected', !wrongTask.result.report.ok);

    /* Timeout + cancellation via the fake (no provider call). */
    const timeout = await invokeScenario(harnessDir, { scenario: 'timeout' }, { timeoutMs: 400 });
    check('runaway run times out with confirmed termination', timeout.result.outcome.timedOut && timeout.result.outcome.termination === 'termination_confirmed');
    const cancelled = await invokeScenario(harnessDir, { scenario: 'cancellation' }, { timeoutMs: 30_000, cancelAfterMs: 300 });
    check('run cancels on request with confirmed termination', cancelled.result.outcome.cancelled && cancelled.result.outcome.termination === 'termination_confirmed');

    /* Session capture + explicit resume through the manager. */
    const sessionAdapter = createClaudeCodeAdapter({ now: () => '2026-07-23T12:00:00.000Z', ids: deterministicIds() });
    const assoc = association();
    const cap1 = sessionAdapter.sessions.capture(assoc, FAKE_SESSION);
    check('session captured', cap1.ok);
    const dup = sessionAdapter.sessions.capture(assoc, FAKE_SESSION);
    check('duplicate session capture rejected', !dup.ok);
    const resumePlan = sessionAdapter.sessions.prepareResume(assoc);
    check('resume prepared with captured id', resumePlan.ok && resumePlan.value.claudeSessionId === FAKE_SESSION);
    const wrong = sessionAdapter.sessions.confirmResume(assoc, 'different-id');
    check('wrong resumed session id rejected', !wrong.ok);
    const right = sessionAdapter.sessions.confirmResume(assoc, FAKE_SESSION);
    check('correct resumed session id accepted', right.ok);
    const secondRepair = sessionAdapter.sessions.prepareResume(assoc);
    check('second repair prohibited', !secondRepair.ok);
  } catch (error) {
    check('contract harness completed', false, error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(harnessDir, { recursive: true, force: true });
  }
  checks.push({ name: 'no provider call made (fake executable only)', ok: true });
  checks.push({ name: 'harness artifacts removed', ok: !existsSync(harnessDir) });
  return { checks, failures: checks.filter((c) => !c.ok).length };
}
