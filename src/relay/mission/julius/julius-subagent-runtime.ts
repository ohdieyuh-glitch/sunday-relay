/**
 * SUB-AGENTS THAT ACTUALLY EXECUTE.
 *
 * #172 built `authorizeSubagent`: a pure function that checks C.A.R.D., depth,
 * count and permission narrowing, and returns a child task. Nothing called it,
 * nothing stored its answer, and the child task it returned never entered the
 * durable graph — so no bound survived a restart and no child ever ran.
 *
 * THIS DOES NOT REPLACE IT. `authorizeSubagent` remains the authorization
 * rule and is called here. What is added is everything around it: reading the
 * real depth and counts from the store instead of trusting the request,
 * reserving budget before the child exists, inserting the child into the task
 * graph so the NORMAL scheduler claims it, recording the grant durably, and
 * turning a denial into a value.
 *
 * A SUB-AGENT IS NOT AN ALTERNATE RUNTIME. The child is an ordinary
 * `julius_tasks` row with a `parent_task_id`. It is claimed by the same
 * `claimRunnable`, dispatched by the same pipeline, budgeted by the same
 * reservation ledger and verified by the same evaluator. There is no second
 * execution path here and adding one would be the defect this file exists to
 * avoid.
 *
 * ONE INHERITED SEMANTIC IS PINNED AND NOT CHANGED. `evaluateJuliusPolicy`
 * refuses a spawn when `depth >= maxDepth`, and a child's depth is
 * `parentDepth + 1` — so `maxDepth: 1` permits no children at all and
 * `maxDepth: 2` permits exactly one level. The same `>=` is right for
 * `maxActive` and `maxTotal`, where the value counts children that ALREADY
 * exist, and off by one for depth, where the value is the prospective new
 * depth. Loosening a C.A.R.D. bound is a product decision rather than a wiring
 * fix, and erring strict is the safe direction, so the behaviour is left alone,
 * asserted by a test so it cannot drift, and written down in the runtime docs
 * so it can be decided deliberately.
 *
 * DENIAL IS A VALUE. `authorizeSubagent` throws when policy refuses, which is
 * right for a rule and wrong for a runtime: a worker asking for a child it may
 * not have is an ordinary event, not an exception. This wraps the throw into
 * a discriminated outcome so the caller must handle refusal.
 */

import { authorizeSubagent, type JuliusSubagentRequest } from './julius-bounded-runtime';
import { evaluateJuliusPolicy, type JuliusCardPolicy } from './julius-policy';
import type { JuliusTask, JuliusWorkerRole } from './julius-runtime';
import type { JuliusBudgetPort, JuliusClock, JuliusEventWriter, JuliusIdFactory, JuliusRunRow } from './julius-runtime-ports';
import { validateJuliusEvent, type JuliusOperationalEventType } from './julius-events';
import { JULIUS_RUNTIME_VERSION } from './julius-runtime';
import { validateTrajectoryEvent } from './julius-trajectory';
import type { JuliusTrajectoryWriter } from './julius-runtime-ports';

/* --------------------------------------------------------------- records */

export const JULIUS_SUBAGENT_STATES = ['AUTHORIZED', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type JuliusSubagentState = (typeof JULIUS_SUBAGENT_STATES)[number];

export interface JuliusSubagentRecord {
  readonly requestId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly parentTaskId: string;
  readonly childTaskId: string;
  readonly depth: number;
  readonly capability: string;
  readonly permissions: readonly string[];
  readonly budgetReservationId: string;
  readonly state: JuliusSubagentState;
}

/**
 * WHAT THE STORE KNOWS ABOUT A PARENT, read rather than supplied.
 *
 * The inherited `JuliusSubagentRequest` carries `parentDepth`, `activeChildren`
 * and `totalChildren` as request FIELDS — which means a worker asking for a
 * child could state its own depth as zero and be believed. Every one of those
 * numbers is now read from the store, and the request's copies are ignored.
 */
export interface JuliusSubagentContext {
  readonly parentDepth: number;
  readonly activeChildren: number;
  readonly totalChildren: number;
  /** What the PARENT actually holds. A child can only ever be granted a subset. */
  readonly parentPermissions: readonly string[];
}

export interface JuliusSubagentStore {
  /** Depth, live counts and the parent's permissions, from durable state. */
  subagentContext(runId: string, parentTaskId: string): Promise<JuliusSubagentContext>;
  /** Idempotent by `requestId`: a retried spawn returns the first grant. */
  recordSubagent(record: JuliusSubagentRecord): Promise<{ readonly recorded: boolean; readonly duplicate: boolean }>;
  /** Production transaction: locks the run, rechecks bounds, and inserts task+grant together. */
  recordSubagentAndTaskWithinLimits?(input:{record:JuliusSubagentRecord;task:JuliusTask;maxActive:number;maxTotal:number;maxDepth:number}):Promise<{recorded:boolean;duplicate:boolean;denialReason:string|null}>;
  loadSubagent(runId: string, requestId: string): Promise<JuliusSubagentRecord | null>;
  subagentsForRun(runId: string): Promise<readonly JuliusSubagentRecord[]>;
  setSubagentState(runId: string, requestId: string, state: JuliusSubagentState): Promise<boolean>;
}

/* -------------------------------------------------------------- outcomes */

export type JuliusSubagentOutcome =
  | { readonly authorized: true; readonly record: JuliusSubagentRecord; readonly childTask: JuliusTask; readonly duplicate: boolean }
  | { readonly authorized: false; readonly reasonCode: string; readonly safeMessage: string };

/* ------------------------------------------------------------- the spawn */

export interface JuliusSubagentSpawnInput {
  readonly run: JuliusRunRow;
  readonly policy: JuliusCardPolicy;
  readonly requestId: string;
  readonly parentTaskId: string;
  readonly role: JuliusWorkerRole;
  readonly taskType: string;
  readonly capability: string;
  readonly requestedPermissions: readonly string[];
  /**
   * The authority the RUN holds, used when the parent is a root task and
   * therefore has no sub-agent record of its own. Supplied by the caller from
   * the mission's granted permissions; never inferred.
   */
  readonly runPermissions: readonly string[];
  readonly usdMicros: number;
}

export interface JuliusSubagentDependencies {
  readonly store: JuliusSubagentStore & {
    addTask(input: { commandId: string; runId: string; projectId: string; task: JuliusTask }): Promise<boolean>;
  };
  readonly budget: JuliusBudgetPort;
  readonly clock: JuliusClock;
  readonly ids: JuliusIdFactory;
  /**
   * OPTIONAL, AND THE ABSENCE IS HONEST. A caller with no ledger attached gets
   * the authorization and the durable grant and no events — which is exactly
   * what a test double wants, and is visibly different from a caller whose
   * events silently went nowhere.
   */
  readonly events?: JuliusEventWriter;
  /** Optional for the same reason `events` is: absent means no facts, visibly. */
  readonly trajectory?: JuliusTrajectoryWriter;
}

/** One SUBAGENT trajectory fact, when a trajectory sink is attached. */
async function trace(
  deps: Pick<JuliusSubagentDependencies, 'trajectory' | 'clock' | 'ids'>,
  run: JuliusRunRow,
  input: { requestId: string; taskId: string | null; outcome: string; usdMicros: number | null; facts: Record<string, string | number | boolean | null> },
): Promise<void> {
  if (deps.trajectory === undefined) return;
  const event = {
    trajectoryEventId: deps.ids.next('trajectory:SUBAGENT'),
    runId: run.runId, projectId: run.projectId, kind: 'SUBAGENT' as const,
    taskId: input.taskId, workerId: null, providerId: null, contextId: null,
    runtimeVersion: JULIUS_RUNTIME_VERSION, policyVersion: run.cardRevision,
    cardRevision: run.cardRevision, missionContractRevision: run.missionContractRevision,
    projectBrainRevision: run.projectBrainRevision,
    durationMs: null, usdMicros: input.usdMicros, inputTokens: null, outputTokens: null,
    outcome: input.outcome, safeFacts: input.facts,
    idempotencyKey: `subagent:${input.requestId}:${input.outcome}`,
    occurredAt: deps.clock.now(),
  };
  validateTrajectoryEvent(event);
  await deps.trajectory.appendTrajectory(event);
}

/** Emit one sub-agent event, when a ledger is attached. */
async function emit(
  deps: Pick<JuliusSubagentDependencies, 'events' | 'clock' | 'ids'>,
  run: JuliusRunRow,
  type: Extract<JuliusOperationalEventType, 'subagent.spawned' | 'subagent.denied' | 'subagent.completed'>,
  facts: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (deps.events === undefined) return;
  const event = {
    eventId: deps.ids.next(`event:${type}`), runId: run.runId, projectId: run.projectId,
    type, taskId: typeof facts.taskId === 'string' ? facts.taskId : null,
    workerId: null, correlationId: String(facts.requestId ?? run.runId), causationId: null,
    occurredAt: deps.clock.now(), facts,
  } as const;
  validateJuliusEvent(event);
  await deps.events.appendEvent(event);
}

/**
 * Authorize, bound, budget, insert and record — in that order.
 *
 * THE ORDER IS DELIBERATE AND EACH STEP IS UNDONE ON FAILURE. Budget is
 * reserved before the child task exists, because a child in the graph with no
 * reservation is work the run cannot pay for and will discover only when it is
 * claimed. If the insert then fails, the reservation is released rather than
 * left held against a child that does not exist.
 */
export async function spawnJuliusSubagent(
  input: JuliusSubagentSpawnInput,
  deps: JuliusSubagentDependencies,
): Promise<JuliusSubagentOutcome> {
  /* ------------------------------------------ reserved task namespaces */
  // `repair:` types are the repair planner's lineage signal — completion
  // supersedes a REPAIR decision through children carrying them — and
  // `review:` types are how the verification phase recognizes completed
  // reviews. A sub-agent minting either would let ordinary child work
  // impersonate verification machinery, so both namespaces are refused
  // before anything is read, reserved, or recorded.
  if (input.taskType.startsWith('repair:') || input.taskType.startsWith('review:')) {
    return {
      authorized: false, reasonCode: 'SUBAGENT_TASK_TYPE_RESERVED',
      safeMessage: 'Sub-agent tasks may not use the reserved repair:/review: task-type namespaces.',
    };
  }

  /* --------------------------------------- the reviewer is not a swarm member */
  // THE ROLE WAS A SEPARATE QUESTION FROM THE TASK TYPE, and it was unguarded.
  // The namespace refusal above stops a child impersonating verification
  // machinery; it does not stop a child BEING the Independent Reviewer under an
  // ordinary task type. `authorizeSubagent` copies the requested role straight
  // onto the child, so a Coding Agent could spawn a reviewer-role child that
  // entered the durable graph and was routed to the reviewer's own worker.
  //
  // It could not launder an acceptance — no `review:` type, so the verification
  // phase never counts it — and it is still a breach: the reviewer is the one
  // role whose whole value is being no part of the work it judges, and a child of
  // the coder's task spending the mission's budget on the reviewer's provider is
  // the reviewer INSIDE the swarm. Julius creates review work. A worker asks for
  // help; it does not appoint its own judge.
  //
  // Exactly one role wide, deliberately: a guard that refused every role but the
  // parent's would forbid the specialisation a swarm exists for.
  if (input.role === 'INDEPENDENT_REVIEWER') {
    return {
      authorized: false, reasonCode: 'SUBAGENT_ROLE_RESERVED',
      safeMessage: 'A sub-agent may not hold the Independent Reviewer role; review work belongs to Julius.',
    };
  }

  /* -------------------------------------------------- already granted? */
  const existing = await deps.store.loadSubagent(input.run.runId, input.requestId);
  if (existing !== null) {
    return {
      authorized: true, duplicate: true, record: existing,
      childTask: childTaskFrom(existing, input),
    };
  }

  /* ---------------------------------- the policy gate, before anything */
  const gate = evaluateJuliusPolicy(input.policy, { operation: 'SPAWN_SUBAGENT' });
  if (gate.effect === 'REQUIRE_APPROVAL') {
    await emit(deps, input.run, 'subagent.denied', {
      requestId: input.requestId, taskId: input.parentTaskId, reasonCode: 'SUBAGENT_APPROVAL_REQUIRED',
    });
    return { authorized: false, reasonCode: 'SUBAGENT_APPROVAL_REQUIRED', safeMessage: gate.safeRationale };
  }

  /* ------------------------------------- real depth and counts, not claimed */
  const context = await deps.store.subagentContext(input.run.runId, input.parentTaskId);
  const parentPermissions = context.parentDepth === 0 ? input.runPermissions : context.parentPermissions;

  const reservationId = `reservation:subagent:${input.run.runId}:${input.requestId}`;
  const reservation = await deps.budget.reserve({
    reservationId, runId: input.run.runId, projectId: input.run.projectId, taskId: input.parentTaskId,
    usdMicros: input.usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0,
    now: deps.clock.now(),
  });
  if (reservation.state === 'DENIED') {
    await emit(deps, input.run, 'subagent.denied', {
      requestId: input.requestId, taskId: input.parentTaskId, reasonCode: 'SUBAGENT_BUDGET_DENIED',
    });
    return {
      authorized: false, reasonCode: 'SUBAGENT_BUDGET_DENIED',
      safeMessage: reservation.denialReason ?? 'The budget did not permit a sub-agent.',
    };
  }

  /* ------------------------------------------ the inherited authorization */
  const request: JuliusSubagentRequest = {
    requestId: input.requestId, runId: input.run.runId, parentTaskId: input.parentTaskId,
    parentDepth: context.parentDepth,
    activeChildren: context.activeChildren,
    totalChildren: context.totalChildren,
    role: input.role, taskType: input.taskType, capability: input.capability,
    requestedPermissions: input.requestedPermissions,
    parentPermissions,
    budgetReservationId: reservationId,
  };

  let authorized;
  try {
    authorized = authorizeSubagent(input.policy, request);
  } catch (error) {
    await deps.budget.release({ reservationId, reason: 'SUBAGENT_DENIED', now: deps.clock.now() });
    const reasonCode = error instanceof Error ? error.message : 'subagent_denied';
    await emit(deps, input.run, 'subagent.denied', {
      requestId: input.requestId, taskId: input.parentTaskId, reasonCode,
    });
    return { authorized: false, reasonCode, safeMessage: 'The sub-agent request was refused.' };
  }

  /* ---------------------------------------- into the ONE durable task graph */
  const record: JuliusSubagentRecord = {
    requestId: input.requestId,
    runId: input.run.runId,
    projectId: input.run.projectId,
    parentTaskId: input.parentTaskId,
    childTaskId: authorized.childTask.taskId,
    depth: authorized.depth,
    capability: input.capability,
    permissions: authorized.permissions,
    budgetReservationId: reservationId,
    state: 'AUTHORIZED',
  };
  const childTask = childTaskFrom(record, input);

  const atomic=deps.store.recordSubagentAndTaskWithinLimits;
  const atomicStored=atomic===undefined?null:await atomic.call(deps.store,{record,task:childTask,maxActive:input.policy.subagents.maxActive,maxTotal:input.policy.subagents.maxTotal,maxDepth:input.policy.subagents.maxDepth});
  if(atomicStored?.denialReason){await deps.budget.release({reservationId,reason:atomicStored.denialReason,now:deps.clock.now()});return{authorized:false,reasonCode:atomicStored.denialReason,safeMessage:'The durable sub-agent bound was reached.'};}
  if(atomicStored?.duplicate){await deps.budget.release({reservationId,reason:'SUBAGENT_DUPLICATE',now:deps.clock.now()});const durable=await deps.store.loadSubagent(input.run.runId,input.requestId);if(durable===null)throw new Error('subagent_duplicate_missing');return{authorized:true,duplicate:true,record:durable,childTask:childTaskFrom(durable,input)};}
  const inserted = atomicStored===null?await deps.store.addTask({
    commandId: `subagent:${input.requestId}`,
    runId: input.run.runId, projectId: input.run.projectId, task: childTask,
  }):true;
  if (!inserted) {
    await deps.budget.release({ reservationId, reason: 'SUBAGENT_TASK_EXISTS', now: deps.clock.now() });
    return {
      authorized: false, reasonCode: 'SUBAGENT_TASK_ALREADY_EXISTS',
      safeMessage: 'A task with this sub-agent id already exists in the run.',
    };
  }

  const stored = atomicStored??await deps.store.recordSubagent(record);
  await emit(deps, input.run, 'subagent.spawned', {
    requestId: input.requestId, taskId: childTask.taskId, parentTaskId: record.parentTaskId,
    depth: record.depth, capability: record.capability, permissions: record.permissions.length,
  });
  await trace(deps, input.run, {
    requestId: input.requestId, taskId: childTask.taskId, outcome: 'AUTHORIZED',
    usdMicros: input.usdMicros,
    facts: { depth: record.depth, capability: record.capability, permissions: record.permissions.length },
  });
  return { authorized: true, duplicate: stored.duplicate, record, childTask };
}

/**
 * THE CHILD TASK, WITH THE FIELD #172 GOT WRONG.
 *
 * `authorizeSubagent` builds its child with `missionId: request.runId` — the
 * RUN id in the MISSION field. Both `JuliusTaskGraph.add` and the durable
 * `addTask` compare a task's `missionId` against the run's, so every
 * sub-agent child would have been rejected as a cross-mission reference the
 * moment anything tried to insert one. Nothing ever did, so the defect was
 * invisible.
 *
 * The child is rebuilt here from the run's real `missionId` rather than
 * patched in place, and `authorizeSubagent` is left alone: it is #172's
 * authorization rule and its answer about permissions, depth and counts is
 * still the one used.
 *
 * The ordinal is derived from the PARENT's, so a child sorts immediately after
 * the task that asked for it rather than at position `totalChildren`, which is
 * a count and not a position.
 */
function childTaskFrom(record: JuliusSubagentRecord, input: JuliusSubagentSpawnInput): JuliusTask {
  return {
    taskId: record.childTaskId,
    missionId: input.run.missionId,
    parentTaskId: record.parentTaskId,
    dependencyIds: [],
    requiredEvidenceTypes: [],
    taskType: input.taskType,
    role: input.role,
    ordinal: record.depth,
    // RUNNABLE, not BLOCKED: a sub-agent has no dependency to wait on. The
    // parent is already ACTIVE and waiting for the child's result.
    state: 'RUNNABLE',
  };
}

/* ------------------------------------------------------------ completion */

/**
 * Resolve a sub-agent when its child task reaches a terminal state, and hand
 * back whatever budget the child did not use.
 *
 * A PARENT DOES NOT RESUME HERE. The parent is an ordinary task and the
 * scheduler is what re-offers it; teaching this function to wake a parent
 * would be the second execution path this module exists to avoid.
 */
export async function settleJuliusSubagent(
  input: { runId: string; requestId: string; state: Extract<JuliusSubagentState, 'SUCCEEDED' | 'FAILED' | 'CANCELLED'> },
  deps: Pick<JuliusSubagentDependencies, 'store' | 'budget' | 'clock' | 'ids' | 'events'>,
): Promise<{ readonly settled: boolean }> {
  const record = await deps.store.loadSubagent(input.runId, input.requestId);
  if (record === null) return { settled: false };
  const changed = await deps.store.setSubagentState(input.runId, input.requestId, input.state);
  if (input.state !== 'SUCCEEDED') {
    await deps.budget.release({ reservationId: record.budgetReservationId, reason: `SUBAGENT_${input.state}`, now: deps.clock.now() });
  }
  if (changed) {
    await emit(
      { events: deps.events, clock: deps.clock, ids: deps.ids },
      { runId: record.runId, projectId: record.projectId } as never,
      'subagent.completed',
      { requestId: record.requestId, taskId: record.childTaskId, state: input.state, depth: record.depth },
    );
  }
  return { settled: changed };
}
