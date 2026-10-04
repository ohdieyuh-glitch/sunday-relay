import { describe, expect, it } from 'vitest';

import type { JuliusKnowledgeCarryOutcome } from '../../src/relay/mission/julius/julius-claim-ledger';
import type { JuliusKnowledgeCarryRequest } from '../../src/relay/persistence/julius-claim-postgres';
import { buildTaskId, createLiveJuliusBootstrapPort, planTaskId } from './bootstrap';
import { compileBootstrapRequest } from './mission-contract';
import { JULIUS_CARRIED_KNOWLEDGE_LIMIT, type MissionKnowledgeStore } from './mission-knowledge';
import type { MissionSeedStore } from './mission-seed';

/**
 * THE BOOTSTRAP'S HALF OF THE CORRECTED CARRY (founder ruling 2026-10-04), over recording fakes.
 *
 * The rule is the claim ledger's and the write is the store's; what the bootstrap owns is WHEN the carry runs,
 * WHAT it is asked for, and what an outcome may stop. Pinned here, in the order the bootstrap does it:
 *   - after the task graph (every carried row references the plan task) and before the run is READY;
 *   - scoped to this run's plan task, this mission, the bound limit, and — when the caller pins them — only the
 *     named source runs;
 *   - only on a run still CREATED as the STORE reads it: a replayed create always answers CREATED;
 *   - an EMPTY or FAILED carry starts the mission anyway, unless the caller REQUIRES inheritance, in which case it
 *     is refused by name before the run is READY and before anything could be dispatched.
 */

const OUTCOME = (over: Partial<JuliusKnowledgeCarryOutcome> = {}): JuliusKnowledgeCarryOutcome => ({
  outcome: 'CARRIED', carried: 2, written: 2, excluded: 3, reasonCode: null, eventId: 'julius-knowledge-carry.v2:run:x:e', ...over,
});

function recorder(input: { readonly state?: string; readonly carry?: JuliusKnowledgeCarryOutcome } = {}) {
  const calls: string[] = [];
  const requests: JuliusKnowledgeCarryRequest[] = [];
  let version = 0;
  const runs = {
    async loadRun() { calls.push('loadRun'); return { state: input.state ?? 'CREATED' }; },
    async createRun(created: { runId: string }) { version = 1; calls.push('createRun'); return { runId: created.runId, state: 'CREATED', version }; },
    async addTask(added: { task: { taskId: string } }) { calls.push(`addTask:${added.task.taskId}`); return true; },
    async transition(moved: { to: string }) { version += 1; calls.push(`transition:${moved.to}`); return { state: moved.to, version }; },
    async putTaskContract() { calls.push('putTaskContract'); return true; },
  };
  const seeds: MissionSeedStore = {
    async ensureBase() { calls.push('ensureBase'); },
    async insertCriteria() { calls.push('criteria'); },
    async insertBrainEntries() { calls.push('brain'); },
  };
  const knowledge: MissionKnowledgeStore = {
    async carryKnowledge(request) { calls.push('carry'); requests.push(request); return input.carry ?? OUTCOME(); },
  };
  return { calls, requests, runs, seeds, knowledge };
}

const REQUEST = () => compileBootstrapRequest({
  missionId: 'mission-carry-1', markerNamespace: 'carry-namespace', projectId: 'prj-carry', tenantId: 'tenant-carry',
  objective: 'Add the deploy step to the release script.',
  requirements: ['Run the migration first.'], constraints: ['Touch only scripts/.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The release script deploys after migrating.', blocking: true }],
  testCommand: 'npm test', workspacePath: '/workspace/carry',
}, [
  { role: 'PROMPT_ARCHITECT', integrationId: 'a', adapterId: 'openai-architect-live', independenceGroup: 'openai', requiredCapabilities: ['plan'] },
  { role: 'CODING_AGENT', integrationId: 'b', adapterId: 'claude-agent-sdk-hosted-live', independenceGroup: 'anthropic', requiredCapabilities: ['implement'] },
  { role: 'INDEPENDENT_REVIEWER', integrationId: 'c', adapterId: 'hermes-local-live', independenceGroup: 'xai', requiredCapabilities: ['review'] },
], 'card-carry-1');

describe('the bootstrap carries after the task graph, before READY, for a run that is still CREATED', () => {
  it('asks for exactly this run, its plan task, its mission and the bound — after both tasks exist, before the contract and the transitions', async () => {
    const fake = recorder();
    const port = createLiveJuliusBootstrapPort({ runs: fake.runs as never, seeds: fake.seeds, knowledge: fake.knowledge, tenantId: 'tenant-carry', executionId: 'execution-carry' });
    const outcome = await port.submit(REQUEST());
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) throw new Error('unreachable');
    const at = (call: string) => fake.calls.indexOf(call);
    expect(at('carry'), 'the plan task must exist first: carried rows reference it').toBeGreaterThan(at(`addTask:${planTaskId(outcome.runId)}`));
    expect(at('carry')).toBeGreaterThan(at(`addTask:${buildTaskId(outcome.runId)}`));
    expect(at('loadRun'), 'the state is read from the store, right before').toBe(at('carry') - 1);
    expect(at('carry'), 'and the run is not READY yet').toBeLessThan(at('putTaskContract'));
    expect(at('carry')).toBeLessThan(at('transition:PLANNING'));
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      runId: outcome.runId, projectId: 'prj-carry', missionId: 'mission-carry-1',
      scopeTaskId: planTaskId(outcome.runId), limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT,
    });
    expect('fromRunIds' in fake.requests[0]!, 'no source is pinned unless the caller pins one').toBe(false);
  });

  it('carries nothing on a run that already moved on — a replayed create always answers CREATED, so the store is asked', async () => {
    const fake = recorder({ state: 'EXECUTING' });
    const port = createLiveJuliusBootstrapPort({ runs: fake.runs as never, seeds: fake.seeds, knowledge: fake.knowledge, tenantId: 'tenant-carry', executionId: 'execution-carry' });
    await port.submit(REQUEST());
    expect(fake.calls).toContain('loadRun');
    expect(fake.calls, 'a running mission is never handed new inheritance mid-flight').not.toContain('carry');
  });

  it('starts a mission whose carry was EMPTY or FAILED when nobody requires inheritance — the outcome is the store’s record, not a reason to stop', async () => {
    for (const carry of [OUTCOME({ outcome: 'EMPTY', carried: 0, written: 0 }), OUTCOME({ outcome: 'FAILED', carried: 0, written: 0, reasonCode: 'carry_write_failed' })]) {
      const fake = recorder({ carry });
      const port = createLiveJuliusBootstrapPort({ runs: fake.runs as never, seeds: fake.seeds, knowledge: fake.knowledge, tenantId: 'tenant-carry', executionId: 'execution-carry' });
      const outcome = await port.submit(REQUEST());
      expect(outcome, carry.outcome).toMatchObject({ accepted: true, state: 'READY' });
      expect(fake.calls).toContain('carry');
    }
  });

  it('touches no knowledge and reads no state when no store is bound and nothing is required — every other caller is unchanged', async () => {
    const fake = recorder();
    const port = createLiveJuliusBootstrapPort({ runs: fake.runs as never, seeds: fake.seeds, tenantId: 'tenant-carry', executionId: 'execution-carry' });
    expect(await port.submit(REQUEST())).toMatchObject({ accepted: true, state: 'READY' });
    expect(fake.calls).not.toContain('carry');
    expect(fake.calls).not.toContain('loadRun');
  });
});

describe('a caller that REQUIRES inheritance (a registered arm WITH) is refused on an empty or failed carry, before READY', () => {
  const refusedFor = async (carry: JuliusKnowledgeCarryOutcome | null) => {
    const fake = recorder(carry === null ? {} : { carry });
    const port = createLiveJuliusBootstrapPort({
      runs: fake.runs as never, seeds: fake.seeds, ...(carry === null ? {} : { knowledge: fake.knowledge }),
      carry: { required: true, fromRunIds: ['run:without'] }, tenantId: 'tenant-carry', executionId: 'execution-carry',
    });
    return { outcome: await port.submit(REQUEST()), fake };
  };

  it('refuses EMPTY, FAILED and an unbound store by name, and never advances the run or writes its contract', async () => {
    for (const carry of [
      OUTCOME({ outcome: 'EMPTY', carried: 0, written: 0 }),
      OUTCOME({ outcome: 'FAILED', carried: 0, written: 0, reasonCode: 'carry_sources_unreadable', eventId: null }),
      null,
    ]) {
      const { outcome, fake } = await refusedFor(carry);
      const label = carry === null ? 'no store' : carry.outcome;
      expect(outcome, label).toMatchObject({ accepted: false, reasonCode: 'carried_knowledge_required', retryable: false });
      if (outcome.accepted) throw new Error('unreachable');
      if (carry !== null) expect(outcome.safeMessage, label).toContain(carry.outcome);
      expect(fake.calls.filter((call) => call.startsWith('transition:')), `${label}: the run is never made READY`).toEqual([]);
      expect(fake.calls, `${label}: no contract, so nothing could be dispatched`).not.toContain('putTaskContract');
    }
  });

  it('starts when the carry inherited at least one row, and pins the source the caller named', async () => {
    const { outcome, fake } = await refusedFor(OUTCOME({ outcome: 'CARRIED', carried: 1, written: 1 }));
    expect(outcome).toMatchObject({ accepted: true, state: 'READY' });
    expect(fake.requests[0]?.fromRunIds).toEqual(['run:without']);
  });

  it('refuses a carry that says CARRIED with nothing in it — the count is the evidence, not the word', async () => {
    const { outcome } = await refusedFor(OUTCOME({ outcome: 'CARRIED', carried: 0, written: 0 }));
    expect(outcome).toMatchObject({ accepted: false, reasonCode: 'carried_knowledge_required' });
  });
});
