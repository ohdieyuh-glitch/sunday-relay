import type { JuliusWorker } from './julius-runtime';

export type JuliusPolicyEffect='ALLOW'|'DENY'|'REQUIRE_APPROVAL'|'LIMITED';
export type JuliusPolicyOperation='DISPATCH_WORKER'|'USE_CAPABILITY'|'USE_PROVIDER'|'USE_TOOL'|'READ_FILESYSTEM'|'EXECUTE_PROCESS'|'ACCESS_NETWORK'|'MUTATE_FILESYSTEM'|'SPAWN_SUBAGENT'|'CONTINUE_ITERATIVE_REVIEW'|'FALLBACK_PROVIDER'|'AUTOMATIC_RETRY'|'UNCHAINED_CONTINUATION';
/**
 * V6 G-2: A C.A.R.D. GATE SCOPED TO ROLES AND TASK TYPES.
 *
 * `approvals` names an operation and nothing else, so a `DISPATCH_WORKER` gate holds every dispatch of the run:
 * the plan, the build, every review and every repair. A scope holds only the dispatches whose role AND task type
 * it names, so a mission can ask its governance owner to sign off ONE step (the Coding Agent's build, after the
 * plan was reviewed) and nothing else.
 *
 * v1 HONOURS `DISPATCH_WORKER` ONLY. A `USE_CAPABILITY` scope would also reach the tool controller, which REFUSES
 * on REQUIRE_APPROVAL rather than asking a person; a scope naming any other operation gates nothing. A request
 * that carries no role or no task type cannot be evaluated against a scope, so it is HELD (fail closed); the only
 * such caller is `workerAllowedByCard`, which acts on DENY alone.
 */
export interface JuliusApprovalScope {readonly operation:'DISPATCH_WORKER';readonly roles:readonly string[];readonly taskTypes:readonly string[];}
export interface JuliusCardPolicy {readonly revision:string;readonly autonomy:'SUPERVISED'|'AUTONOMOUS'|'UNCHAINED';readonly allowedProviders:readonly string[];readonly capabilities:readonly string[];readonly network:boolean;/** Defaults true for legacy C.A.R.D. records; new records persist it explicitly. */readonly filesystemRead?:boolean;readonly filesystemMutation:boolean;readonly fallback:boolean;readonly automaticRetry:boolean;readonly subagents:{readonly allowed:boolean;readonly maxDepth:number;readonly maxActive:number;readonly maxTotal:number};readonly iterativeReview:{readonly allowed:boolean;readonly maxRounds:number};readonly concurrency:number;readonly approvals:readonly JuliusPolicyOperation[];/** V6 G-2: gates scoped to roles and task types (see `JuliusApprovalScope`). Absent or empty: none. */readonly approvalScopes?:readonly JuliusApprovalScope[];}
export interface JuliusPolicyRequest {readonly operation:JuliusPolicyOperation;readonly providerId?:string;readonly capability?:string;readonly depth?:number;readonly active?:number;readonly total?:number;readonly round?:number;/** V6 G-2: who would be dispatched, and for what. A scoped gate that cannot read them holds the dispatch. */readonly role?:string;readonly taskType?:string;}
export interface JuliusPolicyDecision {readonly effect:JuliusPolicyEffect;readonly reasonCode:string;readonly policyRevision:string;readonly limit:number|null;readonly safeRationale:string;}
const decision=(policy:JuliusCardPolicy,effect:JuliusPolicyEffect,reasonCode:string,safeRationale:string,limit:number|null=null):JuliusPolicyDecision=>({effect,reasonCode,policyRevision:policy.revision,limit,safeRationale});

/**
 * Evaluates C.A.R.D. only. Prompts and provider output are deliberately not
 * inputs.
 *
 * `CONTINUE_ITERATIVE_REVIEW` and `iterativeReview` were named
 * `CONTINUE_GAUNTLET` and `gauntlet`, which made this policy — and therefore
 * Julius — aware of a user-facing feature. The BOUND is generic and belongs
 * here: a deployment may limit how many times work is reviewed again. The
 * feature that uses the bound lives in `src/relay/mission/gauntlet/**`, and
 * Julius does not know it exists.
 */
export function evaluateJuliusPolicy(policy:JuliusCardPolicy,request:JuliusPolicyRequest):JuliusPolicyDecision{
 if(!policy.revision.trim())throw new Error('card_revision_required');
 if(policy.approvals.includes(request.operation)&&policy.autonomy!=='UNCHAINED')return decision(policy,'REQUIRE_APPROVAL','CARD_APPROVAL_REQUIRED','C.A.R.D. requires an authorized approval.');
 if(policy.autonomy!=='UNCHAINED'&&request.operation==='DISPATCH_WORKER'&&(policy.approvalScopes??[]).some((scope)=>scope.operation==='DISPATCH_WORKER'&&(request.role===undefined||request.taskType===undefined||(scope.roles.includes(request.role)&&scope.taskTypes.includes(request.taskType)))))return decision(policy,'REQUIRE_APPROVAL','CARD_SCOPED_APPROVAL_REQUIRED','C.A.R.D. requires an authorized approval for this role and task type.');
 switch(request.operation){
  case'ACCESS_NETWORK':return decision(policy,policy.network?'ALLOW':'DENY',policy.network?'CARD_NETWORK_ALLOWED':'CARD_NETWORK_DENIED',policy.network?'Network access is allowed.':'Network access is denied by C.A.R.D.');
  case'MUTATE_FILESYSTEM':return decision(policy,policy.filesystemMutation?'ALLOW':'DENY',policy.filesystemMutation?'CARD_FILESYSTEM_ALLOWED':'CARD_FILESYSTEM_DENIED',policy.filesystemMutation?'Filesystem mutation is allowed.':'Filesystem mutation is denied by C.A.R.D.');
  case'USE_TOOL':return decision(policy,request.capability!==undefined&&policy.capabilities.includes(request.capability)?'ALLOW':'DENY',request.capability!==undefined&&policy.capabilities.includes(request.capability)?'CARD_TOOL_ALLOWED':'CARD_TOOL_DENIED','Tool use is governed by the run capability set.');
  case'READ_FILESYSTEM':return decision(policy,policy.filesystemRead!==false?'ALLOW':'DENY',policy.filesystemRead!==false?'CARD_FILESYSTEM_READ_ALLOWED':'CARD_FILESYSTEM_READ_DENIED',policy.filesystemRead!==false?'Bounded workspace reads are allowed.':'Filesystem reads are denied by C.A.R.D.');
  case'EXECUTE_PROCESS':return decision(policy,policy.capabilities.includes('process')?'ALLOW':'DENY',policy.capabilities.includes('process')?'CARD_PROCESS_ALLOWED':'CARD_PROCESS_DENIED','Process execution requires the process capability.');
  case'USE_PROVIDER':{const allowed=request.providerId!==undefined&&policy.allowedProviders.includes(request.providerId);return decision(policy,allowed?'ALLOW':'DENY',allowed?'CARD_PROVIDER_ALLOWED':'CARD_PROVIDER_DENIED',allowed?'Provider is allowed.':'Provider is not allowed by C.A.R.D.');}
  case'USE_CAPABILITY':{const allowed=request.capability!==undefined&&policy.capabilities.includes(request.capability);return decision(policy,allowed?'ALLOW':'DENY',allowed?'CARD_CAPABILITY_ALLOWED':'CARD_CAPABILITY_DENIED',allowed?'Capability is allowed.':'Capability is not allowed by C.A.R.D.');}
  case'FALLBACK_PROVIDER':return decision(policy,policy.fallback?'ALLOW':'DENY',policy.fallback?'CARD_FALLBACK_ALLOWED':'CARD_FALLBACK_DENIED',policy.fallback?'Fallback is allowed.':'Fallback is denied by C.A.R.D.');
  case'AUTOMATIC_RETRY':return decision(policy,policy.automaticRetry?'ALLOW':'DENY',policy.automaticRetry?'CARD_RETRY_ALLOWED':'CARD_RETRY_DENIED',policy.automaticRetry?'Automatic retry is allowed.':'Automatic retry is denied by C.A.R.D.');
  case'SPAWN_SUBAGENT':{if(!policy.subagents.allowed)return decision(policy,'DENY','CARD_SUBAGENT_DENIED','Sub-agents are denied by C.A.R.D.');const checks:[[number|undefined,number,string],...Array<[number|undefined,number,string]>]=[[request.depth,policy.subagents.maxDepth,'CARD_SUBAGENT_DEPTH_LIMIT'],[request.active,policy.subagents.maxActive,'CARD_SUBAGENT_ACTIVE_LIMIT'],[request.total,policy.subagents.maxTotal,'CARD_SUBAGENT_TOTAL_LIMIT']];const exceeded=checks.find(([value,limit])=>value===undefined||value>=limit);return exceeded?decision(policy,'DENY',exceeded[2],'Sub-agent limit reached.',exceeded[1]):decision(policy,'LIMITED','CARD_SUBAGENT_ALLOWED','Sub-agent is allowed within explicit limits.',policy.subagents.maxTotal);}
  case'CONTINUE_ITERATIVE_REVIEW':{const allowed=policy.iterativeReview.allowed&&request.round!==undefined&&request.round<policy.iterativeReview.maxRounds;return decision(policy,allowed?'LIMITED':'DENY',allowed?'CARD_ITERATIVE_REVIEW_ALLOWED':'CARD_ITERATIVE_REVIEW_LIMIT','Iterative review is bounded by C.A.R.D.',policy.iterativeReview.maxRounds);}
  case'UNCHAINED_CONTINUATION':return decision(policy,policy.autonomy==='UNCHAINED'?'LIMITED':'DENY',policy.autonomy==='UNCHAINED'?'CARD_UNCHAINED_ALLOWED':'CARD_UNCHAINED_DENIED','Unchained changes continuation behavior but never overrides hard policy.',policy.concurrency);
  case'DISPATCH_WORKER':return decision(policy,'LIMITED','CARD_CONCURRENCY_LIMIT','Worker dispatch is allowed within C.A.R.D. concurrency.',policy.concurrency);
 }
}

export function workerAllowedByCard(policy:JuliusCardPolicy,worker:JuliusWorker,capability:string):JuliusPolicyDecision{
 const provider=evaluateJuliusPolicy(policy,{operation:'USE_PROVIDER',providerId:worker.providerId});if(provider.effect==='DENY')return provider;
 const capabilityDecision=evaluateJuliusPolicy(policy,{operation:'USE_CAPABILITY',capability});if(capabilityDecision.effect==='DENY')return capabilityDecision;
 return evaluateJuliusPolicy(policy,{operation:'DISPATCH_WORKER'});
}
