import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';

const run=promisify(execFile),required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`sibling_config_missing:${name}`);return value;};
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denyRead=async(path:string)=>{try{await readFile(path);throw new Error(`isolation_read_succeeded:${path}`);}catch(error){if(error instanceof Error&&error.message.startsWith('isolation_'))throw error;}};
const denyWrite=async(path:string)=>{try{await writeFile(path,'forbidden');throw new Error(`isolation_write_succeeded:${path}`);}catch(error){if(error instanceof Error&&error.message.startsWith('isolation_'))throw error;}};

async function main():Promise<void>{
  await denyRead('/var/run/docker.sock');
  await denyRead(required('PROBE_EXECUTOR_PRIVATE_KEY'));
  await denyWrite(required('PROBE_EXECUTOR_RECEIPT_ROOT'));
  if(process.env.EXECUTOR_SIGNING_KEY_PATH||process.env.EXECUTOR_RECEIPT_ROOT||process.env.EXECUTOR_SECRET_ENV)throw new Error('isolation_executor_environment_visible');
  await run('docker',['ps']).then(()=>{throw new Error('isolation_direct_docker_succeeded');},()=>undefined);
  await access(required('JULIUS_PUBLIC_KEY_PATH'),constants.R_OK);

  const pool=new Pool({connectionString:required('DATABASE_URL')});
  await new TransactionalWonderlandDatabase(pool).migrate();
  await pool.query(`INSERT INTO relay_wonderland.players(player_id)VALUES('tenant');INSERT INTO relay_wonderland.projects(project_id)VALUES('project');INSERT INTO relay_wonderland.project_members(project_id,player_id,role)VALUES('project','tenant','OWNER');INSERT INTO relay_wonderland.agents(agent_id,owner_id)VALUES('agent','tenant');INSERT INTO relay_wonderland.card_versions(card_version_id,agent_id,owner_id,version,snapshot)VALUES('card-v','agent','tenant',1,'{}');INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot)VALUES('mission','project','READY','hash','{}');INSERT INTO relay_wonderland.execution_sessions(execution_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint)VALUES('execution','mission','project','tenant','agent','card-v','RUNNING','sandbox','{}','{}');INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)VALUES('run','mission','project','EXECUTING','1','card',1,0);INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal,worker_id,lease_owner,lease_generation,lease_expires_at)VALUES('task','run','CODING_AGENT','code','ACTIVE',1,'worker','scheduler',3,now()+interval '10 minutes');INSERT INTO relay_wonderland.budget_reservations(reservation_id,execution_id,worker_id,operation_key,idempotency_key,state,tool_calls,runtime_ms,expires_at)VALUES('budget','execution','worker','tool','tool-inv','RESERVED',1,10000,now()+interval '10 minutes')`);
  const publicKey=createPublicKey(await readFile(required('JULIUS_PUBLIC_KEY_PATH'),'utf8'));
  const toolRepository=new JuliusToolPostgresRepository(pool),requestDigest='a'.repeat(64),requestedAt=new Date().toISOString();
  await toolRepository.request({invocationId:'sibling-inv',idempotencyKey:'sibling-effect',requestDigest,tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',workerId:'worker',leaseGeneration:3,policyRevision:'card',toolId:'shell.bash',toolVersion:'1',mutationClass:'WORKSPACE',requestedAt});
  await toolRepository.authorize({invocationId:'sibling-inv',tenantId:'tenant',projectId:'project',requestDigest,policyRevision:'card',budgetReservationId:'budget',authorizedAt:new Date().toISOString()});
  const dispatches=await toolRepository.claimDispatch({claimedBy:'julius-sibling',now:new Date().toISOString(),claimedUntil:new Date(Date.now()+120_000).toISOString(),limit:1});
  if(dispatches.length!==1||dispatches[0].invocation.invocationId!=='sibling-inv'||dispatches[0].dispatchGeneration!==1)throw new Error('sibling_dispatch_not_claimed');
  const client=new RemoteExecutorControlPlane({endpoint:new URL('http://127.0.0.1:8787'),serviceCredential:required('JULIUS_EXECUTOR_CREDENTIAL'),callerId:'julius-prod',tenantId:'tenant',requestTimeoutMs:30_000,trustedReceiptKeys:new Map([['ci-key',publicKey]]),allowInsecureLoopbackForTests:true});
  const identity={sandboxId:'sibling-sandbox',invocationId:'sibling-inv',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',leaseGeneration:3,policyRevision:'card',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300_000).toISOString()};
  const limits={cpuCount:1,memoryBytes:134_217_728,pids:32,openFiles:128,workspaceBytes:10_485_760,outputBytes:32_768,wallClockMs:10_000,concurrentProcesses:4};
  await client.createSandbox({identity,limits,policy:{readWorkspace:true,mutateWorkspace:true,executeProcess:true,network:'DENY',allowedTools:['shell.bash']}});
  await client.prepareWorkspace({sandboxId:identity.sandboxId,sourceRef:required('JULIUS_WORKSPACE'),expectedLeaseGeneration:3});
  const request={invocationId:'sibling-inv',runId:'run',taskId:'task',projectId:'project',workerId:'worker',toolId:'shell.bash' as const,toolVersion:'1',arguments:{command:`test "$(id -u)" = 65532 && printf 'one-effect\\n' >> physical-effects.log && test ! -S /var/run/docker.sock && node -e "fetch('http://example.com').then(()=>process.exit(2)).catch(()=>process.exit(0))"`},cwd:'.',idempotencyKey:'sibling-effect',timeoutMs:5000,expectedMutation:'WORKSPACE' as const};
  const execution={sandboxId:identity.sandboxId,expectedLeaseGeneration:3,dispatchGeneration:1,requestDigest,executionTokenHash:'b'.repeat(64),effectClassification:'NON_IDEMPOTENT_MUTATION' as const,request};
  const original=await client.executeTool(execution),replay=await client.executeTool(execution);
  if(JSON.stringify(original)!==JSON.stringify(replay))throw new Error('terminal_replay_material_changed');
  if((await readFile(`${required('JULIUS_WORKSPACE')}/physical-effects.log`,'utf8'))!=='one-effect\n')throw new Error('second_physical_effect_detected');
  const settlement=new JuliusToolSettlementPostgresRepository(pool),command={settlementId:'sibling-settlement',invocationId:'sibling-inv',dispatchGeneration:1,resultDigest:sha(original),result:original,artifacts:[],evidence:[{evidenceId:'sibling-evidence',type:'COMMAND_EXECUTION' as const,integrityHash:'e'.repeat(64),facts:{safeSummary:'Sibling executor result verified.'}}],taskOutcome:null,occurredAt:new Date().toISOString()};
  if(!(await settlement.settle(command)).created||(await settlement.settle(command)).created)throw new Error('settlement_not_exactly_once');
  await client.destroySandbox({sandboxId:identity.sandboxId,expectedLeaseGeneration:3,reason:'sibling-ci-cleanup'});
  const counts=await pool.query(`SELECT (SELECT count(*) FROM relay_wonderland.julius_tool_settlements WHERE invocation_id='sibling-inv') settlements,(SELECT count(*) FROM relay_wonderland.julius_evidence WHERE evidence_id='sibling-evidence') evidence`);
  if(counts.rows[0].settlements!=='1'||counts.rows[0].evidence!=='1')throw new Error('settlement_duplicate_material');
  await pool.end();
  process.stdout.write('SIBLING_E2E_GREEN\n');
}
void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:error}\n`);process.exitCode=1;});
