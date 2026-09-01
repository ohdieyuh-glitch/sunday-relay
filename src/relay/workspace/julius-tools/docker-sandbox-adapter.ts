import {spawn} from 'node:child_process';
import {access,mkdir,realpath,stat,statfs} from 'node:fs/promises';
import {resolve,relative,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {JuliusCollectedArtifact,JuliusDurableSandbox,JuliusPhysicalSandbox,JuliusSandboxIdentity,JuliusSandboxInspection,JuliusSandboxLimits,JuliusSandboxPolicy,JuliusSandboxRecord,JuliusSandboxStore,SandboxExecutionPort,ToolInvocationRequest,ToolInvocationResult} from '../../mission/julius';
import {assertSandboxIdentity,assertSandboxLimits} from '../../mission/julius';
import {DockerExecutorReceiptStore} from './executor-receipt-store';
interface CommandResult{code:number|null;stdout:Buffer<ArrayBufferLike>;stderr:Buffer<ArrayBufferLike>;timedOut:boolean;}
const safeName=(id:string)=>`julius-${createHash('sha256').update(id).digest('hex').slice(0,24)}`;
const stable=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const stableManifest=(record:JuliusSandboxRecord,input:any,executorIdentity:string,imageDigest:string)=>stable({invocationId:record.invocationId,dispatchGeneration:input.dispatchGeneration,sandboxId:record.sandboxId,tenantId:record.tenantId,projectId:record.projectId,runId:record.runId,taskId:record.taskId,workerId:input.request.workerId,toolId:input.request.toolId,toolVersion:input.request.toolVersion,requestDigest:input.requestDigest,argumentsDigest:opaque(stable(input.request.arguments)),policyRevision:record.policyRevision,leaseGeneration:record.leaseGeneration,imageDigest,effectClassification:input.effectClassification,executorIdentity});
const opaque=(value:string)=>createHash('sha256').update(value).digest('hex');
/**
 * bash's `ulimit -f` counts 1024-byte blocks, not 512. Deriving the ceiling from 512 gave every sandbox twice
 * the output budget it declared — measured, a declared 32,768 produced 65,674 bytes. Rounded DOWN so the
 * granted budget is never larger than the declared one.
 */
export const outputBlocksFor=(outputBytes:number)=>Math.max(1,Math.floor(outputBytes/1024));
/** The uid every untrusted invocation runs as; see scripts/julius-docker-executor.sh. */
export const SANDBOX_UID=65532;
/** What one tmpfs inode costs in host memory, near enough to bound an inode count against a byte ceiling. */
export const MINIMUM_INODE_COST=1024;

/**
 * The declared ceiling must be one the kernel will actually hold. A workspace whose backing filesystem is
 * larger than the ceiling cannot enforce it — the number would be a claim about storage nothing bounds — so
 * the sandbox is refused rather than granted a limit that does not exist. Measured before this rule: a
 * 200,000-byte write into a declared 65,536-byte ceiling completed in full.
 */
export interface WorkspaceBacking {readonly blocks:number;readonly bsize:number;readonly files:number;}
export async function assertEnforceableWorkspaceCeiling(workspace:string,workspaceBytes:number,measure:(path:string)=>Promise<WorkspaceBacking>=statfs):Promise<void>{
  const backing=await measure(workspace).catch(()=>null);
  if(!backing)throw new Error('sandbox_workspace_invalid');
  const total=Number(backing.blocks)*Number(backing.bsize);
  // A store reporting zero total blocks (several FUSE and 9p backends) bounds nothing. `0 > ceiling` is
  // false, so accepting it would declare the ceiling enforced by a filesystem that enforces nothing.
  if(!(total>0)||!Number.isFinite(total)||total>workspaceBytes)throw new Error('sandbox_workspace_ceiling_unenforceable');
  /* Data blocks are not the only host resource a workspace spends. A memory-backed store derives its inode
     count from host RAM rather than from its size, so an unbounded inode count pins hundreds of megabytes of
     kernel memory that both `df` and `du` report as zero. Such a store reports its inode count, so where one
     is reported it must be bounded by the same ceiling; a store reporting none keeps its inodes inside the
     same bounded medium as its data, which the block ceiling already covers. */
  const inodes=Number(backing.files);
  if(inodes>0&&inodes*MINIMUM_INODE_COST>workspaceBytes)throw new Error('sandbox_workspace_inode_ceiling_unenforceable');
}

/**
 * Nothing the workload can rename may lie on the path to its own mount. Renaming a component between the
 * containment check and the mount is how a validated directory stops being the mounted one, so every
 * ancestor up to the governing root must be unwritable by the sandbox user. The workspace itself stays
 * writable — that is the point of it — but its name cannot be moved out from under the mount.
 */
export async function assertUnrenameableAncestry(workspace:string,root:string):Promise<void>{
  // Resolved, because `workspace` arrives resolved: comparing it to a root's spelling makes a root reached
  // through a symlink match nothing, and the walk then climbs past it to refuse on /tmp.
  const ceiling=await realpath(resolve(root)).catch(()=>null);
  if(!ceiling)throw new Error('sandbox_workspace_invalid');
  const target=resolve(workspace);
  // The root itself is a workspace, and it has no ancestry inside the root to check.
  if(target===ceiling)return;
  for(let directory=dirname(target);;directory=dirname(directory)){
    const entry=await stat(directory).catch(()=>null);
    if(!entry)throw new Error('sandbox_workspace_invalid');
    if((entry.mode&0o022)!==0||entry.uid===SANDBOX_UID)throw new Error('sandbox_workspace_parent_writable');
    if(directory===ceiling||directory===dirname(directory))break;
  }
}

/** The root itself is a workspace; anything reached by climbing out of it is not. */
export const workspaceContained=(root:string,candidate:string)=>{const rel=relative(root,candidate);return rel===''||(!rel.startsWith('/')&&!rel.split(/[\\/]/).includes('..'));};
/**
 * Permitted iff the root and the candidate both resolve and the resolved candidate lies inside the resolved
 * root. Comparing an unresolved spelling to a resolved path is not containment in either direction: a symlink
 * planted inside a workspace a tenant owns resolves elsewhere, and a root reached through one matches nothing.
 */
/**
 * Every declared root must admit the path, and all must resolve it to the SAME place. The agreement rule is
 * what closes the window between the two resolutions: measured, removing it let 2,690 of 4,000 raced relink
 * attempts mount another tenant. The resolver is injectable only so that rule can be tested without a race.
 */
export async function admitAcrossRoots(roots:readonly string[],sourceRef:string,resolveOne:(root:string,ref:string)=>Promise<string|null>=permittedWorkspace):Promise<string|null>{
  let agreed:string|null=null;
  for(const root of roots){
    const admitted=await resolveOne(root,sourceRef);
    if(!admitted||(agreed!==null&&admitted!==agreed))return null;
    agreed=admitted;
  }
  return agreed;
}

export async function permittedWorkspace(root:string,sourceRef:string):Promise<string|null>{
  if(!root)return null;
  /* Both sides are resolved and only the RESOLVED paths compared. A lexical pre-check against the root's
     spelling cannot work: when the root is itself reached through a symlink, nothing under it is lexically
     related to it and every request is refused. Answering outside-the-root and does-not-exist with the same
     null is what keeps `prepare` from becoming an existence oracle for the host. */
  const base=await realpath(resolve(root)).catch(()=>null);
  const real=await realpath(resolve(sourceRef)).catch(()=>null);
  return base&&real&&workspaceContained(base,real)?real:null;
}
const command=(binary:string,args:readonly string[],timeoutMs:number,cap:number):Promise<CommandResult>=>new Promise((done,reject)=>{let stdout:Buffer<ArrayBufferLike>=Buffer.alloc(0),stderr:Buffer<ArrayBufferLike>=Buffer.alloc(0),used=0,timedOut=false;const child=spawn(binary,[...args],{shell:false,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe'],detached:true});const add=(old:Buffer<ArrayBufferLike>,chunk:Buffer<ArrayBufferLike>)=>{const take=Math.min(chunk.length,Math.max(0,cap-used));used+=take;return take?Buffer.concat([old,chunk.subarray(0,take)]):old;};child.stdout.on('data',(x:Buffer<ArrayBufferLike>)=>stdout=add(stdout,x));child.stderr.on('data',(x:Buffer<ArrayBufferLike>)=>stderr=add(stderr,x));const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid!,'SIGKILL');}catch{}},timeoutMs);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);done({code,stdout,stderr,timedOut});});});
export interface DockerSandboxDurability {store:JuliusSandboxStore;receipts:DockerExecutorReceiptStore;runtimeInstanceId:string;executorVersion:string;attestReceipt?:(input:{phase:'BEFORE'|'AFTER';executionTokenHash:string;sandboxId:string})=>Promise<void>;settleRecovered?:(receipt:NonNullable<Awaited<ReturnType<DockerExecutorReceiptStore['consume']>>>)=>Promise<void>;}

/** Docker is a deployment adapter; durable DB ownership and executor-volume receipts are mandatory in production mode. */
export class DockerJuliusSandboxAdapter implements SandboxExecutionPort {
 private readonly cache=new Map<string,JuliusSandboxRecord>();private readonly active=new Map<string,string>();
 constructor(private readonly config:{dockerBinary?:string;image:string;enabled:boolean;durability?:DockerSandboxDurability;unsafeDevelopmentMode?:boolean;allowedWorkspaceRoot?:string;faultAfterExecutor?:boolean}){if(!config.image.includes('@sha256:')&&!/^sha256:[a-f0-9]{64}$/.test(config.image))throw new Error('sandbox_image_must_be_digest_pinned');if(config.enabled&&!config.durability&&!config.unsafeDevelopmentMode)throw new Error('sandbox_durability_required');}
 async createSandbox(input:{identity:JuliusSandboxIdentity;policy:JuliusSandboxPolicy;limits:JuliusSandboxLimits}):Promise<JuliusSandboxRecord>{if(!this.config.enabled)throw new Error('production_sandbox_disabled');assertSandboxIdentity(input.identity);assertSandboxLimits(input.limits);const record:JuliusSandboxRecord={...input.identity,state:'CREATING',workspaceRef:null,runtimeKind:'docker-rootless-boundary',limits:input.limits,policy:input.policy,safeFailure:null};if(this.config.durability){const created=await this.config.durability.store.save({...record,runtimeInstanceId:this.config.durability.runtimeInstanceId,containerId:null,imageDigest:this.config.image,lastHeartbeatAt:input.identity.createdAt});if(!created){const prior=await this.config.durability.store.load({sandboxId:record.sandboxId,tenantId:record.tenantId,projectId:record.projectId});if(!prior||prior.invocationId!==record.invocationId||prior.runId!==record.runId||prior.taskId!==record.taskId||prior.leaseGeneration!==record.leaseGeneration||prior.policyRevision!==record.policyRevision)throw new Error('sandbox_identity_conflict');return prior;}}this.cache.set(record.sandboxId,record);return record;}
 async prepareWorkspace(input:{sandboxId:string;sourceRef:string;expectedLeaseGeneration:number;permittedWorkspaceRoot?:string}):Promise<JuliusSandboxRecord>{const record=await this.owned(input.sandboxId,input.expectedLeaseGeneration);if(record.state!=='CREATING')throw new Error('sandbox_state_conflict');if(record.policy.network==='MEDIATED')throw new Error('sandbox_mediated_network_unavailable');const workspace=await this.resolveWorkspace(input.sourceRef,input.permittedWorkspaceRoot);
  /* A writable workspace must be bounded by its own backing store and unmovable beneath the mount. Both are
     checked here, against the object that was just validated, and the object's identity is captured so the
     args built below can be proven to describe the same one. */
  // Ancestry is walked to the FLEET root, not the tenant's: renaming the tenant directory itself would move
  // the whole path, so that directory's own writability has to be checked too.
  const governing=this.config.allowedWorkspaceRoot??input.permittedWorkspaceRoot;
  /* Two different questions. The ceiling is about writes, so it asks only of a workspace that can be
     written. Ancestry is about which object gets mounted, which matters just as much for a read-only
     mount — a swapped directory there is a cross-tenant READ — so it asks of every mounted workspace. */
  if(record.policy.readWorkspace){
   if(record.policy.mutateWorkspace)await assertEnforceableWorkspaceCeiling(workspace,record.limits.workspaceBytes);
   if(governing)await assertUnrenameableAncestry(workspace,governing);
  }
  const authorized=await stat(workspace).catch(()=>null);
  if(!authorized)throw new Error('sandbox_workspace_invalid');const workspaceArg=record.policy.readWorkspace?['--mount',`type=bind,src=${workspace},dst=/workspace${record.policy.mutateWorkspace?'':',readonly'}`]:['--tmpfs',`/workspace:rw,noexec,nosuid,nodev,size=${Math.min(record.limits.workspaceBytes,16_777_216)}`];const receiptArgs:string[]=[];if(this.config.durability){const sandboxReceipts=join(this.config.durability.receipts.root,opaque(record.sandboxId));await mkdir(sandboxReceipts,{recursive:true,mode:0o700});receiptArgs.push('--mount',`type=bind,src=${sandboxReceipts},dst=/julius-receipts-root`);}const args=['create','--name',safeName(record.sandboxId),'--init','--read-only','--cap-drop=ALL','--cap-add=DAC_OVERRIDE','--cap-add=SETUID','--cap-add=SETGID','--cap-add=KILL','--security-opt=no-new-privileges:true','--pids-limit',String(record.limits.pids),'--memory',String(record.limits.memoryBytes),'--cpus',String(record.limits.cpuCount),'--ulimit',`nofile=${record.limits.openFiles}:${record.limits.openFiles}`,'--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16777216',...workspaceArg,...receiptArgs,'--workdir','/workspace','--user','0:0','--network','none','--label',`julius.sandbox=${record.sandboxId}`,'--label',`julius.run=${opaque(record.runId)}`,'--label',`julius.task=${opaque(record.taskId)}`,'--label',`julius.invocation=${opaque(record.invocationId)}`,'--label',`julius.image=${opaque(this.config.image)}`,this.config.image,'sleep','infinity'];const atUse=await stat(workspace).catch(()=>null);
  // Between authorization and use nothing may have replaced the object. The ancestry rule makes this
  // unreachable for a workload; the check is what makes that a property of the code rather than of the mode bits.
  if(!atUse||atUse.dev!==authorized.dev||atUse.ino!==authorized.ino)throw new Error('sandbox_workspace_changed_before_use');
  const created=await command(this.binary(),args,30_000,32_000);if(created.code!==0)throw new Error('sandbox_create_failed');const containerId=created.stdout.toString().trim()||safeName(record.sandboxId);if((await command(this.binary(),['start',containerId],30_000,8_000)).code!==0)throw new Error('sandbox_start_failed');if(this.config.durability&&!await this.config.durability.store.bindPhysical({sandboxId:record.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:record.leaseGeneration,containerId,workspaceRef:workspace}))throw new Error('sandbox_durable_bind_failed');const ready={...record,state:'READY' as const,workspaceRef:record.policy.readWorkspace?workspace:null};this.cache.set(record.sandboxId,ready);return ready;}
 async executeTool(input:{sandboxId:string;expectedLeaseGeneration:number;dispatchGeneration:number;requestDigest:string;executionTokenHash:string;effectClassification:any;request:ToolInvocationRequest}):Promise<ToolInvocationResult>{let record=await this.owned(input.sandboxId,input.expectedLeaseGeneration);if(record.state!=='READY')throw new Error('sandbox_not_ready');if(!record.policy.executeProcess)throw new Error('sandbox_process_denied');if(!record.policy.allowedTools.includes(input.request.toolId))throw new Error('sandbox_tool_denied');if(input.request.invocationId!==record.invocationId)throw new Error('sandbox_invocation_scope');const commandText=input.request.arguments.command;if(typeof commandText!=='string')throw new Error('tool_argument_command_required');const cwd=input.request.cwd??'.';if(cwd.startsWith('/')||cwd.split('/').includes('..'))throw new Error('sandbox_cwd_refused');if(this.config.durability){record=await this.config.durability.store.authorizeExecution({sandboxId:record.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,invocationId:record.invocationId,leaseGeneration:record.leaseGeneration,dispatchGeneration:input.dispatchGeneration,requestDigest:input.requestDigest,executionTokenHash:input.executionTokenHash});await this.config.durability.receipts.prepare(input.executionTokenHash,{invocationId:record.invocationId,dispatchGeneration:input.dispatchGeneration,sandboxId:record.sandboxId,tenantId:record.tenantId,projectId:record.projectId,runId:record.runId,taskId:record.taskId,workerId:input.request.workerId,toolId:input.request.toolId,toolVersion:input.request.toolVersion,requestDigest:input.requestDigest,argumentsDigest:opaque(stable(input.request.arguments)),policyRevision:record.policyRevision,leaseGeneration:record.leaseGeneration,imageDigest:this.config.image,effectClassification:input.effectClassification,executorIdentity:this.config.durability.executorVersion});}
  this.active.set(record.sandboxId,input.request.invocationId);const started=Date.now(),container=(record as JuliusDurableSandbox).containerId??safeName(record.sandboxId),execArgs=['exec','--workdir',`/workspace/${cwd}`,'--user','0:0'];if(this.config.durability)execArgs.push('--env',`JULIUS_EXECUTION_TOKEN=${input.executionTokenHash}`,'--env',`JULIUS_OUTPUT_BLOCKS=${outputBlocksFor(record.limits.outputBytes)}`,'--env',`JULIUS_MANIFEST_DIGEST=${opaque(stableManifest(record,input,this.config.durability.executorVersion,this.config.image))}`,'--env',`JULIUS_INVOCATION_ID=${record.invocationId}`,'--env',`JULIUS_DISPATCH_GENERATION=${input.dispatchGeneration}`,'--env',`JULIUS_SANDBOX_ID=${record.sandboxId}`,'--env',`JULIUS_TENANT_DIGEST=${opaque(record.tenantId)}`,'--env',`JULIUS_PROJECT_DIGEST=${opaque(record.projectId)}`,'--env',`JULIUS_RUN_DIGEST=${opaque(record.runId)}`,'--env',`JULIUS_TASK_DIGEST=${opaque(record.taskId)}`,'--env',`JULIUS_WORKER_DIGEST=${opaque(input.request.workerId)}`,'--env',`JULIUS_TOOL_ID=${input.request.toolId}`,'--env',`JULIUS_TOOL_VERSION=${input.request.toolVersion}`,'--env',`JULIUS_REQUEST_DIGEST=${input.requestDigest}`,'--env',`JULIUS_POLICY_DIGEST=${opaque(record.policyRevision)}`,'--env',`JULIUS_LEASE_GENERATION=${record.leaseGeneration}`,'--env',`JULIUS_IMAGE_DIGEST=${opaque(this.config.image)}`,'--env',`JULIUS_EXECUTOR_IDENTITY=${this.config.durability.executorVersion}`);if(this.config.durability?.attestReceipt)execArgs.push('--env','JULIUS_ATTESTATION_REQUIRED=1');execArgs.push(container,...(this.config.durability?['/usr/local/bin/julius-executor',commandText]:['/bin/bash','--noprofile','--norc','-lc',commandText]));let authorityLost=false;let pulseFailure:unknown;const pulses=new Set<Promise<void>>(),stopHostile=async()=>{authorityLost=true;await command(this.binary(),['kill','--signal','KILL',container],10_000,8_000);const inspected=await command(this.binary(),['inspect','--format','{{.State.Running}}',container],10_000,8_000);if(inspected.code===0&&inspected.stdout.toString().trim()!=='false')throw new Error('sandbox_hostile_process_survived');};const heartbeat=this.config.durability?setInterval(()=>{let pulse!:Promise<void>;pulse=(async()=>{try{if(!await this.config.durability!.store.heartbeat({sandboxId:record.sandboxId,runtimeInstanceId:this.config.durability!.runtimeInstanceId,leaseGeneration:record.leaseGeneration,expiresAt:record.expiresAt,state:'RUNNING'}))await stopHostile();}catch{await stopHostile();}})().catch(failure=>{if(!(pulseFailure instanceof Error&&pulseFailure.message==='sandbox_hostile_process_survived'))pulseFailure=failure;}).finally(()=>pulses.delete(pulse));pulses.add(pulse);},Math.min(5000,Math.max(250,Math.floor(record.limits.wallClockMs/3)))):null;const effectiveTimeoutMs=Math.min(input.request.timeoutMs??record.limits.wallClockMs,record.limits.wallClockMs);const rawPromise=command(this.binary(),execArgs,effectiveTimeoutMs,record.limits.outputBytes);let raw!:CommandResult;
  /* Every exit from the receipt phase clears the heartbeat and reaps the workload. Throwing out of the middle
     used to leak a live interval hammering the database for an execution nobody was running, and to leave the
     command running inside the container after the executor had already reported failure. */
  try{
  if(this.config.durability?.attestReceipt){const directory=this.config.durability.receipts.directory(input.executionTokenHash,record.sandboxId);
  /* BEFORE lands as the workload container starts. AFTER cannot land before the command itself finishes,
     so waiting a fixed constant for it capped every durable execution at that constant. It is bounded by the
     execution's own ceiling instead, and abandoned early once the command has exited without sealing. */
  /* A timed-out command leaves its daemonised descendants alive inside the container: the in-sandbox
     reaper only runs when the command exits on its own. The tree is killed the moment the timeout is
     observed, not after the receipt grace, or a descendant can still land an effect in between. */
  let exited=false;void rawPromise.then(result=>{exited=true;if(result.timedOut)void stopHostile().catch(()=>undefined);},()=>{exited=true;});
  const waitFor=async(receipt:string,hardDeadline:number,graceAfterExitMs:number)=>{
   let exitedAt=0;
   for(;;){
    if(await access(receipt).then(()=>true,()=>false))return true;
    if(exited&&!exitedAt)exitedAt=Date.now();
    if(Date.now()>hardDeadline||(exitedAt&&Date.now()-exitedAt>graceAfterExitMs))return false;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
  };
  for(const phase of ['BEFORE','AFTER'] as const){
   const receipt=join(directory,`${phase.toLowerCase()}.receipt`);
   const present=await waitFor(receipt,Date.now()+(phase==='BEFORE'?15_000:effectiveTimeoutMs+15_000),5_000);
   if(!present)throw new Error(`executor_${phase.toLowerCase()}_receipt_timeout`);
   await this.config.durability.attestReceipt({phase,executionTokenHash:input.executionTokenHash,sandboxId:record.sandboxId});
  }}
  raw=await rawPromise;
  }catch(error){let survived:unknown;await stopHostile().catch(failure=>{survived=failure;});await rawPromise.catch(()=>undefined);
   // A container still running after its kill outranks whatever prompted the kill: reporting the lesser fact
   // would let a caller believe nothing is executing while the workload is still inside the sandbox.
   throw survived instanceof Error&&survived.message==='sandbox_hostile_process_survived'?survived:error;}
  finally{if(heartbeat)clearInterval(heartbeat);}
  if(raw.timedOut)await stopHostile();await Promise.all(pulses);
  // A container still executing after its kill outranks a lost lease: reporting the lesser fact would let a
  // caller believe nothing is running while the workload is still inside the sandbox.
  if(pulseFailure instanceof Error&&pulseFailure.message==='sandbox_hostile_process_survived')throw pulseFailure;
  if(authorityLost&&!raw.timedOut)throw new Error('sandbox_execution_authority_lost');if(this.config.durability&&!raw.timedOut){try{if(!await this.config.durability.store.heartbeat({sandboxId:record.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:record.leaseGeneration,expiresAt:record.expiresAt,state:'READY'})){await stopHostile();throw new Error('sandbox_execution_authority_lost');}}catch(error){await stopHostile();throw error;}}this.active.delete(record.sandboxId);if(this.config.durability){if(this.config.faultAfterExecutor){const diagnostic=raw.stderr.toString().slice(0,500).replace(/[^A-Za-z0-9_ .:/-]/g,'?');throw new Error(`injected_after_executor_effect:${raw.code??'signal'}:${raw.timedOut?'timeout':'terminal'}:${diagnostic}`);}const consumed=await this.config.durability.receipts.consume(input.executionTokenHash,record.sandboxId);if(!consumed){await stopHostile();throw new Error('executor_receipt_missing');}await this.config.durability.store.recordReceipt({...consumed.receipt,projectId:record.projectId});if(consumed.receipt.result)return consumed.receipt.result;await stopHostile();throw new Error('sandbox_unknown_effect');}const status=raw.timedOut?'TIMED_OUT':raw.code===0?'SUCCEEDED':'FAILED';return{invocationId:input.request.invocationId,status,exitCode:raw.code,safeSummary:status==='SUCCEEDED'?'Sandbox command completed.':status==='TIMED_OUT'?'Sandbox command timed out.':'Sandbox command failed.',stdout:raw.stdout.toString(),stderr:raw.stderr.toString(),stdoutRef:null,stderrRef:null,artifacts:[],evidence:[],durationMs:Date.now()-started,resourceUsage:{toolCalls:1,runtimeMs:Date.now()-started,outputBytes:raw.stdout.length+raw.stderr.length},policyDecisionRef:record.policyRevision,mutations:[]};}
 async cancelExecution(input:{sandboxId:string;invocationId:string;expectedLeaseGeneration:number}):Promise<boolean>{const record=await this.owned(input.sandboxId,input.expectedLeaseGeneration);if(this.active.get(input.sandboxId)!==input.invocationId)return false;this.active.delete(input.sandboxId);return this.destroySandbox({sandboxId:record.sandboxId,expectedLeaseGeneration:record.leaseGeneration,reason:'cancelled'});}
 async destroySandbox(input:{sandboxId:string;expectedLeaseGeneration:number;reason:string}):Promise<boolean>{const record=await this.owned(input.sandboxId,input.expectedLeaseGeneration),id=(record as JuliusDurableSandbox).containerId??safeName(record.sandboxId);if(this.config.durability&&!await this.config.durability.store.beginDestroy({sandboxId:record.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:record.leaseGeneration}))return false;const removed=await command(this.binary(),['rm','-f','--volumes',id],30_000,8_000);if(removed.code!==0&&(await command(this.binary(),['inspect',id],10_000,8_000)).code===0)throw new Error('sandbox_destroy_failed');if(this.config.durability&&!await this.config.durability.store.finishDestroy({sandboxId:record.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:record.leaseGeneration}))throw new Error('sandbox_destroy_settlement_failed');this.cache.set(record.sandboxId,{...record,state:'DESTROYED'});return true;}
 async inspectSandbox(input:{sandboxId:string;tenantId:string;projectId:string}):Promise<JuliusSandboxInspection|null>{const record=this.config.durability?await this.config.durability.store.load(input):this.cache.get(input.sandboxId);if(!record)return null;return{record,alive:['READY','RUNNING'].includes(record.state),processCount:null,workspaceBytes:null};}
 async collectArtifacts(_input:{sandboxId:string;invocationId:string;expectedLeaseGeneration:number}):Promise<readonly JuliusCollectedArtifact[]>{return[];}
 async discoverSandboxes():Promise<readonly JuliusPhysicalSandbox[]>{const result=await command(this.binary(),['ps','-a','--no-trunc','--filter','label=julius.sandbox','--format','{{json .}}'],30_000,1_000_000);if(result.code!==0)throw new Error('sandbox_discovery_failed');return result.stdout.toString().split('\n').filter(Boolean).map(line=>{const row=JSON.parse(line) as {ID:string;State:string;Labels:string};const labels=Object.fromEntries((row.Labels??'').split(',').map(x=>x.split('=',2)).filter(x=>x.length===2)) as Record<string,string>;return{sandboxId:labels['julius.sandbox']??'',runtimeId:row.ID,state:row.State,labels};}).filter(x=>x.sandboxId);}
 async quarantineSandbox(input:{runtimeId:string;reason:string}):Promise<boolean>{if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.runtimeId))throw new Error('sandbox_runtime_id_invalid');const removed=await command(this.binary(),['rm','-f','--volumes',input.runtimeId],30_000,8_000);return removed.code===0||(await command(this.binary(),['inspect',input.runtimeId],10_000,8_000)).code!==0;}
 async reconcileSandboxes(){if(!this.config.durability)throw new Error('sandbox_durability_required');let recovered=0,lost=0,quarantined=0,destroyed=0;const physical=await this.discoverSandboxes(),byId=new Map(physical.map(x=>[x.sandboxId,x]));const claims=await this.config.durability.store.listRecoverable({runtimeInstanceId:this.config.durability.runtimeInstanceId,now:new Date().toISOString(),limit:100});for(const claim of claims){const db=claim.record as JuliusDurableSandbox,p=byId.get(db.sandboxId);byId.delete(db.sandboxId);if(!p){if(db.executionTokenHash){const receipt=await this.config.durability.receipts.consume(db.executionTokenHash,db.sandboxId);if(receipt){await this.config.durability.store.recordReceipt({...receipt.receipt,projectId:db.projectId});if(receipt.receipt.result&&this.config.durability.settleRecovered)await this.config.durability.settleRecovered(receipt);}}await this.config.durability.store.markLost({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,recoveryGeneration:claim.recoveryGeneration});lost++;continue;}const inspected=await command(this.binary(),['inspect','--format','{{.Image}} {{.State.Status}}',p.runtimeId],10_000,8_000);if(inspected.code!==0){if(db.executionTokenHash){const receipt=await this.config.durability.receipts.consume(db.executionTokenHash,db.sandboxId);if(receipt){await this.config.durability.store.recordReceipt({...receipt.receipt,projectId:db.projectId});if(receipt.receipt.result&&this.config.durability.settleRecovered)await this.config.durability.settleRecovered(receipt);}}await this.config.durability.store.markLost({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,recoveryGeneration:claim.recoveryGeneration});lost++;continue;}const [physicalImage,physicalState]=inspected.stdout.toString().trim().split(/\s+/,2);if(physicalImage!==db.imageDigest){if(!await this.quarantineSandbox({runtimeId:p.runtimeId,reason:'image-mismatch'}))throw new Error('sandbox_quarantine_failed');await this.config.durability.store.markLost({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,recoveryGeneration:claim.recoveryGeneration});quarantined++;lost++;continue;}if(p.labels['julius.run']!==opaque(db.runId)||p.labels['julius.task']!==opaque(db.taskId)||p.labels['julius.invocation']!==opaque(db.invocationId)||p.labels['julius.image']!==opaque(db.imageDigest)){if(!await this.quarantineSandbox({runtimeId:p.runtimeId,reason:'label-mismatch'}))throw new Error('sandbox_quarantine_failed');await this.config.durability.store.markLost({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,recoveryGeneration:claim.recoveryGeneration});quarantined++;lost++;continue;}if(db.containerId===null&&db.state==='CREATING'){if(physicalState!=='running')throw new Error('sandbox_adoption_not_running');if(!await this.config.durability.store.adoptPhysical({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:db.leaseGeneration,recoveryGeneration:claim.recoveryGeneration,containerId:p.runtimeId}))throw new Error('sandbox_adoption_failed');recovered++;continue;}if(p.runtimeId!==db.containerId){if(!await this.quarantineSandbox({runtimeId:p.runtimeId,reason:'identity-mismatch'}))throw new Error('sandbox_quarantine_failed');await this.config.durability.store.markLost({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,recoveryGeneration:claim.recoveryGeneration});quarantined++;lost++;continue;}if(db.state==='DESTROYING'){if(!await this.quarantineSandbox({runtimeId:p.runtimeId,reason:'finish-destroy'}))throw new Error('sandbox_quarantine_failed');await this.config.durability.store.transition({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:db.leaseGeneration,recoveryGeneration:claim.recoveryGeneration,from:['DESTROYING'],to:'DESTROYING',now:new Date().toISOString()});await this.config.durability.store.finishDestroy({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:db.leaseGeneration});destroyed++;continue;}if(db.executionTokenHash){const receipt=await this.config.durability.receipts.consume(db.executionTokenHash,db.sandboxId);if(receipt){await this.config.durability.store.recordReceipt({...receipt.receipt,projectId:db.projectId});if(receipt.receipt.result&&this.config.durability.settleRecovered)await this.config.durability.settleRecovered(receipt);}}await this.config.durability.store.transition({sandboxId:db.sandboxId,runtimeInstanceId:this.config.durability.runtimeInstanceId,leaseGeneration:db.leaseGeneration,recoveryGeneration:claim.recoveryGeneration,from:[db.state],to:physicalState==='running'?'READY':'LOST',now:new Date().toISOString()});recovered++;}for(const orphan of byId.values()){const db=await this.config.durability.store.loadOwned(orphan.sandboxId);if(!db||db.state==='DESTROYED'){if(!await this.quarantineSandbox({runtimeId:orphan.runtimeId,reason:db?'destroyed-leftover':'orphan'}))throw new Error('sandbox_quarantine_failed');quarantined++;}}return{recovered,lost,quarantined,destroyed};}
 /** Contained, existing, and free of the delimiters the mount specification is parsed on. One code for every failure. */
 private async resolveWorkspace(sourceRef:string,permittedRoot?:string):Promise<string>{
  const invalid=()=>new Error('sandbox_workspace_invalid');
  const requested=resolve(sourceRef);
  /* Checking only the fleet root makes an upstream tenant check advisory: the path is resolved twice, at two
     moments, and a workspace relinked in between still lands inside the fleet — which is where the other
     tenants are. So EVERY declared root must admit it, and all must agree on where it resolves. Taking one
     root and testing the other for truthiness let a tenant root widen the fleet's, and an empty string —
     supplied and falsy at once — slipped past both. The cheapest way past a guard must never be a vaguer root. */
  const roots=[permittedRoot,this.config.allowedWorkspaceRoot].filter((candidate):candidate is string=>candidate!==undefined);
  const workspace=roots.length===0?await realpath(requested).catch(()=>{throw invalid();}):await admitAcrossRoots(roots,requested);
  // The mount specification is comma and equals delimited, so a path carrying either could splice a field.
  if(workspace===null||/[,=]/.test(workspace))throw invalid();
  return workspace;
 }
 private async owned(id:string,generation:number):Promise<JuliusSandboxRecord>{let record:JuliusSandboxRecord|undefined|null=this.cache.get(id);if(this.config.durability)record=await this.config.durability.store.loadOwned(id);if(!record)throw new Error('sandbox_not_found');if(record.leaseGeneration!==generation)throw new Error('sandbox_stale_lease');if(Date.parse(record.expiresAt)<=Date.now())throw new Error('sandbox_expired');return record;}
 private binary(){return this.config.dockerBinary??'/usr/bin/docker';}
}
