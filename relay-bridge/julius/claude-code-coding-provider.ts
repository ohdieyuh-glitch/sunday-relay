/**
 * CLAUDE CODE, AS ONE IMPLEMENTATION OF THE JULIUS CODING AGENT PORT.
 *
 * Everything here is specific to the hosted Claude Agent SDK session: how it is
 * launched, what its envelope is, how its outcomes and its runtime's failures
 * read, and which structural facts its observation carries. Nothing here
 * decides anything for Julius. It turns one governed request into one closed
 * outcome, and the Julius side of the adapter does the rest — the executor
 * evidence, the participation block, the failure disposition, the money.
 *
 * A Codex-shaped or Devin-shaped provider replaces THIS FILE and nothing else.
 */

import { classifyClaudeCodeResult } from '../../src/relay/connectors/claude-code/result-classification';
import { classifyHostedFailure } from '../hosted-coding-agent/hosted-failure-reason';
import { DEFAULT_HOSTED_LIMITS, hostedLimitsForAllocation, type HostedLimits } from '../hosted-coding-agent/hosted-envelope';
import type { HostedObservation } from '../hosted-coding-agent/hosted-observation';
import {
  loadHostedQuery,
  runHostedCodingAgent,
  type HostedQueryFn,
  type HostedRunOutcome,
} from '../hosted-coding-agent/hosted-runner';
import {
  JULIUS_CODING_AGENT_CHARTER,
  renderJuliusCodingAgentPrompt,
  type JuliusCodingAgentFailure,
  type JuliusCodingAgentProvider,
  type JuliusCodingAgentProviderOutcome,
  type JuliusCodingAgentRequest,
} from '../../src/relay/mission/julius/julius-coding-agent';
import {
  JULIUS_PARTICIPATION_CHANNELS,
  readJuliusParticipationBlock,
  type JuliusParticipationReading,
} from '../../src/relay/mission/julius/julius-worker-participation';

export const CLAUDE_CODE_PROVIDER_KIND = 'claude-code-hosted' as const;

/**
 * THE CODER'S STRUCTURAL FACTS, ON BOTH ENDINGS, FROM ONE BUILDER.
 *
 * A success and a failure used to be described by two hand-built objects, and
 * findings C and E were both a column present on one and absent on the other.
 */
export const hostedCoderDiagnostics = (input: {
  readonly taskType: string | undefined;
  readonly requestedModel: string | null;
  readonly observed: HostedObservation | null;
  readonly limits: HostedLimits;
  readonly outcome: 'succeeded' | 'failed';
  /**
   * The runner's own classification of the error it caught, when it caught one.
   * It is strictly better evidence than the final text: on
   * `coder_provider_error_after_init` the runtime threw INSTEAD of finishing,
   * so the cause is in the thrown error and the final text is whatever the
   * stream had managed to emit before it.
   */
  readonly failureReason?: string | null;
}): Record<string, unknown> => {
  const observed = input.observed;
  /**
   * WHETHER THE WORKER ASKED, ON BOTH ENDINGS. A dispatch with no observed final
   * message never gave the worker a place to ask, so every field below is
   * UNKNOWN rather than false: "did not ask" and "had no way to" are different
   * facts and one column for both would erase the second.
   */
  const participation: JuliusParticipationReading | null =
    observed === null || observed.finalText === null ? null : readJuliusParticipationBlock(observed.finalText);
  const asked = (channel: (typeof JULIUS_PARTICIPATION_CHANNELS)[number]): boolean | null =>
    participation === null ? null
      : participation.present && participation.readable ? participation.channels.includes(channel)
        : false;
  return {
    /** Stated, so a successful row is never read as a failure nobody classified. */
    outcome: input.outcome,
    /**
     * WHY IT FAILED, in a closed vocabulary — never the runtime's own words.
     * `classifyHostedFailure` MATCHES the runtime's final text and returns a
     * constant; no substring of that text can reach this row. NULL ON SUCCESS:
     * classifying a successful summary would read the word "error" in it as one.
     */
    failureReason: input.outcome === 'failed'
      ? input.failureReason ?? classifyHostedFailure(observed?.finalText ?? null)
      : null,
    // THE ROUND THAT SPENT THE MONEY.
    stage: input.taskType === 'repair:build' ? 'repair:build' : 'build',
    transport: 'hosted',
    provider: 'anthropic',
    requestedModel: input.requestedModel,
    servedModel: observed?.actualModel ?? null,
    responseId: observed?.sessionId ?? null,
    numTurns: observed?.numTurns ?? null,
    // INVOCATIONS, not distinct names: `toolsUsed` deduplicates.
    toolUseCount: observed?.toolInvocations ?? null,
    /**
     * ONLY WHEN A RESULT ARRIVED. `permissionDenials` is populated by the result
     * message alone, so reporting it after a timeout would assert that no denial
     * occurred on precisely the runs where the terminal data never came.
     */
    permissionDenials: observed?.resultSubtype === null || observed === null
      ? null : observed.permissionDenials,
    resultSubtype: observed?.resultSubtype ?? null,
    isError: observed?.isError ?? null,
    /** A member of the SDK's vocabulary, `unrecognised`, or null when none was sent. */
    terminalReason: observed?.terminalReason ?? null,
    /**
     * WHAT THE RESULT MESSAGE AMOUNTED TO, read from every field of it. Null
     * when nothing was observed; `NO_RESULT` when the stream ended without one.
     */
    resultClass: observed === null ? null : classifyClaudeCodeResult(observed),
    // A COUNT of the runtime's final text, never the text.
    outputBytesObserved: observed?.finalText === null || observed?.finalText === undefined
      ? null : Buffer.byteLength(observed.finalText, 'utf8'),
    /**
     * AN OBSERVED SUCCESSFUL RESULT, not merely a runtime that started — and
     * not merely `is_error: false` beside an error subtype. Unknown while no
     * result arrived.
     */
    implementationPresent: observed === null || observed.resultSubtype === null
      ? null : classifyClaudeCodeResult(observed) === 'SUCCESS',
    /** THE MONEY, BESIDE THE REFUSAL. Unknown stays Unknown, never zero. */
    costUsdMicros: observed?.usage.totalCostUsd === null || observed?.usage.totalCostUsd === undefined
      ? null : Math.round(observed.usage.totalCostUsd * 1_000_000),
    costCeilingUsdMicros: input.limits.maxCostCents * 10_000,
    costSource: observed?.usage.source ?? null,
    /** DID THE RUNTIME EVER START? A run that never launched billed nothing. */
    runtimeStarted: observed?.initSeen ?? false,
    /* ------------------------------- what the worker asked Julius for ---- */
    participationPresent: participation === null ? null : participation.present,
    participationReadable: participation === null || !participation.present ? null : participation.readable,
    participationRefusal: participation !== null && participation.present && !participation.readable
      ? participation.reasonCode : null,
    participationAskedGuidance: asked('guidanceRequest'),
    participationAskedResearch: asked('researchAsks'),
    participationAskedResume: asked('segmentResume'),
    participationAskedReport: asked('report'),
    participationAskedObservations: asked('architectureObservations'),
    /** `PROVIDER_REPORTED` requires BOTH the runtime's own attestation and an actual figure. */
    costBasis: observed?.usage.source === 'runtime_reported'
      && observed.usage.totalCostUsd !== null && observed.usage.totalCostUsd !== undefined
      ? 'PROVIDER_REPORTED' : 'UNKNOWN',
    inputTokens: observed?.usage.inputTokens ?? null,
    outputTokens: observed?.usage.outputTokens ?? null,
    /**
     * AND WHAT THE STREAM SAID BEFORE IT WAS CUT OFF. A FLOOR, never the total,
     * never a cost, and named apart so no reader can mistake one for the other.
     */
    streamUsageMessages: observed?.streamUsage.messages ?? null,
    streamAbortedMessages: observed?.streamUsage.abortedMessages ?? null,
    streamInputTokens: observed?.streamUsage.inputTokens ?? null,
    streamOutputTokens: observed?.streamUsage.outputTokens ?? null,
    streamCacheReadInputTokens: observed?.streamUsage.cacheReadInputTokens ?? null,
    streamCacheCreationInputTokens: observed?.streamUsage.cacheCreationInputTokens ?? null,
  };
};

/**
 * THE RUNTIME'S CLASSIFIED REASON, AS A JULIUS FAILURE.
 *
 * Transient reasons become transient failures, so a 429, an overload, a 5xx or
 * a dropped stream after launch is retried under the run's own retry policy
 * instead of ending a paid mission. Exhausted credit and a rejected key become
 * operator failures. Anything the classifier could not name stays UNCLASSIFIED,
 * which is NOT transient: an unknown is not a reason to spend again.
 */
export function codingAgentFailureFromHostedReason(reason: string | null | undefined): JuliusCodingAgentFailure {
  switch (reason) {
    case 'rate_limited': return 'RATE_LIMITED';
    case 'provider_overloaded':
    case 'provider_server_error': return 'PROVIDER_UNAVAILABLE';
    case 'stream_interrupted': return 'INTERRUPTED';
    case 'context_length_exceeded': return 'CONTEXT_OVERFLOW';
    case 'provider_auth_rejected': return 'AUTHENTICATION';
    case 'credit_unavailable': return 'CREDIT_UNAVAILABLE';
    // The classifier already recognised a content filter or a safety refusal;
    // mapping it to UNCLASSIFIED threw that recognition away.
    case 'content_filtered': return 'CONTENT_REFUSED';
    default: return 'UNCLASSIFIED';
  }
}

/** One hosted outcome that did not complete, as the failure Julius reasons about. */
export function codingAgentFailureFromHostedOutcome(
  outcome: Exclude<HostedRunOutcome, { kind: 'completed' }>,
  reason: string | null,
): JuliusCodingAgentFailure {
  switch (outcome.kind) {
    case 'timed_out': return 'TIMEOUT';
    case 'cancelled': return 'CANCELLED';
    case 'launch_failed': {
      const refined = codingAgentFailureFromHostedReason(reason);
      return refined === 'AUTHENTICATION' || refined === 'CREDIT_UNAVAILABLE' ? refined : 'LAUNCH_FAILED';
    }
    case 'refused':
      switch (outcome.refusalCode) {
        case 'coder_cost_exceeded': return 'COST_CEILING_REACHED';
        case 'coder_envelope_not_honoured': return 'ENVELOPE_NOT_HONOURED';
        case 'coder_provider_error_after_init': return codingAgentFailureFromHostedReason(reason);
        case 'coder_result_untrusted': {
          // An untrusted result whose runtime said WHY — a rate limit, exhausted
          // credit — is that failure. One that said nothing recognisable is a
          // partial response: it ended without a result anyone can trust.
          const refined = codingAgentFailureFromHostedReason(reason);
          return refined === 'UNCLASSIFIED' ? 'PARTIAL_RESPONSE' : refined;
        }
        default: return 'UNCLASSIFIED';
      }
    default: return 'UNCLASSIFIED';
  }
}

export function createClaudeCodeCodingAgentProvider(input: {
  readonly apiKey: string;
  readonly requestedModel: string;
  readonly run?: typeof runHostedCodingAgent;
  readonly queryLoader?: () => Promise<HostedQueryFn>;
}): JuliusCodingAgentProvider {
  const run = input.run ?? runHostedCodingAgent;
  const loadQuery = input.queryLoader ?? loadHostedQuery;
  const nowIso = (): string => new Date().toISOString();
  return {
    providerKind: CLAUDE_CODE_PROVIDER_KIND,
    async execute(request: JuliusCodingAgentRequest, signal?: AbortSignal): Promise<JuliusCodingAgentProviderOutcome> {
      /**
       * A DISPATCH CANCELLED BEFORE LAUNCH LAUNCHES NOTHING. The signal was
       * dropped at this method's signature, so a deadline cut or a lost lease
       * aborted Julius's side of the race while the paid session kept editing
       * the workspace until its own timer fired — and a retry could start a
       * second session on the same directory beside it.
       */
      const cancelledBeforeLaunch = (): JuliusCodingAgentProviderOutcome => ({
        kind: 'failed', failure: 'CANCELLED', runtimeStarted: false, costUsdMicros: null,
        safeMessage: 'The dispatch was cancelled before the hosted Coding Agent launched.',
        providerFailureClass: 'coder_cancelled_before_launch', diagnostics: {},
      });
      // Read through a function: the signal changes under an await, and a narrowed property would not.
      const aborted = (): boolean => signal?.aborted === true;
      if (aborted()) return cancelledBeforeLaunch();
      let queryFn: HostedQueryFn;
      try { queryFn = await loadQuery(); } catch {
        return {
          kind: 'failed', failure: 'LAUNCH_FAILED', runtimeStarted: false, costUsdMicros: null,
          safeMessage: 'The hosted Claude Agent SDK runtime is not installed.',
          providerFailureClass: 'coder_runtime_not_installed', diagnostics: {},
        };
      }
      /**
       * THE MISSION'S ALLOCATION IS THE EXECUTION LIMIT. With no allocation — a
       * composition without a policy — the envelope keeps its own conservative
       * default; with one, the runtime is told to stop exactly there.
       */
      const limits: HostedLimits = request.budget.usdMicros === null
        ? DEFAULT_HOSTED_LIMITS
        : hostedLimitsForAllocation(request.budget.usdMicros);
      /** AN ALLOCATION BELOW ONE CENT BUYS NOTHING AND STILL BILLS a turn. Refused before launch. */
      if (request.budget.usdMicros !== null && limits.maxCostCents < 1) {
        return {
          kind: 'failed', failure: 'COST_CEILING_REACHED', runtimeStarted: false, costUsdMicros: null,
          safeMessage: 'The remaining mission budget is below one cent; the hosted Coding Agent was not dispatched.',
          providerFailureClass: 'coder_allocation_below_one_cent', diagnostics: {},
        };
      }
      if (aborted()) return cancelledBeforeLaunch();
      /**
       * THE ABORT REACHES THE SESSION. The runner already hands its own
       * controller to the SDK; this connects Julius's signal to it, once, and
       * detaches when the run is over. A second abort is a no-op on both sides.
       */
      let detach = (): void => undefined;
      const outcome: HostedRunOutcome = await run({
        queryFn,
        prompt: renderJuliusCodingAgentPrompt(request, JULIUS_CODING_AGENT_CHARTER),
        workspacePath: request.workspacePath,
        apiKey: input.apiKey,
        requestedModel: input.requestedModel,
        limits,
        now: nowIso,
        ...(signal === undefined ? {} : {
          onCancel: (cancel: () => void): void => {
            if (signal.aborted) { cancel(); return; }
            signal.addEventListener('abort', cancel, { once: true });
            detach = () => signal.removeEventListener('abort', cancel);
          },
        }),
      }).finally(() => detach());
      /**
       * AN ABORT THAT ARRIVED AS THE STREAM ENDED STILL ENDS THE DISPATCH.
       * Whatever the session finished with, the dispatch it belonged to is over,
       * so it is a cancellation — charged, because the session ran — and never
       * a completed outcome anything could be minted from.
       */
      if (aborted() && outcome.kind === 'completed') {
        const diagnostics = hostedCoderDiagnostics({
          taskType: request.identity.taskType, requestedModel: input.requestedModel,
          observed: outcome.observation, limits, outcome: 'failed', failureReason: null,
        });
        return {
          kind: 'failed', failure: 'CANCELLED', runtimeStarted: true,
          costUsdMicros: typeof diagnostics.costUsdMicros === 'number' ? diagnostics.costUsdMicros : null,
          safeMessage: 'Hosted Coding Agent run was cancelled.',
          providerFailureClass: 'coder_cancelled', diagnostics,
        };
      }

      const observed = 'observation' in outcome ? outcome.observation : null;
      if (outcome.kind !== 'completed') {
        const runnerReason = 'failureReason' in outcome ? outcome.failureReason ?? null : null;
        const diagnostics = hostedCoderDiagnostics({
          taskType: request.identity.taskType, requestedModel: input.requestedModel,
          observed, limits, outcome: 'failed', failureReason: runnerReason,
        });
        const reason = typeof diagnostics.failureReason === 'string' ? diagnostics.failureReason : null;
        const failure = codingAgentFailureFromHostedOutcome(outcome, reason);
        const providerFailureClass = outcome.kind === 'timed_out' ? 'coder_timed_out'
          : outcome.kind === 'cancelled' ? 'coder_cancelled'
            : outcome.kind === 'launch_failed' ? 'coder_launch_failed'
              : outcome.kind === 'refused' ? outcome.refusalCode : 'coder_outcome_unrecognised';
        const safeMessage = outcome.kind === 'timed_out' ? 'Hosted Coding Agent timed out.'
          : outcome.kind === 'cancelled' ? 'Hosted Coding Agent run was cancelled.'
            : outcome.kind === 'launch_failed' ? 'Hosted Coding Agent could not launch.'
              : outcome.kind === 'refused' ? 'Hosted Coding Agent refused or failed after launch.'
                : 'The hosted Coding Agent returned an unrecognised outcome.';
        return {
          kind: 'failed', failure, safeMessage, providerFailureClass,
          runtimeStarted: observed?.initSeen ?? false,
          costUsdMicros: typeof diagnostics.costUsdMicros === 'number' ? diagnostics.costUsdMicros : null,
          diagnostics: outcome.kind === 'timed_out' ? { ...diagnostics, timedOut: true } : diagnostics,
        };
      }

      const diagnostics = hostedCoderDiagnostics({
        taskType: request.identity.taskType, requestedModel: input.requestedModel,
        observed: outcome.observation, limits, outcome: 'succeeded',
      });
      const usage = outcome.observation.usage;
      return {
        kind: 'completed',
        finalText: outcome.observation.finalText,
        observation: {
          providerModel: outcome.observation.actualModel ?? null,
          turns: outcome.observation.numTurns ?? null,
          toolInvocations: outcome.observation.toolInvocations ?? null,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          costUsdMicros: usage.totalCostUsd === null || usage.totalCostUsd === undefined ? null : Math.round(usage.totalCostUsd * 1_000_000),
          costBasis: usage.source === 'runtime_reported' && usage.totalCostUsd !== null && usage.totalCostUsd !== undefined
            ? 'PROVIDER_REPORTED' : 'UNKNOWN',
          diagnostics,
        },
      };
    },
  };
}
