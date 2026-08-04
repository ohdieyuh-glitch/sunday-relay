/**
 * SUNDAY RELAY — THE CLI's HALF OF A LOOP RUN.
 *
 * Parsing a command is free. Compiling a draft is free. Previewing it is free.
 * NONE of those start anything, and this module exists to keep that true while
 * still giving the CLI a way to actually run a Loop.
 *
 * THE CONFIRMATION GATE IS NOT DECORATION. `runLoopCli` already renders a
 * preview; execution requires the caller to come back with `confirmed: true`
 * and a request id it chose. A surface that parsed and immediately executed
 * would make `/loop coding rm -rf` a one-keystroke mistake, and the preview it
 * skipped is the only place the user could have seen what was about to happen.
 *
 * THE SERVER IS AUTHORITATIVE ABOUT EVERYTHING THAT MATTERS. This module holds
 * no run state, evaluates no feature flag, resolves no target, and decides no
 * completion. It sends a confirmed contract and renders what comes back. If the
 * server says a target is unsupported, that is the answer — a CLI that
 * second-guessed it would be enforcing a policy from the wrong side of the
 * boundary.
 *
 * THE CLIENT IS INJECTED. No `fetch`, no base URL, no token handling here, so
 * every one of these paths is testable offline and the CLI cannot accidentally
 * become a second HTTP stack.
 */

import type { LoopHistoryEntry, LoopInspectionProjection, LoopStatusProjection } from '../mission/loop/runtime';

/* ----------------------------------------------------------------- port */

export type LoopClientResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly kind: string; readonly message: string };

/** What the CLI needs the bridge to do. Injected; implemented over HTTP. */
export interface LoopExecutionClient {
  capability(): Promise<LoopClientResult<{ readonly loopEngineEnabled: boolean; readonly supportedRoles: readonly string[] }>>;
  confirm(input: {
    readonly projectId: string;
    readonly loopId: string;
    readonly contractRef: string;
    readonly contractVersion: number;
    readonly contractBindingDigest: string;
    readonly confirmationRequestId: string;
    readonly objective: string;
    readonly targetExpression: string;
    readonly workspaceId: string | null;
  }): Promise<LoopClientResult<LoopStatusProjection & { readonly duplicate?: boolean }>>;
  status(runId: string): Promise<LoopClientResult<LoopStatusProjection>>;
  inspect(runId: string): Promise<LoopClientResult<LoopInspectionProjection>>;
  history(loopId: string): Promise<LoopClientResult<{ readonly runs: readonly LoopHistoryEntry[] }>>;
  control(input: {
    readonly runId: string;
    readonly action: 'pause' | 'resume' | 'stop';
    readonly requestId: string;
    readonly reason: string | null;
  }): Promise<LoopClientResult<LoopStatusProjection & { readonly duplicate?: boolean }>>;
}

/* --------------------------------------------------------------- render */

const micros = (value: string | null, unknown: boolean, currency: string | null): string => {
  // Unknown is printed as Unknown. Rendering `$0.00` for an unreported cost
  // would be a confident number nobody measured.
  if (unknown || value === null) return 'Unknown';
  const dollars = Number(BigInt(value)) / 1_000_000;
  return `${currency ?? ''}${currency === null ? '' : ' '}${dollars.toFixed(4)}`.trim();
};

const count = (used: number | null, max: number | null, unknown: boolean): string => {
  const left = unknown || used === null ? 'Unknown' : String(used);
  return max === null ? `${left} / no limit` : `${left} / ${max}`;
};

/** The lines a status renders as. Shared by status, confirm and every control. */
export function renderLoopStatusLines(status: LoopStatusProjection): readonly string[] {
  const lines: string[] = [
    `Loop run ${status.runId}`,
    `  Loop        ${status.loopId}`,
    `  State       ${status.state.replace(/_/g, ' ')}${status.finished ? ' (finished)' : ''}`,
  ];
  // "Succeeded" is stated only for a finished run, and only `completed` earns
  // it. An exhausted or stopped run is finished and did not succeed.
  if (status.finished) {
    lines.push(`  Outcome     ${status.succeeded ? 'completed' : 'did not complete'}`);
  }
  if (status.identity !== null) {
    lines.push(`  Role        ${status.identity.requestedRole}${
      status.identity.requestedRole === status.identity.resolvedRole
        ? '' : ` (resolved to ${status.identity.resolvedRole})`}`);
    lines.push(`  Agent       ${status.identity.actualAgentId ?? 'Unknown'}`);
    lines.push(`  Model       requested ${status.identity.requestedModel ?? 'none'}, actual ${
      status.identity.actualModel ?? 'Unknown'}`);
  }
  lines.push(`  Iterations  ${count(status.usage.iterationsStarted, status.usage.maxIterations, false)}`);
  lines.push(`  Spend       ${micros(status.usage.knownSpendMicros, status.usage.spendUnknown, status.usage.currency)}`);
  lines.push(`  Tokens      ${count(status.usage.tokensUsed, status.usage.maxTotalTokens, status.usage.tokensUnknown)}`);
  if (status.blocker !== null) {
    lines.push(`  Blocked     ${status.blocker.detail}`);
    if (status.blocker.requiredUserAction !== null) {
      lines.push(`              ${status.blocker.requiredUserAction}`);
    }
  }
  if (status.latestFailure !== null) {
    lines.push(`  Failure     ${status.latestFailure.summary}`);
  }
  if (status.latestCheckpoint !== null) {
    lines.push(`  Checkpoint  ${status.latestCheckpoint.reason.replace(/_/g, ' ')}`);
  }
  return lines;
}

const failureLines = (
  verb: string,
  failure: { readonly status: number; readonly kind: string; readonly message: string },
): readonly string[] => [
  `Could not ${verb}: ${failure.message}`,
  `  (${failure.kind})`,
];

/* ------------------------------------------------------------- commands */

export interface LoopExecutionResult {
  readonly lines: readonly string[];
  /** Non-zero exit for the caller. A refusal is a real answer, not a crash. */
  readonly failed: boolean;
}

export interface LoopCreationRequest {
  readonly projectId: string;
  readonly loopId: string;
  readonly contractRef: string;
  readonly contractVersion: number;
  readonly contractBindingDigest: string;
  readonly objective: string;
  readonly targetExpression: string;
  readonly workspaceId: string | null;
  /** The caller's own request id. A RETRY reuses it; a new decision does not. */
  readonly confirmationRequestId: string;
  /** The user said yes to the preview. Without this nothing is sent. */
  readonly confirmed: boolean;
}

/**
 * Start a Loop run, having shown a preview and been told yes.
 *
 * The capability check happens first and separately, so a disabled engine
 * produces a sentence about the engine rather than a confusing refusal from a
 * route the user did not know existed.
 */
export async function executeLoopCreation(
  client: LoopExecutionClient,
  request: LoopCreationRequest,
): Promise<LoopExecutionResult> {
  if (!request.confirmed) {
    return {
      lines: [
        'This Loop was not started, because it has not been confirmed.',
        'Review the preview above, then run the same command with --confirm.',
      ],
      failed: false,
    };
  }

  const capability = await client.capability();
  if (!capability.ok) return { lines: failureLines('reach the Loop engine', capability), failed: true };
  if (!capability.data.loopEngineEnabled) {
    return {
      lines: [
        'The Loop engine is not enabled on this server, so nothing was started.',
        'A Loop can be drafted and previewed without it; running one is a server-side capability.',
      ],
      failed: true,
    };
  }

  const created = await client.confirm({
    projectId: request.projectId,
    loopId: request.loopId,
    contractRef: request.contractRef,
    contractVersion: request.contractVersion,
    contractBindingDigest: request.contractBindingDigest,
    confirmationRequestId: request.confirmationRequestId,
    objective: request.objective,
    targetExpression: request.targetExpression,
    workspaceId: request.workspaceId,
  });
  if (!created.ok) return { lines: failureLines('start this Loop', created), failed: true };

  return {
    lines: [
      created.data.duplicate === true
        ? 'That confirmation had already been recorded. This is the run it created:'
        : 'Loop run started.',
      '',
      ...renderLoopStatusLines(created.data),
    ],
    failed: false,
  };
}

export async function executeLoopStatus(
  client: LoopExecutionClient,
  runId: string,
): Promise<LoopExecutionResult> {
  const result = await client.status(runId);
  return result.ok
    ? { lines: renderLoopStatusLines(result.data), failed: false }
    : { lines: failureLines('read that Loop run', result), failed: true };
}

export async function executeLoopInspect(
  client: LoopExecutionClient,
  runId: string,
): Promise<LoopExecutionResult> {
  const result = await client.inspect(runId);
  if (!result.ok) return { lines: failureLines('inspect that Loop run', result), failed: true };

  const lines: string[] = [...renderLoopStatusLines(result.data), ''];
  lines.push(`  Contract    ${result.data.contract.ref} v${result.data.contract.version}`);
  lines.push(`  Journal     ${result.data.journalIntegrity}, read from ${result.data.snapshotSource.replace(/_/g, ' ')}`);
  lines.push('');
  for (const iteration of result.data.iterations) {
    lines.push(`  Iteration ${iteration.ordinal} — ${iteration.state}${
      iteration.executionOutcome === null ? '' : ` (${iteration.executionOutcome})`}`);
    for (const observation of iteration.observations) {
      // The TRUST is printed beside every observation, because "the agent said
      // it is done" and "Relay verified it is done" must never look alike.
      lines.push(`    ${observation.trust.padEnd(9)} ${observation.kind}: ${observation.summary}`);
    }
    if (iteration.evidenceRefs.length > 0) {
      lines.push(`    evidence  ${iteration.evidenceRefs.join(', ')}`);
    }
    if (iteration.decision !== null) {
      lines.push(`    decision  ${iteration.decision.action} — ${iteration.decision.reason}`);
    }
  }
  return { lines, failed: false };
}

export async function executeLoopHistory(
  client: LoopExecutionClient,
  loopId: string,
): Promise<LoopExecutionResult> {
  const result = await client.history(loopId);
  if (!result.ok) return { lines: failureLines('read that Loop\'s history', result), failed: true };
  if (result.data.runs.length === 0) {
    return { lines: [`Loop ${loopId} has no runs yet.`], failed: false };
  }
  return {
    lines: [
      `Loop ${loopId} — ${result.data.runs.length} run${result.data.runs.length === 1 ? '' : 's'}`,
      ...result.data.runs.map((run) => `  ${run.runId}  ${run.state.replace(/_/g, ' ').padEnd(22)}`
        + `${run.iterationsStarted} iteration${run.iterationsStarted === 1 ? '' : 's'}  ${run.createdAt}`),
    ],
    failed: false,
  };
}

export async function executeLoopControl(
  client: LoopExecutionClient,
  input: {
    readonly runId: string;
    readonly action: 'pause' | 'resume' | 'stop';
    readonly requestId: string;
    readonly reason?: string | null;
  },
): Promise<LoopExecutionResult> {
  const result = await client.control({
    runId: input.runId,
    action: input.action,
    requestId: input.requestId,
    reason: input.reason ?? null,
  });
  if (!result.ok) return { lines: failureLines(`${input.action} that Loop run`, result), failed: true };
  return {
    lines: [
      result.data.duplicate === true
        ? `That ${input.action} request had already been recorded. The run stands as:`
        : `Loop run ${input.action === 'stop' ? 'stopped' : `${input.action}d`}.`,
      '',
      ...renderLoopStatusLines(result.data),
    ],
    failed: false,
  };
}
