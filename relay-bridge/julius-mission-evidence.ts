import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';

/**
 * COMPLETION EVIDENCE FOR A WONDERLAND JULIUS MISSION.
 *
 * OWNED BY YUJI. The server-side reader that matches the spend tag's
 * `workflow_run_id` to the actual workflow run, and returns the completion
 * evidence below, is YUJI's. It is supplied by YUJI's PR. This module does
 * not implement that reader. It does not call GitHub, does not read a
 * workflow run, and does not decide that a dispatch completed.
 *
 * What lives here is the shape that reader must return, the check that a
 * value is that shape, and a test double that plays a stored value back.
 * A boolean, a dispatch, or any other signal is not completion.
 *
 * The field list and the commits it was read from are in
 * `docs/JULIUS_MISSION_EVIDENCE_READER.md`. A field that was not found is
 * not on this interface. Unknown values stay null.
 *
 * `traceId` is derived from the admitted `wlj_` id by
 * `scripts/julius-mission-trace.mjs`. It is not read off the payload.
 * A phase `spanId` and `traceparent` stay null, as the reader assigns them.
 */

export const JULIUS_SPEND_TAG_SCHEMA = 'julius-run-spent.v1' as const;

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
   * When the matched Actions run was created (GitHub's `created_at`, ISO,
   * UTC). The reader reads it off the run it matched to `workflowRunId`.
   * Required: without it the bridge cannot show that the operator's
   * dispatch came first, so the read is not completion.
   */
  readonly workflowRunCreatedAt: string;
}

/** Cap reading of one verified tag. Present only when YUJI's reader supplies it. */
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
 * `responseId` is a different field. It is never copied from `providerRequestId`.
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

/** Archive columns for the run YUJI matched. `conclusion` is the workflow conclusion. */
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
 * One C.A.R.D. peer, in the order `projectJuliusSlotViews` returns.
 * Repair is a `stage` on that peer, not a fourth role.
 * `spanId` and `traceparent` are null. A supplied id is not copied and is
 * not replaced with a derived one.
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
 * What YUJI's reader returns for a run whose own record says COMPLETED.
 * Anything short of this shape is not completion.
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
  /**
   * Derived from the admitted `wlj_` id. A trace id on the reader payload,
   * and a trace id supplied to dispatch, are not this field.
   */
  readonly traceId: string | null;
  /**
   * The mission record is not itself a span, so this is null. A phase
   * `traceparent` is null as well: the reader does not attach a span.
   */
  readonly traceparent: null;
  /**
   * The pinned hidden checker's verdict from the paid workflow's grade job.
   * Only PASS is a verified completion. Absent or any other token is NOT_RUN.
   */
  readonly checkerVerdict: JuliusCheckerVerdict;
  readonly checker: JuliusCheckerEvidence | null;
}

export const JULIUS_CHECKER_VERDICTS = ['PASS', 'FAIL', 'NOT_RUN'] as const;
export type JuliusCheckerVerdict = (typeof JULIUS_CHECKER_VERDICTS)[number];

export interface JuliusCheckerEvidence {
  readonly reason: string | null;
  readonly taskId: string | null;
  readonly judgedTrimmedSha256: string | null;
  readonly gameDigest: string | null;
  readonly checkerSha256: string | null;
}

/**
 * OWNED BY YUJI. To be supplied by YUJI's PR.
 *
 * `read` matches the spend tag's `workflow_run_id` to the workflow run and
 * returns that run's completion evidence, or null when there is none.
 * Null is not completion. A thrown error is not completion. The value is
 * accepted only by {@link acceptJuliusMissionEvidence}.
 */
export interface JuliusMissionEvidenceReader {
  read(wljRunId: string): Promise<unknown>;
  /**
   * Optional. The ambiguous provider outcome Julius itself recorded for this
   * run, when it recorded one. The value is accepted only by
   * {@link acceptJuliusOutcomeUnknown}. Null or a throw means none was READ;
   * that is not proof there was none.
   */
  readOutcomeUnknown?(wljRunId: string): Promise<unknown>;
}

/**
 * Julius's own record that a provider request may have been processed and
 * its outcome is unknown, so the task was failed and never retried. These
 * are the record's causes. Any other value is not this.
 */
export const JULIUS_OUTCOME_UNKNOWN_CAUSES = ['HANDED_OUTCOME_UNKNOWN'] as const;
export type JuliusOutcomeUnknownCause = (typeof JULIUS_OUTCOME_UNKNOWN_CAUSES)[number];

export interface JuliusOutcomeUnknown {
  readonly cause: JuliusOutcomeUnknownCause;
  readonly role: 'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER' | null;
  readonly taskId: string | null;
}

const OUTCOME_ROLES = new Set(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
const OUTCOME_TASK = /^[A-Za-z0-9:_-]{1,128}$/u;
const OUTCOME_RUN = /^[1-9][0-9]{0,19}$/u;

/**
 * A reader's outcome-unknown value, bound to the workflow run the dispatch
 * record names. When the record names no run, or the value is for another run
 * or is not this shape, it is null.
 */
export function acceptJuliusOutcomeUnknown(value: unknown, dispatchedWorkflowRunId: string | null): JuliusOutcomeUnknown | null {
  const body = record(value);
  if (body === null || dispatchedWorkflowRunId === null || !OUTCOME_RUN.test(dispatchedWorkflowRunId)) return null;
  if (body.workflowRunId !== dispatchedWorkflowRunId) return null;
  if (typeof body.cause !== 'string' || !(JULIUS_OUTCOME_UNKNOWN_CAUSES as readonly string[]).includes(body.cause)) return null;
  const role = body.role === null || (typeof body.role === 'string' && OUTCOME_ROLES.has(body.role)) ? body.role : undefined;
  const taskId = body.taskId === null || (typeof body.taskId === 'string' && OUTCOME_TASK.test(body.taskId)) ? body.taskId : undefined;
  if (role === undefined || taskId === undefined) return null;
  return { cause: body.cause as JuliusOutcomeUnknownCause, role: role as JuliusOutcomeUnknown['role'], taskId: taskId as string | null };
}

export interface JuliusMissionEvidenceReading {
  readonly completion: JuliusMissionCompletionEvidence | null;
  /** Null when the reader did not supply the three-phase projection, or the value was not that shape. */
  readonly phases: readonly JuliusMissionPhaseEvidence[] | null;
}

const SECRET = /sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|xai-[A-Za-z0-9_-]{16,}|BEGIN [A-Z ]*PRIVATE KEY/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGITS = /^\d{1,20}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const REASON = /^[a-z0-9_:-]{1,80}$/;
const WORK_ARTIFACT = /julius-work-artifact\.v1/;

const absent = { completion: null, phases: null } as const;

/** Bounds on reader arrays. A longer list is not truncated: it is unknown (null). */
export const JULIUS_ARCHIVE_FILES_MAX = 512;
export const JULIUS_FAILED_STEPS_MAX = 64;
export const JULIUS_WORK_ARTIFACT_REFS_MAX = 256;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function plain(value: unknown, max = 500): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return null;
  if (/[\r\n]/.test(value) || SECRET.test(value)) return null;
  return value;
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function spendTag(wljRunId: string, value: unknown): JuliusMissionSpendTagEvidence | null {
  const body = record(value);
  if (body === null || body.schema !== JULIUS_SPEND_TAG_SCHEMA || body.run !== wljRunId) return null;
  const namespace = plain(body.namespace, 200);
  const reservedUsdMicros = nonNegativeInt(body.reservedUsdMicros);
  const workflowRunId = typeof body.workflowRunId === 'string' && DIGITS.test(body.workflowRunId) ? body.workflowRunId : null;
  const workflowRunAttempt = typeof body.workflowRunAttempt === 'string' && DIGITS.test(body.workflowRunAttempt) ? body.workflowRunAttempt : null;
  const headSha = typeof body.headSha === 'string' && SHA40.test(body.headSha) ? body.headSha : null;
  const workflowRunCreatedAt = isoUtc(body.workflowRunCreatedAt);
  if (namespace === null || reservedUsdMicros === null || workflowRunId === null || workflowRunAttempt === null || headSha === null
    || workflowRunCreatedAt === null) {
    return null;
  }
  return {
    schema: JULIUS_SPEND_TAG_SCHEMA,
    run: wljRunId,
    namespace,
    reservedUsdMicros,
    workflowRunId,
    workflowRunAttempt,
    headSha,
    workflowRunCreatedAt,
  };
}

function isoUtc(value: unknown): string | null {
  return typeof value === 'string' && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

/** What the operator claim recorded for this run, as the status route reports it. */
export interface JuliusMissionDispatchRecord {
  /** The first recorded dispatch, or null when none is recorded. */
  readonly dispatchedAt: string | null;
  /** The Actions run id `gh workflow run` printed for the dispatched child, or null. */
  readonly workflowRunId: string | null;
  /**
   * GitHub's clock on the spent-tag read made right before the reservation
   * (the claim's `githubDate`), or null. The ordering is checked against this,
   * never against the operator machine's clock.
   */
  readonly githubDispatchDate: string | null;
}

/**
 * How far GitHub's `created_at` may read before GitHub's own `Date:` on the
 * spent-tag read and still be this dispatch's run. Both are GitHub clocks at
 * whole seconds; two seconds absorbs the rounding of each and GitHub's own
 * spread between hosts. The operator machine's clock is not involved.
 */
export const JULIUS_DISPATCH_CLOCK_TOLERANCE_MS = 2_000;

/**
 * Bind accepted evidence to the operator's own dispatch record. A completion
 * survives only when:
 * - a dispatch is recorded (`dispatchedAt` is an ISO time);
 * - when the record knows a workflow run id, the spend tag names that same
 *   run (a run the operator did not dispatch is not this mission's run);
 * - the dispatch came first, on GitHub's clock alone: the matched run's
 *   `created_at` is no earlier than the `Date:` GitHub sent on the spent-tag
 *   read right before the reservation, less
 *   `JULIUS_DISPATCH_CLOCK_TOLERANCE_MS`. A record without that date binds
 *   nothing: unknown is not a time.
 * Anything else is no completion, so the verdict is NOT_RUN.
 */
export function bindJuliusEvidenceToDispatch(
  reading: JuliusMissionEvidenceReading,
  dispatch: JuliusMissionDispatchRecord,
): JuliusMissionEvidenceReading {
  const completion = reading.completion;
  if (completion === null) return reading;
  const dispatchedAt = isoUtc(dispatch.dispatchedAt);
  if (dispatchedAt === null) return absent;
  const tag = completion.spendTag;
  if (dispatch.workflowRunId !== null && dispatch.workflowRunId !== tag.workflowRunId) return absent;
  const githubDispatchDate = isoUtc(dispatch.githubDispatchDate);
  if (githubDispatchDate === null) return absent;
  const dispatchMs = Date.parse(githubDispatchDate);
  const createdMs = Date.parse(tag.workflowRunCreatedAt);
  if (!(createdMs >= dispatchMs - JULIUS_DISPATCH_CLOCK_TOLERANCE_MS)) return absent;
  return reading;
}

function spendAccounting(value: unknown): JuliusMissionSpendAccounting | null {
  const body = record(value);
  if (body === null) return null;
  return {
    knownUsdMicros: nonNegativeInt(body.knownUsdMicros),
    unknownCostComponents: nonNegativeInt(body.unknownCostComponents),
    unverifiableApiSpend: flag(body.unverifiableApiSpend),
    spendVerified: flag(body.spendVerified),
  };
}

function coderCost(value: unknown): JuliusMissionCoderCost | null {
  const body = record(value);
  if (body === null) return null;
  return {
    costUsdMicros: nonNegativeInt(body.costUsdMicros),
    costBasis: oneOf(body.costBasis, JULIUS_MISSION_CODER_COST_BASES),
    executionCostUsdMicros: nonNegativeInt(body.executionCostUsdMicros),
    billingPath: oneOf(body.billingPath, JULIUS_MISSION_BILLING_PATHS),
  };
}

function missionCost(value: unknown): JuliusMissionCostEvidence | null {
  const body = record(value);
  if (body === null) return null;
  return {
    knownUsdMicros: nonNegativeInt(body.knownUsdMicros),
    unknownComponents: nonNegativeInt(body.unknownComponents),
    complete: flag(body.complete),
  };
}

/**
 * CAPTURED survives only when the provider request id itself survives.
 * A credential-shaped id is dropped and does not count as captured.
 *
 * `responseId` is read from its own field. A missing response id stays null.
 * It is not filled from `providerRequestId`.
 */
function providerReceipt(value: unknown): JuliusMissionProviderReceipt | null {
  const body = record(value);
  if (body === null) return null;
  const stated = oneOf(body.providerRequestAvailability, JULIUS_MISSION_REQUEST_AVAILABILITY);
  const rawRequestId = body.providerRequestId;
  const credentialShaped = typeof rawRequestId === 'string' && SECRET.test(rawRequestId);
  const providerRequestId = plain(rawRequestId, 200);
  const captured = stated === 'CAPTURED' && providerRequestId !== null;
  const statedReason = typeof body.providerRequestUnavailableReason === 'string' && REASON.test(body.providerRequestUnavailableReason)
    ? body.providerRequestUnavailableReason
    : null;
  const providerRequestUnavailableReason = captured
    ? null
    : credentialShaped
      ? 'provider_request_id_credential_shaped'
      : statedReason ?? (stated === 'CAPTURED' ? 'provider_request_id_unusable' : null);
  return {
    providerRequestId: captured ? providerRequestId : null,
    responseId: captured ? plain(body.responseId, 200) : null,
    providerRequestAvailability: captured ? 'CAPTURED' : 'UNAVAILABLE',
    providerRequestUnavailableReason,
  };
}

function archiveFiles(value: unknown): readonly JuliusMissionArchiveFile[] | null {
  if (!Array.isArray(value) || value.length > JULIUS_ARCHIVE_FILES_MAX) return null;
  const files: JuliusMissionArchiveFile[] = [];
  for (const entry of value) {
    const body = record(entry);
    if (body === null) continue;
    const path = plain(body.path, 500);
    const sha256 = typeof body.sha256 === 'string' && SHA256.test(body.sha256) ? body.sha256 : null;
    const kind = oneOf(body.kind, JULIUS_MISSION_ARCHIVE_FILE_KINDS);
    if (path === null || sha256 === null || kind === null) continue;
    files.push({ path, sha256, kind });
  }
  return files;
}

function failedSteps(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > JULIUS_FAILED_STEPS_MAX) return null;
  const steps: string[] = [];
  for (const entry of value) {
    const step = plain(entry, 300);
    if (step === null) return null;
    steps.push(step);
  }
  return steps;
}

function archive(value: unknown): JuliusMissionArchiveEvidence | null {
  const body = record(value);
  if (body === null) return null;
  const artifactDigest = typeof body.artifactDigest === 'string' && SHA256.test(body.artifactDigest) ? body.artifactDigest : null;
  return {
    artifactName: plain(body.artifactName, 200),
    artifactDigest,
    fileCount: nonNegativeInt(body.fileCount),
    totalBytes: nonNegativeInt(body.totalBytes),
    conclusion: plain(body.conclusion, 80),
    failedSteps: failedSteps(body.failedSteps),
    files: archiveFiles(body.files),
  };
}

function workArtifactRefs(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > JULIUS_WORK_ARTIFACT_REFS_MAX) return null;
  const refs: string[] = [];
  for (const entry of value) {
    const ref = plain(entry, 400);
    if (ref !== null && WORK_ARTIFACT.test(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * The slot projection: the three peers, in order, or null.
 * A missing list is null. A list that is not that shape is null.
 * `knownUsdMicros: 0` is kept. A supplied `spanId` or `traceparent` is not
 * rewritten into a derived id; the list is null instead.
 */
function phases(value: unknown): readonly JuliusMissionPhaseEvidence[] | null {
  if (!Array.isArray(value) || value.length !== JULIUS_MISSION_PHASE_ROLES.length) return null;
  const rows: JuliusMissionPhaseEvidence[] = [];
  for (let index = 0; index < JULIUS_MISSION_PHASE_ROLES.length; index += 1) {
    const parsed = phaseProjection(value[index], JULIUS_MISSION_PHASE_ROLES[index]!);
    if (parsed === null) return null;
    rows.push(parsed);
  }
  return rows;
}

function phaseProjection(value: unknown, role: JuliusMissionPhaseRole): JuliusMissionPhaseEvidence | null {
  const body = record(value);
  if (body === null || body.role !== role) return null;
  const state = oneOf(body.state, JULIUS_MISSION_SLOT_STATES);
  if (state === null) return null;
  for (const key of ['stage', 'attempt', 'spanId', 'traceparent', 'knownUsdMicros', 'costComplete'] as const) {
    if (!Object.hasOwn(body, key)) return null;
  }
  const stage = body.stage === null ? null : oneOf(body.stage, JULIUS_MISSION_PHASE_STAGES);
  if (body.stage !== null && stage === null) return null;
  const attempt = body.attempt === null ? null : nonNegativeInt(body.attempt);
  if (body.attempt !== null && attempt === null) return null;
  if (body.spanId !== null || body.traceparent !== null) return null;
  const knownUsdMicros = nonNegativeInt(body.knownUsdMicros);
  if (knownUsdMicros === null || typeof body.costComplete !== 'boolean') return null;
  return {
    role,
    state,
    stage,
    attempt,
    spanId: null,
    traceparent: null,
    knownUsdMicros,
    costComplete: body.costComplete,
  };
}

/**
 * Accepts YUJI's evidence object and nothing else.
 *
 * Completion requires the spend-tag fields and `juliusFinalState: "COMPLETED"`
 * on that same object. `{ completed: true }` is not that object. A null
 * reader result is not that object: the route stays on the status ceiling.
 *
 * YUJI's reader at `041d2599` returns `phases: null`, `spendAccounting: null`,
 * and `projectBrainRevision: null`. At `44a7f1e1` a present phase list is the
 * three-slot projection, `projectBrainRevision` is a non-negative integer
 * (`0` included), and `spendAccounting` stays null. A null section stays
 * null. It is not replaced with an empty list, a guessed phase, or a
 * coerced zero. A value that is not the projection is null.
 *
 * Phases are published only on a verified completion. An in-progress or
 * failed read does not carry a phase list.
 *
 * `traceId` is derived here from the admitted `wlj_` id. A `traceId` on the
 * payload is ignored. Phase `spanId` and `traceparent` stay null.
 * `responseId` is kept as its own field and is never copied from
 * `providerRequestId`.
 */
export function acceptJuliusMissionEvidence(wljRunId: string, value: unknown): JuliusMissionEvidenceReading {
  const body = record(value);
  if (body === null) return absent;
  const phaseRows = phases(body.phases);
  const tag = spendTag(wljRunId, body.spendTag);
  if (tag === null || body.juliusFinalState !== 'COMPLETED') return absent;
  return {
    completion: {
      juliusFinalState: 'COMPLETED',
      spendTag: tag,
      spendAccounting: spendAccounting(body.spendAccounting),
      coderCost: coderCost(body.coderCost),
      missionCost: missionCost(body.missionCost),
      providerReceipt: providerReceipt(body.providerReceipt),
      archive: archive(body.archive),
      workArtifactRefs: workArtifactRefs(body.workArtifactRefs),
      projectBrainRevision: nonNegativeInt(body.projectBrainRevision),
      phases: phaseRows,
      traceId: juliusMissionTraceId(wljRunId),
      traceparent: null,
      ...checkerVerdict(body.checkerVerdict, body.checker),
    },
    phases: phaseRows,
  };
}

const TASK_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const DIGEST12 = /^[0-9a-f]{12}$/;
/**
 * The pinned hidden checker's own sha256 (J1_PINNED_CHECKER_FILE_SHA256 in
 * relay-bridge/julius-inworld-checker.ts, on the paid stack). A verdict from any
 * other checker is not this mission's grade. A drift test lands with that file.
 */
export const JULIUS_PINNED_CHECKER_SHA256 = '1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e';

/** A verdict outside the closed set is NOT_RUN. A PASS or FAIL must name the judged bytes. */
function checkerVerdict(verdictValue: unknown, checkerValue: unknown): { readonly checkerVerdict: JuliusCheckerVerdict; readonly checker: JuliusCheckerEvidence | null } {
  const body = record(checkerValue);
  const shaped = (value: unknown, shape: RegExp): string | null => (typeof value === 'string' && shape.test(value) ? value : null);
  const checker: JuliusCheckerEvidence | null = body === null ? null : {
    reason: shaped(body.reason, REASON),
    taskId: shaped(body.taskId, TASK_ID),
    judgedTrimmedSha256: shaped(body.judgedTrimmedSha256, SHA256),
    gameDigest: shaped(body.gameDigest, DIGEST12),
    checkerSha256: shaped(body.checkerSha256, SHA256),
  };
  const verdict = oneOf(verdictValue, JULIUS_CHECKER_VERDICTS);
  if (verdict === 'PASS' || verdict === 'FAIL') {
    if (checker === null || checker.judgedTrimmedSha256 === null || checker.checkerSha256 !== JULIUS_PINNED_CHECKER_SHA256
      || checker.gameDigest !== checker.judgedTrimmedSha256.slice(0, 12)) {
      return { checkerVerdict: 'NOT_RUN', checker };
    }
    return { checkerVerdict: verdict, checker };
  }
  return { checkerVerdict: 'NOT_RUN', checker };
}

/**
 * Test double for {@link JuliusMissionEvidenceReader}.
 *
 * Not YUJI's reader. The stored value is the completion object PR 446
 * returns at `041d2599`, or null. A stored null is a null read, and the
 * route stays on the status ceiling. This double does not match
 * `workflow_run_id` to a workflow run. Production wires no reader.
 */
export function createJuliusMissionEvidenceTestDouble(
  byRunId: Readonly<Record<string, unknown>>,
): JuliusMissionEvidenceReader {
  return {
    read(wljRunId: string) {
      return Promise.resolve(Object.hasOwn(byRunId, wljRunId) ? byRunId[wljRunId] : null);
    },
  };
}
