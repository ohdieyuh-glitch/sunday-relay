/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Ordered, immutable command events (PURE).
 *
 * Every step of a command's life is an append-only event: received,
 * interpreted, validated/rejected, checkpoint and approval activity,
 * execution start, each applied state change, executed/failed. Events are
 * frozen at creation, sequence-ordered per command, linked to the mission
 * revision, and their metadata passes the secret redactor before storage.
 *
 * Hash chaining is DELIBERATELY absent — it belongs to the Aquala Trace
 * ledger (Milestone 4), where these events gain durable append-only storage
 * and reconstruction becomes the ledger's integrity check.
 */

import { redactTerminalText } from '../terminal';

export const RELAY_MISSION_COMMAND_EVENT_TYPES = [
  'command_received',
  'command_interpreted',
  'command_clarification_required',
  'command_validation_required',
  'command_validated',
  'command_rejected',
  'checkpoint_required',
  'checkpoint_satisfied',
  'checkpoint_failed',
  'approval_required',
  'approval_received',
  'command_execution_started',
  'state_change_applied',
  'command_executed',
  'command_failed',
] as const;
export type RelayMissionCommandEventType =
  (typeof RELAY_MISSION_COMMAND_EVENT_TYPES)[number];

export interface RelayMissionCommandEvent {
  readonly eventId: string;
  readonly commandId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly sequence: number;
  readonly eventType: RelayMissionCommandEventType;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly metadata: Record<string, unknown>;
}

const SECRET_KEY_PATTERN =
  /(?:secret|token|password|credential|api[-_]?key|private[-_]?key|cookie|authorization)/iu;

/**
 * Deep, deterministic metadata redaction: keys whose NAME looks secret are
 * replaced wholesale; every string VALUE passes the shared secret redactor.
 * The input is never mutated.
 */
export function redactCommandMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactTerminalText(value).text;
    if (Array.isArray(value)) return value.map(redactValue);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(inner);
      }
      return out;
    }
    return value;
  };
  return redactValue(metadata) as Record<string, unknown>;
}

export interface CreateCommandEventInput {
  eventId: string;
  commandId: string;
  projectId: string;
  missionId: string;
  missionRevision: number;
  sequence: number;
  eventType: RelayMissionCommandEventType;
  actorId: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

/** The ONLY way to build a command event: redacts metadata and freezes the
    record so no later code can mutate history. */
export function createCommandEvent(input: CreateCommandEventInput): RelayMissionCommandEvent {
  return Object.freeze({
    eventId: input.eventId,
    commandId: input.commandId,
    projectId: input.projectId,
    missionId: input.missionId,
    missionRevision: input.missionRevision,
    sequence: input.sequence,
    eventType: input.eventType,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    metadata: Object.freeze(redactCommandMetadata(input.metadata ?? {})),
  });
}
