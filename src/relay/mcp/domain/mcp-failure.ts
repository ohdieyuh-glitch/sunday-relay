/**
 * MCP FAILURE TAXONOMY (PURE).
 *
 * The single most load-bearing rule in this file is that these categories are
 * DISTINCT and must stay distinct:
 *
 *   protocol_mismatch     the server spoke, and spoke a version Relay refuses
 *   malformed_response    the server spoke, and what it said was not MCP
 *   server_unreachable    nothing answered
 *   timed_out             something answered too slowly, or not at all, in time
 *   authentication_failed the transport authenticated and was refused
 *
 * Collapsing any pair of them produces a specific, known operational failure.
 * "Connection failed" cannot tell an operator whether to fix a token, a
 * firewall rule, or a version pin, and a mission preflight that reports it has
 * told the founder nothing actionable. §7 and §19 of the MCP Foundation
 * directive require the distinction; every transport in `../transports`
 * classifies into exactly one of these, and `mcp-failure.test.ts` proves the
 * classifier never returns a generic category for a specific cause.
 *
 * A failure is a VALUE, never a thrown error — the same convention as
 * `RelayResult` in `src/relay/protocol/errors.ts`. Transports catch at their
 * own edge and return a classified failure, so no MCP fault can escape as an
 * exception carrying an un-redacted message.
 */

export const MCP_FAILURE_CATEGORIES = [
  /* transport / reachability */
  'server_unreachable',
  'connection_refused',
  'dns_resolution_failed',
  'network_policy_blocked',
  'tls_failed',
  'timed_out',
  'cancelled',

  /* process (stdio) */
  'executable_not_allowed',
  'argument_not_allowed',
  'environment_not_allowed',
  'process_spawn_failed',
  'process_crashed',
  'process_exited_early',
  'non_mcp_stdout',

  /* protocol */
  'protocol_mismatch',
  'malformed_response',
  'response_too_large',
  'unsupported_transport',
  'initialize_failed',

  /* authorization */
  'authentication_failed',
  'authorization_required',
  'authorization_expired',
  'insufficient_scope',
  'credential_missing',
  'credential_revoked',

  /* policy */
  'permission_denied',
  'approval_required',
  'approval_expired',
  'approval_exhausted',
  'capability_missing',
  'capability_changed',
  'registry_untrusted',
  'risk_unknown',

  /* invocation */
  'tool_execution_error',
  'result_rejected',
  'internal_error',
] as const;

export type McpFailureCategory = (typeof MCP_FAILURE_CATEGORIES)[number];

/**
 * Categories that must NEVER be reachable from a successful invocation. The
 * gateway asserts this rather than trusting call sites: §24 requires that a
 * timeout, a cancellation and a process crash can never be recorded as
 * completion, and the cheapest way to guarantee that is to make "completed"
 * and "has a failure category" mutually exclusive by construction.
 */
export const MCP_NEVER_SUCCESS_CATEGORIES: readonly McpFailureCategory[] = Object.freeze([
  'timed_out',
  'cancelled',
  'process_crashed',
  'process_exited_early',
  'malformed_response',
  'protocol_mismatch',
  'response_too_large',
  'non_mcp_stdout',
  'authentication_failed',
  'permission_denied',
  'approval_required',
]);

export interface McpFailure {
  readonly category: McpFailureCategory;
  /**
   * A SAFE, operator-facing message. Never a raw upstream body, never a
   * credential, never a local executable path, never a child environment.
   * `mcp-redaction.ts` is applied before anything reaches this field.
   */
  readonly message: string;
  /** Whether retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;
  /** Safe structured detail: field paths, limits, states — never content. */
  readonly details?: readonly string[];
}

export function mcpFailure(
  category: McpFailureCategory,
  message: string,
  extra: { retryable?: boolean; details?: readonly string[] } = {},
): McpFailure {
  return {
    category,
    message,
    retryable: extra.retryable ?? DEFAULT_RETRYABLE.has(category),
    ...(extra.details ? { details: extra.details } : {}),
  };
}

/**
 * Whether a category is retryable BY DEFAULT. A policy refusal is never
 * retryable — retrying a `permission_denied` is how a client turns a decision
 * into a rate-limit problem — and neither is a protocol mismatch, which cannot
 * change without a configuration change.
 */
const DEFAULT_RETRYABLE = new Set<McpFailureCategory>([
  'server_unreachable',
  'connection_refused',
  'dns_resolution_failed',
  'tls_failed',
  'timed_out',
  'process_spawn_failed',
  'internal_error',
]);

export type McpOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: McpFailure };

export const mcpOk = <T>(value: T): McpOutcome<T> => ({ ok: true, value });
export const mcpFail = <T = never>(failure: McpFailure): McpOutcome<T> => ({ ok: false, failure });

/** True when the category forbids ever recording the invocation as completed. */
export const forbidsSuccess = (category: McpFailureCategory): boolean =>
  MCP_NEVER_SUCCESS_CATEGORIES.includes(category);

/**
 * A failure the reporter knows is a CONSEQUENCE of something not yet observed.
 *
 * The transport notices a broken pipe before the process object reports why the
 * pipe broke, so its failure is real but provisional: whatever the exit says
 * next — a signal, an exit code — describes the same event better.
 */
export const CONSEQUENTIAL_DETAIL = 'consequence: observed by the writer before the process reported';

/**
 * Which of two fatal conditions describes what actually happened.
 *
 * FIRST WINS, because a crash followed by a pipe error should report the
 * crash — the cause, not its consequence. First-wins ALONE stopped delivering
 * that rule once the transport began reporting broken pipes: a server dying
 * mid-write emits the pipe error BEFORE `exit` — measured 5 of 5 — so the
 * consequence latched first and whatever the exit knew was discarded.
 *
 * So a failure MARKED as a consequence yields to the next observation. The rule
 * is general on purpose: an earlier version replaced only a `process_crashed`,
 * which recovered the signal and still lost the exit CODE of a server that died
 * without one — fixing the instance and leaving the class.
 */
export function preferredFailure(
  current: McpFailure | null, next: McpFailure,
): McpFailure {
  if (current === null) return next;
  if (current.details?.includes(CONSEQUENTIAL_DETAIL) === true) return next;
  return current;
}
