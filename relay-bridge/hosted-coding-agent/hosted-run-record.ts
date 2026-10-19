/**
 * THE HOSTED CODING AGENT RUN RECORD — pure shape and pure transitions.
 *
 * One record per hosted run, durable under the mounted volume, and the single
 * thing every surface reads. It exists so a hosted run can be answered for
 * after the process that started it is gone.
 *
 * Three rules shape every field:
 *
 *   REQUESTED AND VERIFIED ARE NEVER THE SAME FIELD. `requestedModel` is what
 *   Relay asked for; `actualModel` is what the runtime said answered. There is
 *   no fallback between them, so a run whose runtime named nothing records
 *   null and renders Unknown.
 *
 *   AN SDK SUCCESS IS NOT A PASS. `sdkCompleted` says the agent finished its
 *   turn. `validationPassed` says Relay's own tests passed on the workspace
 *   afterwards. `completed` requires BOTH, and the record keeps them apart so
 *   nobody can quietly promote one into the other.
 *
 *   A RETRY IS A NEW RUN. Nothing is ever mutated in place to "try again" — a
 *   retry mints a new runId that points back at its predecessor, so the
 *   history of what was spent stays intact.
 */

export const HOSTED_RUN_SCHEMA = 'relay-hosted-coding-run.v1' as const;

export const HOSTED_RUN_STATES = [
  'ready', 'running', 'completed', 'failed', 'stopped', 'timed_out',
] as const;
export type HostedRunState = (typeof HOSTED_RUN_STATES)[number];

/** States in which a run may still be doing work. */
export const ACTIVE_HOSTED_STATES: readonly HostedRunState[] = ['ready', 'running'];

export interface HostedRunEvidence {
  /** Workspace-relative paths Relay observed changing. */
  readonly filesChanged: readonly string[];
  /** Paths the runtime reported touching, for the scope audit. */
  readonly filesInspected: readonly string[];
  readonly toolsUsed: readonly string[];
  /** Bounded unified diff read by Relay from the workspace. */
  readonly unifiedDiff: string | null;
  readonly validationCommand: string | null;
  readonly validationPassed: boolean;
  readonly sourceUnchanged: boolean;
  /** Kept until the founder approves cleanup. */
  readonly preservedWorkspacePath: string | null;
}

export const NO_EVIDENCE: HostedRunEvidence = Object.freeze({
  filesChanged: [], filesInspected: [], toolsUsed: [], unifiedDiff: null,
  validationCommand: null, validationPassed: false, sourceUnchanged: true,
  preservedWorkspacePath: null,
});

export interface HostedRunRecord {
  readonly schemaVersion: typeof HOSTED_RUN_SCHEMA;
  readonly runId: string;
  readonly missionId: string;
  /** Guards duplicate execution — one key, one run, forever. */
  readonly idempotencyKey: string;
  /** Set when this run is a retry, naming the run it replaces. */
  readonly priorRunId: string | null;
  readonly state: HostedRunState;

  readonly requestedRuntime: string;
  /** Observed only after the runtime identified itself. */
  readonly actualRuntime: string | null;
  readonly requestedModel: string | null;
  /** Observed only. NEVER an echo of requestedModel. */
  readonly actualModel: string | null;
  readonly runtimeVersion: string | null;

  /** The agent finished its turn. Not a verdict on the work. */
  readonly sdkCompleted: boolean;
  /** Relay's own validation passed on the workspace. The verdict. */
  readonly validationPassed: boolean;

  readonly usageInputTokens: number | null;
  readonly usageOutputTokens: number | null;
  /** Runtime-reported only; Relay never estimates. */
  readonly reportedCostUsd: number | null;

  readonly evidence: HostedRunEvidence;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /** Exactly why Relay refused or the run ended badly. */
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function newHostedRun(input: {
  runId: string;
  missionId: string;
  idempotencyKey: string;
  requestedModel: string | null;
  priorRunId?: string | null;
  now: string;
}): HostedRunRecord {
  return {
    schemaVersion: HOSTED_RUN_SCHEMA,
    runId: input.runId,
    missionId: input.missionId,
    idempotencyKey: input.idempotencyKey,
    priorRunId: input.priorRunId ?? null,
    state: 'ready',
    requestedRuntime: 'Claude Agent SDK (hosted)',
    actualRuntime: null,
    requestedModel: input.requestedModel,
    actualModel: null,
    runtimeVersion: null,
    sdkCompleted: false,
    validationPassed: false,
    usageInputTokens: null,
    usageOutputTokens: null,
    reportedCostUsd: null,
    evidence: NO_EVIDENCE,
    startedAt: null,
    endedAt: null,
    failureReason: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Terminal-state guard. A finished run is never reopened — a caller that wants
 * another attempt gets a NEW run, which is what keeps spend auditable.
 */
export function isTerminal(state: HostedRunState): boolean {
  return !ACTIVE_HOSTED_STATES.includes(state);
}

/**
 * The single place a run becomes `completed`.
 *
 * Both halves are required. A run whose SDK reported success but whose
 * validation failed is `failed` and says so — that is the rule this whole
 * milestone exists to keep, and putting it in one function means no route can
 * route around it.
 */
export function settleHostedRun(input: {
  record: HostedRunRecord;
  sdkCompleted: boolean;
  validationPassed: boolean;
  actualRuntime: string | null;
  actualModel: string | null;
  runtimeVersion: string | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  reportedCostUsd: number | null;
  evidence: HostedRunEvidence;
  failureReason: string | null;
  now: string;
}): HostedRunRecord {
  const passed = input.sdkCompleted && input.validationPassed;
  return {
    ...input.record,
    state: passed ? 'completed' : 'failed',
    sdkCompleted: input.sdkCompleted,
    validationPassed: input.validationPassed,
    actualRuntime: input.actualRuntime,
    actualModel: input.actualModel,
    runtimeVersion: input.runtimeVersion,
    usageInputTokens: input.usageInputTokens,
    usageOutputTokens: input.usageOutputTokens,
    reportedCostUsd: input.reportedCostUsd,
    evidence: input.evidence,
    endedAt: input.now,
    failureReason: passed
      ? null
      : input.failureReason
        ?? (input.sdkCompleted
          ? "Relay's own validation did not pass."
          : 'The hosted Coding Agent did not complete.'),
    updatedAt: input.now,
  };
}

/**
 * The browser-safe projection. Facts about a run, never the machinery behind
 * it: no workspace path, no prompt, no credential, no host layout.
 */
export interface SanitizedHostedRun {
  readonly runId: string;
  readonly missionId: string;
  readonly state: HostedRunState;
  readonly requestedRuntime: string;
  readonly actualRuntime: string;
  readonly requestedModel: string;
  readonly actualModel: string;
  readonly sdkCompleted: boolean;
  readonly validationPassed: boolean;
  readonly filesChanged: readonly string[];
  readonly usageLabel: string;
  readonly costLabel: string;
  readonly failureReason: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

const UNKNOWN = 'Unknown';

export function sanitizeHostedRun(record: HostedRunRecord): SanitizedHostedRun {
  return {
    runId: record.runId,
    missionId: record.missionId,
    state: record.state,
    requestedRuntime: record.requestedRuntime,
    actualRuntime: record.actualRuntime ?? UNKNOWN,
    requestedModel: record.requestedModel ?? UNKNOWN,
    // Never falls back to the requested model.
    actualModel: record.actualModel ?? UNKNOWN,
    sdkCompleted: record.sdkCompleted,
    validationPassed: record.validationPassed,
    filesChanged: record.evidence.filesChanged,
    // Unreported usage stays Unknown. It never becomes zero.
    usageLabel: record.usageInputTokens === null && record.usageOutputTokens === null
      ? UNKNOWN
      : `${record.usageInputTokens ?? UNKNOWN} in / ${record.usageOutputTokens ?? UNKNOWN} out`,
    costLabel: record.reportedCostUsd === null
      ? UNKNOWN
      : `$${record.reportedCostUsd.toFixed(4)} (runtime-reported)`,
    failureReason: record.failureReason,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  };
}
