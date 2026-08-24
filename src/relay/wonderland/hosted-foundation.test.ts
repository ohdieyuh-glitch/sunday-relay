import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createFileArtifactStore } from './artifacts'; import { executeSwarm, ProviderBudgetEnforcer, type ProviderReceiptSource, type RelaySubagentWorker } from './execution';
import type { Swarm } from './types';
import { createMemoryWonderlandStore } from './store'; import { WonderlandService } from './service';

describe('hosted execution and evidence boundaries', () => {
  it('executes every bounded swarm role through a real injected worker', async () => {
    const seen: string[] = []; const worker: RelaySubagentWorker = { async execute(task, _signal, telemetry) { seen.push(task.role); telemetry('task.started', { role: task.role }); return { subagentId: task.subagentId, usage: [], evidence: [], findings: [], artifacts: [] }; } };
    const swarm: Swarm = { id: 's1', battleId: 'b1', parentAgentId: 'a1', mode: 'GOAL', roles: ['testing', 'review'], subagentIds: ['sa1', 'sa2'], tokenBudget: 100, timeBudgetMs: 1000, toolCallLimit: 4, startedAt: 'now', completedAt: null };
    const results = await executeSwarm(swarm, 'verify it', worker, new AbortController().signal, () => undefined); expect(results.map((r) => r.subagentId)).toEqual(['sa1', 'sa2']); expect(seen).toEqual(['testing', 'review']);
  });
  it('signs durable artifacts and prevents cross-player private reads', () => {
    const root = mkdtempSync(join(tmpdir(), 'wonderland-artifacts-'));
    try {
      const store = createFileArtifactStore(root, 'a-secure-signing-secret-with-32-bytes');
      store.put({ id: 'artifact1', projectId: 'p1', ownerPlayerId: 'owner', battleId: 'b1', visibility: 'OWNER', mediaType: 'text/plain', createdAt: 'now' }, Buffer.from('private evidence'));
      const expiry = Date.now() + 10_000; const ownerToken = store.sign('artifact1', 'owner', expiry);
      expect(Buffer.from(store.read('artifact1', { playerId: 'owner', projectIds: ['p1'], battleIds: ['b1'] }, ownerToken)!).toString('utf8')).toBe('private evidence');
      const opponentToken = store.sign('artifact1', 'opponent', expiry);
      expect(store.read('artifact1', { playerId: 'opponent', projectIds: ['p1'], battleIds: ['b1'] }, opponentToken)).toBeNull();
      const restarted = createFileArtifactStore(root, 'a-secure-signing-secret-with-32-bytes'); const restartedToken = restarted.sign('artifact1', 'owner', expiry); expect(Buffer.from(restarted.read('artifact1', { playerId: 'owner', projectIds: ['p1'], battleIds: ['b1'] }, restartedToken)!).toString()).toBe('private evidence');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('accepts only authoritative provider receipts and halts at the cumulative budget', () => {
    const api = new WonderlandService(createMemoryWonderlandStore()); let listener: Parameters<ProviderReceiptSource['onReceipt']>[0] = () => undefined;
    const source: ProviderReceiptSource = { onReceipt(next) { listener = next; return { close() {} }; } };
    const permissions = { tools: ['model'], network: false, fileRead: true, fileWrite: false, execute: true, approvalRequired: [], maxSubagents: 1 };
    new ProviderBudgetEnforcer(api, { agent1: { projectId: 'p1', missionId: 'm1', playerId: 'player1', permissions, budget: { tokenLimit: 10, computeLimit: 10, toolCallLimit: 10, spendLimitUsd: 1 } } }).attach(source);
    listener({ receiptId: 'r1', provider: 'provider', subjectId: 'agent1', at: 'now', tokens: 9, compute: 1, toolCalls: 1, spendUsd: 0.1 });
    expect(() => listener({ receiptId: 'r2', provider: 'provider', subjectId: 'agent1', at: 'now', tokens: 2, compute: 0, toolCalls: 0, spendUsd: 0 })).toThrow('budget');
    expect(api.state().events.at(-1)?.payload).toMatchObject({ code: 'budget_exhausted' });
  });
});
