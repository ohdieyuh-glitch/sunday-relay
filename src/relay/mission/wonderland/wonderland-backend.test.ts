import { describe, expect, it } from 'vitest';
import { WonderlandBackend, type CardVersion, type Evidence, type ProjectAvatar, type WonderlandExecutor } from './wonderland-backend';

const card = (ownerId: string, agentId: string, cardVersionId: string): CardVersion => ({
  cardVersionId, ownerId, agentId, version: 1, promptArchitect: 'architect-v1', codingAgent: 'coder-v1', reviewer: 'reviewer-v1',
  tools: ['workspace', 'tests'], permissions: ['workspace:write'], autonomy: 'supervised', models: ['model-v1'],
  budgets: { tokens: 10_000, costUsd: 5, toolCalls: 100, runtimeMs: 60_000 }, verificationPolicy: ['visible_tests', 'security'],
  capabilities: ['implementation', 'review'], runtimeConfiguration: { concurrency: 2 },
});

function fixture(mode: 'GOAL' | 'EVAL' = 'GOAL') {
  let id = 0;
  const backend = WonderlandBackend.empty(() => '2026-08-24T00:00:00.000Z', () => `id-${++id}`);
  backend.registerProject('project-1', ['alice', 'bob', 'spy'], 'Build a verified feature');
  backend.registerCard(card('alice', 'agent-a', 'card-a'));
  backend.registerCard(card('bob', 'agent-b', 'card-b'));
  for (const [avatarId, ownerId] of [['avatar-a', 'alice'], ['avatar-b', 'bob']]) backend.registerAvatar({ avatarId, ownerId, projectId: 'project-1', form: 'relay-dog', stage: 'SEED_EGG', xp: 0, milestones: [], appearanceUnlocks: [], evolutionEvidence: [] } as ProjectAvatar);
  const challenge = backend.createChallenge('alice', 'cmd-challenge', { projectId: 'project-1', challengedId: 'bob', challengerAgentId: 'agent-a', challengedAgentId: 'agent-b', challengerCardVersionId: 'card-a', challengedCardVersionId: 'card-b', mode, objective: mode === 'GOAL' ? 'Implement safely' : 'Evaluate orchestration' });
  const battle = backend.acceptChallenge('bob', 'cmd-accept', challenge.challengeId);
  return { backend, battle };
}

const executor: WonderlandExecutor = {
  async run(input) {
    const score = input.playerId === 'alice' ? 92 : 75;
    return [{ evidenceId: `run-${input.playerId}`, battleId: input.battleId, ownerId: input.playerId, category: 'visible_tests', supported: true, passed: true, score, summary: 'real test runner result' }];
  },
  async runSubagent(input) {
    const evidence: Evidence = { evidenceId: `swarm-${input.role}`, battleId: input.battleId, ownerId: input.playerId, category: input.role === 'security' ? 'security' : 'robustness', supported: true, passed: true, score: 88, summary: 'bounded worker result' };
    return { telemetry: ['test passed', 'Bearer super-secret-token'], evidence: [evidence], artifactIds: [`artifact-${input.role}`] };
  },
};

describe('authoritative Goal Mode vertical slice', () => {
  it('maps real Relay Mission transitions automatically without timers or caller mirroring', () => {
    const { backend, battle } = fixture();
    const phases = ['prompt_architect_working', 'coding', 'reviewer_working', 'relay_verifying', 'verification_failed', 'verified_complete', 'budget_exhausted'] as const;
    for (const phase of phases) backend.observeRelayTransition(battle.missionId, phase);
    expect(backend.eventsFor({ projectId: 'project-1', playerId: 'alice', battleId: battle.battleId }).map(event => event.eventType)).toEqual(expect.arrayContaining([
      'agent.planning', 'agent.implementing', 'agent.reviewing', 'agent.verifying', 'verification.started',
      'verification.failed', 'agent.repairing', 'mission.completed', 'agent.error',
    ]));
    expect(backend.observeRelayTransition('unknown-mission', 'coding')).toEqual([]);
  });

  it('locks identical rules and immutable C.A.R.D. snapshots server-side', () => {
    const { backend, battle } = fixture();
    const snapshot = backend.snapshot();
    const contract = snapshot.contracts[battle.missionId];
    expect(contract.stage).toBe('LOCKED');
    expect(contract.participants).toEqual(['alice', 'bob']);
    expect(contract.cardSnapshots.map(x => x.cardVersionId)).toEqual(['card-a', 'card-b']);
    expect(contract.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => backend.createChallenge('spy', 'forged', { projectId: 'project-1', challengedId: 'bob', challengerAgentId: 'agent-a', challengedAgentId: 'agent-b', challengerCardVersionId: 'card-a', challengedCardVersionId: 'card-b', mode: 'GOAL', objective: 'steal' })).toThrow('card_or_agent_not_owned');
  });

  it('executes isolated competitors, a real bounded swarm, GVE scoring, one reward, Brain and Avatar updates', async () => {
    const { backend, battle } = fixture();
    await backend.startBattle('alice', 'cmd-start', battle.battleId, executor);
    const workers = await backend.activateSwarm('alice', 'cmd-swarm', battle.battleId, executor, ['research', 'security']);
    expect(workers).toHaveLength(2);
    expect(workers.every(x => x.state === 'COMPLETE' && x.evidenceIds.length === 1)).toBe(true);
    expect(workers[0].telemetry[1]).toBe('Bearer [REDACTED]');
    const result = backend.finalize('bob', 'cmd-finalize', battle.battleId);
    expect(result.winnerId).toBe('alice');
    expect(result.explanations.bob.join(' ')).toContain('WHY YOU LOST');
    const repeated = backend.finalize('bob', 'cmd-finalize', battle.battleId);
    expect(repeated).toEqual(result);
    const state = backend.snapshot();
    expect(Object.values(state.rewards)).toHaveLength(2);
    expect(state.brains['project-1'].missionHistory).toEqual([battle.missionId]);
    expect(state.avatars['avatar-a'].xp).toBe(100);
    expect(state.avatars['avatar-a'].stage).toBe('BABY');
  });

  it('replays ordered missed events without polling and filters private battle telemetry', () => {
    const { backend, battle } = fixture();
    const participant = backend.eventsFor({ projectId: 'project-1', playerId: 'alice', cursor: 0, battleId: battle.battleId });
    expect(participant.map(x => x.sequence)).toEqual([...participant.map(x => x.sequence)].sort((a, b) => a - b));
    expect(participant.some(x => x.eventType === 'battle.created')).toBe(true);
    expect(backend.eventsFor({ projectId: 'project-1', playerId: 'spy', cursor: 0, battleId: battle.battleId })).toEqual([]);
    expect(() => backend.eventsFor({ projectId: 'project-1', playerId: 'alice', cursor: -1 })).toThrow('malformed_cursor');
    const source = WonderlandBackend.toString();
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('setTimeout');
  });

  it('recovers durable state and suppresses duplicate commands and rewards after restart', async () => {
    const { backend, battle } = fixture();
    await backend.startBattle('alice', 'cmd-start', battle.battleId, executor);
    backend.finalize('alice', 'cmd-finalize', battle.battleId);
    const recovered = WonderlandBackend.empty();
    recovered.restore(backend.snapshot());
    const replay = recovered.finalize('alice', 'cmd-finalize', battle.battleId);
    expect(replay.winnerId).toBe('alice');
    expect(Object.values(recovered.snapshot().rewards)).toHaveLength(2);
  });
});

describe('Eval Mode evidence and rebuttal', () => {
  it('counts only verified unrebutted findings and persists evolution recommendations', async () => {
    const { backend, battle } = fixture('EVAL');
    await backend.startBattle('alice', 'cmd-start', battle.battleId, executor);
    await backend.activateSwarm('alice', 'cmd-eval-swarm', battle.battleId, executor, ['architecture', 'security']);
    const finding = backend.addFinding('alice', battle.battleId, { category: 'verification_weakness', severity: 'HIGH', evaluatorAgentId: 'agent-a', targetAgentId: 'agent-b', evidenceIds: ['run-bob'], confidence: 0.9, remediation: 'Require independent security verification.' });
    backend.rebutFinding('bob', battle.battleId, finding.findingId, ['run-bob']);
    backend.verifyFinding(battle.battleId, finding.findingId, true, true);
    const result = backend.finalize('bob', 'cmd-finalize', battle.battleId);
    expect(result.scores.bob).toBe(75);
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations.every(x => x.status === 'PENDING')).toBe(true);
  });
});
