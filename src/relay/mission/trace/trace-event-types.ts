/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * The Relay event-type registry (PURE).
 *
 * An event family is a coarse bucket, never the event's meaning — so the
 * registry pins each exact Relay event type to the family it is allowed to
 * appear under. An unknown type, or a known type filed under the wrong
 * family, is rejected rather than stored as a plausible-looking event.
 *
 * Other Aquala products will register their own types behind the same
 * boundary. None of them are live in this milestone.
 */

import type { AqualaTraceEventFamily } from './trace-types';

/** Exact Relay event types → the family each belongs to. */
export const RELAY_TRACE_EVENT_TYPES: Readonly<Record<string, AqualaTraceEventFamily>> = {
  /* trace lifecycle */
  trace_created: 'trace',
  trace_completed: 'trace',
  trace_sealed: 'trace',
  trace_integrity_failed: 'integrity',

  /* mission four-status model */
  mission_execution_status_changed: 'mission',
  mission_outcome_status_changed: 'mission',
  mission_verification_status_changed: 'verification',
  mission_release_status_changed: 'release',

  /* command protocol */
  command_received: 'command',
  command_interpreted: 'command',
  command_clarification_required: 'command',
  command_validation_required: 'command',
  command_validated: 'command',
  command_rejected: 'command',
  command_checkpoint_required: 'command',
  command_checkpoint_satisfied: 'command',
  command_approval_required: 'approval',
  command_approval_received: 'approval',
  command_execution_started: 'command',
  command_state_change_applied: 'command',
  command_executed: 'command',
  command_failed: 'command',

  /* execution capsules */
  execution_capsule_prepared: 'execution',
  agent_launch_requested: 'execution',
  agent_launch_verified: 'execution',
  agent_launch_failed: 'execution',
  agent_fallback_authorized: 'execution',
  agent_fallback_rejected: 'security',
  agent_execution_started: 'execution',
  agent_waiting: 'execution',
  agent_stalled: 'execution',
  agent_heartbeat: 'process',
  agent_partial_output_saved: 'report',
  agent_final_report_received: 'report',
  agent_completion_claim_received: 'report',
  agent_execution_completed: 'execution',
  agent_execution_failed: 'execution',
  agent_execution_cancelled: 'execution',
  agent_execution_timed_out: 'execution',
  agent_execution_orphaned: 'execution',

  /* activity references */
  prompt_reference_linked: 'prompt',
  tool_reference_linked: 'tool',
  permission_reference_linked: 'permission',
  workspace_reference_linked: 'workspace',
  file_reference_linked: 'file',
  process_reference_linked: 'process',
  test_reference_linked: 'test',
  build_reference_linked: 'build',
  evidence_reference_linked: 'evidence',
  review_reference_linked: 'review',
  finding_reference_linked: 'finding',
  repair_reference_linked: 'repair',
  approval_reference_linked: 'approval',
  cost_receipt_reference_linked: 'economics',

  /* economics (Milestone 5) */
  cost_receipt_created: 'economics',
  cost_receipt_finalized: 'economics',
  cost_receipt_disputed: 'economics',
  cost_receipt_voided: 'economics',
  cost_adjustment_recorded: 'economics',
  mission_budget_created: 'economics',
  mission_budget_warning_reached: 'economics',
  mission_budget_approval_required: 'approval',
  mission_budget_increase_approved: 'approval',
  mission_budget_hard_limit_reached: 'economics',
  mission_economics_recalculated: 'economics',
  verified_mission_cost_calculated: 'economics',
};

export type RelayTraceEventType = keyof typeof RELAY_TRACE_EVENT_TYPES;

export function isKnownTraceEventType(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(RELAY_TRACE_EVENT_TYPES, eventType);
}

export function familyForEventType(eventType: string): AqualaTraceEventFamily | undefined {
  return RELAY_TRACE_EVENT_TYPES[eventType];
}

/** The single genesis type. Exactly one per trace, always at sequence 1. */
export const GENESIS_EVENT_TYPE = 'trace_created';

/** Types the ledger itself emits; adapters and callers may not fabricate them. */
export const LEDGER_CONTROLLED_EVENT_TYPES: readonly string[] = [
  'trace_created',
  'trace_completed',
  'trace_sealed',
  'trace_integrity_failed',
];

/**
 * Types permitted AFTER a trace is completed but before it is sealed —
 * completion means operational execution ended, not that the record is
 * finished. Late cost receipts, human approval, the release decision, and
 * integrity audit results all legitimately arrive afterwards.
 */
export const POST_COMPLETION_EVENT_TYPES: readonly string[] = [
  'cost_receipt_reference_linked',
  'cost_receipt_created',
  'cost_receipt_finalized',
  'cost_receipt_disputed',
  'cost_receipt_voided',
  'cost_adjustment_recorded',
  'mission_budget_warning_reached',
  'mission_budget_approval_required',
  'mission_budget_increase_approved',
  'mission_budget_hard_limit_reached',
  'mission_economics_recalculated',
  'verified_mission_cost_calculated',
  'approval_reference_linked',
  'command_approval_received',
  'mission_release_status_changed',
  'mission_verification_status_changed',
  'evidence_reference_linked',
  'review_reference_linked',
  'finding_reference_linked',
  'trace_sealed',
  'trace_integrity_failed',
];
