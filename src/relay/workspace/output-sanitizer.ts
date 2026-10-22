/**
 * Output sanitization (Prompt 7) — PURE. Captured process output is bounded
 * by the runner; this module redacts secret-shaped substrings before
 * anything is stored in results, evidence, events, or shown to a user.
 * Patterns intentionally align with the demo verifiers' secret scanners.
 */

const PRIVATE_KEY_BLOCK = /-{0,5} ?BEGIN [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)? ?-{4,5}[\s\S]*?----(?:-)? ?END [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)? ?-{4,5}/g;
// A header can only start a block when a footer exists after it. `sanitizeOutput` applies the block pattern to the text up to the LAST footer, so a stream of headers with no footer after them is not rescanned once per header (hostile worker output, review S-1).
const PRIVATE_KEY_FOOTER = /----(?:-)? ?END [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)? ?-{4,5}/g;

const SECRET_OUTPUT_PATTERNS: RegExp[] = [
  // Vendor keys: legacy `sk-<alphanumerics>` AND the current OpenAI `sk-proj-` / `sk-svcacct-` / `sk-admin-` and Anthropic `sk-ant-api03-` shapes, which carry hyphens and underscores in the body.
  // The legacy pattern below is unchanged. The new one is limited to the four known prefixes so ordinary hyphenated words (task-force-2024-q3, ask-me-later) are not redacted.
  /sk-(?:proj|svcacct|admin|ant)-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{8,}/g,
  // Other vendor shapes with a word in the prefix: Stripe `sk_live_` / `rk_test_`, `sk-live-`, OpenRouter `sk-or-v1-<hex>`. Anchored at a word start so `ask-me-later`, `risk-free` are untouched.
  /\b(?:sk|rk)[-_](?:live|test|or-v1|or)[-_][A-Za-z0-9_-]{8,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  // Private-key blocks: PEM (five dashes), PGP (`PRIVATE KEY BLOCK`) and SSH2 (four dashes, a digit in the label). The label class admits digits. The header's LEADING dashes are optional (0-5): when one block's footer is
  // glued to the next block's header (`-----END RSA PRIVATE KEY--------BEGIN ...`) the footer takes its five dashes and the next header keeps only what is left, possibly none. The footer fence stays 4-5 dashes.
  // Linear-time shape: the label is bounded (real labels are `RSA`, `EC`, `OPENSSH`, `ENCRYPTED`, ...) and the body stops at the next `BEGIN ` so a stream of unterminated headers is scanned once, not once per header.
  PRIVATE_KEY_BLOCK,
  /BEGIN [A-Z0-9 ]{0,30}PRIVATE KEY/g,
  // GitHub tokens. The body class admits `_` so two tokens glued together (`gho_..ghs_..`) are one match, not a match and a tail; `github_pat_<id>_<body>` is the fine-grained shape.
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  // `name: value` / `name=value`; also a JSON-quoted name (`"token": "..."`), an env-style name (`OPENAI_API_KEY=`, no word boundary before API), `secret_key` / `aws_secret_access_key`, `passwd`,
  // a quoted value that contains spaces, and JSON inside a JSON string (`{\"password\":\"...\"}`: any run of backslashes before a quote).
  /(?:api[-_]?key|private[-_]?key|secret(?:[-_](?:access[-_])?key)?|passw(?:or)?d|token)\\*["']?\s*[:=]\s*(?:\\*"[^"\n]{8,}"|\\*'[^'\n]{8,}'|\S{8,})/gi,
];

export const REDACTION_MARK = '[REDACTED:secret-shape]';

export function sanitizeOutput(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let sanitized = text;
  for (const pattern of SECRET_OUTPUT_PATTERNS) {
    let head = sanitized;
    let tail = '';
    if (pattern === PRIVATE_KEY_BLOCK) {
      let footerEnd = 0;
      for (const footer of sanitized.matchAll(PRIVATE_KEY_FOOTER)) footerEnd = footer.index + footer[0].length;
      head = sanitized.slice(0, footerEnd);
      tail = sanitized.slice(footerEnd);
    }
    sanitized = head.replace(pattern, () => {
      redactions += 1;
      return REDACTION_MARK;
    }) + tail;
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
