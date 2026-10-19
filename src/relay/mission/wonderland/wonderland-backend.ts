export const WONDERLAND_EVENT_SCHEMA_VERSION = 'relay-wonderland-event.v1' as const;

export const WONDERLAND_EVENT_TYPES = [
  'mission.created', 'mission.started', 'mission.stage_changed', 'mission.completed', 'mission.failed',
  'agent.planning', 'agent.implementing', 'agent.reviewing', 'agent.verifying', 'agent.repairing', 'agent.complete', 'agent.error',
  'subagent.spawned', 'subagent.started', 'subagent.progress', 'subagent.completed', 'subagent.failed',
  'verification.started', 'verification.finding', 'verification.failed', 'verification.passed',
  'project_avatar.progress', 'project_avatar.stage_changed', 'project_avatar.evolved',
  'battle.created', 'battle.accepted', 'battle.started', 'battle.telemetry', 'battle.swarm_activated', 'battle.finding', 'battle.completed',
  'presence.joined', 'presence.updated', 'presence.left',
] as const;

export type WonderlandEventType = typeof WONDERLAND_EVENT_TYPES[number];
export type WonderlandVisibility = 'OWNER' | 'PARTICIPANTS' | 'PUBLIC';
export type BattleMode = 'GOAL' | 'EVAL';
export type RelayMissionPhase = 'prompt_architect_working' | 'coding_agent_starting' | 'coding' | 'reviewer_starting' | 'reviewer_working' | 'relay_verifying' | 'verification_failed' | 'verified_complete' | 'budget_exhausted';

export interface WonderlandEvent {
  readonly eventId: string;
  readonly schemaVersion: typeof WONDERLAND_EVENT_SCHEMA_VERSION;
  readonly timestamp: string;
  readonly projectId: string;
  readonly sessionId: string | null;
  readonly playerId: string | null;
  readonly agentId: string | null;
  readonly missionId: string | null;
  readonly battleId: string | null;
  readonly eventType: WonderlandEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly visibility: WonderlandVisibility;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly sequence: number;
}

export interface CardVersion {
  readonly cardVersionId: string;
  readonly ownerId: string;
  readonly agentId: string;
  readonly version: number;
  readonly promptArchitect: string;
  readonly codingAgent: string;
  readonly reviewer: string;
  readonly tools: readonly string[];
  readonly permissions: readonly string[];
  readonly autonomy: string;
  readonly models: readonly string[];
  readonly budgets: Readonly<{ tokens: number; costUsd: number; toolCalls: number; runtimeMs: number }>;
  readonly verificationPolicy: readonly string[];
  readonly capabilities: readonly string[];
  readonly runtimeConfiguration: Readonly<Record<string, string | number | boolean>>;
}

export type MissionContractStage = 'DRAFT' | 'LOCKED' | 'READY' | 'RUNNING' | 'VERIFYING' | 'REPAIRING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
export interface MissionContract {
  readonly missionId: string;
  readonly projectId: string;
  stage: MissionContractStage;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly allowedTools: readonly string[];
  readonly permissions: readonly string[];
  readonly budgets: Readonly<{ tokens: number; costUsd: number; toolCalls: number; runtimeMs: number }>;
  readonly timeLimitMs: number;
  readonly verificationRequirements: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly participants: readonly string[];
  readonly cardSnapshots: readonly CardVersion[];
  readonly canonicalHash: string;
}

export interface ProjectBrain {
  readonly projectId: string;
  objective: string;
  requirements: string[];
  architecture: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  decisions: string[];
  research: string[];
  findings: string[];
  handoffs: string[];
  repairs: string[];
  evidenceReferences: string[];
  missionHistory: string[];
  currentState: string;
  battleLessons: string[];
}

export type AvatarStage = 'SEED_EGG' | 'BABY' | 'GROWING' | 'ADVANCED' | 'FINAL';
export interface ProjectAvatar {
  readonly avatarId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly form: string;
  stage: AvatarStage;
  xp: number;
  milestones: string[];
  appearanceUnlocks: string[];
  evolutionEvidence: string[];
}

export interface Challenge {
  readonly challengeId: string;
  readonly projectId: string;
  readonly challengerId: string;
  readonly challengedId: string;
  readonly challengerAgentId: string;
  readonly challengedAgentId: string;
  readonly challengerCardVersionId: string;
  readonly challengedCardVersionId: string;
  readonly mode: BattleMode;
  readonly objective: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
}

export interface Evidence {
  readonly evidenceId: string;
  readonly battleId: string;
  readonly ownerId: string;
  readonly category: 'visible_tests' | 'hidden_tests' | 'adversarial_tests' | 'robustness' | 'security' | 'performance' | 'regression';
  readonly supported: boolean;
  readonly passed: boolean | null;
  readonly score: number | null;
  readonly summary: string;
}

export interface Usage {
  inputTokens: number; outputTokens: number; costUsd: number; toolCalls: number; computeMs: number; sandboxRuntimeMs: number; subagentUsage: number;
}

export interface Subagent {
  readonly subagentId: string; readonly role: string; readonly parentAgentId: string;
  readonly budget: number; readonly permissions: readonly string[];
  state: 'SPAWNED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  telemetry: string[]; evidenceIds: string[]; artifactIds: string[];
}

export interface Finding {
  readonly findingId: string; readonly battleId: string; readonly category: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; readonly evaluatorAgentId: string;
  readonly targetAgentId: string; readonly evidenceIds: readonly string[]; readonly confidence: number;
  readonly remediation: string; verificationState: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rebuttalState: 'NONE' | 'SUBMITTED' | 'UPHELD' | 'REBUTTED'; rebuttalEvidenceIds: string[];
}

export interface Battle {
  readonly battleId: string; readonly projectId: string; readonly mode: BattleMode;
  readonly participantIds: readonly [string, string]; readonly agentIds: readonly [string, string];
  readonly cardSnapshots: readonly [CardVersion, CardVersion]; readonly missionId: string;
  state: 'READY' | 'RUNNING' | 'VERIFYING' | 'COMPLETE' | 'FAILED';
  swarms: Subagent[]; evidence: Evidence[]; findings: Finding[];
  usage: Record<string, Usage>; winnerId: string | null; result: BattleResult | null;
}

export interface BattleResult {
  readonly winnerId: string | null; readonly scores: Readonly<Record<string, number>>;
  readonly explanations: Readonly<Record<string, readonly string[]>>;
  readonly recommendations: readonly CardRecommendation[];
}
export interface CardRecommendation {
  readonly recommendationId: string; readonly sourceBattleId: string; readonly ownerId: string;
  readonly evidenceIds: readonly string[]; readonly component: string; readonly confidence: number;
  readonly severity: string; readonly expectedImprovement: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'APPLIED';
}
export interface RewardGrant { readonly grantId: string; readonly battleId: string; readonly playerId: string; readonly kind: string; readonly value: string; }
export interface Presence { readonly sessionId: string; readonly projectId: string; readonly playerId: string; status: 'ONLINE' | 'AWAY'; challengeAvailable: boolean; expiresAt: number; }

export interface WonderlandSnapshot {
  sequence: number; events: WonderlandEvent[]; members: Record<string, string[]>; cards: Record<string, CardVersion>;
  brains: Record<string, ProjectBrain>; avatars: Record<string, ProjectAvatar>; challenges: Record<string, Challenge>;
  contracts: Record<string, MissionContract>; battles: Record<string, Battle>; rewards: Record<string, RewardGrant>;
  presence: Record<string, Presence>; commandResults: Record<string, unknown>;
}

export interface WonderlandExecutor {
  run(input: { battleId: string; projectId: string; playerId: string; agentId: string; mission: MissionContract; isolatedWorkspaceKey: string }): Promise<readonly Evidence[]>;
  runSubagent(input: { battleId: string; playerId: string; agentId: string; role: string; isolatedWorkspaceKey: string }): Promise<{ telemetry: readonly string[]; evidence: readonly Evidence[]; artifactIds: readonly string[] }>;
}

const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, computeMs: 0, sandboxRuntimeMs: 0, subagentUsage: 0 });
const clone = <T>(value: T): T => structuredClone(value);
/** Stable pure-domain fingerprint. It detects snapshot drift; it is not an authentication MAC. */
const canonical = (value: unknown): string => {
  const text = JSON.stringify(value);
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5];
  for (let i = 0; i < text.length; i += 1) {
    for (let j = 0; j < words.length; j += 1) {
      words[j] ^= text.charCodeAt(i) + j;
      words[j] = Math.imul(words[j], 0x01000193) >>> 0;
    }
  }
  return words.map(word => word.toString(16).padStart(8, '0')).join('');
};
const safePayload = (input: unknown): Readonly<Record<string, unknown>> => redact(input) as Readonly<Record<string, unknown>>;

export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input !== null && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, value]) =>
      /token|secret|password|authorization|credential|system.?prompt|chain.?of.?thought|private.?prompt|api.?key/i.test(key)
        ? [key, '[REDACTED]'] : [key, redact(value)]));
  }
  if (typeof input === 'string') return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:sk|gh[opusr])_[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
  return input;
}

export class WonderlandBackend {
  private readonly listeners = new Set<(event: WonderlandEvent) => void>();
  constructor(private state: WonderlandSnapshot, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = () => globalThis.crypto.randomUUID()) {}
  static empty(now?: () => string, newId?: () => string): WonderlandBackend {
    return new WonderlandBackend({ sequence: 0, events: [], members: {}, cards: {}, brains: {}, avatars: {}, challenges: {}, contracts: {}, battles: {}, rewards: {}, presence: {}, commandResults: {} }, now, newId);
  }
  snapshot(): WonderlandSnapshot { return clone(this.state); }
  restore(snapshot: WonderlandSnapshot): void { this.state = clone(snapshot); }
  registerProject(projectId: string, memberIds: readonly string[], objective = ''): void {
    this.state.members[projectId] = [...new Set(memberIds)];
    this.state.brains[projectId] ??= { projectId, objective, requirements: [], architecture: [], constraints: [], acceptanceCriteria: [], decisions: [], research: [], findings: [], handoffs: [], repairs: [], evidenceReferences: [], missionHistory: [], currentState: 'READY', battleLessons: [] };
  }
  registerCard(card: CardVersion): void { this.state.cards[card.cardVersionId] = clone(card); }
  registerAvatar(avatar: ProjectAvatar): void { this.state.avatars[avatar.avatarId] = clone(avatar); }
  joinPresence(playerId: string, commandId: string, input: { projectId: string; sessionId: string; nowMs: number; ttlMs?: number; challengeAvailable?: boolean }): Presence { return this.once(commandId, () => { this.member(input.projectId, playerId); const presence: Presence = { sessionId: input.sessionId, projectId: input.projectId, playerId, status: 'ONLINE', challengeAvailable: input.challengeAvailable ?? true, expiresAt: input.nowMs + (input.ttlMs ?? 45_000) }; this.state.presence[input.sessionId] = presence; this.append({ projectId: input.projectId, sessionId: input.sessionId, playerId, agentId: null, missionId: null, battleId: null, eventType: 'presence.joined', payload: { status: presence.status, challengeAvailable: presence.challengeAvailable }, visibility: 'PUBLIC', correlationId: commandId, causationId: null }); return clone(presence); }); }
  heartbeatPresence(playerId: string, sessionId: string, nowMs: number, ttlMs = 45_000): Presence { const presence = this.state.presence[sessionId]; if (!presence || presence.playerId !== playerId || presence.expiresAt <= nowMs) throw new Error('stale_or_foreign_session'); presence.expiresAt = nowMs + ttlMs; this.append({ projectId: presence.projectId, sessionId, playerId, agentId: null, missionId: null, battleId: null, eventType: 'presence.updated', payload: { status: presence.status, challengeAvailable: presence.challengeAvailable }, visibility: 'PUBLIC', correlationId: sessionId, causationId: null }); return clone(presence); }
  leavePresence(playerId: string, sessionId: string): void { const presence = this.state.presence[sessionId]; if (!presence || presence.playerId !== playerId) throw new Error('stale_or_foreign_session'); delete this.state.presence[sessionId]; this.append({ projectId: presence.projectId, sessionId, playerId, agentId: null, missionId: null, battleId: null, eventType: 'presence.left', payload: {}, visibility: 'PUBLIC', correlationId: sessionId, causationId: null }); }
  expirePresence(nowMs: number): number { let expired = 0; for (const presence of Object.values(this.state.presence)) if (presence.expiresAt <= nowMs) { delete this.state.presence[presence.sessionId]; expired += 1; this.append({ projectId: presence.projectId, sessionId: presence.sessionId, playerId: presence.playerId, agentId: null, missionId: null, battleId: null, eventType: 'presence.left', payload: { reason: 'expired' }, visibility: 'PUBLIC', correlationId: presence.sessionId, causationId: null }); } return expired; }
  private member(projectId: string, playerId: string): void { if (!this.state.members[projectId]?.includes(playerId)) throw new Error('permission_denied'); }
  private card(playerId: string, cardId: string, agentId: string): CardVersion {
    const card = this.state.cards[cardId]; if (!card || card.ownerId !== playerId || card.agentId !== agentId) throw new Error('card_or_agent_not_owned'); return card;
  }
  private append(input: Omit<WonderlandEvent, 'eventId' | 'schemaVersion' | 'timestamp' | 'sequence' | 'payload'> & { payload: unknown }): WonderlandEvent {
    const event: WonderlandEvent = { ...input, eventId: this.newId(), schemaVersion: WONDERLAND_EVENT_SCHEMA_VERSION, timestamp: this.now(), sequence: ++this.state.sequence, payload: safePayload(input.payload) };
    this.state.events.push(event); for (const listener of this.listeners) listener(event); return event;
  }
  /** The automatic Relay→Wonderland seam. Unknown Missions are ignored rather than fabricated. */
  observeRelayTransition(missionId: string, phase: RelayMissionPhase): readonly WonderlandEvent[] {
    const battle = Object.values(this.state.battles).find(candidate => candidate.missionId === missionId);
    if (!battle) return [];
    const types: readonly WonderlandEventType[] = phase === 'prompt_architect_working' ? ['agent.planning']
      : phase === 'coding_agent_starting' || phase === 'coding' ? ['agent.implementing']
        : phase === 'reviewer_starting' || phase === 'reviewer_working' ? ['agent.reviewing']
          : phase === 'relay_verifying' ? ['agent.verifying', 'verification.started']
            : phase === 'verification_failed' ? ['verification.failed', 'agent.repairing']
              : phase === 'verified_complete' ? ['mission.completed']
                : ['agent.error'];
    return types.map(eventType => this.append({ projectId: battle.projectId, sessionId: null, playerId: null, agentId: null, missionId, battleId: battle.battleId, eventType, payload: { relayPhase: phase }, visibility: 'PARTICIPANTS', correlationId: battle.battleId, causationId: null }));
  }
  private once<T>(commandId: string, action: () => T): T { if (commandId in this.state.commandResults) return clone(this.state.commandResults[commandId] as T); const before = clone(this.state); try { const result = action(); this.state.commandResults[commandId] = clone(result); return result; } catch (error) { this.state = before; throw error; } }
  createChallenge(actorId: string, commandId: string, input: Omit<Challenge, 'challengeId' | 'challengerId' | 'status'>): Challenge {
    return this.once(commandId, () => { this.member(input.projectId, actorId); this.member(input.projectId, input.challengedId); this.card(actorId, input.challengerCardVersionId, input.challengerAgentId); this.card(input.challengedId, input.challengedCardVersionId, input.challengedAgentId); if (actorId === input.challengedId) throw new Error('invalid_challenge');
      const challenge: Challenge = { ...clone(input), challengeId: this.newId(), challengerId: actorId, status: 'PENDING' }; this.state.challenges[challenge.challengeId] = challenge; return clone(challenge); });
  }
  acceptChallenge(actorId: string, commandId: string, challengeId: string): Battle {
    return this.once(commandId, () => { const c = this.state.challenges[challengeId]; if (!c || c.status !== 'PENDING') throw new Error('challenge_not_pending'); if (actorId !== c.challengedId) throw new Error('permission_denied'); this.member(c.projectId, actorId);
      const cards = [this.card(c.challengerId, c.challengerCardVersionId, c.challengerAgentId), this.card(c.challengedId, c.challengedCardVersionId, c.challengedAgentId)] as const;
      c.status = 'ACCEPTED'; const missionId = this.newId(); const contractBody = { projectId: c.projectId, objective: c.objective, acceptanceCriteria: ['Evidence-backed completion'], constraints: ['Isolated workspaces', 'No private opponent state'], allowedTools: [...new Set(cards.flatMap(x => x.tools))], permissions: [...new Set(cards.flatMap(x => x.permissions))], budgets: { tokens: Math.min(...cards.map(x => x.budgets.tokens)), costUsd: Math.min(...cards.map(x => x.budgets.costUsd)), toolCalls: Math.min(...cards.map(x => x.budgets.toolCalls)), runtimeMs: Math.min(...cards.map(x => x.budgets.runtimeMs)) }, timeLimitMs: Math.min(...cards.map(x => x.budgets.runtimeMs)), verificationRequirements: ['visible_tests', 'security'], evidenceRequirements: ['machine-verifiable result'], participants: [c.challengerId, c.challengedId], cardSnapshots: clone(cards) };
      const contract: MissionContract = { missionId, stage: 'LOCKED', ...contractBody, canonicalHash: canonical(contractBody) }; this.state.contracts[missionId] = contract;
      const battle: Battle = { battleId: this.newId(), projectId: c.projectId, mode: c.mode, participantIds: [c.challengerId, c.challengedId], agentIds: [c.challengerAgentId, c.challengedAgentId], cardSnapshots: clone(cards), missionId, state: 'READY', swarms: [], evidence: [], findings: [], usage: { [c.challengerId]: emptyUsage(), [c.challengedId]: emptyUsage() }, winnerId: null, result: null }; this.state.battles[battle.battleId] = battle;
      for (const [eventType, payload] of [['battle.accepted', { challengeId }], ['mission.created', { canonicalHash: contract.canonicalHash }], ['battle.created', { mode: c.mode }]] as const) this.append({ projectId: c.projectId, sessionId: null, playerId: actorId, agentId: null, missionId, battleId: battle.battleId, eventType, payload, visibility: 'PARTICIPANTS', correlationId: battle.battleId, causationId: null }); return clone(battle); });
  }
  async startBattle(actorId: string, commandId: string, battleId: string, executor: WonderlandExecutor): Promise<Battle> {
    const existing = this.state.commandResults[commandId] as Battle | undefined; if (existing) return clone(existing);
    const battle = this.state.battles[battleId]; if (!battle || !battle.participantIds.includes(actorId)) throw new Error('permission_denied'); if (battle.state !== 'READY') throw new Error('battle_not_ready');
    battle.state = 'RUNNING'; this.state.contracts[battle.missionId].stage = 'RUNNING'; this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId: null, missionId: battle.missionId, battleId, eventType: 'battle.started', payload: {}, visibility: 'PUBLIC', correlationId: battleId, causationId: null });
    const evidence = await Promise.all(battle.participantIds.map((playerId, i) => executor.run({ battleId, projectId: battle.projectId, playerId, agentId: battle.agentIds[i], mission: clone(this.state.contracts[battle.missionId]), isolatedWorkspaceKey: canonical([battleId, playerId]) })));
    battle.evidence.push(...evidence.flat()); battle.state = 'VERIFYING'; this.state.contracts[battle.missionId].stage = 'VERIFYING'; this.state.commandResults[commandId] = clone(battle); return clone(battle);
  }
  async activateSwarm(actorId: string, commandId: string, battleId: string, executor: WonderlandExecutor, roles?: readonly string[]): Promise<readonly Subagent[]> {
    const prior = this.state.commandResults[commandId] as readonly Subagent[] | undefined; if (prior) return clone(prior); const battle = this.state.battles[battleId]; if (!battle || !battle.participantIds.includes(actorId)) throw new Error('permission_denied'); if (battle.state !== 'RUNNING' && battle.state !== 'VERIFYING') throw new Error('battle_not_active');
    const index = battle.participantIds.indexOf(actorId); const agentId = battle.agentIds[index]; const selected = (roles ?? (battle.mode === 'GOAL' ? ['research', 'implementation', 'testing', 'review', 'verification'] : ['architecture', 'security', 'memory', 'orchestration', 'verification', 'efficiency'])).slice(0, 6); if (battle.swarms.some(x => x.parentAgentId === agentId)) throw new Error('swarm_already_activated');
    this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId, missionId: battle.missionId, battleId, eventType: 'battle.swarm_activated', payload: { count: selected.length }, visibility: 'PARTICIPANTS', correlationId: battleId, causationId: null });
    const workers: Subagent[] = selected.map(role => ({ subagentId: this.newId(), role, parentAgentId: agentId, budget: 1, permissions: ['evidence:write'], state: 'SPAWNED', telemetry: [], evidenceIds: [], artifactIds: [] })); battle.swarms.push(...workers);
    await Promise.all(workers.map(async worker => { this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId, missionId: battle.missionId, battleId, eventType: 'subagent.spawned', payload: { subagentId: worker.subagentId, role: worker.role }, visibility: 'PARTICIPANTS', correlationId: battleId, causationId: null }); worker.state = 'RUNNING'; this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId, missionId: battle.missionId, battleId, eventType: 'subagent.started', payload: { subagentId: worker.subagentId }, visibility: 'PARTICIPANTS', correlationId: battleId, causationId: null }); try { const result = await executor.runSubagent({ battleId, playerId: actorId, agentId, role: worker.role, isolatedWorkspaceKey: canonical([battleId, actorId, worker.subagentId]) }); worker.telemetry = result.telemetry.map(x => redact(x) as string); worker.evidenceIds = result.evidence.map(x => x.evidenceId); worker.artifactIds = [...result.artifactIds]; worker.state = 'COMPLETE'; battle.evidence.push(...result.evidence); this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId, missionId: battle.missionId, battleId, eventType: 'subagent.completed', payload: { subagentId: worker.subagentId, evidenceIds: worker.evidenceIds }, visibility: 'PARTICIPANTS', correlationId: battleId, causationId: null }); } catch { worker.state = 'FAILED'; this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId, missionId: battle.missionId, battleId, eventType: 'subagent.failed', payload: { subagentId: worker.subagentId }, visibility: 'PARTICIPANTS', correlationId: battleId, causationId: null }); } }));
    battle.usage[actorId].subagentUsage += workers.length; this.state.commandResults[commandId] = clone(workers); return clone(workers);
  }
  addFinding(actorId: string, battleId: string, input: Omit<Finding, 'findingId' | 'battleId' | 'verificationState' | 'rebuttalState' | 'rebuttalEvidenceIds'>): Finding { const battle = this.state.battles[battleId]; if (!battle || battle.mode !== 'EVAL' || battle.agentIds[battle.participantIds.indexOf(actorId)] !== input.evaluatorAgentId) throw new Error('permission_denied'); const finding: Finding = { ...clone(input), findingId: this.newId(), battleId, verificationState: 'PENDING', rebuttalState: 'NONE', rebuttalEvidenceIds: [] }; battle.findings.push(finding); this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId: input.evaluatorAgentId, missionId: battle.missionId, battleId, eventType: 'battle.finding', payload: finding, visibility: 'PARTICIPANTS', correlationId: battleId, causationId: null }); return clone(finding); }
  rebutFinding(actorId: string, battleId: string, findingId: string, evidenceIds: readonly string[]): Finding { const battle = this.state.battles[battleId]; const finding = battle?.findings.find(x => x.findingId === findingId); if (!battle || !finding || battle.agentIds[battle.participantIds.indexOf(actorId)] !== finding.targetAgentId) throw new Error('permission_denied'); finding.rebuttalState = 'SUBMITTED'; finding.rebuttalEvidenceIds = [...evidenceIds]; return clone(finding); }
  verifyFinding(battleId: string, findingId: string, verified: boolean, rebutted: boolean): Finding { const finding = this.state.battles[battleId]?.findings.find(x => x.findingId === findingId); if (!finding) throw new Error('finding_not_found'); finding.verificationState = verified ? 'VERIFIED' : 'REJECTED'; finding.rebuttalState = rebutted ? 'REBUTTED' : finding.rebuttalState === 'SUBMITTED' ? 'UPHELD' : 'NONE'; return clone(finding); }
  finalize(actorId: string, commandId: string, battleId: string): BattleResult { return this.once(commandId, () => { const battle = this.state.battles[battleId]; if (!battle || !battle.participantIds.includes(actorId)) throw new Error('permission_denied'); if (battle.state !== 'VERIFYING') throw new Error('battle_not_verifying'); const scores: Record<string, number> = {}; for (const player of battle.participantIds) { const supported = battle.evidence.filter(x => x.ownerId === player && x.supported && x.score !== null); scores[player] = supported.length ? supported.reduce((n, x) => n + (x.passed ? x.score! : 0), 0) / supported.length : 0; if (battle.mode === 'EVAL') { const agent = battle.agentIds[battle.participantIds.indexOf(player)]; scores[player] -= battle.findings.filter(x => x.targetAgentId === agent && x.verificationState === 'VERIFIED' && x.rebuttalState !== 'REBUTTED').reduce((n, x) => n + ({ LOW: 2, MEDIUM: 5, HIGH: 10, CRITICAL: 20 }[x.severity]), 0); } }
      const ordered = [...battle.participantIds].sort((a, b) => scores[b] - scores[a]); const winnerId = scores[ordered[0]] === scores[ordered[1]] ? null : ordered[0]; const recommendations: CardRecommendation[] = battle.participantIds.map(player => ({ recommendationId: this.newId(), sourceBattleId: battleId, ownerId: player, evidenceIds: battle.evidence.filter(x => x.ownerId === player && x.supported).map(x => x.evidenceId), component: scores[player] < 70 ? 'verification_policy' : 'efficiency', confidence: 0.8, severity: scores[player] < 50 ? 'HIGH' : 'MEDIUM', expectedImprovement: scores[player] < 70 ? 'Increase evidence-backed verification coverage.' : 'Reduce spend while preserving verified outcomes.', status: 'PENDING' })); const explanations = Object.fromEntries(battle.participantIds.map(player => [player, [winnerId === player ? 'WHY YOU WON: stronger supported GVE evidence.' : winnerId === null ? 'RESULT: evidence produced a draw.' : 'WHY YOU LOST: the opponent produced stronger supported GVE evidence.', 'WHAT YOUR AGENT DID WELL: supported evidence was counted.', 'WHERE YOUR AGENT STAGNATED: unsupported categories were not scored.', 'WHAT THE OPPONENT DID BETTER: see the comparative evidence scores.', 'HOW YOUR C.A.R.D. COULD EVOLVE: review the persisted recommendation.']])); const result: BattleResult = { winnerId, scores, explanations, recommendations }; battle.winnerId = winnerId; battle.result = result; battle.state = 'COMPLETE'; this.state.contracts[battle.missionId].stage = 'COMPLETE';
      const brain = this.state.brains[battle.projectId]; brain.missionHistory.push(battle.missionId); brain.evidenceReferences.push(...battle.evidence.filter(x => x.supported).map(x => x.evidenceId));
      for (const player of battle.participantIds) { const rewardKey = `${battleId}:${player}:completion`; this.state.rewards[rewardKey] ??= { grantId: this.newId(), battleId, playerId: player, kind: 'XP', value: winnerId === player ? '100' : '40' }; brain.battleLessons.push(...explanations[player]); const avatar = Object.values(this.state.avatars).find(x => x.projectId === battle.projectId && x.ownerId === player); if (avatar) { const xp = Number(this.state.rewards[rewardKey].value); avatar.xp += xp; avatar.evolutionEvidence.push(...battle.evidence.filter(x => x.ownerId === player && x.supported && x.passed).map(x => x.evidenceId)); const stages: AvatarStage[] = ['SEED_EGG', 'BABY', 'GROWING', 'ADVANCED', 'FINAL']; avatar.stage = stages[Math.min(4, Math.floor(avatar.xp / 100))]; } }
      this.append({ projectId: battle.projectId, sessionId: null, playerId: actorId, agentId: null, missionId: battle.missionId, battleId, eventType: 'battle.completed', payload: { winnerId, scores }, visibility: 'PUBLIC', correlationId: battleId, causationId: null }); return clone(result); }); }
  eventsFor(input: { projectId: string; playerId: string; cursor?: number; battleId?: string }): WonderlandEvent[] { this.member(input.projectId, input.playerId); if (input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || input.cursor < 0)) throw new Error('malformed_cursor'); return this.state.events.filter(event => event.projectId === input.projectId && event.sequence > (input.cursor ?? 0) && (!input.battleId || event.battleId === input.battleId) && (event.visibility === 'PUBLIC' || event.playerId === input.playerId || (event.visibility === 'PARTICIPANTS' && event.battleId !== null && this.state.battles[event.battleId]?.participantIds.includes(input.playerId)))); }
  subscribe(input: { projectId: string; playerId: string; cursor?: number; battleId?: string }, listener: (event: WonderlandEvent) => void): () => void { for (const event of this.eventsFor(input)) listener(event); const live = (event: WonderlandEvent) => { if (this.eventsFor({ ...input, cursor: event.sequence - 1 }).some(x => x.eventId === event.eventId)) listener(event); }; this.listeners.add(live); return () => { this.listeners.delete(live); }; }
}
