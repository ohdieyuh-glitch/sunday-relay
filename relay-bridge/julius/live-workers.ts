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
    throw new JuliusDispatchError('INVALID_REQUEST', false, 'Compiled context is not available to the adapter.', 'context_unavailable');
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
        /**
         * THE CLASS TRAVELS WITH THE CODE.
         *
         * Nine `JuliusErrorCode`s cannot separate a refusal from a malformed
         * response from a 500 — all three are WORKER_EXECUTION_FAILURE — and
         * the first paid mission failed on exactly that ambiguity: its durable
         * record held the code alone. The connector's own class is a fixed
         * machine token, so it is passed through and narrowed again by
         * `safeFailureClass` on the way into the error.
         */
        switch (outcome.failureClass) {
          case 'authentication_failed':
          case 'permission_denied':
            throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'Prompt Architect authentication or configuration failed.', outcome.failureClass);
          case 'rate_limited':
            throw new JuliusDispatchError('RATE_LIMIT', true, 'Prompt Architect provider rate limit reached.', outcome.failureClass);
          case 'timeout':
          case 'network_disconnected':
            throw new JuliusDispatchError('TIMEOUT', true, 'Prompt Architect provider timed out.', outcome.failureClass);
          case 'model_unavailable':
            throw new JuliusDispatchError('PROVIDER_UNAVAILABLE', false, 'Prompt Architect model is unavailable.', outcome.failureClass);
          default:
            throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Prompt Architect failed: ${outcome.failureClass}.`, outcome.failureClass);
        }
      }
      let parsed: unknown;
      try { parsed = JSON.parse(outcome.outputText); } catch {
        // Julius's own classes, not the provider's: the call succeeded and what
        // came back was unusable, which is a different repair from a 500.
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Prompt Architect output was not parseable JSON.', 'unparseable_plan_json');
      }
      const validation = validateArchitectPlan(parsed);
      if (!validation.ok) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Prompt Architect plan failed validation: ${safeClaim(validation.reason, 120)}.`, 'plan_validation_failed');
      }
      input.artifacts.put(planRef(snapshot.runId), outcome.outputText);
      return {
        workerId: input.worker.workerId,
        providerId: input.worker.providerId,
        status: 'SUCCEEDED',
        safeSummary: `Prompt Architect plan produced by observed model ${safeClaim(outcome.actualModel ?? 'unknown', 80)} (response ${safeClaim(outcome.responseId ?? 'unknown', 80)}).`,
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
      if (plan === null) {
        // The artifact exchange is same-process: after a restart or in a
        // second process the plan is gone even though the plan TASK succeeded
        // durably. Implementing without the plan on a resumed run would be a
        // silent downgrade of what the mission paid the architect for —
        // refuse, so the resume fails visibly instead. (Independent review
        // finding F1; the durable artifact store is the recorded fix.)
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The architect plan artifact is not available to this process; a resumed run cannot implement without it.');
      }

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
          plan,
        ].join('\n\n'),
        workspacePath: input.workspacePath,
        apiKey: input.apiKey,
        requestedModel: input.requestedModel,
        now: nowIso,
      });
      if (outcome.kind !== 'completed') {
        if (outcome.kind === 'timed_out') throw new JuliusDispatchError('TIMEOUT', true, 'Hosted Coding Agent timed out.', 'coder_timed_out');
        if (outcome.kind === 'cancelled') throw new JuliusDispatchError('CANCELLED', false, 'Hosted Coding Agent run was cancelled.', 'coder_cancelled');
        if (outcome.kind === 'launch_failed') throw new JuliusDispatchError('AUTH_CONFIGURATION', false, `Hosted Coding Agent could not launch: ${safeClaim(outcome.safeMessage, 120)}.`, 'coder_launch_failed');
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Hosted Coding Agent refused: ${safeClaim(outcome.safeMessage, 120)}.`, 'coder_refused');
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
        safeSummary: `Hosted Coding Agent session completed (observed model ${safeClaim(observed.actualModel ?? 'unknown', 80)}, ${observed.numTurns ?? 'unknown'} turns); tests ${test.status === 'SUCCEEDED' ? 'passed' : 'failed'} under the independent executor.`,
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
      const planArtifact = input.artifacts.get(planRef(snapshot.runId));
      const diffArtifact = input.artifacts.get(diffRef(snapshot.runId));
      if (planArtifact === null && diffArtifact === null) {
        // The artifact exchange is same-process. After a restart both the plan
        // and the diff are gone even though their tasks succeeded durably, and
        // a review dispatched with neither would be a review of NOTHING whose
        // approval could complete the mission. Refuse instead: a resumed run
        // fails visibly rather than completing falsely. (Independent review
        // finding F1, proven by probe; the durable artifact store is the
        // recorded fix.) A legitimate first plan-review always has the plan.
        throw new JuliusDispatchError('INVALID_REQUEST', false, 'Neither the architect plan nor the workspace diff artifact is available to this process; an independent review of nothing is refused.');
      }
      const unifiedDiff = diffArtifact ?? '';
      const packet: ReviewPacket = {
        missionId: snapshot.packet.missionId,
        originalRequest: safeClaim(packetText(snapshot), 8_000),
        handoffJson: planArtifact ?? '{}',
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
        throw new JuliusDispatchError('PROVIDER_UNAVAILABLE', false, `Hermes reviewer could not launch: ${safeClaim(outcome.safeMessage, 120)}.`, 'reviewer_launch_failed');
      }
      if (outcome.kind === 'review_incomplete') {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, `Hermes review incomplete: ${safeClaim(outcome.safeMessage, 120)}.`, 'reviewer_review_incomplete');
      }
      if (outcome.result.verdict === 'unable_to_review') {
        // A reviewer that could not review has not reviewed. Recording that as
        // evidence would park the run; failing the dispatch keeps the outcome
        // visible and retryable by policy. (Independent review finding F8.)
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Hermes was unable to review the change.', 'reviewer_unable_to_review');
      }
      const blocking = outcome.result.findings.filter((finding) => finding.severity === 'blocking' || finding.severity === 'major');
      // The engine's own rule (`hasBlockingFinding`) treats ANY changes_required
      // verdict as blocking; a non-approved verdict with only minor findings
      // must therefore drive the repair path too, not park the run on
      // inconclusive evidence. (Independent review finding F8.)
      const evidence = blocking.length === 0 && outcome.result.verdict === 'approved'
        ? [{
          type: 'REVIEW_FINDING' as const,
          status: 'PASSED' as const,
          safeSummary: `Independent review verdict approved with no blocking findings (served model ${safeClaim(outcome.servedModel ?? 'unknown', 80)}).`,
          occurredAt: nowIso(),
        }]
        : blocking.length === 0
          ? [{
            type: 'REVIEW_FINDING' as const,
            status: 'FAILED' as const,
            safeSummary: safeClaim(`Independent review verdict ${outcome.result.verdict} without blocking-severity findings: ${outcome.result.summary}`),
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
        safeSummary: `Independent Hermes review completed: verdict ${outcome.result.verdict}, ${outcome.result.findings.length} findings (${blocking.length} blocking), served model ${safeClaim(outcome.servedModel ?? 'unknown', 80)}.`,
        evidence,
        usage: { toolCalls: 0 },
      };
    },
  };
}
