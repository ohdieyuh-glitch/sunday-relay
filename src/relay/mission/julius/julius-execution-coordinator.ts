import type { JuliusCardPolicy } from './julius-policy';
import { flattenDiagnostics, JuliusDispatchError, JuliusProviderRouter, safeReviewDiagnostics, type JuliusDispatchAllocation, type JuliusDispatchWorkspace, type JuliusProviderResult } from './julius-router';
import type { JuliusEvidence, JuliusTask, JuliusWorker, JuliusWorkerRole } from './julius-runtime';
import type { JuliusContractReviewCharge } from './julius-task-contract';
import { isJuliusContentDigest, juliusDurableArtifactRef } from './julius-artifact-reference';
import { juliusEvidenceAuthority, juliusMintedEvidenceId } from './julius-worker-authority';
import { juliusStoreErrorClass, juliusStoreErrorIsTransient, type JuliusStoreErrorClass } from './julius-store-failure';

/** The cost a provider reported on its own result, or null when it reported none. */
const reportedUsdMicros=(result:JuliusProviderResult|null):number|null=>{
 const usage=result?.usage;
 if(usage===null||usage===undefined||typeof usage!=='object')return null;
 const value=(usage as Record<string,unknown>).usdMicros;
 return typeof value==='number'&&Number.isFinite(value)?value:null;
};
/**
 * HOW A FAILED ATTEMPT WAS PAID FOR, read off whichever report exists.
 *
 * A subscription-backed dispatch has no API charge to report, so its failure must
 * not settle as `UNKNOWN` — the word for a charge that exists and was not read.
 * It settles as `NOT_APPLICABLE`, and the runtime's own EXECUTION figure travels
 * beside it, so the mission's execution budget is consumed as an API dispatch's
 * would be while no bill is ever recorded. The billing path, which the provider
 * decided from its credential, travels on every basis. The answered result speaks
 * first, as it does for money; the failure's diagnostics otherwise. The ledger
 * validates all of it; this only carries it.
 */
const settlementProvenance=(result:JuliusProviderResult|null,diagnostics:Readonly<Record<string,unknown>>|null|undefined):{costBasis?:'NOT_APPLICABLE';executionUsdMicros?:number|null;billingPath?:string}=>{
 const usage=result!==null&&typeof result.usage==='object'&&result.usage!==null?result.usage as Record<string,unknown>:null;
 const basis=usage?.costBasis??diagnostics?.costBasis;
 const figure=usage?.executionUsdMicros??diagnostics?.executionCostUsdMicros;
 const path=usage?.billingPath??diagnostics?.billingPath;
 return{
  ...(basis==='NOT_APPLICABLE'?{costBasis:'NOT_APPLICABLE' as const,executionUsdMicros:typeof figure==='number'&&Number.isFinite(figure)&&figure>=0?figure:null}:{}),
  ...(typeof path==='string'?{billingPath:path}:{}),
 };
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
/**
 * AN ABORT FROM OUTSIDE ENDS THE DISPATCH, not merely asks the adapter to.
 *
 * The external signal used to be forwarded and nothing more, so the race kept
 * waiting on an adapter that ignored it — and a result that arrived after the
 * abort was persisted, accepted and settled as if nobody had stopped it. The
 * cut is now part of the race, settled BEFORE the adapter is told, so the
 * reason recorded is the one that fired: an outside abort is a cancellation, the
 * deadline is the deadline. Whatever the signal's owner said about why — a lost
 * lease — travels as the failure class.
 */
class JuliusDispatchCancelled extends Error{
 constructor(readonly reasonCode:string){super('dispatch_cancelled');this.name='JuliusDispatchCancelled';}
}
const cancellationReasonOf=(signal:AbortSignal):string=>{
 const reason:unknown=signal.reason;
 return typeof reason==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(reason)?reason:'dispatch_cancelled';
};
async function dispatchWithinDeadline<T>(
 declaredTimeoutMs:number,
 externalSignal:AbortSignal|undefined,
 run:(signal:AbortSignal)=>Promise<T>,
):Promise<T>{
 const controller=new AbortController();
 let cut:(error:Error)=>void=()=>undefined;
 const race=new Promise<never>((_resolve,reject)=>{cut=reject;});
 // Settle first, then tell the adapter: the reason recorded is the one that fired.
 // The adapter is told the same reason the record keeps.
 const forward=():void=>{const reasonCode=cancellationReasonOf(externalSignal!);cut(new JuliusDispatchCancelled(reasonCode));controller.abort(reasonCode);};
 externalSignal?.addEventListener('abort',forward,{once:true});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const running=run(controller.signal);
 try{
  timer=setTimeout(()=>{cut(new JuliusWorkerDeadlineExceeded(declaredTimeoutMs));controller.abort('worker_deadline_exceeded');},declaredTimeoutMs);
  return await Promise.race([running,race]);
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
  /**
   * `usdMicros` is what the failed attempt billed, when the boundary reported it. Spent money is charged, not released.
   * `costBasis: 'NOT_APPLICABLE'` says no bill can exist (a subscription-backed dispatch); `executionUsdMicros` is then
   * what the runtime priced the attempt at, for the execution budget only — never a charge. `billingPath` is how the
   * attempt was paid for, as the provider decided it from its credential.
   */
  release(input:{claim:JuliusExecutionClaim;reservationId:string;reason:string;usdMicros?:number|null;spendUnknown?:boolean;costBasis?:'NOT_APPLICABLE';executionUsdMicros?:number|null;billingPath?:string}):Promise<void>;
  persistEvidence(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;evidence:readonly JuliusEvidence[]}):Promise<void>;
  /**
   * `evidence` is what this result CITES — the kept evidence, already
   * persisted by the call before this one. The result row has carried an
   * `evidence_ids` column since #173 and was given `[]` on every attempt,
   * including attempts that had just written evidence: a durable row asserting
   * "this result cited nothing" as a fact. Unknown is not zero, and neither is
   * an empty list when the answer is known.
   */
  acceptResult(input:{claim:JuliusExecutionClaim;worker:JuliusWorker;result:JuliusProviderResult;idempotencyKey:string;evidence:readonly JuliusEvidence[]}):Promise<{duplicate:boolean}>;
  /**
   * `taskId` is the task the event is ABOUT. It was absent, and the events
   * this coordinator writes carried none — so on the failure path that matters
   * most, a non-retryable worker failure, the durable row could not say which
   * task or which C.A.R.D. role had stopped. Every call already holds the
   * claim; only the port refused to carry it.
   */
  recordEvent(input:{runId:string;projectId:string;taskId:string|null;type:JuliusExecutionEventType;idempotencyKey:string;payload:Record<string,unknown>}):Promise<void>;
  /**
   * THE HANDOFF, FENCED BY THE LEASE ((a2)). Writes `worker.dispatched` only
   * while this attempt still owns the task, and answers false when it no longer
   * does: a recovery took it first, and the provider must not be called.
   * Optional; without it the handoff is written through `recordEvent`, unfenced.
   */
  recordHandoff?(input:{runId:string;projectId:string;taskId:string;idempotencyKey:string;payload:Record<string,unknown>;leaseGeneration:number}):Promise<boolean>;
}
export type JuliusExecutionEventType='worker.selected'|'budget.reserved'|'budget.denied'|'worker.dispatched'|'worker.completed'|'retry.scheduled'|'task.failed'|'evidence.refused';
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
 readonly attempt?:number;
 /** The one undo Julius authorises before this dispatch starts. Additive; absent means nothing is undone. */
 readonly workspace?:JuliusDispatchWorkspace; }
/**
 * `failureClass` is the connector's safe subclass when one is known, already
 * narrowed to a machine token by {@link safeFailureClass}. It is additive:
 * every existing reader keeps working, and `null` means "not classified",
 * never "fine".
 */
/**
 * WHAT AN ATTEMPT OBSERVED ABOUT ITSELF, IN NUMBERS, ON THE PATH THAT SUCCEEDED.
 *
 * `JuliusTrajectoryEvent` has carried `providerId`, `usdMicros`, `inputTokens`,
 * `outputTokens` and `durationMs` since it was written, and on a successful
 * dispatch every one of them was null — because the pipeline had nothing to put
 * there. The coordinator saw the provider's usage, committed the budget with it,
 * and returned `{status, workerId, duplicate}`.
 *
 * SO EVERY METRIC DERIVED FROM THE TRAJECTORY WAS STRUCTURALLY EMPTY.
 * `summariseJuliusEvals` reads cost and duration off DISPATCH rows:
 * `knownUsdMicros` was always 0, `unknownCostComponents` always equalled the
 * dispatch count, `costComplete` was always false, and `averageDurationMs` was
 * always null — for every project, every runtime version and every mission that
 * has ever run. Not because a provider was silent. Because nobody was asked.
 *
 * IT IS NOT A SECOND RECORD OF THE MONEY. `budget.settled` remains the ledger
 * and the authority; this is the same figure on the row the EVALS read, which is
 * the row that was designed to hold it. Where the provider reported nothing the
 * field stays null, so an unreported cost still cannot become a zero.
 */
export interface JuliusAttemptMeasurement{
 /** The provider that actually answered, as the adapter reported itself. */
 readonly providerId:string;
 /** What the boundary billed, or null when it reported nothing. Never 0 for unknown. */
 readonly usdMicros:number|null;
 readonly inputTokens:number|null;
 readonly outputTokens:number|null;
 /** Wall time the runtime observed for the attempt, or null. */
 readonly durationMs:number|null;
}
/**
 * READ THE NUMBERS OFF THE PROVIDER'S OWN REPORT, and nothing else.
 *
 * `usage` is `unknown` by design — it is the provider's shape, not Julius's — so
 * every field is checked one at a time and a value that is not a finite,
 * non-negative integer is null. `validateTrajectoryEvent` refuses anything else,
 * and a NaN reaching the durable row would be a number nobody could act on.
 */
function measurementOf(worker:{readonly providerId:string},result:{readonly usage:unknown}):JuliusAttemptMeasurement{
 const usage=(typeof result.usage==='object'&&result.usage!==null?result.usage:{}) as Record<string,unknown>;
 const count=(value:unknown):number|null=>
  typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
 return{
  providerId:worker.providerId,
  usdMicros:count(usage.usdMicros),
  inputTokens:count(usage.inputTokens),
  outputTokens:count(usage.outputTokens),
  // `runtimeMs` is what the adapters report; the trajectory column is `durationMs`.
  durationMs:count(usage.runtimeMs),
 };
}

export type JuliusExecutionOutcome={readonly status:'COMPLETED';readonly workerId:string;readonly duplicate:boolean;/** What this attempt measured. Absent only where no provider answered. */readonly measured?:JuliusAttemptMeasurement;/** What the worker proposed for its own task contract, unsanitised. Julius decides. */readonly contractProposal?:unknown;/** A coder's request for architect guidance, unsanitised. */readonly guidanceRequest?:unknown;/** An architect's guidance packet, unsanitised. */readonly guidance?:unknown;/** What a continuation segment resumes from, unsanitised. Julius rebuilds it. */readonly segmentResume?:unknown;/** What a worker of any slot needs Julius to go and look at, unsanitised. */readonly researchAsks?:unknown;/** A reviewer's canonical verdict, unsanitised. Julius decides what it means. */readonly reviewVerdict?:unknown;/** An architect's rebuttal to a disagreement, unsanitised. */readonly rebuttal?:unknown;/** An architect's structured architecture state, unsanitised. Advisory, never the contract. */readonly architecture?:unknown;/** An architect's final architecture consistency assessment, unsanitised. */readonly consistency?:unknown;/** A Coding Agent's workspace change set and report, unsanitised. */readonly implementation?:unknown;/** A Coding Agent's observations about the design, unsanitised. */readonly architectureObservations?:unknown;/** Writes Julius owed after the store accepted the result, and could not make. Absent when there were none. */readonly unrecorded?:readonly JuliusUnrecordedBookkeeping[]}|{
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
 /**
  * WHAT THE FAILED ATTEMPT CHANGED IN THE WORKSPACE, unsanitised.
  *
  * A failed attempt still edited the directory, and those edits used to reach
  * the record only by turning up inside the NEXT attempt's diff — credited to
  * an attempt that did not make them. The boundary carries the same shape a
  * completed dispatch returns; the kernel reads it with its own allowlist and
  * decides what it means. Absent when nothing was observed, which a cancelled
  * dispatch must not confuse with an empty one.
  */
 readonly implementation?:unknown;
};

/**
 * A piece of evidence a worker reported that Julius will not keep, and why.
 * The position is the item's place in the result, so the refusal names exactly
 * which claim it was.
 */
interface RefusedEvidence{readonly index:number;readonly evidenceType:string;readonly status:string;readonly reasonCode:string}
/**
 * WHAT A RESULT'S EVIDENCE MAY BE, AND WHAT IT IS CALLED.
 *
 * The SHAPE is still refused whole — a malformed item fails the dispatch, as it
 * always has. What changed is AUTHORITY: an item of a type the producing role
 * may not author is set aside and named, rather than kept. And the id is
 * Julius's, whatever the worker wrote: position under the producing task and
 * lease, so a replay writes the same rows and no worker can name another
 * task's.
 */
const normalizedEvidence=(claim:JuliusExecutionClaim,worker:JuliusWorker,result:JuliusProviderResult,role:string):{readonly kept:JuliusEvidence[];readonly refused:RefusedEvidence[]}=>{
  if(result.workerId!==worker.workerId||result.providerId!==worker.providerId||!result.safeSummary.trim()||!Array.isArray(result.evidence))throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned a malformed or mismatched result.');
  const refused:RefusedEvidence[]=[];
  const kept=result.evidence.map((raw,index)=>{if(raw===null||typeof raw!=='object')throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned malformed evidence.');const value=raw as Record<string,unknown>;if(!['PASSED','FAILED','INCONCLUSIVE'].includes(String(value.status))||typeof value.type!=='string'||typeof value.safeSummary!=='string')throw new JuliusDispatchError('INVALID_REQUEST',false,'Provider returned malformed evidence.');
   const authority=juliusEvidenceAuthority(role,value.type);
   if(!authority.ok){refused.push({index,evidenceType:value.type.slice(0,64),status:String(value.status),reasonCode:authority.reasonCode});return null;}
   return{evidenceId:juliusMintedEvidenceId(claim.taskId,claim.leaseGeneration,index),missionId:claim.task.missionId,taskId:claim.taskId,workerId:worker.workerId,type:value.type as JuliusEvidence['type'],status:value.status as JuliusEvidence['status'],safeSummary:value.safeSummary,/* WHAT A WORKER MAY PUT IN A DURABLE COLUMN. Both were taken verbatim: any
      string a provider wrote became the artifact reference of record, and any
      string became its integrity hash. A reference is kept only when it names
      something that outlives this process, and a hash only when it IS one — a
      dangling pointer and a plausible-looking non-digest are each worse than the
      null that says the runtime does not know. The tool path has enforced this
      since #208 (`tool_result_artifact_ref_unverified`); the worker path did not. */
   artifactRef:juliusDurableArtifactRef(value.artifactRef),integrityHash:isJuliusContentDigest(value.integrityHash)?value.integrityHash:null,occurredAt:typeof value.occurredAt==='string'?value.occurredAt:new Date().toISOString()};}).filter((item):item is NonNullable<typeof item>=>item!==null);
  return{kept,refused};
};

/**
 * JULIUS'S OWN BOOKKEEPING IS RETRIED, A BOUNDED NUMBER OF TIMES.
 *
 * Three attempts, pausing 250 ms and then 1 s between them. Serialization
 * failures are already retried inside each store call (`juliusSerializable`),
 * so this layer is for what that one cannot absorb: a connection lost between
 * statements, a pool that could not hand one out, a lock that timed out.
 */
export const JULIUS_BOOKKEEPING_ATTEMPTS=3;
const JULIUS_BOOKKEEPING_PAUSES_MS:readonly number[]=Object.freeze([250,1000]);
/** Where Julius's own write failed, relative to handing the work to a provider. */
export type JuliusPersistencePhase='persist_before_dispatch'|'persist_during_dispatch'|'persist_after_answer';
/** A write Julius owed after the store accepted the result and could not make. Reported on the outcome, never thrown. */
export interface JuliusUnrecordedBookkeeping{readonly step:'settlement'|'completed_event';readonly storeErrorClass:JuliusStoreErrorClass|null}
/**
 * THE ENDING ITSELF COULD NOT BE WRITTEN.
 *
 * When even the release and the ending event fail after retrying, there is
 * nothing durable left to say it with. So the failure leaves as a typed
 * error: Julius's, from this phase, with or without the work handed. The raw
 * driver error used to leave instead, which read the same as a crash
 * anywhere else. `handed` is what a caller must honour: work that was handed
 * may have been paid for, and must not be dispatched again blind.
 */
export class JuliusPersistenceUnavailable extends Error{
 constructor(readonly phase:JuliusPersistencePhase,readonly handed:boolean,readonly storeErrorClass:JuliusStoreErrorClass|null){super('julius_persistence_unavailable');this.name='JuliusPersistenceUnavailable';}
}
/**
 * JULIUS'S OWN WRITE FAILED. It is never the worker's failure.
 *
 * Retryable only before the work was handed, when nothing can have been
 * spent and a retry repeats nothing but bookkeeping, and only when the store
 * error is one that repetition can cure: an integrity error before the
 * dispatch fails the same way on every attempt, so it fails once. After the
 * handoff a retry would dispatch the worker again and pay twice, so the
 * attempt fails truthfully instead, and what the answer cost is charged by
 * the ending.
 */
const persistenceFailure=(phase:JuliusPersistencePhase,retryable:boolean,error:unknown,handed:boolean):JuliusDispatchError=>
 new JuliusDispatchError('PERSISTENCE_FAILURE',retryable,'Julius could not record its own bookkeeping.',phase,{runtimeStarted:handed,storeErrorClass:juliusStoreErrorClass(error)});
/**
 * THE STORE'S TWO REFUSALS OF A RESULT say what happened to the lease, not to
 * the worker.
 *
 * `stale_worker_result` means the lease moved on: recovery reclaimed the task,
 * or a newer generation holds it. `result_after_cancellation` means the run or
 * the task was cancelled. Both are cancellations of this attempt, and both
 * answers were paid for, so the ending charges them. Anything else a result
 * write throws is Julius's own bookkeeping failing.
 */
const acceptanceRefusal=(error:unknown):JuliusDispatchError|null=>{
 const message=error instanceof Error?error.message:null;
 if(message==='stale_worker_result')return new JuliusDispatchError('CANCELLED',false,'The lease moved on before the result could be accepted.','lease_superseded',{runtimeStarted:true});
 if(message==='result_after_cancellation')return new JuliusDispatchError('CANCELLED',false,'The run or task was cancelled before the result could be accepted.','result_after_cancellation',{runtimeStarted:true});
 return null;
};

/** One claimed task execution. Julius—not the adapter—owns policy, budget, evidence, result acceptance, and retry semantics. */
export class JuliusExecutionCoordinator {
  constructor(private readonly router:JuliusProviderRouter,private readonly ports:JuliusExecutionPorts,private readonly pause:(ms:number)=>Promise<void>=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms))){}
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
    /**
     * P0: JULIUS'S OWN WRITES BEFORE ANYTHING IS HANDED.
     *
     * These four used to sit outside every guard. A store error in any of them
     * rejected `execute` itself, the tick threw, and every task that tick had
     * claimed waited out its lease. Nothing has been spent here, so a failure
     * is Julius's, retryable, and releases whatever hold it took.
     */
    let reservation:JuliusResourceReservation|null=null;
    try{
      await this.bookkeeping(()=>this.event(request,'worker.selected',{workerId:worker.workerId,providerId:worker.providerId}));
      const reserved=await this.bookkeeping(()=>this.ports.reserve({claim:request.claim,worker,request:request.resources,idempotencyKey:`${request.operationId}:budget`}));
      reservation=reserved;
      if(reserved.state==='DENIED'){await this.bookkeeping(()=>this.event(request,'budget.denied',{reason:reserved.denialReason}));return{status:'DENIED',code:'BUDGET_DENIED'};}
      /**
       * THE ROLE AND THE AMOUNT TRAVEL WITH THE RESERVATION ID.
       *
       * Without them the row says only that money moved, and the per-slot ledger
       * — which is PROJECTED from these rows rather than stored — cannot say
       * whose it was. Attribution guessed from the task id would be a second
       * source of truth about money, which is the arrangement the cost-accounting
       * module exists to end.
       */
      await this.bookkeeping(()=>this.event(request,'budget.reserved',{reservationId:reserved.reservationId,role:request.role,usdMicros:request.resources.usdMicros}));
    }catch(error){
      return this.end(request,persistenceFailure('persist_before_dispatch',juliusStoreErrorIsTransient(juliusStoreErrorClass(error)),error,false),reservation?.state==='RESERVED'?reservation.reservationId:null,null,false);
    }
    const reservationId=reservation.reservationId;
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
    /**
     * WHETHER THE WORK HAS BEEN HANDED. Set on the line before the dispatch, so
     * every failure before it is Julius's bookkeeping with nothing spent, and
     * every failure after it may have been paid for.
     */
    let handed=false;
    let accepted:{readonly result:JuliusProviderResult;readonly duplicate:boolean;readonly evidence:readonly JuliusEvidence[]};
    try{
      if(request.signal?.aborted)throw new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.',cancellationReasonOf(request.signal));
      /**
       * THE HANDOFF IS WRITTEN ONLY WHILE THIS ATTEMPT OWNS THE TASK ((a2)). A
       * recovery that took the task first refuses it here, before anything is
       * sent: this attempt is over, and its hold is released as spending nothing.
       */
      const owned=await this.bookkeeping(()=>this.handoff(request,worker));
      if(!owned)throw new JuliusDispatchError('CANCELLED',false,'This attempt no longer owns its task, so nothing was dispatched.','lease_lost',{runtimeStarted:false});
      /**
       * AND AN ABORT THAT LANDED WHILE THE HANDOFF WAS WRITTEN STOPS IT HERE (F4).
       * `dispatchWithinDeadline` listens for aborts from the moment it is
       * called, and never sees one that fired before: from here to its listener
       * everything is synchronous, so this is the last moment one can land.
       */
      if(request.signal?.aborted)throw new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.',cancellationReasonOf(request.signal),{runtimeStarted:false});
      dispatchedAtMs=Date.now();
      handed=true;
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
      const result=await dispatchWithinDeadline(worker.timeoutMs,request.signal,(signal)=>this.router.dispatch(worker,{taskId:request.claim.taskId,contextId:request.claim.contextId,taskType:request.taskType,signal,...(request.allocation===undefined?{}:{allocation:request.allocation}),...(request.contract===undefined?{}:{contract:request.contract}),...(request.workspace===undefined?{}:{workspace:request.workspace}),/* WHICH ATTEMPT. The claim already fences it; the adapter needs it to keep one round's body from overwriting the round before it. */attempt:{leaseGeneration:request.claim.leaseGeneration}}));
      answered=result;
      /**
       * NOTHING FROM A CANCELLED DISPATCH BECOMES MISSION STATE. An abort that
       * landed in the same turn the result did is still an abort: what it cost
       * is charged below, and no evidence, acceptance or settlement follows.
       */
      if(request.signal?.aborted===true)throw new JuliusDispatchCancelled(cancellationReasonOf(request.signal));
      const screened=normalizedEvidence(request.claim,worker,result,request.role);
      const evidence=screened.kept;
      for(const refused of screened.refused){
       await this.bookkeeping(()=>this.event(request,'evidence.refused',{workerId:worker.workerId,role:request.role,taskType:request.taskType,...refused},String(refused.index)));
      }
      /**
       * A WORKER THAT SAYS IT FAILED HAS FAILED THIS ATTEMPT.
       *
       * The coordinator never read `status`. The store marked the task FAILED,
       * verification then minted a review of a FAILED task, and the claim query
       * never offers one — so the run sat in READY with nothing it could claim.
       * The attempt ran, so what it cost is charged; what it reported is not
       * kept, because PASSED evidence from an attempt its own worker called
       * failed would still count toward a mission's criteria.
       */
      if(result.status!=='SUCCEEDED'){
       throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'The worker reported that its attempt failed.','worker_reported_failure',{runtimeStarted:true});
      }
      /**
       * P2: A PAID ANSWER, RECORDED — RETRYING THE BOOKKEEPING, NEVER THE DISPATCH.
       *
       * Both writes are idempotent already: evidence by its position under this
       * task and lease, the result by `${operationId}:result`. So a transient
       * store error repeats the WRITE. Retrying the task instead would dispatch
       * the worker again and pay for the same answer twice.
       */
      await this.bookkeeping(()=>this.ports.persistEvidence({claim:request.claim,worker,evidence}));
      const receipt=await this.bookkeepingCounted(()=>this.ports.acceptResult({claim:request.claim,worker,result,idempotencyKey:`${request.operationId}:result`,evidence}));
      /**
       * A RETRIED ACCEPT THAT ANSWERS `duplicate` FOUND ITS OWN WRITE. A
       * connection lost during COMMIT leaves the first attempt landed and
       * unacknowledged. The key is this operation's, and the lease fences any
       * other holder, so the row can only be this dispatch's. Calling it a
       * replay would make the pipeline skip what a first result owes.
       */
      accepted={result,duplicate:receipt.retried?false:receipt.value.duplicate,evidence};
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
      /* A CANCELLATION AFTER HANDOFF MAY HAVE BEEN PAID FOR: the hold is kept. */
      : error instanceof JuliusDispatchCancelled
       ? new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.',error.reasonCode,{runtimeStarted:true,elapsedMs:Date.now()-dispatchedAtMs})
       : error;
     /**
      * WHOSE FAILURE THIS IS: the WORKER'S only when the worker's boundary threw it.
      *
      * Before the handoff, anything that throws is Julius's own write, and
      * nothing has been spent. Out of the dispatch, a store error (it carries a
      * SQLSTATE or a socket errno) escaped the adapter's own writes. It is
      * Julius's, but it may have been paid for, so it is not retried. Anything
      * else out of the dispatch is the boundary failing, as it always was.
      * After the answer, the only throwers are Julius's writes and the store's
      * two refusals, which name what happened to the lease rather than the
      * worker.
      */
     const failure=boundary instanceof JuliusDispatchError?boundary
      : !handed?persistenceFailure('persist_before_dispatch',juliusStoreErrorIsTransient(juliusStoreErrorClass(boundary)),boundary,false)
       : answered===null
        ? (juliusStoreErrorClass(boundary)===null?new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Execution boundary failed.'):persistenceFailure('persist_during_dispatch',false,boundary,true))
        : acceptanceRefusal(boundary)??persistenceFailure('persist_after_answer',false,boundary,true);
     return this.end(request,failure,reservationId,answered,handed);
    }
    // P3 runs OUTSIDE the catch. Once the store owns the task, nothing below can turn this into a failure.
    return this.afterAccept(request,worker,reservationId,accepted);
  }
  /**
   * P3: THE STORE HAS THE RESULT, SO THE DISPATCH COMPLETED.
   *
   * `acceptResult` committed the task in its own transaction. A settlement or
   * event write that fails after it used to be caught as a failure of the
   * attempt. Its `task.failed` then contradicted the store, and the pipeline
   * skipped everything a completed dispatch owes: the trajectory, contract
   * proposals, guidance, verdicts and repairs. Its `release`, after a commit that
   * had already written `budget.settled`, wrote a second one, and
   * `cost-accounting.tsv` sums them.
   *
   * So each write is retried as bookkeeping. One that still fails is REPORTED on
   * the outcome, never thrown, and NEVER released: the reservation stays held,
   * which keeps the money counted and leaves the missing settlement row visible
   * as missing.
   */
  private async afterAccept(request:JuliusExecutionRequest,worker:JuliusWorker,reservationId:string,accepted:{readonly result:JuliusProviderResult;readonly duplicate:boolean;readonly evidence:readonly JuliusEvidence[]}):Promise<JuliusExecutionOutcome>{
    const {result,duplicate,evidence}=accepted;
    const unrecorded:JuliusUnrecordedBookkeeping[]=[];
    try{await this.bookkeeping(()=>this.ports.commit({claim:request.claim,reservationId,result}));}
    catch(error){unrecorded.push({step:'settlement',storeErrorClass:juliusStoreErrorClass(error)});}
    try{await this.bookkeeping(()=>this.event(request,'worker.completed',{workerId:worker.workerId,duplicate,evidenceCount:evidence.length,...successDiagnostics(request,result)}));}
    catch(error){unrecorded.push({step:'completed_event',storeErrorClass:juliusStoreErrorClass(error)});}
    return{status:'COMPLETED',workerId:worker.workerId,duplicate,measured:measurementOf(worker,result),...(unrecorded.length===0?{}:{unrecorded}),...(result.contractProposal===undefined?{}:{contractProposal:result.contractProposal}),...(result.guidanceRequest===undefined?{}:{guidanceRequest:result.guidanceRequest}),...(result.guidance===undefined?{}:{guidance:result.guidance}),
    ...(result.segmentResume===undefined?{}:{segmentResume:result.segmentResume}),
    ...(result.researchAsks===undefined?{}:{researchAsks:result.researchAsks}),
    ...(result.reviewVerdict===undefined?{}:{reviewVerdict:result.reviewVerdict}),
    ...(result.rebuttal===undefined?{}:{rebuttal:result.rebuttal}),
    ...(result.architecture===undefined?{}:{architecture:result.architecture}),
    ...(result.consistency===undefined?{}:{consistency:result.consistency}),
    ...(result.implementation===undefined?{}:{implementation:result.implementation}),
    ...(result.architectureObservations===undefined?{}:{architectureObservations:result.architectureObservations})};
  }
  /**
   * THE ENDING OF AN ATTEMPT THAT DID NOT COMPLETE: settle the hold, write the
   * ending, answer. Its own writes are bookkeeping too. If they cannot be
   * written even after retrying, it throws `JuliusPersistenceUnavailable`,
   * naming the phase and whether the work had been handed. The caller then
   * knows a Julius store failure from a worker's, and a handed task is one it
   * must not dispatch again blind.
   */
  private async end(request:JuliusExecutionRequest,failure:JuliusDispatchError,reservationId:string|null,answered:JuliusProviderResult|null,handed:boolean):Promise<JuliusExecutionOutcome>{
   try{
    const reported=reportedUsdMicros(answered);
    const billed=reported??(typeof failure.diagnostics?.costUsdMicros==='number'?failure.diagnostics.costUsdMicros:null);
    // A provider that ANSWERED ran, whatever the diagnostics say about it.
    // A subscription-backed failure says so, rather than reading as a charge nobody read.
    /**
     * AFTER THE HANDOFF, NO AMOUNT IS UNKNOWN, NOT FREE.
     *
     * The rule used to be "unknown only if something says it ran". An error that
     * said nothing therefore released its whole hold. A timeout normalised from a
     * raw error carries no diagnostics at all, so a request the provider had
     * received, and may have billed, settled as free: in the slot ledger, inside
     * the paid run's own budget, before any report could read it. Now, once the
     * work is handed, only an explicit `runtimeStarted: false` (a provider that
     * refused the request unprocessed, or an adapter that knows it sent nothing)
     * releases a hold that has no amount. Before the handoff nothing was sent,
     * and a hold is released as before.
     *
     * A timed-out attempt therefore keeps its hold, and a retry after a timeout
     * meets a tighter budget. That is the truthful direction.
     */
    const startedOrUnsaid=answered!==null||failure.diagnostics?.runtimeStarted===true||(handed&&failure.diagnostics?.runtimeStarted!==false);
    if(reservationId!==null)await this.bookkeeping(()=>this.ports.release({claim:request.claim,reservationId,reason:failure.code,usdMicros:billed,spendUnknown:billed===null&&startedOrUnsaid,...settlementProvenance(answered,failure.diagnostics)}));
    /* The class travels with the code on BOTH endings. A retry that is later
     * abandoned and a failure taken at once must leave the same diagnosis
     * behind, or the durable record would explain only the failures that
     * happened to be non-retryable. */
    /* WHAT THE FAILED ATTEMPT CHANGED travels on both endings too: a retry is
     * exactly where an unrecorded change set becomes the next attempt's. */
    const carriedImplementation=failure.implementation===undefined?{}:{implementation:failure.implementation};
    if(failure.retryable&&request.policy.automaticRetry){await this.bookkeeping(()=>this.event(request,'retry.scheduled',{code:failure.code,errorRetryable:true,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)}));return{status:'RETRY',code:failure.code,failureClass:failure.failureClass,...carriedDiagnostics(failure),...carriedImplementation};}
    await this.bookkeeping(()=>this.event(request,'task.failed',{code:failure.code,errorRetryable:failure.retryable,failureClass:failure.failureClass,...flattenDiagnostics(failure.diagnostics)}));
    return{status:'FAILED',code:failure.code,failureClass:failure.failureClass,...carriedDiagnostics(failure),...carriedImplementation};
   }catch(error){
    throw new JuliusPersistenceUnavailable(!handed?'persist_before_dispatch':answered===null?'persist_during_dispatch':'persist_after_answer',handed,juliusStoreErrorClass(error));
   }
  }
  /**
   * A WRITE OF JULIUS'S OWN, REPEATED WHILE REPEATING CAN HELP.
   *
   * Only a transient store failure is repeated (`juliusStoreErrorIsTransient`),
   * at most {@link JULIUS_BOOKKEEPING_ATTEMPTS} times. Everything else is thrown
   * at once: an integrity error fails the same way every time, and a refusal is
   * an answer. Every step handed to this is idempotent (see each call site),
   * and a dispatch is never one of them.
   */
  private async bookkeeping<T>(step:()=>Promise<T>):Promise<T>{return(await this.bookkeepingCounted(step)).value;}
  private async bookkeepingCounted<T>(step:()=>Promise<T>):Promise<{readonly value:T;readonly retried:boolean}>{
    for(let attempt=1;;attempt+=1){
      try{return{value:await step(),retried:attempt>1};}
      catch(error){
        if(attempt>=JULIUS_BOOKKEEPING_ATTEMPTS||!juliusStoreErrorIsTransient(juliusStoreErrorClass(error)))throw error;
        await this.pause(JULIUS_BOOKKEEPING_PAUSES_MS[attempt-1]??JULIUS_BOOKKEEPING_PAUSES_MS[JULIUS_BOOKKEEPING_PAUSES_MS.length-1]!);
      }
    }
  }
  /**
   * ON EVERY EVENT, not only the failures. `retry.scheduled` and `task.failed`
   * are where a reader looks after a bad run, but `worker.dispatched` is where
   * they look to see that a SECOND ask happened at all — and a fact present on
   * one and absent on the other is the kind of gap that reads as a bug in the
   * record. Facts are flat scalars by contract; a number is one. Omitted when
   * the caller did not say, because unknown is not one.
   */
  /** `suffix` distinguishes several events of one type from one operation — one per refused evidence item. */
  private event(request:JuliusExecutionRequest,type:JuliusExecutionEventType,payload:Record<string,unknown>,suffix?:string){return this.ports.recordEvent({runId:request.claim.runId,projectId:request.claim.projectId,taskId:request.claim.taskId,type,idempotencyKey:`${request.operationId}:${type}${suffix===undefined?'':`:${suffix}`}`,payload:typeof request.attempt==='number'?{...payload,attempt:request.attempt}:payload});}
  /** `worker.dispatched`, fenced where the ports can fence it: the same key and facts as `event` writes. */
  private async handoff(request:JuliusExecutionRequest,worker:JuliusWorker):Promise<boolean>{
    const payload=typeof request.attempt==='number'?{workerId:worker.workerId,attempt:request.attempt}:{workerId:worker.workerId};
    if(this.ports.recordHandoff===undefined){await this.event(request,'worker.dispatched',{workerId:worker.workerId});return true;}
    return this.ports.recordHandoff({runId:request.claim.runId,projectId:request.claim.projectId,taskId:request.claim.taskId,idempotencyKey:`${request.operationId}:worker.dispatched`,payload,leaseGeneration:request.claim.leaseGeneration});
  }
}
