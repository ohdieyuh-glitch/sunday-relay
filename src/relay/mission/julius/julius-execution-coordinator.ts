import type { JuliusCardPolicy } from './julius-policy';
import { JuliusDispatchError, JuliusProviderRouter, type JuliusProviderResult } from './julius-router';
import type { JuliusEvidence, JuliusTask, JuliusWorker, JuliusWorkerRole } from './julius-runtime';

export interface JuliusExecutionClaim { readonly runId:string;readonly projectId:string;readonly taskId:string;readonly leaseOwner:string;readonly leaseGeneration:number;readonly task:JuliusTask;readonly capability:string;readonly contextId:string; }
export interface JuliusResourceRequest { readonly usdMicros:number;readonly inputTokens:number;readonly outputTokens:number;readonly toolCalls:number;readonly runtimeMs:number; }
export interface JuliusResourceReservation { readonly reservationId:string;readonly state:'RESERVED'|'DENIED';readonly denialReason:string|null; }
export interface JuliusExecutionPorts {
  reserve(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;request:JuliusResourceRequest;idempotencyKey:string}):Promise<JuliusResourceReservation>;
  commit(input:{reservationId:string;result:JuliusProviderResult}):Promise<void>;
  release(input:{reservationId:string;reason:string}):Promise<void>;
  persistEvidence(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;evidence:readonly JuliusEvidence[]}):Promise<void>;
  acceptResult(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;result:JuliusProviderResult;idempotencyKey:string}):Promise<{duplicate:boolean}>;
  recordEvent(input:{runId:string;projectId:string;type:JuliusExecutionEventType;idempotencyKey:string;payload:Record<string,unknown>}):Promise<void>;
}
export type JuliusExecutionEventType='worker.selected'|'budget.reserved'|'budget.denied'|'worker.dispatched'|'worker.completed'|'retry.scheduled'|'task.failed';
export interface JuliusExecutionRequest { readonly claim:JuliusExecutionClaim;readonly policy:JuliusCardPolicy;readonly role:JuliusWorkerRole;readonly taskType:string;readonly capability:string;readonly resources:JuliusResourceRequest;readonly operationId:string;readonly signal?:AbortSignal;/** Workers already tried for this task. Additive: omitted behaves exactly as before. */readonly excludedWorkerIds?:readonly string[]; }
export type JuliusExecutionOutcome={readonly status:'COMPLETED';readonly workerId:string;readonly duplicate:boolean}|{readonly status:'RETRY'|'FAILED'|'DENIED';readonly code:string};

const normalizedEvidence=(claim:JuliusExecutionClaim,worker:JuliusWorker,result:JuliusProviderResult):JuliusEvidence[]=>{
  if(result.workerId!==worker.workerId||result.providerId!==worker.providerId||!result.safeSummary.trim()||!Array.isArray(result.evidence))throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned a malformed or mismatched result.');
  return result.evidence.map((raw,index)=>{if(raw===null||typeof raw!=='object')throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned malformed evidence.');const value=raw as Record<string,unknown>;if(!['PASSED','FAILED','INCONCLUSIVE'].includes(String(value.status))||typeof value.type!=='string'||typeof value.safeSummary!=='string')throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned malformed evidence.');return{evidenceId:String(value.evidenceId??`${claim.taskId}:${claim.leaseGeneration}:${index}`),missionId:claim.task.missionId,taskId:claim.taskId,workerId:worker.workerId,type:value.type as JuliusEvidence['type'],status:value.status as JuliusEvidence['status'],safeSummary:value.safeSummary,artifactRef:typeof value.artifactRef==='string'?value.artifactRef:null,integrityHash:typeof value.integrityHash==='string'?value.integrityHash:null,occurredAt:typeof value.occurredAt==='string'?value.occurredAt:new Date().toISOString()};});
};

/** One claimed task execution. Julius—not the adapter—owns policy, budget, evidence, result acceptance, and retry semantics. */
export class JuliusExecutionCoordinator {
  constructor(private readonly router:JuliusProviderRouter,private readonly ports:JuliusExecutionPorts){}
  async execute(request:JuliusExecutionRequest):Promise<JuliusExecutionOutcome>{
    let worker:JuliusWorker;try{worker=this.router.select({role:request.role,taskType:request.taskType,capability:request.capability,policy:request.policy,excludedWorkerIds:request.excludedWorkerIds});}catch(error){const failure=error as JuliusDispatchError;await this.event(request,'task.failed',{code:failure.code});return{status:failure.code==='POLICY_DENIED'?'DENIED':'FAILED',code:failure.code};}
    await this.event(request,'worker.selected',{workerId:worker.workerId,providerId:worker.providerId});
    const reservation=await this.ports.reserve({claim:request.claim,worker,request:request.resources,idempotencyKey:`${request.operationId}:budget`});
    if(reservation.state==='DENIED'){await this.event(request,'budget.denied',{reason:reservation.denialReason});return{status:'DENIED',code:'BUDGET_DENIED'};}
    await this.event(request,'budget.reserved',{reservationId:reservation.reservationId});
    try{
      if(request.signal?.aborted)throw new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.');
      await this.event(request,'worker.dispatched',{workerId:worker.workerId});
      const result=await this.router.dispatch(worker,{taskId:request.claim.taskId,contextId:request.claim.contextId,signal:request.signal});
      const evidence=normalizedEvidence(request.claim,worker,result);
      await this.ports.persistEvidence({claim:request.claim,worker,evidence});
      const receipt=await this.ports.acceptResult({claim:request.claim,worker,result,idempotencyKey:`${request.operationId}:result`});
      await this.ports.commit({reservationId:reservation.reservationId,result});
      await this.event(request,'worker.completed',{workerId:worker.workerId,duplicate:receipt.duplicate,evidenceCount:evidence.length});
      return{status:'COMPLETED',workerId:worker.workerId,duplicate:receipt.duplicate};
    }catch(error){const failure=error instanceof JuliusDispatchError?error:new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Execution boundary failed.');await this.ports.release({reservationId:reservation.reservationId,reason:failure.code});if(failure.retryable&&request.policy.automaticRetry){await this.event(request,'retry.scheduled',{code:failure.code});return{status:'RETRY',code:failure.code};}await this.event(request,'task.failed',{code:failure.code});return{status:'FAILED',code:failure.code};}
  }
  private event(request:JuliusExecutionRequest,type:JuliusExecutionEventType,payload:Record<string,unknown>){return this.ports.recordEvent({runId:request.claim.runId,projectId:request.claim.projectId,type,idempotencyKey:`${request.operationId}:${type}`,payload});}
}
