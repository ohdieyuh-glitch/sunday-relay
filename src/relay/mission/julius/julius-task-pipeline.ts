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
import type { JuliusApprovalStore } from './julius-lifecycle-runtime';
import { decideJuliusContinuation } from './julius-continuation';
import { JuliusExecutionCoordinator, type JuliusExecutionOutcome, type JuliusExecutionPorts, type JuliusExecutionClaim, type JuliusResourceRequest } from './julius-execution-coordinator';
import { safeReasonCode, type JuliusDispatchWorkspace, type JuliusProviderRouter } from './julius-router';
import { consistentJuliusBillingPath, juliusCostComponent } from './julius-cost-accounting';
import { juliusContractDisposition, juliusContractDispositionFacts } from './julius-contract-disposition';
import { createJuliusContextSnapshot } from './julius-context-snapshot';
import { deriveJuliusContextQualification } from './julius-context-provenance';
import type { JuliusBrainAppend } from './julius-runtime-ports';
import { juliusAdmittedClaimFor, juliusClaimPromotionsOnAccept, mergeJuliusDurableStanding } from './julius-claim-ledger';
import { JULIUS_DEFAULT_MAX_CODER_SEGMENTS, evaluateJuliusVerification, type JuliusReviewerFinding, type JuliusVerificationPolicy } from './julius-verification-runtime';
import { planJuliusRepair } from './julius-repair-runtime';
import { juliusWorkUnitRootOf, repairLineageRootOf, repairRoundsBefore, repairTaskTypeFor } from './julius-repair-lineage';
import { foldJuliusPeerRequests, guardJuliusPeerResponse, juliusPeerIdsThatFit, type JuliusPeerLedgerEntry } from './julius-peer-channel';
import {
  advanceJuliusDisagreement, foldJuliusDisagreements, juliusDisagreementOpenedFacts, juliusDisagreementStepFacts,
  juliusRebuttalReviewTaskId, juliusRebuttalTaskId, openJuliusDisagreement, sanitizeJuliusRebuttal,
  type JuliusDisagreement, type JuliusDisagreementStep,
} from './julius-disagreement';
import {
  JULIUS_LOCAL_EXECUTION_SCOPE, juliusPeerPartyForRole, moveJuliusPeerRequest, openJuliusPeerRequestOnLedger, readJuliusPeerLedger,
  type JuliusPeerRuntimeContext,
} from './julius-peer-runtime';
import { challengeJuliusTaskContract, evaluateJuliusBindingCurrency, evaluateJuliusSharedBinding, juliusContractReviewCharge, juliusTaskContractBinding, lockJuliusTaskContract, mayDispatchUnderContract, reviseJuliusTaskContract, sanitizeJuliusContractProposal, type JuliusTaskContract, type JuliusTaskContractBinding } from './julius-task-contract';
import { evaluateJuliusRelease } from './julius-release-runtime';
import { REVIEW_TASK_ATTEMPTS, boundStageForRole, reviewStageOf, workStageOf, type JuliusReviewStage } from './julius-review-stage';
import {
  juliusRestoreRequestFor,
  juliusWorkspaceCleanliness,
  readJuliusAttemptWorkspace,
  type JuliusWorkspaceCleanliness,
} from './julius-workspace-attribution';
import {
  juliusReviewedWorkOf, juliusSegmentLineageRootOf, juliusSegmentSubjectTaskId, juliusSegmentTaskId, juliusYieldContinuationOf, nextSegmentNumber, pendingSegmentFor,
  routeIsBarrier, sanitizeJuliusSegmentState, segmentChildrenOf, juliusReviewConclusionOf,
} from './julius-segment-lineage';
import {
  juliusEffectiveReviewVerdict, juliusEvidenceReviewVerdict, juliusReviewRoute, juliusReviewVerdictFacts,
  juliusReviewVerdictFromFacts, juliusWarningIsPromoted, sanitizeJuliusReviewVerdict,
  type JuliusReviewRoute, type JuliusReviewVerdictDeclaration,
} from './julius-review-verdict';
import {
  foldJuliusFindings, juliusFindingTransitionFacts, moveJuliusFinding,
  type JuliusFindingLife, type JuliusFindingMove, juliusEffectiveFindings, juliusFindingIsOutstanding, juliusFindingIsUnresolved, juliusFindingsCompletionGate, type JuliusFindingsCompletionGate
} from './julius-finding-lifecycle';
import {
  juliusRepairRoundDiff, juliusRepairRoundEntryId, renderJuliusRepairRoundDiff,
} from './julius-repair-round';
import {
  foldJuliusArchitecture, juliusArchitectureConflicts, juliusArchitectureEntryId, juliusArchitectureFacts,
  juliusArchitectureMatches, juliusArchitectureProposalEntryId, juliusNextArchitectureRevision,
  renderJuliusArchitecture, sanitizeJuliusArchitecture,
  type JuliusArchitectureState,
} from './julius-architecture-state';
import {
  JULIUS_ARCHITECTURE_DRIFT_LIMITS, juliusArchitectureChangeIsMaterial, juliusArchitectureChanges, juliusCoderObservationFacts, sanitizeJuliusCoderObservations,
  juliusArchitectureCheckTaskId, juliusArchitectureCompletionGate, juliusArchitectureTriggerFacts,
  juliusArchitectureTriggers, juliusConsistencyFacts, juliusConsistencyRoute, sanitizeJuliusConsistency,
  type JuliusArchitectureCompletionGate,
} from './julius-architecture-drift';
import { juliusResultChannelPermitted } from './julius-worker-authority';
import {
  JULIUS_WORKSPACE_LIMITS, juliusFailureIsContentRefusal, juliusScopeViolations,
  readJuliusCodingAgentImplementation, sanitizeJuliusCodingAgentReport,
  type JuliusCodingAgentImplementation,
} from './julius-coding-agent';
import {
  JULIUS_CHECKPOINT_LIMITS, JULIUS_COORDINATOR_AUTHOR,
  guidanceSubjectTaskId, isJuliusGuidanceHandoffEntryId, issueJuliusGuidance, juliusCheckpointId,
  JULIUS_GUIDANCE_AUTHORITATIVE_HEADING, JULIUS_GUIDANCE_PROPOSED_HEADING,
  juliusGuidanceHandoffEntryId, juliusGuidanceId, juliusGuidanceProposalEntryId, juliusGuidanceTaskId,
  juliusResearchCheckpointId, renderJuliusGuidanceHandoff,
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
import { JULIUS_RUNTIME_VERSION, JuliusContextIntegrityRefusal, type JuliusBrainEntry, type JuliusContextQualification, type JuliusEvidence, type JuliusRecordedDecision, type JuliusTask, type JuliusVerificationDecision, type JuliusWorker, type JuliusWorkerRole } from './julius-runtime';
import { juliusDecisionEventId, validateJuliusEvent, type JuliusOperationalEvent, type JuliusOperationalEventType } from './julius-events';
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
   *
   * `pendingApprovals`, WHEN THE STORE SERVES IT, is how `advanceRun` knows a
   * BLOCKED run is waiting on a person rather than on work: a run with a
   * PENDING approval is not walked out of BLOCKED by the task graph. Both
   * PostgreSQL and in-memory stores serve it; a store that does not cannot
   * hold an approval at all.
   */
  readonly store: JuliusRuntimeStore & JuliusRecoveryDriver & Partial<Pick<JuliusApprovalStore, 'pendingApprovals'>>;
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
  /**
   * THE EXECUTION ATTEMPT THIS RUNTIME IS, for naming peer requests.
   *
   * A mission's run id is derived from its contract, so every workflow attempt
   * of one mission carries the same run id, and an id built from the run alone
   * would make attempt 4's review request and attempt 5's the same row wherever
   * the two are read together. The live entrypoint passes the workflow run and
   * attempt; absent, `JULIUS_LOCAL_EXECUTION_SCOPE`.
   */
  readonly executionScope?: string;
  /** Whoever holds the lease. Recorded on every event for attribution. */
  readonly owner: string;
  /**
   * Context budget in characters. Compiling is bounded, never open-ended. A
   * function sets it per role: a worker that reads a served page needs room
   * for it, and a worker whose packet travels a bounded transport must not be
   * given room it cannot carry.
   */
  readonly contextCharacterBudget: number | ((role: JuliusWorkerRole) => number);
  /**
   * HOW A BRAIN ENTRY BECOMES A RANKABLE CLAIM. Defaults to
   * `deriveJuliusContextQualification`, which reads durable columns and nothing
   * else.
   *
   * IT IS A SEAM FOR A CLAIM STORE, not a switch. Today nothing records that one
   * brain entry supersedes or contradicts another, so the derivation produces no
   * lineage and the compiler's fail-closed path is unreachable in production. The
   * day a claim store exists it arrives here, and the pipeline does not change.
   * Until then this is also how the fail-closed path is driven through the REAL
   * pipeline by a proof, rather than asserted at the compiler and hoped for here.
   */
  readonly contextQualification?: (entries: readonly JuliusBrainEntry[]) => JuliusContextQualification;
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
  /** The dispatch ended at a barrier: not reviewed, because its continuation carries the work. */
  | { readonly kind: 'YIELDED'; readonly taskId: string; readonly workerId: string; readonly continuationTaskId: string }
  | { readonly kind: 'REPAIR_SCHEDULED'; readonly taskId: string; readonly repairTaskId: string; readonly round: number }
  | { readonly kind: 'RETRY'; readonly taskId: string; readonly code: string; readonly failureClass?: string | null }
  | { readonly kind: 'FAILED'; readonly taskId: string; readonly code: string; readonly failureClass?: string | null }
  /**
   * THE WORK WAS NOT DONE AND THE TASK DID NOT FAIL: a provider declined the
   * request itself, and Julius re-planned the work into a continuation the
   * architect will restate. The task ends SKIPPED, the mission is still alive,
   * and `code`/`failureClass` still say what was declined.
   */
  | {
    readonly kind: 'SUPERSEDED'; readonly taskId: string; readonly code: string;
    readonly failureClass: string; readonly guidanceTaskId: string; readonly continuationTaskId: string;
  }
  | { readonly kind: 'DENIED'; readonly taskId: string; readonly reasonCode: string }
  | { readonly kind: 'APPROVAL_REQUIRED'; readonly taskId: string; readonly operation: string; readonly reasonCode: string }
  | { readonly kind: 'HALTED'; readonly taskId: string; readonly reasonCode: string; readonly safeSummary: string }
  /**
   * NO DECISION YET, ON PURPOSE. A material challenge is open against the work,
   * so Julius neither accepts it — which would release what depends on it — nor
   * repairs it on a disagreement nobody has resolved.
   */
  | { readonly kind: 'HELD'; readonly taskId: string; readonly reasonCode: string; readonly requestId: string }
  /**
   * NOT REVIEWED, AND NOT GOING TO BE BY THIS REVIEW. The reviewer paused for
   * research and the research failed, so no verdict exists. Julius neither
   * accepts the work nor repairs it on a review that never concluded.
   */
  | { readonly kind: 'UNREVIEWED'; readonly taskId: string; readonly reasonCode: 'REVIEW_RESEARCH_FAILED'; readonly reviewTaskId: string; readonly failedSegmentTaskId: string };

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
    await this.deps.store.appendEvent(this.compose(type, input));
  }

  /**
   * THE SAME EVENT, BUILT BUT NOT WRITTEN.
   *
   * An event that explains a decision is written inside the decision's own
   * durable write, so its caller needs the event as a value rather than as a
   * side effect. `eventId` comes from that caller — derived from the decision's
   * idempotency key, so a replayed decision names the same events — and
   * otherwise defaults to the minted id every other event carries.
   *
   * Validated here, as it always was, so a fact that could not legally be
   * recorded is refused before it can take a decision's transaction down with
   * it.
   */
  compose(
    type: JuliusOperationalEventType,
    input: { taskId: string | null; workerId?: string | null; causationId?: string | null; facts: Record<string, string | number | boolean | null> },
    eventId?: string,
  ): JuliusOperationalEvent {
    const event: JuliusOperationalEvent = {
      eventId: eventId ?? this.deps.ids.next(`event:${type}`),
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
    return event;
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
     *
     * READ OFF THE LINEAGE ROOT, not the dispatch's own id. The repair of a
     * rejected packet (`repair:guidance:…`) and the continuation of an architect
     * that paused its answer (`segment:guidance:…`) advise under the same terms
     * as the guidance task they descend from; matched by id alone they were
     * architect tasks bound by nothing, dispatched past the gate that refuses
     * guidance written under unlocked terms.
     */
    const guided = guidanceSubjectTaskId(rootOf(worker));
    if (guided !== null) {
      const subject = byId.get(guided);
      return subject === undefined ? null : rootOf(subject);
    }
    // The Prompt Architect produces the terms and is bound by none.
    return null;
  };
  const own = subjectOfWorker(task);
  if (own !== null) return own;
  if (task.role === 'INDEPENDENT_REVIEWER') {
    // Through the review's own head: a review that paused to research continues
    // as a segment whose parent is the review, not the work it judges.
    const head = byId.get(rootOf(task));
    const reviewed = head?.parentTaskId === null || head === undefined ? undefined : byId.get(head.parentTaskId);
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
/**
 * THE MEASUREMENT COLUMNS OF A FAILED ATTEMPT, read out of the boundary's own
 * flattened diagnostics.
 *
 * `flattenDiagnostics` prefixes every key with `diag_` so it cannot collide with
 * `code`, `failureClass` or `reasonCode`, and it has already sanitised each
 * value. This reads the five the trajectory row has columns for and refuses
 * anything that is not a finite non-negative integer — `validateTrajectoryEvent`
 * would refuse it anyway, and a NaN on a durable row is a number nobody can act
 * on.
 *
 * `diag_elapsedMs` is the reviewer transport's own word for wall time and the
 * trajectory column is `durationMs`; `diag_provider` is what answered, which on
 * a failure is the only place the provider identity survives at all.
 */
function diagnosedMeasurement(diagnostics: Readonly<Record<string, string | number | boolean | null>> | undefined): {
  providerId?: string; usdMicros?: number | null;
  inputTokens?: number | null; outputTokens?: number | null; durationMs?: number | null;
} {
  if (diagnostics === undefined) return {};
  const count = (value: unknown): number | null =>
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
  const provider = diagnostics.diag_provider;
  return {
    ...(typeof provider === 'string' && provider.trim() !== '' ? { providerId: provider } : {}),
    usdMicros: count(diagnostics.diag_costUsdMicros),
    inputTokens: count(diagnostics.diag_inputTokens),
    outputTokens: count(diagnostics.diag_outputTokens),
    durationMs: count(diagnostics.diag_elapsedMs),
  };
}

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
    // For a review that paused to research, the parent is that review, whose own
    // claim already passed this comparison against the work — so the check is
    // transitively the same one.
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
  let handed: { brainRetrievals: number; evidenceInspected: number; guidanceConsumed: number } | null = null;
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
    /**
     * A CONTINUATION NEVER RUNS WITHOUT THE ANSWER IT WAITED FOR.
     *
     * The decision that accepts a guidance packet releases the waiting
     * continuation in the same write, and the packet is delivered in the step
     * AFTER it. A process that died between the two left a RUNNABLE continuation
     * with no answer — and nothing ever delivered it, because a replayed decision
     * writes nothing and the waiting task is no longer BLOCKED to be found.
     * Checked here, where the continuation is about to be dispatched: whatever
     * Julius accepted for it is delivered now if it was not delivered then.
     */
    if (juliusSegmentSubjectTaskId(task.taskId) !== null && task.dependencyIds.some((id) => guidanceSubjectTaskId(id) !== null)) {
      await deliverOwedGuidance({ deps, run, ledger, task, workerId: worker.workerId });
    }
    const [evidence, findings, criteria, brain, runTasks] = await Promise.all([
      deps.store.evidenceForRun(run.runId, run.projectId),
      effectiveFindingsOf(deps, run),
      deps.store.criteriaForRun(run.runId, run.projectId),
      deps.store.brainEntriesForRun(run.runId, run.projectId),
      // Only a repair RE-REVIEW needs to walk to its parent's parent; every
      // other task's subject is its own parent, and a 300-task run must not
      // pay for a graph copy per dispatch it will not read.
      // A repair's own continuation needs the graph too: its parent is the
      // repair it continues, and the findings are on the work that repair is for.
      task.taskType.startsWith('review:repair:') || task.taskType.startsWith('repair:')
        ? deps.store.tasksForRun(run.runId, run.projectId) : Promise.resolve([] as readonly JuliusTask[]),
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
    /**
     * THE CONTEXT INTEGRITY LAYER, ON THE REAL DISPATCH PATH.
     *
     * Every packet a live worker receives is now authority-ranked: the locked
     * terms first, then Julius's own decisions, then the reviewer's cited
     * findings, and an unverified handoff note last — whatever order the brain
     * rows happened to be written in, and however imperative their prose. The
     * qualification is DERIVED from durable columns only
     * (`julius-context-provenance.ts`); an entry the store cannot attribute is
     * admitted at the lowest standing rather than left out.
     *
     * This is deliberately not behind a flag. A ranking that runs for a fixture
     * and not for a mission proves nothing about the mission, and the failure it
     * prevents — one fat unverified memory crowding out the finding a repair
     * exists to address — is a failure of the real path only.
     */
    const contextEntries = [...brain, ...priorFindings.map((finding) => findingEntryFor(task, finding))];
    const derivedQualification = (deps.contextQualification ?? deriveJuliusContextQualification)(contextEntries);
    // THE RECORD WINS. A standing the claim ledger recorded — an admission, a
    // reviewer's promotion — replaces the derived one for the same claim; an
    // entry with no recorded claim keeps its derivation. `julius-claim-ledger.ts`.
    const qualification = mergeJuliusDurableStanding(derivedQualification, await deps.store.claimsForRun(run.runId, run.projectId));
    let snapshot;
    try {
      snapshot = createJuliusContextSnapshot({
      qualification,
      contextId: deps.ids.next('context'),
      runId: run.runId,
      task,
      worker,
      entries: contextEntries,
      maxCharacters: typeof deps.contextCharacterBudget === 'function'
        ? deps.contextCharacterBudget(worker.role)
        : deps.contextCharacterBudget,
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
    } catch (error) {
      /**
       * AN AUTHORITATIVE CLASH FAILS THE TASK, IT DOES NOT CRASH THE TICK.
       *
       * `compileContextWithIntegrity` refuses to compile a packet when two claims
       * of equal authority and equal trust contradict and nothing separates them:
       * handing a worker either side would make the packet assert something
       * Julius has no basis for. That refusal has to become a RECORDED task
       * failure — an exception escaping `dispatchJuliusTask` would abort the whole
       * tick, taking every other claimed task with it, and leave this one ACTIVE
       * with its lease held until the recovery sweep.
       *
       * The conflicting claim ids reach the ledger, because "something
       * contradicted something" is not a diagnosis. It is not retryable: the same
       * rows compile the same refusal, and a retry would spend an attempt to
       * learn what this row already says.
       */
      if (!(error instanceof JuliusContextIntegrityRefusal)) throw error;
      const clash = error.conflicts[0];
      await ledger.event('task.failed', {
        taskId: task.taskId,
        facts: {
          code: 'INVALID_REQUEST', errorRetryable: false,
          failureClass: 'context_integrity_unresolved_clash',
          reasonCode: error.reasonCode,
          conflicts: error.conflicts.length,
          clashClaimIds: clash === undefined ? null : clash.claimIds.join('|'),
          clashEntryIds: clash === undefined ? null : clash.entryIds.join('|'),
        },
      });
      await deps.store.finishTask({
        taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
        state: 'FAILED', now: deps.clock.now(),
      });
      return {
        kind: 'FAILED', taskId: claim.taskId, code: 'INVALID_REQUEST',
        failureClass: 'context_integrity_unresolved_clash',
      };
    }
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
      /**
       * GUIDANCE THIS PACKET ACTUALLY CARRIED.
       *
       * Counted the same way `brainRetrievals` is — off the entries the
       * compiler ADMITTED, not the entries that existed — so a packet whose
       * character budget dropped the advice reports that it carried none, which
       * is the truth about what the worker was shown.
       *
       * It stayed UNKNOWN until now for the plainest reason: nothing delivered
       * guidance to a worker, so nothing could count it. The number is a
       * consequence of the delivery above rather than a dimension invented to
       * fill a column.
       */
      guidanceConsumed: snapshot.sourceEntryIds.filter(isJuliusGuidanceHandoffEntryId).length,
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
     * NOR IS A CONTINUATION THAT CANNOT SEE THE ANSWER JULIUS ACCEPTED FOR IT.
     *
     * The same character budget that can drop a repair's findings can drop an
     * accepted guidance packet, and the continuation would then run on exactly
     * the guess the question existed to prevent — with the record saying the
     * answer was delivered. Refused for the reason the findings are.
     */
    const owedGuidance = brain.filter((entry) => isJuliusGuidanceHandoffEntryId(entry.entryId) && entry.taskIds.includes(task.taskId));
    const droppedGuidance = owedGuidance.filter((entry) => !snapshot.sourceEntryIds.includes(entry.entryId));
    if (droppedGuidance.length > 0) {
      await ledger.event('task.failed', {
        taskId: task.taskId,
        facts: {
          code: 'INVALID_REQUEST', errorRetryable: false, failureClass: 'accepted_guidance_dropped',
          droppedGuidance: droppedGuidance.length, characterCount: snapshot.characterCount,
        },
      });
      await deps.store.finishTask({
        taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
        state: 'FAILED', now: deps.clock.now(),
      });
      return { kind: 'FAILED', taskId: claim.taskId, code: 'INVALID_REQUEST', failureClass: 'accepted_guidance_dropped' };
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
    /* DID THE ANSWER ARRIVE. Null when this task is not a research continuation;
       otherwise whether the compiled packet really holds the answer entry — the
       last link between "Julius served a page" and "the worker was given it". */
    const researchAnswerId = `brain:research-answer:${task.taskId}`;
    const researchAnswerIncluded = brain.some((entry) => entry.entryId === researchAnswerId)
      ? snapshot.sourceEntryIds.includes(researchAnswerId)
      : null;
    await ledger.event('context.compiled', {
      taskId: task.taskId, workerId: worker.workerId,
      facts: {
        contextId, characterCount: snapshot.characterCount, truncated: snapshot.truncated,
        redactionCount: snapshot.redactionCount, contentHash: snapshot.contentHash, researchAnswerIncluded,
      },
    });
    /**
     * WHICH ACCEPTED GUIDANCE THIS DISPATCH WAS GIVEN, BY NAME.
     *
     * `worker.effort` carried a count, written only when a dispatch completed,
     * and a carried copy left nothing at all — so no record could say which
     * packet a coder acted on. Written with the compile, beside the context id,
     * from the snapshot's own source ids: what was in the packet, not what was
     * meant to be. A replayed dispatch compiles and records again, and says so
     * with the same context id.
     */
    const consumedGuidance = snapshot.sourceEntryIds.filter(isJuliusGuidanceHandoffEntryId);
    if (consumedGuidance.length > 0) {
      await ledger.event('guidance.consumed', {
        taskId: task.taskId, workerId: worker.workerId,
        facts: {
          contextId, attempt: claim.attempt, count: consumedGuidance.length,
          entryIds: consumedGuidance.join(' ').slice(0, 1_500),
        },
      });
    }
    await ledger.trajectory('CONTEXT_COMPILED', {
      taskId: task.taskId, workerId: worker.workerId, contextId,
      policyRevision: request.policy.revision,
      facts: { characterCount: snapshot.characterCount, truncated: snapshot.truncated, redactionCount: snapshot.redactionCount, contentHash: snapshot.contentHash, researchAnswerIncluded },
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
  /**
   * WHAT THE LAST ATTEMPT LEFT THAT THIS ONE MUST NOT INHERIT. Only a Coding
   * Agent edits the workspace, so only its dispatches carry the question.
   */
  const workspaceUndo = role === 'CODING_AGENT' ? await juliusWorkspaceRestoreFor(deps, run, claim.taskId) : null;
  let outcome: JuliusExecutionOutcome = allocation?.basis === 'EXHAUSTED'
    ? await (async (): Promise<JuliusExecutionOutcome> => {
      await ledger.event('budget.denied', { taskId: claim.taskId, facts: { reason: 'BUDGET_EXHAUSTED', ...allocationFacts(allocation) } });
      return { status: 'DENIED', code: 'BUDGET_DENIED' };
    })()
    : await coordinator.execute({
      claim: executionClaim, policy: request.policy, role, taskType: claim.taskType,
      capability: request.capability, resources, operationId, signal: request.signal,
      attempt: claim.attempt,
      ...(workspaceUndo === null ? {} : { workspace: workspaceUndo }),
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
      ...(workspaceUndo === null ? {} : { workspace: workspaceUndo }),
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
    /**
     * A FAILED ATTEMPT STILL CHANGED THE WORKSPACE, AND IT OWNS WHAT IT CHANGED.
     *
     * Recorded before the task is finished, so the facts exist whichever way
     * this attempt ends and whatever happens to the process next: the next
     * attempt reads them to know what it inherited, and Julius reads them to
     * decide whether the edits it refused must be undone first. A cancelled
     * dispatch collects nothing, and its record says UNKNOWN rather than clean.
     */
    if (outcome.implementation !== undefined && juliusResultChannelPermitted(claim.role, 'implementation')) {
      const failed = readJuliusCodingAgentImplementation(outcome.implementation);
      if (failed === null) {
        await ledger.event('coder.report.refused', {
          taskId: claim.taskId, facts: { reasonCode: 'coding_agent_implementation_unreadable' },
        });
      } else {
        /* The attribution alone: a failed attempt produced no result to review,
         * so it mints no diff evidence — only the truth about what it changed. */
        await recordAttemptWorkspace({
          deps, run, ledger, task, workerId: null,
          leaseGeneration: claim.leaseGeneration, attempt: claim.attempt, implementation: failed,
          scope: contractCharge === null ? null : { permittedPaths: contractCharge.permittedPaths, outOfScope: contractCharge.outOfScope },
        });
      }
    }

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
    /**
     * A RETRY IS SCHEDULED ONLY IF THE STORE TOOK IT. `finishTask` refuses a
     * holder whose lease is gone — reclaimed while this attempt ran, which is
     * exactly what a lost-lease cancellation is — and its answer was ignored,
     * so the trajectory said RETRY and the outcome said RETRY for a requeue
     * that never happened and belonged to someone else's lease.
     */
    /**
     * A DECLINED REQUEST IS RE-PLANNED, NOT COLLAPSED.
     *
     * One failed task fails the whole run (`julius-run-loop`: any FAILED task
     * is a FAILED mission), which is right for a crash and wrong for a refusal:
     * a provider declining the ASK is the one failure whose cure is a different
     * ask, and the Prompt Architect is who writes asks. So Julius raises the
     * guidance itself — `PROVIDER_DECLINED_REQUEST`, origin JULIUS — and the
     * barrier mints the architect's task plus a continuation segment carrying
     * the same work. Only then does the refused task end SKIPPED instead of
     * FAILED: the work is still owed to the continuation, so the mission is not
     * finished and nothing has been laundered.
     *
     * EVERY BOUND IS THE ORDINARY ONE. The reviewer is excluded — a review that
     * was declined leaves the work UNJUDGED, and re-planning the work would be
     * answering a question nobody asked; a declined review therefore fails, and
     * a mission that cannot be reviewed cannot complete. The rest is the
     * guidance path's own: nothing before the contract is LOCKED (a declining
     * architect cannot be asked to re-plan its own refusal), one outstanding
     * guidance task per subject, the segment ceiling, and a route the architect
     * can actually be reached on. Any of them failing leaves the task FAILED
     * and the run fails truthfully with the class on the record.
     */
    /**
     * ONE RE-PLAN PER UNIT OF WORK, and no counter to keep: a unit that has
     * already had a refusal re-planned holds a SKIPPED task, which is durable,
     * survives a restart, and cannot be double-counted by a replayed tick. If
     * the architect restated the ask and a provider declines it again, the ask
     * was not the problem — the run fails truthfully rather than paying for
     * another round of the same conversation. (The segment ceiling would bound
     * it eventually; "eventually" is several paid dispatches away.)
     */
    const refusalCanReplan = !requeue
      && juliusFailureIsContentRefusal(outcome.failureClass)
      && claim.role !== 'INDEPENDENT_REVIEWER'
      && await (async (): Promise<boolean> => {
        const rows = await deps.store.tasksForRun(run.runId, run.projectId);
        const unit = juliusSegmentLineageRootOf(task, rows).taskId;
        const replayed = rows.some((row) => row.state === 'SKIPPED'
          && juliusSegmentLineageRootOf(row, rows).taskId === unit);
        if (replayed) {
          await ledger.event('checkpoint.verdict', {
            taskId: claim.taskId, workerId: JULIUS_COORDINATOR_AUTHOR,
            facts: {
              checkpointId: null, route: 'CONTINUE', reasonCode: 'REFUSAL_ALREADY_REPLANNED',
              failureClass: outcome.failureClass ?? null, unitRootTaskId: unit,
            },
          });
        }
        return !replayed;
      })();
    const replanned = refusalCanReplan
      ? await driveContinuousLifecycle({
        deps, run, ledger, task, request,
        // Julius raised this, so Julius is who the record names: the declining
        // worker is not known here (the coordinator chooses it), and naming the
        // task's own role would claim a worker asked.
        workerId: JULIUS_COORDINATOR_AUTHOR,
        declined: { code: outcome.code, failureClass: outcome.failureClass as string },
      })
      : null;
    const supersededBy = replanned?.continuationTaskId ?? null;
    const finished = await deps.store.finishTask({
      taskId: claim.taskId, owner: deps.owner, leaseGeneration: claim.leaseGeneration,
      state: supersededBy === null ? 'FAILED' : 'SKIPPED', now: deps.clock.now(),
      ...(requeue ? { nextAttemptAt: deps.clock.now() } : {}),
    });
    if (supersededBy !== null && finished) {
      // ANNOUNCE FACTS: the row follows the durable state change, and says both
      // what was declined and where the work went.
      await ledger.event('task.superseded', {
        taskId: claim.taskId, workerId: JULIUS_COORDINATOR_AUTHOR,
        facts: {
          reasonCode: 'PROVIDER_DECLINED_REQUEST',
          code: outcome.code, failureClass: outcome.failureClass ?? null,
          guidanceTaskId: replanned?.guidanceTaskId ?? null, continuationTaskId: supersededBy,
        },
      });
    }
    const requeued = requeue && finished;
    await ledger.trajectory(requeued ? 'RETRY' : 'DISPATCH', {
      taskId: claim.taskId, contextId, policyRevision: request.policy.revision, outcome: outcome.code,
      /**
       * A FAILED ATTEMPT THAT BILLED IS STILL SPEND, AND THE EVAL LAYER READS
       * THIS ROW.
       *
       * The boundary's own diagnostics already reach `task.failed` — flattened
       * and `diag_`-prefixed — so the money was durable but in a different place
       * under a different name. `summariseJuliusEvals` reads `usdMicros` off
       * trajectory rows, so a mission that spent on an attempt and then failed
       * reported only its SUCCESSFUL spend: a total that looks complete and is
       * biased low, which is worse than one that says it is a floor.
       *
       * Absent stays null. A boundary that reported nothing is unknown, and a
       * dispatch refused before any provider was reached has nothing to report.
       */
      ...diagnosedMeasurement(outcome.diagnostics),
      facts: { failureClass: outcome.failureClass ?? null, ...bindingFacts(preflight.contractBinding) },
    });
    if (requeued) return { kind: 'RETRY', taskId: claim.taskId, code: outcome.code, failureClass: outcome.failureClass ?? null };
    if (outcome.status === 'DENIED') return { kind: 'DENIED', taskId: claim.taskId, reasonCode: outcome.code };
    if (supersededBy !== null && finished) {
      return {
        kind: 'SUPERSEDED', taskId: claim.taskId, code: outcome.code,
        failureClass: outcome.failureClass as string,
        guidanceTaskId: replanned!.guidanceTaskId, continuationTaskId: supersededBy,
      };
    }
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
    /**
     * THE FOUR MEASUREMENT COLUMNS, FILLED AT LAST. They have been on
     * `JuliusTrajectoryEvent` since it was written and were null on every
     * successful dispatch, so every eval derived from the trajectory — cost,
     * cost completeness, average duration — was structurally empty rather than
     * merely unreported. Absent stays null: an unreported cost must not become a
     * zero, and `measured` is undefined only where no provider answered.
     */
    ...(outcome.measured === undefined ? {} : {
      providerId: outcome.measured.providerId,
      usdMicros: outcome.measured.usdMicros,
      inputTokens: outcome.measured.inputTokens,
      outputTokens: outcome.measured.outputTokens,
      durationMs: outcome.measured.durationMs,
    }),
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

  /* ------------------------------------------- 3b1. a channel this role has no right to */
  /**
   * REFUSED ON THE RECORD, NOT DROPPED IN SILENCE.
   *
   * Each role gate below already applies its channel for its own role only.
   * What none of them did was say when another role sent one: a Coding Agent
   * returning a verdict about its own work, or a design, left no trace, and a
   * refusal nobody records reads exactly like a channel nobody used. The gates
   * are unchanged — this names what they ignore.
   */
  if (!outcome.duplicate) {
    for (const channel of ['reviewVerdict', 'rebuttal', 'architecture', 'consistency', 'implementation', 'architectureObservations'] as const) {
      if (outcome[channel] === undefined || juliusResultChannelPermitted(task.role, channel)) continue;
      await ledger.event('worker.channel.refused', {
        taskId: task.taskId, workerId: outcome.workerId,
        facts: { channel, role: task.role, taskType: task.taskType, reasonCode: 'channel_not_permitted_for_role' },
      });
    }
  }

  /* ------------------------------------------- 3b1b. what the Coding Agent did to the workspace */
  if (!outcome.duplicate && juliusResultChannelPermitted(task.role, 'implementation') && outcome.implementation !== undefined) {
    await recordCodingAgentImplementation({
      deps, run, ledger, task, workerId: outcome.workerId, value: outcome.implementation,
      leaseGeneration: claim.leaseGeneration, attempt: claim.attempt,
      scope: contractCharge === null ? null : { permittedPaths: contractCharge.permittedPaths, outOfScope: contractCharge.outOfScope },
    });
  }

  /* ------------------------------------------- 3b1c. what the implementation peer saw the design do */
  if (!outcome.duplicate && juliusResultChannelPermitted(task.role, 'architectureObservations') && outcome.architectureObservations !== undefined) {
    const rows = await readVerdictLedger(deps, run);
    const state = foldJuliusArchitecture(rows);
    const reading = sanitizeJuliusCoderObservations({ value: outcome.architectureObservations, state });
    if (!reading.ok) {
      await ledger.event('architecture.observation.refused', {
        taskId: task.taskId, workerId: outcome.workerId, facts: { reasonCode: reading.reasonCode },
      });
    } else {
      for (const observation of reading.observations) {
        await ledger.event('architecture.observed', {
          taskId: task.taskId, workerId: outcome.workerId,
          facts: juliusCoderObservationFacts({ observation, revision: state!.revision, observedByRole: task.role }),
        });
      }
    }
  }

  /* ------------------------------------------- 3b2. the architecture the architect holds */
  if (!outcome.duplicate && task.role === 'PROMPT_ARCHITECT' && outcome.architecture !== undefined) {
    await recordArchitecture({ deps, run, ledger, task, workerId: outcome.workerId, value: outcome.architecture });
  }

  /* ------------------------------------------- 3b3. does the built thing match the design */
  if (!outcome.duplicate && task.role === 'PROMPT_ARCHITECT' && outcome.consistency !== undefined) {
    await recordConsistency({ deps, run, ledger, task, workerId: outcome.workerId, value: outcome.consistency });
  }

  /* ------------------------------------------- 3c. what the architect answered */
  if (!outcome.duplicate && task.role === 'PROMPT_ARCHITECT' && task.taskType === 'rebuttal') {
    await recordRebuttal({ deps, run, ledger, task, workerId: outcome.workerId, value: outcome.rebuttal });
  }

  /* ------------------------------------------- 3d. what the reviewer concluded */
  if (!outcome.duplicate && task.role === 'INDEPENDENT_REVIEWER' && outcome.reviewVerdict !== undefined) {
    await recordReviewVerdictDeclaration({ ledger, task, workerId: outcome.workerId, value: outcome.reviewVerdict });
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
/**
 * WHAT A GUIDANCE BARRIER LEFT BEHIND, for a caller that has to act on it.
 *
 * `null` means no guidance was raised at all — no request, a refused
 * checkpoint, a route that was not guidance, an unroutable architect, a ceiling
 * reached. The pair means the ask exists; `continuationTaskId` is null when the
 * route was not a barrier, which is a different fact from a barrier that could
 * not mint one.
 */
interface JuliusGuidanceBarrier {
  readonly guidanceTaskId: string;
  readonly continuationTaskId: string | null;
}

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
  /**
   * JULIUS RAISED THIS ASK ITSELF, because a provider declined the request.
   * No worker asked, so nothing here may claim one did: the checkpoint is
   * `PROVIDER_DECLINED_REQUEST` with origin `JULIUS`, and the ask the architect
   * reads is Julius's own sentence naming the refusal's class.
   */
  readonly declined?: { readonly code: string; readonly failureClass: string };
}): Promise<JuliusGuidanceBarrier | null> {
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
      return null;
    }
  }

  // A WORKER ASKED, OR JULIUS DID. Nothing else reaches the guidance path.
  if (input.guidanceRequest === undefined && input.declined === undefined) return null;

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
  const declined = input.declined;
  /**
   * WHO RAISED THIS, AND WHO WROTE THE ASK. A worker's request is the worker's,
   * recorded under its own role; a refusal is JULIUS's observation, and the ask
   * Julius writes is authored by Julius — see `JULIUS_COORDINATOR_AUTHOR`.
   */
  const askAuthorWorkerId = declined === undefined ? input.workerId : JULIUS_COORDINATOR_AUTHOR;
  const recorded = recordJuliusCheckpoint({
    checkpointId: juliusCheckpointId(subjectTaskId, sequence),
    runId: run.runId,
    taskId: subjectTaskId,
    sequence,
    trigger: declined === undefined ? 'GUIDANCE_REQUESTED' : 'PROVIDER_DECLINED_REQUEST',
    origin: declined === undefined ? originForRole(task.role) : 'JULIUS',
    binding,
    evidenceIds: [],
    // The worker's own bounded words about what it is stuck on, or Julius's
    // sentence when the request arrived unusable. Never the provider's body.
    safeSummary: declined !== undefined
      ? `A provider declined this request (${declined.failureClass}); the ask itself has to change.`
      : request?.question ?? 'A worker asked for guidance and its request could not be read.',
    recordedAt: deps.clock.now(),
  });
  if (recorded.outcome === 'REFUSED') {
    await ledger.event('guidance.refused', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: { reasonCode: recorded.reasonCode, stage: 'checkpoint' },
    });
    return null;
  }

  const checkpoint = recorded.checkpoint;
  await ledger.event('checkpoint.recorded', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, trigger: checkpoint.trigger, origin: checkpoint.origin,
      sequence: checkpoint.sequence, evidenceCount: checkpoint.evidenceIds.length,
      contractRevision: binding?.contractRevision ?? null,
      contractBindingDigest: binding?.bindingDigest ?? null,
      /**
       * WHETHER THE QUESTION COULD BE READ, and why not. An unreadable request
       * still reaches the architect — told plainly that it could not be read —
       * but the record used to say nothing about it, so a paid guidance dispatch
       * answering an unreadable question was indistinguishable from one
       * answering a real one.
       */
      requestReadable: request !== null,
      requestReasonCode: request === null ? 'guidance_request_unreadable' : null,
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
    return null;
  }

  /**
   * THE QUESTION IS A PEER REQUEST, AND THE CHANNEL DECIDES WHO MAY ASK IT.
   *
   * A guidance question runs Coding Agent → Prompt Architect and nowhere else.
   * Before the channel, any slot's `guidanceRequest` minted a guidance task once
   * the contract locked: a reviewer could put a question straight to the
   * architect it is meant to judge independently — the side channel the peer
   * protocol exists to close — and the architect's own guidance task could ask
   * the architect. The direction is checked BEFORE the guidance task exists, so
   * a refused question mints nothing, and the refusal is written as
   * `peer.request.refused` rather than dropped.
   */
  const peers = peerContextFor(deps, run, ledger);
  const guidanceTaskId = juliusGuidanceTaskId(subjectTaskId, sequence);
  const question = {
    kind: 'GUIDANCE_QUESTION',
    anchor: guidanceTaskId,
    sourceRole: juliusPeerPartyForRole(task.role) ?? String(task.role),
    targetRole: 'PROMPT_ARCHITECT',
    reason: declined === undefined
      ? 'A worker paused its unit of work and asked the Prompt Architect for guidance.'
      : 'A provider declined this request on content grounds; Julius asked the Prompt Architect to restate the work.',
    subjectTaskId,
    carrierTaskId: guidanceTaskId,
    contextRefs: [`brain:guidance-request:${guidanceTaskId}`],
    checkpointId: checkpoint.checkpointId,
    contractBindingDigest: binding?.bindingDigest ?? null,
    workerId: input.workerId,
  } as const;
  const permitted = await openJuliusPeerRequestOnLedger(peers, { ...question, mandatory: true, announce: false });
  if (permitted.outcome === 'REFUSED') {
    await openJuliusPeerRequestOnLedger(peers, { ...question, mandatory: true, announce: true });
    await ledger.event('checkpoint.verdict', {
      taskId: subjectTaskId, workerId: input.workerId,
      facts: {
        checkpointId: checkpoint.checkpointId, route: 'CONTINUE', reasonCode: 'GUIDANCE_DIRECTION_REFUSED',
        wouldHaveRouted: routing.route, peerRefusal: permitted.reasonCode,
      },
    });
    return null;
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
      return null;
    }
  }

  /**
   * THE CEILING, BEFORE ANYTHING IS BOUGHT.
   *
   * The guidance task used to be minted first and the segment ceiling checked
   * after — so a question asked past the ceiling still bought an architect
   * dispatch and its review, for an answer no continuation would ever wait for.
   * A pause that cannot continue is refused here, and nothing is created.
   */
  if (routeIsBarrier(routing.route)) {
    const unitRoot = juliusSegmentLineageRootOf(task, tasks);
    const nextSegment = nextSegmentNumber(unitRoot, tasks);
    const ceiling = input.request.verification.maxCoderSegments ?? JULIUS_DEFAULT_MAX_CODER_SEGMENTS;
    if (nextSegment > ceiling) {
      await ledger.event('checkpoint.verdict', {
        taskId: subjectTaskId, workerId: input.workerId,
        facts: {
          checkpointId: checkpoint.checkpointId, route: routing.route,
          reasonCode: 'SEGMENT_CEILING_REACHED', guidanceTaskId: null, created: false,
          continuationTaskId: null, barrier: true, segment: nextSegment, ceiling,
        },
      });
      return null;
    }
  }

  const guidanceTask: JuliusTask = {
    taskId: guidanceTaskId,
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
    const askText = declined !== undefined
      ? [
        'JULIUS RAISED THIS ASK. No worker asked for guidance: the provider DECLINED this request itself.',
        `REFUSAL CLASS: ${declined.failureClass} (carried as ${declined.code})`,
        'WHAT THIS MEANS: the work as currently specified will not be served — by this provider, and on the same wording probably by another.',
        'WHAT IS NEEDED: restate this unit of work so that it can be served WITHIN the locked contract. Do not widen the scope, do not weaken an acceptance criterion, and do not propose anything the contract forbids. If the work cannot be restated within those terms, say so plainly: Julius will fail the mission truthfully rather than pretend.',
      ].join('\n')
      : request === null
      ? 'A worker asked for guidance and its request could not be read. No question, blocking condition, attempt or path is available.'
      : [
        `QUESTION: ${request.question}`,
        `BLOCKED ON: ${request.blockedOn.join(' | ') || '(none stated)'}`,
        `ALREADY ATTEMPTED: ${request.attempted.join(' | ') || '(none stated)'}`,
        `RELEVANT PATHS: ${request.relevantPaths.join(' | ') || '(none stated)'}`,
      ].join('\n');
    await appendBrainEntryAdmitting(deps, {
      runId: run.runId,
      projectId: run.projectId,
      taskId: guidanceTask.taskId,
      workerId: askAuthorWorkerId,
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
  /**
   * THE QUESTION GOES ON THE RECORD WITH THE WORK IT PAUSES, and only when this
   * tick minted its carrier — `addTask` is idempotent by command id, so a replay
   * opens nothing twice. Mandatory exactly when a continuation waits on the
   * answer; the pause itself is that continuation's dependency edge.
   */
  const announceQuestion = async (pausedTaskId: string | null): Promise<void> => {
    if (!created) return;
    await openJuliusPeerRequestOnLedger(peers, {
      ...question,
      mandatory: pausedTaskId !== null,
      pausedTaskIds: pausedTaskId === null ? [] : [pausedTaskId],
      announce: true,
    });
  };
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
      await carryAcceptedGuidanceForward({
        deps, run, ledger, lineage: [segmentRoot, ...segmentChildrenOf(segmentRoot, tasks)],
        continuationTaskId: continuation.taskId, workerId: input.workerId,
      });
      await appendBrainEntryAdmitting(deps, {
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

  await announceQuestion(continuationTaskId);
  await ledger.event('checkpoint.verdict', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, route: routing.route, reasonCode: routing.reasonCode,
      guidanceTaskId: guidanceTask.taskId, created,
      // Null when the route was not a barrier, which is a different fact from
      // a barrier that failed to mint one.
      continuationTaskId, barrier: routeIsBarrier(routing.route),
      // WHO RAISED IT, on the row that explains what happened next.
      raisedBy: declined === undefined ? 'WORKER' : 'JULIUS',
      declinedFailureClass: declined?.failureClass ?? null,
    },
  });
  return created ? { guidanceTaskId: guidanceTask.taskId, continuationTaskId } : null;
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
  const continuationTaskId = juliusSegmentTaskId(segmentRoot.taskId, segmentNumber);
  const handoffEntryId = `brain:research-answer:${continuationTaskId}`;
  const provenanceEntryId = `brain:research-served:${continuationTaskId}`;
  const count = (value: unknown): number | null =>
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
  const served = observations.filter((observation) => observation.delivery !== null && observation.delivery !== undefined);
  for (const [index, observation] of observations.entries()) {
    const delivery = observation.delivery ?? null;
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
        reasonCode: observation.refusal ?? null,
        reachRefusal: observation.reachRefusal ?? null,
        requestedSource: observation.requested?.source ?? null,
        requestedCapability: observation.requested?.capability ?? null,
        requestedHost: observation.requested?.host ?? null,
        /* THE BYTES CHARGED, AND THAT THEY WERE RECORDED. The research ledger is
           rebuilt from these rows. Paid qualification attempt 4 (run
           34774471909) wrote rows with no byte count, so every past read came
           back unsized and a byte-budgeted mission refused all ten asks after
           its first. `bytesRecorded` separates "this row says nothing was
           measured" (null) from a row written before the count existed, which a
           reader must treat as unknown historical spend, never as zero. */
        bytes: typeof observation.bytes === 'number' && Number.isSafeInteger(observation.bytes) && observation.bytes >= 0
          ? observation.bytes
          : null,
        bytesRecorded: true,
        askOrdinal: index,
        resourcePath: observation.requested?.path ?? null,
        mechanism: delivery?.mechanism ?? null,
        contentDigest: delivery?.contentDigest ?? null,
        readableChars: count(delivery?.readableChars),
        deliveredFrom: count(delivery?.deliveredFrom),
        deliveredChars: count(delivery?.deliveredChars),
        deliveryCut: delivery === null ? null : delivery.cut,
        deliveryAnchor: delivery?.anchor ?? null,
        handoffTaskId: continuationTaskId,
        handoffEntryId,
        /* WHICH PAGE, WHAT CAME BACK, AND WHERE IT WENT. Qualification attempt 4
           (run 34774471909) served one page and its row could not say which page
           of the host it was, how much of it existed, or whether any of it reached
           the worker — none had: the text was dropped before the packet. The path
           (no query, no fragment, token-shaped segments scrubbed), the backend
           that answered, the digest of the body Relay kept, how many readable
           characters it held and which were handed over, the section a cut
           started at, and the continuation and Brain entry the answer rides. Null
           where nothing was retrieved. No page text is ever on this row. */
        /* THE LAST FIVE: WHY, AND AT WHAT. Paid run 34757974058 wrote four
           refusals with an empty reason and no target, so a worker asking for
           a host the mission never granted and Relay refusing one it had were
           the same empty row. Relay's own refusal code, Live Reach's when it
           ran, and the ask's source, capability and HOST NAME ONLY — never the
           path, query or purpose, which are the worker's own text. Null where
           the port did not say: unknown, never a guessed reason. */
      },
    });
  }

  const continuation: JuliusTask = {
    taskId: continuationTaskId,
    missionId: task.missionId,
    parentTaskId: segmentRoot.taskId,
    /**
     * CREATED RUNNABLE, BECAUSE NOTHING IS LEFT TO WAIT FOR. The research was
     * served above, before this task could exist, so the only thing the
     * continuation depended on — the subject having yielded, SUCCEEDED — is
     * already true when Julius creates it, exactly as a review or a repair is.
     *
     * It used to wait BLOCKED on the subject's ACCEPTANCE, which meant the
     * yielded dispatch had to be reviewed before its own continuation could run.
     * A dispatch that stopped to ask is unfinished by its own account, so its
     * review asked for repair every time: qualification attempt 3 (run
     * 34766115321) left all five research continuations BLOCKED behind repairs
     * of the half-done work they were supposed to finish. A yielded dispatch is
     * no longer reviewed (`verifyExecutedTask`); this segment is, when it ends.
     *
     * The edge stays recorded as the dependency it is, and the claim query's
     * second gate still requires it SUCCEEDED. The answer is written to the
     * Project Brain in the next statement; a second runtime claiming this row
     * between the two writes would compile its context without it, and the live
     * path runs one loop per run, which is the condition that makes that
     * window empty.
     */
    dependencyIds: [subjectTaskId],
    requiredEvidenceTypes: task.requiredEvidenceTypes,
    taskType: task.taskType,
    role: task.role,
    ordinal: task.ordinal + 2,
    state: 'RUNNABLE',
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
    await appendBrainEntryAdmitting(deps, {
      runId: run.runId,
      projectId: run.projectId,
      taskId: continuation.taskId,
      workerId: input.workerId,
      entryId: handoffEntryId,
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

    /**
     * THE TRAIL A REVIEWER CAN CHECK A CITATION AGAINST.
     *
     * The answer above reaches only the continuation that asked. A reviewer
     * later told "the source is the psql reference" had nothing to hold that
     * against: attempt 4's reviewer could only observe that no WHERE was
     * recorded. This entry is Julius's own record of each page it served —
     * slot, host and path, bytes, digest, what was handed over and to which
     * task — run-wide, so every later packet, the reviewer's included, carries
     * it. It holds no page text and no worker text, and it is written under the
     * same guard as the answer, so a replayed tick adds nothing.
     */
    await carryAcceptedGuidanceForward({
      deps, run, ledger, lineage: [segmentRoot, ...segmentChildrenOf(segmentRoot, tasks)],
      continuationTaskId: continuation.taskId, workerId: input.workerId,
    });

    if (served.length > 0) {
      await appendBrainEntryAdmitting(deps, {
        runId: run.runId,
        projectId: run.projectId,
        taskId: null,
        workerId: input.workerId,
        entryId: provenanceEntryId,
        kind: 'EVIDENCE',
        safeText: served.map((observation) => juliusResearchServedLine({
          role: task.role,
          checkpointId: checkpoint.checkpointId,
          continuationTaskId,
          observation,
        })).join('\n'),
        evidenceIds: served.flatMap((observation) => (observation.evidenceId === null ? [] : [observation.evidenceId])),
        occurredAt: deps.clock.now(),
      });
    }
  }

  await ledger.event('checkpoint.verdict', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      checkpointId: checkpoint.checkpointId, route: routing.route, reasonCode: routing.reasonCode,
      continuationTaskId: created ? continuation.taskId : null,
      handoffEntryId: created ? handoffEntryId : null,
      provenanceEntryId: created && served.length > 0 ? provenanceEntryId : null,
      deliveredChars: served.reduce((total, observation) => total + (count(observation.delivery?.deliveredChars) ?? 0), 0),
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

  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);

  /**
   * THE QUESTION THIS ANSWERS IS THE UNIT'S, NOT THE DISPATCH'S.
   *
   * Two tasks write guidance without the `guidance:<subject>:<n>:task` id: the
   * REPAIR of a packet Julius rejected, and the CONTINUATION of an architect that
   * paused its answer to have something read. Both were refused
   * `guidance_from_a_non_guidance_task` — reproduced on main ad03df90 — so
   * corrected advice and researched advice could never be issued, and the
   * coder's continuation was released onto whatever it had been handed first.
   * The question is the guidance task every repair and every segment of this
   * work descends from, found by walking both lineages.
   */
  const questionTask = juliusWorkUnitRootOf(task, tasks);
  const subjectTaskId = guidanceSubjectTaskId(questionTask.taskId);
  if (subjectTaskId === null) return refuse('guidance_from_a_non_guidance_task');
  const sequence = Number(/:([1-9]\d*):task$/u.exec(questionTask.taskId)![1]);

  /**
   * A PEER PROPOSES; IT DOES NOT DECIDE. Refused by name, at any depth and in
   * any spelling, before the allowlist rebuild below — which already drops
   * contract fields at the top level, but under one reason that cannot say
   * whether the packet was malformed or reached for Julius's authority.
   */
  const guarded = guardJuliusPeerResponse(input.guidance);
  if (!guarded.ok) return refuse(guarded.reasonCode);

  const proposal = sanitizeJuliusGuidanceProposal(input.guidance);
  if (proposal === null) return refuse('guidance_shape_refused');

  const contractTaskId = juliusContractSubjectTaskId(task, tasks);
  const contract = contractTaskId === null
    ? null
    : await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
  if (contract === null) return refuse('contract_absent');
  const binding = juliusTaskContractBinding(contract);
  // GUIDANCE EXISTS ONLY UNDER AN AGREEMENT. Before LOCK the architect holds the
  // plan task and speaks through it; after SUPERSESSION there is no agreement
  // left to advise under.
  if (binding === null) return refuse('contract_not_locked');

  /**
   * MONOTONIC PER SUBJECT, counted from the packets already issued for it. The
   * question's own number was the revision while one question had one answer;
   * a corrected answer to the same question would have reused it, and its
   * handoff — keyed by revision — would have been dropped as a duplicate of the
   * advice it corrects. Without a readable ledger there is nothing to count, and
   * the question's number is the honest fallback.
   */
  const ledgerRows = await readJuliusPeerLedger(deps.timeline, run);
  const revision = ledgerRows === null
    ? sequence
    : ledgerRows.filter((row) => row.type === 'guidance.issued' && row.taskId === subjectTaskId).length + 1;
  const issued = issueJuliusGuidance({
    guidanceId: juliusGuidanceId(subjectTaskId, revision),
    runId: run.runId,
    taskId: subjectTaskId,
    binding,
    revision,
    triggeringCheckpointId: juliusCheckpointId(subjectTaskId, sequence),
    proposal,
    contractCriterionIds: contract.blockingAcceptanceCriteria.map((criterion) => criterion.criterionId),
    issuedByWorkerId: input.workerId,
    issuedAt: deps.clock.now(),
  });
  if (issued.outcome === 'REFUSED') return refuse(issued.reasonCode);

  const packet = issued.packet;

  /**
   * THE ADVICE REACHES THE WORKER IT WAS WRITTEN FOR.
   *
   * IT DID NOT, BEFORE THIS. The packet was stored as an artifact whose only
   * consumer is the Independent Reviewer — so a mission bought an architect
   * dispatch, bought a review of its output, and handed the Coding Agent that
   * asked the question nothing but `brain:segment-resume`, which is what the
   * coder itself said before it paused. The comment that used to sit here said
   * the text "travels to the coder the way the plan does"; the plan has a
   * reader and this did not.
   *
   * ON THE CONTINUATION'S OWN CHANNEL, exactly as a research answer travels:
   * one Project Brain, one redaction path, one provenance record, and no prose
   * side channel. The dispatch that asked has ended, so the continuation is the
   * only place an answer can appear.
   *
   * UNDELIVERED SAYS SO. Where no segment is waiting — nothing paused on this
   * subject, or a shape with two waiting segments that nobody has built —
   * `deliveredTo` is null on the row below rather than absent, so guidance that
   * reached no one is legible as that instead of as guidance that was read.
   */
  /**
   * A PACKET NOBODY HAS ACCEPTED IS NOT ADVICE YET.
   *
   * IT USED TO BE. The packet was written straight onto the waiting
   * continuation, so a coder released later read it as instruction whatever the
   * reviewer went on to say — and when the review sent it back, the rejected
   * packet stayed in that context and the correction arrived beside it. Two
   * packets, equally actionable, the wrong one first.
   *
   * So the proposal is stored against the ARCHITECT'S OWN TASK, under a heading
   * that says it is not authoritative. `deliverAcceptedGuidance` copies it to the
   * continuation when Julius accepts the review, and never otherwise. The
   * continuation cannot run before that decision — it is BLOCKED on this task and
   * only an accepting decision releases it — so nothing waits longer for the
   * change, and a rejected packet reaches no one.
   *
   * Rejected guidance is NOT erased: this row, the `guidance.issued` row and the
   * review's own decision stay on the record as provenance.
   */
  await appendBrainEntryAdmitting(deps, {
    runId: run.runId,
    projectId: run.projectId,
    taskId: task.taskId,
    workerId: input.workerId,
    entryId: juliusGuidanceProposalEntryId(task.taskId),
    kind: 'HANDOFF',
    safeText: `${JULIUS_GUIDANCE_PROPOSED_HEADING}\n\n${renderJuliusGuidanceHandoff(packet)}`,
    evidenceIds: [],
    occurredAt: deps.clock.now(),
  });
  const waiting = pendingSegmentFor(questionTask.taskId, tasks);

  // COUNTS AND IDENTIFIERS, never the advice itself. The advice is on the
  // Project Brain above, where the context compiler redacts it and the packet
  // records what was handed over; the ledger records that it existed, under
  // which agreement, how much of it there was, and who it reached.
  await ledger.event('guidance.issued', {
    taskId: subjectTaskId, workerId: input.workerId,
    facts: {
      guidanceId: packet.guidanceId, guidanceRevision: packet.revision,
      guidanceDigest: packet.packetDigest,
      /* WHO IT WILL REACH IF JULIUS ACCEPTS IT, or null when nothing is waiting.
         Delivery itself is `guidance.delivered`, written only on acceptance:
         "issued" and "authoritative" are different facts and used to be one. */
      proposedTo: waiting === null ? null : waiting.taskId,
      proposalEntryId: juliusGuidanceProposalEntryId(task.taskId),
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

  // THE QUESTION HAS AN ANSWER — not yet an accepted one. Julius's decision on
  // the guidance review resolves it or reopens it.
  await moveJuliusPeerRequest(peerContextFor(deps, run, ledger), {
    kind: 'GUIDANCE_QUESTION', anchor: questionTask.taskId, to: 'ANSWERED', from: ['OPEN'],
    responseRef: packet.guidanceId, causeRef: packet.guidanceId, taskId: subjectTaskId, workerId: input.workerId, firstWrite: true,
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
  handed: { readonly brainRetrievals: number; readonly evidenceInspected: number; readonly guidanceConsumed: number } | null,
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
      /**
       * WHAT A DISPATCH WITH NO BILL CONSUMED OF THE MISSION'S EXECUTION BUDGET.
       *
       * A subscription-backed Coding Agent is charged nothing per request, so its
       * `usdMicros` stays null and its basis says `NOT_APPLICABLE`. The runtime still
       * PRICES the work, and that figure is what the slot ledger charges, so a
       * later round is granted exactly what it would be granted in API mode. Only
       * ever beside `NOT_APPLICABLE`, and never folded into `usdMicros` or passed
       * to the budget store, whose committed amount a reader may take for spend.
       */
      const executionUsdMicros = component.basis === 'NOT_APPLICABLE' ? maybe('executionUsdMicros') : null;
      /**
       * HOW IT WAS PAID FOR, as the adapter that resolved the credential said —
       * and only when that agrees with the basis. Absent when no adapter said, so
       * a reader falls back to the basis rather than to a guess.
       */
      const billingPath = consistentJuliusBillingPath(usage.billingPath, component.basis);
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
          ...(component.basis === 'NOT_APPLICABLE' ? { executionUsdMicros } : {}),
          ...(billingPath === null ? {} : { billingPath }),
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
          guidanceConsumed: handed === null ? null : handed.guidanceConsumed,
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
    release: async ({ claim, reservationId, reason, usdMicros, spendUnknown, costBasis, executionUsdMicros, billingPath }) => {
      await deps.budget.release({ reservationId, reason, now: deps.clock.now(), usdMicros: usdMicros ?? null, spendUnknown });
      /**
       * NO BILL IS NOT NO CONSUMPTION. A subscription-backed attempt that the
       * runtime priced has used the mission's execution budget even though nobody
       * was charged, so its hold is kept exactly as a billed one's would be.
       */
      const notApplicable = costBasis === 'NOT_APPLICABLE';
      const execution = notApplicable && typeof executionUsdMicros === 'number'
        && Number.isFinite(executionUsdMicros) && executionUsdMicros >= 0 ? executionUsdMicros : null;
      // A failed attempt that billed before it failed is a settlement, not a
      // hand-back, and the record has to be able to say so.
      const billed = (typeof usdMicros === 'number' && usdMicros > 0) || spendUnknown === true
        || (execution !== null && execution > 0);
      const rowBasis = notApplicable ? 'NOT_APPLICABLE' : typeof usdMicros === 'number' ? 'PROVIDER_REPORTED' : 'UNKNOWN';
      // As the provider decided it from its credential, and only when it agrees with the basis.
      const path = consistentJuliusBillingPath(billingPath, rowBasis);
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
          // name is UNKNOWN, which is why the hold is not released. One that
          // could not be billed at all — a subscription-backed dispatch — says
          // NOT_APPLICABLE, and carries what the runtime priced it at instead.
          costBasis: rowBasis,
          estimatedUsdMicros: null,
          ...(notApplicable ? { executionUsdMicros: execution } : {}),
          ...(path === null ? {} : { billingPath: path }),
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
    acceptResult: async ({ claim, worker, result, idempotencyKey, evidence }) => {
      const receipt = await deps.store.acceptWorkerResult({
        resultId: deps.ids.next('result'), idempotencyKey,
        runId: claim.runId, projectId: claim.projectId, taskId: claim.taskId,
        leaseGeneration: claim.leaseGeneration, workerId: worker.workerId,
        status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        safeSummary: result.safeSummary,
        /* WHAT THIS RESULT CITED, which is known here and was written as `[]`
           on every attempt — including the ones that had just persisted
           evidence a line earlier. An empty list is a claim, and it was false.
           `providerReceiptIds` stays empty because it is TRUE: no provider
           receipt is minted anywhere in this runtime yet. */
        evidenceIds: evidence.map((item) => item.evidenceId),
        providerReceiptIds: [], occurredAt: deps.clock.now(),
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
      .filter((task) => task.role === 'INDEPENDENT_REVIEWER'
        && (task.state === 'BLOCKED' || task.state === 'RUNNABLE' || task.state === 'ACTIVE'))
      // A researching review is still a pending review of the same work.
      .map((task) => juliusReviewedWorkOf(task, tasks)?.taskId ?? null)
      .filter((taskId): taskId is string => taskId !== null),
  );
  const stranded = tasks.filter((task) => task.state === 'SUCCEEDED'
    && !decided.has(task.taskId)
    /* A REVIEW IS DECIDED WHEN THE WORK IT REVIEWED IS. Decisions are keyed on
       the work, so a concluded review never appears in `decided` by its own id,
       and every idle `advanceRun` re-verified every review the run had ever
       concluded: on main ad03df90 a two-review mission that had COMPLETED wrote
       18 `verification.decided` rows across nine idle calls, resuming both
       reviews each time. The crash window this sweep exists for — a review
       accepted with no decision written — still resumes, because then the work
       is undecided. */
    && !(task.role === 'INDEPENDENT_REVIEWER' && decided.has(juliusReviewedWorkOf(task, tasks)?.taskId ?? ''))
    && !pendingReviewSubjects.has(task.taskId)
    // A yielded dispatch is undecided on purpose, not stranded: its continuation
    // carries the verification it would otherwise be missing.
    && juliusYieldContinuationOf(task, tasks) === null);
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

/**
 * WHAT THE REVIEWER SAID, ON THE RECORD BEFORE ANYTHING ACTS ON IT.
 *
 * Written from the dispatch that produced it and read back by verification,
 * so a resumed verification applies the same declaration. A declaration Julius
 * will not read is refused by name and the review is judged on its evidence
 * alone: a reviewer that wrote VERIFIED buys nothing with the word.
 */
async function recordReviewVerdictDeclaration(input: {
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
  readonly value: unknown;
}): Promise<void> {
  const reading = sanitizeJuliusReviewVerdict(input.value);
  if (!reading.ok) {
    await input.ledger.event('review.verdict.refused', {
      taskId: input.task.taskId, workerId: input.workerId, facts: { reviewTaskId: input.task.taskId, reasonCode: reading.reasonCode },
    });
    return;
  }
  await input.ledger.event('review.verdict.declared', {
    taskId: input.task.taskId, workerId: input.workerId,
    facts: { reviewTaskId: input.task.taskId, ...juliusReviewVerdictFacts(reading.declaration) },
  });
}

interface AppliedReviewVerdict {
  readonly verdict: string | null;
  readonly route: JuliusReviewRoute | 'RE_REVIEW';
  readonly category: string | null;
}

/**
 * Every row the verdict, the channel, the disagreement and the finding
 * projections read, or none when no timeline is bound.
 *
 * `finding.` belongs here and was missing: without it every finding folded as
 * OPEN however many times it had been addressed, so a repair re-addressed it on
 * every round and a reviewer answering "still open" was refused as a repeat.
 */
async function readVerdictLedger(deps: JuliusPipelineDependencies, run: JuliusRunRow): Promise<readonly JuliusPeerLedgerEntry[]> {
  if (deps.timeline === undefined) return [];
  const rows: JuliusPeerLedgerEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await deps.timeline.timeline({ runId: run.runId, projectId: run.projectId, sinceSequence, limit: 500 });
    for (const entry of page.entries) {
      sinceSequence = Math.max(sinceSequence, entry.sequence);
      if (entry.type.startsWith('review.verdict.') || entry.type.startsWith('peer.')
        || entry.type.startsWith('disagreement.') || entry.type.startsWith('finding.')
        || entry.type.startsWith('architecture.')) {
        rows.push({ type: entry.type, facts: entry.facts, taskId: entry.taskId });
      }
    }
    if (!page.hasMore || page.entries.length === 0) break;
  }
  return rows;
}

/**
 * APPLY ONE CONCLUDED REVIEW'S VERDICT TO THE WORK IT REVIEWED.
 *
 * Every write is keyed on the review task, so a resumed verification of the
 * same review records nothing twice: findings are idempotent by id, the
 * challenge request is opened only with the verdict's first application, and
 * `review.verdict.applied` is written once per review.
 */
async function applyReviewVerdict(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly review: JuliusTask;
  readonly reviewed: JuliusTask;
  readonly tasks: readonly JuliusTask[];
  readonly evidence: readonly JuliusEvidence[];
  readonly policy: JuliusVerificationPolicy;
  readonly request: JuliusPipelineRequest;
  readonly workerId: string;
}): Promise<AppliedReviewVerdict> {
  const { deps, run, ledger, review, reviewed } = input;
  const rows = await readVerdictLedger(deps, run);
  const declaredRow = [...rows].reverse().find((row) => row.type === 'review.verdict.declared' && row.facts.reviewTaskId === review.taskId);
  const declaration: JuliusReviewVerdictDeclaration | null = declaredRow === undefined ? null : juliusReviewVerdictFromFacts(declaredRow.facts);
  const reviewEvidence = input.evidence.filter((item) => item.taskId === review.taskId);
  const effective = juliusEffectiveReviewVerdict(declaration?.verdict ?? null, juliusEvidenceReviewVerdict(reviewEvidence));
  const fromDeclaration = effective.source === 'DECLARED' || effective.source === 'BOTH';
  const category = fromDeclaration ? declaration?.category ?? null : null;
  const route = juliusReviewRoute({ verdict: effective.verdict, category });
  const citations = reviewEvidence.map((item) => item.evidenceId);
  const firstApplication = !rows.some((row) => row.type === 'review.verdict.applied' && row.facts.reviewTaskId === review.taskId);

  /**
   * THE RE-REVIEW OF A REBUTTAL RECORDS NO FINDING AND OPENS NO CHALLENGE. Its
   * verdict is the disagreement's last word; a challenge raised here would be
   * the second turn the bound exists to refuse.
   */
  if (reviewed.role === 'PROMPT_ARCHITECT' && reviewed.taskType === 'rebuttal') {
    if (firstApplication) {
      await ledger.event('review.verdict.applied', {
        taskId: reviewed.taskId, workerId: input.workerId,
        facts: {
          reviewTaskId: review.taskId, reviewedTaskId: reviewed.taskId, verdict: effective.verdict,
          declared: effective.declared, derived: effective.derived, source: effective.source, category,
          target: null, route: 'RE_REVIEW', warningsRetained: 0, warningsPromoted: 0, challengeRequestId: null,
        },
      });
    }
    return { verdict: effective.verdict, route: 'RE_REVIEW', category };
  }

  const record = async (finding: {
    readonly findingId: string; readonly severity: 'MEDIUM' | 'HIGH' | 'CRITICAL'; readonly category: string;
    readonly claim: string; readonly blocking: boolean;
  }): Promise<void> => {
    // A finding cites the review that raised it; a review with no evidence row
    // cannot be cited, and its declaration stays on the ledger instead.
    if (citations.length === 0) return;
    const recorded = await deps.store.recordFinding({
      projectId: run.projectId,
      finding: {
        ...finding, runId: run.runId, taskId: reviewed.taskId, reviewerWorkerId: input.workerId,
        criterionId: null, evidenceIds: citations, status: 'OPEN', createdAt: deps.clock.now(),
      },
    });
    if (recorded) {
      await ledger.event('finding.recorded', {
        taskId: reviewed.taskId, workerId: input.workerId,
        facts: {
          findingId: finding.findingId, evidenceId: citations[0]!, blocking: finding.blocking,
          category: finding.category, reviewTaskId: review.taskId,
        },
      });
    }
  };

  // WARNINGS ARE RETAINED WHATEVER ELSE THE VERDICT SAYS, and promoted only by
  // Julius's own policy.
  let promoted = 0;
  for (const [index, warning] of (declaration?.warnings ?? []).entries()) {
    const blocking = juliusWarningIsPromoted(warning, input.policy.promotedWarningCategories);
    if (blocking) promoted += 1;
    await record({
      findingId: `finding:warning:${review.taskId}:${String(index)}`, severity: blocking ? 'HIGH' : 'MEDIUM',
      category: warning.category ?? 'review_warning', claim: warning.claim, blocking,
    });
  }
  if (route === 'REPAIR' && fromDeclaration && effective.derived !== 'REPAIR_REQUIRED' && declaration !== null) {
    await record({ findingId: `finding:verdict:${review.taskId}`, severity: 'HIGH', category: declaration.category ?? 'review', claim: declaration.claim, blocking: true });
  }
  if (route === 'HALT' && declaration !== null && fromDeclaration) {
    await record({ findingId: `finding:verdict:${review.taskId}`, severity: 'CRITICAL', category: declaration.category ?? 'review', claim: declaration.claim, blocking: true });
  }

  /**
   * A CHALLENGE IS A REQUEST TO JULIUS, NEVER A REVISION. Against the work it
   * is the reviewer's own CHALLENGE; against the plan, the guidance or the terms
   * it is an EVIDENCE_CHALLENGE about the architect, mediated by Julius. It is
   * mandatory — pausing the work gated on this unit — exactly when material.
   */
  let challengeRequestId: string | null = null;
  if ((route === 'RECORD' || route === 'HOLD') && declaration !== null) {
    await record({
      findingId: `finding:challenge:${review.taskId}`, severity: route === 'HOLD' ? 'HIGH' : 'MEDIUM',
      category: declaration.category ?? 'review', claim: declaration.claim, blocking: false,
    });
    if (firstApplication) {
      const unitRoot = juliusWorkUnitRootOf(reviewed, input.tasks);
      const paused = juliusPeerIdsThatFit(input.tasks
        .filter((row) => row.state === 'BLOCKED' && (row.dependencyIds.includes(reviewed.taskId) || row.dependencyIds.includes(unitRoot.taskId)))
        .map((row) => row.taskId));
      const aboutArchitect = declaration.target !== 'WORK';
      const opened = await openJuliusPeerRequestOnLedger(peerContextFor(deps, run, ledger), {
        kind: aboutArchitect ? 'EVIDENCE_CHALLENGE' : 'CHALLENGE',
        anchor: review.taskId,
        sourceRole: 'INDEPENDENT_REVIEWER', targetRole: 'JULIUS',
        mediatedFor: aboutArchitect ? 'PROMPT_ARCHITECT' : null,
        reason: `The independent reviewer challenges the ${String(declaration.target).toLowerCase()} (${String(declaration.category)}).`,
        subjectTaskId: reviewed.taskId, carrierTaskId: review.taskId,
        contextRefs: [review.taskId], evidenceIds: juliusPeerIdsThatFit(citations).ids,
        mandatory: route === 'HOLD', pausedTaskIds: route === 'HOLD' ? paused.ids : [], pausedTaskCount: route === 'HOLD' ? paused.total : 0,
        announce: true, workerId: input.workerId,
      });
      if (opened.outcome === 'OPENED') {
        challengeRequestId = opened.request.requestId;
        await openDisagreementFor({
          deps, run, ledger, request: input.request, review, reviewed, tasks: input.tasks, evidence: input.evidence,
          declaration, material: route === 'HOLD', challengeRequestId, citations,
          paused: route === 'HOLD' ? paused : { ids: [], total: 0 }, workerId: input.workerId,
        });
      }
    }
  }

  /**
   * WHAT THIS REVIEW SAYS ABOUT THE FINDINGS IT RAISED BEFORE. Applied after the
   * new findings exist, so a supersession can name the one that replaces it.
   */
  const resolutions = firstApplication
    ? await applyFindingResolutions({
      deps, run, ledger, review, reviewed, declaration, tasks: input.tasks,
      findings: await effectiveFindingsOf(deps, run),
      newFindingIds: reviewEvidence.filter((item) => item.type === 'REVIEW_FINDING' && item.status === 'FAILED')
        .map((item) => `finding:${item.evidenceId}`),
      workerId: input.workerId,
    })
    : { applied: 0, refused: 0 };

  if (firstApplication) {
    await ledger.event('review.verdict.applied', {
      taskId: reviewed.taskId, workerId: input.workerId,
      facts: {
        reviewTaskId: review.taskId, reviewedTaskId: reviewed.taskId,
        verdict: effective.verdict, declared: effective.declared, derived: effective.derived, source: effective.source,
        category, target: fromDeclaration ? declaration?.target ?? null : null, route,
        warningsRetained: declaration?.warnings.length ?? 0, warningsPromoted: promoted,
        challengeRequestId,
        findingsResolved: resolutions.applied, findingResolutionsRefused: resolutions.refused,
      },
    });
  }
  return { verdict: effective.verdict, route, category };
}

/**
 * ACCEPTED ADVICE TRAVELS WITH THE UNIT, not with one segment of it.
 *
 * A packet is delivered to the continuation that was waiting for it, and a
 * Project Brain entry reaches the packet of the task it is scoped to and no
 * other. So a unit that pauses AGAIN — to research, or to ask something else —
 * ran its next segment without the advice Julius had accepted for it: the
 * guidance was delivered once and then silently left behind.
 *
 * Every accepted packet already delivered to an earlier segment of this lineage
 * is therefore copied onto each new continuation, under the same authoritative
 * heading and the same revision, guarded by the entry id so a replay copies
 * nothing twice. Rejected packets are not carried: they were never delivered.
 */
async function carryAcceptedGuidanceForward(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly lineage: readonly JuliusTask[];
  readonly continuationTaskId: string;
  readonly workerId: string;
}): Promise<void> {
  const { deps, run } = input;
  const carried = new Set(input.lineage.map((task) => task.taskId));
  const entries = await deps.store.brainEntriesForRun(run.runId, run.projectId);
  for (const entry of entries) {
    if (!isJuliusGuidanceHandoffEntryId(entry.entryId)) continue;
    if (!entry.taskIds.some((taskId) => carried.has(taskId))) continue;
    const revision = /:r([1-9]\d*)$/u.exec(entry.entryId);
    if (revision === null) continue;
    await appendBrainEntryAdmitting(deps, {
      // A copy keeps its author; the tick that copies it is not the one that wrote it.
      runId: run.runId, projectId: run.projectId, taskId: input.continuationTaskId, workerId: entry.provenance?.workerId ?? input.workerId,
      entryId: juliusGuidanceHandoffEntryId(input.continuationTaskId, Number(revision[1])),
      kind: 'HANDOFF', safeText: entry.text, evidenceIds: [], occurredAt: deps.clock.now(),
    });
  }
}

/**
 * HAND AN ACCEPTED PACKET TO THE WORKER THAT ASKED FOR IT.
 *
 * The packet is read back from the proposal row the architect's dispatch wrote,
 * so the text delivered is the text that was reviewed — not a re-render of
 * something that could have changed. It is written under the authoritative
 * heading, scoped to the waiting continuation and to nothing else, and guarded
 * by the brain entry's own id: a replayed decision delivers nothing twice.
 *
 * A packet whose review was REJECTED never reaches here. It stays on the record
 * as the proposal it was.
 */
async function deliverAcceptedGuidance(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly tasks: readonly JuliusTask[];
  /** The architect task Julius accepted: the original guidance, its repair, or a continuation of either. */
  readonly guidanceTaskId: string;
  /** The guidance task the question was asked on — the lineage root. */
  readonly questionTaskId: string;
  readonly workerId: string;
  readonly firstWrite: boolean;
  /** The continuation owed the packet, when the caller already knows it — a claim-time delivery. */
  readonly waitingTaskId?: string;
  /** Where the delivery happened: on the accepting decision, or when the continuation was claimed. */
  readonly deliveredAt?: 'DECISION' | 'CLAIM';
}): Promise<void> {
  const { deps, run, ledger } = input;
  if (!input.firstWrite) return;
  const waiting = input.waitingTaskId !== undefined
    ? input.tasks.find((item) => item.taskId === input.waitingTaskId) ?? null
    : pendingSegmentFor(input.questionTaskId, input.tasks);
  if (waiting === null) return;
  const entries = await deps.store.brainEntriesForRun(run.runId, run.projectId);
  const proposal = entries.find((entry) => entry.entryId === juliusGuidanceProposalEntryId(input.guidanceTaskId));
  if (proposal === undefined) {
    // Accepted work that produced no readable packet delivers nothing, and says so.
    await ledger.event('guidance.refused', {
      taskId: input.questionTaskId, workerId: input.workerId,
      facts: { reasonCode: 'accepted_guidance_has_no_proposal', stage: 'deliver', guidanceTaskId: input.guidanceTaskId },
    });
    return;
  }
  const revision = entries.filter((entry) => entry.entryId.startsWith(`brain:guidance-answer:${waiting.taskId}:r`)).length + 1;
  const packet = proposal.text.startsWith(JULIUS_GUIDANCE_PROPOSED_HEADING)
    ? proposal.text.slice(JULIUS_GUIDANCE_PROPOSED_HEADING.length).replace(/^\n+/u, '')
    : proposal.text;
  /**
   * DELIVERED ONCE — THIS PACKET, not any packet. Whichever path reaches it first
   * (the accepting decision, or the continuation's claim) writes the answer; the
   * other finds the same text already there and writes nothing. Keyed on the
   * packet, because a continuation also holds packets CARRIED from earlier
   * pauses, and those must not stand in for a new answer.
   */
  const authoritative = `${JULIUS_GUIDANCE_AUTHORITATIVE_HEADING}\n\n${packet}`;
  if (entries.some((entry) => isJuliusGuidanceHandoffEntryId(entry.entryId) && entry.taskIds.includes(waiting.taskId) && entry.text === authoritative)) return;
  const entryId = juliusGuidanceHandoffEntryId(waiting.taskId, revision);
  /**
   * AUTHOR AND DELIVERER ARE TWO IDENTITIES. The handoff row is the
   * architect's words reaching the continuation; the tick that delivers it may
   * belong to anyone — the reviewer whose acceptance released it, most often.
   * The row's writer is therefore the AUTHOR (the proposal's own provenance),
   * so the claim ledger's self-verification rule follows authorship: a reviewer
   * that merely delivered the packet may still verify it, and the architect
   * that wrote it may not. The DELIVERER is on the event beside it — which
   * tick, which task, whose completion — so the record still answers who
   * carried the packet and when.
   */
  const authorWorkerId = proposal.provenance?.workerId ?? input.workerId;
  await appendBrainEntryAdmitting(deps, {
    runId: run.runId, projectId: run.projectId, taskId: waiting.taskId, workerId: authorWorkerId,
    entryId, kind: 'HANDOFF',
    safeText: authoritative,
    evidenceIds: [], occurredAt: deps.clock.now(),
  });
  await ledger.event('guidance.delivered', {
    taskId: input.questionTaskId, workerId: input.workerId,
    facts: {
      authorWorkerId, deliveredByWorkerId: input.workerId, deliveredAtTaskId: input.questionTaskId,
      guidanceTaskId: input.guidanceTaskId, deliveredTo: waiting.taskId, entryId,
      revision, proposalEntryId: proposal.entryId, deliveredAt: input.deliveredAt ?? 'DECISION',
    },
  });
}

/**
 * WHATEVER JULIUS ACCEPTED FOR A CONTINUATION, DELIVERED BEFORE IT RUNS.
 *
 * The accepted architect task is found from the decisions, not from the event
 * that would have recorded the delivery — the delivery is exactly what may be
 * missing. The latest ACCEPT or COMPLETE in the guidance task's own unit is the
 * packet that answered; its proposal is what reaches the coder.
 */
async function deliverOwedGuidance(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
}): Promise<void> {
  const { deps, run } = input;
  const [tasks, decisions] = await Promise.all([
    deps.store.tasksForRun(run.runId, run.projectId),
    deps.store.decisionsForRun(run.runId, run.projectId),
  ]);
  const byId = new Map(tasks.map((item) => [item.taskId, item]));
  for (const questionTaskId of input.task.dependencyIds.filter((id) => guidanceSubjectTaskId(id) !== null)) {
    const accepted = [...decisions].reverse().find((decision) => (decision.action === 'ACCEPT' || decision.action === 'COMPLETE')
      && byId.has(decision.taskId) && juliusWorkUnitRootOf(byId.get(decision.taskId)!, tasks).taskId === questionTaskId);
    if (accepted === undefined) continue;
    await deliverAcceptedGuidance({
      deps, run, ledger: input.ledger, tasks, guidanceTaskId: accepted.taskId, questionTaskId,
      workerId: input.workerId, firstWrite: true, waitingTaskId: input.task.taskId, deliveredAt: 'CLAIM',
    });
  }
}

/* ------------------------------------------------------ coding agent work */

/**
 * RECORD WHAT A CODING AGENT DISPATCH CHANGED, AND HOLD IT TO THE AGREEMENT.
 *
 * The locked contract's permitted paths and out-of-scope paths were stated to
 * the coder and to the reviewer and checked by nothing, so an edit outside them
 * was caught only if a reviewer happened to notice. Julius now reads the change
 * set the independent executor observed, recomputes scope against the contract
 * this dispatch was bound by, and — where the work strayed — writes a FAILED
 * DIFF evidence row of its own. Verification then routes the task to repair on
 * that evidence, after the independent review, exactly as it does for a failed
 * test. The coder's own report sits beside it as CLAIMS: compared with what the
 * executor saw, never substituted for it.
 */
/**
 * WHICH ATTEMPT CHANGED WHAT — WRITTEN FOR EVERY ATTEMPT, INCLUDING FAILED ONES.
 *
 * One workspace serves the whole mission and is never reset, so an attempt's
 * `git status` was the sum of everything before it: attempt 2 of a build was
 * credited with attempt 1's edits, and an attempt that failed before the
 * capture ran left edits that simply appeared inside the next attempt's diff.
 * The executor now records three trees per attempt and Julius derives what the
 * attempt INHERITED, what it OWNS and what the mission CARRIES from them.
 *
 * UNKNOWN IS NEVER CLEAN. A record with a missing snapshot is `captured:false`
 * with empty sets, and the cleanliness it reports is `UNKNOWN` — a cancelled
 * dispatch, which collects no evidence after its abort, lands here truthfully
 * rather than as a workspace somebody read and found empty.
 */
/**
 * THE ONE UNDO THIS DISPATCH IS AUTHORISED TO DO, read from the durable record
 * and from nothing else.
 *
 * The rule is deliberately narrow, because the alternative — a broad reset — is
 * how a worker destroys work whose provenance nobody can account for. Julius
 * asks for an undo only when the LAST recorded attempt of this task FAILED and
 * its OWN changes broke the locked contract's scope: nothing of that attempt
 * will ever be reviewed, and leaving its edits makes them the next attempt's
 * inheritance. Both trees travel with the request, so the adapter can refuse if
 * the workspace has moved since — which it must, because anything that moved it
 * is work this record cannot account for.
 *
 * It reads the ledger rather than any in-process state, so a restart, a
 * requeue or another worker entirely reaches the same decision.
 */
async function juliusWorkspaceRestoreFor(
  deps: JuliusPipelineDependencies, run: JuliusRunRow, taskId: string,
): Promise<JuliusDispatchWorkspace | null> {
  if (deps.timeline === undefined) return null;
  let last: { outcome: 'SUCCEEDED' | 'FAILED'; scopeViolations: number; startTree: string | null; endTree: string | null } | null = null;
  let sinceSequence = 0;
  for (;;) {
    const page = await deps.timeline.timeline({ runId: run.runId, projectId: run.projectId, sinceSequence, limit: 500 });
    for (const entry of page.entries) {
      sinceSequence = Math.max(sinceSequence, entry.sequence);
      if (entry.type !== 'coder.attempt.workspace' || entry.taskId !== taskId) continue;
      const facts = entry.facts;
      const outcome = facts.attemptOutcome === 'FAILED' ? 'FAILED' as const : 'SUCCEEDED' as const;
      last = {
        outcome,
        scopeViolations: typeof facts.ownScopeViolations === 'number' ? facts.ownScopeViolations : 0,
        startTree: typeof facts.startTree === 'string' ? facts.startTree : null,
        endTree: typeof facts.endTree === 'string' ? facts.endTree : null,
      };
    }
    if (!page.hasMore || page.entries.length === 0) break;
  }
  const request = juliusRestoreRequestFor({ lastAttempt: last });
  return request === null ? null : { restoreToTree: request.startTree, expectedTree: request.endTree };
}

async function recordAttemptWorkspace(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  /** Null on the failure path: the outcome names no worker, and inventing one would misattribute the attempt. */
  readonly workerId: string | null;
  readonly leaseGeneration: number;
  readonly attempt: number | null;
  readonly implementation: JuliusCodingAgentImplementation;
  readonly scope: { readonly permittedPaths: readonly string[]; readonly outOfScope: readonly string[] } | null;
}): Promise<{ readonly ownViolations: number; readonly cleanliness: JuliusWorkspaceCleanliness }> {
  const { ledger, task, implementation } = input;
  const attempt = readJuliusAttemptWorkspace(implementation.attempt);
  const cleanliness = juliusWorkspaceCleanliness(implementation.workspace);
  const ownViolations = attempt.captured && input.scope !== null
    ? juliusScopeViolations({ changes: attempt.own, ...input.scope })
    : [];
  const listed = (paths: readonly string[]): string => paths.slice(0, JULIUS_WORKSPACE_LIMITS.listedPaths).join(' ');

  await ledger.event('coder.attempt.workspace', {
    taskId: task.taskId, ...(input.workerId === null ? {} : { workerId: input.workerId }),
    facts: {
      attemptOutcome: implementation.attemptOutcome,
      attempt: input.attempt,
      leaseGeneration: input.leaseGeneration,
      captured: attempt.captured,
      cleanliness,
      uncapturedReason: attempt.captured ? null : implementation.uncapturedReason,
      baseTree: attempt.baseTree, startTree: attempt.startTree, endTree: attempt.endTree,
      ownPaths: attempt.own.length,
      inheritedPaths: attempt.inherited.length,
      cumulativePaths: attempt.cumulative.length,
      ownScopeViolations: ownViolations.length,
      truncated: attempt.truncated,
      own: listed(attempt.own.map((change) => change.path)),
      inherited: listed(attempt.inherited.map((change) => change.path)),
      restoreOutcome: attempt.restore?.outcome ?? null,
    },
  });
  if (attempt.restore !== null) {
    await ledger.event('coder.workspace.restored', {
      taskId: task.taskId, ...(input.workerId === null ? {} : { workerId: input.workerId }),
      facts: {
        outcome: attempt.restore.outcome,
        toTree: attempt.restore.toTree, expectedTree: attempt.restore.expectedTree, observedTree: attempt.restore.observedTree,
        removed: attempt.restore.removed, restored: attempt.restore.restored,
        leaseGeneration: input.leaseGeneration, attempt: input.attempt,
      },
    });
  }
  /**
   * THE ATTEMPT OWNS WHAT IT CHANGED, in scope or out of it. A failed attempt's
   * stray edits are named under the attempt that made them rather than left to
   * turn up under the next one — and they are what Julius reads when it decides
   * whether the next attempt must begin by undoing them.
   */
  for (const violation of ownViolations.slice(0, JULIUS_WORKSPACE_LIMITS.listedPaths)) {
    await ledger.event('coder.scope.violated', {
      taskId: task.taskId, ...(input.workerId === null ? {} : { workerId: input.workerId }),
      facts: { path: violation.path, rule: violation.rule, resolvedBy: 'CONTRACT', attributedTo: 'ATTEMPT', attempt: input.attempt },
    });
  }
  return { ownViolations: ownViolations.length, cleanliness };
}

async function recordCodingAgentImplementation(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
  readonly value: unknown;
  readonly leaseGeneration: number;
  readonly attempt?: number | null;
  readonly scope: { readonly permittedPaths: readonly string[]; readonly outOfScope: readonly string[] } | null;
}): Promise<void> {
  const { deps, run, ledger, task } = input;
  const implementation = readJuliusCodingAgentImplementation(input.value);
  if (implementation === null) {
    await ledger.event('coder.report.refused', {
      taskId: task.taskId, workerId: input.workerId, facts: { reasonCode: 'coding_agent_implementation_unreadable' },
    });
    return;
  }
  const attribution = await recordAttemptWorkspace({
    deps, run, ledger, task, workerId: input.workerId, leaseGeneration: input.leaseGeneration,
    attempt: input.attempt ?? null, implementation, scope: input.scope,
  });
  const changes = implementation.workspace.changes;
  const violations = input.scope === null ? [] : juliusScopeViolations({ changes, ...input.scope });

  let reportOutcome: string | null = null;
  let claimedNotObserved: number | null = null;
  let observedNotClaimed: number | null = null;
  let uncertainty: number | null = null;
  let blocked: boolean | null = null;
  if (implementation.report !== undefined && implementation.report !== null) {
    const reading = sanitizeJuliusCodingAgentReport(implementation.report);
    if (!reading.ok) {
      await ledger.event('coder.report.refused', {
        taskId: task.taskId, workerId: input.workerId, facts: { reasonCode: reading.reasonCode },
      });
    } else {
      const observed = new Set(changes.map((change) => change.path));
      const claimed = new Set(reading.report.filesTouched);
      reportOutcome = reading.report.outcome;
      claimedNotObserved = [...claimed].filter((path) => !observed.has(path)).length;
      observedNotClaimed = [...observed].filter((path) => !claimed.has(path)).length;
      uncertainty = reading.report.remainingUncertainty.length;
      blocked = reading.report.blockedReason !== null;
    }
  }

  const listed = (paths: readonly string[]): string => paths.slice(0, JULIUS_WORKSPACE_LIMITS.listedPaths).join(' ');
  await ledger.event('coder.implementation.recorded', {
    taskId: task.taskId, workerId: input.workerId,
    facts: {
      providerKind: implementation.providerKind,
      workspaceCaptured: implementation.workspace.captured,
      changedPaths: changes.length,
      untrackedPaths: changes.filter((change) => change.change === 'UNTRACKED').length,
      changeTruncated: implementation.workspace.truncated,
      paths: listed(changes.map((change) => change.path)),
      scopeChecked: input.scope !== null,
      scopeViolations: violations.length,
      ownScopeViolations: attribution.ownViolations,
      cleanliness: attribution.cleanliness,
      reportOutcome, claimedNotObserved, observedNotClaimed, uncertainty, blocked,
    },
  });

  /**
   * A WORKSPACE NOBODY COULD READ IS NOT A CLEAN ONE.
   *
   * An uncaptured change set is empty because nothing is known, and every rule
   * that reads it — the scope check, the diff evidence's "no change observed" —
   * then answers as though the executor had looked and found nothing. Julius
   * writes its own FAILED evidence instead, so an accepted result can never
   * rest on a workspace that was never read.
   */
  if (attribution.cleanliness === 'UNKNOWN') {
    await deps.store.appendEvidence({
      runId: run.runId, projectId: run.projectId,
      idempotencyKey: `${task.taskId}:${String(input.leaseGeneration)}:workspace`,
      evidence: {
        evidenceId: `${task.taskId}:${String(input.leaseGeneration)}:workspace`,
        missionId: task.missionId, taskId: task.taskId, workerId: input.workerId,
        type: 'DIFF', status: 'FAILED',
        safeSummary: 'Julius workspace check: the independent executor did not report a change set for this attempt, so what it changed is UNKNOWN — which is not a clean workspace.',
        artifactRef: null, integrityHash: null, occurredAt: deps.clock.now(),
      },
    });
  }

  if (violations.length === 0) return;
  for (const violation of violations.slice(0, JULIUS_WORKSPACE_LIMITS.listedPaths)) {
    await ledger.event('coder.scope.violated', {
      taskId: task.taskId, workerId: input.workerId,
      facts: { path: violation.path, rule: violation.rule, resolvedBy: 'CONTRACT', attributedTo: 'CUMULATIVE', attempt: input.attempt ?? null },
    });
  }
  /**
   * JULIUS'S OWN EVIDENCE, NOT THE WORKER'S. The id is under the task and lease
   * that did the work, so a replay writes nothing twice; the summary names the
   * paths and the rule, and no worker text.
   */
  await deps.store.appendEvidence({
    runId: run.runId, projectId: run.projectId,
    idempotencyKey: `${task.taskId}:${String(input.leaseGeneration)}:scope`,
    evidence: {
      evidenceId: `${task.taskId}:${String(input.leaseGeneration)}:scope`,
      missionId: task.missionId, taskId: task.taskId, workerId: input.workerId,
      type: 'DIFF', status: 'FAILED',
      safeSummary: `Julius scope check: ${String(violations.length)} changed path(s) the locked contract does not allow — ${listed(violations.map((violation) => `${violation.path} [${violation.rule}]`))}.`.slice(0, 900),
      artifactRef: null, integrityHash: null, occurredAt: deps.clock.now(),
    },
  });
}

/* ------------------------------------------------------------ architecture */

/**
 * RECORD A REVISION OF THE ARCHITECTURE, AND SAY WHERE IT DISAGREES WITH THE
 * AGREEMENT.
 *
 * Advisory state: recording it changes no term, releases no task and decides
 * nothing. What it does is make the design answerable — which boundary a change
 * crosses, what was assumed, what was rejected and why — so drift can be
 * detected against something other than prose.
 *
 * A proposal that names a mission-owned term is refused by the peer authority
 * guard, under the same rule as a guidance packet that tries. A conflict with
 * the contract's permitted paths or prohibited actions is RECORDED rather than
 * resolved: the contract wins until Julius decides otherwise.
 *
 * AFTER THE TERMS LOCK, A MATERIAL CHANGE IS A RE-PLAN. It is PROPOSED, and the
 * review of the task that proposed it decides whether it becomes the design in
 * force; one that would need a mission term to move is escalated instead of
 * applied.
 */
async function recordArchitecture(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
  readonly value: unknown;
}): Promise<void> {
  const { deps, run, ledger, task } = input;
  const rows = await readVerdictLedger(deps, run);
  const revision = juliusNextArchitectureRevision(rows);
  /**
   * A RE-PLAN LOOP IS BOUNDED. Each revision can mint a consultation and each
   * consultation can propose a revision, so without a ceiling a mission could
   * spend itself redesigning. The cap is refused by name, not silently ignored.
   */
  if (revision > JULIUS_ARCHITECTURE_DRIFT_LIMITS.revisions) {
    await ledger.event('architecture.refused', {
      taskId: task.taskId, workerId: input.workerId,
      facts: { reasonCode: 'architecture_revision_limit', revision, limit: JULIUS_ARCHITECTURE_DRIFT_LIMITS.revisions },
    });
    return;
  }
  const reading = sanitizeJuliusArchitecture({
    value: input.value,
    revision,
    proposedByTaskId: task.taskId,
    recordedAt: deps.clock.now(),
  });
  if (!reading.ok) {
    await ledger.event('architecture.refused', {
      taskId: task.taskId, workerId: input.workerId, facts: { reasonCode: reading.reasonCode },
    });
    return;
  }
  const state = reading.state;

  /**
   * THE CONTRACTS THAT GOVERN WORK IN THIS RUN, read before anything is
   * recorded, because whether this revision is a re-plan depends on whether any
   * of them is LOCKED. Not the architect's own binding: the architect that
   * drafts the terms is bound by none, so read off its own task this would be
   * dead at exactly the moment the architecture is first written.
   */
  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);
  const subjects: string[] = [];
  for (const candidate of tasks) {
    const subject = juliusContractSubjectTaskId(candidate, tasks);
    if (subject !== null && !subjects.includes(subject)) subjects.push(subject);
  }
  const governing: { contractTaskId: string; contract: JuliusTaskContract }[] = [];
  for (const contractTaskId of subjects) {
    const contract = await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
    if (contract !== null) governing.push({ contractTaskId, contract });
  }
  const conflicts = governing.flatMap(({ contractTaskId, contract }) =>
    juliusArchitectureConflicts(state, contract).map((conflict) => ({ contractTaskId, conflict })));

  const previous = foldJuliusArchitecture(rows);

  /**
   * AN ANSWER THAT SAYS THE SAME THING IS NOT A NEW REVISION.
   *
   * A consultation states the WHOLE design rather than a diff, so an architect
   * that finds nothing to change answers with exactly what is already in force.
   * Numbering that as a revision would change the id of every trigger that
   * names the revision, and Julius would consult the architect again about the
   * same design until the run cap stopped it — which is what the first version
   * of this did, eight times in one mission. The record says the consultation
   * happened and that nothing moved.
   */
  if (previous !== null && juliusArchitectureMatches(previous, state)) {
    await ledger.event('architecture.unchanged', {
      taskId: task.taskId, workerId: input.workerId,
      facts: { revision: previous.revision, proposedByTaskId: task.taskId },
    });
    return;
  }

  const changes = juliusArchitectureChanges(previous, state);
  const material = juliusArchitectureChangeIsMaterial(changes);
  const locked = governing.some((item) => item.contract.state === 'LOCKED');
  const changeKinds = changes.filter((change) => change.material).map((change) => `${change.kind}:${change.change}`).join(' ');

  /**
   * A RE-PLAN THAT NEEDS A MISSION TERM TO MOVE IS NOT THE ARCHITECT'S TO MAKE.
   *
   * A material revision that conflicts with a LOCKED contract cannot be
   * validated by a reviewer, because what it asks for is outside what was
   * agreed. It is escalated as exactly that and recorded as NO REVISION AT ALL:
   * the design in force does not move, nothing reaches a worker's context, and
   * changing the agreement stays where it belongs — a contract revision, or the
   * user.
   */
  if (locked && material && conflicts.length > 0) {
    await ledger.event('architecture.replan.escalated', {
      taskId: task.taskId, workerId: input.workerId,
      facts: {
        revision, reasonCode: 'replan_requires_contract_revision',
        conflicts: conflicts.length, conflictKinds: conflicts.map((item) => item.conflict.kind).join(' '),
        changeKinds, contractTaskId: conflicts[0]!.contractTaskId,
      },
    });
    return;
  }

  const status = locked && material && previous !== null ? 'PROPOSED' : 'IN_FORCE';
  await ledger.event('architecture.recorded', {
    taskId: task.taskId, workerId: input.workerId,
    facts: {
      ...juliusArchitectureFacts(state), status,
      materialChanges: changes.filter((change) => change.material).length, changeKinds,
    },
  });

  if (status === 'PROPOSED') {
    await ledger.event('architecture.proposed', {
      taskId: task.taskId, workerId: input.workerId,
      facts: { revision, proposedByTaskId: task.taskId, changeKinds, reasonCode: 'material_change_after_lock' },
    });
    /**
     * SCOPED TO THE TASK THAT PROPOSED IT, exactly as a guidance proposal is:
     * the reviewer judging this consultation reads it, and no coder builds
     * against a design nobody has accepted.
     */
    await appendBrainEntryAdmitting(deps, {
      runId: run.runId, projectId: run.projectId, taskId: task.taskId, workerId: input.workerId,
      entryId: juliusArchitectureProposalEntryId(task.taskId), kind: 'DECISION',
      safeText: [
        `PROPOSED ARCHITECTURE REVISION — NOT IN FORCE. It changes ${changeKinds === '' ? '(nothing material)' : changeKinds} after the terms were locked, and governs nothing unless this consultation is accepted.`,
        renderJuliusArchitecture(state),
      ].join('\n'),
      evidenceIds: [], occurredAt: deps.clock.now(),
    });
  } else {
    /**
     * THE ACCEPTED PICTURE, WHERE EVERY WORKER READS IT. Run-wide, so the coder
     * building against it and the reviewer judging against it see the same
     * revision, and bounded by the same cap the row is.
     */
    await appendBrainEntryAdmitting(deps, {
      runId: run.runId, projectId: run.projectId, taskId: null, workerId: input.workerId,
      entryId: juliusArchitectureEntryId(run.runId, state.revision), kind: 'DECISION',
      safeText: renderJuliusArchitecture(state), evidenceIds: [], occurredAt: deps.clock.now(),
    });
  }

  /**
   * WHERE THE DESIGN AND THE AGREEMENT DISAGREE, THE AGREEMENT WINS. Recorded,
   * never resolved here: the contract stands as written.
   */
  for (const { contractTaskId, conflict } of conflicts) {
    await ledger.event('architecture.conflicted', {
      taskId: task.taskId, workerId: input.workerId,
      facts: {
        revision: state.revision, kind: conflict.kind, name: conflict.name, detail: conflict.detail,
        contractTaskId, resolvedBy: 'CONTRACT',
      },
    });
  }
}

/**
 * A PROPOSED REVISION BECOMES THE DESIGN IN FORCE WHEN ITS CONSULTATION IS
 * ACCEPTED, AND NOT BEFORE.
 *
 * The same rule as an accepted guidance packet, and for the same reason: a
 * design the reviewer sent back must never be the design the next worker builds
 * against. Nothing is erased — the proposal row, the recorded revision and the
 * rejecting decision all stay — but only acceptance writes the run-wide entry.
 */
async function acceptProposedArchitecture(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly proposedByTaskIds: readonly string[];
  readonly acceptedTaskId: string;
  readonly workerId: string;
  readonly firstWrite: boolean;
}): Promise<void> {
  const { deps, run, ledger } = input;
  if (!input.firstWrite) return;
  const rows = await readVerdictLedger(deps, run);
  const already = new Set(rows.filter((row) => row.type === 'architecture.accepted')
    .map((row) => (typeof row.facts.revision === 'number' ? row.facts.revision : -1)));
  for (const row of rows) {
    if (row.type !== 'architecture.proposed') continue;
    const proposedBy = typeof row.facts.proposedByTaskId === 'string' ? row.facts.proposedByTaskId : null;
    const revision = typeof row.facts.revision === 'number' ? row.facts.revision : null;
    if (proposedBy === null || revision === null) continue;
    if (!input.proposedByTaskIds.includes(proposedBy) || already.has(revision)) continue;
    const state = architectureRevisionOf(rows, revision);
    if (state === null) continue;
    await ledger.event('architecture.accepted', {
      taskId: proposedBy, workerId: input.workerId,
      facts: { revision, proposedByTaskId: proposedBy, acceptedByTaskId: input.acceptedTaskId },
    });
    await appendBrainEntryAdmitting(deps, {
      runId: run.runId, projectId: run.projectId, taskId: null, workerId: input.workerId,
      entryId: juliusArchitectureEntryId(run.runId, revision), kind: 'DECISION',
      safeText: renderJuliusArchitecture(state), evidenceIds: [], occurredAt: deps.clock.now(),
    });
  }
}

/** One recorded revision, read back through the same allowlist it was written with. */
function architectureRevisionOf(
  rows: readonly JuliusPeerLedgerEntry[], revision: number,
): JuliusArchitectureState | null {
  for (const row of rows) {
    if (row.type !== 'architecture.recorded' || row.facts.revision !== revision) continue;
    const raw = typeof row.facts.state === 'string' ? row.facts.state : null;
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const reading = sanitizeJuliusArchitecture({
      value: parsed, revision,
      proposedByTaskId: typeof row.facts.proposedByTaskId === 'string' ? row.facts.proposedByTaskId : '',
      recordedAt: typeof row.facts.recordedAt === 'string' ? row.facts.recordedAt : '',
    });
    if (reading.ok) return reading.state;
  }
  return null;
}

/**
 * THE ARCHITECT'S ANSWER TO "DOES WHAT WAS BUILT MATCH WHAT WAS DESIGNED?"
 *
 * An ASSESSMENT, not a verdict. It cannot accept a task, cannot mint VERIFIED
 * and cannot complete a mission — the peer authority guard refuses those words
 * before a field is read. What it can do is refuse to let a completion happen:
 * DRIFT_REQUIRES_REPAIR and REPLAN_REQUIRED hold the run at the completion gate
 * with the drift, and the work it names, on the record.
 */
async function recordConsistency(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
  readonly value: unknown;
}): Promise<void> {
  const { deps, run, ledger, task } = input;
  const rows = await readVerdictLedger(deps, run);
  const state = foldJuliusArchitecture(rows);
  if (state === null) {
    await ledger.event('architecture.assessment.refused', {
      taskId: task.taskId, workerId: input.workerId, facts: { reasonCode: 'consistency_without_architecture' },
    });
    return;
  }
  const reading = sanitizeJuliusConsistency({ value: input.value, revision: state.revision });
  if (!reading.ok) {
    await ledger.event('architecture.assessment.refused', {
      taskId: task.taskId, workerId: input.workerId, facts: { reasonCode: reading.reasonCode, revision: state.revision },
    });
    return;
  }
  const declaration = reading.declaration;
  /* WORK THIS RUN DOES NOT HOLD IS NOT THIS ARCHITECT'S TO CALL DRIFTED. */
  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);
  const known = new Set(tasks.map((item) => item.taskId));
  const foreign = declaration.driftingTaskIds.filter((taskId) => !known.has(taskId));
  if (foreign.length > 0) {
    await ledger.event('architecture.assessment.refused', {
      taskId: task.taskId, workerId: input.workerId,
      facts: { reasonCode: 'consistency_names_foreign_work', revision: state.revision, foreign: foreign.join(' ') },
    });
    return;
  }
  await ledger.event('architecture.assessed', {
    taskId: task.taskId, workerId: input.workerId,
    facts: {
      ...juliusConsistencyFacts(declaration), assessedByTaskId: task.taskId,
      holdsCompletion: juliusConsistencyRoute(declaration.assessment) === 'REPAIR'
        || juliusConsistencyRoute(declaration.assessment) === 'REPLAN',
    },
  });
}

/**
 * GO BACK TO THE ARCHITECT, ONCE PER REASON.
 *
 * Julius decides when the architect is consulted. Every trigger is derived from
 * rows that already exist, raised at most once for the revision and subject it
 * is about, and capped for the run, so a mission that keeps drifting spends its
 * budget on the work rather than on being told about it.
 *
 * A consultation nobody can serve is RECORDED AND NOT WAITED FOR. The guidance
 * path learned this on paid run 34037313976: a task minted for a role nothing
 * serves does not fail, it SITS — RUNNABLE forever, with the mission unable to
 * complete around it.
 */
export async function juliusArchitectureGateFor(
  deps: JuliusPipelineDependencies, run: JuliusRunRow,
): Promise<JuliusArchitectureCompletionGate> {
  if (deps.timeline === undefined) return { ok: true, reasonCode: 'NO_ARCHITECTURE_RECORDED' };
  return juliusArchitectureCompletionGate({ entries: await readVerdictLedger(deps, run) });
}

export async function serveArchitectureTriggers(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly policy: JuliusCardPolicy;
  readonly tasks: readonly JuliusTask[];
  readonly completionReady: boolean;
  readonly capabilityFor?: (task: { taskId: string; taskType: string; role: string }) => string;
}): Promise<number> {
  const { deps, run } = input;
  if (deps.timeline === undefined) return 0;
  const rows = await readVerdictLedger(deps, run);
  const state = foldJuliusArchitecture(rows);
  if (state === null) return 0;
  const candidates = juliusArchitectureTriggers({ state, entries: rows, completionReady: input.completionReady });
  if (candidates.length === 0) return 0;

  const anchor = input.tasks.find((task) => task.role === 'PROMPT_ARCHITECT') ?? input.tasks[0];
  if (anchor === undefined) return 0;
  const ledger = new RuntimeLedger(deps, run, `architecture:${run.runId}`);
  let served = 0;
  for (const candidate of candidates) {
    const taskId = juliusArchitectureCheckTaskId(run.runId, candidate.triggerId);
    const capability = input.capabilityFor?.({ taskId, taskType: 'architecture', role: 'PROMPT_ARCHITECT' });
    const routable = capability === undefined || deps.router.eligibleWorkerIds({
      role: 'PROMPT_ARCHITECT', taskType: 'architecture', capability, policy: input.policy,
    }).length > 0;
    const created = routable
      ? await deps.store.addTask({
        commandId: `architecture:${taskId}`,
        runId: run.runId, projectId: run.projectId,
        task: {
          taskId, missionId: run.missionId,
          parentTaskId: candidate.subjectTaskId,
          dependencyIds: [], requiredEvidenceTypes: ['ARTIFACT'],
          taskType: 'architecture', role: 'PROMPT_ARCHITECT',
          ordinal: anchor.ordinal + 1,
          // RUNNABLE, because BLOCKED is unreachable by the claim query and only
          // `appendDecision({releaseTaskIds})` ever moves a task out of it.
          state: 'RUNNABLE',
        },
      })
      : false;
    /*
     * NOT CREATED IS NOT NECESSARILY UNSERVED. A replay after a crash between
     * the insert and this row finds its own task already there: that trigger IS
     * served, and saying otherwise would hand the completion gate a false fact.
     * Only a task this run does not hold is a check that did not happen.
     */
    const present = created || (routable && (await deps.store.tasksForRun(run.runId, run.projectId))
      .some((item) => item.taskId === taskId));
    await ledger.event('architecture.trigger.raised', {
      taskId: candidate.subjectTaskId, workerId: null,
      facts: {
        ...juliusArchitectureTriggerFacts(candidate),
        served: present, servedByTaskId: present ? taskId : null,
        unroutable: !routable,
        created,
      },
    });
    if (created) served += 1;
  }
  return served;
}

/* --------------------------------------------------------- finding lifecycle */

/**
 * THE FINDING ROWS AS THE LEDGER SAYS THEY ARE. The only place the pipeline
 * reads finding rows, so no decision can read a stored status the lifecycle has
 * moved past (`juliusEffectiveFindings`).
 */
async function effectiveFindingsOf(deps: JuliusPipelineDependencies, run: JuliusRunRow): Promise<readonly JuliusReviewerFinding[]> {
  return juliusEffectiveFindings(await deps.store.findingsForRun(run.runId, run.projectId), await readVerdictLedger(deps, run));
}

/** The findings a repair's review is about: on the work, its earlier rounds and its unit. */
function chargedFindingSubjects(reviewed: JuliusTask, tasks: readonly JuliusTask[]): ReadonlySet<string> {
  const reviewedHead = juliusSegmentLineageRootOf(reviewed, tasks);
  return new Set([
    reviewed.taskId,
    reviewed.parentTaskId ?? reviewed.taskId,
    // A repair that paused is reviewed through its last segment; the findings
    // it answers are on the repair's own subject and lineage.
    reviewedHead.parentTaskId ?? reviewedHead.taskId,
    // And every task of the unit: the root, every repair round, every segment.
    ...unitWorkTaskIds(reviewed, tasks),
  ]);
}

/**
 * THE WORK TASKS OF ONE UNIT — its root, every repair round and every segment of
 * either — the tasks a finding about this unit can be recorded on.
 */
function unitWorkTaskIds(task: JuliusTask, tasks: readonly JuliusTask[]): ReadonlySet<string> {
  const unit = juliusWorkUnitRootOf(task, tasks).taskId;
  return new Set(tasks
    .filter((item) => item.role !== 'INDEPENDENT_REVIEWER' && juliusWorkUnitRootOf(item, tasks).taskId === unit)
    .map((item) => item.taskId));
}

/**
 * THE CHARGED FINDINGS A RE-REVIEW LEFT UNRESOLVED, split by why — and each
 * silence refused by name, once.
 */
async function chargedFindingsOf(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly review: JuliusTask;
  readonly reviewed: JuliusTask;
  readonly tasks: readonly JuliusTask[];
  readonly workerId: string;
}): Promise<{ readonly silent: readonly JuliusFindingLife[]; readonly maintained: readonly JuliusFindingLife[] }> {
  const { deps, run } = input;
  const rows = await readVerdictLedger(deps, run);
  const lives = foldJuliusFindings(await deps.store.findingsForRun(run.runId, run.projectId), rows);
  const subjects = chargedFindingSubjects(input.reviewed, input.tasks);
  /*
   * A finding THIS review raised is OPEN on the work it reviewed, so the evaluator
   * already repairs over it: it can only ever fall in `maintained`, which only
   * overrides an ACCEPT that such a finding already prevents.
   */
  const outstanding = lives.filter((life) => subjects.has(life.taskId) && juliusFindingIsOutstanding(life, lives));
  const silent = outstanding.filter((life) => life.state === 'ADDRESSED');
  for (const life of silent) {
    const already = rows.some((row) => row.type === 'review.verdict.refused' && row.facts.reasonCode === 'review_resolution_missing'
      && row.facts.findingId === life.findingId && row.facts.reviewTaskId === input.review.taskId);
    if (already) continue;
    await input.ledger.event('review.verdict.refused', {
      taskId: input.reviewed.taskId, workerId: input.workerId,
      facts: { reviewTaskId: input.review.taskId, reasonCode: 'review_resolution_missing', findingId: life.findingId },
    });
  }
  return { silent, maintained: outstanding.filter((life) => life.state !== 'ADDRESSED') };
}

/**
 * THE COMPLETION GATE ON FINDINGS, as the run loop asks it. Holds a run whose
 * blocking findings the lifecycle says are unresolved; with no timeline bound
 * the lifecycle cannot be read, and an unreadable finding is not a resolved one.
 */
export async function juliusFindingsGateFor(
  deps: JuliusPipelineDependencies, run: JuliusRunRow,
): Promise<JuliusFindingsCompletionGate> {
  return juliusFindingsCompletionGate({
    findings: await deps.store.findingsForRun(run.runId, run.projectId),
    entries: await readVerdictLedger(deps, run),
  });
}

/** Every finding in this run, with the life the ledger gives it. */
async function findingLivesOf(
  deps: JuliusPipelineDependencies,
  run: JuliusRunRow,
  findings: readonly JuliusReviewerFinding[],
): Promise<readonly JuliusFindingLife[]> {
  return foldJuliusFindings(findings, await readVerdictLedger(deps, run));
}

/** Write one legal move, or nothing. The record refuses what the runtime would have refused. */
async function moveFinding(input: {
  readonly ledger: RuntimeLedger;
  readonly deps: JuliusPipelineDependencies;
  readonly life: JuliusFindingLife;
  readonly move: JuliusFindingMove;
  readonly workerId: string;
  readonly reviewTaskId?: string | null;
  readonly repairTaskId?: string | null;
  readonly supersededByFindingId?: string | null;
}): Promise<boolean> {
  const at = input.deps.clock.now();
  const transition = {
    findingId: input.life.findingId, move: input.move, at,
    reviewTaskId: input.reviewTaskId ?? null,
    repairTaskId: input.repairTaskId ?? null,
    supersededByFindingId: input.supersededByFindingId ?? null,
  };
  if (moveJuliusFinding(input.life, transition).outcome !== 'MOVED') return false;
  await input.ledger.event('finding.transitioned', {
    taskId: input.life.taskId, workerId: input.workerId, facts: juliusFindingTransitionFacts(transition),
  });
  return true;
}

/**
 * A REPAIR THAT SUCCEEDED HAS ADDRESSED ITS FINDINGS — and addressed is not
 * resolved. The claim is that someone acted, which is a fact about the run; the
 * reviewer's re-review is the only thing that can say it worked.
 */
async function markFindingsAddressed(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly repair: JuliusTask;
  readonly tasks: readonly JuliusTask[];
  readonly findings: readonly JuliusReviewerFinding[];
  readonly workerId: string;
}): Promise<void> {
  // The repair itself, not the last pause of it: a paused repair finishes in a
  // continuation whose parent is the repair.
  const head = juliusSegmentLineageRootOf(input.repair, input.tasks);
  if (head.parentTaskId === null) return;
  /*
   * THE UNIT, EVERY ROUND OF IT. A repair is shown every unresolved finding of
   * the work it belongs to, so it addresses every OPEN one — the root's, and
   * those raised on earlier rounds — not only the round it directly repairs.
   * Before, a finding raised on round one and answered "still open" by round
   * two's review was never addressed or shown again by round three.
   */
  const unit = unitWorkTaskIds(head, input.tasks);
  for (const life of await findingLivesOf(input.deps, input.run, input.findings)) {
    if (!unit.has(life.taskId) || life.state !== 'OPEN') continue;
    await moveFinding({
      ledger: input.ledger, deps: input.deps, life, move: 'REPAIR_SUCCEEDED',
      // Named by the repair, not by the pause that finished it: the finding's
      // repair linkage is the unit of work sent to fix it.
      workerId: input.workerId, repairTaskId: head.taskId,
    });
  }
}

/**
 * WHAT THE RE-REVIEW SAID ABOUT EACH FINDING, applied to the findings it was
 * actually asked about.
 *
 * A resolution naming a finding that belongs to other work, or one the review
 * was not asked to judge, is refused rather than applied: a reviewer may end
 * its own findings about the work in front of it and no others. Silence is not
 * a resolution — a finding nobody mentions keeps its state.
 */
async function applyFindingResolutions(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly review: JuliusTask;
  readonly reviewed: JuliusTask;
  readonly tasks: readonly JuliusTask[];
  readonly declaration: JuliusReviewVerdictDeclaration | null;
  readonly findings: readonly JuliusReviewerFinding[];
  readonly newFindingIds: readonly string[];
  readonly workerId: string;
}): Promise<{ readonly applied: number; readonly refused: number }> {
  if (input.declaration === null || input.declaration.resolutions.length === 0) return { applied: 0, refused: 0 };
  const lives = await findingLivesOf(input.deps, input.run, input.findings);
  /**
   * THE FINDINGS THIS REVIEW MAY END: the ones raised about the work it is
   * re-reviewing, and about the unit that work belongs to.
   *
   * Repairs nest — round two's parent is round one — so a reviewer answering
   * "is the original problem fixed?" is answering about a finding recorded
   * against the lineage's root. Anything outside this unit is another review's
   * to end.
   */
  const subjects = chargedFindingSubjects(input.reviewed, input.tasks);
  let applied = 0;
  let refused = 0;
  for (const resolution of input.declaration.resolutions) {
    const life = lives.find((item) => item.findingId === resolution.findingId);
    if (life === undefined || !subjects.has(life.taskId)) {
      await input.ledger.event('review.verdict.refused', {
        taskId: input.reviewed.taskId, workerId: input.workerId,
        facts: {
          reviewTaskId: input.review.taskId, reasonCode: 'review_resolution_names_a_foreign_finding',
          findingId: resolution.findingId,
        },
      });
      refused += 1;
      continue;
    }
    const move: JuliusFindingMove = resolution.status === 'RESOLVED'
      ? 'REVIEWER_RESOLVED'
      : resolution.status === 'SUPERSEDED' ? 'REVIEWER_SUPERSEDED' : 'REVIEWER_MAINTAINED';
    const moved = await moveFinding({
      ledger: input.ledger, deps: input.deps, life, move, workerId: input.workerId,
      reviewTaskId: input.review.taskId,
      // A SUPERSESSION NAMES ITS REPLACEMENT: the finding this same review
      // raised. Without exactly one, the claim cannot be recorded truthfully
      // and the finding stays where it is.
      supersededByFindingId: input.newFindingIds.length === 1 ? input.newFindingIds[0]! : null,
    });
    if (moved) applied += 1;
    else refused += 1;
  }
  return { applied, refused };
}

/* ------------------------------------------------------------ disagreement */

/** Who Julius attributes a verification to when a resolved disagreement, not a worker, caused it. */
export const JULIUS_DISAGREEMENT_RESOLVER = 'julius-disagreement-resolution' as const;

async function disagreementsOf(deps: JuliusPipelineDependencies, run: JuliusRunRow): Promise<readonly JuliusDisagreement[]> {
  return foldJuliusDisagreements(await readVerdictLedger(deps, run));
}

/**
 * MOVE A DISAGREEMENT ONE LEGAL STEP, OR WRITE NOTHING.
 *
 * The step is checked against the record's current state before it is written,
 * so a replayed tick — or a second attempt at a rebuttal or a re-review — is
 * refused by the record rather than appended. A step that resolves it is
 * followed by `disagreement.resolved` and by the peer requests it closes.
 */
async function stepDisagreement(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly disagreement: JuliusDisagreement;
  readonly step: JuliusDisagreementStep;
  readonly workerId: string;
  readonly extraFacts?: Record<string, string | number | boolean | null>;
}): Promise<JuliusDisagreement> {
  const { deps, run, ledger, disagreement } = input;
  const at = deps.clock.now();
  const moved = advanceJuliusDisagreement(disagreement, input.step, at);
  if (moved.outcome === 'REFUSED') return disagreement;
  await ledger.event('disagreement.step', {
    taskId: disagreement.subjectTaskId, workerId: input.workerId,
    facts: { ...juliusDisagreementStepFacts(disagreement.disagreementId, input.step, at), ...(input.extraFacts ?? {}) },
  });
  if (moved.resolved) {
    const resolved = moved.disagreement;
    await ledger.event('disagreement.resolved', {
      taskId: resolved.subjectTaskId, workerId: input.workerId,
      facts: {
        disagreementId: resolved.disagreementId, subjectTaskId: resolved.subjectTaskId, material: resolved.material,
        resolution: resolved.resolution, resolutionBasis: resolved.resolutionBasis,
        architectPosition: resolved.architectPosition, rebuttalTaskId: resolved.rebuttalTaskId, reReviewTaskId: resolved.reReviewTaskId,
        resolvedAt: resolved.resolvedAt,
      },
    });
    const peers = peerContextFor(deps, run, ledger);
    const close = { to: 'RESOLVED' as const, from: ['OPEN', 'ANSWERED'] as const, transitionCode: resolved.resolution!, responseRef: resolved.disagreementId, causeRef: resolved.disagreementId, taskId: resolved.subjectTaskId, workerId: input.workerId, firstWrite: true };
    await moveJuliusPeerRequest(peers, { ...close, from: [...close.from], kind: resolved.target === 'WORK' ? 'CHALLENGE' : 'EVIDENCE_CHALLENGE', anchor: resolved.reviewTaskId });
    if (resolved.rebuttalTaskId !== null) {
      await moveJuliusPeerRequest(peers, { ...close, from: [...close.from], kind: 'REBUTTAL_REQUEST', anchor: resolved.rebuttalTaskId });
    }
  }
  return moved.disagreement;
}

/**
 * A CHALLENGE BECOMES A DISAGREEMENT, and the architect is asked once.
 *
 * The rebuttal is a TASK — claimed, dispatched and settled like any other — so
 * it is bounded by the same machinery as all work and survives a restart. It is
 * proven routable first, together with its re-review: a rebuttal nobody can
 * write, or a maintained position nobody can re-review, would hold the work
 * forever, so an unroutable rebuttal is resolved at once by Julius's rule — the
 * challenge stands, because nothing answered it.
 */
async function openDisagreementFor(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly request: JuliusPipelineRequest;
  readonly review: JuliusTask;
  readonly reviewed: JuliusTask;
  readonly tasks: readonly JuliusTask[];
  readonly evidence: readonly JuliusEvidence[];
  readonly declaration: JuliusReviewVerdictDeclaration;
  readonly material: boolean;
  readonly challengeRequestId: string;
  readonly citations: readonly string[];
  readonly paused: { readonly ids: readonly string[]; readonly total: number };
  readonly workerId: string;
}): Promise<void> {
  const { deps, run, ledger, review, reviewed } = input;
  const contractTaskId = juliusContractSubjectTaskId(reviewed, input.tasks);
  const contract = contractTaskId === null ? null : await deps.store.loadTaskContract({ projectId: run.projectId, taskId: contractTaskId });
  const binding = contract === null ? null : juliusTaskContractBinding(contract);
  const opened = openJuliusDisagreement({
    executionScope: deps.executionScope ?? JULIUS_LOCAL_EXECUTION_SCOPE,
    missionId: run.missionId,
    subjectTaskId: reviewed.taskId,
    reviewTaskId: review.taskId,
    challengeRequestId: input.challengeRequestId,
    material: input.material,
    category: input.declaration.category ?? 'review',
    target: input.declaration.target ?? 'WORK',
    reviewerPosition: input.declaration.claim,
    reviewerEvidenceIds: juliusPeerIdsThatFit(input.citations).ids,
    codingAgentEvidenceIds: juliusPeerIdsThatFit(input.evidence.filter((item) => item.taskId === reviewed.taskId).map((item) => item.evidenceId)).ids,
    contractBindingDigest: binding?.bindingDigest ?? null,
    openedAt: deps.clock.now(),
  });
  if (opened.outcome === 'REFUSED') {
    // FAIL CLOSED: the challenge request stays open, so a material hold stays in
    // place and the run says why rather than proceeding past an argument.
    await ledger.event('disagreement.refused', {
      taskId: reviewed.taskId, workerId: input.workerId, facts: { reviewTaskId: review.taskId, reasonCode: opened.reasonCode },
    });
    return;
  }
  let disagreement = opened.disagreement;
  await ledger.event('disagreement.opened', {
    taskId: reviewed.taskId, workerId: input.workerId, facts: juliusDisagreementOpenedFacts(disagreement),
  });

  const routable = (taskType: string, role: JuliusWorkerRole): boolean => {
    const capability = input.request.capabilityFor?.({ taskId: juliusRebuttalTaskId(review.taskId), taskType, role });
    if (capability === undefined) return true;
    return deps.router.eligibleWorkerIds({ role, taskType, capability, policy: input.request.policy }).length > 0;
  };
  if (!routable('rebuttal', 'PROMPT_ARCHITECT') || !routable('review:rebuttal', 'INDEPENDENT_REVIEWER')) {
    await stepDisagreement({ deps, run, ledger, disagreement, step: { kind: 'REBUTTAL_UNROUTABLE' }, workerId: input.workerId });
    return;
  }

  const rebuttalTaskId = juliusRebuttalTaskId(review.taskId);
  const created = await deps.store.addTask({
    commandId: `rebuttal:${rebuttalTaskId}`, runId: run.runId, projectId: run.projectId,
    task: {
      taskId: rebuttalTaskId, missionId: reviewed.missionId, parentTaskId: reviewed.taskId,
      // The review that raised the challenge has SUCCEEDED, so the rebuttal can run now.
      dependencyIds: [review.taskId], requiredEvidenceTypes: [],
      taskType: 'rebuttal', role: 'PROMPT_ARCHITECT', ordinal: review.ordinal + 1, state: 'RUNNABLE',
    },
  });
  if (!created) return;
  disagreement = await stepDisagreement({ deps, run, ledger, disagreement, step: { kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId }, workerId: input.workerId });

  const entryId = `brain:disagreement-challenge:${rebuttalTaskId}`;
  await appendBrainEntryAdmitting(deps, {
    runId: run.runId, projectId: run.projectId, taskId: rebuttalTaskId, workerId: input.workerId, entryId, kind: 'HANDOFF',
    safeText: [
      `DISAGREEMENT ${disagreement.disagreementId}`,
      `THE INDEPENDENT REVIEWER CHALLENGES THE ${disagreement.target} OF ${reviewed.taskId} (${disagreement.category}; ${disagreement.material ? 'dependent work is held until this is resolved' : 'the work proceeds while it is argued'}).`,
      `REVIEWER'S POSITION: ${disagreement.reviewerPosition}`,
      'ANSWER ONCE. Your result carries "rebuttal": {"position": "CONCEDES" or "MAINTAINS", "argument": one paragraph, "evidence": [{"locator": where, "claim": what it shows}], "missionTermsMustChange": true or false}.',
      'A position you MAINTAIN must cite evidence, and it will be re-reviewed independently. There is no second rebuttal.',
      'You cannot change the contract, the objective, the acceptance criteria, the budget or the permissions here. If your position needs a mission-owned term to change, say so with "missionTermsMustChange": Julius will escalate rather than decide.',
    ].join('\n'),
    evidenceIds: disagreement.reviewerEvidenceIds, occurredAt: deps.clock.now(),
  });
  await openJuliusPeerRequestOnLedger(peerContextFor(deps, run, ledger), {
    kind: 'REBUTTAL_REQUEST', anchor: rebuttalTaskId,
    sourceRole: 'JULIUS', targetRole: 'PROMPT_ARCHITECT',
    reason: 'Julius asks the Prompt Architect for its one rebuttal to a reviewer challenge.',
    subjectTaskId: reviewed.taskId, carrierTaskId: rebuttalTaskId,
    contextRefs: [entryId, disagreement.disagreementId, input.challengeRequestId], evidenceIds: disagreement.reviewerEvidenceIds,
    contractBindingDigest: disagreement.contractBindingDigest,
    mandatory: disagreement.material, pausedTaskIds: input.paused.ids, pausedTaskCount: input.paused.total,
    announce: true, workerId: input.workerId,
  });
}

/** The disagreement a rebuttal task (or a continuation of one) answers. */
function disagreementForRebuttal(
  disagreements: readonly JuliusDisagreement[],
  task: JuliusTask,
  tasks: readonly JuliusTask[],
): JuliusDisagreement | undefined {
  const head = juliusSegmentLineageRootOf(task, tasks).taskId;
  if (juliusRebuttalReviewTaskId(head) === null) return undefined;
  return disagreements.find((item) => item.rebuttalTaskId === head);
}

/**
 * THE ARCHITECT'S ANSWER, ON THE RECORD BEFORE ANYTHING ACTS ON IT. Refused by
 * name when unusable — including one that MAINTAINS with nothing to cite — and
 * a refused answer is an answer Julius could not use, which the disagreement
 * resolves on.
 */
async function recordRebuttal(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly workerId: string;
  readonly value: unknown;
}): Promise<void> {
  const { deps, run, ledger, task } = input;
  const tasks = await deps.store.tasksForRun(run.runId, run.projectId);
  const disagreement = disagreementForRebuttal(await disagreementsOf(deps, run), task, tasks);
  if (disagreement === undefined || disagreement.status !== 'AWAITING_REBUTTAL' || disagreement.rebuttalTaskId === null) return;
  const reading = input.value === undefined ? null : sanitizeJuliusRebuttal(input.value);
  if (reading !== null && reading.ok) {
    await moveJuliusPeerRequest(peerContextFor(deps, run, ledger), {
      kind: 'REBUTTAL_REQUEST', anchor: disagreement.rebuttalTaskId, to: 'ANSWERED', from: ['OPEN'],
      responseRef: task.taskId, causeRef: `${task.taskId}:rebuttal`, taskId: disagreement.subjectTaskId, workerId: input.workerId, firstWrite: true,
    });
  }
  await stepDisagreement({
    deps, run, ledger, disagreement, workerId: input.workerId,
    step: { kind: 'REBUTTAL', rebuttal: reading !== null && reading.ok ? reading.rebuttal : null },
    extraFacts: { rebuttalRefusal: reading === null ? 'rebuttal_absent' : reading.ok ? null : reading.reasonCode },
  });
}

/** Julius's closing decision on a rebuttal task: the task was answered, whichever position stood. */
async function closeRebuttalTask(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly request: JuliusPipelineRequest;
  readonly task: JuliusTask;
  readonly disagreement: JuliusDisagreement | undefined;
  readonly workerId: string;
}): Promise<JuliusVerificationDecision> {
  const { deps, run, ledger, task, disagreement } = input;
  const reasonCode = disagreement === undefined ? 'DISAGREEMENT_ABSENT' : 'DISAGREEMENT_REBUTTAL_RECEIVED';
  const decision: JuliusVerificationDecision = {
    action: 'ACCEPT', reasonCode, evidenceIds: [],
    safeSummary: disagreement === undefined
      ? 'No disagreement names this rebuttal; Julius closed the task.'
      : `Rebuttal received; Julius resolved the disagreement ${disagreement.resolution ?? 'UNRESOLVED'} (${disagreement.resolutionBasis ?? 'no basis'}).`,
  };
  // The announcement goes in WITH the decision, for the reason the other site
  // does: appended afterwards, a crash between the two lost it for good.
  const decisionKey = `${task.taskId}:${decision.action}:${decision.reasonCode}`;
  await deps.store.appendDecision({
    decisionId: deps.ids.next('decision'), runId: run.runId, taskId: task.taskId,
    policyRevision: input.request.verification.revision,
    idempotencyKey: decisionKey,
    occurredAt: deps.clock.now(), decision, releaseTaskIds: [],
    events: [ledger.compose('verification.decided', {
      taskId: task.taskId, workerId: input.workerId,
      facts: {
        action: decision.action, reasonCode, criteriaSatisfied: 0, criteriaMissing: 0, missionCompletable: false, released: 0,
        disagreementId: disagreement?.disagreementId ?? null, resolution: disagreement?.resolution ?? null,
      },
    }, juliusDecisionEventId(decisionKey, 'verification.decided', 0))],
  });
  return decision;
}

/** After a resolution, the held work is decided now rather than on the next idle sweep. */
async function verifyHeldWork(
  input: Parameters<typeof verifyExecutedTask>[0] & { readonly tasks: readonly JuliusTask[] },
  disagreement: JuliusDisagreement,
): Promise<JuliusTaskOutcome | null> {
  if (!disagreement.material || disagreement.status !== 'RESOLVED') return null;
  const decisions = await input.deps.store.decisionsForRun(input.run.runId, input.run.projectId);
  if (decisions.some((item) => item.taskId === disagreement.subjectTaskId)) return null;
  const subject = (await input.deps.store.tasksForRun(input.run.runId, input.run.projectId)).find((item) => item.taskId === disagreement.subjectTaskId);
  if (subject === undefined || subject.state !== 'SUCCEEDED') return null;
  return verifyExecutedTask({ ...input, task: subject, workerId: JULIUS_DISAGREEMENT_RESOLVER, duplicate: false });
}

async function settleRebuttal(input: Parameters<typeof verifyExecutedTask>[0] & { readonly tasks: readonly JuliusTask[] }): Promise<JuliusTaskOutcome> {
  const { deps, run, ledger, task } = input;
  let disagreement = disagreementForRebuttal(await disagreementsOf(deps, run), task, input.tasks);
  // AN ANSWER THAT NEVER ARRIVED IS AN ANSWER JULIUS CANNOT USE.
  if (disagreement !== undefined && disagreement.status === 'AWAITING_REBUTTAL') {
    disagreement = await stepDisagreement({
      deps, run, ledger, disagreement, workerId: input.workerId,
      step: { kind: 'REBUTTAL', rebuttal: null }, extraFacts: { rebuttalRefusal: 'rebuttal_absent' },
    });
  }
  if (disagreement !== undefined && disagreement.status === 'AWAITING_RE_REVIEW') {
    const reReviewTaskId = `${juliusSegmentLineageRootOf(task, input.tasks).taskId}:review`;
    if (disagreement.reReviewTaskId === null) {
      const created = await deps.store.addTask({
        commandId: `review:${reReviewTaskId}`, runId: run.runId, projectId: run.projectId,
        task: {
          taskId: reReviewTaskId, missionId: task.missionId, parentTaskId: task.taskId, dependencyIds: [task.taskId],
          requiredEvidenceTypes: ['REVIEW_FINDING'], taskType: 'review:rebuttal', role: 'INDEPENDENT_REVIEWER',
          ordinal: task.ordinal + 1, state: 'RUNNABLE',
        },
      });
      if (created) {
        disagreement = await stepDisagreement({ deps, run, ledger, disagreement, step: { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId }, workerId: input.workerId });
        const entryId = `brain:disagreement-rebuttal:${reReviewTaskId}`;
        await appendBrainEntryAdmitting(deps, {
          runId: run.runId, projectId: run.projectId, taskId: reReviewTaskId, workerId: input.workerId, entryId, kind: 'HANDOFF',
          safeText: [
            `DISAGREEMENT ${disagreement.disagreementId} — RE-REVIEW`,
            `You challenged the ${disagreement.target} of ${disagreement.subjectTaskId} (${disagreement.category}): ${disagreement.reviewerPosition}`,
            `THE PROMPT ARCHITECT MAINTAINS ITS POSITION: ${disagreement.architectArgument ?? ''}`,
            ...disagreement.architectEvidence.map((item) => `EVIDENCE: ${item.locator} — ${item.claim}`),
            'Judge the evidence independently. CONTINUE (or WARNING) accepts the architect\'s position; anything stricter maintains your challenge. This is the last word on this disagreement: a challenge raised here opens no second one.',
          ].join('\n'),
          evidenceIds: disagreement.reviewerEvidenceIds, occurredAt: deps.clock.now(),
        });
        await openJuliusPeerRequestOnLedger(peerContextFor(deps, run, ledger), {
          kind: 'REVIEW_REQUEST', anchor: reReviewTaskId, sourceRole: 'JULIUS', targetRole: 'INDEPENDENT_REVIEWER',
          reason: 'Julius requires an independent re-review of the architect\'s maintained position.',
          subjectTaskId: task.taskId, carrierTaskId: reReviewTaskId, contextRefs: [entryId, disagreement.disagreementId],
          mandatory: true, pausedTaskIds: [disagreement.subjectTaskId], pausedTaskCount: 1, announce: true, workerId: input.workerId,
        });
      }
    }
    return { kind: 'REVIEW_SCHEDULED', taskId: task.taskId, reviewTaskId: reReviewTaskId };
  }
  const decision = await closeRebuttalTask({ deps, run, ledger, request: input.request, task, disagreement, workerId: input.workerId });
  const held = disagreement === undefined ? null : await verifyHeldWork(input, disagreement);
  return held ?? { kind: 'COMPLETED', taskId: task.taskId, workerId: input.workerId, duplicate: input.duplicate, decision };
}

async function settleReReview(
  input: Parameters<typeof verifyExecutedTask>[0] & { readonly tasks: readonly JuliusTask[]; readonly rebuttalTask: JuliusTask; readonly verdict: string | null },
): Promise<JuliusTaskOutcome> {
  const { deps, run, ledger, task } = input;
  const reviewHead = juliusSegmentLineageRootOf(task, input.tasks).taskId;
  let disagreement = disagreementForRebuttal(await disagreementsOf(deps, run), input.rebuttalTask, input.tasks);
  if (disagreement !== undefined && disagreement.status === 'AWAITING_RE_REVIEW' && disagreement.reReviewTaskId === reviewHead) {
    disagreement = await stepDisagreement({ deps, run, ledger, disagreement, step: { kind: 'RE_REVIEW', verdict: input.verdict }, workerId: input.workerId });
  }
  const peers = peerContextFor(deps, run, ledger);
  const verdictEvidence = (await deps.store.evidenceForRun(run.runId, run.projectId)).find((item) => item.taskId === task.taskId && item.type === 'REVIEW_FINDING');
  await moveJuliusPeerRequest(peers, {
    kind: 'REVIEW_REQUEST', anchor: reviewHead, to: 'ANSWERED', from: ['OPEN'], responseRef: verdictEvidence?.evidenceId ?? task.taskId,
    causeRef: `${task.taskId}:verdict`, taskId: input.rebuttalTask.taskId, workerId: input.workerId, firstWrite: true,
  });
  if (disagreement?.status === 'RESOLVED') {
    await moveJuliusPeerRequest(peers, {
      kind: 'REVIEW_REQUEST', anchor: reviewHead, to: 'RESOLVED', from: ['ANSWERED'], transitionCode: `DISAGREEMENT_${disagreement.resolution!}`,
      causeRef: disagreement.disagreementId, taskId: input.rebuttalTask.taskId, workerId: input.workerId, firstWrite: true,
    });
  }
  const decision = await closeRebuttalTask({ deps, run, ledger, request: input.request, task: input.rebuttalTask, disagreement, workerId: input.workerId });
  const held = disagreement === undefined ? null : await verifyHeldWork(input, disagreement);
  return held ?? { kind: 'COMPLETED', taskId: task.taskId, workerId: input.workerId, duplicate: input.duplicate, decision };
}

/**
 * THE RESOLVED MATERIAL DISAGREEMENTS ABOUT THIS WORK, APPLIED.
 *
 * Only material ones: a challenge that did not hold the work was argued beside
 * a decision already made, and its resolution is on the record rather than
 * reopening that decision. The upheld finding is idempotent by the review's id.
 */
async function disagreementRulingFor(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly subject: JuliusTask;
  readonly evidence: readonly JuliusEvidence[];
  readonly workerId: string;
}): Promise<{ readonly recorded: boolean; readonly halt: { readonly reasonCode: string; readonly evidenceIds: readonly string[]; readonly safeSummary: string } | null }> {
  const { deps, run, ledger, subject } = input;
  const known = new Set(input.evidence.map((item) => item.evidenceId));
  const resolved = (await disagreementsOf(deps, run))
    .filter((item) => item.material && item.status === 'RESOLVED' && item.subjectTaskId === subject.taskId);
  let recorded = false;
  let halt: { reasonCode: string; evidenceIds: readonly string[]; safeSummary: string } | null = null;
  for (const disagreement of resolved) {
    const citations = disagreement.reviewerEvidenceIds.filter((id) => known.has(id));
    if (disagreement.resolution === 'ESCALATED') {
      halt = {
        reasonCode: 'DISAGREEMENT_ESCALATED', evidenceIds: citations,
        safeSummary: `The architect's position requires a mission-owned term to change; Julius escalated disagreement ${disagreement.disagreementId} to the mission owner and halted this work.`,
      };
    } else if (disagreement.resolution === 'CHALLENGE_UPHELD' && disagreement.resolutionBasis === 'RE_REVIEW_BLOCKED') {
      halt = {
        reasonCode: 'REVIEW_BLOCKED', evidenceIds: citations,
        safeSummary: `The independent re-review of disagreement ${disagreement.disagreementId} blocked this work; Julius halted it.`,
      };
    }
    if (disagreement.resolution === 'CHALLENGE_UPHELD' && citations.length > 0) {
      const findingId = `finding:disagreement:${disagreement.reviewTaskId}`;
      const written = await deps.store.recordFinding({
        projectId: run.projectId,
        finding: {
          findingId, runId: run.runId, taskId: subject.taskId, reviewerWorkerId: input.workerId,
          severity: 'HIGH', category: disagreement.category,
          claim: `Challenge upheld (${disagreement.resolutionBasis ?? 'no basis'}): ${disagreement.reviewerPosition}`,
          criterionId: null, evidenceIds: citations, blocking: true, status: 'OPEN', createdAt: deps.clock.now(),
        },
      });
      if (written) {
        recorded = true;
        await ledger.event('finding.recorded', {
          taskId: subject.taskId, workerId: input.workerId,
          facts: { findingId, evidenceId: citations[0]!, blocking: true, category: disagreement.category, disagreementId: disagreement.disagreementId },
        });
      }
    }
  }
  return { recorded, halt };
}

/** The id of an unresolved, mandatory challenge against this unit of work, or null. */
async function materialChallengeHolding(
  deps: JuliusPipelineDependencies,
  run: JuliusRunRow,
  subject: JuliusTask,
  tasks: readonly JuliusTask[],
): Promise<string | null> {
  const rows = await readVerdictLedger(deps, run);
  if (rows.length === 0) return null;
  const unit = juliusWorkUnitRootOf(subject, tasks).taskId;
  const byId = new Map(tasks.map((row) => [row.taskId, row]));
  const holding = foldJuliusPeerRequests(rows).find((request) => request.mandatory
    && (request.kind === 'CHALLENGE' || request.kind === 'EVIDENCE_CHALLENGE')
    && (request.status === 'OPEN' || request.status === 'ANSWERED')
    && (() => {
      const challenged = byId.get(request.subjectTaskId);
      return challenged !== undefined && juliusWorkUnitRootOf(challenged, tasks).taskId === unit;
    })());
  return holding?.requestId ?? null;
}

/**
 * WHAT A DECISION DOES TO THE REQUESTS IT ANSWERS.
 *
 * A reviewer's completion ANSWERS Julius's review request — the verdict is on
 * the evidence it left — and the decision that follows RESOLVES it, named for
 * what Julius decided. A RETRY leaves it answered: the review will run again.
 *
 * A decision on guidance settles the coder's question: an accepted packet
 * resolves it; a rejected one REOPENS it, because the answer is still owed and
 * the coder's continuation is still waiting; a halt resolves it as halted. The
 * question is found through the unit's root, so the decision on a repair or a
 * research continuation of the guidance settles the same question.
 *
 * Every move is written only when the ledger says it is legal now, so a resumed
 * verification re-derives the same position and writes nothing twice.
 */
async function settlePeerRequestsForDecision(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly task: JuliusTask;
  readonly subject: JuliusTask;
  readonly reviewedTask: JuliusTask | null;
  readonly tasks: readonly JuliusTask[];
  readonly evidence: readonly { readonly evidenceId: string; readonly taskId: string; readonly type: string }[];
  readonly action: string;
  /** The decision's idempotency key: the cause of every move below, applied once. */
  readonly decisionKey: string;
  readonly workerId: string;
  readonly decisionRecorded: boolean;
}): Promise<void> {
  const peers = peerContextFor(input.deps, input.run, input.ledger);
  const common = {
    taskId: input.subject.taskId, workerId: input.workerId, firstWrite: input.decisionRecorded, causeRef: input.decisionKey,
  };

  if (input.task.role === 'INDEPENDENT_REVIEWER' && input.reviewedTask !== null) {
    const anchor = juliusSegmentLineageRootOf(input.task, input.tasks).taskId;
    const verdictRef = input.evidence.find((item) => item.taskId === input.task.taskId && item.type === 'REVIEW_FINDING')?.evidenceId
      ?? input.task.taskId;
    await moveJuliusPeerRequest(peers, {
      ...common, kind: 'REVIEW_REQUEST', anchor, to: 'ANSWERED', from: ['OPEN'], responseRef: verdictRef,
      causeRef: `${input.task.taskId}:verdict`,
    });
    if (input.action !== 'RETRY') {
      await moveJuliusPeerRequest(peers, {
        ...common, kind: 'REVIEW_REQUEST', anchor, to: 'RESOLVED', from: ['ANSWERED'], transitionCode: `DECIDED_${input.action}`,
      });
    }
  }

  /**
   * A PROPOSED ARCHITECTURE REVISION IS IN FORCE ONLY WHERE ITS CONSULTATION
   * WAS ACCEPTED — before the guidance rule below returns, because an
   * architecture consultation is not a guidance task and would never reach it.
   */
  if (input.action === 'ACCEPT' || input.action === 'COMPLETE') {
    await acceptProposedArchitecture({
      deps: input.deps, run: input.run, ledger: input.ledger,
      proposedByTaskIds: [input.subject.taskId, juliusSegmentLineageRootOf(input.subject, input.tasks).taskId],
      acceptedTaskId: input.task.taskId, workerId: input.workerId, firstWrite: input.decisionRecorded,
    });
  }

  const unit = juliusWorkUnitRootOf(input.subject, input.tasks);
  if (guidanceSubjectTaskId(unit.taskId) === null || input.action === 'RETRY') return;
  const question = { ...common, kind: 'GUIDANCE_QUESTION' as const, anchor: unit.taskId };
  if (input.action === 'ACCEPT' || input.action === 'COMPLETE') {
    /**
     * ACCEPTANCE IS WHAT MAKES A PACKET AUTHORITATIVE, and only an accepted
     * packet reaches the worker that asked: here, and — if this write was lost
     * to a crash — at the waiting continuation's own claim, which looks for
     * the same acceptance (`deliverOwedGuidance`).
     */
    await deliverAcceptedGuidance({
      deps: input.deps, run: input.run, ledger: input.ledger, tasks: input.tasks,
      guidanceTaskId: input.subject.taskId, questionTaskId: unit.taskId, workerId: input.workerId,
      firstWrite: input.decisionRecorded,
    });
    const resolved = await moveJuliusPeerRequest(peers, {
      ...question, to: 'RESOLVED', from: ['ANSWERED'], transitionCode: 'ANSWER_ACCEPTED',
    });
    // Accepted work that never produced a readable packet closed the question
    // without answering it, and the record says exactly that.
    if (resolved.outcome === 'NOT_MOVED') {
      await moveJuliusPeerRequest(peers, {
        ...question, to: 'RESOLVED', from: ['OPEN'], transitionCode: 'ACCEPTED_WITHOUT_ANSWER',
      });
    }
    return;
  }
  if (input.action === 'REPAIR') {
    await moveJuliusPeerRequest(peers, { ...question, to: 'OPEN', from: ['ANSWERED'], transitionCode: 'ANSWER_REJECTED' });
    return;
  }
  if (input.action === 'HALT') {
    await moveJuliusPeerRequest(peers, { ...question, to: 'RESOLVED', from: ['OPEN', 'ANSWERED'], transitionCode: 'ANSWER_HALTED' });
  }
}

/** The peer channel's view of one runtime tick: this run, this attempt, this ledger. */
function peerContextFor(deps: JuliusPipelineDependencies, run: JuliusRunRow, ledger: RuntimeLedger): JuliusPeerRuntimeContext {
  return {
    runId: run.runId,
    projectId: run.projectId,
    missionId: run.missionId,
    executionScope: deps.executionScope ?? JULIUS_LOCAL_EXECUTION_SCOPE,
    now: () => deps.clock.now(),
    ...(deps.timeline === undefined ? {} : { timeline: deps.timeline }),
    emit: (type, input) => ledger.event(type, input),
  };
}

/* ------------------------------------------------------- the verification */

/**
 * EVERY BRAIN WRITE ADMITS A CLAIM. The entry goes to the store as it always
 * did; when it is new, the claim ledger's derivation of that same entry is
 * recorded as its first standing, so the durable claim and the derived one
 * agree at birth. A replayed append (false) admits nothing again.
 */
async function appendBrainEntryAdmitting(deps: JuliusPipelineDependencies, input: JuliusBrainAppend): Promise<boolean> {
  const appended = await deps.store.appendBrainEntry(input);
  if (!appended) return false;
  await deps.store.recordClaimStanding({
    runId: input.runId, projectId: input.projectId,
    claim: juliusAdmittedClaimFor(input), reason: 'ADMITTED', occurredAt: input.occurredAt,
  });
  return true;
}

async function promoteClaimsOnAcceptedReview(input: {
  readonly deps: JuliusPipelineDependencies;
  readonly run: JuliusRunRow;
  readonly ledger: RuntimeLedger;
  readonly subject: JuliusTask;
  readonly reviewTask: JuliusTask;
  readonly reviewer: string;
  readonly evidence: ReadonlyArray<{ readonly taskId: string; readonly evidenceId: string }>;
}): Promise<void> {
  const { deps, run, ledger, subject, reviewTask } = input;
  const [claims, entries] = await Promise.all([
    deps.store.claimsForRun(run.runId, run.projectId),
    deps.store.brainEntriesForRun(run.runId, run.projectId),
  ]);
  const at = deps.clock.now();
  const outcome = juliusClaimPromotionsOnAccept({
    claims, entries, subjectTaskId: subject.taskId, by: input.reviewer, at,
    reviewEvidenceIds: input.evidence.filter((item) => item.taskId === reviewTask.taskId).map((item) => item.evidenceId),
  });
  for (const promotion of outcome.promoted) {
    const recorded = await deps.store.recordClaimStanding({
      runId: run.runId, projectId: run.projectId, claim: promotion.claim, reason: 'REVIEW_ACCEPTED', occurredAt: at,
    });
    // ANNOUNCE FACTS: the event follows the durable write, and only a write.
    if (recorded) {
      await ledger.event('claim.promoted', {
        taskId: subject.taskId, workerId: input.reviewer,
        facts: {
          claimId: promotion.claim.claimId, entryId: promotion.claim.entryId,
          from: promotion.from, to: promotion.claim.trust,
          reviewTaskId: reviewTask.taskId, evidenceCount: promotion.claim.evidence.length,
        },
      });
    }
  }
  // A refusal is a fact about the record too: a reviewer who turns out to be
  // the asserter, or a review that cites nothing, is why a memory stayed where
  // it was — and a reader asking "why is this still SUPPORTED" needs it.
  for (const refusal of outcome.refused) {
    await ledger.event('claim.promotion.refused', {
      taskId: subject.taskId, workerId: input.reviewer,
      facts: { claimId: refusal.claimId, reasonCode: refusal.reasonCode, reviewTaskId: reviewTask.taskId },
    });
  }
}

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
  const [tasks, evidence, findings, criteria, decisions] = await Promise.all([
    deps.store.tasksForRun(run.runId, run.projectId),
    deps.store.evidenceForRun(run.runId, run.projectId),
    effectiveFindingsOf(deps, run),
    deps.store.criteriaForRun(run.runId, run.projectId),
    deps.store.decisionsForRun(run.runId, run.projectId),
  ]);
  /**
   * WHETHER THE WORK WAS REVIEWED, read from the task rows — one rule, shared
   * with the liveness judgement in `canStillBeAccepted`, rather than a store
   * query that counted any reviewer child that had succeeded.
   */
  const review = juliusReviewConclusionOf(task, tasks);
  const reviewCompleted = review.conclusion === 'CONCLUDED';

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
   * A DISPATCH THAT YIELDED IS NOT FINISHED WORK, AND IS NOT JUDGED AS IF IT WERE.
   *
   * It ended at a barrier — it asked the architect, or asked Julius to read
   * something — and Julius minted the segment that carries it on. Reviewing it
   * here asked a reviewer whether half the work was the whole of it, and the
   * answer is always no. Qualification attempt 3 (run 34766115321) did exactly
   * that for all ten of its pauses: each review sent the yielded dispatch to
   * REPAIR while its continuation also ran, so every question a worker asked
   * forked the deliverable into two lines of work, and the fork is where most of
   * that run's 15 repair tasks came from.
   *
   * The review obligation passes to the continuation, and through it to the
   * unit's last segment: that is the task that ends without yielding, and its
   * review sees the whole unit's work. The yielded dispatch is accepted exactly
   * when its continuation is (`effectivelyAcceptedTaskIds`), so completion and
   * release need no second rule. Replays and resumed verifications reach this
   * branch from the durable rows, not from a flag on this call.
   */
  /*
   * AND A REVIEWER THAT PAUSED HAS NOT CONCLUDED. Its dispatch ended at a
   * research ask; what it said before it looked is kept on the record and never
   * applied. Reproduced before this: a reviewer that approved and asked to check
   * a manual had its approval decided at once — the plan accepted and the build
   * released — while the continuation that read the answer ran later and found
   * the plan wrong. The verdict that applies is the one written after the answer.
   */
  const continuation = juliusYieldContinuationOf(task, tasks);
  if (continuation !== null) {
    return { kind: 'YIELDED', taskId: task.taskId, workerId: input.workerId, continuationTaskId: continuation.taskId };
  }

  /**
   * A REBUTTAL IS SETTLED BY ITS DISAGREEMENT, NEVER BY THE EVALUATOR. Reviewed
   * and repaired like ordinary work, a maintained rebuttal the re-review
   * disagreed with would be sent to repair — and the argument would go round
   * again. It gets exactly one re-review, and then Julius resolves it.
   */
  /**
   * A REVIEW WHOSE RESEARCH FAILED NEVER CONCLUDED, AND DECIDES NOTHING.
   *
   * The reviewer asked Julius to read something before judging, and the
   * continuation that would have judged with the answer failed. What it said
   * before it looked stays on the record as history; it is not applied, the work
   * is neither accepted nor repaired on it, nothing that depends on the work is
   * released, and the reason is written once.
   */
  if (task.role !== 'INDEPENDENT_REVIEWER' && review.conclusion === 'RESEARCH_FAILED') {
    const reviewTaskId = review.reviewTaskId!;
    const failedSegmentTaskId = review.failedSegmentTaskId!;
    const recorded = (await readVerdictLedger(deps, run)).some((row) => row.type === 'review.verdict.refused'
      && row.facts.reasonCode === 'review_research_continuation_failed' && row.facts.reviewTaskId === reviewTaskId);
    if (!recorded) {
      await ledger.event('review.verdict.refused', {
        taskId: task.taskId, workerId: input.workerId,
        facts: {
          reviewTaskId, reasonCode: 'review_research_continuation_failed', failedSegmentTaskId,
        },
      });
    }
    return { kind: 'UNREVIEWED', taskId: task.taskId, reasonCode: 'REVIEW_RESEARCH_FAILED', reviewTaskId, failedSegmentTaskId };
  }

  if (task.role === 'PROMPT_ARCHITECT' && task.taskType === 'rebuttal') {
    return settleRebuttal({ ...input, tasks });
  }

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
  const reviewedTask = juliusReviewedWorkOf(task, tasks);
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
  if (reviewedTask !== null) {
    for (const item of evidence) {
      if (item.taskId !== task.taskId || item.type !== 'REVIEW_FINDING' || item.status !== 'FAILED') continue;
      const recorded = await deps.store.recordFinding({
        projectId: run.projectId,
        finding: {
          findingId: `finding:${item.evidenceId}`,
          runId: run.runId,
          taskId: reviewedTask.taskId,
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
          taskId: reviewedTask.taskId, workerId: item.workerId,
          // THE REVIEW THAT RAISED IT, so the finding's life has an origin and a
          // re-review can be matched to the judgement it is revisiting.
          facts: { findingId: `finding:${item.evidenceId}`, evidenceId: item.evidenceId, blocking: true, reviewTaskId: task.taskId },
        });
        await ledger.trajectory('FINDING', {
          taskId: reviewedTask.taskId, workerId: item.workerId,
          policyRevision: input.request.verification.revision, outcome: 'BLOCKING',
        });
      }
    }
  }

  /**
   * THE REVIEWER'S VERDICT, APPLIED — the stricter of what it declared and what
   * its evidence shows, routed by Julius. Warnings become non-blocking findings,
   * a challenge becomes a challenge request and never a contract revision, a
   * required repair becomes a blocking finding, a BLOCK becomes a HALT.
   */
  const applied = reviewedTask === null ? null : await applyReviewVerdict({
    deps, run, ledger, review: task, reviewed: reviewedTask, tasks, evidence,
    policy: input.request.verification, request: input.request, workerId: input.workerId,
  });

  // THE ONE RE-REVIEW OF A MAINTAINED POSITION resolves its disagreement.
  if (reviewedTask !== null && reviewedTask.taskType === 'rebuttal' && reviewedTask.role === 'PROMPT_ARCHITECT') {
    return settleReReview({ ...input, tasks, rebuttalTask: reviewedTask, verdict: applied?.verdict ?? null });
  }

  /**
   * A MATERIAL CHALLENGE HOLDS THE WORK. Read from the ledger, not from this
   * call, so a resumed verification of the same work is held the same way and
   * cannot accept it past an argument nobody has settled.
   */
  const held = await materialChallengeHolding(deps, run, subject, tasks);
  if (held !== null) {
    // The reviewer did answer Julius's request; Julius has not decided on it.
    if (reviewedTask !== null) {
      await moveJuliusPeerRequest(peerContextFor(deps, run, ledger), {
        kind: 'REVIEW_REQUEST', anchor: juliusSegmentLineageRootOf(task, tasks).taskId, to: 'ANSWERED', from: ['OPEN'],
        responseRef: held, causeRef: `${task.taskId}:verdict`, taskId: subject.taskId, workerId: input.workerId, firstWrite: true,
      });
    }
    return { kind: 'HELD', taskId: task.taskId, reasonCode: 'MATERIAL_CHALLENGE_UNRESOLVED', requestId: held };
  }

  /**
   * WHAT A RESOLVED DISAGREEMENT MEANS FOR THIS WORK. An upheld material
   * challenge becomes a blocking finding, so the evaluator repairs the work; an
   * escalation, or a re-review that blocked, halts it; the architect's position
   * upheld changes nothing, and the work is judged on its evidence.
   */
  const ruling = await disagreementRulingFor({ deps, run, ledger, subject, evidence, workerId: input.workerId });

  /**
   * WHAT A REPAIR'S RE-REVIEW WAS CHARGED WITH, AND WHAT IT LEFT UNANSWERED.
   *
   * The review of a repair is asked about the findings the repair exists for —
   * recorded on the work, on earlier rounds, on the unit. Its resolutions have
   * just been applied, so a charged finding that is still ADDRESSED is one the
   * reviewer said nothing about. Silence is not resolution: each is refused by
   * name, stays unresolved, and the repair is not accepted on its strength.
   *
   * WHICHEVER TASK THE VERIFICATION ENTERED THROUGH. A crash between the refusal
   * and the decision is resumed by verifying the repair ITSELF, not its review;
   * reading the charge only from the review's side let that resumed verification
   * accept the repair over the very finding it had just refused. The charge
   * belongs to the repair's concluded review, found from the task rows.
   */
  const chargingReview = reviewedTask !== null
    ? task
    : review.conclusion === 'CONCLUDED' ? tasks.find((item) => item.taskId === review.reviewTaskId) ?? null : null;
  const charged = subject.taskType.startsWith('repair:') && chargingReview !== null && deps.timeline !== undefined
    ? await chargedFindingsOf({ deps, run, ledger, review: chargingReview, reviewed: subject, tasks, workerId: input.workerId })
    : { silent: [], maintained: [] };

  /**
   * A REPAIR THAT SUCCEEDED HAS ADDRESSED THE FINDINGS IT EXISTS FOR — and that
   * is all it has done. The reviewer's re-review is the only thing that resolves
   * one; this row is what makes "someone acted" distinguishable from "it worked".
   */
  if (task.taskType.startsWith('repair:') && reviewedTask === null) {
    await markFindingsAddressed({ deps, run, ledger, repair: task, tasks, findings, workerId: input.workerId });
  }

  const evaluated = evaluateJuliusVerification({
    task: subject,
    evidence,
    criteria,
    // The findings the reviewer just recorded are read back, because
    // `findings` was loaded before this task ran and a decision made without
    // them would be a decision about a review that had not happened yet.
    findings: reviewedTask === null && !ruling.recorded && charged.silent.length === 0 ? findings : await effectiveFindingsOf(deps, run),
    policy: input.request.verification,
    reviewCompleted: reviewSatisfied,
    allTasks: tasks,
    priorDecisions: decisions,
  });
  /**
   * A BLOCK IS A HALT, AND JULIUS WRITES IT. The evaluator would read the
   * blocking finding as a reason to repair; a reviewer that said the work must
   * not continue is not asking for another attempt at it.
   */
  const halt = applied?.route === 'HALT'
    ? {
      reasonCode: 'REVIEW_BLOCKED',
      evidenceIds: evidence.filter((item) => item.taskId === task.taskId).map((item) => item.evidenceId),
      safeSummary: `The independent reviewer blocked this work (${applied.category ?? 'uncategorised'}); Julius halted it.`,
    }
    : ruling.halt;
  /**
   * A REPAIR IS NOT ACCEPTED OVER A FINDING NOBODY RESOLVED.
   *
   * The evaluator counts findings on the task it decides — the repair — and the
   * findings a repair answers live on the work it repairs. So a repair whose
   * re-review left the original finding ADDRESSED was accepted, the work counted
   * as accepted through it, and the run completed over the open problem.
   *   silent     the re-review never answered a charged finding: Julius will not
   *              buy another round on a reviewer's silence, and halts with
   *              FINDINGS_UNRESOLVED, naming them.
   *   maintained the re-review said the problem is still there: the next repair
   *              round is what answers it, exactly as the lifecycle designs.
   */
  const unresolved = halt === null && evaluated.action === 'DECIDE' && evaluated.decision.action === 'ACCEPT'
    ? charged.silent.length > 0
      ? {
        action: 'HALT' as const, reasonCode: 'FINDINGS_UNRESOLVED',
        evidenceIds: [...new Set(charged.silent.flatMap((life) => life.evidenceIds))],
        safeSummary: `The re-review of this repair did not answer ${String(charged.silent.length)} finding(s) it was charged with (${charged.silent.map((life) => life.findingId).join(', ').slice(0, 300)}); an unanswered finding is not resolved.`,
      }
      : charged.maintained.length > 0
        ? {
          action: 'REPAIR' as const, reasonCode: 'BLOCKING_FINDINGS',
          evidenceIds: [...new Set(charged.maintained.flatMap((life) => life.evidenceIds))],
          safeSummary: `The re-review of this repair says ${String(charged.maintained.length)} finding(s) are still open; another round must answer them.`,
        }
        : null
    : null;
  const action = halt !== null && evaluated.action === 'DECIDE'
    ? { ...evaluated, missionCompletable: false, decision: { action: 'HALT' as const, ...halt } }
    : unresolved !== null && evaluated.action === 'DECIDE'
      ? { ...evaluated, missionCompletable: false, decision: unresolved }
      : evaluated;

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

    /**
     * WHAT THE REVIEWER REJECTED, WHAT THE REPAIR CLAIMS, AND WHAT ACTUALLY
     * MOVED — bounded, structured, and scoped to this review alone.
     *
     * A re-review used to be handed the repair's evidence and asked whether
     * prior findings were resolved, without being shown what it had rejected or
     * what changed. It answered from a memory it does not have.
     */
    if (created && task.taskType.startsWith('repair:') && task.parentTaskId !== null) {
      /**
       * EVERY OUTSTANDING FINDING OF THE UNIT, not of the last round.
       *
       * Repairs nest: round two repairs round one, so its parent is a repair
       * rather than the work. Reading findings off the parent alone would hide
       * the finding the whole lineage exists to answer from the reviewer being
       * asked whether it is answered.
       */
      const unit = unitWorkTaskIds(task, tasks);
      const all = await findingLivesOf(deps, run, await effectiveFindingsOf(deps, run));
      const lives = all.filter((life) => unit.has(life.taskId) && juliusFindingIsUnresolved(life, all));
      const diff = juliusRepairRoundDiff({
        repairTaskId: task.taskId,
        repairedTaskId: task.parentTaskId,
        // `repairRoundsBefore` counts this round's own task, so it IS the round.
        round: repairRoundsBefore(task, tasks),
        findings: lives,
        evidence: evidence.map((item) => ({ taskId: item.taskId, type: item.type, status: item.status, safeSummary: item.safeSummary })),
        repairSummary: evidence.filter((item) => item.taskId === task.taskId).at(-1)?.safeSummary ?? null,
      });
      await appendBrainEntryAdmitting(deps, {
        runId: run.runId, projectId: run.projectId, taskId: reviewTaskId, workerId: input.workerId,
        entryId: juliusRepairRoundEntryId(reviewTaskId), kind: 'FINDING',
        safeText: renderJuliusRepairRoundDiff(diff), evidenceIds: [], occurredAt: deps.clock.now(),
      });
      await ledger.event('review.started', {
        taskId: reviewTaskId,
        facts: {
          reviewsTaskId: task.taskId, created: false, repairRoundDiff: true, round: diff.round,
          findingsToAnswer: diff.findings.length, gainedEvidence: diff.gainedTypes.length, lostEvidence: diff.lostTypes.length,
        },
      });
    }
    /**
     * JULIUS ASKS THE REVIEWER, ON THE RECORD. The review task is the carrier;
     * the request names the work that cannot start until Julius decides on what
     * was reviewed — every BLOCKED task gated on this unit — and that pause is
     * the release rule's, which moves nothing out of BLOCKED before an accepting
     * decision. Opened with the task's own write, so a replay opens nothing.
     */
    if (created) {
      const unitRoot = juliusWorkUnitRootOf(task, tasks);
      const paused = juliusPeerIdsThatFit(tasks
        .filter((row) => row.state === 'BLOCKED'
          && (row.dependencyIds.includes(task.taskId) || row.dependencyIds.includes(unitRoot.taskId)))
        .map((row) => row.taskId));
      await openJuliusPeerRequestOnLedger(peerContextFor(deps, run, ledger), {
        kind: 'REVIEW_REQUEST', anchor: reviewTaskId,
        sourceRole: 'JULIUS', targetRole: 'INDEPENDENT_REVIEWER',
        reason: 'Julius requires an independent review of completed work before it is accepted.',
        subjectTaskId: task.taskId, carrierTaskId: reviewTaskId, contextRefs: [task.taskId],
        mandatory: true, pausedTaskIds: paused.ids, pausedTaskCount: paused.total,
        announce: true,
      });
    }
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
      ? (await effectiveFindingsOf(deps, run))
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

  /**
   * THE DECISION AND THE HISTORY THAT EXPLAINS IT GO IN TOGETHER.
   *
   * `verification.decided` and the `task.runnable` rows for what this decision
   * released used to be appended after this call returned. A crash in between
   * left the decision and the release standing with neither recorded, and
   * nothing ever wrote them: the resume sweep skips a task that already has a
   * decision. The history could not say the verification had been decided, or
   * that a build had become claimable, while the rows saying exactly that sat
   * beside it.
   *
   * Their ids come from the decision's OWN idempotency key, so two processes
   * deciding the same thing name the same events, and the store's append
   * contract recognises the second as the replay it is.
   */
  const decisionKey = `${subject.taskId}:${decision.action}:${decision.reasonCode}`;
  const byId = new Map(tasks.map((value) => [value.taskId, value]));
  const decisionRecorded = await deps.store.appendDecision({
    decisionId: deps.ids.next('decision'),
    runId: run.runId,
    taskId: subject.taskId,
    policyRevision: input.request.verification.revision,
    idempotencyKey: decisionKey,
    occurredAt: deps.clock.now(),
    decision,
    releaseTaskIds: release.releasable,
    events: [
      ledger.compose('verification.decided', {
        taskId: subject.taskId, workerId: input.workerId,
        facts: {
          action: decision.action, reasonCode: decision.reasonCode,
          criteriaSatisfied: action.criteriaSatisfied.length, criteriaMissing: action.criteriaMissing.length,
          missionCompletable: action.missionCompletable,
          released: release.releasable.length,
          reviewVerdict: applied?.verdict ?? null,
          reviewRoute: applied?.route ?? null,
        },
      }, juliusDecisionEventId(decisionKey, 'verification.decided', 0)),
      /**
       * `task.runnable` announces exactly what this write released — a fact
       * the claim query will act on. Only an ACCEPT or a COMPLETE releases
       * anything; for every other action `releasable` is empty, so this names
       * nothing without having to ask which action it is.
       */
      ...release.releasable.map((taskId, ordinal) => ledger.compose('task.runnable', {
        taskId,
        facts: {
          unblockedBy: subject.taskId,
          role: byId.get(taskId)?.role ?? null,
          taskType: byId.get(taskId)?.taskType ?? null,
        },
      }, juliusDecisionEventId(decisionKey, 'task.runnable', ordinal))),
    ],
  });
  /**
   * A REVIEWER'S ACCEPTANCE IS WHAT PROMOTES A MEMORY. The entries the
   * reviewed task wrote were admitted at whatever standing their kind and
   * citations earned; an Independent Reviewer accepting that task is the
   * evidence that raises them to VERIFIED — through the trust core, which is
   * what refuses a reviewer who is the asserter. Only on a decision this tick
   * recorded: a replayed decision promotes nothing twice.
   */
  if (decisionRecorded && decision.action === 'ACCEPT' && task.role === 'INDEPENDENT_REVIEWER' && task.taskId !== subject.taskId) {
    await promoteClaimsOnAcceptedReview({ deps, run, ledger, subject, reviewTask: task, reviewer: input.workerId, evidence });
  }
  await ledger.trajectory('VERIFICATION', {
    taskId: subject.taskId, workerId: input.workerId,
    policyRevision: input.request.verification.revision, outcome: decision.action,
    facts: { reasonCode: decision.reasonCode, criteriaMissing: action.criteriaMissing.length },
  });

  await settlePeerRequestsForDecision({
    deps, run, ledger, task, subject, reviewedTask, tasks, evidence,
    action: decision.action, decisionKey: `${subject.taskId}:${decision.action}:${decision.reasonCode}`,
    workerId: input.workerId, decisionRecorded,
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
    await appendBrainEntryAdmitting(deps, {
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
      findings: await effectiveFindingsOf(deps, run),
    });
  }
  if (decision.action === 'ACCEPT' || decision.action === 'COMPLETE') {
    // `task.runnable` went in with the decision that released them: a duplicate
    // decision released nothing, so it announced nothing, and a crash can no
    // longer separate the release from the record of it.
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
  workerId: string;
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
  /**
   * WHAT JULIUS ACCEPTED FOR THIS WORK IS STILL ACCEPTED WHILE IT IS REPAIRED.
   *
   * Carry-forward followed the segment lineage only, and a repair is its own
   * root — so the round sent to fix the work was the one dispatch of the unit
   * that could not see the guidance the work was built on. Guarded by the
   * repair's own write, so a replay carries nothing twice.
   */
  if (created) {
    const unit = juliusWorkUnitRootOf(task, input.tasks).taskId;
    await carryAcceptedGuidanceForward({
      deps, run, ledger,
      lineage: input.tasks.filter((item) => juliusWorkUnitRootOf(item, input.tasks).taskId === unit),
      continuationTaskId: plan.task.taskId, workerId: input.workerId,
    });
  }
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
      // Execution a subscription dispatch consumed is held like a bill would be:
      // the billing mode must not change what the mission can still lend.
      held[slot] = account.outstandingUsdMicros
        + account.settledKnownUsdMicros + account.settledUnknownUsdMicros
        + account.settledExecutionUsdMicros;
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
  // THE REPAIR, NOT THE PAUSE, AND THE WHOLE UNIT. A repair that paused
  // continues as `segment:repair:…`; its findings, and every earlier round's
  // unresolved ones, are on the unit the repair belongs to.
  let work: JuliusTask | null = null;
  if (task.taskType.startsWith('repair:')) work = task;
  else if (task.taskType.startsWith('review:repair:')) work = juliusReviewedWorkOf(task, tasks);
  if (work === null) return [];
  const unit = unitWorkTaskIds(work, tasks);
  // `status` here is the lifecycle's (`juliusEffectiveFindings`): OPEN means unresolved.
  return findings.filter((finding) => unit.has(finding.taskId) && finding.blocking && finding.status === 'OPEN');
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

/**
 * ONE LINE OF JULIUS'S RESEARCH RECORD, as a later packet carries it.
 * Numbers and identifiers only: the host and scrubbed path, never the query,
 * fragment, purpose or any text of the page.
 */
export function juliusResearchServedLine(input: {
  readonly role: string;
  readonly checkpointId: string;
  readonly continuationTaskId: string;
  readonly observation: JuliusResearchObservationRecord;
}): string {
  const { observation } = input;
  const delivery = observation.delivery;
  if (delivery === null || delivery === undefined) throw new Error('research_served_line_without_delivery');
  const host = observation.requested?.host ?? null;
  const where = host === null ? 'an unparseable reference' : `https://${host}${observation.requested?.path ?? ''}`;
  const bytes = delivery.fetchedBytes === null ? 'an unreported number of bytes' : `${String(delivery.fetchedBytes)} bytes`;
  const handed = delivery.cut
    ? `characters ${String(delivery.deliveredFrom + 1)}–${String(delivery.deliveredFrom + delivery.deliveredChars)} of ${String(delivery.readableChars)}`
    : `all ${String(delivery.readableChars)} readable characters`;
  return `RESEARCH SERVED (Julius's record, no page text): the ${input.role} asked at ${input.checkpointId} for ${where}; `
    + `${observation.outcome}; ${bytes} fetched by ${delivery.mechanism ?? 'an unreported backend'}; body ${delivery.contentDigest}; `
    + `${handed} handed to ${input.continuationTaskId}.`;
}
