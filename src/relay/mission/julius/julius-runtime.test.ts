import { describe, expect, it } from 'vitest';
import { JuliusTaskGraph, JuliusWorkerRegistry, compileJuliusContext, missionMayComplete, transitionMission, verifyTask, type JuliusTask, type JuliusWorker } from './julius-runtime';

const worker: JuliusWorker = { workerId: 'coding-1', role: 'CODING_AGENT', adapterId: 'codex', providerId: 'openai', capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1, timeoutMs: 1000, maxRetries: 2, status: 'AVAILABLE' };
const task = (taskId: string, dependencyIds: string[] = [], ordinal = 0): JuliusTask => ({ taskId, missionId: 'mission-1', parentTaskId: null, dependencyIds, requiredEvidenceTypes: ['TEST'], taskType: 'implementation', role: 'CODING_AGENT', ordinal, state: dependencyIds.length ? 'BLOCKED' : 'RUNNABLE' });

describe('Julius authoritative kernel', () => {
  it('validates lifecycle transitions and emits safe structured audit facts', () => {
    expect(transitionMission({ transitionId: 't1', missionId: 'm', current: 'CREATED', to: 'PLANNING', reasonCode: 'CONTRACT_ACCEPTED', safeSummary: 'Planning started.', evidenceIds: [], occurredAt: '2026-08-27T00:00:00Z' }).from).toBe('CREATED');
    expect(() => transitionMission({ transitionId: 't2', missionId: 'm', current: 'CREATED', to: 'COMPLETED', reasonCode: 'WORKER_SAID_DONE', safeSummary: 'done', evidenceIds: [], occurredAt: '2026-08-27T00:00:00Z' })).toThrow('invalid_julius_transition');
  });
  it('keeps roles provider-neutral and deterministically selects eligible workers', () => {
    const registry = new JuliusWorkerRegistry(); registry.register(worker);
    registry.register({ ...worker, workerId: 'coding-0', providerId: 'anthropic' });
    expect(registry.eligible('CODING_AGENT', 'implementation', 'code').map(item => item.workerId)).toEqual(['coding-0', 'coding-1']);
    expect(registry.eligible('INDEPENDENT_REVIEWER', 'implementation', 'code')).toEqual([]);
  });
  it('resolves a persistent-style DAG deterministically and rejects stale claims', () => {
    const graph = new JuliusTaskGraph(); graph.add(task('build')); graph.add(task('review', ['build'], 2)); graph.add(task('test', ['build'], 1));
    expect(graph.resolveRunnable('mission-1').map(item => item.taskId)).toEqual(['build']);
    graph.transition('build', 'RUNNABLE', 'ACTIVE'); graph.transition('build', 'ACTIVE', 'SUCCEEDED');
    expect(graph.resolveRunnable('mission-1').map(item => item.taskId)).toEqual(['test', 'review']);
    expect(() => graph.transition('test', 'BLOCKED', 'ACTIVE')).toThrow('stale_task_state');
  });
  it('compiles bounded role-specific context and excludes secrets and unrelated entries', () => {
    const packet = compileJuliusContext({ missionId: 'mission-1', task: task('build'), worker, maxCharacters: 80, entries: [
      { entryId: 'objective', kind: 'OBJECTIVE', text: 'Implement durable scheduling', taskIds: [], allowedRoles: ['CODING_AGENT'], sensitivity: 'INTERNAL' },
      { entryId: 'secret', kind: 'CONSTRAINT', text: 'token=do-not-leak', taskIds: [], allowedRoles: ['CODING_AGENT'], sensitivity: 'SECRET' },
      { entryId: 'review', kind: 'FINDING', text: 'review only', taskIds: [], allowedRoles: ['INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
      { entryId: 'other', kind: 'DECISION', text: 'other task', taskIds: ['other'], allowedRoles: ['CODING_AGENT'], sensitivity: 'INTERNAL' },
    ] });
    expect(packet.sourceEntryIds).toEqual(['objective']); expect(JSON.stringify(packet)).not.toContain('do-not-leak'); expect(JSON.stringify(packet)).not.toContain('review only');
  });
  it('requires evidence and Julius acceptance before mission completion', () => {
    const succeeded = { ...task('build'), state: 'SUCCEEDED' as const };
    expect(verifyTask(succeeded, [], 0).action).toBe('HALT');
    const accepted = verifyTask(succeeded, [{ evidenceId: 'e1', missionId: 'mission-1', taskId: 'build', workerId: 'testing-1', type: 'TEST', status: 'PASSED', safeSummary: '48 tests passed', artifactRef: null, integrityHash: 'sha256:x', occurredAt: '2026-08-27T00:00:00Z' }], 0);
    const recorded = { ...accepted, taskId: succeeded.taskId };
    expect(accepted.action).toBe('ACCEPT'); expect(missionMayComplete({ state: 'VERIFYING', tasks: [succeeded], decisions: [recorded] })).toBe(true);
    expect(missionMayComplete({ state: 'EXECUTING', tasks: [succeeded], decisions: [recorded] })).toBe(false);
  });
});
