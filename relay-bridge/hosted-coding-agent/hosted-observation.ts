/**
 * READING A HOSTED RUN — PURE.
 *
 * The Claude Agent SDK streams typed messages. This module turns that stream
 * into the facts Relay is willing to state, and refuses to turn it into
 * anything else.
 *
 * Two properties matter more than the parsing:
 *
 *   THE RUNTIME IS THE ONLY AUTHORITY ON WHAT RAN. `actualModel` comes from
 *   the `init` message's own `model` field, never from the model Relay
 *   requested. A request for `claude-sonnet-5` may be answered by a dated
 *   build, and a receipt that echoed the request would be asserting an
 *   identity nothing checked — the exact defect already fixed once for the
 *   Prompt Architect and once for the local Coding Agent.
 *
 *   AND `init` IS AN ANNOUNCEMENT, NOT A SERVING. It arrives before any turn
 *   exists. Paid attempt 1's init named `claude-fable-5`, and its only turn then
 *   produced zero tokens: the record said a model served when none had. What
 *   served is attested separately, by {@link hostedServedModel}, from the
 *   turns that produced output and the result's own `modelUsage`.
 *
 *   A SUCCESSFUL RESULT MESSAGE IS NOT A VERDICT. `result.subtype === 'success'`
 *   means the agent finished its turn, not that the work is correct or that it
 *   stayed inside its envelope. Relay's own inspection and tests decide that,
 *   afterwards, and this module only reports what it saw.
 */


import {
  claudeCodeResultRefusalReason,
  readClaudeCodeErrorFlag,
  readClaudeCodeTerminalReason,
} from '../../src/relay/connectors/claude-code/result-classification';

export interface HostedUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalCostUsd: number | null;
  readonly source: 'runtime_reported' | 'unavailable';
}

export const UNKNOWN_HOSTED_USAGE: HostedUsage = Object.freeze({
  inputTokens: null, outputTokens: null, totalCostUsd: null, source: 'unavailable',
});

/**
 * WHAT THE STREAM ITSELF REPORTED, TURN BY TURN — a FLOOR, never a total.
 *
 * The runtime reports its usage in the terminal `result` message, and a run
 * Relay aborts at its own runtime ceiling never gets one. Paid run
 * `34485676189` attempt 1 is exactly that: cut off at 360 000 ms, twelve tool
 * calls done, and the record says the cost is UNKNOWN. We paid and could not
 * say how much.
 *
 * But every assistant turn already carried its own usage block, and all of them
 * were discarded. "The run reported nothing" was a fact about this parser, not
 * about the runtime.
 *
 * IT IS NOT THE SAME NUMBER AS {@link HostedUsage} AND MUST NEVER REPLACE IT.
 * This is a sum over the assistant turns whose usage was actually seen: a
 * LOWER BOUND on what the run consumed, with no claim to be complete, and no
 * cost at all — an assistant message reports tokens and never dollars. The
 * runtime's own total stays the only thing allowed to be called
 * `runtime_reported`, and a floor may never settle a budget as if it were one.
 */
export interface HostedStreamUsage {
  /** Assistant turns whose usage block was readable. Zero means none was. */
  readonly messages: number;
  /**
   * Turns the runtime itself marked `aborted` — truncated by an interrupt
   * before `stop_reason` arrived. Its own word for what Relay's timer did.
   */
  readonly abortedMessages: number;
  /** Summed over `messages`; null while no turn has reported this field. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
}

/** Nothing observed. Every total null, because zero turns is not zero tokens. */
export const NO_HOSTED_STREAM_USAGE: HostedStreamUsage = Object.freeze({
  messages: 0, abortedMessages: 0,
  inputTokens: null, outputTokens: null,
  cacheReadInputTokens: null, cacheCreationInputTokens: null,
});

/**
 * ONE MODEL'S SHARE OF THE SESSION'S TURNS THAT PRODUCED SOMETHING.
 *
 * Every assistant message carries the API's own `model` field: the model that
 * generated THAT turn, which is not necessarily the model `init` announced
 * before any turn existed. Counted only for the session's own turns
 * (`parent_tool_use_id` null), only when the turn reported output tokens, and
 * never for a message carrying the runtime's `error`. An API failure surfaces
 * as an assistant message with zero usage and a placeholder model, and a turn
 * that produced nothing served nothing.
 */
export interface HostedTurnModel {
  readonly model: string;
  readonly turns: number;
  readonly outputTokens: number;
}

/**
 * ONE ENTRY OF THE RESULT'S `modelUsage`, keyed as the runtime keyed it.
 *
 * This is the runtime's own account of which models it called and what each
 * produced. `canonicalModel` is the SDK's resolution of an alias or a
 * provider-specific key ("may differ from the raw model string this entry is
 * keyed by", sdk.d.ts 0.3.220), so a key the runtime wrote as an alias can
 * still be matched to the turn that named the model in full.
 */
export interface HostedResultModelUsage {
  readonly model: string;
  readonly canonicalModel: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface HostedObservation {
  /** True once the runtime's own init message was seen. */
  readonly initSeen: boolean;
  /**
   * The SDK's own session id, from its init message.
   *
   * It was not read, and a comment on the invoker asserted the SDK "reports no
   * resumable session id through this surface" — which the SDK's own type
   * declarations disprove: every message carries `session_id`, and `Options`
   * declares `resume`. Not reading a field is a fact about this code; it is
   * not a fact about the runtime, and stating the second was the defect.
   */
  readonly sessionId: string | null;
  /**
   * The model the RUNTIME named in `init`. Never the requested one, and never
   * proof of serving: it was announced before any turn existed. What served is
   * {@link hostedServedModel}'s answer.
   */
  readonly actualModel: string | null;
  /** The Claude Code version the hosted runtime reported. */
  readonly runtimeVersion: string | null;
  /** Where the runtime says its credential came from — a class, never a value. */
  readonly apiKeySource: string | null;
  readonly reportedCwd: string | null;
  readonly reportedTools: readonly string[];
  /** Tool targets the run reported touching, for the scope audit. */
  readonly toolTargets: readonly string[];
  /** DISTINCT tool NAMES, deduplicated. Not how often they were called. */
  readonly toolsUsed: readonly string[];
  /**
   * HOW MANY TIMES A TOOL WAS ACTUALLY INVOKED.
   *
   * `toolsUsed` deduplicates by name, so ten `Edit` calls and one `Read` are
   * two entries. A refusal record that reported that as the tool-use count
   * materially understated how much the run did — ten edits and one read is
   * not "2 tool uses". This counts invocations as they are observed, so a
   * partial run reports what it genuinely saw before the stream ended.
   */
  readonly toolInvocations: number;
  /** Permission denials the runtime itself recorded — evidence of the envelope working. */
  readonly permissionDenials: number;
  readonly numTurns: number | null;
  readonly durationMs: number | null;
  readonly usage: HostedUsage;
  /**
   * THE FLOOR THE STREAM ITSELF ESTABLISHED, always available — including on
   * the runs that end with no result at all, which are the only runs that
   * needed it.
   */
  readonly streamUsage: HostedStreamUsage;
  /** The session's output-bearing turns, per model, in the order each model was first seen. */
  readonly turnModels: readonly HostedTurnModel[];
  /**
   * The result's `modelUsage`, ordered by output tokens and then by key. Null
   * when no result reported one. An empty list is a result that reported no
   * model at all, which is a different claim.
   */
  readonly resultModelUsage: readonly HostedResultModelUsage[] | null;
  readonly resultSubtype: string | null;
  /** `is_error` as the runtime sent it. Absent is null, never false. */
  readonly isError: boolean | null;
  /**
   * `terminal_reason`, as a member of the SDK's vocabulary, `unrecognised`, or
   * null when the runtime sent none. It was never read, so a session that ended
   * `tool_deferred` or `hook_stopped` under a `success` subtype was trusted.
   */
  readonly terminalReason: string | null;
  readonly finalText: string | null;
  /** Hidden reasoning is counted and dropped — never stored, never surfaced. */
  readonly thinkingBlocksOmitted: number;
  readonly unknownMessageCount: number;
}

const EMPTY: HostedObservation = {
  initSeen: false, sessionId: null, actualModel: null, runtimeVersion: null, apiKeySource: null,
  reportedCwd: null, reportedTools: [], toolTargets: [], toolsUsed: [], toolInvocations: 0,
  permissionDenials: 0, numTurns: null, durationMs: null, usage: UNKNOWN_HOSTED_USAGE,
  streamUsage: NO_HOSTED_STREAM_USAGE,
  turnModels: [], resultModelUsage: null,
  resultSubtype: null, isError: null, terminalReason: null, finalText: null,
  thinkingBlocksOmitted: 0, unknownMessageCount: 0,
};

const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'glob'];
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Add an observed component to a running floor. Null + null stays null. */
const addObserved = (running: number | null, seen: number | null): number | null =>
  seen === null ? running : (running ?? 0) + seen;

/**
 * Fold ONE assistant turn's reported usage into the floor.
 *
 * Each component accumulates independently, so a field no turn ever reported
 * stays null rather than becoming a sum of nothing. `cache_read_input_tokens`
 * and `cache_creation_input_tokens` are declared nullable by the API's own
 * types, and a null there means "not reported for this turn" — not zero.
 */
const foldStreamUsage = (
  state: HostedObservation,
  message: Record<string, unknown>,
  inner: Record<string, unknown> | undefined,
): HostedObservation => {
  const usage = inner?.usage as Record<string, unknown> | undefined;
  const aborted = message.aborted === true ? 1 : 0;
  if (usage === null || usage === undefined || typeof usage !== 'object') {
    // The turn reported no usage block at all. It still happened, and if it was
    // aborted that is worth counting, but it contributes nothing to the floor
    // and does not count toward the turns the floor is built from.
    return aborted === 0 ? state : {
      ...state,
      streamUsage: { ...state.streamUsage, abortedMessages: state.streamUsage.abortedMessages + aborted },
    };
  }
  const previous = state.streamUsage;
  return {
    ...state,
    streamUsage: {
      messages: previous.messages + 1,
      abortedMessages: previous.abortedMessages + aborted,
      inputTokens: addObserved(previous.inputTokens, num(usage.input_tokens)),
      outputTokens: addObserved(previous.outputTokens, num(usage.output_tokens)),
      cacheReadInputTokens: addObserved(previous.cacheReadInputTokens, num(usage.cache_read_input_tokens)),
      cacheCreationInputTokens: addObserved(previous.cacheCreationInputTokens, num(usage.cache_creation_input_tokens)),
    },
  };
};

/** A token count: a non-negative integer, or null. A fraction or a negative is not a count. */
const tokenCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/**
 * Fold ONE assistant turn's own `model` into the per-model tally, when the turn
 * produced output. See {@link HostedTurnModel} for which turns count.
 */
const foldTurnModel = (
  state: HostedObservation,
  message: Record<string, unknown>,
  inner: Record<string, unknown> | undefined,
): HostedObservation => {
  // A subagent's turn is not the session's, and an error delivered as a message is not a turn.
  if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) return state;
  if (message.error !== null && message.error !== undefined) return state;
  const model = inner?.model;
  const usage = inner?.usage as Record<string, unknown> | undefined;
  const output = tokenCount(usage?.output_tokens);
  if (typeof model !== 'string' || model.trim() === '' || output === null || output === 0) return state;
  const index = state.turnModels.findIndex((entry) => entry.model === model);
  return {
    ...state,
    turnModels: index === -1
      ? [...state.turnModels, { model, turns: 1, outputTokens: output }]
      : state.turnModels.map((entry, at) => at === index
        ? { model, turns: entry.turns + 1, outputTokens: entry.outputTokens + output }
        : entry),
  };
};

/**
 * The result's `modelUsage`, read one entry at a time. Null when the result
 * carried none, and an entry that is not an object is skipped rather than
 * allowed to throw mid-run.
 */
const readModelUsage = (raw: unknown): readonly HostedResultModelUsage[] | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries: HostedResultModelUsage[] = [];
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (model.trim() === '' || value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    entries.push({
      model,
      canonicalModel: typeof entry.canonicalModel === 'string' && entry.canonicalModel.trim() !== ''
        ? entry.canonicalModel : null,
      inputTokens: tokenCount(entry.inputTokens),
      outputTokens: tokenCount(entry.outputTokens),
    });
  }
  // The largest producer first, so a bounded export keeps the entries that matter.
  return entries.sort((a, b) => (b.outputTokens ?? -1) - (a.outputTokens ?? -1) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
};

/**
 * Fold one SDK message into the running observation. Written as a reducer over
 * `unknown` rather than against the SDK's types on purpose: a hosted runtime
 * can ship a new message shape at any time, and an unrecognised message must
 * be counted and ignored, never allowed to throw mid-run.
 */
export function foldHostedMessage(
  state: HostedObservation,
  message: unknown,
): HostedObservation {
  if (message === null || typeof message !== 'object') {
    return { ...state, unknownMessageCount: state.unknownMessageCount + 1 };
  }
  const m = message as Record<string, unknown>;

  if (m.type === 'system' && m.subtype === 'init') {
    return {
      ...state,
      initSeen: true,
      sessionId: typeof m.session_id === 'string' && m.session_id.trim() !== ''
        ? m.session_id
        : null,
      actualModel: typeof m.model === 'string' && m.model.trim() !== '' ? m.model : null,
      runtimeVersion: typeof m.claude_code_version === 'string' ? m.claude_code_version : null,
      apiKeySource: typeof m.apiKeySource === 'string' ? m.apiKeySource : null,
      reportedCwd: typeof m.cwd === 'string' ? m.cwd : null,
      reportedTools: Array.isArray(m.tools) ? m.tools.filter((t): t is string => typeof t === 'string') : [],
    };
  }

  if (m.type === 'assistant' || m.type === 'user') {
    const inner = m.message as Record<string, unknown> | undefined;
    const content = inner?.content;
    /**
     * THE TURN'S OWN USAGE, FOLDED BEFORE ANYTHING ELSE CAN RETURN EARLY.
     *
     * Above the `content` guard deliberately: a turn whose content is absent or
     * unparseable still reported what it consumed, and the old shape returned
     * `state` unchanged there — which is how a cut-off run's last, most
     * interesting turn would have been the one dropped.
     *
     * ASSISTANT ONLY. A `user` message is the harness replaying a tool result
     * and carries no usage of its own; counting one would double what the
     * assistant turn beside it already reported.
     */
    let next = m.type === 'assistant' ? foldTurnModel(foldStreamUsage(state, m, inner), m, inner) : state;
    if (!Array.isArray(content)) return next;
    for (const raw of content) {
      if (raw === null || typeof raw !== 'object') continue;
      const block = raw as Record<string, unknown>;
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        next = { ...next, thinkingBlocksOmitted: next.thinkingBlocksOmitted + 1 };
        continue;
      }
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        const tool = block.name;
        const targets: string[] = [];
        const input = block.input;
        if (input !== null && typeof input === 'object') {
          for (const key of PATH_KEYS) {
            const value = (input as Record<string, unknown>)[key];
            if (typeof value === 'string' && value.length > 0) {
              targets.push(value.length > 200 ? `${value.slice(0, 197)}…` : value);
            }
          }
        }
        next = {
          ...next,
          toolsUsed: next.toolsUsed.includes(tool) ? next.toolsUsed : [...next.toolsUsed, tool],
          toolInvocations: next.toolInvocations + 1,
          toolTargets: [...next.toolTargets, ...targets],
        };
      }
    }
    return next;
  }

  if (m.type === 'result') {
    const usageRaw = m.usage as Record<string, unknown> | undefined;
    const inputTokens = num(usageRaw?.input_tokens);
    const outputTokens = num(usageRaw?.output_tokens);
    const cost = num(m.total_cost_usd);
    return {
      ...state,
      resultSubtype: typeof m.subtype === 'string' ? m.subtype : null,
      isError: readClaudeCodeErrorFlag(m.is_error),
      terminalReason: readClaudeCodeTerminalReason(m.terminal_reason),
      /**
       * THE REPORT IS READ BY A PARSER, NOT SHOWN TO ANYONE.
       *
       * This was `safeText(m.result)`. `safeText` is the DISPLAY sanitizer for
       * short event strings: it collapses all whitespace and truncates at 600
       * characters. Relay's structured execution report is longer than that,
       * so every hosted run had its report guillotined mid-JSON before the
       * parser saw it — and the mission died with "Report JSON object is not
       * closed" or, when the cut landed earlier, "Required report marker is
       * absent". Both refusals were correct about the text they were given and
       * wrong about the agent, which had done the work: `result=success`,
       * `turns=5`, `toolsUsed=3`.
       *
       * The local surface has always captured this raw (`stream-parser.ts`
       * sets `finalResult = record.result`), which is what the invoker seam
       * exists to guarantee — one report contract, not two. This is the drift
       * it was built to prevent, arriving in the field it does not cover.
       *
       * SAFE BECAUSE NOTHING DISPLAYS IT: the only consumers are
       * `parseAgentExecutionReport` and a character count. The report's own
       * fields are redacted downstream when they become events and claims.
       */
      finalText: typeof m.result === 'string' ? m.result : null,
      numTurns: num(m.num_turns),
      durationMs: num(m.duration_ms),
      resultModelUsage: readModelUsage(m.modelUsage),
      permissionDenials: Array.isArray(m.permission_denials) ? m.permission_denials.length : 0,
      usage: inputTokens === null && outputTokens === null && cost === null
        // Unreported usage stays Unknown. It never becomes zero.
        ? UNKNOWN_HOSTED_USAGE
        : { inputTokens, outputTokens, totalCostUsd: cost, source: 'runtime_reported' },
    };
  }

  return { ...state, unknownMessageCount: state.unknownMessageCount + 1 };
}

export function emptyObservation(): HostedObservation {
  return EMPTY;
}

/** Fold a whole stream. Convenience for tests and for the runner alike. */
export function observeHostedMessages(messages: readonly unknown[]): HostedObservation {
  return messages.reduce<HostedObservation>(foldHostedMessage, EMPTY);
}

/**
 * WHY A SERVED MODEL WAS OR WAS NOT ATTESTED, as a closed set.
 *
 * The domain keeps its own copy (`JULIUS_SERVED_MODEL_BASES`) because it may
 * not import an adapter; `hosted-served-model.test.ts` fails if the two
 * disagree.
 */
export const HOSTED_SERVED_MODEL_BASES = [
  /** One model produced every output-bearing turn, and the result's `modelUsage` names it with output. */
  'attested',
  /** No turn of the session produced output under a named model. Attempt 1's shape. */
  'no_output_turns',
  /** Output-bearing turns named more than one model, so no single model served the dispatch. */
  'mixed_turn_models',
  /** The stream ended without a result, so the runtime never gave its own account. */
  'no_result',
  /** A result arrived without `modelUsage`. */
  'no_model_usage',
  /** The result's `modelUsage` does not name the turns' model with output. The two accounts disagree. */
  'result_disagrees',
] as const;
export type HostedServedModelBasis = (typeof HOSTED_SERVED_MODEL_BASES)[number];

/**
 * THE MODEL THAT SERVED THE DISPATCH, WHEN TWO INDEPENDENT ACCOUNTS AGREE.
 *
 * The turns say which model generated each piece of output. The result's
 * `modelUsage` is the runtime's own final accounting. A served model is named
 * only when every output-bearing turn names ONE model and the result credits
 * that model with output. Anything less is null, with the reason beside it.
 * `init`'s announcement is never consulted: it is what attempt 1 recorded as
 * served when nothing had served.
 *
 * Other models in `modelUsage` do not unseat the answer. A runtime may spend a
 * little on a helper model for its own housekeeping, and every entry is
 * reported beside the verdict so that spending is visible, not hidden.
 */
export function hostedServedModel(o: HostedObservation): {
  readonly servedModel: string | null;
  readonly basis: HostedServedModelBasis;
} {
  if (o.turnModels.length === 0) return { servedModel: null, basis: 'no_output_turns' };
  if (o.turnModels.length > 1) return { servedModel: null, basis: 'mixed_turn_models' };
  if (o.resultSubtype === null) return { servedModel: null, basis: 'no_result' };
  if (o.resultModelUsage === null) return { servedModel: null, basis: 'no_model_usage' };
  const turn = o.turnModels[0].model;
  const credited = o.resultModelUsage.some((entry) =>
    (entry.model === turn || entry.canonicalModel === turn) && entry.outputTokens !== null && entry.outputTokens > 0);
  return credited ? { servedModel: turn, basis: 'attested' } : { servedModel: null, basis: 'result_disagrees' };
}

/**
 * The model that produced the most output across the session's turns, or null
 * when no turn produced any. Ties go to the model seen first. This is evidence
 * for a reader, never a verdict. {@link hostedServedModel} is the verdict.
 */
export function dominantTurnModel(o: HostedObservation): string | null {
  let best: HostedTurnModel | null = null;
  for (const entry of o.turnModels) if (best === null || entry.outputTokens > best.outputTokens) best = entry;
  return best?.model ?? null;
}

/**
 * Did the stream contain enough to be trusted at all?
 *
 * Without an `init` there is no verified model, no reported cwd and no granted
 * tool list — which means the envelope cannot be checked, so the run cannot be
 * accepted however healthy its final message looks.
 */
export function hostedStreamIsUsable(
  o: HostedObservation,
): { ok: boolean; reason: string | null } {
  if (!o.initSeen) {
    return { ok: false, reason: 'the hosted runtime never reported an initialization message' };
  }
  if (o.resultSubtype === null) {
    return { ok: false, reason: 'the hosted runtime never reported a final result' };
  }
  /**
   * EVERY FIELD OF THE RESULT MUST SAY SUCCESS, not only `is_error`. An error
   * subtype beside `is_error: false`, a missing `is_error`, an unknown subtype
   * or a terminal reason other than `completed` is not a finished session.
   */
  const refusal = claudeCodeResultRefusalReason(o);
  if (refusal !== null) return { ok: false, reason: refusal.replace(/^the runtime/u, 'the hosted runtime') };
  return { ok: true, reason: null };
}
