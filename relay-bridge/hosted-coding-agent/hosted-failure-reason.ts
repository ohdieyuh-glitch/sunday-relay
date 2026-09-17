/**
 * WHAT A HOSTED CODER FAILURE WAS, IN A CLOSED VOCABULARY.
 *
 * Paid Mission 5's rerun (run 34504244415) reached the Coding Agent with the
 * plan accepted after three independently reviewed repair rounds and the
 * contract locked at revision 5. The coder then ran six turns of its
 * twenty-six, made five tool calls, changed NOTHING, and stopped with
 * `is_error: true` — for $0.885661. The durable record said
 * `coder_provider_error_after_init` and one fixed sentence, and nothing in any
 * artifact says why. The cause is unrecoverable, exactly as Mission 4 attempt
 * one's `incomplete_details.reason` was before #247.
 *
 * THE FIXED SENTENCE IS NOT AN OVERSIGHT and is not being removed.
 * `hosted-runner.ts` says why: "A provider error can quote the request, which
 * can quote the credential — so only a fixed sentence leaves this function
 * either way." That reasoning is correct and this module does not weaken it.
 *
 * WHAT #247 DID FOR THE ARCHITECT, AND WHY THIS IS NOT THE SAME.
 * `safeReasonToken` PASSES THROUGH a value the provider already gave as an
 * enum (`response.status`, `incomplete_details.reason`), rejecting anything not
 * already token-shaped. The hosted SDK gives no such enum: what it gives is
 * `result`, free prose. Passing that through a shape test would be a
 * credential-exfiltration hazard wearing a regex — a request quoted back could
 * contain a token that happens to look like a token.
 *
 * So this CLASSIFIES rather than forwards. The output is always one of
 * `HOSTED_FAILURE_REASONS` and is never derived from the input's characters:
 * the input is matched, and a constant is returned. Nothing a provider writes
 * can leave through this function, whatever it writes.
 *
 * UNKNOWN STAYS UNKNOWN. Text that matches nothing is `unclassified`, which is
 * a real answer — "the runtime failed and did not say anything we recognise" —
 * and not a guess.
 */

export const HOSTED_FAILURE_REASON_VOCABULARY_VERSION = 'julius-hosted-failure-reason.v1' as const;

export const HOSTED_FAILURE_REASONS = [
  'rate_limited',
  /**
   * The provider account cannot pay for the call. Attempt 5 of the
   * continuous-worker qualification ended on exactly this, and the classifier
   * read it as a bad request because the provider sends it as a 400.
   */
  'credit_unavailable',
  'context_length_exceeded',
  'content_filtered',
  'provider_overloaded',
  'provider_auth_rejected',
  'provider_bad_request',
  'provider_server_error',
  'stream_interrupted',
  'execution_error',
  /** The runtime failed and said nothing this vocabulary recognises. */
  'unclassified',
  /** The runtime said nothing at all. Distinct from saying something unrecognised. */
  'no_message',
] as const;
export type HostedFailureReason = (typeof HOSTED_FAILURE_REASONS)[number];

/**
 * Ordered, because a provider sentence can satisfy more than one pattern and
 * the FIRST match wins deterministically. Specific before general: a 429 that
 * also says "error" is a rate limit, not an execution error.
 */
const PATTERNS: readonly (readonly [RegExp, HostedFailureReason])[] = [
  [/\b429\b|rate[ _-]?limit|too many requests/iu, 'rate_limited'],
  // BEFORE the 400 rule: credit exhaustion arrives as a 400, and it is not a
  // malformed request — retrying it buys nothing until someone pays.
  [/credit balance|insufficient[ _-]?(credit|funds|balance)|billing|payment required|\b402\b|quota (exceeded|exhausted)/iu, 'credit_unavailable'],
  [/context[ _-]?(length|window)|prompt is too long|maximum context|too many tokens/iu, 'context_length_exceeded'],
  [/content[ _-]?(filter|policy)|refus(al|ed) by (the )?(safety|policy)|stop_reason.{0,12}refusal/iu, 'content_filtered'],
  [/\b529\b|overloaded|capacity|try again later/iu, 'provider_overloaded'],
  [/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|authentication/iu, 'provider_auth_rejected'],
  [/\b400\b|invalid[ _-]?request|bad request|validation/iu, 'provider_bad_request'],
  [/\b5\d\d\b|internal (server )?error|upstream|gateway/iu, 'provider_server_error'],
  [/stream|disconnect|aborted|closed|econnreset|socket/iu, 'stream_interrupted'],
  [/error|failed|exception/iu, 'execution_error'],
];

/**
 * CLASSIFY, NEVER FORWARD.
 *
 * Returns a member of `HOSTED_FAILURE_REASONS` for every possible input. The
 * returned value is a literal from this module; no substring of `finalText`
 * can reach the caller, which is what makes it safe to record durably.
 */
export function classifyHostedFailure(finalText: string | null | undefined): HostedFailureReason {
  if (typeof finalText !== 'string' || finalText.trim() === '') return 'no_message';
  for (const [pattern, reason] of PATTERNS) if (pattern.test(finalText)) return reason;
  return 'unclassified';
}
