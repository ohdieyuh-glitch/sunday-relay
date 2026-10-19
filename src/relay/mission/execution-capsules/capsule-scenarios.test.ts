import { describe, expect, it } from 'vitest';

/**
 * The ten required deterministic fixtures (A–J), driven END-TO-END through the
 * real services and repository, plus the Milestone 2 command-integration
 * BOUNDARY (documented and typed here; the command executor is not changed).
 */

import {
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T3,
  CAPSULE_T4,
  CAPSULE_T_STALE,
  CLAUDE_ACTUAL,
  CLAUDE_REQUESTED,
  claudeImplementationInput,
  codexReviewInput,
  CODEX_ACTUAL,
  CODEX_REQUESTED,
  completionClaim,
  failedAttestation,
  finalReport,
  HERMES_ACTUAL,
  HERMES_REQUESTED,
  hermesOperationsInput,
  MANUAL_ACTUAL,
  MOCK_WRAPPER_ACTUAL,
  observedOtherRuntimeAttestation,
  partialOutput,
  prepareFixture,
  runningFixture,
  secretShapedMetadata,
  STALL_THRESHOLD_MS,
  verifiedAttestation,
} from './capsule-fixtures';
import { evaluateReviewCredit } from './capsule-identity';
import { evaluateCapsuleReviewCredit } from './capsule-types';
import { projectAgentRun } from './capsule-projection';
import { InMemoryExecutionCapsuleRepository } from './capsule-repository';
import {
  appendCapsuleTraceReference,
  attachEvidenceId,
  attachLaunchAttestation,
  attachPartialOutput,
  evaluateHeartbeatLiveness,
  markCancelled,
  markCompleted,
  markFailed,
  markOrphaned,
  markRunning,
  markStalled,
  markWaiting,
  recordHeartbeat,
  recordLaunchRequested,
} from './capsule-service';
import { projectCapsuleExecutionStatus } from './capsule-status';
import { createInitialAqualaOutcomeStatus } from '../status/status-model';

function startedCapsule(input = claudeImplementationInput()) {
  const prepared = prepareFixture(input);
  const starting = recordLaunchRequested(prepared, CAPSULE_T1);
  if (!starting.ok) throw new Error('setup failed');
  return starting.value;
}

describe('fixture A — Claude Code implementation run', () => {
  it('completes with a report and evidence, determining neither outcome nor verification', () => {
    const repository = new InMemoryExecutionCapsuleRepository();
    let capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    expect(repository.create(capsule).ok).toBe(true);

    const withFile = appendCapsuleTraceReference(capsule, {
      channel: 'fileEvents',
      reference: {
        referenceId: 'ref-file-a', eventId: 'evt-file-a', eventType: 'file.changed',
        occurredAt: CAPSULE_T3, actorId: 'workspace-monitor',
        source: 'workspace_monitor', integrity: 'trusted_source',
      },
      at: CAPSULE_T3,
    });
    if (!withFile.ok) throw new Error('setup failed');
    const withEvidence = attachEvidenceId(withFile.value, 'ev-tests-a', CAPSULE_T3);
    if (!withEvidence.ok) throw new Error('setup failed');
    const completed = markCompleted(withEvidence.value, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    capsule = completed.value;
    expect(repository.replace(capsule).ok).toBe(true);

    expect(capsule.status).toBe('completed');
    expect(capsule.identity.kind).toBe('verified');
    expect(capsule.workspace?.kind).toBe('browser_worktree');
    expect(capsule.finalReport).toBeDefined();
    expect(capsule.completionClaim).toBeDefined();
    expect(capsule.evidenceIds).toEqual(['ev-tests-a']);

    // Outcome and verification are NOT determined by the capsule.
    const projected = {
      ...createInitialAqualaOutcomeStatus(),
      executionStatus: projectCapsuleExecutionStatus(capsule.status),
    };
    expect(projected).toEqual({
      executionStatus: 'completed',
      outcomeStatus: 'unknown',
      verificationStatus: 'unverified',
      releaseStatus: 'not_eligible',
    });
  });
});

describe('fixture B — Codex review run', () => {
  it('is review-credit eligible because identity and launch were verified', () => {
    const reviewer = runningFixture(codexReviewInput(), CODEX_ACTUAL);
    const completed = markCompleted(reviewer, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-codex', { reportFormat: 'relay-review-report/1' }),
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const withFinding = attachEvidenceId(reviewer, 'finding-auth-1', CAPSULE_T3);
    expect(withFinding.ok).toBe(true);

    expect(completed.value.workspace?.readOnly).toBe(true);
    const credit = evaluateReviewCredit(completed.value.identity, 'review');
    expect(credit.eligible).toBe(true);
    expect(credit.creditedAgentId).toBe('agent-codex');
  });
});

describe('fixture C — Codex failed to launch', () => {
  it('fails with no actual identity and no review credit', () => {
    const starting = startedCapsule(codexReviewInput());
    const attested = attachLaunchAttestation(starting, {
      attestation: failedAttestation('cap-codex-review', CODEX_REQUESTED, 'execution permission denied'),
      at: CAPSULE_T2,
    });
    if (!attested.ok) throw new Error('setup failed');

    expect(markRunning(attested.value, CAPSULE_T2).ok).toBe(false);
    const failed = markFailed(attested.value, { at: CAPSULE_T4 });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;

    expect(failed.value.status).toBe('failed');
    expect(failed.value.identity.kind).toBe('launch_failed');
    expect(projectAgentRun(failed.value).identity.actual).toBeNull();
    expect(evaluateReviewCredit(failed.value.identity, 'review').eligible).toBe(false);
    expect(failed.value.finalReport).toBeUndefined();
  });
});

describe('fixture D — unauthorized fallback', () => {
  it('cannot enter running, credits neither Codex nor the wrapper, and stays visible', () => {
    const starting = startedCapsule(codexReviewInput());
    const observed = attachLaunchAttestation(starting, {
      attestation: observedOtherRuntimeAttestation('cap-codex-review', CODEX_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      fallbackAuthorization: { authorized: false, reason: 'no policy permits a wrapper substitution' },
      at: CAPSULE_T2,
    });
    if (!observed.ok) throw new Error('setup failed');

    const running = markRunning(observed.value, CAPSULE_T2);
    expect(!running.ok && running.error.code).toBe('UNAUTHORIZED_FALLBACK');

    const projection = projectAgentRun(observed.value);
    expect(projection.identity.requested).toBe('agent-codex');
    expect(projection.identity.actual).toBeNull();
    expect(projection.identity.observed).toBe('agent-mock-wrapper');
    expect(projection.identity.fallback).toBe('Yes — NOT authorized');
    expect(evaluateReviewCredit(observed.value.identity, 'review').eligible).toBe(false);

    // It may only be closed out.
    expect(markFailed(observed.value, { at: CAPSULE_T4 }).ok).toBe(true);
  });
});

describe('fixture E — authorized fallback', () => {
  it('keeps both identities visible and may proceed under policy', () => {
    const starting = startedCapsule();
    const verified = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, MANUAL_ACTUAL),
      actualAgent: MANUAL_ACTUAL,
      fallbackAuthorization: {
        authorized: true,
        authorizedBy: 'user-founder',
        reason: 'Claude Code unavailable; founder authorized a manual agent',
      },
      at: CAPSULE_T2,
    });
    if (!verified.ok) throw new Error('setup failed');

    const running = markRunning(verified.value, CAPSULE_T2);
    expect(running.ok).toBe(true);
    if (!running.ok) return;
    const projection = projectAgentRun(running.value);
    expect(projection.identity.requested).toBe('agent-claude');
    expect(projection.identity.actual).toBe('agent-manual');
    expect(projection.identity.fallback).toBe('Yes — authorized');
  });
});

describe('fixture F — cancelled run with partial output', () => {
  it('preserves partial output, has no final report, and stays inspectable', () => {
    const repository = new InMemoryExecutionCapsuleRepository();
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    repository.create(running);
    const cancelled = markCancelled(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    repository.replace(cancelled.value);

    const stored = repository.get('cap-claude-impl');
    expect(stored?.status).toBe('cancelled');
    expect(stored?.partialOutput?.changedFileCount).toBe(2);
    expect(stored?.finalReport).toBeUndefined();
    expect(stored?.identity.requested.agentId).toBe('agent-claude');
    expect(projectCapsuleExecutionStatus('cancelled')).toBe('cancelled');
  });
});

describe('fixture G — orphaned external session', () => {
  it('never auto-completes, grants no review credit, and retains partial output', () => {
    const hermes = runningFixture(hermesOperationsInput(), HERMES_ACTUAL);
    const withPartial = attachPartialOutput(hermes, partialOutput(), CAPSULE_T3);
    if (!withPartial.ok) throw new Error('setup failed');
    const orphaned = markOrphaned(withPartial.value, { at: CAPSULE_T4 });
    expect(orphaned.ok).toBe(true);
    if (!orphaned.ok) return;

    expect(orphaned.value.status).toBe('orphaned');
    expect(orphaned.value.partialOutput).toBeDefined();
    expect(orphaned.value.completionClaim).toBeUndefined();
    expect(markCompleted(orphaned.value, { at: CAPSULE_T4 }).ok).toBe(false);
    expect(orphaned.value.identity.requested.agentId).toBe(HERMES_REQUESTED.agentId);
  });

  it('an orphaned REVIEWER earns no review credit even though its identity was verified', () => {
    const reviewer = runningFixture(codexReviewInput(), CODEX_ACTUAL);
    // Identity alone would qualify…
    expect(evaluateReviewCredit(reviewer.identity, 'review').eligible).toBe(true);
    const orphaned = markOrphaned(reviewer, { at: CAPSULE_T4, partialOutput: partialOutput() });
    if (!orphaned.ok) throw new Error('setup failed');
    // …but Relay lost contact before the review finished, so the capsule
    // grants nothing.
    const credit = evaluateCapsuleReviewCredit(orphaned.value);
    expect(credit.eligible).toBe(false);
    expect(credit.reason).toMatch(/orphaned/u);
    expect(projectAgentRun(orphaned.value).reviewCredit.eligible).toBe(false);
  });
});

describe('fixture H — completed run without verified outcome', () => {
  it('projects execution completed with outcome unknown, unverified, not eligible', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const completed = markCompleted(running, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');

    expect({
      ...createInitialAqualaOutcomeStatus(),
      executionStatus: projectCapsuleExecutionStatus(completed.value.status),
    }).toEqual({
      executionStatus: 'completed',
      outcomeStatus: 'unknown',
      verificationStatus: 'unverified',
      releaseStatus: 'not_eligible',
    });
  });
});

describe('fixture I — stalled run', () => {
  it('detects a stale heartbeat against an injected clock and moves to stalled', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const beating = recordHeartbeat(running, CAPSULE_T3);
    if (!beating.ok) throw new Error('setup failed');

    const liveness = evaluateHeartbeatLiveness(beating.value, CAPSULE_T_STALE, STALL_THRESHOLD_MS);
    expect(liveness.stalled).toBe(true);

    const stalled = markStalled(beating.value, CAPSULE_T_STALE);
    expect(stalled.ok).toBe(true);
    if (!stalled.ok) return;
    expect(stalled.value.status).toBe('stalled');
    // Stalled is alive-but-silent: it projects to WAITING, not failed.
    expect(projectCapsuleExecutionStatus('stalled')).toBe('waiting');
    // …and it can still recover.
    expect(markRunning(stalled.value, CAPSULE_T4).ok).toBe(true);
  });
});

describe('fixture J — secret redaction', () => {
  it('stores only redacted values when metadata carries synthetic credentials', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const result = appendCapsuleTraceReference(running, {
      channel: 'commandEvents',
      reference: {
        referenceId: 'ref-secret-j', eventId: 'evt-secret-j', eventType: 'command.run',
        occurredAt: CAPSULE_T3, actorId: 'relay-supervisor', source: 'relay_supervisor',
        metadata: secretShapedMetadata(),
      },
      at: CAPSULE_T3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = JSON.stringify(result.value);
    expect(stored).not.toContain('sk-fixture0123456789abcdef');
    expect(stored).not.toContain('fixture-token-0123456789');
    expect(stored).toContain('[redacted]');
  });
});

describe('Milestone 2 command integration boundary', () => {
  it('PAUSE maps to waiting only after the checkpoint representation exists', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    // The command layer captures partial work first; the capsule then waits.
    const checkpointed = attachPartialOutput(running, partialOutput(), CAPSULE_T3);
    if (!checkpointed.ok) throw new Error('setup failed');
    const waiting = markWaiting(checkpointed.value, CAPSULE_T3);
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    expect(waiting.value.partialOutput).toBeDefined();
    expect(waiting.value.status).toBe('waiting');
  });

  it('RESUME returns a waiting capsule to running while the process stays valid', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const waiting = markWaiting(running, CAPSULE_T3);
    if (!waiting.ok) throw new Error('setup failed');
    const resumed = markRunning(waiting.value, CAPSULE_T3);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.identity.kind).toBe('verified');
  });

  it('CANCEL preserves partial output and closes the capsule', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const cancelled = markCancelled(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.partialOutput).toBeDefined();
  });

  it('REASSIGN creates a NEW capsule and never rewrites the old identity', () => {
    const repository = new InMemoryExecutionCapsuleRepository();
    const original = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    repository.create(original);
    const cancelled = markCancelled(original, { at: CAPSULE_T4, partialOutput: partialOutput() });
    if (!cancelled.ok) throw new Error('setup failed');
    repository.replace(cancelled.value);

    const replacement = prepareFixture(
      claudeImplementationInput({
        capsuleId: 'cap-hermes-repair',
        runId: 'run-hermes-repair',
        requestedAgent: HERMES_REQUESTED,
        workspace: { ...claudeImplementationInput().workspace!, writeOwnerAgentId: null },
      }),
    );
    expect(repository.create(replacement).ok).toBe(true);

    // The original capsule still says Claude Code ran it.
    const stored = repository.get('cap-claude-impl');
    expect(stored?.identity.requested.agentId).toBe('agent-claude');
    expect(stored?.status).toBe('cancelled');
    expect(repository.get('cap-hermes-repair')?.identity.requested.agentId).toBe('agent-hermes');
    expect(repository.listByTask('task-auth-repair')).toHaveLength(2);
  });

  it('RETRY requires a new run — the failed capsule is never revived', () => {
    const repository = new InMemoryExecutionCapsuleRepository();
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    repository.create(running);
    const failed = markFailed(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    if (!failed.ok) throw new Error('setup failed');
    repository.replace(failed.value);

    expect(markRunning(failed.value, CAPSULE_T4).ok).toBe(false);
    const sameRun = repository.create({ ...failed.value, capsuleId: 'cap-retry' });
    expect(!sameRun.ok && sameRun.error.code).toBe('DUPLICATE_RUN_ID');

    const retry = prepareFixture(
      claudeImplementationInput({ capsuleId: 'cap-retry', runId: 'run-claude-2' }),
    );
    expect(repository.create(retry).ok).toBe(true);
    expect(repository.get('cap-claude-impl')?.status).toBe('failed');
    expect(repository.get('cap-retry')?.status).toBe('prepared');
  });

  it('START prepares a capsule without launching anything', () => {
    const prepared = prepareFixture(codexReviewInput());
    expect(prepared.status).toBe('prepared');
    expect(prepared.identity.kind).toBe('requested');
    expect(prepared.launchAttestationId).toBeUndefined();
    expect(prepared.startedAt).toBeUndefined();
  });
});
