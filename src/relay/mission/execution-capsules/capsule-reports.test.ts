import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T3,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  codexReviewInput,
  CODEX_REQUESTED,
  completionClaim,
  failedAttestation,
  finalReport,
  partialOutput,
  prepareFixture,
  runningFixture,
} from './capsule-fixtures';
import { completionClaimEstablishesVerification } from './capsule-reports';
import {
  attachCompletionClaim,
  attachFinalReport,
  attachLaunchAttestation,
  attachPartialOutput,
  markCancelled,
  markCompleted,
  markFailed,
  markOrphaned,
  markTimedOut,
  recordLaunchRequested,
} from './capsule-service';
import { projectCapsuleExecutionStatus } from './capsule-status';
import { createInitialAqualaOutcomeStatus } from '../status/status-model';

const running = () => runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);

describe('partial output', () => {
  it('may be attached while the run is still active', () => {
    const result = attachPartialOutput(running(), partialOutput(), CAPSULE_T3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('running');
    expect(result.value.partialOutput?.changedFileCount).toBe(2);
  });

  it.each([
    ['cancellation', markCancelled, 'cancelled'],
    ['failure', markFailed, 'failed'],
    ['timeout', markTimedOut, 'timed_out'],
    ['loss of control', markOrphaned, 'orphaned'],
  ] as const)('survives %s', (_label, operation, status) => {
    const withPartial = attachPartialOutput(running(), partialOutput(), CAPSULE_T3);
    if (!withPartial.ok) throw new Error('setup failed');
    const result = operation(withPartial.value, { at: CAPSULE_T4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(status);
    expect(result.value.partialOutput?.referenceId).toBe('partial-fixture-1');
    expect(result.value.finalReport).toBeUndefined();
  });
});

describe('final report and completion claim', () => {
  it('are separate records with separate truth classes', () => {
    const withReport = attachFinalReport(running(), finalReport('agent-claude'), CAPSULE_T4);
    if (!withReport.ok) throw new Error('setup failed');
    const withClaim = attachCompletionClaim(
      withReport.value,
      completionClaim('agent-claude'),
      CAPSULE_T4,
    );
    expect(withClaim.ok).toBe(true);
    if (!withClaim.ok) return;
    expect(withClaim.value.finalReport?.truth).toBe('agent_claim');
    expect(withClaim.value.completionClaim?.truth).toBe('agent_claim');
    expect(withClaim.value.finalReport?.referenceId).not.toBe(
      withClaim.value.completionClaim?.referenceId,
    );
  });

  it('a completion claim never sets outcome, verification, or release', () => {
    const completed = markCompleted(running(), {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');

    expect(completionClaimEstablishesVerification()).toBe(false);
    const projected = {
      ...createInitialAqualaOutcomeStatus(),
      executionStatus: projectCapsuleExecutionStatus(completed.value.status),
    };
    expect(projected.executionStatus).toBe('completed');
    expect(projected.outcomeStatus).toBe('unknown');
    expect(projected.verificationStatus).toBe('unverified');
    expect(projected.releaseStatus).toBe('not_eligible');
  });

  it('a failed launch can never receive a fabricated final report or claim', () => {
    const prepared = prepareFixture(codexReviewInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');
    const failedLaunch = attachLaunchAttestation(starting.value, {
      attestation: failedAttestation('cap-codex-review', CODEX_REQUESTED, 'execution permission denied'),
      at: CAPSULE_T2,
    });
    if (!failedLaunch.ok) throw new Error('setup failed');

    const report = attachFinalReport(failedLaunch.value, finalReport('agent-codex'), CAPSULE_T4);
    expect(!report.ok && report.error.code).toBe('ACTUAL_AGENT_NOT_VERIFIED');
    const claim = attachCompletionClaim(failedLaunch.value, completionClaim('agent-codex'), CAPSULE_T4);
    expect(!claim.ok && claim.error.code).toBe('ACTUAL_AGENT_NOT_VERIFIED');
    expect(failedLaunch.value.finalReport).toBeUndefined();
  });

  it('a cancelled run may legitimately lack a final report', () => {
    const cancelled = markCancelled(running(), { at: CAPSULE_T4, partialOutput: partialOutput() });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.finalReport).toBeUndefined();
    expect(cancelled.value.partialOutput).toBeDefined();
  });

  it('an orphaned run retains partial output and never auto-completes', () => {
    const withPartial = attachPartialOutput(running(), partialOutput(), CAPSULE_T3);
    if (!withPartial.ok) throw new Error('setup failed');
    const orphaned = markOrphaned(withPartial.value, { at: CAPSULE_T4 });
    expect(orphaned.ok).toBe(true);
    if (!orphaned.ok) return;
    expect(orphaned.value.status).toBe('orphaned');
    expect(orphaned.value.partialOutput).toBeDefined();
    expect(orphaned.value.completionClaim).toBeUndefined();
    expect(markCompleted(orphaned.value, { at: CAPSULE_T4 }).ok).toBe(false);
  });
});
