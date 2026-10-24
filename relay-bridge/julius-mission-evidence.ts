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

/** One C.A.R.D. peer. Repair is a `stage` on that peer, not a fourth role. */
export interface JuliusMissionPhaseEvidence {
  readonly role: JuliusMissionPhaseRole;
  readonly state: JuliusMissionSlotState;
  readonly stage: JuliusMissionPhaseStage | null;
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
}

export interface JuliusMissionEvidenceReading {
  readonly completion: JuliusMissionCompletionEvidence | null;
  /** Null when the reader did not supply a phase list. An empty list is a supplied list. */
  readonly phases: readonly JuliusMissionPhaseEvidence[] | null;
}

const SECRET = /sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|xai-[A-Za-z0-9_-]{16,}|BEGIN [A-Z ]*PRIVATE KEY/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGITS = /^\d{1,20}$/;
const REASON = /^[a-z0-9_:-]{1,80}$/;
const WORK_ARTIFACT = /julius-work-artifact\.v1/;

const absent = { completion: null, phases: null } as const;

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
  if (namespace === null || reservedUsdMicros === null || workflowRunId === null || workflowRunAttempt === null || headSha === null) {
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
  };
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
    responseId: captured ? providerRequestId : null,
    providerRequestAvailability: captured ? 'CAPTURED' : 'UNAVAILABLE',
    providerRequestUnavailableReason,
  };
}

function archiveFiles(value: unknown): readonly JuliusMissionArchiveFile[] | null {
  if (!Array.isArray(value)) return null;
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
  if (!Array.isArray(value)) return null;
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
  if (!Array.isArray(value)) return null;
  const refs: string[] = [];
  for (const entry of value) {
    const ref = plain(entry, 400);
    if (ref !== null && WORK_ARTIFACT.test(ref)) refs.push(ref);
  }
  return refs;
}

function phases(value: unknown): readonly JuliusMissionPhaseEvidence[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const rows: JuliusMissionPhaseEvidence[] = [];
  for (const entry of value) {
    const body = record(entry);
    if (body === null) continue;
    const role = oneOf(body.role, JULIUS_MISSION_PHASE_ROLES);
    const state = oneOf(body.state, JULIUS_MISSION_SLOT_STATES);
    if (role === null || state === null || seen.has(role)) continue;
    seen.add(role);
    rows.push({
      role,
      state,
      stage: oneOf(body.stage, JULIUS_MISSION_PHASE_STAGES),
      knownUsdMicros: nonNegativeInt(body.knownUsdMicros),
      costComplete: flag(body.costComplete),
    });
  }
  return rows;
}

/**
 * Accepts YUJI's evidence object and nothing else.
 *
 * Completion requires the spend-tag fields and `juliusFinalState: "COMPLETED"`
 * on that same object. `{ completed: true }` is not that object. Phases are
 * read from the same object when the reader supplied a list, including when
 * the run is not complete.
 */
export function acceptJuliusMissionEvidence(wljRunId: string, value: unknown): JuliusMissionEvidenceReading {
  const body = record(value);
  if (body === null) return absent;
  const phaseRows = phases(body.phases);
  const tag = spendTag(wljRunId, body.spendTag);
  if (tag === null || body.juliusFinalState !== 'COMPLETED') {
    return { completion: null, phases: phaseRows };
  }
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
    },
    phases: phaseRows,
  };
}

/**
 * Test double for {@link JuliusMissionEvidenceReader}.
 *
 * Not YUJI's reader. It returns the value stored for that id and does not
 * match `workflow_run_id` to a workflow run. Production wires no reader.
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
