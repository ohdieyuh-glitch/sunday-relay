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
/**
 * THE DECLARED DEADLINE, ENFORCED — by Julius, not by the adapter it describes.
 *
 * `JuliusWorker.timeoutMs` was read in exactly one place:
 * `JuliusWorkerRegistry.register`, which checks it is a positive integer and
 * never consults it again. Every adapter bounds ITSELF — the OpenAI client's
 * `timeout`, the hosted runner's abort timer, `runHermesReview`'s window — so
 * the declared number was a MIRROR of adapter behaviour, true only for as long
 * as each adapter's own timer kept working. Nothing stood behind it. A worker
 * whose timer never fires, or whose promise never settles, held the dispatch
 * open until the lease expired and took the job's wall clock with it.
 *
 * This is that missing layer, and only that layer: it does not replace an
 * adapter's own deadline and must never be reached on a healthy run, because
 * every adapter is configured to stop first. Reaching it is itself the finding.
 *
 * TWO MECHANISMS, BECAUSE ONE IS NOT ENOUGH. The signal is forwarded so a
 * well-behaved adapter is told to stop and can release what it holds; the race
 * is what actually returns, because an adapter that ignores the signal is
 * precisely the case this exists for. The abandoned promise gets a `catch` so
 * its eventual rejection cannot surface as an unhandled rejection minutes after
 * the task has already failed.
 */
class JuliusWorkerDeadlineExceeded extends Error{
 constructor(readonly declaredTimeoutMs:number){super('worker_deadline_exceeded');this.name='JuliusWorkerDeadlineExceeded';}
}
async function dispatchWithinDeadline<T>(
 declaredTimeoutMs:number,
 externalSignal:AbortSignal|undefined,
 run:(signal:AbortSignal)=>Promise<T>,
):Promise<T>{
 const controller=new AbortController();
 const forward=():void=>controller.abort();
 externalSignal?.addEventListener('abort',forward,{once:true});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const running=run(controller.signal);
 try{
  return await Promise.race([
   running,
   new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new JuliusWorkerDeadlineExceeded(declaredTimeoutMs));},declaredTimeoutMs);
   }),
  ]);
 }finally{
  if(timer!==undefined)clearTimeout(timer);
  externalSignal?.removeEventListener('abort',forward);
  // The race may have abandoned it. Nothing reads the result; this only stops
  // a later rejection from arriving with no listener.
  void running.catch(()=>{});
 }
}
/**
 * THE CARRIED DIAGNOSTICS, OR NOTHING AT ALL.
 *
 * Absent and empty are different claims. A boundary that reported no
 * structural facts is not the same as one that reported an empty set, and an
 * always-present `{}` would also change the shape of every outcome that has
 * nothing to say — which is most of them, and none of which this repair is
 * about. So the key appears only when there is something under it.
 */
const carriedDiagnostics=(failure:JuliusDispatchError):{diagnostics?:Record<string,string|number|boolean|null>}=>{
 const flat=flattenDiagnostics(failure.diagnostics);
 return Object.keys(flat).length===0?{}:{diagnostics:flat};
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
export type JuliusExecutionOutcome={readonly status:'COMPLETED';readonly workerId:string;readonly duplicate:boolean;/** What the worker proposed for its own task contract, unsanitised. Julius decides. */readonly contractProposal?:unknown;/** A coder's request for architect guidance, unsanitised. */readonly guidanceRequest?:unknown;/** An architect's guidance packet, unsanitised. */readonly guidance?:unknown;/** What a continuation segment resumes from, unsanitised. Julius rebuilds it. */readonly segmentResume?:unknown;/** What a worker of any slot needs Julius to go and look at, unsanitised. */readonly researchAsks?:unknown;/** A reviewer's canonical verdict, unsanitised. Julius decides what it means. */readonly reviewVerdict?:unknown}|{
 readonly status:'RETRY'|'FAILED'|'DENIED';
 readonly code:string;
 readonly failureClass?:string|null;
 /**
  * THE FACTS THE BOUNDARY REPORTED, ALREADY FLATTENED AND SAFE, so the caller
  * that owns the TASK can put them on the row that ends it.
  *
  * This arm used to carry the code and the class and nothing else. The
  * coordinator flattened the adapter's diagnostics onto its OWN event and then
  * dropped them, so `julius-task-pipeline`'s terminal `task.failed` — the row
  * written when a run's autonomy declines a retry, and the row a reader opens
  * first to ask why a paid mission ended — could not name the served model, the
  * response id, the tokens, or what the coder had already spent before it timed
  * out. Not by omission: this type gave the pipeline nothing to write.
  *
  * `diag_`-prefixed, so it can be spread beside a facts object without any key
  * of its own colliding. Absent when the boundary reported none, which is not
  * the same claim as reporting an empty set.
  */
 readonly diagnostics?:Record<string,string|number|boolean|null>;
};

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
    let worker:JuliusWorker;try{worker=this.router.select({role:request.role,taskType:request.taskType,capability:request.capability,policy:request.policy,excludedWorkerIds:request.excludedWorkerIds});}catch(error){const failure=error instanceof JuliusDispatchError?error:new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Worker selection failed.');await this.event(request,'task.failed',{code:failure.code,errorRetryable:failure.retryable,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:failure.code==='POLICY_DENIED'?'DENIED':'FAILED',code:failure.code,failureClass:failure.failureClass,...carriedDiagnostics(failure)};}
    await this.event(request,'worker.selected',{workerId:worker.workerId,providerId:worker.providerId});
    const reservation=await this.ports.reserve({claim:request.claim,worker,request:request.resources,idempotencyKey:`${request.operationId}:budget`});
    if(reservation.state==='DENIED'){await this.event(request,'budget.denied',{reason:reservation.denialReason});return{status:'DENIED',code:'BUDGET_DENIED'};}
    /**
     * THE ROLE AND THE AMOUNT TRAVEL WITH THE RESERVATION ID.
     *
     * Without them the row says only that money moved, and the per-slot ledger
     * — which is PROJECTED from these rows rather than stored — cannot say
     * whose it was. Attribution guessed from the task id would be a second
     * source of truth about money, which is the arrangement the cost-accounting
     * module exists to end.
     */
    await this.event(request,'budget.reserved',{reservationId:reservation.reservationId,role:request.role,usdMicros:request.resources.usdMicros});
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
    /** Set when the dispatch is handed to the router, so a deadline cut can say
     *  how long the worker actually ran beside the limit it declared. */
    let dispatchedAtMs=Date.now();
    try{
      if(request.signal?.aborted)throw new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.');
      await this.event(request,'worker.dispatched',{workerId:worker.workerId});
      dispatchedAtMs=Date.now();
      // THE WORKER'S OWN DECLARED NUMBER, never a literal here. A second
      // opinion about how long a worker may take is how declared and operative
      // deadlines came to differ by 160 s once already.
      /**
       * EVERY STEP THAT TOUCHES MISSION STATE IS BELOW THIS AWAIT, and that
       * ordering is what makes a late result harmless rather than a rule
       * forbidding one.
       *
       * `persistEvidence`, `acceptResult` and `commit` are reached only by
       * falling through a dispatch that RESOLVED inside the deadline. A promise
       * that settles afterwards has already lost the race, so nothing reads it:
       * it cannot create evidence, cannot be accepted as a result, and cannot
       * settle a reservation the catch below has already released. A guard
       * asserting the same thing would bind nothing — and would not survive the
       * one edit that could actually break this, which is moving a line above
       * the await. `julius-worker-deadline.test.ts` pins the ordering instead.
       */
      const result=await dispatchWithinDeadline(worker.timeoutMs,request.signal,(signal)=>this.router.dispatch(worker,{taskId:request.claim.taskId,contextId:request.claim.contextId,taskType:request.taskType,signal,...(request.allocation===undefined?{}:{allocation:request.allocation}),...(request.contract===undefined?{}:{contract:request.contract})}));
      answered=result;
      const evidence=normalizedEvidence(request.claim,worker,result);
      await this.ports.persistEvidence({claim:request.claim,worker,evidence});
      const receipt=await this.ports.acceptResult({claim:request.claim,worker,result,idempotencyKey:`${request.operationId}:result`});
      await this.ports.commit({claim:request.claim,reservationId:reservation.reservationId,result});
      await this.event(request,'worker.completed',{workerId:worker.workerId,duplicate:receipt.duplicate,evidenceCount:evidence.length,...successDiagnostics(request,result)});
      return{status:'COMPLETED',workerId:worker.workerId,duplicate:receipt.duplicate,...(result.contractProposal===undefined?{}:{contractProposal:result.contractProposal}),...(result.guidanceRequest===undefined?{}:{guidanceRequest:result.guidanceRequest}),...(result.guidance===undefined?{}:{guidance:result.guidance}),
      ...(result.segmentResume===undefined?{}:{segmentResume:result.segmentResume}),
      ...(result.researchAsks===undefined?{}:{researchAsks:result.researchAsks}),
      ...(result.reviewVerdict===undefined?{}:{reviewVerdict:result.reviewVerdict})};
    }catch(error){
     /**
      * A DEADLINE CUT IS RETRYABLE, AND ITS HOLD IS NOT FREED.
      *
      * `runtimeStarted: true` is the literal truth and it is load-bearing: the
      * release below frees the reservation only when nothing can have been
      * spent, and a dispatch cut mid-flight had already reached a provider.
      * Reporting it as a clean nothing would hand the mission that money a
      * second time. The declared deadline travels beside the elapsed time so
      * the row says WHICH limit was reached rather than merely that one was —
      * and reaching this limit at all means an adapter outlived its own timer,
      * which is the finding, not the remedy.
      */
     const boundary=error instanceof JuliusWorkerDeadlineExceeded
      ? new JuliusDispatchError('TIMEOUT',true,'Worker exceeded the deadline it declares.','worker_deadline_exceeded',{timedOut:true,runtimeStarted:true,timeoutMs:error.declaredTimeoutMs,elapsedMs:Date.now()-dispatchedAtMs})
      : error;
     const failure=boundary instanceof JuliusDispatchError?boundary:new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Execution boundary failed.');const reported=reportedUsdMicros(answered);
     const billed=reported??(typeof failure.diagnostics?.costUsdMicros==='number'?failure.diagnostics.costUsdMicros:null);
     // A provider that ANSWERED ran, whatever the diagnostics say about it.
     await this.ports.release({claim:request.claim,reservationId:reservation.reservationId,reason:failure.code,usdMicros:billed,spendUnknown:billed===null&&(answered!==null||failure.diagnostics?.runtimeStarted===true)});
     /* The class travels with the code on BOTH endings. A retry that is later
      * abandoned and a failure taken at once must leave the same diagnosis
      * behind, or the durable record would explain only the failures that
      * happened to be non-retryable. */
     if(failure.retryable&&request.policy.automaticRetry){await this.event(request,'retry.scheduled',{code:failure.code,errorRetryable:true,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:'RETRY',code:failure.code,failureClass:failure.failureClass,...carriedDiagnostics(failure)};}await this.event(request,'task.failed',{code:failure.code,errorRetryable:failure.retryable,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)});return{status:'FAILED',code:failure.code,failureClass:failure.failureClass,...carriedDiagnostics(failure)};}
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
