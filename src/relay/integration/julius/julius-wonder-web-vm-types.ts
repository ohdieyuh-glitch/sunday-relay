/**
 * JULIUS-SIDE FACTS FOR ONE WONDER WEB VM SESSION.
 *
 * BRIDGE owns the session model: user, terminal, agent, VM session, window,
 * and the session id its service mints. This file does not declare that model.
 * It declares the facts Julius records after BRIDGE answers, keyed by
 * `vmSessionId`. A window title is an opaque string BRIDGE returns. Julius
 * does not assign a window number.
 *
 * Not a VM, and not a pass for a real browser session.
 */

export const JULIUS_WONDER_WEB_VM_CONTRACT = 'julius-wonder-web-vm.v1' as const;

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
  readonly spend: JuliusVmSpendRecord;
}

export interface JuliusVmResult {
  readonly ok: boolean;
  readonly reasonCode: string;
  readonly taskId: string | null;
  readonly vmSessionId: string | null;
  readonly agentId: string | null;
  readonly windowTitle: string | null;
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
  /** Display only. */
  readonly cardLabel: string;
  /** Display only. The same token for every Julius session. */
  readonly accentColourToken: typeof JULIUS_TERMINAL_ACCENT_TOKEN;
  /** Opaque title BRIDGE returned. */
  readonly windowTitle: string;
  readonly hardTtlAt: string;
  readonly idleTtlAt: string;
  readonly allowlistHosts: readonly string[];
  readonly state: JuliusVmSessionState;
}
