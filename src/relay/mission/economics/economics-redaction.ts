/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Economics metadata redaction (PURE, self-contained, SHARED verbatim).
 *
 * This module is deliberately dependency-free so the economics domain can be
 * carried byte-identically by the website AND the CLI. It is NOT a weaker
 * redactor: it applies the same secret-key and secret-value rules as the
 * Milestone 2 command redactor, deeply, without mutating its input.
 *
 * Cost metadata is the highest-risk metadata in Relay — it is the place a raw
 * provider invoice, an authorization header, or a billing credential would
 * most plausibly arrive. Nothing credential-shaped is ever stored.
 */

/** Key NAMES whose value is replaced wholesale, whatever it contains. */
const SECRET_KEY_PATTERN =
  /(?:secret|token|password|credential|api[-_]?key|private[-_]?key|cookie|authorization|bearer|card|iban|account[-_]?number|routing[-_]?number)/iu;

/** Secret-SHAPED values, replaced even under an innocent key name. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/gu,
  /\bAKIA[0-9A-Z]{12,}/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/gu,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/giu,
  /\b(?:api[-_]?key|secret|password|token|cookie)\s*[:=]\s*\S{6,}/giu,
  // Long digit runs that look like a payment instrument.
  /\b(?:\d[ -]?){13,19}\b/gu,
];

const REDACTED = '[redacted]';

export function redactEconomicsText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Deep, non-mutating redaction. Key names that look like credentials are
 * replaced wholesale; every remaining string value is scrubbed for
 * secret-shaped content.
 */
export function redactEconomicsMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactEconomicsText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(inner);
      }
      return out;
    }
    return value;
  };
  return redactValue(metadata) as Record<string, unknown>;
}

/** True when redaction would change the input — i.e. it carried secrets. */
export function economicsMetadataContainsSecrets(metadata: Record<string, unknown>): boolean {
  return JSON.stringify(redactEconomicsMetadata(metadata)) !== JSON.stringify(metadata);
}
