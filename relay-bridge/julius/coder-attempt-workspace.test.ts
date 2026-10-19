import { describe, expect, it } from 'vitest';

import { JuliusDispatchError, type JuliusContextSnapshot, type JuliusWorker } from '../../src/relay/mission/julius';
import { JULIUS_CONTEXT_COMPILER_VERSION } from '../../src/relay/mission/julius';
import { readJuliusAttemptWorkspace } from '../../src/relay/mission/julius/julius-workspace-attribution';
import { readJuliusCodingAgentImplementation } from '../../src/relay/mission/julius/julius-coding-agent';
import { createFakeExecutorShell, createScriptedCodingAgentProvider } from './coding-agent-fixtures';
import { createJuliusCodingAgentAdapter, createInMemoryArtifactExchange } from './live-workers';

/**
 * WHAT THE ADAPTER RECORDS ABOUT ONE ATTEMPT — including the attempts that failed.
 *
 * The executor is a fake that answers the snapshot commands; the provider is a
 * deterministic fixture. Nothing is called and nothing is spent.
 */

const WS = '/workspace/mission';
const TREE = (seed: string): string => seed.repeat(40).slice(0, 40);
const WORKER: JuliusWorker = {
  workerId: 'coding-agent', role: 'CODING_AGENT', adapterId: 'coding-agent-adapter', providerId: 'anthropic',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
};
const CHARGE = Object.freeze({
  stage: 'build' as const,
  binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
  objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
  inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
  prohibitedActions: [], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
  requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: [], stoppingCondition: 'The suite is green.',
});
const snapshot = (): JuliusContextSnapshot => ({
  contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: WORKER.workerId, workerRole: 'CODING_AGENT',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
  taskContractRevision: 2, taskContractDigest: CHARGE.binding.bindingDigest,
  sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: ['AC-1'],
  contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
    // A fixture packet was compiled without claims, so no integrity decision
    // was made for it. NULL says that; `[]` would say it was checked.
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
  packet: {
    missionId: 'mission-1', taskId: 'build-1', workerId: WORKER.workerId, sourceEntryIds: ['brain:objective'],
    blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize the mission label.' }], truncated: false,
  },
});
const DISPATCH = { taskId: 'build-1', contextId: 'ctx-1', taskType: 'build', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contract: CHARGE, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };

const adapterOver = (
  provider: Parameters<typeof createJuliusCodingAgentAdapter>[0]['provider'],
  shell: ReturnType<typeof createFakeExecutorShell>,
) => {
  const artifacts = createInMemoryArtifactExchange();
  artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
  return createJuliusCodingAgentAdapter({
    worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
    workspacePath: WS, testCommand: 'npm test', shell, provider,
  });
};
const completed = () => createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
const failed = () => createScriptedCodingAgentProvider({ script: [{ kind: 'failed', failure: 'PARTIAL_RESPONSE', runtimeStarted: true }] });
const steps = (shell: ReturnType<typeof createFakeExecutorShell>): string[] =>
  shell.invocations.map((effect) => effect.invocationKey.split(':').pop()!);
const attemptOf = (value: unknown) => readJuliusAttemptWorkspace(readJuliusCodingAgentImplementation(value)!.attempt);

describe('a successful attempt says which changes are its own', () => {
  it('carries the three trees and the three sets, kept apart', async () => {
    const shell = createFakeExecutorShell({
      status: [' M src/slug.ts'],
      own: [['M', 'src/slug.ts']],
      inherited: [['M', 'src/inherited.ts']],
      cumulative: [['M', 'src/inherited.ts'], ['M', 'src/slug.ts']],
    });
    const result = await adapterOver(completed(), shell).dispatch(DISPATCH) as { implementation: unknown };
    const record = readJuliusCodingAgentImplementation(result.implementation)!;
    expect(record.attemptOutcome).toBe('SUCCEEDED');
    const attempt = attemptOf(result.implementation);
    expect(attempt.captured).toBe(true);
    expect(attempt.baseTree).toBe(TREE('b'));
    expect(attempt.startTree).toBe(TREE('5'));
    expect(attempt.endTree).toBe(TREE('e'));
    expect(attempt.own.map((change) => change.path)).toEqual(['src/slug.ts']);
    expect(attempt.inherited.map((change) => change.path)).toEqual(['src/inherited.ts']);
    expect(attempt.cumulative.map((change) => change.path)).toEqual(['src/inherited.ts', 'src/slug.ts']);
    // The change set the contract is checked from is still the one against HEAD.
    expect(record.workspace).toEqual({ captured: true, truncated: false, changes: [{ path: 'src/slug.ts', change: 'MODIFIED' }] });
  });
});

describe('a failed attempt owns what it changed', () => {
  it('takes the close-out look and carries it on the failure', async () => {
    const shell = createFakeExecutorShell({ status: [' M src/persistence/ledger.ts'], own: [['M', 'src/persistence/ledger.ts']] });
    const refusal = await adapterOver(failed(), shell).dispatch(DISPATCH).then(() => null, (error: unknown) => error as JuliusDispatchError);
    expect(refusal).toBeInstanceOf(JuliusDispatchError);
    expect(steps(shell)).toEqual(['base', 'status']);
    const record = readJuliusCodingAgentImplementation(refusal!.implementation)!;
    expect(record.attemptOutcome).toBe('FAILED');
    expect(attemptOf(refusal!.implementation).own.map((change) => change.path)).toEqual(['src/persistence/ledger.ts']);
  });

  it('a runtime that never started changed nothing, so nothing is looked for', async () => {
    const shell = createFakeExecutorShell({});
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'failed', failure: 'LAUNCH_FAILED', runtimeStarted: false }] });
    const refusal = await adapterOver(provider, shell).dispatch(DISPATCH).then(() => null, (error: unknown) => error as JuliusDispatchError);
    expect(steps(shell)).toEqual(['base']);
    expect(attemptOf(refusal!.implementation).captured).toBe(false);
  });

  it('a cancelled attempt collects nothing after the abort, and says why it is unknown', async () => {
    const shell = createFakeExecutorShell({});
    const controller = new AbortController();
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'runUntilAborted', started: () => controller.abort('lease_lost') }] });
    const refusal = await adapterOver(provider, shell).dispatch({ ...DISPATCH, signal: controller.signal })
      .then(() => null, (error: unknown) => error as JuliusDispatchError);
    expect(refusal!.code).toBe('CANCELLED');
    expect(steps(shell)).toEqual(['base']);
    const record = readJuliusCodingAgentImplementation(refusal!.implementation)!;
    expect(record.uncapturedReason).toBe('DISPATCH_CANCELLED');
    expect(attemptOf(refusal!.implementation).captured).toBe(false);
  });
});

describe('a snapshot that did not arrive is not a clean workspace', () => {
  it('without the start snapshot the change set is still read, and the attempt claims no attribution', async () => {
    const shell = createFakeExecutorShell({ baseFails: true, status: [' M src/slug.ts'] });
    const result = await adapterOver(completed(), shell).dispatch(DISPATCH) as { implementation: unknown };
    const record = readJuliusCodingAgentImplementation(result.implementation)!;
    expect(record.workspace.captured, 'the change set arrived').toBe(true);
    expect(attemptOf(result.implementation).captured, 'the attribution did not').toBe(false);
    // And the executor was asked the plain question, because there was nothing to compare against.
    expect(shell.commands[1]).toBe('git status --porcelain=v1 --untracked-files=all -z');
  });

  it('without the end snapshot nothing is attributed either', async () => {
    const shell = createFakeExecutorShell({ endTree: null, status: [' M src/slug.ts'] });
    const result = await adapterOver(completed(), shell).dispatch(DISPATCH) as { implementation: unknown };
    expect(attemptOf(result.implementation).captured).toBe(false);
  });
});

describe('the undo Julius asked for, as the executor answered it', () => {
  it('reports what it put back when the workspace was still the refused attempt\'s tree', async () => {
    const shell = createFakeExecutorShell({ restore: 'RESTORED', restoreCounts: [2, 1] });
    const result = await adapterOver(completed(), shell).dispatch({
      ...DISPATCH, workspace: { restoreToTree: TREE('5'), expectedTree: TREE('e') },
    }) as { implementation: unknown };
    expect(shell.commands[0], 'the guard travels with the request').toContain(`if [ "$CUR" = "${TREE('e')}" ]`);
    expect(attemptOf(result.implementation).restore).toMatchObject({ outcome: 'RESTORED', removed: 2, restored: 1 });
  });

  it('reports a refusal when the workspace moved, and the attempt runs anyway', async () => {
    const shell = createFakeExecutorShell({ restore: 'REFUSED_TREE_MOVED' });
    const result = await adapterOver(completed(), shell).dispatch({
      ...DISPATCH, workspace: { restoreToTree: TREE('5'), expectedTree: TREE('e') },
    }) as { status: string; implementation: unknown };
    expect(result.status).toBe('SUCCEEDED');
    expect(attemptOf(result.implementation).restore).toMatchObject({ outcome: 'REFUSED_TREE_MOVED' });
  });

  it('asks for no undo when Julius did not authorise one', async () => {
    const shell = createFakeExecutorShell({});
    const result = await adapterOver(completed(), shell).dispatch(DISPATCH) as { implementation: unknown };
    expect(shell.commands[0]).toContain('RESTORE NONE');
    expect(shell.commands[0]).not.toContain('git read-tree');
    expect(attemptOf(result.implementation).restore).toBeNull();
  });
});
