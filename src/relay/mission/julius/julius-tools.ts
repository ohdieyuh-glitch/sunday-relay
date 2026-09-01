import type { JuliusBudgetPort, JuliusClock } from './julius-runtime-ports';
import { evaluateJuliusPolicy, type JuliusCardPolicy, type JuliusPolicyDecision, type JuliusPolicyOperation } from './julius-policy';

export type JuliusToolId =
  | 'fs.read'|'fs.write'|'fs.patch'|'fs.list'|'fs.stat'|'fs.mkdir'|'fs.move'|'fs.copy'|'fs.remove'
  | 'search.grep'|'search.find'|'search.glob'|'process.exec'|'shell.bash'
  | 'git.status'|'git.diff'|'git.show'|'git.log'|'git.apply'|'test.run'|'build.run';
export type JuliusToolKind='FILESYSTEM'|'SEARCH'|'PROCESS'|'SHELL'|'GIT'|'TEST'|'BUILD';
export type JuliusToolRisk='LOW'|'MEDIUM'|'HIGH';
export interface JuliusToolDefinition {readonly toolId:JuliusToolId;readonly version:string;readonly kind:JuliusToolKind;readonly capability:string;readonly riskClass:JuliusToolRisk;readonly readsFilesystem:boolean;readonly mutatesFilesystem:boolean;readonly accessesNetwork:boolean;readonly executesProcess:boolean;readonly timeoutCeilingMs:number;readonly outputCeilingBytes:number;readonly concurrency:'SERIAL'|'PARALLEL';readonly available:boolean;}
export interface ToolInvocationRequest {readonly invocationId:string;readonly runId:string;readonly taskId:string;readonly projectId:string;readonly workerId:string;readonly toolId:JuliusToolId;readonly toolVersion:string;readonly arguments:Readonly<Record<string,unknown>>;readonly cwd?:string;readonly idempotencyKey:string;readonly timeoutMs?:number;readonly expectedMutation:'NONE'|'WORKSPACE';}
export type JuliusToolEvidenceType='COMMAND_EXECUTION'|'FILE_MUTATION'|'TEST_RESULT'|'BUILD_RESULT'|'STATIC_ANALYSIS'|'ARTIFACT';
export interface JuliusToolArtifact {readonly artifactId:string;readonly kind:string;readonly byteLength:number;readonly integrityHash:string;}
export interface JuliusToolEvidence {readonly evidenceId:string;readonly type:JuliusToolEvidenceType;readonly integrityHash:string;readonly facts:Readonly<Record<string,string|number|boolean|null>>;}
export interface ToolInvocationResult {readonly invocationId:string;readonly status:'SUCCEEDED'|'FAILED'|'DENIED'|'TIMED_OUT'|'CANCELLED';readonly exitCode:number|null;readonly safeSummary:string;readonly stdout:string;readonly stderr:string;readonly stdoutRef:null|string;readonly stderrRef:null|string;readonly artifacts:readonly JuliusToolArtifact[];readonly evidence:readonly JuliusToolEvidence[];readonly durationMs:number;readonly resourceUsage:{readonly toolCalls:number;readonly runtimeMs:number;readonly outputBytes:number};readonly policyDecisionRef:string;readonly mutations:readonly {path:string;beforeHash:string|null;afterHash:string|null}[];}
export interface JuliusToolExecutionContext {readonly workspaceRoot:string;readonly signal?:AbortSignal;readonly safeEnvironment?:Readonly<Record<string,string>>;readonly networkIsolation:'ENFORCED_DENY'|'MEDIATED_ALLOW';readonly filesystemIsolation:'WORKSPACE_ONLY'|'READ_ONLY';}
export interface JuliusToolAdapter {execute(definition:JuliusToolDefinition,request:ToolInvocationRequest,context:JuliusToolExecutionContext,decision:JuliusPolicyDecision):Promise<ToolInvocationResult>;}
export interface JuliusToolAuditPort {record(fact:{invocationId:string;runId:string;taskId:string;projectId:string;workerId:string;state:'AUTHORIZED'|'DENIED'|'STARTED'|'COMPLETED';toolId:JuliusToolId;policyDecisionRef:string;safeSummary:string;evidenceIds:readonly string[];durationMs:number;toolCalls:number}):Promise<void>;}

export class JuliusToolRegistry {
 private readonly tools=new Map<JuliusToolId,JuliusToolDefinition>();
 register(definition:JuliusToolDefinition):void {if(this.tools.has(definition.toolId))throw new Error('tool_already_registered');if(!definition.version.trim())throw new Error('tool_version_required');this.tools.set(definition.toolId,Object.freeze({...definition}));}
 get(toolId:JuliusToolId,version:string):JuliusToolDefinition|null {const tool=this.tools.get(toolId);return tool?.version===version&&tool.available?tool:null;}
 list():readonly JuliusToolDefinition[]{return [...this.tools.values()].sort((a,b)=>a.toolId.localeCompare(b.toolId));}
}

const operationFor=(tool:JuliusToolDefinition):JuliusPolicyOperation[]=>['USE_TOOL',...(tool.readsFilesystem?['READ_FILESYSTEM' as const]:[]),...(tool.mutatesFilesystem?['MUTATE_FILESYSTEM' as const]:[]),...(tool.executesProcess?['EXECUTE_PROCESS' as const]:[]),...(tool.accessesNetwork?['ACCESS_NETWORK' as const]:[])];
export class JuliusToolController {
 private readonly completed=new Map<string,{fingerprint:string;result:ToolInvocationResult}>(); private readonly active=new Map<string,{fingerprint:string;result:Promise<ToolInvocationResult>}>();
 constructor(private readonly deps:{registry:JuliusToolRegistry;adapter:JuliusToolAdapter;budget:JuliusBudgetPort;audit:JuliusToolAuditPort;clock:JuliusClock}){}
 async invoke(request:ToolInvocationRequest,policy:JuliusCardPolicy,context:JuliusToolExecutionContext):Promise<ToolInvocationResult>{
  const key=`${request.projectId}\u0000${request.runId}\u0000${request.idempotencyKey}`;const fingerprint=JSON.stringify([request.taskId,request.workerId,request.toolId,request.toolVersion,request.arguments,request.cwd,request.timeoutMs,request.expectedMutation]);const prior=this.completed.get(key);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('idempotency_key_request_mismatch');return prior.result;}const running=this.active.get(key);if(running){if(running.fingerprint!==fingerprint)throw new Error('idempotency_key_request_mismatch');return running.result;}
  const operation=this.run(request,policy,context,key,fingerprint).finally(()=>this.active.delete(key));this.active.set(key,{fingerprint,result:operation});return operation;
 }
 private async run(request:ToolInvocationRequest,policy:JuliusCardPolicy,context:JuliusToolExecutionContext,key:string,fingerprint:string):Promise<ToolInvocationResult>{
  const tool=this.deps.registry.get(request.toolId,request.toolVersion);if(!tool)return this.denied(request,policy,'TOOL_UNAVAILABLE','The requested tool and version are unavailable.');
  if(request.expectedMutation==='NONE'&&tool.mutatesFilesystem)return this.denied(request,policy,'MUTATION_CONTRACT_MISMATCH','The request declared no mutation.');
  let decision:JuliusPolicyDecision=evaluateJuliusPolicy(policy,{operation:'USE_TOOL',capability:tool.capability});
  for(const operation of operationFor(tool)){const next=evaluateJuliusPolicy(policy,{operation,capability:tool.capability});if(next.effect==='DENY'||next.effect==='REQUIRE_APPROVAL'){decision=next;break;}}
  if(decision.effect==='DENY'||decision.effect==='REQUIRE_APPROVAL')return this.denied(request,policy,decision.reasonCode,decision.safeRationale,decision);
  const timeoutMs=Math.min(Math.max(1,request.timeoutMs??tool.timeoutCeilingMs),tool.timeoutCeilingMs);const reservationId=`tool:${request.projectId}:${request.runId}:${request.invocationId}`;
  const reserved=await this.deps.budget.reserve({reservationId,runId:request.runId,projectId:request.projectId,taskId:request.taskId,usdMicros:0,inputTokens:0,outputTokens:0,toolCalls:1,runtimeMs:timeoutMs,now:this.deps.clock.now()});
  if(reserved.state==='DENIED')return this.denied(request,policy,'TOOL_BUDGET_DENIED','The tool-call budget is exhausted.',decision);
  await this.deps.audit.record({invocationId:request.invocationId,runId:request.runId,taskId:request.taskId,projectId:request.projectId,workerId:request.workerId,state:'AUTHORIZED',toolId:request.toolId,policyDecisionRef:decision.reasonCode,safeSummary:'Tool authorized under C.A.R.D.',evidenceIds:[],durationMs:0,toolCalls:1});
  try{await this.deps.audit.record({invocationId:request.invocationId,runId:request.runId,taskId:request.taskId,projectId:request.projectId,workerId:request.workerId,state:'STARTED',toolId:request.toolId,policyDecisionRef:decision.reasonCode,safeSummary:'Tool invocation started.',evidenceIds:[],durationMs:0,toolCalls:1});const result=await this.deps.adapter.execute(tool,{...request,timeoutMs},context,decision);this.completed.set(key,{fingerprint,result});await this.deps.budget.commit({reservationId,usdMicros:0,inputTokens:0,outputTokens:0,toolCalls:1,runtimeMs:result.durationMs,receiptId:request.invocationId,now:this.deps.clock.now()});await this.deps.audit.record({invocationId:request.invocationId,runId:request.runId,taskId:request.taskId,projectId:request.projectId,workerId:request.workerId,state:'COMPLETED',toolId:request.toolId,policyDecisionRef:decision.reasonCode,safeSummary:result.safeSummary,evidenceIds:result.evidence.map(e=>e.evidenceId),durationMs:result.durationMs,toolCalls:1});return result;}catch(error){if(!this.completed.has(key))await this.deps.budget.release({reservationId,reason:'TOOL_EXECUTION_FAILED',now:this.deps.clock.now()});throw error;}
 }
 private async denied(request:ToolInvocationRequest,policy:JuliusCardPolicy,code:string,summary:string,decision?:JuliusPolicyDecision):Promise<ToolInvocationResult>{const result:ToolInvocationResult={invocationId:request.invocationId,status:'DENIED',exitCode:null,safeSummary:summary,stdout:'',stderr:'',stdoutRef:null,stderrRef:null,artifacts:[],evidence:[],durationMs:0,resourceUsage:{toolCalls:0,runtimeMs:0,outputBytes:0},policyDecisionRef:decision?.reasonCode??`${policy.revision}:${code}`,mutations:[]};await this.deps.audit.record({invocationId:request.invocationId,runId:request.runId,taskId:request.taskId,projectId:request.projectId,workerId:request.workerId,state:'DENIED',toolId:request.toolId,policyDecisionRef:result.policyDecisionRef,safeSummary:summary,evidenceIds:[],durationMs:0,toolCalls:0});return result;}
}
