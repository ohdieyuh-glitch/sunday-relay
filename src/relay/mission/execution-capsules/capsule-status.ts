/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Capsule status vocabulary, transition table, and the Milestone 1 execution
 * PROJECTION (PURE).
 *
 * A capsule status describes ONE agent run's process reality. It is NOT the
 * Milestone 1 four-status model and never collapses into it: a capsule that
 * reached `completed` says the process finished and produced a report — it
 * says nothing about whether the mission outcome was satisfied, whether an
 * independent review verified it, or whether release is authorized. Those
 * remain Milestone 1's authority, driven by evidence and review, never by a
 * process exit code.
 */

import type { AqualaExecutionStatus } from '../status/status-model';

export const RELAY_CAPSULE_STATUSES = [
  'prepared',
  'starting',
  'running',
  'waiting',
  'stalled',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'orphaned',
] as const;
export type RelayAgentExecutionCapsuleStatus = (typeof RELAY_CAPSULE_STATUSES)[number];

export const TERMINAL_CAPSULE_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'orphaned',
] as const;

/** Statuses that require a previously VERIFIED launch to be reachable. */
export const VERIFIED_LAUNCH_STATUSES = ['running', 'waiting', 'stalled', 'completed'] as const;

export function isTerminalCapsuleStatus(status: RelayAgentExecutionCapsuleStatus): boolean {
  return (TERMINAL_CAPSULE_STATUSES as readonly string[]).includes(status);
}

/**
 * A terminal capsule NEVER returns to running — a retry is a new run with a
 * new capsule (Milestone 2 `retry` boundary), never a rewritten history.
 */
const CAPSULE_TRANSITIONS: Record<
  RelayAgentExecutionCapsuleStatus,
  readonly RelayAgentExecutionCapsuleStatus[]
> = {
  prepared: ['starting'],
  starting: ['running', 'failed', 'cancelled', 'timed_out'],
  running: ['waiting', 'stalled', 'completed', 'failed', 'cancelled', 'timed_out', 'orphaned'],
  waiting: ['running', 'stalled', 'completed', 'failed', 'cancelled', 'timed_out', 'orphaned'],
  stalled: ['running', 'failed', 'cancelled', 'timed_out', 'orphaned'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  orphaned: [],
};

export interface CapsuleTransitionValidation {
  ok: boolean;
  reason: string;
}

export function validateCapsuleStatusTransition(
  previous: RelayAgentExecutionCapsuleStatus,
  next: RelayAgentExecutionCapsuleStatus,
): CapsuleTransitionValidation {
  if (previous === next) {
    return { ok: false, reason: `no-op capsule transition (${previous})` };
  }
  if (!(RELAY_CAPSULE_STATUSES as readonly string[]).includes(next)) {
    return { ok: false, reason: `unknown capsule status "${next}"` };
  }
  return CAPSULE_TRANSITIONS[previous].includes(next)
    ? { ok: true, reason: 'valid capsule transition' }
    : { ok: false, reason: `capsule ${previous} → ${next} is not permitted` };
}

export function capsuleTransitionsFrom(
  status: RelayAgentExecutionCapsuleStatus,
): readonly RelayAgentExecutionCapsuleStatus[] {
  return CAPSULE_TRANSITIONS[status];
}

/* --------------------------------------- Milestone 1 execution projection */

const EXECUTION_PROJECTION: Record<RelayAgentExecutionCapsuleStatus, AqualaExecutionStatus> = {
  prepared: 'not_started',
  starting: 'starting',
  running: 'running',
  // A stalled run is still alive but not progressing — it WAITS; declaring it
  // failed is a separate, explicit decision.
  stalled: 'waiting',
  waiting: 'waiting',
  completed: 'completed',
  failed: 'failed',
  // A deadline breach and a lost process are distinct capsule facts, but both
  // are execution failures at mission scope.
  timed_out: 'failed',
  orphaned: 'failed',
  cancelled: 'cancelled',
};

/**
 * Projects a capsule status onto the Milestone 1 EXECUTION dimension only.
 * Outcome, verification, and release are deliberately unreachable from here —
 * a finished process is not a satisfied mission, a verified review, or an
 * authorized release.
 */
export function projectCapsuleExecutionStatus(
  status: RelayAgentExecutionCapsuleStatus,
): AqualaExecutionStatus {
  return EXECUTION_PROJECTION[status];
}
