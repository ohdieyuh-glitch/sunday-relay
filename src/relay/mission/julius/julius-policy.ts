import type { JuliusWorker } from './julius-runtime';

export type JuliusPolicyEffect='ALLOW'|'DENY'|'REQUIRE_APPROVAL'|'LIMITED';
export type JuliusPolicyOperation='DISPATCH_WORKER'|'USE_CAPABILITY'|'USE_PROVIDER'|'ACCESS_NETWORK'|'MUTATE_FILESYSTEM'|'SPAWN_SUBAGENT'|'CONTINUE_GAUNTLET'|'FALLBACK_PROVIDER'|'AUTOMATIC_RETRY'|'UNCHAINED_CONTINUATION';
export interface JuliusCardPolicy {readonly revision:string;readonly autonomy:'SUPERVISED'|'AUTONOMOUS'|'UNCHAINED';readonly allowedProviders:readonly string[];readonly capabilities:readonly string[];readonly network:boolean;readonly filesystemMutation:boolean;readonly fallback:boolean;readonly automaticRetry:boolean;readonly subagents:{readonly allowed:boolean;readonly maxDepth:number;readonly maxActive:number;readonly maxTotal:number};readonly gauntlet:{readonly allowed:boolean;readonly maxRounds:number};readonly concurrency:number;readonly approvals:readonly JuliusPolicyOperation[];}
export interface JuliusPolicyRequest {readonly operation:JuliusPolicyOperation;readonly providerId?:string;readonly capability?:string;readonly depth?:number;readonly active?:number;readonly total?:number;readonly round?:number;}
export interface JuliusPolicyDecision {readonly effect:JuliusPolicyEffect;readonly reasonCode:string;readonly policyRevision:string;readonly limit:number|null;readonly safeRationale:string;}
const decision=(policy:JuliusCardPolicy,effect:JuliusPolicyEffect,reasonCode:string,safeRationale:string,limit:number|null=null):JuliusPolicyDecision=>({effect,reasonCode,policyRevision:policy.revision,limit,safeRationale});

/** Evaluates C.A.R.D. only. Prompts and provider output are deliberately not inputs. */
export function evaluateJuliusPolicy(policy:JuliusCardPolicy,request:JuliusPolicyRequest):JuliusPolicyDecision{
 if(!policy.revision.trim())throw new Error('card_revision_required');
 if(policy.approvals.includes(request.operation)&&policy.autonomy!=='UNCHAINED')return decision(policy,'REQUIRE_APPROVAL','CARD_APPROVAL_REQUIRED','C.A.R.D. requires an authorized approval.');
 switch(request.operation){
  case'ACCESS_NETWORK':return decision(policy,policy.network?'ALLOW':'DENY',policy.network?'CARD_NETWORK_ALLOWED':'CARD_NETWORK_DENIED',policy.network?'Network access is allowed.':'Network access is denied by C.A.R.D.');
  case'MUTATE_FILESYSTEM':return decision(policy,policy.filesystemMutation?'ALLOW':'DENY',policy.filesystemMutation?'CARD_FILESYSTEM_ALLOWED':'CARD_FILESYSTEM_DENIED',policy.filesystemMutation?'Filesystem mutation is allowed.':'Filesystem mutation is denied by C.A.R.D.');
  case'USE_PROVIDER':{const allowed=request.providerId!==undefined&&policy.allowedProviders.includes(request.providerId);return decision(policy,allowed?'ALLOW':'DENY',allowed?'CARD_PROVIDER_ALLOWED':'CARD_PROVIDER_DENIED',allowed?'Provider is allowed.':'Provider is not allowed by C.A.R.D.');}
  case'USE_CAPABILITY':{const allowed=request.capability!==undefined&&policy.capabilities.includes(request.capability);return decision(policy,allowed?'ALLOW':'DENY',allowed?'CARD_CAPABILITY_ALLOWED':'CARD_CAPABILITY_DENIED',allowed?'Capability is allowed.':'Capability is not allowed by C.A.R.D.');}
  case'FALLBACK_PROVIDER':return decision(policy,policy.fallback?'ALLOW':'DENY',policy.fallback?'CARD_FALLBACK_ALLOWED':'CARD_FALLBACK_DENIED',policy.fallback?'Fallback is allowed.':'Fallback is denied by C.A.R.D.');
  case'AUTOMATIC_RETRY':return decision(policy,policy.automaticRetry?'ALLOW':'DENY',policy.automaticRetry?'CARD_RETRY_ALLOWED':'CARD_RETRY_DENIED',policy.automaticRetry?'Automatic retry is allowed.':'Automatic retry is denied by C.A.R.D.');
  case'SPAWN_SUBAGENT':{if(!policy.subagents.allowed)return decision(policy,'DENY','CARD_SUBAGENT_DENIED','Sub-agents are denied by C.A.R.D.');const checks:[[number|undefined,number,string],...Array<[number|undefined,number,string]>]=[[request.depth,policy.subagents.maxDepth,'CARD_SUBAGENT_DEPTH_LIMIT'],[request.active,policy.subagents.maxActive,'CARD_SUBAGENT_ACTIVE_LIMIT'],[request.total,policy.subagents.maxTotal,'CARD_SUBAGENT_TOTAL_LIMIT']];const exceeded=checks.find(([value,limit])=>value===undefined||value>=limit);return exceeded?decision(policy,'DENY',exceeded[2],'Sub-agent limit reached.',exceeded[1]):decision(policy,'LIMITED','CARD_SUBAGENT_ALLOWED','Sub-agent is allowed within explicit limits.',policy.subagents.maxTotal);}
  case'CONTINUE_GAUNTLET':{const allowed=policy.gauntlet.allowed&&request.round!==undefined&&request.round<policy.gauntlet.maxRounds;return decision(policy,allowed?'LIMITED':'DENY',allowed?'CARD_GAUNTLET_ALLOWED':'CARD_GAUNTLET_LIMIT','Gauntlet continuation is bounded by C.A.R.D.',policy.gauntlet.maxRounds);}
  case'UNCHAINED_CONTINUATION':return decision(policy,policy.autonomy==='UNCHAINED'?'LIMITED':'DENY',policy.autonomy==='UNCHAINED'?'CARD_UNCHAINED_ALLOWED':'CARD_UNCHAINED_DENIED','Unchained changes continuation behavior but never overrides hard policy.',policy.concurrency);
  case'DISPATCH_WORKER':return decision(policy,'LIMITED','CARD_CONCURRENCY_LIMIT','Worker dispatch is allowed within C.A.R.D. concurrency.',policy.concurrency);
 }
}

export function workerAllowedByCard(policy:JuliusCardPolicy,worker:JuliusWorker,capability:string):JuliusPolicyDecision{
 const provider=evaluateJuliusPolicy(policy,{operation:'USE_PROVIDER',providerId:worker.providerId});if(provider.effect==='DENY')return provider;
 const capabilityDecision=evaluateJuliusPolicy(policy,{operation:'USE_CAPABILITY',capability});if(capabilityDecision.effect==='DENY')return capabilityDecision;
 return evaluateJuliusPolicy(policy,{operation:'DISPATCH_WORKER'});
}
