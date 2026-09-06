import type { JuliusCardPolicy } from './julius-policy';
import { flattenDiagnostics, JuliusDispatchError, JuliusProviderRouter, type JuliusDispatchAllocation, type JuliusProviderResult } from './julius-router';
import type { JuliusEvidence, JuliusTask, JuliusWorker, JuliusWorkerRole } from './julius-runtime';

export interface JuliusExecutionClaim { readonly runId:string;readonly projectId:string;readonly taskId:string;readonly leaseOwner:string;readonly leaseGeneration:number;readonly task:JuliusTask;readonly capability:string;readonly contextId:string; }
export interface JuliusResourceRequest { readonly usdMicros:number;readonly inputTokens:number;readonly outputTokens:number;readonly toolCalls:number;readonly runtimeMs:number; }
export interface JuliusResourceReservation { readonly reservationId:string;readonly state:'RESERVED'|'DENIED';readonly denialReason:string|null; }
export interface JuliusExecutionPorts {
  reserve(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;request:JuliusResourceRequest;idempotencyKey:string}):Promise<JuliusResourceReservation>;
  commit(input:{reservationId:string;result:JuliusProviderResult}):Promise<void>;
  /** `usdMicros` is what the failed attempt billed, when the boundary reported it. Spent money is charged, not released. */
  release(input:{reservationId:string;reason:string;usdMicros?:number|null;spendUnknown?:boolean}):Promise<void>;
  persistEvidence(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;evidence:readonly JuliusEvidence[]}):Promise<void>;
  acceptResult(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;result:JuliusProviderResult;idempotencyKey:string}):Promise<{duplicate:boolean}>;
  /**
   * `taskId` is the task the event is ABOUT. It was absent, and the events
   * this coordinator writes carried none — so on the failure path that matters
   * most, a non-retryable worker failure, the durable row could not say which
   * task or which C.A.R.D. role had stopped. Every call already holds the
   * claim; only the port refused to carry it.
   */
  recordEvent(input:{runId:string;projectId:string;taskId:string|null;type:JuliusExecutionEventType;idempotencyKey:string;payload:Record<string,unknown>}):Promise<void>;
}
export type JuliusExecutionEventType='worker.selected'|'budget.reserved'|'budget.denied'|'worker.dispatched'|'worker.completed'|'retry.scheduled'|'task.failed';
export interface JuliusExecutionRequest { readonly claim:JuliusExecutionClaim;readonly policy:JuliusCardPolicy;readonly role:JuliusWorkerRole;readonly taskType:string;readonly capability:string;readonly resources:JuliusResourceRequest;readonly operationId:string;readonly signal?:AbortSignal;/** Workers already tried for this task. Additive: omitted behaves exactly as before. */readonly excludedWorkerIds?:readonly string[];/** The execution ceiling Julius reserved for this dispatch, handed to the adapter. Additive. */readonly allocation?:JuliusDispatchAllocation; }
/**
 * `failureClass` is the connector's safe subclass when one is known, already
 * narrowed to a machine token by {@link safeFailureClass}. It is additive:
 * every existing reader keeps working, and `null` means "not classified",
 * never "fine".
 */
export type JuliusExecutionOutcome={readonly status:'COMPLETED';readonly workerId:string;readonly duplicate:boolean}|{readonly status:'RETRY'|'FAILED'|'DENIED';readonly code:string;readonly failureClass?:string|null};

const normalizedEvidence=(claim:JuliusExecutionClaim,worker:JuliusWorker,result:JuliusProviderResult):JuliusEvidence[]=>{
  if(result.workerId!==worker.workerId||result.providerId!==worker.providerId||!result.safeSummary.trim()||!Array.isArray(result.evidence))throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned a malformed or mismatched result.');
  return result.evidence.map((raw,index)=>{if(raw===null||typeof raw!=='object')throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned malformed evidence.');const value=raw as Record<string,unknown>;if(!['PASSED','FAILED','INCONCLUSIVE'].includes(String(value.status))||typeof value.type!=='string'||typeof value.safeSummary!=='string')throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned malformed evidence.');return{evidenceId:String(value.evidenceId??`${claim.taskId}:${claim.leaseGeneration}:${index}`),missionId:claim.task.missionId,taskId:claim.taskId,workerId:worker.workerId,type:value.type as JuliusEvidence['type'],status:value.status as JuliusEvidence['status'],safeSummary:value.safeSummary,artifactRef:typeof value.artifactRef==='string'?value.artifactRef:null,integrityHash:typeof value.integrityHash==='string'?value.integrityHash:null,occurredAt:typeof value.occurredAt==='string'?value.occurredAt:new Date().toISOString()};});
};

/** One claimed task execution. Julius—not the adapter—owns policy, budget, evidence, result acceptance, and retry semantics. */
export class JuliusExecutionCoordinator {
  constructor(private readonly router:JuliusProviderRouter,private readonly ports:JuliusExecutionPorts){}
  /**
   * UNKNOWN IS NULL, NOT THE STRING "undefined".
   *
   * `select` throws `JuliusDispatchError` for every routing outcome it models,
   * but this catch used to CAST rather than check, so any other throw — a
   * programming error inside the registry or the C.A.R.D. evaluation — read
   * `.code`, `.retryable` and `.failureClass` off an object that has none. The
   * port coerces a non-primitive through `String(value)`, and `typeof
   * undefined` is not in its allowlist, so all three columns of the row that
   * ENDS the task would have read the literal `undefined` in the one artifact
   * built to explain a paid failure.
   *
   * It is narrowed the same way the dispatch catch below narrows: anything
   * that is not already a `JuliusDispatchError` becomes a NON-RETRYABLE
   * `WORKER_EXECUTION_FAILURE`. Deliberately not `normalizeProviderError` —
   * that reads a provider's `.code` for a rate limit or a timeout, and
   * `select` contacts nobody. It reads the worker registry, the health
   * registry, the adapter map and the C.A.R.D. — all in memory — so a throw
   * from it is a programming error, not a transient provider condition;
   * classifying one as TIMEOUT would put `errorRetryable: true` on a row that
   * ends the task.
   */
  async execute(request:JuliusExecutionRequest):Promise<JuliusExecutionOutcome>{
    let worker:JuliusWorker;try{worker=this.router.select({role:request.role,taskType:request.taskType,capability:request.capability,policy:request.policy,excludedWorkerIds:request.excludedWorkerIds});}catch(error){const failure=error instanceof JuliusDispatchError?error:new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Worker selection failed.');await this.event(request,'task.failed',{code:failure.code,errorRetryable:failure.retryable,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:failure.code==='POLICY_DENIED'?'DENIED':'FAILED',code:failure.code,failureClass:failure.failureClass};}
    await this.event(request,'worker.selected',{workerId:worker.workerId,providerId:worker.providerId});
    const reservation=await this.ports.reserve({claim:request.claim,worker,request:request.resources,idempotencyKey:`${request.operationId}:budget`});
    if(reservation.state==='DENIED'){await this.event(request,'budget.denied',{reason:reservation.denialReason});return{status:'DENIED',code:'BUDGET_DENIED'};}
    await this.event(request,'budget.reserved',{reservationId:reservation.reservationId});
    try{
      if(request.signal?.aborted)throw new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.');
      await this.event(request,'worker.dispatched',{workerId:worker.workerId});
      const result=await this.router.dispatch(worker,{taskId:request.claim.taskId,contextId:request.claim.contextId,taskType:request.taskType,signal:request.signal,...(request.allocation===undefined?{}:{allocation:request.allocation})});
      const evidence=normalizedEvidence(request.claim,worker,result);
      await this.ports.persistEvidence({claim:request.claim,worker,evidence});
      const receipt=await this.ports.acceptResult({claim:request.claim,worker,result,idempotencyKey:`${request.operationId}:result`});
      await this.ports.commit({reservationId:reservation.reservationId,result});
      await this.event(request,'worker.completed',{workerId:worker.workerId,duplicate:receipt.duplicate,evidenceCount:evidence.length});
      return{status:'COMPLETED',workerId:worker.workerId,duplicate:receipt.duplicate};
    }catch(error){const failure=error instanceof JuliusDispatchError?error:new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Execution boundary failed.');const billed=typeof failure.diagnostics?.costUsdMicros==='number'?failure.diagnostics.costUsdMicros:null;
     await this.ports.release({reservationId:reservation.reservationId,reason:failure.code,usdMicros:billed,spendUnknown:billed===null&&failure.diagnostics?.runtimeStarted===true});
     /* The class travels with the code on BOTH endings. A retry that is later
      * abandoned and a failure taken at once must leave the same diagnosis
      * behind, or the durable record would explain only the failures that
      * happened to be non-retryable. */
     if(failure.retryable&&request.policy.automaticRetry){await this.event(request,'retry.scheduled',{code:failure.code,errorRetryable:true,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:'RETRY',code:failure.code,failureClass:failure.failureClass};}await this.event(request,'task.failed',{code:failure.code,errorRetryable:failure.retryable,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:'FAILED',code:failure.code,failureClass:failure.failureClass};}
  }
  private event(request:JuliusExecutionRequest,type:JuliusExecutionEventType,payload:Record<string,unknown>){return this.ports.recordEvent({runId:request.claim.runId,projectId:request.claim.projectId,taskId:request.claim.taskId,type,idempotencyKey:`${request.operationId}:${type}`,payload});}
}
