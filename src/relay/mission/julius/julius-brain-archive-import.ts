import {
  canonicalJuliusBrainJson,
  isJuliusBrainId,
  juliusBrainProvenance,
  juliusBrainSha256,
  juliusPrincipal,
  type JuliusBrainBody,
  type JuliusBrainDraft,
  type JuliusBrainJson,
  type JuliusBrainLink,
  type JuliusBrainPrincipal,
  type JuliusBrainRecordKind,
} from './julius-brain-contracts';
import type { JuliusBrainCommitGroup, JuliusBrainReceipt } from './julius-brain-projection';
import { juliusStringsOf, scanJuliusSecrets } from './julius-brain-secrets';
import { JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX, JULIUS_BRAIN_STATE_MODES, type JuliusBrainStateMode } from './julius-brain-state-modes';
import type { JuliusBrainStore } from './julius-brain-store';

/**
 * THE PAID-RUN ARCHIVE → PROJECT BRAIN IMPORT BOUNDARY.
 *
 * Formal Julius keeps a TEMPORARY archive of real paid runs so their history is
 * not lost before Project Brain can hold it. That archive's schema is not the
 * Brain's, and must never become it. So there are two contracts and a
 * translation between them, and nothing else crosses:
 *
 *   SOURCE   `julius-paid-run-archive-export.v1` — the SAFE, SELF-HASHED export
 *            the archive produces for one workflow run attempt. Owned by this
 *            file, versioned, and deliberately shaped after what the live
 *            evidence bundle already records (runs, tasks, evidence, decisions,
 *            findings, repairs, research, per-role usage with cost basis,
 *            timeline and tool events, artifact references). The archive's own
 *            table layout is never read, only `archiveSchemaVersion` is kept.
 *   TARGET   canonical Brain records, written by Julius under the ordinary
 *            planner and policy.
 *
 * WHAT THE TRANSLATION GUARANTEES
 *   - Validated before anything is written: format, identity, internal
 *     references, every section hash and the export hash (tamper-evident), and
 *     credential-shaped content — refused with its location, never redacted in.
 *   - One atomic commit: an import writes every record or none.
 *   - Idempotent: keys and entity ids derive from workflow run, attempt, section
 *     and source id, so re-importing the same export writes nothing; the same
 *     key with different content is a conflict, not an overwrite. Attempts are
 *     distinct runs.
 *   - Provenance on every record: accepted main SHA as `commit`, the archive
 *     coordinates as `externalRef`, provider and model where the source had
 *     them, and a DERIVED_FROM link to the stored export itself, whose bytes are
 *     content-addressed so any record can be traced back to exactly what arrived.
 *   - Unknown stays unknown: a cost with no reported amount is null with basis
 *     UNKNOWN; an estimate is never counted as a charge; the known total is
 *     marked a floor while any component is unknown.
 *   - Every imported record carries the archived run's `runId`, so a state mode
 *     (`julius-brain-state-modes.ts`) decides whether a later run may draw on
 *     it. Retention is not retrieval authority.
 */

export const JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT = 'julius-paid-run-archive-export.v1' as const;
export const JULIUS_ARCHIVE_IMPORTER_VERSION = 'julius-brain-archive-import.v1' as const;

/* ---------------------------------------------------------- source contract */

export type JuliusArchiveCostBasis = 'PROVIDER_REPORTED' | 'MEASURED_FROM_USAGE' | 'ESTIMATED' | 'UNKNOWN';

export interface JuliusPaidRunArchiveRun {
  readonly workflowRunId: string;
  readonly workflowRunAttempt: number;
  /** 40-hex commit the run executed against. */
  readonly acceptedMainSha: string;
  readonly missionId: string;
  readonly campaignId: string | null;
  /** The Julius run id inside the run; null when the archive does not have one. */
  readonly juliusRunId: string | null;
  readonly projectId: string;
  readonly stateMode: JuliusBrainStateMode;
  /** QUALIFICATION, LAB_EVAL, REGRESSION, … — carried verbatim. */
  readonly classification: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  readonly outcomeReason: string | null;
}

export interface JuliusPaidRunArchiveExportBody {
  readonly format: typeof JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT;
  readonly exportedAt: string;
  readonly archive: { readonly archiveId: string; readonly archiveSchemaVersion: string };
  readonly run: JuliusPaidRunArchiveRun;
  readonly tasks: readonly { readonly taskId: string; readonly taskType: string; readonly role: string; readonly state: string; readonly ordinal: number; readonly parentTaskId: string | null }[];
  readonly evidence: readonly { readonly evidenceId: string; readonly taskId: string | null; readonly evidenceType: string; readonly status: 'PASSED' | 'FAILED' | 'INCONCLUSIVE'; readonly safeSummary: string; readonly occurredAt: string; readonly artifactRef: string | null; readonly integrityHash: string | null }[];
  readonly reviews: readonly { readonly reviewId: string; readonly taskId: string; readonly action: string; readonly reasonCode: string; readonly safeSummary: string | null; readonly evidenceIds: readonly string[]; readonly occurredAt: string }[];
  readonly findings: readonly { readonly findingId: string; readonly taskId: string | null; readonly severity: string | null; readonly blocking: boolean; readonly status: 'OPEN' | 'RESOLVED' | 'DISMISSED'; readonly claim: string; readonly evidenceIds: readonly string[]; readonly occurredAt: string }[];
  readonly repairs: readonly { readonly repairId: string; readonly originalTaskId: string; readonly repairTaskId: string | null; readonly round: number; readonly findingIds: readonly string[]; readonly state: string; readonly occurredAt: string }[];
  readonly research: readonly { readonly requestKey: string; readonly taskId: string | null; readonly role: string; readonly outcome: string; readonly reference: string | null; readonly purpose: string | null; readonly evidenceId: string | null; readonly occurredAt: string }[];
  readonly usage: readonly { readonly componentId: string; readonly taskId: string | null; readonly role: string; readonly provider: string | null; readonly model: string | null; readonly inputTokens: number | null; readonly outputTokens: number | null; readonly usdMicros: number | null; readonly costBasis: JuliusArchiveCostBasis; readonly estimatedUsdMicros: number | null; readonly occurredAt: string }[];
  readonly events: readonly { readonly sequence: number; readonly eventType: string; readonly taskId: string | null; readonly occurredAt: string; readonly facts: Readonly<Record<string, JuliusBrainJson>> }[];
  readonly toolInvocations: readonly { readonly invocationId: string; readonly taskId: string | null; readonly toolId: string; readonly state: string; readonly requestedAt: string; readonly completedAt: string | null }[];
  readonly artifacts: readonly { readonly artifactId: string; readonly name: string; readonly contentType: string | null; readonly byteSize: number | null; readonly contentHash: string; readonly storageRef: string | null }[];
}

export const JULIUS_ARCHIVE_SECTIONS = ['tasks', 'evidence', 'reviews', 'findings', 'repairs', 'research', 'usage', 'events', 'toolInvocations', 'artifacts'] as const;
export type JuliusArchiveSection = typeof JULIUS_ARCHIVE_SECTIONS[number];

export interface JuliusPaidRunArchiveExport extends JuliusPaidRunArchiveExportBody {
  readonly integrity: {
    readonly sectionHashes: Readonly<Record<JuliusArchiveSection, string>>;
    /** sha256 over the canonical export without `integrity`. */
    readonly contentHash: string;
  };
}

/** For the exporter: seal a body with its section and content hashes. Any runtime can reproduce these. */
export function sealJuliusPaidRunArchiveExport(body: JuliusPaidRunArchiveExportBody): JuliusPaidRunArchiveExport {
  const sectionHashes = Object.fromEntries(JULIUS_ARCHIVE_SECTIONS.map((section) => [section, juliusBrainSha256(canonicalJuliusBrainJson(body[section]))])) as Record<JuliusArchiveSection, string>;
  return { ...body, integrity: { sectionHashes, contentHash: juliusBrainSha256(canonicalJuliusBrainJson(body)) } };
}

/* --------------------------------------------------------------- validation */

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const iso = (value: unknown) => typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));

export function validateJuliusPaidRunArchiveExport(archive: JuliusPaidRunArchiveExport): string[] {
  const errors: string[] = [];
  if (archive?.format !== JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT) return [`format: expected ${JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT}`];
  for (const section of JULIUS_ARCHIVE_SECTIONS) if (!Array.isArray(archive[section])) errors.push(`${section}: must be a list`);
  if (errors.length > 0) return errors;
  const { run } = archive;
  if (!/^[0-9]{1,20}$/.test(String(run.workflowRunId))) errors.push('run.workflowRunId: digits');
  if (!Number.isSafeInteger(run.workflowRunAttempt) || run.workflowRunAttempt < 1) errors.push('run.workflowRunAttempt: a positive integer');
  if (!SHA40.test(String(run.acceptedMainSha))) errors.push('run.acceptedMainSha: 40 lowercase hex');
  if (!isJuliusBrainId(run.missionId)) errors.push('run.missionId: invalid');
  if (!isJuliusBrainId(run.projectId)) errors.push('run.projectId: invalid');
  if (run.juliusRunId !== null && !isJuliusBrainId(run.juliusRunId)) errors.push('run.juliusRunId: invalid');
  if (!(JULIUS_BRAIN_STATE_MODES as readonly string[]).includes(run.stateMode)) errors.push('run.stateMode: FRESH, CONTINUATION, LEARNING or REGRESSION');
  if (!iso(run.startedAt)) errors.push('run.startedAt: ISO timestamp');
  if (run.endedAt !== null && !iso(run.endedAt)) errors.push('run.endedAt: ISO timestamp or null');
  if (!['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(run.outcome)) errors.push('run.outcome: unknown value');
  if (!iso(archive.exportedAt)) errors.push('exportedAt: ISO timestamp');

  // Integrity: every section, then the whole body.
  const { integrity, ...body } = archive;
  for (const section of JULIUS_ARCHIVE_SECTIONS) {
    if (integrity?.sectionHashes?.[section] !== juliusBrainSha256(canonicalJuliusBrainJson(archive[section]))) errors.push(`integrity.sectionHashes.${section}: does not match the section`);
  }
  if (integrity?.contentHash !== juliusBrainSha256(canonicalJuliusBrainJson(body))) errors.push('integrity.contentHash: does not match the export');

  // Internal references must resolve: a history whose edges point nowhere is not trusted.
  const unique = (section: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) errors.push(`${section}: duplicate id ${id}`); seen.add(id); }
    return seen;
  };
  const tasks = unique('tasks', archive.tasks.map((task) => task.taskId));
  const evidence = unique('evidence', archive.evidence.map((item) => item.evidenceId));
  const findings = unique('findings', archive.findings.map((item) => item.findingId));
  unique('reviews', archive.reviews.map((item) => item.reviewId));
  unique('repairs', archive.repairs.map((item) => item.repairId));
  unique('research', archive.research.map((item) => item.requestKey));
  unique('usage', archive.usage.map((item) => item.componentId));
  unique('events', archive.events.map((item) => String(item.sequence)));
  unique('toolInvocations', archive.toolInvocations.map((item) => item.invocationId));
  const artifacts = unique('artifacts', archive.artifacts.map((item) => item.artifactId));
  const task = (value: string | null, at: string) => { if (value !== null && !tasks.has(value)) errors.push(`${at}: task ${value} is not in tasks`); };
  archive.tasks.forEach((item, i) => task(item.parentTaskId, `tasks[${i}].parentTaskId`));
  archive.evidence.forEach((item, i) => {
    task(item.taskId, `evidence[${i}].taskId`);
    if (!['PASSED', 'FAILED', 'INCONCLUSIVE'].includes(item.status)) errors.push(`evidence[${i}].status: unknown`);
    if (!iso(item.occurredAt)) errors.push(`evidence[${i}].occurredAt: ISO timestamp`);
    if (item.artifactRef !== null && !artifacts.has(item.artifactRef)) errors.push(`evidence[${i}].artifactRef: ${item.artifactRef} is not in artifacts`);
  });
  archive.reviews.forEach((item, i) => {
    task(item.taskId, `reviews[${i}].taskId`);
    for (const id of item.evidenceIds) if (!evidence.has(id)) errors.push(`reviews[${i}].evidenceIds: ${id} is not in evidence`);
    if (!iso(item.occurredAt)) errors.push(`reviews[${i}].occurredAt: ISO timestamp`);
  });
  archive.findings.forEach((item, i) => {
    task(item.taskId, `findings[${i}].taskId`);
    for (const id of item.evidenceIds) if (!evidence.has(id)) errors.push(`findings[${i}].evidenceIds: ${id} is not in evidence`);
    if (!iso(item.occurredAt)) errors.push(`findings[${i}].occurredAt: ISO timestamp`);
  });
  archive.repairs.forEach((item, i) => {
    task(item.originalTaskId, `repairs[${i}].originalTaskId`);
    task(item.repairTaskId, `repairs[${i}].repairTaskId`);
    for (const id of item.findingIds) if (!findings.has(id)) errors.push(`repairs[${i}].findingIds: ${id} is not in findings`);
    if (!Number.isSafeInteger(item.round) || item.round < 1) errors.push(`repairs[${i}].round: positive integer`);
    if (!iso(item.occurredAt)) errors.push(`repairs[${i}].occurredAt: ISO timestamp`);
  });
  archive.research.forEach((item, i) => {
    task(item.taskId, `research[${i}].taskId`);
    if (item.evidenceId !== null && !evidence.has(item.evidenceId)) errors.push(`research[${i}].evidenceId: ${item.evidenceId} is not in evidence`);
    if (!iso(item.occurredAt)) errors.push(`research[${i}].occurredAt: ISO timestamp`);
  });
  archive.usage.forEach((item, i) => {
    task(item.taskId, `usage[${i}].taskId`);
    if (!['PROVIDER_REPORTED', 'MEASURED_FROM_USAGE', 'ESTIMATED', 'UNKNOWN'].includes(item.costBasis)) errors.push(`usage[${i}].costBasis: unknown`);
    // A reported basis with no amount would be a zero pretending to be a bill.
    if ((item.costBasis === 'PROVIDER_REPORTED' || item.costBasis === 'MEASURED_FROM_USAGE') && item.usdMicros === null) errors.push(`usage[${i}]: ${item.costBasis} requires usdMicros`);
    if (item.costBasis === 'UNKNOWN' && item.usdMicros !== null) errors.push(`usage[${i}]: UNKNOWN basis cannot carry usdMicros`);
    for (const key of ['inputTokens', 'outputTokens', 'usdMicros', 'estimatedUsdMicros'] as const) {
      const value = item[key];
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) errors.push(`usage[${i}].${key}: null or a non-negative integer`);
    }
    if (!iso(item.occurredAt)) errors.push(`usage[${i}].occurredAt: ISO timestamp`);
  });
  archive.events.forEach((item, i) => {
    task(item.taskId, `events[${i}].taskId`);
    if (!Number.isSafeInteger(item.sequence) || item.sequence < 1) errors.push(`events[${i}].sequence: positive integer`);
    if (!iso(item.occurredAt)) errors.push(`events[${i}].occurredAt: ISO timestamp`);
  });
  archive.toolInvocations.forEach((item, i) => {
    task(item.taskId, `toolInvocations[${i}].taskId`);
    if (!iso(item.requestedAt)) errors.push(`toolInvocations[${i}].requestedAt: ISO timestamp`);
  });
  archive.artifacts.forEach((item, i) => {
    if (!SHA256.test(item.contentHash)) errors.push(`artifacts[${i}].contentHash: sha256:<64 hex>`);
    if (item.byteSize !== null && (!Number.isSafeInteger(item.byteSize) || item.byteSize < 0)) errors.push(`artifacts[${i}].byteSize: null or a non-negative integer`);
  });

  // Credential-shaped content is refused where it is, not discovered later by the planner.
  for (const section of JULIUS_ARCHIVE_SECTIONS) {
    archive[section].forEach((item: unknown, i: number) => {
      const scan = scanJuliusSecrets(juliusStringsOf(item).join('\n'));
      if (scan.shapes.length > 0) errors.push(`${section}[${i}]: credential-shaped content (${scan.shapes.join(', ')})`);
    });
  }
  return errors.slice(0, 50);
}

/* -------------------------------------------------------------- translation */

const ARCHIVE_IMPORTER = juliusPrincipal('JULIUS', 'julius:archive-importer');

const safeId = (value: string): string => (/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,120}$/.test(value) ? value : `h-${juliusBrainSha256(value).slice(7, 31)}`);
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

export const juliusArchiveRunKey = (run: Pick<JuliusPaidRunArchiveRun, 'workflowRunId' | 'workflowRunAttempt'>): string => `${run.workflowRunId}/${run.workflowRunAttempt}`;

/**
 * The Brain run id every imported record is scoped to — what a state mode keys
 * on. ALWAYS THE WORKFLOW RUN AND ITS ATTEMPT, NEVER THE JULIUS RUN ID: the
 * Julius run id is derived from the mission contract, so every paid attempt of
 * one contract carries the same one (in the paid-run archive, `run:5408584e…`
 * spans three workflow runs, and task, evidence, finding and v1 Brain entry
 * ids repeat between them). Scoped by it, three attempts would be one run to
 * CONTINUATION, LEARNING and REGRESSION. The Julius run id stays a fact.
 */
export const juliusArchiveBrainRunId = (run: Pick<JuliusPaidRunArchiveRun, 'workflowRunId' | 'workflowRunAttempt'>): string =>
  `workflow:${juliusArchiveRunKey(run)}`;

export const juliusArchiveEntityId = (run: JuliusPaidRunArchiveRun, section: JuliusArchiveSection | 'run' | 'export' | 'accounting', sourceId: string): string =>
  `archive:${juliusArchiveRunKey(run)}:${section}:${safeId(sourceId)}`;

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
const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const REPAIR_STATUS: Readonly<Record<string, string>> = { SCHEDULED: 'REQUESTED', ACTIVE: 'IN_PROGRESS', VERIFIED: 'VERIFIED', FAILED: 'REJECTED', CANCELLED: 'ABANDONED' };

function traceClassFor(eventType: string): string {
  if (eventType.startsWith('tool.')) return 'TOOL_INVOCATION';
  if (eventType.startsWith('recovery.')) return 'RECOVERY';
  if (eventType.includes('fail') || eventType.includes('refused') || eventType.includes('denied')) return 'FAILURE';
  if (eventType.startsWith('run.') || eventType.startsWith('task.') || eventType.startsWith('contract.') || eventType.startsWith('checkpoint.')) return 'STATE_TRANSITION';
  if (eventType.startsWith('worker.') || eventType.startsWith('subagent.')) return 'WORKER_ACTION';
  return 'ACTION';
}

/** Scalar facts only, bounded; what was dropped is counted, never silent. */
function scalarFacts(facts: Readonly<Record<string, JuliusBrainJson>>, extra: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = { ...extra };
  let dropped = 0;
  for (const key of Object.keys(facts).sort()) {
    const value = facts[key];
    if (Object.keys(out).length >= 30) { dropped += 1; continue; }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') out[clip(key, 64)] = value;
    else if (typeof value === 'string') out[clip(key, 64)] = clip(value, 512);
    else dropped += 1;
  }
  if (dropped > 0) out.droppedFacts = dropped;
  return out;
}

export interface JuliusArchiveImportPlan {
  readonly runKey: string;
  readonly brainRunId: string;
  readonly anchorEntityId: string;
  readonly drafts: readonly JuliusBrainDraft[];
  readonly counts: Readonly<Partial<Record<JuliusBrainRecordKind, number>>>;
  readonly accounting: { readonly knownUsdMicros: number; readonly knownIsFloor: boolean; readonly estimatedUsdMicros: number | null; readonly unknownComponents: number; readonly components: number };
}

/**
 * THE TRANSLATION, PURE. `stored` is where the export's own bytes were put
 * (content-addressed); every record derives from that artifact.
 */
export function planJuliusPaidRunArchiveImport(archive: JuliusPaidRunArchiveExport, stored: { readonly contentHash: string; readonly byteSize: number; readonly storageRef: string }): JuliusArchiveImportPlan {
  const { run } = archive;
  const runKey = juliusArchiveRunKey(run);
  const brainRunId = juliusArchiveBrainRunId(run);
  const anchorEntityId = juliusArchiveEntityId(run, 'export', archive.integrity.contentHash.slice(7, 23));
  const drafts: JuliusBrainDraft[] = [];
  const counts: Partial<Record<JuliusBrainRecordKind, number>> = {};
  const provenance = (section: string, sourceId: string, extra: { provider?: string | null; model?: string | null; tool?: string | null } = {}) =>
    juliusBrainProvenance('run_observed', { commit: run.acceptedMainSha, externalRef: clip(`${JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX}${runKey}#${section}/${sourceId}`, 2_048), ...extra });
  const add = (kind: JuliusBrainRecordKind, section: JuliusArchiveSection | 'run' | 'export' | 'accounting', sourceId: string, body: JuliusBrainBody, options: { taskId?: string | null; links?: readonly JuliusBrainLink[]; occurredAt: string; provider?: string | null; model?: string | null; tool?: string | null; entityId?: string }) => {
    const entityId = options.entityId ?? juliusArchiveEntityId(run, section, sourceId);
    const fromExport = entityId === anchorEntityId ? [] : [{ relation: 'DERIVED_FROM' as const, target: anchorEntityId, targetVersion: null }];
    drafts.push({
      kind, op: 'CREATE', entityId, expectedVersion: 0, body,
      links: [...(options.links ?? []), ...fromExport],
      scope: { missionId: run.missionId, runId: brainRunId, taskId: options.taskId ?? null },
      retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
      provenance: provenance(section, sourceId, { provider: options.provider ?? null, model: options.model ?? null, tool: options.tool ?? null }),
      idempotencyKey: `archive:${runKey}:${section}:${safeId(sourceId)}`,
      occurredAt: options.occurredAt,
    });
    counts[kind] = (counts[kind] ?? 0) + 1;
    return entityId;
  };
  const link = (relation: JuliusBrainLink['relation'], section: JuliusArchiveSection, sourceId: string): JuliusBrainLink => ({ relation, target: juliusArchiveEntityId(run, section, sourceId), targetVersion: null });

  // The export's own bytes: the anchor every record derives from.
  add('ARTIFACT', 'export', archive.integrity.contentHash.slice(7, 23), {
    artifactClass: 'REPORT', name: `paid-run-archive-${runKey.replace('/', '-attempt-')}.json`, contentType: 'application/json',
    byteSize: stored.byteSize, contentHash: stored.contentHash, storageRef: stored.storageRef, commit: run.acceptedMainSha,
  }, { entityId: anchorEntityId, occurredAt: archive.exportedAt });

  add('TRACE', 'run', runKey, {
    traceClass: 'LIFECYCLE',
    summary: clip(`Archived paid run ${runKey} of ${run.missionId} (${run.classification}, ${run.stateMode}) ended ${run.outcome}${run.outcomeReason ? `: ${run.outcomeReason}` : ''}`, 8_000),
    facts: {
      workflowRunId: run.workflowRunId, workflowRunAttempt: run.workflowRunAttempt, acceptedMainSha: run.acceptedMainSha,
      missionId: run.missionId, campaignId: run.campaignId, juliusRunId: run.juliusRunId, stateMode: run.stateMode,
      classification: clip(run.classification, 128), outcome: run.outcome, outcomeReason: run.outcomeReason === null ? null : clip(run.outcomeReason, 512),
      startedAt: run.startedAt, endedAt: run.endedAt, archiveId: clip(archive.archive.archiveId, 256),
      archiveSchemaVersion: clip(archive.archive.archiveSchemaVersion, 128), archiveContentHash: archive.integrity.contentHash, importer: JULIUS_ARCHIVE_IMPORTER_VERSION,
    },
  }, { occurredAt: run.endedAt ?? run.startedAt });

  for (const artifact of archive.artifacts) {
    add('ARTIFACT', 'artifacts', artifact.artifactId, {
      artifactClass: 'GENERATED_FILE', name: clip(artifact.name, 512), contentType: artifact.contentType ?? 'application/octet-stream',
      byteSize: artifact.byteSize, contentHash: artifact.contentHash,
      // A reference, not bytes this Brain holds: it resolves as UNSUPPORTED_REF, which is the truth.
      storageRef: clip(artifact.storageRef ?? `archive-ref:${runKey}/${artifact.artifactId}`, 2_048), commit: run.acceptedMainSha,
    }, { occurredAt: archive.exportedAt });
  }

  for (const task of archive.tasks) {
    add('TRACE', 'tasks', task.taskId, {
      traceClass: 'WORKER_ACTION', summary: clip(`${task.taskType} (${task.role}) ended ${task.state}`, 8_000),
      facts: { taskId: task.taskId, taskType: clip(task.taskType, 256), role: clip(task.role, 128), state: task.state, ordinal: task.ordinal, parentTaskId: task.parentTaskId },
    }, { taskId: task.taskId, occurredAt: run.startedAt });
  }

  for (const item of archive.evidence) {
    add('EVIDENCE', 'evidence', item.evidenceId, {
      evidenceClass: EVIDENCE_CLASS[item.evidenceType] ?? 'OBSERVATION',
      claim: clip(`${item.evidenceType} evidence${item.taskId ? ` for ${item.taskId}` : ''}`, 8_000), summary: clip(item.safeSummary, 8_000),
      status: item.status,
      // The archive recorded it; nothing here re-verified it.
      verification: 'UNVERIFIED',
      data: { sourceType: item.evidenceType, artifactRef: item.artifactRef, integrityHash: item.integrityHash, sourceEvidenceId: item.evidenceId },
      juliusEvidenceId: item.evidenceId,
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: item.artifactRef === null ? [] : [link('DERIVED_FROM', 'artifacts', item.artifactRef)] });
  }

  for (const item of archive.reviews) {
    add('DECISION', 'reviews', item.reviewId, {
      decisionClass: 'VERIFICATION', statement: clip(`${item.action} (${item.reasonCode})`, 8_000),
      rationale: clip(item.safeSummary ?? 'Unknown — the archive recorded no rationale.', 8_000), alternatives: [], status: 'ACTIVE',
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: item.evidenceIds.map((id) => link('EVIDENCED_BY', 'evidence', id)) });
  }

  for (const item of archive.findings) {
    const severity = item.severity !== null && SEVERITIES.includes(item.severity) ? item.severity : 'UNKNOWN';
    add('FINDING', 'findings', item.findingId, {
      findingClass: 'REVIEWER_FINDING', severity, statement: clip(item.claim, 8_000), blocking: item.blocking, status: item.status, juliusFindingId: item.findingId,
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: item.evidenceIds.map((id) => link('EVIDENCED_BY', 'evidence', id)) });
  }

  for (const item of archive.repairs) {
    add('REPAIR', 'repairs', item.repairId, {
      reason: clip(`Repair round ${item.round} of ${item.originalTaskId}`, 8_000), status: REPAIR_STATUS[item.state] ?? 'ABANDONED',
      implementation: item.repairTaskId === null ? null : `repair task ${item.repairTaskId}`,
      verification: item.state === 'VERIFIED' ? 'PASSED' : item.state === 'FAILED' ? 'FAILED' : 'NOT_RUN',
      reviewerDisposition: null, resultingState: clip(`archived state ${item.state}`, 8_000), juliusRepairId: item.repairId,
    }, { taskId: item.originalTaskId, occurredAt: item.occurredAt, links: item.findingIds.map((id) => link('REPAIRS', 'findings', id)) });
  }

  for (const item of archive.research) {
    const observed = item.outcome === 'observed';
    add('RESEARCH', 'research', item.requestKey, {
      question: clip(item.purpose ?? `Research request ${item.requestKey} (${item.role})`, 8_000),
      findings: [],
      sources: item.reference === null ? [] : [{ sourceKind: /^https?:/.test(item.reference) ? 'URL' : 'REPOSITORY', reference: clip(item.reference, 2_048), retrievedAt: observed ? item.occurredAt : null }],
      contradictions: [], unresolved: observed ? [] : [clip(`not observed: ${item.outcome}`, 8_000)], status: 'CONCLUDED',
    }, { taskId: item.taskId, occurredAt: item.occurredAt, links: item.evidenceId === null ? [] : [link('EVIDENCED_BY', 'evidence', item.evidenceId)] });
  }

  let knownUsdMicros = 0;
  let estimatedUsdMicros: number | null = null;
  let unknownComponents = 0;
  for (const item of archive.usage) {
    const known = item.costBasis === 'PROVIDER_REPORTED' || item.costBasis === 'MEASURED_FROM_USAGE';
    if (known) knownUsdMicros += item.usdMicros ?? 0;
    else unknownComponents += item.costBasis === 'UNKNOWN' ? 1 : 0;
    if (item.estimatedUsdMicros !== null) estimatedUsdMicros = (estimatedUsdMicros ?? 0) + item.estimatedUsdMicros;
    add('EVIDENCE', 'usage', item.componentId, {
      evidenceClass: 'MEASUREMENT', claim: clip(`spend of ${item.role}${item.taskId ? ` on ${item.taskId}` : ''}`, 8_000),
      summary: clip(`${item.costBasis}: ${item.usdMicros === null ? 'amount Unknown' : `${item.usdMicros} µ$`}; tokens ${item.inputTokens ?? 'Unknown'} in / ${item.outputTokens ?? 'Unknown'} out`, 8_000),
      status: known ? 'PASSED' : 'INCONCLUSIVE', verification: 'UNVERIFIED',
      data: { role: item.role, provider: item.provider, model: item.model, inputTokens: item.inputTokens, outputTokens: item.outputTokens, usdMicros: item.usdMicros, costBasis: item.costBasis, estimatedUsdMicros: item.estimatedUsdMicros },
      juliusEvidenceId: null,
    }, { taskId: item.taskId, occurredAt: item.occurredAt, provider: item.provider, model: item.model });
  }
  const accounting = { knownUsdMicros, knownIsFloor: unknownComponents > 0, estimatedUsdMicros, unknownComponents, components: archive.usage.length };
  add('EVIDENCE', 'accounting', runKey, {
    evidenceClass: 'MEASUREMENT', claim: `what paid run ${runKey} cost`,
    summary: `known ${knownUsdMicros} µ$${unknownComponents > 0 ? ` (a floor: ${unknownComponents} component(s) reported no amount)` : ''}; estimated ${estimatedUsdMicros ?? 'none'} µ$, never added to the known total`,
    status: unknownComponents > 0 ? 'INCONCLUSIVE' : 'PASSED', verification: 'UNVERIFIED', data: accounting, juliusEvidenceId: null,
  }, { occurredAt: run.endedAt ?? run.startedAt, links: archive.usage.map((item) => link('DERIVED_FROM', 'usage', item.componentId)).slice(0, 63) });

  for (const item of archive.events) {
    add('TRACE', 'events', String(item.sequence), {
      traceClass: traceClassFor(item.eventType), summary: clip(item.eventType, 8_000),
      facts: scalarFacts(item.facts, { eventType: clip(item.eventType, 256), sequence: item.sequence }),
    }, { taskId: item.taskId, occurredAt: item.occurredAt });
  }

  for (const item of archive.toolInvocations) {
    add('TRACE', 'toolInvocations', item.invocationId, {
      traceClass: 'TOOL_INVOCATION', summary: clip(`${item.toolId} ${item.state}`, 8_000),
      facts: { invocationId: clip(item.invocationId, 256), toolId: clip(item.toolId, 128), state: item.state, requestedAt: item.requestedAt, completedAt: item.completedAt },
    }, { taskId: item.taskId, occurredAt: item.requestedAt, tool: item.toolId });
  }
  return { runKey, brainRunId, anchorEntityId, drafts, counts, accounting };
}

/* ------------------------------------------------------------------ import */

export interface JuliusArchiveContentPort {
  put(content: Uint8Array): Promise<{ readonly contentHash: string; readonly byteSize: number; readonly storageRef: string }>;
}

export type JuliusArchiveImportResult =
  | {
    readonly outcome: 'IMPORTED' | 'ALREADY_IMPORTED';
    readonly runKey: string; readonly brainRunId: string; readonly archiveContentHash: string; readonly anchorEntityId: string;
    readonly appended: number; readonly duplicates: number;
    readonly counts: JuliusArchiveImportPlan['counts']; readonly accounting: JuliusArchiveImportPlan['accounting'];
  }
  | { readonly outcome: 'REJECTED'; readonly reasonCode: 'archive_invalid'; readonly errors: readonly string[] }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string; readonly detail: string; readonly group: number; readonly index: number };

const GROUP_SIZE = 400;

export async function importJuliusPaidRunArchive(input: {
  readonly store: JuliusBrainStore;
  readonly brainId: string;
  readonly projectId: string;
  readonly archive: JuliusPaidRunArchiveExport;
  readonly content: JuliusArchiveContentPort;
  readonly recordedAt: string;
  readonly importer?: JuliusBrainPrincipal;
}): Promise<JuliusArchiveImportResult> {
  const errors = validateJuliusPaidRunArchiveExport(input.archive);
  if (errors.length > 0) return { outcome: 'REJECTED', reasonCode: 'archive_invalid', errors };
  const importer = input.importer ?? ARCHIVE_IMPORTER;
  if (importer.kind !== 'JULIUS') return { outcome: 'REJECTED', reasonCode: 'archive_invalid', errors: ['importer: archived history enters the Brain only under Julius'] };
  const bytes = new TextEncoder().encode(canonicalJuliusBrainJson(input.archive));
  const stored = await input.content.put(bytes);
  const plan = planJuliusPaidRunArchiveImport(input.archive, stored);
  const groups: JuliusBrainCommitGroup[] = [];
  for (let start = 0; start < plan.drafts.length; start += GROUP_SIZE) groups.push({ principal: importer, grant: null, drafts: plan.drafts.slice(start, start + GROUP_SIZE) });
  // ONE commit, many groups: the whole run arrives or none of it does.
  const result = await input.store.commitGroup({ brainId: input.brainId, projectId: input.projectId, recordedAt: input.recordedAt, groups });
  if (result.outcome === 'REFUSED') return { outcome: 'REFUSED', reasonCode: result.reasonCode, detail: result.detail, group: result.group, index: result.index };
  const receipts: JuliusBrainReceipt[] = result.receipts.flat();
  const appended = receipts.filter((receipt) => receipt.outcome === 'APPENDED').length;
  return {
    outcome: appended === 0 ? 'ALREADY_IMPORTED' : 'IMPORTED',
    runKey: plan.runKey, brainRunId: plan.brainRunId, archiveContentHash: input.archive.integrity.contentHash, anchorEntityId: plan.anchorEntityId,
    appended, duplicates: receipts.length - appended, counts: plan.counts, accounting: plan.accounting,
  };
}
