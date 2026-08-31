/**
 * Julius-side lifecycle proof against real sibling infrastructure.
 * Every phase runs as its own process, so a phase boundary is a genuine Julius restart.
 *
 *   isolation        Julius has no Docker, no signing key and no receipt store.
 *   initial          authorize -> dispatch -> scoped envelope -> reservation -> BEFORE -> effect -> AFTER, then Julius dies.
 *   settle           Julius restarts, consumes the durable AFTER, never re-executes, settles exactly once.   (case B)
 *   interrupt-start  a dangerous effect starts and its sandbox is destroyed under it.                        (cases A and C)
 *   interrupt-verify the interrupted identity answers STARTED_UNKNOWN_OUTCOME and is never replayed blind.   (cases A and C)
 *   replay           after an executor restart the terminal material replays verbatim with no second effect. (case D)
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { LIMITS, FULL_POLICY, LEASE, PROJECT, RUN, TASK, TENANT, WORKER, POLICY, digestOf, endpoint, envelopeFor, openJuliusClient, required, seedBase, seedInvocation, sha, type SeededInvocation } from './julius-sibling-support';

const run=promisify(execFile);
const denyRead=async(path:string)=>{try{await readFile(path);throw new Error(`isolation_read_succeeded:${path}`);}catch(error){if(error instanceof Error&&error.message.startsWith('isolation_'))throw error;}};
const denyWrite=async(path:string)=>{try{await writeFile(path,'forbidden');throw new Error(`isolation_write_succeeded:${path}`);}catch(error){if(error instanceof Error&&error.message.startsWith('isolation_'))throw error;}};
const EFFECT_LOG='physical-effects.log',INTERRUPT_STARTED='interrupt-started.log',INTERRUPT_UNSTARTED='interrupt-unstarted.log';
const PHASES=['isolation','initial','settle','interrupt-start','interrupt-verify','replay'] as const;
const LONG_RUNNING={...LIMITS,wallClockMs:150_000} as const;
type Phase=(typeof PHASES)[number];

/** Julius must not be able to reach any executor-private authority, and asserting it from configuration is not proof. */
async function proveIsolation():Promise<void>{
  await denyRead('/var/run/docker.sock');
  await denyRead(required('PROBE_EXECUTOR_PRIVATE_KEY'));
  await denyRead(`${required('PROBE_EXECUTOR_RECEIPT_ROOT')}/.`);
  await denyWrite(`${required('PROBE_EXECUTOR_RECEIPT_ROOT')}/probe`);
  await denyRead(`${required('PROBE_EXECUTOR_LEDGER_ROOT')}/.`);
  await denyWrite(`${required('PROBE_EXECUTOR_LEDGER_ROOT')}/probe`);
  if(process.env.EXECUTOR_SIGNING_KEY_PATH||process.env.EXECUTOR_RECEIPT_ROOT||process.env.EXECUTOR_LEDGER_ROOT||process.env.EXECUTOR_SECRET_ENV||process.env.EXECUTOR_CREDENTIAL_ROOT||process.env.EXECUTOR_CALLERS)throw new Error('isolation_executor_environment_visible');
  await run('docker',['ps']).then(()=>{throw new Error('isolation_direct_docker_succeeded');},()=>undefined);
  await run('docker',['-H','unix:///var/run/docker.sock','info']).then(()=>{throw new Error('isolation_direct_docker_socket_succeeded');},()=>undefined);
  await access(required('JULIUS_PUBLIC_KEY_PATH'),constants.R_OK);
  process.stdout.write('SIBLING_ISOLATION_GREEN\n');
}

const proofPath=()=>`${required('JULIUS_WORKSPACE')}/julius-terminal-proof.json`;
const lines=async(name:string)=>(await readFile(`${required('JULIUS_WORKSPACE')}/${name}`,'utf8')).trim().split('\n').filter(Boolean).length;
const absent=async(name:string)=>readFile(`${required('JULIUS_WORKSPACE')}/${name}`,'utf8').then(()=>false,()=>true);

const settlementCommand=(seed:SeededInvocation,result:unknown)=>({settlementId:'sibling-settlement',invocationId:seed.invocationId,dispatchGeneration:seed.dispatchGeneration,resultDigest:digestOf(result),result:result as never,artifacts:[],evidence:[{evidenceId:'sibling-evidence',type:'COMMAND_EXECUTION' as const,integrityHash:'e'.repeat(64),facts:{safeSummary:'Sibling executor result verified.'}}],taskOutcome:null,occurredAt:new Date().toISOString()});

async function main():Promise<void>{
  const phase=(process.env.SIBLING_PHASE??'initial') as Phase;
  if(!PHASES.includes(phase))throw new Error(`sibling_phase_invalid:${phase}`);
  if(phase==='isolation'){await proveIsolation();return;}
  await proveIsolation();

  const {pool,tools,client,scoped,workspace}=await openJuliusClient();
  const post=(operation:string,credential:string,payload:unknown)=>fetch(new URL('/v1/execute',endpoint()),{method:'POST',headers:{authorization:`Bearer ${credential}`,'x-julius-operation':operation,'content-type':'application/json'},body:JSON.stringify(payload)});
  const settlement=new JuliusToolSettlementPostgresRepository(pool);
  const reseed=async(invocationId:string,command:string,timeoutMs?:number)=>{await seedBase(pool);return seedInvocation(pool,tools,{invocationId,command,timeoutMs});};
  const rebuild=(invocationId:string,command:string,timeoutMs=10_000):SeededInvocation=>{
    const request={invocationId,runId:RUN,taskId:TASK,projectId:PROJECT,workerId:WORKER,toolId:'shell.bash' as const,toolVersion:'1',arguments:{command},cwd:'.',idempotencyKey:invocationId,timeoutMs,expectedMutation:'WORKSPACE' as const};
    const requestDigest=sha(invocationId);
    const identity={sandboxId:invocationId,invocationId,tenantId:TENANT,projectId:PROJECT,runId:RUN,taskId:TASK,leaseGeneration:LEASE,policyRevision:POLICY,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3_600_000).toISOString()};
    return {invocationId,requestDigest,dispatchGeneration:1,identity,request,execution:{sandboxId:invocationId,expectedLeaseGeneration:LEASE,dispatchGeneration:1,requestDigest,executionTokenHash:sha(`token:${invocationId}`),effectClassification:'NON_IDEMPOTENT_MUTATION' as const,request}};
  };

  const EFFECT_COMMAND=`test "$(id -u)" = 65532 && printf 'one-effect\\n' >> ${EFFECT_LOG} && test ! -S /var/run/docker.sock && node -e "fetch('http://example.com').then(()=>process.exit(2)).catch(()=>process.exit(0))"`;
  const STARTED_COMMAND=`printf 'started\\n' >> ${INTERRUPT_STARTED}; sleep 90`;
  const UNSTARTED_COMMAND=`sleep 90; printf 'never\\n' >> ${INTERRUPT_UNSTARTED}`;

  if(phase==='initial'){
    const seed=await reseed('sibling-inv',EFFECT_COMMAND);
    await client.createSandbox({identity:seed.identity,limits:LIMITS,policy:FULL_POLICY});
    await client.prepareWorkspace({sandboxId:seed.identity.sandboxId,sourceRef:workspace,expectedLeaseGeneration:LEASE});
    const original=await client.executeTool(seed.execution);
    if(original.status!=='SUCCEEDED')throw new Error(`initial_execution_not_successful:${original.status}:${original.stderr.slice(0,200)}`);
    if(await lines(EFFECT_LOG)!==1)throw new Error('initial_effect_not_exactly_one');
    await writeFile(proofPath(),JSON.stringify({invocationId:seed.invocationId,dispatchGeneration:seed.dispatchGeneration,original}),{flag:'wx'});
    // Julius now dies without settling. Nothing downstream of the executor has been written.
    if((await pool.query(`SELECT count(*) c FROM relay_wonderland.julius_tool_settlements WHERE invocation_id=$1`,[seed.invocationId])).rows[0].c!=='0')throw new Error('initial_settled_too_early');
    await pool.end();process.stdout.write('SIBLING_INITIAL_GREEN\n');return;
  }

  if(phase==='interrupt-start'){
    const started=await reseed('sibling-interrupt-started',STARTED_COMMAND,LONG_RUNNING.wallClockMs);
    const unstarted=await reseed('sibling-interrupt-unstarted',UNSTARTED_COMMAND,LONG_RUNNING.wallClockMs);
    for(const seed of [started,unstarted]){
      await client.createSandbox({identity:seed.identity,limits:LONG_RUNNING,policy:FULL_POLICY});
      await client.prepareWorkspace({sandboxId:seed.identity.sandboxId,sourceRef:workspace,expectedLeaseGeneration:LEASE});
      // Fire and forget: this process exits while the executor is mid-flight and the workflow destroys the sandbox under it.
      void post('execute',scoped.get('execute')!,envelopeFor(seed)).catch(()=>undefined);
    }
    const deadline=Date.now()+45_000;
    while(await lines(INTERRUPT_STARTED).catch(()=>0)<1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
    if(await lines(INTERRUPT_STARTED).catch(()=>0)!==1)throw new Error('interrupt_dangerous_effect_never_started');
    if(!await absent(INTERRUPT_UNSTARTED))throw new Error('interrupt_unstarted_effect_ran_early');
    await pool.end();process.stdout.write('SIBLING_INTERRUPT_STARTED\n');
    // Julius dies here, mid-request, exactly as a crashed orchestrator would.
    process.exit(0);
  }

  if(phase==='interrupt-verify'){
    for(const [invocationId,command,marker,expected] of [['sibling-interrupt-started',STARTED_COMMAND,INTERRUPT_STARTED,1],['sibling-interrupt-unstarted',UNSTARTED_COMMAND,INTERRUPT_UNSTARTED,0]] as const){
      const seed=rebuild(invocationId,command,LONG_RUNNING.wallClockMs);
      const answer=await post('execute',scoped.get('execute')!,envelopeFor(seed));
      const decoded=await answer.json() as {error?:string};
      if(answer.status!==409||decoded.error!=='STARTED_UNKNOWN_OUTCOME')throw new Error(`interrupt_outcome_not_unknown:${invocationId}:${answer.status}:${decoded.error??''}`);
      const observed=expected===0?(await absent(marker)?0:await lines(marker)):await lines(marker);
      if(observed!==expected)throw new Error(`interrupt_replayed_effect:${invocationId}:${observed}!==${expected}`);
    }
    await pool.end();process.stdout.write('SIBLING_INTERRUPT_VERIFY_GREEN\n');return;
  }

  const proof=JSON.parse(await readFile(proofPath(),'utf8')) as {invocationId:string;dispatchGeneration:number;original:Awaited<ReturnType<typeof client.executeTool>>};
  const seed=rebuild(proof.invocationId,EFFECT_COMMAND);
  const replayed=await client.executeTool(seed.execution);
  if(JSON.stringify(proof.original)!==JSON.stringify(replayed))throw new Error('terminal_replay_material_changed');
  if(await lines(EFFECT_LOG)!==1)throw new Error('second_physical_effect_detected');

  if(phase==='settle'){
    // Julius restarted with no memory of the run, consumed the durable AFTER, and settles for the first time.
    if(!(await settlement.settle(settlementCommand(seed,replayed))).created)throw new Error('restart_settlement_missing');
    if(await lines(EFFECT_LOG)!==1)throw new Error('settlement_caused_a_second_effect');
    await pool.end();process.stdout.write('SIBLING_SETTLE_GREEN\n');return;
  }

  // replay: the executor itself restarted between the settlement and now.
  const command=settlementCommand(seed,replayed);
  if((await settlement.settle(command)).created)throw new Error('settlement_not_exactly_once');
  await expectConflict(post,scoped.get('execute')!,seed);
  await client.destroySandbox({sandboxId:seed.identity.sandboxId,expectedLeaseGeneration:LEASE,reason:'sibling-ci-cleanup'});
  const counts=await pool.query(`SELECT (SELECT count(*) FROM relay_wonderland.julius_tool_settlements WHERE invocation_id=$1) settlements,(SELECT count(*) FROM relay_wonderland.julius_evidence WHERE evidence_id='sibling-evidence') evidence,(SELECT count(*) FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1 AND state='SUCCEEDED') succeeded,(SELECT count(*) FROM relay_wonderland.budget_reservations WHERE reservation_id=$2 AND state='COMMITTED') committed`,[seed.invocationId,`budget-${seed.invocationId}`]);
  const truth=counts.rows[0] as Record<string,string>;
  if(truth.settlements!=='1'||truth.evidence!=='1'||truth.succeeded!=='1'||truth.committed!=='1')throw new Error(`settlement_duplicate_material:${JSON.stringify(truth)}`);
  if(await lines(EFFECT_LOG)!==1)throw new Error('final_effect_count_not_one');
  await pool.end();
  process.stdout.write(`SIBLING_E2E_GREEN settlements=${truth.settlements} evidence=${truth.evidence} invocation=${truth.succeeded} budget=${truth.committed} effects=1\n`);
}

/** The same execution identity carrying a different request is a hard conflict, never a second execution. */
async function expectConflict(post:(operation:string,credential:string,payload:unknown)=>Promise<Response>,credential:string,seed:SeededInvocation):Promise<void>{
  const answer=await post('execute',credential,envelopeFor(seed,{requestDigest:'b'.repeat(64)}));
  const decoded=await answer.json() as {error?:string};
  if(answer.status!==409||decoded.error!=='SECURITY_FAILURE:execution_identity_conflict')throw new Error(`identity_conflict_not_refused:${answer.status}:${decoded.error??''}`);
}

void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:error}\n`);process.exitCode=1;});
