import { createHash } from 'node:crypto';

import type { JuliusMemoryProvenance, JuliusMemoryTrustState } from './julius-memory-trust';
import type { JuliusWorkerRole } from './julius-runtime';

/**
 * PROJECT BRAIN v2 — THE DURABLE MEMORY OF THE COMPOUND AGENT.
 *
 * WHAT IT IS. The record of what Julius knows, did, decided, observed, proved,
 * changed and left unresolved, across missions. It belongs to Julius; a project
 * or mission USES a Brain. It is not an agent and it has no opinions: every
 * write is authorised by `julius-brain-policy.ts` against a principal the
 * composition root bound, never one a caller claimed.
 *
 * HOW IT IS SHAPED. An append-only LEDGER of immutable, typed records, and a
 * CURRENT STATE that is a pure projection of that ledger
 * (`julius-brain-projection.ts`). A change of truth is a new record — a
 * revision, a supersession, a retirement, a contradiction — never an overwrite,
 * so the Brain can always explain why something stopped being true.
 *
 * WHY THIS IS NOT A SECOND MEMORY ARCHITECTURE. `julius_brain_entries` (v1) is
 * the context compiler's per-run prose feed and stays exactly that; the v2
 * ledger is typed and project-scoped, and `julius-brain-legacy.ts` maps between
 * the two in both directions. The trust vocabulary is v2's own trust core's
 * (`julius-memory-trust.ts`), imported rather than re-declared — that file's
 * functions are deliberately unimplemented regression-mission deliverables and
 * nothing here calls them.
 *
 * LANGUAGE-INDEPENDENT BY CONSTRUCTION. Records are JSON with explicit schemas
 * (`JULIUS_BRAIN_BODY_SCHEMAS`), sha256 content hashes and a hash chain. The
 * schema table is exported verbatim for the Python SDK and any future runtime;
 * nothing is persisted as a language object.
 *
 * PURE. No clock (every time is an injected ISO string), no I/O. `node:crypto`
 * is the julius domain's one declared exception.
 */

export const JULIUS_BRAIN_SCHEMA_VERSION = 'julius-project-brain.v1' as const;

/* ------------------------------------------------------------------ kinds */

export const JULIUS_BRAIN_SECTIONS = [
  'MISSION', 'REQUIREMENTS', 'ARCHITECTURE', 'DECISIONS', 'RESEARCH', 'EVIDENCE', 'EVALS',
  'FINDINGS', 'REPAIRS', 'HANDOFFS', 'ARTIFACTS', 'MEMORY', 'STATE', 'TRACE', 'EXECUTIONS',
] as const;
export type JuliusBrainSection = typeof JULIUS_BRAIN_SECTIONS[number];

export const JULIUS_BRAIN_RECORD_KINDS = [
  'MISSION', 'OBJECTIVE', 'MISSION_STATE',
  'REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION', 'ASSUMPTION', 'OPEN_QUESTION',
  'ARCHITECTURE_COMPONENT', 'ARCHITECTURE_INTERFACE',
  'DECISION', 'RESEARCH', 'EVIDENCE', 'EVAL', 'FINDING', 'REPAIR', 'HANDOFF', 'ARTIFACT',
  'MEMORY_FACT', 'TRACE', 'PYTHON_EXECUTION', 'CHECKPOINT',
] as const;
export type JuliusBrainRecordKind = typeof JULIUS_BRAIN_RECORD_KINDS[number];

export const JULIUS_BRAIN_KIND_SECTION: Readonly<Record<JuliusBrainRecordKind, JuliusBrainSection>> = Object.freeze({
  MISSION: 'MISSION', OBJECTIVE: 'MISSION', MISSION_STATE: 'STATE',
  REQUIREMENT: 'REQUIREMENTS', ACCEPTANCE_CRITERION: 'REQUIREMENTS', CONSTRAINT: 'REQUIREMENTS',
  PROHIBITION: 'REQUIREMENTS', ASSUMPTION: 'REQUIREMENTS', OPEN_QUESTION: 'REQUIREMENTS',
  ARCHITECTURE_COMPONENT: 'ARCHITECTURE', ARCHITECTURE_INTERFACE: 'ARCHITECTURE',
  DECISION: 'DECISIONS', RESEARCH: 'RESEARCH', EVIDENCE: 'EVIDENCE', EVAL: 'EVALS',
  FINDING: 'FINDINGS', REPAIR: 'REPAIRS', HANDOFF: 'HANDOFFS', ARTIFACT: 'ARTIFACTS',
  MEMORY_FACT: 'MEMORY', TRACE: 'TRACE', PYTHON_EXECUTION: 'EXECUTIONS', CHECKPOINT: 'STATE',
});

/* ------------------------------------------------------------- principals */

/**
 * WHO IS WRITING. Bound by the composition root that authenticated the caller;
 * a worker holding a Brain handle cannot mint itself a JULIUS principal.
 *
 *   JULIUS       the compound agent's own control plane — mission authority
 *   USER         a human acting through the product
 *   WORKER       one of the three tiers (or a declared specialist); `role` set
 *   TOOL         a governed tool execution (Python); `grantId` + `onBehalfOf`
 *   ENVIRONMENT  a future evaluation environment (GVE); `grantId` required
 *   SYSTEM       restore and migration paths only
 */
export const JULIUS_BRAIN_PRINCIPAL_KINDS = ['JULIUS', 'USER', 'WORKER', 'TOOL', 'ENVIRONMENT', 'SYSTEM'] as const;
export type JuliusBrainPrincipalKind = typeof JULIUS_BRAIN_PRINCIPAL_KINDS[number];

export interface JuliusBrainPrincipal {
  readonly kind: JuliusBrainPrincipalKind;
  readonly id: string;
  readonly role: JuliusWorkerRole | null;
  /** For TOOL and ENVIRONMENT: the principal id that requested the execution. */
  readonly onBehalfOf: string | null;
  /** For TOOL and ENVIRONMENT: the write grant this principal acts under. */
  readonly grantId: string | null;
}

/* ------------------------------------------------------------------ links */

export const JULIUS_BRAIN_LINK_RELATIONS = [
  'SUPERSEDES', 'CONTRADICTS', 'SUPPORTS', 'DERIVED_FROM', 'RESOLVES', 'REPAIRS',
  'EVIDENCED_BY', 'ANSWERS', 'PRODUCED_BY', 'RELATES_TO',
] as const;
export type JuliusBrainLinkRelation = typeof JULIUS_BRAIN_LINK_RELATIONS[number];

export interface JuliusBrainLink {
  readonly relation: JuliusBrainLinkRelation;
  /** An entity id in the same Brain. */
  readonly target: string;
  /** The version the author was looking at, or null for "whatever is current". */
  readonly targetVersion: number | null;
}

/* ------------------------------------------------------------- provenance */

/**
 * WHERE A RECORD CAME FROM, beyond who wrote it. Every field is present; an
 * unknown field is null, never omitted and never guessed.
 */
export interface JuliusBrainProvenance {
  readonly source: JuliusMemoryProvenance;
  readonly provider: string | null;
  readonly model: string | null;
  readonly tool: string | null;
  readonly commit: string | null;
  /** An external reference (URL, document id) the record was derived from. */
  readonly externalRef: string | null;
  /** The governed execution that produced this record, when one did. */
  readonly executionId: string | null;
}

/* ---------------------------------------------------------------- records */

export const JULIUS_BRAIN_OPERATIONS = ['CREATE', 'REVISE', 'RETIRE'] as const;
export type JuliusBrainOperation = typeof JULIUS_BRAIN_OPERATIONS[number];

export const JULIUS_BRAIN_RETENTION = ['DURABLE', 'WORKING'] as const;
export type JuliusBrainRetention = typeof JULIUS_BRAIN_RETENTION[number];

/** SECRET is not a level: credential-shaped content is refused, not classified. */
export const JULIUS_BRAIN_SENSITIVITY = ['PUBLIC', 'INTERNAL', 'RESTRICTED'] as const;
export type JuliusBrainSensitivity = typeof JULIUS_BRAIN_SENSITIVITY[number];

export const JULIUS_BRAIN_RETIREMENT_DISPOSITIONS = ['WITHDRAWN', 'INVALIDATED', 'REVERSED', 'STALE', 'COMPLETED'] as const;
export type JuliusBrainRetirementDisposition = typeof JULIUS_BRAIN_RETIREMENT_DISPOSITIONS[number];

export interface JuliusBrainScope {
  readonly missionId: string | null;
  readonly runId: string | null;
  readonly taskId: string | null;
}

export type JuliusBrainJson = null | boolean | number | string | readonly JuliusBrainJson[] | { readonly [key: string]: JuliusBrainJson };
export type JuliusBrainBody = { readonly [key: string]: JuliusBrainJson };

/**
 * WHAT A WRITER SUBMITS. The store turns an accepted draft into a
 * {@link JuliusBrainRecord} by allocating its sequence, version and hashes.
 */
export interface JuliusBrainDraft {
  readonly kind: JuliusBrainRecordKind;
  readonly op: JuliusBrainOperation;
  /** Required for REVISE and RETIRE. Optional for CREATE (derived when null). */
  readonly entityId: string | null;
  /**
   * OPTIMISTIC CONCURRENCY. The entity version the writer read: 0 for CREATE,
   * the current version for REVISE and RETIRE. A stale value is refused, so a
   * concurrent writer's revision is never silently overwritten.
   */
  readonly expectedVersion: number;
  /** For RETIRE: `{ reason, disposition }`. Otherwise the kind's schema. */
  readonly body: JuliusBrainBody;
  readonly links: readonly JuliusBrainLink[];
  readonly scope: JuliusBrainScope;
  readonly retention: JuliusBrainRetention;
  /** 0..1, or null when nobody measured it. */
  readonly confidence: number | null;
  readonly sensitivity: JuliusBrainSensitivity;
  readonly provenance: JuliusBrainProvenance;
  /** Deterministic per source. The same key with the same content is a replay. */
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface JuliusBrainRecord extends JuliusBrainDraft {
  readonly schemaVersion: typeof JULIUS_BRAIN_SCHEMA_VERSION;
  readonly brainId: string;
  readonly recordId: string;
  readonly entityId: string;
  /** Per-brain, gap-free, allocated by the store. */
  readonly sequence: number;
  readonly entityVersion: number;
  readonly principal: JuliusBrainPrincipal;
  /** sha256 over everything a replay must agree on (never the clock). */
  readonly fingerprint: string;
  /** sha256 over the record's content, occurredAt included. */
  readonly contentHash: string;
  /** sha256 chaining this record to its predecessor. */
  readonly chainHash: string;
  readonly recordedAt: string;
}

export interface JuliusBrainIdentity {
  readonly brainId: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdBy: JuliusBrainPrincipal;
  readonly createdAt: string;
  readonly schemaVersion: typeof JULIUS_BRAIN_SCHEMA_VERSION;
}

export interface JuliusBrainHead {
  /** 0 for an empty Brain. */
  readonly sequence: number;
  readonly chainHash: string;
}

/* ------------------------------------------------------------ body schema */

/**
 * A DELIBERATELY SMALL SCHEMA LANGUAGE. It exists so the same table can be
 * enforced here, exported as JSON, and enforced again by the Python SDK before
 * a proposal ever leaves the sandbox. Unknown keys are refused; a `required`
 * key must be present (a nullable one may be null — "Unknown" — but never
 * absent, because absent and unknown are different claims).
 */
export type JuliusBrainFieldSpec =
  | { readonly type: 'string'; readonly nullable?: boolean; readonly maxLength?: number; readonly enum?: readonly string[]; readonly pattern?: string }
  | { readonly type: 'number'; readonly nullable?: boolean; readonly integer?: boolean; readonly min?: number; readonly max?: number }
  | { readonly type: 'boolean'; readonly nullable?: boolean }
  | { readonly type: 'string[]'; readonly maxItems?: number; readonly maxLength?: number; readonly enum?: readonly string[] }
  | { readonly type: 'object'; readonly nullable?: boolean; readonly fields: JuliusBrainObjectSpec }
  | { readonly type: 'object[]'; readonly maxItems?: number; readonly fields: JuliusBrainObjectSpec }
  | { readonly type: 'scalarMap'; readonly maxEntries?: number }
  | { readonly type: 'json'; readonly nullable?: boolean; readonly maxBytes?: number };
export type JuliusBrainObjectSpec = { readonly [field: string]: JuliusBrainFieldSpec };

const TEXT = 8_000;
const SHORT = 512;
const str = (maxLength = TEXT): JuliusBrainFieldSpec => ({ type: 'string', maxLength });
const nstr = (maxLength = TEXT): JuliusBrainFieldSpec => ({ type: 'string', nullable: true, maxLength });
const oneOf = (values: readonly string[]): JuliusBrainFieldSpec => ({ type: 'string', enum: values, maxLength: SHORT });
const strings = (maxItems = 64, maxLength = TEXT): JuliusBrainFieldSpec => ({ type: 'string[]', maxItems, maxLength });
const bool: JuliusBrainFieldSpec = { type: 'boolean' };
const nnum: JuliusBrainFieldSpec = { type: 'number', nullable: true };
const unit: JuliusBrainFieldSpec = { type: 'number', nullable: true, min: 0, max: 1 };
export const JULIUS_BRAIN_SHA256_PATTERN = '^sha256:[0-9a-f]{64}$';

export const JULIUS_BRAIN_TRUST_WRITABLE: readonly JuliusMemoryTrustState[] = Object.freeze(['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED']);

export const JULIUS_BRAIN_EVIDENCE_CLASSES = [
  'MEASUREMENT', 'COMPARISON', 'ASSERTION', 'EVALUATION_RESULT', 'ARTIFACT_RESULT', 'FAILURE',
  'METRIC_SERIES', 'EXPERIMENT_RESULT', 'TABLE', 'OBSERVATION', 'TEST_RESULT', 'COMMAND_EXECUTION', 'REVIEW',
] as const;
export type JuliusBrainEvidenceClass = typeof JULIUS_BRAIN_EVIDENCE_CLASSES[number];

export const JULIUS_BRAIN_ARTIFACT_CLASSES = [
  'CODE', 'PATCH', 'PLAN', 'REPORT', 'STRUCTURED_OUTPUT', 'SCREENSHOT', 'LOG', 'DATASET', 'GENERATED_FILE', 'PYTHON_OUTPUT',
] as const;

export const JULIUS_BRAIN_BODY_SCHEMAS: Readonly<Record<JuliusBrainRecordKind, JuliusBrainObjectSpec>> = Object.freeze({
  MISSION: {
    missionId: str(SHORT), title: str(SHORT),
    status: oneOf(['PROPOSED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']),
    missionContract: { type: 'object', nullable: true, fields: { missionId: str(SHORT), revision: { type: 'number', nullable: true, integer: true, min: 1 }, canonicalHash: nstr(SHORT) } },
    parentProjectId: nstr(SHORT),
  },
  OBJECTIVE: { statement: str(), successMeasure: nstr() },
  MISSION_STATE: {
    phase: str(SHORT), activeTaskIds: strings(256, SHORT),
    dependencies: { type: 'object[]', maxItems: 256, fields: { taskId: str(SHORT), dependsOn: strings(64, SHORT) } },
    waitingOn: strings(64, SHORT), humanBoundaries: strings(64, SHORT),
    repairRound: { type: 'number', nullable: true, integer: true, min: 0 },
    retryState: { type: 'scalarMap', maxEntries: 32 },
    budget: { type: 'object', nullable: true, fields: { spentUsdMicros: { type: 'number', nullable: true, integer: true, min: 0 }, limitUsdMicros: { type: 'number', nullable: true, integer: true, min: 0 } } },
  },
  REQUIREMENT: {
    // UNCLASSIFIED is a real value, not a default: v1 requirements carry no
    // class, and a mirror that picked one would be inventing a fact.
    requirementClass: oneOf(['FUNCTIONAL', 'NON_FUNCTIONAL', 'UNCLASSIFIED']), statement: str(),
    priority: { type: 'string', nullable: true, enum: ['MUST', 'SHOULD', 'COULD'] },
    status: oneOf(['PROPOSED', 'ACTIVE', 'SATISFIED', 'WAIVED']),
  },
  ACCEPTANCE_CRITERION: {
    statement: str(), blocking: bool, requiredEvidenceClasses: { type: 'string[]', maxItems: 16, enum: JULIUS_BRAIN_EVIDENCE_CLASSES },
    status: oneOf(['PROPOSED', 'ACTIVE', 'SATISFIED', 'UNSATISFIED', 'WAIVED']),
  },
  CONSTRAINT: { statement: str(), status: oneOf(['PROPOSED', 'ACTIVE']) },
  PROHIBITION: { statement: str(), status: oneOf(['PROPOSED', 'ACTIVE']) },
  ASSUMPTION: { statement: str(), status: oneOf(['OPEN', 'VALIDATED', 'INVALIDATED']) },
  OPEN_QUESTION: { question: str(), blocking: bool, status: oneOf(['OPEN', 'ANSWERED', 'WITHDRAWN']), answer: nstr() },
  ARCHITECTURE_COMPONENT: { name: str(SHORT), responsibility: str(), interfaces: strings(64, SHORT), dependsOn: strings(64, SHORT), constraints: strings(64) },
  ARCHITECTURE_INTERFACE: { name: str(SHORT), providedBy: str(SHORT), consumers: strings(64, SHORT), contract: str() },
  DECISION: {
    decisionClass: oneOf(['MISSION', 'ARCHITECTURE', 'IMPLEMENTATION', 'VERIFICATION', 'REPAIR', 'PROCESS']),
    statement: str(), rationale: str(),
    alternatives: { type: 'object[]', maxItems: 16, fields: { option: str(), reasonRejected: str() } },
    status: oneOf(['ACTIVE', 'REVERSED']),
  },
  RESEARCH: {
    question: str(),
    findings: { type: 'object[]', maxItems: 64, fields: { statement: str(), confidence: unit } },
    sources: { type: 'object[]', maxItems: 64, fields: { sourceKind: oneOf(['REPOSITORY', 'URL', 'DOCUMENT', 'TOOL', 'WORKER', 'BRAIN', 'USER']), reference: str(2_048), retrievedAt: nstr(64) } },
    contradictions: strings(32), unresolved: strings(32), status: oneOf(['OPEN', 'CONCLUDED']),
  },
  EVIDENCE: {
    evidenceClass: oneOf(JULIUS_BRAIN_EVIDENCE_CLASSES), claim: str(), summary: str(),
    status: oneOf(['PASSED', 'FAILED', 'INCONCLUSIVE']),
    verification: oneOf(['UNVERIFIED', 'VERIFIED', 'REFUTED']),
    data: { type: 'json', nullable: true, maxBytes: 64_000 },
    juliusEvidenceId: nstr(SHORT),
  },
  EVAL: {
    evaluationName: str(SHORT),
    target: { type: 'object', fields: { targetKind: oneOf(['ENTITY', 'ARTIFACT', 'COMMIT', 'WORKER', 'MODEL', 'PROMPT', 'DATASET', 'OTHER']), reference: str(2_048) } },
    inputs: { type: 'object[]', maxItems: 64, fields: { name: str(SHORT), reference: str(2_048), contentHash: { type: 'string', nullable: true, pattern: JULIUS_BRAIN_SHA256_PATTERN } } },
    outcome: oneOf(['PASS', 'FAIL', 'REFUSED', 'ERROR', 'INCONCLUSIVE']),
    score: nnum, maxScore: nnum,
    metrics: { type: 'object[]', maxItems: 128, fields: { name: str(SHORT), value: nnum, unit: nstr(64) } },
    evaluator: str(SHORT),
    reproducibility: { type: 'object', fields: {
      seed: { type: 'number', nullable: true, integer: true }, codeHash: nstr(SHORT), inputsHash: nstr(SHORT),
      environmentHash: nstr(SHORT), commit: nstr(SHORT), command: nstr(2_048), environmentRunId: nstr(SHORT),
    } },
  },
  FINDING: {
    findingClass: oneOf(['DEFECT', 'AMBIGUITY', 'RISK', 'INCONSISTENCY', 'REVIEWER_FINDING', 'UNRESOLVED_ISSUE']),
    // UNKNOWN is a real value: an imported finding whose source recorded no
    // severity must not be given one.
    severity: oneOf(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN']),
    statement: str(), blocking: bool, status: oneOf(['OPEN', 'RESOLVED', 'DISMISSED', 'STALE']), juliusFindingId: nstr(SHORT),
  },
  REPAIR: {
    reason: str(), status: oneOf(['REQUESTED', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'REJECTED', 'ABANDONED']),
    implementation: nstr(), verification: oneOf(['NOT_RUN', 'PASSED', 'FAILED']),
    reviewerDisposition: { type: 'string', nullable: true, enum: ['PENDING', 'ACCEPTED', 'REJECTED'] },
    resultingState: nstr(), juliusRepairId: nstr(SHORT),
  },
  HANDOFF: {
    handoffClass: oneOf(['ARCHITECT_TO_CODER', 'CODER_TO_REVIEWER', 'REVIEWER_TO_JULIUS', 'JULIUS_CONTINUATION', 'RESEARCH_ANSWER', 'REPAIR_GUIDANCE', 'OTHER']),
    fromRole: str(SHORT), toRole: str(SHORT), summary: str(), openQuestions: strings(32),
  },
  ARTIFACT: {
    artifactClass: oneOf(JULIUS_BRAIN_ARTIFACT_CLASSES), name: str(SHORT), contentType: str(SHORT),
    // Null when only a reference and hash are known (an archived artifact whose bytes this Brain does not hold).
    byteSize: { type: 'number', nullable: true, integer: true, min: 0 },
    contentHash: { type: 'string', pattern: JULIUS_BRAIN_SHA256_PATTERN },
    storageRef: str(2_048), commit: nstr(SHORT),
  },
  MEMORY_FACT: {
    statement: str(), trust: oneOf(JULIUS_BRAIN_TRUST_WRITABLE), expiresAt: nstr(64),
  },
  TRACE: {
    traceClass: oneOf(['ACTION', 'WORKER_ACTION', 'TOOL_INVOCATION', 'STATE_TRANSITION', 'LIFECYCLE', 'FAILURE', 'RECOVERY']),
    summary: str(), facts: { type: 'scalarMap', maxEntries: 32 },
  },
  PYTHON_EXECUTION: {
    executionId: str(SHORT),
    // DISCONNECTED: in flight when its host went away. Never replayed, never
    // relaunched, and never reported as anything it cannot be shown to be.
    state: oneOf(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'DENIED', 'DISCONNECTED']),
    reasonCode: nstr(SHORT),
    /** The state mode its Brain snapshot was selected under; null when none was applied. */
    stateMode: { type: 'string', nullable: true, enum: ['FRESH', 'CONTINUATION', 'LEARNING', 'REGRESSION'] },
    requestedBy: str(SHORT),
    purpose: str(2_048),
    scriptHash: { type: 'string', pattern: JULIUS_BRAIN_SHA256_PATTERN },
    requestDigest: { type: 'string', pattern: JULIUS_BRAIN_SHA256_PATTERN },
    inputsHash: { type: 'string', pattern: JULIUS_BRAIN_SHA256_PATTERN },
    contextSnapshotHash: { type: 'string', nullable: true, pattern: JULIUS_BRAIN_SHA256_PATTERN },
    environmentId: str(SHORT),
    environmentHash: { type: 'string', nullable: true, pattern: JULIUS_BRAIN_SHA256_PATTERN },
    interpreter: { type: 'object', nullable: true, fields: { version: str(SHORT), implementation: str(SHORT), platform: str(SHORT), executableHash: { type: 'string', nullable: true, pattern: JULIUS_BRAIN_SHA256_PATTERN } } },
    requirements: { type: 'object[]', maxItems: 256, fields: { name: str(SHORT), version: str(SHORT) } },
    /** Distributions the execution actually imported, as the runner observed them; null when unknown. */
    dependencies: { type: 'json', nullable: true, maxBytes: 32_000 },
    exitCode: { type: 'number', nullable: true, integer: true },
    durationMs: { type: 'number', nullable: true, integer: true, min: 0 },
    cpuSeconds: { type: 'number', nullable: true, min: 0 },
    peakMemoryBytes: { type: 'number', nullable: true, integer: true, min: 0 },
    network: oneOf(['DENY', 'ALLOWLIST']),
    networkDestinations: strings(32, SHORT),
    enforcement: { type: 'scalarMap', maxEntries: 16 },
    denialCount: { type: 'number', nullable: true, integer: true, min: 0 },
    stdoutHash: { type: 'string', nullable: true, pattern: JULIUS_BRAIN_SHA256_PATTERN },
    stderrHash: { type: 'string', nullable: true, pattern: JULIUS_BRAIN_SHA256_PATTERN },
    stdoutBytes: { type: 'number', nullable: true, integer: true, min: 0 },
    stderrBytes: { type: 'number', nullable: true, integer: true, min: 0 },
    outputTruncated: bool,
    structuredOutput: oneOf(['VALID', 'INVALID', 'ABSENT']),
    structuredOutputErrors: strings(16, SHORT),
    proposalsStaged: { type: 'number', nullable: true, integer: true, min: 0 },
    proposalsAdmitted: { type: 'number', integer: true, min: 0 },
    artifactCount: { type: 'number', integer: true, min: 0 },
    redactions: { type: 'number', integer: true, min: 0 },
    cancellation: { type: 'object', nullable: true, fields: { requestedBy: str(SHORT), requestedAt: str(64), confirmedBy: oneOf(['KILLED', 'EXITED', 'NEVER_STARTED']) } },
  },
  CHECKPOINT: {
    label: str(SHORT), throughSequence: { type: 'number', integer: true, min: 0 },
    stateHash: { type: 'string', pattern: JULIUS_BRAIN_SHA256_PATTERN },
    entityCount: { type: 'number', integer: true, min: 0 },
  },
});

export const JULIUS_BRAIN_RETIRE_SCHEMA: JuliusBrainObjectSpec = Object.freeze({
  reason: str(), disposition: oneOf(JULIUS_BRAIN_RETIREMENT_DISPOSITIONS),
});

/* ------------------------------------------------------------- validation */

const LIMITS = Object.freeze({ idLength: 256, links: 64, draftBytes: 256_000 });
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/;

export const isJuliusBrainId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const isIso = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));

/** The errors, each a stable `path: reason` string. Empty means valid. */
export function validateJuliusBrainObject(spec: JuliusBrainObjectSpec, value: unknown, path = 'body'): string[] {
  const errors: string[] = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path}: must be an object`];
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(key in spec)) errors.push(`${path}.${key}: unknown field`);
  for (const [key, field] of Object.entries(spec)) {
    if (!(key in record)) { errors.push(`${path}.${key}: required`); continue; }
    errors.push(...validateField(field, record[key], `${path}.${key}`));
  }
  return errors;
}

function validateField(spec: JuliusBrainFieldSpec, value: unknown, path: string): string[] {
  if (value === null) {
    return 'nullable' in spec && spec.nullable === true ? [] : [`${path}: may not be null`];
  }
  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') return [`${path}: must be a string`];
      if (spec.maxLength !== undefined && value.length > spec.maxLength) return [`${path}: longer than ${spec.maxLength}`];
      if (spec.enum !== undefined && !spec.enum.includes(value)) return [`${path}: not one of ${spec.enum.join('|')}`];
      if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) return [`${path}: does not match ${spec.pattern}`];
      return [];
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: must be a finite number`];
      if (spec.integer === true && !Number.isSafeInteger(value)) return [`${path}: must be an integer`];
      if (spec.min !== undefined && value < spec.min) return [`${path}: below ${spec.min}`];
      if (spec.max !== undefined && value > spec.max) return [`${path}: above ${spec.max}`];
      return [];
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path}: must be a boolean`];
    case 'string[]': {
      if (!Array.isArray(value)) return [`${path}: must be an array`];
      if (spec.maxItems !== undefined && value.length > spec.maxItems) return [`${path}: more than ${spec.maxItems} items`];
      return value.flatMap((item, index) => validateField({ type: 'string', maxLength: spec.maxLength, enum: spec.enum }, item, `${path}[${index}]`));
    }
    case 'object':
      return validateJuliusBrainObject(spec.fields, value, path);
    case 'object[]': {
      if (!Array.isArray(value)) return [`${path}: must be an array`];
      if (spec.maxItems !== undefined && value.length > spec.maxItems) return [`${path}: more than ${spec.maxItems} items`];
      return value.flatMap((item, index) => validateJuliusBrainObject(spec.fields, item, `${path}[${index}]`));
    }
    case 'scalarMap': {
      if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: must be an object`];
      const entries = Object.entries(value as Record<string, unknown>);
      if (spec.maxEntries !== undefined && entries.length > spec.maxEntries) return [`${path}: more than ${spec.maxEntries} entries`];
      return entries.flatMap(([key, item]) =>
        item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
          ? (typeof item === 'string' && item.length > SHORT ? [`${path}.${key}: longer than ${SHORT}`] : [])
          : [`${path}.${key}: must be a scalar`]);
    }
    case 'json': {
      let bytes: number;
      try { bytes = canonicalJuliusBrainJson(value).length; } catch { return [`${path}: must be finite JSON`]; }
      return spec.maxBytes !== undefined && bytes > spec.maxBytes ? [`${path}: larger than ${spec.maxBytes} bytes`] : [];
    }
  }
}

/**
 * STRUCTURAL validity of a draft: identities, enums, the body against its
 * kind's schema. Governance (who may write it) is `julius-brain-policy.ts`;
 * referential validity (does a link target exist) needs the ledger and is the
 * planner's.
 */
export function validateJuliusBrainDraft(draft: JuliusBrainDraft): string[] {
  const errors: string[] = [];
  if (!(JULIUS_BRAIN_RECORD_KINDS as readonly string[]).includes(draft.kind)) return [`kind: unknown ${String(draft.kind)}`];
  if (!(JULIUS_BRAIN_OPERATIONS as readonly string[]).includes(draft.op)) errors.push('op: unknown');
  if (draft.op === 'CREATE') {
    if (draft.entityId !== null && !isJuliusBrainId(draft.entityId)) errors.push('entityId: invalid');
    if (draft.expectedVersion !== 0) errors.push('expectedVersion: must be 0 for CREATE');
  } else {
    if (!isJuliusBrainId(draft.entityId)) errors.push('entityId: required for REVISE and RETIRE');
    if (!Number.isSafeInteger(draft.expectedVersion) || draft.expectedVersion < 1) errors.push('expectedVersion: must be the current version');
  }
  if (!isJuliusBrainId(draft.idempotencyKey)) errors.push('idempotencyKey: invalid');
  if (!isIso(draft.occurredAt)) errors.push('occurredAt: must be an ISO timestamp');
  if (!(JULIUS_BRAIN_RETENTION as readonly string[]).includes(draft.retention)) errors.push('retention: unknown');
  if (!(JULIUS_BRAIN_SENSITIVITY as readonly string[]).includes(draft.sensitivity)) errors.push('sensitivity: unknown');
  if (draft.confidence !== null && (typeof draft.confidence !== 'number' || !Number.isFinite(draft.confidence) || draft.confidence < 0 || draft.confidence > 1)) {
    errors.push('confidence: must be null or within 0..1');
  }
  for (const key of ['missionId', 'runId', 'taskId'] as const) {
    const value = draft.scope?.[key];
    if (value !== null && !isJuliusBrainId(value)) errors.push(`scope.${key}: invalid`);
  }
  errors.push(...validateJuliusBrainProvenance(draft.provenance));
  if (!Array.isArray(draft.links) || draft.links.length > LIMITS.links) errors.push(`links: at most ${LIMITS.links}`);
  else {
    draft.links.forEach((link, index) => {
      if (!(JULIUS_BRAIN_LINK_RELATIONS as readonly string[]).includes(link.relation)) errors.push(`links[${index}].relation: unknown`);
      if (!isJuliusBrainId(link.target)) errors.push(`links[${index}].target: invalid`);
      if (link.targetVersion !== null && (!Number.isSafeInteger(link.targetVersion) || link.targetVersion < 1)) errors.push(`links[${index}].targetVersion: invalid`);
    });
  }
  errors.push(...validateJuliusBrainObject(draft.op === 'RETIRE' ? JULIUS_BRAIN_RETIRE_SCHEMA : JULIUS_BRAIN_BODY_SCHEMAS[draft.kind], draft.body));
  try {
    const encoded = canonicalJuliusBrainJson(draft);
    if (encoded.length > LIMITS.draftBytes) errors.push(`draft: larger than ${LIMITS.draftBytes} bytes`);
    // PostgreSQL text and jsonb both refuse NUL. Refusing it here keeps the
    // in-memory model from accepting a record production would reject.
    if (encoded.includes('\\u0000')) errors.push('draft: contains a NUL character');
  } catch {
    errors.push('draft: not finite JSON');
  }
  return errors;
}

const PROVENANCE_SOURCES: readonly JuliusMemoryProvenance[] = [
  'user_stated', 'repository_observed', 'tool_observed', 'run_observed', 'reviewer_verified', 'system_policy', 'derived_candidate', 'external_retrieved',
];

function validateJuliusBrainProvenance(provenance: JuliusBrainProvenance | undefined): string[] {
  if (provenance === undefined || provenance === null || typeof provenance !== 'object') return ['provenance: required'];
  const errors: string[] = [];
  const allowed = ['source', 'provider', 'model', 'tool', 'commit', 'externalRef', 'executionId'];
  for (const key of Object.keys(provenance)) if (!allowed.includes(key)) errors.push(`provenance.${key}: unknown field`);
  if (!PROVENANCE_SOURCES.includes(provenance.source)) errors.push('provenance.source: unknown');
  for (const key of allowed.slice(1) as (keyof JuliusBrainProvenance)[]) {
    if (!(key in provenance)) errors.push(`provenance.${key}: required (null when unknown)`);
    else if (provenance[key] !== null && (typeof provenance[key] !== 'string' || provenance[key].length > 2_048)) errors.push(`provenance.${key}: invalid`);
  }
  return errors;
}

export function validateJuliusBrainPrincipal(principal: JuliusBrainPrincipal): string[] {
  const errors: string[] = [];
  if (!(JULIUS_BRAIN_PRINCIPAL_KINDS as readonly string[]).includes(principal.kind)) return ['principal.kind: unknown'];
  if (!isJuliusBrainId(principal.id)) errors.push('principal.id: invalid');
  if (principal.kind === 'WORKER' && (principal.role === null || !principal.role.trim())) errors.push('principal.role: required for WORKER');
  if (principal.kind !== 'WORKER' && principal.role !== null) errors.push('principal.role: only a WORKER has a role');
  if ((principal.kind === 'TOOL' || principal.kind === 'ENVIRONMENT') && (principal.grantId === null || !isJuliusBrainId(principal.grantId))) {
    errors.push('principal.grantId: required for TOOL and ENVIRONMENT');
  }
  if (principal.kind === 'TOOL' && (principal.onBehalfOf === null || !isJuliusBrainId(principal.onBehalfOf))) errors.push('principal.onBehalfOf: required for TOOL');
  return errors;
}

/* ---------------------------------------------------------------- hashing */

/**
 * CANONICAL JSON: sorted keys, no whitespace, finite numbers only, no
 * `undefined`. Two runtimes that agree on the value agree on the bytes, which
 * is what makes a hash computed in Python comparable to one computed here.
 */
export function canonicalJuliusBrainJson(value: unknown): string {
  const encode = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('julius_brain_non_finite_number');
      return JSON.stringify(item);
    }
    if (typeof item === 'string') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    if (typeof item === 'object') {
      const entries = Object.entries(item as Record<string, unknown>).filter(([, inner]) => inner !== undefined);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${encode(inner)}`).join(',')}}`;
    }
    throw new Error(`julius_brain_unencodable_${typeof item}`);
  };
  return encode(value);
}

export const juliusBrainSha256 = (text: string): string => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

/** Exactly the fields of a draft, whatever else the object carries. */
export function juliusBrainDraftOf(value: JuliusBrainDraft): JuliusBrainDraft {
  return {
    kind: value.kind, op: value.op, entityId: value.entityId, expectedVersion: value.expectedVersion,
    body: value.body, links: value.links, scope: value.scope, retention: value.retention,
    confidence: value.confidence, sensitivity: value.sensitivity, provenance: value.provenance,
    idempotencyKey: value.idempotencyKey, occurredAt: value.occurredAt,
  };
}

/**
 * What a replay must agree on. The clock is deliberately not part of it: a
 * retry that re-reads the clock is still the same write. `draft.entityId` must
 * already be resolved, so a replay that omits a derived id and one that spells
 * it out agree.
 */
export function juliusBrainFingerprint(draft: JuliusBrainDraft, principal: JuliusBrainPrincipal): string {
  const { occurredAt: _occurredAt, ...content } = juliusBrainDraftOf(draft);
  return juliusBrainSha256(canonicalJuliusBrainJson({ content, principal }));
}

export type JuliusBrainRecordContent = Omit<JuliusBrainRecord, 'contentHash' | 'chainHash' | 'recordedAt' | 'sequence'>;

/** sha256 over a record's content: every draft field plus its identity, author and fingerprint. */
export function juliusBrainContentHash(record: JuliusBrainRecordContent): string {
  return juliusBrainSha256(canonicalJuliusBrainJson({
    ...juliusBrainDraftOf(record), schemaVersion: record.schemaVersion, brainId: record.brainId, recordId: record.recordId,
    entityVersion: record.entityVersion, principal: record.principal, fingerprint: record.fingerprint,
  }));
}

export const juliusBrainGenesisHash = (brainId: string): string => juliusBrainSha256(`julius-project-brain-genesis\n${brainId}`);

export function juliusBrainChainHash(previous: string, sequence: number, recordId: string, contentHash: string): string {
  return juliusBrainSha256(`${previous}\n${sequence}\n${recordId}\n${contentHash}`);
}

export const juliusBrainRecordId = (brainId: string, idempotencyKey: string): string =>
  `brec:${juliusBrainSha256(`${brainId}\u0000${idempotencyKey}`).slice(7, 39)}`;

export const juliusBrainDerivedEntityId = (brainId: string, kind: JuliusBrainRecordKind, idempotencyKey: string): string =>
  `${kind.toLowerCase().replace(/_/g, '-')}:${juliusBrainSha256(`${brainId}\u0000entity\u0000${idempotencyKey}`).slice(7, 31)}`;

/* ------------------------------------------------------------ constructors */

export const JULIUS_BRAIN_UNKNOWN_PROVENANCE_FIELDS = Object.freeze({
  provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null,
});

export function juliusBrainProvenance(source: JuliusMemoryProvenance, fields: Partial<Omit<JuliusBrainProvenance, 'source'>> = {}): JuliusBrainProvenance {
  return { source, ...JULIUS_BRAIN_UNKNOWN_PROVENANCE_FIELDS, ...fields };
}

export const juliusBrainScope = (fields: Partial<JuliusBrainScope> = {}): JuliusBrainScope =>
  ({ missionId: fields.missionId ?? null, runId: fields.runId ?? null, taskId: fields.taskId ?? null });

export function juliusPrincipal(kind: JuliusBrainPrincipalKind, id: string, fields: Partial<Omit<JuliusBrainPrincipal, 'kind' | 'id'>> = {}): JuliusBrainPrincipal {
  return { kind, id, role: fields.role ?? null, onBehalfOf: fields.onBehalfOf ?? null, grantId: fields.grantId ?? null };
}

export const juliusWorkerPrincipal = (id: string, role: JuliusWorkerRole): JuliusBrainPrincipal => juliusPrincipal('WORKER', id, { role });
