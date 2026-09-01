/**
 * THE THREE LIVE WORKERS, AS JULIUS PROVIDER ADAPTERS.
 *
 * Each factory wraps an EXISTING, already-proven provider implementation —
 * `runGptArchitect` (OpenAI Responses API), `runHostedCodingAgent` (Claude
 * Agent SDK), `runHermesReview` (local Hermes binary) — behind Julius's
 * provider-neutral `JuliusProviderAdapter` port. No provider client is
 * duplicated here and no provider payload leaves this module: adapters return
 * structured results and evidence whose summaries are composed from counts,
 * identifiers and observed model names, never from response bodies.
 *
 * WORKERS DO NOT ORCHESTRATE. An adapter receives a task and a context id,
 * answers with a result, and holds no reference to the registry, the router,
 * another adapter, or the run loop. The only cross-task material a worker can
 * see arrives through the two composition-owned handoffs below, both written
 * by Julius-dispatched work and both read-only to the next worker.
 *
 * WHY A CONTEXT HANDOFF EXISTS. The runtime compiles and persists a context
 * snapshot BEFORE dispatch, then hands the adapter only `{taskId, contextId}`.
 * PostgreSQL stores the snapshot's bounded metadata, not its packet text, so a
 * live adapter must receive the compiled packet from the same process that
 * persisted it. `CompiledContextSource` is that handoff: the composition wraps
 * the store's `persist` and retains each full snapshot under its contextId.
 */

import { createHash } from 'node:crypto';
import {
  JuliusDispatchError,
  type JuliusContextSnapshot,
  type JuliusProviderAdapter,
  type JuliusProviderResult,
  type JuliusWorker,
} from '../../src/relay/mission/julius';
import {
  runGptArchitect,
  type GptArchitectConfig,
  type GptRunOutcome,
} from '../../src/relay/connectors/gpt-architect';
import { validateArchitectPlan } from '../../src/relay/mission/prompt-architect/prompt-architect-plan';
import {
  loadHostedQuery,
  runHostedCodingAgent,
  type HostedQueryFn,
  type HostedRunOutcome,
} from '../hosted-coding-agent/hosted-runner';
import {
  runHermesReview,
  type HermesConfig,
  type HermesOutcome,
  type ReviewPacket,
} from '../hermes-reviewer';
import type { ShellEffectPort } from './executor-effects';

/* ------------------------------------------------------------- handoffs */

/** Compiled context snapshots, keyed by contextId, same-process only. */
export interface CompiledContextSource {
  snapshotFor(contextId: string): JuliusContextSnapshot | null;
}

/**
 * Bounded text artifacts produced by one Julius-dispatched task and read by a
 * later one (the architect's plan, the coder's diff and base revision). Keys
 * are runId-scoped; values are capped so a runaway payload cannot grow the
 * process without bound.
 */
export interface LiveArtifactExchange {
  put(ref: string, text: string): void;
  get(ref: string): string | null;
}

export const ARTIFACT_TEXT_CAP = 256 * 1024;

export function createLiveArtifactExchange(): LiveArtifactExchange {
  const values = new Map<string, string>();
  return {
    put(ref, text) { values.set(ref, text.slice(0, ARTIFACT_TEXT_CAP)); },
    get(ref) { return values.get(ref) ?? null; },
  };
}

export const planRef = (runId: string): string => `plan:${runId}`;
export const diffRef = (runId: string): string => `diff:${runId}`;
export const baseRevisionRef = (runId: string): string => `base:${runId}`;
export const testOutputRef = (runId: string): string => `test-output:${runId}`;

/* -------------------------------------------------------------- helpers */

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * A summary that may quote worker-derived text is bounded and scrubbed of
 * secret-shaped substrings before it can reach evidence or an event. This is
 * defense in depth on top of the callers' own redaction, not a substitute.
 */
export function safeClaim(text: string, cap = 240): string {
  return text
    .replace(/\b(sk|xai|rk|pk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]')
    .replace(/[\x00-\x1f]+/g, ' ')
    .slice(0, cap);
}

function requireSnapshot(contexts: CompiledContextSource, contextId: string): JuliusContextSnapshot {
  const snapshot = contexts.snapshotFor(contextId);
  if (snapshot === null) {
    // The pipeline persists the snapshot immediately before dispatch in this
    // same process, so a miss means the handoff itself is broken — refuse
    // rather than dispatch a provider against a context nobody compiled.
    throw new JuliusDispatchError('INVALID_REQUEST', false, 'Compiled context is not available to the adapter.');
  }
  return snapshot;
}

const packetText = (snapshot: JuliusContextSnapshot): string =>
  snapshot.packet.blocks.map((block) => block.text).join('');

const nowIso = (): string => new Date().toISOString();

/* ----------------------------------------------------- prompt architect */

const ARCHITECT_CHARTER = [
  'You are the Prompt Architect for a Relay mission run by Julius, the mission controller.',
  'Read the mission context below and produce the structured plan the output schema requires.',
  'You plan; you do not implement, review, or approve your own work.',
].join(' ');

export function createLiveArchitectAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly config: GptArchitectConfig;
  readonly apiKey: string;
  /** Injectable for offline tests; defaults to the real connector. */
  readonly run?: typeof runGptArchitect;
}): JuliusProviderAdapter {
  if (!input.config.liveMode || input.config.model === null || !input.apiKey) {
    throw new Error('architect_adapter_requires_live_config');
  }
  const run = input.run ?? runGptArchitect;
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      const outcome: GptRunOutcome = await run({
        apiKey: input.apiKey,
        config: input.config,
        instructions: ARCHITECT_CHARTER,
        input: packetText(snapshot),
        signal: dispatch.signal,
      });
      if (!outcome.ok) {
        switch (outcome.failureClass) {
          case 'authentication_failed':
          case 'permission_denied':
            throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'Prompt Architect authentication or configuration failed.');
          case 'rate_limited':
            throw new JuliusDispatchError('RATE_LIMIT', true, 'Prompt Architect provider rate limit reached.');
          case 'timeout':
          case 'network_disconnected':
            throw new JuliusDispatchError('TIMEOUT', true, 'Prompt Architect provider timed out.');
          case 'model_unavailable':
            throw new JuliusDispatchError('PROVIDER_UNAVAILABLE', false, 'Prompt Architect model is unavailable.');
          default:
            throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Prompt Architect failed: ${outcome.failureClass}.`);
        }
      }
      let parsed: unknown;
      try { parsed = JSON.parse(outcome.outputText); } catch {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Prompt Architect output was not parseable JSON.');
      }
      const validation = validateArchitectPlan(parsed);
      if (!validation.ok) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Prompt Architect plan failed validation: ${safeClaim(validation.reason, 120)}.`);
      }
      input.artifacts.put(planRef(snapshot.runId), outcome.outputText);
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Prompt Architect plan produced by observed model ${outcome.actualModel ?? 'unknown'} (response ${outcome.responseId ?? 'unknown'}).`,
        evidence: [{
          type: 'ARTIFACT',
          status: 'PASSED',
          safeSummary: `Validated architect plan stored for this run (${outcome.outputText.length} chars, sha256:${sha256(outcome.outputText).slice(0, 16)}…).`,
          artifactRef: planRef(snapshot.runId),
          occurredAt: nowIso(),
        }],
        usage: {
          inputTokens: outcome.usage.inputTokens ?? undefined,
          outputTokens: outcome.usage.outputTokens ?? undefined,
          toolCalls: 0,
        },
      };
    },
  };
}

/* --------------------------------------------------------- coding agent */

const CODER_CHARTER = [
  'You are the Coding Agent for a Relay mission run by Julius, the mission controller.',
  'Implement exactly what the mission context and the architect plan below require, by editing files in this workspace only.',
  'Do not run commands; verification is executed separately by an independent executor.',
  'You implement; you do not review or approve your own work, and completion is decided by Julius.',
].join(' ');

export function createLiveHostedCodingAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly projectId: string;
  readonly apiKey: string;
  readonly requestedModel: string;
  readonly workspacePath: string;
  /** The deterministic verification command the mission declares. */
  readonly testCommand: string;
  /** Tool effects go through the independent executor, never a local shell. */
  readonly shell: ShellEffectPort;
  readonly run?: typeof runHostedCodingAgent;
  readonly queryLoader?: () => Promise<HostedQueryFn>;
}): JuliusProviderAdapter {
  if (!input.apiKey || !input.requestedModel || !input.workspacePath || !input.testCommand) {
    throw new Error('hosted_coding_adapter_requires_live_config');
  }
  const run = input.run ?? runHostedCodingAgent;
  const loadQuery = input.queryLoader ?? loadHostedQuery;
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      const plan = input.artifacts.get(planRef(snapshot.runId));

      const shellScope = {
        runId: snapshot.runId,
        projectId: input.projectId,
        taskId: dispatch.taskId,
        workerId: input.worker.workerId,
      };
      const before = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:base`,
        command: 'git rev-parse HEAD',
        timeoutMs: 15_000,
      });
      if (before.status === 'SUCCEEDED') {
        input.artifacts.put(baseRevisionRef(snapshot.runId), before.stdout.trim());
      }

      let queryFn: HostedQueryFn;
      try { queryFn = await loadQuery(); } catch {
        throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'The hosted Claude Agent SDK runtime is not installed.');
      }
      const outcome: HostedRunOutcome = await run({
        queryFn,
        prompt: [
          CODER_CHARTER,
          '--- MISSION CONTEXT ---',
          packetText(snapshot),
          '--- ARCHITECT PLAN ---',
          plan ?? 'No architect plan artifact is available; follow the mission context alone.',
        ].join('\n\n'),
        workspacePath: input.workspacePath,
        apiKey: input.apiKey,
        requestedModel: input.requestedModel,
        now: nowIso,
      });
      if (outcome.kind !== 'completed') {
        if (outcome.kind === 'timed_out') throw new JuliusDispatchError('TIMEOUT', true, 'Hosted Coding Agent timed out.');
        if (outcome.kind === 'cancelled') throw new JuliusDispatchError('CANCELLED', false, 'Hosted Coding Agent run was cancelled.');
        if (outcome.kind === 'launch_failed') throw new JuliusDispatchError('AUTH_CONFIGURATION', false, `Hosted Coding Agent could not launch: ${safeClaim(outcome.safeMessage, 120)}.`);
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Hosted Coding Agent refused: ${safeClaim(outcome.safeMessage, 120)}.`);
      }

      const diff = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:diff`,
        command: 'git --no-pager diff && git --no-pager diff --stat',
        timeoutMs: 30_000,
      });
      if (diff.status === 'SUCCEEDED') input.artifacts.put(diffRef(snapshot.runId), diff.stdout);
      const test = await input.shell.run({
        ...shellScope,
        invocationKey: `${dispatch.taskId}:test`,
        command: input.testCommand,
        timeoutMs: 300_000,
      });
      input.artifacts.put(testOutputRef(snapshot.runId), `exit=${test.exitCode ?? 'unknown'}\n${test.stdout}\n${test.stderr}`);

      const observed = outcome.observation;
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Hosted Coding Agent session completed (observed model ${observed.actualModel ?? 'unknown'}, ${observed.numTurns ?? 'unknown'} turns); tests ${test.status === 'SUCCEEDED' ? 'passed' : 'failed'} under the independent executor.`,
        evidence: [
          {
            type: 'DIFF',
            status: diff.status === 'SUCCEEDED' ? 'PASSED' : 'INCONCLUSIVE',
            safeSummary: diff.status === 'SUCCEEDED'
              ? `Workspace diff captured by executor invocation ${diff.invocationId} (${diff.stdout.length} chars).`
              : 'Workspace diff could not be captured by the executor.',
            artifactRef: diff.status === 'SUCCEEDED' ? diffRef(snapshot.runId) : null,
            occurredAt: nowIso(),
          },
          {
            type: 'TEST',
            status: test.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED',
            safeSummary: `Deterministic test command exited ${test.exitCode ?? 'unknown'} under executor invocation ${test.invocationId}.`,
            artifactRef: null,
            occurredAt: nowIso(),
          },
        ],
        usage: {
          inputTokens: observed.usage.inputTokens ?? undefined,
          outputTokens: observed.usage.outputTokens ?? undefined,
          usdMicros: observed.usage.totalCostUsd === null ? undefined : Math.round(observed.usage.totalCostUsd * 1_000_000),
          toolCalls: observed.toolsUsed.length,
        },
      };
    },
  };
}

/* -------------------------------------------------- independent reviewer */

export function createLiveHermesReviewerAdapter(input: {
  readonly worker: JuliusWorker;
  readonly contexts: CompiledContextSource;
  readonly artifacts: LiveArtifactExchange;
  readonly config: HermesConfig;
  readonly testCommand: string;
  readonly run?: typeof runHermesReview;
}): JuliusProviderAdapter {
  if (!input.config.executable || !input.config.model || !input.config.provider) {
    throw new Error('hermes_reviewer_adapter_requires_live_config');
  }
  const run = input.run ?? runHermesReview;
  return {
    adapterId: input.worker.adapterId,
    async dispatch(dispatch): Promise<JuliusProviderResult> {
      const snapshot = requireSnapshot(input.contexts, dispatch.contextId);
      const unifiedDiff = input.artifacts.get(diffRef(snapshot.runId)) ?? '';
      const packet: ReviewPacket = {
        missionId: snapshot.packet.missionId,
        originalRequest: safeClaim(packetText(snapshot), 8_000),
        handoffJson: input.artifacts.get(planRef(snapshot.runId)) ?? '{}',
        acceptanceCriteria: [...snapshot.acceptanceCriterionIds],
        baseRevision: input.artifacts.get(baseRevisionRef(snapshot.runId)) ?? 'unknown',
        artifactDigest: sha256(unifiedDiff),
        changedFiles: [...new Set([...unifiedDiff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]))],
        unifiedDiff,
        changedFileContents: '',
        testCommand: input.testCommand,
        testOutput: input.artifacts.get(testOutputRef(snapshot.runId)) ?? '',
        relayEvidence: [...snapshot.evidenceIds],
      };
      const outcome: HermesOutcome = await run({ packet, config: input.config });
      if (outcome.kind === 'launch_failed') {
        throw new JuliusDispatchError('PROVIDER_UNAVAILABLE', false, `Hermes reviewer could not launch: ${safeClaim(outcome.safeMessage, 120)}.`);
      }
      if (outcome.kind === 'review_incomplete') {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Hermes review incomplete: ${safeClaim(outcome.safeMessage, 120)}.`);
      }
      const blocking = outcome.result.findings.filter((finding) => finding.severity === 'blocking' || finding.severity === 'major');
      const evidence = blocking.length === 0
        ? [{
          type: 'REVIEW_FINDING' as const,
          status: outcome.result.verdict === 'approved' ? 'PASSED' as const : 'INCONCLUSIVE' as const,
          safeSummary: `Independent review verdict ${outcome.result.verdict} with no blocking findings (served model ${outcome.servedModel ?? 'unknown'}).`,
          occurredAt: nowIso(),
        }]
        : blocking.map((finding) => ({
          type: 'REVIEW_FINDING' as const,
          status: 'FAILED' as const,
          safeSummary: safeClaim(`[${finding.severity}] ${finding.requirement}: ${finding.explanation}`),
          occurredAt: nowIso(),
        }));
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Independent Hermes review completed: verdict ${outcome.result.verdict}, ${outcome.result.findings.length} findings (${blocking.length} blocking), served model ${outcome.servedModel ?? 'unknown'}.`,
        evidence,
        usage: { toolCalls: 0 },
      };
    },
  };
}
