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
  readonly totalCostUsd: number | null;
  readonly source: 'runtime_reported' | 'unavailable';
}

export const UNKNOWN_HOSTED_USAGE: HostedUsage = Object.freeze({
  inputTokens: null, outputTokens: null, totalCostUsd: null, source: 'unavailable',
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
  readonly toolsUsed: readonly string[];
  /** Permission denials the runtime itself recorded — evidence of the envelope working. */
  readonly permissionDenials: number;
  readonly numTurns: number | null;
  readonly durationMs: number | null;
  readonly usage: HostedUsage;
  readonly resultSubtype: string | null;
  readonly isError: boolean | null;
  readonly finalText: string | null;
  /** Hidden reasoning is counted and dropped — never stored, never surfaced. */
  readonly thinkingBlocksOmitted: number;
  readonly unknownMessageCount: number;
}

const EMPTY: HostedObservation = {
  initSeen: false, sessionId: null, actualModel: null, runtimeVersion: null, apiKeySource: null,
  reportedCwd: null, reportedTools: [], toolTargets: [], toolsUsed: [],
  permissionDenials: 0, numTurns: null, durationMs: null, usage: UNKNOWN_HOSTED_USAGE,
  resultSubtype: null, isError: null, finalText: null,
  thinkingBlocksOmitted: 0, unknownMessageCount: 0,
};

const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'glob'];
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

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
    const content = (m.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) return state;
    let next = state;
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
