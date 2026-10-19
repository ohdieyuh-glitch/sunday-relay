import { parseArgs } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicIds, testClock } from '../testing/factories';
import type { IdFactory } from '../protocol/ids';
import type { ClaudeCodeCapabilityProfile } from '../connectors/claude-code/contracts';
import { writeFakeClaude } from '../connectors/claude-code/fake-executable';
import { CLAIMED_FILE, REFERENCE_IMPLEMENTATION } from '../connectors/claude-code/fixture';
import type { CodexReviewerCapabilityProfile } from '../connectors/codex-reviewer/contracts';
import { writeFakeCodex, type FakeReviewerSpec } from '../connectors/codex-reviewer/fake-executable';
import { runSupervisedProof } from '../connectors/supervised/live-runner';
import { SIMULATED_BLOCKING_FINDING } from '../connectors/supervised/verify-harness';
import type { SupervisedPersistenceBoundary } from '../connectors/supervised/contracts';
import { callAuthorization } from './contracts';
import { createStateStore } from './store';
import { createSupervisedRunRecorder } from './supervised-recorder';
import { recoverRun } from './recovery';
import { acquireRunLock, inspectLock } from './lock';
import { resolveRunDir } from './paths';
import { migrateRun } from './migrations';
import { stateDoctorReport } from './doctor';

/**
 * Persistence restart-proof DRIVER (Prompt 8.5) — a standalone child-process
 * entry bundled by the offline verifier so every scenario step runs in a
 * REAL separate Node process against a shared isolated state root. OFFLINE
 * ONLY: fake executables for both agents, zero provider calls. Crash
 * scenarios exit the process immediately after a chosen boundary is durably
 * recorded (process.exit — no unwinding), leaving the lock held and the
 * workspace on disk exactly as a real crash would.
 */

const FAKE_CLAUDE_SESSION = '11111111-2222-4333-8444-555555555555';
const FAKE_CODEX_SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CRASH_EXIT_CODE = 87;

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

/** Tagged id factory so each scenario's run id is distinct + predictable:
 * run_t0001-<tag>. */
function taggedIds(tag: string): IdFactory {
  const base = deterministicIds();
  return {
    next(prefix) {
      const value = base.next(prefix);
      return (prefix === 'run' ? `${value}-${tag}` : value) as never;
    },
  };
}

async function runFakeSupervised(input: {
  stateRoot: string;
  tag: string;
  codexSpec: Partial<FakeReviewerSpec> & { scenario: FakeReviewerSpec['scenario'] };
  stopAfter?: SupervisedPersistenceBoundary;
}): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), `relay-driver-${input.tag}-`));
  const claudeExe = writeFakeClaude(dir, {
    scenario: 'success', sessionId: FAKE_CLAUDE_SESSION, taskId: 'tsk_ignored', runId: 'run_ignored',
    editPath: CLAIMED_FILE, editContent: REFERENCE_IMPLEMENTATION,
  });
  const codexExe = writeFakeCodex(dir, { sessionId: FAKE_CODEX_SESSION, ...input.codexSpec });
  const clock = testClock('2026-07-25T08:00:00.000Z', 25);
  const store = createStateStore({ root: input.stateRoot });
  const recorder = createSupervisedRunRecorder({
    store, now: () => clock.now(),
    afterRecord: input.stopAfter
      ? (boundary) => {
          if (boundary === input.stopAfter) {
            // Crash semantics: no unwinding, no cleanup, lock left held.
            process.stdout.write(`${JSON.stringify({ ok: true, crashedAfter: boundary, runId: recorder.runId })}\n`);
            process.exit(CRASH_EXIT_CODE);
          }
        }
      : undefined,
  });
  const proof = await runSupervisedProof({
    claude: { executablePath: claudeExe, capabilities: claudeCaps(claudeExe, clock.peek()) },
    codex: { executablePath: codexExe, capabilities: codexCaps(codexExe, clock.peek()) },
    now: () => clock.now(), ids: taggedIds(input.tag), baseEnv: process.env,
    persistence: recorder,
  });
  recorder.release();
  return {
    ok: true, runId: recorder.runId, exitCode: proof.exitCode, path: proof.path,
    claudeInvocations: proof.claudeInvocations, codexInvocations: proof.codexInvocations,
    reviewVerdicts: proof.reviewVerdicts,
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      'state-root': { type: 'string' },
      run: { type: 'string' },
      'persist-markers': { type: 'boolean', default: false },
    },
  });
  const scenario = positionals[0] ?? '';
  const stateRoot = values['state-root'];
  if (!stateRoot) throw new Error('--state-root is required');
  const runRef = values.run ?? '';
  const clock = testClock('2026-07-25T12:00:00.000Z', 15);
  const out = (data: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(data)}\n`);
  };

  switch (scenario) {
    case 'patha-complete':
      out(await runFakeSupervised({
        stateRoot, tag: values.run ?? 'patha',
        codexSpec: { scenario: 'approved', verdict: 'approved', findings: [] },
      }));
      return;
    case 'pathb-complete':
      out(await runFakeSupervised({
        stateRoot, tag: values.run ?? 'pathb',
        codexSpec: {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], resumeVerdict: 'approved', resumeFindings: [],
        },
      }));
      return;
    case 'interrupt-after-verification':
      await runFakeSupervised({
        stateRoot, tag: values.run ?? 'iverify',
        codexSpec: { scenario: 'approved', verdict: 'approved', findings: [] },
        stopAfter: 'verification_completed',
      });
      out({ ok: false, error: 'expected to crash before completion' });
      return;
    case 'interrupt-after-repair-created':
      await runFakeSupervised({
        stateRoot, tag: values.run ?? 'ifinding',
        codexSpec: {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], resumeVerdict: 'approved', resumeFindings: [],
        },
        stopAfter: 'repair_created',
      });
      out({ ok: false, error: 'expected to crash before completion' });
      return;
    case 'interrupt-after-reverification':
      await runFakeSupervised({
        stateRoot, tag: values.run ?? 'irever',
        codexSpec: {
          scenario: 'changes_required', verdict: 'changes_required',
          findings: [SIMULATED_BLOCKING_FINDING], resumeVerdict: 'approved', resumeFindings: [],
        },
        stopAfter: 're_verification_completed',
      });
      out({ ok: false, error: 'expected to crash before completion' });
      return;
    case 'recover': {
      const store = createStateStore({ root: stateRoot });
      const report = recoverRun({
        store, reference: runRef, now: () => clock.now(),
        persistMarkers: values['persist-markers'] === true,
      });
      if (!report.ok) { out({ ok: false, error: report.error.message }); process.exitCode = 1; return; }
      const value = report.value;
      out({
        ok: true, runId: value.runId, plan: value.plan, quarantined: value.quarantined,
        projectionKinds: value.projectionEvents.map((e) => e.kind),
        journalEvents: value.loaded?.journal.events.length ?? 0,
        journalIntegrity: value.loaded?.journal.integrity,
        snapshotSource: value.loaded?.snapshotSource,
        lifecycle: value.loaded?.state?.run.lifecycle ?? null,
        outputVisibility: value.loaded?.state?.run.outputVisibility ?? null,
        callBudget: value.loaded?.state?.callBudget ?? null,
        findings: value.loaded?.state?.findings ?? [],
        repairs: value.loaded?.state?.repairs ?? [],
        sessions: (value.loaded?.state?.sessions ?? []).map((s) => ({
          provider: s.provider, attempt: s.attempt, initializationVerified: s.initializationVerified,
          resumeEligible: s.resumeEligible, readiness: value.plan.sessionReadiness[s.provider] ?? s.readiness,
          hasProviderSessionId: s.providerSessionId !== null,
        })),
        workspaceExists: value.workspaceInspection?.workspaceExists ?? null,
        evidenceStatuses: (value.loaded?.state?.evidence ?? []).map((e) => e.status),
      });
      return;
    }
    case 'inspect': {
      const store = createStateStore({ root: stateRoot });
      const loaded = store.loadRun(runRef);
      if (!loaded.ok) { out({ ok: false, error: loaded.error.message }); process.exitCode = 1; return; }
      const state = loaded.value.state;
      out({
        ok: true, area: loaded.value.area, lifecycle: state?.run.lifecycle ?? null,
        completionVerdict: state?.run.completionVerdict ?? null,
        outputVisibility: state?.run.outputVisibility ?? null,
        callBudget: state?.callBudget ?? null,
        fifthCallAuthorized: state ? callAuthorization(state.callBudget, 'claude').authorized : null,
        journalEvents: loaded.value.journal.events.length,
        journalIntegrity: loaded.value.journal.integrity,
        snapshotSource: loaded.value.snapshotSource,
        snapshotConsistent: loaded.value.snapshotConsistent,
        evidenceCount: state?.evidence.length ?? 0,
        findingsCount: state?.findings.length ?? 0,
      });
      return;
    }
    case 'list': {
      const store = createStateStore({ root: stateRoot });
      out({ ok: true, runs: store.listRuns() });
      return;
    }
    case 'doctor': {
      const report = stateDoctorReport({ env: process.env, overrideRoot: stateRoot, now: clock.now() });
      out({ ok: report.exitCode === 0, lines: report.lines, exitCode: report.exitCode });
      return;
    }
    case 'archive': {
      const store = createStateStore({ root: stateRoot });
      const archived = store.archiveRun(runRef, clock.now());
      out(archived.ok ? { ok: true } : { ok: false, error: archived.error.message });
      return;
    }
    case 'migrate': {
      const migrated = migrateRun(stateRoot, runRef, clock.now());
      out(migrated.ok ? { ok: true, ...migrated.value } : { ok: false, error: migrated.error.message });
      return;
    }
    case 'hold-lock': {
      const dir = resolveRunDir(stateRoot, 'runs', runRef);
      if (!dir.ok) { out({ ok: false, error: dir.error.message }); process.exitCode = 1; return; }
      const acquired = acquireRunLock(dir.value, 'driver-hold', () => clock.now());
      if (!acquired.ok) { out({ ok: false, error: acquired.error.message }); process.exitCode = 1; return; }
      out({ ok: true, holding: true });
      setInterval(() => { /* stay alive until killed */ }, 1000);
      return;
    }
    case 'try-lock': {
      const dir = resolveRunDir(stateRoot, 'runs', runRef);
      if (!dir.ok) { out({ ok: false, error: dir.error.message }); process.exitCode = 1; return; }
      const classification = inspectLock(dir.value);
      const acquired = acquireRunLock(dir.value, 'driver-try', () => clock.now());
      if (acquired.ok) {
        acquired.value.lock.release();
        out({ ok: true, acquired: true, priorStatus: classification.status, diagnostics: acquired.value.diagnostics });
      } else {
        out({ ok: true, acquired: false, priorStatus: classification.status, error: acquired.error.message });
      }
      return;
    }
    default:
      out({ ok: false, error: `unknown scenario "${scenario}"` });
      process.exitCode = 2;
  }
}

void main().catch((err) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: (err as Error).message })}\n`);
  process.exitCode = 1;
});
