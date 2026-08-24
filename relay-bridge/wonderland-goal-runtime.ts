import type { Evidence, WonderlandExecutor } from '../src/relay/mission/wonderland/wonderland-backend';
import { WonderlandBackend, type Battle, type ProjectAvatar, type ProjectBrain, type RewardGrant } from '../src/relay/mission/wonderland/wonderland-backend';
import { WonderlandExecutionRuntime, type ProviderUsageReceipt, type WonderlandExecutionSession } from '../src/relay/mission/wonderland/wonderland-execution';

export interface GoalWorkspaceProvisioner {
  provision(input: { battleId: string; projectId: string; playerId: string; agentId: string; sharedFixtureRef: string }): Promise<{ isolationRef: string; environmentRef: string; credentialRef: string; processRef: string }>;
}
export interface GoalRelayExecutionPort extends WonderlandExecutor {
  runGoal(input: Parameters<WonderlandExecutor['run']>[0] & { executionId: string; environmentRef: string; credentialRef: string; processRef: string }): Promise<{ evidence: readonly Evidence[]; receipts: readonly ProviderUsageReceipt[]; artifactIds: readonly string[] }>;
}
export interface GoalRuntimeResult { readonly battleId: string; readonly executionIds: readonly [string,string]; readonly startEpoch: string; readonly winnerId: string|null; }
export interface GoalRuntimePersistence {
  prepare(input: { commandId: string; battle: Battle; sessions: readonly WonderlandExecutionSession[] }): Promise<void>;
  finalize(input: { commandId: string; battle: Battle; sessions: readonly WonderlandExecutionSession[]; brain: ProjectBrain; avatars: readonly ProjectAvatar[]; rewards: readonly RewardGrant[] }): Promise<void>;
}

/** Hosted Goal coordinator: presence/ownership is already authoritative in Wonderland; this binds it to isolated Relay executions. */
export class WonderlandGoalRuntime {
  constructor(private readonly backend: WonderlandBackend, private readonly executions: WonderlandExecutionRuntime, private readonly provisioner: GoalWorkspaceProvisioner, private readonly relay: GoalRelayExecutionPort, private readonly now: () => string, private readonly newId: () => string, private readonly persistence?: GoalRuntimePersistence) {}
  async run(actorId: string, commandId: string, battleId: string, nowMs: number): Promise<GoalRuntimeResult> {
    const snapshot = this.backend.snapshot(); const battle = snapshot.battles[battleId];
    if (!battle || battle.mode !== 'GOAL' || !battle.participantIds.includes(actorId)) throw new Error('goal_battle_not_authorized');
    if (battle.state !== 'READY') throw new Error('goal_battle_not_ready');
    for (const playerId of battle.participantIds) if (!Object.values(snapshot.presence).some(p => p.playerId === playerId && p.projectId === battle.projectId && p.expiresAt > nowMs && p.challengeAvailable)) throw new Error('goal_participant_not_present');
    const sharedFixtureRef = `goal-fixture:${snapshot.contracts[battle.missionId].canonicalHash}`;
    const scopes = await Promise.all(battle.participantIds.map((playerId,index) => this.provisioner.provision({ battleId, projectId:battle.projectId, playerId, agentId:battle.agentIds[index], sharedFixtureRef })));
    const isolation = new Set(scopes.flatMap(scope => [scope.isolationRef,scope.environmentRef,scope.credentialRef,scope.processRef]));
    if (isolation.size !== 8 || scopes.some(scope => Object.values(scope).some(value => !value.trim()))) throw new Error('goal_execution_isolation_failed');
    const executionIds = [this.newId(),this.newId()] as [string,string];
    for(let index=0;index<2;index+=1){ const card=battle.cardSnapshots[index]; const budget=card.budgets; this.executions.create(`${commandId}:execution:${index}`,{ executionId:executionIds[index],battleId,missionId:battle.missionId,projectId:battle.projectId,playerId:battle.participantIds[index],agentId:battle.agentIds[index],cardSnapshot:card,workspaceIsolationRef:scopes[index].isolationRef,permissions:card.permissions,budget:{inputTokens:budget.tokens,cachedTokens:budget.tokens,outputTokens:budget.tokens,toolCalls:budget.toolCalls,usdMicros:Math.round(budget.costUsd*1_000_000),computeMs:budget.runtimeMs,runtimeMs:budget.runtimeMs,swarmConcurrency:Number(card.runtimeConfiguration.concurrency??1)}}); this.executions.transition(executionIds[index],'PROVISIONING'); }
    await this.persistence?.prepare({ commandId, battle, sessions: executionIds.map(id => this.executions.get(id)!) });
    // Both scopes must exist before either RUNNING transition or Relay launch.
    const startEpoch=this.now(); for(const id of executionIds)this.executions.transition(id,'RUNNING');
    const contract=snapshot.contracts[battle.missionId];
    const executor: WonderlandExecutor={
      run: async input=>{const index=battle.participantIds.indexOf(input.playerId);const outcome=await this.relay.runGoal({...input,executionId:executionIds[index],environmentRef:scopes[index].environmentRef,credentialRef:scopes[index].credentialRef,processRef:scopes[index].processRef});for(const receipt of outcome.receipts)this.executions.recordReceipt(receipt);for(const evidence of outcome.evidence)this.executions.attachEvidence(executionIds[index],evidence.evidenceId);for(const artifact of outcome.artifactIds)this.executions.attachArtifact(executionIds[index],artifact);this.executions.transition(executionIds[index],'VERIFYING');return outcome.evidence;},
      runSubagent: input=>this.relay.runSubagent(input),
    };
    await this.backend.startBattle(actorId,`${commandId}:start`,battleId,executor);
    const result=this.backend.finalize(actorId,`${commandId}:finalize`,battleId);
    for(const id of executionIds)this.executions.transition(id,'COMPLETE');
    // Contract identity is intentionally shared; private runtime scopes are not.
    if(contract.canonicalHash!==this.backend.snapshot().contracts[battle.missionId].canonicalHash)throw new Error('goal_contract_mutated');
    const completed = this.backend.snapshot();
    await this.persistence?.finalize({ commandId, battle: completed.battles[battleId], sessions: executionIds.map(id => this.executions.get(id)!), brain: completed.brains[battle.projectId], avatars: Object.values(completed.avatars).filter(avatar => avatar.projectId === battle.projectId), rewards: Object.values(completed.rewards).filter(reward => reward.battleId === battleId) });
    return {battleId,executionIds,startEpoch,winnerId:result.winnerId};
  }
}
