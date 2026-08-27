/**
 * ONE CLAIMED TASK, ALL THE WAY THROUGH.
 *
 * This is the composition the inherited stack was missing. Every component it
 * calls already existed and none of them called each other:
 *
 *   policy      → `evaluateJuliusPolicy`      (#171)
 *   context     → `createJuliusContextSnapshot` (#176)
 *   execution   → `JuliusExecutionCoordinator`  (#174) — which itself owns
 *                 routing, budget reservation, dispatch, evidence
 *                 normalization, result acceptance and retry classification
 *   verification→ `evaluateJuliusVerification`  (#175)
 *   repair      → `planJuliusRepair`            (#177)
 *
 * NOTHING HERE REIMPLEMENTS ANY OF THEM. Where this file contains logic at all
 * it is sequencing, tenancy and the translation between one component's output
 * and the next one's input — which is exactly the work that was absent.
 *
 * THE ORDER IS THE PRODUCT. Policy runs BEFORE a context snapshot is compiled,
 * because compiling context for an operation C.A.R.D. forbids is work nobody
 * authorized. The snapshot is persisted BEFORE dispatch, because a dispatch
 * whose context cannot be reproduced cannot be audited. Budget is reserved
 * before the provider call and released on every failure path. Verification
 * runs after the result is accepted, not after it is merely received.
 *
 * A DOUBLE TRANSITION AVOIDED. `acceptWorkerResult` already moves the task out
 * of ACTIVE inside its own serializable transaction. So `finishTask` is called
 * ONLY on the paths where no worker result was ever accepted — a policy
 * denial, a budget denial, a dispatch that failed before a result. Calling it
 * on the success path would be a second writer for one fact, and would fail
 * silently because the task is no longer ACTIVE.
 */

import { evaluateJuliusPolicy, type JuliusCardPolicy } from './julius-policy';
import { JuliusExecutionCoordinator, type JuliusExecutionPorts, type JuliusExecutionClaim, type JuliusResourceRequest } from './julius-execution-coordinator';
import type { JuliusProviderRouter } from './julius-router';
import { createJuliusContextSnapshot } from './julius-context-snapshot';
import { evaluateJuliusVerification, type JuliusVerificationPolicy } from './julius-verification-runtime';
import { planJuliusRepair } from './julius-repair-runtime';
import { JULIUS_RUNTIME_VERSION, type JuliusTask, type JuliusVerificationDecision, type JuliusWorker } from './julius-runtime';
import { validateJuliusEvent, type JuliusOperationalEvent, type JuliusOperationalEventType } from './julius-events';
import { validateTrajectoryEvent, type JuliusTrajectoryEvent, type JuliusTrajectoryKind } from './julius-trajectory';
import {
  resolveWorkerRole,
  type JuliusBudgetPort,
  type JuliusClaimedTask,
  type JuliusClock,
  type JuliusIdFactory,
  type JuliusRunRow,
  type JuliusRuntimeStore,
} from './julius-runtime-ports';

/* --------------------------------------------------------------- inputs */

/**
 * HOW MUCH A TASK IS EXPECTED TO COST.
 *
 * A port, not a constant. The runtime must reserve budget before dispatch and
 * it has no honest way to know a task's cost in advance, so it refuses to
 * invent one: a deployment supplies an estimator and its choice is visible.
 * `fixedResourceEstimate` exists so a caller can be explicit about using a
 * flat ceiling rather than silently getting one.
 */
export interface JuliusResourceEstimator {
  estimate(task: { taskId: string; taskType: string; role: string; attempt: number }): JuliusResourceRequest;
}

export function fixedResourceEstimate(request: JuliusResourceRequest): JuliusResourceEstimator {
  return { estimate: () => request };
}

/** What a task needs in order to be dispatched at all. */
export interface JuliusPipelineDependencies {
  readonly store: JuliusRuntimeStore;
  readonly router: JuliusProviderRouter;
  readonly budget: JuliusBudgetPort;
  readonly clock: JuliusClock;
  readonly ids: JuliusIdFactory;
  readonly resources: JuliusResourceEstimator;
  /** Whoever holds the lease. Recorded on every event for attribution. */
  readonly owner: string;
  /** Context budget in characters. Compiling is bounded, never open-ended. */
  readonly contextCharacterBudget: number;
}

export interface JuliusPipelineRequest {
  readonly claim: JuliusClaimedTask;
  readonly policy: JuliusCardPolicy;
  readonly verification: JuliusVerificationPolicy;
  /** The capability this task requires. Refused if C.A.R.D. does not allow it. */
  readonly capability: string;
  readonly signal?: AbortSignal;
}

/* -------------------------------------------------------------- outcomes */

/**
 * EVERY WAY ONE TASK CAN END, as a value.
 *
 * The run loop reads these to decide the run's next state, so a new ending has
 * to be added here and handled there rather than being expressible as a thrown
 * error nobody classified.
 */
export type JuliusTaskOutcome =
  | { readonly kind: 'COMPLETED'; readonly taskId: string; readonly workerId: string; readonly duplicate: boolean; readonly decision: JuliusVerificationDecision }
  | { readonly kind: 'REVIEW_SCHEDULED'; readonly taskId: string; readonly reviewTaskId: string }
  | { readonly kind: 'REPAIR_SCHEDULED'; readonly taskId: string; readonly repairTaskId: string; readonly round: number }
  | { readonly kind: 'RETRY'; readonly taskId: string; readonly code: string }
  | { readonly kind: 'FAILED'; readonly taskId: string; readonly code: string }
  | { readonly kind: 'DENIED'; readonly taskId: string; readonly reasonCode: string }
  | { readonly kind: 'APPROVAL_REQUIRED'; readonly taskId: string; readonly operation: string; readonly reasonCode: string }
  | { readonly kind: 'HALTED'; readonly taskId: string; readonly reasonCode: string; readonly safeSummary: string };

/* ------------------------------------------------------------- the ledger */

/**
 * Emit one operational event and its trajectory counterpart where the
 * trajectory has a matching kind.
 *
 * Both are validated before they are written — `validateJuliusEvent` rejects a
 * fact payload that looks like a credential, and it is cheaper to fail here
 * than to discover a leak in a delivered event.
 */
class RuntimeLedger {
  constructor(
    private readonly deps: JuliusPipelineDependencies,
    private readonly run: JuliusRunRow,
    private readonly correlationId: string,
  ) {}

  async event(
    type: JuliusOperationalEventType,
    input: { taskId: string | null; workerId?: string | null; causationId?: string | null; facts: Record<string, string | number | boolean | null> },
  ): Promise<void> {
    const event: JuliusOperationalEvent = {
      eventId: this.deps.ids.next(`event:${type}`),
      runId: this.run.runId,
      projectId: this.run.projectId,
      type,
      taskId: input.taskId,
      workerId: input.workerId ?? null,
      correlationId: this.correlationId,
      causationId: input.causationId ?? null,
      occurredAt: this.deps.clock.now(),
      facts: { ...input.facts, owner: this.deps.owner },
    };
    validateJuliusEvent(event);
    await this.deps.store.appendEvent(event);
  }

  async trajectory(
    kind: JuliusTrajectoryKind,
    input: {
      taskId: string | null; workerId?: string | null; providerId?: string | null; contextId?: string | null;
      policyRevision: string; outcome?: string | null; durationMs?: number | null; usdMicros?: number | null;
      inputTokens?: number | null; outputTokens?: number | null;
      facts?: Record<string, string | number | boolean | null>;
    },
  ): Promise<void> {
    const event: JuliusTrajectoryEvent = {
      trajectoryEventId: this.deps.ids.next(`trajectory:${kind}`),
      runId: this.run.runId,
      projectId: this.run.projectId,
      kind,
      taskId: input.taskId,
      workerId: input.workerId ?? null,
      providerId: input.providerId ?? null,
      contextId: input.contextId ?? null,
      runtimeVersion: JULIUS_RUNTIME_VERSION,
      policyVersion: input.policyRevision,
      cardRevision: this.run.cardRevision,
      missionContractRevision: this.run.missionContractRevision,
      projectBrainRevision: this.run.projectBrainRevision,
      // UNKNOWN IS NULL. A duration or a cost the runtime did not observe is
      // not zero, and writing zero would make an eval average a lie.
      durationMs: input.durationMs ?? null,
      usdMicros: input.usdMicros ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      outcome: input.outcome ?? null,
      safeFacts: input.facts ?? {},
      idempotencyKey: `${this.correlationId}:${kind}:${input.taskId ?? 'run'}`,
      occurredAt: this.deps.clock.now(),
    };
    validateTrajectoryEvent(event);
    await this.deps.store.appendTrajectory(event);
  }
}

/* -------------------------------------------------------------- pipeline */

/**
 * Run one claimed task through policy, context, execution and verification.
 *
 * TENANCY IS CHECKED HERE, not assumed from the claim. The claim came from a
 * scheduler query that may have been scoped to a project or not, and a task
 * whose run belongs to a different project must never be executed under this
 * caller's identity.
 */
export async function runClaimedTask(
  request: JuliusPipelineRequest,
  deps: JuliusPipelineDependencies,
  scope: { readonly projectId: string },
): Promise<JuliusTaskOutcome> {
  const { claim } = request;
  const run = await deps.store.loadRun(claim.runId, scope.projectId);
  if (run === null) {
    // Not this caller's run. Nothing is written and nothing is dispatched: a
    // silent skip is the only safe answer, because even a failure event would
    // be a write into another tenant's stream.
    return { kind: 'HALTED', taskId: claim.taskId, reasonCode: 'RUN_NOT_IN_SCOPE', safeSummary: 'The claimed task belongs to a run outside this scope.' };
  }

  const correlationId = `${claim.taskId}:${claim.leaseGeneration}`;
  const ledger = new RuntimeLedger(deps, run, correlationId);
  await ledger.event('task.claimed', {
    taskId: claim.taskId,
    facts: { leaseGeneration: claim.leaseGeneration, attempt: claim.attempt, role: claim.role },
  });

  const role = resolveWorkerRole(claim.role);
  if (role === null) {
    await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
    await ledger.event('run.failed', { taskId: claim.taskId, facts: { reasonCode: 'UNRESOLVED_WORKER_ROLE', role: claim.role } });
    return { kind: 'HALTED', taskId: claim.taskId, reasonCode: 'UNRESOLVED_WORKER_ROLE', safeSummary: 'The task names a role Julius cannot resolve, so it was not dispatched.' };
  }

  /* -------------------------------------------------- 1. policy, first */
  const dispatchVerdict = evaluateJuliusPolicy(request.policy, { operation: 'DISPATCH_WORKER' });
  const capabilityVerdict = evaluateJuliusPolicy(request.policy, { operation: 'USE_CAPABILITY', capability: request.capability });
  for (const verdict of [dispatchVerdict, capabilityVerdict]) {
    if (verdict.effect === 'REQUIRE_APPROVAL') {
      // The task keeps its lease released and returns to RUNNABLE so the
      // approval can be answered without the claim expiring underneath it.
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('run.paused', { taskId: claim.taskId, facts: { reasonCode: verdict.reasonCode, policyRevision: verdict.policyRevision } });
      return { kind: 'APPROVAL_REQUIRED', taskId: claim.taskId, operation: 'DISPATCH_WORKER', reasonCode: verdict.reasonCode };
    }
    if (verdict.effect === 'DENY') {
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('run.failed', { taskId: claim.taskId, facts: { reasonCode: verdict.reasonCode, policyRevision: verdict.policyRevision } });
      await ledger.trajectory('DISPATCH', { taskId: claim.taskId, policyRevision: verdict.policyRevision, outcome: 'POLICY_DENIED' });
      return { kind: 'DENIED', taskId: claim.taskId, reasonCode: verdict.reasonCode };
    }
  }

  /* ------------------------------------- 2. context, compiled and stored */
  const tasks = await deps.store.tasksForRun(run.runId);
  const task = tasks.find((value) => value.taskId === claim.taskId);
  if (task === undefined) {
    return { kind: 'HALTED', taskId: claim.taskId, reasonCode: 'TASK_NOT_FOUND', safeSummary: 'The claimed task no longer exists in the run.' };
  }

  let worker: JuliusWorker;
  try {
    worker = deps.router.select({ role, taskType: claim.taskType, capability: request.capability, policy: request.policy });
  } catch {
    // Route selection also happens inside the coordinator; doing it here first
    // is what lets the context snapshot name the worker it was compiled FOR.
    // A failure is not handled twice — it is handed to the coordinator, which
    // owns the classification and the retry decision.
    worker = null as unknown as JuliusWorker;
  }

  let contextId: string | null = null;
  if (worker !== null) {
    const [evidence, findings, criteria, brain] = await Promise.all([
      deps.store.evidenceForRun(run.runId),
      deps.store.findingsForRun(run.runId),
      deps.store.criteriaForRun(run.runId),
      deps.store.brainEntriesForRun(run.runId),
    ]);
    const snapshot = createJuliusContextSnapshot({
      contextId: deps.ids.next('context'),
      runId: run.runId,
      task,
      worker,
      entries: brain,
      maxCharacters: deps.contextCharacterBudget,
      missionContractRevision: run.missionContractRevision,
      cardRevision: run.cardRevision,
      projectBrainRevision: run.projectBrainRevision,
      dependencyTaskIds: task.dependencyIds,
      evidenceIds: evidence.filter((value) => task.dependencyIds.includes(value.taskId)).map((value) => value.evidenceId),
      findingIds: findings.filter((value) => value.taskId === task.taskId).map((value) => value.findingId),
      acceptanceCriterionIds: criteria.map((value) => value.criterionId),
    });
    await deps.store.persist({ projectId: run.projectId, snapshot });
    contextId = snapshot.contextId;
    await ledger.trajectory('CONTEXT_COMPILED', {
      taskId: task.taskId, workerId: worker.workerId, contextId,
      policyRevision: request.policy.revision,
      facts: { characterCount: snapshot.characterCount, truncated: snapshot.truncated, redactionCount: snapshot.redactionCount, contentHash: snapshot.contentHash },
    });
  }

  /* ------------------------------------------------------ 3. execution */
  const executionClaim: JuliusExecutionClaim = {
    runId: run.runId, projectId: run.projectId, taskId: claim.taskId,
    leaseOwner: deps.owner, leaseGeneration: claim.leaseGeneration,
    task, capability: request.capability,
    // A dispatch with no reproducible context is refused by the adapter side
    // rather than sent with an empty string pretending to be one.
    contextId: contextId ?? '',
  };
  const operationId = `${correlationId}:${claim.attempt}`;
  const resources = deps.resources.estimate({ taskId: claim.taskId, taskType: claim.taskType, role: claim.role, attempt: claim.attempt });

  const coordinator = new JuliusExecutionCoordinator(deps.router, executionPorts(deps, run, ledger));
  const outcome = await coordinator.execute({
    claim: executionClaim, policy: request.policy, role, taskType: claim.taskType,
    capability: request.capability, resources, operationId, signal: request.signal,
  });

  if (outcome.status !== 'COMPLETED') {
    // The coordinator already released the reservation and emitted its own
    // event. What it cannot do is move the TASK, because it has no store — so
    // that is done here, once, on the paths where no result was accepted.
    const state = outcome.status === 'RETRY' ? undefined : 'FAILED' as const;
    if (state === undefined) {
      await deps.store.finishTask({
        taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
        state: 'FAILED', now: deps.clock.now(), nextAttemptAt: deps.clock.now(),
      });
    } else {
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state, now: deps.clock.now() });
    }
    await ledger.trajectory(outcome.status === 'RETRY' ? 'RETRY' : 'DISPATCH', {
      taskId: claim.taskId, contextId, policyRevision: request.policy.revision, outcome: outcome.code,
    });
    if (outcome.status === 'RETRY') return { kind: 'RETRY', taskId: claim.taskId, code: outcome.code };
    if (outcome.status === 'DENIED') return { kind: 'DENIED', taskId: claim.taskId, reasonCode: outcome.code };
    return { kind: 'FAILED', taskId: claim.taskId, code: outcome.code };
  }

  await ledger.trajectory('DISPATCH', {
    taskId: claim.taskId, workerId: outcome.workerId, contextId,
    policyRevision: request.policy.revision, outcome: 'COMPLETED',
    facts: { duplicate: outcome.duplicate },
  });

  /* --------------------------------------------------- 4. verification */
  return verifyExecutedTask({ request, deps, run, ledger, task, workerId: outcome.workerId, duplicate: outcome.duplicate });
}

/* ------------------------------------------------------ execution ports */

/**
 * The coordinator's ports, backed by the store.
 *
 * `persistEvidence` writes each piece under its OWN idempotency key, so a
 * retried execution re-inserts nothing and a partially-written batch completes
 * on the next attempt rather than duplicating what already landed.
 */
function executionPorts(
  deps: JuliusPipelineDependencies,
  run: JuliusRunRow,
  ledger: RuntimeLedger,
): JuliusExecutionPorts {
  return {
    reserve: async ({ claim, request, idempotencyKey }) => {
      const reservationId = `reservation:${idempotencyKey}`;
      const result = await deps.budget.reserve({
        reservationId, runId: claim.runId, projectId: claim.projectId, taskId: claim.taskId,
        usdMicros: request.usdMicros, inputTokens: request.inputTokens, outputTokens: request.outputTokens,
        toolCalls: request.toolCalls, runtimeMs: request.runtimeMs, now: deps.clock.now(),
      });
      return { reservationId, state: result.state, denialReason: result.denialReason };
    },
    commit: async ({ reservationId, result }) => {
      const usage = (result.usage ?? {}) as Record<string, unknown>;
      const number = (key: string): number => (typeof usage[key] === 'number' && Number.isFinite(usage[key] as number) ? usage[key] as number : 0);
      await deps.budget.commit({
        reservationId, usdMicros: number('usdMicros'), inputTokens: number('inputTokens'),
        outputTokens: number('outputTokens'), toolCalls: number('toolCalls'), runtimeMs: number('runtimeMs'),
        receiptId: typeof usage.receiptId === 'string' ? usage.receiptId : null, now: deps.clock.now(),
      });
    },
    release: async ({ reservationId, reason }) => {
      await deps.budget.release({ reservationId, reason, now: deps.clock.now() });
    },
    persistEvidence: async ({ claim, evidence }) => {
      for (const item of evidence) {
        await deps.store.appendEvidence({
          runId: claim.runId, projectId: claim.projectId,
          idempotencyKey: `${claim.taskId}:${claim.leaseGeneration}:${item.evidenceId}`,
          evidence: item,
        });
      }
    },
    acceptResult: async ({ claim, worker, result, idempotencyKey }) => {
      const receipt = await deps.store.acceptWorkerResult({
        resultId: deps.ids.next('result'), idempotencyKey,
        runId: claim.runId, projectId: claim.projectId, taskId: claim.taskId,
        leaseGeneration: claim.leaseGeneration, workerId: worker.workerId,
        status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        safeSummary: result.safeSummary,
        evidenceIds: [], providerReceiptIds: [], occurredAt: deps.clock.now(),
      });
      return { duplicate: receipt.duplicate };
    },
    recordEvent: async ({ type, payload }) => {
      const facts: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(payload)) {
        facts[key] = value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value as string | number | boolean | null : String(value);
      }
      await ledger.event(type, { taskId: null, facts: { ...facts, runId: run.runId } });
    },
  };
}

/* ------------------------------------------------------- the verification */

async function verifyExecutedTask(input: {
  request: JuliusPipelineRequest;
  deps: JuliusPipelineDependencies;
  run: JuliusRunRow;
  ledger: RuntimeLedger;
  task: JuliusTask;
  workerId: string;
  duplicate: boolean;
}): Promise<JuliusTaskOutcome> {
  const { deps, run, ledger, task } = input;
  const [tasks, evidence, findings, criteria, decisions, reviewCompleted] = await Promise.all([
    deps.store.tasksForRun(run.runId),
    deps.store.evidenceForRun(run.runId),
    deps.store.findingsForRun(run.runId),
    deps.store.criteriaForRun(run.runId),
    deps.store.decisionsForRun(run.runId),
    deps.store.reviewCompletedFor(task.taskId),
  ]);

  const action = evaluateJuliusVerification({
    task, evidence, criteria, findings,
    policy: input.request.verification,
    reviewCompleted,
    allTasks: tasks,
    priorDecisions: decisions,
  });

  /* ------------------------------------------------- a review is required */
  if (action.action === 'SCHEDULE_REVIEW') {
    const reviewTaskId = `${task.taskId}:review`;
    const created = await deps.store.addTask({
      commandId: `review:${reviewTaskId}`,
      runId: run.runId,
      projectId: run.projectId,
      task: {
        taskId: reviewTaskId,
        missionId: task.missionId,
        parentTaskId: task.taskId,
        // The reviewer depends on the task it reviews, so the scheduler will
        // not hand it out until that task has actually succeeded.
        dependencyIds: [task.taskId],
        requiredEvidenceTypes: ['REVIEW_FINDING'],
        taskType: `review:${task.taskType}`,
        role: 'INDEPENDENT_REVIEWER',
        ordinal: task.ordinal + 1,
        state: 'BLOCKED',
      },
    });
    await ledger.event('review.started', { taskId: reviewTaskId, facts: { reviewsTaskId: task.taskId, created } });
    return { kind: 'REVIEW_SCHEDULED', taskId: task.taskId, reviewTaskId };
  }

  /* ------------------------------------------------------- a decision */
  const { decision } = action;
  await deps.store.appendDecision({
    decisionId: deps.ids.next('decision'),
    runId: run.runId,
    taskId: task.taskId,
    policyRevision: input.request.verification.revision,
    idempotencyKey: `${task.taskId}:${decision.action}:${decision.reasonCode}`,
    occurredAt: deps.clock.now(),
    decision,
  });
  await ledger.event('verification.decided', {
    taskId: task.taskId, workerId: input.workerId,
    facts: {
      action: decision.action, reasonCode: decision.reasonCode,
      criteriaSatisfied: action.criteriaSatisfied.length, criteriaMissing: action.criteriaMissing.length,
      missionCompletable: action.missionCompletable,
    },
  });
  await ledger.trajectory('VERIFICATION', {
    taskId: task.taskId, workerId: input.workerId,
    policyRevision: input.request.verification.revision, outcome: decision.action,
    facts: { reasonCode: decision.reasonCode, criteriaMissing: action.criteriaMissing.length },
  });

  if (decision.action === 'REPAIR') {
    return scheduleRepair({ ...input, decision, findings });
  }
  if (decision.action === 'ACCEPT' || decision.action === 'COMPLETE') {
    return { kind: 'COMPLETED', taskId: task.taskId, workerId: input.workerId, duplicate: input.duplicate, decision };
  }
  if (decision.action === 'RETRY') {
    return { kind: 'RETRY', taskId: task.taskId, code: decision.reasonCode };
  }
  return { kind: 'HALTED', taskId: task.taskId, reasonCode: decision.reasonCode, safeSummary: decision.safeSummary };
}

/* ------------------------------------------------------------ the repair */

async function scheduleRepair(input: {
  request: JuliusPipelineRequest;
  deps: JuliusPipelineDependencies;
  run: JuliusRunRow;
  ledger: RuntimeLedger;
  task: JuliusTask;
  decision: JuliusVerificationDecision;
  findings: Awaited<ReturnType<JuliusRuntimeStore['findingsForRun']>>;
}): Promise<JuliusTaskOutcome> {
  const { deps, run, ledger, task } = input;
  const priorRounds = await deps.store.repairRoundsFor(task.taskId);

  // A REPAIR IS BUDGETED WORK. Reserving before planning is what stops a run
  // from scheduling a repair it cannot pay for and discovering that when the
  // repair task is claimed.
  const reservationId = `reservation:repair:${task.taskId}:${priorRounds + 1}`;
  const estimate = deps.resources.estimate({ taskId: task.taskId, taskType: `repair:${task.taskType}`, role: 'CODING_AGENT', attempt: priorRounds + 1 });
  const reservation = await deps.budget.reserve({
    reservationId, runId: run.runId, projectId: run.projectId, taskId: task.taskId,
    usdMicros: estimate.usdMicros, inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens,
    toolCalls: estimate.toolCalls, runtimeMs: estimate.runtimeMs, now: deps.clock.now(),
  });
  if (reservation.state === 'DENIED') {
    await ledger.event('budget.denied', { taskId: task.taskId, facts: { reason: reservation.denialReason, forRepairRound: priorRounds + 1 } });
    return { kind: 'HALTED', taskId: task.taskId, reasonCode: 'REPAIR_BUDGET_DENIED', safeSummary: 'A repair round was required and the budget did not permit it.' };
  }

  let plan;
  try {
    plan = planJuliusRepair({
      runId: run.runId, originalTask: task, decision: input.decision,
      findings: input.findings, priorRounds, policy: input.request.verification,
      budgetReservationId: reservationId, now: deps.clock.now(),
    });
  } catch (error) {
    // `planJuliusRepair` throws on a round limit, a missing reservation and
    // missing evidence. Each is a HALT with a reason rather than a crash: the
    // run stops for a stated cause and the reservation is handed back.
    await deps.budget.release({ reservationId, reason: 'REPAIR_NOT_PLANNABLE', now: deps.clock.now() });
    const reasonCode = error instanceof Error ? error.message : 'repair_not_plannable';
    await ledger.event('run.failed', { taskId: task.taskId, facts: { reasonCode } });
    return { kind: 'HALTED', taskId: task.taskId, reasonCode, safeSummary: 'A repair round was required and could not be planned.' };
  }

  const created = await deps.store.addTask({
    commandId: `repair:${plan.repairId}`, runId: run.runId, projectId: run.projectId, task: plan.task,
  });
  await ledger.event('repair.scheduled', {
    taskId: plan.task.taskId,
    facts: { repairId: plan.repairId, round: plan.round, repairsTaskId: task.taskId, findingCount: plan.findingIds.length, created },
  });
  await ledger.trajectory('REPAIR', {
    taskId: plan.task.taskId, policyRevision: input.request.verification.revision,
    outcome: 'SCHEDULED', facts: { round: plan.round, repairsTaskId: task.taskId },
  });
  return { kind: 'REPAIR_SCHEDULED', taskId: task.taskId, repairTaskId: plan.task.taskId, round: plan.round };
}
