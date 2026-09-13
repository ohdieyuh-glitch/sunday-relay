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
 *   A SUCCESSFUL RESULT MESSAGE IS NOT A VERDICT. `result.subtype === 'success'`
 *   means the agent finished its turn, not that the work is correct or that it
 *   stayed inside its envelope. Relay's own inspection and tests decide that,
 *   afterwards, and this module only reports what it saw.
 */


export interface HostedUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /**
   * THE RESULT'S OWN CACHE COUNTS. `inputTokens` is the runtime's UNCACHED
   * input, so a coder that read most of its context from the prompt cache —
   * every long run does — reported 32 input tokens over 21 turns on Mission 5,
   * and a receipt could say nothing truer. These are the tokens read from the
   * cache and written to it, as the terminal result stated them.
   */
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly totalCostUsd: number | null;
  readonly source: 'runtime_reported' | 'unavailable';
}

export const UNKNOWN_HOSTED_USAGE: HostedUsage = Object.freeze({
  inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null,
  totalCostUsd: null, source: 'unavailable',
});

/**
 * ONE MODEL'S SHARE OF A RUN, as the result's `modelUsage` stated it.
 *
 * WHY IT IS READ AT ALL. The runtime's own cost guide says to account from
 * `total_cost_usd` or `modelUsage` rather than `usage`: `usage` counts only the
 * top-level loop, and on `error_max_budget_usd` it leaves out the response that
 * crossed the budget while the other two include it. Lab run 34739303313 is
 * that case — a coder that spent $0.369044 with `usage` reading 0 in and 0 out.
 * `costUsd` is the runtime's client-side estimate, as `total_cost_usd` is, and
 * never a provider's bill.
 */
export interface HostedModelUsage {
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly costUsd: number | null;
}

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
  /** The model the RUNTIME named. Never the requested one. */
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
  /** Per-model usage from the result, in model-id order; empty when none was reported. */
  readonly modelUsage: readonly HostedModelUsage[];
  readonly resultSubtype: string | null;
  readonly isError: boolean | null;
  readonly finalText: string | null;
  /** Hidden reasoning is counted and dropped — never stored, never surfaced. */
  readonly thinkingBlocksOmitted: number;
  readonly unknownMessageCount: number;
}

const EMPTY: HostedObservation = {
  initSeen: false, sessionId: null, actualModel: null, runtimeVersion: null, apiKeySource: null,
  reportedCwd: null, reportedTools: [], toolTargets: [], toolsUsed: [], toolInvocations: 0,
  permissionDenials: 0, numTurns: null, durationMs: null, usage: UNKNOWN_HOSTED_USAGE,
  streamUsage: NO_HOSTED_STREAM_USAGE, modelUsage: [],
  resultSubtype: null, isError: null, finalText: null,
  thinkingBlocksOmitted: 0, unknownMessageCount: 0,
};

const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'glob'];
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A count or an amount the runtime reported: finite and not negative, or unknown. */
const nonNegative = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** A model id as the runtime writes one. A key that is not one is not recorded. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$/u;

/**
 * READ `modelUsage` WITHOUT TRUSTING ITS SHAPE. The runtime is a separate
 * process and its final message is input: an entry needs a model-id key and an
 * object value, and every figure in it is recorded only when it is a finite,
 * non-negative number. Only the four token counts and the cost are kept.
 */
export function readHostedModelUsage(raw: unknown): readonly HostedModelUsage[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const entries: HostedModelUsage[] = [];
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MODEL_ID.test(model) || value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const figures = value as Record<string, unknown>;
    entries.push({
      model,
      inputTokens: nonNegative(figures.inputTokens),
      outputTokens: nonNegative(figures.outputTokens),
      cacheReadInputTokens: nonNegative(figures.cacheReadInputTokens),
      cacheCreationInputTokens: nonNegative(figures.cacheCreationInputTokens),
      costUsd: nonNegative(figures.costUSD),
    });
  }
  return entries.sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
}

/** The most models a summary names. A run that used more says how many it left out. */
export const HOSTED_MODEL_USAGE_SUMMARY_LIMIT = 8;

/**
 * ONE LINE A DIAGNOSTICS COLUMN CAN CARRY: `model:in=N,out=N,cr=N,cc=N,usd=D`
 * per model, joined by `;`, with `?` for a figure the runtime did not report and
 * a final `+N` when more models than the limit were used. Null when the result
 * named no model. A closed grammar, so the allowlist can refuse anything else.
 */
export function summariseHostedModelUsage(entries: readonly HostedModelUsage[]): string | null {
  if (entries.length === 0) return null;
  const count = (value: number | null): string => (value === null ? '?' : String(Math.round(value)));
  const parts = entries.slice(0, HOSTED_MODEL_USAGE_SUMMARY_LIMIT).map((entry) =>
    `${entry.model}:in=${count(entry.inputTokens)},out=${count(entry.outputTokens)},cr=${count(entry.cacheReadInputTokens)},cc=${count(entry.cacheCreationInputTokens)},usd=${entry.costUsd === null ? '?' : entry.costUsd.toFixed(6)}`);
  if (entries.length > HOSTED_MODEL_USAGE_SUMMARY_LIMIT) parts.push(`+${entries.length - HOSTED_MODEL_USAGE_SUMMARY_LIMIT}`);
  return parts.join(';');
}

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
    let next = m.type === 'assistant' ? foldStreamUsage(state, m, inner) : state;
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
    const cacheReadInputTokens = nonNegative(usageRaw?.cache_read_input_tokens);
    const cacheCreationInputTokens = nonNegative(usageRaw?.cache_creation_input_tokens);
    const cost = num(m.total_cost_usd);
    return {
      ...state,
      resultSubtype: typeof m.subtype === 'string' ? m.subtype : null,
      isError: m.is_error === true,
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
      permissionDenials: Array.isArray(m.permission_denials) ? m.permission_denials.length : 0,
      usage: inputTokens === null && outputTokens === null && cost === null
        && cacheReadInputTokens === null && cacheCreationInputTokens === null
        // Unreported usage stays Unknown. It never becomes zero.
        ? UNKNOWN_HOSTED_USAGE
        : { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, totalCostUsd: cost, source: 'runtime_reported' },
      modelUsage: readHostedModelUsage(m.modelUsage),
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
  if (o.isError === true) {
    return { ok: false, reason: `the hosted runtime reported ${o.resultSubtype}` };
  }
  return { ok: true, reason: null };
}
