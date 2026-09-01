import { exact, identifier, integer, iso, str, boolean as flag } from './executor-schema';

/** Every physical operation the executor exposes. One operation is one narrowly scoped authority. */
export type ExecutorOperation='create'|'prepare'|'execute'|'cancel'|'destroy'|'inspect'|'artifacts'|'discover'|'quarantine'|'reconcile';
export type ExecutorCallerScope=`sandbox:${ExecutorOperation}`;
export const EXECUTOR_OPERATIONS:readonly ExecutorOperation[]=['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile'];
export const EXECUTOR_OPERATION_SET=new Set<ExecutorOperation>(EXECUTOR_OPERATIONS);
export const operationScope=(operation:ExecutorOperation):ExecutorCallerScope=>`sandbox:${operation}`;
/** Operations that act on an already-bound sandbox, so the executor must re-check the sandbox's tenant. */
export const SANDBOX_SCOPED:ReadonlySet<ExecutorOperation>=new Set<ExecutorOperation>(['prepare','execute','cancel','destroy','inspect','artifacts']);
/** What a tenant's orchestrator may do: everything it does names a sandbox it owns. */
export const TENANT_OPERATIONS:readonly ExecutorOperation[]=['create','prepare','execute','cancel','destroy','inspect','artifacts'];
/**
 * Fleet-wide operations. `discover` and `reconcile` read and act across every tenant's sandboxes and
 * `quarantine` destroys a container outright, so none of them is ever derived for a tenant caller.
 */
export const OPERATOR_OPERATIONS:readonly ExecutorOperation[]=['discover','reconcile','quarantine'];

const C='executor_operation_invalid';
/**
 * Derived from what the response envelope can actually carry, not asserted to be under it. `ulimit -f` caps
 * stdout and stderr separately, and each stream crosses the wire twice: once inside the result, where a
 * control byte costs six characters of JSON escaping, and once as the base64 terminal payload it is verified
 * against, which costs 4/3. The margin absorbs what that formula leaves out — the changed-path payload, the
 * two receipt bodies, the attestations, and `ulimit -f`'s rounding down to whole 1024-byte blocks. Measured
 * worst case with the current constants is about 3.7 MB against 4 MB. A ceiling merely claimed to be safe is how a
 * completed, signed execution became unreportable, so this one is computed and the margin is load-bearing.
 */
export const MAX_EXECUTOR_RESPONSE_BYTES=4*1024*1024;
export const MAX_SANDBOX_OUTPUT_BYTES=Math.floor(MAX_EXECUTOR_RESPONSE_BYTES/(2*(6+4/3))*0.9);
const NETWORKS=new Set(['DENY','MEDIATED']);
const identity=(value:unknown,tenantId:string)=>{
  const record=exact(value,['sandboxId','invocationId','tenantId','projectId','runId','taskId','leaseGeneration','policyRevision','createdAt','expiresAt'],'executor_identity');
  const parsed={sandboxId:identifier(record.sandboxId,'identity.sandboxId',C),invocationId:identifier(record.invocationId,'identity.invocationId',C),tenantId:identifier(record.tenantId,'identity.tenantId',C),projectId:identifier(record.projectId,'identity.projectId',C),runId:identifier(record.runId,'identity.runId',C),taskId:identifier(record.taskId,'identity.taskId',C),leaseGeneration:integer(record.leaseGeneration,'identity.leaseGeneration',C),policyRevision:str(record.policyRevision,'identity.policyRevision',C,128),createdAt:iso(record.createdAt,'identity.createdAt',C),expiresAt:iso(record.expiresAt,'identity.expiresAt',C)};
  if(parsed.tenantId!==tenantId)throw new Error('SECURITY_FAILURE:executor_tenant_scope_refused');
  if(Date.parse(parsed.expiresAt)<=Date.parse(parsed.createdAt))throw new Error(`${C}:identity.expiresAt`);
  return parsed;
};
const limits=(value:unknown)=>{
  const record=exact(value,['cpuCount','memoryBytes','pids','openFiles','workspaceBytes','outputBytes','wallClockMs','concurrentProcesses'],'executor_limits');
  const bounded={cpuCount:integer(record.cpuCount,'limits.cpuCount',C,1,64),memoryBytes:integer(record.memoryBytes,'limits.memoryBytes',C,1,68_719_476_736),pids:integer(record.pids,'limits.pids',C,1,4096),openFiles:integer(record.openFiles,'limits.openFiles',C,1,1_048_576),workspaceBytes:integer(record.workspaceBytes,'limits.workspaceBytes',C,1,1_099_511_627_776),outputBytes:integer(record.outputBytes,'limits.outputBytes',C,1,MAX_SANDBOX_OUTPUT_BYTES),wallClockMs:integer(record.wallClockMs,'limits.wallClockMs',C,1,3_600_000),concurrentProcesses:integer(record.concurrentProcesses,'limits.concurrentProcesses',C,1,256)};
  // The kernel enforces concurrency through the pid ceiling, so a larger concurrency claim would be a number
  // the sandbox cannot honour. It is refused rather than recorded and left unenforced.
  if(bounded.concurrentProcesses>bounded.pids)throw new Error(`${C}:limits.concurrentProcesses`);
  return bounded;
};
const policy=(value:unknown)=>{
  const record=exact(value,['readWorkspace','mutateWorkspace','executeProcess','network','allowedTools'],'executor_policy');
  if(!NETWORKS.has(record.network as string))throw new Error(`${C}:policy.network`);
  if(!Array.isArray(record.allowedTools)||record.allowedTools.length>64)throw new Error(`${C}:policy.allowedTools`);
  return {readWorkspace:flag(record.readWorkspace,'policy.readWorkspace',C),mutateWorkspace:flag(record.mutateWorkspace,'policy.mutateWorkspace',C),executeProcess:flag(record.executeProcess,'policy.executeProcess',C),network:record.network as 'DENY'|'MEDIATED',allowedTools:record.allowedTools.map((tool,index)=>identifier(tool,`policy.allowedTools.${index}`,C))};
};
const lease=(record:Record<string,unknown>)=>integer(record.expectedLeaseGeneration,'expectedLeaseGeneration',C);

export interface ExecutorOperationContext {readonly tenantId:string;}

/** Strict per-operation validation. The executor never forwards a caller-shaped object to the physical adapter. */
export function parseExecutorOperationRequest(operation:Exclude<ExecutorOperation,'execute'>,value:unknown,context:ExecutorOperationContext):unknown {
  switch(operation){
    case 'create':{const record=exact(value,['identity','policy','limits'],'executor_create');return {identity:identity(record.identity,context.tenantId),policy:policy(record.policy),limits:limits(record.limits)};}
    case 'prepare':{const record=exact(value,['sandboxId','sourceRef','expectedLeaseGeneration'],'executor_prepare');return {sandboxId:identifier(record.sandboxId,'sandboxId',C),sourceRef:str(record.sourceRef,'sourceRef',C,1024),expectedLeaseGeneration:lease(record)};}
    case 'cancel':{const record=exact(value,['sandboxId','invocationId','expectedLeaseGeneration'],'executor_cancel');return {sandboxId:identifier(record.sandboxId,'sandboxId',C),invocationId:identifier(record.invocationId,'invocationId',C),expectedLeaseGeneration:lease(record)};}
    case 'destroy':{const record=exact(value,['sandboxId','expectedLeaseGeneration','reason'],'executor_destroy');return {sandboxId:identifier(record.sandboxId,'sandboxId',C),expectedLeaseGeneration:lease(record),reason:str(record.reason,'reason',C,256)};}
    case 'inspect':{const record=exact(value,['sandboxId','tenantId','projectId'],'executor_inspect');const tenantId=identifier(record.tenantId,'tenantId',C);if(tenantId!==context.tenantId)throw new Error('SECURITY_FAILURE:executor_tenant_scope_refused');return {sandboxId:identifier(record.sandboxId,'sandboxId',C),tenantId,projectId:identifier(record.projectId,'projectId',C)};}
    case 'artifacts':{const record=exact(value,['sandboxId','invocationId','expectedLeaseGeneration'],'executor_artifacts');return {sandboxId:identifier(record.sandboxId,'sandboxId',C),invocationId:identifier(record.invocationId,'invocationId',C),expectedLeaseGeneration:lease(record)};}
    case 'quarantine':{const record=exact(value,['runtimeId','reason'],'executor_quarantine');return {runtimeId:identifier(record.runtimeId,'runtimeId',C),reason:str(record.reason,'reason',C,256)};}
    case 'discover':case 'reconcile':{exact(value,[],`executor_${operation}`);return undefined;}
  }
}
