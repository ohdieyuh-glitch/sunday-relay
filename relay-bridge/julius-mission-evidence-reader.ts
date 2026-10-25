/**
 * YUJI's reader for one admitted Julius mission.
 *
 * The interface is `JuliusMissionEvidenceReader` from BRIDGE
 * `7e71a122` `relay-bridge/julius-mission-evidence.ts`:
 * `read(wljRunId)` returns the object `acceptJuliusMissionEvidence` accepts,
 * or null. This module does not copy that check, the test double, or the
 * Wonderland routes, and it does not call GitHub. The Actions read is the
 * injected {@link JuliusMissionGitHub}.
 *
 * Null is the fail-closed answer. Completion is `juliusFinalState: "COMPLETED"`
 * plus the spend tag whose `run` is the requested `wlj_` id, and only when
 * the tagged workflow run succeeded, its completion marker matches that run,
 * the evidence has one `RESULT: COMPLETED` line for this id, and `runs.tsv`
 * is absent or agrees. A missing section on that object is null.
 *
 * `traceId` is derived here from the admitted id. `acceptJuliusMissionEvidence`
 * derives it again and ignores this field. `traceparent` is null because the
 * mission is not a span.
 */

import { createHash } from 'node:crypto';

import { deriveJuliusSpentTag } from '../scripts/julius-admission-run-id.mjs';
import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import { projectJuliusSlotViews, type JuliusTimelineEntry } from '../src/relay/mission/julius/julius-runtime-api';

export const JULIUS_SPEND_TAG_SCHEMA = 'julius-run-spent.v1' as const;
const EVIDENCE_ARTIFACT = 'julius-live-evidence';
/** The grade job's own artifact. A verdict anywhere else is not read. */
const VERDICT_ARTIFACT = 'julius-inworld-verdict';
/** J1_PINNED_CHECKER_FILE_SHA256 (relay-bridge/julius-inworld-checker.ts), inlined so this reader does not reach the J1 dispatch modules. A test holds the two equal. */
const J1_PINNED_CHECKER_FILE_SHA256 = '1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e';

export const JULIUS_MISSION_PHASE_ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;
export type JuliusMissionPhaseRole = (typeof JULIUS_MISSION_PHASE_ROLES)[number];

export const JULIUS_MISSION_SLOT_STATES = ['NEVER_DISPATCHED', 'ACTIVE', 'IDLE', 'FAILED'] as const;
export type JuliusMissionSlotState = (typeof JULIUS_MISSION_SLOT_STATES)[number];

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

/** Cap reading of one verified tag. Present only when this reader can supply it. */
export interface JuliusMissionSpendAccounting {
  readonly knownUsdMicros: number | null;
  readonly unknownCostComponents: number | null;
  readonly unverifiableApiSpend: boolean | null;
  readonly spendVerified: boolean | null;
}

/** Settled coder cost. `costUsdMicros` null means the provider reported no bill. */
export interface JuliusMissionCoderCost {
  readonly costUsdMicros: number | null;
  readonly costBasis: JuliusMissionCoderCostBasis | null;
  readonly executionCostUsdMicros: number | null;
  readonly billingPath: JuliusMissionBillingPath | null;
}

/** Mission-level cost projection. `complete: false` means the total is a floor. */
export interface JuliusMissionCostEvidence {
  readonly knownUsdMicros: number | null;
  readonly unknownComponents: number | null;
  readonly complete: boolean | null;
}

/**
 * Provider receipt. `CAPTURED` is the provider `request_id` itself.
 * `providerMessageId` is not a field here: a message id does not capture a request.
 */
export interface JuliusMissionProviderReceipt {
  readonly providerRequestId: string | null;
  readonly responseId: string | null;
  readonly providerRequestAvailability: JuliusMissionRequestAvailability;
  readonly providerRequestUnavailableReason: string | null;
}

/** One file row from the paid-run archive. */
export interface JuliusMissionArchiveFile {
  readonly path: string;
  readonly sha256: string;
  readonly kind: JuliusMissionArchiveFileKind;
}

/** Archive columns for the run this reader matched. `conclusion` is the workflow conclusion. */
export interface JuliusMissionArchiveEvidence {
  readonly artifactName: string | null;
  readonly artifactDigest: string | null;
  readonly fileCount: number | null;
  readonly totalBytes: number | null;
  readonly conclusion: string | null;
  readonly failedSteps: readonly string[] | null;
  readonly files: readonly JuliusMissionArchiveFile[] | null;
}

/**
 * One C.A.R.D. peer. Repair is a `stage` on that peer, not a fourth role.
 * This reader does not supply `spanId` or `traceparent`. The bridge derives both.
 */
export interface JuliusMissionPhaseEvidence {
  readonly role: JuliusMissionPhaseRole;
  readonly state: JuliusMissionSlotState;
  readonly stage: JuliusMissionPhaseStage | null;
  readonly attempt: number | null;
  readonly spanId: string | null;
  readonly traceparent: string | null;
  readonly knownUsdMicros: number | null;
  readonly costComplete: boolean | null;
}

/**
 * What `read` returns for a run whose own record says COMPLETED.
 * Anything short of this shape is null, which is not completion.
 */
export interface JuliusMissionCompletionEvidence {
  readonly juliusFinalState: 'COMPLETED';
  readonly spendTag: JuliusMissionSpendTagEvidence;
  readonly spendAccounting: JuliusMissionSpendAccounting | null;
  readonly coderCost: JuliusMissionCoderCost | null;
  readonly missionCost: JuliusMissionCostEvidence | null;
  readonly providerReceipt: JuliusMissionProviderReceipt | null;
  readonly archive: JuliusMissionArchiveEvidence | null;
  readonly workArtifactRefs: readonly string[] | null;
  readonly projectBrainRevision: number | null;
  readonly phases: readonly JuliusMissionPhaseEvidence[] | null;
  readonly traceId: string | null;
  readonly traceparent: null;
  /**
   * The pinned hidden checker's verdict on this run, from the grade job. Absent,
   * unreadable, for another run, or any other token is NOT_RUN: never PASS.
   */
  readonly checkerVerdict: JuliusCheckerVerdict;
  readonly checker: JuliusCheckerEvidence | null;
}

export type JuliusCheckerVerdict = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface JuliusCheckerEvidence {
  readonly reason: string | null;
  readonly taskId: string | null;
  readonly judgedTrimmedSha256: string | null;
  readonly gameDigest: string | null;
  readonly checkerSha256: string | null;
}

/**
 * `read` matches the spend tag's `workflow_run_id` to the workflow run and
 * returns that run's completion evidence, or null when there is none.
 * Null is not completion. A thrown error is not completion.
 */
export interface JuliusMissionEvidenceReader {
  read(wljRunId: string): Promise<unknown>;
}

export const JULIUS_MISSION_WORKFLOW_STATUSES = ['queued', 'in_progress', 'completed'] as const;
export type JuliusMissionWorkflowStatus = (typeof JULIUS_MISSION_WORKFLOW_STATUSES)[number];

export const JULIUS_MISSION_WORKFLOW_CONCLUSIONS = [
  'success', 'failure', 'cancelled', 'timed_out', 'startup_failure', 'skipped', 'neutral', 'action_required', 'stale',
] as const;
export type JuliusMissionWorkflowConclusion = (typeof JULIUS_MISSION_WORKFLOW_CONCLUSIONS)[number];

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

function receiptFromRow(row: Record<string, string>): JuliusMissionProviderReceipt | null {
  const rawId = row.provider_request_id ?? '';
  const stated = oneOf(row.provider_request_availability ?? '', JULIUS_MISSION_REQUEST_AVAILABILITY);
  if (rawId.length === 0 && stated === null) return null;
  const shaped = rawId.length > 0 && credentialShaped(rawId);
  const requestId = rawId.length > 0 && !shaped ? plain(rawId, 200) : null;
  const captured = stated === 'CAPTURED' && requestId !== null;
  const responseRaw = row.response_id ?? '';
  const responseId = captured && responseRaw.length > 0 && !credentialShaped(responseRaw) ? plain(responseRaw, 200) : null;
  const statedReason = REASON.test(row.provider_request_unavailable_reason ?? '') ? row.provider_request_unavailable_reason : null;
  const reason = captured
    ? null
    : shaped
      ? 'provider_request_id_credential_shaped'
      : stated === 'CAPTURED'
        ? 'provider_request_id_unusable'
        : statedReason;
  return {
    providerRequestId: captured ? requestId : null,
    responseId,
    providerRequestAvailability: captured ? 'CAPTURED' : 'UNAVAILABLE',
    providerRequestUnavailableReason: reason,
  };
}

function coderReceipt(rows: readonly Record<string, string>[] | null): JuliusMissionProviderReceipt | null {
  if (rows === null) return null;
  const receipts: JuliusMissionProviderReceipt[] = [];
  for (const row of rows) {
    if (row.role !== 'CODING_AGENT') continue;
    const receipt = receiptFromRow(row);
    if (receipt !== null) receipts.push(receipt);
  }
  return receipts.length === 1 ? receipts[0] : null;
}

function coderCostFrom(rows: readonly Record<string, string>[] | null): JuliusMissionCoderCost | null {
  if (rows === null) return null;
  const coderRows = rows.filter((row) => row.role === 'CODING_AGENT');
  if (coderRows.length === 0) return null;
  const cost = (row: Record<string, string>): JuliusMissionCoderCost => ({
    costUsdMicros: row.cost_usd_micros === '' || row.cost_usd_micros === undefined ? null : nonNegative(row.cost_usd_micros),
    costBasis: oneOf(row.cost_basis ?? '', JULIUS_MISSION_CODER_COST_BASES),
    executionCostUsdMicros: row.execution_cost_usd_micros === '' || row.execution_cost_usd_micros === undefined ? null : nonNegative(row.execution_cost_usd_micros),
    billingPath: oneOf(row.billing_path ?? '', JULIUS_MISSION_BILLING_PATHS),
  });
  const first = cost(coderRows[0]);
  if (coderRows.some((row) => JSON.stringify(cost(row)) !== JSON.stringify(first))) return null;
  if (first.costUsdMicros === null && first.costBasis === null && first.executionCostUsdMicros === null && first.billingPath === null) return null;
  return first;
}

function missionCostFrom(text: string | null, runId: string): JuliusMissionCostEvidence | null {
  const rows = rowsForRun(text, runId);
  if (rows === null || rows.length === 0) return null;
  let known = 0;
  let unknown = 0;
  let estimated = 0;
  let unsettled = 0;
  for (const row of rows) {
    const knownCell = nonNegative(row.known_usd_micros ?? '');
    const unknownCell = nonNegative(row.unknown_components ?? '');
    const estimatedCell = nonNegative(row.estimated_components ?? '');
    const unsettledCell = nonNegative(row.unsettled_components ?? '');
    if (knownCell === null || unknownCell === null || estimatedCell === null || unsettledCell === null) return null;
    known += knownCell;
    unknown += unknownCell;
    estimated += estimatedCell;
    unsettled += unsettledCell;
  }
  if (!Number.isSafeInteger(known)) return null;
  return { knownUsdMicros: known, unknownComponents: unknown, complete: unknown === 0 && estimated === 0 && unsettled === 0 };
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

function markerAgrees(artifact: JuliusMissionWorkflowArtifact | undefined, tag: JuliusMissionSpendTagEvidence): boolean {
  if (artifact === undefined || artifact.name !== `${tag.namespace}-completed`) return false;
  const text = fileText(artifact, 'marker.txt');
  if (text === null) return false;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 4) return false;
  const fields = new Map<string, string>();
  for (const line of lines) {
    const cut = line.indexOf('=');
    if (cut <= 0) return false;
    fields.set(line.slice(0, cut), line.slice(cut + 1));
  }
  const completedAt = fields.get('completed_at');
  const workflowRef = fields.get('workflow_ref');
  if (completedAt === undefined || !STAMP.test(completedAt)) return false;
  if (fields.get('run_id') !== tag.workflowRunId || fields.get('commit') !== tag.headSha) return false;
  return workflowRef !== undefined && plain(workflowRef, 300) === workflowRef;
}

function resultCompleted(text: string | null, runId: string): boolean {
  if (text === null) return false;
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, ''));
  let count = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (!line.startsWith('RESULT: ') || lines[index + 1] !== `  run: ${runId}`) continue;
    const word = line.slice('RESULT: '.length).split(' ')[0] ?? '';
    if (word === 'COMPLETED') count += 1;
  }
  return count === 1;
}

function evidenceFiles(artifact: JuliusMissionWorkflowArtifact | undefined): readonly JuliusMissionArchiveFile[] | null {
  if (artifact?.files == null) return null;
  return artifact.files.map((file) => ({
    path: file.path,
    sha256: sha256(file.text),
    kind: file.path.endsWith('.tsv') ? 'table' as const : 'text' as const,
  }));
}

const SLOT_EVENT_COLUMNS = [
  'run_id', 'sequence', 'event_id', 'event_type', 'task_id', 'worker_id', 'role',
  'cost_basis', 'usd_micros', 'reservation_id', 'failure_class', 'provider', 'provider_id',
  'requested_model', 'served_model', 'stage', 'attempt', 'occurred_at',
] as const;

/**
 * Slot rows from `slot-events.tsv`. The file is every `julius.*` event in ledger
 * order. `projectJuliusSlotViews` is the projection; this function only restores
 * the integer `usdMicros` psql stringified and reads stage and attempt off the
 * same rows. A missing file, the word `unavailable`, a drifted header, a repeated
 * sequence, or a non-integer `usd_micros` or `attempt` is null. A header and no
 * rows is the projection of an empty ledger. A stage outside the four phase words
 * is a real fact and leaves the list intact.
 */
function phasesFrom(text: string | null, runId: string): readonly JuliusMissionPhaseEvidence[] | null {
  if (text === null || text.trim() === 'unavailable') return null;
  const table = parseTable(text);
  if (table === null || SLOT_EVENT_COLUMNS.some((column) => !table.columns.includes(column))) return null;
  const rows = table.rows.filter((row) => row.run_id === runId);
  const seen = new Set<string>();
  const entries: JuliusTimelineEntry[] = [];
  const stageOf = new Map<JuliusMissionPhaseRole, JuliusMissionPhaseStage>();
  const attemptOf = new Map<JuliusMissionPhaseRole, number>();
  const roleOfTask = new Map<string, JuliusMissionPhaseRole>();
  const ordered = [...rows].sort((left, right) => (nonNegative(left.sequence ?? '') ?? 0) - (nonNegative(right.sequence ?? '') ?? 0));
  for (const row of ordered) {
    const sequence = nonNegative(row.sequence ?? '');
    if (sequence === null || sequence < 1 || seen.has(row.sequence)) return null;
    seen.add(row.sequence);
    if (!row.event_type.startsWith('julius.') || row.event_type.length === 'julius.'.length) return null;
    const usd = row.usd_micros === '' ? null : nonNegative(row.usd_micros);
    if (row.usd_micros !== '' && usd === null) return null;
    const attempt = row.attempt === '' ? null : nonNegative(row.attempt);
    if (row.attempt !== '' && attempt === null) return null;
    const stated = (JULIUS_MISSION_PHASE_ROLES as readonly string[]).includes(row.role) ? row.role as JuliusMissionPhaseRole : null;
    const taskId = row.task_id === '' ? null : row.task_id;
    const role = stated ?? (taskId === null ? null : roleOfTask.get(taskId) ?? null);
    if (role !== null && taskId !== null) roleOfTask.set(taskId, role);
    const stage = oneOf(row.stage, JULIUS_MISSION_PHASE_STAGES);
    if (role !== null && stage !== null) stageOf.set(role, stage);
    if (role !== null && attempt !== null) attemptOf.set(role, attempt);
    const facts: Record<string, string | number | boolean | null> = {};
    const textFact = (key: string, value: string): void => {
      if (value !== '') facts[key] = value;
    };
    textFact('role', row.role);
    textFact('costBasis', row.cost_basis);
    if (usd !== null) facts.usdMicros = usd;
    textFact('reservationId', row.reservation_id);
    textFact('failureClass', row.failure_class);
    textFact('provider', row.provider);
    textFact('providerId', row.provider_id);
    textFact('requestedModel', row.requested_model);
    textFact('servedModel', row.served_model);
    entries.push({
      eventId: row.event_id === '' ? `sequence:${row.sequence}` : row.event_id,
      sequence,
      type: row.event_type.slice('julius.'.length),
      taskId,
      workerId: row.worker_id === '' ? null : row.worker_id,
      occurredAt: row.occurred_at,
      facts,
    });
  }
  return projectJuliusSlotViews(entries).map((slot): JuliusMissionPhaseEvidence => ({
    role: slot.role,
    state: slot.state,
    stage: stageOf.get(slot.role) ?? null,
    attempt: attemptOf.get(slot.role) ?? null,
    spanId: null,
    traceparent: null,
    knownUsdMicros: slot.knownUsdMicros,
    costComplete: slot.costComplete,
  }));
}

/**
 * `julius_runs.project_brain_revision` from `runs.tsv`. `0` is the stored counter.
 * A missing file, a header without the column, an empty cell, or a non-integer is
 * null. This does not read `project-brain.tsv`.
 */
function brainRevision(text: string | null, runId: string): number | null {
  if (text === null) return null;
  const rows = rowsForRun(text, runId);
  if (rows === null || rows.length !== 1) return null;
  const cell = rows[0].project_brain_revision;
  if (cell === undefined || cell === '') return null;
  return nonNegative(cell);
}

function archiveFrom(evidence: JuliusMissionWorkflowArtifact | undefined, run: JuliusMissionWorkflowRun): JuliusMissionArchiveEvidence | null {
  if (evidence === undefined) return null;
  const files = evidenceFiles(evidence);
  return {
    artifactName: evidence.name,
    artifactDigest: files === null ? null : bundleDigest(files),
    fileCount: files === null ? null : files.length,
    totalBytes: evidence.files === null ? null : evidence.files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0),
    conclusion: run.conclusion,
    failedSteps: run.failedSteps,
    files,
  };
}

export function createJuliusMissionEvidenceReader(github: JuliusMissionGitHub): JuliusMissionEvidenceReader {
  return {
    async read(wljRunId: string): Promise<unknown> {
      const derived = deriveJuliusSpentTag(wljRunId);
      if (!derived.ok || derived.form !== 'wlj') return null;
      let message: string | null;
      try {
        message = await github.readAnnotatedTagMessage(derived.tag);
      } catch {
        return null;
      }
      if (message === null) return null;
      const spendTag = parseSpendTag(message, derived.runId);
      if (spendTag === null) return null;
      let observed: JuliusMissionWorkflowRun | null;
      try {
        observed = normalizeRun(await github.readWorkflowRun(spendTag.workflowRunId, spendTag.workflowRunAttempt));
      } catch {
        return null;
      }
      if (observed === null
        || observed.workflowRunId !== spendTag.workflowRunId
        || observed.workflowRunAttempt !== spendTag.workflowRunAttempt
        || observed.headSha !== spendTag.headSha
        || observed.status !== 'completed'
        || observed.conclusion !== 'success') {
        return null;
      }
      const evidence = observed.artifacts.find((artifact) => artifact.name === EVIDENCE_ARTIFACT);
      const marker = observed.artifacts.find((artifact) => artifact.name === `${spendTag.namespace}-completed`);
      if (!markerAgrees(marker, spendTag)) return null;
      if (!resultCompleted(fileText(evidence, 'live-mission.evidence.txt'), derived.runId)) return null;
      if (!runtimeAgrees(fileText(evidence, 'runs.tsv'), derived.runId)) return null;
      const diagnosticRows = rowsForRun(fileText(evidence, 'worker-diagnostics.tsv'), derived.runId);
      const runsText = fileText(evidence, 'runs.tsv');
      const completion: JuliusMissionCompletionEvidence = {
        juliusFinalState: 'COMPLETED',
        spendTag,
        // The admission step writes this run's seven-line reservation and does not
        // compute knownUsdMicros, unknownCostComponents, unverifiableApiSpend, or
        // spendVerified. cost-accounting.tsv is missionCost. The reservation is
        // spendTag.reservedUsdMicros.
        spendAccounting: null,
        coderCost: coderCostFrom(diagnosticRows),
        missionCost: missionCostFrom(fileText(evidence, 'cost-accounting.tsv'), derived.runId),
        providerReceipt: coderReceipt(diagnosticRows),
        archive: archiveFrom(evidence, observed),
        workArtifactRefs: workRefsFrom(fileText(evidence, 'evidence.tsv'), derived.runId),
        projectBrainRevision: brainRevision(runsText, derived.runId),
        phases: phasesFrom(fileText(evidence, 'slot-events.tsv'), derived.runId),
        traceId: juliusMissionTraceId(derived.runId),
        traceparent: null,
        ...checkerVerdictFrom(
          fileText(observed.artifacts.find((artifact) => artifact.name === VERDICT_ARTIFACT), 'checker-verdict.txt'),
          derived.runId,
          (taskId, contextId) => publishedFinalMessageSha256(fileText(evidence, `${taskId.replace(/:/gu, '_')}.${contextId.replace(/:/gu, '_')}.redacted.json`), taskId, contextId, derived.runId),
        ),
      };
      return completion;
    },
  };
}

const VERDICT_SHA = /^[0-9a-f]{64}$/u;
const VERDICT_DIGEST = /^[0-9a-f]{12}$/u;
const VERDICT_TOKEN = /^[a-z_]{1,64}$/u;
const VERDICT_TASK = /^[A-Za-z0-9:_-]{1,128}$/u;

/** checker-verdict.txt (scripts/julius-inworld-grade.mjs): closed `key=value` lines. */
export function checkerVerdictFrom(
  text: string | null,
  runId: string,
  /** The trimmed sha256 the run's own published final-message record holds for a task and context, or null. */
  publishedSha256: (taskId: string, contextId: string) => string | null = () => null,
): { readonly checkerVerdict: JuliusCheckerVerdict; readonly checker: JuliusCheckerEvidence | null } {
  const notRun = { checkerVerdict: 'NOT_RUN' as const, checker: null };
  if (text === null) return notRun;
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at);
    if (fields.has(key)) return notRun;
    fields.set(key, line.slice(at + 1).replace(/\r$/u, ''));
  }
  if (fields.get('schema') !== 'julius-inworld-verdict.v1' || fields.get('run_id') !== runId) return notRun;
  const verdict = fields.get('verdict');
  const known = (value: string | undefined, shape: RegExp): string | null => (value !== undefined && shape.test(value) ? value : null);
  const checker: JuliusCheckerEvidence = {
    reason: known(fields.get('reason'), VERDICT_TOKEN),
    taskId: known(fields.get('task_id'), VERDICT_TASK),
    judgedTrimmedSha256: known(fields.get('judged_trimmed_sha256'), VERDICT_SHA),
    gameDigest: known(fields.get('game_digest'), VERDICT_DIGEST),
    checkerSha256: known(fields.get('checker_sha256'), VERDICT_SHA),
  };
  if (verdict === 'PASS' || verdict === 'FAIL') {
    // A PASS or FAIL names what was judged. Without those hashes it is not a verdict.
    if (checker.judgedTrimmedSha256 === null || checker.checkerSha256 === null || checker.gameDigest !== checker.judgedTrimmedSha256.slice(0, 12)) return notRun;
    // Only the pinned hidden checker's verdict counts, on the bytes the run itself published.
    if (checker.checkerSha256 !== J1_PINNED_CHECKER_FILE_SHA256) return { checkerVerdict: 'NOT_RUN', checker };
    const contextId = known(fields.get('context_id'), VERDICT_TASK);
    if (checker.taskId === null || contextId === null || publishedSha256(checker.taskId, contextId) !== checker.judgedTrimmedSha256) {
      return { checkerVerdict: 'NOT_RUN', checker };
    }
    return { checkerVerdict: verdict, checker };
  }
  return { checkerVerdict: 'NOT_RUN', checker };
}

/** The trimmed sha256 a published `<task>.<context>.redacted.json` records, when it names this run, task and context. */
function publishedFinalMessageSha256(text: string | null, taskId: string, contextId: string, runId: string): string | null {
  if (text === null) return null;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  const record = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (record === null || record.schema !== 'julius-final-message.v2' || record.taskId !== taskId || record.contextId !== contextId || record.runId !== runId) return null;
  return typeof record.trimmedSha256 === 'string' && VERDICT_SHA.test(record.trimmedSha256) ? record.trimmedSha256 : null;
}
