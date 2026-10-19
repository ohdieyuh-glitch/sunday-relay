import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T0,
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T3,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  finalReport,
  prepareFixture,
  runningFixture,
} from './capsule-fixtures';
import {
  replayCapsuleOperations,
  validateCapsuleSnapshot,
  type CapsuleOperationRecord,
} from './capsule-reconstruction';
import { markCompleted } from './capsule-service';
import type { RelayAgentExecutionCapsule } from './capsule-types';

const completedCapsule = (): RelayAgentExecutionCapsule => {
  const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
  const completed = markCompleted(running, {
    at: CAPSULE_T4,
    finalReport: finalReport('agent-claude'),
  });
  if (!completed.ok) throw new Error('setup failed');
  return completed.value;
};

const HISTORY: CapsuleOperationRecord[] = [
  {
    sequence: 0,
    operation: 'prepare',
    occurredAt: CAPSULE_T0,
    resultingStatus: 'prepared',
    launchVerified: false,
    missionRevision: 4,
    taskRevision: 2,
  },
  {
    sequence: 1,
    operation: 'record_launch_requested',
    occurredAt: CAPSULE_T1,
    resultingStatus: 'starting',
    launchVerified: false,
    missionRevision: 4,
    taskRevision: 2,
  },
  {
    sequence: 2,
    operation: 'mark_running',
    occurredAt: CAPSULE_T2,
    resultingStatus: 'running',
    launchVerified: true,
    observedAgentId: 'agent-claude',
    missionRevision: 4,
    taskRevision: 2,
  },
  {
    sequence: 3,
    operation: 'mark_completed',
    occurredAt: CAPSULE_T4,
    resultingStatus: 'completed',
    launchVerified: true,
    missionRevision: 4,
    taskRevision: 2,
  },
];

describe('snapshot validation', () => {
  it('accepts a coherent stored capsule', () => {
    expect(validateCapsuleSnapshot(completedCapsule()).ok).toBe(true);
    expect(validateCapsuleSnapshot(prepareFixture(claudeImplementationInput())).ok).toBe(true);
  });

  it('rejects a snapshot whose invariants no longer hold', () => {
    const forged: RelayAgentExecutionCapsule = {
      ...prepareFixture(claudeImplementationInput()),
      status: 'running',
    };
    const result = validateCapsuleSnapshot(forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LAUNCH_NOT_VERIFIED');
  });

  it('rejects a snapshot claiming VERIFIED trace integrity before the ledger exists', () => {
    const forged: RelayAgentExecutionCapsule = {
      ...completedCapsule(),
      traceIntegrityStatus: 'verified',
    };
    const result = validateCapsuleSnapshot(forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAPSULE_RECONSTRUCTION_FAILED');
    expect(result.error.actual).toBe('verified');
  });

  it('rejects duplicated trace event ids across channels', () => {
    const base = completedCapsule();
    const reference = {
      referenceId: 'ref-x',
      eventId: 'evt-dup',
      eventType: 'file.changed',
      occurredAt: CAPSULE_T3,
      actorId: 'workspace-monitor',
      source: 'workspace_monitor' as const,
      integrity: 'trusted_source' as const,
    };
    const forged: RelayAgentExecutionCapsule = {
      ...base,
      traceReferences: {
        ...base.traceReferences,
        fileEvents: [reference],
        toolEvents: [{ ...reference, referenceId: 'ref-y' }],
      },
    };
    const result = validateCapsuleSnapshot(forged);
    expect(!result.ok && result.error.code).toBe('DUPLICATE_TRACE_REFERENCE');
  });

  it('rejects references that regress in time within a channel', () => {
    const base = completedCapsule();
    const forged: RelayAgentExecutionCapsule = {
      ...base,
      traceReferences: {
        ...base.traceReferences,
        fileEvents: [
          {
            referenceId: 'ref-1', eventId: 'evt-1', eventType: 'file.changed',
            occurredAt: CAPSULE_T3, actorId: 'workspace-monitor',
            source: 'workspace_monitor', integrity: 'trusted_source',
          },
          {
            referenceId: 'ref-2', eventId: 'evt-2', eventType: 'file.changed',
            occurredAt: CAPSULE_T1, actorId: 'workspace-monitor',
            source: 'workspace_monitor', integrity: 'trusted_source',
          },
        ],
      },
    };
    const result = validateCapsuleSnapshot(forged);
    expect(!result.ok && result.error.code).toBe('INVALID_TIMESTAMP_ORDER');
  });

  it('never mutates the capsule it validates', () => {
    const capsule = completedCapsule();
    const snapshot = JSON.stringify(capsule);
    validateCapsuleSnapshot(capsule);
    expect(JSON.stringify(capsule)).toBe(snapshot);
  });
});

describe('operation replay', () => {
  it('replays a coherent history to the stored status', () => {
    const result = replayCapsuleOperations(completedCapsule(), HISTORY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toBe(4);
  });

  it('reports the FIRST invalid operation index for an illegal status sequence', () => {
    const broken = [
      HISTORY[0],
      { ...HISTORY[1], resultingStatus: 'completed' as const, launchVerified: true },
    ];
    const result = replayCapsuleOperations(completedCapsule(), broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedIndex).toBe(1);
    expect(result.error.code).toBe('INVALID_CAPSULE_STATUS_TRANSITION');
  });

  it('rejects a revision change mid-history', () => {
    const broken = [HISTORY[0], { ...HISTORY[1], missionRevision: 5 }];
    const result = replayCapsuleOperations(completedCapsule(), broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedIndex).toBe(1);
    expect(result.error.code).toBe('RESPONSIBILITY_REVISION_MISMATCH');
  });

  it('rejects an identity contradiction', () => {
    const broken = [HISTORY[0], HISTORY[1], { ...HISTORY[2], observedAgentId: 'agent-mock-wrapper' }];
    const result = replayCapsuleOperations(completedCapsule(), broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACTUAL_AGENT_NOT_VERIFIED');
  });

  it('rejects a timestamp regression and an out-of-order sequence', () => {
    const timeBroken = [HISTORY[0], { ...HISTORY[1], occurredAt: '2026-07-28T11:00:00.000Z' }];
    expect(replayCapsuleOperations(completedCapsule(), timeBroken).ok).toBe(false);

    const seqBroken = [HISTORY[0], { ...HISTORY[1], sequence: 0 }];
    const result = replayCapsuleOperations(completedCapsule(), seqBroken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAPSULE_RECONSTRUCTION_FAILED');
  });

  it('rejects a duplicate trace event id in the replayed history', () => {
    const broken = [
      { ...HISTORY[0], traceEventIds: ['evt-1'] },
      { ...HISTORY[1], traceEventIds: ['evt-1'] },
    ];
    const result = replayCapsuleOperations(completedCapsule(), broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DUPLICATE_TRACE_REFERENCE');
  });

  it('rejects reaching an activity state without a verified launch', () => {
    const broken = [HISTORY[0], HISTORY[1], { ...HISTORY[2], launchVerified: false }];
    const result = replayCapsuleOperations(completedCapsule(), broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LAUNCH_NOT_VERIFIED');
  });

  it('rejects a history that does not end where the stored capsule stands', () => {
    const result = replayCapsuleOperations(completedCapsule(), HISTORY.slice(0, 3));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAPSULE_RECONSTRUCTION_FAILED');
    expect(result.error.expected).toBe('completed');
    expect(result.error.actual).toBe('running');
  });

  it('never mutates the operation records or the capsule', () => {
    const capsule = completedCapsule();
    const capsuleSnapshot = JSON.stringify(capsule);
    const historySnapshot = JSON.stringify(HISTORY);
    replayCapsuleOperations(capsule, HISTORY);
    expect(JSON.stringify(capsule)).toBe(capsuleSnapshot);
    expect(JSON.stringify(HISTORY)).toBe(historySnapshot);
  });
});
