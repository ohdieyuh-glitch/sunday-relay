import { createHash } from 'node:crypto';
import type { WonderlandEvent } from '../src/relay/mission/wonderland/wonderland-backend';
import type { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import type { GoalRuntimePersistence } from './wonderland-goal-runtime';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const event = (input: { eventId: string; timestamp: string; projectId: string; battleId: string; missionId: string; eventType: 'battle.telemetry' | 'battle.completed'; payload: Record<string, unknown>; visibility: 'PARTICIPANTS' | 'PUBLIC'; causationId: string }): Omit<WonderlandEvent, 'sequence'> => ({
  eventId: input.eventId, schemaVersion: 'relay-wonderland-event.v1', timestamp: input.timestamp,
  projectId: input.projectId, sessionId: null, playerId: null, agentId: null,
  missionId: input.missionId, battleId: input.battleId, eventType: input.eventType,
  payload: input.payload, visibility: input.visibility, correlationId: input.battleId, causationId: input.causationId,
});

/** Commits each durable Goal orchestration boundary before it is eligible for live fan-out. */
export class TransactionalGoalRuntimePersistence implements GoalRuntimePersistence {
  constructor(private readonly database: TransactionalWonderlandDatabase, private readonly now: () => string) {}

  async prepare(input: Parameters<GoalRuntimePersistence['prepare']>[0]): Promise<void> {
    const commandId = `${input.commandId}:persist:prepared`;
    await this.database.commitCommand({
      scope: 'wonderland.goal.prepare', commandId, requestHash: hash({ battleId: input.battle.battleId, sessions: input.sessions.map(session => session.executionId) }),
      streamId: input.battle.projectId,
      event: event({ eventId: `event:${commandId}`, timestamp: this.now(), projectId: input.battle.projectId, battleId: input.battle.battleId, missionId: input.battle.missionId, eventType: 'battle.telemetry', payload: { phase: 'PROVISIONED', executionIds: input.sessions.map(session => session.executionId) }, visibility: 'PARTICIPANTS', causationId: input.commandId }),
    }, async transaction => {
      for (const session of input.sessions) await transaction.saveExecution(session, null);
      return { battleId: input.battle.battleId, executionIds: input.sessions.map(session => session.executionId) };
    });
  }

  async finalize(input: Parameters<GoalRuntimePersistence['finalize']>[0]): Promise<void> {
    const commandId = `${input.commandId}:persist:finalized`;
    await this.database.commitCommand({
      scope: 'wonderland.goal.finalize', commandId, requestHash: hash({ battleId: input.battle.battleId, result: input.battle.result }),
      streamId: input.battle.projectId,
      event: event({ eventId: `event:${commandId}`, timestamp: this.now(), projectId: input.battle.projectId, battleId: input.battle.battleId, missionId: input.battle.missionId, eventType: 'battle.completed', payload: { winnerId: input.battle.winnerId, scores: input.battle.result?.scores ?? {} }, visibility: 'PUBLIC', causationId: input.commandId }),
    }, async transaction => {
      const battleVersion = await transaction.loadBattleVersion(input.battle.battleId);
      if (battleVersion === null) throw new Error('goal_battle_not_persisted');
      await transaction.saveBattle(input.battle, battleVersion);
      for (const session of input.sessions) await transaction.saveExecution(session, 2);
      await transaction.saveEntity({ kind: 'GOAL_RESULT', recordId: input.battle.battleId, projectId: input.battle.projectId, battleId: input.battle.battleId, ownerId: null, data: input.battle.result });
      for (const evidence of input.battle.evidence) await transaction.saveEntity({ kind: 'GVE_EVIDENCE', recordId: evidence.evidenceId, projectId: input.battle.projectId, battleId: input.battle.battleId, ownerId: evidence.ownerId, data: evidence });
      for (const recommendation of input.battle.result?.recommendations ?? []) await transaction.saveEntity({ kind: 'CARD_RECOMMENDATION', recordId: recommendation.recommendationId, projectId: input.battle.projectId, battleId: input.battle.battleId, ownerId: recommendation.ownerId, data: recommendation });
      await transaction.saveEntity({ kind: 'PROJECT_BRAIN', recordId: input.brain.projectId, projectId: input.battle.projectId, battleId: input.battle.battleId, ownerId: null, data: input.brain });
      for (const avatar of input.avatars) await transaction.saveEntity({ kind: 'PROJECT_AVATAR', recordId: avatar.avatarId, projectId: input.battle.projectId, battleId: input.battle.battleId, ownerId: avatar.ownerId, data: avatar });
      for (const reward of input.rewards) await transaction.grantReward({ grantId: reward.grantId, rewardKey: `${reward.battleId}:${reward.playerId}:completion`, battleId: reward.battleId, playerId: reward.playerId, data: reward });
      return { battleId: input.battle.battleId, winnerId: input.battle.winnerId };
    });
  }
}
