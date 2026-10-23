/**
 * JULIUS-SIDE FACTS FOR ONE WONDER WEB VM SESSION.
 *
 * BRIDGE owns the session model: user, terminal, agent, VM session, window,
 * and the session id its service mints. This file does not declare that model.
 * It declares the facts Julius records after BRIDGE answers, keyed by
 * `vmSessionId`. The client composes the window from the session record.
 * Julius does not send or store a window title, and it does not assign a
 * window number.
 *
 * Not a VM, and not a pass for a real browser session.
 */

export const JULIUS_WONDER_WEB_VM_CONTRACT = 'julius-wonder-web-vm.v1' as const;

/** BRIDGE session contract. Julius does not publish a second one. */
export const WONDER_WEB_VM_SESSION_CONTRACT = 'wonder-web-vm-session.v1' as const;

/**
 * Why a session ended. Closed set from `wonder-web-vm-session.v1`.
 * A Julius card-end or run-end terminate sends `owner_terminated`.
 * Any other string the port reports is still terminal.
 */
export const JULIUS_VM_END_CAUSES = [
  'owner_terminated',
  'idle_timeout',
  'max_lifetime',
  'provider_failed',
  'cap_exhausted',
  'authorization_revoked',
] as const;
export type JuliusVmEndCause = (typeof JULIUS_VM_END_CAUSES)[number];

/**
 * Accent token for every Julius VM. Display metadata for BRIDGE and the
 * Wonderland outline. Not an authority key: authorization never reads it.
 * This checkout has no painted Julius terminal colour; the token is the name
 * the session service resolves.
 */
export const JULIUS_TERMINAL_ACCENT_TOKEN = 'julius-terminal' as const;

/** The terminal a working card is registered under. Secondary metadata. */
export const JULIUS_VM_TERMINAL_ID = 'julius' as const;

export type JuliusVmOperation =
  | 'open'
  | 'navigate'
  | 'act'
  | 'screenshot'
  | 'close-window'
  | 'terminate';

export type JuliusVmSessionState = 'OPEN' | 'WINDOW_CLOSED' | 'TERMINATED' | 'TERMINATE_FAILED';

/**
 * The only spend record a Julius VM action carries.
 *
 * `mechanism` names PR #404 (`authorizeJuliusLiveSpend`) together with
 * `JuliusBudgetPort`. This module does not apply a second ceiling. A null
 * measured amount is unknown, not zero: the reservation stands.
 */
export interface JuliusVmSpendRecord {
  readonly mechanism: 'pr-404-julius-spend-ceiling';
  readonly agentId: string | null;
  readonly reservationId: string | null;
  readonly vmSessionId: string | null;
  readonly reservedUsdMicros: number | null;
  readonly measuredUsdMicros: number | null;
  readonly state: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'DENIED' | 'NOT_SPENT';
  readonly denialReason: string | null;
}

export interface JuliusVmActionTrace {
  readonly traceId: string;
  readonly operation: JuliusVmOperation;
  readonly taskId: string | null;
  readonly vmSessionId: string | null;
  readonly agentId: string | null;
  readonly occurredAt: string;
  readonly providerResponseId: string | null;
  /** `label_omitted:<reason>` when the card label was not sent. Null when it was. */
  readonly note: string | null;
  readonly spend: JuliusVmSpendRecord;
}

export interface JuliusVmResult {
  readonly ok: boolean;
  readonly reasonCode: string;
  readonly taskId: string | null;
  readonly vmSessionId: string | null;
  readonly agentId: string | null;
  /** Raw cause the port reported. Null while the session is open. Not a title. */
  readonly endCause: string | null;
  readonly streamRef: string | null;
  readonly providerResponseId: string | null;
  readonly trace: JuliusVmActionTrace;
}

/** What Julius keeps after BRIDGE mints the session. Keyed by `vmSessionId`. */
export interface JuliusVmOwnedSession {
  readonly vmSessionId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly projectId: string;
  /** Display name sent at registration. Null when the card had no label. */
  readonly agentDisplayName: string | null;
  /** Display only. The same token for every Julius session. */
  readonly accentColourToken: typeof JULIUS_TERMINAL_ACCENT_TOKEN;
  readonly endCause: string | null;
  readonly hardTtlAt: string;
  readonly idleTtlAt: string;
  readonly allowlistHosts: readonly string[];
  readonly state: JuliusVmSessionState;
}
