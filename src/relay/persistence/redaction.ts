/**
 * Persistence redaction (Prompt 8.5) — PURE. Every payload is sanitized
 * BEFORE it reaches the journal or a snapshot. The journal must never
 * contain credentials, tokens, cookies, recovery codes, raw provider event
 * streams, chain-of-thought / hidden reasoning, full internal prompts,
 * account information, or unredacted environment values.
 *
 * Redaction is structural (forbidden key names are dropped), shape-based
 * (secret-shaped substrings are replaced), and bounded (strings and arrays
 * are truncated so no unrestricted output is persisted).
 */

export const FORBIDDEN_KEY_RE =
  /password|passwd|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|secret|authorization|cookie|recovery[-_]?code|bearer|credential|account[-_]?email|env(ironment)?[-_]?values?$/i;

/** Keys whose values are raw streams / transcripts / prompts — never persisted. */
export const FORBIDDEN_STREAM_KEY_RE =
  /^(rawStream|rawEvents|eventStream|transcript|stdout|stderr|prompt|promptBody|systemPrompt|fullPrompt|reasoning|thinking|chainOfThought|hiddenReasoning|profile|accountProfile)$/i;

export const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9]{8,})|(AKIA[0-9A-Z]{12,})|(-----BEGIN [A-Z ]*PRIVATE KEY)|(gh[pousr]_[A-Za-z0-9]{20,})|(xox[baprs]-[A-Za-z0-9-]{10,})|(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;

export const HIDDEN_REASONING_RE = /chain[- ]of[- ]thought|hidden reasoning|<thinking>|internal monologue/i;

export interface SanitizeOptions {
  maxStringLength?: number;
  maxArrayLength?: number;
  maxDepth?: number;
}

const DEFAULTS: Required<SanitizeOptions> = { maxStringLength: 2_000, maxArrayLength: 200, maxDepth: 8 };

export function sanitizeText(text: string, maxLength = DEFAULTS.maxStringLength): string {
  let safe = text.replace(SECRET_VALUE_RE, '[REDACTED]');
  if (HIDDEN_REASONING_RE.test(safe)) safe = '[REDACTED: hidden-reasoning-shaped content removed]';
  if (safe.length > maxLength) safe = `${safe.slice(0, maxLength)}…[truncated]`;
  return safe;
}

/** Deep-sanitize a payload for persistence. Forbidden keys are DROPPED
 * (recorded in the returned count), secret shapes are replaced, strings and
 * arrays are bounded, and non-serializable values are removed. */
export function sanitizePayload(
  value: unknown, options: SanitizeOptions = {},
): { payload: Record<string, unknown>; droppedKeys: number } {
  const opts = { ...DEFAULTS, ...options };
  let droppedKeys = 0;

  const visit = (input: unknown, depth: number): unknown => {
    if (depth > opts.maxDepth) return '[REDACTED: depth-bounded]';
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') return sanitizeText(input, opts.maxStringLength);
    if (Array.isArray(input)) {
      const bounded = input.slice(0, opts.maxArrayLength).map((v) => visit(v, depth + 1));
      if (input.length > opts.maxArrayLength) bounded.push(`[truncated: ${input.length - opts.maxArrayLength} more]`);
      return bounded;
    }
    if (typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
        if (FORBIDDEN_KEY_RE.test(key) || FORBIDDEN_STREAM_KEY_RE.test(key)) { droppedKeys += 1; continue; }
        const visited = visit(raw, depth + 1);
        if (visited !== undefined) out[key] = visited;
      }
      return out;
    }
    return undefined; // functions, symbols, bigints are never persisted
  };

  const result = visit(value ?? {}, 0);
  const payload = (result !== null && typeof result === 'object' && !Array.isArray(result))
    ? result as Record<string, unknown>
    : { value: result ?? null };
  return { payload, droppedKeys };
}

/** Test/audit helper: does persisted text contain secret-shaped material or
 * forbidden markers? Used by the security tests and the artifact scans. */
export function containsForbiddenMaterial(text: string): string | null {
  SECRET_VALUE_RE.lastIndex = 0;
  if (SECRET_VALUE_RE.test(text)) return 'secret-shaped value';
  if (HIDDEN_REASONING_RE.test(text)) return 'hidden-reasoning marker';
  return null;
}
