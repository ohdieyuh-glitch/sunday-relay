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

import { isSubscriptionUsageLimit } from '../../scripts/julius-usage-limit.mjs';

export const HOSTED_FAILURE_REASON_VOCABULARY_VERSION = 'julius-hosted-failure-reason.v1' as const;

export const HOSTED_FAILURE_REASONS = [
  'rate_limited',
  /**
   * The Claude subscription's own usage limit (its 5-hour window, weekly, session or Opus allowance) was reached
   * (audit F5). The sentence is recognised by the SAME function the paid workflow's subscription smoke uses
   * (`scripts/julius-usage-limit.mjs`); it was `unclassified` here while the smoke knew it.
   */
  'usage_limit_reached',
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
 * A RATE LIMIT IS RECOGNISED ONLY FROM A STRUCTURED SIGNAL (bug batch #56).
 *
 * `rate_limited` becomes RATE_LIMIT, and a RATE_LIMIT with `runtimeStarted === false` is the ONE handed failure the
 * coordinator still retries: it is taken as the provider's own proof that nothing ran. Prose cannot carry that proof.
 * The loose rule this replaces (`\b429\b|rate limit|too many requests`) read any sentence that mentioned a 429 as
 * that proof — a tool's output quoted back, a proxy's page, a model's own words.
 *
 * Two signals are structured, and only these:
 *  - the runtime's own classification, the SDK assistant message's `error: 'rate_limit'` (`HostedObservation`'s
 *    `assistantError`). The installed CLI (claude-agent-sdk 0.3.286) writes a 429 as
 *    `API Error: Request rejected (429) · <the body's message>` with `error: "rate_limit"` beside it, so for the
 *    current runtime this field is the signal and the prose is not;
 *  - the Messages API error body's own type, `"type":"rate_limit_error"`, as an APIError message carries it
 *    (`429 {"type":"error","error":{"type":"rate_limit_error",…}}`). The CLI recognises a rate limit by exactly this
 *    substring; whitespace and one level of JSON-string escaping are tolerated.
 *
 * Anything else that mentions a 429 falls through to the table below, to whatever else it says or `unclassified`:
 * never a reason to retry.
 */
const STRUCTURED_RATE_LIMIT_BODY = /\\?"type\\?"\s*:\s*\\?"rate_limit_error\\?"/u;

/** The structured signals the caller may hold beside the text. */
export interface HostedFailureSignals {
  /** The SDK assistant message's `error` field, as `HostedObservation.assistantError` records it. */
  readonly assistantError?: string | null;
}

/**
 * Ordered, because a provider sentence can satisfy more than one pattern and
 * the FIRST match wins deterministically. Specific before general.
 */
const PATTERNS: readonly (readonly [RegExp, HostedFailureReason])[] = [
  [STRUCTURED_RATE_LIMIT_BODY, 'rate_limited'],
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
export function classifyHostedFailure(
  finalText: string | null | undefined,
  signals: HostedFailureSignals = {},
): HostedFailureReason {
  const text = typeof finalText === 'string' && finalText.trim() !== '' ? finalText : null;
  // FIRST, because it is the most specific: a limit sentence may also carry a 429, the word "error", or the runtime's
  // own `rate_limit` (the CLI writes the subscription's limits under that same field).
  if (text !== null && isSubscriptionUsageLimit(text)) return 'usage_limit_reached';
  if (signals.assistantError === 'rate_limit') return 'rate_limited';
  if (text === null) return 'no_message';
  for (const [pattern, reason] of PATTERNS) if (pattern.test(text)) return reason;
  return 'unclassified';
}
