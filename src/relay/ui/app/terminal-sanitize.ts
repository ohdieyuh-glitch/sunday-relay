/**
 * TERMINAL SANITIZATION — one pure implementation, used on BOTH sides.
 *
 * The relay-bridge sanitizes at capture (before anything is stored or sent)
 * and the Coding Agent terminal sanitizes again at render. Neither side
 * trusts the other, and neither imports Node APIs, so the same rules are
 * testable in jsdom without a provider, a process, or a server.
 *
 * What never survives this module:
 *   - ANSI/OSC escape sequences and C0/C1 control characters
 *   - credential-shaped material (provider keys, bearer tokens, JWTs)
 *   - environment-variable assignments (NAME=value)
 *   - absolute host paths (/home/<user>/…, /tmp/…, /Users/…)
 *   - complete external session identifiers (UUID-shaped) — tail only
 *   - unbounded text (every string and block is length/line bounded)
 *
 * This is a redactor, not an escaper: output is plain text that React renders
 * as text. It never produces markup.
 */

export const TERMINAL_LINE_MAX = 400;
export const TERMINAL_BLOCK_MAX_LINES = 240;
export const TERMINAL_BLOCK_MAX_CHARS = 12_000;

/* eslint-disable no-control-regex */

/* Control-character patterns are built from hex escapes in STRING form so the
   source file itself stays printable ASCII (a raw ESC byte in a source file
   is exactly the kind of thing this module exists to remove). */

/** CSI / OSC / single-character escape sequences (7-bit ESC and 8-bit CSI). */
const ANSI_PATTERN = new RegExp(
  '\\x1B(?:\\[[0-9;?]*[ -\\/]*[@-~]|\\][\\s\\S]*?(?:\\x07|\\x1B\\\\)|[@-Z\\\\-_])' +
    '|\\x9B[0-9;?]*[ -\\/]*[@-~]',
  'g',
);

/** C0 (except tab/newline, collapsed by the caller) and C1 control characters. */
const CONTROL_PATTERN = new RegExp('[\\x00-\\x08\\x0B-\\x1F\\x7F-\\x9F]', 'g');


/* eslint-enable no-control-regex */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style keys
  /\b(?:xox[baprs]|ghp|gho|ghu|ghs|ghr)[-_][A-Za-z0-9-]{10,}/g, // slack / github
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /\b(?:api[_-]?key|secret|token|password|authorization)\b\s*[:=]\s*\S+/gi,
];

/** SCREAMING_SNAKE assignments — an environment variable and its value. */
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]{3,})=(?:"[^"]*"|'[^']*'|\S+)/g;

/** UUID-shaped identifiers (Claude session ids) — never shown in full. */
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const ABSOLUTE_PATH = /(?:\/(?:home|Users|tmp|var|root|private)\/[^\s"'`)\]]+)/g;

export const REDACTED = '[redacted]';

/** Keep only the tail of an external identifier, never the whole value. */
export function redactExternalId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return `…${trimmed.slice(-6)}`;
}

/** Collapse an absolute host path to its basename. */
function collapsePaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (match) => {
    const base = match.split('/').filter(Boolean).pop() ?? '';
    return base ? `…/${base}` : '…';
  });
}

/**
 * Sanitize one display line. Newlines and tabs collapse to single spaces —
 * a "line" is always one line.
 */
export function sanitizeTerminalLine(input: unknown, maxLength = TERMINAL_LINE_MAX): string {
  let text = typeof input === 'string' ? input : String(input ?? '');
  text = text.replace(ANSI_PATTERN, '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, REDACTED);
  text = text.replace(ENV_ASSIGNMENT, (_m, name: string) => `${name}=${REDACTED}`);
  text = text.replace(UUID_PATTERN, (m) => `…${m.slice(-6)}`);
  text = collapsePaths(text);
  // Never surface a raw stack frame.
  text = text.replace(/\n\s*at\s+.+/g, '');
  text = text.replace(CONTROL_PATTERN, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return text;
}

/**
 * Sanitize a multi-line block (a diff, captured test output). Line structure
 * is preserved; the block is bounded by both line count and total characters
 * so a runaway process can never produce unbounded terminal content.
 */
export function sanitizeTerminalBlock(
  input: unknown,
  options: { maxLines?: number; maxChars?: number; maxLineLength?: number } = {},
): string {
  const maxLines = options.maxLines ?? TERMINAL_BLOCK_MAX_LINES;
  const maxChars = options.maxChars ?? TERMINAL_BLOCK_MAX_CHARS;
  const maxLineLength = options.maxLineLength ?? TERMINAL_LINE_MAX;
  const raw = typeof input === 'string' ? input : String(input ?? '');
  if (!raw.trim()) return '';

  const sourceLines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let truncatedLines = false;
  for (const line of sourceLines) {
    if (kept.length >= maxLines) {
      truncatedLines = true;
      break;
    }
    // Preserve a leading diff marker and the indentation that follows it
    // (bounded, tabs → 2 spaces) so a captured diff stays readable. Everything
    // after that prefix is sanitized as a normal single line.
    const match = /^([+\-@ ]?)([ \t]{0,32})([\s\S]*)$/.exec(line);
    const marker = match ? match[1] : '';
    const indent = (match ? match[2] : '').replace(/\t/g, '  ');
    const body = sanitizeTerminalLine(match ? match[3] : line, maxLineLength);
    kept.push(body ? `${marker}${indent}${body}` : marker);
  }
  // Drop trailing blank lines so the block ends cleanly.
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();

  let text = kept.join('\n');
  let truncatedChars = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncatedChars = true;
  }
  if (truncatedLines || truncatedChars) text = `${text}\n[truncated: Relay output limit reached]`;
  return text;
}

/** Sanitize a list of short labels (file names, tool names), dropping empties. */
export function sanitizeTerminalLabels(values: readonly unknown[], maxLength = 160): string[] {
  return values.map((v) => sanitizeTerminalLine(v, maxLength)).filter((v) => v.length > 0);
}
