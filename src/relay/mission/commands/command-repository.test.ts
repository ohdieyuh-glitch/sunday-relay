import { describe, expect, it } from 'vitest';

import { createCommandEvent } from './command-events';
import { createAuthMissionContext } from './command-fixtures';
import {
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
} from './command-repository';
import type { RelayMissionCommand } from './command-types';

const command = (commandId: string): RelayMissionCommand => ({
  commandId,
  projectId: 'project-sunday',
  missionId: 'mission-auth',
  issuedByUserId: 'user-founder',
  issuedAt: '2026-07-28T12:00:00.000Z',
  naturalLanguageRequest: 'pause the backend task',
  intent: 'pause',
  secondaryIntents: [],
  targetTaskIds: ['task-backend'],
  targetAgentIds: [],
  interpretedChanges: [],
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
  status: 'validated',
  missionRevision: 3,
  taskRevisions: { 'task-backend': 1 },
  executionEventIds: [],
});

const event = (commandId: string, sequence: number) =>
  createCommandEvent({
    eventId: `${commandId}-ev-${sequence}`,
    commandId,
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    missionRevision: 3,
    sequence,
    eventType: 'command_received',
    actorId: 'user-founder',
    occurredAt: '2026-07-28T12:00:00.000Z',
  });

describe('in-memory command repository', () => {
  it('command ids are unique — duplicates are rejected, not overwritten', () => {
    const repo = new InMemoryMissionCommandRepository();
    expect(repo.createCommand(command('cmd-1')).ok).toBe(true);
    const duplicate = repo.createCommand({ ...command('cmd-1'), intent: 'cancel' });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error.code).toBe('DUPLICATE_COMMAND');
    expect(repo.getCommand('cmd-1')?.intent).toBe('pause');
  });

  it('returned records are frozen clones — callers can never mutate stored state', () => {
    const repo = new InMemoryMissionCommandRepository();
    repo.createCommand(command('cmd-2'));
    const fetched = repo.getCommand('cmd-2') as RelayMissionCommand;
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(() => {
      (fetched as { status: string }).status = 'executed';
    }).toThrow();
    expect(() => {
      fetched.targetTaskIds.push('task-x');
    }).toThrow();
    expect(repo.getCommand('cmd-2')?.status).toBe('validated');
    expect(repo.getCommand('cmd-2')?.targetTaskIds).toEqual(['task-backend']);
  });

  it('rejected and failed commands remain inspectable', () => {
    const repo = new InMemoryMissionCommandRepository();
    repo.createCommand({ ...command('cmd-3'), status: 'rejected', rejectionReason: 'STALE_MISSION_REVISION: stale' });
    repo.createCommand({ ...command('cmd-4'), status: 'failed' });
    expect(repo.getCommand('cmd-3')?.rejectionReason).toContain('STALE_MISSION_REVISION');
    expect(repo.getCommand('cmd-4')?.status).toBe('failed');
    expect(repo.listCommands()).toHaveLength(2);
  });

  it('events append in contiguous order and can never be reordered or replaced', () => {
    const repo = new InMemoryMissionCommandRepository();
    expect(repo.appendEvent(event('cmd-5', 0)).ok).toBe(true);
    expect(repo.appendEvent(event('cmd-5', 1)).ok).toBe(true);

    const outOfOrder = repo.appendEvent(event('cmd-5', 5));
    expect(outOfOrder.ok).toBe(false);
    if (!outOfOrder.ok) expect(outOfOrder.error.reason).toMatch(/reordered/u);

    const replay = repo.appendEvent(event('cmd-5', 0));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.reason).toMatch(/immutable/u);

    expect(repo.listEvents('cmd-5').map((e) => e.sequence)).toEqual([0, 1]);
    expect(repo.nextEventSequence('cmd-5')).toBe(2);
  });

  it('the repository exposes no event deletion or mutation API', () => {
    const repo = new InMemoryMissionCommandRepository();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
    expect(surface.some((name) => /delete|remove|replace/iu.test(name))).toBe(false);
    repo.appendEvent(event('cmd-6', 0));
    const events = repo.listEvents('cmd-6');
    events.pop(); // mutating the RETURNED array…
    expect(repo.listEvents('cmd-6')).toHaveLength(1); // …never touches the stream
  });

  it('prerequisites can only move out of pending once', () => {
    const repo = new InMemoryMissionCommandRepository();
    repo.savePrerequisites('cmd-7', [
      {
        prerequisiteId: 'cmd-7-pre-1',
        commandId: 'cmd-7',
        kind: 'human_approval',
        description: 'approve',
        status: 'pending',
      },
    ]);
    expect(repo.updatePrerequisite('cmd-7', 'cmd-7-pre-1', { status: 'satisfied' }).ok).toBe(true);
    const again = repo.updatePrerequisite('cmd-7', 'cmd-7-pre-1', { status: 'failed' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('APPROVAL_INVALID');
    const unknown = repo.updatePrerequisite('cmd-7', 'cmd-7-pre-99', { status: 'satisfied' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('APPROVAL_INVALID');
  });

  it('executed commands retain their applied state-change ids', () => {
    const repo = new InMemoryMissionCommandRepository();
    repo.createCommand(command('cmd-8'));
    repo.saveExecutionOutcome({
      commandId: 'cmd-8',
      appliedChangeIds: ['chg-1', 'chg-2'],
      executedAt: '2026-07-28T12:01:00.000Z',
      eventIds: ['cmd-8-ev-0'],
    });
    expect(repo.getExecutionOutcome('cmd-8')?.appliedChangeIds).toEqual(['chg-1', 'chg-2']);
  });
});

describe('in-memory mission context store (mock)', () => {
  it('returns clones and commits atomically by full replacement', () => {
    const store = new InMemoryMissionContextStore();
    const context = createAuthMissionContext();
    store.save(context);

    const fetched = store.get('mission-auth');
    expect(fetched).not.toBeNull();
    if (!fetched) return;
    fetched.mission.missionRevision = 99; // mutating the returned clone…
    expect(store.get('mission-auth')?.mission.missionRevision).toBe(3); // …changes nothing

    fetched.mission.missionRevision = 4;
    store.commit('mission-auth', fetched);
    expect(store.get('mission-auth')?.mission.missionRevision).toBe(4);
  });
});
