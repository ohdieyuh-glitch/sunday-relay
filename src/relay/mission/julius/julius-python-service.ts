import {
  juliusBrainScope,
  juliusPrincipal,
  juliusBrainProvenance,
  type JuliusBrainDraft,
  type JuliusBrainPrincipal,
} from './julius-brain-contracts';
import { createJuliusBrainEvaluationContext, juliusPrincipalLabel } from './julius-brain-export';
import type { JuliusBrainReadGrant } from './julius-brain-policy';
import type { JuliusBrainCommitGroup, JuliusBrainRefusal } from './julius-brain-projection';
import { redactJuliusSecretsDeep } from './julius-brain-secrets';
import { readAllJuliusBrainEntities, type JuliusBrainGroupCommitResult, type JuliusBrainMemoryStore, type JuliusBrainStore } from './julius-brain-store';
import type { JuliusPolicyDecision, JuliusCardPolicy } from './julius-policy';
import {
  authorizeJuliusPythonExecution,
  convertJuliusPythonProposals,
  juliusPythonExecutionEntityId,
  juliusPythonInputsHash,
  juliusPythonRequestDigest,
  juliusPythonScriptHash,
  juliusPythonToolPrincipalId,
  juliusPythonWriteGrant,
  parseJuliusPythonResult,
  parseJuliusPythonUsage,
  validateJuliusPythonRequest,
  type JuliusPythonCollectedArtifact,
  type JuliusPythonExecutionRequest,
  type JuliusPythonResolvedEnvironment,
  type JuliusPythonRunOutcome,
  type JuliusPythonRunnerPort,
  type JuliusPythonStream,
  type JuliusPythonStructuredResult,
  type JuliusPythonUsage,
} from './julius-python-contracts';
import type { JuliusBudgetPort, JuliusClock } from './julius-runtime-ports';

/**
 * THE PYTHON EXECUTION SERVICE: REQUEST → AUTHORISE → RUN → SETTLE.
 *
 * DURABLE STATES
 *   REQUESTED ─┬─ DENIED
 *              ├─ CANCELLED            (cancelled before it started)
 *              └─ RUNNING ─┬─ SUCCEEDED | FAILED | TIMED_OUT
 *                          ├─ CANCEL_REQUESTED ── CANCELLED
 *                          └─ DISCONNECTED    (its host is gone; never replayed)
 *
 * SETTLEMENT IS ONE ATOMIC DECISION. The store calls `decide` with the state it
 * holds under its lock, and persists the terminal state and the Brain records
 * together. So a cancellation that lands while the process is finishing makes
 * the settlement CANCELLED — the script's staged output is discarded and the
 * Brain receives only Julius's own record of the cancellation — and a result
 * arriving after cancellation can never mutate the Brain.
 *
 * ANNOUNCED FACTS. CANCELLED is written only when the runner has confirmed the
 * process ended (killed, or it had already exited), never when the request was
 * merely made. SUCCEEDED requires a real exit 0 and validated structured output.
 */

export const JULIUS_PYTHON_EXECUTION_STATES = ['REQUESTED', 'RUNNING', 'CANCEL_REQUESTED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'DENIED', 'DISCONNECTED'] as const;
export type JuliusPythonExecutionState = typeof JULIUS_PYTHON_EXECUTION_STATES[number];
export const JULIUS_PYTHON_TERMINAL_STATES: readonly JuliusPythonExecutionState[] = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'DENIED', 'DISCONNECTED'];
type Terminal = 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED' | 'DENIED' | 'DISCONNECTED';

export interface JuliusPythonExecutionOutcome {
  readonly state: Terminal;
  readonly reasonCode: string | null;
  readonly detail: string | null;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
  readonly structured: JuliusPythonStructuredResult;
  readonly proposals: { readonly status: 'NONE' | 'VALID' | 'INVALID' | 'DISCARDED'; readonly staged: number | null; readonly admitted: number; readonly errors: readonly string[] };
  readonly stdout: JuliusPythonStream | null;
  readonly stderr: JuliusPythonStream | null;
  readonly artifacts: readonly JuliusPythonCollectedArtifact[];
  readonly usage: JuliusPythonUsage | null;
  readonly brain: { readonly outcome: 'COMMITTED' | 'PROPOSALS_REFUSED' | 'NOT_RECORDED'; readonly reasonCode: string | null; readonly executionEntityId: string; readonly recordIds: readonly string[] };
  readonly contextSnapshotHash: string | null;
  readonly redactions: number;
  readonly cancellation: { readonly requestedBy: string; readonly requestedAt: string; readonly confirmedBy: 'KILLED' | 'EXITED' | 'NEVER_STARTED' } | null;
  /** The process finished normally after cancellation was requested; its output was discarded. */
  readonly lateResultDiscarded: boolean;
}

export interface JuliusPythonExecutionRecord {
  readonly executionId: string;
  readonly projectId: string;
  readonly brainId: string;
  readonly missionId: string;
  readonly runId: string | null;
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly scriptHash: string;
  readonly requestedBy: JuliusBrainPrincipal;
  readonly state: JuliusPythonExecutionState;
  readonly hostInstanceId: string | null;
  readonly request: JuliusPythonExecutionRequest;
  readonly decisions: readonly JuliusPolicyDecision[] | null;
  readonly outcome: JuliusPythonExecutionOutcome | null;
  readonly cancellation: { readonly requestedBy: string; readonly requestedAt: string } | null;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly version: number;
}

export interface JuliusPythonSettlementPlan {
  readonly terminal: Terminal;
  readonly groups: readonly JuliusBrainCommitGroup[];
  readonly outcome: (brain: JuliusBrainGroupCommitResult | null) => JuliusPythonExecutionOutcome;
}

export interface JuliusPythonSettleInput {
  readonly executionId: string;
  readonly projectId: string;
  readonly expectedStates: readonly JuliusPythonExecutionState[];
  readonly completedAt: string;
  readonly recordedAt: string;
  /**
   * Called under the store's lock with the state it holds. Called again with
   * the Brain's refusal when a plan's groups are refused, and a third time with
   * `lastResort` when the fallback was refused too — which must carry no groups.
   */
  readonly decide: (input: {
    readonly state: JuliusPythonExecutionState;
    /** The durable cancellation request, when one was made — the only source of who asked and when. */
    readonly cancellation: JuliusPythonExecutionRecord['cancellation'];
    readonly refusal: (JuliusBrainRefusal & { readonly group: number }) | null;
    readonly lastResort: boolean;
  }) => JuliusPythonSettlementPlan;
}

export type JuliusPythonSettleResult =
  | { readonly settled: true; readonly record: JuliusPythonExecutionRecord }
  | { readonly settled: false; readonly record: JuliusPythonExecutionRecord | null };

export interface JuliusPythonExecutionStore {
  /** Idempotent on (projectId, idempotencyKey); a different digest under a used key throws. */
  create(record: JuliusPythonExecutionRecord): Promise<{ readonly created: boolean; readonly record: JuliusPythonExecutionRecord }>;
  load(executionId: string, projectId: string): Promise<JuliusPythonExecutionRecord | null>;
  /** REQUESTED → RUNNING. False when it is no longer REQUESTED. */
  start(input: { readonly executionId: string; readonly projectId: string; readonly hostInstanceId: string; readonly startedAt: string; readonly decisions: readonly JuliusPolicyDecision[] }): Promise<boolean>;
  /** RUNNING → CANCEL_REQUESTED; any other state is returned unchanged. */
  requestCancel(input: { readonly executionId: string; readonly projectId: string; readonly requestedBy: string; readonly requestedAt: string }): Promise<JuliusPythonExecutionRecord | null>;
  settle(input: JuliusPythonSettleInput): Promise<JuliusPythonSettleResult>;
  /** RUNNING or CANCEL_REQUESTED executions started before `startedBefore`. */
  listInFlight(input: { readonly startedBefore: string; readonly limit: number }): Promise<readonly JuliusPythonExecutionRecord[]>;
}

export interface JuliusPythonServiceDeps {
  readonly store: JuliusPythonExecutionStore;
  readonly brains: JuliusBrainStore;
  readonly runner: JuliusPythonRunnerPort;
  readonly environments: { resolve(environmentId: string): Promise<JuliusPythonResolvedEnvironment | null> };
  readonly secrets: { has(capabilityId: string): boolean; resolve(capabilityId: string): Promise<string | null> };
  readonly policies: { cardFor(request: JuliusPythonExecutionRequest): Promise<JuliusCardPolicy> };
  /** The canonical Brain schema document handed to the SDK. */
  readonly schema: unknown;
  readonly clock: JuliusClock;
  readonly hostInstanceId: string;
  readonly julius?: JuliusBrainPrincipal;
  /**
   * The run's tool budget. When present, an execution reserves one tool call
   * and its timeout as runtime before it starts, commits the observed runtime
   * when it settles, and is DENIED without running when the ledger refuses.
   * A local execution calls no provider, so its spend is a known zero.
   */
  readonly budget?: JuliusBudgetPort;
  readonly cancelPollMs?: number;
  /** Beyond timeout + this, an in-flight execution's host is presumed gone. */
  readonly disconnectGraceMs?: number;
}

export interface JuliusPythonExecutionService {
  execute(request: JuliusPythonExecutionRequest): Promise<JuliusPythonExecutionRecord>;
  cancel(input: { readonly executionId: string; readonly projectId: string; readonly requestedBy: JuliusBrainPrincipal }): Promise<'CANCEL_REQUESTED' | 'CANCELLED' | 'ALREADY_TERMINAL' | 'NOT_FOUND' | 'NOT_PERMITTED'>;
  load(executionId: string, projectId: string): Promise<JuliusPythonExecutionRecord | null>;
  /** Settle every in-flight execution whose host has provably gone as DISCONNECTED. Never relaunches. */
  recoverDisconnected(input?: { readonly limit?: number }): Promise<number>;
}

const EMPTY_STRUCTURED: JuliusPythonStructuredResult = Object.freeze({ status: 'ABSENT', errors: [], valueSet: false, value: null, metrics: [], proposalCount: null });

export function createJuliusPythonExecutionService(deps: JuliusPythonServiceDeps): JuliusPythonExecutionService {
  const julius = deps.julius ?? juliusPrincipal('JULIUS', 'julius');
  const controllers = new Map<string, AbortController>();
  const pollMs = deps.cancelPollMs ?? 250;
  const graceMs = deps.disconnectGraceMs ?? 60_000;

  const executionDraft = (request: JuliusPythonExecutionRequest, outcome: JuliusPythonExecutionOutcome, environment: JuliusPythonResolvedEnvironment | null, occurredAt: string): JuliusBrainDraft => ({
    kind: 'PYTHON_EXECUTION', op: 'CREATE', entityId: juliusPythonExecutionEntityId(request.executionId), expectedVersion: 0,
    body: {
      executionId: request.executionId, state: outcome.state, reasonCode: outcome.reasonCode,
      requestedBy: juliusPrincipalLabel(request.requestedBy).slice(0, 512), purpose: request.purpose,
      scriptHash: juliusPythonScriptHash(request.script), requestDigest: juliusPythonRequestDigest(request), inputsHash: juliusPythonInputsHash(request),
      contextSnapshotHash: outcome.contextSnapshotHash, environmentId: request.environment.environmentId,
      environmentHash: environment?.environmentHash ?? null,
      interpreter: outcome.usage?.interpreter
        ? { ...outcome.usage.interpreter, executableHash: environment?.executableHash ?? null }
        : (environment === null ? null : { version: environment.version, implementation: environment.implementation, platform: environment.platform, executableHash: environment.executableHash }),
      requirements: request.environment.requirements.map(({ name, version }) => ({ name, version })),
      dependencies: outcome.usage?.dependencies ?? null,
      exitCode: outcome.exitCode, durationMs: outcome.durationMs,
      cpuSeconds: outcome.usage?.cpuSeconds ?? null, peakMemoryBytes: outcome.usage?.peakMemoryBytes ?? null,
      network: request.network.mode,
      networkDestinations: request.network.mode === 'ALLOWLIST' ? request.network.destinations.map((d) => `${d.host}:${d.port ?? '*'}`) : [],
      enforcement: outcome.usage?.enforcement ?? {},
      denialCount: outcome.usage?.denialCount ?? null,
      stdoutHash: outcome.stdout?.hash ?? null, stderrHash: outcome.stderr?.hash ?? null,
      stdoutBytes: outcome.stdout?.bytes ?? null, stderrBytes: outcome.stderr?.bytes ?? null,
      outputTruncated: Boolean(outcome.stdout?.truncated || outcome.stderr?.truncated),
      structuredOutput: outcome.structured.status === 'VALID' && outcome.proposals.status === 'INVALID' ? 'INVALID' : outcome.structured.status,
      structuredOutputErrors: [...outcome.structured.errors, ...outcome.proposals.errors].slice(0, 16).map((error) => error.slice(0, 512)),
      proposalsStaged: outcome.proposals.staged, proposalsAdmitted: outcome.proposals.admitted,
      artifactCount: outcome.artifacts.filter((artifact) => artifact.quarantined === null).length,
      redactions: outcome.redactions,
      cancellation: outcome.cancellation,
    } as unknown as JuliusBrainDraft['body'],
    links: [],
    scope: juliusBrainScope({ missionId: request.missionId, runId: request.runId, taskId: request.taskId }),
    retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
    provenance: juliusBrainProvenance('tool_observed', { tool: 'python.run', executionId: request.executionId }),
    idempotencyKey: `python-execution:${request.executionId}`,
    occurredAt,
  });

  const baseOutcome = (state: Terminal, patch: Partial<JuliusPythonExecutionOutcome> = {}): JuliusPythonExecutionOutcome => ({
    state, reasonCode: null, detail: null, exitCode: null, durationMs: null, structured: EMPTY_STRUCTURED,
    proposals: { status: 'NONE', staged: null, admitted: 0, errors: [] }, stdout: null, stderr: null, artifacts: [], usage: null,
    brain: { outcome: 'NOT_RECORDED', reasonCode: null, executionEntityId: '', recordIds: [] },
    contextSnapshotHash: null, redactions: 0, cancellation: null, lateResultDiscarded: false,
    ...patch,
  });

  const withBrain = (outcome: JuliusPythonExecutionOutcome, request: JuliusPythonExecutionRequest, brain: JuliusBrainGroupCommitResult | null, refusal: { reasonCode: string } | null): JuliusPythonExecutionOutcome => ({
    ...outcome,
    brain: brain !== null && brain.outcome === 'COMMITTED'
      ? { outcome: refusal === null ? 'COMMITTED' : 'PROPOSALS_REFUSED', reasonCode: refusal?.reasonCode ?? null, executionEntityId: juliusPythonExecutionEntityId(request.executionId), recordIds: brain.receipts.flat().map((receipt) => receipt.recordId) }
      : { outcome: 'NOT_RECORDED', reasonCode: brain?.outcome === 'REFUSED' ? brain.reasonCode : (refusal?.reasonCode ?? null), executionEntityId: juliusPythonExecutionEntityId(request.executionId), recordIds: [] },
  });

  /** A settlement that writes Julius's own execution record and nothing from the process. */
  const recordOnly = (request: JuliusPythonExecutionRequest, outcome: JuliusPythonExecutionOutcome, environment: JuliusPythonResolvedEnvironment | null, at: string) => (lastResort: boolean): JuliusPythonSettlementPlan => ({
    terminal: outcome.state,
    groups: lastResort ? [] : [{ principal: julius, grant: null, drafts: [executionDraft(request, outcome, environment, at)] }],
    outcome: (brain) => withBrain(outcome, request, brain, null),
  });

  async function settleWithoutRun(request: JuliusPythonExecutionRequest, expected: readonly JuliusPythonExecutionState[], outcome: JuliusPythonExecutionOutcome, environment: JuliusPythonResolvedEnvironment | null): Promise<JuliusPythonExecutionRecord> {
    const at = deps.clock.now();
    const plan = recordOnly(request, outcome, environment, at);
    const result = await deps.store.settle({
      executionId: request.executionId, projectId: request.projectId, expectedStates: expected, completedAt: at, recordedAt: at,
      decide: ({ lastResort }) => plan(lastResort),
    });
    return result.record ?? (await deps.store.load(request.executionId, request.projectId))!;
  }

  function classify(run: JuliusPythonRunOutcome, usage: JuliusPythonUsage | null): { terminal: Terminal; reasonCode: string | null } {
    switch (run.termination) {
      case 'TIMED_OUT': return { terminal: 'TIMED_OUT', reasonCode: 'TIMEOUT' };
      case 'CANCELLED': return { terminal: 'CANCELLED', reasonCode: 'CANCELLED_BY_REQUEST' };
      case 'SPAWN_FAILED': return { terminal: 'FAILED', reasonCode: 'SPAWN_FAILED' };
      case 'OUTPUT_LIMIT': return { terminal: 'FAILED', reasonCode: 'OUTPUT_LIMIT' };
      case 'EXITED':
        if (run.exitCode === 0) return { terminal: 'SUCCEEDED', reasonCode: null };
        if (run.exitCode === 90) return { terminal: 'FAILED', reasonCode: 'CONTROL_INVALID' };
        if (run.exitCode === 91) return { terminal: 'FAILED', reasonCode: 'SCRIPT_HASH_MISMATCH' };
        if (run.exitCode === 92) return { terminal: 'FAILED', reasonCode: 'DEPENDENCY_UNSATISFIED' };
        if (usage?.scriptError === 'MemoryError') return { terminal: 'FAILED', reasonCode: 'MEMORY_LIMIT' };
        if (usage?.scriptError === 'PermissionError' && (usage.denialCount ?? 0) > 0) return { terminal: 'FAILED', reasonCode: 'GOVERNANCE_DENIED' };
        // A process killed by the OS (a job memory limit on Windows can end
        // it before Python raises) exits non-zero with no runner report.
        if (usage === null) return { terminal: 'FAILED', reasonCode: 'TERMINATED_WITHOUT_REPORT' };
        return { terminal: 'FAILED', reasonCode: 'NONZERO_EXIT' };
    }
  }

  return {
    async execute(request) {
      const errors = validateJuliusPythonRequest(request);
      if (errors.length > 0) throw new Error(`julius_python_request_invalid: ${errors.slice(0, 6).join('; ')}`);
      const { record: stored } = await deps.store.create({
        executionId: request.executionId, projectId: request.projectId, brainId: request.brainId, missionId: request.missionId,
        runId: request.runId, taskId: request.taskId, idempotencyKey: request.idempotencyKey, requestDigest: juliusPythonRequestDigest(request),
        scriptHash: juliusPythonScriptHash(request.script), requestedBy: request.requestedBy, state: 'REQUESTED', hostInstanceId: null,
        request, decisions: null, outcome: null, cancellation: null, requestedAt: request.requestedAt, startedAt: null, completedAt: null, version: 1,
      });
      // A REPLAY RETURNS WHAT HAPPENED. It never runs the script a second time.
      if (stored.state !== 'REQUESTED' || stored.executionId !== request.executionId) return stored;

      if ((await deps.brains.loadBrain(request.brainId, request.projectId)) === null) {
        return settleWithoutRun(request, ['REQUESTED'], baseOutcome('DENIED', { reasonCode: 'BRAIN_NOT_FOUND', detail: `${request.brainId} is not a Brain of ${request.projectId}.` }), null);
      }
      const environment = await deps.environments.resolve(request.environment.environmentId);
      const authorization = authorizeJuliusPythonExecution({ request, card: await deps.policies.cardFor(request), environment, secretAvailable: (id) => deps.secrets.has(id) });
      if (!authorization.allowed) {
        return settleWithoutRun(request, ['REQUESTED'], baseOutcome('DENIED', { reasonCode: authorization.reasonCode, detail: authorization.detail }), environment);
      }
      const reservationId = `python:${request.projectId}:${request.executionId}`;
      if (deps.budget !== undefined) {
        // The ledger is per run; an execution outside a run has nothing to charge against.
        if (request.runId === null) {
          return settleWithoutRun(request, ['REQUESTED'], baseOutcome('DENIED', { reasonCode: 'BUDGET_RUN_REQUIRED', detail: 'A budgeted execution must belong to a run.' }), environment);
        }
        const reserved = await deps.budget.reserve({
          reservationId, runId: request.runId, projectId: request.projectId, taskId: request.taskId,
          usdMicros: 0, inputTokens: 0, outputTokens: 0, toolCalls: 1, runtimeMs: request.limits.timeoutMs, now: deps.clock.now(),
        });
        if (reserved.state === 'DENIED') {
          return settleWithoutRun(request, ['REQUESTED'], baseOutcome('DENIED', { reasonCode: 'TOOL_BUDGET_DENIED', detail: reserved.denialReason }), environment);
        }
      }
      const startedAt = deps.clock.now();
      if (!(await deps.store.start({ executionId: request.executionId, projectId: request.projectId, hostInstanceId: deps.hostInstanceId, startedAt, decisions: authorization.decisions }))) {
        await deps.budget?.release({ reservationId, reason: 'PYTHON_EXECUTION_NOT_STARTED', now: deps.clock.now(), usdMicros: 0 });
        return (await deps.store.load(request.executionId, request.projectId))!;
      }

      const controller = new AbortController();
      controllers.set(request.executionId, controller);
      // CROSS-PROCESS CANCELLATION: another host may write CANCEL_REQUESTED.
      const poll = setInterval(() => {
        void deps.store.load(request.executionId, request.projectId).then((current) => {
          if (current?.state === 'CANCEL_REQUESTED') controller.abort();
        }, () => undefined);
      }, pollMs);
      let run: JuliusPythonRunOutcome;
      let contextSnapshotHash: string | null = null;
      // A staged link may name only what this execution was allowed to see.
      const visibleEntityIds = new Set<string>();
      const secretValues: string[] = [];
      try {
        const head = (await deps.brains.head(request.brainId, request.projectId))!;
        const readGrant: JuliusBrainReadGrant = {
          grantId: `python-read:${request.executionId}`, brainId: request.brainId, kinds: request.brainRead.kinds,
          missionIds: [request.missionId], taskIds: request.brainRead.taskScoped ? [request.taskId] : null,
          includeHistory: request.brainRead.includeHistory, includeRestricted: false,
        };
        const context = createJuliusBrainEvaluationContext({
          brainId: request.brainId, entities: await readAllJuliusBrainEntities(deps.brains, request.brainId, request.projectId),
          head, grant: readGrant, consumerRunId: request.executionId, createdAt: startedAt,
        });
        contextSnapshotHash = context.snapshotHash;
        for (const state of context.entities) visibleEntityIds.add(state.entityId);
        const secrets: { envName: string; value: string }[] = [];
        for (const grant of request.secrets) {
          const value = await deps.secrets.resolve(grant.capabilityId);
          if (value === null) throw new Error('julius_python_secret_vanished');
          secrets.push({ envName: grant.envName, value });
          secretValues.push(value);
        }
        run = await deps.runner.run({
          request, environment: environment!, context, schema: deps.schema, secrets,
          writeGrant: { kinds: request.brainWrite.kinds, maxRecords: Math.min(request.brainWrite.maxRecords, request.limits.maxProposals) },
        }, controller.signal);
      } catch (error) {
        const empty = { text: '', bytes: 0, truncated: false, hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', redactions: 0 };
        run = {
          termination: controller.signal.aborted ? 'CANCELLED' : 'SPAWN_FAILED', exitCode: null, durationMs: 0, scriptHash: juliusPythonScriptHash(request.script),
          stdout: empty, stderr: empty, resultText: null, resultTooLarge: false, proposalsText: null, proposalsTooLarge: false, usageText: null, artifacts: [],
          spawnError: error instanceof Error ? error.message.split('\n')[0]!.slice(0, 300) : 'unknown',
        };
      } finally {
        clearInterval(poll);
        controllers.delete(request.executionId);
      }

      const completedAt = deps.clock.now();
      const usage = parseJuliusPythonUsage(run.usageText);
      const parsedResult = parseJuliusPythonResult(request.executionId, run.resultText, run.resultTooLarge);
      const redactedValue = redactJuliusSecretsDeep(parsedResult.value, secretValues);
      const structured: JuliusPythonStructuredResult = { ...parsedResult, value: redactedValue.value };
      const { terminal: ranTo, reasonCode: ranReason } = classify(run, usage);
      const conversion = ranTo === 'SUCCEEDED'
        ? convertJuliusPythonProposals({
          request, text: run.proposalsText, tooLarge: run.proposalsTooLarge, visibleEntityIds, artifacts: run.artifacts,
          scriptHash: run.scriptHash, environmentHash: environment?.environmentHash ?? null, occurredAt: completedAt,
        })
        : { status: 'NONE' as const, staged: null, errors: [], drafts: [] };
      // COMPLETED MEANS VALIDATED. An exit 0 whose structured output did not
      // validate is not a success Julius can build on.
      const outputInvalid = ranTo === 'SUCCEEDED' && (structured.status === 'INVALID' || conversion.status === 'INVALID');
      const terminal: Terminal = outputInvalid ? 'FAILED' : ranTo;
      const reasonCode = outputInvalid ? 'STRUCTURED_OUTPUT_INVALID' : ranReason;
      const redactions = run.stdout.redactions + run.stderr.redactions + redactedValue.redactions;
      const common = {
        exitCode: run.exitCode, durationMs: run.durationMs, structured, stdout: run.stdout, stderr: run.stderr,
        artifacts: run.artifacts, usage, contextSnapshotHash, redactions, detail: run.spawnError,
      };
      const toolPrincipal = juliusPrincipal('TOOL', juliusPythonToolPrincipalId(request.executionId), { onBehalfOf: request.requestedBy.id, grantId: `python-grant:${request.executionId}` });
      const grantExpiry = new Date(Date.parse(completedAt) + 10 * 60_000).toISOString();

      const settled = await deps.store.settle({
        executionId: request.executionId, projectId: request.projectId, expectedStates: ['RUNNING', 'CANCEL_REQUESTED'],
        completedAt, recordedAt: completedAt,
        decide: ({ state, cancellation, refusal, lastResort }) => {
          if (state === 'CANCEL_REQUESTED' || run.termination === 'CANCELLED') {
            const confirmedBy = run.termination === 'CANCELLED' ? 'KILLED' as const : 'EXITED' as const;
            const outcome = baseOutcome('CANCELLED', {
              ...common, reasonCode: 'CANCELLED_BY_REQUEST',
              proposals: { status: 'DISCARDED', staged: conversion.staged, admitted: 0, errors: [] },
              cancellation: cancellation === null ? null : { requestedBy: cancellation.requestedBy, requestedAt: cancellation.requestedAt, confirmedBy },
              lateResultDiscarded: confirmedBy === 'EXITED',
            });
            return recordOnly(request, outcome, environment, completedAt)(lastResort);
          }
          const admitted = refusal === null && !lastResort ? conversion.drafts.length : 0;
          const outcome = baseOutcome(refusal === null ? terminal : 'FAILED', {
            ...common,
            reasonCode: refusal === null ? reasonCode : `BRAIN_REFUSED_PROPOSALS:${refusal.reasonCode}`,
            proposals: { status: conversion.status, staged: conversion.staged, admitted, errors: refusal === null ? conversion.errors : [`${refusal.reasonCode}: ${refusal.detail}`.slice(0, 512)] },
          });
          if (lastResort) return recordOnly(request, outcome, environment, completedAt)(true);
          const groups: JuliusBrainCommitGroup[] = [{ principal: julius, grant: null, drafts: [executionDraft(request, outcome, environment, completedAt)] }];
          if (refusal === null && terminal === 'SUCCEEDED' && conversion.drafts.length > 0) {
            groups.push({ principal: toolPrincipal, grant: juliusPythonWriteGrant(request, grantExpiry), drafts: conversion.drafts, secretLiterals: secretValues });
          }
          return { terminal: outcome.state, groups, outcome: (brain) => withBrain(outcome, request, brain, refusal) };
        },
      });
      if (deps.budget !== undefined) {
        // A process that never started consumed nothing; one that ran used its observed time.
        if (run.termination === 'SPAWN_FAILED') await deps.budget.release({ reservationId, reason: 'PYTHON_SPAWN_FAILED', now: completedAt, usdMicros: 0 });
        else await deps.budget.commit({ reservationId, usdMicros: 0, inputTokens: 0, outputTokens: 0, toolCalls: 1, runtimeMs: run.durationMs, receiptId: request.executionId, now: completedAt });
      }
      return settled.record ?? (await deps.store.load(request.executionId, request.projectId))!;
    },

    async cancel(input) {
      const current = await deps.store.load(input.executionId, input.projectId);
      if (current === null) return 'NOT_FOUND';
      const authority = input.requestedBy.kind === 'JULIUS' || input.requestedBy.kind === 'USER'
        || (input.requestedBy.kind === current.requestedBy.kind && input.requestedBy.id === current.requestedBy.id);
      if (!authority) return 'NOT_PERMITTED';
      if (JULIUS_PYTHON_TERMINAL_STATES.includes(current.state)) return 'ALREADY_TERMINAL';
      const requestedAt = deps.clock.now();
      const label = juliusPrincipalLabel(input.requestedBy).slice(0, 512);
      if (current.state === 'REQUESTED') {
        const outcome = baseOutcome('CANCELLED', { reasonCode: 'CANCELLED_BY_REQUEST', cancellation: { requestedBy: label, requestedAt, confirmedBy: 'NEVER_STARTED' } });
        const record = await settleWithoutRun(current.request, ['REQUESTED'], outcome, null);
        return record.state === 'CANCELLED' ? 'CANCELLED' : JULIUS_PYTHON_TERMINAL_STATES.includes(record.state) ? 'ALREADY_TERMINAL' : 'CANCEL_REQUESTED';
      }
      const updated = await deps.store.requestCancel({ executionId: input.executionId, projectId: input.projectId, requestedBy: label, requestedAt });
      controllers.get(input.executionId)?.abort();
      if (updated === null) return 'NOT_FOUND';
      return JULIUS_PYTHON_TERMINAL_STATES.includes(updated.state) ? 'ALREADY_TERMINAL' : 'CANCEL_REQUESTED';
    },

    load: (executionId, projectId) => deps.store.load(executionId, projectId),

    async recoverDisconnected(input = {}) {
      const now = Date.parse(deps.clock.now());
      const candidates = await deps.store.listInFlight({ startedBefore: new Date(now - graceMs).toISOString(), limit: input.limit ?? 100 });
      let settled = 0;
      for (const record of candidates) {
        if (controllers.has(record.executionId)) continue;
        if (record.startedAt === null || Date.parse(record.startedAt) + record.request.limits.timeoutMs + graceMs > now) continue;
        const at = deps.clock.now();
        // Termination was never confirmed, so no cancellation is claimed even
        // when one was requested: DISCONNECTED says exactly what is known.
        const outcome = baseOutcome('DISCONNECTED', {
          reasonCode: 'HOST_LOST',
          detail: `No host confirmed an outcome within timeout + ${graceMs}ms; the execution is not replayed or relaunched.`,
        });
        const plan = recordOnly(record.request, outcome, null, at);
        const result = await deps.store.settle({
          executionId: record.executionId, projectId: record.projectId, expectedStates: ['RUNNING', 'CANCEL_REQUESTED'], completedAt: at, recordedAt: at,
          decide: ({ lastResort }) => plan(lastResort),
        });
        if (result.settled) settled += 1;
      }
      return settled;
    },
  };
}

/**
 * THE SETTLEMENT LOOP EVERY STORE RUNS UNDER ITS LOCK: the primary plan; on a
 * Brain refusal, the fallback the refusal produces; on a second refusal, a
 * last resort with no Brain groups — so an execution is never left in flight
 * because its records could not be written.
 */
export function settleJuliusPythonPlan(
  input: JuliusPythonSettleInput,
  row: Pick<JuliusPythonExecutionRecord, 'state' | 'cancellation'>,
  commit: (groups: readonly JuliusBrainCommitGroup[]) => JuliusBrainGroupCommitResult,
): { readonly terminal: Terminal; readonly outcome: JuliusPythonExecutionOutcome } {
  const steps = settlementSteps(input, row);
  let step = steps.next();
  while (!step.done) step = steps.next(commit(step.value));
  return step.value;
}

/** The same loop for a store whose Brain commit is asynchronous (inside its transaction). */
export async function settleJuliusPythonPlanAsync(
  input: JuliusPythonSettleInput,
  row: Pick<JuliusPythonExecutionRecord, 'state' | 'cancellation'>,
  commit: (groups: readonly JuliusBrainCommitGroup[]) => Promise<JuliusBrainGroupCommitResult>,
): Promise<{ readonly terminal: Terminal; readonly outcome: JuliusPythonExecutionOutcome }> {
  const steps = settlementSteps(input, row);
  let step = steps.next();
  while (!step.done) step = steps.next(await commit(step.value));
  return step.value;
}

function* settlementSteps(
  input: JuliusPythonSettleInput,
  row: Pick<JuliusPythonExecutionRecord, 'state' | 'cancellation'>,
): Generator<readonly JuliusBrainCommitGroup[], { readonly terminal: Terminal; readonly outcome: JuliusPythonExecutionOutcome }, JuliusBrainGroupCommitResult> {
  let refusal: (JuliusBrainRefusal & { group: number }) | null = null;
  let plan = input.decide({ state: row.state, cancellation: row.cancellation, refusal: null, lastResort: false });
  let brain: JuliusBrainGroupCommitResult | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (plan.groups.length === 0) { brain = null; break; }
    const result: JuliusBrainGroupCommitResult = yield plan.groups;
    brain = result;
    if (result.outcome === 'COMMITTED') break;
    refusal = result;
    plan = input.decide({ state: row.state, cancellation: row.cancellation, refusal, lastResort: attempt >= 1 });
  }
  return { terminal: plan.terminal, outcome: plan.outcome(brain) };
}

/* ------------------------------------------------------ in-memory model */

/**
 * The execution store's semantics in memory, sharing the Brain memory store so
 * a settlement's state change and its Brain records are one synchronous step —
 * the same atomicity the PostgreSQL store gets from one transaction.
 */
export function createJuliusPythonExecutionMemoryStore(brains: JuliusBrainMemoryStore): JuliusPythonExecutionStore {
  const rows = new Map<string, JuliusPythonExecutionRecord>();
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const key = (projectId: string, idempotencyKey: string) => `${projectId}\u0000${idempotencyKey}`;
  const byKey = new Map<string, string>();
  const owned = (executionId: string, projectId: string) => {
    const row = rows.get(executionId);
    return row !== undefined && row.projectId === projectId ? row : null;
  };
  return {
    async create(record) {
      const existingId = byKey.get(key(record.projectId, record.idempotencyKey));
      if (existingId !== undefined) {
        const existing = rows.get(existingId)!;
        if (existing.requestDigest !== record.requestDigest) throw new Error('julius_python_idempotency_conflict');
        return { created: false, record: copy(existing) };
      }
      if (rows.has(record.executionId)) throw new Error('julius_python_execution_id_taken');
      rows.set(record.executionId, copy(record));
      byKey.set(key(record.projectId, record.idempotencyKey), record.executionId);
      return { created: true, record: copy(record) };
    },
    async load(executionId, projectId) {
      const row = owned(executionId, projectId);
      return row === null ? null : copy(row);
    },
    async start(input) {
      const row = owned(input.executionId, input.projectId);
      if (row === null || row.state !== 'REQUESTED') return false;
      rows.set(row.executionId, { ...row, state: 'RUNNING', hostInstanceId: input.hostInstanceId, startedAt: input.startedAt, decisions: copy(input.decisions), version: row.version + 1 });
      return true;
    },
    async requestCancel(input) {
      const row = owned(input.executionId, input.projectId);
      if (row === null) return null;
      if (row.state !== 'RUNNING') return copy(row);
      const updated = { ...row, state: 'CANCEL_REQUESTED' as const, cancellation: { requestedBy: input.requestedBy, requestedAt: input.requestedAt }, version: row.version + 1 };
      rows.set(row.executionId, updated);
      return copy(updated);
    },
    async settle(input) {
      // Synchronous from the state check to the last write.
      const row = owned(input.executionId, input.projectId);
      if (row === null || !input.expectedStates.includes(row.state)) return { settled: false, record: row === null ? null : copy(row) };
      const plan = settleJuliusPythonPlan(input, row, (groups) => brains.commitGroupSync({ brainId: row.brainId, projectId: row.projectId, recordedAt: input.recordedAt, groups }));
      const settled: JuliusPythonExecutionRecord = { ...row, state: plan.terminal, outcome: copy(plan.outcome), completedAt: input.completedAt, version: row.version + 1 };
      rows.set(row.executionId, settled);
      return { settled: true, record: copy(settled) };
    },
    async listInFlight(input) {
      return [...rows.values()]
        .filter((row) => (row.state === 'RUNNING' || row.state === 'CANCEL_REQUESTED') && row.startedAt !== null && row.startedAt < input.startedBefore)
        .slice(0, input.limit).map(copy);
    },
  };
}
