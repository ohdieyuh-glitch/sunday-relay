/**
 * CREDENTIAL-SHAPED CONTENT, FOR THE PROJECT BRAIN AND THE PYTHON TOOL.
 *
 * Two different jobs share one vocabulary here, and they must not be confused:
 *
 *   DETECT  — a Brain write refuses content that looks like a credential. The
 *             Brain never redacts on write: a record whose text was silently
 *             rewritten on the way in is a record nobody can audit, and its
 *             content hash would describe something the author never said.
 *
 *   REDACT  — Python stdout, stderr, tracebacks and exports are DIAGNOSTIC
 *             text that arrives from outside Julius's control. Those are
 *             redacted, and the number of redactions is always reported.
 *
 * Exact secret VALUES (a capability-scoped secret the Python tool injected)
 * are matched literally in addition to the shapes, because a granted secret
 * need not look like any known credential format.
 *
 * `sk-` IS ANCHORED. An unanchored `sk-` matches inside `task-…`, and every
 * Julius task id would be reported as an OpenAI key.
 */

const SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = Object.freeze([
  { name: 'provider-key', pattern: /(?<![A-Za-z0-9_-])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g },
  { name: 'aws-access-key', pattern: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g },
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)?/g },
  { name: 'github-token', pattern: /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: 'slack-token', pattern: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'jwt', pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { name: 'url-credentials', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi },
  { name: 'assignment', pattern: /\b(?:api[_-]?key|secret|password|passwd|authorization|access[_-]?token|auth[_-]?token|token)\s*[:=]\s*["']?[^\s"',;]{8,}/gi },
]);

export const JULIUS_BRAIN_REDACTION_MARK = '[REDACTED]';

/** The smallest literal secret worth matching; shorter values cause false hits. */
const MINIMUM_LITERAL = 6;

export interface JuliusSecretScan {
  /** Shape names (never the matched text) in first-seen order. */
  readonly shapes: readonly string[];
  readonly literalMatches: number;
}

const escapeLiteral = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const literalPatterns = (literals: readonly string[]): RegExp[] =>
  [...new Set(literals.filter((value) => value.length >= MINIMUM_LITERAL))]
    // Longest first, so a secret that contains another is replaced whole.
    .sort((a, b) => b.length - a.length)
    .map((value) => new RegExp(escapeLiteral(value), 'g'));

/** Which credential shapes (and how many exact secret values) appear in `text`. */
export function scanJuliusSecrets(text: string, literals: readonly string[] = []): JuliusSecretScan {
  const shapes: string[] = [];
  for (const { name, pattern } of SHAPES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) shapes.push(name);
    pattern.lastIndex = 0;
  }
  let literalMatches = 0;
  for (const pattern of literalPatterns(literals)) literalMatches += text.match(pattern)?.length ?? 0;
  return { shapes, literalMatches };
}

export function containsJuliusSecret(text: string, literals: readonly string[] = []): boolean {
  const scan = scanJuliusSecrets(text, literals);
  return scan.shapes.length > 0 || scan.literalMatches > 0;
}

/**
 * Redact literals first (they are exact), then shapes. Returns the count so a
 * caller can never present redacted text as if it were the original.
 */
export function redactJuliusSecrets(text: string, literals: readonly string[] = []): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const pattern of literalPatterns(literals)) {
    out = out.replace(pattern, () => { redactions += 1; return JULIUS_BRAIN_REDACTION_MARK; });
  }
  for (const { pattern } of SHAPES) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, () => { redactions += 1; return JULIUS_BRAIN_REDACTION_MARK; });
  }
  return { text: out, redactions };
}

/** Every string reachable inside a JSON-shaped value, for scanning. */
export function juliusStringsOf(value: unknown, sink: string[] = []): string[] {
  if (typeof value === 'string') sink.push(value);
  else if (Array.isArray(value)) for (const item of value) juliusStringsOf(item, sink);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { sink.push(key); juliusStringsOf(item, sink); }
  }
  return sink;
}

/** Deep redaction of a JSON-shaped value. Keys are redacted too. */
export function redactJuliusSecretsDeep<T>(value: T, literals: readonly string[] = []): { value: T; redactions: number } {
  let redactions = 0;
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      const result = redactJuliusSecrets(item, literals);
      redactions += result.redactions;
      return result.text;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, inner]) => [walk(key) as string, walk(inner)]));
    }
    return item;
  };
  return { value: walk(value) as T, redactions };
}
