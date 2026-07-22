/**
 * Claude Code stream-json parser (Prompt 8) — PURE, incremental. Consumes
 * NDJSON chunks from `claude -p --output-format stream-json`, tolerating
 * partial chunks, blank lines, unknown record types, and noncritical
 * malformed lines. Hidden reasoning (thinking/reasoning blocks) is COUNTED
 * and DROPPED, never surfaced. A malformed or missing REQUIRED record
 * (init, result) is reported so the adapter can stop honestly.
 */

export type SafeToolActivity = {
  tool: string;
  /** Sanitized target descriptors (file paths / patterns) — never contents. */
  targets: string[];
};

export interface ParsedStreamState {
  initSeen: boolean;
  sessionId: string | null;
  model: string | null;
  cwd: string | null;
  toolActivity: SafeToolActivity[];
  finalResult: string | null;
  resultSubtype: string | null;
  isError: boolean | null;
  usage: {
    numTurns: number | null;
    durationMs: number | null;
    apiDurationMs: number | null;
    reportedCostUsd: number | null;
  };
  unknownRecordCount: number;
  malformedLineCount: number;
  thinkingBlocksOmitted: number;
  assistantTextChunks: string[];
}

const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'LS', 'NotebookRead']);
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'glob'];

const sanitizeToolTargets = (input: unknown): string[] => {
  if (typeof input !== 'object' || input === null) return [];
  const record = input as Record<string, unknown>;
  const targets: string[] = [];
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      // Names/patterns only, bounded; never the edit content.
      targets.push(value.length > 200 ? `${value.slice(0, 197)}…` : value);
    }
  }
  return targets;
};

export function createStreamParser() {
  const state: ParsedStreamState = {
    initSeen: false, sessionId: null, model: null, cwd: null,
    toolActivity: [], finalResult: null, resultSubtype: null, isError: null,
    usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null },
    unknownRecordCount: 0, malformedLineCount: 0, thinkingBlocksOmitted: 0,
    assistantTextChunks: [],
  };
  let buffer = '';

  const handleContentBlock = (block: unknown): void => {
    if (typeof block !== 'object' || block === null) return;
    const b = block as Record<string, unknown>;
    const type = b.type;
    if (type === 'thinking' || type === 'redacted_thinking' || type === 'reasoning') {
      state.thinkingBlocksOmitted += 1; // dropped — never stored or emitted
      return;
    }
    if (type === 'text' && typeof b.text === 'string') {
      state.assistantTextChunks.push(b.text);
      return;
    }
    if (type === 'tool_use' && typeof b.name === 'string') {
      const tool = b.name;
      if (SAFE_TOOLS.has(tool)) {
        state.toolActivity.push({ tool, targets: sanitizeToolTargets(b.input) });
      } else {
        state.toolActivity.push({ tool: `${tool}`, targets: [] });
      }
    }
  };

  const handleRecord = (record: Record<string, unknown>): void => {
    const type = record.type;
    if (typeof record.session_id === 'string' && !state.sessionId) state.sessionId = record.session_id;

    if (type === 'system' && record.subtype === 'init') {
      state.initSeen = true;
      if (typeof record.session_id === 'string') state.sessionId = record.session_id;
      if (typeof record.model === 'string') state.model = record.model;
      if (typeof record.cwd === 'string') state.cwd = record.cwd;
      return;
    }
    if (type === 'assistant' || type === 'user') {
      const message = record.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (Array.isArray(content)) content.forEach(handleContentBlock);
      return;
    }
    if (type === 'result') {
      state.resultSubtype = typeof record.subtype === 'string' ? record.subtype : null;
      state.isError = record.is_error === true;
      if (typeof record.result === 'string') state.finalResult = record.result;
      if (typeof record.num_turns === 'number') state.usage.numTurns = record.num_turns;
      if (typeof record.duration_ms === 'number') state.usage.durationMs = record.duration_ms;
      if (typeof record.duration_api_ms === 'number') state.usage.apiDurationMs = record.duration_api_ms;
      if (typeof record.total_cost_usd === 'number') state.usage.reportedCostUsd = record.total_cost_usd;
      if (typeof record.model === 'string' && !state.model) state.model = record.model;
      return;
    }
    // Unknown future record type: recorded as safely ignored, never a
    // workflow input.
    state.unknownRecordCount += 1;
  };

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      state.malformedLineCount += 1;
      return;
    }
    if (typeof record === 'object' && record !== null && !Array.isArray(record)) {
      handleRecord(record as Record<string, unknown>);
    } else {
      state.unknownRecordCount += 1;
    }
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        consumeLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    },
    end(): ParsedStreamState {
      if (buffer.length > 0) {
        consumeLine(buffer);
        buffer = '';
      }
      return state;
    },
    peek(): ParsedStreamState {
      return state;
    },
  };
}

export type StreamParser = ReturnType<typeof createStreamParser>;

/** Did the stream contain the required records to be trusted at all? */
export function streamIsStructurallyValid(state: ParsedStreamState): { ok: boolean; reason?: string } {
  if (!state.initSeen) return { ok: false, reason: 'missing initialization record' };
  if (state.sessionId === null) return { ok: false, reason: 'missing session id' };
  if (state.resultSubtype === null) return { ok: false, reason: 'missing final result record' };
  return { ok: true };
}
