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
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { canonicalRequestDigest } from '../src/relay/workspace/julius-tools/execution-envelope';
import { LIMITS, FULL_POLICY, LEASE, PROJECT, RUN, TASK, TENANT, WORKER, POLICY, COMPLETION_RUN, COMPLETION_TASK, digestOf, endpoint, divergentEnvelope, envelopeFor, openJuliusClient, required, seedBase, seedInvocation, sha, type SandboxLimits, type SeededInvocation } from './julius-sibling-support';

const run=promisify(execFile);
const refused=async(what:string,attempt:()=>Promise<unknown>)=>{try{await attempt();}catch(error){if(error instanceof Error&&error.message.startsWith('isolation_'))throw error;return;}throw new Error(`isolation_${what}_succeeded`);};
const denyRead=(path:string)=>refused(`read:${path}`,()=>readFile(path));
const denyList=(path:string)=>refused(`list:${path}`,()=>readdir(path));
const denyWrite=(path:string)=>refused(`write:${path}`,()=>writeFile(path,'forbidden'));
/** readFile on a unix socket fails whether or not the socket is there, so the socket is probed by connecting to it. */
const denySocket=(path:string)=>refused(`docker_socket:${path}`,async()=>{
  const kind=await stat(path).then(entry=>entry.isSocket(),()=>false);
  if(!kind)throw new Error('absent');
  await new Promise<void>((resolve,reject)=>{const socket=connect(path);socket.once('connect',()=>{socket.destroy();resolve();});socket.once('error',error=>{socket.destroy();reject(error);});});
});
const EFFECT_LOG='physical-effects.log',INTERRUPT_STARTED='interrupt-started.log',INTERRUPT_ENTERED='interrupt-entered.log',INTERRUPT_UNSTARTED='interrupt-unstarted.log';
const PHASES=['isolation','initial','settle','interrupt-start','interrupt-verify','replay','complete'] as const;
const LONG_RUNNING:SandboxLimits={...LIMITS,wallClockMs:150_000};
type Phase=(typeof PHASES)[number];

/** Julius must not be able to reach any executor-private authority, and asserting it from configuration is not proof. */
async function proveIsolation():Promise<void>{
  await denySocket('/var/run/docker.sock');
  await denyRead(required('PROBE_EXECUTOR_PRIVATE_KEY'));
  for(const root of [required('PROBE_EXECUTOR_RECEIPT_ROOT'),required('PROBE_EXECUTOR_LEDGER_ROOT')]){
    await denyList(root);await denyRead(`${root}/probe`);await denyWrite(`${root}/probe`);
  }
  if(process.env.EXECUTOR_SIGNING_KEY_PATH||process.env.EXECUTOR_RECEIPT_ROOT||process.env.EXECUTOR_LEDGER_ROOT||process.env.EXECUTOR_SECRET_ENV||process.env.EXECUTOR_CREDENTIAL_ROOT||process.env.EXECUTOR_CALLERS)throw new Error('isolation_executor_environment_visible');
  await refused('direct_docker',()=>run('docker',['ps']));
  await refused('direct_docker_over_socket',()=>run('docker',['-H','unix:///var/run/docker.sock','info']));
  // The public verification key is the one executor artefact Julius is meant to hold.
  await access(required('JULIUS_PUBLIC_KEY_PATH'),constants.R_OK);
  process.stdout.write('SIBLING_ISOLATION_GREEN\n');
}

const proofPath=()=>`${required('JULIUS_WORKSPACE')}/julius-terminal-proof.json`;
const settlementProofPath=()=>`${required('JULIUS_WORKSPACE')}/julius-settlement-proof.json`;
const lines=async(name:string)=>(await readFile(`${required('JULIUS_WORKSPACE')}/${name}`,'utf8')).trim().split('\n').filter(Boolean).length;
const absent=async(name:string)=>readFile(`${required('JULIUS_WORKSPACE')}/${name}`,'utf8').then(()=>false,()=>true);

type SettlementCommand=Parameters<JuliusToolSettlementPostgresRepository['settle']>[0];
const settlementCommand=(input:{settlementId:string;seed:SeededInvocation;result:unknown;evidenceId:string;taskOutcome:{state:'SUCCEEDED';verificationDecisionId:string}|null}):SettlementCommand=>({settlementId:input.settlementId,invocationId:input.seed.invocationId,dispatchGeneration:input.seed.dispatchGeneration,resultDigest:digestOf(input.result),result:input.result as never,artifacts:[],evidence:[{evidenceId:input.evidenceId,type:'COMMAND_EXECUTION' as const,integrityHash:'e'.repeat(64),facts:{safeSummary:'Sibling executor result verified.'}}],taskOutcome:input.taskOutcome,occurredAt:new Date().toISOString()});

/** Every row the settlement writes, counted by its own identity. Each must be exactly one, however often Julius retries. */
const SETTLEMENT_COUNTS=`SELECT
 (SELECT count(*) FROM relay_wonderland.julius_tool_settlements WHERE invocation_id=$1) settlements,
 (SELECT count(*) FROM relay_wonderland.julius_evidence WHERE evidence_id=$2) evidence,
 (SELECT count(*) FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1 AND state='SUCCEEDED') succeeded,
 (SELECT count(*) FROM relay_wonderland.budget_reservations WHERE reservation_id=$3 AND state='COMMITTED') committed,
 (SELECT count(*) FROM relay_wonderland.julius_trajectory_events WHERE trajectory_event_id=$4) trajectory,
 (SELECT count(*) FROM relay_wonderland.events WHERE event_id=$5) events,
 (SELECT count(*) FROM relay_wonderland.outbox WHERE outbox_id=$6) outbox,
 (SELECT count(*) FROM relay_wonderland.julius_tool_outbox WHERE invocation_id=$1 AND state='DELIVERED') delivered,
 (SELECT count(*) FROM relay_wonderland.julius_tasks WHERE task_id=$7 AND state=$8) task`;
const settlementTruth=async(pool:import('pg').Pool,input:{invocationId:string;evidenceId:string;settlementId:string;taskId:string;taskState:string})=>{
  const counts=await pool.query(SETTLEMENT_COUNTS,[input.invocationId,input.evidenceId,`budget-${input.invocationId}`,`trajectory:tool-settlement:${input.settlementId}`,`julius:tool-settlement:${input.settlementId}`,`outbox:julius:tool-settlement:${input.settlementId}`,input.taskId,input.taskState]);
  const truth=counts.rows[0] as Record<string,string>;
  const wrong=Object.entries(truth).filter(([,value])=>value!=='1');
  if(wrong.length)throw new Error(`settlement_not_exactly_once:${JSON.stringify(truth)}`);
  return truth;
};

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
    const requestDigest=canonicalRequestDigest(request);
    const identity={sandboxId:invocationId,invocationId,tenantId:TENANT,projectId:PROJECT,runId:RUN,taskId:TASK,leaseGeneration:LEASE,policyRevision:POLICY,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3_600_000).toISOString()};
    return {invocationId,requestDigest,dispatchGeneration:1,identity,request,execution:{sandboxId:invocationId,expectedLeaseGeneration:LEASE,dispatchGeneration:1,requestDigest,executionTokenHash:sha(`token:${invocationId}`),effectClassification:'NON_IDEMPOTENT_MUTATION' as const,request}};
  };

  const EFFECT_COMMAND=`test "$(id -u)" = 65532 && printf 'one-effect\\n' >> ${EFFECT_LOG} && test ! -S /var/run/docker.sock && node -e "fetch('http://example.com').then(()=>process.exit(2)).catch(()=>process.exit(0))"`;
  const STARTED_COMMAND=`printf 'started\\n' >> ${INTERRUPT_STARTED}; sleep 120`;
  // The entry marker proves the workload really started; the effect itself is what must never happen.
  const UNSTARTED_COMMAND=`printf 'entered\\n' >> ${INTERRUPT_ENTERED}; sleep 120; printf 'never\\n' >> ${INTERRUPT_UNSTARTED}`;

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
    const deadline=Date.now()+60_000;
    const seen=async(name:string)=>lines(name).catch(()=>0);
    while((await seen(INTERRUPT_STARTED)<1||await seen(INTERRUPT_ENTERED)<1)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
    if(await seen(INTERRUPT_STARTED)!==1)throw new Error('interrupt_dangerous_effect_never_started');
    if(await seen(INTERRUPT_ENTERED)!==1)throw new Error('interrupt_unstarted_workload_never_entered');
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

  if(phase==='complete'){
    // Completion authority on its own task, so proving it cannot strand any other phase.
    await seedBase(pool,{runId:COMPLETION_RUN,taskId:COMPLETION_TASK});
    const seed=await seedInvocation(pool,tools,{invocationId:'sibling-completion',command:"printf 'completed\\n' >> completion-effect.log",runId:COMPLETION_RUN,taskId:COMPLETION_TASK});
    await client.createSandbox({identity:seed.identity,limits:LIMITS,policy:FULL_POLICY});
    await client.prepareWorkspace({sandboxId:seed.identity.sandboxId,sourceRef:workspace,expectedLeaseGeneration:LEASE});
    const result=await client.executeTool(seed.execution);
    if(result.status!=='SUCCEEDED')throw new Error(`completion_execution_not_successful:${result.status}`);
    await pool.query(`INSERT INTO relay_wonderland.julius_verification_decisions(decision_id,run_id,task_id,action,reason_code,safe_summary,evidence_ids,policy_revision,occurred_at,idempotency_key)VALUES($1,$2,$3,'COMPLETE','evidence_verified','Sibling completion authority.',$4::jsonb,$5,now(),$1) ON CONFLICT DO NOTHING`,
      ['sibling-decision',COMPLETION_RUN,COMPLETION_TASK,JSON.stringify(['completion-evidence']),POLICY]);
    const command=settlementCommand({settlementId:'sibling-completion-settlement',seed,result,evidenceId:'completion-evidence',taskOutcome:{state:'SUCCEEDED',verificationDecisionId:'sibling-decision'}});
    if(!(await settlement.settle(command)).created)throw new Error('completion_settlement_missing');
    if((await settlement.settle(command)).created)throw new Error('completion_settlement_not_exactly_once');
    const truth=await settlementTruth(pool,{invocationId:seed.invocationId,evidenceId:'completion-evidence',settlementId:'sibling-completion-settlement',taskId:COMPLETION_TASK,taskState:'SUCCEEDED'});
    const released=await pool.query(`SELECT count(*) c FROM relay_wonderland.julius_tasks WHERE task_id=$1 AND state='SUCCEEDED' AND lease_owner IS NULL AND lease_expires_at IS NULL`,[COMPLETION_TASK]);
    if(released.rows[0].c!=='1')throw new Error('completion_did_not_release_the_task_lease');
    if(await lines('completion-effect.log')!==1)throw new Error('completion_effect_not_exactly_one');
    await client.destroySandbox({sandboxId:seed.identity.sandboxId,expectedLeaseGeneration:LEASE,reason:'sibling-ci-cleanup'});
    await pool.end();process.stdout.write(`SIBLING_COMPLETION_GREEN ${JSON.stringify(truth)}\n`);return;
  }

  const proof=JSON.parse(await readFile(proofPath(),'utf8')) as {invocationId:string;dispatchGeneration:number;original:Awaited<ReturnType<typeof client.executeTool>>};
  const seed=rebuild(proof.invocationId,EFFECT_COMMAND);
  const replayed=await client.executeTool(seed.execution);
  if(JSON.stringify(proof.original)!==JSON.stringify(replayed))throw new Error('terminal_replay_material_changed');
  if(await lines(EFFECT_LOG)!==1)throw new Error('second_physical_effect_detected');

  if(phase==='settle'){
    // Julius restarted with no memory of the run, consumed the durable AFTER, and settles for the first time.
    const command=settlementCommand({settlementId:'sibling-settlement',seed,result:replayed,evidenceId:'sibling-evidence',taskOutcome:null});
    if(!(await settlement.settle(command)).created)throw new Error('restart_settlement_missing');
    if(await lines(EFFECT_LOG)!==1)throw new Error('settlement_caused_a_second_effect');
    // A restarted Julius rebuilds the same command from its own durable record; this file stands in for that record.
    await writeFile(settlementProofPath(),JSON.stringify(command),{flag:'wx'});
    await pool.end();process.stdout.write('SIBLING_SETTLE_GREEN\n');return;
  }

  // replay: the executor itself restarted between the settlement and now.
  const command=JSON.parse(await readFile(settlementProofPath(),'utf8')) as SettlementCommand;
  if((await settlement.settle(command)).created)throw new Error('settlement_not_exactly_once');
  // A second settlement of the same invocation carrying different material is refused, never merged.
  await settlement.settle({...command,occurredAt:new Date().toISOString()}).then(
    ()=>{throw new Error('divergent_settlement_accepted');},
    error=>{if(!(error instanceof Error)||error.message!=='tool_settlement_identity_conflict')throw error;});
  await expectConflict(post,scoped.get('execute')!,seed);
  await client.destroySandbox({sandboxId:seed.identity.sandboxId,expectedLeaseGeneration:LEASE,reason:'sibling-ci-cleanup'});
  const truth=await settlementTruth(pool,{invocationId:seed.invocationId,evidenceId:'sibling-evidence',settlementId:'sibling-settlement',taskId:TASK,taskState:'ACTIVE'});
  if(await lines(EFFECT_LOG)!==1)throw new Error('final_effect_count_not_one');
  await pool.end();
  process.stdout.write(`SIBLING_E2E_GREEN ${JSON.stringify(truth)} effects=1\n`);
}

/** The same execution identity carrying a different request is a hard conflict, never a second execution. */
async function expectConflict(post:(operation:string,credential:string,payload:unknown)=>Promise<Response>,credential:string,seed:SeededInvocation):Promise<void>{
  const asserted=await post('execute',credential,envelopeFor(seed,{requestDigest:'b'.repeat(64)}));
  const assertedError=((await asserted.json()) as {error?:string}).error??'';
  // A digest the caller merely asserts is refused before the ledger is consulted at all.
  if(asserted.status!==400||assertedError!=='INVALID_REQUEST:execution_envelope_request_digest_mismatch')throw new Error(`asserted_digest_not_refused:${asserted.status}:${assertedError}`);
  const answer=await post('execute',credential,divergentEnvelope(seed));
  const decoded=await answer.json() as {error?:string};
  if(answer.status!==409||decoded.error!=='SECURITY_FAILURE:execution_identity_conflict')throw new Error(`identity_conflict_not_refused:${answer.status}:${decoded.error??''}`);
}

void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:error}\n`);process.exitCode=1;});
