import { describe, expect, it } from 'vitest';

import { juliusFindingTransitionFacts } from '../../src/relay/mission/julius/julius-finding-lifecycle';
import { selectJuliusCarry, type JuliusCarrySelection } from '../../src/relay/mission/julius/julius-carry';
import type { JuliusReviewerFinding } from '../../src/relay/mission/julius/julius-verification-runtime';
import { createLiveJuliusBootstrapPort } from './bootstrap';
import type { MissionKnowledgeStore } from './mission-knowledge';
import { compileBootstrapRequest, parseLiveMissionContract } from './mission-contract';
import type { MissionSeedStore } from './mission-seed';

/**
 * THE BOOTSTRAP UNDER DECISION C's PAIR RULE.
 *
 * A WITH arm whose carry is empty, design-only or unreadable is refused BEFORE
 * the bootstrap writes anything, so there is no run, no task and nothing a paid
 * dispatch could pick up. A WITHOUT arm inherits nothing and records that it
 * did not. An ordinary mission is never refused for its carry. A WITH arm whose
 * restore fails is refused, never silently run empty.
 */

const CONTRACT = {
  missionId: 'mission:carry-1', markerNamespace: 'carry-one', projectId: 'prj-carry', tenantId: 'tenant-c',
  objective: 'Fix the date parser so 2026-02-30 is refused.',
  requirements: ['Refuse impossible dates.'], constraints: ['Touch only src/date.ts.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'Impossible dates are refused.', blocking: true }],
  testCommand: 'node --test', workspacePath: '/workspace/carry', limits: { spendUsd: 2, repairCycles: 1 },
};
const WORKERS = [
  { role: 'PROMPT_ARCHITECT', integrationId: 'a', adapterId: 'openai-architect', independenceGroup: 'openai', requiredCapabilities: ['plan'] },
  { role: 'CODING_AGENT', integrationId: 'b', adapterId: 'claude-code', independenceGroup: 'anthropic', requiredCapabilities: ['code'] },
  { role: 'INDEPENDENT_REVIEWER', integrationId: 'c', adapterId: 'hermes', independenceGroup: 'xai', requiredCapabilities: ['review'] },
] as const;

const request = (carryArm?: 'WITHOUT' | 'WITH') => {
  const parsed = parseLiveMissionContract(JSON.stringify(carryArm === undefined ? CONTRACT : { ...CONTRACT, carryArm }));
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, WORKERS as never, 'card-1');
};

const finding: JuliusReviewerFinding = {
  findingId: 'f-1', runId: 'run:prior', taskId: 'run:prior:build', reviewerWorkerId: 'reviewer', severity: 'HIGH',
  category: 'correctness', claim: 'parseDate accepts 2026-02-30.', criterionId: null, evidenceIds: ['e-1'], blocking: true,
  status: 'OPEN', createdAt: '2026-10-01T10:00:00.000Z',
};
const transitioned = (move: 'REPAIR_SUCCEEDED' | 'REVIEWER_RESOLVED', ids: { review?: string; repair?: string }) => ({
  type: 'finding.transitioned', taskId: null,
  facts: juliusFindingTransitionFacts({ findingId: 'f-1', move, at: '2026-10-01T11:00:00.000Z', reviewTaskId: ids.review ?? null, repairTaskId: ids.repair ?? null }),
});
const repairedSource = {
  runId: 'run:prior',
  findings: [finding],
  ledger: [
    { type: 'finding.recorded', taskId: 'run:prior:review', facts: { findingId: 'f-1', reviewTaskId: 'run:prior:review' } },
    transitioned('REPAIR_SUCCEEDED', { repair: 'run:prior:repair-1' }),
    transitioned('REVIEWER_RESOLVED', { review: 'run:prior:review:repair-1' }),
  ],
};

function stage(knowledge: MissionKnowledgeStore | undefined) {
  const writes: string[] = [];
  const seeds: MissionSeedStore = {
    async ensureBase() { writes.push('ensureBase'); },
    async insertCriteria() { writes.push('criteria'); },
    async insertBrainEntries() { writes.push('brain'); },
  };
  let version = 0;
  const runs = {
    async loadRun() { return null; },
    async createRun(input: { runId: string }) { writes.push('createRun'); version = 1; return { runId: input.runId, state: 'CREATED', version }; },
    async addTask() { writes.push('addTask'); return true; },
    async transition(input: { to: string }) { version += 1; writes.push(`transition:${input.to}`); return { state: input.to, version }; },
    async putTaskContract() { writes.push('contract'); return true; },
  };
  const port = createLiveJuliusBootstrapPort({
    runs: runs as never, seeds, tenantId: 'tenant-c', executionId: 'execution-c',
    now: () => '2026-10-04T12:00:00.000Z', ...(knowledge === undefined ? {} : { knowledge }),
  });
  return { port, writes };
}

function knowledgeOf(selection: (targetRunId: string) => JuliusCarrySelection | Error, restoreFails = false) {
  const restored: Array<{ arm: string | null; selected: number; firstRevision: number }> = [];
  const store: MissionKnowledgeStore = {
    async select(input) {
      const result = selection(input.targetRunId);
      if (result instanceof Error) throw result;
      return result;
    },
    async restore(input) {
      if (restoreFails) throw new Error('store unavailable');
      restored.push({ arm: input.arm, selected: input.selection.selected.length, firstRevision: input.firstRevision });
      return input.selection.selected.length;
    },
  };
  return { store, restored };
}

describe('the WITH arm', () => {
  it('with a verified repair finding: bootstraps, and restores exactly the selection after the seed', async () => {
    const { store, restored } = knowledgeOf((target) => selectJuliusCarry({ targetRunId: target, sources: [repairedSource], claims: [] }));
    const { port, writes } = stage(store);
    const outcome = await port.submit(request('WITH'));
    expect(outcome.accepted).toBe(true);
    expect(restored).toEqual([{ arm: 'WITH', selected: 1, firstRevision: 3 + 1 + 1 }]);
    expect(writes.indexOf('brain')).toBeLessThan(writes.indexOf('addTask'));
  });

  it.each([
    ['an empty carry', () => selectJuliusCarry({ targetRunId: 'x', sources: [], claims: [] }), 'CARRY_EMPTY'],
    ['a design-only carry', () => selectJuliusCarry({
      targetRunId: 'x', sources: [],
      claims: [{
        sourceRunId: 'run:prior', taskId: null,
        claim: { claimId: 'claim:d', entryId: 'd', provenance: 'system_policy', trust: 'APPROVED', assertedBy: 'founder', assertedAt: '2026-10-01T00:00:00.000Z', evidence: [{ kind: 'DECISION', id: 'dec-1' }], supersedes: null, contradicts: [] },
        entry: { entryId: 'd', kind: 'DECISION', text: 'Use ISO dates.', evidenceIds: [] },
      }],
    }), 'CARRY_DESIGN_ONLY'],
    ['an unreadable carry', () => new Error('connection refused'), 'CARRY_UNKNOWN'],
  ] as const)('with %s: refused before anything is written', async (_name, selection, code) => {
    const { store, restored } = knowledgeOf(selection as never);
    const { port, writes } = stage(store);
    const outcome = await port.submit(request('WITH'));
    expect(outcome).toMatchObject({ accepted: false, reasonCode: 'carry_pair_invalid' });
    if (outcome.accepted) return;
    expect(outcome.safeMessage).toContain(code);
    expect(writes, 'no run, no task, nothing a paid dispatch could pick up').toEqual([]);
    expect(restored).toEqual([]);
  });

  it('with no knowledge store bound at all: UNKNOWN, refused', async () => {
    const { port, writes } = stage(undefined);
    const outcome = await port.submit(request('WITH'));
    expect(outcome).toMatchObject({ accepted: false, reasonCode: 'carry_pair_invalid' });
    expect(writes).toEqual([]);
  });

  it('whose restore fails: refused as a persistence failure, never run with nothing to learn from', async () => {
    const { store } = knowledgeOf((target) => selectJuliusCarry({ targetRunId: target, sources: [repairedSource], claims: [] }), true);
    const { port, writes } = stage(store);
    const outcome = await port.submit(request('WITH'));
    expect(outcome).toMatchObject({ accepted: false, reasonCode: 'bootstrap_persistence_failure' });
    expect(writes).not.toContain('transition:READY');
  });
});

describe('the WITHOUT arm', () => {
  it('inherits nothing, is never asked, and its manifest records an empty WITHOUT carry', async () => {
    let asked = 0;
    const { store, restored } = knowledgeOf((target) => {
      asked += 1;
      return selectJuliusCarry({ targetRunId: target, sources: [repairedSource], claims: [] });
    });
    const { port } = stage(store);
    const outcome = await port.submit(request('WITHOUT'));
    expect(outcome.accepted).toBe(true);
    expect(asked).toBe(0);
    expect(restored).toEqual([{ arm: 'WITHOUT', selected: 0, firstRevision: 5 }]);
  });
});

describe('an ordinary mission', () => {
  it('carries what is selected, with no arm', async () => {
    const { store, restored } = knowledgeOf((target) => selectJuliusCarry({ targetRunId: target, sources: [repairedSource], claims: [] }));
    const outcome = await stage(store).port.submit(request());
    expect(outcome.accepted).toBe(true);
    expect(restored).toEqual([{ arm: null, selected: 1, firstRevision: 5 }]);
  });

  it('is never refused for its carry: an unreadable store means no carry and no manifest', async () => {
    const { store, restored } = knowledgeOf(() => new Error('connection refused'));
    const outcome = await stage(store).port.submit(request());
    expect(outcome.accepted).toBe(true);
    expect(restored, 'nothing restored, and no manifest claiming an empty carry').toEqual([]);
  });

  it('tolerates a failed restore', async () => {
    const { store } = knowledgeOf((target) => selectJuliusCarry({ targetRunId: target, sources: [repairedSource], claims: [] }), true);
    expect((await stage(store).port.submit(request())).accepted).toBe(true);
  });
});

describe('the contract', () => {
  it('accepts WITHOUT and WITH, refuses anything else, and makes the two arms two runs', () => {
    expect(parseLiveMissionContract(JSON.stringify({ ...CONTRACT, carryArm: 'BOTH' }))).toEqual({
      ok: false, problem: 'The contract field "carryArm" must be "WITHOUT" or "WITH" when present.',
    });
    const withArm = request('WITH');
    const withoutArm = request('WITHOUT');
    expect(withArm.carryArm).toBe('WITH');
    expect(withoutArm.carryArm).toBe('WITHOUT');
    expect(request().carryArm).toBeUndefined();
    expect(withArm.idempotencyKey).not.toBe(withoutArm.idempotencyKey);
  });
});
