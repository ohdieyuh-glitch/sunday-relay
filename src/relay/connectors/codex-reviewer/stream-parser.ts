/**
 * Codex Reviewer stream parser (Prompt 8.3) — PURE. Incrementally parses the
 * newline-delimited JSON event stream from `codex exec --json`. It is
 * deliberately DEFENSIVE and forward-compatible: unknown event types are
 * counted, blank lines ignored, malformed required records recorded honestly,
 * and hidden reasoning is DROPPED (only the omission count is kept). The final
 * structured report is captured primarily from the --output-last-message file
 * (see process-runner); assistant text chunks here are a fallback only.
 */

export type SafeReviewerActivity = { kind: string; targets: string[] };

export interface ParsedReviewerStream {
  initSeen: boolean;
  sessionId: string | null;
  model: string | null;
  activity: SafeReviewerActivity[];
  diffInspectionSeen: boolean;
  evidenceInspectionSeen: boolean;
  finalMessage: string | null;
  turnCompleted: boolean;
  errorSeen: boolean;
  errorSummary: string | null;
  unknownRecordCount: number;
  malformedLineCount: number;
  reasoningBlocksOmitted: number;
  assistantTextChunks: string[];
}

const SAFE_ACTIVITY_KINDS = new Set([
  'read', 'search', 'grep', 'list', 'shell', 'command', 'exec', 'tool', 'file', 'patch_view',
]);
const PATH_KEYS = ['path', 'file', 'file_path', 'target', 'pattern', 'query', 'cmd', 'command'];
const MAX_ACTIVITY = 200;

function extractSessionId(obj: Record<string, unknown>): string | null {
  for (const key of ['session_id', 'sessionId', 'thread_id', 'threadId', 'conversation_id', 'id']) {
    const v = obj[key];
    if (typeof v === 'string' && v.length >= 6) return v;
  }
  for (const key of ['session', 'thread', 'conversation']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object') {
      const id = (nested as Record<string, unknown>).id ?? (nested as Record<string, unknown>).session_id;
      if (typeof id === 'string' && id.length >= 6) return id;
    }
  }
  return null;
}

function safeTargets(obj: Record<string, unknown>): string[] {
  const targets: string[] = [];
  for (const key of PATH_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v) targets.push(v.slice(0, 200));
  }
  return targets.slice(0, 6);
}

const isReasoning = (t: string): boolean => /reasoning|thinking|chain[_-]?of[_-]?thought/i.test(t);

export function createReviewerStreamParser(): {
  push(chunk: string): void;
  end(): ParsedReviewerStream;
  peek(): ParsedReviewerStream;
} {
  const state: ParsedReviewerStream = {
    initSeen: false, sessionId: null, model: null, activity: [], diffInspectionSeen: false,
    evidenceInspectionSeen: false, finalMessage: null, turnCompleted: false, errorSeen: false,
    errorSummary: null, unknownRecordCount: 0, malformedLineCount: 0, reasoningBlocksOmitted: 0,
    assistantTextChunks: [],
  };
  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      state.malformedLineCount += 1;
      return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      state.unknownRecordCount += 1;
      return;
    }
    const rec = obj as Record<string, unknown>;
    const type = String(rec.type ?? rec.event ?? rec.kind ?? '').toLowerCase();

    // Session / initialization.
    const sid = extractSessionId(rec);
    if (sid && !state.sessionId) state.sessionId = sid;
    if (/session|thread|configured|init|started/.test(type)) {
      state.initSeen = true;
      const model = rec.model ?? (rec.session as Record<string, unknown> | undefined)?.model;
      if (typeof model === 'string') state.model = model;
    }

    // Reasoning — DROP content, count omissions.
    if (isReasoning(type)) {
      state.reasoningBlocksOmitted += 1;
      return;
    }

    // Errors.
    if (/error|failed|aborted/.test(type)) {
      state.errorSeen = true;
      const msg = rec.message ?? rec.error ?? rec.reason;
      if (typeof msg === 'string' && !state.errorSummary) state.errorSummary = msg.slice(0, 300);
      return;
    }

    // Turn / completion.
    if (/turn\.completed|thread\.finished|completed|result|done/.test(type)) {
      state.turnCompleted = true;
    }

    // Assistant message text (fallback capture of the final report).
    const text = extractAssistantText(rec);
    if (text) {
      state.assistantTextChunks.push(text);
      if (/diff|changed file|patch/i.test(text)) state.diffInspectionSeen = true;
      if (/evidence|test|verification/i.test(text)) state.evidenceInspectionSeen = true;
    }

    // Tool / command activity.
    if (SAFE_ACTIVITY_KINDS.has(type) || /item|tool|command|exec|patch/.test(type)) {
      if (state.activity.length < MAX_ACTIVITY) {
        const targets = safeTargets(rec);
        state.activity.push({ kind: type || 'activity', targets });
        if (targets.some((t) => /diff|\.patch|git/i.test(t)) || /diff|patch/.test(type)) state.diffInspectionSeen = true;
        if (targets.some((t) => /test|evidence|verify/i.test(t))) state.evidenceInspectionSeen = true;
      }
    } else if (type && !/session|thread|configured|init|started|turn|completed|result|done/.test(type)) {
      state.unknownRecordCount += 1;
    }
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    },
    end(): ParsedReviewerStream {
      if (buffer.length) { handleLine(buffer); buffer = ''; }
      if (state.finalMessage == null && state.assistantTextChunks.length) {
        state.finalMessage = state.assistantTextChunks.join('\n');
      }
      return state;
    },
    peek(): ParsedReviewerStream {
      return state;
    },
  };
}

function extractAssistantText(rec: Record<string, unknown>): string | null {
  const collect = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.text === 'string') return o.text;
      if (Array.isArray(o.content)) {
        return o.content
          .map((c) => (c && typeof c === 'object' && typeof (c as Record<string, unknown>).text === 'string'
            ? (c as Record<string, unknown>).text as string : ''))
          .filter(Boolean)
          .join('');
      }
    }
    return null;
  };
  const role = String(rec.role ?? (rec.item as Record<string, unknown> | undefined)?.role ?? '').toLowerCase();
  if (role && role !== 'assistant' && role !== 'agent') return null;
  return collect(rec.message) ?? collect(rec.item) ?? collect(rec.text) ?? collect(rec.content) ?? null;
}

export function reviewerStreamIsStructurallyValid(state: ParsedReviewerStream): { ok: boolean; reason?: string } {
  if (!state.initSeen) return { ok: false, reason: 'missing initialization record' };
  if (state.sessionId === null) return { ok: false, reason: 'missing session id' };
  if (state.errorSeen) return { ok: false, reason: state.errorSummary ?? 'reviewer reported an error' };
  if (!state.turnCompleted) return { ok: false, reason: 'missing completion record' };
  return { ok: true };
}
