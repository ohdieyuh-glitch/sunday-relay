/**
 * Output sanitization (Prompt 7) — PURE. Captured process output is bounded
 * by the runner; this module redacts secret-shaped substrings before
 * anything is stored in results, evidence, events, or shown to a user.
 * Patterns intentionally align with the demo verifiers' secret scanners.
 */

const SECRET_OUTPUT_PATTERNS: RegExp[] = [
  // Vendor keys: legacy `sk-<alphanumerics>` AND the current OpenAI `sk-proj-` / `sk-svcacct-` / `sk-admin-` and Anthropic `sk-ant-api03-` shapes, which carry hyphens and underscores in the body.
  // The legacy pattern below is unchanged. The new one is limited to the four known prefixes so ordinary hyphenated words (task-force-2024-q3, ask-me-later) are not redacted.
  /sk-(?:proj|svcacct|admin|ant)-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{8,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /BEGIN [A-Z ]*PRIVATE KEY/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  // No leading word boundary: a word character glued to the key (`xpassword=`) is still an assignment.
  // The separator keeps ordinary words (`passwordless`, `tokenizer`, `apikey_docs`). The value stays 8 or more non-whitespace characters.
  /(?:api[-_]?key|secret|password|token)\s*[:=]\s*\S{8,}/gi,
];

export const REDACTION_MARK = '[REDACTED:secret-shape]';

export function sanitizeOutput(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let sanitized = text;
  for (const pattern of SECRET_OUTPUT_PATTERNS) {
    sanitized = sanitized.replace(pattern, () => {
      redactions += 1;
      return REDACTION_MARK;
    });
  }
  return { text: sanitized, redactions };
}

/** Bound a captured stream to an exact UTF-8 byte budget, never splitting a character. */
export function boundOutput(text: string, limitBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= limitBytes) return { text, truncated: false };
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limitBytes) break;
    bytes += size;
    end += ch.length;
  }
  return { text: `${text.slice(0, end)}\n[TRUNCATED: output limit reached]`, truncated: true };
}
