/**
 * WHAT A CLAUDE CODE RESULT MESSAGE SAYS, IN A CLOSED VOCABULARY.
 *
 * Both Claude Code surfaces — the local CLI stream and the hosted Agent SDK —
 * end a session with one `result` message carrying `subtype`, `is_error` and,
 * on current runtimes, `terminal_reason`. Both used to decide success from
 * `is_error` ALONE: a result whose subtype was `error_max_turns` or
 * `error_during_execution` but whose `is_error` was `false` — or absent — was a
 * completed session, the adapter returned SUCCEEDED, and nothing downstream
 * read the subtype again. An error the runtime named was accepted as work
 * because a second field did not repeat it.
 *
 * A RESULT IS A SUCCESS ONLY WHEN EVERY FIELD SAYS SO:
 *   - the subtype is `success`,
 *   - `is_error` is the boolean `false` — absent is not false,
 *   - and `terminal_reason`, when the runtime reports one, is `completed`.
 *
 * An error subtype is that error whatever `is_error` says. A subtype this
 * vocabulary does not know is refused, not trusted: a newer runtime that
 * invents `error_something` must not be read as done. Absent `terminal_reason`
 * is accepted because older runtimes never send it; a PRESENT reason other than
 * `completed` — `tool_deferred`, `hook_stopped`, `aborted_tools` — is a session
 * that stopped before it finished, and is refused.
 *
 * The vocabularies are the SDK's own (`@anthropic-ai/claude-agent-sdk` 0.3.220,
 * `SDKResultMessage` and `TerminalReason`). Only a member of them ever leaves
 * this module: the runtime's strings are matched, never forwarded.
 */

export const CLAUDE_CODE_RESULT_VOCABULARY_VERSION = 'claude-code-result-class.v1' as const;

export const CLAUDE_CODE_RESULT_SUBTYPES = [
  'success',
  'error_during_execution',
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
] as const;
export type ClaudeCodeResultSubtype = (typeof CLAUDE_CODE_RESULT_SUBTYPES)[number];

export const CLAUDE_CODE_TERMINAL_REASONS = [
  'blocking_limit', 'rapid_refill_breaker', 'prompt_too_long', 'image_error', 'model_error', 'api_error',
  'malformed_tool_use_exhausted', 'aborted_streaming', 'aborted_tools', 'stop_hook_prevented', 'hook_stopped',
  'tool_deferred', 'max_turns', 'background_requested', 'completed', 'budget_exhausted',
  'structured_output_retry_exhausted', 'tool_deferred_unavailable', 'turn_setup_failed',
] as const;
export type ClaudeCodeTerminalReason = (typeof CLAUDE_CODE_TERMINAL_REASONS)[number];

/** A terminal reason the runtime sent that this vocabulary does not know. */
export const UNRECOGNISED_TERMINAL_REASON = 'unrecognised' as const;

export const CLAUDE_CODE_RESULT_CLASSES = [
  /** Every field agrees the session finished its work. The only trusted class. */
  'SUCCESS',
  /** No result message arrived. */
  'NO_RESULT',
  /** The subtype is not one this vocabulary knows. Unknown is refused, never trusted. */
  'UNKNOWN_SUBTYPE',
  /** `success`, with `is_error: true`. */
  'REPORTED_ERROR',
  /** `success`, with `is_error` absent or not a boolean. Absent is not false. */
  'ERROR_FLAG_UNREPORTED',
  /** `success`, with a terminal reason other than `completed`. */
  'TERMINAL_REASON_NOT_COMPLETED',
  /** `error_max_budget_usd`: the runtime stopped at the ceiling it was given. */
  'BUDGET_STOP',
  /** `error_max_turns`. */
  'MAX_TURNS',
  /** `error_during_execution`. */
  'EXECUTION_ERROR',
  /** `error_max_structured_output_retries`. */
  'STRUCTURED_OUTPUT_RETRIES_EXHAUSTED',
] as const;
export type ClaudeCodeResultClass = (typeof CLAUDE_CODE_RESULT_CLASSES)[number];

const SUBTYPES: ReadonlySet<string> = new Set(CLAUDE_CODE_RESULT_SUBTYPES);
const TERMINAL_REASONS: ReadonlySet<string> = new Set(CLAUDE_CODE_TERMINAL_REASONS);

/** `is_error` as the runtime sent it: true, false, or not reported. Never defaulted. */
export const readClaudeCodeErrorFlag = (value: unknown): boolean | null =>
  value === true ? true : value === false ? false : null;

/**
 * `terminal_reason` as a vocabulary member, `unrecognised`, or null when absent.
 * The runtime's own string never passes through unless it is a known member.
 */
export const readClaudeCodeTerminalReason = (value: unknown): ClaudeCodeTerminalReason | typeof UNRECOGNISED_TERMINAL_REASON | null => {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && TERMINAL_REASONS.has(value)
    ? value as ClaudeCodeTerminalReason
    : UNRECOGNISED_TERMINAL_REASON;
};

export interface ClaudeCodeResultFields {
  readonly resultSubtype: string | null;
  readonly isError: boolean | null;
  /** Absent on surfaces or runtimes that never report one. */
  readonly terminalReason?: string | null;
}

/** THE ONE CLASSIFIER. Total: every input maps to exactly one class. */
export function classifyClaudeCodeResult(result: ClaudeCodeResultFields): ClaudeCodeResultClass {
  if (result.resultSubtype === null) return 'NO_RESULT';
  if (!SUBTYPES.has(result.resultSubtype)) return 'UNKNOWN_SUBTYPE';
  switch (result.resultSubtype as ClaudeCodeResultSubtype) {
    // AN ERROR SUBTYPE IS THAT ERROR, whatever `is_error` says beside it.
    case 'error_max_budget_usd': return 'BUDGET_STOP';
    case 'error_max_turns': return 'MAX_TURNS';
    case 'error_during_execution': return 'EXECUTION_ERROR';
    case 'error_max_structured_output_retries': return 'STRUCTURED_OUTPUT_RETRIES_EXHAUSTED';
    case 'success': break;
  }
  if (result.isError === true) return 'REPORTED_ERROR';
  if (result.isError !== false) return 'ERROR_FLAG_UNREPORTED';
  const terminal = result.terminalReason ?? null;
  if (terminal !== null && terminal !== 'completed') return 'TERMINAL_REASON_NOT_COMPLETED';
  return 'SUCCESS';
}

/**
 * A RESULT ARRIVED AND IT IS NOT A SUCCESS. A result arrived when it carried a
 * subtype or an error flag. False when neither was seen: that is a structural
 * fault the surfaces already name separately, and it must not be reported as
 * the runtime having said "error".
 */
export const claudeCodeResultRefused = (result: ClaudeCodeResultFields): boolean =>
  (result.resultSubtype !== null || result.isError !== null) && classifyClaudeCodeResult(result) !== 'SUCCESS';

/** The reason a refused result gives, as a fixed sentence built from vocabulary members only. */
export function claudeCodeResultRefusalReason(result: ClaudeCodeResultFields): string | null {
  const resultClass = classifyClaudeCodeResult(result);
  const subtype = result.resultSubtype !== null && SUBTYPES.has(result.resultSubtype) ? result.resultSubtype : 'an unrecognised subtype';
  switch (resultClass) {
    case 'SUCCESS': return null;
    case 'NO_RESULT': return 'the runtime never reported a final result';
    case 'UNKNOWN_SUBTYPE': return 'the runtime reported a result subtype this vocabulary does not know';
    case 'REPORTED_ERROR': return `the runtime reported ${subtype} with is_error set`;
    case 'ERROR_FLAG_UNREPORTED': return `the runtime reported ${subtype} without saying whether it was an error`;
    case 'TERMINAL_REASON_NOT_COMPLETED': {
      const terminal = readClaudeCodeTerminalReason(result.terminalReason);
      return `the runtime reported ${subtype} but ended with terminal reason ${terminal ?? UNRECOGNISED_TERMINAL_REASON}`;
    }
    default: return `the runtime reported ${subtype}`;
  }
}
