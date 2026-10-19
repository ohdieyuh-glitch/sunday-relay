/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * The deterministic validation pipeline (PURE — context is never mutated).
 *
 * One ordered pipeline evaluates every interpreted command:
 *
 *   1  mission exists                13  evidence/reviews evaluated
 *   2  mission revision matches      14  stale-review consequences
 *   3  target tasks exist            15  reviewer independence
 *   4  task revisions match          16  Agent Passport compatibility
 *   5  target agents exist           17  permission compatibility
 *   6  entity states compatible      18  workspace compatibility
 *   7  Milestone 1 transitions valid 19  Mission Contract conflicts
 *   8  ownership identified          20  security-policy conflicts
 *   9  partial work identified       21  budget consequences
 *   10 child processes identified    22  command risk
 *   11 checkpoint requirement        23  human-approval requirement
 *   12 dependencies evaluated        24  atomic applicability
 *
 * Unsafe, ambiguous, stale, or impossible commands are REJECTED with
 * structured errors and zero state changes. Steps 16–17 share the permission
 * module (the passport is a permission record in this milestone).
 */

import {
  applyStatusTransition,
  type AqualaOutcomeStatus,
  type AqualaStatusDimension,
  AQUALA_STATUS_VALUES,
} from '../status/status-model';
import { calculateCheckpointRequirements } from './command-checkpoint';
import type { RelayMissionCommandContext } from './command-context';
import { cloneCommandContext, findActiveRunForTask, findAgent, findTask } from './command-context';
import { analyzeDependencyImpact, findUnmetPrerequisites, type DependencyImpact } from './command-dependencies';
import { commandError, type RelayMissionCommandError } from './command-errors';
import { evaluateReviewerIndependence, type IndependenceAssessment } from './command-independence';
import { evaluatePermissionCompatibility, type PermissionAssessment } from './command-permissions';
import { projectCommandPreview, type RelayMissionCommandPreview } from './command-preview';
import {
  calculateApprovalRequirement,
  calculateCommandRisk,
  type CommandRiskInput,
} from './command-risk';
import type {
  RelayCommandCheckpointRequirement,
  RelayCommandPrerequisite,
  RelayMissionCommand,
  RelayMissionCommandDraft,
  RelayStateChange,
} from './command-types';
import { evaluateWorkspaceCompatibility, type WorkspaceAssessment } from './command-workspace';

/* ------------------------------------------------------------- results */

export interface CommandValidationAnalyses {
  checkpoints: RelayCommandCheckpointRequirement[];
  dependencies: DependencyImpact;
  independence: IndependenceAssessment;
  permissions: PermissionAssessment;
  workspace: WorkspaceAssessment;
  riskInput: CommandRiskInput;
  /** Current owner of every target task, identified before any change. */
  currentOwnership: Record<string, string | null>;
  /** Child-process references were identified on targeted active runs. */
  childProcessesPresent: boolean;
}

export type RelayMissionCommandValidationResult =
  | {
      ok: true;
      validatedCommand: RelayMissionCommand;
      preview: RelayMissionCommandPreview;
      prerequisites: RelayCommandPrerequisite[];
      analyses: CommandValidationAnalyses;
    }
  | {
      ok: false;
      rejectedCommand: RelayMissionCommand;
      errors: RelayMissionCommandError[];
      preview?: RelayMissionCommandPreview;
    };

export interface ValidateMissionCommandInput {
  commandId: string;
  draft: RelayMissionCommandDraft;
  context: RelayMissionCommandContext;
}

/* ------------------------------------------------------------- helpers */

/** The entity's CURRENT state in the vocabulary the change speaks — used at
    validation time and again by the executor immediately before applying. */
export function currentEntityState(
  change: RelayStateChange,
  context: RelayMissionCommandContext,
): string | undefined {
  const dimensionValue = (status: AqualaOutcomeStatus, d: AqualaStatusDimension): string =>
    d === 'execution'
      ? status.executionStatus
      : d === 'outcome'
        ? status.outcomeStatus
        : d === 'verification'
          ? status.verificationStatus
          : status.releaseStatus;

  switch (change.entityType) {
    case 'mission': {
      if (change.statusDimension) {
        return dimensionValue(context.mission.status, change.statusDimension);
      }
      const key = change.requestedState.split(':')[0];
      return `${key}:${context.mission.annotations[key] ?? 'none'}`;
    }
    case 'task': {
      const task = findTask(context, change.entityId);
      if (!task) return undefined;
      if (change.statusDimension) return dimensionValue(task.status, change.statusDimension);
      if (change.requestedState.startsWith('owner:')) return `owner:${task.ownerAgentId ?? 'none'}`;
      if (change.requestedState.startsWith('priority:')) return `priority:${task.priority}`;
      if (change.requestedState.startsWith('output_target:')) {
        return `output_target:${task.outputTarget}`;
      }
      return undefined;
    }
    case 'agent_run': {
      const run = context.agentRuns.find((r) => r.runId === change.entityId);
      return run?.state;
    }
    case 'workspace': {
      const workspace = context.workspaces.find((w) => w.workspaceId === change.entityId);
      if (!workspace) return undefined;
      return `write_owner:${workspace.writeOwnerAgentId ?? 'none'}`;
    }
    case 'review': {
      const review = context.reviews.find((r) => r.reviewId === change.entityId);
      return review?.status;
    }
    case 'permission': {
      const agent = findAgent(context, change.entityId);
      if (!agent) return undefined;
      if (change.requestedState.startsWith('production_writes:')) {
        return `production_writes:${agent.passport.permissions.productionAccess ? 'allowed' : 'prohibited'}`;
      }
      if (change.requestedState.startsWith('network:')) {
        return `network:${agent.passport.permissions.networkPolicy}`;
      }
      return undefined;
    }
    case 'budget':
      return `max_usd:${context.mission.budget.maximumSpendUsd ?? 'none'}`;
    default:
      return undefined;
  }
}

function staticDimensionValidity(change: RelayStateChange): boolean {
  if (!change.statusDimension) return true;
  const values = AQUALA_STATUS_VALUES[change.statusDimension] as readonly string[];
  return values.includes(change.requestedState);
}

/* ------------------------------------------------------------ pipeline */

export function validateMissionCommand(
  input: ValidateMissionCommandInput,
): RelayMissionCommandValidationResult {
  const { commandId, draft } = input;
  const context = input.context;
  const errors: RelayMissionCommandError[] = [];

  const buildCommand = (
    status: RelayMissionCommand['status'],
    extras: Partial<RelayMissionCommand> = {},
  ): RelayMissionCommand => ({
    commandId,
    projectId: draft.projectId,
    missionId: draft.missionId,
    issuedByUserId: draft.issuedByUserId,
    issuedAt: draft.issuedAt,
    naturalLanguageRequest: draft.naturalLanguageRequest,
    intent: draft.intent,
    secondaryIntents: [...draft.secondaryIntents],
    targetTaskIds: [...draft.targetTaskIds],
    targetAgentIds: [...draft.targetAgentIds],
    interpretedChanges: draft.interpretedChanges.map((c) => ({ ...c })),
    affectedDependencies: [],
    affectedWorkspaces: [],
    affectedReviews: [],
    affectedFindings: [],
    checkpointRequired: false,
    approvalRequired: false,
    independenceRiskDetected: false,
    permissionChangeDetected: false,
    risk: 'low',
    riskFactors: [],
    status,
    missionRevision: draft.missionRevision,
    taskRevisions: { ...draft.taskRevisions },
    executionEventIds: [],
    ...extras,
  });

  const rejectNow = (): RelayMissionCommandValidationResult => ({
    ok: false,
    rejectedCommand: buildCommand('rejected', {
      rejectionReason: errors.map((e) => `${e.code}: ${e.reason}`).join('; '),
    }),
    errors,
  });

  /* 1 — mission exists. */
  if (draft.missionId !== context.mission.missionId) {
    errors.push(
      commandError(
        'MISSION_NOT_FOUND',
        `mission ${draft.missionId} is not the mission in context (${context.mission.missionId})`,
        'refresh the mission context and re-issue the command',
        { commandId, entityType: 'mission', entityId: draft.missionId },
      ),
    );
    return rejectNow();
  }

  /* 2 — mission revision matches. */
  if (draft.missionRevision !== context.mission.missionRevision) {
    errors.push(
      commandError(
        'STALE_MISSION_REVISION',
        'the command was interpreted against an older mission revision',
        'refresh the mission context and re-issue the command',
        {
          commandId,
          entityType: 'mission',
          entityId: draft.missionId,
          expected: String(context.mission.missionRevision),
          actual: String(draft.missionRevision),
        },
      ),
    );
    return rejectNow();
  }

  /* 3 — target tasks exist. */
  const taskIdsToCheck = new Set([
    ...draft.targetTaskIds,
    ...draft.interpretedChanges.filter((c) => c.entityType === 'task').map((c) => c.entityId),
  ]);
  for (const taskId of taskIdsToCheck) {
    if (!findTask(context, taskId)) {
      errors.push(
        commandError(
          'TASK_NOT_FOUND',
          `task ${taskId} does not exist in mission ${draft.missionId}`,
          'refresh the mission context or name an existing task',
          { commandId, entityType: 'task', entityId: taskId },
        ),
      );
    }
  }

  /* 4 — task revisions match. */
  for (const [taskId, revision] of Object.entries(draft.taskRevisions)) {
    const task = findTask(context, taskId);
    if (task && task.taskRevision !== revision) {
      errors.push(
        commandError(
          'STALE_TASK_REVISION',
          `task ${taskId} moved from revision ${revision} to ${task.taskRevision} after interpretation`,
          'refresh the mission context and re-issue the command',
          {
            commandId,
            entityType: 'task',
            entityId: taskId,
            expected: String(task.taskRevision),
            actual: String(revision),
          },
        ),
      );
    }
  }
  for (const change of draft.interpretedChanges) {
    if (change.entityType !== 'task' || change.expectedRevision === undefined) continue;
    const task = findTask(context, change.entityId);
    if (task && task.taskRevision !== change.expectedRevision) {
      const already = errors.some(
        (e) => e.code === 'STALE_TASK_REVISION' && e.entityId === change.entityId,
      );
      if (!already) {
        errors.push(
          commandError(
            'STALE_TASK_REVISION',
            `change ${change.changeId} expects task ${change.entityId} at revision ${change.expectedRevision}, found ${task.taskRevision}`,
            'refresh the mission context and re-issue the command',
            {
              commandId,
              entityType: 'task',
              entityId: change.entityId,
              expected: String(task.taskRevision),
              actual: String(change.expectedRevision),
            },
          ),
        );
      }
    }
  }

  /* 5 — target agents exist. */
  const agentIdsToCheck = new Set([
    ...draft.targetAgentIds,
    ...draft.interpretedChanges
      .filter((c) => c.entityType === 'task' && c.requestedState.startsWith('owner:'))
      .map((c) => c.requestedState.slice('owner:'.length)),
    ...draft.interpretedChanges.filter((c) => c.entityType === 'permission').map((c) => c.entityId),
  ]);
  for (const agentId of agentIdsToCheck) {
    if (agentId !== 'none' && !findAgent(context, agentId)) {
      errors.push(
        commandError(
          'AGENT_NOT_FOUND',
          `agent ${agentId} is not registered in the mission context`,
          'name a registered agent or refresh the mission context',
          { commandId, entityType: 'permission', entityId: agentId },
        ),
      );
    }
  }
  if (errors.length > 0) return rejectNow();

  /* 6 — target entities are in compatible states. */
  for (const change of draft.interpretedChanges) {
    const actual = currentEntityState(change, context);
    if (actual === undefined) {
      errors.push(
        commandError(
          'INVALID_STATE_TRANSITION',
          `${change.entityType} ${change.entityId} has no state matching "${change.requestedState.split(':')[0]}"`,
          'refresh the mission context and re-interpret the request',
          { commandId, entityType: change.entityType, entityId: change.entityId },
        ),
      );
      continue;
    }
    if (actual !== change.previousState) {
      errors.push(
        commandError(
          'INVALID_STATE_TRANSITION',
          `${change.entityType} ${change.entityId} is "${actual}", not "${change.previousState}" as interpreted`,
          'refresh the mission context and re-issue the command',
          {
            commandId,
            entityType: change.entityType,
            entityId: change.entityId,
            expected: change.previousState,
            actual,
          },
        ),
      );
    }
  }

  /* 7 — requested Milestone 1 transitions are statically valid values. */
  for (const change of draft.interpretedChanges) {
    if (!staticDimensionValidity(change)) {
      errors.push(
        commandError(
          'INVALID_STATE_TRANSITION',
          `"${change.requestedState}" is not a ${change.statusDimension} status`,
          'use a canonical Milestone 1 status value',
          { commandId, entityType: change.entityType, entityId: change.entityId },
        ),
      );
    }
  }
  if (errors.length > 0) return rejectNow();

  /* 8 — current task ownership is identified. */
  const currentOwnership: Record<string, string | null> = {};
  for (const taskId of draft.targetTaskIds) {
    currentOwnership[taskId] = findTask(context, taskId)?.ownerAgentId ?? null;
  }

  /* 9 + 10 — partial work and child processes are identified. */
  let partialWorkPresent = false;
  let childProcessesPresent = false;
  let activeWorkTargeted = false;
  for (const taskId of draft.targetTaskIds) {
    const task = findTask(context, taskId);
    const run = findActiveRunForTask(context, taskId);
    if (
      run ||
      (task &&
        ['starting', 'running', 'waiting'].includes(task.status.executionStatus))
    ) {
      activeWorkTargeted = true;
    }
    if (!run) continue;
    const w = run.partialWork;
    if (
      w.changedFiles.length > 0 ||
      w.commandsRun > 0 ||
      w.testsRun > 0 ||
      w.knownErrors.length > 0 ||
      w.findingIds.length > 0 ||
      w.unresolvedQuestions.length > 0 ||
      w.costConsumedUsd > 0
    ) {
      partialWorkPresent = true;
    }
    if (run.childProcessRefs.length > 0) childProcessesPresent = true;
  }

  /* 11 — checkpoint requirements. */
  const checkpoints = calculateCheckpointRequirements(draft, context);
  for (const cp of checkpoints) {
    if (cp.status === 'failed') {
      errors.push(
        commandError(
          'CHECKPOINT_FAILED',
          `the checkpoint for ${cp.taskId} previously failed — interrupting now would lose work`,
          'repair the checkpoint capture before re-issuing the command',
          { commandId, entityType: 'task', entityId: cp.taskId },
          ),
      );
    }
  }

  /* 12 — dependencies. */
  const dependencies = analyzeDependencyImpact(draft, context);
  if (draft.intent === 'resume' || draft.intent === 'start') {
    for (const taskId of draft.targetTaskIds) {
      const unmet = findUnmetPrerequisites(context, taskId);
      if (unmet.length > 0) {
        errors.push(
          commandError(
            'DEPENDENCY_BLOCKED',
            `task ${taskId} depends on ${unmet.join(', ')} which are not completed`,
            'complete or explicitly re-plan the prerequisite tasks first',
            {
              commandId,
              entityType: 'task',
              entityId: taskId,
              expected: 'completed prerequisites',
              actual: `unmet: ${unmet.join(', ')}`,
            },
          ),
        );
      }
    }
  }

  /* 13 + 14 — evidence/reviews and stale-review consequences. */
  const affectedReviews = new Set<string>();
  for (const change of draft.interpretedChanges) {
    if (change.entityType === 'review') affectedReviews.add(change.entityId);
  }
  for (const taskId of draft.targetTaskIds) {
    for (const review of context.reviews.filter((r) => r.taskId === taskId)) {
      if (review.status === 'in_progress' || review.status === 'completed') {
        affectedReviews.add(review.reviewId);
      }
    }
  }
  let independentReviewBypass = false;
  for (const change of draft.interpretedChanges) {
    if (change.statusDimension !== 'verification' || change.requestedState !== 'approved') {
      continue;
    }
    const supporting = context.reviews
      .filter((r) => r.taskId === change.entityId && r.status === 'completed')
      .at(-1);
    if (!supporting) {
      independentReviewBypass = true;
      errors.push(
        commandError(
          'REVIEWER_INDEPENDENCE_VIOLATION',
          `no completed review exists for ${change.entityId} — approval without independent review is a bypass`,
          'run an independent review of the current artifact first',
          { commandId, entityType: 'review', entityId: change.entityId, humanActionRequired: true },
        ),
      );
      continue;
    }
    affectedReviews.add(supporting.reviewId);
    if (supporting.artifactRevision !== context.mission.artifactRevision) {
      errors.push(
        commandError(
          'STALE_REVIEW',
          `review ${supporting.reviewId} examined artifact ${supporting.artifactRevision}, but the mission is on ${context.mission.artifactRevision} — the artifact changed after the review`,
          're-review the current artifact; release remains not eligible',
          {
            commandId,
            entityType: 'review',
            entityId: supporting.reviewId,
            expected: context.mission.artifactRevision,
            actual: supporting.artifactRevision,
          },
        ),
      );
    }
  }

  /* 15 — reviewer independence. */
  const independence = evaluateReviewerIndependence(draft, context);
  if (independence.violation) {
    errors.push(
      commandError(
        'REVIEWER_INDEPENDENCE_VIOLATION',
        independence.reasons.join('; '),
        'assign a structurally independent reviewer instead',
        { commandId, humanActionRequired: false },
      ),
    );
  }
  for (const id of independence.invalidatedReviewIds) affectedReviews.add(id);

  /* 16 + 17 — Agent Passport and permission compatibility. */
  const permissions = evaluatePermissionCompatibility(draft, context);
  errors.push(...permissions.errors.map((e) => ({ ...e, commandId })));

  /* 18 — workspace compatibility. */
  const workspace = evaluateWorkspaceCompatibility(draft, context);
  errors.push(...workspace.errors.map((e) => ({ ...e, commandId })));
  const enrichedChanges: RelayStateChange[] = [
    ...draft.interpretedChanges.map((c) => ({ ...c })),
    ...workspace.requiredOwnershipChanges,
  ];

  /* 19 — Mission Contract conflicts. */
  const contract = context.mission.contract;
  let contractApprovalNeeded = false;
  if (permissions.productionExpansionRequested && contract.productionWritesProhibited) {
    if (contract.amendable) {
      contractApprovalNeeded = true;
    } else {
      errors.push(
        commandError(
          'MISSION_CONTRACT_CONFLICT',
          'the Mission Contract prohibits production writes and is not amendable',
          'author a new mission contract if production access is genuinely required',
          { commandId, entityType: 'mission', entityId: draft.missionId, humanActionRequired: true },
        ),
      );
    }
  }

  /* 20 — security-policy conflicts. */
  if (permissions.securityWeakeningRequested) {
    if (contract.amendable) {
      contractApprovalNeeded = true;
    } else {
      errors.push(
        commandError(
          'SECURITY_POLICY_CONFLICT',
          'the command weakens a protected security constraint and the contract is not amendable',
          'keep the security constraint, or author a new contract explicitly',
          { commandId, entityType: 'mission', entityId: draft.missionId, humanActionRequired: true },
        ),
      );
    }
  }

  /* 21 — budget consequences. */
  let budgetIncreaseMaterial = false;
  let hardBudgetBypass = false;
  for (const change of enrichedChanges) {
    if (change.entityType !== 'budget') continue;
    const requestedRaw = change.requestedState.slice('max_usd:'.length);
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested) || requested < 0) {
      errors.push(
        commandError(
          'BUDGET_CONFLICT',
          `"${requestedRaw}" is not a valid budget amount`,
          'state the requested maximum in USD',
          { commandId, entityType: 'budget', entityId: change.entityId },
        ),
      );
      continue;
    }
    const budget = context.mission.budget;
    if (requested < budget.currentSpendUsd) {
      errors.push(
        commandError(
          'BUDGET_CONFLICT',
          `the requested maximum ($${requested}) is below the already-consumed spend ($${budget.currentSpendUsd})`,
          'request a maximum at or above the current spend',
          {
            commandId,
            entityType: 'budget',
            entityId: change.entityId,
            expected: `>= ${budget.currentSpendUsd}`,
            actual: String(requested),
          },
        ),
      );
      continue;
    }
    const current = budget.maximumSpendUsd;
    if (contract.maximumBudgetUsd !== null && requested > contract.maximumBudgetUsd) {
      if (budget.approvalPolicy === 'hard_limit' || !contract.amendable) {
        hardBudgetBypass = true;
        errors.push(
          commandError(
            'BUDGET_CONFLICT',
            `the requested maximum ($${requested}) exceeds the hard contract limit ($${contract.maximumBudgetUsd})`,
            'stay within the contract limit or author a new contract explicitly',
            {
              commandId,
              entityType: 'budget',
              entityId: change.entityId,
              expected: `<= ${contract.maximumBudgetUsd}`,
              actual: String(requested),
              humanActionRequired: true,
            },
          ),
        );
        continue;
      }
      contractApprovalNeeded = true;
    }
    if (current === null || (current > 0 && (requested - current) / current > budget.materialIncreaseFraction)) {
      budgetIncreaseMaterial = requested > (current ?? 0);
    }
  }

  /* 22 — command risk (domain-controlled; the interpreter never sets it). */
  const riskInput: CommandRiskInput = {
    intent: draft.intent,
    secondaryIntents: [...draft.secondaryIntents],
    activeWorkTargeted,
    partialWorkPresent,
    checkpointRequired: checkpoints.some((c) => c.required),
    dependencyHighImpact: dependencies.highImpact,
    reviewInvalidated: independence.invalidatedReviewIds.length > 0,
    ownershipTransfer: workspace.ownershipTransferDetected,
    budgetIncreaseMaterial,
    permissionExpansion: permissions.permissionExpansionRequested,
    productionWritesRequested: permissions.productionExpansionRequested,
    deploymentRequested: enrichedChanges.some(
      (c) => c.requestedState === 'deployment:authorized',
    ),
    securityWeakening: permissions.securityWeakeningRequested,
    evidenceDiscard: enrichedChanges.some((c) => c.requestedState === 'evidence:discarded'),
    independentReviewBypass,
    hardBudgetBypass,
    releaseWithoutApproval: enrichedChanges.some(
      (c) => c.statusDimension === 'release' && c.requestedState === 'released',
    ),
  };
  const { risk, factors } = calculateCommandRisk(riskInput);

  /* 23 — human-approval requirement (separate from interpretation). */
  const approval = calculateApprovalRequirement(riskInput, risk);
  const approvalRequired = approval.required || contractApprovalNeeded;

  /* 24 — atomic applicability: the WHOLE change set must apply cleanly. */
  if (errors.length === 0) {
    const sim = cloneCommandContext(context);
    for (const change of enrichedChanges) {
      if (!change.statusDimension) continue;
      const target =
        change.entityType === 'mission'
          ? sim.mission.status
          : sim.tasks.find((t) => t.taskId === change.entityId)?.status;
      if (!target) continue;
      const supporting = context.reviews
        .filter((r) => r.taskId === change.entityId && r.status === 'completed')
        .at(-1);
      const result = applyStatusTransition(target, {
        dimension: change.statusDimension,
        nextStatus: change.requestedState,
        reason: change.reason,
        actorId: draft.issuedByUserId,
        actorType: 'user',
        eventId: `sim-${change.changeId}`,
        projectId: draft.projectId,
        missionId: draft.missionId,
        taskId: change.entityType === 'task' ? change.entityId : undefined,
        missionRevision: context.mission.missionRevision,
        artifactRevision:
          change.statusDimension === 'verification' ? supporting?.artifactRevision : undefined,
        currentArtifactRevision: context.mission.artifactRevision,
        occurredAt: draft.issuedAt,
        policy: context.mission.releasePolicy,
      });
      if (!result.ok) {
        errors.push(
          commandError(
            result.error.code === 'STALE_ARTIFACT_REVIEW' ? 'STALE_REVIEW' : 'INVALID_STATE_TRANSITION',
            `the combined change set does not apply atomically: ${result.error.reason}`,
            'refresh the mission context and re-issue a coherent command',
            {
              commandId,
              entityType: change.entityType,
              entityId: change.entityId,
              expected: change.previousState,
              actual: result.error.previousStatus,
              humanActionRequired: result.error.humanActionRequired,
            },
          ),
        );
        break;
      }
      if (change.entityType === 'mission') sim.mission.status = result.status;
      else {
        const t = sim.tasks.find((task) => task.taskId === change.entityId);
        if (t) t.status = result.status;
      }
    }
  }

  /* ------------------------- assemble the command ------------------------- */

  const affectedFindings = new Set<string>(independence.preservedFindingIds);
  for (const taskId of draft.targetTaskIds) {
    for (const id of findTask(context, taskId)?.unresolvedFindingIds ?? []) {
      affectedFindings.add(id);
    }
  }

  const commandBase = buildCommand(errors.length > 0 ? 'rejected' : 'validated', {
    interpretedChanges: enrichedChanges,
    affectedDependencies: dependencies.affectedDependencyIds,
    affectedWorkspaces: workspace.affectedWorkspaceIds,
    affectedReviews: [...affectedReviews],
    affectedFindings: [...affectedFindings],
    checkpointRequired: checkpoints.some((c) => c.required),
    approvalRequired,
    independenceRiskDetected: independence.riskDetected,
    permissionChangeDetected: permissions.permissionChangeDetected,
    risk,
    riskFactors: [...factors, ...approval.reasons, ...independence.reasons],
    rejectionReason:
      errors.length > 0 ? errors.map((e) => `${e.code}: ${e.reason}`).join('; ') : undefined,
  });

  const prerequisites: RelayCommandPrerequisite[] = [];
  let prereqCount = 0;
  for (const cp of checkpoints) {
    if (!cp.required || cp.status === 'satisfied') continue;
    prereqCount += 1;
    prerequisites.push({
      prerequisiteId: `${commandId}-pre-${prereqCount}`,
      commandId,
      kind: 'checkpoint',
      description: `capture ${cp.requiredCapture.join(', ')} for ${cp.taskId}`,
      status: 'pending',
      taskId: cp.taskId,
      runId: cp.runId,
    });
  }
  if (approvalRequired && errors.length === 0) {
    prereqCount += 1;
    prerequisites.push({
      prerequisiteId: `${commandId}-pre-${prereqCount}`,
      commandId,
      kind: 'human_approval',
      description: [...approval.reasons, ...(contractApprovalNeeded ? ['amends a contract-controlled policy'] : [])].join('; '),
      status: 'pending',
    });
  }

  const analyses: CommandValidationAnalyses = {
    checkpoints,
    dependencies,
    independence,
    permissions,
    workspace,
    riskInput,
    currentOwnership,
    childProcessesPresent,
  };

  const preview = projectCommandPreview(
    commandBase,
    prerequisites,
    context,
    {
      preservedFindingIds: independence.preservedFindingIds,
      invalidatedReviewIds: independence.invalidatedReviewIds,
      reReviewRequired: independence.reReviewRequired,
      riskFactors: factors,
    },
    errors,
  );

  if (errors.length > 0) {
    return { ok: false, rejectedCommand: commandBase, errors, preview };
  }
  return { ok: true, validatedCommand: commandBase, preview, prerequisites, analyses };
}
