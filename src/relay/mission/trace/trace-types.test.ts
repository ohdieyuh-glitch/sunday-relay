import { describe, expect, it } from 'vitest';

import {
  AQUALA_TRACE_ACTOR_TYPES,
  AQUALA_TRACE_CANONICALIZATION_VERSIONS,
  AQUALA_TRACE_EVENT_FAMILIES,
  AQUALA_TRACE_EVENT_SCHEMA_VERSIONS,
  AQUALA_TRACE_HASH_ALGORITHMS,
  AQUALA_TRACE_LIFECYCLE_STATUSES,
  AQUALA_TRACE_REDACTION_STATUSES,
  AQUALA_TRACE_RETENTION_CLASSIFICATIONS,
  AQUALA_TRACE_SCHEMA_VERSIONS,
  AQUALA_TRACE_SOURCE_PRODUCTS,
  AQUALA_TRACE_SOURCE_TRUSTS,
  CURRENT_CANONICALIZATION_VERSION,
  CURRENT_EVENT_SCHEMA_VERSION,
  CURRENT_HASH_ALGORITHM,
  CURRENT_TRACE_SCHEMA_VERSION,
  EMITTING_SOURCE_PRODUCTS,
  isSupportedCanonicalizationVersion,
  isSupportedEventSchema,
  isSupportedHashAlgorithm,
  isSupportedTraceSchema,
} from './trace-types';
import {
  familyForEventType,
  GENESIS_EVENT_TYPE,
  isKnownTraceEventType,
  LEDGER_CONTROLLED_EVENT_TYPES,
  POST_COMPLETION_EVENT_TYPES,
  RELAY_TRACE_EVENT_TYPES,
} from './trace-event-types';

describe('schema versioning', () => {
  it('pins the current versions explicitly', () => {
    expect(CURRENT_TRACE_SCHEMA_VERSION).toBe('1.0.0');
    expect(CURRENT_EVENT_SCHEMA_VERSION).toBe('1.0.0');
    expect(CURRENT_CANONICALIZATION_VERSION).toBe('1');
    expect(CURRENT_HASH_ALGORITHM).toBe('SHA-256');
  });

  it('accepts supported versions and rejects everything else deterministically', () => {
    expect(isSupportedTraceSchema('1.0.0')).toBe(true);
    expect(isSupportedTraceSchema('2.0.0')).toBe(false);
    expect(isSupportedEventSchema('1.0.0')).toBe(true);
    expect(isSupportedEventSchema('0.9.0')).toBe(false);
    expect(isSupportedCanonicalizationVersion('1')).toBe(true);
    expect(isSupportedCanonicalizationVersion('2')).toBe(false);
    expect(isSupportedHashAlgorithm('SHA-256')).toBe(true);
    expect(isSupportedHashAlgorithm('SHA-1')).toBe(false);
    expect(isSupportedHashAlgorithm('MD5')).toBe(false);
  });

  it('lists supported versions as explicit const tuples', () => {
    expect(AQUALA_TRACE_SCHEMA_VERSIONS).toEqual(['1.0.0']);
    expect(AQUALA_TRACE_EVENT_SCHEMA_VERSIONS).toEqual(['1.0.0']);
    expect(AQUALA_TRACE_CANONICALIZATION_VERSIONS).toEqual(['1']);
    expect(AQUALA_TRACE_HASH_ALGORITHMS).toEqual(['SHA-256']);
  });
});

describe('vocabularies', () => {
  it('exposes the seven Aquala source products', () => {
    expect(AQUALA_TRACE_SOURCE_PRODUCTS).toEqual([
      'sunday_alcatraz', 'sunday_relay', 'ophiuchus', 'aladiah',
      'ship_on_sunday', 'external_adapter', 'manual',
    ]);
  });

  it('only Sunday Relay and manual events are actually emitted in this milestone', () => {
    expect(EMITTING_SOURCE_PRODUCTS).toEqual(['sunday_relay', 'manual']);
    for (const product of ['sunday_alcatraz', 'ophiuchus', 'aladiah', 'ship_on_sunday'] as const) {
      expect(EMITTING_SOURCE_PRODUCTS).not.toContain(product);
    }
  });

  it('exposes the 27 event families', () => {
    expect(AQUALA_TRACE_EVENT_FAMILIES).toHaveLength(27);
    expect(AQUALA_TRACE_EVENT_FAMILIES).toContain('trace');
    expect(AQUALA_TRACE_EVENT_FAMILIES).toContain('integrity');
    expect(new Set(AQUALA_TRACE_EVENT_FAMILIES).size).toBe(27);
  });

  it('exposes actor types, trust levels, lifecycle, retention, and redaction status', () => {
    expect(AQUALA_TRACE_ACTOR_TYPES).toEqual(['user', 'relay', 'agent', 'reviewer', 'system', 'adapter']);
    expect(AQUALA_TRACE_SOURCE_TRUSTS).toEqual(['claim', 'observed', 'attested', 'verified']);
    expect(AQUALA_TRACE_LIFECYCLE_STATUSES).toEqual(['open', 'completed', 'sealed', 'integrity_failed']);
    expect(AQUALA_TRACE_RETENTION_CLASSIFICATIONS).toEqual([
      'reference_only', 'standard', 'verified', 'regulated',
    ]);
    expect(AQUALA_TRACE_REDACTION_STATUSES).toEqual(['not_required', 'redacted', 'rejected']);
  });
});

describe('event type registry', () => {
  it('registers every required Relay event type', () => {
    const required = [
      'trace_created', 'trace_completed', 'trace_sealed', 'trace_integrity_failed',
      'mission_execution_status_changed', 'mission_outcome_status_changed',
      'mission_verification_status_changed', 'mission_release_status_changed',
      'command_received', 'command_interpreted', 'command_clarification_required',
      'command_validation_required', 'command_validated', 'command_rejected',
      'command_checkpoint_required', 'command_checkpoint_satisfied',
      'command_approval_required', 'command_approval_received',
      'command_execution_started', 'command_state_change_applied',
      'command_executed', 'command_failed',
      'execution_capsule_prepared', 'agent_launch_requested', 'agent_launch_verified',
      'agent_launch_failed', 'agent_fallback_authorized', 'agent_fallback_rejected',
      'agent_execution_started', 'agent_waiting', 'agent_stalled', 'agent_heartbeat',
      'agent_partial_output_saved', 'agent_final_report_received',
      'agent_completion_claim_received', 'agent_execution_completed',
      'agent_execution_failed', 'agent_execution_cancelled',
      'agent_execution_timed_out', 'agent_execution_orphaned',
      'prompt_reference_linked', 'tool_reference_linked', 'permission_reference_linked',
      'workspace_reference_linked', 'file_reference_linked', 'process_reference_linked',
      'test_reference_linked', 'build_reference_linked', 'evidence_reference_linked',
      'review_reference_linked', 'finding_reference_linked', 'repair_reference_linked',
      'approval_reference_linked', 'cost_receipt_reference_linked',
    ];
    for (const eventType of required) {
      expect(isKnownTraceEventType(eventType), `${eventType} must be registered`).toBe(true);
    }

    /* The registry is extensible by design (Milestone 5 added economics), so
       the guarantee is not a fixed count but that NOTHING unaccounted-for is
       registered: every entry is a Milestone 4 type or a Milestone 5
       economics type. */
    const milestone5Economics = [
      'cost_receipt_created', 'cost_receipt_finalized', 'cost_receipt_disputed',
      'cost_receipt_voided', 'cost_adjustment_recorded', 'mission_budget_created',
      'mission_budget_warning_reached', 'mission_budget_approval_required',
      'mission_budget_increase_approved', 'mission_budget_hard_limit_reached',
      'mission_economics_recalculated', 'verified_mission_cost_calculated',
    ];
    const accountedFor = new Set([...required, ...milestone5Economics]);
    for (const eventType of Object.keys(RELAY_TRACE_EVENT_TYPES)) {
      expect(accountedFor.has(eventType), `${eventType} is registered but undocumented`).toBe(true);
    }
    expect(Object.keys(RELAY_TRACE_EVENT_TYPES)).toHaveLength(accountedFor.size);
  });

  it('every registered type maps to a real family', () => {
    for (const [eventType, family] of Object.entries(RELAY_TRACE_EVENT_TYPES)) {
      expect(AQUALA_TRACE_EVENT_FAMILIES, `${eventType}`).toContain(family);
      expect(familyForEventType(eventType)).toBe(family);
    }
  });

  it('rejects an unregistered event type', () => {
    expect(isKnownTraceEventType('invented_event')).toBe(false);
    expect(familyForEventType('invented_event')).toBeUndefined();
  });

  it('names exactly one genesis type and the ledger-controlled types', () => {
    expect(GENESIS_EVENT_TYPE).toBe('trace_created');
    expect(LEDGER_CONTROLLED_EVENT_TYPES).toEqual([
      'trace_created', 'trace_completed', 'trace_sealed', 'trace_integrity_failed',
    ]);
  });

  it('permits only genuinely-late event types after completion', () => {
    for (const eventType of POST_COMPLETION_EVENT_TYPES) {
      expect(isKnownTraceEventType(eventType), `${eventType}`).toBe(true);
    }
    // Operational execution can never resume on a completed trace.
    expect(POST_COMPLETION_EVENT_TYPES).not.toContain('agent_execution_started');
    expect(POST_COMPLETION_EVENT_TYPES).not.toContain('command_execution_started');
    // …but late cost, approval, and release genuinely arrive.
    expect(POST_COMPLETION_EVENT_TYPES).toContain('cost_receipt_reference_linked');
    expect(POST_COMPLETION_EVENT_TYPES).toContain('command_approval_received');
    expect(POST_COMPLETION_EVENT_TYPES).toContain('mission_release_status_changed');
  });

  it('files security-relevant capsule outcomes under the security family', () => {
    expect(familyForEventType('agent_fallback_rejected')).toBe('security');
    expect(familyForEventType('agent_fallback_authorized')).toBe('execution');
    expect(familyForEventType('cost_receipt_reference_linked')).toBe('economics');
    expect(familyForEventType('trace_integrity_failed')).toBe('integrity');
  });
});
