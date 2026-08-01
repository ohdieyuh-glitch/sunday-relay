import {
  BRIDGE_TOKEN_ENV, BRIDGE_URL_ENV, createReviewerBridgeClient, isConfigurationError,
  type BridgeError, type BridgeResult, type ReviewerBridgeClient,
} from '../reviewer-bridge-client';
import { EXIT } from './exit-codes';

/**
 * `relay mission reviewer <test-connection|start|status|inspect|stop|retry>`
 * against a LIVE Relay Bridge.
 *
 * The CLI is a thin client here in the strictest sense: it validates its own
 * arguments, calls one Bridge Client operation, and prints what came back. It
 * holds no Hermes adapter, no provider client and no credential beyond the
 * bridge token it reads from the environment and never prints.
 *
 * ACCEPTANCE IS NOT COMPLETION. `start` reports that the server took the
 * request and what run id it minted; whether a review finished, and with what
 * verdict, is only ever read back from `status` or `inspect`.
 */

export interface BridgeCliIo {
  out: (line: string) => void;
  env: Record<string, string | undefined>;
}

/** Exit codes separate an unconfigured setup from a Reviewer that failed. */
export function exitCodeForBridgeError(error: BridgeError): number {
  if (isConfigurationError(error)) return EXIT.blocked;
  switch (error.kind) {
    case 'budget_blocked': return EXIT.budgetExceeded;
    case 'validation_failed': return EXIT.usage;
    case 'run_disconnected': return EXIT.runFailed;
    default: return EXIT.blocked;
  }
}

function printError(io: BridgeCliIo, error: BridgeError, json: boolean): void {
  if (json) {
    io.out(JSON.stringify({ ok: false, error: { kind: error.kind, message: error.message } }, null, 2));
    return;
  }
  io.out(`  Blocked:      ${error.kind.replace(/_/g, ' ')}`);
  io.out(`  Detail:       ${error.message}`);
}

/** Builds the client, or returns the configuration failure verbatim. */
export function bridgeClientFrom(io: BridgeCliIo): BridgeResult<ReviewerBridgeClient> {
  return createReviewerBridgeClient({
    bridgeUrl: io.env[BRIDGE_URL_ENV],
    token: io.env[BRIDGE_TOKEN_ENV],
  });
}

export interface ReviewerBridgeCliInput {
  readonly mode: 'test-connection' | 'start' | 'status' | 'inspect' | 'stop' | 'retry';
  readonly missionId: string;
  readonly json: boolean;
  readonly authorize: boolean;
  readonly harness?: string;
  readonly model?: string;
  readonly generation?: string;
  readonly idempotencyKey?: string;
  readonly priorRun?: string;
  /** Injected so tests exercise the real client against a real fake server. */
  readonly client?: ReviewerBridgeClient;
}

const UNKNOWN = 'Unknown';
const show = (v: string | null | undefined): string =>
  v === null || v === undefined || v === '' ? UNKNOWN : v;

export async function runReviewerBridgeCli(
  input: ReviewerBridgeCliInput,
  io: BridgeCliIo,
): Promise<number> {
  let client = input.client;
  if (client === undefined) {
    const built = bridgeClientFrom(io);
    if (!built.ok) {
      if (!input.json) io.out(`REVIEWER — ${input.missionId}`);
      printError(io, built.error, input.json);
      return exitCodeForBridgeError(built.error);
    }
    client = built.value;
  }

  switch (input.mode) {
    case 'test-connection': return await testConnection(client, input, io);
    case 'start': return await start(client, input, io);
    case 'status': return await status(client, input, io);
    case 'inspect': return await inspect(client, input, io);
    case 'stop': return await stop(client, input, io);
    case 'retry': return await retry(client, input, io);
    default: return EXIT.usage;
  }
}

/* --------------------------------------------------- test connection --- */

async function testConnection(
  client: ReviewerBridgeClient, input: ReviewerBridgeCliInput, io: BridgeCliIo,
): Promise<number> {
  const result = await client.testReviewerConnection();
  if (!result.ok) {
    if (!input.json) io.out('REVIEWER CONNECTION TEST');
    printError(io, result.error, input.json);
    return exitCodeForBridgeError(result.error);
  }
  const v = result.value;
  if (input.json) {
    io.out(JSON.stringify({
      ok: true, operation: 'test-connection', connected: v.connected,
      requestedModel: v.requestedModel, verifiedModel: v.verifiedModelId,
      provider: v.provider, providerRequestMade: v.providerRequestMade,
      checkedAt: v.checkedAt, reason: v.reason,
      // A connection test is not a run and mints none.
      runCreated: false,
    }, null, 2));
    return v.connected ? EXIT.completed : EXIT.blocked;
  }
  io.out('REVIEWER CONNECTION TEST');
  io.out(`  Harness:      ${show(v.harness)}`);
  // Requested and verified are ALWAYS separate lines; a requested model never
  // fills in for a verified one.
  io.out(`  Requested:    ${show(v.requestedModel)}`);
  io.out(`  Verified:     ${show(v.verifiedModelId)}`);
  io.out(`  Provider:     ${show(v.provider)}`);
  io.out(`  Checked:      ${show(v.checkedAt)}`);
  io.out(`  Connected:    ${v.connected ? 'yes' : 'no'}`);
  io.out('  Run created:  no');
  if (v.reason !== null) io.out(`  Reason:       ${v.reason}`);
  return v.connected ? EXIT.completed : EXIT.blocked;
}

/* ------------------------------------------------------------- start --- */

async function start(
  client: ReviewerBridgeClient, input: ReviewerBridgeCliInput, io: BridgeCliIo,
): Promise<number> {
  const missing: string[] = [];
  if (input.generation === undefined || input.generation.trim() === '') missing.push('--generation');
  if (input.harness === undefined || input.harness.trim() === '') missing.push('--harness');
  if (input.idempotencyKey === undefined || input.idempotencyKey.trim() === '') missing.push('--idempotency-key');
  if (missing.length > 0) {
    io.out(`mission reviewer start requires ${missing.join(', ')}.`);
    return EXIT.usage;
  }
  if (!input.authorize) {
    // A paid Reviewer run is never implied by having typed the command.
    io.out('mission reviewer start requires --authorize. A Reviewer run may spend money.');
    return EXIT.blocked;
  }

  const limits = { timeoutMs: 180_000, maxOutputBytes: 524_288, maxTurns: 1, maxPromptBytes: 262_144 };
  const result = await client.startReviewerRun({
    missionId: input.missionId,
    reviewGeneration: input.generation as string,
    requestedHarness: input.harness as string,
    // No model is chosen here. Absent means "use the server-approved model".
    requestedModel: input.model !== undefined && input.model.trim() !== '' ? input.model.trim() : null,
    idempotencyKey: input.idempotencyKey as string,
    authorized: true,
    limits,
  });
  if (!result.ok) {
    if (!input.json) io.out(`REVIEWER START — ${input.missionId}`);
    printError(io, result.error, input.json);
    return exitCodeForBridgeError(result.error);
  }
  const v = result.value;
  if (input.json) {
    io.out(JSON.stringify({
      ok: true, operation: 'start', runId: v.runId, accepted: v.accepted, state: v.state,
      requestedHarness: v.requestedHarness, requestedModel: v.requestedModel,
      // Actual identity is unknown until the run reports it.
      actualHarness: null, actualModel: null,
      deduplicated: v.deduplicated, idempotencyKey: v.idempotencyKey, limits: v.limits,
      completed: false,
    }, null, 2));
    return EXIT.completed;
  }
  io.out(`REVIEWER START — ${v.missionId}`);
  io.out(`  Run:          ${v.runId}`);
  io.out(`  Accepted:     ${v.accepted ? 'yes' : 'no'}${v.deduplicated ? ' (existing run for this key)' : ''}`);
  io.out(`  State:        ${v.state}`);
  io.out(`  Requested:    harness ${show(v.requestedHarness)} · model ${show(v.requestedModel)}`);
  io.out(`  Limits:       ${v.limits.timeoutMs} ms · ${v.limits.maxTurns} turn(s) · ${v.limits.maxOutputBytes} B out`);
  io.out(`  Bridge:       ${io.env[BRIDGE_URL_ENV] ?? UNKNOWN}`);
  // Accepting a start says nothing about the review's outcome.
  io.out(`  Next:         relay mission reviewer status ${v.missionId}`);
  return EXIT.completed;
}

/* ---------------------------------------------------- status/inspect --- */

async function status(
  client: ReviewerBridgeClient, input: ReviewerBridgeCliInput, io: BridgeCliIo,
): Promise<number> {
  const result = await client.getReviewerStatus(input.missionId);
  if (!result.ok) {
    if (!input.json) io.out(`REVIEWER — ${input.missionId}`);
    // An unreachable bridge is reported as unreachable — never as "not running".
    printError(io, result.error, input.json);
    return exitCodeForBridgeError(result.error);
  }
  const v = result.value;
  if (input.json) {
    io.out(JSON.stringify({
      ok: true, operation: 'status', missionId: v.missionId, runId: v.runId,
      state: v.view.connectionState,
      requestedHarness: v.view.requestedHarnessLabel, actualHarness: v.view.harnessLabel,
      requestedModel: v.view.requestedModelLabel, actualModel: v.view.modelLabel,
      provider: v.view.providerLabel, independence: v.view.independenceLabel,
      usage: v.view.usageLabel, startedAt: v.startedAt, completedAt: v.completedAt,
      limits: v.limits, failureClassification: v.failureClassification,
    }, null, 2));
    return EXIT.completed;
  }
  io.out(`REVIEWER — ${v.missionId}`);
  io.out(`  Run:          ${show(v.runId)}`);
  io.out(`  Connection:   ${v.view.connectionLabel}`);
  io.out(`  Harness:      ${v.view.harnessLabel} (requested ${v.view.requestedHarnessLabel})`);
  io.out(`  Model:        ${v.view.modelLabel} (requested ${v.view.requestedModelLabel})`);
  io.out(`  Provider:     ${v.view.providerLabel}`);
  io.out(`  Independence: ${v.view.independenceLabel}`);
  io.out(`  Usage:        ${v.view.usageLabel}`);
  io.out(`  Started:      ${show(v.startedAt)}`);
  io.out(`  Completed:    ${show(v.completedAt)}`);
  if (v.failureClassification !== null) io.out(`  Failure:      ${v.failureClassification}`);
  return EXIT.completed;
}

async function inspect(
  client: ReviewerBridgeClient, input: ReviewerBridgeCliInput, io: BridgeCliIo,
): Promise<number> {
  const result = await client.inspectReviewerRun(input.missionId);
  if (!result.ok) {
    if (!input.json) io.out(`REVIEWER — ${input.missionId}`);
    printError(io, result.error, input.json);
    return exitCodeForBridgeError(result.error);
  }
  const v = result.value;
  if (input.json) {
    io.out(JSON.stringify({
      ok: true, operation: 'inspect', missionId: v.missionId, runId: v.runId,
      state: v.view.connectionState,
      requestedHarness: v.view.requestedHarnessLabel, actualHarness: v.view.harnessLabel,
      requestedModel: v.view.requestedModelLabel, actualModel: v.view.modelLabel,
      provider: v.view.providerLabel,
      proposedVerdict: v.proposedVerdict, validatedVerdict: v.validatedVerdict,
      independence: v.independenceLabel, independenceReasons: v.independenceReasons,
      findings: v.findings, toolUseEvidence: v.toolUseEvidence,
      usage: v.view.usageLabel, stopReason: v.stopReason,
    }, null, 2));
    return EXIT.completed;
  }
  io.out(`REVIEWER — ${v.missionId}`);
  io.out(`  Run:          ${show(v.runId)}`);
  io.out(`  Connection:   ${v.view.connectionLabel}`);
  io.out(`  Harness:      ${v.view.harnessLabel} (requested ${v.view.requestedHarnessLabel})`);
  io.out(`  Model:        ${v.view.modelLabel} (requested ${v.view.requestedModelLabel})`);
  io.out(`  Proposed:     ${show(v.proposedVerdict)}`);
  // Relay's conclusion is separate from the harness's proposal, always.
  io.out(`  Validated:    ${show(v.validatedVerdict)}`);
  io.out(`  Independence: ${v.independenceLabel}`);
  for (const reason of v.independenceReasons) io.out(`    - ${reason}`);
  io.out(`  Findings:     ${v.findings.length}`);
  for (const f of v.findings) {
    io.out(`    [${f.severity}] ${f.findingId} ${f.title}${f.blocking ? ' (blocking)' : ''}`);
    if (f.file !== null) io.out(`      ${f.file}${f.line !== null ? `:${f.line}` : ''}`);
  }
  io.out(`  Tool use:     ${v.toolUseEvidence.length === 0 ? 'none recorded' : v.toolUseEvidence.join(', ')}`);
  io.out(`  Usage:        ${v.view.usageLabel}`);
  if (v.stopReason !== null) io.out(`  Stop reason:  ${v.stopReason}`);
  return EXIT.completed;
}

/* -------------------------------------------------------- stop/retry --- */

async function stop(
  client: ReviewerBridgeClient, input: ReviewerBridgeCliInput, io: BridgeCliIo,
): Promise<number> {
  const result = await client.stopReviewerRun(input.missionId);
  if (!result.ok) {
    if (!input.json) io.out(`REVIEWER STOP — ${input.missionId}`);
    printError(io, result.error, input.json);
    return exitCodeForBridgeError(result.error);
  }
  const v = result.value;
  if (input.json) {
    io.out(JSON.stringify({
      ok: true, operation: 'stop', missionId: v.missionId, runId: v.runId,
      cancellationRequested: v.cancellationRequested,
      cancellationConfirmed: v.cancellationConfirmed,
      state: v.state, findingsPreserved: v.findingsPreserved,
      // A stop is never a completion.
      completed: false,
    }, null, 2));
    return EXIT.completed;
  }
  io.out(`REVIEWER STOP — ${v.missionId}`);
  io.out(`  Run:          ${show(v.runId)}`);
  io.out(`  Requested:    ${v.cancellationRequested ? 'yes' : 'no'}`);
  // A request is not a confirmation, and neither is a completion.
  io.out(`  Confirmed:    ${v.cancellationConfirmed ? 'yes' : 'not yet'}`);
  io.out(`  State:        ${v.state}`);
  io.out(`  Findings:     ${v.findingsPreserved} preserved`);
  io.out(`  ${v.message}`);
  return EXIT.completed;
}

async function retry(
  client: ReviewerBridgeClient, input: ReviewerBridgeCliInput, io: BridgeCliIo,
): Promise<number> {
  const missing: string[] = [];
  if (input.priorRun === undefined || input.priorRun.trim() === '') missing.push('--prior-run');
  if (input.idempotencyKey === undefined || input.idempotencyKey.trim() === '') missing.push('--idempotency-key');
  if (missing.length > 0) {
    io.out(`mission reviewer retry requires ${missing.join(', ')}.`);
    return EXIT.usage;
  }
  if (!input.authorize) {
    // Prior authorization never carries over — a retry is a new paid call.
    io.out('mission reviewer retry requires fresh --authorize. A retry is a new Reviewer run.');
    return EXIT.blocked;
  }
  const result = await client.retryReviewerRun({
    missionId: input.missionId,
    priorRunId: input.priorRun as string,
    idempotencyKey: input.idempotencyKey as string,
    authorized: true,
  });
  if (!result.ok) {
    if (!input.json) io.out(`REVIEWER RETRY — ${input.missionId}`);
    printError(io, result.error, input.json);
    return exitCodeForBridgeError(result.error);
  }
  const v = result.value;
  if (input.json) {
    io.out(JSON.stringify({
      ok: true, operation: 'retry', missionId: v.missionId,
      priorRunId: v.priorRunId, runId: v.runId, idempotencyKey: v.idempotencyKey,
      state: v.state, preservedFindings: v.preservedFindings,
      requestedHarness: v.requestedHarness, requestedModel: v.requestedModel,
      completed: false,
    }, null, 2));
    return EXIT.completed;
  }
  io.out(`REVIEWER RETRY — ${v.missionId}`);
  // Both ids, so the prior run is never lost track of.
  io.out(`  Prior run:    ${v.priorRunId}`);
  io.out(`  New run:      ${v.runId}`);
  io.out(`  State:        ${v.state}`);
  io.out(`  Requested:    harness ${show(v.requestedHarness)} · model ${show(v.requestedModel)}`);
  io.out(`  Preserved:    ${v.preservedFindings} finding(s) from the prior run`);
  return EXIT.completed;
}
