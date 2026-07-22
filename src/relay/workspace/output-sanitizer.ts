/**
 * Output sanitization (Prompt 7) — PURE. Captured process output is bounded
 * by the runner; this module redacts secret-shaped substrings before
 * anything is stored in results, evidence, events, or shown to a user.
 * Patterns intentionally align with the demo verifiers' secret scanners.
 */

const SECRET_OUTPUT_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{8,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /BEGIN [A-Z ]*PRIVATE KEY/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b(?:api[-_]?key|secret|password|token)\s*[:=]\s*\S{8,}/gi,
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

/** Bound a captured stream to a byte budget (UTF-8), marking truncation. */
export function boundOutput(text: string, limitBytes: number): { text: string; truncated: boolean } {
  let bytes = 0;
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    bytes += text.charCodeAt(i) < 0x80 ? 1 : 3; // conservative UTF-8 estimate
    if (bytes > limitBytes) {
      end = i;
      break;
    }
  }
  if (end >= text.length) return { text, truncated: false };
  return { text: `${text.slice(0, end)}\n[TRUNCATED: output limit reached]`, truncated: true };
}
