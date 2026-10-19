import { describe, expect, it } from 'vitest';

import {
  capsuleTransitionsFrom,
  isTerminalCapsuleStatus,
  projectCapsuleExecutionStatus,
  RELAY_CAPSULE_STATUSES,
  TERMINAL_CAPSULE_STATUSES,
  validateCapsuleStatusTransition,
  type RelayAgentExecutionCapsuleStatus,
} from './capsule-status';
import type { AqualaExecutionStatus } from '../status/status-model';
import { AQUALA_STATUS_VALUES, createInitialAqualaOutcomeStatus } from '../status/status-model';

const ALL = RELAY_CAPSULE_STATUSES;

describe('capsule status vocabulary', () => {
  it('exposes exactly the ten canonical statuses', () => {
    expect(ALL).toEqual([
      'prepared', 'starting', 'running', 'waiting', 'stalled',
      'completed', 'failed', 'cancelled', 'timed_out', 'orphaned',
    ]);
  });

  it('names the five terminal statuses', () => {
    expect(TERMINAL_CAPSULE_STATUSES).toEqual([
      'completed', 'failed', 'cancelled', 'timed_out', 'orphaned',
    ]);
    for (const status of ALL) {
      expect(isTerminalCapsuleStatus(status)).toBe(
        (TERMINAL_CAPSULE_STATUSES as readonly string[]).includes(status),
      );
    }
  });
});

describe('capsule status transitions', () => {
  const VALID: Array<[RelayAgentExecutionCapsuleStatus, RelayAgentExecutionCapsuleStatus]> = [
    ['prepared', 'starting'],
    ['starting', 'running'],
    ['starting', 'failed'],
    ['starting', 'cancelled'],
    ['starting', 'timed_out'],
    ['running', 'waiting'],
    ['running', 'stalled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'cancelled'],
    ['running', 'timed_out'],
    ['running', 'orphaned'],
    ['waiting', 'running'],
    ['waiting', 'stalled'],
    ['waiting', 'completed'],
    ['waiting', 'failed'],
    ['waiting', 'cancelled'],
    ['waiting', 'timed_out'],
    ['waiting', 'orphaned'],
    ['stalled', 'running'],
    ['stalled', 'failed'],
    ['stalled', 'cancelled'],
    ['stalled', 'timed_out'],
    ['stalled', 'orphaned'],
  ];

  it.each(VALID)('%s → %s is permitted', (from, to) => {
    expect(validateCapsuleStatusTransition(from, to).ok).toBe(true);
  });

  const INVALID: Array<[RelayAgentExecutionCapsuleStatus, RelayAgentExecutionCapsuleStatus]> = [
    ['prepared', 'completed'],
    ['prepared', 'running'],
    ['prepared', 'waiting'],
    ['starting', 'completed'],
    ['starting', 'waiting'],
    ['starting', 'stalled'],
    ['starting', 'orphaned'],
    ['failed', 'running'],
    ['cancelled', 'running'],
    ['timed_out', 'running'],
    ['orphaned', 'completed'],
    ['orphaned', 'running'],
    ['completed', 'running'],
    ['completed', 'failed'],
    ['stalled', 'waiting'],
  ];

  it.each(INVALID)('%s → %s is rejected', (from, to) => {
    const validation = validateCapsuleStatusTransition(from, to);
    expect(validation.ok).toBe(false);
    expect(validation.reason).toBeTruthy();
  });

  it('every pair is exhaustively decided, and no-ops are rejected', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const validation = validateCapsuleStatusTransition(from, to);
        if (from === to) {
          expect(validation.ok).toBe(false);
          continue;
        }
        expect(validation.ok).toBe(capsuleTransitionsFrom(from).includes(to));
      }
    }
  });

  it('no terminal status has any outgoing transition — a retry needs a new run', () => {
    for (const status of TERMINAL_CAPSULE_STATUSES) {
      expect(capsuleTransitionsFrom(status)).toEqual([]);
    }
  });

  it('an unknown status value is rejected structurally', () => {
    const validation = validateCapsuleStatusTransition(
      'running',
      'hibernating' as RelayAgentExecutionCapsuleStatus,
    );
    expect(validation.ok).toBe(false);
    expect(validation.reason).toMatch(/unknown capsule status/u);
  });
});

describe('Milestone 1 execution projection', () => {
  const MAPPING: Array<[RelayAgentExecutionCapsuleStatus, AqualaExecutionStatus]> = [
    ['prepared', 'not_started'],
    ['starting', 'starting'],
    ['running', 'running'],
    ['waiting', 'waiting'],
    ['stalled', 'waiting'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['timed_out', 'failed'],
    ['orphaned', 'failed'],
  ];

  it.each(MAPPING)('%s projects to execution %s', (capsuleStatus, executionStatus) => {
    expect(projectCapsuleExecutionStatus(capsuleStatus)).toBe(executionStatus);
  });

  it('every capsule status maps to a REAL Milestone 1 execution value', () => {
    for (const status of ALL) {
      expect(AQUALA_STATUS_VALUES.execution).toContain(projectCapsuleExecutionStatus(status));
    }
  });

  it('the projection touches ONLY the execution dimension', () => {
    // A completed capsule leaves outcome, verification, and release exactly as
    // the canonical initial status — the projection cannot express them.
    const initial = createInitialAqualaOutcomeStatus();
    const projected = {
      ...initial,
      executionStatus: projectCapsuleExecutionStatus('completed'),
    };
    expect(projected.executionStatus).toBe('completed');
    expect(projected.outcomeStatus).toBe('unknown');
    expect(projected.verificationStatus).toBe('unverified');
    expect(projected.releaseStatus).toBe('not_eligible');
  });

  it('timed_out and orphaned are distinct capsule facts that both read as execution failure', () => {
    expect(projectCapsuleExecutionStatus('timed_out')).toBe('failed');
    expect(projectCapsuleExecutionStatus('orphaned')).toBe('failed');
    expect('timed_out').not.toBe('failed');
    expect('orphaned').not.toBe('failed');
  });
});
