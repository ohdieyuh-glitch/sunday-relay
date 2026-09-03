import type{JuliusWorker,JuliusWorkerRegistry,JuliusWorkerRole}from'./julius-runtime';import{workerAllowedByCard,type JuliusCardPolicy}from'./julius-policy';
export const JULIUS_ERROR_CODES=['RATE_LIMIT','TIMEOUT','AUTH_CONFIGURATION','PROVIDER_UNAVAILABLE','INVALID_REQUEST','WORKER_EXECUTION_FAILURE','POLICY_DENIED','BUDGET_DENIED','CANCELLED']as const;export type JuliusErrorCode=typeof JULIUS_ERROR_CODES[number];
/**
 * THE CONNECTOR'S OWN CLASSIFICATION, NARROWED TO A MACHINE TOKEN.
 *
 * A `JuliusErrorCode` is deliberately coarse: nine codes have to cover every
 * provider, so `WORKER_EXECUTION_FAILURE` answers "a malformed plan", "a
 * refusal" and "a 500" identically. The first paid mission failed on exactly
 * that ambiguity — the durable record held `code` and nothing else, and the
 * run could not be diagnosed after its database was destroyed.
 *
 * The connector already knows the finer answer, so it is carried alongside the
 * code. NARROWING IS THE SAFETY PROPERTY, not a convention: anything that is
 * not a short lower-case token becomes `null`, so a provider exception
 * message, a URL, a header or a key SHAPE cannot survive this function even if
 * a future adapter passes one by mistake. Redaction that depends on the caller
 * remembering to redact is not redaction.
 */
export const safeFailureClass=(value:unknown):string|null=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value)?value:null;
export class JuliusDispatchError extends Error{
 readonly failureClass:string|null;
 constructor(readonly code:JuliusErrorCode,readonly retryable:boolean,readonly safeMessage:string,failureClass?:unknown){super(code);this.failureClass=safeFailureClass(failureClass);}
}
export interface JuliusProviderResult{readonly workerId:string;readonly providerId:string;readonly status:'SUCCEEDED'|'FAILED';readonly safeSummary:string;readonly evidence:readonly unknown[];readonly usage:unknown;}
export interface JuliusProviderAdapter{readonly adapterId:string;dispatch(input:{taskId:string;contextId:string;signal?:AbortSignal}):Promise<JuliusProviderResult>;}
export interface JuliusProviderHealth{readonly providerId:string;readonly state:'CLOSED'|'OPEN'|'HALF_OPEN';readonly consecutiveFailures:number;readonly openedAt:string|null;readonly active:number;readonly concurrencyLimit:number;}
export class JuliusProviderHealthRegistry{private readonly values=new Map<string,JuliusProviderHealth>();set(value:JuliusProviderHealth){this.values.set(value.providerId,structuredClone(value));}available(providerId:string){const value=this.values.get(providerId);return value===undefined||(value.state!=='OPEN'&&value.active<value.concurrencyLimit);}get(providerId:string){const value=this.values.get(providerId);return value?structuredClone(value):null;}}
export class JuliusProviderRouter{constructor(private readonly workers:JuliusWorkerRegistry,private readonly adapters:ReadonlyMap<string,JuliusProviderAdapter>,private readonly health:JuliusProviderHealthRegistry){}
 select(input:{role:JuliusWorkerRole;taskType:string;capability:string;policy:JuliusCardPolicy;excludedWorkerIds?:readonly string[]}):JuliusWorker{const candidates=this.workers.eligible(input.role,input.taskType,input.capability).filter(worker=>!input.excludedWorkerIds?.includes(worker.workerId)&&this.health.available(worker.providerId));let denied=false;for(const worker of candidates){const verdict=workerAllowedByCard(input.policy,worker,input.capability);if(verdict.effect==='DENY'){denied=true;continue;}if(this.adapters.has(worker.adapterId))return worker;}throw new JuliusDispatchError(denied?'POLICY_DENIED':'PROVIDER_UNAVAILABLE',false,denied?'C.A.R.D. denied all eligible routes.':'No healthy provider route is available.');}
 /**
  * WHICH WORKERS COULD TAKE THIS, in the router's own order.
  *
  * `select` answers "which one" and throws when none; a caller deciding
  * whether to REROUTE needs "how many are left" without taking one and
  * without catching. Read-only: it registers nothing, dispatches nothing and
  * applies exactly the same eligibility, health and C.A.R.D. filters `select`
  * does, so the two can never disagree about who is available.
  */
 eligibleWorkerIds(input:{role:JuliusWorkerRole;taskType:string;capability:string;policy:JuliusCardPolicy;excludedWorkerIds?:readonly string[]}):string[]{
  return this.workers.eligible(input.role,input.taskType,input.capability)
   .filter(worker=>!input.excludedWorkerIds?.includes(worker.workerId)
    &&this.health.available(worker.providerId)
    &&workerAllowedByCard(input.policy,worker,input.capability).effect!=='DENY'
    &&this.adapters.has(worker.adapterId))
   .map(worker=>worker.workerId);
 }
 /** The provider a worker belongs to, or null when the worker is unknown. */
 providerOf(workerId:string|null):string|null{
  if(workerId===null)return null;
  const worker=this.workers.get(workerId);
  return worker?worker.providerId:null;
 }
 async dispatch(worker:JuliusWorker,input:{taskId:string;contextId:string;signal?:AbortSignal}){const adapter=this.adapters.get(worker.adapterId);if(!adapter)throw new JuliusDispatchError('PROVIDER_UNAVAILABLE',false,'Worker adapter is unavailable.');try{return await adapter.dispatch(input);}catch(error){throw normalizeProviderError(error);}}
}
export function normalizeProviderError(error:unknown):JuliusDispatchError{if(error instanceof JuliusDispatchError)return error;const code=error!==null&&typeof error==='object'&&'code'in error?String((error as{code:unknown}).code).toUpperCase():'';if(code==='429'||code==='RATE_LIMIT')return new JuliusDispatchError('RATE_LIMIT',true,'Provider rate limit reached.');if(code==='ETIMEDOUT'||code==='TIMEOUT'||error instanceof DOMException&&error.name==='TimeoutError')return new JuliusDispatchError('TIMEOUT',true,'Provider timed out.');if(['401','403','AUTH','CONFIGURATION'].includes(code))return new JuliusDispatchError('AUTH_CONFIGURATION',false,'Provider authentication or configuration failed.');if(code==='ABORT_ERR')return new JuliusDispatchError('CANCELLED',false,'Dispatch was cancelled.');return new JuliusDispatchError('WORKER_EXECUTION_FAILURE',false,'Worker execution failed.');}
