import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T3,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  codexReviewInput,
  CODEX_ACTUAL,
  finalReport,
  prepareFixture,
  runningFixture,
} from './capsule-fixtures';
import { InMemoryExecutionCapsuleRepository, bindingDrift } from './capsule-repository';
import { attachEvidenceId, markCompleted } from './capsule-service';
import type { RelayAgentExecutionCapsule } from './capsule-types';

function repositoryWithClaude() {
  const repository = new InMemoryExecutionCapsuleRepository();
  const capsule = prepareFixture(claudeImplementationInput());
  const created = repository.create(capsule);
  if (!created.ok) throw new Error('setup failed');
  return { repository, capsule };
}

describe('in-memory capsule repository', () => {
  it('enforces unique capsule ids', () => {
    const { repository, capsule } = repositoryWithClaude();
    const duplicate = repository.create({ ...capsule, runId: 'run-other' });
    expect(!duplicate.ok && duplicate.error.code).toBe('DUPLICATE_CAPSULE_ID');
  });

  it('enforces ONE capsule per run', () => {
    const { repository, capsule } = repositoryWithClaude();
    const sameRun = repository.create({ ...capsule, capsuleId: 'cap-other' });
    expect(!sameRun.ok && sameRun.error.code).toBe('DUPLICATE_RUN_ID');
    if (sameRun.ok) return;
    expect(sameRun.error.actual).toBe('cap-claude-impl');
  });

  it('gets by capsule id and by run id', () => {
    const { repository } = repositoryWithClaude();
    expect(repository.get('cap-claude-impl')?.runId).toBe('run-claude-1');
    expect(repository.getByRunId('run-claude-1')?.capsuleId).toBe('cap-claude-impl');
    expect(repository.get('cap-missing')).toBeNull();
    expect(repository.getByRunId('run-missing')).toBeNull();
  });

  it('lists by mission and by task', () => {
    const { repository } = repositoryWithClaude();
    const reviewer = prepareFixture(codexReviewInput());
    expect(repository.create(reviewer).ok).toBe(true);

    expect(repository.listByMission('mission-auth').map((c) => c.capsuleId).sort()).toEqual([
      'cap-claude-impl',
      'cap-codex-review',
    ]);
    expect(repository.listByTask('task-auth-review').map((c) => c.capsuleId)).toEqual([
      'cap-codex-review',
    ]);
    expect(repository.listByMission('mission-other')).toEqual([]);
  });

  it('returns deep-frozen clones — stored state is unreachable through them', () => {
    const { repository } = repositoryWithClaude();
    const fetched = repository.get('cap-claude-impl') as RelayAgentExecutionCapsule;
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(Object.isFrozen(fetched.traceReferences.fileEvents)).toBe(true);
    expect(Object.isFrozen(fetched.binding)).toBe(true);

    expect(() => {
      (fetched as { status: string }).status = 'completed';
    }).toThrow();
    expect(() => {
      (fetched.evidenceIds as string[]).push('ev-hack');
    }).toThrow();

    expect(repository.get('cap-claude-impl')?.status).toBe('prepared');
    expect(repository.get('cap-claude-impl')?.evidenceIds).toEqual([]);
  });

  it('exposes no deletion or arbitrary-mutation API', () => {
    const repository = new InMemoryExecutionCapsuleRepository();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repository));
    expect(surface.some((name) => /delete|remove|clear|drop|patch|set[A-Z]/u.test(name))).toBe(false);
    expect(surface.sort()).toEqual([
      'constructor', 'create', 'get', 'getByRunId', 'listByMission', 'listByTask', 'replace',
    ]);
  });

  it('replaces only through a validated same-run update', () => {
    const { repository } = repositoryWithClaude();
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const replaced = repository.replace(running);
    expect(replaced.ok).toBe(true);
    expect(repository.get('cap-claude-impl')?.status).toBe('running');

    const unknown = repository.replace({ ...running, capsuleId: 'cap-ghost' });
    expect(!unknown.ok && unknown.error.code).toBe('CAPSULE_NOT_FOUND');

    const rePointed = repository.replace({ ...running, runId: 'run-other' });
    expect(!rePointed.ok && rePointed.error.code).toBe('DUPLICATE_RUN_ID');
    expect(repository.get('cap-claude-impl')?.runId).toBe('run-claude-1');
  });

  it('rejects any drift in a field fixed at preparation', () => {
    const { repository } = repositoryWithClaude();
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    repository.replace(running);

    const drifted: RelayAgentExecutionCapsule = {
      ...running,
      binding: { ...running.binding, missionRevision: 5 },
    };
    const result = repository.replace(drifted);
    expect(!result.ok && result.error.code).toBe('RESPONSIBILITY_REVISION_MISMATCH');
    expect(repository.get('cap-claude-impl')?.binding.missionRevision).toBe(4);
  });

  it.each([
    ['projectId', { projectId: 'project-other' }],
    ['missionId', { missionId: 'mission-other' }],
    ['taskId', { taskId: 'task-other' }],
    ['createdAt', { createdAt: '2026-07-29T00:00:00.000Z' }],
  ] as const)('bindingDrift detects a changed %s', (field, over) => {
    const stored = prepareFixture(claudeImplementationInput());
    const drift = bindingDrift(stored, { ...stored, ...over });
    expect(drift?.field).toBe(field);
  });

  it('bindingDrift detects a silent workspace switch and a changed requested agent', () => {
    const stored = prepareFixture(claudeImplementationInput());
    const movedWorkspace = bindingDrift(stored, { ...stored, workspace: undefined });
    expect(movedWorkspace?.field).toBe('workspace.workspaceId');

    const newAgent = bindingDrift(stored, {
      ...stored,
      identity: { kind: 'requested', requested: { agentId: 'agent-hermes', agentType: 'hermes' } },
    });
    expect(newAgent?.field).toBe('identity.requested.agentId');
  });

  it('terminal capsules remain inspectable', () => {
    const { repository } = repositoryWithClaude();
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const withEvidence = attachEvidenceId(running, 'ev-1', CAPSULE_T3);
    if (!withEvidence.ok) throw new Error('setup failed');
    const completed = markCompleted(withEvidence.value, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');
    repository.replace(completed.value);

    const stored = repository.get('cap-claude-impl');
    expect(stored?.status).toBe('completed');
    expect(stored?.finalReport?.reportedBy).toBe('agent-claude');
    expect(stored?.evidenceIds).toEqual(['ev-1']);
    expect(stored?.identity.requested.agentId).toBe('agent-claude');
    expect(repository.listByMission('mission-auth')).toHaveLength(1);
  });

  it('a rejected update leaves the stored capsule byte-for-byte unchanged', () => {
    const { repository } = repositoryWithClaude();
    const before = JSON.stringify(repository.get('cap-claude-impl'));
    repository.replace({
      ...prepareFixture(claudeImplementationInput()),
      binding: { ...prepareFixture(claudeImplementationInput()).binding, taskRevision: 99 },
    });
    expect(JSON.stringify(repository.get('cap-claude-impl'))).toBe(before);
  });

  it('separate runs of the same task each get their own capsule (retry semantics)', () => {
    const { repository } = repositoryWithClaude();
    const retry = prepareFixture(
      claudeImplementationInput({ capsuleId: 'cap-claude-impl-2', runId: 'run-claude-2' }),
    );
    expect(repository.create(retry).ok).toBe(true);
    expect(repository.listByTask('task-auth-repair')).toHaveLength(2);
    expect(repository.getByRunId('run-claude-2')?.capsuleId).toBe('cap-claude-impl-2');
    // The original capsule is untouched by the retry.
    expect(repository.getByRunId('run-claude-1')?.capsuleId).toBe('cap-claude-impl');
  });

  it('capsules for different agents coexist under one mission', () => {
    const { repository } = repositoryWithClaude();
    const reviewer = runningFixture(codexReviewInput(), CODEX_ACTUAL);
    expect(repository.create(reviewer).ok).toBe(true);
    expect(repository.listByMission('mission-auth')).toHaveLength(2);
  });
});
