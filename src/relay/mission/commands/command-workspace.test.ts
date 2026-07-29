import { describe, expect, it } from 'vitest';

import { evaluateWorkspaceCompatibility } from './command-workspace';
import { createAuthMissionContext } from './command-fixtures';
import type { RelayStateChange } from './command-types';

const ownerChange = (taskId: string, agentId: string): RelayStateChange => ({
  changeId: `chg-${taskId}-${agentId}`,
  entityType: 'task',
  entityId: taskId,
  previousState: 'owner:none',
  requestedState: `owner:${agentId}`,
  reason: 'test ownership change',
});

describe('workspace compatibility', () => {
  it('an ownership transfer is represented as an EXPLICIT workspace state change', () => {
    const result = evaluateWorkspaceCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      createAuthMissionContext(),
    );
    expect(result.compatible).toBe(true);
    expect(result.ownershipTransferDetected).toBe(true);
    expect(result.requiredOwnershipChanges).toHaveLength(1);
    expect(result.requiredOwnershipChanges[0]).toMatchObject({
      entityType: 'workspace',
      entityId: 'workspace-auth',
      previousState: 'write_owner:agent-claude',
      requestedState: 'write_owner:agent-hermes',
    });
  });

  it('no transfer is generated when the new owner already holds the workspace', () => {
    const result = evaluateWorkspaceCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-claude')] },
      createAuthMissionContext(),
    );
    expect(result.compatible).toBe(true);
    expect(result.ownershipTransferDetected).toBe(false);
    expect(result.requiredOwnershipChanges).toEqual([]);
  });

  it('an ACTIVE current write owner blocks reassignment (no concurrent ownership)', () => {
    const result = evaluateWorkspaceCompatibility(
      { interpretedChanges: [ownerChange('task-auth-review', 'agent-hermes')] },
      createAuthMissionContext(),
    );
    expect(result.compatible).toBe(false);
    expect(result.errors[0].code).toBe('WORKSPACE_INCOMPATIBLE');
    expect(result.errors[0].reason).toMatch(/concurrent write ownership/u);
  });

  it('the same command cancelling the active owner run releases ownership safely', () => {
    const changes: RelayStateChange[] = [
      {
        changeId: 'chg-run',
        entityType: 'agent_run',
        entityId: 'run-codex-review',
        previousState: 'running',
        requestedState: 'cancelled',
        reason: 'stop the reviewer',
      },
      ownerChange('task-auth-review', 'agent-hermes'),
    ];
    const result = evaluateWorkspaceCompatibility(
      { interpretedChanges: changes },
      createAuthMissionContext(),
    );
    expect(result.compatible).toBe(true);
    expect(result.ownershipTransferDetected).toBe(true);
  });

  it('the CLI worktree and the browser worktree are never confused', () => {
    const context = createAuthMissionContext();
    const backend = context.workspaces.find((w) => w.workspaceId === 'workspace-backend');
    if (backend) backend.writeOwnerAgentId = null; // hermes owns ONLY a browser worktree
    context.workspaces.push({
      workspaceId: 'workspace-browser',
      isolationMode: 'browser_virtual',
      writeOwnerAgentId: 'agent-hermes',
      readablePaths: ['src/'],
      writablePaths: ['src/'],
      branch: 'relay/browser',
      kind: 'browser_worktree',
      allowsParallelWriters: false,
    });
    const result = evaluateWorkspaceCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      context,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors[0].reason).toMatch(/cannot silently inherit/u);
  });

  it('a task whose workspace record is missing rejects reassignment', () => {
    const context = createAuthMissionContext();
    context.workspaces = context.workspaces.filter((w) => w.workspaceId !== 'workspace-auth');
    const result = evaluateWorkspaceCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      context,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors[0].reason).toMatch(/not in the mission context/u);
  });
});
