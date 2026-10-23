/**
 * PORTS BRIDGE IMPLEMENTS. Julius does not implement a registry, a session
 * service, or a provider behind these interfaces.
 *
 * The real registry issues agent ids with a CSPRNG. The real session service
 * mints `vmSessionId` and the idle and hard TTLs, and charges those TTLs
 * against PR #404. The client composes the window from `agentDisplayName`
 * and `vmNumber` on that record. This file has no such implementation.
 */

import type { JuliusMissionState, JuliusTaskState } from '../../mission/julius/julius-runtime';
import type { JULIUS_TERMINAL_ACCENT_TOKEN, JULIUS_VM_TERMINAL_ID } from './julius-wonder-web-vm-types';

/**
 * Tasks the Julius runtime already stored for a run.
 *
 * Production binds this to the run's task rows. Bootstrap writes those ids
 * (`planTaskId` / `buildTaskId` in `relay-bridge/julius/bootstrap.ts`); this
 * package does not import the bridge, and it does not accept a task id that
 * this source cannot find.
 */
export interface JuliusIssuedTaskSource {
  tasksForRun(
    runId: string,
    projectId: string,
  ): Promise<readonly {
    readonly taskId: string;
    readonly missionId: string;
    readonly state: JuliusTaskState;
    readonly taskType: string;
    readonly role: string;
  }[]>;
  runState(runId: string, projectId: string): Promise<JuliusMissionState | null>;
}

/**
 * A decision PR #404 already made (`authorizeJuliusLiveSpend`). Absent on
 * frozen main; the caller of this package supplies the decision. This package
 * does not recompute the namespace table. `authorized !== true` is a refusal.
 * A missing ceiling is not treated as zero and is not filled in here.
 */
export interface JuliusVmSpendAuthorization {
  readonly authorized: boolean;
  readonly reasonCode: string | null;
  readonly spendCeilingUsdMicros: number | null;
}

export interface JuliusVmSpendCapPort {
  /**
   * The only spend call. Production binds `reserve` / `commit` / `release` to
   * `JuliusBudgetPort` after `authorizeJuliusLiveSpend` has authorized.
   * `measuredUsdMicros: null` on commit means the bill was not observed; the
   * reservation is not released as zero.
   */
  reserve(input: {
    readonly agentId: string;
    readonly reservationId: string;
    readonly runId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly vmSessionId: string | null;
    readonly usdMicros: number;
    readonly now: string;
    readonly authorization: JuliusVmSpendAuthorization;
  }): Promise<{ readonly state: 'RESERVED' | 'DENIED'; readonly denialReason: string | null }>;
  commit(input: {
    readonly agentId: string;
    readonly reservationId: string;
    readonly measuredUsdMicros: number | null;
    readonly now: string;
  }): Promise<void>;
  release(input: {
    readonly agentId: string;
    readonly reservationId: string;
    readonly reason: string;
    readonly now: string;
  }): Promise<void>;
}

export interface JuliusVmRegistryPort {
  /** BRIDGE mints `agentId`. Julius stores it and never invents one. */
  registerWorkingCard(input: {
    readonly terminalId: typeof JULIUS_VM_TERMINAL_ID;
    readonly taskId: string;
    /** Present only when the card has a label. A missing label omits it. */
    readonly agentDisplayName?: string;
    readonly accentColourToken: typeof JULIUS_TERMINAL_ACCENT_TOKEN;
  }): Promise<{ readonly agentId: string }>;
}

/**
 * BRIDGE's session service. There is no extend operation: Julius cannot push
 * a session past the hard TTL the service returned.
 *
 * Idle TTL, hard TTL, and the orphan sweep stay on that service. They are
 * charged to PR #404. This port does not implement them.
 *
 * `closeWindow` does not end the session and is not an end cause.
 * `terminate` is the owner-only end. Terminate does not take a spend
 * reservation. A failure leaves the session to the service's TTL and is not
 * retried.
 */
export interface JuliusVmSessionPort {
  openSession(input: {
    readonly agentId: string;
    readonly accentColourToken: typeof JULIUS_TERMINAL_ACCENT_TOKEN;
    readonly allowlistHosts: readonly string[];
    readonly reservationId: string;
  }): Promise<{
    readonly vmSessionId: string;
    readonly hardTtlAt: string;
    readonly idleTtlAt: string;
    readonly providerResponseId: string;
  }>;
  navigate(input: {
    readonly vmSessionId: string;
    readonly agentId: string;
    readonly url: string;
    readonly reservationId: string;
  }): Promise<{ readonly providerResponseId: string }>;
  act(input: {
    readonly vmSessionId: string;
    readonly agentId: string;
    readonly actionName: string;
    readonly reservationId: string;
  }): Promise<{ readonly providerResponseId: string }>;
  screenshot(input: {
    readonly vmSessionId: string;
    readonly agentId: string;
    readonly reservationId: string;
  }): Promise<{ readonly providerResponseId: string; readonly streamRef: string }>;
  closeWindow(input: {
    readonly vmSessionId: string;
    readonly agentId: string;
  }): Promise<{ readonly providerResponseId: string }>;
  /**
   * Julius sends `owner_terminated` for a card end or a run end.
   * `endCause` on the answer is whatever the session service reported.
   * It may be any string. Julius does not spend on this call.
   */
  terminate(input: {
    readonly vmSessionId: string;
    readonly agentId: string;
    readonly endCause: 'owner_terminated';
  }): Promise<{ readonly providerResponseId: string; readonly endCause: string }>;
}
