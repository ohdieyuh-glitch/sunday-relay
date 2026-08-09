import { fail, relayError } from '../../src/relay/protocol/errors';
import { parseAgentExecutionReport } from '../../src/relay/connectors/claude-code/report-parser';
import type { AgentExecutionReport } from '../../src/relay/connectors/claude-code/report-parser';
import type { AgentInvoker } from '../agent-invoker';
import { HOSTED_ADAPTER_ID } from './hosted-readiness';
import { loadHostedQuery, runHostedCodingAgent, type HostedQueryFn } from './hosted-runner';

/**
 * THE HOSTED CODING SURFACE, BEHIND THE ONE SEAM THAT VARIES.
 *
 * Everything else in the coding leg is unchanged and unduplicated: the same
 * throwaway fixture, the same isolated worktree, the same compiled handoff and
 * prompt, the same git inspection, the same `node --test`, the same completion
 * policy. Only the agent call differs, which is the whole reason
 * `agent-invoker.ts` exists.
 *
 * THE PROMPT IS THE SAME PROMPT. It already asks for Relay's structured report,
 * so the hosted run's final text is parsed by the SAME strict parser the local
 * path uses — one report contract, not a second one specified alongside it.
 *
 * WHAT IS OBSERVED, AND WHAT IS NOT. `actualActor` and `actualRuntimeId` come
 * from this surface because this surface ran; the MODEL that answered is read
 * off the runtime's own init message by `foldHostedMessage` and never inferred
 * from what was requested. What this invoker does NOT do is decide whether the
 * work is correct — the envelope check inside `runHostedCodingAgent` decides
 * whether the run stayed in bounds, and Relay's inspection afterwards decides
 * everything else.
 *
 * NO EVENTS YET, AND THAT IS SAID RATHER THAN FAKED. The local path emits
 * normalized connector events that become the Live Terminal's body. The SDK
 * message stream is a different shape and Relay has no normalizer for it, so
 * this surface returns none. A terminal with no body is honest; one filled with
 * invented lifecycle lines would not be.
 */

export function createHostedClaudeInvoker(input: {
  readonly apiKey: string;
  readonly requestedModel: string | null;
  /** Injected in tests so the whole pipeline is provable with no paid call. */
  readonly queryFn?: HostedQueryFn;
}): AgentInvoker {
  return async (request) => {
    const queryFn = input.queryFn ?? await loadHostedQuery();

    const result = await runHostedCodingAgent({
      queryFn,
      prompt: request.prompt,
      workspacePath: request.workspacePath,
      apiKey: input.apiKey,
      requestedModel: input.requestedModel ?? request.requestedModel,
      now: request.now,
      onCancel: (cancel) => request.registerHandle?.({
        cancel: () => { cancel(); return true; },
      }),
    });

    const identity = {
      actualActor: 'Claude Agent SDK',
      actualRuntimeId: HOSTED_ADAPTER_ID,
    } as const;

    if (result.kind !== 'completed') {
      return {
        outcome: {
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          cancelled: result.kind === 'cancelled',
          timedOut: result.kind === 'timed_out',
          launchFailed: result.kind === 'launch_failed',
        },
        events: [],
        sessionId: null,
        /**
         * A REFUSED result is a stream Relay declined to trust — a broken
         * envelope, an unusable stream, a cost ceiling. That is precisely
         * `structurallyValid: false`, and the reason travels with it rather
         * than being reduced to a boolean.
         */
        structurallyValid: false,
        structuralReason: result.safeMessage,
        report: fail<AgentExecutionReport>(relayError('invalid-report', result.safeMessage)),
        ...identity,
      };
    }

    const finalText = result.observation.finalText;
    return {
      outcome: {
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        cancelled: false,
        timedOut: false,
        launchFailed: false,
      },
      events: [],
      // The SDK reports no resumable session id through this surface, and an
      // invented one would be a resume reference that resolves to nothing.
      sessionId: null,
      structurallyValid: true,
      report: finalText === null
        ? fail<AgentExecutionReport>(relayError(
          'invalid-report',
          'The hosted Coding Agent produced no final result to parse.',
        ))
        : parseAgentExecutionReport(finalText, {
          taskId: request.association.taskId,
          runId: request.association.runId,
        }),
      ...identity,
    };
  };
}
