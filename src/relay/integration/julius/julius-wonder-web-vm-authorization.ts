/**
 * PER-CARD AUTHORIZATION FOR A WONDER WEB VM.
 *
 * Keys are the agent id BRIDGE's registry issued and the `vmSessionId`
 * BRIDGE's session service issued. A display name, an accent token, and a
 * caller-supplied user id are not inputs to these decisions.
 *
 * Wonder Web's creation check compares two caller-supplied user id strings
 * (`authorizeWonderWebRun`). These functions do not.
 */

import type { JuliusTaskState } from '../../mission/julius/julius-runtime';

const CALLER_AGENT_FIELDS = ['agentId', 'vmNumber'] as const;
const CALLER_USER_FIELDS = ['userId', 'ownerUserId', 'requesterUserId'] as const;

const PROVIDER_LABELS = new Set([
  'browserbase',
  'e2b',
  'playwright',
  'vercel sandbox',
  'computer use',
  'computer-use',
  'wonder web',
  'wonder web vm',
]);

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const JULIUS_VM_WORKING_TASK_STATES: readonly JuliusTaskState[] = ['BLOCKED', 'RUNNABLE', 'ACTIVE'];
export const JULIUS_VM_CARD_END_STATES: readonly JuliusTaskState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

/**
 * A field the caller put on the request. Julius resolves the agent id from
 * the registry result it stored. A caller-supplied id is refused even when
 * the characters match the issued one.
 */
export function callerSuppliedIdentityField(input: object): 'forged_agent_id' | 'caller_supplied_user_id' | null {
  for (const field of CALLER_AGENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) return 'forged_agent_id';
  }
  for (const field of CALLER_USER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) return 'caller_supplied_user_id';
  }
  return null;
}

/** A Project Brain loadout id is not a Julius working card. */
export function workingCardIdProblem(taskId: string): 'task_not_issued' | 'loadout_is_not_a_working_card' | null {
  if (taskId.trim() === '' || taskId !== taskId.trim()) return 'task_not_issued';
  if (taskId.startsWith('pbcard:')) return 'loadout_is_not_a_working_card';
  return null;
}

/**
 * The name Julius may send to BRIDGE's registry.
 *
 * Trim with `String.prototype.trim` first. The registry accepts that string
 * only when it is non-empty, at most 64 Unicode code points, and free of
 * C0 (U+0000–U+001F), U+007F, C1 (U+0080–U+009F), U+2028, U+2029, and lone
 * surrogates. Code points are counted, not UTF-16 units. Anything else is
 * omitted, and the card still gets its VM. The trimmed label is sent as-is.
 * It is never truncated and never replaced. A provider label is never sent.
 */
export function registrationDisplayName(label: string | null | undefined): {
  readonly agentDisplayName: string | undefined;
  readonly note: string | null;
} {
  if (label == null) return { agentDisplayName: undefined, note: 'label_omitted:missing' };
  const trimmed = label.trim();
  if (trimmed === '') return { agentDisplayName: undefined, note: 'label_omitted:blank' };
  if (hasRejectedNameCharacter(trimmed)) return { agentDisplayName: undefined, note: 'label_omitted:control_character' };
  if (codePointLength(trimmed) > 64) return { agentDisplayName: undefined, note: 'label_omitted:too_long' };
  if (PROVIDER_LABELS.has(trimmed.toLowerCase())) return { agentDisplayName: undefined, note: 'label_omitted:provider_label' };
  return { agentDisplayName: trimmed, note: null };
}

/** C0, DEL, C1, line and paragraph separators. Lone surrogates are separate. */
const REJECTED_NAME_CHARS = /[\u0000-\u001F\u007F\u0080-\u009F\u2028\u2029]/;

function hasRejectedNameCharacter(value: string): boolean {
  if (REJECTED_NAME_CHARS.test(value)) return true;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit < 0xD800 || unit > 0xDFFF) continue;
    const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
    if (unit <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      i += 1;
      continue;
    }
    return true;
  }
  return false;
}

/** Unicode code points, matching `for...of` on a string. Not UTF-16 units. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function spendAmountProblem(usdMicros: number): 'spend_amount_invalid' | null {
  if (typeof usdMicros !== 'number' || !Number.isSafeInteger(usdMicros) || usdMicros <= 0) return 'spend_amount_invalid';
  return null;
}

/**
 * `maxLifetimeMs` is injected. The number comes from BRIDGE's wonder-web-vm
 * session-layer constant once that module lands. This package does not import
 * that module and does not keep a number of its own. Missing, non-finite, and
 * non-positive values refuse the open.
 */
export function maxLifetimeProblem(maxLifetimeMs: unknown): 'max_lifetime_unconfigured' | null {
  if (typeof maxLifetimeMs !== 'number' || !Number.isFinite(maxLifetimeMs) || maxLifetimeMs <= 0) {
    return 'max_lifetime_unconfigured';
  }
  return null;
}

/**
 * `hard_ttl_beyond_maximum` when `hardTtlAt` is strictly after `now` plus the
 * injected span. An unreadable timestamp is not treated as inside the span.
 */
export function hardTtlProblem(
  now: string,
  hardTtlAt: string,
  maxLifetimeMs: number,
): 'hard_ttl_unreadable' | 'hard_ttl_beyond_maximum' | null {
  if (maxLifetimeProblem(maxLifetimeMs)) return 'hard_ttl_unreadable';
  if (!UTC_ISO.test(now) || !UTC_ISO.test(hardTtlAt)) return 'hard_ttl_unreadable';
  const nowMs = Date.parse(now);
  const hardMs = Date.parse(hardTtlAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(hardMs)) return 'hard_ttl_unreadable';
  if (hardMs > nowMs + maxLifetimeMs) return 'hard_ttl_beyond_maximum';
  return null;
}

/**
 * Ownership. Both arguments are agent ids Julius stored from the registry
 * and from the session port. Same label and same accent are not represented
 * here, so they cannot authorize.
 */
export function sessionOwnedByAgent(input: { readonly issuedAgentId: string; readonly sessionAgentId: string }): boolean {
  return input.issuedAgentId !== '' && input.issuedAgentId === input.sessionAgentId;
}

export function navigationTarget(url: string): { readonly ok: true; readonly host: string } | { readonly ok: false; readonly reasonCode: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reasonCode: 'navigation_url_invalid' };
  }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reasonCode: 'navigation_credential_denied' };
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, reasonCode: 'navigation_scheme_denied' };
  if (parsed.hostname === '') return { ok: false, reasonCode: 'navigation_host_invalid' };
  return { ok: true, host: parsed.hostname.toLowerCase() };
}

/** Exact host. An entry of `*` or `*.example.com` matches only that literal string. */
export function hostOnAllowlist(host: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(host);
}

/**
 * `null` means the timestamps are not both UTC ISO-8601, which is unknown,
 * not "still inside the TTL".
 */
export function utcDeadlineReached(now: string, deadline: string): boolean | null {
  if (!UTC_ISO.test(now) || !UTC_ISO.test(deadline)) return null;
  return now >= deadline;
}
