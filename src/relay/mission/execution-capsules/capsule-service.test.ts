import { describe, expect, it } from 'vitest';

import {
  claudeImplementationInput,
  codexReviewInput,
  browserWorkspace,
  CAPSULE_T0,
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T3,
  CAPSULE_T4,
  CAPSULE_T_STALE,
  CLAUDE_ACTUAL,
  CODEX_ACTUAL,
  completionClaim,
  finalReport,
  hermesOperationsInput,
  partialOutput,
  prepareFixture,
  runningFixture,
  STALL_THRESHOLD_MS,
  verifiedAttestation,
} from './capsule-fixtures';
import {
  attachCompletionClaim,
  attachFinalReport,
  attachLaunchAttestation,
  attachPartialOutput,
  evaluateHeartbeatLiveness,
  markCancelled,
  markCompleted,
  markFailed,
  markOrphaned,
  markRunning,
  markStalled,
  markTimedOut,
  markWaiting,
  prepareExecutionCapsule,
  recordHeartbeat,
  recordLaunchRequested,
} from './capsule-service';
import type { PrepareExecutionCapsuleInput } from './capsule-service';

describe('capsule preparation', () => {
  it('produces the canonical prepared capsule with no actual identity and no launch', () => {
    const result = prepareExecutionCapsule(claudeImplementationInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const capsule = result.value;

    expect(capsule.status).toBe('prepared');
    expect(capsule.identity.kind).toBe('requested');
    expect(capsule.identity.requested.agentId).toBe('agent-claude');
    expect('actual' in capsule.identity).toBe(false);
    expect(capsule.traceIntegrityStatus).toBe('not_evaluated');
    expect(capsule.evidenceIds).toEqual([]);
    expect(capsule.costReceiptIds).toEqual([]);
    expect(capsule.startedAt).toBeUndefined();
    expect(capsule.finishedAt).toBeUndefined();
    expect(capsule.binding).toMatchObject({
      missionRevision: 4,
      taskRevision: 2,
      handoffId: 'handoff-auth-repair-1',
      handoffCompilerVersion: '0.3.1',
      policyPackVersion: 'implementation-v3',
      passportId: 'passport-claude-1',
    });
    expect(capsule.createdAt).toBe(CAPSULE_T0);
  });

  it.each([
    ['projectId', { projectId: '' }, 'MISSING_PROJECT_ID'],
    ['missionId', { missionId: '' }, 'MISSING_MISSION_ID'],
    ['taskId', { taskId: '' }, 'MISSING_TASK_ID'],
    ['runId', { runId: '' }, 'MISSING_RUN_ID'],
    ['missionRevision', { missionRevision: 0 }, 'INVALID_MISSION_REVISION'],
    ['negative missionRevision', { missionRevision: -1 }, 'INVALID_MISSION_REVISION'],
    ['taskRevision', { taskRevision: 0 }, 'INVALID_TASK_REVISION'],
    ['handoffId', { handoffId: '' }, 'MISSING_HANDOFF_REFERENCE'],
    ['policyPackVersion', { policyPackVersion: '' }, 'MISSING_POLICY_REFERENCE'],
    ['passportId', { passportId: '' }, 'MISSING_PASSPORT_REFERENCE'],
  ] as const)('rejects a missing/invalid %s', (_label, over, code) => {
    const result = prepareExecutionCapsule(
      claudeImplementationInput(over as Partial<PrepareExecutionCapsuleInput>),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expect(result.error.safeNextAction).toBeTruthy();
  });

  it('rejects a missing requested agent', () => {
    const result = prepareExecutionCapsule(
      claudeImplementationInput({
        requestedAgent: { agentId: '', agentType: 'claude_code' },
      }),
    );
    expect(!result.ok && result.error.code).toBe('MISSING_REQUESTED_AGENT');
  });

  it('rejects a file-changing responsibility with no workspace', () => {
    const result = prepareExecutionCapsule(
      claudeImplementationInput({ workspace: undefined }),
    );
    expect(!result.ok && result.error.code).toBe('WORKSPACE_REQUIRED');
  });

  it('accepts a reviewer responsibility bound to a read-only workspace', () => {
    const result = prepareExecutionCapsule(codexReviewInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace?.readOnly).toBe(true);
    expect(result.value.permissions.readOnly).toBe(true);
  });

  it('accepts an operations run with no workspace at all', () => {
    expect(prepareExecutionCapsule(hermesOperationsInput()).ok).toBe(true);
  });

  it('rejects a write-owner conflict at preparation', () => {
    const result = prepareExecutionCapsule(
      claudeImplementationInput({ workspace: browserWorkspace('agent-hermes') }),
    );
    expect(!result.ok && result.error.code).toBe('WRITE_OWNER_CONFLICT');
    if (result.ok) return;
    expect(result.error.expected).toBe('agent-claude');
    expect(result.error.actual).toBe('agent-hermes');
  });

  it('rejects a file-changing run bound to a read-only workspace', () => {
    const result = prepareExecutionCapsule(
      claudeImplementationInput({
        workspace: { ...browserWorkspace(), readOnly: true },
      }),
    );
    expect(!result.ok && result.error.code).toBe('WORKSPACE_INCOMPATIBLE');
  });

  it('never mutates its input objects', () => {
    const input = claudeImplementationInput();
    const snapshot = JSON.stringify(input);
    const prepared = prepareExecutionCapsule(input);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // Mutating the RESULT must not reach the input.
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(prepared.value.inputContext).not.toBe(input.inputContext);
    expect(prepared.value.identity.requested).not.toBe(input.requestedAgent);
  });
});

describe('lifecycle operations', () => {
  it('records a launch request without granting any actual identity', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    const result = recordLaunchRequested(prepared, CAPSULE_T1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('starting');
    expect(result.value.identity.kind).toBe('launch_requested');
    expect('actual' in result.value.identity).toBe(false);
    // The previous capsule is untouched.
    expect(prepared.status).toBe('prepared');
  });

  it('refuses to mark a run running before its launch is verified', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    expect(starting.ok).toBe(true);
    if (!starting.ok) return;
    const result = markRunning(starting.value, CAPSULE_T2);
    expect(!result.ok && result.error.code).toBe('LAUNCH_NOT_VERIFIED');
    expect(starting.value.status).toBe('starting');
  });

  it('a verified launch enables running and records startedAt', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    expect(running.status).toBe('running');
    expect(running.startedAt).toBe(CAPSULE_T2);
    expect(running.identity.kind).toBe('verified');
  });

  it('running → waiting → running → stalled → running is permitted', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const waiting = markWaiting(running, CAPSULE_T3);
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    const resumed = markRunning(waiting.value, CAPSULE_T3);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    const stalled = markStalled(resumed.value, CAPSULE_T3);
    expect(stalled.ok).toBe(true);
    if (!stalled.ok) return;
    expect(markRunning(stalled.value, CAPSULE_T4).ok).toBe(true);
  });

  it('completing requires a final report unless policy waives it', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const withoutReport = markCompleted(running, { at: CAPSULE_T4 });
    expect(!withoutReport.ok && withoutReport.error.code).toBe('FINAL_REPORT_REQUIRED');

    const withReport = markCompleted(running, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    expect(withReport.ok).toBe(true);
    if (!withReport.ok) return;
    expect(withReport.value.status).toBe('completed');
    expect(withReport.value.finishedAt).toBe(CAPSULE_T4);

    const waived = runningFixture(hermesOperationsInput(), {
      agentId: 'agent-hermes',
      agentType: 'hermes',
      executionIdentityId: 'identity-hermes',
    });
    expect(markCompleted(waived, { at: CAPSULE_T4 }).ok).toBe(true);
  });

  it.each([
    ['failed', markFailed],
    ['cancelled', markCancelled],
    ['timed_out', markTimedOut],
    ['orphaned', markOrphaned],
  ] as const)('%s preserves partial output and records finishedAt', (status, operation) => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const result = operation(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(status);
    expect(result.value.finishedAt).toBe(CAPSULE_T4);
    expect(result.value.partialOutput?.referenceId).toBe('partial-fixture-1');
    expect(result.value.finalReport).toBeUndefined();
  });

  it('a terminal capsule is immutable — every lifecycle operation is rejected', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const cancelled = markCancelled(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    const capsule = cancelled.value;
    const before = JSON.stringify(capsule);

    for (const attempt of [
      markRunning(capsule, CAPSULE_T4),
      markWaiting(capsule, CAPSULE_T4),
      markCompleted(capsule, { at: CAPSULE_T4, finalReport: finalReport('agent-claude') }),
      attachFinalReport(capsule, finalReport('agent-claude'), CAPSULE_T4),
      attachCompletionClaim(capsule, completionClaim('agent-claude'), CAPSULE_T4),
      attachPartialOutput(capsule, partialOutput(), CAPSULE_T4),
      recordHeartbeat(capsule, CAPSULE_T4),
    ]) {
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) {
        expect(['TERMINAL_CAPSULE_IMMUTABLE', 'INVALID_CAPSULE_STATUS_TRANSITION']).toContain(
          attempt.error.code,
        );
      }
    }
    expect(JSON.stringify(capsule)).toBe(before);
  });

  it('rejects a launch attestation issued for a different capsule or agent', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');

    const wrongCapsule = attachLaunchAttestation(starting.value, {
      attestation: verifiedAttestation('cap-other', claudeImplementationInput().requestedAgent, CLAUDE_ACTUAL),
      actualAgent: CLAUDE_ACTUAL,
      at: CAPSULE_T2,
    });
    expect(!wrongCapsule.ok && wrongCapsule.error.code).toBe('INVALID_LAUNCH_ATTESTATION');

    const wrongAgent = attachLaunchAttestation(starting.value, {
      attestation: verifiedAttestation('cap-claude-impl', codexReviewInput().requestedAgent, CODEX_ACTUAL),
      actualAgent: CODEX_ACTUAL,
      at: CAPSULE_T2,
    });
    expect(!wrongAgent.ok && wrongAgent.error.code).toBe('INVALID_LAUNCH_ATTESTATION');
  });

  it('rejects an attestation attached before a launch was requested', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    const result = attachLaunchAttestation(prepared, {
      attestation: verifiedAttestation('cap-claude-impl', claudeImplementationInput().requestedAgent, CLAUDE_ACTUAL),
      actualAgent: CLAUDE_ACTUAL,
      at: CAPSULE_T2,
    });
    expect(!result.ok && result.error.code).toBe('LAUNCH_NOT_REQUESTED');
  });
});

describe('heartbeats and stall detection', () => {
  it('records monotonic heartbeats and rejects regressions', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const first = recordHeartbeat(running, CAPSULE_T3);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.lastHeartbeatAt).toBe(CAPSULE_T3);

    const backwards = recordHeartbeat(first.value, CAPSULE_T2);
    expect(!backwards.ok && backwards.error.code).toBe('INVALID_TIMESTAMP_ORDER');
    expect(first.value.lastHeartbeatAt).toBe(CAPSULE_T3);
  });

  it('a heartbeat cannot precede startedAt', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const result = recordHeartbeat(running, CAPSULE_T1);
    expect(!result.ok && result.error.code).toBe('INVALID_TIMESTAMP_ORDER');
  });

  it('evaluates stall against an INJECTED clock, never a real one', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const beating = recordHeartbeat(running, CAPSULE_T3);
    if (!beating.ok) throw new Error('setup failed');

    const fresh = evaluateHeartbeatLiveness(beating.value, CAPSULE_T3, STALL_THRESHOLD_MS);
    expect(fresh.stalled).toBe(false);

    const stale = evaluateHeartbeatLiveness(beating.value, CAPSULE_T_STALE, STALL_THRESHOLD_MS);
    expect(stale.stalled).toBe(true);
    expect(stale.silentForMs).toBe(26 * 60 * 1000);
    expect(markStalled(beating.value, CAPSULE_T_STALE).ok).toBe(true);
  });

  it('a run that never started is not stalled', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    expect(evaluateHeartbeatLiveness(prepared, CAPSULE_T_STALE, STALL_THRESHOLD_MS).stalled).toBe(false);
  });
});
