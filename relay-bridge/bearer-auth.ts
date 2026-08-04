import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * BEARER AUTHENTICATION — ONE IMPLEMENTATION, SHARED BY EVERY SERVER SURFACE.
 *
 * There used to be two. `relay-bridge/reviewer-routes.ts` and
 * `relay-hermes-service/service.ts` each carried their own `bearerMatches`,
 * and the service's docstring claimed it was "matching the bridge's own
 * implementation". It was not:
 *
 *   - the bridge accepted `bearer <secret>` (RFC 6750 says the scheme is
 *     case-insensitive); the service required exactly `Bearer `;
 *   - the bridge accepted any run of whitespace after the scheme, including a
 *     tab; the service required one space;
 *   - the bridge trimmed the CONFIGURED secret; the service did not, so an
 *     environment variable with a trailing newline authenticated on one
 *     surface and not the other.
 *
 * Neither divergence let a wrong secret through — both fail closed, and that
 * is why this was a non-blocking review finding rather than an auth bypass.
 * The defect was the CLAIM: a comment asserting a parity that did not exist is
 * the kind of thing a later change trusts. One module removes the claim by
 * making it true.
 *
 * SERVER-ONLY. `relay-bridge/` is forbidden to browser entries by
 * `src/relay/shared/browser-boundary.test.ts`, so this module — which handles
 * shared secrets and imports `node:crypto` — cannot reach a browser bundle.
 *
 * WHY THE CHOSEN SEMANTICS. RFC 6750 §2.1 defines the scheme as
 * case-insensitive and the syntax as `Bearer` followed by whitespace, so the
 * bridge's parsing was the correct one and the service's was needlessly
 * strict. The configured secret is trimmed because a trailing newline in a
 * platform environment variable is a real operational footgun and trimming it
 * weakens nothing: the comparison is still constant-time against the exact
 * secret, and an attacker gains no ability to authenticate with a value that
 * is not the secret.
 */

/**
 * Extract the credential from an `Authorization` header, or `null`.
 *
 * Returns the raw credential WITHOUT trimming its interior: a token is opaque
 * and Relay does not get to decide that a caller's whitespace is decorative.
 * Trailing whitespace after the credential is not part of the header value
 * per RFC 7230 §3.2.4, so it is stripped.
 */
export function parseBearerCredential(header: string | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^[ \t]*[Bb][Ee][Aa][Rr][Ee][Rr][ \t]+(\S.*?)[ \t]*$/.exec(header);
  return match === null ? null : match[1];
}

/**
 * Constant-time bearer comparison.
 *
 * A plain `===` leaks the shared prefix length through timing. Both sides are
 * hashed to a fixed 32 bytes before comparison, so `timingSafeEqual` never
 * sees a length mismatch — which matters because a length mismatch is itself
 * information, and the previous shape (compare-the-secret-with-itself, then
 * return false) still branched on length.
 *
 * An absent header, a malformed header and a wrong token are refused
 * identically, because distinguishing them is information too.
 */
export function bearerMatches(header: string | undefined, expected: string | undefined): boolean {
  if (typeof expected !== 'string') return false;
  const secret = expected.trim();
  if (secret === '') return false;
  const presented = parseBearerCredential(header) ?? '';
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(presented), digest(secret));
}
