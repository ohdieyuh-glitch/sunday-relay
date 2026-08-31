/**
 * APPROVALS, PAUSE, RESUME AND CANCEL — as durable operations.
 *
 * WHAT WAS MISSING. `evaluateJuliusPolicy` can return REQUIRE_APPROVAL and the
 * runtime had nowhere to put the request, no way to wait for an answer and no
 * way to resume — so a gated operation could only ever be REFUSED, which is
 * not the same thing as gated. `PAUSED` and `CANCELLED` were states in the
 * transition table with no operation behind them: nothing could put a run in
 * one, nothing recorded who asked, and nothing propagated a cancellation to
 * the work already in flight.
 *
 * PAUSE DOES NOT KILL WORK IN FLIGHT, and that is a decision worth stating.
 * The claim query already refuses every run state outside its claimable set,
 * so moving a run to PAUSED stops NEW claims by itself. An in-flight task
 * keeps its lease, finishes, and has its result accepted — because that result
 * was already paid for, and discarding it would make pausing a run more
 * expensive than letting it finish. Pause means "start nothing further".
 *
 * CANCEL DOES REACH IN. A cancelled run refuses late results
 * (`result_after_cancellation`, already enforced), and this additionally moves
 * every non-terminal task to CANCELLED so the graph stops offering them and a
 * held reservation can be released against a task that will never run.
 *
 * UNCHAINED CANNOT BYPASS A HARD APPROVAL. `evaluateJuliusPolicy` skips the
 * approval gate when `autonomy === 'UNCHAINED'`, which is its rule for
 * OPERATIONS LISTED IN `policy.approvals`. This module never consults autonomy
 * at all: an approval that has been REQUESTED is answered by a person or it is
 * not answered, and no autonomy level decides one on their behalf.
 */

import type { JuliusMissionState } from './julius-runtime';
import { planRunStatePath } from './julius-state-path';
import type { JuliusPolicyOperation } from './julius-policy';
import type { JuliusClock, JuliusEventWriter, JuliusIdFactory, JuliusRunRow, JuliusRunWriter } from './julius-runtime-ports';
import { validateJuliusEvent, type JuliusOperationalEventType } from './julius-events';

/* ------------------------------------------------------------- approvals */

export const JULIUS_APPROVAL_STATES = ['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'] as const;
export type JuliusApprovalState = (typeof JULIUS_APPROVAL_STATES)[number];

export interface JuliusApprovalRecord {
  readonly approvalId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly taskId: string | null;
  readonly operation: JuliusPolicyOperation;
  readonly policyRevision: string;
  readonly reasonCode: string;
  readonly safeRationale: string;
  readonly state: JuliusApprovalState;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  /** The authorized approver. Never a token, never a session. */
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly idempotencyKey: string;
}

export interface JuliusApprovalStore {
  /**
   * Idempotent twice over: by `(runId, idempotencyKey)` and by the partial
   * unique index that permits ONE PENDING approval per gated operation. Two
   * workers reaching the same gate produce one request for a human.
   */
  requestApproval(record: JuliusApprovalRecord): Promise<{ readonly created: boolean; readonly record: JuliusApprovalRecord }>;
  /** Production stores atomically persist the gate and make the run non-claimable. */
  requestApprovalAndBlock?(input:{record:JuliusApprovalRecord;expectedRunVersion:number}):Promise<{created:boolean;record:JuliusApprovalRecord;runState:JuliusMissionState}>;
  loadApproval(runId: string, approvalId: string, projectId: string): Promise<JuliusApprovalRecord | null>;
  pendingApprovals(runId: string, projectId: string): Promise<readonly JuliusApprovalRecord[]>;
  /** Decides only a PENDING approval. A decided one stays decided. */
  decideApproval(input: {
    runId: string; approvalId: string; projectId: string;
    state: Extract<JuliusApprovalState, 'APPROVED' | 'DENIED' | 'CANCELLED'>;
    decidedBy: string; decisionReason: string; decidedAt: string;
  }): Promise<boolean>;
}

export interface JuliusLifecycleStore {
  /** Move every non-terminal task of a run to CANCELLED. Returns how many. */
  cancelRunTasks(runId: string, projectId: string, now: string): Promise<number>;
  /** Record who asked for a lifecycle change and why. */
  recordLifecycle(input: {
    runId: string; projectId: string; reason: string; actor: string; at: string;
  }): Promise<boolean>;
}

/* ------------------------------------------------------------- outcomes */

export type JuliusApprovalRequestOutcome =
  | { readonly requested: true; readonly record: JuliusApprovalRecord; readonly duplicate: boolean; readonly runState: JuliusMissionState }
  | { readonly requested: false; readonly reasonCode: string; readonly safeMessage: string };

export type JuliusApprovalDecisionOutcome =
  | { readonly decided: true; readonly state: JuliusApprovalState; readonly runState: JuliusMissionState; readonly duplicate: boolean }
  | { readonly decided: false; readonly reasonCode: string; readonly safeMessage: string };

export type JuliusLifecycleOutcome =
  | { readonly applied: true; readonly from: JuliusMissionState; readonly to: JuliusMissionState; readonly cancelledTasks: number; readonly duplicate: boolean }
  | { readonly applied: false; readonly reasonCode: string; readonly safeMessage: string };

export interface JuliusLifecycleDependencies {
  readonly store: JuliusApprovalStore & JuliusLifecycleStore & Pick<JuliusRunWriter, 'loadRun' | 'transition'>;
  readonly clock: JuliusClock;
  /** Optional, and its absence is visible: no ledger, no events. */
  readonly events?: JuliusEventWriter;
  readonly ids?: JuliusIdFactory;
}

type LifecycleEventType = Extract<JuliusOperationalEventType,
  'approval.requested' | 'approval.decided' | 'task.cancelled'
  | 'run.paused' | 'run.resumed' | 'run.cancelled'>;

/** Which event a lifecycle target announces. Total, so a new state cannot be silent. */
const LIFECYCLE_EVENT: Readonly<Partial<Record<JuliusMissionState, LifecycleEventType>>> = Object.freeze({
  PAUSED: 'run.paused', READY: 'run.resumed', CANCELLED: 'run.cancelled',
});

async function emit(
  deps: JuliusLifecycleDependencies,
  run: { runId: string; projectId: string },
  type: LifecycleEventType,
  facts: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (deps.events === undefined || deps.ids === undefined) return;
  const event = {
    eventId: deps.ids.next(`event:${type}`), runId: run.runId, projectId: run.projectId,
    type, taskId: typeof facts.taskId === 'string' ? facts.taskId : null, workerId: null,
    correlationId: String(facts.approvalId ?? run.runId), causationId: null,
    occurredAt: deps.clock.now(), facts,
  } as const;
  validateJuliusEvent(event);
  await deps.events.appendEvent(event);
}

/**
 * WHO MAY APPROVE.
 *
 * A port, not a list. Relay owns identity and Julius owns execution, so the
 * runtime asks rather than deciding — and it refuses when the port cannot
 * answer, because "we could not check" is not "yes".
 */
export interface JuliusApproverAuthority {
  mayApprove(input: {
    projectId: string; runId: string; approverId: string; operation: JuliusPolicyOperation;
  }): Promise<boolean>;
}

/* ------------------------------------------------- requesting an approval */

/**
 * Record a gated operation and put the run somewhere it cannot dispatch from.
 *
 * The run moves to BLOCKED rather than PAUSED. Both stop new claims, and they
 * mean different things to a person reading a run list: PAUSED is somebody's
 * decision and BLOCKED is the run waiting on something. An approval is the
 * second, and collapsing them would make "who paused this?" unanswerable.
 */
export async function requestJuliusApproval(
  input: {
    readonly run: JuliusRunRow;
    readonly approvalId: string;
    readonly taskId: string | null;
    readonly operation: JuliusPolicyOperation;
    readonly policyRevision: string;
    readonly reasonCode: string;
    readonly safeRationale: string;
    readonly idempotencyKey: string;
  },
  deps: JuliusLifecycleDependencies,
): Promise<JuliusApprovalRequestOutcome> {
  const now = deps.clock.now();
  const record: JuliusApprovalRecord = {
    approvalId: input.approvalId, runId: input.run.runId, projectId: input.run.projectId,
    taskId: input.taskId, operation: input.operation, policyRevision: input.policyRevision,
    reasonCode: input.reasonCode, safeRationale: input.safeRationale,
    state: 'PENDING', requestedAt: now, decidedAt: null, decidedBy: null,
    decisionReason: null, idempotencyKey: input.idempotencyKey,
  };
  const atomic=deps.store.requestApprovalAndBlock;
  const stored=atomic===undefined?await deps.store.requestApproval(record):await atomic.call(deps.store,{record,expectedRunVersion:input.run.version});
  const moved:JuliusMissionState='runState'in stored?stored.runState as JuliusMissionState:await moveRun(input.run, 'BLOCKED', {reasonCode:'APPROVAL_REQUIRED',safeSummary:`Waiting on an authorized approval for ${input.operation}.`}, deps);

  await emit(deps, input.run, 'approval.requested', {
    approvalId: stored.record.approvalId, taskId: input.taskId, operation: input.operation,
    reasonCode: input.reasonCode, duplicate: !stored.created,
  });
  return { requested: true, record: stored.record, duplicate: !stored.created, runState: moved };
}

/* -------------------------------------------------- deciding an approval */

export async function decideJuliusApproval(
  input: {
    readonly runId: string;
    readonly projectId: string;
    readonly approvalId: string;
    readonly decision: 'APPROVED' | 'DENIED';
    readonly approverId: string;
    readonly reason: string;
  },
  deps: JuliusLifecycleDependencies & { readonly approvers: JuliusApproverAuthority },
): Promise<JuliusApprovalDecisionOutcome> {
  const run = await deps.store.loadRun(input.runId, input.projectId);
  if (run === null) {
    return { decided: false, reasonCode: 'RUN_NOT_FOUND', safeMessage: 'No such run in this project.' };
  }
  const approval = await deps.store.loadApproval(input.runId, input.approvalId, input.projectId);
  if (approval === null) {
    return { decided: false, reasonCode: 'APPROVAL_NOT_FOUND', safeMessage: 'No such approval in this run.' };
  }

  // A CANCELLED RUN CANNOT BE APPROVED INTO LIFE. The approval is answered as
  // cancelled rather than as approved, so the record shows what happened
  // instead of showing an approval that never took effect.
  if (run.state === 'CANCELLED') {
    await deps.store.decideApproval({
      runId: input.runId, approvalId: input.approvalId, projectId: input.projectId,
      state: 'CANCELLED', decidedBy: input.approverId,
      decisionReason: 'The run was cancelled before this approval was answered.',
      decidedAt: deps.clock.now(),
    });
    return { decided: false, reasonCode: 'RUN_CANCELLED', safeMessage: 'This run was cancelled before the approval was answered.' };
  }

  if (approval.state !== 'PENDING') {
    // ALREADY DECIDED IS NOT AN ERROR. A retried submit sees the same answer,
    // and a second approver racing the first loses without anything breaking.
    return { decided: true, state: approval.state, runState: run.state, duplicate: true };
  }

  if (!input.approverId.trim() || !input.reason.trim()) {
    return { decided: false, reasonCode: 'APPROVER_REQUIRED', safeMessage: 'An approval records who decided it and why. Neither may be blank.' };
  }

  const permitted = await deps.approvers.mayApprove({
    projectId: input.projectId, runId: input.runId,
    approverId: input.approverId, operation: approval.operation,
  });
  if (!permitted) {
    return { decided: false, reasonCode: 'APPROVER_NOT_AUTHORIZED', safeMessage: 'This identity may not approve that operation for this run.' };
  }

  const decided = await deps.store.decideApproval({
    runId: input.runId, approvalId: input.approvalId, projectId: input.projectId,
    state: input.decision, decidedBy: input.approverId,
    decisionReason: input.reason, decidedAt: deps.clock.now(),
  });
  if (!decided) {
    // Lost the race to another approver between the read and the write.
    const reloaded = await deps.store.loadApproval(input.runId, input.approvalId, input.projectId);
    return { decided: true, state: reloaded?.state ?? approval.state, runState: run.state, duplicate: true };
  }

  /* ---------------------------------------------- what the run does next */
  await emit(deps, run, 'approval.decided', {
    approvalId: input.approvalId, taskId: approval.taskId, operation: approval.operation,
    decision: input.decision, decidedBy: input.approverId,
  });

  if (input.decision === 'DENIED') {
    const to = await moveRun(run, 'FAILED', {
      reasonCode: 'APPROVAL_DENIED',
      safeSummary: `An authorized approver denied ${approval.operation}.`,
    }, deps);
    return { decided: true, state: 'DENIED', runState: to, duplicate: false };
  }

  // APPROVED — but only back to work when nothing ELSE is still waiting. A run
  // with two gates open must not resume because one of them was answered.
  const stillPending = await deps.store.pendingApprovals(input.runId, input.projectId);
  if (stillPending.length > 0) {
    return { decided: true, state: 'APPROVED', runState: run.state, duplicate: false };
  }
  const to = await moveRun(run, 'READY', {
    reasonCode: 'APPROVAL_GRANTED',
    safeSummary: `An authorized approver granted ${approval.operation}.`,
  }, deps);
  return { decided: true, state: 'APPROVED', runState: to, duplicate: false };
}

/* --------------------------------------------------- pause / resume / cancel */

export async function pauseJuliusRun(
  input: { runId: string; projectId: string; actor: string; reason: string },
  deps: JuliusLifecycleDependencies,
): Promise<JuliusLifecycleOutcome> {
  return lifecycle(input, 'PAUSED', 'OPERATOR_PAUSED', deps, false);
}

export async function resumeJuliusRun(
  input: { runId: string; projectId: string; actor: string; reason: string },
  deps: JuliusLifecycleDependencies,
): Promise<JuliusLifecycleOutcome> {
  const run = await deps.store.loadRun(input.runId, input.projectId);
  if (run === null) return { applied: false, reasonCode: 'RUN_NOT_FOUND', safeMessage: 'No such run in this project.' };
  if (run.state !== 'PAUSED') {
    // RESUMING SOMETHING THAT IS NOT PAUSED IS NOT A RESUME. Reporting success
    // would tell an operator their run is running when it is blocked.
    return {
      applied: false, reasonCode: 'RUN_NOT_PAUSED',
      safeMessage: `This run is ${run.state}, not PAUSED, so there is nothing to resume.`,
    };
  }
  return lifecycle(input, 'READY', 'OPERATOR_RESUMED', deps, false);
}

/**
 * Cancel a run and stop the work already in it.
 *
 * IDEMPOTENT BY OBSERVATION, not by a key: a run that is already CANCELLED
 * reports success with `duplicate: true`, because the caller's intent is
 * satisfied and re-cancelling has nothing left to do.
 */
export async function cancelJuliusRun(
  input: { runId: string; projectId: string; actor: string; reason: string },
  deps: JuliusLifecycleDependencies,
): Promise<JuliusLifecycleOutcome> {
  return lifecycle(input, 'CANCELLED', 'OPERATOR_CANCELLED', deps, true);
}

async function lifecycle(
  input: { runId: string; projectId: string; actor: string; reason: string },
  to: JuliusMissionState,
  reasonCode: string,
  deps: JuliusLifecycleDependencies,
  cancelTasks: boolean,
): Promise<JuliusLifecycleOutcome> {
  const run = await deps.store.loadRun(input.runId, input.projectId);
  if (run === null) return { applied: false, reasonCode: 'RUN_NOT_FOUND', safeMessage: 'No such run in this project.' };
  if (!input.actor.trim() || !input.reason.trim()) {
    return {
      applied: false, reasonCode: 'ACTOR_AND_REASON_REQUIRED',
      safeMessage: 'A lifecycle change records who asked and why. Neither may be blank.',
    };
  }
  if (run.state === to) {
    const cancelled = cancelTasks ? await deps.store.cancelRunTasks(input.runId, input.projectId, deps.clock.now()) : 0;
    return { applied: true, from: run.state, to, cancelledTasks: cancelled, duplicate: true };
  }
  if (!reachable(run.state, to)) {
    return {
      applied: false, reasonCode: 'TRANSITION_NOT_LEGAL',
      safeMessage: `A run in ${run.state} cannot move to ${to}.`,
    };
  }

  await deps.store.recordLifecycle({
    runId: input.runId, projectId: input.projectId,
    reason: input.reason, actor: input.actor, at: deps.clock.now(),
  });
  const state = await moveRun(run, to, { reasonCode, safeSummary: `${reasonCode}: ${input.reason}` }, deps);
  // TASKS ARE CANCELLED AFTER THE RUN IS, never before. A task cancelled while
  // its run is still EXECUTING would be reclaimed by the next tick.
  if (state !== to) {
    // The move was legal when it was checked and did not land — another writer
    // moved the run between the read and the write. Reporting success would
    // tell an operator their run is paused when somebody else cancelled it.
    return {
      applied: false, reasonCode: 'CONCURRENT_LIFECYCLE_CHANGE',
      safeMessage: `This run moved to ${state} while the change was being applied. Re-read it and decide again.`,
    };
  }
  const cancelled = cancelTasks
    ? await deps.store.cancelRunTasks(input.runId, input.projectId, deps.clock.now())
    : 0;
  const announcement = LIFECYCLE_EVENT[to];
  if (announcement !== undefined) {
    await emit(deps, run, announcement, {
      actor: input.actor, reason: input.reason.slice(0, 200), from: run.state,
    });
  }
  if (cancelled > 0) {
    // ONE EVENT FOR THE SWEEP, not one per task. A cancellation is a single
    // decision, and a hundred events for a hundred tasks would bury the fact
    // that one person cancelled one run.
    await emit(deps, run, 'task.cancelled', {
      cancelledTasks: cancelled, actor: input.actor, reason: input.reason.slice(0, 200),
    });
  }
  return { applied: true, from: run.state, to: state, cancelledTasks: cancelled, duplicate: false };
}

/* ------------------------------------------------------------- internals */

/**
 * Whether a run can REACH a state, in one step or several.
 *
 * A gated operation must move a READY run to BLOCKED and `READY → BLOCKED` is
 * not a transition — a run reaches BLOCKED from EXECUTING. Checking only the
 * single step made every approval request a silent no-op: the record was
 * written, the run stayed READY, and the scheduler kept handing out work for
 * an operation nobody had approved. The walk lives in `julius-state-path.ts`,
 * shared with the run loop, so neither keeps a copy of the table.
 */
function reachable(from: JuliusMissionState, to: JuliusMissionState): boolean {
  return planRunStatePath(from, to).length > 0;
}

/**
 * Move a run, tolerating both an illegal target and a lost version race.
 *
 * Returns the state the run is ACTUALLY in afterwards, which may be the one it
 * started in. A caller that assumed success would report a paused run to an
 * operator who paused nothing.
 */
async function moveRun(
  run: JuliusRunRow,
  to: JuliusMissionState,
  detail: { reasonCode: string; safeSummary: string },
  deps: JuliusLifecycleDependencies,
): Promise<JuliusMissionState> {
  const path = planRunStatePath(run.state, to);
  if (path.length === 0) return run.state;
  let current = run;
  for (const [index, step] of path.entries()) {
    const last = index === path.length - 1;
    try {
      current = await deps.store.transition({
        commandId: `lifecycle:${run.runId}:${current.version}:${step}`,
        runId: run.runId, projectId: run.projectId, expectedVersion: current.version,
        to: step,
        reasonCode: last ? detail.reasonCode : 'PASSED_THROUGH',
        safeSummary: last ? detail.safeSummary : `Run passed through ${step} on the way to ${to}.`,
        evidenceIds: [], occurredAt: deps.clock.now(),
      });
    } catch {
      const reloaded = await deps.store.loadRun(run.runId, run.projectId);
      return reloaded?.state ?? current.state;
    }
  }
  return current.state;
}
