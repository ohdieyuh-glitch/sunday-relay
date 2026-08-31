/**
 * DEFENCE IN DEPTH FOR THE LIVE TERMINAL.
 *
 * Julius events are EXPECTED to be safe — every field is named `safeSummary`
 * for a reason, and Julius sanitizes its own context packets. This module
 * assumes none of that. A terminal is the one surface where a leak is visible
 * to a user, shareable as a screenshot, and permanent; "the layer below should
 * have handled it" is not a property anything checks at runtime.
 *
 * IT EXTENDS RELAY'S ONE RULE RATHER THAN REPLACING IT. `redactTerminalText`
 * in `mission/terminal.ts` is the existing repository-wide redactor and it
 * runs FIRST, so the terminal cannot become a second, weaker rule that drifts
 * below the original. What is added here is the set a BOUNDARY sees that a
 * ledger event does not: transport authorization headers, provider session
 * identifiers, and connection strings.
 *
 * PRIVATE REASONING IS DROPPED, NOT REDACTED. A redacted chain of thought is
 * still a record that one existed and still carries its own shape. The
 * projection replaces the whole text, and nothing stores the original.
 *
 * PURE. No Node, no network, no clock.
 */

import { redactTerminalText } from '../../mission/terminal';

/**
 * WHAT A BOUNDARY SEES THAT A LEDGER EVENT DOES NOT.
 *
 * Each pattern is here because a Julius event could plausibly carry it: a
 * dispatch error quoting the request that failed, a provider adapter echoing
 * its own configuration, a recovery record naming the session it resumed.
 */
const BOUNDARY_SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /** An Authorization header, with any scheme and any value. */
  /\bauthorization\s*[:=]\s*\S+/gi,
  /** A bearer or basic credential quoted without the header name. */
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /** A provider or transport session identifier. */
  /\b(?:sess|session|sid|conv|thread|req)[_-][A-Za-z0-9]{12,}/gi,
  /** A connection string with inline credentials. */
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/gi,
  /** A private key body, however it was fenced. */
  /-{2,}\s*BEGIN[A-Z ]*(?:PRIVATE KEY|CERTIFICATE)/gi,
  /** An AWS-style secret access key assignment. */
  /\b(?:aws_)?secret_access_key\s*[:=]\s*\S+/gi,
  /** A credential-shaped environment assignment the base rule does not name. */
  /\b[A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIAL|_CREDENTIALS)\s*=\s*\S+/g,
]);

/**
 * A FACT KEY THAT COULD ONLY HOLD A SECRET.
 *
 * A fact named `apiKey` is dropped rather than redacted: there is no version
 * of that key/value pair a terminal should render, and rendering
 * `apiKey: [redacted]` still tells a reader the run had one and invites the
 * next change to "just show the last four".
 */
const SECRET_FACT_KEY = /(?:^|[^a-z])(?:key|token|secret|password|passwd|credential|credentials|cookie|authorization|auth|session|sessionid|bearer|signature|nonce)(?:$|[^a-z])/i;

export function factKeyIsSecretShaped(key: string): boolean {
  // The regex reads word-ish components, so `apiKey`, `api_key`, `API-KEY` and
  // `sessionId` all match while `keyboard`, `monkey` and `tokenizer` do not.
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return SECRET_FACT_KEY.test(` ${spaced} `);
}

/**
 * MARKERS OF PRIVATE REASONING.
 *
 * A SUPERSET of `mission/terminal.ts`'s set, deliberately: the boundary is
 * defence in depth and must never be the weaker of the two.
 * `julius-terminal-projection.test.ts` holds this against the mission
 * terminal's own behaviour over a shared corpus, so the superset claim is
 * checked rather than asserted in prose.
 */
const PRIVATE_REASONING = /\b(chain[_ -]?of[_ -]?thought|thinking|thought[_ -]?process|internal[_ -]?monologue|scratchpad|hidden[_ -]?reasoning|reasoning[_ -]?trace|system[_ -]?prompt|developer[_ -]?message|<thinking>|deliberation)\b/i;

export function containsPrivateReasoning(text: string): boolean {
  return PRIVATE_REASONING.test(text);
}

/** A raw exception dump — a stack frame, or a nested error chain. */
const STACK_TRACE = /(?:\n\s+at\s+\S|\bat\s+\S+\s+\([^)]*:\d+:\d+\)|Error:\s.*\n\s+at\s)/;

export function containsStackTrace(text: string): boolean {
  return STACK_TRACE.test(text);
}

export interface BoundaryRedaction {
  readonly text: string;
  readonly redactions: number;
}

/**
 * Redact a string for the Live Terminal: Relay's existing rule first, then the
 * boundary set. Counts are cumulative so a surface can show that something was
 * removed without showing what.
 */
export function redactBoundaryText(text: string): BoundaryRedaction {
  const base = redactTerminalText(text);
  let redactions = base.redactions;
  let out = base.text;
  for (const pattern of BOUNDARY_SECRET_PATTERNS) {
    out = out.replace(pattern, () => { redactions += 1; return '[redacted]'; });
  }
  return { text: out, redactions };
}
