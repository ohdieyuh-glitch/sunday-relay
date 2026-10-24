/**
 * YUJI's reader for one admitted Julius mission.
 *
 * `read` takes the run id, reads the `julius-run-spent.v1` tag (the spend
 * record), and matches that tag's `workflow_run_id` and attempt to the
 * Actions run behind an injected {@link JuliusMissionGitHub}. GitHub is not
 * called from this module. A legacy `run:` id is read the same way and is
 * never rewritten into a `wlj_` id. A `preflight:` id and any other string
 * are not a mission: the reader does not call GitHub and does not invent a
 * tag, a cost, a receipt, or a trace id.
 *
 * Fail closed. The state stays `dispatched` unless the tag and the workflow
 * run agree and the next state is itself on that run. A missing cost is
 * null. Trace ids are derived from the admitted `wlj_` id by
 * `scripts/julius-mission-trace.mjs`. A trace id in the tag, the diagnostics,
 * or the dispatch is not read. This module does not mount a route.
 */

import { createHash } from 'node:crypto';

import { deriveJuliusSpentTag } from '../scripts/julius-admission-run-id.mjs';
import {
  juliusMissionSpanId,
  juliusMissionTraceId,
  juliusMissionTraceparent,
} from '../scripts/julius-mission-trace.mjs';

export const JULIUS_SPEND_TAG_SCHEMA = 'julius-run-spent.v1' as const;
export const JULIUS_MISSION_EVIDENCE_ARTIFACT = 'julius-live-evidence' as const;

export const JULIUS_MISSION_EVIDENCE_STATES = ['dispatched', 'running', 'completed', 'failed'] as const;
export type JuliusMissionEvidenceState = (typeof JULIUS_MISSION_EVIDENCE_STATES)[number];

export const JULIUS_MISSION_PHASE_ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;
export type JuliusMissionPhaseRole = (typeof JULIUS_MISSION_PHASE_ROLES)[number];

export const JULIUS_MISSION_PHASE_STAGES = ['plan', 'build', 'repair:plan', 'repair:build'] as const;
export type JuliusMissionPhaseStage = (typeof JULIUS_MISSION_PHASE_STAGES)[number];

export const JULIUS_MISSION_CODER_COST_BASES = ['PROVIDER_REPORTED', 'UNKNOWN', 'NOT_APPLICABLE'] as const;
export type JuliusMissionCoderCostBasis = (typeof JULIUS_MISSION_CODER_COST_BASES)[number];

export const JULIUS_MISSION_BILLING_PATHS = ['SUBSCRIPTION', 'API_BILLED'] as const;
export type JuliusMissionBillingPath = (typeof JULIUS_MISSION_BILLING_PATHS)[number];

export const JULIUS_MISSION_REQUEST_AVAILABILITY = ['CAPTURED', 'UNAVAILABLE'] as const;
export type JuliusMissionRequestAvailability = (typeof JULIUS_MISSION_REQUEST_AVAILABILITY)[number];

export const JULIUS_MISSION_ARCHIVE_FILE_KINDS = ['table', 'text'] as const;
export type JuliusMissionArchiveFileKind = (typeof JULIUS_MISSION_ARCHIVE_FILE_KINDS)[number];

export const JULIUS_MISSION_WORKFLOW_STATUSES = ['queued', 'in_progress', 'completed'] as const;
export type JuliusMissionWorkflowStatus = (typeof JULIUS_MISSION_WORKFLOW_STATUSES)[number];

export const JULIUS_MISSION_WORKFLOW_CONCLUSIONS = [
  'success', 'failure', 'cancelled', 'timed_out', 'startup_failure', 'skipped', 'neutral', 'action_required', 'stale',
] as const;
export type JuliusMissionWorkflowConclusion = (typeof JULIUS_MISSION_WORKFLOW_CONCLUSIONS)[number];

const FAILURE_CONCLUSIONS = ['failure', 'cancelled', 'timed_out', 'startup_failure'] as const;
type FailureConclusion = (typeof FAILURE_CONCLUSIONS)[number];

/** The `julius-run-spent.v1` message. A reservation record, not a settled bill. */
export interface JuliusMissionSpendTagEvidence {
  readonly schema: typeof JULIUS_SPEND_TAG_SCHEMA;
  readonly run: string;
  readonly namespace: string;
  readonly reservedUsdMicros: number;
  readonly workflowRunId: string;
  readonly workflowRunAttempt: string;
  readonly headSha: string;
}

/**
 * Cap reading. This reader does not invent `spendVerified` or a zero
 * component count. The fields stay null until a source that carries them is
 * part of the evidence this reader is given.
 */
export interface JuliusMissionSpendAccounting {
  readonly knownUsdMicros: number | null;
  readonly unknownCostComponents: number | null;
  readonly unverifiableApiSpend: boolean | null;
  readonly spendVerified: boolean | null;
}

/** Settled coder cost. Every field null means the section is absent. */
export interface JuliusMissionCoderCost {
  readonly costUsdMicros: number | null;
  readonly costBasis: JuliusMissionCoderCostBasis | null;
  readonly executionCostUsdMicros: number | null;
  readonly billingPath: JuliusMissionBillingPath | null;
}

/** Mission-level cost. `complete: false` means the total is a floor. */
export interface JuliusMissionCostEvidence {
  readonly knownUsdMicros: number | null;
  readonly unknownComponents: number | null;
  readonly complete: boolean | null;
}

/**
 * Provider receipt. `CAPTURED` is the provider request id itself.
 * `providerMessageId` is not a field: a message id does not capture a request.
 */
export interface JuliusMissionProviderReceipt {
  readonly providerRequestId: string | null;
  readonly responseId: string | null;
  readonly providerRequestAvailability: JuliusMissionRequestAvailability;
  readonly providerRequestUnavailableReason: string | null;
}

export interface JuliusMissionObservedReceipt extends JuliusMissionProviderReceipt {
  readonly role: JuliusMissionPhaseRole;
  readonly stage: JuliusMissionPhaseStage | null;
  readonly attempt: number | null;
}

export interface JuliusMissionArchiveFile {
  readonly path: string;
  readonly sha256: string;
  readonly kind: JuliusMissionArchiveFileKind;
}

export interface JuliusMissionArchiveEvidence {
  readonly artifactName: string | null;
  readonly artifactDigest: string | null;
  readonly fileCount: number | null;
  readonly totalBytes: number | null;
  readonly conclusion: string | null;
  readonly failedSteps: readonly string[] | null;
  readonly files: readonly JuliusMissionArchiveFile[] | null;
}

/** The Actions artifact named `julius-live-evidence`, when that run lists it. */
export interface JuliusMissionArtifactReference {
  readonly name: typeof JULIUS_MISSION_EVIDENCE_ARTIFACT;
  readonly digest: string | null;
  readonly fileCount: number | null;
  readonly totalBytes: number | null;
}

/**
 * The completion marker. `workflowRunId` is the Actions run id on the marker,
 * the same number the spend tag recorded. It is not the `wlj_` id.
 */
export interface JuliusMissionCompletedMarker {
  readonly artifactName: string;
  readonly completedAt: string;
  readonly workflowRunId: string;
  readonly commit: string;
  readonly workflowRef: string;
}

/**
 * A phase span derived from the admitted `wlj_` id. The mission itself is not
 * a span. Slot state is not on the evidence bundle, so this list is not a
 * C.A.R.D. slot projection.
 */
export interface JuliusMissionSpanEvidence {
  readonly role: JuliusMissionPhaseRole;
  readonly stage: JuliusMissionPhaseStage;
  readonly attempt: number;
  readonly spanId: string;
  readonly traceparent: string;
}

export interface JuliusMissionWorkflowArtifactFile {
  readonly path: string;
  readonly text: string;
}

export interface JuliusMissionWorkflowArtifact {
  readonly name: string;
  /** Null when the artifact was listed and its bytes were not fetched. */
  readonly files: readonly JuliusMissionWorkflowArtifactFile[] | null;
}

/** One Actions run, already fetched. The reader does not interpret HTTP. */
export interface JuliusMissionWorkflowRun {
  readonly workflowRunId: string;
  readonly workflowRunAttempt: string;
  readonly headSha: string;
  readonly status: JuliusMissionWorkflowStatus;
  readonly conclusion: JuliusMissionWorkflowConclusion | null;
  readonly failedSteps: readonly string[];
  readonly artifacts: readonly JuliusMissionWorkflowArtifact[];
}

/**
 * Read-only GitHub access. There is no method that creates a tag, a run, or
 * an artifact. Tests pass a fake. A thrown error is an unverifiable read.
 */
export interface JuliusMissionGitHub {
  readAnnotatedTagMessage(tagRef: string): Promise<string | null>;
  readWorkflowRun(workflowRunId: string, workflowRunAttempt: string): Promise<JuliusMissionWorkflowRun | null>;
}

/**
 * What {@link JuliusMissionEvidenceReader.read} returns.
 *
 * `state` is the only progression claim. `dispatched` is the fail-closed
 * ceiling: the tag may still be present. `cause` is set only for `failed`.
 * `juliusFinalState` is `COMPLETED` only when `state` is `completed`.
 * `traceparent` on the mission is null. Phase spans are `spans`.
 */
export interface JuliusMissionEvidenceResult {
  readonly admissionForm: 'wlj' | 'legacy' | null;
  readonly runId: string | null;
  readonly state: JuliusMissionEvidenceState;
  readonly cause: string | null;
  readonly juliusFinalState: 'COMPLETED' | null;
  readonly spendTag: JuliusMissionSpendTagEvidence | null;
  readonly spendAccounting: JuliusMissionSpendAccounting | null;
  readonly coderCost: JuliusMissionCoderCost | null;
  readonly missionCost: JuliusMissionCostEvidence | null;
  readonly providerReceipt: JuliusMissionProviderReceipt | null;
  readonly providerReceipts: readonly JuliusMissionObservedReceipt[] | null;
  readonly archive: JuliusMissionArchiveEvidence | null;
  readonly artifact: JuliusMissionArtifactReference | null;
  readonly workArtifactRefs: readonly string[] | null;
  readonly projectBrainRevision: number | null;
  readonly phases: null;
  readonly spans: readonly JuliusMissionSpanEvidence[] | null;
  readonly completedMarker: JuliusMissionCompletedMarker | null;
  readonly resultLine: string | null;
  readonly traceId: string | null;
  readonly traceparent: null;
}

export interface JuliusMissionEvidenceReader {
  read(wljRunId: string): Promise<JuliusMissionEvidenceResult>;
}

const NAMESPACE = /^[a-z][a-z0-9-]{2,48}$/u;
const DIGITS = /^[1-9][0-9]{0,19}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const MICROS = /^(?:0|[1-9][0-9]{0,15})$/u;
const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u;
const REASON = /^[a-z0-9_:-]{1,80}$/u;
const WORK_ARTIFACT = /julius-work-artifact\.v1/u;
const FOOTER = /^\(\d+ rows?\)$/u;

function credentialShaped(value: string): boolean {
  return /sk-/u.test(value)
    || /gh[pousr]_/u.test(value)
    || /github_pat_/u.test(value)
    || /xai-/u.test(value)
    || /BEGIN [A-Z ]*PRIVATE KEY/u.test(value)
    || /Bearer /u.test(value);
}

function plain(value: string, max: number): string | null {
  if (value.length === 0 || value.length > max || /[\r\n]/u.test(value) || credentialShaped(value)) return null;
  return value;
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? value as T : null;
}

function nonNegative(value: string): number | null {
  if (!MICROS.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Same digest as the paid-run archive: sha256 of `path NUL file-sha256` lines, in path order. */
function bundleDigest(files: readonly JuliusMissionArchiveFile[]): string {
  return sha256([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((file) => `${file.path}\0${file.sha256}`).join('\n'));
}

function blank(): JuliusMissionEvidenceResult {
  return {
    admissionForm: null,
    runId: null,
    state: 'dispatched',
    cause: null,
    juliusFinalState: null,
    spendTag: null,
    spendAccounting: null,
    coderCost: null,
    missionCost: null,
    providerReceipt: null,
    providerReceipts: null,
    archive: null,
    artifact: null,
    workArtifactRefs: null,
    projectBrainRevision: null,
    phases: null,
    spans: null,
    completedMarker: null,
    resultLine: null,
    traceId: null,
    traceparent: null,
  };
}

function withRun(form: 'wlj' | 'legacy', runId: string, rest: Partial<JuliusMissionEvidenceResult>): JuliusMissionEvidenceResult {
  const traceId = form === 'wlj' ? juliusMissionTraceId(runId) : null;
  return {
    ...blank(),
    ...rest,
    admissionForm: form,
    runId,
    traceId,
    traceparent: null,
    phases: null,
    juliusFinalState: rest.state === 'completed' ? 'COMPLETED' : null,
    cause: rest.state === 'failed' ? rest.cause ?? null : null,
  };
}

function parseSpendTag(message: string, runId: string): JuliusMissionSpendTagEvidence | null {
  const lines = message.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 7 || lines[0] !== JULIUS_SPEND_TAG_SCHEMA) return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cut = line.indexOf('=');
    if (cut <= 0) return null;
    const key = line.slice(0, cut);
    if (fields.has(key)) return null;
    fields.set(key, line.slice(cut + 1));
  }
  if (fields.size !== 6) return null;
  const run = fields.get('run');
  const namespace = fields.get('namespace');
  const reserved = fields.get('reservedUsdMicros');
  const workflowRunId = fields.get('workflow_run_id');
  const workflowRunAttempt = fields.get('workflow_run_attempt');
  const headSha = fields.get('head_sha');
  if (run !== runId || namespace === undefined || !NAMESPACE.test(namespace)) return null;
  if (reserved === undefined || workflowRunId === undefined || workflowRunAttempt === undefined || headSha === undefined) return null;
  const reservedUsdMicros = nonNegative(reserved);
  if (reservedUsdMicros === null || !DIGITS.test(workflowRunId) || !DIGITS.test(workflowRunAttempt) || !SHA40.test(headSha)) return null;
  return {
    schema: JULIUS_SPEND_TAG_SCHEMA,
    run,
    namespace,
    reservedUsdMicros,
    workflowRunId,
    workflowRunAttempt,
    headSha,
  };
}

function isFailureConclusion(value: JuliusMissionWorkflowConclusion | null): value is FailureConclusion {
  return value !== null && (FAILURE_CONCLUSIONS as readonly string[]).includes(value);
}

function normalizeRun(value: JuliusMissionWorkflowRun | null): JuliusMissionWorkflowRun | null {
  if (value === null) return null;
  if (!DIGITS.test(value.workflowRunId) || !DIGITS.test(value.workflowRunAttempt) || !SHA40.test(value.headSha)) return null;
  if (!oneOf(value.status, JULIUS_MISSION_WORKFLOW_STATUSES)) return null;
  if (value.conclusion !== null && !oneOf(value.conclusion, JULIUS_MISSION_WORKFLOW_CONCLUSIONS)) return null;
  if (!Array.isArray(value.failedSteps) || !Array.isArray(value.artifacts)) return null;
  const failedSteps: string[] = [];
  for (const step of value.failedSteps) {
    if (typeof step !== 'string') return null;
    const safe = plain(step, 300);
    if (safe === null) return null;
    failedSteps.push(safe);
  }
  const artifacts: JuliusMissionWorkflowArtifact[] = [];
  for (const artifact of value.artifacts) {
    if (typeof artifact.name !== 'string' || plain(artifact.name, 200) !== artifact.name) return null;
    if (artifact.files === null) {
      artifacts.push({ name: artifact.name, files: null });
      continue;
    }
    if (!Array.isArray(artifact.files)) return null;
    const files: JuliusMissionWorkflowArtifactFile[] = [];
    for (const file of artifact.files) {
      if (typeof file.path !== 'string' || typeof file.text !== 'string') return null;
      if (plain(file.path, 500) !== file.path) return null;
      files.push({ path: file.path, text: file.text });
    }
    artifacts.push({ name: artifact.name, files });
  }
  return {
    workflowRunId: value.workflowRunId,
    workflowRunAttempt: value.workflowRunAttempt,
    headSha: value.headSha,
    status: value.status,
    conclusion: value.conclusion,
    failedSteps,
    artifacts,
  };
}

function fileText(artifact: JuliusMissionWorkflowArtifact | undefined, leaf: string): string | null {
  if (artifact?.files == null) return null;
  const matches = artifact.files.filter((file) => file.path === leaf || file.path.endsWith(`/${leaf}`));
  return matches.length === 1 ? matches[0].text : null;
}

function parseTable(text: string): { readonly columns: readonly string[]; readonly rows: readonly Record<string, string>[] } | null {
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line.length > 0 && !FOOTER.test(line.trim()));
  if (lines.length === 0) return null;
  const columns = lines[0].split('\t');
  if (columns.some((column) => column.length === 0 || columns.indexOf(column) !== columns.lastIndexOf(column))) return null;
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (cells.length !== columns.length) return null;
    const row: Record<string, string> = {};
    columns.forEach((column, index) => { row[column] = cells[index]; });
    rows.push(row);
  }
  return { columns, rows };
}

function rowsForRun(text: string | null, runId: string): readonly Record<string, string>[] | null {
  if (text === null) return null;
  const table = parseTable(text);
  if (table === null || !table.columns.includes('run_id')) return null;
  return table.rows.filter((row) => row.run_id === runId);
}

function receiptFromRow(row: Record<string, string>): JuliusMissionObservedReceipt | null {
  const role = oneOf(row.role ?? '', JULIUS_MISSION_PHASE_ROLES);
  if (role === null) return null;
  const stage = row.stage === undefined || row.stage === '' ? null : oneOf(row.stage, JULIUS_MISSION_PHASE_STAGES);
  const attempt = row.dispatch_attempt === undefined || row.dispatch_attempt === '' ? null : nonNegative(row.dispatch_attempt);
  const rawId = row.provider_request_id ?? '';
  const stated = oneOf(row.provider_request_availability ?? '', JULIUS_MISSION_REQUEST_AVAILABILITY);
  const shaped = rawId.length > 0 && credentialShaped(rawId);
  const requestId = rawId.length > 0 && !shaped ? plain(rawId, 200) : null;
  const captured = requestId !== null && (stated === 'CAPTURED' || stated === null);
  if (rawId.length === 0 && stated === null) return null;
  const statedReason = REASON.test(row.provider_request_unavailable_reason ?? '') ? row.provider_request_unavailable_reason : null;
  const reason = captured
    ? null
    : shaped
      ? 'provider_request_id_credential_shaped'
      : stated === 'CAPTURED'
        ? 'provider_request_id_unusable'
        : statedReason;
  return {
    role,
    stage,
    attempt,
    providerRequestId: captured ? requestId : null,
    responseId: captured ? requestId : null,
    providerRequestAvailability: captured ? 'CAPTURED' : 'UNAVAILABLE',
    providerRequestUnavailableReason: reason,
  };
}

function spansFrom(rows: readonly Record<string, string>[] | null, wljRunId: string): readonly JuliusMissionSpanEvidence[] | null {
  if (rows === null) return null;
  const traceId = juliusMissionTraceId(wljRunId);
  const seen = new Set<string>();
  const spans: JuliusMissionSpanEvidence[] = [];
  for (const row of rows) {
    const role = oneOf(row.role ?? '', JULIUS_MISSION_PHASE_ROLES);
    const stage = oneOf(row.stage ?? '', JULIUS_MISSION_PHASE_STAGES);
    const attempt = nonNegative(row.dispatch_attempt ?? '');
    if (role === null || stage === null || attempt === null) continue;
    const key = `${role}\0${stage}\0${String(attempt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spanId = juliusMissionSpanId(wljRunId, role, stage, attempt);
    const traceparent = juliusMissionTraceparent(traceId, spanId);
    if (spanId === null || traceparent === null) continue;
    spans.push({ role, stage, attempt, spanId, traceparent });
  }
  return spans;
}

function coderCostFrom(receiptsRows: readonly Record<string, string>[] | null): JuliusMissionCoderCost | null {
  if (receiptsRows === null) return null;
  const rows = receiptsRows.filter((row) => row.role === 'CODING_AGENT');
  if (rows.length === 0) return null;
  const cost = (row: Record<string, string>): JuliusMissionCoderCost => ({
    costUsdMicros: row.cost_usd_micros === '' || row.cost_usd_micros === undefined ? null : nonNegative(row.cost_usd_micros),
    costBasis: oneOf(row.cost_basis ?? '', JULIUS_MISSION_CODER_COST_BASES),
    executionCostUsdMicros: row.execution_cost_usd_micros === '' || row.execution_cost_usd_micros === undefined ? null : nonNegative(row.execution_cost_usd_micros),
    billingPath: oneOf(row.billing_path ?? '', JULIUS_MISSION_BILLING_PATHS),
  });
  const first = cost(rows[0]);
  if (rows.some((row) => JSON.stringify(cost(row)) !== JSON.stringify(first))) return null;
  if (first.costUsdMicros === null && first.costBasis === null && first.executionCostUsdMicros === null && first.billingPath === null) return null;
  return first;
}

function costsFrom(text: string | null, runId: string): { readonly spend: JuliusMissionSpendAccounting | null; readonly mission: JuliusMissionCostEvidence | null } {
  const rows = rowsForRun(text, runId);
  if (rows === null || rows.length === 0) return { spend: null, mission: null };
  let known = 0;
  let unknown = 0;
  let estimated = 0;
  let unsettled = 0;
  for (const row of rows) {
    const knownCell = nonNegative(row.known_usd_micros ?? '');
    const unknownCell = nonNegative(row.unknown_components ?? '');
    const estimatedCell = nonNegative(row.estimated_components ?? '');
    const unsettledCell = nonNegative(row.unsettled_components ?? '');
    if (knownCell === null || unknownCell === null || estimatedCell === null || unsettledCell === null) return { spend: null, mission: null };
    known += knownCell;
    unknown += unknownCell;
    estimated += estimatedCell;
    unsettled += unsettledCell;
  }
  if (!Number.isSafeInteger(known)) return { spend: null, mission: null };
  return {
    spend: { knownUsdMicros: known, unknownCostComponents: unknown, unverifiableApiSpend: null, spendVerified: null },
    mission: { knownUsdMicros: known, unknownComponents: unknown, complete: unknown === 0 && estimated === 0 && unsettled === 0 },
  };
}

function workRefsFrom(text: string | null, runId: string): readonly string[] | null {
  const rows = rowsForRun(text, runId);
  if (rows === null) return null;
  const refs: string[] = [];
  for (const row of rows) {
    const ref = plain(row.artifact_ref ?? '', 400);
    if (ref !== null && WORK_ARTIFACT.test(ref)) refs.push(ref);
  }
  return refs;
}

function runtimeAgrees(text: string | null, runId: string): boolean {
  if (text === null) return true;
  const rows = rowsForRun(text, runId);
  if (rows === null || rows.length !== 1) return false;
  return rows[0].state === 'COMPLETED';
}

function completedMarker(artifact: JuliusMissionWorkflowArtifact | undefined, tag: JuliusMissionSpendTagEvidence): JuliusMissionCompletedMarker | null {
  if (artifact === undefined || artifact.name !== `${tag.namespace}-completed`) return null;
  const text = fileText(artifact, 'marker.txt');
  if (text === null) return null;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 4) return null;
  const fields = new Map<string, string>();
  for (const line of lines) {
    const cut = line.indexOf('=');
    if (cut <= 0) return null;
    fields.set(line.slice(0, cut), line.slice(cut + 1));
  }
  const completedAt = fields.get('completed_at');
  const workflowRunId = fields.get('run_id');
  const commit = fields.get('commit');
  const workflowRef = fields.get('workflow_ref');
  if (completedAt === undefined || !STAMP.test(completedAt)) return null;
  if (workflowRunId !== tag.workflowRunId || commit !== tag.headSha) return null;
  if (workflowRef === undefined || plain(workflowRef, 300) !== workflowRef) return null;
  return { artifactName: artifact.name, completedAt, workflowRunId, commit, workflowRef };
}

function resultLineFor(text: string | null, runId: string): { readonly line: string; readonly word: string } | null {
  if (text === null) return null;
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, ''));
  const pairs: { readonly line: string; readonly word: string }[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (!line.startsWith('RESULT: ')) continue;
    if (lines[index + 1] !== `  run: ${runId}`) continue;
    const word = line.slice('RESULT: '.length).split(' ')[0] ?? '';
    if (word.length === 0) continue;
    pairs.push({ line, word });
  }
  return pairs.length === 1 ? pairs[0] : null;
}

function evidenceFiles(artifact: JuliusMissionWorkflowArtifact | undefined): readonly JuliusMissionArchiveFile[] | null {
  if (artifact?.files == null) return null;
  return artifact.files.map((file) => {
    const digest = sha256(file.text);
    return { path: file.path, sha256: digest, kind: file.path.endsWith('.tsv') ? 'table' as const : 'text' as const };
  });
}

function failureCause(run: JuliusMissionWorkflowRun): string | null {
  if (!isFailureConclusion(run.conclusion)) return null;
  if (run.failedSteps.length === 0) return run.conclusion;
  return `${run.conclusion}: ${run.failedSteps.join('; ')}`;
}

export function createJuliusMissionEvidenceReader(github: JuliusMissionGitHub): JuliusMissionEvidenceReader {
  return {
    async read(wljRunId: string): Promise<JuliusMissionEvidenceResult> {
      const derived = deriveJuliusSpentTag(wljRunId);
      if (!derived.ok) return blank();
      let message: string | null;
      try {
        message = await github.readAnnotatedTagMessage(derived.tag);
      } catch {
        return withRun(derived.form, derived.runId, { state: 'dispatched' });
      }
      if (message === null) return withRun(derived.form, derived.runId, { state: 'dispatched' });
      const spendTag = parseSpendTag(message, derived.runId);
      if (spendTag === null) return withRun(derived.form, derived.runId, { state: 'dispatched' });
      let observed: JuliusMissionWorkflowRun | null;
      try {
        observed = normalizeRun(await github.readWorkflowRun(spendTag.workflowRunId, spendTag.workflowRunAttempt));
      } catch {
        return withRun(derived.form, derived.runId, { state: 'dispatched', spendTag });
      }
      if (observed === null
        || observed.workflowRunId !== spendTag.workflowRunId
        || observed.workflowRunAttempt !== spendTag.workflowRunAttempt
        || observed.headSha !== spendTag.headSha) {
        return withRun(derived.form, derived.runId, { state: 'dispatched', spendTag });
      }
      const evidence = observed.artifacts.find((artifact) => artifact.name === JULIUS_MISSION_EVIDENCE_ARTIFACT);
      const files = evidenceFiles(evidence);
      const artifact: JuliusMissionArtifactReference | null = evidence === undefined ? null : {
        name: JULIUS_MISSION_EVIDENCE_ARTIFACT,
        digest: files === null ? null : bundleDigest(files),
        fileCount: files === null ? null : files.length,
        totalBytes: files === null || evidence?.files == null ? null : evidence.files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0),
      };
      const archive: JuliusMissionArchiveEvidence = {
        artifactName: artifact?.name ?? null,
        artifactDigest: artifact?.digest ?? null,
        fileCount: artifact?.fileCount ?? null,
        totalBytes: artifact?.totalBytes ?? null,
        conclusion: observed.conclusion,
        failedSteps: observed.failedSteps,
        files,
      };
      const diagnosticText = fileText(evidence, 'worker-diagnostics.tsv');
      const diagnosticRows = rowsForRun(diagnosticText, derived.runId);
      const spans = derived.form === 'wlj' ? spansFrom(diagnosticRows, derived.runId) : null;
      const providerReceipts = diagnosticRows === null ? null : diagnosticRows.flatMap((row) => {
        const receipt = receiptFromRow(row);
        return receipt === null ? [] : [receipt];
      });
      const coderReceipts = (providerReceipts ?? []).filter((receipt) => receipt.role === 'CODING_AGENT');
      const providerReceipt = coderReceipts.length === 1
        ? {
          providerRequestId: coderReceipts[0].providerRequestId,
          responseId: coderReceipts[0].responseId,
          providerRequestAvailability: coderReceipts[0].providerRequestAvailability,
          providerRequestUnavailableReason: coderReceipts[0].providerRequestUnavailableReason,
        }
        : null;
      const costs = costsFrom(fileText(evidence, 'cost-accounting.tsv'), derived.runId);
      const held = withRun(derived.form, derived.runId, {
        state: 'dispatched',
        spendTag,
        spendAccounting: costs.spend,
        coderCost: coderCostFrom(diagnosticRows),
        missionCost: costs.mission,
        providerReceipt,
        providerReceipts,
        archive,
        artifact,
        workArtifactRefs: workRefsFrom(fileText(evidence, 'evidence.tsv'), derived.runId),
        spans,
      });
      if (observed.status === 'in_progress') return { ...held, state: 'running' };
      if (observed.status !== 'completed') return held;
      const marker = completedMarker(observed.artifacts.find((item) => item.name === `${spendTag.namespace}-completed`), spendTag);
      const result = resultLineFor(fileText(evidence, 'live-mission.evidence.txt'), derived.runId);
      const runtime = runtimeAgrees(fileText(evidence, 'runs.tsv'), derived.runId);
      if (observed.conclusion === 'success' && marker !== null && result !== null && result.word === 'COMPLETED' && runtime) {
        return { ...held, state: 'completed', juliusFinalState: 'COMPLETED', completedMarker: marker, resultLine: result.line };
      }
      if (marker !== null || (result !== null && result.word === 'COMPLETED' && observed.conclusion !== 'success')) {
        return held;
      }
      const cause = failureCause(observed);
      if (cause !== null && observed.conclusion !== 'success') {
        return {
          ...held,
          state: 'failed',
          cause,
          resultLine: result?.line ?? null,
        };
      }
      return held;
    },
  };
}
