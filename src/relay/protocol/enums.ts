/**
 * Shared enums — exact values from PROTOCOL.md §0. The prompt-level aliases
 * live_local/live_cloud are represented as provenance `live` plus the
 * dispatch-path metadata on the producing adapter/usage record (Decision 1
 * keeps local and cloud dispatch structurally separate; provenance answers
 * "did this really happen", not "which pipe").
 */

export const PROVENANCES = ['simulated', 'live', 'imported', 'manual'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const CLASSIFICATIONS = [
  'canonical',
  'historical',
  'derived',
  'external-artifact',
  'unverified-claim',
  'verified-evidence',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const ENFORCEMENT_LEVELS = ['enforced', 'advisory', 'unsupported'] as const;
export type Enforcement = (typeof ENFORCEMENT_LEVELS)[number];

export const ROLES = ['architect', 'coding-agent', 'reviewer', 'verification'] as const;
export type Role = (typeof ROLES)[number];

export const EVENT_SOURCES = [
  'relay-core',
  'architect',
  'coding-agent',
  'reviewer',
  'verification',
  'system',
  'user',
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const RUN_STATUSES = [
  'created',
  'active',
  'paused',
  'checkpoint_required',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** RunStatus has NO `blocked` value: task-level blocked surfaces as run
 * checkpoint_required; the audit outcome may record `blocked` (PROTOCOL §2.3). */
export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export const RUN_PHASES = [
  'blueprint',
  'handoff',
  'implementation',
  'verification',
  'review',
  'repair',
  'final_verification',
  'final_review',
  'audit',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const TASK_STATUSES = [
  'proposed',
  'queued',
  'assigned',
  'working',
  'waiting',
  'reviewing',
  'revision_required',
  'blocked',
  'checkpoint_required',
  'completed',
  'failed',
  'cancelled',
  'obsolete',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled', 'obsolete'] as const;

export const EVIDENCE_STATUSES = [
  'passed',
  'failed',
  'pending',
  'unavailable',
  'unverified',
  'requires_approval',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const REVIEW_VERDICTS = ['approved', 'changes_requested'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const FINDING_SEVERITIES = ['critical', 'major', 'minor'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const RUN_MODES = ['guided'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const PROVENANCE_PROFILES = ['simulated', 'live', 'mixed'] as const;
export type ProvenanceProfile = (typeof PROVENANCE_PROFILES)[number];

export const AUDIT_OUTCOMES = ['verified-complete', 'failed', 'cancelled', 'blocked'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const REPORT_TYPES = [
  'blueprint',
  'implementation',
  'review',
  'repair',
  'verification-output',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const RISK_LEVELS = ['low', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
