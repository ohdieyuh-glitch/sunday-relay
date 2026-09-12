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
import { JuliusExecutionCoordinator, type JuliusExecutionOutcome, type JuliusExecutionPorts, type JuliusExecutionClaim, type JuliusResourceRequest } from './julius-execution-coordinator';
import { safeReasonCode, type JuliusProviderRouter } from './julius-router';
import { juliusCostComponent } from './julius-cost-accounting';
import { juliusContractDisposition, juliusContractDispositionFacts } from './julius-contract-disposition';
import { createJuliusContextSnapshot } from './julius-context-snapshot';
import { JULIUS_DEFAULT_MAX_CODER_SEGMENTS, evaluateJuliusVerification, type JuliusReviewerFinding, type JuliusVerificationPolicy } from './julius-verification-runtime';
import { planJuliusRepair } from './julius-repair-runtime';
import { repairLineageRootOf, repairRoundsBefore, repairTaskTypeFor } from './julius-repair-lineage';
import { challengeJuliusTaskContract, evaluateJuliusBindingCurrency, evaluateJuliusSharedBinding, juliusContractReviewCharge, juliusTaskContractBinding, lockJuliusTaskContract, mayDispatchUnderContract, reviseJuliusTaskContract, sanitizeJuliusContractProposal, type JuliusTaskContract, type JuliusTaskContractBinding } from './julius-task-contract';
import { evaluateJuliusRelease } from './julius-release-runtime';
import { REVIEW_TASK_ATTEMPTS, boundStageForRole, reviewStageOf, workStageOf, type JuliusReviewStage } from './julius-review-stage';
import {
  juliusSegmentLineageRootOf, juliusSegmentTaskId, nextSegmentNumber, routeIsBarrier,
  sanitizeJuliusSegmentState,
} from './julius-segment-lineage';
import {
  JULIUS_CHECKPOINT_LIMITS,
  guidanceSubjectTaskId, issueJuliusGuidance, juliusCheckpointId, juliusGuidanceId, juliusGuidanceTaskId,
  juliusResearchCheckpointId,
  recordJuliusCheckpoint, routeJuliusCheckpoint, sanitizeJuliusGuidanceProposal, sanitizeJuliusGuidanceRequest,
  type JuliusCheckpointOrigin,
} from './julius-continuous-lifecycle';
import { isJuliusResearchRole } from './julius-research-policy';
import {
  JULIUS_RESEARCH_ASK_VERSION, renderJuliusResearchResume, sanitizeJuliusResearchAsks,
  type JuliusResearchObservationRecord, type JuliusResearchPort,
} from './julius-research-protocol';
import { evaluateJuliusAllocation, type JuliusAllocationPolicy } from './julius-allocation-runtime';
import { JULIUS_SLOT_EFFORT_VERSION } from './julius-slot-effort';
import {
  JULIUS_SLOT_ENVELOPE_VERSION, evaluateJuliusSlotAllocation, slotEnvelopeUsdMicros,
  slotRoundShareUsdMicros, type JuliusSlotEnvelopePolicy,
} from './julius-slot-envelope';
import {
  projectJuliusSlotLedger, reserveJuliusSlotCapacity,
  type JuliusBudgetRow, type JuliusMissionSlotLedger,
} from './julius-slot-ledger';
import {
  JULIUS_SHARED_CEILING_VERSION, juliusSharedCeilingDraw, juliusSharedCeilingSourceFor,
  type JuliusSharedCeilingPolicy,
} from './julius-shared-ceiling';
import type { JuliusTimelineReader } from './julius-runtime-api';
import { JULIUS_RUNTIME_VERSION, type JuliusBrainEntry, type JuliusRecordedDecision, type JuliusTask, type JuliusVerificationDecision, type JuliusWorker, type JuliusWorkerRole } from './julius-runtime';
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
 * THE CEILING THIS TASK ACTUALLY GETS — and the one place anything may ask.
 *
 * A REVIEW IS NOT RETRIED. `MAX_TASK_ATTEMPTS` gives every task three, which
 * for a review is three provider calls against the same packet, the same
 * engine deadline and the same prompt. The reviewer's observed failure mode is
 * a request that outran the engine's own per-request timeout; repeating it
 * verbatim reaches the same wall, so the second and third attempts buy nothing
 * and spend the job's reviewer share doing it.
 *
 * This is the number `reviewer-deadline.ts` budgets against, read from here
 * rather than restated there — `MAX_REVIEWER_ATTEMPTS` was a modelling constant
 * the dispatch path never consulted, still describing the two review stages
 * that existed when it was written, and its arithmetic was the only thing
 * keeping an understated deadline looking affordable.
 *
 * A repair after `changes_required` is a NEW task with its own ceiling. It is
 * not another attempt at the review, and counting it as one would make a
 * reviewer doing its job indistinguishable from a reviewer failing at it.
 */
export function taskAttemptCeiling(taskType: string): number {
  return reviewStageOf(taskType) === null ? MAX_TASK_ATTEMPTS : REVIEW_TASK_ATTEMPTS;
}

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
  /**
   * THE MISSION'S ALLOCATION POLICY, when the composition has one. A Coding
   * Agent dispatch is then allocated a bounded share of the run budget, that
   * share is what gets reserved, and the adapter is limited to exactly it.
   * Absent, every dispatch reserves its fixed estimate and the adapter keeps
   * its own conservative default — Mission 2's grant reaches nobody else.
   */
  readonly allocation?: JuliusAllocationPolicy | JuliusSlotEnvelopePolicy | JuliusSharedCeilingPolicy;
  /**
   * HOW JULIUS GOES AND LOOKS, when the composition has bound one.
   *
   * Absent, a research ask from any slot is recorded and refused as
   * `RESEARCH_UNSERVED` and the mission continues — the same safe default the
   * guidance path takes when no worker serves `guidance`. A mission is never
   * stalled on a question nothing can answer.
   */
  readonly research?: JuliusResearchPort;
  /**
   * THE DURABLE MONEY RECORD, READ BACK.
   *
   * The per-slot ledger is PROJECTED from `budget.reserved` and `budget.settled`
   * rather than stored, so it cannot drift from the money record and survives a
   * restart without a table. Absent, allocation v2 falls back to counting rounds
   * off the task rows — a conservative lower bound that cannot tell an open
   * reservation from one settled for less, and the basis it reports says so.
   */
  readonly timeline?: JuliusTimelineReader;
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
  /** Resolves the capability a task not yet created would need, so a repair can be proven routable before it exists. */
  readonly capabilityFor?: (task: { taskId: string; taskType: string; role: string }) => string;
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
    /**
     * THE AGREEMENT THIS DISPATCH RUNS UNDER, carried from the gate that proved
     * it rather than re-read downstream — two reads could see two different
     * revisions, and the whole point of the binding is that one dispatch names
     * exactly one. `null` for the roles that need no contract (see
     * {@link juliusContractSubjectTaskId}), which is a fact rather than an
     * absence: those tasks are not bound, not unbound-and-permitted-anyway.
     */
    readonly contractBinding: JuliusTaskContractBinding | null;
    /**
     * The locked contract itself, read ONCE at the gate. A reviewer is charged
     * with its terms and a second read could see a different revision — the
     * whole point of a binding is that one dispatch names exactly one.
     */
    readonly contract: JuliusTaskContract | null;
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
/**
 * WHICH TASK'S CONTRACT GOVERNS THIS ONE.
 *
 * `null` means this task needs no locked contract, and the two cases are
 * deliberate rather than a whitelist:
 *
 *   THE PROMPT ARCHITECT plans and REVISES the contract, so requiring one
 *   before it may run would deadlock the only role that can propose the terms.
 *   Its own review is the challenge step, and is exempt for the same reason.
 *
 *   THE CODING AGENT is bound, and bound by ITS ROOT'S contract rather than
 *   one of its own. `repair:build` is still the build, and a bounded sub-agent
 *   is work its parent delegated — neither may be graded against terms of its
 *   own, or a worker could escape the mission's by spawning a child. So the
 *   walk climbs `parentTaskId` through every coding ancestor, which covers a
 *   repair round, a sub-agent, and a sub-agent of a repair alike.
 *
 *   THE INDEPENDENT REVIEWER of a coding task is bound by that task's
 *   contract, which is rule 2 — the thing being graded and the thing it is
 *   graded against must be one document.
 */
export function juliusContractSubjectTaskId(task: JuliusTask, tasks: readonly JuliusTask[]): string | null {
  const byId = new Map(tasks.map((item) => [item.taskId, item]));
  const rootOf = (start: JuliusTask): string => {
    const seen = new Set<string>([start.taskId]);
    let current = start;
    while (current.parentTaskId !== null) {
      const parent = byId.get(current.parentTaskId);
      // A parent in another role is a different kind of relationship — a review
      // reviews, it does not own — and a cycle is a graph nobody can climb.
      if (parent === undefined || parent.role !== current.role || seen.has(parent.taskId)) break;
      seen.add(parent.taskId);
      current = parent;
    }
    return current.taskId;
  };
  /**
   * A SPECIALIST IS BOUND BY THE CODING WORK IT WAS SPAWNED UNDER.
   *
   * `SPECIALIST:*` is a resolvable, dispatchable role — `resolveWorkerRole`
   * accepts it and the router will pay for it — and it used to resolve to no
   * subject at all, so a specialist child of a build ran a provider under no
   * agreement whatever its parent had locked. The parent chain is climbed
   * through any role to the nearest Coding Agent and that lineage's root is
   * the subject. A specialist with NO coding ancestor is bound to itself: it
   * needs a contract of its own or it is refused `contract_absent` before a
   * reservation exists. Nothing in production spawns one today, and the strict
   * answer is the one a later decision can loosen on purpose; the loose answer
   * is the one that would have been paying for ungoverned work silently.
   */
  const codingAncestorOf = (start: JuliusTask): JuliusTask | null => {
    const seen = new Set<string>([start.taskId]);
    let current = start;
    while (current.parentTaskId !== null) {
      const parent = byId.get(current.parentTaskId);
      if (parent === undefined || seen.has(parent.taskId)) return null;
      if (parent.role === 'CODING_AGENT') return parent;
      seen.add(parent.taskId);
      current = parent;
    }
    return null;
  };
  const subjectOfWorker = (worker: JuliusTask): string | null => {
    if (worker.role === 'CODING_AGENT') return rootOf(worker);
    if (worker.role.startsWith('SPECIALIST:')) {
      const ancestor = codingAncestorOf(worker);
      return ancestor === null ? worker.taskId : rootOf(ancestor);
    }
    /**
     * A GUIDANCE TASK IS THE ONE ARCHITECT TASK THAT IS BOUND.
     *
     * The architect that DRAFTS the terms is bound by none — it is writing
     * them. The architect that ADVISES under terms already locked is bound by
     * exactly those, which is what makes the whole continuous lifecycle safe:
     * the guidance task then passes the ordinary dispatch gate (refused unless
     * LOCKED), records the ordinary binding on its claim, and its own review
     * passes the ordinary shared-binding guard. Not one of those three had to
     * be rebuilt for the new path; this line is what buys them.
     */
    const guided = guidanceSubjectTaskId(worker.taskId);
    if (guided !== null) {
      const subject = byId.get(guided);
      return subject === undefined ? null : rootOf(subject);
    }
    // The Prompt Architect produces the terms and is bound by none.
    return null;
  };
  const own = subjectOfWorker(task);
  if (own !== null) return own;
  if (task.role === 'INDEPENDENT_REVIEWER' && task.parentTaskId !== null) {
    const reviewed = byId.get(task.parentTaskId);
    if (reviewed !== undefined) return subjectOfWorker(reviewed);
  }
  return null;
}

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

  /* ------------------------------------- 3. the task contract, before the attempt */
  /**
   * RULE 1 — CODING MUST NOT BEGIN BEFORE THE CONTRACT IS LOCKED.
   *
   * Placed here, in the one pre-execution gate, for the reason every other gate
   * moved here: a refusal must cost no execution attempt. `admitTask` runs
   * AFTER this returns, so a run that cannot show what its coder was charged
   * with is stopped without spending one of its three turns on the question.
   *
   * It is a separate question from the release rule (#234), and both are
   * needed. `evaluateJuliusRelease` asks whether the build's DEPENDENCIES are
   * accepted; this asks whether what the build was asked to do has been AGREED.
   * A run can satisfy the first and not the second — an accepted plan review
   * whose contract was then revised — and dispatching on the graph alone sends
   * a coder to work against terms nobody locked.
   *
   * FAIL CLOSED AND LOUD. The task ends FAILED with the gate's own reason code
   * rather than being handed back, because nothing about retrying a dispatch
   * causes a contract to become agreed; a quiet requeue would spin the run
   * against a condition only a decision can change.
   */
  const contractTaskId = juliusContractSubjectTaskId(task, tasks);
  if (contractTaskId !== null) {
    const contract = await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
    const verdict = mayDispatchUnderContract(contract);
    if (!verdict.permitted) {
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('contract.refused', {
        taskId: claim.taskId,
        facts: { reasonCode: verdict.reasonCode, contractTaskId, role: claim.role },
      });
      await ledger.trajectory('DISPATCH', { taskId: claim.taskId, policyRevision: request.policy.revision, outcome: 'CONTRACT_NOT_LOCKED', facts: { reasonCode: verdict.reasonCode } });
      return {
        kind: 'REFUSED',
        outcome: {
          kind: 'HALTED', taskId: claim.taskId, reasonCode: 'TASK_CONTRACT_NOT_LOCKED',
          safeSummary: `The task contract governing ${contractTaskId} is not locked (${verdict.reasonCode}), so no work was dispatched.`,
        },
      };
    }
    return { kind: 'ELIGIBLE', run, role, task, contractBinding: verdict.binding, contract };
  }

  return { kind: 'ELIGIBLE', run, role, task, contractBinding: null, contract: null };
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
/** The three closed values that name an agreement on a trajectory row; null when the role is unbound. */
function bindingFacts(binding: JuliusTaskContractBinding | null): Record<string, string | number | null> {
  return {
    contractTaskId: binding?.taskId ?? null,
    contractRevision: binding?.contractRevision ?? null,
    bindingDigest: binding?.bindingDigest ?? null,
  };
}

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
   * RULE 5 — THE REVIEWER GRADES AGAINST THE CONTRACT.
   *
   * Built from the contract the gate proved, and handed DOWN to the adapter
   * rather than looked up by it: a worker that could fetch its own charge
   * would be choosing what it is bound by, which is the same inversion
   * `taskType` exists for.
   *
   * THE CODER RECEIVES IT TOO. It used to reach only the reviewer, on the
   * reasoning that a coder "is bound by the contract but does not review
   * against it" — which left the coder briefed by the plan alone and made
   * "the coder executed under the contract" mean only that a binding was
   * written beside its claim. A worker must explicitly receive the locked
   * revision it executes: the same objective, boundary, permitted paths,
   * required checks and stopping condition the reviewer will grade against,
   * carried on the dispatch, so that the two roles hold one document rather
   * than two readings of a plan. The stage on a coder's charge names the
   * round (`build` or `repair:build`); the reviewer's names what it judges.
   * An unbound role receives none, and an unknown review type is not guessed
   * at.
   */
  const reviewStage = role === 'INDEPENDENT_REVIEWER' ? reviewStageOf(claim.taskType) : null;
  const chargeStage: JuliusReviewStage | null = reviewStage
    ?? (preflight.contractBinding === null || role === 'INDEPENDENT_REVIEWER'
      ? null
      // READ OFF THE TASK FIRST, and fall back to the ROLE — never to a prefix.
      // The old derivation asked "is it prefixed `repair:`?" and answered
      // `repair:build` or `build`, which was correct only while the coder was
      // the one bound non-review role. A guidance task took the `build` branch
      // and its charge went on the record under the coder's stage. A sub-agent
      // child names no stage at all (`spawnJuliusSubagent` takes the type from
      // its caller, so it can be `audit`), and it still executes under its
      // parent's contract — which is what the role fallback is for.
      : workStageOf(claim.taskType) ?? boundStageForRole(role, claim.taskType));
  const contractCharge = preflight.contract !== null && chargeStage !== null
    ? juliusContractReviewCharge({ contract: preflight.contract, stage: chargeStage })
    : null;
  /**
   * RULE 2, ENFORCED RATHER THAN RECORDED.
   *
   * `contractCharge` above is built from the lock CURRENT at the reviewer's
   * claim. The coder executed under the lock current at ITS claim. Those are
   * one document unless the contract was revised and re-locked in between —
   * and then a reviewer grading against revision 2 would be judging work done
   * to revision 1, with every finding citing criteria the coder never held.
   * `evaluateJuliusSharedBinding` existed for exactly this comparison and was
   * called by nothing on the runtime path; the durable `task.claimed` record
   * is what makes the comparison possible after a restart.
   *
   * The subject is the review's parent — the build, or the repair round that
   * reviewer is judging — and its binding was recorded before it was dispatched.
   * Fail closed and loud: a review that cannot show it holds the coder's
   * agreement is not run, and nothing about retrying it changes the record.
   */
  if (reviewStage !== null && contractCharge !== null && preflight.contractBinding !== null) {
    const subjectTaskId = task.parentTaskId ?? preflight.contractBinding.taskId;
    const implementation = await deps.store.executedBindingFor(subjectTaskId, run.projectId);
    const shared = evaluateJuliusSharedBinding({ implementation, review: preflight.contractBinding });
    if (!shared.shared) {
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('contract.refused', {
        taskId: claim.taskId,
        facts: {
          reasonCode: shared.reasonCode, contractTaskId: preflight.contractBinding.taskId, role, subjectTaskId,
          contractId: preflight.contractBinding.contractId,
          reviewRevision: preflight.contractBinding.contractRevision,
          implementationRevision: implementation?.contractRevision ?? null,
        },
      });
      await ledger.trajectory('DISPATCH', {
        taskId: claim.taskId, policyRevision: request.policy.revision, outcome: 'REVIEW_CONTRACT_MISMATCH',
        facts: { reasonCode: shared.reasonCode, reviewRevision: preflight.contractBinding.contractRevision, implementationRevision: implementation?.contractRevision ?? null },
      });
      return {
        kind: 'HALTED', taskId: claim.taskId, reasonCode: 'REVIEW_CONTRACT_MISMATCH',
        safeSummary: `The review of ${subjectTaskId} does not hold the contract binding that work was executed under (${shared.reasonCode}), so no review was dispatched.`,
      };
    }
  }
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
  /**
   * RULE 2 IS RECORDED, NOT ASSUMED. The binding the gate proved is written on
   * this dispatch, so "the coder and its reviewer held the same agreement" is a
   * durable comparison of two rows rather than a claim about code paths. Null
   * for the roles that are not bound, which is a fact and not an absence.
   */
  await ledger.event('task.claimed', {
    taskId: claim.taskId,
    facts: {
      leaseGeneration: claim.leaseGeneration, attempt: claim.attempt, role: claim.role,
      contractId: preflight.contractBinding?.contractId ?? null,
      contractTaskId: preflight.contractBinding?.taskId ?? null,
      contractRevision: preflight.contractBinding?.contractRevision ?? null,
      bindingDigest: preflight.contractBinding?.bindingDigest ?? null,
    },
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
  /**
   * WHAT JULIUS HANDED THIS DISPATCH, measured where it is known and carried to
   * where it is recorded. Null until a context is compiled — a dispatch with no
   * packet was handed nothing MEASURED, which is not the same as being handed
   * nothing, so it stays unknown rather than becoming zero.
   */
  let handed: { brainRetrievals: number; evidenceInspected: number } | null = null;
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
    const [evidence, findings, criteria, brain, runTasks] = await Promise.all([
      deps.store.evidenceForRun(run.runId, run.projectId),
      deps.store.findingsForRun(run.runId, run.projectId),
      deps.store.criteriaForRun(run.runId, run.projectId),
      deps.store.brainEntriesForRun(run.runId, run.projectId),
      // Only a repair RE-REVIEW needs to walk to its parent's parent; every
      // other task's subject is its own parent, and a 300-task run must not
      // pay for a graph copy per dispatch it will not read.
      task.taskType.startsWith('review:repair:') ? deps.store.tasksForRun(run.runId, run.projectId) : Promise.resolve([] as readonly JuliusTask[]),
    ]);
    /**
     * A REPAIR SEES WHAT IT IS REPAIRING. The findings that admitted a repair
     * round were recorded on the SUBJECT, and the context carried only the
     * Project Brain — so the worker asked to revise a plan, or repair a build,
     * was never told why. Julius compiles the subject's OPEN blocking findings
     * into the repair's context (and into its re-review's, so the reviewer can
     * judge resolution) as FINDING entries scoped to this task and role.
     */
    const priorFindings = repairContextFindings(task, runTasks, findings);
    const snapshot = createJuliusContextSnapshot({
      contextId: deps.ids.next('context'),
      runId: run.runId,
      task,
      worker,
      entries: [...brain, ...priorFindings.map((finding) => findingEntryFor(task, finding))],
      maxCharacters: deps.contextCharacterBudget,
      missionContractRevision: run.missionContractRevision,
      cardRevision: run.cardRevision,
      projectBrainRevision: run.projectBrainRevision,
      /**
       * THE AGREEMENT THIS PACKET IS COMPILED UNDER. Null for a role that is
       * not bound by one, which is a fact rather than an omission.
       *
       * It reaches the content hash, and that is why it is here rather than
       * only on the event: `persist` deduplicates on
       * `(task_id, worker_id, content_hash)`, so a retry after the contract was
       * revised — with a packet whose text happens to be unchanged — would
       * match the row compiled under the PREVIOUS agreement and hand the worker
       * a context recorded against terms nobody holds any more.
       */
      taskContractRevision: preflight.contractBinding?.contractRevision ?? null,
      taskContractDigest: preflight.contractBinding?.bindingDigest ?? null,
      dependencyTaskIds: task.dependencyIds,
      evidenceIds: evidence.filter((value) => task.dependencyIds.includes(value.taskId)).map((value) => value.evidenceId),
      findingIds: (priorFindings.length > 0 ? priorFindings : findings.filter((value) => value.taskId === task.taskId)).map((value) => value.findingId),
      acceptanceCriterionIds: criteria.map((value) => value.criterionId),
    });
    /**
     * WHAT THIS DISPATCH WAS ACTUALLY HANDED — the two effort dimensions Julius
     * can measure itself, and the only point in the runtime that knows them.
     *
     * `maybe()` at the effort row reads `result.usage`, which is the PROVIDER's
     * self-report. Neither of these is a provider fact: what reached a worker's
     * packet is Julius's own act, so wiring them to `usage` left them permanently
     * null. They are threaded to the effort row the way `allocated` already is.
     *
     * `brainRetrievals` counts the Project Brain entries that SURVIVED the
     * character budget — `sourceEntryIds` is what fit, not what was offered —
     * intersected with the brain array, because `entries` also carries the
     * repair FINDING entries compiled beside it and those are not retrievals.
     *
     * `evidenceInspected` is a REFERENCE count, not a read receipt: evidence
     * reaches a packet as a list of ids rather than as text, so this is
     * "evidence this dispatch was shown", which is what the dimension claims
     * and no more.
     */
    const brainEntryIds = new Set(brain.map((entry) => entry.entryId));
    handed = {
      brainRetrievals: snapshot.sourceEntryIds.filter((id) => brainEntryIds.has(id)).length,
      evidenceInspected: snapshot.evidenceIds.length,
    };
    /**
     * A REPAIR THAT CANNOT SEE ITS FINDINGS IS NOT A REPAIR.
     *
     * `compileJuliusContext` stops at the first entry that would overflow the
     * character budget, and the findings are appended after the Project Brain
     * — so a large brain silently drops exactly the entries the repair exists
     * to address, and `findingIds` would then record findings the worker was
     * never shown. Refusing here keeps the durable claim true and costs a
     * dispatch nobody could have acted on. The brain stays first because a
     * revision that loses the mission objective is the worse failure.
     */
    const droppedFindings = priorFindings.filter((finding) =>
      !snapshot.sourceEntryIds.includes(findingEntryFor(task, finding).entryId));
    if (droppedFindings.length > 0) {
      await ledger.event('task.failed', {
        taskId: task.taskId,
        facts: {
          code: 'INVALID_REQUEST', errorRetryable: false, failureClass: 'repair_context_findings_dropped',
          droppedFindings: droppedFindings.length, characterCount: snapshot.characterCount,
        },
      });
      await deps.store.finishTask({
        taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
        state: 'FAILED', now: deps.clock.now(),
      });
      return { kind: 'FAILED', taskId: claim.taskId, code: 'INVALID_REQUEST', failureClass: 'repair_context_findings_dropped' };
    }
    /**
     * THE STORE'S ID, NOT THE ONE WE MINTED.
     *
     * `persist` deduplicates on (task_id, worker_id, content_hash), so a RETRY
     * of a task whose context has not changed stores nothing and the id minted
     * above exists nowhere. Assigning it here is what put a dangling
     * `context_id` on a trajectory event and crashed paid Mission #2 on the
     * foreign key. The stored id is the only one anything downstream may name.
     */
    const persistedContextId = await deps.store.persist({ projectId: run.projectId, snapshot });
    if (persistedContextId === null) {
      // The store could not prove a context exists. Dispatching would hand a
      // worker a context nothing can resolve and write references to a row
      // that is not there, so the task fails here instead — visibly, before a
      // provider is paid.
      await ledger.event('task.failed', {
        taskId: task.taskId,
        facts: { code: 'INVALID_REQUEST', errorRetryable: false, failureClass: 'context_not_persisted' },
      });
      await deps.store.finishTask({
        taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
        state: 'FAILED', now: deps.clock.now(),
      });
      return { kind: 'FAILED', taskId: claim.taskId, code: 'INVALID_REQUEST', failureClass: 'context_not_persisted' };
    }
    contextId = persistedContextId;
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

  /* ----------------------- 2b. the agreement, re-read before anything is spent */
  /**
   * A HANDOFF IS STALE WHEN THE AGREEMENT MOVED UNDER IT.
   *
   * `prepareClaimedTask` read the lock and the context above was compiled from
   * that binding. Between those two reads and this line, an accepting review
   * on another tick can lock a NEWER revision — and the worker would then be
   * handed a packet recorded against terms nobody holds any more, with the
   * money spent against them. `evaluateJuliusBindingCurrency` existed for this
   * and was called by nothing on the runtime path; every dispatch compiled
   * fresh, so the property held by accident rather than by check.
   *
   * It is checked HERE, after the context and before the reservation, because
   * this is the last instant Julius can refuse without a provider being paid.
   * The window between this read and the provider call is not closable at
   * this layer; the task lease and the coordinator's reservation are the
   * fences there.
   *
   * NEVER SILENTLY UPGRADED. A stale handoff is refused, not rebound to the
   * newest revision: a worker must explicitly receive the locked revision it
   * executes, and a packet compiled under revision 1 is not that packet for
   * revision 2 however similar its text. INDETERMINATE refuses too — a bound
   * role with nothing locked to compare against is the gate's own failure, not
   * a licence.
   */
  if (preflight.contractBinding !== null) {
    const recorded = preflight.contractBinding;
    const current = await deps.store.loadTaskContract({ projectId: run.projectId, taskId: recorded.taskId });
    const currency = evaluateJuliusBindingCurrency({ recorded, contract: current });
    if (currency !== 'CURRENT') {
      const reasonCode = `binding_${currency.toLowerCase()}`;
      await deps.store.finishTask({ taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration, state: 'FAILED', now: deps.clock.now() });
      await ledger.event('contract.refused', {
        taskId: claim.taskId,
        facts: {
          reasonCode, contractTaskId: recorded.taskId, role, contractId: recorded.contractId,
          recordedRevision: recorded.contractRevision, currentRevision: current?.contractRevision ?? null,
          currentState: current?.state ?? null,
        },
      });
      await ledger.trajectory('DISPATCH', {
        taskId: claim.taskId, policyRevision: request.policy.revision, outcome: 'CONTRACT_STALE',
        facts: { reasonCode, recordedRevision: recorded.contractRevision, currentRevision: current?.contractRevision ?? null },
      });
      return {
        kind: 'HALTED', taskId: claim.taskId, reasonCode: 'TASK_CONTRACT_STALE',
        safeSummary: `The handoff for ${claim.taskId} was compiled under contract revision ${recorded.contractRevision} and the agreement is now ${currency.toLowerCase()} (${reasonCode}), so no work was dispatched.`,
      };
    }
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
  const estimate = deps.resources.estimate({ taskId: claim.taskId, taskType: claim.taskType, role: claim.role, attempt: claim.attempt });
  /**
   * THE ALLOCATION IS THE RESERVATION IS THE LIMIT.
   *
   * With an allocation policy, a Coding Agent dispatch is allocated its share
   * of the mission budget bounded by what remains; that amount is what the
   * coordinator reserves, and it travels to the adapter as the execution
   * ceiling. So the adapter can never be allowed more than Julius reserved,
   * the sum of allocations can never pass the ceiling (the ledger refuses),
   * and a mission with nothing left is denied HERE, before a provider is
   * reached, rather than by an adapter refusing work it already did.
   */
  const allocation = await allocateFor({ deps, run, role, taskId: claim.taskId, estimateUsdMicros: estimate.usdMicros });
  /**
   * WHAT IS HELD, which is not always what is permitted. A rule that separates
   * them says so with `reserveUsdMicros`; the rules that do not are unchanged.
   */
  const resources: JuliusResourceRequest = allocation === null
    ? estimate
    : { ...estimate, usdMicros: allocation.reserveUsdMicros ?? allocation.usdMicros };
  const dispatchAllocation = allocation === null ? undefined
    : { usdMicros: allocation.usdMicros, policyVersion: allocation.policyVersion, basis: allocation.basis };
  if (allocation !== null) {
    await ledger.event('budget.allocated', { taskId: claim.taskId, facts: { role, ...allocationFacts(allocation) } });
  }

  const coordinator = new JuliusExecutionCoordinator(
    deps.router,
    executionPorts(deps, run, ledger, allocation?.usdMicros ?? null, handed),
  );

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
  let outcome: JuliusExecutionOutcome = allocation?.basis === 'EXHAUSTED'
    ? await (async (): Promise<JuliusExecutionOutcome> => {
      await ledger.event('budget.denied', { taskId: claim.taskId, facts: { reason: 'BUDGET_EXHAUSTED', ...allocationFacts(allocation) } });
      return { status: 'DENIED', code: 'BUDGET_DENIED' };
    })()
    : await coordinator.execute({
      claim: executionClaim, policy: request.policy, role, taskType: claim.taskType,
      capability: request.capability, resources, operationId, signal: request.signal,
      attempt: claim.attempt,
      ...(dispatchAllocation === undefined ? {} : { allocation: dispatchAllocation }),
      ...(contractCharge === null ? {} : { contract: contractCharge }),
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
      attempt: claim.attempt,
      signal: request.signal, excludedWorkerIds: tried,
      ...(contractCharge === null ? {} : { contract: contractCharge }),
      ...(dispatchAllocation === undefined ? {} : { allocation: dispatchAllocation }),
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
        // The ceiling this TASK gets, which for a review is one.
        maxAttempts: taskAttemptCeiling(claim.taskType), errorCode: outcome.code as never,
      });
      requeue = carryOn.proceed;
      if (!carryOn.proceed) {
        await ledger.event('task.failed', {
          taskId: claim.taskId,
          facts: {
            /**
             * WHAT THE BOUNDARY SAW, ON THE ROW THAT ENDS THE TASK.
             *
             * The coordinator flattened these onto its own `retry.scheduled`
             * and then had nowhere to put them: its outcome carried the code
             * and the class alone. So the terminal row — the one a reader opens
             * first to ask why a paid mission ended — named neither the served
             * model, nor the response id, nor the tokens, nor what a coder had
             * already spent before it timed out, while all of it sat one event
             * earlier under a different type. Spread FIRST so nothing below can
             * be overwritten by a `diag_` key; the prefix already makes a
             * collision impossible, and the order says so.
             */
            ...(outcome.diagnostics ?? {}),
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
      facts: { failureClass: outcome.failureClass ?? null, ...bindingFacts(preflight.contractBinding) },
    });
    if (requeue) return { kind: 'RETRY', taskId: claim.taskId, code: outcome.code, failureClass: outcome.failureClass ?? null };
    if (outcome.status === 'DENIED') return { kind: 'DENIED', taskId: claim.taskId, reasonCode: outcome.code };
    return { kind: 'FAILED', taskId: claim.taskId, code: outcome.code, failureClass: outcome.failureClass ?? null };
  }

  /**
   * THE AGREEMENT IS ON THE TRAJECTORY ROW. The trajectory is the record evals
   * and the evidence bundle read to say what a run did; a dispatch row that
   * could not say which revision it ran under would let a repair lineage read
   * as one story when its rounds ran under two. Null for the unbound roles,
   * which is a fact, not an omission.
   */
  await ledger.trajectory('DISPATCH', {
    taskId: claim.taskId, workerId: outcome.workerId, contextId,
    policyRevision: request.policy.revision, outcome: 'COMPLETED',
    facts: { duplicate: outcome.duplicate, ...bindingFacts(preflight.contractBinding) },
  });

  /* ------------------------------- 3b. a contract revision the worker proposed */
  /**
   * THE ARCHITECT PROPOSES THE DETAIL, AND JULIUS STORES IT AS A DRAFT.
   *
   * Revision 1 is Julius's, seeded from the Mission Contract. What it cannot
   * contain is the detail only a planner can supply — the exact checks, the
   * narrowed boundary, the concrete outputs — so the architect proposes them and
   * this is where the proposal becomes a durable revision.
   *
   * A DRAFT, NEVER A LOCK. The plan review is the challenge step and the
   * accepting decision is what locks whatever revision is then current; a worker
   * that could lock would be agreeing with itself.
   *
   * THREE REFUSALS BEFORE ANYTHING BINDS, and they are separate on purpose:
   * `sanitizeJuliusContractProposal` refuses a shape a provider should not send,
   * `reviseJuliusTaskContract` refuses every mission-owned field, and
   * `validateJuliusTaskContract` (inside it) refuses a result that could not be
   * reviewed against. A refusal is RECORDED and the run continues on the
   * revision it already has — the plan is still the plan, and failing a task
   * because its optional proposal was malformed would trade a worse contract for
   * no mission.
   */
  if (outcome.contractProposal !== undefined && !outcome.duplicate) {
    await proposeContractRevision({
      deps, run, ledger, task,
      tasks: await deps.store.tasksForRun(run.runId, run.projectId),
      workerId: outcome.workerId, proposal: outcome.contractProposal,
    });
  }

  /* ------------------------------- 3b. the continuous three-worker lifecycle */
  if (!outcome.duplicate && (
    outcome.guidanceRequest !== undefined
    || outcome.guidance !== undefined
    || outcome.researchAsks !== undefined
  )) {
    await driveContinuousLifecycle({
      deps, run, ledger, task, request, workerId: outcome.workerId,
      ...(outcome.guidanceRequest === undefined ? {} : { guidanceRequest: outcome.guidanceRequest }),
      ...(outcome.segmentResume === undefined ? {} : { segmentResume: outcome.segmentResume }),
      ...(outcome.researchAsks === undefined ? {} : { researchAsks: outcome.researchAsks }),
      ...(outcome.guidance === undefined ? {} : { guidance: outcome.guidance }),
    });
  }

  /* --------------------------------------------------- 4. verification */
  return verifyExecutedTask({ request, deps, run, ledger, task, workerId: outcome.workerId, duplicate: outcome.duplicate });
}

/**
 * THE CONTINUOUS LIFECYCLE, driven from the one place a dispatch ends.
 *
 * Two directions cross here and they are deliberately not symmetric.
 *
 * A CODER MAY ASK. Its result may carry a `guidanceRequest`, which Julius turns
 * into a checkpoint, routes, and — if the route says so — answers by minting a
 * REAL TASK on the architect. Not a message, not a side channel: a task, so it
 * is claimed under a lease, admitted against an attempt, dispatched under the
 * locked contract, banked as evidence, reviewed and decided exactly like every
 * other unit of work. That is the whole reason participation is expressed this
 * way — a parallel channel would have to re-earn every one of those properties,
 * and would get most of them wrong.
 *
 * AN ARCHITECT MAY ANSWER. A `guidance` result on a guidance task is sanitised,
 * bound to the contract revision in force, and recorded. It cannot amend the
 * contract: the packet has nowhere to put a contract term and the sanitizer
 * refuses a proposal that names one.
 *
 * A REFUSAL IS RECORDED AND THE RUN CONTINUES, exactly as a malformed contract
 * proposal is: failing a task because its optional guidance was unusable would
 * trade worse advice for no mission.
 */
async function driveContinuousLifecycle(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly request: JuliusPipelineRequest;
  readonly workerId: string;
  readonly guidanceRequest?: unknown;
  readonly guidance?: unknown;
  readonly segmentResume?: unknown;
  readonly researchAsks?: unknown;
}): Promise<void> {
  const { deps, run, ledger, task } = input;

  if (input.guidance !== undefined) {
    await issueGuidanceFromResult(input);
  }

  /**
   * A DISPATCH YIELDS FOR ONE REASON, and research wins when both arrive.
   *
   * Julius can answer a research ask itself, immediately and cheaply; guidance
   * costs the architect a turn. A worker holding both is usually a worker that
   * will not need the second once it has the first, and minting two
   * continuations for one subject would collide on the segment number and
   * silently drop one of them. The guidance request is RECORDED as deferred
   * rather than discarded, so the record says what the worker asked for.
   */
  if (input.researchAsks !== undefined) {
    const yielded = await driveResearchCheckpoint(input);
    if (yielded) {
      if (input.guidanceRequest !== undefined) {
        await ledger.event('guidance.deferred', {
          taskId: task.taskId, workerId: input.workerId,
          facts: { reasonCode: 'RESEARCH_YIELD_TOOK_THE_SEGMENT' },
        });
      }
      return;
    }
  }

  if (input.guidanceRequest === undefined) return;

  // THE SUBJECT IS THE ASKING TASK ITSELF. A coder asks about its own build;
  // routing a request onto some parent would answer a question nobody posed.
  const subjectTaskId = task.taskId;
  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);
  const priorGuidance = tasks.filter((row) => guidanceSubjectTaskId(row.taskId) === subjectTaskId);
  const sequence = priorGuidance.length + 1;

  const contractTaskId = juliusContractSubjectTaskId(task, tasks);
  const contract = contractTaskId === null
    ? null
    : await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
  const binding = contract === null ? null : juliusTaskContractBinding(contract);

  const request = sanitizeJuliusGuidanceRequest(input.guidanceRequest);
  const recorded = recordJuliusCheckpoint({
    checkpointId: juliusCheckpointId(subjectTaskId, sequence),
    runId: run.runId,
    taskId: subjectTaskId,
    sequence,
    trigger: 'GUIDANCE_REQUESTED',
    origin: originForRole(task.role),
    binding,
    evidenceIds: [],
    // The worker's own bounded words about what it is stuck on, or Julius's
    // sentence when the request arrived unusable. Never the provider's body.
    safeSummary: request?.question ?? 'A worker asked for guidance and its request could not be read.',
    recordedAt: deps.clock.now(),
  });
  if (recorded.outcome === 'REFUSED') {
    await ledger.event('guidance.refused', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: { reasonCode: recorded.reasonCode, stage: 'checkpoint' },
    });
    return;
  }

  const checkpoint = recorded.checkpoint;
  await ledger.event('checkpoint.recorded', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, trigger: checkpoint.trigger, origin: checkpoint.origin,
      sequence: checkpoint.sequence, evidenceCount: checkpoint.evidenceIds.length,
      contractRevision: binding?.contractRevision ?? null,
      contractBindingDigest: binding?.bindingDigest ?? null,
    },
  });

  // AN OUTSTANDING QUESTION SUPPRESSES THE NEXT ONE. This is the anti-spam rule
  // and it is computed from durable task state, not from a counter.
  const guidanceInFlight = priorGuidance.some(
    (row) => row.state === 'RUNNABLE' || row.state === 'ACTIVE' || row.state === 'BLOCKED',
  );
  const routing = routeJuliusCheckpoint({
    checkpoint, verdict: null, guidanceInFlight, contractState: contract?.state ?? null,
  });
  if (routing.route !== 'REQUEST_GUIDANCE') {
    await ledger.event('checkpoint.verdict', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: { checkpointId: checkpoint.checkpointId, route: routing.route, reasonCode: routing.reasonCode },
    });
    return;
  }

  /**
   * A GUIDANCE TASK NOBODY CAN CLAIM IS WORSE THAN NO GUIDANCE AT ALL.
   *
   * `scheduleRepair` learned this the expensive way on paid run 34037313976: a
   * task minted for a role nothing serves does not fail, it SITS — RUNNABLE
   * forever, with the mission unable to complete around it. The same preflight
   * is applied here, and it is what lets this land safely ahead of the live
   * architect's guidance charter: until a worker registers `guidance`, Julius
   * records that it would have asked and carries on, rather than stalling a
   * paid mission on a question no one can answer.
   */
  const capability = input.request.capabilityFor?.({
    taskId: subjectTaskId, taskType: 'guidance', role: 'PROMPT_ARCHITECT',
  });
  if (capability !== undefined) {
    const routes = deps.router.eligibleWorkerIds({
      role: 'PROMPT_ARCHITECT', taskType: 'guidance', capability, policy: input.request.policy,
    });
    if (routes.length === 0) {
      await ledger.event('checkpoint.verdict', {
        taskId: subjectTaskId, workerId: input.workerId,
        facts: {
          checkpointId: checkpoint.checkpointId, route: 'CONTINUE',
          reasonCode: 'GUIDANCE_UNROUTABLE', wouldHaveRouted: routing.route,
        },
      });
      return;
    }
  }

  const guidanceTask: JuliusTask = {
    taskId: juliusGuidanceTaskId(subjectTaskId, sequence),
    missionId: task.missionId,
    parentTaskId: subjectTaskId,
    dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'],
    taskType: 'guidance',
    role: 'PROMPT_ARCHITECT',
    ordinal: task.ordinal + 1,
    // RUNNABLE, because BLOCKED is unreachable by the claim query and only
    // `appendDecision({releaseTaskIds})` ever moves a task out of it.
    state: 'RUNNABLE',
  };
  const created = await deps.store.addTask({
    commandId: `guidance:${guidanceTask.taskId}`,
    runId: run.runId, projectId: run.projectId, task: guidanceTask,
  });

  /**
   * THE QUESTION HAS TO REACH THE ARCHITECT, and the only channel Julius owns
   * is the Project Brain.
   *
   * Minting the task is not asking the question. A guidance task carries no
   * payload of its own: what a worker sees is the packet Julius compiles for
   * it, so a request that stops at the checkpoint's `safeSummary` would arrive
   * as a task to write advice about nothing in particular. `blockedOn`,
   * `attempted` and `relevantPaths` are exactly the difference between "the
   * coder is stuck" and a question someone can answer.
   *
   * It goes through the ordinary brain write rather than beside it, so the
   * architect reads it the way it reads the objective and the findings — no
   * prose side channel, one context compiler, one redaction path, one
   * provenance record. The entry is SCOPED TO THE GUIDANCE TASK, so it reaches
   * that packet and no other: the coder does not get its own question read back
   * to it, and the reviewer sees it only when reviewing the guidance.
   *
   * GUARDED BY THE TASK'S OWN WRITE, exactly as the decision entry is guarded
   * by `appendDecision`: `addTask` is idempotent by command id, so a replayed
   * tick writes neither the task nor the entry and the brain revision does not
   * drift.
   *
   * Every value below has already passed `sanitizeJuliusGuidanceRequest`, which
   * rebuilds the request from an allowlist with bounded lengths. No provider
   * body reaches this row. When the request could not be read at all, the entry
   * SAYS SO rather than being skipped — an architect told nothing cannot tell
   * that it was told nothing.
   */
  if (created) {
    const askText = request === null
      ? 'A worker asked for guidance and its request could not be read. No question, blocking condition, attempt or path is available.'
      : [
        `QUESTION: ${request.question}`,
        `BLOCKED ON: ${request.blockedOn.join(' | ') || '(none stated)'}`,
        `ALREADY ATTEMPTED: ${request.attempted.join(' | ') || '(none stated)'}`,
        `RELEVANT PATHS: ${request.relevantPaths.join(' | ') || '(none stated)'}`,
      ].join('\n');
    await deps.store.appendBrainEntry({
      runId: run.runId,
      projectId: run.projectId,
      taskId: guidanceTask.taskId,
      workerId: input.workerId,
      entryId: `brain:guidance-request:${guidanceTask.taskId}`,
      kind: 'HANDOFF',
      safeText: askText,
      evidenceIds: [],
      occurredAt: deps.clock.now(),
    });
  }

  /**
   * THE BARRIER, AND IT NEEDS NO NEW MECHANISM.
   *
   * Minting a guidance task proves Julius ASKED. It does not stop the coder:
   * the dispatch that carried the request has already resolved, so guidance
   * written in answer would reach a worker that finished. Recording the ask and
   * calling that continuous supervision is the failure this exists to prevent.
   *
   * The continuation is therefore a TASK THAT CANNOT RUN YET. It is created
   * BLOCKED with a dependency on the guidance task, and `evaluateJuliusRelease`
   * — the only thing in Julius that moves a task out of BLOCKED — releases it
   * solely when that dependency is SUCCEEDED **and effectively accepted**. So:
   *
   *   - a BLOCK or a rejected guidance review is never effectively accepted,
   *     and the continuation is never released. Segment B does not run because
   *     there is nothing runnable, not because a model agreed to wait;
   *   - a REPAIR holds it until the repair lineage itself reaches an accepted
   *     state, which is the routing the founder asked for, unchanged;
   *   - an ACCEPT releases it, and only then.
   *
   * Every one of those properties is already drilled on real PostgreSQL by the
   * release and repair-loop drills. Inventing a pause primitive beside them
   * would have re-earned all of it and been the weaker of the two.
   *
   * GUARDED BY THE GUIDANCE TASK'S OWN WRITE. `addTask` is idempotent by
   * command id, so a replayed tick creates neither task, releases nothing twice
   * and leaves the lineage unchanged.
   */
  let continuationTaskId: string | null = null;
  /**
   * THE CEILING, AND IT IS NOT THE REPAIR BOUND.
   *
   * The barrier made the coder stop; nothing yet made it stop stopping. A coder
   * that asks at every segment mints a continuation forever and the mission
   * never completes — the unbounded-loop twin of the unroutable repair task
   * that sat RUNNABLE forever on paid run 34037313976. This was not a
   * hypothesis: wiring the barrier turned six existing proofs red with seven
   * and eight guidance tasks where one was expected.
   *
   * Counted separately from repairs on purpose. A repair means the work was
   * REJECTED; a segment boundary means the coder needed something. Sharing one
   * bound would let honest collaboration exhaust a ceiling set for failure.
   */
  // COUNTED AGAINST THE UNIT OF WORK, not against the most recent pause in it.
  const segmentRoot = juliusSegmentLineageRootOf(task, tasks);
  const segmentNumber = nextSegmentNumber(segmentRoot, tasks);
  const segmentCeiling = input.request.verification.maxCoderSegments ?? JULIUS_DEFAULT_MAX_CODER_SEGMENTS;
  if (created && routeIsBarrier(routing.route) && segmentNumber > segmentCeiling) {
    await ledger.event('checkpoint.verdict', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: {
        checkpointId: checkpoint.checkpointId, route: routing.route,
        reasonCode: 'SEGMENT_CEILING_REACHED', guidanceTaskId: guidanceTask.taskId, created,
        continuationTaskId: null, barrier: true, segment: segmentNumber, ceiling: segmentCeiling,
      },
    });
    return;
  }
  if (created && routeIsBarrier(routing.route)) {
    const resume = sanitizeJuliusSegmentState(input.segmentResume);
    const continuation: JuliusTask = {
      taskId: juliusSegmentTaskId(segmentRoot.taskId, segmentNumber),
      missionId: task.missionId,
      // The ROOT is the parent at every level, so the chain stays a chain and
      // `segmentChildrenOf` can see every pause of one unit of work at once.
      parentTaskId: segmentRoot.taskId,
      // THE WHOLE BARRIER IS THIS ONE EDGE.
      dependencyIds: [guidanceTask.taskId],
      requiredEvidenceTypes: task.requiredEvidenceTypes,
      // The same kind of work, so the coder needs no new registration and the
      // charge keeps the subject's own stage.
      taskType: task.taskType,
      role: task.role,
      ordinal: task.ordinal + 2,
      state: 'BLOCKED',
    };
    const madeContinuation = await deps.store.addTask({
      commandId: `segment:${continuation.taskId}`,
      runId: run.runId, projectId: run.projectId, task: continuation,
    });
    if (madeContinuation) {
      continuationTaskId = continuation.taskId;
      /**
       * WHAT THE CONTINUATION RESUMES FROM, on the same Project Brain channel
       * the question travelled on and scoped the same way. A continuation told
       * nothing about what its own earlier segment did would redo it; one told
       * through a provider session handle would not survive a restart.
       *
       * An absent or unusable resume SAYS SO. The barrier holds either way —
       * that is the point of making it structural — but a coder that cannot
       * tell it was told nothing is the gap this whole change exists to close.
       */
      await deps.store.appendBrainEntry({
        runId: run.runId,
        projectId: run.projectId,
        taskId: continuation.taskId,
        workerId: input.workerId,
        entryId: `brain:segment-resume:${continuation.taskId}`,
        kind: 'HANDOFF',
        safeText: resume === null
          ? 'This segment resumes work paused at a checkpoint. No usable record of what the previous segment completed was supplied; re-establish the state from the workspace before continuing.'
          : [
            `RESUMING AFTER CHECKPOINT: ${checkpoint.checkpointId}`,
            `COMPLETED IN THE PREVIOUS SEGMENT: ${resume.completedSoFar.join(' | ') || '(nothing stated)'}`,
            `INTENDED NEXT: ${resume.nextIntent}`,
          ].join('\n'),
        evidenceIds: [],
        occurredAt: deps.clock.now(),
      });
    }
  }

  await ledger.event('checkpoint.verdict', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, route: routing.route, reasonCode: routing.reasonCode,
      guidanceTaskId: guidanceTask.taskId, created,
      // Null when the route was not a barrier, which is a different fact from
      // a barrier that failed to mint one.
      continuationTaskId, barrier: routeIsBarrier(routing.route),
    },
  });
}

/**
 * JULIUS GOES AND LOOKS, ON BEHALF OF WHICHEVER SLOT ASKED.
 *
 * The only checkpoint route that schedules no worker, because retrieval is
 * Julius's own act rather than somebody else's turn. It is still a BARRIER, and
 * that is the whole reason it is here rather than on the result of the dispatch
 * that asked: the asking dispatch has ENDED, the observation exists before the
 * continuation is created, and the continuation is the only place the answer
 * appears. An observation handed back to a worker that already finished would
 * be a citation, not research, and every proof of "the worker asked" would pass
 * while the property that matters was false.
 *
 * Returns true when this dispatch's yield was research — meaning a continuation
 * exists and the guidance branch must not mint a second one for the same
 * subject.
 */
async function driveResearchCheckpoint(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly request: JuliusPipelineRequest;
  readonly workerId: string;
  readonly researchAsks?: unknown;
  readonly segmentResume?: unknown;
}): Promise<boolean> {
  const { deps, run, ledger, task } = input;
  const subjectTaskId = task.taskId;
  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);

  // The same durable counter the guidance path uses, read from the rows that
  // exist rather than from a field a restart would lose, and counted against
  // the unit of work rather than against the most recent pause in it.
  const segmentRoot = juliusSegmentLineageRootOf(task, tasks);
  const segmentNumber = nextSegmentNumber(segmentRoot, tasks);
  const asks = sanitizeJuliusResearchAsks(input.researchAsks);

  const contractTaskId = juliusContractSubjectTaskId(task, tasks);
  const contract = contractTaskId === null
    ? null
    : await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
  const binding = contract === null ? null : juliusTaskContractBinding(contract);

  const recorded = recordJuliusCheckpoint({
    checkpointId: juliusResearchCheckpointId(subjectTaskId, segmentNumber),
    runId: run.runId,
    taskId: subjectTaskId,
    sequence: segmentNumber,
    trigger: 'RESEARCH_REQUESTED',
    origin: originForRole(task.role),
    binding,
    evidenceIds: [],
    // The worker's own bounded words about what it needs to know. An unusable
    // ask still gets a checkpoint, because "a worker asked for something Julius
    // could not read" is a fact worth having in the record.
    safeSummary: asks === null
      ? 'A worker asked Julius to research something and its request could not be read.'
      : asks.map((item) => item.purpose).join(' | ').slice(0, JULIUS_CHECKPOINT_LIMITS.summaryChars),
    recordedAt: deps.clock.now(),
  });
  if (recorded.outcome === 'REFUSED') {
    await ledger.event('research.refused', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: { reasonCode: recorded.reasonCode, stage: 'checkpoint' },
    });
    return false;
  }
  const checkpoint = recorded.checkpoint;
  await ledger.event('checkpoint.recorded', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, trigger: checkpoint.trigger, origin: checkpoint.origin,
      sequence: checkpoint.sequence, evidenceCount: 0,
      contractRevision: binding?.contractRevision ?? null,
      contractBindingDigest: binding?.bindingDigest ?? null,
    },
  });

  const refuse = async (reasonCode: string): Promise<boolean> => {
    await ledger.event('checkpoint.verdict', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: {
        checkpointId: checkpoint.checkpointId, route: 'CONTINUE', reasonCode,
        wouldHaveRouted: 'SERVE_RESEARCH', continuationTaskId: null, barrier: false,
      },
    });
    return false;
  };

  if (asks === null) return refuse('RESEARCH_ASK_UNREADABLE');

  const routing = routeJuliusCheckpoint({
    checkpoint, verdict: null, guidanceInFlight: false, contractState: contract?.state ?? null,
  });
  if (routing.route !== 'SERVE_RESEARCH') return refuse(`RESEARCH_ROUTED_${routing.route}`);

  /**
   * NO PORT MEANS NO RESEARCH, RECORDED AND CARRIED PAST.
   *
   * The lesson `scheduleRepair` bought on paid run 34037313976: work minted for
   * something nothing serves does not fail, it SITS. A mission is never stalled
   * on a question Julius has no way to answer.
   */
  if (deps.research === undefined) return refuse('RESEARCH_UNSERVED');
  if (!isJuliusResearchRole(task.role)) return refuse('RESEARCH_ROLE_UNSUPPORTED');

  // The same ceiling the guidance barrier answers to, counted from the same
  // rows. A worker that asks at every segment would otherwise mint a
  // continuation forever and the mission would never complete.
  const segmentCeiling = input.request.verification.maxCoderSegments ?? JULIUS_DEFAULT_MAX_CODER_SEGMENTS;
  if (segmentNumber > segmentCeiling) return refuse('SEGMENT_CEILING_REACHED');

  /**
   * THE ATTEMPT, WRITTEN BEFORE THE SPEND.
   *
   * WHAT USED TO HAPPEN HERE. `serve()` is awaited and the `research.retrieved`
   * rows are appended after it returns; the mediator's own settlement is an
   * in-process Map that writes nothing durable. So a process that died between
   * the two had RETRIEVED AND BEEN CHARGED with nothing at all on the record —
   * and, because the checkpoint is driven once per accepted result and never
   * re-entered, nothing ever asked again either. The retrieval was paid for,
   * its answer was lost, the mission carried on without it, and the durable
   * ledger — rebuilt from rows, and the only budget that survives a restart —
   * counted one retrieval fewer than were bought. A budget that over-counts is
   * pessimistic; one that UNDER-counts can be exceeded.
   *
   * THIS ROW IS THE SCAR. It is written before a socket can exist, so an
   * attempt with no retrieval beside it is exactly the loss above, visible in
   * the bundle rather than inferred from a gap nobody can see. It carries the
   * checkpoint's own id, which is what pairs it with the charges it produced.
   *
   * WHAT IT IS NOT. It does not make the retrieval recoverable and it does not
   * re-ask: this path CANNOT re-enter — the dispatch that asked has ended, and
   * `driveContinuousLifecycle` runs only on a result that was not a duplicate.
   * An earlier guard here compared the CONTINUATION's id against the task rows
   * and was removed because it could never fire; a re-entry guard would be the
   * same mistake in a new place, because there is no re-entry to guard. What is
   * repaired is the silence, which was the part that could not be noticed.
   */
  const attemptKey = checkpoint.checkpointId;
  await ledger.event('research.attempted', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: { role: task.role, attemptKey, segment: segmentNumber, askCount: asks.length },
  });

  const observations = await deps.research.serve({
    missionId: task.missionId,
    projectId: run.projectId,
    runId: run.runId,
    taskId: subjectTaskId,
    role: task.role,
    asks,
    requestedAt: deps.clock.now(),
  });

  /**
   * THE CHARGE, DURABLY, one row per observation.
   *
   * The research meter enforcing per-role and per-mission budgets lived in a
   * Map on the mediator, keyed by mission and held for the process lifetime. A
   * bridge restart forgot every retrieval a slot had made and the budget began
   * again at zero — a budget that binds within a process is not a budget.
   *
   * These rows are the durable truth the meter is rebuilt from. `counted` is
   * the metered outcome rather than the success: a retrieval that reached a
   * host and was refused by it still spent something, and pretending otherwise
   * is how a budget is exceeded while every individual read looks free.
   */
  for (const [index, observation] of observations.entries()) {
    await ledger.event('research.retrieved', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: {
        role: task.role,
        /* PER OBSERVATION, and derived rather than arbitrary so two rows for
           the same retrieval are recognisable as such by a reader. It does NOT
           deduplicate: the only consumer folds every row, which is right —
           where two rows carry one key, two retrievals genuinely happened. */
        requestKey: `${juliusSegmentTaskId(segmentRoot.taskId, segmentNumber)}:${index}`,
        /* THE ATTEMPT THIS ANSWERS. One key per serve, shared by every
           observation it produced, so a reader pairs a charge with the attempt
           that authorised it. An attempt with no row carrying its key is a
           retrieval that was bought and never accounted for. */
        attemptKey,
        outcome: observation.outcome,
        counted: observation.outcome === 'observed',
        evidenceId: observation.evidenceId,
        signalled: observation.injectionSignals.length,
        segment: segmentNumber,
      },
    });
  }

  const continuation: JuliusTask = {
    taskId: juliusSegmentTaskId(segmentRoot.taskId, segmentNumber),
    missionId: task.missionId,
    parentTaskId: segmentRoot.taskId,
    /**
     * BLOCKED ON THE SUBJECT ITSELF, which is the only edge there is when no
     * second worker is involved. It releases through `evaluateJuliusRelease`
     * exactly as every other dependency does: when the yielded segment is
     * SUCCEEDED and effectively accepted, and never while it is halted or
     * being repaired. No new pause primitive, and nothing that depends on a
     * model agreeing to wait.
     */
    dependencyIds: [subjectTaskId],
    requiredEvidenceTypes: task.requiredEvidenceTypes,
    taskType: task.taskType,
    role: task.role,
    ordinal: task.ordinal + 2,
    state: 'BLOCKED',
  };
  const created = await deps.store.addTask({
    commandId: `segment:${continuation.taskId}`,
    runId: run.runId, projectId: run.projectId, task: continuation,
  });

  if (created) {
    const resume = sanitizeJuliusSegmentState(input.segmentResume);
    const answer = renderJuliusResearchResume({
      version: JULIUS_RESEARCH_ASK_VERSION,
      askedAtCheckpointId: checkpoint.checkpointId,
      observations,
    });
    /**
     * THE ANSWER TRAVELS THE PROJECT BRAIN, scoped to the continuation, exactly
     * as the architect's question does. One context compiler, one redaction
     * path, one provenance record, and no prose side channel — and the entry is
     * guarded by the continuation's own idempotent write, so a replayed tick
     * adds neither the task nor the entry and the brain revision does not drift.
     */
    await deps.store.appendBrainEntry({
      runId: run.runId,
      projectId: run.projectId,
      taskId: continuation.taskId,
      workerId: input.workerId,
      entryId: `brain:research-answer:${continuation.taskId}`,
      kind: 'HANDOFF',
      safeText: [
        resume === null
          ? 'This segment resumes work paused to research something. No usable record of what the previous segment completed was supplied; re-establish the state from the workspace before continuing.'
          : [
            `RESUMING AFTER RESEARCH CHECKPOINT: ${checkpoint.checkpointId}`,
            `COMPLETED IN THE PREVIOUS SEGMENT: ${resume.completedSoFar.join(' | ') || '(nothing stated)'}`,
            `INTENDED NEXT: ${resume.nextIntent}`,
          ].join('\n'),
        '',
        answer,
      ].join('\n'),
      evidenceIds: observations.flatMap(
        (observation: JuliusResearchObservationRecord) => (observation.evidenceId === null ? [] : [observation.evidenceId]),
      ),
      occurredAt: deps.clock.now(),
    });
  }

  await ledger.event('checkpoint.verdict', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, route: routing.route, reasonCode: routing.reasonCode,
      continuationTaskId: created ? continuation.taskId : null,
      barrier: true,
      segment: segmentNumber,
      asks: asks.length,
      // Every outcome, in order, so the record distinguishes four observed
      // pages from four refusals without reading the evidence.
      outcomes: observations.map((observation) => observation.outcome).join(','),
      evidence: observations.filter((observation) => observation.evidenceId !== null).length,
      signalled: observations.filter((observation) => observation.injectionSignals.length > 0).length,
    },
  });
  return true;
}

/** `PROMPT_ARCHITECT` → itself; anything Julius does not recognise observes as JULIUS. */
const originForRole = (role: JuliusWorkerRole): JuliusCheckpointOrigin =>
  role === 'PROMPT_ARCHITECT' || role === 'CODING_AGENT' || role === 'INDEPENDENT_REVIEWER' ? role : 'JULIUS';

/**
 * Turn an architect's answer into a bound, versioned packet — or record why it
 * could not be one.
 *
 * The contract is read FRESH rather than taken from the dispatch preflight: an
 * architect that spent a long time researching may be answering under terms
 * that have since been revised, and a packet stamped with the revision Julius
 * remembers rather than the one in force would be the forgery
 * `evaluateJuliusGuidanceCurrency` exists to make impossible.
 */
async function issueGuidanceFromResult(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
  readonly guidance?: unknown;
}): Promise<void> {
  const { deps, run, ledger, task } = input;
  const refuse = async (reasonCode: string): Promise<void> => {
    await ledger.event('guidance.refused', {
      taskId: task.taskId, workerId: input.workerId, facts: { reasonCode, stage: 'issue' },
    });
  };

  const subjectTaskId = guidanceSubjectTaskId(task.taskId);
  if (subjectTaskId === null) return refuse('guidance_from_a_non_guidance_task');

  const proposal = sanitizeJuliusGuidanceProposal(input.guidance);
  if (proposal === null) return refuse('guidance_shape_refused');

  const contractTaskId = juliusContractSubjectTaskId(
    task, await deps.store.tasksForRun(run.runId, run.projectId),
  );
  const contract = contractTaskId === null
    ? null
    : await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
  if (contract === null) return refuse('contract_absent');
  const binding = juliusTaskContractBinding(contract);
  // GUIDANCE EXISTS ONLY UNDER AN AGREEMENT. Before LOCK the architect holds the
  // plan task and speaks through it; after SUPERSESSION there is no agreement
  // left to advise under.
  if (binding === null) return refuse('contract_not_locked');

  const match = /:([1-9]\d*):task$/u.exec(task.taskId);
  const revision = match === null ? 1 : Number(match[1]);
  const issued = issueJuliusGuidance({
    guidanceId: juliusGuidanceId(subjectTaskId, revision),
    runId: run.runId,
    taskId: subjectTaskId,
    binding,
    revision,
    triggeringCheckpointId: juliusCheckpointId(subjectTaskId, revision),
    proposal,
    contractCriterionIds: contract.blockingAcceptanceCriteria.map((criterion) => criterion.criterionId),
    issuedByWorkerId: input.workerId,
    issuedAt: deps.clock.now(),
  });
  if (issued.outcome === 'REFUSED') return refuse(issued.reasonCode);

  const packet = issued.packet;
  // COUNTS AND IDENTIFIERS, never the advice itself. The packet's own text
  // travels to the coder the way the plan does — as an artifact the composition
  // owns — and the ledger records that it existed, under which agreement, and
  // how much of it there was.
  await ledger.event('guidance.issued', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      guidanceId: packet.guidanceId, guidanceRevision: packet.revision,
      guidanceDigest: packet.packetDigest,
      contractRevision: binding.contractRevision, contractBindingDigest: binding.bindingDigest,
      recommendedActions: packet.recommendedActions.length,
      additionalProhibitions: packet.additionalProhibitions.length,
      references: packet.references.length,
      webReferences: packet.references.filter((reference) => reference.kind === 'WEB').length,
      corroboratedReferences: packet.references.filter((reference) => reference.trust === 'CORROBORATED').length,
      affectedCriteria: packet.affectedCriterionIds.length,
      unresolvedQuestions: packet.unresolvedQuestions.length,
    },
  });
}


/**
 * Store a worker's proposed contract revision, or record why it was refused.
 *
 * The contract is looked up by the task the proposal is ABOUT, which for a
 * planner is the implementation task it is planning — the same resolution the
 * dispatch gate uses, so a plan and the build it plans can never end up naming
 * different contracts.
 */
async function proposeContractRevision(input: {
  deps: JuliusPipelineDependencies;
  run: JuliusRunRow;
  ledger: RuntimeLedger;
  task: JuliusTask;
  tasks: readonly JuliusTask[];
  workerId: string;
  proposal: unknown;
}): Promise<void> {
  const { deps, run, ledger, task } = input;
  const refuse = (reasonCode: string, contractTaskId: string | null): Promise<void> =>
    ledger.event('contract.refused', {
      taskId: task.taskId, workerId: input.workerId,
      facts: { reasonCode, contractTaskId, proposedBy: task.role },
    });

  /**
   * WHICH CONTRACT A PLANNER'S PROPOSAL IS ABOUT.
   *
   * A `plan` task is not itself bound — `juliusContractSubjectTaskId` returns
   * null for the Prompt Architect, and must, or the role that writes the terms
   * could not run before they existed. So the subject is resolved the other way:
   * the tasks that DEPEND on this one and are bound by a contract. Exactly one
   * is the ordinary graph (plan → build); more than one is a shape nobody has
   * built, and guessing which the proposal meant would be Julius inventing an
   * agreement.
   *
   * A PLAN REVISION PROPOSES FOR THE PLAN IT REVISES. `repair:plan-1:1:task`
   * depends on nothing and nothing depends on it — the build depends on
   * `plan-1` — so the dependents are read off the lineage ROOT. Without this the
   * one round in which a proposal is most needed, the architect answering a
   * challenge, was refused as having no subject, and the challenged revision
   * could never be revised.
   */
  const lineageRoot = repairLineageRootOf(task, input.tasks);
  const dependents = input.tasks
    .filter((value) => value.dependencyIds.includes(lineageRoot.taskId))
    .map((value) => juliusContractSubjectTaskId(value, input.tasks))
    .filter((value): value is string => value !== null);
  const contractTaskId = juliusContractSubjectTaskId(task, input.tasks)
    ?? (new Set(dependents).size === 1 ? dependents[0]! : null);
  if (contractTaskId === null) return refuse('proposal_has_no_contract_subject', null);

  const sanitized = sanitizeJuliusContractProposal(input.proposal);
  if (sanitized === null) return refuse('proposal_shape_refused', contractTaskId);

  const current = await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
  if (current === null) return refuse('contract_absent', contractTaskId);
  // A LOCKED contract is not revised by a worker finishing its task: changing
  // agreed terms is a decision, and the decision path is where a revision is
  // cut. Refusing here keeps "coding began under the terms that were locked"
  // true for the whole of the coder's run.
  if (current.state === 'LOCKED') return refuse('contract_already_locked', contractTaskId);

  const revised = reviseJuliusTaskContract({ contract: current, proposal: sanitized });
  if (revised.outcome !== 'REVISED') return refuse(revised.reasonCode, contractTaskId);

  const stored = await deps.store.putTaskContract({
    projectId: run.projectId, contract: revised.contract, occurredAt: deps.clock.now(),
  }).catch(() => false);
  if (!stored) return refuse('proposal_not_stored', contractTaskId);

  await ledger.event('contract.proposed', {
    taskId: task.taskId, workerId: input.workerId,
    facts: {
      contractTaskId, contractId: revised.contract.contractId,
      contractRevision: revised.contract.contractRevision, proposedBy: task.role,
    },
  });
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
  /** What Julius reserved for this dispatch, so the effort row can name it. */
  allocated: number | null,
  /**
   * What Julius HANDED this dispatch. Measured at the context compile, which is
   * the only place that knows it; absent for a caller that did not compile one,
   * and absent reads as unknown rather than as zero.
   */
  handed: { readonly brainRetrievals: number; readonly evidenceInspected: number } | null,
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
    commit: async ({ claim, reservationId, result }) => {
      const usage = (result.usage ?? {}) as Record<string, unknown>;
      const number = (key: string): number => (typeof usage[key] === 'number' && Number.isFinite(usage[key] as number) ? usage[key] as number : 0);
      /** The same read WITHOUT the zero substitution, for anything diagnostic. */
      const maybe = (key: string): number | null => (typeof usage[key] === 'number' && Number.isFinite(usage[key] as number) ? usage[key] as number : null);
      /**
       * UNKNOWN COST IS NOT ZERO COST, and it used to be. A worker that
       * reports no `usdMicros` — the hosted runtime is allowed to, and Relay
       * records that as Unknown rather than inventing a number — settled its
       * reservation at $0 and handed the whole allocation back to the ledger,
       * so the rest of the mission could be granted money this dispatch may
       * already have spent. `null` tells the ledger to keep what it reserved.
       */
      const usdMicros = typeof usage.usdMicros === 'number' && Number.isFinite(usage.usdMicros) ? usage.usdMicros : null;
      await deps.budget.commit({
        reservationId, usdMicros, inputTokens: number('inputTokens'),
        outputTokens: number('outputTokens'), toolCalls: number('toolCalls'), runtimeMs: number('runtimeMs'),
        receiptId: typeof usage.receiptId === 'string' ? usage.receiptId : null, now: deps.clock.now(),
      });
      /**
       * WHOSE MONEY, AND ON WHOSE AUTHORITY.
       *
       * `taskId: null` and no basis is how Live Run 3's ledger came to read as
       * a $0.608861 mission: one component reported a figure, three reported
       * nothing, and the rows were indistinguishable from a $0 settlement
       * except by joining back through the reservation id. The task and the
       * role make each component attributable; the basis says whether the
       * amount beside it is a bill, a harness's arithmetic, or an absence.
       *
       * `juliusCostComponent` decides, not the caller: a basis its own data
       * cannot support is demoted to `UNKNOWN` rather than published, so an
       * adapter cannot claim `PROVIDER_REPORTED` without a number.
       */
      const component = juliusCostComponent({
        taskId: claim.taskId, role: claim.task.role,
        basis: usage.costBasis, usdMicros,
        estimatedUsdMicros: usage.estimatedUsdMicros,
      });
      // The coordinator emits `budget.reserved` and `budget.denied` and has no
      // event for the settlement, so the amount actually spent had no
      // authoritative record. It does now, and it is the OBSERVED usage rather
      // than the estimate that was reserved — or `null`, which says the
      // boundary reported none rather than claiming it cost nothing.
      await ledger.event('budget.settled', {
        taskId: claim.taskId,
        facts: {
          reservationId, usdMicros, inputTokens: number('inputTokens'), outputTokens: number('outputTokens'),
          role: claim.task.role, costBasis: component.basis,
          // A completed dispatch never releases: it either reported an amount
          // or it did not, and neither answer hands the money back.
          released: false,
          // NEVER FOLDED INTO `usdMicros`. A price a harness worked out from its
          // own table is not what anyone was charged, and one column for both
          // is how an estimate becomes a bill.
          estimatedUsdMicros: component.estimatedUsdMicros,
        },
      });
      /**
       * WHAT THIS SLOT ACTUALLY DID, reported rather than inferred.
       *
       * Deliberately NOT folded into `budget.settled`, which reads its numbers
       * through a helper that substitutes zero for an absent field — correct
       * for a ledger that must not over-hold, and fatal for a parity
       * diagnostic, which would then call every worker whose provider reports
       * no token counts "shallow" rather than "unmeasured". Here an unreported
       * component is null, and `summarizeJuliusSlotEffort` counts it as
       * unknown.
       *
       * `researchCalls` and `reasoningTokens` are read from the same usage
       * object: an adapter that reports them is measured on them, and one that
       * does not is not charged for the silence.
       */
      /**
       * WHAT JULIUS ITSELF OBSERVED, beside what the provider reported.
       *
       * Only the dimensions this site can actually see are given a number.
       * Evidence produced, repair participation, guidance written and reviewer
       * verdicts are all visible HERE, from the claim and the result; the ones
       * that are not instrumented yet stay ABSENT, which the reader turns into
       * `unknown` rather than into a zero. A dimension nobody measured must
       * never read as a dimension that was zero — the same rule money follows.
       */
      const evidence = Array.isArray(result.evidence) ? result.evidence : [];
      const verdicts = claim.task.role === 'INDEPENDENT_REVIEWER'
        ? evidence.filter((item) => (item as { type?: unknown }).type === 'REVIEW_FINDING').length
        : 0;
      await ledger.event('worker.effort', {
        taskId: claim.taskId,
        facts: {
          role: claim.task.role, taskType: claim.task.taskType,
          inputTokens: maybe('inputTokens'), outputTokens: maybe('outputTokens'),
          reasoningTokens: maybe('reasoningTokens'), toolCalls: maybe('toolCalls'),
          researchCalls: maybe('researchCalls'), activeMs: maybe('runtimeMs'),
          providerCalls: maybe('providerCalls'),
          // JULIUS'S OWN MEASUREMENTS, not the provider's. Null when no context
          // was compiled for this dispatch — never zero, which would claim the
          // worker was handed nothing.
          brainRetrievals: handed === null ? null : handed.brainRetrievals,
          evidenceInspected: handed === null ? null : handed.evidenceInspected,
          usdMicros,
          // The two halves of the money question, on the same row: what Julius
          // permitted, and what came back — with the basis, so an UNKNOWN
          // settlement is legible as one rather than as a missing number.
          allocatedUsdMicros: allocated,
          settledUsdMicros: usdMicros,
          settlementBasis: component.basis,
          evidenceGenerated: evidence.length,
          repairRounds: claim.task.taskType.startsWith('repair:') ? 1 : 0,
          guidanceGenerated: result.guidance === undefined ? 0 : 1,
          reviewerVerdicts: verdicts,
          effortVersion: JULIUS_SLOT_EFFORT_VERSION,
        },
      });
    },
    release: async ({ claim, reservationId, reason, usdMicros, spendUnknown }) => {
      await deps.budget.release({ reservationId, reason, now: deps.clock.now(), usdMicros: usdMicros ?? null, spendUnknown });
      // A failed attempt that billed before it failed is a settlement, not a
      // hand-back, and the record has to be able to say so.
      const billed = (typeof usdMicros === 'number' && usdMicros > 0) || spendUnknown === true;
      /**
       * A RELEASE CLOSES THE RESERVATION EITHER WAY, AND THE ROW SAYS WHICH.
       *
       * Previously only a BILLED failure wrote a row, so an attempt that never
       * reached a provider left its reservation with no closing record at all.
       * The durable ledger frees it; anything PROJECTED from the events sees a
       * hold that never ends, and money a slot genuinely did not spend reads as
       * spent forever. Conservative in the safe direction, and it would starve
       * a mission whose first dispatch was rerouted.
       *
       * `released: true` is the discriminator, and it is the ONE case where an
       * absent amount frees capacity. That is safe precisely because it is
       * reached only when the boundary reported NO spend and did NOT report
       * unknown spend — nothing was sent, so there is nothing to hold.
       */
      await ledger.event('budget.settled', {
        taskId: claim.taskId,
        facts: {
          reservationId, usdMicros: typeof usdMicros === 'number' ? usdMicros : null, reason,
          role: claim.task.role,
          released: !billed,
          // A failure that billed a number the boundary reported is a
          // provider's own figure; one that billed an amount nobody could
          // name is UNKNOWN, which is why the hold is not released.
          costBasis: typeof usdMicros === 'number' ? 'PROVIDER_REPORTED' : 'UNKNOWN',
          estimatedUsdMicros: null,
        },
      });
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

/**
 * RESUME A VERIFICATION THAT NEVER RAN.
 *
 * THE WINDOW THIS CLOSES. `acceptWorkerResult` moves a task out of ACTIVE in
 * its own transaction; the verification decision is a SEPARATE write. A process
 * that dies between them leaves a SUCCEEDED task with no decision — and nothing
 * ever looks at it again, because the claim query offers RUNNABLE tasks only
 * and a SUCCEEDED task is not one. The run then parks in VERIFYING forever.
 *
 * It parks HONESTLY — completion requires a decision per task, so nothing
 * false is reported — but "the mission never finishes and the money is spent"
 * is not a recovery. The chaos suite reached this window and asserted only that
 * the run did not wedge in an impossible STATE; that a run could be permanently
 * stranded in a possible one was the thing nobody was asking about.
 *
 * WHY NOT REQUEUE THE TASK INSTEAD. Returning it to RUNNABLE would send the
 * worker again and pay for work that is already durably done. The result was
 * accepted; what is missing is Julius's own judgement of it, and that costs
 * nothing to redo.
 *
 * IT IS IDEMPOTENT BY CONSTRUCTION. `appendDecision`'s key is
 * `<taskId>:<action>:<reasonCode>` and the brain entry's id is derived from the
 * same three, so the decision this resume writes IS the decision the crashed
 * tick would have written — a later replay adds nothing and does not mint a
 * second repair round.
 *
 * A TASK WITH A PENDING REVIEW IS NOT STRANDED. Verification answers
 * SCHEDULE_REVIEW while a required review has not completed, so sweeping such a
 * task every tick would re-announce a review that is already on its way. The
 * run is making progress; only a task with nothing left to wait for is resumed.
 */
export async function resumeUnverifiedTasks(input: {
  deps: JuliusPipelineDependencies;
  run: JuliusRunRow;
  policy: JuliusCardPolicy;
  verification: JuliusVerificationPolicy;
  tasks: readonly JuliusTask[];
  decisions: readonly JuliusRecordedDecision[];
  /** The capability a task WOULD need, so a resumed REPAIR is proven routable before it exists. */
  capabilityFor?: (task: { taskId: string; taskType: string; role: string }) => string;
}): Promise<readonly JuliusTaskOutcome[]> {
  const { deps, run, tasks, decisions } = input;
  const decided = new Set(decisions.map((decision) => decision.taskId));
  const pendingReviewSubjects = new Set(
    tasks
      .filter((task) => task.role === 'INDEPENDENT_REVIEWER' && task.parentTaskId !== null
        && (task.state === 'BLOCKED' || task.state === 'RUNNABLE' || task.state === 'ACTIVE'))
      .map((task) => task.parentTaskId as string),
  );
  const stranded = tasks.filter((task) => task.state === 'SUCCEEDED'
    && !decided.has(task.taskId)
    && !pendingReviewSubjects.has(task.taskId));
  if (stranded.length === 0) return [];

  const outcomes: JuliusTaskOutcome[] = [];
  for (const task of stranded) {
    const correlationId = `resume:${task.taskId}`;
    const ledger = new RuntimeLedger(deps, run, correlationId);
    const request: JuliusPipelineRequest = {
      claim: {
        taskId: task.taskId, runId: run.runId,
        role: task.role, taskType: task.taskType, leaseGeneration: 0, attempt: 0,
      },
      policy: input.policy,
      verification: input.verification,
      // Never dispatched from here, so no capability is exercised; the value is
      // the task's own type so a reader of the request can see what it was.
      capability: task.taskType,
      ...(input.capabilityFor === undefined ? {} : { capabilityFor: input.capabilityFor }),
    };
    outcomes.push(await verifyExecutedTask({
      request, deps, run, ledger, task,
      /**
       * WHO PERFORMED THIS VERIFICATION, truthfully. It is not the worker that
       * produced the result — that process is gone — and naming it would put a
       * worker's id on a judgement it did not make. The decision itself is keyed
       * on the task and the verdict, not on this, so the durable row is the same
       * one the crashed tick would have written.
       */
      workerId: JULIUS_VERIFICATION_RESUME_WORKER,
      duplicate: false,
    }));
  }
  return outcomes;
}

/** The identity a resumed verification is attributed to. Never a worker's. */
export const JULIUS_VERIFICATION_RESUME_WORKER = 'julius-verification-resume' as const;

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
        // The reviewer depends on the task it reviews, and that task has just
        // SUCCEEDED — this review is scheduled from its verification — so the
        // dependency is satisfied at creation and the review is RUNNABLE now.
        // (BLOCKED is no longer claimable; only Julius releases BLOCKED work.)
        dependencyIds: [task.taskId],
        requiredEvidenceTypes: ['REVIEW_FINDING'],
        taskType: `review:${task.taskType}`,
        role: 'INDEPENDENT_REVIEWER',
        ordinal: task.ordinal + 1,
        state: 'RUNNABLE',
      },
    });
    await ledger.event('review.started', { taskId: reviewTaskId, facts: { reviewsTaskId: task.taskId, created } });
    return { kind: 'REVIEW_SCHEDULED', taskId: task.taskId, reviewTaskId };
  }

  /* ------------------------------------------------------- a decision */
  const { decision } = action;
  /**
   * WHAT THIS DECISION RELEASES, decided before it is written and written
   * with it. `evaluateJuliusRelease` names the BLOCKED tasks whose every
   * dependency is now accepted (an ACCEPT, or a REPAIR superseded by an
   * accepted repair lineage) or SKIPPED. The store moves them to RUNNABLE in
   * the same durable write as the decision, so a restart between the two is
   * not a state that exists. Paid run 34037313976 ran `build` before the plan
   * review because SUCCEEDED alone used to be enough; it is not.
   */
  const recorded = { ...decision, taskId: subject.taskId };
  const release = (decision.action === 'ACCEPT' || decision.action === 'COMPLETE') && tasks.some((value) => value.state === 'BLOCKED')
    ? evaluateJuliusRelease({ tasks, decisions: [...decisions, recorded] })
    : { releasable: [] as readonly string[], withheld: [] };
  /**
   * THE LOCK HAPPENS BEFORE THE RELEASE, and that order is the whole guarantee.
   *
   * An accepting decision that releases a BLOCKED task is Julius agreeing that
   * the work may start; the contract governing that work must stop being
   * arguable at the same moment. Locking FIRST means the two orders a crash can
   * produce are both safe:
   *
   *   lock, crash            nothing is released; the next tick re-verifies and
   *                          the lock is idempotent, so it resumes cleanly.
   *   lock, release, crash   the task is runnable and its terms are agreed,
   *                          which is exactly the state that should exist.
   *
   * The reverse order has a third: released with nothing locked, where the
   * dispatch gate would refuse a task the run had already announced as ready.
   *
   * A REFUSAL DOES NOT STOP THE DECISION. The decision is about the work that
   * was reviewed and is true regardless; what a failed lock stops is the
   * DISPATCH, at the gate, with its own reason. Recording the refusal here is
   * what makes that later refusal explicable instead of mysterious.
   *
   * The evaluator is the reviewer whose acceptance this decision carries —
   * `workerId` — so the durable row says who accepted the terms, not merely
   * that something did.
   */
  /**
   * A REJECTED PLAN CHALLENGES THE TERMS IT PROPOSED.
   *
   * The contract has a CHALLENGED state, the store has a write for it, and
   * nothing on the runtime path ever reached either: a plan the reviewer sent
   * back for repair left its contract a DRAFT indistinguishable from one nobody
   * had looked at. The durable record then said "the plan was found wanting"
   * and "the terms were never argued about" at once, and a dispatch gate that
   * refuses `contract_challenged` separately from `contract_not_locked` had no
   * way to ever say the former.
   *
   * So a REPAIR decision on a Prompt Architect's work challenges every DRAFT
   * contract governing the tasks that depend on that plan — read off the
   * lineage ROOT, because the re-review of `repair:plan-1:1:task` judges a task
   * nothing depends on. LOCKED terms are not arguable and are left alone; a
   * revision already CHALLENGED is not challenged twice, which is what makes a
   * crash between this write and the decision below resumable.
   *
   * The objections handed to the domain gate are the decision's own reason and
   * the ids of the blocking findings — names, never the findings' prose — and
   * the announced facts carry counts and ids only.
   */
  /**
   * AND THE OTHER HALF: WHAT THE EVALUATOR DECIDED, RECORDED EITHER WAY.
   *
   * Live Run 3 reached VERIFIED COMPLETION and the word "challenge" appears
   * nowhere in its evidence bundle — no `contract.challenged` event, which was
   * correct because nothing was challenged, and no record saying so either. A
   * reader cannot tell "the evaluator examined the terms and had no objection"
   * from "the challenge leg never ran", and on a paid run those are opposite
   * conclusions: the first is the cycle working, the second is a hole in it.
   * SILENCE IS NOT A DISPOSITION.
   *
   * So an ACCEPT on a Prompt Architect's work now walks the same contracts a
   * REPAIR does and writes `NO_CHALLENGE` against each. One block for both
   * branches on purpose: two blocks would drift, and the branch that drifts is
   * always the quiet one.
   *
   * THE STATE TRANSITION STAYS ON THE CHALLENGE BRANCH ALONE. An accept changes
   * no contract state — the terms are unchanged and still a DRAFT, and the LOCK
   * above is what agrees them. `contract.disposition` says what the evaluator
   * DECIDED; `contract.challenged` says the contract's state CHANGED. A
   * challenge the store refused to write produces the first without the second,
   * which is exactly what a reader chasing a stalled cycle needs to see.
   */
  if ((decision.action === 'REPAIR' || decision.action === 'ACCEPT') && subject.role === 'PROMPT_ARCHITECT') {
    const challenging = decision.action === 'REPAIR';
    /**
     * THE IDS THE DISPOSITION POINTS AT — names, never the findings' prose.
     * Empty on an accept because there is nothing to point at, and empty on a
     * repair round admitted on the subject's own FAILED evidence, which has no
     * findings by construction.
     */
    const findingIds = challenging
      ? (await deps.store.findingsForRun(run.runId, run.projectId))
        .filter((finding) => finding.taskId === subject.taskId && finding.blocking && finding.status === 'OPEN')
        .map((finding) => finding.findingId)
      : [];
    const objections = [decision.reasonCode, ...findingIds];
    const lineageRoot = repairLineageRootOf(subject, tasks);
    const governed = new Set(tasks
      .filter((value) => value.dependencyIds.includes(lineageRoot.taskId))
      .map((value) => juliusContractSubjectTaskId(value, tasks))
      .filter((value): value is string => value !== null));
    for (const contractTaskId of governed) {
      const contract = await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
      if (contract === null || contract.state !== 'DRAFT') continue;

      // THE ANSWER, FIRST AND ALWAYS. It is written before the state
      // transition below so that a crash between the two leaves the evaluator's
      // decision on the record rather than leaving the run unexplainable.
      const disposition = juliusContractDisposition({
        disposition: challenging ? 'CHALLENGE' : 'NO_CHALLENGE',
        contractTaskId, contractId: contract.contractId,
        contractRevision: contract.contractRevision,
        evaluatorId: input.workerId,
        reasonCode: decision.reasonCode,
        evidenceIds: findingIds,
      });
      await ledger.event(disposition.outcome === 'RECORDED' ? 'contract.disposition' : 'contract.refused', {
        taskId: subject.taskId, workerId: input.workerId,
        facts: disposition.outcome === 'RECORDED'
          ? juliusContractDispositionFacts(disposition.record)
          : { reasonCode: disposition.reasonCode, contractTaskId },
      });

      // An accept argues with nothing, so there is no state to transition.
      if (!challenging) continue;
      const verdict = challengeJuliusTaskContract(contract, { verdict: 'CHALLENGE', evaluatorId: input.workerId, objections });
      if (verdict.outcome !== 'CHALLENGED') {
        await ledger.event('contract.refused', {
          taskId: subject.taskId, workerId: input.workerId,
          facts: { reasonCode: verdict.outcome === 'REFUSED' ? verdict.reasonCode : 'challenge_not_applicable', contractTaskId },
        });
        continue;
      }
      const challenged = await deps.store.challengeTaskContract({
        projectId: run.projectId, contractId: contract.contractId, contractRevision: contract.contractRevision,
      });
      // ANNOUNCED ONLY AFTER THE DURABLE WRITE, and a write that changed nothing
      // — the revision was no longer a DRAFT by the time it was reached — is
      // announced as the refusal it is.
      await ledger.event(challenged ? 'contract.challenged' : 'contract.refused', {
        taskId: subject.taskId, workerId: input.workerId,
        facts: challenged
          ? { contractTaskId, contractId: contract.contractId, contractRevision: contract.contractRevision, reasonCode: decision.reasonCode, objectionCount: objections.length }
          : { contractTaskId, reasonCode: 'challenge_not_stored', contractRevision: contract.contractRevision },
      });
    }
  }

  if (decision.action === 'ACCEPT' || decision.action === 'COMPLETE') {
    for (const releasedTaskId of release.releasable) {
      const governed = tasks.find((value) => value.taskId === releasedTaskId);
      const contractTaskId = governed === undefined ? null : juliusContractSubjectTaskId(governed, tasks);
      if (contractTaskId === null) continue;
      const contract = await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
      if (contract === null) {
        await ledger.event('contract.refused', { taskId: releasedTaskId, workerId: input.workerId, facts: { reasonCode: 'contract_absent', contractTaskId } });
        continue;
      }
      const proposed = lockJuliusTaskContract({
        contract, verdict: { verdict: 'ACCEPT', evaluatorId: input.workerId }, lockedAt: deps.clock.now(),
      });
      if (proposed.outcome !== 'LOCKED') {
        // Already locked is the ordinary replay, and it is not a refusal worth
        // announcing — the terms are agreed, which is what the caller needed.
        const reasonCode = proposed.outcome === 'REFUSED' ? proposed.reasonCode : 'contract_challenged';
        if (reasonCode !== 'contract_already_locked') {
          await ledger.event('contract.refused', { taskId: releasedTaskId, workerId: input.workerId, facts: { reasonCode, contractTaskId } });
        }
        continue;
      }
      const locked = await deps.store.lockTaskContract({
        projectId: run.projectId, contractId: contract.contractId, contractRevision: contract.contractRevision,
        bindingDigest: proposed.contract.bindingDigest!, lockedAt: proposed.contract.lockedAt!, evaluatorId: input.workerId,
      });
      // ANNOUNCE FACTS, NOT INTENTIONS: `contract.locked` is written only after
      // the durable write resolves, and a lost race is announced as the refusal
      // it is rather than as a lock this tick did not perform.
      await ledger.event(locked.locked ? 'contract.locked' : 'contract.refused', {
        taskId: releasedTaskId, workerId: input.workerId,
        facts: locked.locked
          ? { contractTaskId, contractId: contract.contractId, contractRevision: contract.contractRevision, bindingDigest: proposed.contract.bindingDigest! }
          : { contractTaskId, reasonCode: locked.reasonCode, lockedRevision: locked.lockedRevision },
      });
    }
  }

  const decisionRecorded = await deps.store.appendDecision({
    decisionId: deps.ids.next('decision'),
    runId: run.runId,
    taskId: subject.taskId,
    policyRevision: input.request.verification.revision,
    idempotencyKey: `${subject.taskId}:${decision.action}:${decision.reasonCode}`,
    occurredAt: deps.clock.now(),
    decision,
    releaseTaskIds: release.releasable,
  });
  await ledger.event('verification.decided', {
    taskId: subject.taskId, workerId: input.workerId,
    facts: {
      action: decision.action, reasonCode: decision.reasonCode,
      criteriaSatisfied: action.criteriaSatisfied.length, criteriaMissing: action.criteriaMissing.length,
      missionCompletable: action.missionCompletable,
      released: release.releasable.length,
    },
  });
  await ledger.trajectory('VERIFICATION', {
    taskId: subject.taskId, workerId: input.workerId,
    policyRevision: input.request.verification.revision, outcome: decision.action,
    facts: { reasonCode: decision.reasonCode, criteriaMissing: action.criteriaMissing.length },
  });

  /**
   * WHAT THE RUN DECIDED, KEPT WHERE THE NEXT WORKER WILL READ IT.
   *
   * The Project Brain has been compiled into every worker's context since
   * migration 014 and written to by exactly one thing — the bootstrap seed — so
   * a run's own conclusions died with it. A verification decision is the first
   * thing worth keeping: it is the record of why a task was accepted, halted or
   * sent back, and a repair that cannot see that reasoning is a repair working
   * from the same blindness that produced the finding.
   *
   * GUARDED BY THE DECISION'S OWN WRITE, not by a second idempotency key. The
   * entry id is derived from exactly what `appendDecision` keys on, so the two
   * agree by construction: a replayed tick writes neither, and the brain
   * revision does not drift on retried ticks. `decisionRecorded` is false for a
   * duplicate, and this is inside that guard for the same reason scheduling a
   * repair is — the write that records a decision is the one that acts on it.
   *
   * The text is assembled from three closed values. `safeSummary` is already
   * safe by contract, `action` and `reasonCode` are closed vocabularies, and no
   * reviewer prose, diff or provider body reaches this row.
   */
  if (decisionRecorded) {
    await deps.store.appendBrainEntry({
      runId: run.runId,
      projectId: run.projectId,
      taskId: subject.taskId,
      workerId: input.workerId,
      entryId: `brain:decision:${subject.taskId}:${decision.action}:${decision.reasonCode}`,
      kind: 'DECISION',
      safeText: `${decision.action} (${decision.reasonCode}): ${decision.safeSummary}`,
      evidenceIds: decision.evidenceIds,
      occurredAt: deps.clock.now(),
    });
  }

  if (decision.action === 'REPAIR') {
    /**
     * ONE DECISION, ONE ROUND. `appendDecision` is idempotent by key, and a
     * replayed verification that skipped this guard would mint a SECOND repair
     * task beside the first — `repairRoundsBefore` counts the existing child,
     * so the replay computes the next round and creates it under a fresh id —
     * spending a round of the bound and a paid dispatch on work already
     * scheduled. The write that recorded the decision is the one that schedules
     * its repair.
     */
    if (!decisionRecorded) {
      return { kind: 'COMPLETED', taskId: task.taskId, workerId: input.workerId, duplicate: true, decision };
    }
    // The repair is planned for the SUBJECT — the work — never for the review.
    return scheduleRepair({
      ...input, task: subject, decision, tasks,
      findings: await deps.store.findingsForRun(run.runId, run.projectId),
    });
  }
  if (decision.action === 'ACCEPT' || decision.action === 'COMPLETE') {
    /**
     * `task.runnable` announces exactly what the decision's write released —
     * a fact the claim query will act on, recorded once, by the writer. A
     * duplicate decision released nothing, so it announces nothing.
     */
    if (decisionRecorded) {
      const byId = new Map(tasks.map((value) => [value.taskId, value]));
      for (const taskId of release.releasable) {
        const dependent = byId.get(taskId);
        await ledger.event('task.runnable', {
          taskId,
          facts: { unblockedBy: subject.taskId, role: dependent?.role ?? null, taskType: dependent?.taskType ?? null },
        });
      }
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
  tasks: readonly JuliusTask[];
  findings: Awaited<ReturnType<JuliusRuntimeStore['findingsForRun']>>;
}): Promise<JuliusTaskOutcome> {
  const { deps, run, ledger, task } = input;
  /**
   * ROUNDS ARE COUNTED FROM THE LINEAGE, from durable task rows. The store's
   * repair-cycle table is never written on the live path, so it answered zero
   * for every round and the repair bound was never reached; and a second
   * round chains on the first, so counting the subject's own children alone
   * would restart at one. `repairRoundsBefore` counts both directions.
   */
  const priorRounds = repairRoundsBefore(task, input.tasks);
  const repairTaskType = repairTaskTypeFor(task.taskType);

  /**
   * ROUTABLE BEFORE IT EXISTS. Paid run 34037313976 minted a repair task no
   * registered worker accepted, then spent an attempt discovering that as
   * `PROVIDER_UNAVAILABLE` — indistinguishable in the record from an outage.
   * The same eligibility, health and C.A.R.D. filters the dispatcher applies
   * are asked here, and an unroutable repair halts the run with its own
   * reason and spends nothing: no reservation, no task, no attempt.
   */
  const capability = input.request.capabilityFor?.({ taskId: task.taskId, taskType: repairTaskType, role: task.role });
  if (capability !== undefined) {
    const routes = deps.router.eligibleWorkerIds({ role: task.role, taskType: repairTaskType, capability, policy: input.request.policy });
    if (routes.length === 0) {
      await ledger.event('run.failed', {
        taskId: task.taskId,
        facts: { reasonCode: 'REPAIR_UNROUTABLE', repairRole: task.role, repairTaskType, forRepairRound: priorRounds + 1 },
      });
      return {
        kind: 'HALTED', taskId: task.taskId, reasonCode: 'REPAIR_UNROUTABLE',
        safeSummary: `A repair round was required and no registered worker accepts ${task.role} ${repairTaskType}.`,
      };
    }
  }

  // A REPAIR IS BUDGETED WORK. Reserving before planning is what stops a run
  // from scheduling a repair it cannot pay for and discovering that when the
  // repair task is claimed. The amount is the same allocation the round's own
  // dispatch will be given, so admission and execution cannot disagree.
  const reservationId = `reservation:repair:${task.taskId}:${priorRounds + 1}`;
  const estimate = deps.resources.estimate({ taskId: task.taskId, taskType: repairTaskType, role: task.role, attempt: priorRounds + 1 });
  const admission = await allocateFor({ deps, run, role: task.role, taskId: task.taskId, estimateUsdMicros: estimate.usdMicros });
  if (admission?.basis === 'EXHAUSTED') {
    await ledger.event('budget.denied', { taskId: task.taskId, facts: { reason: 'BUDGET_EXHAUSTED', forRepairRound: priorRounds + 1, ...allocationFacts(admission) } });
    await ledger.event('run.failed', { taskId: task.taskId, facts: { reasonCode: 'REPAIR_BUDGET_DENIED', forRepairRound: priorRounds + 1 } });
    return { kind: 'HALTED', taskId: task.taskId, reasonCode: 'REPAIR_BUDGET_DENIED', safeSummary: 'A repair round was required and the mission budget is exhausted.' };
  }
  const reservation = await deps.budget.reserve({
    reservationId, runId: run.runId, projectId: run.projectId, taskId: task.taskId,
    usdMicros: admission?.usdMicros ?? estimate.usdMicros, inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens,
    toolCalls: estimate.toolCalls, runtimeMs: estimate.runtimeMs, now: deps.clock.now(),
  });
  if (reservation.state === 'DENIED') {
    await ledger.event('budget.denied', { taskId: task.taskId, facts: { reason: reservation.denialReason, forRepairRound: priorRounds + 1 } });
    await ledger.event('run.failed', { taskId: task.taskId, facts: { reasonCode: 'REPAIR_BUDGET_DENIED', forRepairRound: priorRounds + 1 } });
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

/* ------------------------------------------------------- allocation */

/**
 * The allocation for one dispatch, or null when the composition has no policy
 * — in which case the estimate is reserved and the adapter keeps its default.
 * `remaining` is read from the ledger when it can answer; Unknown stays null.
 */
async function allocateFor(input: {
  deps: JuliusPipelineDependencies;
  run: JuliusRunRow;
  role: JuliusWorkerRole;
  /** The dispatch being allocated, so its own row is not counted as a prior round. */
  taskId: string;
  estimateUsdMicros: number;
}): Promise<JuliusDispatchDecision | null> {
  const policy = input.deps.allocation;
  if (policy === undefined) return null;
  const remaining = input.deps.budget.available === undefined ? null
    : await input.deps.budget.available({ runId: input.run.runId, projectId: input.run.projectId, now: input.deps.clock.now() });

  /**
   * v3 — ONE SHARED CEILING WITH PROTECTED FLOORS.
   *
   * The ledger is REQUIRED here rather than preferred: this rule decides
   * against what every slot currently holds, and a round count cannot see an
   * outstanding reservation or a settlement that reported less than it held.
   * With no timeline reader bound there is nothing honest to decide from, so it
   * reports the estimate under its own basis rather than inventing a position.
   */
  if (policy.version === JULIUS_SHARED_CEILING_VERSION) {
    const ledger = await projectSlotLedgerFor(input.deps, input.run, policy.ceilingUsdMicros, policy.version);
    if (ledger === null || ledger.historicalPolicyConflict) {
      return {
        usdMicros: input.estimateUsdMicros, basis: 'ESTIMATE_NO_LEDGER',
        shareUsdMicros: null, remainingUsdMicros: remaining,
        policyVersion: policy.version, slot: input.role, slotEnvelopeUsdMicros: null,
      };
    }
    const held: Record<string, number> = {};
    for (const [slot, account] of Object.entries(ledger.bySlot)) {
      held[slot] = account.outstandingUsdMicros
        + account.settledKnownUsdMicros + account.settledUnknownUsdMicros;
    }
    const runTasks = await input.deps.store.tasksForRun(input.run.runId, input.run.projectId);
    // COUNTED FROM THE RUN'S OWN ROWS, never from a field, so a restarted
    // process reaches the same number.
    const repairRoundsUsed = runTasks.filter((task) => task.taskType.startsWith('repair:')).length;
    const draw = juliusSharedCeilingDraw({
      policy, slot: input.role, heldBySlot: held,
      unallocatedUsdMicros: ledger.unallocatedUsdMicros, repairRoundsUsed,
    });
    /**
     * THE DRAW IS THE GRANT, and deliberately not the estimate.
     *
     * `resources` is a FIXED estimate — one number, 300,000, for every role in
     * the live composition. It is a placeholder for the shape of a request, not
     * a model of what a dispatch costs, and Mission 5's coder settled seventeen
     * times it. Binding the grant to that number reintroduces exactly the
     * starvation v3 exists to end, from a different direction: not a per-round
     * cap, but a per-estimate one.
     *
     * So a slot is permitted what the mission can actually lend it right now.
     * The costs of that are stated rather than hidden:
     *
     *   - a provider that REPORTS its cost closes the difference on settlement,
     *     because a known settlement releases the unheld remainder;
     *   - a provider that stays SILENT is charged the whole reservation, which
     *     is the conservative rule this repository already runs under, and it
     *     means a silent slot spends its draw whether or not it did the work.
     *
     * The second is why PERMISSION AND RESERVATION ARE SEPARATED HERE, and they
     * were conflated in one line before this: `resources.usdMicros` became the
     * allocation, so whatever a dispatch was permitted was also held, and
     * whatever was held was what a silent provider consumed. Granting a peer
     * its whole draw then cost the mission a third of its ceiling on one
     * planning dispatch that reported nothing — which a test caught by asking
     * whether the peers still had anything protected by the time the coder ran.
     *
     * So: `usdMicros` is what this dispatch may SPEND, bounded by what the
     * mission can lend; `reserveUsdMicros` is what Julius HOLDS against it,
     * which stays the estimate. A provider that reports closes the difference
     * on settlement; a silent one consumes only what was actually held. Neither
     * can exceed the mission, because the spend ceiling itself is the draw.
     */
    const granted = Math.floor(draw.maxDrawUsdMicros);
    const reserved = Math.floor(Math.min(Math.max(0, input.estimateUsdMicros), draw.maxDrawUsdMicros));
    const shared = {
      sharedPoolUsdMicros: draw.sharedPoolUsdMicros,
      protectedForPeersUsdMicros: draw.protectedForPeersUsdMicros,
      repairReserveUsdMicros: draw.repairReserveUsdMicros,
    };
    if (granted <= 0) {
      return {
        usdMicros: 0, basis: 'EXHAUSTED', shareUsdMicros: draw.ownFloorRemainingUsdMicros,
        remainingUsdMicros: remaining, policyVersion: policy.version, slot: input.role,
        slotEnvelopeUsdMicros: draw.ownFloorRemainingUsdMicros,
        unallocatedUsdMicros: ledger.unallocatedUsdMicros, ledgerRevision: ledger.revision,
        slotRefusal: 'SHARED_CEILING_EXHAUSTED', ...shared,
      };
    }
    return {
      usdMicros: granted,
      basis: juliusSharedCeilingSourceFor(granted, draw),
      shareUsdMicros: draw.ownFloorRemainingUsdMicros,
      remainingUsdMicros: remaining,
      policyVersion: policy.version,
      slot: input.role,
      slotEnvelopeUsdMicros: draw.ownFloorRemainingUsdMicros,
      slotRemainingUsdMicros: draw.ownFloorRemainingUsdMicros,
      unallocatedUsdMicros: ledger.unallocatedUsdMicros,
      ledgerRevision: ledger.revision,
      slotRefusal: null,
      reserveUsdMicros: reserved,
      ...shared,
    };
  }

  if (policy.version !== JULIUS_SLOT_ENVELOPE_VERSION) {
    const v1 = evaluateJuliusAllocation({
      policy, role: input.role, remainingUsdMicros: remaining, estimateUsdMicros: input.estimateUsdMicros,
    });
    return { ...v1, slot: null, slotEnvelopeUsdMicros: null };
  }

  /**
   * THE SLOT DIMENSION IS COUNTED IN ROUNDS, AND SAYS SO.
   *
   * `available` reports what the MISSION has left; no ledger here can report
   * what one slot has left, and inventing a per-slot money figure out of a
   * mission-wide one would be a number nobody measured. So a slot's remaining
   * envelope is derived from the rows that exist: every dispatch of that slot
   * was capped at one share, so `envelope - rounds × share` is a LOWER bound on
   * what the slot still has. Under-allocating is the safe direction, and the
   * global remainder — which is real money from the real ledger — is what
   * reallocation draws on once a slot's envelope is spent.
   *
   * A store that can one day answer per-slot money passes it straight into the
   * evaluator; nothing about the rule changes when it does.
   */
  /**
   * THE REAL LEDGER FIRST. Projected from the run's own durable budget rows, so
   * an open reservation, a settlement that reported less than it held and money
   * another slot is holding are all visible — none of which a round count can
   * see.
   */
  const ledger = await projectSlotLedger(input.deps, input.run, policy);
  /**
   * A RUN ALLOCATED UNDER v1 IS READ UNDER v1, whatever is deployed now. The
   * ledger still projects — the money is the money — and the decision falls
   * back rather than inventing a per-slot position that run never had.
   */
  if (ledger !== null && !ledger.historicalPolicyConflict) {
    const verdict = reserveJuliusSlotCapacity({ ledger, slot: input.role });
    const account = ledger.bySlot[input.role];
    if (!verdict.ok) {
      return {
        usdMicros: 0,
        basis: verdict.refusal === 'SLOT_NOT_A_PEER' ? 'ESTIMATE' : 'EXHAUSTED',
        shareUsdMicros: account?.perRoundShareUsdMicros ?? null,
        remainingUsdMicros: remaining,
        policyVersion: policy.version,
        slot: input.role,
        slotEnvelopeUsdMicros: account?.envelopeUsdMicros ?? null,
        slotRemainingUsdMicros: account?.remainingOwnEnvelopeUsdMicros ?? null,
        slotRoundsUsed: account?.reservationsOpened ?? 0,
        ledgerRevision: verdict.ledgerRevision,
        slotOutstandingUsdMicros: account?.outstandingUsdMicros ?? null,
        slotSettledKnownUsdMicros: account?.settledKnownUsdMicros ?? null,
        slotSettledUnknownUsdMicros: account?.settledUnknownUsdMicros ?? null,
        unallocatedUsdMicros: ledger.unallocatedUsdMicros,
        slotRefusal: verdict.refusal,
      };
    }
    return {
      usdMicros: verdict.usdMicros,
      basis: verdict.source,
      shareUsdMicros: verdict.perRoundShareUsdMicros,
      remainingUsdMicros: remaining,
      policyVersion: policy.version,
      slot: verdict.slot,
      slotEnvelopeUsdMicros: account?.envelopeUsdMicros ?? null,
      slotRemainingUsdMicros: verdict.remainingOwnEnvelopeUsdMicros,
      slotRoundsUsed: account?.reservationsOpened ?? 0,
      ledgerRevision: verdict.ledgerRevision,
      slotOutstandingUsdMicros: account?.outstandingUsdMicros ?? null,
      slotSettledKnownUsdMicros: account?.settledKnownUsdMicros ?? null,
      slotSettledUnknownUsdMicros: account?.settledUnknownUsdMicros ?? null,
      unallocatedUsdMicros: verdict.unallocatedUsdMicros,
      // The ledger granted. Stated rather than left absent, so "no refusal" and
      // "a rule with no refusals to give" do not read the same on the row.
      slotRefusal: null,
    };
  }

  /**
   * NO TIMELINE READER: COUNT ROUNDS, AND SAY THAT IS WHAT WAS COUNTED.
   *
   * Every dispatch of a slot was capped at one share, so
   * `envelope - rounds x share` is a LOWER bound on what the slot still has.
   * Under-allocating is the safe direction. The basis carries an
   * `_ESTIMATED_FROM_ROUNDS` suffix so a reader of the durable record can tell
   * a decision made against the money from one made against a proxy for it.
   */
  const tasks = await input.deps.store.tasksForRun(input.run.runId, input.run.projectId);
  const priorRounds = tasks.filter((row) => row.role === input.role
    && row.taskId !== input.taskId
    && (row.state === 'SUCCEEDED' || row.state === 'FAILED' || row.state === 'ACTIVE')).length;
  const envelope = slotEnvelopeUsdMicros(policy, input.role);
  const share = slotRoundShareUsdMicros(policy, input.role);
  const slotRemaining = Math.max(0, envelope - (priorRounds * share));

  const v2 = evaluateJuliusSlotAllocation({
    policy, role: input.role,
    slotRemainingUsdMicros: slotRemaining,
    unreservedUsdMicros: remaining,
    estimateUsdMicros: input.estimateUsdMicros,
  });
  return {
    usdMicros: v2.usdMicros,
    basis: `${v2.basis}_ESTIMATED_FROM_ROUNDS`,
    shareUsdMicros: v2.slotShareUsdMicros,
    remainingUsdMicros: v2.unreservedUsdMicros,
    policyVersion: v2.policyVersion,
    slot: v2.slot,
    slotEnvelopeUsdMicros: v2.slotEnvelopeUsdMicros,
    slotRemainingUsdMicros: v2.slotRemainingUsdMicros,
    slotRoundsUsed: priorRounds,
  };
}

/**
 * READ EVERY BUDGET ROW THIS RUN HAS WRITTEN, and project the slot accounts.
 *
 * Null when no timeline reader is bound — an honest absence rather than an
 * empty ledger, because an empty ledger would report a mission that has spent
 * nothing and hand out the whole ceiling twice.
 */
async function projectSlotLedger(
  deps: JuliusPipelineDependencies,
  run: JuliusRunRow,
  policy: JuliusSlotEnvelopePolicy,
): Promise<JuliusMissionSlotLedger | null> {
  return projectSlotLedgerFor(deps, run, policy.ceilingUsdMicros, policy.version, policy);
}

/**
 * The same projection for any policy version.
 *
 * v3 has no per-slot envelope of its own — its floors are a different shape —
 * so it passes no policy and reads the accounts for what they are: what each
 * slot holds, settled and unsettled. The envelope fields on those accounts are
 * then zero, which is correct rather than missing: under v3 a slot's capacity
 * is not an envelope.
 */
async function projectSlotLedgerFor(
  deps: JuliusPipelineDependencies,
  run: JuliusRunRow,
  ceilingUsdMicros: number,
  policyVersion: string,
  policy: JuliusSlotEnvelopePolicy | null = null,
): Promise<JuliusMissionSlotLedger | null> {
  if (deps.timeline === undefined) return null;
  const rows: JuliusBudgetRow[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await deps.timeline.timeline({
      runId: run.runId, projectId: run.projectId, sinceSequence, limit: 500,
    });
    for (const entry of page.entries) {
      sinceSequence = Math.max(sinceSequence, entry.sequence);
      if (entry.type === 'budget.allocated' || entry.type === 'budget.reserved' || entry.type === 'budget.settled') {
        rows.push({ type: entry.type, taskId: entry.taskId, facts: entry.facts });
      }
    }
    if (!page.hasMore || page.entries.length === 0) break;
  }
  return projectJuliusSlotLedger({
    runId: run.runId,
    policy,
    policyVersion,
    ceilingUsdMicros,
    rows,
  });
}

/**
 * ONE ALLOCATION SHAPE FOR BOTH POLICIES, so the pipeline reads the same
 * fields whichever rule produced them and `EXHAUSTED` still means the same
 * thing at the one place a dispatch is denied.
 */
interface JuliusDispatchDecision {
  readonly usdMicros: number;
  readonly basis: string;
  readonly shareUsdMicros: number | null;
  readonly remainingUsdMicros: number | null;
  readonly policyVersion: string;
  /** Which peer slot this draws against. Null under the v1 rule, which has none. */
  readonly slot: JuliusWorkerRole | null;
  readonly slotEnvelopeUsdMicros: number | null;
  readonly slotRemainingUsdMicros?: number | null;
  readonly slotRoundsUsed?: number;
  /** The ledger revision this decision was made against, when there was one. */
  readonly ledgerRevision?: number;
  readonly slotOutstandingUsdMicros?: number | null;
  readonly slotSettledKnownUsdMicros?: number | null;
  readonly slotSettledUnknownUsdMicros?: number | null;
  readonly unallocatedUsdMicros?: number | null;
  /**
   * WHY THE LEDGER SAID NO, in its own vocabulary.
   *
   * The decision collapses every refusal into `EXHAUSTED`, which is what the
   * dispatch path needs, and collapsing it there loses the one distinction a
   * reader afterwards actually needs: a slot refused because THE MISSION ran
   * dry did not do less work for the same reason as one refused because it is
   * not a peer of this policy. Null when the ledger granted; absent under v1,
   * which has no per-slot ledger to refuse.
   */
  readonly slotRefusal?: string | null;
  /**
   * What Julius HOLDS for this dispatch, when that differs from what it may
   * spend. Absent means the two are the same, which is what every rule before
   * v3 assumed.
   */
  readonly reserveUsdMicros?: number;
  /** v3 only: what was free, what was protected, what repairs still hold. */
  readonly sharedPoolUsdMicros?: number;
  readonly protectedForPeersUsdMicros?: number;
  readonly repairReserveUsdMicros?: number;
}

const allocationFacts = (allocation: JuliusDispatchDecision): Record<string, string | number | null> => ({
  allocatedUsdMicros: allocation.usdMicros, allocationBasis: allocation.basis,
  shareUsdMicros: allocation.shareUsdMicros, remainingUsdMicros: allocation.remainingUsdMicros,
  allocationPolicy: allocation.policyVersion,
  // Null under v1 rather than absent: a reader comparing two missions should be
  // able to see that one had no slot envelope at all.
  slot: allocation.slot,
  slotEnvelopeUsdMicros: allocation.slotEnvelopeUsdMicros,
  slotRemainingUsdMicros: allocation.slotRemainingUsdMicros ?? null,
  slotRoundsUsed: allocation.slotRoundsUsed ?? null,
  // The per-slot position this decision was made against, so a reader can
  // reconstruct WHY a dispatch got what it got without replaying the ledger.
  slotOutstandingUsdMicros: allocation.slotOutstandingUsdMicros ?? null,
  slotSettledKnownUsdMicros: allocation.slotSettledKnownUsdMicros ?? null,
  slotSettledUnknownUsdMicros: allocation.slotSettledUnknownUsdMicros ?? null,
  unallocatedUsdMicros: allocation.unallocatedUsdMicros ?? null,
  ledgerRevision: allocation.ledgerRevision ?? null,
  // ABSENT, NULL AND A CODE ARE THREE DIFFERENT ANSWERS, so the key is omitted
  // rather than nulled when there is nothing to say. Absent is v1: no per-slot
  // ledger exists, so no refusal was possible and the reader sees unknown.
  // `null` is a ledger that GRANTED. A code is the ledger's own reason for
  // refusing. Nulling the first would report v1 as a rule that considered this
  // dispatch and allowed it, which is not something v1 ever did.
  ...(allocation.slotRefusal === undefined ? {} : { slotRefusal: allocation.slotRefusal }),
  ...(allocation.reserveUsdMicros === undefined ? {} : { reserveUsdMicros: allocation.reserveUsdMicros }),
  // v3's three numbers, absent under the rules that do not have them — so a
  // reader can tell "this rule protects peer capacity and here is how much"
  // from "this rule has no such concept".
  ...(allocation.sharedPoolUsdMicros === undefined ? {} : { sharedPoolUsdMicros: allocation.sharedPoolUsdMicros }),
  ...(allocation.protectedForPeersUsdMicros === undefined
    ? {} : { protectedForPeersUsdMicros: allocation.protectedForPeersUsdMicros }),
  ...(allocation.repairReserveUsdMicros === undefined
    ? {} : { repairReserveUsdMicros: allocation.repairReserveUsdMicros }),
});

/* ---------------------------------------------------- repair context */

/**
 * The OPEN blocking findings a repair-shaped task exists to address: for a
 * `repair:*` task, those recorded on its subject (its parent); for a
 * `review:repair:*` task, those recorded on the repaired subject (its
 * parent's parent). Anything else has none.
 */
function repairContextFindings(
  task: JuliusTask,
  tasks: readonly JuliusTask[],
  findings: readonly JuliusReviewerFinding[],
): JuliusReviewerFinding[] {
  const byId = new Map(tasks.map((value) => [value.taskId, value]));
  let subjectId: string | null = null;
  if (task.taskType.startsWith('repair:')) subjectId = task.parentTaskId;
  else if (task.taskType.startsWith('review:repair:')) {
    const repair = task.parentTaskId === null ? undefined : byId.get(task.parentTaskId);
    subjectId = repair?.parentTaskId ?? null;
  }
  if (subjectId === null) return [];
  return findings.filter((finding) => finding.taskId === subjectId && finding.blocking && finding.status === 'OPEN');
}

/** A finding as a context entry: scoped to this task and this role, never SECRET, never the reviewer's raw body. */
const findingEntryFor = (task: JuliusTask, finding: JuliusReviewerFinding): JuliusBrainEntry => ({
  entryId: `finding:${task.taskId}:${finding.findingId}`,
  kind: 'FINDING',
  text: `REVIEW FINDING ${finding.findingId} [${finding.severity}${finding.criterionId === null ? '' : `, criterion ${finding.criterionId}`}]: ${finding.claim}`,
  taskIds: [task.taskId],
  allowedRoles: [task.role],
  sensitivity: 'INTERNAL',
});
