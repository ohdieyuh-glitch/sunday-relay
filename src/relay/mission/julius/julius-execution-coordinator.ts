import type { JuliusCardPolicy } from './julius-policy';
import { flattenDiagnostics, JuliusDispatchError, JuliusProviderRouter, safeReviewDiagnostics, type JuliusDispatchAllocation, type JuliusProviderResult } from './julius-router';
import type { JuliusEvidence, JuliusTask, JuliusWorker, JuliusWorkerRole } from './julius-runtime';
import type { JuliusContractReviewCharge } from './julius-task-contract';

/** The cost a provider reported on its own result, or null when it reported none. */
const reportedUsdMicros=(result:JuliusProviderResult|null):number|null=>{
 const usage=result?.usage;
 if(usage===null||usage===undefined||typeof usage!=='object')return null;
 const value=(usage as Record<string,unknown>).usdMicros;
 return typeof value==='number'&&Number.isFinite(value)?value:null;
};
/**
 * THE FACTS A SUCCESSFUL ATTEMPT LEAVES BEHIND.
 *
 * Failure has had this since paid run 34311556047: both catch-side endings
 * flatten the error's diagnostics onto their event, so `task.failed` and
 * `retry.scheduled` carry a reviewer's whole lifecycle. Success carried
 * `{workerId, duplicate, evidenceCount}` — and Live Run 3, which completed,
 * produced a `worker-diagnostics.tsv` with no rows at all. A clean attempt was
 * less reconstructable than a broken one, so there was no healthy baseline to
 * read the next timeout against.
 *
 * WHAT THE ADAPTER SAYS AND WHAT JULIUS SAYS ARE MERGED IN THAT ORDER, and the
 * order is the point. The adapter reports what it observed — transport, served
 * model, elapsed time, the process it ran. Julius reports what only Julius
 * knows and what an adapter must never be able to overstate: that the attempt
 * SUCCEEDED, and which locked contract revision and binding digest it ran
 * under. An adapter claiming its own `contractBindingDigest` would be
 * attesting to the thing the contract stack exists to prove independently of
 * it, so Julius's values are written last and win.
 *
 * `null` when the adapter reported nothing: a row of nulls is not evidence,
 * and the evidence dump keys on `diag_transport` precisely so that a worker
 * with no lifecycle to report produces no row instead of an empty one.
 */
const successDiagnostics=(request:JuliusExecutionRequest,result:JuliusProviderResult):Record<string,string|number|boolean|null>=>{
 const reported=result.diagnostics;
 if(reported===undefined||reported===null||typeof reported!=='object'||Array.isArray(reported))return{};
 return flattenDiagnostics(safeReviewDiagnostics({
  ...reported as Record<string,unknown>,
  outcome:'succeeded',
  /* ALWAYS BOTH, EVEN WHEN THERE IS NO CONTRACT. Spreading them only when one
   * exists would leave an unbound dispatch — a plan, which precedes the lock —
   * carrying whatever the adapter happened to put in those keys, which is the
   * one claim an adapter must never be able to make. Null here is the true
   * answer: this dispatch was bound to nothing. */
  contractRevision:request.contract===undefined?null:request.contract.binding.contractRevision,
  contractBindingDigest:request.contract===undefined?null:request.contract.binding.bindingDigest,
 }));
};
export interface JuliusExecutionClaim { readonly runId:string;readonly projectId:string;readonly taskId:string;readonly leaseOwner:string;readonly leaseGeneration:number;readonly task:JuliusTask;readonly capability:string;readonly contextId:string; }
export interface JuliusResourceRequest { readonly usdMicros:number;readonly inputTokens:number;readonly outputTokens:number;readonly toolCalls:number;readonly runtimeMs:number; }
export interface JuliusResourceReservation { readonly reservationId:string;readonly state:'RESERVED'|'DENIED';readonly denialReason:string|null; }
export interface JuliusExecutionPorts {
  reserve(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;request:JuliusResourceRequest;idempotencyKey:string}):Promise<JuliusResourceReservation>;
  /**
   * `claim` is WHOSE money this was. The settlement event carried a reservation
   * id and nothing else, so `budget.tsv` could only attribute a component to a
   * task by joining back through the reservation — and the founder's question
   * after Live Run 3 was exactly per-role: what did the architect cost, what
   * did the reviewer cost. The port already had the claim at every call site;
   * only the signature refused to carry it.
   */
  commit(input:{claim:JuliusExecutionClaim;reservationId:string;result:JuliusProviderResult}):Promise<void>;
  /** `usdMicros` is what the failed attempt billed, when the boundary reported it. Spent money is charged, not released. */
  release(input:{claim:JuliusExecutionClaim;reservationId:string;reason:string;usdMicros?:number|null;spendUnknown?:boolean}):Promise<void>;
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
export interface JuliusExecutionRequest { readonly claim:JuliusExecutionClaim;readonly policy:JuliusCardPolicy;readonly role:JuliusWorkerRole;readonly taskType:string;readonly capability:string;readonly resources:JuliusResourceRequest;readonly operationId:string;readonly signal?:AbortSignal;/** Workers already tried for this task. Additive: omitted behaves exactly as before. */readonly excludedWorkerIds?:readonly string[];/** The execution ceiling Julius reserved for this dispatch, handed to the adapter. Additive. */readonly allocation?:JuliusDispatchAllocation;/** The locked task contract this dispatch runs under, as a review charge. Additive. */readonly contract?:JuliusContractReviewCharge;
 /**
  * WHICH DISPATCH THIS IS — 1, 2 or 3 of the task's attempt ceiling.
  *
  * Paid run 34311556047's reviewer failed three times and the bundle recorded
  * three rows distinguishable only by `occurred_at`. A reader could COUNT them
  * and infer the order; nobody could read "this was the third and last ask" as
  * a fact, and an inference is not evidence — least of all in an artifact whose
  * whole purpose is to explain a paid failure without buying another one.
  *
  * It is the OUTER number: how many times Julius dispatched this task, which is
  * not `planAttempts`/`reviewAttempts` (how many provider calls one dispatch
  * made). Both matter and they answer different questions.
  *
  * Deferred until now on purpose: recording it means widening this interface
  * and threading it through the pipeline, and that is the surface the contract
  * stack rewrote. Adding it before #238 landed would have manufactured a
  * conflict for no gain. Optional, so a caller that omits it behaves exactly
  * as before. */
 readonly attempt?:number; }
/**
 * `failureClass` is the connector's safe subclass when one is known, already
 * narrowed to a machine token by {@link safeFailureClass}. It is additive:
 * every existing reader keeps working, and `null` means "not classified",
 * never "fine".
 */
export type JuliusExecutionOutcome={readonly status:'COMPLETED';readonly workerId:string;readonly duplicate:boolean;/** What the worker proposed for its own task contract, unsanitised. Julius decides. */readonly contractProposal?:unknown}|{readonly status:'RETRY'|'FAILED'|'DENIED';readonly code:string;readonly failureClass?:string|null};

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
    /**
     * WHAT THE PROVIDER REPORTED, HELD WHERE THE CATCH CAN SEE IT.
     *
     * Everything after the dispatch can still throw — persisting evidence, a
     * stale lease refusing the result, the settlement itself — and the catch
     * read the billed amount only from the ERROR's diagnostics. A provider
     * that answered, reported its cost, and was then dropped by a store write
     * released its whole hold, and the mission could be granted that money a
     * second time. The result is captured here so a failure after a paid
     * answer still charges what the answer cost.
     */
    let answered:JuliusProviderResult|null=null;
    try{
      if(request.signal?.aborted)throw new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.');
      await this.event(request,'worker.dispatched',{workerId:worker.workerId});
      const result=await this.router.dispatch(worker,{taskId:request.claim.taskId,contextId:request.claim.contextId,taskType:request.taskType,signal:request.signal,...(request.allocation===undefined?{}:{allocation:request.allocation}),...(request.contract===undefined?{}:{contract:request.contract})});
      answered=result;
      const evidence=normalizedEvidence(request.claim,worker,result);
      await this.ports.persistEvidence({claim:request.claim,worker,evidence});
      const receipt=await this.ports.acceptResult({claim:request.claim,worker,result,idempotencyKey:`${request.operationId}:result`});
      await this.ports.commit({claim:request.claim,reservationId:reservation.reservationId,result});
      await this.event(request,'worker.completed',{workerId:worker.workerId,duplicate:receipt.duplicate,evidenceCount:evidence.length,...successDiagnostics(request,result)});
      return{status:'COMPLETED',workerId:worker.workerId,duplicate:receipt.duplicate,...(result.contractProposal===undefined?{}:{contractProposal:result.contractProposal})};
    }catch(error){const failure=error instanceof JuliusDispatchError?error:new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Execution boundary failed.');const reported=reportedUsdMicros(answered);
     const billed=reported??(typeof failure.diagnostics?.costUsdMicros==='number'?failure.diagnostics.costUsdMicros:null);
     // A provider that ANSWERED ran, whatever the diagnostics say about it.
     await this.ports.release({claim:request.claim,reservationId:reservation.reservationId,reason:failure.code,usdMicros:billed,spendUnknown:billed===null&&(answered!==null||failure.diagnostics?.runtimeStarted===true)});
     /* The class travels with the code on BOTH endings. A retry that is later
      * abandoned and a failure taken at once must leave the same diagnosis
      * behind, or the durable record would explain only the failures that
      * happened to be non-retryable. */
     if(failure.retryable&&request.policy.automaticRetry){await this.event(request,'retry.scheduled',{code:failure.code,errorRetryable:true,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:'RETRY',code:failure.code,failureClass:failure.failureClass};}await this.event(request,'task.failed',{code:failure.code,errorRetryable:failure.retryable,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:'FAILED',code:failure.code,failureClass:failure.failureClass};}
  }
  /**
   * ON EVERY EVENT, not only the failures. `retry.scheduled` and `task.failed`
   * are where a reader looks after a bad run, but `worker.dispatched` is where
   * they look to see that a SECOND ask happened at all — and a fact present on
   * one and absent on the other is the kind of gap that reads as a bug in the
   * record. Facts are flat scalars by contract; a number is one. Omitted when
   * the caller did not say, because unknown is not one.
   */
  private event(request:JuliusExecutionRequest,type:JuliusExecutionEventType,payload:Record<string,unknown>){return this.ports.recordEvent({runId:request.claim.runId,projectId:request.claim.projectId,taskId:request.claim.taskId,type,idempotencyKey:`${request.operationId}:${type}`,payload:typeof request.attempt==='number'?{...payload,attempt:request.attempt}:payload});}
}
