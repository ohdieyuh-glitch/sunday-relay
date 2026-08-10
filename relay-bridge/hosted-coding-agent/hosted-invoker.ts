import { fail, relayError } from '../../src/relay/protocol/errors';
import type { RelayResult } from '../../src/relay/protocol/errors';
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
 * THE TOOL POLICY IS NOT SHARED, AND THAT IS A REAL LIMIT. The seam carries the
 * compiled `toolPolicy` because the local surface needs it as argv. This
 * surface ignores it and compiles its own envelope from
 * `HOSTED_ALLOWED_TOOLS`/`HOSTED_DISALLOWED_TOOLS`, because the SDK takes
 * option arrays rather than flags. The two allow-lists coincide today and the
 * deny-lists already differ — the hosted one additionally denies `Write` and
 * `TodoWrite`, and denies `Write` unconditionally where the compiler grants it
 * for a fixture that needs file creation. So a task requiring file creation
 * would work locally and be blocked here. Written down rather than described as
 * one shared policy.
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
    /**
     * A MISSING SDK IS A LAUNCH FAILURE, NOT A MISSION FAULT.
     *
     * `loadHostedQuery` throws when the package is absent or exports no
     * `query`. Unguarded, that reached the pipeline's outer catch and became
     * "The mission stopped unexpectedly", `verification_failed`, RETRYABLE —
     * with the coding ledger left `in_flight`, so the retry answered "a
     * dispatch was started but its outcome is unknown". Nothing had started
     * and nothing had been spent. It is a launch failure, permanently, and it
     * says which.
     */
    let queryFn: HostedQueryFn;
    try {
      queryFn = input.queryFn ?? await loadHostedQuery();
    } catch {
      const at = request.now();
      return {
        outcome: {
          startedAt: at, completedAt: at,
          cancelled: false, timedOut: false, launchFailed: true,
          // Nothing was loaded, so nothing started.
          launchObserved: false,
        },
        events: [],
        sessionId: null,
        structurallyValid: false,
        structuralReason:
          'The hosted Coding Agent runtime could not be loaded in this deployment',
        report: fail<AgentExecutionReport>(relayError(
          'invalid-report',
          'The hosted Coding Agent runtime could not be loaded in this deployment.',
        )),
        actualActor: 'Claude Agent SDK',
        actualRuntimeId: HOSTED_ADAPTER_ID,
        actualModel: null,
      };
    }

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
      /**
       * A REFUSED RESULT IS NOT ALWAYS AN UNUSABLE STREAM.
       *
       * `runHostedCodingAgent` refuses for three different reasons — an
       * unusable stream, an envelope the runtime did not honour, and a spend
       * ceiling. Calling all three "structurally invalid" told an operator
       * their output was bad when what actually happened was that the run cost
       * more than its ceiling — money genuinely spent, described as a parse
       * problem. The runner's own safe message is carried through instead of
       * being replaced by a category.
       */
      const launchFailed = result.kind === 'launch_failed';
      return {
        outcome: {
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          cancelled: result.kind === 'cancelled',
          timedOut: result.kind === 'timed_out',
          launchFailed,
          // The runtime's own init message, whatever went wrong afterwards.
          launchObserved: 'observation' in result ? result.observation.initSeen : false,
        },
        events: [],
        sessionId: 'observation' in result ? result.observation.sessionId : null,
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
        actualModel: 'observation' in result ? result.observation.actualModel : null,
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
        launchObserved: result.observation.initSeen,
      },
      events: [],
      // The SDK's own session id, read off its init message. An earlier
      // version returned null under a comment claiming the SDK reports none —
      // its type declarations say otherwise, and not reading a field is a fact
      // about this code rather than about the runtime.
      sessionId: result.observation.sessionId,
      structurallyValid: true,
      report: finalText === null
        ? fail<AgentExecutionReport>(relayError(
          'invalid-report',
          `The hosted Coding Agent produced no final result to parse. ${runShape(result.observation)}`,
        ))
        : withRunShape(
          parseAgentExecutionReport(finalText, {
            taskId: request.association.taskId,
            runId: request.association.runId,
          }),
          result.observation,
        ),
      ...identity,
      actualModel: result.observation.actualModel,
    };
  };
}


/**
 * WHAT THE RUN LOOKED LIKE, in facts that cannot leak.
 *
 * A hosted run failed with "Required report marker is absent" and nothing
 * else. That sentence is true and useless: it cannot distinguish an agent that
 * worked and forgot the marker from one that hit its turn ceiling, from one
 * the provider errored on before it edited anything. The observation already
 * held all three answers and none of them reached the operator.
 *
 * Only the SHAPE is surfaced — the SDK's own result subtype, whether it
 * flagged an error, how many turns it took, how many tools it used. The final
 * TEXT is never included: it is model output, it can quote the workspace, and
 * the report parser is the only thing that should read it.
 */
export function runShape(o: {
  readonly resultSubtype: string | null;
  readonly isError: boolean | null;
  readonly numTurns: number | null;
  readonly toolsUsed: readonly string[];
  readonly finalText: string | null;
}): string {
  const parts: string[] = [];
  // An SDK enum: `success`, `error_max_turns`, `error_during_execution`.
  if (typeof o.resultSubtype === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(o.resultSubtype)) {
    parts.push(`result=${o.resultSubtype}`);
  }
  if (o.isError !== null) parts.push(`isError=${String(o.isError)}`);
  if (o.numTurns !== null && Number.isFinite(o.numTurns)) parts.push(`turns=${String(o.numTurns)}`);
  parts.push(`toolsUsed=${String(o.toolsUsed.length)}`);
  // LENGTH, never content. It separates "said nothing" from "said the wrong
  // thing", which is the distinction that matters here.
  parts.push(`finalTextChars=${String(o.finalText === null ? 0 : o.finalText.length)}`);
  return `Run shape: ${parts.join(' ')}.`;
}

/** Attach the run shape to a failed report, and leave a good one untouched. */
function withRunShape(
  parsed: RelayResult<AgentExecutionReport>,
  observation: Parameters<typeof runShape>[0],
): RelayResult<AgentExecutionReport> {
  if (parsed.ok) return parsed;
  return fail<AgentExecutionReport>(relayError(
    parsed.error.code,
    `${parsed.error.message} ${runShape(observation)}`,
  ));
}
