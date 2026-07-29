/**
 * Relay CLI safe rendering boundary (Prompt 8.6). The SINGLE gate every
 * displayed string passes through before it can reach a view model. The
 * terminal must never display: chain-of-thought / hidden reasoning, raw
 * provider streams, system prompts, credentials/tokens/cookies/recovery
 * codes, account emails, provider profile data, raw environment values,
 * internal session identifiers (masked by default), unrestricted
 * stdout/stderr, or terminal-control injection (ANSI/OSC/newline attacks).
 */

/** Secret shapes (mirrors the persistence redactor — kept dependency-free
 * here so the rendering boundary works even on unsanitized fixture text). */
export const SECRET_SHAPE_RE =
  /(sk-[A-Za-z0-9]{8,})|(AKIA[0-9A-Z]{12,})|(-----BEGIN [A-Z ]*PRIVATE KEY)|(gh[pousr]_[A-Za-z0-9]{20,})|(xox[baprs]-[A-Za-z0-9-]{10,})|(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;

export const HIDDEN_REASONING_RE =
  /chain[- ]of[- ]thought|hidden reasoning|<thinking>|internal monologue/i;

/** UUID-shaped identifiers (provider session ids) are masked by default. */
const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/** Email addresses (account information) are masked. */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** ANSI CSI/OSC/DCS escape sequences + raw control characters. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\|\x1b[@-_]/g;
/** C0 control chars (except LF/CR, which the newline fold handles) + DEL +
 * the C1 range 0x80-0x9f. C1 bytes are single-byte CSI/OSC/ST introducers on
 * 8-bit terminals, so they must never survive the boundary either. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g;
/** Every line-separating code point — LF, bare CR (cursor-return spoofing),
 * NEL, and the Unicode line/paragraph separators — is folded to one line. */
const NEWLINE_RE = /[\r\n\u0085\u2028\u2029]+/g;

export interface SafeTextOptions {
  maxLength?: number;
  /** Collapse newlines into ' · ' (default) or keep as single spaces. */
  allowNewlines?: boolean;
}

/** Sanitize ANY inbound text before it may enter a view model. */
export function safeText(input: unknown, options: SafeTextOptions = {}): string {
  const maxLength = options.maxLength ?? 200;
  let text = typeof input === 'string' ? input : input === null || input === undefined ? '' : String(input);
  text = text.replace(ANSI_RE, '');
  text = text.replace(CONTROL_RE, ' ');
  // Newline injection is bounded: fold every line separator (LF, bare CR,
  // NEL, LS/PS) into one line so cursor-return spoofing cannot survive.
  text = text.replace(NEWLINE_RE, options.allowNewlines ? ' ' : ' · ').replace(/\s{2,}/g, ' ').trim();
  SECRET_SHAPE_RE.lastIndex = 0;
  text = text.replace(SECRET_SHAPE_RE, '[REDACTED]');
  text = text.replace(UUID_RE, '[session-ref]');
  text = text.replace(EMAIL_RE, '[masked-email]');
  if (HIDDEN_REASONING_RE.test(text)) text = '[REDACTED: hidden-reasoning-shaped content]';
  if (text.length > maxLength) text = `${text.slice(0, Math.max(1, maxLength - 1))}…`;
  return text;
}

/** Reject raw provider stream shapes outright — a payload that looks like a
 * provider NDJSON/stream frame is never rendered, even sanitized. */
export function looksLikeProviderStream(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  return /"type"\s*:\s*"(assistant|system|result|item\.completed|session\.created|turn\.completed)"/.test(input)
    || /^data:\s*\{/m.test(input);
}

/** Path display: shorten with an explicit middle ellipsis, never truncate
 * silently; strips control/ANSI first. */
export function safePath(input: unknown, maxLength = 48): string {
  const text = safeText(input, { maxLength: 4096 });
  if (text.length <= maxLength) return text;
  const keep = maxLength - 1;
  const head = Math.ceil(keep * 0.45);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Guard for view-model assembly: returns the sanitized string or a safe
 * placeholder when the input is a rejected provider stream. */
export function safeSummary(input: unknown, maxLength = 160): string {
  if (looksLikeProviderStream(input)) return '[unavailable: raw provider stream is never rendered]';
  return safeText(input, { maxLength });
}
