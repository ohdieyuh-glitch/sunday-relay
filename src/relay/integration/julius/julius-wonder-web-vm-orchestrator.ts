/**
 * ONE WORKING CARD, ONE VM SESSION.
 *
 * The card is a Julius task the runtime already stored. This orchestrator
 * registers that task under the Julius terminal, asks BRIDGE's session port
 * to open one session, and keys every later call on the `vmSessionId` that
 * port returns. It does not mint agent ids or window numbers, and it has no
 * global lock: two tasks may be in `openSession` at once.
 *
 * Spend goes through `JuliusVmSpendCapPort` only. Terminate is explicit, owner
 * only, and not a spend. Closing a window is not terminate. There is no call
 * that extends a TTL.
 */

import {
  JULIUS_TERMINAL_MISSION_STATES,
  type JuliusMissionState,
  type JuliusTaskState,
} from '../../mission/julius/julius-runtime';
import {
  JULIUS_VM_CARD_END_STATES,
  JULIUS_VM_WORKING_TASK_STATES,
  callerSuppliedIdentityField,
  hardTtlProblem,
  hostOnAllowlist,
  maxLifetimeProblem,
  navigationTarget,
  registrationDisplayName,
  sessionOwnedByAgent,
  spendAmountProblem,
  utcDeadlineReached,
  workingCardIdProblem,
} from './julius-wonder-web-vm-authorization';
import type {
  JuliusIssuedTaskSource,
  JuliusVmRegistryPort,
  JuliusVmSessionPort,
  JuliusVmSpendAuthorization,
  JuliusVmSpendCapPort,
} from './julius-wonder-web-vm-port';
import {
  JULIUS_TERMINAL_ACCENT_TOKEN,
  JULIUS_VM_TERMINAL_ID,
  type JuliusVmActionTrace,
  type JuliusVmOperation,
  type JuliusVmOwnedSession,
  type JuliusVmResult,
  type JuliusVmSessionState,
  type JuliusVmSpendRecord,
} from './julius-wonder-web-vm-types';

export interface JuliusVmClock { now(): string }
export interface JuliusVmIds { next(kind: string): string }

export interface JuliusVmOrchestratorDeps {
  readonly tasks: JuliusIssuedTaskSource;
  readonly registry: JuliusVmRegistryPort;
  readonly sessions: JuliusVmSessionPort;
  readonly spend: JuliusVmSpendCapPort;
  readonly clock: JuliusVmClock;
  readonly ids: JuliusVmIds;
  /**
   * Maximum hard TTL, in milliseconds, measured from `clock.now()`.
   * The value comes from BRIDGE's wonder-web-vm session-layer constant once
   * that module lands. This package does not import that module and does not
   * substitute a number. Missing, non-finite, or non-positive values refuse
   * the open.
   */
  readonly maxLifetimeMs: number;
}

interface OpenInput {
  readonly runId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly cardLabel?: string | null;
  readonly allowlistHosts: readonly string[];
  readonly usdMicros: number;
  readonly authorization: JuliusVmSpendAuthorization;
}

interface SessionInput {
  readonly runId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly vmSessionId: string;
}

interface PaidInput extends SessionInput {
  readonly usdMicros: number;
  readonly authorization: JuliusVmSpendAuthorization;
}

interface StoredSession extends JuliusVmOwnedSession {
  state: JuliusVmSessionState;
  endCause: string | null;
  /** A paid commit failed after the port acted. Further paid actions stop. */
  spendUnreconciled: boolean;
}

const notSpent = (agentId: string | null, vmSessionId: string | null): JuliusVmSpendRecord => ({
  mechanism: 'pr-404-julius-spend-ceiling',
  agentId,
  reservationId: null,
  vmSessionId,
  reservedUsdMicros: null,
  measuredUsdMicros: null,
  state: 'NOT_SPENT',
  denialReason: null,
});

const heldSpend = (
  agentId: string,
  reservationId: string,
  vmSessionId: string,
  reservedUsdMicros: number,
  denialReason: string,
): JuliusVmSpendRecord => ({
  mechanism: 'pr-404-julius-spend-ceiling',
  agentId,
  reservationId,
  vmSessionId,
  reservedUsdMicros,
  measuredUsdMicros: null,
  state: 'UNRECONCILED',
  denialReason,
});

export class JuliusWonderWebVmOrchestrator {
  private readonly byTask = new Map<string, StoredSession>();
  private readonly bySession = new Map<string, StoredSession>();
  private readonly agents = new Map<string, string>();
  /** In-flight open for one task. Not a lock across tasks. */
  private readonly opening = new Map<string, Promise<JuliusVmResult>>();

  constructor(private readonly deps: JuliusVmOrchestratorDeps) {}

  async open(input: OpenInput): Promise<JuliusVmResult> {
    const forged = callerSuppliedIdentityField(input);
    if (forged) return this.answer(input, 'open', forged, null, null, notSpent(null, null));
    const key = taskKey(input);
    const existing = this.byTask.get(key);
    if (existing?.state === 'TERMINATE_FAILED') return this.replay(existing, 'terminate', 'terminate_left_to_server_ttl');
    if (existing?.state === 'TERMINATED') return this.replay(existing, 'open', 'session_not_open');
    if (existing?.state === 'OPEN' || existing?.state === 'WINDOW_CLOSED') return this.replay(existing, 'open', 'session_open');
    const inflight = this.opening.get(key);
    if (inflight) return inflight;
    const run = this.openNew(input, key);
    this.opening.set(key, run);
    try {
      return await run;
    } finally {
      this.opening.delete(key);
    }
  }

  async navigate(input: PaidInput & { readonly url: string }): Promise<JuliusVmResult> {
    const gate = await this.gatePaid(input, 'navigate');
    if (!gate.ok) return gate.result;
    const target = navigationTarget(input.url);
    if (!target.ok) return this.unspent(input, 'navigate', target.reasonCode, gate.session);
    if (!hostOnAllowlist(target.host, gate.session.allowlistHosts)) return this.unspent(input, 'navigate', 'navigation_allowlist_denied', gate.session);
    return this.withSpend(input, gate.session, 'navigate', async (reservationId) => {
      const response = await this.deps.sessions.navigate({
        vmSessionId: gate.session.vmSessionId, agentId: gate.session.agentId, url: input.url, reservationId,
      });
      return { providerResponseId: response.providerResponseId, streamRef: null };
    });
  }

  async act(input: PaidInput & { readonly actionName: string }): Promise<JuliusVmResult> {
    const gate = await this.gatePaid(input, 'act');
    if (!gate.ok) return gate.result;
    if (input.actionName.trim() === '' || input.actionName.length > 200) return this.unspent(input, 'act', 'action_invalid', gate.session);
    return this.withSpend(input, gate.session, 'act', async (reservationId) => {
      const response = await this.deps.sessions.act({
        vmSessionId: gate.session.vmSessionId, agentId: gate.session.agentId, actionName: input.actionName, reservationId,
      });
      return { providerResponseId: response.providerResponseId, streamRef: null };
    });
  }

  async screenshot(input: PaidInput): Promise<JuliusVmResult> {
    const gate = await this.gatePaid(input, 'screenshot');
    if (!gate.ok) return gate.result;
    return this.withSpend(input, gate.session, 'screenshot', async (reservationId) => {
      const response = await this.deps.sessions.screenshot({
        vmSessionId: gate.session.vmSessionId, agentId: gate.session.agentId, reservationId,
      });
      return { providerResponseId: response.providerResponseId, streamRef: response.streamRef };
    });
  }

  /**
   * Hides the window. `wonder-web-vm-session.v1`: closing a window is not an
   * end cause. The session stays live for paid actions. Terminate is not called.
   */
  async closeWindow(input: SessionInput): Promise<JuliusVmResult> {
    const ready = await this.readySession(input, 'close-window', false);
    if (!ready.ok) return ready.result;
    const response = await this.deps.sessions.closeWindow({
      vmSessionId: ready.session.vmSessionId, agentId: ready.session.agentId,
    });
    ready.session.state = 'WINDOW_CLOSED';
    return this.answer(input, 'close-window', 'window_closed', ready.session.agentId, ready.session, notSpent(ready.session.agentId, ready.session.vmSessionId), response.providerResponseId);
  }

  /**
   * A cause the session port already reported. Does not call terminate and
   * does not reserve. Known and unknown causes both end the session.
   */
  async notePortEnd(input: SessionInput & { readonly endCause: string }): Promise<JuliusVmResult> {
    const ready = await this.readySession(input, 'terminate', true);
    if (!ready.ok) return ready.result;
    if (ready.session.state === 'TERMINATED') return this.replay(ready.session, 'terminate', endedReason(ready.session.endCause));
    return this.markEnded(ready.session, input.endCause, null);
  }

  /**
   * Owner terminate for one session. Refuses a session that belongs to
   * another task's agent, even when the labels match.
   */
  async requestTerminate(input: SessionInput): Promise<JuliusVmResult> {
    const ready = await this.readySession(input, 'terminate', true);
    if (!ready.ok) return ready.result;
    return this.terminateOwned(ready.session, input.taskId);
  }

  async onTaskEnded(input: { readonly runId: string; readonly projectId: string; readonly taskId: string }): Promise<JuliusVmResult> {
    const forged = callerSuppliedIdentityField(input);
    if (forged) return this.answer(input, 'terminate', forged, null, null, notSpent(null, null));
    const issued = await this.issuedTask(input);
    if (!issued.ok) return this.answer(input, 'terminate', issued.reasonCode, null, null, notSpent(null, null));
    if (!JULIUS_VM_CARD_END_STATES.includes(issued.task.state)) {
      return this.answer(input, 'terminate', 'card_still_working', this.agents.get(taskKey(input)) ?? null, null, notSpent(this.agents.get(taskKey(input)) ?? null, null));
    }
    const session = this.byTask.get(taskKey(input));
    if (!session) return this.answer(input, 'terminate', 'nothing_to_terminate', this.agents.get(taskKey(input)) ?? null, null, notSpent(this.agents.get(taskKey(input)) ?? null, null));
    return this.terminateOwned(session, input.taskId);
  }

  async onRunEnded(input: { readonly runId: string; readonly projectId: string }): Promise<JuliusVmResult> {
    const forged = callerSuppliedIdentityField(input);
    if (forged) return this.answer({ ...input, taskId: null }, 'terminate', forged, null, null, notSpent(null, null));
    const state = await this.deps.tasks.runState(input.runId, input.projectId);
    if (state === null) return this.answer({ ...input, taskId: null }, 'terminate', 'run_not_issued', null, null, notSpent(null, null));
    if (!isTerminalRun(state)) return this.answer({ ...input, taskId: null }, 'terminate', 'run_still_open', null, null, notSpent(null, null));
    const sessions = [...this.bySession.values()]
      .filter((session) => session.runId === input.runId && session.projectId === input.projectId)
      .sort((a, b) => a.vmSessionId.localeCompare(b.vmSessionId));
    let last: JuliusVmResult = this.answer({ ...input, taskId: null }, 'terminate', 'nothing_to_terminate', null, null, notSpent(null, null));
    let failure: JuliusVmResult | null = null;
    for (const session of sessions) {
      const result = await this.terminateOwned(session, session.taskId);
      last = result;
      if (result.reasonCode === 'terminate_left_to_server_ttl' && failure === null) failure = result;
    }
    return failure ?? last;
  }

  private async openNew(input: OpenInput, key: string): Promise<JuliusVmResult> {
    const run = await this.deps.tasks.runState(input.runId, input.projectId);
    if (run === null) return this.answer(input, 'open', 'run_not_issued', null, null, notSpent(null, null));
    if (isTerminalRun(run)) return this.answer(input, 'open', 'run_already_ended', null, null, notSpent(null, null));
    const idProblem = workingCardIdProblem(input.taskId);
    if (idProblem) return this.answer(input, 'open', idProblem, null, null, notSpent(null, null));
    const issued = await this.issuedTask(input);
    if (!issued.ok) return this.answer(input, 'open', issued.reasonCode, null, null, notSpent(null, null));
    if (!JULIUS_VM_WORKING_TASK_STATES.includes(issued.task.state)) {
      return this.answer(input, 'open', 'card_not_working', null, null, notSpent(null, null));
    }
    const named = registrationDisplayName(input.cardLabel);
    const lifetime = maxLifetimeProblem(this.deps.maxLifetimeMs);
    if (lifetime) return this.answer(input, 'open', lifetime, null, null, notSpent(null, null));
    if (input.authorization.authorized !== true) {
      return this.answer(input, 'open', input.authorization.reasonCode ?? 'spend_cap_denied', null, null, {
        ...notSpent(null, null), state: 'DENIED', denialReason: input.authorization.reasonCode ?? 'spend_cap_denied',
      });
    }
    const amountProblem = spendAmountProblem(input.usdMicros);
    if (amountProblem) return this.answer(input, 'open', amountProblem, null, null, notSpent(null, null));

    const agentId = await this.agentFor(input, named.agentDisplayName);
    if (agentId === null) return this.answer(input, 'open', 'agent_not_issued', null, null, notSpent(null, null));
    const now = this.deps.clock.now();
    const reservationId = this.deps.ids.next('vm-reservation');
    const reserved = await this.deps.spend.reserve({
      agentId, reservationId, runId: input.runId, projectId: input.projectId, taskId: input.taskId,
      vmSessionId: null, usdMicros: input.usdMicros, now, authorization: input.authorization,
    });
    if (reserved.state === 'DENIED') {
      return this.answer(input, 'open', reserved.denialReason ?? 'spend_cap_denied', agentId, null, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId, reservationId, vmSessionId: null,
        reservedUsdMicros: input.usdMicros, measuredUsdMicros: null, state: 'DENIED',
        denialReason: reserved.denialReason ?? 'spend_cap_denied',
      });
    }
    const allowlistHosts = [...new Set(input.allowlistHosts.map((host) => host.toLowerCase()))];
    let opened: Awaited<ReturnType<JuliusVmSessionPort['openSession']>>;
    try {
      opened = await this.deps.sessions.openSession({
        agentId, accentColourToken: JULIUS_TERMINAL_ACCENT_TOKEN,
        allowlistHosts, reservationId,
      });
      if (opened.vmSessionId.trim() === '') throw new Error('vm_session_not_issued');
    } catch {
      await this.deps.spend.release({ agentId, reservationId, reason: 'session_open_failed', now: this.deps.clock.now() });
      return this.answer(input, 'open', 'session_open_failed', agentId, null, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId, reservationId, vmSessionId: null,
        reservedUsdMicros: input.usdMicros, measuredUsdMicros: null, state: 'RELEASED', denialReason: 'session_open_failed',
      }, null, null, named.note);
    }
    const ttlProblem = hardTtlProblem(this.deps.clock.now(), opened.hardTtlAt, this.deps.maxLifetimeMs);
    if (ttlProblem) {
      return this.rejectOpenedSession(input, key, agentId, reservationId, allowlistHosts, opened, ttlProblem, named);
    }
    const session: StoredSession = {
      vmSessionId: opened.vmSessionId, agentId, taskId: input.taskId, runId: input.runId, projectId: input.projectId,
      agentDisplayName: named.agentDisplayName ?? null, accentColourToken: JULIUS_TERMINAL_ACCENT_TOKEN,
      endCause: null, hardTtlAt: opened.hardTtlAt, idleTtlAt: opened.idleTtlAt, allowlistHosts, state: 'OPEN',
      spendUnreconciled: false,
    };
    this.byTask.set(key, session);
    this.bySession.set(session.vmSessionId, session);
    try {
      await this.deps.spend.commit({ agentId, reservationId, measuredUsdMicros: null, now: this.deps.clock.now() });
    } catch {
      return this.terminateAfterFailedCommit(session, reservationId, input.usdMicros, named.note);
    }
    return this.answer(input, 'open', 'session_open', agentId, session, {
      mechanism: 'pr-404-julius-spend-ceiling', agentId, reservationId, vmSessionId: session.vmSessionId,
      reservedUsdMicros: input.usdMicros, measuredUsdMicros: null, state: 'COMMITTED', denialReason: null,
    }, opened.providerResponseId, null, named.note);
  }

  private async gatePaid(
    input: PaidInput,
    operation: Extract<JuliusVmOperation, 'navigate' | 'act' | 'screenshot'>,
  ): Promise<{ readonly ok: true; readonly session: StoredSession } | { readonly ok: false; readonly result: JuliusVmResult }> {
    const ready = await this.readySession(input, operation, false);
    if (!ready.ok) return ready;
    if (ready.session.spendUnreconciled) {
      return { ok: false, result: this.unspent(input, operation, 'spend_unreconciled', ready.session) };
    }
    const ttl = this.ttlRefusal(ready.session);
    if (ttl) return { ok: false, result: this.unspent(input, operation, ttl, ready.session) };
    if (input.authorization.authorized !== true) {
      const denialReason = input.authorization.reasonCode ?? 'spend_cap_denied';
      return { ok: false, result: this.answer(input, operation, denialReason, ready.session.agentId, ready.session, {
        ...notSpent(ready.session.agentId, ready.session.vmSessionId), state: 'DENIED', denialReason,
      }) };
    }
    const amountProblem = spendAmountProblem(input.usdMicros);
    if (amountProblem) return { ok: false, result: this.unspent(input, operation, amountProblem, ready.session) };
    return { ok: true, session: ready.session };
  }

  /** One reservation, one port call. A refusal before this method does not spend. */
  private async withSpend(
    input: PaidInput,
    session: StoredSession,
    operation: Extract<JuliusVmOperation, 'navigate' | 'act' | 'screenshot'>,
    effect: (reservationId: string) => Promise<{ readonly providerResponseId: string; readonly streamRef: string | null }>,
  ): Promise<JuliusVmResult> {
    const reservationId = this.deps.ids.next('vm-reservation');
    const now = this.deps.clock.now();
    const reserved = await this.deps.spend.reserve({
      agentId: session.agentId, reservationId, runId: input.runId, projectId: input.projectId,
      taskId: input.taskId, vmSessionId: session.vmSessionId, usdMicros: input.usdMicros, now,
      authorization: input.authorization,
    });
    if (reserved.state === 'DENIED') {
      const denialReason = reserved.denialReason ?? 'spend_cap_denied';
      return this.answer(input, operation, denialReason, session.agentId, session, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId: session.agentId, reservationId,
        vmSessionId: session.vmSessionId, reservedUsdMicros: input.usdMicros, measuredUsdMicros: null,
        state: 'DENIED', denialReason,
      });
    }
    let done: { readonly providerResponseId: string; readonly streamRef: string | null };
    try {
      done = await effect(reservationId);
    } catch {
      await this.deps.spend.release({ agentId: session.agentId, reservationId, reason: 'action_failed', now: this.deps.clock.now() });
      return this.answer(input, operation, 'action_failed', session.agentId, session, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId: session.agentId, reservationId,
        vmSessionId: session.vmSessionId, reservedUsdMicros: input.usdMicros, measuredUsdMicros: null,
        state: 'RELEASED', denialReason: 'action_failed',
      });
    }
    try {
      await this.deps.spend.commit({
        agentId: session.agentId, reservationId, measuredUsdMicros: null, now: this.deps.clock.now(),
      });
    } catch {
      session.spendUnreconciled = true;
      return this.answer(input, operation, 'action_commit_failed', session.agentId, session, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId: session.agentId, reservationId,
        vmSessionId: session.vmSessionId, reservedUsdMicros: input.usdMicros, measuredUsdMicros: null,
        state: 'UNRECONCILED', denialReason: 'action_commit_failed',
      }, done.providerResponseId, done.streamRef);
    }
    return this.answer(input, operation, 'acted', session.agentId, session, {
      mechanism: 'pr-404-julius-spend-ceiling', agentId: session.agentId, reservationId,
      vmSessionId: session.vmSessionId, reservedUsdMicros: input.usdMicros, measuredUsdMicros: null,
      state: 'COMMITTED', denialReason: null,
    }, done.providerResponseId, done.streamRef);
  }

  private unspent(input: PaidInput, operation: JuliusVmOperation, reasonCode: string, session: StoredSession): JuliusVmResult {
    return this.answer(input, operation, reasonCode, session.agentId, session, notSpent(session.agentId, session.vmSessionId));
  }

  private async readySession(
    input: SessionInput,
    operation: JuliusVmOperation,
    allowEnded: boolean,
  ): Promise<{ readonly ok: true; readonly session: StoredSession } | { readonly ok: false; readonly result: JuliusVmResult }> {
    const forged = callerSuppliedIdentityField(input);
    if (forged) return { ok: false, result: this.answer(input, operation, forged, null, null, notSpent(null, null)) };
    const issued = await this.issuedTask(input);
    if (!issued.ok) return { ok: false, result: this.answer(input, operation, issued.reasonCode, null, null, notSpent(null, null)) };
    const session = this.bySession.get(input.vmSessionId);
    if (!session) return { ok: false, result: this.answer(input, operation, 'session_unknown', this.agents.get(taskKey(input)) ?? null, null, notSpent(this.agents.get(taskKey(input)) ?? null, null)) };
    const issuedAgentId = this.agents.get(taskKey(input));
    if (!issuedAgentId || !sessionOwnedByAgent({ issuedAgentId, sessionAgentId: session.agentId }) || session.taskId !== input.taskId) {
      return { ok: false, result: this.answer(input, operation, 'session_not_owned', issuedAgentId ?? null, null, notSpent(issuedAgentId ?? null, input.vmSessionId)) };
    }
    if (session.state === 'TERMINATE_FAILED') {
      return { ok: false, result: this.answer(input, operation, 'terminate_left_to_server_ttl', session.agentId, session, notSpent(session.agentId, session.vmSessionId)) };
    }
    if (!allowEnded && session.state === 'TERMINATED') {
      return { ok: false, result: this.answer(input, operation, 'session_not_open', session.agentId, session, notSpent(session.agentId, session.vmSessionId)) };
    }
    return { ok: true, session };
  }

  /**
   * The VM exists and Julius will not keep it. Terminate with
   * `owner_terminated`. Release the reservation only when that terminate is
   * confirmed. A failed terminate poisons the task so a later open does not
   * start a second VM, and the reservation stays held.
   */
  private async rejectOpenedSession(
    input: OpenInput,
    key: string,
    agentId: string,
    reservationId: string,
    allowlistHosts: readonly string[],
    opened: { readonly vmSessionId: string; readonly hardTtlAt: string; readonly idleTtlAt: string },
    reason: string,
    named: { readonly agentDisplayName: string | undefined; readonly note: string | null },
  ): Promise<JuliusVmResult> {
    try {
      const response = await this.deps.sessions.terminate({
        vmSessionId: opened.vmSessionId, agentId, endCause: 'owner_terminated',
      });
      try {
        await this.deps.spend.release({ agentId, reservationId, reason, now: this.deps.clock.now() });
      } catch {
        const session = this.remember(input, key, agentId, allowlistHosts, opened, named.agentDisplayName ?? null, 'TERMINATED', response.endCause, true);
        return this.answer(input, 'open', reason, agentId, session, heldSpend(agentId, reservationId, session.vmSessionId, input.usdMicros, reason), response.providerResponseId, null, named.note);
      }
      return this.answer(input, 'open', reason, agentId, null, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId, reservationId, vmSessionId: opened.vmSessionId,
        reservedUsdMicros: input.usdMicros, measuredUsdMicros: null, state: 'RELEASED', denialReason: reason,
      }, response.providerResponseId, null, named.note);
    } catch {
      const session = this.remember(input, key, agentId, allowlistHosts, opened, named.agentDisplayName ?? null, 'TERMINATE_FAILED', null, true);
      return this.answer(input, 'open', reason, agentId, session, heldSpend(agentId, reservationId, session.vmSessionId, input.usdMicros, reason), null, null, named.note);
    }
  }

  /** Commit threw after the VM was stored. The reservation stays held unless terminate is confirmed. */
  private async terminateAfterFailedCommit(
    session: StoredSession,
    reservationId: string,
    usdMicros: number,
    note: string | null,
  ): Promise<JuliusVmResult> {
    const input = { runId: session.runId, projectId: session.projectId, taskId: session.taskId };
    try {
      const response = await this.deps.sessions.terminate({
        vmSessionId: session.vmSessionId, agentId: session.agentId, endCause: 'owner_terminated',
      });
      session.state = 'TERMINATED';
      session.endCause = response.endCause;
      try {
        await this.deps.spend.release({
          agentId: session.agentId, reservationId, reason: 'session_commit_failed', now: this.deps.clock.now(),
        });
      } catch {
        session.spendUnreconciled = true;
        return this.answer(input, 'open', 'session_commit_failed_terminated', session.agentId, session, heldSpend(session.agentId, reservationId, session.vmSessionId, usdMicros, 'session_commit_failed'), response.providerResponseId, null, note);
      }
      return this.answer(input, 'open', 'session_commit_failed_terminated', session.agentId, session, {
        mechanism: 'pr-404-julius-spend-ceiling', agentId: session.agentId, reservationId, vmSessionId: session.vmSessionId,
        reservedUsdMicros: usdMicros, measuredUsdMicros: null, state: 'RELEASED', denialReason: 'session_commit_failed',
      }, response.providerResponseId, null, note);
    } catch {
      session.state = 'TERMINATE_FAILED';
      session.spendUnreconciled = true;
      return this.answer(input, 'open', 'session_commit_failed_terminate_failed', session.agentId, session, heldSpend(session.agentId, reservationId, session.vmSessionId, usdMicros, 'session_commit_failed'), null, null, note);
    }
  }

  private remember(
    input: OpenInput,
    key: string,
    agentId: string,
    allowlistHosts: readonly string[],
    opened: { readonly vmSessionId: string; readonly hardTtlAt: string; readonly idleTtlAt: string },
    agentDisplayName: string | null,
    state: JuliusVmSessionState,
    endCause: string | null,
    spendUnreconciled: boolean,
  ): StoredSession {
    const session: StoredSession = {
      vmSessionId: opened.vmSessionId, agentId, taskId: input.taskId, runId: input.runId, projectId: input.projectId,
      agentDisplayName, accentColourToken: JULIUS_TERMINAL_ACCENT_TOKEN, endCause, hardTtlAt: opened.hardTtlAt,
      idleTtlAt: opened.idleTtlAt, allowlistHosts, state, spendUnreconciled,
    };
    this.byTask.set(key, session);
    this.bySession.set(session.vmSessionId, session);
    return session;
  }

  private async terminateOwned(session: StoredSession, taskId: string): Promise<JuliusVmResult> {
    const input = { runId: session.runId, projectId: session.projectId, taskId };
    if (session.state === 'TERMINATED') return this.replay(session, 'terminate', endedReason(session.endCause));
    if (session.state === 'TERMINATE_FAILED') {
      return this.answer(input, 'terminate', 'terminate_left_to_server_ttl', session.agentId, session, notSpent(session.agentId, session.vmSessionId));
    }
    try {
      const response = await this.deps.sessions.terminate({
        vmSessionId: session.vmSessionId, agentId: session.agentId, endCause: 'owner_terminated',
      });
      return this.markEnded(session, response.endCause, response.providerResponseId);
    } catch {
      session.state = 'TERMINATE_FAILED';
      return this.answer(input, 'terminate', 'terminate_left_to_server_ttl', session.agentId, session, notSpent(session.agentId, session.vmSessionId));
    }
  }

  private markEnded(session: StoredSession, reported: string, providerResponseId: string | null): JuliusVmResult {
    session.state = 'TERMINATED';
    session.endCause = reported;
    const reason = reported === 'owner_terminated' ? 'session_terminated' : 'session_ended';
    return this.answer(
      { runId: session.runId, projectId: session.projectId, taskId: session.taskId },
      'terminate', reason, session.agentId, session, notSpent(session.agentId, session.vmSessionId),
      providerResponseId,
    );
  }

  private ttlRefusal(session: StoredSession): string | null {
    const now = this.deps.clock.now();
    const hard = utcDeadlineReached(now, session.hardTtlAt);
    if (hard === null) return 'ttl_unreadable';
    if (hard) return 'session_hard_ttl_elapsed';
    const idle = utcDeadlineReached(now, session.idleTtlAt);
    if (idle === null) return 'ttl_unreadable';
    if (idle) return 'session_idle_elapsed';
    return null;
  }

  private async agentFor(input: { readonly runId: string; readonly projectId: string; readonly taskId: string }, agentDisplayName: string | undefined): Promise<string | null> {
    const key = taskKey(input);
    const known = this.agents.get(key);
    if (known) return known;
    const registered = await this.deps.registry.registerWorkingCard({
      terminalId: JULIUS_VM_TERMINAL_ID,
      taskId: input.taskId,
      accentColourToken: JULIUS_TERMINAL_ACCENT_TOKEN,
      ...(agentDisplayName === undefined ? {} : { agentDisplayName }),
    });
    if (registered.agentId.trim() === '') return null;
    this.agents.set(key, registered.agentId);
    return registered.agentId;
  }

  private async issuedTask(input: { readonly runId: string; readonly projectId: string; readonly taskId: string }): Promise<
    { readonly ok: true; readonly task: { readonly taskId: string; readonly state: JuliusTaskState } } | { readonly ok: false; readonly reasonCode: string }
  > {
    const idProblem = workingCardIdProblem(input.taskId);
    if (idProblem) return { ok: false, reasonCode: idProblem };
    const tasks = await this.deps.tasks.tasksForRun(input.runId, input.projectId);
    const task = tasks.find((candidate) => candidate.taskId === input.taskId);
    if (!task) return { ok: false, reasonCode: 'task_not_issued' };
    return { ok: true, task };
  }

  private replay(session: StoredSession, operation: JuliusVmOperation, reasonCode: string): JuliusVmResult {
    return this.answer(
      { runId: session.runId, projectId: session.projectId, taskId: session.taskId },
      operation, reasonCode, session.agentId, session, notSpent(session.agentId, session.vmSessionId), null, null,
    );
  }

  private answer(
    input: { readonly runId: string; readonly projectId: string; readonly taskId: string | null },
    operation: JuliusVmOperation,
    reasonCode: string,
    agentId: string | null,
    session: StoredSession | null,
    spend: JuliusVmSpendRecord,
    providerResponseId: string | null = null,
    streamRef: string | null = null,
    note: string | null = null,
  ): JuliusVmResult {
    const trace: JuliusVmActionTrace = {
      traceId: this.deps.ids.next('vm-trace'),
      operation,
      taskId: input.taskId,
      vmSessionId: session?.vmSessionId ?? spend.vmSessionId,
      agentId,
      occurredAt: this.deps.clock.now(),
      providerResponseId,
      note,
      spend,
    };
    return {
      ok: reasonCode === 'session_open' || reasonCode === 'acted' || reasonCode === 'window_closed' || reasonCode === 'session_terminated' || reasonCode === 'session_ended' || reasonCode === 'nothing_to_terminate' || reasonCode === 'card_still_working' || reasonCode === 'run_still_open',
      reasonCode,
      taskId: input.taskId,
      vmSessionId: session?.vmSessionId ?? null,
      agentId,
      endCause: session?.endCause ?? null,
      streamRef,
      providerResponseId,
      trace,
    };
  }
}

function endedReason(endCause: string | null): 'session_terminated' | 'session_ended' {
  return endCause === 'owner_terminated' ? 'session_terminated' : 'session_ended';
}

function taskKey(input: { readonly projectId: string; readonly runId: string; readonly taskId: string }): string {
  return `${input.projectId}\u0000${input.runId}\u0000${input.taskId}`;
}

function isTerminalRun(state: JuliusMissionState): boolean {
  return (JULIUS_TERMINAL_MISSION_STATES as readonly JuliusMissionState[]).includes(state);
}
