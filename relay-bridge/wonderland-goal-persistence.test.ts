import { describe, expect, it } from 'vitest';
import type { Battle, ProjectBrain, RewardGrant } from '../src/relay/mission/wonderland/wonderland-backend';
import type { WonderlandExecutionSession } from '../src/relay/mission/wonderland/wonderland-execution';
import type { TransactionalWonderlandDatabase, WonderlandTransaction } from '../src/relay/persistence/wonderland-postgres';
import { TransactionalGoalRuntimePersistence } from './wonderland-goal-persistence';

const session = (id: string, state: WonderlandExecutionSession['state'], version: number): WonderlandExecutionSession => ({
  executionId: id, battleId: 'battle', missionId: 'mission', projectId: 'project', playerId: id, agentId: `agent-${id}`,
  cardSnapshot: { cardVersionId:`card-${id}`,ownerId:id,agentId:`agent-${id}`,version:1,promptArchitect:'p',codingAgent:'c',reviewer:'r',tools:[],permissions:[],autonomy:'a',models:[],budgets:{tokens:1,costUsd:1,toolCalls:1,runtimeMs:1},verificationPolicy:[],capabilities:[],runtimeConfiguration:{} },
  workspaceIsolationRef:`workspace-${id}`,permissions:[],budget:{inputTokens:1,cachedTokens:1,outputTokens:1,toolCalls:1,usdMicros:1,computeMs:1,runtimeMs:1,swarmConcurrency:1},
  state,usage:{inputTokens:0,cachedTokens:0,outputTokens:0,usdMicros:0,toolCalls:0,reviewerCalls:0,sandboxComputeMs:0,durationMs:0,subagentCalls:0,gveCalls:0},receiptIds:[],evidenceIds:[],artifactIds:[],startedAt:null,completedAt:null,cancellationRequestedAt:null,terminalReason:null,checkpoint:{version,phase:state,lastReceiptId:null,recordedAt:'2026-08-24T00:00:00Z'},version,
});
const battle: Battle = { battleId:'battle',projectId:'project',mode:'GOAL',participantIds:['a','b'],agentIds:['agent-a','agent-b'],cardSnapshots:[session('a','PROVISIONING',2).cardSnapshot,session('b','PROVISIONING',2).cardSnapshot],missionId:'mission',state:'COMPLETE',swarms:[],evidence:[],findings:[],usage:{a:{inputTokens:0,outputTokens:0,costUsd:0,toolCalls:0,computeMs:0,sandboxRuntimeMs:0,subagentUsage:0},b:{inputTokens:0,outputTokens:0,costUsd:0,toolCalls:0,computeMs:0,sandboxRuntimeMs:0,subagentUsage:0}},winnerId:'a',result:{winnerId:'a',scores:{a:1,b:0},explanations:{a:[],b:[]},recommendations:[]}};

function harness(failOperation?: string) {
  const operations:string[]=[]; const committed=new Map<string,unknown>();
  const transaction: WonderlandTransaction = {
    loadExecution:async()=>null,
    loadBattleVersion:async()=>1,
    saveExecution:async value=>{operations.push(`execution:${value.executionId}:${value.state}`);if(failOperation===operations.at(-1))throw new Error('injected_failure');},
    saveBattle:async()=>{operations.push('battle');if(failOperation==='battle')throw new Error('injected_failure');},
    saveEntity:async value=>{operations.push(`entity:${value.kind}`);}, grantReward:async()=>{operations.push('reward');return true;}, insertProviderReceipt:async()=>true,
    reserveBudget:async()=>{throw new Error('not used');},commitBudget:async()=>{throw new Error('not used');},releaseBudget:async()=>{throw new Error('not used');},
    appendEvent:async value=>({...value,sequence:1}),enqueueEvent:async()=>undefined,replay:async()=>[],idempotent:async(_s,_c,_h,effect)=>effect(),
  };
  const database = { commitCommand: async <T>(input:{commandId:string}, effect:(tx:WonderlandTransaction)=>Promise<T>) => { if(committed.has(input.commandId))return committed.get(input.commandId); const response=await effect(transaction); const result={response,event:{}}; committed.set(input.commandId,result); return result; } } as unknown as TransactionalWonderlandDatabase;
  return { persistence:new TransactionalGoalRuntimePersistence(database,()=> '2026-08-24T00:00:00Z'), operations };
}

describe('transactional Goal persistence',()=>{
  it('persists the execution pair idempotently before Relay launch',async()=>{const h=harness();const input={commandId:'run',battle,sessions:[session('a','PROVISIONING',2),session('b','PROVISIONING',2)]};await h.persistence.prepare(input);await h.persistence.prepare(input);expect(h.operations).toEqual(['execution:a:PROVISIONING','execution:b:PROVISIONING']);});
  it('commits final battle, executions, result, Brain and rewards as one command boundary',async()=>{const h=harness();await h.persistence.finalize({commandId:'run',battle,sessions:[session('a','COMPLETE',5),session('b','COMPLETE',5)],brain:{projectId:'project',objective:'',requirements:[],architecture:[],constraints:[],acceptanceCriteria:[],decisions:[],research:[],findings:[],handoffs:[],repairs:[],evidenceReferences:[],missionHistory:[],currentState:'',battleLessons:[]} satisfies ProjectBrain,avatars:[],rewards:[{grantId:'grant',battleId:'battle',playerId:'a',kind:'XP',value:'100'} satisfies RewardGrant]});expect(h.operations).toContain('battle');expect(h.operations).toContain('entity:GOAL_RESULT');expect(h.operations).toContain('entity:PROJECT_BRAIN');expect(h.operations).toContain('reward');});
  it('does not record an idempotent result when an atomic effect fails',async()=>{const h=harness('battle');const input={commandId:'run',battle,sessions:[session('a','COMPLETE',5),session('b','COMPLETE',5)],brain:{projectId:'project',objective:'',requirements:[],architecture:[],constraints:[],acceptanceCriteria:[],decisions:[],research:[],findings:[],handoffs:[],repairs:[],evidenceReferences:[],missionHistory:[],currentState:'',battleLessons:[]} as ProjectBrain,avatars:[],rewards:[]};await expect(h.persistence.finalize(input)).rejects.toThrow('injected_failure');await expect(h.persistence.finalize(input)).rejects.toThrow('injected_failure');expect(h.operations.filter(value=>value==='battle')).toHaveLength(2);});
});
