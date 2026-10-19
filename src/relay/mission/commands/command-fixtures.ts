/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * DETERMINISTIC FIXTURES — test/development data ONLY. Nothing here is
 * production state, no fixture references a real process, agent, provider,
 * or workspace, and no fixture is ever loaded outside tests/dev tooling.
 *
 * The flagship scenario models the required example:
 *   - Claude Code implemented artifact art-2 (task-auth-impl, completed);
 *   - Codex is MID-REVIEW of art-2 (task-auth-review running, partial
 *     finding finding-auth-1, child process reference, cost consumed);
 *   - a prepared repair task (task-auth-repair) exists, unassigned;
 *   - backend → api → frontend dependency chain for dependency tests.
 */

import { createInitialAqualaOutcomeStatus } from '../status/status-model';
import type { AqualaOutcomeStatus } from '../status/status-model';
import type {
  CommandAgentContext,
  CommandPermissionContext,
  CommandTaskContext,
  CommandWorkspaceContext,
  RelayMissionCommandContext,
} from './command-context';
import type { RelayMissionCommandNaturalRequest } from './command-interpreter';

export const FIXTURE_TIME = '2026-07-28T12:00:00.000Z';

function status(partial: Partial<AqualaOutcomeStatus>): AqualaOutcomeStatus {
  return { ...createInitialAqualaOutcomeStatus(), ...partial };
}

const fullPermissions = (over: Partial<CommandPermissionContext> = {}): CommandPermissionContext => ({
  readablePaths: ['*'],
  writablePaths: ['src/', 'tests/'],
  allowedCommands: ['npm test', 'npm run typecheck'],
  networkPolicy: 'none',
  toolPolicy: ['editor', 'terminal'],
  secretPolicy: 'handles_only',
  productionAccess: false,
  expiresAt: null,
  revoked: false,
  ...over,
});

function agent(
  agentId: string,
  agentType: CommandAgentContext['agentType'],
  displayName: string,
  over: Partial<CommandAgentContext> = {},
): CommandAgentContext {
  return {
    agentId,
    agentType,
    displayName,
    executionIdentity: `${agentId}-identity`,
    adapterId: `${agentId}-adapter`,
    independenceGroup: `${agentId}-group`,
    sessionId: `${agentId}-session-1`,
    passport: {
      passportId: `${agentId}-passport`,
      compatibleResponsibilities: ['implementation', 'repair', 'review'],
      permissions: fullPermissions(),
    },
    rolesInMission: [],
    implementedArtifactRevisions: [],
    reviewedArtifactRevisions: [],
    ...over,
  };
}

function task(
  taskId: string,
  title: string,
  over: Partial<CommandTaskContext> = {},
): CommandTaskContext {
  return {
    taskId,
    title,
    taskRevision: 1,
    responsibility: 'implementation',
    ownerAgentId: null,
    status: status({}),
    dependsOn: [],
    unresolvedFindingIds: [],
    workspaceId: null,
    priority: 3,
    touchesProduction: false,
    outputTarget: 'default',
    ...over,
  };
}

function workspace(
  workspaceId: string,
  over: Partial<CommandWorkspaceContext> = {},
): CommandWorkspaceContext {
  return {
    workspaceId,
    isolationMode: 'isolated_worktree',
    writeOwnerAgentId: null,
    readablePaths: ['src/', 'tests/'],
    writablePaths: ['src/', 'tests/'],
    branch: 'relay/fixture',
    kind: 'cli_worktree',
    allowsParallelWriters: false,
    ...over,
  };
}

/**
 * The flagship deterministic context. Every test may override pieces after
 * cloning — the builder always returns a FRESH object graph.
 */
export function createAuthMissionContext(): RelayMissionCommandContext {
  const claude = agent('agent-claude', 'claude_code', 'Claude Code', {
    rolesInMission: ['implementer'],
    implementedArtifactRevisions: ['art-1', 'art-2'],
  });
  const codex = agent('agent-codex', 'codex', 'Codex', {
    rolesInMission: ['reviewer'],
    reviewedArtifactRevisions: ['art-1'],
    passport: {
      passportId: 'agent-codex-passport',
      compatibleResponsibilities: ['review'],
      permissions: fullPermissions({ writablePaths: [] }), // read-only reviewer
    },
  });
  const hermes = agent('agent-hermes', 'hermes', 'Hermes', {
    passport: {
      passportId: 'agent-hermes-passport',
      compatibleResponsibilities: ['implementation', 'repair'],
      permissions: fullPermissions(),
    },
  });
  /* A fresh session of Claude Code's EXECUTION IDENTITY — structurally the
     same party for independence purposes. */
  const claudeSession2 = agent('agent-claude-s2', 'claude_code', 'Claude Code (new session)', {
    executionIdentity: 'agent-claude-identity',
    adapterId: 'agent-claude-adapter',
    independenceGroup: 'agent-claude-group',
    sessionId: 'agent-claude-session-2',
    implementedArtifactRevisions: [],
  });

  return {
    mission: {
      projectId: 'project-sunday',
      missionId: 'mission-auth',
      missionRevision: 3,
      artifactRevision: 'art-2',
      evaluationTime: FIXTURE_TIME,
      contract: {
        productionWritesProhibited: true,
        deploymentProhibited: true,
        networkAccessProhibited: true,
        maximumRepairAttempts: 1,
        independentReviewRequired: true,
        protectedFiles: ['infra/prod.ts'],
        maximumBudgetUsd: 25,
        humanReleaseApprovalRequired: true,
        amendable: true,
      },
      status: status({ executionStatus: 'running' }),
      budget: {
        currentSpendUsd: 4,
        maximumSpendUsd: 10,
        categoryLimitsUsd: { repair: 5 },
        approvalPolicy: 'human_approval_over_limit',
        materialIncreaseFraction: 0.2,
      },
      annotations: {},
    },
    tasks: [
      task('task-auth-impl', 'Implement the authentication fix', {
        responsibility: 'implementation',
        ownerAgentId: 'agent-claude',
        status: status({
          executionStatus: 'completed',
          outcomeStatus: 'partial',
          verificationStatus: 'reviewing',
        }),
        workspaceId: 'workspace-auth',
      }),
      task('task-auth-review', 'Independent review of the authentication fix', {
        responsibility: 'review',
        ownerAgentId: 'agent-codex',
        status: status({ executionStatus: 'running' }),
        dependsOn: ['task-auth-impl'],
        unresolvedFindingIds: ['finding-auth-1'],
        workspaceId: 'workspace-auth-review',
      }),
      task('task-auth-repair', 'Repair the authentication defect', {
        responsibility: 'repair',
        ownerAgentId: null,
        status: status({}),
        dependsOn: ['task-auth-review'],
        workspaceId: 'workspace-auth',
      }),
      task('task-backend', 'Backend data layer', {
        ownerAgentId: 'agent-hermes',
        status: status({ executionStatus: 'running' }),
        workspaceId: 'workspace-backend',
      }),
      task('task-api', 'API surface', {
        status: status({ executionStatus: 'waiting' }),
        dependsOn: ['task-backend'],
      }),
      task('task-frontend', 'Frontend wiring', {
        status: status({ executionStatus: 'waiting' }),
        dependsOn: ['task-api'],
      }),
    ],
    agentRuns: [
      {
        runId: 'run-codex-review',
        taskId: 'task-auth-review',
        requestedAgentId: 'agent-codex',
        actualAgentId: 'agent-codex',
        state: 'running',
        partialWork: {
          changedFiles: [],
          commandsRun: 3,
          testsRun: 1,
          knownErrors: [],
          findingIds: ['finding-auth-1'],
          unresolvedQuestions: ['does the session rotate on privilege change?'],
          costConsumedUsd: 0.4,
        },
        childProcessRefs: ['proc-ref-codex-1'],
        checkpointStatus: 'none',
      },
      {
        runId: 'run-hermes-backend',
        taskId: 'task-backend',
        requestedAgentId: 'agent-hermes',
        actualAgentId: 'agent-hermes',
        state: 'running',
        partialWork: {
          changedFiles: ['src/db/schema.ts'],
          commandsRun: 2,
          testsRun: 0,
          knownErrors: [],
          findingIds: [],
          unresolvedQuestions: [],
          costConsumedUsd: 0.2,
        },
        childProcessRefs: [],
        checkpointStatus: 'none',
      },
    ],
    agents: [claude, codex, hermes, claudeSession2],
    workspaces: [
      workspace('workspace-auth', { writeOwnerAgentId: 'agent-claude' }),
      workspace('workspace-auth-review', {
        writeOwnerAgentId: 'agent-codex',
        writablePaths: [],
      }),
      workspace('workspace-backend', { writeOwnerAgentId: 'agent-hermes' }),
    ],
    reviews: [
      {
        reviewId: 'review-auth-r1',
        taskId: 'task-auth-review',
        reviewerAgentId: 'agent-codex',
        artifactRevision: 'art-2',
        status: 'in_progress',
        findingIds: ['finding-auth-1'],
        independent: true,
        runId: 'run-codex-review',
      },
    ],
  };
}

/** Variant: the completed review examined art-1 but the mission moved to
    art-2 — the STALE REVIEW scenario (fixture H). */
export function createStaleReviewContext(): RelayMissionCommandContext {
  const context = createAuthMissionContext();
  context.reviews = [
    {
      reviewId: 'review-auth-stale',
      taskId: 'task-auth-impl',
      reviewerAgentId: 'agent-codex',
      artifactRevision: 'art-1',
      status: 'completed',
      findingIds: [],
      independent: true,
    },
  ];
  context.agentRuns = context.agentRuns.filter((r) => r.runId !== 'run-codex-review');
  context.tasks = context.tasks.map((t) =>
    t.taskId === 'task-auth-review'
      ? { ...t, status: status({ executionStatus: 'completed' }), unresolvedFindingIds: [] }
      : t,
  );
  return context;
}

export function naturalRequest(
  requestId: string,
  text: string,
  over: Partial<RelayMissionCommandNaturalRequest> = {},
): RelayMissionCommandNaturalRequest {
  return {
    requestId,
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    issuedByUserId: 'user-founder',
    issuedAt: FIXTURE_TIME,
    text,
    ...over,
  };
}
