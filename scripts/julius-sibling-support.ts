/** Shared Julius-side setup for the real sibling-infrastructure harnesses. Julius holds no Docker, key or receipt authority here. */
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';
import type { ExecutorOperation } from '../src/relay/workspace/julius-tools/executor-operation-request';
import { canonicalRequestDigest } from '../src/relay/workspace/julius-tools/execution-envelope';

export const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`sibling_config_missing:${name}`);return value;};
export const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export const stable=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
export const digestOf=(value:unknown)=>sha(stable(value));

export const TENANT=process.env.JULIUS_TENANT_ID??'tenant',PROJECT='project',RUN='run',TASK='task',WORKER='worker',LEASE=3,POLICY='card';
/** The evaluation suite gets its own run and task so completing the lifecycle task cannot strand it. */
export const EVAL_RUN='run-evals',EVAL_TASK='task-evals',COMPLETION_RUN='run-completion',COMPLETION_TASK='task-completion';
export interface SandboxLimits {readonly cpuCount:number;readonly memoryBytes:number;readonly pids:number;readonly openFiles:number;readonly workspaceBytes:number;readonly outputBytes:number;readonly wallClockMs:number;readonly concurrentProcesses:number;}
export const LIMITS:SandboxLimits={cpuCount:1,memoryBytes:134_217_728,pids:32,openFiles:128,workspaceBytes:4_194_304,outputBytes:32_768,wallClockMs:15_000,concurrentProcesses:4};
export const FULL_POLICY={readWorkspace:true,mutateWorkspace:true,executeProcess:true,network:'DENY' as const,allowedTools:['shell.bash']};
export const endpoint=()=>new URL(process.env.JULIUS_EXECUTOR_ENDPOINT??'http://127.0.0.1:8787');
export const scopedCredentials=(name='JULIUS_SCOPED_CREDENTIALS')=>new Map(Object.entries(JSON.parse(required(name)) as Record<string,string>)) as ReadonlyMap<ExecutorOperation,string>;

export async function openJuliusClient():Promise<{pool:Pool;tools:JuliusToolPostgresRepository;client:RemoteExecutorControlPlane;scoped:ReadonlyMap<ExecutorOperation,string>;trustedReceiptKeys:ReadonlyMap<string,import('node:crypto').KeyObject>;workspace:string}>{
  const pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{});
  const scoped=scopedCredentials();
  const trustedReceiptKeys=new Map([[required('EXECUTOR_KEY_ID'),createPublicKey(await readFile(required('JULIUS_PUBLIC_KEY_PATH'),'utf8'))]]);
  const client=new RemoteExecutorControlPlane({endpoint:endpoint(),serviceCredential:scoped.get('execute')!,scopedCredentials:scoped,callerId:required('JULIUS_CALLER_ID'),tenantId:TENANT,requestTimeoutMs:Number(process.env.JULIUS_REQUEST_TIMEOUT_MS??'60000'),trustedReceiptKeys,allowInsecureLoopbackForTests:true});
  return {pool,tools:new JuliusToolPostgresRepository(pool),client,scoped,trustedReceiptKeys,workspace:required('JULIUS_WORKSPACE')};
}

/** The migration set is a one-shot replay, so each phase migrates only when the last migration has not landed. */
async function migrateOnce(pool:Pool):Promise<void>{
  const applied=await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='relay_wonderland' AND table_name='julius_sandboxes' AND column_name='sandbox_policy'`);
  if(applied.rowCount===0)await new TransactionalWonderlandDatabase(pool).migrate();
}

export async function seedBase(pool:Pool,scope:{runId:string;taskId:string}={runId:RUN,taskId:TASK}):Promise<void>{
  await migrateOnce(pool);
  await pool.query(`INSERT INTO relay_wonderland.players(player_id)VALUES($1) ON CONFLICT DO NOTHING`,[TENANT]);
  await pool.query(`INSERT INTO relay_wonderland.projects(project_id)VALUES($1) ON CONFLICT DO NOTHING`,[PROJECT]);
  await pool.query(`INSERT INTO relay_wonderland.project_members(project_id,player_id,role)VALUES($1,$2,'OWNER') ON CONFLICT DO NOTHING`,[PROJECT,TENANT]);
  await pool.query(`INSERT INTO relay_wonderland.agents(agent_id,owner_id)VALUES('agent',$1) ON CONFLICT DO NOTHING`,[TENANT]);
  await pool.query(`INSERT INTO relay_wonderland.card_versions(card_version_id,agent_id,owner_id,version,snapshot)VALUES('card-v','agent',$1,1,'{}') ON CONFLICT DO NOTHING`,[TENANT]);
  await pool.query(`INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot)VALUES('mission',$1,'READY','hash','{}') ON CONFLICT DO NOTHING`,[PROJECT]);
  await pool.query(`INSERT INTO relay_wonderland.execution_sessions(execution_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint)VALUES('execution','mission',$1,$2,'agent','card-v','RUNNING','sandbox','{}','{}') ON CONFLICT DO NOTHING`,[PROJECT,TENANT]);
  await pool.query(`INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)VALUES($1,'mission',$2,'EXECUTING','1',$3,1,0) ON CONFLICT DO NOTHING`,[scope.runId,PROJECT,POLICY]);
  await pool.query(`INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal,worker_id,lease_owner,lease_generation,lease_expires_at)VALUES($1,$2,'CODING_AGENT','code','ACTIVE',1,$3,'scheduler',$4,now()+interval '60 minutes') ON CONFLICT DO NOTHING`,[scope.taskId,scope.runId,WORKER,LEASE]);
  // The task lease must outlive the whole harness, including an executor restart between phases.
  await pool.query(`UPDATE relay_wonderland.julius_tasks SET lease_expires_at=now()+interval '60 minutes' WHERE task_id=$1 AND state='ACTIVE'`,[scope.taskId]);
}

export interface SeededInvocation {
  readonly invocationId:string;readonly requestDigest:string;readonly dispatchGeneration:number;
  readonly identity:{sandboxId:string;invocationId:string;tenantId:string;projectId:string;runId:string;taskId:string;leaseGeneration:number;policyRevision:string;createdAt:string;expiresAt:string};
  readonly request:{invocationId:string;runId:string;taskId:string;projectId:string;workerId:string;toolId:'shell.bash';toolVersion:string;arguments:{command:string};cwd:string;idempotencyKey:string;timeoutMs:number;expectedMutation:'WORKSPACE'};
  readonly execution:{sandboxId:string;expectedLeaseGeneration:number;dispatchGeneration:number;requestDigest:string;executionTokenHash:string;effectClassification:'NON_IDEMPOTENT_MUTATION';request:SeededInvocation['request']};
}

/** Julius authorizes and dispatches. The executor is never asked to make either decision. */
export async function seedInvocation(pool:Pool,tools:JuliusToolPostgresRepository,input:{invocationId:string;command:string;timeoutMs?:number;claim?:boolean;runId?:string;taskId?:string}):Promise<SeededInvocation>{
  const {invocationId,command}=input,timeoutMs=input.timeoutMs??10_000,reservationId=`budget-${invocationId}`,runId=input.runId??RUN,taskId=input.taskId??TASK;
  const request={invocationId,runId,taskId,projectId:PROJECT,workerId:WORKER,toolId:'shell.bash' as const,toolVersion:'1',arguments:{command},cwd:'.',idempotencyKey:invocationId,timeoutMs,expectedMutation:'WORKSPACE' as const};
  // The executor recomputes this from the request it receives, so Julius must record the same canonical digest.
  const requestDigest=canonicalRequestDigest(request);
  await pool.query(`INSERT INTO relay_wonderland.budget_reservations(reservation_id,execution_id,worker_id,operation_key,idempotency_key,state,tool_calls,runtime_ms,expires_at)VALUES($1,'execution',$2,'tool',$3,'RESERVED',1,600000,now()+interval '60 minutes') ON CONFLICT DO NOTHING`,[reservationId,WORKER,invocationId]);
  await tools.request({invocationId,idempotencyKey:invocationId,requestDigest,tenantId:TENANT,projectId:PROJECT,runId,taskId,workerId:WORKER,leaseGeneration:LEASE,policyRevision:POLICY,toolId:'shell.bash',toolVersion:'1',mutationClass:'WORKSPACE',requestedAt:new Date().toISOString()});
  await tools.authorize({invocationId,tenantId:TENANT,projectId:PROJECT,requestDigest,policyRevision:POLICY,budgetReservationId:reservationId,authorizedAt:new Date().toISOString()});
  let dispatchGeneration=1;
  if(input.claim!==false){
    const claimed=await tools.claimDispatch({claimedBy:'julius-sibling',now:new Date().toISOString(),claimedUntil:new Date(Date.now()+1_800_000).toISOString(),limit:64});
    const dispatch=claimed.find(entry=>entry.invocation.invocationId===invocationId);
    if(!dispatch)throw new Error(`sibling_dispatch_not_claimed:${invocationId}`);
    if(dispatch.dispatchGeneration!==1)throw new Error(`sibling_dispatch_generation_unexpected:${dispatch.dispatchGeneration}`);
    dispatchGeneration=dispatch.dispatchGeneration;
  }
  const identity={sandboxId:invocationId,invocationId,tenantId:TENANT,projectId:PROJECT,runId,taskId,leaseGeneration:LEASE,policyRevision:POLICY,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3_600_000).toISOString()};
  return {invocationId,requestDigest,dispatchGeneration,identity,request,execution:{sandboxId:invocationId,expectedLeaseGeneration:LEASE,dispatchGeneration,requestDigest,executionTokenHash:sha(`token:${invocationId}`),effectClassification:'NON_IDEMPOTENT_MUTATION' as const,request}};
}

/** The exact wire envelope Julius's transport would build, for cases that must be posted by hand. */
export function envelopeFor(seed:SeededInvocation,overrides:Record<string,unknown>={}):Record<string,unknown>{
  const issuedAt=new Date();
  return {schemaVersion:1,callerId:required('JULIUS_CALLER_ID'),callerScope:'sandbox:execute',tenantId:TENANT,projectId:PROJECT,runId:seed.request.runId,taskId:seed.request.taskId,invocationId:seed.invocationId,dispatchGeneration:seed.dispatchGeneration,sandboxId:seed.identity.sandboxId,requestDigest:seed.requestDigest,executionIdentity:`${seed.invocationId}:${seed.dispatchGeneration}:${seed.identity.sandboxId}`,nonce:randomUUID(),issuedAt:issuedAt.toISOString(),expiresAt:new Date(issuedAt.getTime()+240_000).toISOString(),payload:{expectedLeaseGeneration:seed.execution.expectedLeaseGeneration,executionTokenHash:seed.execution.executionTokenHash,effectClassification:'NON_IDEMPOTENT_MUTATION',request:seed.request},...overrides};
}

/**
 * The same execution identity carrying a genuinely different request, with the canonical digest that
 * request actually has. A merely wrong digest is refused at the shape gate, so it can no longer reach
 * the ledger; reaching the ledger's identity conflict now requires a real second request.
 */
export function divergentEnvelope(seed:SeededInvocation):Record<string,unknown>{
  const request={...seed.request,arguments:{command:'printf divergent'}};
  return envelopeFor(seed,{requestDigest:canonicalRequestDigest(request),payload:{expectedLeaseGeneration:seed.execution.expectedLeaseGeneration,executionTokenHash:seed.execution.executionTokenHash,effectClassification:'NON_IDEMPOTENT_MUTATION',request}});
}
