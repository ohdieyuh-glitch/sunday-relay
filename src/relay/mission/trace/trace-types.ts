/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Aquala Trace schema, manifest, lifecycle, and event envelope (PURE).
 *
 * One shared, append-only, hash-chained trace connects user intent through
 * routing, contracts, commands, capsules, activity, evidence, review,
 * approval, verification, release, and (later) economics — across every
 * Aquala product. This module defines the FORMAT; `trace-ledger.ts` owns the
 * only way to write it.
 *
 * Versioning is explicit everywhere so a future schema change creates a new
 * representation or an explicit migration record — existing events are never
 * rewritten because a newer version appeared.
 */

export const AQUALA_TRACE_SCHEMA_VERSIONS = ['1.0.0'] as const;
export type AqualaTraceSchemaVersion = (typeof AQUALA_TRACE_SCHEMA_VERSIONS)[number];
export const CURRENT_TRACE_SCHEMA_VERSION: AqualaTraceSchemaVersion = '1.0.0';

export const AQUALA_TRACE_EVENT_SCHEMA_VERSIONS = ['1.0.0'] as const;
export type AqualaTraceEventSchemaVersion = (typeof AQUALA_TRACE_EVENT_SCHEMA_VERSIONS)[number];
export const CURRENT_EVENT_SCHEMA_VERSION: AqualaTraceEventSchemaVersion = '1.0.0';

export const AQUALA_TRACE_CANONICALIZATION_VERSIONS = ['1'] as const;
export type AqualaTraceCanonicalizationVersion =
  (typeof AQUALA_TRACE_CANONICALIZATION_VERSIONS)[number];
export const CURRENT_CANONICALIZATION_VERSION: AqualaTraceCanonicalizationVersion = '1';

export const AQUALA_TRACE_HASH_ALGORITHMS = ['SHA-256'] as const;
export type AqualaTraceHashAlgorithm = (typeof AQUALA_TRACE_HASH_ALGORITHMS)[number];
export const CURRENT_HASH_ALGORITHM: AqualaTraceHashAlgorithm = 'SHA-256';

export function isSupportedTraceSchema(version: string): version is AqualaTraceSchemaVersion {
  return (AQUALA_TRACE_SCHEMA_VERSIONS as readonly string[]).includes(version);
}
export function isSupportedEventSchema(version: string): version is AqualaTraceEventSchemaVersion {
  return (AQUALA_TRACE_EVENT_SCHEMA_VERSIONS as readonly string[]).includes(version);
}
export function isSupportedCanonicalizationVersion(
  version: string,
): version is AqualaTraceCanonicalizationVersion {
  return (AQUALA_TRACE_CANONICALIZATION_VERSIONS as readonly string[]).includes(version);
}
export function isSupportedHashAlgorithm(algorithm: string): algorithm is AqualaTraceHashAlgorithm {
  return (AQUALA_TRACE_HASH_ALGORITHMS as readonly string[]).includes(algorithm);
}

/* ------------------------------------------------------ source products */

export const AQUALA_TRACE_SOURCE_PRODUCTS = [
  'sunday_alcatraz',
  'sunday_relay',
  'ophiuchus',
  'aladiah',
  'ship_on_sunday',
  'external_adapter',
  'manual',
] as const;
export type AqualaTraceSourceProduct = (typeof AQUALA_TRACE_SOURCE_PRODUCTS)[number];

/** Products whose events this milestone actually emits. Every other product
    has schema compatibility and a documented adapter boundary ONLY — none of
    their integrations are live. */
export const EMITTING_SOURCE_PRODUCTS: readonly AqualaTraceSourceProduct[] = [
  'sunday_relay',
  'manual',
];

/* ------------------------------------------------------ event families */

export const AQUALA_TRACE_EVENT_FAMILIES = [
  'trace',
  'request',
  'routing',
  'policy',
  'mission',
  'task',
  'command',
  'execution',
  'prompt',
  'tool',
  'permission',
  'workspace',
  'file',
  'process',
  'test',
  'build',
  'report',
  'evidence',
  'review',
  'finding',
  'repair',
  'approval',
  'economics',
  'verification',
  'release',
  'security',
  'integrity',
] as const;
export type AqualaTraceEventFamily = (typeof AQUALA_TRACE_EVENT_FAMILIES)[number];

/* ---------------------------------------------------------- actor model */

export const AQUALA_TRACE_ACTOR_TYPES = [
  'user',
  'relay',
  'agent',
  'reviewer',
  'system',
  'adapter',
] as const;
export type AqualaTraceActorType = (typeof AQUALA_TRACE_ACTOR_TYPES)[number];

/**
 * How much the trace is entitled to believe an event:
 *
 *   claim     — the actor reported something about itself or its own work;
 *   observed   — a supervisory system saw it, without attesting full identity;
 *   attested  — a trusted supervisory source or adapter produced attestation;
 *   verified  — Relay or an authorized verification system validated evidence.
 */
export const AQUALA_TRACE_SOURCE_TRUSTS = ['claim', 'observed', 'attested', 'verified'] as const;
export type AqualaTraceSourceTrust = (typeof AQUALA_TRACE_SOURCE_TRUSTS)[number];

export const AQUALA_TRACE_REDACTION_STATUSES = ['not_required', 'redacted', 'rejected'] as const;
export type AqualaTraceRedactionStatus = (typeof AQUALA_TRACE_REDACTION_STATUSES)[number];

/* -------------------------------------------------------- trace lifecycle */

export const AQUALA_TRACE_LIFECYCLE_STATUSES = [
  'open',
  'completed',
  'sealed',
  'integrity_failed',
] as const;
export type AqualaTraceLifecycleStatus = (typeof AQUALA_TRACE_LIFECYCLE_STATUSES)[number];

export const AQUALA_TRACE_RETENTION_CLASSIFICATIONS = [
  'reference_only',
  'standard',
  'verified',
  'regulated',
] as const;
export type AqualaTraceRetentionClassification =
  (typeof AQUALA_TRACE_RETENTION_CLASSIFICATIONS)[number];

/* ------------------------------------------------------------- manifest */

/**
 * Trace identity, fixed at creation. The ledger updates ONLY
 * `lifecycleStatus` and `sourceProducts` (the latter grows as products
 * contribute events); nothing else may ever change, and there is no generic
 * manifest mutation API.
 */
export interface AqualaTraceManifest {
  readonly traceId: string;
  readonly schemaVersion: AqualaTraceSchemaVersion;

  readonly projectId: string;
  readonly missionId?: string;
  readonly taskId?: string;

  readonly createdByActorId: string;
  readonly createdAt: string;

  readonly canonicalizationVersion: AqualaTraceCanonicalizationVersion;
  readonly hashAlgorithm: AqualaTraceHashAlgorithm;

  readonly genesisEventId: string;
  readonly genesisHash: string;

  readonly sourceProducts: readonly AqualaTraceSourceProduct[];

  readonly retentionClassification: AqualaTraceRetentionClassification;

  readonly lifecycleStatus: AqualaTraceLifecycleStatus;
}

/* -------------------------------------------------------- event envelope */

/**
 * The immutable, hash-chained event. Serializable by construction: no
 * functions, no class instances, no provider objects, no streams, no
 * handles, no secrets — identities, references, and redacted metadata only.
 *
 * `sequence`, `previousEventHash`, and `eventHash` are LEDGER-CONTROLLED. A
 * caller (and therefore an agent) can never supply them.
 */
export interface AqualaTraceEvent {
  readonly eventId: string;
  readonly traceId: string;

  readonly schemaVersion: AqualaTraceEventSchemaVersion;
  readonly canonicalizationVersion: AqualaTraceCanonicalizationVersion;
  readonly hashAlgorithm: AqualaTraceHashAlgorithm;

  readonly projectId: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly commandId?: string;
  readonly capsuleId?: string;
  readonly runId?: string;

  readonly missionRevision?: number;
  readonly taskRevision?: number;
  readonly artifactRevision?: string;

  readonly sequence: number;

  readonly eventFamily: AqualaTraceEventFamily;
  readonly eventType: string;

  readonly sourceProduct: AqualaTraceSourceProduct;
  readonly sourceService: string;

  readonly actorId: string;
  readonly actorType: AqualaTraceActorType;

  readonly sourceTrust: AqualaTraceSourceTrust;

  readonly occurredAt: string;

  readonly metadata: Record<string, unknown>;

  readonly redactionStatus: AqualaTraceRedactionStatus;

  readonly previousEventHash: string | null;
  readonly eventHash: string;
}

/** What a caller may supply. Ledger-controlled fields are absent by type. */
export type AqualaTraceEventDraft = Omit<
  AqualaTraceEvent,
  | 'sequence'
  | 'previousEventHash'
  | 'eventHash'
  | 'schemaVersion'
  | 'canonicalizationVersion'
  | 'hashAlgorithm'
  | 'redactionStatus'
> & {
  /** Optional explicit event schema version; defaults to the current one. */
  readonly schemaVersion?: AqualaTraceEventSchemaVersion;
};

/** The ledger head an appender must expect, for optimistic concurrency. */
export interface AqualaTraceHead {
  readonly sequence: number;
  readonly eventId: string;
  readonly eventHash: string;
}
