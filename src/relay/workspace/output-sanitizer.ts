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
  // A private key whose END marker never arrived (the process died, the stream was cut): the complete-block pattern above has consumed every
  // finished block, so a header still standing here is UNTERMINATED and everything after it is key material.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g,
  /BEGIN [A-Z ]*PRIVATE KEY/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b(?:api[-_]?key|secret|password|token)\s*[:=]\s*\S{8,}/gi,
];

/**
 * The OPEN TAIL of a stream that stopped before it ended (cap hit, timeout, cancel, kill): a secret that was still being written has no
 * end to match, and its head is below the complete-shape minimums. Applied ONLY to such streams, and only at the very end of the text.
 */
const OPEN_TAIL_PATTERNS: RegExp[] = [
  /(?:sk-|AKIA|gh[pousr]_|xox[baprs]-)[A-Za-z0-9-]*$/,
  /eyJ[A-Za-z0-9_.-]*$/,
  /\b(?:api[-_]?key|secret|password|token)\s*[:=]\s*\S*$/i,
];

export const REDACTION_MARK = '[REDACTED:secret-shape]';
export const TRUNCATION_MARK = '\n[TRUNCATED: output limit reached]';

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
  return { text: `${text.slice(0, end)}${TRUNCATION_MARK}`, truncated: true };
}

/**
 * THE ONE WAY TO STORE CAPTURED OUTPUT: redact the WHOLE captured text first, then bound the redacted result. Bounding first cuts a
 * secret's tail off before any pattern can see its shape, and the surviving head is stored in clear.
 *
 * `open` says the stream stopped before it ended (cap hit, timeout, cancel, kill, signal). An open stream also loses its open tail
 * (see OPEN_TAIL_PATTERNS), as does any stream the byte budget truncated.
 */
export function sanitizeAndBound(
  text: string,
  limitBytes: number,
  options: { open: boolean },
): { text: string; truncated: boolean; redactions: number } {
  const redacted = sanitizeOutput(text);
  let redactions = redacted.redactions;
  const bounded = boundOutput(redacted.text, limitBytes);
  if (!options.open && !bounded.truncated) return { text: bounded.text, truncated: false, redactions };
  const core = bounded.truncated ? bounded.text.slice(0, bounded.text.length - TRUNCATION_MARK.length) : bounded.text;
  let tail = core;
  for (const pattern of OPEN_TAIL_PATTERNS) {
    tail = tail.replace(pattern, () => {
      redactions += 1;
      return REDACTION_MARK;
    });
  }
  return { text: bounded.truncated ? `${tail}${TRUNCATION_MARK}` : tail, truncated: bounded.truncated, redactions };
}
