/**
 * ONE PATH-SEGMENT DECODER, SHARED BY EVERY SERVER SURFACE.
 *
 * `decodeURIComponent` THROWS a `URIError` on a malformed escape — `%ZZ`, a
 * lone `%`, an orphan surrogate. Every route that captures an id out of a path
 * used to call it bare, so the throw escaped the handler and landed in a
 * generic catch that answered **500 internal error**. A client sending `%ZZ`
 * made a client error; reporting it as a server fault tells an operator the
 * service is broken when nothing about it is, and it is the exact inversion of
 * the discipline these files apply everywhere else: a refusal is a decision,
 * not an outage.
 *
 * The first independent review caught this on the Hermes service and it was
 * repaired there. It was NOT repaired on the bridge, where the same bare call
 * appeared four more times under a catch that whitelists two message strings
 * and maps everything else to 500. Fixing one copy of a defect and leaving four
 * is how the defect comes back, so the decoder lives in one place now.
 *
 * `null` means "this segment names no resource" — undecodable, empty, or
 * whitespace-only. Callers answer 404 or 422; none of them answers 500.
 */
export function decodeSegment(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.trim() === '' ? null : decoded;
  } catch {
    return null;
  }
}
