/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Structured command errors — typed expected failures, never thrown strings.
 *
 * Every rejection carries what was expected, what was found, a concise
 * reason, and the safe next action — so the future Mission Operations UI can
 * explain a refusal without inventing text.
 */

import type { RelayStateChangeEntityType } from './command-types';

export const RELAY_MISSION_COMMAND_ERROR_CODES = [
  'MISSION_NOT_FOUND',
  'TASK_NOT_FOUND',
  'AGENT_NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'AMBIGUOUS_REQUEST',
  'MISSION_CONTRACT_CONFLICT',
  'DEPENDENCY_BLOCKED',
  'CHECKPOINT_REQUIRED',
  'CHECKPOINT_FAILED',
  'APPROVAL_REQUIRED',
  'APPROVAL_INVALID',
  'PERMISSION_INCOMPATIBLE',
  'WORKSPACE_INCOMPATIBLE',
  'REVIEWER_INDEPENDENCE_VIOLATION',
  'STALE_MISSION_REVISION',
  'STALE_TASK_REVISION',
  'STALE_REVIEW',
  'BUDGET_CONFLICT',
  'SECURITY_POLICY_CONFLICT',
  'DUPLICATE_COMMAND',
  'ATOMIC_APPLICATION_FAILED',
] as const;
export type RelayMissionCommandErrorCode =
  (typeof RELAY_MISSION_COMMAND_ERROR_CODES)[number];

export interface RelayMissionCommandError {
  code: RelayMissionCommandErrorCode;
  commandId?: string;
  /** The affected entity ('command' for command-scoped failures). */
  entityType?: RelayStateChangeEntityType | 'command';
  entityId?: string;
  /** Expected state or revision, when the failure is a mismatch. */
  expected?: string;
  /** Actual state or revision found. */
  actual?: string;
  reason: string;
  safeNextAction: string;
  humanActionRequired: boolean;
}

/** Compact constructor keeping call sites honest about every field. */
export function commandError(
  code: RelayMissionCommandErrorCode,
  reason: string,
  safeNextAction: string,
  details: Omit<RelayMissionCommandError, 'code' | 'reason' | 'safeNextAction' | 'humanActionRequired'> & {
    humanActionRequired?: boolean;
  } = {},
): RelayMissionCommandError {
  const { humanActionRequired, ...rest } = details;
  return {
    code,
    reason,
    safeNextAction,
    humanActionRequired: humanActionRequired ?? false,
    ...rest,
  };
}
