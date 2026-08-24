import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { redactTelemetry, validateWonderlandEvent } from './contracts';
import { WonderlandDomainError, WonderlandService } from './service';
import { createFileWonderlandStore, createMemoryWonderlandStore } from './store';
import type { CardVersion, MissionContract, PermissionBounds, SpendBudget, VerificationEvidence } from './types';

const NOW = '2026-08-24T12:00:00.000Z';
let counter = 0;
const service = (store = createMemoryWonderlandStore()) => new WonderlandService(store, { now: () => NOW, id: (kind) => `${kind}_${++counter}` });
const permissions: PermissionBounds = { tools: ['shell', 'tests'], network: false, fileRead: true, fileWrite: true, execute: true, approvalRequired: ['deploy'], maxSubagents: 3 };
const budget: SpendBudget = { tokenLimit: 10_000, computeLimit: 100, toolCallLimit: 20, spendLimitUsd: 10 };
const cardInput = (cardId: string, agentId: string): Omit<CardVersion, 'id' | 'version' | 'createdAt'> => ({ cardId, promptArchitect: 'architect-v1', codingAgent: 'coder-v1', reviewer: 'reviewer-v1', tools: ['shell', 'tests'], permissions, autonomy: 'AUTONOMOUS', models: { coding: 'model-a' }, budgets: budget, verificationPolicy: ['hidden tests required'], capabilityFlags: ['swarm'], runtimeConfiguration: { agentId } });
const missionInput = (cards: string[]): Omit<MissionContract, 'id' | 'status' | 'revision' | 'lockedSnapshot'> => ({ projectId: 'project-1', objective: 'Implement a verified parser', acceptanceCriteria: ['all tests pass'], constraints: ['no network'], allowedTools: ['shell', 'tests'], permissions, budget, timeLimitMs: 60_000, verificationRequirements: ['visible', 'hidden'], cardVersionIds: cards, participants: ['p1', 'p2'], evidenceRequirements: ['test report'], competitive: true });
const evidence = (id: string, passed: boolean, weight: number, summary: string): VerificationEvidence => ({ id, passed, weight, summary, kind: 'HIDDEN_TEST' });

function prepared(mode: 'GOAL' | 'EVAL' = 'GOAL') {
  const api = service(); const c1 = api.createCard('card-1', cardInput('card-a', 'agent-a')); const c2 = api.createCard('card-2', cardInput('card-b', 'agent-b'));
  let mission: MissionContract | undefined;
  if (mode === 'GOAL') { mission = api.createMission('mission-create', missionInput([c1.id, c2.id])); mission = api.transitionMission('mission-lock', mission.id, 'LOCKED'); }
  const battle = api.createBattle('challenge', mode, 'project-1', 'p1', 'p2'); api.acceptBattle('accept', battle.id, 'p2', { p1: c1.id, p2: c2.id }, mission?.id); api.startBattle('start', battle.id);
  return { api, battleId: battle.id, mission, c1, c2 };
}

describe('Wonderland client event contract and realtime stream', () => {
  it('validates versioned events and delivers cursor catch-up without duplicates', async () => {
    const api = service(); const mission = api.createMission('create', missionInput([])); const received: number[] = [];
    const subscription = api.events.subscribe(0, (event) => received.push(event.sequence));
    api.transitionMission('lock', mission.id, 'LOCKED'); await Promise.resolve(); subscription.close();
    expect(received).toEqual([1, 2]); expect(validateWonderlandEvent(api.state().events[0])).toEqual([]);
    const resumed: number[] = []; api.events.subscribe(1, (event) => resumed.push(event.sequence)).close(); expect(resumed).toEqual([2]);
  });
  it('separates visibility and redacts credentials, private prompts, and reasoning', () => {
    const payload = redactTelemetry({ command: 'curl Bearer abc.def.secret', systemPrompt: 'private', chain_of_thought: 'hidden', file: 'safe.ts' }, 'PUBLIC');
    expect(payload).toEqual({ command: 'curl [REDACTED]', systemPrompt: '[REDACTED]', chain_of_thought: '[REDACTED]', file: 'safe.ts' });
  });
  it('contains no timer or polling API in the event layer', async () => {
    const source = await import.meta.glob('./{store,service}.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.values(source).join('\n')).not.toMatch(/setInterval|setTimeout|pollMission|polling/);
  });
});

describe('durable authoritative domains', () => {
  it('enforces the Mission Contract lifecycle and freezes a competitive snapshot', () => {
    const api = service(); const draft = api.createMission('c', missionInput([])); expect(() => api.transitionMission('bad', draft.id, 'RUNNING')).toThrow(WonderlandDomainError);
    const locked = api.transitionMission('l', draft.id, 'LOCKED'); expect(locked.lockedSnapshot).toContain('Implement a verified parser');
    expect(api.transitionMission('r', draft.id, 'READY').status).toBe('READY'); expect(api.transitionMission('s', draft.id, 'RUNNING').status).toBe('RUNNING');
  });
  it('versions and snapshots C.A.R.D. configuration', () => {
    const api = service(); const v1 = api.createCard('v1', cardInput('card', 'agent')); const v2 = api.createCard('v2', { ...cardInput('card', 'agent'), autonomy: 'GUIDED' });
    expect([v1.version, v2.version]).toEqual([1, 2]); const battle = api.createBattle('b', 'EVAL', 'project-1', 'p1', 'p2'); const other = api.createCard('other', cardInput('other', 'agent-b'));
    const accepted = api.acceptBattle('a', battle.id, 'p2', { p1: v1.id, p2: other.id }); expect(accepted.cardSnapshots.p1.autonomy).toBe('AUTONOMOUS');
  });
  it('persists Project Brain, events, and state across process recreation', () => {
    const root = mkdtempSync(join(tmpdir(), 'wonderland-')); const path = join(root, 'state.json');
    try { const first = service(createFileWonderlandStore(path)); first.updateBrain('brain', 'project-1', { objective: 'durable objective', decisions: ['use event log'] }); const second = service(createFileWonderlandStore(path)); expect(second.state().brains['project-1']).toMatchObject({ objective: 'durable objective', version: 1 }); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('only advances an arbitrary-form Project Avatar from authoritative evidence', () => {
    const { api, battleId } = prepared(); api.createAvatar('avatar', 'project-1', 'crystal-fox'); expect(() => api.progressAvatar('fake', 'project-1', 100, 'client click', 'fake')).toThrow('authoritative');
    api.addEvidence('ev', battleId, evidence('e1', true, 1, 'verified')); api.completeBattle('done', battleId, { e1: 'p1' }); const avatar = api.progressAvatar('xp', 'project-1', 120, 'battle won', battleId); expect(avatar).toMatchObject({ formId: 'crystal-fox', stage: 'BABY', xp: 120 });
  });
  it('resumes presence with a private token and rejects an invalid token', () => {
    const api = service(); const session = api.joinPresence('join', { playerId: 'p1', relayDogId: 'dog-1', worldId: 'world', instanceId: 'i1', ttlMs: 1000, projectId: 'project-1' });
    expect(() => api.resumePresence('bad', session.id, 'wrong', 1000)).toThrow('Invalid resume token'); expect(api.resumePresence('resume', session.id, session.resumeToken, 2000).connected).toBe(true);
  });
});

describe('permissions, budgets, swarms and rewards', () => {
  it('enforces execution/tool permissions and cumulative spend', () => {
    const api = service(); expect(() => api.consume('deny', 'p1', { ...permissions, execute: false }, budget, { tokens: 1, compute: 1, toolCalls: 1, spendUsd: 1 })).toThrow('permission');
    expect(() => api.consume('tool', 'p1', permissions, budget, { tokens: 1, compute: 1, toolCalls: 1, spendUsd: 1 }, 'network')).toThrow('Tool permission');
    api.consume('ok', 'p1', permissions, budget, { tokens: 9_999, compute: 1, toolCalls: 1, spendUsd: 1 }, 'tests'); expect(() => api.consume('over', 'p1', permissions, budget, { tokens: 2, compute: 0, toolCalls: 0, spendUsd: 0 })).toThrow('budget');
  });
  it('bounds real sub-agent activation and emits sub-agent events', async () => {
    const { api, battleId } = prepared(); expect(() => api.activateSwarm('too-many', { battleId, parentAgentId: 'agent-a', roles: ['a', 'b', 'c', 'd'], tokenBudget: 100, timeBudgetMs: 1000, toolCallLimit: 2 })).toThrow('concurrency');
    const swarm = api.activateSwarm('swarm', { battleId, parentAgentId: 'agent-a', roles: ['testing', 'review'], tokenBudget: 100, timeBudgetMs: 1000, toolCallLimit: 2 }); await Promise.resolve();
    expect(swarm.subagentIds).toHaveLength(2); expect(api.state().events.filter((e) => e.eventType === 'subagent.spawned')).toHaveLength(2);
  });
  it('makes command and reward application idempotent', () => {
    const api = service(); const one = api.grantReward('battle:p1:rare', 'p1', 'skin', 'aurora', 1); const replay = api.grantReward('battle:p1:rare', 'p1', 'skin', 'aurora', 1);
    expect(replay.id).toBe(one.id); expect(api.state().rewards).toHaveLength(1); const first = api.createBattle('same-command', 'EVAL', 'project-1', 'p1', 'p2'); expect(api.createBattle('same-command', 'EVAL', 'project-1', 'p1', 'p2').id).toBe(first.id);
  });
});

describe('acceptance flows', () => {
  it('runs a complete two-player Goal Mode flow from one locked contract through reconnect', async () => {
    const { api, battleId, mission } = prepared(); expect(api.state().battles[battleId].missionContractId).toBe(mission?.id);
    api.agentEvent('planning', battleId, 'agent-a', 'p1', 'agent.planning'); api.agentEvent('implementing', battleId, 'agent-b', 'p2', 'agent.implementing');
    api.telemetry('terminal', { battleId, agentId: 'agent-a', playerId: 'p1', kind: 'test.started', detail: { command: 'npm test', apiKey: 'sk-abcdefghijklmnop' }, visibility: 'OWNER' });
    api.activateSwarm('swarm', { battleId, parentAgentId: 'agent-a', roles: ['testing', 'review'], tokenBudget: 500, timeBudgetMs: 5000, toolCallLimit: 5 });
    api.consume('usage-p1', 'p1', permissions, budget, { tokens: 100, compute: 1, toolCalls: 2, spendUsd: 0.2 }); api.consume('usage-p2', 'p2', permissions, budget, { tokens: 80, compute: 1, toolCalls: 1, spendUsd: 0.1 });
    api.addEvidence('e1-add', battleId, evidence('e1', true, 1, 'visible and hidden tests passed')); api.addEvidence('e2-add', battleId, evidence('e2', false, 1, 'regression failed'));
    const completed = api.completeBattle('complete', battleId, { e1: 'p1', e2: 'p2' }); expect(completed.result?.winnerPlayerId).toBe('p1'); expect(completed.result?.explanations.p2.outcome).toContain('WHY YOU LOST');
    const reward = api.grantReward(`battle:${battleId}:winner`, 'p1', 'XP', 'goal-win', 100); expect(api.grantReward(`battle:${battleId}:winner`, 'p1', 'XP', 'goal-win', 100).id).toBe(reward.id);
    api.updateBrain('brain-complete', 'project-1', { missionHistory: [mission!.id], currentState: 'Goal battle complete', evidenceReferences: ['e1'] });
    await Promise.resolve(); const recovered = api.events.subscribe(0, () => undefined); recovered.close(); expect(api.state().battles[battleId].status).toBe('COMPLETE'); expect(api.state().events.some((e) => e.eventType === 'battle.completed')).toBe(true);
  });
  it('runs Eval Mode with structured mutual findings, evaluator swarm, GVE evidence and recommendations', () => {
    const { api, battleId } = prepared('EVAL'); api.activateSwarm('evaluators', { battleId, parentAgentId: 'agent-a', roles: ['security', 'efficiency'], tokenBudget: 500, timeBudgetMs: 5000, toolCallLimit: 5 });
    api.addEvidence('sec-evidence', battleId, { ...evidence('sec-1', true, 1, 'permission boundary held'), kind: 'SECURITY' }); api.addEvidence('eff-evidence', battleId, { ...evidence('eff-1', true, 0.5, 'avoidable calls observed'), kind: 'PERFORMANCE' });
    api.addFinding('f1', battleId, { id: 'finding-1', category: 'inefficient_workflow', severity: 4, evidenceIds: ['eff-1'], evaluatorAgentId: 'p1', targetAgentId: 'p2', confidence: 0.9, remediation: 'Reduce redundant tool calls.', rebutted: false, verified: true });
    api.addFinding('f2', battleId, { id: 'finding-2', category: 'security', severity: 2, evidenceIds: ['sec-1'], evaluatorAgentId: 'p2', targetAgentId: 'p1', confidence: 0.7, remediation: 'Narrow file permissions.', rebutted: false, verified: true });
    const result = api.completeBattle('eval-complete', battleId, { 'sec-1': 'p1', 'eff-1': 'p2' }).result!; expect(result.explanations.p2.evolveCard).toContain('Reduce redundant tool calls.'); expect(result.winnerPlayerId).toBe('p1');
  });
});
