import { describe, expect, it } from 'vitest';

/**
 * The twelve required deterministic fixtures (A–L), run END-TO-END through
 * submit → prerequisites → execute. Every scenario also proves the mission
 * context mutates ONLY through a successful atomic execution.
 */

import {
  executeMissionCommand,
  resolveCommandPrerequisite,
  submitMissionCommand,
} from './command-executor';
import { DeterministicCommandInterpreter } from './deterministic-command-interpreter';
import {
  createAuthMissionContext,
  createStaleReviewContext,
  naturalRequest,
  FIXTURE_TIME,
} from './command-fixtures';
import {
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
} from './command-repository';
import type { RelayMissionCommandContext } from './command-context';

const interpreter = new DeterministicCommandInterpreter();

function harness(context: RelayMissionCommandContext) {
  const repository = new InMemoryMissionCommandRepository();
  const contextStore = new InMemoryMissionContextStore();
  contextStore.save(context);
  const submit = (commandId: string, text: string) =>
    submitMissionCommand({
      request: naturalRequest(commandId, text),
      interpreter,
      context: contextStore.get(context.mission.missionId) as RelayMissionCommandContext,
      repository,
      commandId,
    });
  const execute = (commandId: string) =>
    executeMissionCommand({
      commandId, repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
  const satisfyAll = (commandId: string) => {
    for (const p of repository.getPrerequisites(commandId)) {
      if (p.status === 'pending') {
        resolveCommandPrerequisite({
          commandId, prerequisiteId: p.prerequisiteId, repository,
          actorId: p.kind === 'checkpoint' ? 'relay' : 'user-founder',
          occurredAt: FIXTURE_TIME, outcome: 'satisfied',
        });
      }
    }
  };
  return { repository, contextStore, submit, execute, satisfyAll };
}

describe('fixture A — pause an active task with partial work', () => {
  it('requires a checkpoint, lists dependents, and never executes before the checkpoint', () => {
    const h = harness(createAuthMissionContext());
    const result = h.submit('cmd-a', 'Pause the backend task.');
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;
    expect(result.command.checkpointRequired).toBe(true);
    expect(result.command.affectedDependencies).toEqual(['task-api']);
    expect(result.prerequisites.some((p) => p.kind === 'checkpoint')).toBe(true);

    const blocked = h.execute('cmd-a');
    expect(!blocked.ok && blocked.errors[0].code).toBe('CHECKPOINT_REQUIRED');
    expect(
      h.contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-backend')?.status.executionStatus,
    ).toBe('running');
  });
});

describe('fixture B — resume a valid waiting task', () => {
  it('is low risk, needs no checkpoint, and moves execution waiting → running', () => {
    const context = createAuthMissionContext();
    const backend = context.tasks.find((t) => t.taskId === 'task-backend');
    if (backend) backend.status = { ...backend.status, executionStatus: 'completed' };
    context.agentRuns = context.agentRuns.filter((r) => r.taskId !== 'task-backend');
    const h = harness(context);

    const result = h.submit('cmd-b', 'Resume the api task.');
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;
    expect(result.command.risk).toBe('low');
    expect(result.command.checkpointRequired).toBe(false);
    expect(result.prerequisites).toEqual([]);

    const executed = h.execute('cmd-b');
    expect(executed.ok).toBe(true);
    expect(
      h.contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-api')?.status.executionStatus,
    ).toBe('running');
  });
});

describe('fixture C — cancel an active prerequisite task', () => {
  it('identifies dependents, is high risk, requires approval, and mutates nothing before it', () => {
    const h = harness(createAuthMissionContext());
    const result = h.submit('cmd-c', 'Cancel the backend task.');
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;
    expect(result.command.risk).toBe('high');
    expect(result.command.approvalRequired).toBe(true);
    expect([...result.command.affectedDependencies].sort()).toEqual(['task-api', 'task-frontend']);

    const blocked = h.execute('cmd-c');
    expect(blocked.ok).toBe(false);
    expect(
      h.contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-backend')?.status.executionStatus,
    ).toBe('running');

    h.satisfyAll('cmd-c');
    const executed = h.execute('cmd-c');
    expect(executed.ok).toBe(true);
    expect(
      h.contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-backend')?.status.executionStatus,
    ).toBe('cancelled');
  });
});

describe('fixture D — reassign to a compatible coding agent', () => {
  it('captures ownership, passes permissions and workspace, and represents the transfer explicitly', () => {
    const h = harness(createAuthMissionContext());
    const result = h.submit('cmd-d', 'Move the repair task to Hermes.');
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;
    const ownership = result.command.interpretedChanges.find(
      (c) => c.entityType === 'workspace',
    );
    expect(ownership).toMatchObject({
      previousState: 'write_owner:agent-claude',
      requestedState: 'write_owner:agent-hermes',
    });

    h.satisfyAll('cmd-d');
    const executed = h.execute('cmd-d');
    expect(executed.ok).toBe(true);
    const next = h.contextStore.get('mission-auth');
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-repair')?.ownerAgentId).toBe('agent-hermes');
    expect(next?.workspaces.find((w) => w.workspaceId === 'workspace-auth')?.writeOwnerAgentId).toBe('agent-hermes');
  });
});

describe('fixture E — reassign to an incompatible agent', () => {
  it('rejects with a structured permission error and mutates nothing', () => {
    const context = createAuthMissionContext();
    const h = harness(context);
    const snapshot = JSON.stringify(h.contextStore.get('mission-auth'));
    const result = h.submit('cmd-e', 'Move the repair task to Codex.');
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.errors.some((e) => e.code === 'PERMISSION_INCOMPATIBLE')).toBe(true);
    expect(JSON.stringify(h.contextStore.get('mission-auth'))).toBe(snapshot);
  });
});

describe('fixture F — the original implementer as independent reviewer', () => {
  it('is a reviewer-independence rejection', () => {
    const h = harness(createAuthMissionContext());
    const result = h.submit('cmd-f', 'Move the review task to Claude.');
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.errors.some((e) => e.code === 'REVIEWER_INDEPENDENCE_VIOLATION')).toBe(true);
  });
});

describe('fixture G — the original implementer as repair agent (flagship compound)', () => {
  it('permits the repair, preserves findings and re-review, and never approves verification', () => {
    const h = harness(createAuthMissionContext());
    const result = h.submit('cmd-g', 'Stop Codex and have Claude repair the authentication problem.');
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;

    expect(result.command.independenceRiskDetected).toBe(true);
    expect(result.command.affectedFindings).toContain('finding-auth-1');
    expect(result.command.affectedReviews).toContain('review-auth-r1');
    expect(result.preview.relayWillNot.join(' ')).toContain('approve its own repair');

    h.satisfyAll('cmd-g');
    const executed = h.execute('cmd-g');
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.appliedChangeIds).toHaveLength(4);

    const next = h.contextStore.get('mission-auth');
    expect(next?.agentRuns.find((r) => r.runId === 'run-codex-review')?.state).toBe('cancelled');
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-review')?.status.executionStatus).toBe('cancelled');
    expect(next?.reviews.find((r) => r.reviewId === 'review-auth-r1')?.status).toBe('incomplete');
    expect(next?.reviews.find((r) => r.reviewId === 'review-auth-r1')?.findingIds).toEqual(['finding-auth-1']);
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-repair')?.ownerAgentId).toBe('agent-claude');
    // Verification is NOT approved and release is NOT eligible.
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-impl')?.status.verificationStatus).toBe('reviewing');
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-impl')?.status.releaseStatus).toBe('not_eligible');
    expect(next?.mission.status.releaseStatus).toBe('not_eligible');
  });
});

describe('fixture H — approve a repair using a stale review', () => {
  it('rejects with STALE_REVIEW and release remains not eligible', () => {
    const h = harness(createStaleReviewContext());
    const result = h.submit('cmd-h', 'Approve the repair.');
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    const stale = result.errors.find((e) => e.code === 'STALE_REVIEW');
    expect(stale).toBeDefined();
    expect(stale?.expected).toBe('art-2');
    expect(stale?.actual).toBe('art-1');
    const next = h.contextStore.get('mission-auth');
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-impl')?.status.verificationStatus).toBe('reviewing');
    expect(next?.tasks.find((t) => t.taskId === 'task-auth-impl')?.status.releaseStatus).toBe('not_eligible');
  });
});

describe('fixture I — allow production writes', () => {
  it('is critical risk with explicit approval; no permission changes before approval', () => {
    const h = harness(createAuthMissionContext());
    const result = h.submit('cmd-i', 'Allow production writes.');
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;
    expect(result.command.risk).toBe('critical');
    expect(result.command.approvalRequired).toBe(true);
    expect(result.command.permissionChangeDetected).toBe(true);

    const blocked = h.execute('cmd-i');
    expect(!blocked.ok && blocked.errors[0].code).toBe('APPROVAL_REQUIRED');
    expect(
      h.contextStore.get('mission-auth')?.agents.find((a) => a.agentId === 'agent-claude')
        ?.passport.permissions.productionAccess,
    ).toBe(false);
  });

  it('a NON-amendable contract rejects the expansion outright', () => {
    const context = createAuthMissionContext();
    context.mission.contract.amendable = false;
    const h = harness(context);
    const result = h.submit('cmd-i2', 'Allow production writes.');
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.errors.some((e) => e.code === 'MISSION_CONTRACT_CONFLICT')).toBe(true);
  });
});

describe('fixture J — ambiguous request', () => {
  it('requires clarification, resolves no targets, and executes nothing', () => {
    const h = harness(createAuthMissionContext());
    const snapshot = JSON.stringify(h.contextStore.get('mission-auth'));
    const result = h.submit('cmd-j', 'Stop it and give it to the other one.');
    expect(result.kind).toBe('clarification_required');
    if (result.kind !== 'clarification_required') return;
    expect(result.missingInformation).toEqual(['target task', 'current agent', 'replacement agent']);
    expect(h.repository.getCommand('cmd-j')).toBeNull();
    expect(JSON.stringify(h.contextStore.get('mission-auth'))).toBe(snapshot);
  });
});

describe('fixture K — duplicate execution request', () => {
  it('returns the deterministic existing result with no duplicate transitions or events', () => {
    const context = createAuthMissionContext();
    const backend = context.tasks.find((t) => t.taskId === 'task-backend');
    if (backend) backend.status = { ...backend.status, executionStatus: 'completed' };
    context.agentRuns = context.agentRuns.filter((r) => r.taskId !== 'task-backend');
    const h = harness(context);
    h.submit('cmd-k', 'Resume the api task.');
    const first = h.execute('cmd-k');
    expect(first.ok).toBe(true);
    const revision = h.contextStore.get('mission-auth')?.mission.missionRevision;
    const eventCount = h.repository.listEvents('cmd-k').length;

    const second = h.execute('cmd-k');
    expect(second.ok && second.duplicate).toBe(true);
    expect(h.contextStore.get('mission-auth')?.mission.missionRevision).toBe(revision);
    expect(h.repository.listEvents('cmd-k')).toHaveLength(eventCount);
  });
});

describe('fixture L — stale mission revision', () => {
  it('rejects before any mutation', () => {
    const context = createAuthMissionContext();
    const h = harness(context);
    const submitted = h.submit('cmd-l', 'Pause the backend task.');
    expect(submitted.kind).toBe('validated');
    h.satisfyAll('cmd-l');

    const moved = h.contextStore.get('mission-auth') as RelayMissionCommandContext;
    moved.mission.missionRevision = 4;
    h.contextStore.commit('mission-auth', moved);
    const snapshot = JSON.stringify(h.contextStore.get('mission-auth'));

    const result = h.execute('cmd-l');
    expect(!result.ok && result.errors[0].code).toBe('STALE_MISSION_REVISION');
    expect(JSON.stringify(h.contextStore.get('mission-auth'))).toBe(snapshot);
  });
});
