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
import { decideJuliusContinuation } from './julius-continuation';
import { JuliusExecutionCoordinator, type JuliusExecutionPorts, type JuliusExecutionClaim, type JuliusResourceRequest } from './julius-execution-coordinator';
import { safeReasonCode, type JuliusProviderRouter } from './julius-router';
import { createJuliusContextSnapshot } from './julius-context-snapshot';
import { evaluateJuliusVerification, type JuliusVerificationPolicy } from './julius-verification-runtime';
import { planJuliusRepair } from './julius-repair-runtime';
import { JULIUS_RUNTIME_VERSION, type JuliusTask, type JuliusVerificationDecision, type JuliusWorker, type JuliusWorkerRole } from './julius-runtime';
import { validateJuliusEvent, type JuliusOperationalEvent, type JuliusOperationalEventType } from './julius-events';
import { validateTrajectoryEvent, type JuliusTrajectoryEvent, type JuliusTrajectoryKind } from './julius-trajectory';
import {
  resolveWorkerRole,
  type JuliusBudgetPort,
  type JuliusClaimedTask,
  type JuliusClock,
  type JuliusIdFactory,
  type JuliusRunRow,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from './julius-runtime-ports';

/* --------------------------------------------------------------- inputs */

/**
 * THE STRUCTURAL ATTEMPT CEILING.
 *
 * A task's own `attempt` counter was incremented by the CLAIM, and nothing in
 * the inherited stack bounded it — `planJuliusRecovery` uses a `maxRetries` of
 * 2 written inline in a SQL literal, and the dispatch path had no ceiling at
 * all. This is the dispatch path's ceiling, stated once. It is deliberately
 * NOT a C.A.R.D. value: C.A.R.D. decides whether retrying is permitted, and
 * this decides when a task has simply had enough turns.
 *
 * WHAT A TURN IS, since it used to be the wrong thing. The counter is spent by
 * `admitTask`, once the scheduler has decided to run the task and immediately
 * before provider-capable work begins — so this ceiling bounds EXECUTIONS.
 * While the claim spent it, a task the scheduler claimed and handed straight
 * back for concurrency lost a turn to a provider that was never called, and
 * the first-live topology hands tasks back routinely. Scheduling churn is
 * bounded by {@link MAX_TASK_RECOVERIES} instead, on its own counter.
 */
export const MAX_TASK_ATTEMPTS = 3;

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
  /**
   * ALSO THE RECOVERY DRIVER, so the run loop can sweep before it claims.
   *
   * An expired lease is no longer reclaimable by the claim query — that path
   * raised only `lease_generation` and bypassed the recovery ceiling — so the
   * sweep is the one way back, and it must belong to the kernel rather than to
   * whichever driver happens to call `tick`.
   */
  readonly store: JuliusRuntimeStore & JuliusRecoveryDriver;
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
  | { readonly kind: 'RETRY'; readonly taskId: string; readonly code: string; readonly failureClass?: string | null }
  | { readonly kind: 'FAILED'; readonly taskId: string; readonly code: string; readonly failureClass?: string | null }
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
 * The verdict of every gate that can refuse a claimed task before it executes.
 */
export type JuliusTaskPreflight =
  | { readonly kind: 'REFUSED'; readonly outcome: JuliusTaskOutcome }
  | {
    readonly kind: 'ELIGIBLE';
    readonly run: JuliusRunRow;
    readonly role: JuliusWorkerRole;
    readonly task: JuliusTask;
  };

/**
 * WHAT MUST BE DECIDED BEFORE AN EXECUTION ATTEMPT IS SPENT.
 *
 * Every gate here can REFUSE to execute the task — a run outside this scope, a
 * role Julius cannot resolve, a C.A.R.D. that denies the dispatch or the
 * capability, an approval the operator has not given, a task that no longer
 * exists. None of them is a worker execution, and while admission ran in the
 * run loop before these gates, each of them spent one of the task's three
 * attempts on work Julius had just decided not to do.
 *
 * So the gates live here, exactly once, and the caller admits only an ELIGIBLE
 * result. The policy implementation is not duplicated into the run loop: the
 * run loop learns the verdict from the type, not by re-evaluating it.
 *
 * TENANCY IS CHECKED HERE, not assumed from the claim. The claim came from a
 * scheduler query that may have been scoped to a project or not, and a task
 * whose run belongs to a different project must never be executed under this
 * caller's identity — which is why `runClaimedTask` takes this result rather
 * than a raw claim.
 */
export async function prepareClaimedTask(
  request: JuliusPipelineRequest,
  deps: JuliusPipelineDependencies,
  scope: { readonly projectId: string },
): Promise<JuliusTaskPreflight> {
  const { claim } = request;
  const run = await deps.store.loadRun(claim.runId, scope.projectId);
  if (run === null) {
    // Not this caller's run. Nothing is written and nothing is dispatched: a
    // silent skip is the only safe answer, because even a failure event would
    // be a write into another tenant's stream.
    return { kind: 'REFUSED', outcome: { kind: 'HALTED', taskId: claim.taskId, reasonCode: 'RUN_NOT_IN_SCOPE', safeSummary: 'The claimed task belongs to a run outside this scope.' } };
  }

  const correlationId = `${claim.taskId}:${claim.leaseGeneration}`;
  const ledger = new RuntimeLedger(deps, run, correlationId);

  const role = resolveWorkerRole(claim.role);
  if (role === null) {
    await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
    await ledger.event('run.failed', { taskId: claim.taskId, facts: { reasonCode: 'UNRESOLVED_WORKER_ROLE', role: claim.role } });
    return { kind: 'REFUSED', outcome: { kind: 'HALTED', taskId: claim.taskId, reasonCode: 'UNRESOLVED_WORKER_ROLE', safeSummary: 'The task names a role Julius cannot resolve, so it was not dispatched.' } };
  }

  /* -------------------------------------------------- 1. policy, first */
  const dispatchVerdict = evaluateJuliusPolicy(request.policy, { operation: 'DISPATCH_WORKER' });
  const capabilityVerdict = evaluateJuliusPolicy(request.policy, { operation: 'USE_CAPABILITY', capability: request.capability });
  for (const verdict of [dispatchVerdict, capabilityVerdict]) {
    if (verdict.effect === 'REQUIRE_APPROVAL') {
      // The lease is released at once, so the approval can be answered without
      // the claim expiring underneath it. The task itself ends FAILED: this
      // call passes no next attempt time, and under the hand-back rule both
      // stores now share, only a call that does returns a task to RUNNABLE.
      // (An earlier comment here said it returned to RUNNABLE; it did not, in
      // either store.)
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('run.paused', { taskId: claim.taskId, facts: { reasonCode: verdict.reasonCode, policyRevision: verdict.policyRevision } });
      return { kind: 'REFUSED', outcome: { kind: 'APPROVAL_REQUIRED', taskId: claim.taskId, operation: 'DISPATCH_WORKER', reasonCode: verdict.reasonCode } };
    }
    if (verdict.effect === 'DENY') {
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('run.failed', { taskId: claim.taskId, facts: { reasonCode: verdict.reasonCode, policyRevision: verdict.policyRevision } });
      await ledger.trajectory('DISPATCH', { taskId: claim.taskId, policyRevision: verdict.policyRevision, outcome: 'POLICY_DENIED' });
      return { kind: 'REFUSED', outcome: { kind: 'DENIED', taskId: claim.taskId, reasonCode: verdict.reasonCode } };
    }
  }

  /* ------------------------------------- 2. context, compiled and stored */
  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);
  const task = tasks.find((value) => value.taskId === claim.taskId);
  if (task === undefined) {
    return { kind: 'REFUSED', outcome: { kind: 'HALTED', taskId: claim.taskId, reasonCode: 'TASK_NOT_FOUND', safeSummary: 'The claimed task no longer exists in the run.' } };
  }

  return { kind: 'ELIGIBLE', run, role, task };
}

/**
 * EXECUTE A TASK THE CALLER HAS ALREADY ADMITTED.
 *
 * `claim.attempt` here is the value `admitTask` returned — the attempt actually
 * being run — because every gate that could refuse execution was answered by
 * {@link prepareClaimedTask} BEFORE the attempt was spent. The preflight's
 * findings are passed in rather than recomputed, so the run, the role and the
 * task row are each read once and the policy is evaluated in exactly one place.
 */
export async function runClaimedTask(
  request: JuliusPipelineRequest,
  deps: JuliusPipelineDependencies,
  preflight: Extract<JuliusTaskPreflight, { kind: 'ELIGIBLE' }>,
): Promise<JuliusTaskOutcome> {
  const { claim } = request;
  const { run, role, task } = preflight;
  const correlationId = `${claim.taskId}:${claim.leaseGeneration}`;
  const ledger = new RuntimeLedger(deps, run, correlationId);
  /**
   * TWO NUMBERS THAT USED TO BE ONE, and this event carries both.
   *
   * `leaseGeneration` counts CLAIMS — every one, including the ones the
   * scheduler hands straight back. `attempt` counts EXECUTIONS: it is raised by
   * `admitTask`, which the caller runs after every hand-back decision AND after
   * every pre-execution gate, immediately before this dispatch. So this event
   * fires once per execution and the number it carries is the attempt actually
   * being run. A generation above the attempt is not a discrepancy; it is a
   * task that was offered, or refused, more often than it was run.
   */
  await ledger.event('task.claimed', {
    taskId: claim.taskId,
    facts: { leaseGeneration: claim.leaseGeneration, attempt: claim.attempt, role: claim.role },
  });

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
    // WORKER_SELECTED and PROVIDER_SELECTED were declared trajectory kinds
    // that nothing emitted, so an eval could not tell WHICH worker or provider
    // a run had used — the two facts routing effectiveness is measured from.
    await ledger.trajectory('WORKER_SELECTED', {
      taskId: task.taskId, workerId: worker.workerId,
      policyRevision: request.policy.revision, outcome: 'SELECTED',
      facts: { role: worker.role, adapterId: worker.adapterId },
    });
    await ledger.trajectory('PROVIDER_SELECTED', {
      taskId: task.taskId, workerId: worker.workerId, providerId: worker.providerId,
      policyRevision: request.policy.revision, outcome: 'SELECTED',
    });
    const [evidence, findings, criteria, brain] = await Promise.all([
      deps.store.evidenceForRun(run.runId, run.projectId),
      deps.store.findingsForRun(run.runId, run.projectId),
      deps.store.criteriaForRun(run.runId, run.projectId),
      deps.store.brainEntriesForRun(run.runId, run.projectId),
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
    await ledger.event('context.compiled', {
      taskId: task.taskId, workerId: worker.workerId,
      facts: {
        contextId, characterCount: snapshot.characterCount, truncated: snapshot.truncated,
        redactionCount: snapshot.redactionCount, contentHash: snapshot.contentHash,
      },
    });
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

  /* ------------------------------------------------- reroute and fallback */
  /**
   * TRY A DIFFERENT WORKER BEFORE GIVING THE TASK BACK.
   *
   * `reroute.selected` and `fallback.selected` were in the inherited event
   * catalogue and NOTHING EMITTED THEM, because the runtime never rerouted:
   * the router accepts `excludedWorkerIds` and no caller ever supplied any. A
   * declared event nothing emits is a promise nobody keeps, so rather than
   * deleting the types the behaviour they name is implemented.
   *
   * BOUNDED BY THE ELIGIBLE SET, not by a number. Each attempt excludes every
   * worker already tried, so the loop can run at most once per eligible
   * worker and terminates without a counter to get wrong. Each reroute is
   * still put to `decideJuliusContinuation`, so a SUPERVISED run does not
   * quietly try three providers before telling anyone.
   */
  const tried: string[] = [];
  let outcome = await coordinator.execute({
    claim: executionClaim, policy: request.policy, role, taskType: claim.taskType,
    capability: request.capability, resources, operationId, signal: request.signal,
  });
  let lastProviderId = deps.router.providerOf(outcome.status === 'COMPLETED' ? outcome.workerId : null);

  while (outcome.status !== 'COMPLETED' && outcome.status !== 'DENIED') {
    const selected = deps.router.eligibleWorkerIds({
      role, taskType: claim.taskType, capability: request.capability,
      policy: request.policy, excludedWorkerIds: tried,
    });
    if (selected.length === 0) break;
    tried.push(selected[0]!);
    const remaining = deps.router.eligibleWorkerIds({
      role, taskType: claim.taskType, capability: request.capability,
      policy: request.policy, excludedWorkerIds: tried,
    });
    if (remaining.length === 0) break;

    await ledger.event('provider.failure', {
      taskId: claim.taskId,
      facts: { code: outcome.code, triedWorkers: tried.length, failureClass: outcome.failureClass ?? null },
    });

    const carryOn = decideJuliusContinuation(request.policy, {
      kind: 'REROUTE', excludedWorkerIds: tried, remainingWorkers: remaining.length,
    });
    if (!carryOn.proceed) break;

    const nextProviderId = deps.router.providerOf(remaining[0]!);
    // A REROUTE THAT CROSSES PROVIDERS IS A FALLBACK, and C.A.R.D. governs the
    // two separately — `fallback` may be denied while rerouting inside one
    // provider is allowed. So the crossing is checked before it is taken.
    if (nextProviderId !== null && nextProviderId !== lastProviderId) {
      const mayFallBack = decideJuliusContinuation(request.policy, { kind: 'FALLBACK', providerId: nextProviderId });
      if (!mayFallBack.proceed) break;
      await ledger.event('fallback.selected', {
        taskId: claim.taskId, facts: { providerId: nextProviderId, reasonCode: mayFallBack.reasonCode },
      });
      await ledger.trajectory('FALLBACK', {
        taskId: claim.taskId, providerId: nextProviderId,
        policyRevision: request.policy.revision, outcome: 'SELECTED',
      });
    }
    await ledger.event('reroute.selected', {
      taskId: claim.taskId, facts: { excluded: tried.length, remaining: remaining.length, reasonCode: carryOn.reasonCode },
    });

    lastProviderId = nextProviderId;
    outcome = await coordinator.execute({
      claim: executionClaim, policy: request.policy, role, taskType: claim.taskType,
      capability: request.capability, resources,
      operationId: `${operationId}:reroute:${tried.length}`,
      signal: request.signal, excludedWorkerIds: tried,
    });
  }

  if (outcome.status !== 'COMPLETED') {
    // The coordinator already released the reservation and emitted its own
    // event. What it cannot do is move the TASK, because it has no store — so
    // that is done here, once, on the paths where no result was accepted.
    //
    // WHETHER A RETRYABLE FAILURE IS ACTUALLY RETRIED IS AN AUTONOMY QUESTION.
    // The coordinator classifies the ERROR; whether the runtime carries on by
    // itself is `decideJuliusContinuation`'s. A SUPERVISED run stops on a rate
    // limit and waits for a person, which is what supervised means and what
    // the inherited code — reading only `policy.automaticRetry` — never did.
    let requeue = false;
    if (outcome.status === 'RETRY') {
      const carryOn = decideJuliusContinuation(request.policy, {
        kind: 'RETRY', attempt: claim.attempt,
        maxAttempts: MAX_TASK_ATTEMPTS, errorCode: outcome.code as never,
      });
      requeue = carryOn.proceed;
      if (!carryOn.proceed) {
        await ledger.event('task.failed', {
          taskId: claim.taskId,
          facts: {
            code: outcome.code, reasonCode: carryOn.reasonCode, awaitingHuman: carryOn.awaitingHuman,
            // UNKNOWN IS NULL, NOT ABSENT. A reader asking "why did this task
            // fail" must be able to tell "the connector did not classify it"
            // from "nobody wrote the field down".
            failureClass: outcome.failureClass ?? null,
            // THE ERROR WAS RETRYABLE; THE TASK WAS NOT RETRIED. Reached only
            // from the RETRY branch, where the run's own autonomy declined —
            // `reasonCode` says which rule. The name says which of the two it
            // describes, because `retryable` on a row that ends a task reads as
            // a promise the run did not make.
            errorRetryable: true,
          },
        });
      }
    }
    await deps.store.finishTask({
      taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
      state: 'FAILED', now: deps.clock.now(),
      ...(requeue ? { nextAttemptAt: deps.clock.now() } : {}),
    });
    await ledger.trajectory(requeue ? 'RETRY' : 'DISPATCH', {
      taskId: claim.taskId, contextId, policyRevision: request.policy.revision, outcome: outcome.code,
      facts: { failureClass: outcome.failureClass ?? null },
    });
    if (requeue) return { kind: 'RETRY', taskId: claim.taskId, code: outcome.code, failureClass: outcome.failureClass ?? null };
    if (outcome.status === 'DENIED') return { kind: 'DENIED', taskId: claim.taskId, reasonCode: outcome.code };
    return { kind: 'FAILED', taskId: claim.taskId, code: outcome.code, failureClass: outcome.failureClass ?? null };
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
      // The coordinator emits `budget.reserved` and `budget.denied` and has no
      // event for the settlement, so the amount actually spent had no
      // authoritative record. It does now, and it is the OBSERVED usage rather
      // than the estimate that was reserved.
      await ledger.event('budget.settled', {
        taskId: null,
        facts: { reservationId, usdMicros: number('usdMicros'), inputTokens: number('inputTokens'), outputTokens: number('outputTokens') },
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
    recordEvent: async ({ type, taskId, payload }) => {
      const facts: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(payload)) {
        facts[key] = value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value as string | number | boolean | null : String(value);
      }
      // NAME THE TASK. A `task.failed` with no task cannot say which of the
      // three C.A.R.D. roles stopped, and on a non-retryable worker failure the
      // coordinator's is the only row that ENDS the task — which is exactly the
      // shape the first paid mission failed in. (This port also carries
      // `worker.selected`, `budget.reserved` and `worker.dispatched`, which name
      // the same claimed task, as do the coordinator's other events.)
      await ledger.event(type, { taskId, facts: { ...facts, runId: run.runId } });
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
    deps.store.tasksForRun(run.runId, run.projectId),
    deps.store.evidenceForRun(run.runId, run.projectId),
    deps.store.findingsForRun(run.runId, run.projectId),
    deps.store.criteriaForRun(run.runId, run.projectId),
    deps.store.decisionsForRun(run.runId, run.projectId),
    deps.store.reviewCompletedFor(task.taskId, run.projectId),
  ]);

  /**
   * A REVIEW IS NOT REVIEWED, AND WITHOUT THIS THE CHAIN NEVER ENDS.
   *
   * `evaluateJuliusVerification` schedules a review for any task when policy
   * requires one and none has completed. Applied to a REVIEWER's own task that
   * produces `<task>:review:review`, then `<task>:review:review:review` — an
   * unbounded chain of reviewers reviewing reviewers, each a real durable task
   * and a real paid dispatch. The end-to-end scenario is what surfaced it: the
   * architect's plan was reviewed, and the reviewer was then busy forever.
   *
   * Fixed by ANSWERING #175'S OWN QUESTION rather than bypassing its rule: for
   * a reviewer's task, the review that policy asks about has already happened —
   * it IS this task. So `reviewCompleted` is true, the evaluator takes its
   * DECIDE branch, and the rule it applies is unchanged.
   */
  const reviewSatisfied = reviewCompleted || task.role === 'INDEPENDENT_REVIEWER';

  /**
   * A REVIEWER'S VERDICT IS ABOUT THE TASK IT REVIEWED, and treating it as a
   * verdict about ITSELF schedules the repair on the wrong task.
   *
   * `verifyTask` counts FAILED evidence on a task as a reason to repair THAT
   * task. For every worker that is right; for a reviewer it is exactly wrong.
   * A review that found a problem SUCCEEDED — it did the job — and its FAILED
   * `REVIEW_FINDING` evidence is a statement about the work under review.
   *
   * Before this, the end-to-end scenario produced a repair task named
   * `repair:review:plan` — a coding agent asked to repair a REVIEW. No worker
   * accepts that task type, so it failed, and the run stalled with the real
   * defect unrepaired and a nonsense task in the graph.
   *
   * So a reviewer's completion re-verifies the task it reviewed, which now
   * carries the blocking finding recorded above. The repair is then planned
   * for the work, by the same evaluator, with no rule changed.
   */
  const reviewedTask = task.role === 'INDEPENDENT_REVIEWER' && task.parentTaskId !== null
    ? tasks.find((item) => item.taskId === task.parentTaskId) ?? null
    : null;
  const subject = reviewedTask ?? task;

  /**
   * A REVIEWER'S FAILED EVIDENCE BECOMES A BLOCKING FINDING.
   *
   * `recordFinding` was written in #175 and nothing called it, so a review
   * that failed produced FAILED evidence and no FINDING — and
   * `evaluateJuliusVerification` counts BLOCKING FINDINGS, not failed
   * evidence, when it decides whether to repair. A review could therefore fail
   * and change nothing, which is the most expensive kind of no-op the product
   * has: the paid review ran and its verdict was discarded.
   *
   * The finding is attributed to the task under review — a review task's
   * parent — because that is the task a repair must be scheduled for. Its id
   * is derived from the evidence id, so a re-run of the same reviewer produces
   * the same finding rather than a second one.
   */
  if (task.role === 'INDEPENDENT_REVIEWER' && task.parentTaskId !== null) {
    for (const item of evidence) {
      if (item.taskId !== task.taskId || item.type !== 'REVIEW_FINDING' || item.status !== 'FAILED') continue;
      const recorded = await deps.store.recordFinding({
        projectId: run.projectId,
        finding: {
          findingId: `finding:${item.evidenceId}`,
          runId: run.runId,
          taskId: task.parentTaskId,
          reviewerWorkerId: item.workerId,
          severity: 'HIGH',
          category: 'review',
          claim: item.safeSummary,
          criterionId: null,
          evidenceIds: [item.evidenceId],
          blocking: true,
          status: 'OPEN',
          createdAt: item.occurredAt,
        },
      });
      if (recorded) {
        await ledger.event('finding.recorded', {
          taskId: task.parentTaskId, workerId: item.workerId,
          facts: { findingId: `finding:${item.evidenceId}`, evidenceId: item.evidenceId, blocking: true },
        });
        await ledger.trajectory('FINDING', {
          taskId: task.parentTaskId, workerId: item.workerId,
          policyRevision: input.request.verification.revision, outcome: 'BLOCKING',
        });
      }
    }
  }

  const action = evaluateJuliusVerification({
    task: subject,
    evidence,
    criteria,
    // The findings the reviewer just recorded are read back, because
    // `findings` was loaded before this task ran and a decision made without
    // them would be a decision about a review that had not happened yet.
    findings: reviewedTask === null ? findings : await deps.store.findingsForRun(run.runId, run.projectId),
    policy: input.request.verification,
    reviewCompleted: reviewSatisfied,
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
    taskId: subject.taskId,
    policyRevision: input.request.verification.revision,
    idempotencyKey: `${subject.taskId}:${decision.action}:${decision.reasonCode}`,
    occurredAt: deps.clock.now(),
    decision,
  });
  await ledger.event('verification.decided', {
    taskId: subject.taskId, workerId: input.workerId,
    facts: {
      action: decision.action, reasonCode: decision.reasonCode,
      criteriaSatisfied: action.criteriaSatisfied.length, criteriaMissing: action.criteriaMissing.length,
      missionCompletable: action.missionCompletable,
    },
  });
  await ledger.trajectory('VERIFICATION', {
    taskId: subject.taskId, workerId: input.workerId,
    policyRevision: input.request.verification.revision, outcome: decision.action,
    facts: { reasonCode: decision.reasonCode, criteriaMissing: action.criteriaMissing.length },
  });

  if (decision.action === 'REPAIR') {
    // The repair is planned for the SUBJECT — the work — never for the review.
    return scheduleRepair({
      ...input, task: subject, decision,
      findings: await deps.store.findingsForRun(run.runId, run.projectId),
    });
  }
  if (decision.action === 'ACCEPT' || decision.action === 'COMPLETE') {
    /**
     * DEPENDENCY WAKEUP, AS AN EVENT RATHER THAN AS A MECHANISM.
     *
     * The claim query is what actually makes a task claimable, and nothing
     * here changes that — a second wakeup mechanism would race the first. What
     * was missing is the OBSERVABILITY of it: `task.runnable` was in the
     * catalogue and nothing emitted it, so a consumer could see a task claimed
     * and never see the moment work became available. This announces the fact
     * the claim query will act on, and moves nothing.
     */
    for (const dependent of tasks) {
      if (!dependent.dependencyIds.includes(task.taskId)) continue;
      if (dependent.state !== 'BLOCKED' && dependent.state !== 'RUNNABLE') continue;
      const satisfied = dependent.dependencyIds.every((id) => {
        if (id === task.taskId) return true;
        const other = tasks.find((value) => value.taskId === id);
        return other !== undefined && (other.state === 'SUCCEEDED' || other.state === 'SKIPPED');
      });
      if (!satisfied) continue;
      await ledger.event('task.runnable', {
        taskId: dependent.taskId,
        facts: { unblockedBy: task.taskId, role: dependent.role, taskType: dependent.taskType },
      });
    }
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
  const priorRounds = await deps.store.repairRoundsFor(task.taskId, run.projectId);

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
    // NARROWED, NOT TRUSTED. This value leaves the process in the evidence
    // bundle's `reason_code` column, whose contract is "a machine token by
    // construction". Every throw in the repair planner is a token today, but a
    // TypeError from anywhere in it would otherwise put free text into an
    // uploaded artifact, so the narrowing is applied rather than assumed.
    // `safeReasonCode`, not `safeFailureClass`: no upper-case cause reaches
    // this narrowing today — every throw in the repair planner is lower-case
    // and passes either rule — but the column itself carries
    // `UNRESOLVED_WORKER_ROLE` beside `repair_round_limit`, so the alphabet is
    // matched to the column's vocabulary. A future producer that routes an
    // upper-case cause here is then recorded rather than silently generalised.
    const reasonCode = safeReasonCode(error instanceof Error ? error.message : null) ?? 'repair_not_plannable';
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

  /**
   * THE ADMISSION RESERVATION IS RELEASED ONCE THE ROUND IS ADMITTED, and the
   * end-to-end scenario is what caught it being held forever.
   *
   * This reservation exists to answer one question — can this run afford
   * another repair round — and `planJuliusRepair` requires its id, which the
   * repair record keeps as provenance for what admitted the round. It is NOT
   * the reservation the repair spends against: when the repair task is
   * claimed, the ordinary execution path reserves for its own dispatch. Holding
   * both would count one round's budget twice, and holding this one with
   * nothing ever settling it left it RESERVED for the life of the process.
   *
   * The narrow window this opens is stated rather than hidden: between the
   * release here and the repair's own reservation, another task could take the
   * budget, and the repair would then be denied when it is claimed — a refusal
   * at dispatch instead of at scheduling. That is a worse message and not a
   * worse outcome, and it is the honest cost of not double-counting.
   */
  await deps.budget.release({ reservationId, reason: 'REPAIR_ADMITTED', now: deps.clock.now() });

  return { kind: 'REPAIR_SCHEDULED', taskId: task.taskId, repairTaskId: plan.task.taskId, round: plan.round };
}
