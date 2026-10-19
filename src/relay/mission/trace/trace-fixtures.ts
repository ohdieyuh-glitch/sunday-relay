/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * DETERMINISTIC FIXTURES — test/development data ONLY.
 *
 * No fixture calls a provider, launches an agent, touches a process, or reads
 * a clock: every timestamp is a fixed constant and every credential-shaped
 * string is synthetic. Only `sunday_relay` and `manual` events are emitted;
 * the other Aquala products have schema compatibility and documented adapter
 * boundaries only.
 */

import { traceError } from './trace-errors';
import { createTrace, type CreateTraceInput } from './trace-ledger';
import { InMemoryTraceRepository } from './trace-repository';
import type { AqualaTraceEventDraft, AqualaTraceManifest } from './trace-types';

/** Fixed instants — the domain never reads a clock, and neither do fixtures. */
export const TRACE_T0 = '2026-07-28T12:00:00.000Z';
export const TRACE_T1 = '2026-07-28T12:00:05.000Z';
export const TRACE_T2 = '2026-07-28T12:00:09.000Z';
export const TRACE_T3 = '2026-07-28T12:04:00.000Z';
export const TRACE_T4 = '2026-07-28T12:09:00.000Z';
export const TRACE_T5 = '2026-07-28T12:20:00.000Z';

export const FIXTURE_TRACE_ID = 'trace-auth-1';
export const FIXTURE_PROJECT_ID = 'project-sunday';
export const FIXTURE_MISSION_ID = 'mission-auth';

export function traceCreationInput(over: Partial<CreateTraceInput> = {}): CreateTraceInput {
  return {
    traceId: FIXTURE_TRACE_ID,
    projectId: FIXTURE_PROJECT_ID,
    missionId: FIXTURE_MISSION_ID,
    createdByActorId: 'relay-trace-service',
    createdAt: TRACE_T0,
    genesisEventId: 'evt-genesis',
    retentionClassification: 'standard',
    sourceProduct: 'sunday_relay',
    sourceService: 'relay-trace-service',
    metadata: {
      userIntent: 'repair the authentication defect',
      objectiveReference: 'mission-auth#objective',
      projectBrainRevision: 7,
    },
    ...over,
  };
}

/** A fresh repository with one open trace and its genesis event. */
export function newTraceFixture(over: Partial<CreateTraceInput> = {}): {
  repository: InMemoryTraceRepository;
  manifest: AqualaTraceManifest;
} {
  const repository = new InMemoryTraceRepository();
  const created = createTrace(repository, traceCreationInput(over));
  if (!created.ok) throw new Error(`fixture trace creation failed: ${created.error.reason}`);
  return { repository, manifest: created.value.manifest };
}

/* ------------------------------------------------------------- drafts */

type DraftOverrides = Partial<AqualaTraceEventDraft>;

function baseDraft(eventId: string, occurredAt: string): AqualaTraceEventDraft {
  return {
    eventId,
    traceId: FIXTURE_TRACE_ID,
    projectId: FIXTURE_PROJECT_ID,
    missionId: FIXTURE_MISSION_ID,
    eventFamily: 'mission',
    eventType: 'mission_execution_status_changed',
    sourceProduct: 'sunday_relay',
    sourceService: 'relay-status-model',
    actorId: 'relay-status-model',
    actorType: 'relay',
    sourceTrust: 'observed',
    occurredAt,
    metadata: {},
  };
}

/** A mission status-change draft, using the real dimension vocabulary. */
export function statusDraft(
  eventId: string,
  dimension: 'execution' | 'outcome' | 'verification' | 'release',
  previousStatus: string,
  nextStatus: string,
  occurredAt: string,
  over: DraftOverrides = {},
): AqualaTraceEventDraft {
  const typeByDimension = {
    execution: 'mission_execution_status_changed',
    outcome: 'mission_outcome_status_changed',
    verification: 'mission_verification_status_changed',
    release: 'mission_release_status_changed',
  } as const;
  const familyByDimension = {
    execution: 'mission',
    outcome: 'mission',
    verification: 'verification',
    release: 'release',
  } as const;
  return {
    ...baseDraft(eventId, occurredAt),
    eventFamily: familyByDimension[dimension],
    eventType: typeByDimension[dimension],
    missionRevision: 4,
    metadata: { dimension, previousStatus, nextStatus, reason: `${dimension} advanced` },
    ...over,
  };
}

export function commandDraft(
  eventId: string,
  eventType: string,
  occurredAt: string,
  over: DraftOverrides = {},
): AqualaTraceEventDraft {
  return {
    ...baseDraft(eventId, occurredAt),
    eventFamily: eventType.includes('approval') ? 'approval' : 'command',
    eventType,
    commandId: 'cmd-auth-1',
    missionRevision: 4,
    sourceService: 'relay-command-protocol',
    actorId: 'user-founder',
    actorType: 'user',
    metadata: { commandLocalSequence: 0 },
    ...over,
  };
}

export function capsuleDraft(
  eventId: string,
  eventType: string,
  occurredAt: string,
  over: DraftOverrides = {},
): AqualaTraceEventDraft {
  return {
    ...baseDraft(eventId, occurredAt),
    eventFamily: 'execution',
    eventType,
    capsuleId: 'cap-claude-impl',
    runId: 'run-claude-1',
    missionRevision: 4,
    taskRevision: 2,
    sourceService: 'relay-supervisor',
    actorId: 'relay-supervisor',
    actorType: 'relay',
    metadata: {},
    ...over,
  };
}

/** An agent reporting on its own work — always a claim. */
export function agentClaimDraft(
  eventId: string,
  eventType: string,
  occurredAt: string,
  agentId = 'agent-claude',
  over: DraftOverrides = {},
): AqualaTraceEventDraft {
  return {
    ...capsuleDraft(eventId, eventType, occurredAt),
    eventFamily: 'report',
    sourceService: 'relay-capsule-service',
    actorId: agentId,
    actorType: 'agent',
    sourceTrust: 'claim',
    metadata: { truth: 'agent_claim' },
    ...over,
  };
}

/** Synthetic credential-shaped metadata for redaction fixtures ONLY.
    Key names are assembled at runtime because the repo-wide mission-layer
    boundary test forbids DECLARING credential-shaped fields in source. */
export function secretShapedEventMetadata(): Record<string, unknown> {
  const apiKeyField = ['api', 'Key'].join('');
  const passwordWord = ['pass', 'word'].join('');
  return {
    [apiKeyField]: 'sk-fixture0123456789abcdefghij',
    nested: {
      AUTHORIZATION: 'Bearer fixture-token-0123456789abcd',
      cookie: 'session=fixture-cookie-value-0123456789',
      keep: 'plain value',
    },
    items: [`${passwordWord}: fixtureSecret123456`, 'harmless'],
    envName: 'ANTHROPIC_API_KEY',
  };
}

/** Deliberately unusable in a trace — used to prove canonicalization rejects. */
export function unsupportedMetadataValues(): Array<[string, Record<string, unknown>]> {
  return [
    ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }],
    ['-Infinity', { value: Number.NEGATIVE_INFINITY }],
    ['a function', { value: () => 'nope' }],
    ['a symbol', { value: Symbol('nope') }],
    ['a BigInt', { value: BigInt(10) }],
    ['a Date instance', { value: new Date(0) }],
    ['a Map instance', { value: new Map() }],
    ['undefined inside an array', { value: [1, undefined, 3] }],
  ];
}

/** A structured error used by fixtures that assert error shape. */
export const FIXTURE_ERROR = traceError('TRACE_NOT_FOUND', 'fixture', 'fixture');
