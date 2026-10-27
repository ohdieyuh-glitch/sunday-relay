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
export const EVIDENCE_ARTIFACT = 'julius-live-evidence';
/** The grade job's own artifact. A verdict anywhere else is not read. */
export const VERDICT_ARTIFACT = 'julius-inworld-verdict';
/** The grade job's one step that exits with the checker's status (julius-first-live-mission.yml). */
const GRADE_STEP = 'J1: stage the pinned checker from git objects and grade';
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
  /**
   * When the matched Actions run was created: GitHub's `created_at`, ISO UTC,
   * read off the run this reader matched to `workflowRunId`. The bridge needs it
   * to show the operator's dispatch came first. A run without it is not completion.
   */
  readonly workflowRunCreatedAt: string;
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
/**
 * Julius's own record that a provider request may have been processed and
 * its outcome is unknown, so the task was failed and never retried. These
 * are the record's causes. Any other value is not this.
 */
export const JULIUS_OUTCOME_UNKNOWN_CAUSES = ['HANDED_OUTCOME_UNKNOWN', 'HANDED_TIMEOUT_OUTCOME_UNKNOWN', 'HANDED_FAILURE_OUTCOME_UNKNOWN'] as const;
export type JuliusOutcomeUnknownCause = (typeof JULIUS_OUTCOME_UNKNOWN_CAUSES)[number];

export interface JuliusMissionEvidenceReader {
  read(wljRunId: string): Promise<unknown>;
  readOutcomeUnknown?(wljRunId: string): Promise<unknown>;
}

/**
 * The first ambiguous provider outcome Julius recorded for `runId` in
 * `failures.tsv`: the recovery sweep's FAIL_TASK, or a task.failed, whose
 * reason code (or code or failure class) is one of `causes`. Null when the
 * table is missing, malformed, or names none.
 */
export function outcomeUnknownFrom(
  text: string | null,
  runId: string,
  causes: readonly string[],
): { readonly cause: string; readonly role: string | null; readonly taskId: string | null } | null {
  const rows = rowsForRun(text, runId);
  if (rows === null) return null;
  for (const row of rows) {
    const cause = [row.reason_code, row.julius_code, row.failure_class].find((value) => value !== undefined && causes.includes(value));
    if (cause === undefined) continue;
    const recovered = row.event_type === 'julius.recovery.action' && row.recovery_action === 'FAIL_TASK';
    if (!recovered && row.event_type !== 'julius.task.failed') continue;
    return { cause, role: row.role === undefined || row.role === '' ? null : row.role, taskId: row.task_id === undefined || row.task_id === '' ? null : row.task_id };
  }
  return null;
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
  /** GitHub's `created_at` for this run attempt, ISO UTC. Null when the read did not carry it. */
  readonly createdAt: string | null;
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

/** The run fields the result record is bound on (the gh port's `JuliusRunSummary` is a superset). */
export interface JuliusMissionRunSummary {
  readonly id: string;
  readonly attempt: number;
  readonly status: string;
  readonly conclusion: string | null;
  readonly event: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly path: string;
}

/** One job of one run attempt, names and states only (the gh port's `JuliusRunJob` is a superset). */
export interface JuliusMissionRunJob {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly steps: readonly { readonly name: string; readonly status: string; readonly conclusion: string | null }[];
}

/** One commit status (the gh port's `JuliusCommitStatus` is a superset). */
export interface JuliusMissionCommitStatus {
  readonly context: string;
  readonly state: string;
  readonly description: string;
  readonly creator: string;
  readonly targetUrl?: string | null;
}

/**
 * THE RUN'S OWN RECORD, for the result tag (X′ §4): the run, its jobs and its
 * commit statuses, read-only. The same port the live events route reads.
 */
export interface JuliusMissionRunRecords {
  readRun(workflowRunId: string): Promise<JuliusMissionRunSummary | null>;
  readRunJobs(workflowRunId: string, attempt: number): Promise<readonly JuliusMissionRunJob[] | null>;
  readCommitStatuses(sha: string): Promise<readonly JuliusMissionCommitStatus[] | null>;
}

const NAMESPACE = /^[a-z][a-z0-9-]{2,48}$/u;
const DIGITS = /^[1-9][0-9]{0,19}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
/** GitHub's created_at shape: second precision, Z. Anything else is not a time this reader trusts. */
const CREATED_AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u;
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

/** The tag message carries no run time; `workflowRunCreatedAt` is added from the matched run. */
function parseSpendTag(message: string, runId: string): Omit<JuliusMissionSpendTagEvidence, 'workflowRunCreatedAt'> | null {
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
  const createdAt = typeof value.createdAt === 'string' && CREATED_AT.test(value.createdAt) && !Number.isNaN(Date.parse(value.createdAt))
    ? value.createdAt : null;
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
    createdAt,
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

function markerAgrees(artifact: JuliusMissionWorkflowArtifact | undefined, tag: Omit<JuliusMissionSpendTagEvidence, 'workflowRunCreatedAt'>): boolean {
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

export function createJuliusMissionEvidenceReader(github: JuliusMissionGitHub, records?: JuliusMissionRunRecords): JuliusMissionEvidenceReader {
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
        || observed.status !== 'completed') {
        return null;
      }
      // THE ARTIFACT PATH WINS WHEN ITS ARTIFACTS ARE THERE. Only a finished run whose evidence
      // bundle or verdict artifact is absent (X′: uploads refused under the billing lock) is read
      // from the result record, and only when every binding in readBoundResultRecord holds.
      const present = (name: string): boolean => observed.artifacts.some((artifact) => artifact.name === name && artifact.files !== null);
      if ((present(EVIDENCE_ARTIFACT) && present(VERDICT_ARTIFACT)) || records === undefined) {
        return completionFromArtifacts(observed, spendTag, derived.runId);
      }
      const bound = await readBoundResultRecord(github, records, spendTag, derived.runId);
      const viaRecord = bound === null || observed.createdAt === null ? null : completionFromRecord(bound, spendTag, observed.createdAt, derived.runId);
      return viaRecord ?? completionFromArtifacts(observed, spendTag, derived.runId);
    },

    /**
     * The same spend-tag binding as `read`, for a FINISHED run of any
     * conclusion: a run that stopped on an unknown outcome did not succeed.
     * X′: when the run has no evidence artifact, the bound result record is read.
     */
    async readOutcomeUnknown(wljRunId: string): Promise<unknown> {
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
        || observed.status !== 'completed') {
        return null;
      }
      const evidence = observed.artifacts.find((artifact) => artifact.name === EVIDENCE_ARTIFACT);
      if (evidence?.files != null || records === undefined) {
        const found = outcomeUnknownFrom(fileText(evidence, 'failures.tsv'), derived.runId, JULIUS_OUTCOME_UNKNOWN_CAUSES);
        return found === null ? null : { ...found, workflowRunId: observed.workflowRunId };
      }
      const bound = await readBoundResultRecord(github, records, spendTag, derived.runId);
      // The run's own jobs must say LIVE failed: the record's word alone is not an outcome.
      if (bound === null || bound.record.outcomeUnknown === null || !bound.liveFailed) return null;
      return { ...bound.record.outcomeUnknown, workflowRunId: observed.workflowRunId };
    },
  };
}

/** Today's reading: the spend tag's run, its completion marker and its evidence and verdict artifacts. */
function completionFromArtifacts(
  observed: JuliusMissionWorkflowRun,
  spendTag: Omit<JuliusMissionSpendTagEvidence, 'workflowRunCreatedAt'>,
  runId: string,
): JuliusMissionCompletionEvidence | null {
  // A graded FAIL fails the grade job, and so the run. That run is read only when the
  // grade step is the one thing that failed, and is returned only if its verdict is FAIL.
  const gradedFailure = observed.conclusion === 'failure'
    && observed.failedSteps.length > 0
    && observed.failedSteps.every((step) => step === GRADE_STEP);
  if (observed.conclusion !== 'success' && !gradedFailure) return null;
  const evidence = observed.artifacts.find((artifact) => artifact.name === EVIDENCE_ARTIFACT);
  const marker = observed.artifacts.find((artifact) => artifact.name === `${spendTag.namespace}-completed`);
  if (!markerAgrees(marker, spendTag)) return null;
  if (!resultCompleted(fileText(evidence, 'live-mission.evidence.txt'), runId)) return null;
  if (!runtimeAgrees(fileText(evidence, 'runs.tsv'), runId)) return null;
  const diagnosticRows = rowsForRun(fileText(evidence, 'worker-diagnostics.tsv'), runId);
  const runsText = fileText(evidence, 'runs.tsv');
  // The bridge binds the evidence to the operator's dispatch by the run's creation time.
  // A run whose read carried none is not completion: unknown is not a time.
  if (observed.createdAt === null) return null;
  const completion: JuliusMissionCompletionEvidence = {
    juliusFinalState: 'COMPLETED',
    spendTag: { ...spendTag, workflowRunCreatedAt: observed.createdAt },
    // The admission step writes this run's seven-line reservation and does not
    // compute knownUsdMicros, unknownCostComponents, unverifiableApiSpend, or
    // spendVerified. cost-accounting.tsv is missionCost. The reservation is
    // spendTag.reservedUsdMicros.
    spendAccounting: null,
    coderCost: coderCostFrom(diagnosticRows),
    missionCost: missionCostFrom(fileText(evidence, 'cost-accounting.tsv'), runId),
    providerReceipt: coderReceipt(diagnosticRows),
    archive: archiveFrom(evidence, observed),
    workArtifactRefs: workRefsFrom(fileText(evidence, 'evidence.tsv'), runId),
    projectBrainRevision: brainRevision(runsText, runId),
    phases: phasesFrom(fileText(evidence, 'slot-events.tsv'), runId),
    traceId: juliusMissionTraceId(runId),
    traceparent: null,
    ...checkerVerdictFrom(
      fileText(observed.artifacts.find((artifact) => artifact.name === VERDICT_ARTIFACT), 'checker-verdict.txt'),
      runId,
      (taskId, contextId) => publishedFinalMessageSha256(fileText(evidence, `${taskId.replace(/:/gu, '_')}.${contextId.replace(/:/gu, '_')}.redacted.json`), taskId, contextId, runId),
    ),
  };
  // Anything but a FAIL verdict on a run the grade failed is not this run's outcome.
  if (gradedFailure && completion.checkerVerdict !== 'FAIL') return null;
  return completion;
}

/* ------------------------------------------------------------------------------------------------
 * X′ §4: THE RESULT RECORD, when the artifacts are absent.
 *
 * The grade job's record step writes the annotated tag
 * refs/tags/julius-run-record-<suffix>-result (closed julius-run-result.v1 lines, no model text)
 * and ONE `julius-run-result` commit status on head_sha whose description is
 * `v1 sha256:<sha256 of the tag body>`. Neither is run-bound on its own: any workflow in this
 * repository whose job token has contents: write and statuses: write can write both with a
 * self-chosen body and target_url. So the reading is bound to the run the PROTECTED SPEND TAG
 * names, through that run's own jobs (which no other run can write):
 *   (i)   the run at the spend tag's workflow_run_id: the paid workflow's path, attempt 1, the
 *         spend tag's head, event workflow_dispatch, branch main, completed;
 *   (ii)  PASS only when the grade job and its GRADE_STEP concluded success, its PASS step
 *         concluded success AND its FAIL step was skipped, and the LIVE job and step succeeded;
 *   (iii) FAIL only when the grade job and GRADE_STEP concluded success, its FAIL step concluded
 *         success AND its PASS step was skipped (REVIEW ruling D-b: symmetric);
 *   (iv)  anything else is NOT_RUN (unverified), whatever the tag says;
 *   (v)   the tag and status hash checks hold as well.
 * Completion itself needs the LIVE job AND its LIVE step to have concluded success.
 * ---------------------------------------------------------------------------------------------- */

export const JULIUS_RUN_RESULT_SCHEMA = 'julius-run-result.v1';
export const JULIUS_RUN_RESULT_CONTEXT = 'julius-run-result';
const PAID_WORKFLOW_PATH = '.github/workflows/julius-first-live-mission.yml';
const LIVE_JOB = 'Preflight, then the live mission';
const LIVE_STEP = 'LIVE: run the first real Julius mission';
const GRADE_JOB = 'J1: grade the final message with the pinned hidden checker';
/** Runs only when the pinned checker's own verdict file says PASS (julius-first-live-mission.yml). */
const PASS_STEP = "J1: the pinned checker's verdict is PASS";
/** Runs only when the pinned checker's own verdict file says FAIL. */
const FAIL_STEP = "J1: the pinned checker's verdict is FAIL";
const STATUS_BOT = 'github-actions[bot]';
const RESULT_KEYS = [
  'run', 'namespace', 'workflow_run_id', 'workflow_run_attempt', 'head_sha', 'final_state', 'completed_at', 'verdict',
  'checker_sha256', 'combined_pin_sha256', 'judged_trimmed_sha256', 'published_trimmed_sha256', 'final_message_sha256',
  'outcome_unknown', 'cost_basis', 'usd_micros', 'grader_sha256', 'node_sha256', 'node_version',
] as const;
/**
 * J1_GRADE_PINS.combinedSha256 (scripts/julius-inworld-grade.mjs), inlined like the checker pin; a drift test
 * holds the two equal. Every staged grading input (contract, checker, oracle, seed) is in this one digest.
 */
export const J1_GRADE_COMBINED_PIN_SHA256 = '0ca020dbfd2f971a8c112444961aa57ea0d113b0c1d86336f420fcae126eafd3';
const NODE_VERSION = /^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/u;
const SHA_OR_NONE = /^(?:[0-9a-f]{64}|none)$/u;
const OUTCOME_ROLE = /^[A-Z_]{1,40}$/u;
const OUTCOME_TASK = /^[A-Za-z0-9:_-]{1,128}$/u;
const TARGET_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/([1-9][0-9]{0,19})$/u;

export interface JuliusRunResultRecord {
  readonly run: string;
  readonly namespace: string;
  readonly workflowRunId: string;
  readonly workflowRunAttempt: string;
  readonly headSha: string;
  readonly finalState: 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
  readonly completedAt: string | null;
  readonly verdict: JuliusCheckerVerdict;
  readonly checkerSha256: string | null;
  readonly combinedPinSha256: string | null;
  readonly judgedTrimmedSha256: string | null;
  readonly publishedTrimmedSha256: string | null;
  readonly finalMessageSha256: string | null;
  readonly outcomeUnknown: { readonly cause: JuliusOutcomeUnknownCause; readonly role: string | null; readonly taskId: string | null } | null;
  readonly costBasis: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  readonly usdMicros: number | null;
  /** The grader's own sha256 as it ran (scripts/julius-inworld-grade.mjs at the run's commit), recorded. */
  readonly graderSha256: string | null;
  /** The node binary the grade job ran, recorded (no pin): its sha256 and `node --version`. */
  readonly nodeSha256: string | null;
  readonly nodeVersion: string | null;
}

/**
 * BYTE-EXACT (REVIEW finding X-3). The record step writes every line ended by exactly one `\n` and nothing
 * else; the git tag object stores the message as given, so the message read back must be those bytes. Nothing
 * is normalized: a carriage return, a missing final newline, or a trailing blank line is not this record.
 */
export function juliusRunResultBodyIsExact(message: string): boolean {
  return message.endsWith('\n') && !message.endsWith('\n\n') && !message.includes('\r');
}

/** julius-run-result.v1, closed: every key once, in order, every value in its shape. Null is not a record. */
export function parseJuliusRunResultRecord(message: string): JuliusRunResultRecord | null {
  if (!juliusRunResultBodyIsExact(message)) return null;
  const lines = message.split('\n');
  lines.pop();
  if (lines.length !== RESULT_KEYS.length + 1 || lines[0] !== JULIUS_RUN_RESULT_SCHEMA) return null;
  const field = new Map<string, string>();
  for (const [index, key] of RESULT_KEYS.entries()) {
    const line = lines[index + 1] ?? '';
    if (!line.startsWith(`${key}=`)) return null;
    field.set(key, line.slice(key.length + 1));
  }
  const get = (key: (typeof RESULT_KEYS)[number]): string => field.get(key) ?? '';
  const sha = (key: (typeof RESULT_KEYS)[number]): string | null | undefined => {
    const value = get(key);
    return SHA_OR_NONE.test(value) ? (value === 'none' ? null : value) : undefined;
  };
  const finalState = get('final_state');
  const verdict = get('verdict');
  const completedAt = get('completed_at');
  const costBasis = get('cost_basis');
  const usd = get('usd_micros');
  if (!NAMESPACE.test(get('namespace')) || !DIGITS.test(get('workflow_run_id')) || !DIGITS.test(get('workflow_run_attempt')) || !SHA40.test(get('head_sha'))) return null;
  if (finalState !== 'COMPLETED' && finalState !== 'FAILED' && finalState !== 'INTERRUPTED') return null;
  if (verdict !== 'PASS' && verdict !== 'FAIL' && verdict !== 'NOT_RUN') return null;
  if (completedAt !== 'none' && !STAMP.test(completedAt)) return null;
  if ((finalState === 'COMPLETED') !== (completedAt !== 'none')) return null;
  if (costBasis !== 'COMPLETE' && costBasis !== 'PARTIAL' && costBasis !== 'UNKNOWN') return null;
  const usdMicros = usd === 'UNKNOWN' ? null : nonNegative(usd);
  if ((usdMicros === null) !== (costBasis === 'UNKNOWN') || (usd !== 'UNKNOWN' && usdMicros === null)) return null;
  const hashes = ['checker_sha256', 'combined_pin_sha256', 'judged_trimmed_sha256', 'published_trimmed_sha256', 'final_message_sha256'] as const;
  const read = hashes.map(sha);
  if (read.some((value) => value === undefined)) return null;
  const [checkerSha256, combinedPinSha256, judgedTrimmedSha256, publishedTrimmedSha256, finalMessageSha256] = read as (string | null)[];
  const graderSha256 = sha('grader_sha256');
  const nodeSha256 = sha('node_sha256');
  const nodeVersion = get('node_version');
  if (graderSha256 === undefined || nodeSha256 === undefined || (nodeVersion !== 'none' && !NODE_VERSION.test(nodeVersion))) return null;
  const unknownRaw = get('outcome_unknown');
  let outcomeUnknown: JuliusRunResultRecord['outcomeUnknown'] = null;
  if (unknownRaw !== 'none') {
    const [cause, role, task, extra] = unknownRaw.split('/');
    if (extra !== undefined || cause === undefined || role === undefined || task === undefined) return null;
    if (!(JULIUS_OUTCOME_UNKNOWN_CAUSES as readonly string[]).includes(cause)) return null;
    if (role !== 'none' && !OUTCOME_ROLE.test(role)) return null;
    if (task !== 'none' && !OUTCOME_TASK.test(task)) return null;
    outcomeUnknown = { cause: cause as JuliusOutcomeUnknownCause, role: role === 'none' ? null : role, taskId: task === 'none' ? null : task };
  }
  return {
    run: get('run'),
    namespace: get('namespace'),
    workflowRunId: get('workflow_run_id'),
    workflowRunAttempt: get('workflow_run_attempt'),
    headSha: get('head_sha'),
    finalState,
    completedAt: completedAt === 'none' ? null : completedAt,
    verdict,
    checkerSha256: checkerSha256 ?? null,
    combinedPinSha256: combinedPinSha256 ?? null,
    judgedTrimmedSha256: judgedTrimmedSha256 ?? null,
    publishedTrimmedSha256: publishedTrimmedSha256 ?? null,
    finalMessageSha256: finalMessageSha256 ?? null,
    outcomeUnknown,
    costBasis,
    usdMicros,
    graderSha256,
    nodeSha256,
    nodeVersion: nodeVersion === 'none' ? null : nodeVersion,
  };
}

interface BoundResultRecord {
  readonly record: JuliusRunResultRecord;
  /** The verdict the run's OWN jobs allow: PASS or FAIL only as (ii) and (iii) say, otherwise NOT_RUN. */
  readonly verdict: JuliusCheckerVerdict;
  /** The LIVE job and its LIVE step concluded success. */
  readonly completed: boolean;
  /** The LIVE job and its LIVE step concluded failure. */
  readonly liveFailed: boolean;
}

function onlyOne<T>(items: readonly T[], match: (item: T) => boolean): T | null {
  const found = items.filter(match);
  return found.length === 1 ? found[0] as T : null;
}

/**
 * The result record of the run the SPEND TAG names, or null. The run id and attempt are the spend
 * tag's, never the result tag's. Every read that throws is null: unverified, never a guess.
 */
async function readBoundResultRecord(
  github: JuliusMissionGitHub,
  records: JuliusMissionRunRecords,
  spendTag: Omit<JuliusMissionSpendTagEvidence, 'workflowRunCreatedAt'>,
  runId: string,
): Promise<BoundResultRecord | null> {
  const derived = deriveJuliusSpentTag(runId);
  if (!derived.ok) return null;
  // (i) The run itself, at the spend tag's id: the paid workflow, attempt 1, the tag's head, dispatched on main.
  if (spendTag.workflowRunAttempt !== '1') return null;
  let run: JuliusMissionRunSummary | null;
  let jobs: readonly JuliusMissionRunJob[] | null;
  let message: string | null;
  let statuses: readonly JuliusMissionCommitStatus[] | null;
  try {
    run = await records.readRun(spendTag.workflowRunId);
    if (run === null || run.id !== spendTag.workflowRunId || run.attempt !== 1 || run.headSha !== spendTag.headSha
      || run.path !== PAID_WORKFLOW_PATH || run.event !== 'workflow_dispatch' || run.headBranch !== 'main' || run.status !== 'completed') {
      return null;
    }
    jobs = await records.readRunJobs(spendTag.workflowRunId, 1);
    message = await github.readAnnotatedTagMessage(`refs/tags/julius-run-record-${derived.suffix}-result`);
    statuses = await records.readCommitStatuses(spendTag.headSha);
  } catch {
    return null;
  }
  if (jobs === null || message === null || statuses === null) return null;
  const record = parseJuliusRunResultRecord(message);
  if (record === null) return null;
  // The record names exactly the spend tag's run.
  if (record.run !== runId || record.namespace !== spendTag.namespace || record.workflowRunId !== spendTag.workflowRunId
    || record.workflowRunAttempt !== spendTag.workflowRunAttempt || record.headSha !== spendTag.headSha) {
    return null;
  }
  // (v) Exactly one julius-run-result status on the head, from the job token, naming this run, over these bytes.
  // X-1: ANOTHER RUN at the same head may post its own julius-run-result. Only the statuses from the job
  // token that name THIS run (the spend tag's) AND carry THIS body's digest are candidates, and exactly one
  // must remain: two candidates, or none, is unverified.
  const description = `v1 sha256:${sha256(message)}`;
  const candidates = statuses.filter((entry) => entry.context === JULIUS_RUN_RESULT_CONTEXT && entry.creator === STATUS_BOT
    && TARGET_URL.exec(entry.targetUrl ?? '')?.[1] === spendTag.workflowRunId && entry.description === description);
  const status = candidates.length === 1 ? candidates[0] as JuliusMissionCommitStatus : null;
  if (status === null) return null;
  if (status.state !== (record.verdict === 'PASS' ? 'success' : 'failure')) return null;
  // The run's own jobs.
  const liveJob = onlyOne(jobs, (job) => job.name === LIVE_JOB);
  const liveStep = liveJob === null ? null : onlyOne(liveJob.steps, (step) => step.name === LIVE_STEP);
  const gradeJob = onlyOne(jobs, (job) => job.name === GRADE_JOB);
  const gradeStep = gradeJob === null ? null : onlyOne(gradeJob.steps, (step) => step.name === GRADE_STEP);
  const passStep = gradeJob === null ? null : onlyOne(gradeJob.steps, (step) => step.name === PASS_STEP);
  const failStep = gradeJob === null ? null : onlyOne(gradeJob.steps, (step) => step.name === FAIL_STEP);
  const done =(item: { readonly status: string; readonly conclusion: string | null } | null, conclusion: string): boolean => item !== null && item.status === 'completed' && item.conclusion === conclusion;
  const completed = done(liveJob, 'success') && done(liveStep, 'success');
  const liveFailed = done(liveJob, 'failure') && done(liveStep, 'failure');
  // The verdict names the pinned checker, and the bytes it judged are the bytes the run published.
  // X-4: every staged grading input is fingerprinted by the combined pin, which must be the pinned one.
  const judged = record.judgedTrimmedSha256 !== null && record.checkerSha256 === J1_PINNED_CHECKER_FILE_SHA256
    && record.combinedPinSha256 === J1_GRADE_COMBINED_PIN_SHA256
    && record.publishedTrimmedSha256 === record.judgedTrimmedSha256;
  // SYMMETRIC (D-b): exactly one verdict step ran in THIS run, and it is the one the tag names.
  const graded = judged && completed && done(gradeJob, 'success') && done(gradeStep, 'success');
  let verdict: JuliusCheckerVerdict = 'NOT_RUN';
  if (record.verdict === 'PASS' && graded && done(passStep, 'success') && done(failStep, 'skipped')) verdict = 'PASS';
  if (record.verdict === 'FAIL' && graded && done(failStep, 'success') && done(passStep, 'skipped')) verdict = 'FAIL';
  return { record, verdict, completed, liveFailed };
}

/** What the record can say: completion, the bound verdict, the outcome-unknown cause and the cost. Never the slot views. */
function completionFromRecord(
  bound: BoundResultRecord,
  spendTag: Omit<JuliusMissionSpendTagEvidence, 'workflowRunCreatedAt'>,
  workflowRunCreatedAt: string,
  runId: string,
): JuliusMissionCompletionEvidence | null {
  const { record } = bound;
  if (record.finalState !== 'COMPLETED' || !bound.completed) return null;
  const checker: JuliusCheckerEvidence | null = record.judgedTrimmedSha256 === null && record.checkerSha256 === null ? null : {
    reason: null,
    taskId: null,
    judgedTrimmedSha256: record.judgedTrimmedSha256,
    gameDigest: record.judgedTrimmedSha256 === null ? null : record.judgedTrimmedSha256.slice(0, 12),
    checkerSha256: record.checkerSha256,
  };
  return {
    juliusFinalState: 'COMPLETED',
    spendTag: { ...spendTag, workflowRunCreatedAt },
    spendAccounting: null,
    coderCost: null,
    missionCost: record.usdMicros === null
      ? null
      : { knownUsdMicros: record.usdMicros, unknownComponents: record.costBasis === 'COMPLETE' ? 0 : null, complete: record.costBasis === 'COMPLETE' },
    providerReceipt: null,
    archive: null,
    workArtifactRefs: null,
    projectBrainRevision: null,
    phases: null,
    traceId: juliusMissionTraceId(runId),
    traceparent: null,
    checkerVerdict: bound.verdict,
    checker,
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
