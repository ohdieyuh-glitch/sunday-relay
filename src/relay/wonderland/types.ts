/** Stable, client-facing Wonderland v1 contracts. Never include model reasoning or secrets. */
export const WONDERLAND_SCHEMA_VERSION = 1 as const;

export const WONDERLAND_EVENT_TYPES = [
  'mission.created', 'mission.started', 'mission.stage_changed', 'mission.completed', 'mission.failed',
  'agent.researching', 'agent.planning', 'agent.implementing', 'agent.handoff', 'agent.reviewing',
  'agent.verifying', 'agent.repairing', 'agent.approval_required', 'agent.complete', 'agent.error',
  'subagent.spawned', 'subagent.started', 'subagent.progress', 'subagent.completed', 'subagent.failed',
  'project_avatar.progress', 'project_avatar.stage_changed', 'project_avatar.evolved',
  'verification.started', 'verification.finding', 'verification.failed', 'verification.passed',
  'battle.created', 'battle.accepted', 'battle.started', 'battle.telemetry', 'battle.swarm_activated',
  'battle.finding', 'battle.completed', 'presence.joined', 'presence.updated', 'presence.left',
] as const;
export type WonderlandEventType = typeof WONDERLAND_EVENT_TYPES[number];
export type Visibility = 'OWNER' | 'PARTICIPANTS' | 'PUBLIC';

export interface WonderlandEvent {
  eventId: string; schemaVersion: typeof WONDERLAND_SCHEMA_VERSION; occurredAt: string;
  projectId: string; sessionId: string | null; playerId: string | null; agentId: string | null;
  missionId: string | null; battleId: string | null; eventType: WonderlandEventType;
  payload: Readonly<Record<string, unknown>>; visibility: Visibility;
  correlationId: string; causationId: string | null; sequence: number;
}

export type MissionStatus = 'DRAFT' | 'LOCKED' | 'READY' | 'RUNNING' | 'VERIFYING' | 'REPAIRING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
export interface SpendBudget { tokenLimit: number; computeLimit: number; toolCallLimit: number; spendLimitUsd: number; }
export interface PermissionBounds { tools: readonly string[]; network: boolean; fileRead: boolean; fileWrite: boolean; execute: boolean; approvalRequired: readonly string[]; maxSubagents: number; }
export interface MissionContract {
  id: string; projectId: string; objective: string; acceptanceCriteria: readonly string[];
  constraints: readonly string[]; allowedTools: readonly string[]; permissions: PermissionBounds;
  budget: SpendBudget; timeLimitMs: number | null; verificationRequirements: readonly string[];
  cardVersionIds: readonly string[]; participants: readonly string[]; evidenceRequirements: readonly string[];
  status: MissionStatus; revision: number; competitive: boolean; lockedSnapshot: string | null;
}

export interface CardVersion {
  id: string; cardId: string; version: number; createdAt: string;
  promptArchitect: string; codingAgent: string; reviewer: string; tools: readonly string[];
  permissions: PermissionBounds; autonomy: 'GUIDED' | 'AUTONOMOUS'; models: Readonly<Record<string, string>>;
  budgets: SpendBudget; verificationPolicy: readonly string[]; capabilityFlags: readonly string[];
  runtimeConfiguration: Readonly<Record<string, string | number | boolean>>;
}
export interface ProjectBrain {
  projectId: string; objective: string; requirements: string[]; architecture: string[]; constraints: string[];
  acceptanceCriteria: string[]; decisions: string[]; research: string[]; findings: string[]; handoffs: string[];
  repairs: string[]; evidenceReferences: string[]; missionHistory: string[]; currentState: string; version: number;
}
export type AvatarStage = 'SEED_EGG' | 'BABY' | 'GROWING' | 'ADVANCED' | 'FINAL';
export interface ProjectAvatar { id: string; projectId: string; formId: string; stage: AvatarStage; xp: number; milestones: string[]; unlockedAppearances: string[]; evolutionEvents: Array<{ stage: AvatarStage; at: string; evidenceId: string }>; }
export interface PresenceSession { id: string; projectId: string; playerId: string; relayDogId: string; worldId: string; instanceId: string; challengeAvailable: boolean; connected: boolean; expiresAt: string; resumeToken: string; }
export type BattleMode = 'GOAL' | 'EVAL';
export type BattleStatus = 'PENDING' | 'ACCEPTED' | 'RUNNING' | 'COMPLETE' | 'DECLINED' | 'FAILED';
export interface VerificationEvidence { id: string; kind: 'VISIBLE_TEST' | 'HIDDEN_TEST' | 'ADVERSARIAL' | 'ROBUSTNESS' | 'SECURITY' | 'PERFORMANCE' | 'REGRESSION'; passed: boolean; weight: number; summary: string; }
export interface EvalFinding { id: string; category: string; severity: 1 | 2 | 3 | 4 | 5; evidenceIds: readonly string[]; evaluatorAgentId: string; targetAgentId: string; confidence: number; remediation: string; rebutted: boolean; verified: boolean; }
export interface BattleResult { winnerPlayerId: string; scores: Readonly<Record<string, number>>; evidenceIds: readonly string[]; explanations: Readonly<Record<string, { outcome: string; didWell: string[]; stagnated: string[]; opponentDidBetter: string[]; evolveCard: string[] }>>; }
export interface BattleSelection { agentId: string; cardVersionId: string; }
export interface BattleChallengeSpec { objective: string; acceptanceCriteria: readonly string[]; constraints: readonly string[]; verificationRequirements: readonly string[]; }
export interface Battle { id: string; mode: BattleMode; projectId: string; challengerId: string; opponentId: string; accepted: string[]; status: BattleStatus; missionContractId: string | null; cardSnapshots: Readonly<Record<string, CardVersion>>; selections: Readonly<Record<string, BattleSelection>>; challengeSpec: BattleChallengeSpec | null; startedAt: string | null; completedAt: string | null; evidence: VerificationEvidence[]; findings: EvalFinding[]; result: BattleResult | null; }
export interface Swarm { id: string; battleId: string; parentAgentId: string; mode: BattleMode; roles: readonly string[]; subagentIds: readonly string[]; tokenBudget: number; timeBudgetMs: number; toolCallLimit: number; startedAt: string; completedAt: string | null; }
export interface RewardGrant { id: string; playerId: string; category: string; rewardKey: string; quantity: number; idempotencyKey: string; grantedAt: string; }
export interface Usage { tokens: number; compute: number; toolCalls: number; spendUsd: number; }

export interface WonderlandState {
  events: WonderlandEvent[]; missions: Record<string, MissionContract>; cards: Record<string, CardVersion[]>;
  brains: Record<string, ProjectBrain>; avatars: Record<string, ProjectAvatar>; presence: Record<string, PresenceSession>;
  battles: Record<string, Battle>; swarms: Record<string, Swarm>; rewards: RewardGrant[];
  usage: Record<string, Usage>; commandResults: Record<string, unknown>; sequence: number;
}
