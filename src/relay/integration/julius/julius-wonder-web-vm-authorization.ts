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

export function cardLabelProblem(label: string): 'card_label_invalid' | 'provider_label_is_not_a_card' | null {
  if (label.trim() === '' || label !== label.trim() || label.length > 80) return 'card_label_invalid';
  if (/[\u0000-\u001f]/u.test(label)) return 'card_label_invalid';
  if (/sk-|api[_-]?key|bearer\s/iu.test(label)) return 'card_label_invalid';
  if (PROVIDER_LABELS.has(label.toLowerCase())) return 'provider_label_is_not_a_card';
  return null;
}

export function spendAmountProblem(usdMicros: number): 'spend_amount_invalid' | null {
  if (typeof usdMicros !== 'number' || !Number.isSafeInteger(usdMicros) || usdMicros < 0) return 'spend_amount_invalid';
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
