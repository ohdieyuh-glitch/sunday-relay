/**
 * Bridge redaction — the last line before any text reaches the browser.
 *
 * The relay-bridge runs real providers server-side; nothing it emits to the
 * browser may carry a credential, an absolute host path, or a raw stack
 * trace. Every headline/detail/meta string in a mission view passes through
 * `safeText` (and `safeError` for error messages). This is defense in depth:
 * the connectors already sanitize their own output, but the bridge never
 * trusts that and re-scrubs at the wire boundary.
 */

const MAX_LEN = 600;

// Credential-shaped material: provider keys, bearer/authorization tokens,
// and long opaque secrets. These should never appear in a normalized event,
// but if a connector ever leaked one we blank it here.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style keys
  /\b(?:xox[baprs]|ghp|gho|ghu|ghs|ghr)-[A-Za-z0-9-]{10,}/g, // slack/github tokens
  /**
   * UNDERSCORE forms. Every GitHub token minted since 2021 is `ghp_...`, not
   * `ghp-...`, and `github_pat_` is the fine-grained form. The hyphen-only
   * pattern above missed all of them — found when a credential embedded in a
   * checkout's `origin` URL survived redaction on its way into a persisted,
   * user-visible mission failure reason.
   */
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /** Credentials embedded in a URL: `https://user:token@host/...`. */
  /\/\/[^/\s@]+@/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b(?:api[_-]?key|secret|token|password|authorization)\b\s*[:=]\s*\S+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, // JWTs
];

/** Collapse an absolute host path to just its basename so no sensitive
    directory structure (home dir, temp fixture path) reaches the browser. */
function stripAbsolutePaths(text: string): string {
  // /home/<user>/... , /tmp/relay-claude-fixture-xxxx/... , /Users/...
  return text.replace(/(?:\/(?:home|Users|tmp|var|root)\/[^\s"'`)]+)/g, (m) => {
    const base = m.split('/').filter(Boolean).pop() ?? '';
    return base ? `…/${base}` : '…';
  });
}

/** Make a single free-text string safe to display in the browser. */
export function safeText(input: unknown): string {
  let text = typeof input === 'string' ? input : String(input ?? '');
  for (const re of SECRET_PATTERNS) text = text.replace(re, '[redacted]');
  text = stripAbsolutePaths(text);
  // Never surface a raw stack frame.
  text = text.replace(/\n\s*at\s+.+/g, '').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;
  return text;
}

/** A safe, bounded error message. Falls back to a neutral phrase when the
    input is empty or entirely redacted. */
export function safeError(input: unknown, fallback = 'The mission stopped.'): string {
  const t = safeText(input);
  return t || fallback;
}

/** Redact an array of free-text lines. */
export function safeLines(lines: readonly unknown[]): string[] {
  return lines.map((l) => safeText(l)).filter((l) => l.length > 0);
}

/**
 * REDACTION WITHOUT THE DISPLAY BOUND, for payloads a MACHINE reads.
 *
 * `safeText` exists for short strings a human sees: it collapses whitespace and
 * truncates at 600 characters. Applied to a structured payload it is
 * destructive, and it has been twice — the hosted Coding Agent's execution
 * report and the Hermes Reviewer's verdict were both guillotined mid-JSON
 * before their parsers saw them, and Relay then blamed the agent for producing
 * something unreadable.
 *
 * This keeps the part that is about safety — provider secrets and absolute host
 * paths never survive — and drops the part that is about screen space. The
 * bound that belongs on a payload is the byte ceiling its transport already
 * enforces, not a sentence length.
 *
 * Fields extracted from the payload are still `safeText`-ed when they become
 * events or claims, so nothing reaches a human unbounded.
 */
export function redactPayload(input: unknown): string {
  let text = typeof input === 'string' ? input : String(input ?? '');
  for (const re of SECRET_PATTERNS) text = text.replace(re, '[redacted]');
  return stripAbsolutePaths(text);
}
