import { describe, expect, it } from 'vitest';

import { evaluatePermissionCompatibility } from './command-permissions';
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

const permissionChange = (
  agentId: string,
  previousState: string,
  requestedState: string,
): RelayStateChange => ({
  changeId: `chg-perm-${agentId}`,
  entityType: 'permission',
  entityId: agentId,
  previousState,
  requestedState,
  reason: 'test permission change',
});

describe('permission and Agent Passport compatibility', () => {
  it('a compatible agent with covering read/write permissions passes', () => {
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      createAuthMissionContext(),
    );
    expect(result.compatible).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('a read-only reviewer cannot receive a repair implementation task', () => {
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-codex')] },
      createAuthMissionContext(),
    );
    expect(result.compatible).toBe(false);
    const reasons = result.errors.map((e) => e.reason).join(' ');
    expect(reasons).toMatch(/read-only|missing write permission/u);
    // The passport responsibility gap is also structural, not just paths.
    expect(reasons).toMatch(/"repair" responsibility/u);
  });

  it('missing read permission rejects assignment', () => {
    const context = createAuthMissionContext();
    const hermes = context.agents.find((a) => a.agentId === 'agent-hermes');
    if (hermes) hermes.passport.permissions.readablePaths = ['docs/'];
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      context,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors.some((e) => e.reason.includes('missing read permission'))).toBe(true);
  });

  it('expired permissions reject execution of the assignment', () => {
    const context = createAuthMissionContext();
    const hermes = context.agents.find((a) => a.agentId === 'agent-hermes');
    if (hermes) hermes.passport.permissions.expiresAt = '2026-07-28T11:00:00.000Z';
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      context,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors[0].reason).toMatch(/expired/u);
  });

  it('revoked permissions reject execution of the assignment', () => {
    const context = createAuthMissionContext();
    const hermes = context.agents.find((a) => a.agentId === 'agent-hermes');
    if (hermes) hermes.passport.permissions.revoked = true;
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      context,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors[0].reason).toMatch(/revoked/u);
  });

  it('a production-touching task rejects an agent without production access', () => {
    const context = createAuthMissionContext();
    const repair = context.tasks.find((t) => t.taskId === 'task-auth-repair');
    if (repair) repair.touchesProduction = true;
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      context,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors[0].reason).toMatch(/production/u);
  });

  it('production-write expansion is detected as expansion, never as narrowing', () => {
    const result = evaluatePermissionCompatibility(
      {
        interpretedChanges: [
          permissionChange('agent-claude', 'production_writes:prohibited', 'production_writes:allowed'),
        ],
      },
      createAuthMissionContext(),
    );
    expect(result.permissionChangeDetected).toBe(true);
    expect(result.permissionExpansionRequested).toBe(true);
    expect(result.productionExpansionRequested).toBe(true);
  });

  it('prohibiting production writes is a narrowing — no expansion detected', () => {
    const context = createAuthMissionContext();
    const claude = context.agents.find((a) => a.agentId === 'agent-claude');
    if (claude) claude.passport.permissions.productionAccess = true;
    const result = evaluatePermissionCompatibility(
      {
        interpretedChanges: [
          permissionChange('agent-claude', 'production_writes:allowed', 'production_writes:prohibited'),
        ],
      },
      context,
    );
    expect(result.permissionChangeDetected).toBe(true);
    expect(result.permissionExpansionRequested).toBe(false);
    expect(result.productionExpansionRequested).toBe(false);
  });

  it('widening the network policy is a security weakening', () => {
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [permissionChange('agent-claude', 'network:none', 'network:full')] },
      createAuthMissionContext(),
    );
    expect(result.securityWeakeningRequested).toBe(true);
    expect(result.permissionExpansionRequested).toBe(true);
  });

  it('a repair assignment never carries release authority', () => {
    const result = evaluatePermissionCompatibility(
      { interpretedChanges: [ownerChange('task-auth-repair', 'agent-hermes')] },
      createAuthMissionContext(),
    );
    expect(result.reasons.join(' ')).toMatch(/no release authority/u);
  });
});
