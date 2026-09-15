import { createHash } from 'node:crypto';

import {
  canonicalJuliusBrainJson,
  isJuliusBrainId,
  juliusBrainProvenance,
  juliusBrainSha256,
  juliusPrincipal,
  type JuliusBrainBody,
  type JuliusBrainDraft,
  type JuliusBrainLink,
  type JuliusBrainPrincipal,
  type JuliusBrainRecordKind,
} from './julius-brain-contracts';
import { juliusVerificationDecisionKey, parseJuliusV1DecisionEntryId } from './julius-brain-legacy';
import { deriveJuliusBrainRunPreservation, juliusArchiveRecoveryEntityId, juliusRunOpenedEntityId, type JuliusBrainPreservationStatus, type JuliusBrainRunPreservation } from './julius-brain-preservation';
import type { JuliusBrainCommitGroup, JuliusBrainEntityState, JuliusBrainReceipt } from './julius-brain-projection';
import { juliusStringsOf, scanJuliusSecrets } from './julius-brain-secrets';
import { JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX, JULIUS_BRAIN_STATE_MODES, type JuliusBrainStateMode } from './julius-brain-state-modes';
import { readAllJuliusBrainEntities, readAllJuliusBrainRecords, type JuliusBrainStore } from './julius-brain-store';

/**
 * THE PAID-RUN ARCHIVE → PROJECT BRAIN IMPORT BOUNDARY.
 *
 * Formal Julius keeps a TEMPORARY archive of real paid runs. Its tables are its
 * own and may change freely; the Brain never reads them. What crosses is one
 * versioned, self-hashed, typed JSON document per workflow run attempt —
 * `julius-paid-run-archive-export.v1`, owned here — and a translation into
 * canonical Brain records. Nothing else crosses.
 *
 * NULL, EMPTY AND UNKNOWN, EXACTLY.
 *   - The export is JSON with explicit nulls. A string is never empty: `''` is
 *     refused everywhere, because a source that cannot tell NULL from `''` (a
 *     `psql -A` dump) must decide which it means before export, not leave the
 *     Brain to guess.
 *   - Each item lists, in `unknown`, every nullable field whose null means
 *     "not recorded". A null NOT listed means "recorded as absent" (a root
 *     task's parent; a tool call that never completed).
 *   - A list field is `[]` when recorded as empty and null (listed) when
 *     Unknown.
 *   - A listed field must be null; only nullable fields may be listed; the list
 *     is sorted and unique.
 * The translation never fills an Unknown in: a severity nobody recorded is
 * UNKNOWN, an occurrence time nobody recorded is a null `occurredAt`, a
 * rationale nobody recorded says so, and evidence stays UNVERIFIED whatever the
 * source claimed — an archive does not grant trust.
 *
 * WHAT IS REFUSED BEFORE ANYTHING IS WRITTEN: any other format or version; a
 * field missing, extra, mistyped or empty; a malformed `unknown` list; an
 * identity or section hash, or the content hash, that does not match; duplicate
 * ids; a reference to a task, evidence, finding or artifact the export does not
 * hold; a reported cost with no amount, or an UNKNOWN cost with one; artifact
 * bytes, when supplied, that do not hash to their recorded digest; and any
 * credential-shaped content, with its location.
 *
 * IDENTITY. A Brain run is `workflow:<workflowRunId>/<workflowRunAttempt>`. The
 * Julius run id repeats across paid attempts of one mission contract, so it is
 * provenance only. Entity ids and idempotency keys derive from the workflow
 * attempt, section and source id: re-importing writes nothing, a different
 * history under the same keys is a conflict, and every record carries the run
 * scope a state mode (`julius-brain-state-modes.ts`) decides retrieval by.
 * Retention is not retrieval authority.
 *
 * ONE LOGICAL FACT, ONE RECORD. A verification decision appears in an export
 * twice — as a review, and as the v1 Brain entry the runtime wrote for it
 * (`brain:decision:<task>:<action>:<reason>`). The review is imported; the
 * entry is counted as represented by it, never recorded again.
 *
 * RECONCILED WITH WHAT THE LIVE RUN ALREADY PRESERVED. The same workflow
 * attempt may already be in the Brain through the live mirror. Before anything
 * is written, the attempt's preservation is derived from the Brain
 * (`julius-brain-preservation.ts`):
 *
 *   PRESERVED            the import is refused: the live history is complete,
 *                        and an archive copy would record it twice
 *   PARTIALLY_PRESERVED  RECONCILED: every archive fact the live mirror already
 *                        recorded (a v1 entry by id; a verification decision by
 *                        task, verdict and reason) is linked, not recorded
 *                        again, and only what is missing is added
 *   NOT_PRESERVED        RECONSTRUCTED: the whole attempt is imported
 *
 * A history that contradicts the live one is refused, not merged: an open
 * marker whose mission, Julius run or accepted main disagrees with the export's
 * identity; a v1 entry the live run holds that the export does not list; a seal
 * that counted a different number of entries. Every recovery leaves a
 * Julius-written RECOVERY trace — mode, prior status, what was added and what
 * was already represented, linked to the live records it relied on — and a
 * repeated recovery writes nothing.
 */

export const JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT = 'julius-paid-run-archive-export.v1' as const;
export const JULIUS_ARCHIVE_IMPORTER_VERSION = 'julius-brain-archive-import.v2' as const;

/* ---------------------------------------------------------- source contract */

export type JuliusArchiveCostBasis = 'PROVIDER_REPORTED' | 'MEASURED_FROM_USAGE' | 'ESTIMATED' | 'UNKNOWN';
type Unknowns<F extends string> = { readonly unknown: readonly F[] };

export type JuliusPaidRunArchiveIdentity = Unknowns<'repository' | 'juliusRunId' | 'missionLabel' | 'campaignId' | 'classification' | 'stateModeBasis' | 'outcomeReason' | 'startedAt' | 'endedAt'> & {
  readonly workflowRunId: string;
  readonly workflowRunAttempt: number;
  readonly repository: string | null;
  /** Provenance only: repeats across attempts of one mission contract. */
  readonly juliusRunId: string | null;
  readonly missionId: string;
  readonly missionLabel: string | null;
  readonly campaignId: string | null;
  readonly projectId: string;
  readonly classification: string | null;
  readonly acceptedMainSha: string;
  readonly stateMode: JuliusBrainStateMode;
  readonly stateModeBasis: string | null;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  readonly outcomeReason: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
};

export type JuliusArchiveTask = Unknowns<'role' | 'workerId' | 'ordinal' | 'parentTaskId' | 'dependencyIds'> & {
  readonly taskId: string; readonly taskType: string; readonly role: string | null; readonly workerId: string | null; readonly state: string;
  readonly ordinal: number | null; readonly parentTaskId: string | null; readonly dependencyIds: readonly string[] | null;
};
export type JuliusArchiveResearch = Unknowns<'attemptKey' | 'ordinal' | 'taskId' | 'host' | 'path' | 'bytes' | 'digest' | 'deliveryRange' | 'handoffRef' | 'refusalReason' | 'purpose' | 'evidenceId' | 'occurredAt'> & {
  readonly requestKey: string; readonly attemptKey: string | null; readonly ordinal: number | null; readonly role: string; readonly taskId: string | null;
  readonly host: string | null; readonly path: string | null; readonly bytes: number | null; readonly digest: string | null;
  readonly deliveryRange: { readonly start: number; readonly end: number } | null; readonly handoffRef: string | null;
  readonly disposition: 'SERVED' | 'REFUSED' | 'UNKNOWN'; readonly refusalReason: string | null; readonly purpose: string | null;
  readonly evidenceId: string | null; readonly occurredAt: string | null;
};
export type JuliusArchiveEvidence = Unknowns<'taskId' | 'sourceVerification' | 'safeSummary' | 'artifactRefs' | 'integrityHash' | 'occurredAt'> & {
  readonly evidenceId: string; readonly taskId: string | null; readonly evidenceType: string; readonly status: 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
  /** What the source recorded. Imported evidence is UNVERIFIED regardless. */
  readonly sourceVerification: string | null; readonly safeSummary: string | null; readonly artifactRefs: readonly string[] | null;
  readonly integrityHash: string | null; readonly occurredAt: string | null;
};
export type JuliusArchiveFinding = Unknowns<'taskId' | 'severity' | 'rationale' | 'evidenceIds' | 'occurredAt'> & {
  readonly findingId: string; readonly taskId: string | null; readonly severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  readonly blocking: boolean; readonly status: 'OPEN' | 'RESOLVED' | 'DISMISSED'; readonly claim: string; readonly rationale: string | null;
  readonly evidenceIds: readonly string[] | null; readonly occurredAt: string | null;
};
export type JuliusArchiveReview = Unknowns<'reviewer' | 'targetTaskId' | 'reasonCode' | 'rationale' | 'evidenceIds' | 'sourceRef' | 'occurredAt'> & {
  readonly reviewId: string; readonly reviewer: string | null; readonly verdict: string; readonly targetTaskId: string | null;
  readonly reasonCode: string | null; readonly rationale: string | null; readonly evidenceIds: readonly string[] | null;
  readonly sourceRef: string | null; readonly occurredAt: string | null;
};
export type JuliusArchiveRepair = Unknowns<'round' | 'repairTaskId' | 'reason' | 'outcome' | 'findingIds' | 'occurredAt'> & {
  readonly repairId: string; readonly round: number | null; readonly targetTaskId: string; readonly repairTaskId: string | null;
  readonly reason: string | null; readonly outcome: string | null; readonly findingIds: readonly string[] | null; readonly occurredAt: string | null;
};
export type JuliusArchiveUsage = Unknowns<'taskId' | 'provider' | 'model' | 'requests' | 'inputTokens' | 'outputTokens' | 'usdMicros' | 'estimatedUsdMicros' | 'occurredAt'> & {
  readonly componentId: string; readonly taskId: string | null; readonly role: string; readonly provider: string | null; readonly model: string | null;
  readonly requests: number | null; readonly inputTokens: number | null; readonly outputTokens: number | null; readonly usdMicros: number | null;
  readonly costBasis: JuliusArchiveCostBasis; readonly estimatedUsdMicros: number | null; readonly occurredAt: string | null;
};
/** A v1 Brain entry the run wrote: identifiers only — its content is never exported. */
export type JuliusArchiveBrainEntry = Unknowns<'workerId' | 'taskId' | 'revision' | 'occurredAt'> & {
  readonly entryId: string; readonly kind: string; readonly workerId: string | null; readonly taskId: string | null;
  readonly revision: number | null; readonly occurredAt: string | null;
};
export type JuliusArchiveEvent = Unknowns<'sequence' | 'taskId' | 'occurredAt'> & {
  readonly eventId: string; readonly sequence: number | null; readonly eventType: string; readonly taskId: string | null;
  readonly occurredAt: string | null; readonly facts: Readonly<Record<string, string | number | boolean | null>>;
};
export type JuliusArchiveToolInvocation = Unknowns<'taskId' | 'executionType' | 'result' | 'requestedAt' | 'completedAt' | 'artifactRefs'> & {
  readonly invocationId: string; readonly taskId: string | null; readonly toolId: string; readonly executionType: string | null;
  readonly state: string; readonly result: string | null; readonly requestedAt: string | null; readonly completedAt: string | null;
  readonly artifactRefs: readonly string[] | null;
};
export type JuliusArchiveArtifact = Unknowns<'name' | 'contentType' | 'byteSize' | 'storageRef'> & {
  readonly artifactId: string; readonly name: string | null; readonly contentType: string | null; readonly byteSize: number | null;
  readonly contentHash: string; readonly storageRef: string | null;
};

export const JULIUS_ARCHIVE_SECTIONS = ['tasks', 'research', 'evidence', 'findings', 'reviews', 'repairs', 'usage', 'brainEntries', 'events', 'toolInvocations', 'artifacts'] as const;
export type JuliusArchiveSection = typeof JULIUS_ARCHIVE_SECTIONS[number];

export interface JuliusPaidRunArchiveExportBody {
  readonly format: typeof JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT;
  readonly exportedAt: string;
  readonly source: { readonly archiveId: string; readonly archiveSchemaVersion: string; readonly exporterVersion: string };
  readonly identity: JuliusPaidRunArchiveIdentity;
  readonly tasks: readonly JuliusArchiveTask[];
  readonly research: readonly JuliusArchiveResearch[];
  readonly evidence: readonly JuliusArchiveEvidence[];
  readonly findings: readonly JuliusArchiveFinding[];
  readonly reviews: readonly JuliusArchiveReview[];
  readonly repairs: readonly JuliusArchiveRepair[];
  readonly usage: readonly JuliusArchiveUsage[];
  readonly brainEntries: readonly JuliusArchiveBrainEntry[];
  readonly events: readonly JuliusArchiveEvent[];
  readonly toolInvocations: readonly JuliusArchiveToolInvocation[];
  readonly artifacts: readonly JuliusArchiveArtifact[];
}

export type JuliusArchiveHashedPart = 'identity' | JuliusArchiveSection;

export interface JuliusPaidRunArchiveExport extends JuliusPaidRunArchiveExportBody {
  readonly integrity: {
    /** sha256 of the identity and of each section, as canonical JSON. */
    readonly sectionHashes: Readonly<Record<JuliusArchiveHashedPart, string>>;
    /** sha256 over the canonical export without `integrity`. */
    readonly contentHash: string;
  };
}

const HASHED_PARTS: readonly JuliusArchiveHashedPart[] = ['identity', ...JULIUS_ARCHIVE_SECTIONS];

/** For the exporter: seal a body with its identity, section and content hashes. Any runtime can reproduce these. */
export function sealJuliusPaidRunArchiveExport(body: JuliusPaidRunArchiveExportBody): JuliusPaidRunArchiveExport {
  const sectionHashes = Object.fromEntries(HASHED_PARTS.map((part) => [part, juliusBrainSha256(canonicalJuliusBrainJson(body[part]))])) as Record<JuliusArchiveHashedPart, string>;
  return { ...body, integrity: { sectionHashes, contentHash: juliusBrainSha256(canonicalJuliusBrainJson(body)) } };
}

/* --------------------------------------------------------------- validation */

type FieldType =
  | 'text' | 'shortText' | 'id' | 'iso' | 'sha256' | 'sha40' | 'digits' | 'count' | 'positive' | 'bool' | 'refs' | 'range' | 'facts'
  | readonly string[];
interface FieldSpec { readonly type: FieldType; readonly nullable?: true }
type ObjectSpec = Readonly<Record<string, FieldSpec>>;

const req = (type: FieldType): FieldSpec => ({ type });
const opt = (type: FieldType): FieldSpec => ({ type, nullable: true });

const IDENTITY_SPEC: ObjectSpec = {
  workflowRunId: req('digits'), workflowRunAttempt: req('positive'), repository: opt('shortText'), juliusRunId: opt('id'),
  missionId: req('id'), missionLabel: opt('shortText'), campaignId: opt('shortText'), projectId: req('id'), classification: opt('shortText'),
  acceptedMainSha: req('sha40'), stateMode: req(JULIUS_BRAIN_STATE_MODES), stateModeBasis: opt('text'),
  outcome: req(['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN']), outcomeReason: opt('text'), startedAt: opt('iso'), endedAt: opt('iso'),
};

const SECTION_SPECS: Readonly<Record<JuliusArchiveSection, { readonly idField: string; readonly fields: ObjectSpec }>> = {
  tasks: { idField: 'taskId', fields: {
    taskId: req('shortText'), taskType: req('shortText'), role: opt('shortText'), workerId: opt('shortText'), state: req('shortText'),
    ordinal: opt('count'), parentTaskId: opt('shortText'), dependencyIds: opt('refs'),
  } },
  research: { idField: 'requestKey', fields: {
    requestKey: req('shortText'), attemptKey: opt('shortText'), ordinal: opt('count'), role: req('shortText'), taskId: opt('shortText'),
    host: opt('shortText'), path: opt('text'), bytes: opt('count'), digest: opt('sha256'), deliveryRange: opt('range'), handoffRef: opt('shortText'),
    disposition: req(['SERVED', 'REFUSED', 'UNKNOWN']), refusalReason: opt('shortText'), purpose: opt('text'), evidenceId: opt('shortText'), occurredAt: opt('iso'),
  } },
  evidence: { idField: 'evidenceId', fields: {
    evidenceId: req('shortText'), taskId: opt('shortText'), evidenceType: req('shortText'), status: req(['PASSED', 'FAILED', 'INCONCLUSIVE']),
    sourceVerification: opt('shortText'), safeSummary: opt('text'), artifactRefs: opt('refs'), integrityHash: opt('sha256'), occurredAt: opt('iso'),
  } },
  findings: { idField: 'findingId', fields: {
    findingId: req('shortText'), taskId: opt('shortText'), severity: opt(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), blocking: req('bool'),
    status: req(['OPEN', 'RESOLVED', 'DISMISSED']), claim: req('text'), rationale: opt('text'), evidenceIds: opt('refs'), occurredAt: opt('iso'),
  } },
  reviews: { idField: 'reviewId', fields: {
    reviewId: req('shortText'), reviewer: opt('shortText'), verdict: req('shortText'), targetTaskId: opt('shortText'), reasonCode: opt('shortText'),
    rationale: opt('text'), evidenceIds: opt('refs'), sourceRef: opt('shortText'), occurredAt: opt('iso'),
  } },
  repairs: { idField: 'repairId', fields: {
    repairId: req('shortText'), round: opt('positive'), targetTaskId: req('shortText'), repairTaskId: opt('shortText'), reason: opt('text'),
    outcome: opt('shortText'), findingIds: opt('refs'), occurredAt: opt('iso'),
  } },
  usage: { idField: 'componentId', fields: {
    componentId: req('shortText'), taskId: opt('shortText'), role: req('shortText'), provider: opt('shortText'), model: opt('shortText'),
    requests: opt('count'), inputTokens: opt('count'), outputTokens: opt('count'), usdMicros: opt('count'),
    costBasis: req(['PROVIDER_REPORTED', 'MEASURED_FROM_USAGE', 'ESTIMATED', 'UNKNOWN']), estimatedUsdMicros: opt('count'), occurredAt: opt('iso'),
  } },
  brainEntries: { idField: 'entryId', fields: {
    entryId: req('shortText'), kind: req('shortText'), workerId: opt('shortText'), taskId: opt('shortText'), revision: opt('positive'), occurredAt: opt('iso'),
  } },
  events: { idField: 'eventId', fields: {
    eventId: req('shortText'), sequence: opt('positive'), eventType: req('shortText'), taskId: opt('shortText'), occurredAt: opt('iso'), facts: req('facts'),
  } },
  toolInvocations: { idField: 'invocationId', fields: {
    invocationId: req('shortText'), taskId: opt('shortText'), toolId: req('shortText'), executionType: opt('shortText'), state: req('shortText'),
    result: opt('shortText'), requestedAt: opt('iso'), completedAt: opt('iso'), artifactRefs: opt('refs'),
  } },
  artifacts: { idField: 'artifactId', fields: {
    artifactId: req('shortText'), name: opt('shortText'), contentType: opt('shortText'), byteSize: opt('count'), contentHash: req('sha256'), storageRef: opt('text'),
  } },
};

const EXPORT_KEYS = ['format', 'exportedAt', 'source', 'identity', ...JULIUS_ARCHIVE_SECTIONS, 'integrity'];
const SOURCE_KEYS = ['archiveId', 'archiveSchemaVersion', 'exporterVersion'];
const FORMAT_FAMILY = /^julius-paid-run-archive-export\.v(\d+)$/;
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIso = (value: unknown) => typeof value === 'string' && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

function checkValue(value: unknown, type: FieldType, at: string, errors: string[]): void {
  const text = (max: number) => {
    if (typeof value !== 'string') errors.push(`${at}: a string`);
    else if (value.length === 0) errors.push(`${at}: an empty string is not a value (null means Unknown)`);
    else if (value.length > max) errors.push(`${at}: at most ${max} characters`);
  };
  if (Array.isArray(type)) { if (!type.includes(value as string)) errors.push(`${at}: one of ${type.join(', ')}`); return; }
  switch (type) {
    case 'text': return text(8_000);
    case 'shortText': return text(512);
    case 'id': if (!isJuliusBrainId(value)) errors.push(`${at}: an identifier`); return;
    case 'iso': if (!isIso(value)) errors.push(`${at}: an ISO timestamp`); return;
    case 'sha256': if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) errors.push(`${at}: sha256:<64 hex>`); return;
    case 'sha40': if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) errors.push(`${at}: 40 lowercase hex`); return;
    case 'digits': if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value)) errors.push(`${at}: digits`); return;
    case 'count': if (!Number.isSafeInteger(value) || (value as number) < 0) errors.push(`${at}: a non-negative integer`); return;
    case 'positive': if (!Number.isSafeInteger(value) || (value as number) < 1) errors.push(`${at}: a positive integer`); return;
    case 'bool': if (typeof value !== 'boolean') errors.push(`${at}: a boolean`); return;
    case 'refs': {
      if (!Array.isArray(value)) { errors.push(`${at}: a list`); return; }
      value.forEach((item, i) => checkValue(item, 'shortText', `${at}[${i}]`, errors));
      if (new Set(value).size !== value.length) errors.push(`${at}: duplicate references`);
      return;
    }
    case 'range': {
      if (!isPlainObject(value) || Object.keys(value).sort().join() !== 'end,start') { errors.push(`${at}: { start, end }`); return; }
      checkValue(value.start, 'count', `${at}.start`, errors);
      checkValue(value.end, 'count', `${at}.end`, errors);
      if (typeof value.start === 'number' && typeof value.end === 'number' && value.start > value.end) errors.push(`${at}: start after end`);
      return;
    }
    case 'facts': {
      if (!isPlainObject(value)) { errors.push(`${at}: an object of scalar facts`); return; }
      const keys = Object.keys(value);
      if (keys.length > 64) errors.push(`${at}: at most 64 facts`);
      for (const key of keys) {
        if (key.length === 0 || key.length > 64) errors.push(`${at}: fact names are 1..64 characters`);
        const fact = value[key];
        if (fact === null || typeof fact === 'boolean' || (typeof fact === 'number' && Number.isFinite(fact))) continue;
        if (typeof fact === 'string') checkValue(fact, 'text', `${at}.${key}`, errors);
        else errors.push(`${at}.${key}: a scalar`);
      }
      return;
    }
  }
}

function checkObject(value: unknown, spec: ObjectSpec, at: string, errors: string[]): void {
  if (!isPlainObject(value)) { errors.push(`${at}: an object`); return; }
  const expected = [...Object.keys(spec), 'unknown'];
  for (const key of expected) if (!(key in value)) errors.push(`${at}.${key}: missing`);
  for (const key of Object.keys(value)) if (!expected.includes(key)) errors.push(`${at}.${key}: not part of the contract`);
  for (const [key, field] of Object.entries(spec)) {
    if (!(key in value)) continue;
    const fieldValue = value[key];
    if (fieldValue === null) { if (!field.nullable) errors.push(`${at}.${key}: required`); continue; }
    checkValue(fieldValue, field.type, `${at}.${key}`, errors);
  }
  const unknown = value.unknown;
  if (!Array.isArray(unknown) || unknown.some((name) => typeof name !== 'string')) { errors.push(`${at}.unknown: a list of field names`); return; }
  const names = unknown as string[];
  if ([...names].sort().join('') !== names.join('') || new Set(names).size !== names.length) errors.push(`${at}.unknown: sorted and unique`);
  for (const name of names) {
    const field = spec[name];
    if (field === undefined || !field.nullable) errors.push(`${at}.unknown: ${name} is not a nullable field`);
    else if (value[name] !== null) errors.push(`${at}.unknown: ${name} is listed as Unknown but has a value`);
  }
  // A list recorded as empty is []; null is only ever Unknown.
  for (const [key, field] of Object.entries(spec)) {
    if (field.type === 'refs' && value[key] === null && !names.includes(key)) errors.push(`${at}.${key}: null must be listed as Unknown ([] records none)`);
  }
}

export type JuliusArchiveValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: 'unsupported_export_version' | 'not_an_archive_export' | 'archive_invalid'; readonly errors: readonly string[] };

export function checkJuliusPaidRunArchiveExport(archive: unknown): JuliusArchiveValidation {
  if (!isPlainObject(archive) || typeof archive.format !== 'string') return { ok: false, reasonCode: 'not_an_archive_export', errors: ['format: missing'] };
  if (archive.format !== JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT) {
    const family = FORMAT_FAMILY.exec(archive.format);
    return family === null
      ? { ok: false, reasonCode: 'not_an_archive_export', errors: [`format: ${archive.format.slice(0, 80)} is not a paid-run archive export`] }
      : { ok: false, reasonCode: 'unsupported_export_version', errors: [`format: version v${family[1]} is not supported; this importer reads ${JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT} only`] };
  }
  const errors: string[] = [];
  for (const key of Object.keys(archive)) if (!EXPORT_KEYS.includes(key)) errors.push(`${key}: not part of the contract`);
  if (!isIso(archive.exportedAt)) errors.push('exportedAt: an ISO timestamp');
  if (!isPlainObject(archive.source)) errors.push('source: an object');
  else {
    for (const key of SOURCE_KEYS) checkValue(archive.source[key], 'shortText', `source.${key}`, errors);
    for (const key of Object.keys(archive.source)) if (!SOURCE_KEYS.includes(key)) errors.push(`source.${key}: not part of the contract`);
  }
  checkObject(archive.identity, IDENTITY_SPEC, 'identity', errors);
  for (const section of JULIUS_ARCHIVE_SECTIONS) {
    const items = archive[section];
    if (!Array.isArray(items)) { errors.push(`${section}: a list`); continue; }
    items.forEach((item, i) => checkObject(item, SECTION_SPECS[section].fields, `${section}[${i}]`, errors));
  }
  if (errors.length > 0) return { ok: false, reasonCode: 'archive_invalid', errors: errors.slice(0, 50) };

  const typed = archive as unknown as JuliusPaidRunArchiveExport;
  // Integrity: the identity, every section, then the whole body.
  const { integrity, ...body } = typed;
  if (!isPlainObject(integrity) || !isPlainObject(integrity.sectionHashes)) errors.push('integrity: sectionHashes and contentHash');
  else {
    if (Object.keys(integrity.sectionHashes).sort().join() !== [...HASHED_PARTS].sort().join()) errors.push('integrity.sectionHashes: exactly the identity and every section');
    for (const part of HASHED_PARTS) {
      if (integrity.sectionHashes[part] !== juliusBrainSha256(canonicalJuliusBrainJson(typed[part]))) errors.push(`integrity.sectionHashes.${part}: does not match`);
    }
    if (integrity.contentHash !== juliusBrainSha256(canonicalJuliusBrainJson(body))) errors.push('integrity.contentHash: does not match the export');
  }

  // Internal references must resolve: a history whose edges point nowhere is not trusted.
  const ids = new Map<JuliusArchiveSection, Set<string>>();
  for (const section of JULIUS_ARCHIVE_SECTIONS) {
    const seen = new Set<string>();
    for (const item of typed[section] as readonly Record<string, unknown>[]) {
      const id = String(item[SECTION_SPECS[section].idField]);
      if (seen.has(id)) errors.push(`${section}: duplicate id ${id}`);
      seen.add(id);
    }
    ids.set(section, seen);
  }
  const ref = (section: JuliusArchiveSection, value: string | null, at: string) => {
    if (value !== null && !ids.get(section)!.has(value)) errors.push(`${at}: ${value} is not in ${section}`);
  };
  const refs = (section: JuliusArchiveSection, values: readonly string[] | null, at: string) => { for (const value of values ?? []) ref(section, value, at); };
  typed.tasks.forEach((item, i) => { ref('tasks', item.parentTaskId, `tasks[${i}].parentTaskId`); refs('tasks', item.dependencyIds, `tasks[${i}].dependencyIds`); });
  typed.research.forEach((item, i) => {
    ref('tasks', item.taskId, `research[${i}].taskId`);
    ref('evidence', item.evidenceId, `research[${i}].evidenceId`);
    if (item.disposition !== 'REFUSED' && item.refusalReason !== null) errors.push(`research[${i}].refusalReason: only a REFUSED request has one`);
  });
  typed.evidence.forEach((item, i) => { ref('tasks', item.taskId, `evidence[${i}].taskId`); refs('artifacts', item.artifactRefs, `evidence[${i}].artifactRefs`); });
  typed.findings.forEach((item, i) => { ref('tasks', item.taskId, `findings[${i}].taskId`); refs('evidence', item.evidenceIds, `findings[${i}].evidenceIds`); });
  typed.reviews.forEach((item, i) => { ref('tasks', item.targetTaskId, `reviews[${i}].targetTaskId`); refs('evidence', item.evidenceIds, `reviews[${i}].evidenceIds`); });
  typed.repairs.forEach((item, i) => {
    ref('tasks', item.targetTaskId, `repairs[${i}].targetTaskId`);
    ref('tasks', item.repairTaskId, `repairs[${i}].repairTaskId`);
    refs('findings', item.findingIds, `repairs[${i}].findingIds`);
  });
  typed.usage.forEach((item, i) => {
    ref('tasks', item.taskId, `usage[${i}].taskId`);
    // A reported basis with no amount would be a zero pretending to be a bill.
    if ((item.costBasis === 'PROVIDER_REPORTED' || item.costBasis === 'MEASURED_FROM_USAGE') && item.usdMicros === null) errors.push(`usage[${i}]: ${item.costBasis} requires usdMicros`);
    if (item.costBasis === 'UNKNOWN' && item.usdMicros !== null) errors.push(`usage[${i}]: UNKNOWN basis cannot carry usdMicros`);
  });
  typed.brainEntries.forEach((item, i) => ref('tasks', item.taskId, `brainEntries[${i}].taskId`));
  typed.events.forEach((item, i) => ref('tasks', item.taskId, `events[${i}].taskId`));
  typed.toolInvocations.forEach((item, i) => { ref('tasks', item.taskId, `toolInvocations[${i}].taskId`); refs('artifacts', item.artifactRefs, `toolInvocations[${i}].artifactRefs`); });

  // Credential-shaped content is refused where it is, not discovered later by the planner.
  const scan = (value: unknown, at: string) => {
    const shapes = scanJuliusSecrets(juliusStringsOf(value).join('\n')).shapes;
    if (shapes.length > 0) errors.push(`${at}: credential-shaped content (${shapes.join(', ')})`);
  };
  scan(typed.identity, 'identity');
  scan(typed.source, 'source');
  for (const section of JULIUS_ARCHIVE_SECTIONS) (typed[section] as readonly unknown[]).forEach((item, i) => scan(item, `${section}[${i}]`));
  return errors.length === 0 ? { ok: true } : { ok: false, reasonCode: 'archive_invalid', errors: errors.slice(0, 50) };
}

/** The errors, or [] when the export is valid. */
export function validateJuliusPaidRunArchiveExport(archive: unknown): string[] {
  const check = checkJuliusPaidRunArchiveExport(archive);
  return check.ok ? [] : [...check.errors];
}

/* -------------------------------------------------------------- translation */

export const JULIUS_ARCHIVE_IMPORTER = juliusPrincipal('JULIUS', 'julius:archive-importer');

const safeId = (value: string): string => (/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,120}$/.test(value) ? value : `h-${juliusBrainSha256(value).slice(7, 31)}`);
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);
const joinList = (values: readonly string[] | null): string | null => (values === null ? null : clip(values.join(','), 512));

export const juliusArchiveRunKey = (identity: Pick<JuliusPaidRunArchiveIdentity, 'workflowRunId' | 'workflowRunAttempt'>): string => `${identity.workflowRunId}/${identity.workflowRunAttempt}`;

/**
 * The Brain run id every imported record is scoped to — what a state mode keys
 * on. ALWAYS THE WORKFLOW RUN AND ITS ATTEMPT, NEVER THE JULIUS RUN ID: the
 * Julius run id is derived from the mission contract, so every paid attempt of
 * one contract carries the same one (in the paid-run archive, `run:5408584e…`
 * spans three workflow runs, and task, evidence, finding and v1 Brain entry
 * ids repeat between them). Scoped by it, three attempts would be one run to
 * CONTINUATION, LEARNING and REGRESSION. The Julius run id stays a fact.
 */
export const juliusArchiveBrainRunId = (identity: Pick<JuliusPaidRunArchiveIdentity, 'workflowRunId' | 'workflowRunAttempt'>): string =>
  `workflow:${juliusArchiveRunKey(identity)}`;

export type JuliusArchiveEntitySection = JuliusArchiveSection | 'run' | 'export' | 'accounting' | 'report' | 'researchDelivery';

export const juliusArchiveEntityId = (identity: Pick<JuliusPaidRunArchiveIdentity, 'workflowRunId' | 'workflowRunAttempt'>, section: JuliusArchiveEntitySection, sourceId: string): string =>
  `archive:${juliusArchiveRunKey(identity)}:${section}:${safeId(sourceId)}`;

/**
 * Both evidence vocabularies the runtime writes: the verification runtime's
 * (`JULIUS_EVIDENCE_TYPES`) and the tool layer's (`JuliusToolEvidenceType`).
 * The paid-run archive carries both — `COMMAND_EXECUTION` rows are tool
 * evidence. A type in neither is kept as OBSERVATION with its source type in
 * `data.sourceType`, never guessed into a class.
 */
const EVIDENCE_CLASS: Readonly<Record<string, string>> = {
  TEST: 'TEST_RESULT', COMMAND: 'COMMAND_EXECUTION', BUILD: 'COMMAND_EXECUTION', LINT: 'COMMAND_EXECUTION', TYPECHECK: 'COMMAND_EXECUTION',
  SECURITY_SCAN: 'COMMAND_EXECUTION', TOOL_RECEIPT: 'COMMAND_EXECUTION', REVIEW_FINDING: 'REVIEW', ARTIFACT: 'ARTIFACT_RESULT', DIFF: 'ARTIFACT_RESULT',
  COMMAND_EXECUTION: 'COMMAND_EXECUTION', TEST_RESULT: 'TEST_RESULT', BUILD_RESULT: 'COMMAND_EXECUTION', STATIC_ANALYSIS: 'COMMAND_EXECUTION', FILE_MUTATION: 'ARTIFACT_RESULT',
};
/** Repair outcomes the runtime records; anything else — or nothing — is UNKNOWN, never guessed. */
const REPAIR_STATUS: Readonly<Record<string, string>> = { SCHEDULED: 'REQUESTED', ACTIVE: 'IN_PROGRESS', VERIFIED: 'VERIFIED', FAILED: 'REJECTED', CANCELLED: 'ABANDONED' };
const REPAIR_VERIFICATION: Readonly<Record<string, string>> = { VERIFIED: 'PASSED', FAILED: 'FAILED', SCHEDULED: 'NOT_RUN', ACTIVE: 'NOT_RUN' };

function traceClassFor(eventType: string): string {
  if (/(^|\.)tool\./.test(eventType)) return 'TOOL_INVOCATION';
  if (eventType.includes('recovery.')) return 'RECOVERY';
  if (eventType.includes('fail') || eventType.includes('refused') || eventType.includes('denied')) return 'FAILURE';
  if (/(^|\.)(run|task|contract|checkpoint)\./.test(eventType)) return 'STATE_TRANSITION';
  if (/(^|\.)(worker|subagent)\./.test(eventType)) return 'WORKER_ACTION';
  return 'ACTION';
}

/** At most `limit` scalar facts, in key order; what did not fit is counted, never silent. */
function boundedFacts(facts: Readonly<Record<string, string | number | boolean | null>>, limit = 32): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const keys = Object.keys(facts).sort();
  const room = keys.length > limit ? limit - 1 : limit;
  for (const key of keys.slice(0, room)) {
    const value = facts[key]!;
    out[clip(key, 64)] = typeof value === 'string' ? clip(value, 512) : value;
  }
  if (keys.length > room) out.droppedFacts = keys.length - room;
  return out;
}

/** What already represents a logical fact of this attempt in the Brain, so a planner never records it again. */
export interface JuliusArchiveRepresented {
  /** v1 Brain entry ids already recorded for this attempt (the live mirror's `legacy:` records). */
  readonly entryIds: ReadonlySet<string>;
  /** Verification decisions already recorded for this attempt, by `juliusVerificationDecisionKey`. */
  readonly decisionKeys: ReadonlySet<string>;
}

export interface JuliusArchiveImportPlan {
  readonly runKey: string;
  readonly brainRunId: string;
  readonly anchorEntityId: string;
  readonly drafts: readonly JuliusBrainDraft[];
  readonly counts: Readonly<Partial<Record<JuliusBrainRecordKind, number>>>;
  readonly accounting: { readonly knownUsdMicros: number; readonly knownIsFloor: boolean; readonly estimatedUsdMicros: number | null; readonly unknownComponents: number; readonly components: number };
  /** Logical facts not recorded because something already represents them, by what represents them. */
  readonly represented: { readonly entriesByReview: number; readonly entriesByLiveMirror: number; readonly reviewsByLiveMirror: number };
  /** Field values the export recorded as Unknown, in total. */
  readonly unknownFields: number;
}

/**
 * THE TRANSLATION, PURE. `stored` is where the export's own bytes were put
 * (content-addressed); every record derives from that artifact. `heldArtifacts`
 * maps an artifact id to bytes already verified and stored for it.
 */
export function planJuliusPaidRunArchiveImport(
  archive: JuliusPaidRunArchiveExport,
  stored: { readonly contentHash: string; readonly byteSize: number; readonly storageRef: string },
  options: {
    readonly represented?: JuliusArchiveRepresented;
    readonly heldArtifacts?: ReadonlyMap<string, { readonly storageRef: string; readonly byteSize: number }>;
  } = {},
): JuliusArchiveImportPlan {
  const { identity } = archive;
  const runKey = juliusArchiveRunKey(identity);
  const brainRunId = juliusArchiveBrainRunId(identity);
  const anchorEntityId = juliusArchiveEntityId(identity, 'export', archive.integrity.contentHash.slice(7, 23));
  const represented = options.represented ?? { entryIds: new Set<string>(), decisionKeys: new Set<string>() };
  const drafts: JuliusBrainDraft[] = [];
  const counts: Partial<Record<JuliusBrainRecordKind, number>> = {};
  const unknownCounts = new Map<string, number>();
  const countUnknown = (section: string, item: { readonly unknown: readonly string[] }) => {
    for (const field of item.unknown) unknownCounts.set(`${section}.${field}`, (unknownCounts.get(`${section}.${field}`) ?? 0) + 1);
  };
  countUnknown('identity', identity);

  const provenance = (section: string, sourceId: string, extra: { provider?: string | null; model?: string | null; tool?: string | null; sourceRef?: string | null }) =>
    juliusBrainProvenance('run_observed', {
      commit: identity.acceptedMainSha,
      externalRef: clip(`${JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX}${runKey}#${section}/${sourceId}${extra.sourceRef ? `|source=${extra.sourceRef}` : ''}`, 2_048),
      provider: extra.provider ?? null, model: extra.model ?? null, tool: extra.tool ?? null,
    });
  const add = (kind: JuliusBrainRecordKind, section: JuliusArchiveEntitySection, sourceId: string, body: JuliusBrainBody, entry: {
    taskId?: string | null; links?: readonly JuliusBrainLink[]; occurredAt: string | null; provider?: string | null; model?: string | null;
    tool?: string | null; sourceRef?: string | null; entityId?: string;
  }) => {
    const entityId = entry.entityId ?? juliusArchiveEntityId(identity, section, sourceId);
    const fromExport = entityId === anchorEntityId ? [] : [{ relation: 'DERIVED_FROM' as const, target: anchorEntityId, targetVersion: null }];
    drafts.push({
      kind, op: 'CREATE', entityId, expectedVersion: 0, body,
      links: [...(entry.links ?? []), ...fromExport],
      scope: { missionId: identity.missionId, runId: brainRunId, taskId: entry.taskId ?? null },
      retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
      provenance: provenance(section, sourceId, entry),
      idempotencyKey: `archive:${runKey}:${section}:${safeId(sourceId)}`,
      occurredAt: entry.occurredAt,
    });
    counts[kind] = (counts[kind] ?? 0) + 1;
    return entityId;
  };
  const link = (relation: JuliusBrainLink['relation'], section: JuliusArchiveSection, sourceId: string): JuliusBrainLink => ({ relation, target: juliusArchiveEntityId(identity, section, sourceId), targetVersion: null });
  const runOccurredAt = identity.endedAt ?? identity.startedAt;
  const decisionKeyOf = (item: JuliusArchiveReview) => (item.targetTaskId !== null && item.reasonCode !== null ? juliusVerificationDecisionKey(item.targetTaskId, item.verdict, item.reasonCode) : null);

  // The export's own bytes: the anchor every record derives from.
  add('ARTIFACT', 'export', archive.integrity.contentHash.slice(7, 23), {
    artifactClass: 'REPORT', name: `paid-run-archive-${runKey.replace('/', '-attempt-')}.json`, contentType: 'application/json',
    byteSize: stored.byteSize, contentHash: stored.contentHash, storageRef: stored.storageRef, commit: identity.acceptedMainSha,
  }, { entityId: anchorEntityId, occurredAt: archive.exportedAt });

  add('TRACE', 'run', runKey, {
    traceClass: 'LIFECYCLE',
    summary: clip(`Archived paid run ${runKey} of ${identity.missionId}${identity.classification ? ` (${identity.classification})` : ''}, ${identity.stateMode}, ended ${identity.outcome}${identity.outcomeReason ? `: ${identity.outcomeReason}` : ''}`, 8_000),
    facts: boundedFacts({
      workflowRunId: identity.workflowRunId, workflowRunAttempt: identity.workflowRunAttempt, repository: identity.repository,
      juliusRunId: identity.juliusRunId, missionId: identity.missionId, missionLabel: identity.missionLabel, campaignId: identity.campaignId,
      projectId: identity.projectId, classification: identity.classification, acceptedMainSha: identity.acceptedMainSha,
      stateMode: identity.stateMode, stateModeBasis: identity.stateModeBasis, outcome: identity.outcome, outcomeReason: identity.outcomeReason,
      startedAt: identity.startedAt, endedAt: identity.endedAt, archiveId: archive.source.archiveId,
      archiveSchemaVersion: archive.source.archiveSchemaVersion, exporterVersion: archive.source.exporterVersion,
      archiveContentHash: archive.integrity.contentHash, importer: JULIUS_ARCHIVE_IMPORTER_VERSION, unknown: joinList(identity.unknown),
    }),
  }, { occurredAt: runOccurredAt });

  const heldArtifacts = options.heldArtifacts ?? new Map<string, { storageRef: string; byteSize: number }>();
  for (const item of archive.artifacts) {
    countUnknown('artifacts', item);
    const held = heldArtifacts.get(item.artifactId);
    add('ARTIFACT', 'artifacts', item.artifactId, {
      artifactClass: 'GENERATED_FILE',
      // The archive's own handle when no name was recorded; octet-stream is the registered type for "not known".
      name: clip(item.name ?? item.artifactId, 512), contentType: item.contentType ?? 'application/octet-stream',
      byteSize: held?.byteSize ?? item.byteSize, contentHash: item.contentHash,
      // A reference, not bytes this Brain holds, unless verified bytes were supplied: it resolves as UNSUPPORTED_REF, which is the truth.
      storageRef: clip(held?.storageRef ?? item.storageRef ?? `archive-ref:${runKey}/${item.artifactId}`, 2_048), commit: identity.acceptedMainSha,
    }, { occurredAt: archive.exportedAt });
  }

  for (const item of archive.tasks) {
    countUnknown('tasks', item);
    add('TRACE', 'tasks', item.taskId, {
      traceClass: 'WORKER_ACTION', summary: clip(`${item.taskType}${item.role ? ` (${item.role})` : ''} ended ${item.state}`, 8_000),
      facts: boundedFacts({
        taskId: item.taskId, taskType: item.taskType, role: item.role, workerId: item.workerId, state: item.state, ordinal: item.ordinal,
        parentTaskId: item.parentTaskId, dependencyIds: joinList(item.dependencyIds), unknown: joinList(item.unknown),
      }),
    }, { taskId: item.taskId, occurredAt: null });
  }

  for (const item of archive.evidence) {
    countUnknown('evidence', item);
    add('EVIDENCE', 'evidence', item.evidenceId, {
      evidenceClass: EVIDENCE_CLASS[item.evidenceType] ?? 'OBSERVATION',
      claim: clip(`${item.evidenceType} evidence${item.taskId ? ` for ${item.taskId}` : ''}`, 8_000),
      summary: clip(item.safeSummary ?? 'Unknown — the archive recorded no summary.', 8_000),
      status: item.status,
      // The archive recorded it; nothing here re-verified it, whatever the source claimed.
      verification: 'UNVERIFIED',
      data: {
        sourceType: item.evidenceType, sourceVerification: item.sourceVerification, artifactRefs: item.artifactRefs === null ? null : [...item.artifactRefs],
        integrityHash: item.integrityHash, sourceEvidenceId: item.evidenceId, unknown: [...item.unknown],
      },
      juliusEvidenceId: clip(item.evidenceId, 256),
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: (item.artifactRefs ?? []).map((ref) => link('DERIVED_FROM', 'artifacts', ref)) });
  }

  let reviewsByLiveMirror = 0;
  for (const item of archive.reviews) {
    countUnknown('reviews', item);
    const key = decisionKeyOf(item);
    if (key !== null && represented.decisionKeys.has(key)) { reviewsByLiveMirror += 1; continue; }
    add('DECISION', 'reviews', item.reviewId, {
      decisionClass: 'VERIFICATION',
      statement: clip(`${item.verdict}${item.reasonCode ? ` (${item.reasonCode})` : ''}${item.targetTaskId ? ` on ${item.targetTaskId}` : ''}${item.reviewer ? `, by ${item.reviewer}` : ''}`, 8_000),
      rationale: clip(item.rationale ?? 'Unknown — the archive recorded no rationale.', 8_000), alternatives: [], status: 'ACTIVE',
    }, { taskId: item.targetTaskId, occurredAt: item.occurredAt, sourceRef: item.sourceRef, links: (item.evidenceIds ?? []).map((id) => link('EVIDENCED_BY', 'evidence', id)) });
  }

  for (const item of archive.findings) {
    countUnknown('findings', item);
    add('FINDING', 'findings', item.findingId, {
      findingClass: 'REVIEWER_FINDING', severity: item.severity ?? 'UNKNOWN',
      statement: clip(item.rationale === null ? item.claim : `${item.claim}\n\nRationale: ${item.rationale}`, 8_000),
      blocking: item.blocking, status: item.status, juliusFindingId: clip(item.findingId, 256),
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: (item.evidenceIds ?? []).map((id) => link('EVIDENCED_BY', 'evidence', id)) });
  }

  for (const item of archive.repairs) {
    countUnknown('repairs', item);
    add('REPAIR', 'repairs', item.repairId, {
      reason: clip(item.reason ?? `Repair${item.round === null ? '' : ` round ${item.round}`} of ${item.targetTaskId}; the archive recorded no reason`, 8_000),
      status: (item.outcome === null ? undefined : REPAIR_STATUS[item.outcome]) ?? 'UNKNOWN',
      implementation: item.repairTaskId === null ? null : `repair task ${item.repairTaskId}`,
      verification: (item.outcome === null ? undefined : REPAIR_VERIFICATION[item.outcome]) ?? 'UNKNOWN',
      reviewerDisposition: null, resultingState: item.outcome === null ? null : clip(`archived outcome ${item.outcome}`, 8_000), juliusRepairId: clip(item.repairId, 256),
    }, { taskId: item.targetTaskId, occurredAt: item.occurredAt, links: (item.findingIds ?? []).map((id) => link('REPAIRS', 'findings', id)) });
  }

  for (const item of archive.research) {
    countUnknown('research', item);
    const research = add('RESEARCH', 'research', item.requestKey, {
      question: clip(item.purpose ?? `Research request ${item.requestKey} (${item.role})`, 8_000),
      findings: [],
      sources: item.host === null ? [] : [{ sourceKind: 'URL', reference: clip(`${item.host}${item.path ?? ''}`, 2_048), retrievedAt: item.disposition === 'SERVED' ? item.occurredAt : null }],
      contradictions: [],
      unresolved: item.disposition === 'SERVED' ? [] : [clip(item.disposition === 'REFUSED' ? `refused: ${item.refusalReason ?? 'reason Unknown'}` : 'whether it was served is Unknown', 8_000)],
      status: 'CONCLUDED',
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: item.evidenceId === null ? [] : [link('EVIDENCED_BY', 'evidence', item.evidenceId)] });
    // What was delivered has no place in a RESEARCH body; it is kept beside it, not dropped.
    add('TRACE', 'researchDelivery', item.requestKey, {
      traceClass: 'ACTION', summary: clip(`research ${item.requestKey} ${item.disposition}`, 8_000),
      facts: boundedFacts({
        requestKey: item.requestKey, attemptKey: item.attemptKey, ordinal: item.ordinal, role: item.role, host: item.host, path: item.path,
        bytes: item.bytes, digest: item.digest, rangeStart: item.deliveryRange?.start ?? null, rangeEnd: item.deliveryRange?.end ?? null,
        handoffRef: item.handoffRef, disposition: item.disposition, refusalReason: item.refusalReason, unknown: joinList(item.unknown),
      }),
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: [{ relation: 'RELATES_TO', target: research, targetVersion: null }] });
  }

  let knownUsdMicros = 0;
  let estimatedUsdMicros: number | null = null;
  let unknownComponents = 0;
  const unknownText = (value: number | null) => (value === null ? 'Unknown' : String(value));
  for (const item of archive.usage) {
    countUnknown('usage', item);
    const known = item.costBasis === 'PROVIDER_REPORTED' || item.costBasis === 'MEASURED_FROM_USAGE';
    if (known) knownUsdMicros += item.usdMicros ?? 0;
    else unknownComponents += item.costBasis === 'UNKNOWN' ? 1 : 0;
    if (item.estimatedUsdMicros !== null) estimatedUsdMicros = (estimatedUsdMicros ?? 0) + item.estimatedUsdMicros;
    add('EVIDENCE', 'usage', item.componentId, {
      evidenceClass: 'MEASUREMENT', claim: clip(`spend of ${item.role}${item.taskId ? ` on ${item.taskId}` : ''}`, 8_000),
      summary: clip(`${item.costBasis}: ${item.usdMicros === null ? 'amount Unknown' : `${item.usdMicros} µ$`}; requests ${unknownText(item.requests)}; tokens ${unknownText(item.inputTokens)} in / ${unknownText(item.outputTokens)} out`, 8_000),
      status: known ? 'PASSED' : 'INCONCLUSIVE', verification: 'UNVERIFIED',
      data: {
        role: item.role, provider: item.provider, model: item.model, requests: item.requests, inputTokens: item.inputTokens, outputTokens: item.outputTokens,
        usdMicros: item.usdMicros, costBasis: item.costBasis, estimatedUsdMicros: item.estimatedUsdMicros, unknown: [...item.unknown],
      },
      juliusEvidenceId: null,
    }, { taskId: item.taskId, occurredAt: item.occurredAt, provider: item.provider, model: item.model });
  }
  const accounting = { knownUsdMicros, knownIsFloor: unknownComponents > 0, estimatedUsdMicros, unknownComponents, components: archive.usage.length };
  add('EVIDENCE', 'accounting', runKey, {
    evidenceClass: 'MEASUREMENT', claim: `what paid run ${runKey} cost`,
    summary: `known ${knownUsdMicros} µ$${unknownComponents > 0 ? ` (a floor: ${unknownComponents} component(s) reported no amount)` : ''}; estimated ${estimatedUsdMicros ?? 'none'} µ$, never added to the known total`,
    status: unknownComponents > 0 ? 'INCONCLUSIVE' : 'PASSED', verification: 'UNVERIFIED', data: accounting, juliusEvidenceId: null,
  }, { occurredAt: runOccurredAt, links: archive.usage.slice(0, 63).map((item) => link('DERIVED_FROM', 'usage', item.componentId)) });

  const reviewDecisionKeys = new Set(archive.reviews.flatMap((item) => { const key = decisionKeyOf(item); return key === null ? [] : [key]; }));
  let entriesByReview = 0;
  let entriesByLiveMirror = 0;
  for (const item of archive.brainEntries) {
    countUnknown('brainEntries', item);
    if (represented.entryIds.has(item.entryId)) { entriesByLiveMirror += 1; continue; }
    const decision = parseJuliusV1DecisionEntryId(item.entryId);
    const decisionKey = decision === null ? null : juliusVerificationDecisionKey(decision.taskId, decision.action, decision.reasonCode);
    if (decisionKey !== null && (reviewDecisionKeys.has(decisionKey) || represented.decisionKeys.has(decisionKey))) {
      if (reviewDecisionKeys.has(decisionKey)) entriesByReview += 1; else entriesByLiveMirror += 1;
      continue;
    }
    add('TRACE', 'brainEntries', item.entryId, {
      traceClass: 'ACTION', summary: clip(`v1 Brain entry ${item.entryId} (${item.kind}) was written; its content is not archived`, 8_000),
      facts: boundedFacts({ entryId: item.entryId, kind: item.kind, workerId: item.workerId, taskId: item.taskId, revision: item.revision, unknown: joinList(item.unknown) }),
    }, { taskId: item.taskId, occurredAt: item.occurredAt });
  }

  for (const item of archive.events) {
    countUnknown('events', item);
    add('TRACE', 'events', item.eventId, {
      traceClass: traceClassFor(item.eventType), summary: clip(item.eventType, 8_000),
      facts: boundedFacts({ ...boundedFacts(item.facts, 29), eventType: item.eventType, sequence: item.sequence, unknown: joinList(item.unknown) }),
    }, { taskId: item.taskId, occurredAt: item.occurredAt });
  }

  for (const item of archive.toolInvocations) {
    countUnknown('toolInvocations', item);
    add('TRACE', 'toolInvocations', item.invocationId, {
      traceClass: 'TOOL_INVOCATION', summary: clip(`${item.toolId} ${item.state}${item.result ? `: ${item.result}` : ''}`, 8_000),
      facts: boundedFacts({
        invocationId: item.invocationId, toolId: item.toolId, executionType: item.executionType, state: item.state, result: item.result,
        requestedAt: item.requestedAt, completedAt: item.completedAt, artifactRefs: joinList(item.artifactRefs), unknown: joinList(item.unknown),
      }),
    }, { taskId: item.taskId, occurredAt: item.requestedAt, tool: item.toolId, links: (item.artifactRefs ?? []).map((ref) => link('DERIVED_FROM', 'artifacts', ref)) });
  }

  // What the export did not record, counted by field, in full: Unknown stays visible, never averaged away.
  // A measurement rather than a trace, because a trace's facts are bounded and this breakdown must not be.
  const unknownFields = [...unknownCounts.values()].reduce((sum, value) => sum + value, 0);
  const representedTotal = entriesByReview + entriesByLiveMirror + reviewsByLiveMirror;
  add('EVIDENCE', 'report', runKey, {
    evidenceClass: 'MEASUREMENT', claim: `what the export of ${runKey} did not record, and what was already represented`,
    summary: clip(`${drafts.length + 1} records; ${unknownFields} field value(s) Unknown in the export; ${representedTotal} logical fact(s) already represented`, 8_000),
    status: unknownFields > 0 ? 'INCONCLUSIVE' : 'PASSED', verification: 'UNVERIFIED',
    data: {
      unknownByField: Object.fromEntries([...unknownCounts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      unknownFields, represented: { entriesByReview, entriesByLiveMirror, reviewsByLiveMirror },
    },
    juliusEvidenceId: null,
  }, { occurredAt: archive.exportedAt });

  return { runKey, brainRunId, anchorEntityId, drafts, counts, accounting, represented: { entriesByReview, entriesByLiveMirror, reviewsByLiveMirror }, unknownFields };
}

/* ------------------------------------------------------------------ import */

export interface JuliusArchiveContentPort {
  put(content: Uint8Array): Promise<{ readonly contentHash: string; readonly byteSize: number; readonly storageRef: string }>;
}

export type JuliusArchiveReconciliationMode = 'RECONSTRUCTED' | 'RECONCILED';

export type JuliusArchiveImportResult =
  | {
    readonly outcome: 'IMPORTED' | 'ALREADY_IMPORTED';
    readonly runKey: string; readonly brainRunId: string; readonly archiveContentHash: string; readonly anchorEntityId: string;
    readonly appended: number; readonly duplicates: number;
    readonly counts: JuliusArchiveImportPlan['counts']; readonly accounting: JuliusArchiveImportPlan['accounting'];
    readonly represented: JuliusArchiveImportPlan['represented']; readonly unknownFields: number;
    readonly reconciliation: { readonly mode: JuliusArchiveReconciliationMode; readonly preservationBefore: JuliusBrainPreservationStatus; readonly recoveryEntityId: string } | null;
  }
  | { readonly outcome: 'REJECTED'; readonly reasonCode: 'archive_invalid' | 'unsupported_export_version' | 'not_an_archive_export' | 'artifact_bytes_mismatch' | 'identity_mismatch'; readonly errors: readonly string[] }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: 'attempt_already_preserved' | 'conflicting_history'; readonly detail: string; readonly conflicts: readonly string[]; readonly preservation: JuliusBrainRunPreservation }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string; readonly detail: string; readonly group: number; readonly index: number };

const LEGACY_REF = /^julius_brain_entries:[^#]*#(.+)$/;

/** What the live mirror recorded for this attempt, as the planner's `represented` sets, with the entities behind them. */
export function juliusArchiveLiveRepresentation(entities: readonly JuliusBrainEntityState[], brainRunId: string): JuliusArchiveRepresented & { readonly byEntryId: ReadonlyMap<string, JuliusBrainEntityState> } {
  const byEntryId = new Map<string, JuliusBrainEntityState>();
  const decisionKeys = new Set<string>();
  for (const state of entities) {
    if (state.scope.runId !== brainRunId || !state.entityId.startsWith(`legacy:${brainRunId}:`) || state.createdBy.kind !== 'JULIUS') continue;
    const entryId = LEGACY_REF.exec(state.provenance.externalRef ?? '')?.[1];
    if (entryId === undefined) continue;
    byEntryId.set(entryId, state);
    const decision = parseJuliusV1DecisionEntryId(entryId);
    if (decision !== null) decisionKeys.add(juliusVerificationDecisionKey(decision.taskId, decision.action, decision.reasonCode));
  }
  return { entryIds: new Set(byEntryId.keys()), decisionKeys, byEntryId };
}

/** Where the export contradicts what the live run recorded about the same attempt. Empty when it does not. */
export function juliusArchiveHistoryConflicts(archive: JuliusPaidRunArchiveExport, preservation: JuliusBrainRunPreservation, live: ReturnType<typeof juliusArchiveLiveRepresentation>): string[] {
  const conflicts: string[] = [];
  const { identity } = archive;
  const opened = preservation.evidence.opened;
  if (opened !== null) {
    if (opened.missionId !== null && opened.missionId !== identity.missionId) conflicts.push(`the live run opened for mission ${opened.missionId}; the export is for ${identity.missionId}`);
    if (opened.juliusRunId !== null && identity.juliusRunId !== null && opened.juliusRunId !== identity.juliusRunId) conflicts.push(`the live run was Julius run ${opened.juliusRunId}; the export says ${identity.juliusRunId}`);
    if (opened.acceptedMainSha !== null && opened.acceptedMainSha !== identity.acceptedMainSha) conflicts.push(`the live run executed ${opened.acceptedMainSha}; the export says ${identity.acceptedMainSha}`);
  }
  const listed = new Set(archive.brainEntries.map((item) => item.entryId));
  const unlisted = [...live.entryIds].filter((entryId) => !listed.has(entryId)).sort();
  if (unlisted.length > 0) conflicts.push(`the live run holds v1 entr${unlisted.length === 1 ? 'y' : 'ies'} the export does not list: ${unlisted.slice(0, 8).join(', ')}`);
  const sealed = preservation.evidence.sealed;
  if (sealed !== null && sealed.expectedEntries !== archive.brainEntries.length) conflicts.push(`the live run sealed ${sealed.expectedEntries} v1 entries; the export lists ${archive.brainEntries.length}`);
  return conflicts;
}

const GROUP_SIZE = 400;
const sha256OfBytes = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * Verify supplied artifact bytes against their recorded digest and store them.
 * Bytes are optional — an archive may hold only references — but bytes that
 * are supplied and do not match are refused, never stored beside the claim.
 */
export async function holdJuliusArchiveArtifacts(
  archive: JuliusPaidRunArchiveExport,
  content: JuliusArchiveContentPort,
  bytesFor: ((artifactId: string) => Uint8Array | null) | undefined,
): Promise<{ readonly ok: true; readonly held: ReadonlyMap<string, { readonly storageRef: string; readonly byteSize: number }> } | { readonly ok: false; readonly errors: readonly string[] }> {
  const held = new Map<string, { storageRef: string; byteSize: number }>();
  if (bytesFor === undefined) return { ok: true, held };
  const errors: string[] = [];
  const verified: { artifactId: string; bytes: Uint8Array }[] = [];
  archive.artifacts.forEach((item, i) => {
    const bytes = bytesFor(item.artifactId);
    if (bytes === null) return;
    const digest = sha256OfBytes(bytes);
    if (digest !== item.contentHash) errors.push(`artifacts[${i}]: the supplied bytes hash to ${digest}, not ${item.contentHash}`);
    else if (item.byteSize !== null && item.byteSize !== bytes.byteLength) errors.push(`artifacts[${i}]: the supplied bytes are ${bytes.byteLength} bytes, not ${item.byteSize}`);
    else verified.push({ artifactId: item.artifactId, bytes });
  });
  if (errors.length > 0) return { ok: false, errors };
  for (const item of verified) {
    const stored = await content.put(item.bytes);
    held.set(item.artifactId, { storageRef: stored.storageRef, byteSize: stored.byteSize });
  }
  return { ok: true, held };
}

export async function importJuliusPaidRunArchive(input: {
  readonly store: JuliusBrainStore;
  readonly brainId: string;
  readonly projectId: string;
  readonly archive: JuliusPaidRunArchiveExport;
  readonly content: JuliusArchiveContentPort;
  readonly recordedAt: string;
  readonly importer?: JuliusBrainPrincipal;
  /** Bytes held for an artifact id, when the archive has them; verified before anything is written. */
  readonly artifactBytes?: (artifactId: string) => Uint8Array | null;
}): Promise<JuliusArchiveImportResult> {
  const check = checkJuliusPaidRunArchiveExport(input.archive);
  if (!check.ok) return { outcome: 'REJECTED', reasonCode: check.reasonCode, errors: check.errors };
  const importer = input.importer ?? JULIUS_ARCHIVE_IMPORTER;
  if (importer.kind !== 'JULIUS') return { outcome: 'REJECTED', reasonCode: 'archive_invalid', errors: ['importer: archived history enters the Brain only under Julius'] };
  const { archive } = input;
  if (archive.identity.projectId !== input.projectId) {
    return { outcome: 'REJECTED', reasonCode: 'identity_mismatch', errors: [`identity.projectId: the export is for ${archive.identity.projectId}, not ${input.projectId}`] };
  }

  // What the Brain already holds of this attempt decides what may be added — before a single byte is stored.
  const brainRunId = juliusArchiveBrainRunId(archive.identity);
  for (let attempt = 1; ; attempt += 1) {
    const records = await readAllJuliusBrainRecords(input.store, input.brainId, input.projectId);
    const entities = await readAllJuliusBrainEntities(input.store, input.brainId, input.projectId);
    const preservation = deriveJuliusBrainRunPreservation({ brainId: input.brainId, brainRunId, records, entities });
    if (preservation.status === 'PRESERVED') {
      return { outcome: 'REFUSED', reasonCode: 'attempt_already_preserved', detail: `${brainRunId} was preserved by the live run; an archive copy would record it twice`, conflicts: [], preservation };
    }
    const live = juliusArchiveLiveRepresentation(entities, brainRunId);
    const conflicts = juliusArchiveHistoryConflicts(archive, preservation, live);
    if (conflicts.length > 0) {
      return { outcome: 'REFUSED', reasonCode: 'conflicting_history', detail: `the export is not the history the live run recorded for ${brainRunId}`, conflicts, preservation };
    }
    const mode: JuliusArchiveReconciliationMode = preservation.status === 'PARTIALLY_PRESERVED' ? 'RECONCILED' : 'RECONSTRUCTED';

    const held = await holdJuliusArchiveArtifacts(archive, input.content, input.artifactBytes);
    if (!held.ok) return { outcome: 'REJECTED', reasonCode: 'artifact_bytes_mismatch', errors: held.errors };
    const stored = await input.content.put(new TextEncoder().encode(canonicalJuliusBrainJson(archive)));
    const plan = planJuliusPaidRunArchiveImport(archive, stored, { represented: live, heldArtifacts: held.held });

    // The recovery itself is a record: what was done, on what basis, relying on which live records.
    const recoveryEntityId = juliusArchiveRecoveryEntityId(brainRunId, archive.integrity.contentHash);
    const reliedOn = [...live.byEntryId.values()].map((state) => state.entityId).sort().slice(0, 48);
    const openedId = juliusRunOpenedEntityId(brainRunId);
    const recovery: JuliusBrainDraft = {
      kind: 'TRACE', op: 'CREATE', entityId: recoveryEntityId, expectedVersion: 0,
      body: {
        traceClass: 'RECOVERY',
        summary: clip(`${mode === 'RECONCILED' ? 'Reconciled' : 'Reconstructed'} ${brainRunId} from the paid-run archive: ${plan.drafts.length} record(s) added, ${plan.represented.entriesByLiveMirror + plan.represented.reviewsByLiveMirror} fact(s) already held by the live run`, 8_000),
        facts: {
          mode, preservationBefore: preservation.status, brainRunId, archiveContentHash: archive.integrity.contentHash,
          archiveSchemaVersion: clip(archive.source.archiveSchemaVersion, 512), added: plan.drafts.length, liveRecordsBefore: preservation.evidence.liveRecords,
          representedEntriesByLiveMirror: plan.represented.entriesByLiveMirror, representedReviewsByLiveMirror: plan.represented.reviewsByLiveMirror,
          representedEntriesByReview: plan.represented.entriesByReview, importer: JULIUS_ARCHIVE_IMPORTER_VERSION,
        },
      },
      links: [
        { relation: 'DERIVED_FROM', target: plan.anchorEntityId, targetVersion: null },
        ...(entities.some((state) => state.entityId === openedId) ? [{ relation: 'RELATES_TO' as const, target: openedId, targetVersion: null }] : []),
        ...reliedOn.map((target) => ({ relation: 'RELATES_TO' as const, target, targetVersion: null })),
      ],
      scope: { missionId: archive.identity.missionId, runId: brainRunId, taskId: null },
      retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
      provenance: juliusBrainProvenance('run_observed', { commit: archive.identity.acceptedMainSha, externalRef: `${JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX}${plan.runKey}#recovery` }),
      idempotencyKey: recoveryEntityId,
      occurredAt: null,
    };
    const result = await commitJuliusArchivePlan({
      store: input.store, brainId: input.brainId, projectId: input.projectId, recordedAt: input.recordedAt, principal: importer,
      plan, archiveContentHash: archive.integrity.contentHash, extraDrafts: [recovery],
      // Only if this attempt still holds exactly what the reconciliation was planned from.
      runGuard: { runId: brainRunId, recordCount: records.filter((record) => record.scope.runId === brainRunId).length },
    });
    // The attempt changed between the read and the commit: plan again from what it holds now, once.
    if (result.outcome === 'REFUSED' && result.reasonCode === 'run_changed' && attempt < 2) continue;
    return result.outcome === 'IMPORTED' || result.outcome === 'ALREADY_IMPORTED'
      ? { ...result, reconciliation: { mode, preservationBefore: preservation.status, recoveryEntityId } }
      : result;
  }
}

/** One atomic commit of a plan (and any extra drafts that must land with it). */
export async function commitJuliusArchivePlan(input: {
  readonly store: JuliusBrainStore; readonly brainId: string; readonly projectId: string; readonly recordedAt: string;
  readonly principal: JuliusBrainPrincipal; readonly plan: JuliusArchiveImportPlan; readonly archiveContentHash: string;
  readonly extraDrafts?: readonly JuliusBrainDraft[];
  readonly runGuard?: { readonly runId: string; readonly recordCount: number };
}): Promise<JuliusArchiveImportResult> {
  const { plan } = input;
  const all = [...plan.drafts, ...(input.extraDrafts ?? [])];
  const groups: JuliusBrainCommitGroup[] = [];
  for (let start = 0; start < all.length; start += GROUP_SIZE) groups.push({ principal: input.principal, grant: null, drafts: all.slice(start, start + GROUP_SIZE) });
  // ONE commit, many groups: the whole run arrives or none of it does.
  const result = await input.store.commitGroup({ brainId: input.brainId, projectId: input.projectId, recordedAt: input.recordedAt, groups, runGuard: input.runGuard });
  if (result.outcome === 'REFUSED') return { outcome: 'REFUSED', reasonCode: result.reasonCode, detail: result.detail, group: result.group, index: result.index };
  const receipts: JuliusBrainReceipt[] = result.receipts.flat();
  const appended = receipts.filter((receipt) => receipt.outcome === 'APPENDED').length;
  return {
    outcome: appended === 0 ? 'ALREADY_IMPORTED' : 'IMPORTED',
    runKey: plan.runKey, brainRunId: plan.brainRunId, archiveContentHash: input.archiveContentHash, anchorEntityId: plan.anchorEntityId,
    appended, duplicates: receipts.length - appended, counts: plan.counts, accounting: plan.accounting, represented: plan.represented, unknownFields: plan.unknownFields,
    reconciliation: null,
  };
}
