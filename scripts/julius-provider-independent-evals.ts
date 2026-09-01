/**
 * Provider-independent evaluation suite. Every case here runs against the real sibling
 * infrastructure: a separate PostgreSQL, a separate executor control plane that alone holds
 * Docker authority, and real containers. Nothing is asserted from configuration.
 * Each case reports PASS, FAIL or BLOCKED, and BLOCKED always carries the reason it is blocked.
 */
import { lstat, readFile, rm, stat, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { verifyExecutorAttestation, type SignedExecutorAttestation } from '../src/relay/workspace/julius-tools/executor-attestation';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';
import { EVAL_RUN, EVAL_TASK, FULL_POLICY, divergentEnvelope, LEASE, LIMITS, PROJECT, TENANT, endpoint, envelopeFor, openJuliusClient, required, scopedCredentials, seedBase, seedInvocation, sha, type SandboxLimits } from './julius-sibling-support';

type Verdict='PASS'|'FAIL'|'BLOCKED';
class Blocked extends Error {}
const results:{id:string;verdict:Verdict;detail:string}[]=[];
async function evaluate(id:string,run:()=>Promise<string>):Promise<void>{
  try{results.push({id,verdict:'PASS',detail:await run()});}
  catch(error){const detail=(error instanceof Error?error.message:String(error)).replace(/\s+/g,' ').slice(0,240);results.push({id,verdict:error instanceof Blocked?'BLOCKED':'FAIL',detail});}
}
const refuses=async(id:string,action:()=>Promise<unknown>,expected:string):Promise<void>=>evaluate(id,async()=>{
  let outcome='resolved';
  try{await action();}catch(error){outcome=error instanceof Error?error.message:String(error);}
  if(!outcome.includes(expected))throw new Error(`expected refusal containing "${expected}", observed "${outcome}"`);
  return outcome;
});

async function main():Promise<void>{
  const {pool,tools,client,scoped,trustedReceiptKeys,workspace}=await openJuliusClient();
  await seedBase(pool,{runId:EVAL_RUN,taskId:EVAL_TASK});

  let seeded=0;
  const seedFor=(label:string,command:string,timeoutMs=10_000,claim=true)=>seedInvocation(pool,tools,{invocationId:`eval-${label}-${++seeded}`,command,timeoutMs,claim,runId:EVAL_RUN,taskId:EVAL_TASK});
  const start=async(label:string,command:string,policy=FULL_POLICY,limits:SandboxLimits=LIMITS,timeoutMs=10_000)=>{
    const seed=await seedFor(label,command,timeoutMs);
    await client.createSandbox({identity:seed.identity,limits,policy});
    await client.prepareWorkspace({sandboxId:seed.identity.sandboxId,sourceRef:workspace,expectedLeaseGeneration:LEASE});
    return seed;
  };

  // ── One real execution carrying every kernel-enforced containment observation ────────────
  const probe=[
    'printf "uid=%s\\n" "$(id -u)"',
    'if printf x > /etc/julius-probe 2>/dev/null; then printf "fs_write_outside=ALLOWED\\n"; else printf "fs_write_outside=DENIED\\n"; fi',
    'if cat /julius-receipts-root/* >/dev/null 2>&1; then printf "receipt_read=ALLOWED\\n"; else printf "receipt_read=DENIED\\n"; fi',
    'if test -S /var/run/docker.sock; then printf "docker_socket=PRESENT\\n"; else printf "docker_socket=ABSENT\\n"; fi',
    'if node -e "fetch(\'http://example.com\').then(()=>process.exit(0)).catch(()=>process.exit(3))" 2>/dev/null; then printf "network=ALLOWED\\n"; else printf "network=DENIED\\n"; fi',
    'printf "cpu_max=%s\\n" "$(cat /sys/fs/cgroup/cpu.max 2>/dev/null | tr " " "_")"',
    'printf "memory_max=%s\\n" "$(cat /sys/fs/cgroup/memory.max 2>/dev/null)"',
    'printf "pids_max=%s\\n" "$(cat /sys/fs/cgroup/pids.max 2>/dev/null)"',
    'printf "nofile=%s\\n" "$(ulimit -n)"',
    'printf "no_new_privs=%s\\n" "$(grep NoNewPrivs /proc/self/status | tr -d "\\t " )"',
    'printf "cap_eff=%s\\n" "$(grep CapEff /proc/self/status | tr -d "\\t " )"',
    'printf "one-effect\\n" >> eval-effects.log',
    'printf "effect_written=%s\\n" "$(wc -l < eval-effects.log)"',
  ].join('; ');
  const containment=await start('containment',probe);
  const containmentResult=await client.executeTool(containment.execution);
  const observed=new Map(containmentResult.stdout.split('\n').filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1).trim()]));
  const fact=(key:string)=>{const value=observed.get(key);if(value===undefined)throw new Error(`probe_observation_missing:${key} in ${JSON.stringify(containmentResult.stdout).slice(0,200)}`);return value;};
  const expectFact=(id:string,key:string,expected:string)=>evaluate(id,async()=>{const value=fact(key);if(value!==expected)throw new Error(`${key}=${value}, expected ${expected}`);return `${key}=${value}`;});

  await evaluate('unprivileged-execution-identity',async()=>{const uid=fact('uid');if(uid!=='65532')throw new Error(`uid=${uid}`);return `uid=${uid}`;});
  await expectFact('fs-write-denial-outside-workspace','fs_write_outside','DENIED');
  await expectFact('receipt-store-unreadable-by-workload','receipt_read','DENIED');
  await expectFact('docker-socket-absent-in-sandbox','docker_socket','ABSENT');
  await expectFact('network-denial','network','DENIED');
  const ceiling=(id:string,key:string,ceilingValue:number,read:(raw:string)=>number)=>evaluate(id,async()=>{
    const raw=fact(key);
    if(!raw)throw new Blocked(`${key} is not exposed by this kernel, so the ceiling cannot be observed from inside the sandbox`);
    const value=read(raw);
    if(!Number.isFinite(value))throw new Error(`${key}=${raw}`);
    if(value>ceilingValue)throw new Error(`${key}=${raw} exceeds the requested ceiling ${ceilingValue}`);
    return `${key}=${raw}`;
  });
  await ceiling('cpu-limit-enforced','cpu_max',LIMITS.cpuCount,raw=>{const [quota,period]=raw.split('_').map(Number);return quota/period;});
  await ceiling('memory-limit-enforced','memory_max',LIMITS.memoryBytes,Number);
  await ceiling('pid-limit-enforced','pids_max',LIMITS.pids,Number);
  await evaluate('open-file-limit-enforced',async()=>{const value=Number(fact('nofile'));if(!Number.isFinite(value)||value>LIMITS.openFiles)throw new Error(`nofile=${fact('nofile')}`);return `nofile=${value}`;});
  await evaluate('privilege-escalation-denied',async()=>{const nnp=fact('no_new_privs'),caps=fact('cap_eff');if(!nnp.endsWith('1'))throw new Error(nnp);if(!/CapEff:0*$/.test(caps))throw new Error(caps);return `${nnp} ${caps}`;});

  // ── Temporal ordering, proven from signed material Julius is allowed to hold ─────────────
  await evaluate('before-durable-precedes-effect-precedes-after-durable',async()=>{
    const raw=await fetch(new URL('/v1/execute',endpoint()),{method:'POST',headers:{authorization:`Bearer ${scoped.get('execute')!}`,'x-julius-operation':'execute','content-type':'application/json'},body:JSON.stringify(envelopeFor(containment))});
    const decoded=await raw.json() as {attestations:readonly SignedExecutorAttestation[]};
    const at=(phase:'BEFORE'|'AFTER')=>{const signed=decoded.attestations.find(item=>item.attestation.phase===phase);if(!signed)throw new Error(`attestation_missing:${phase}`);verifyExecutorAttestation(signed,trustedReceiptKeys,{phase,executionIdentity:`${containment.invocationId}:${containment.dispatchGeneration}:${containment.identity.sandboxId}`,invocationId:containment.invocationId,dispatchGeneration:containment.dispatchGeneration,sandboxId:containment.identity.sandboxId,requestDigest:containment.requestDigest,receiptDigest:signed.attestation.receiptDigest});return Date.parse(signed.attestation.issuedAt);};
    const before=at('BEFORE'),after=at('AFTER'),effect=(await stat(`${workspace}/eval-effects.log`)).mtimeMs;
    if(!(before<=effect))throw new Error(`BEFORE_DURABLE ${before} did not precede the effect at ${Math.round(effect)}`);
    if(!(effect<=after))throw new Error(`the effect at ${Math.round(effect)} did not precede AFTER_DURABLE ${after}`);
    return `BEFORE_DURABLE=${before} <= effect=${Math.round(effect)} <= AFTER_DURABLE=${after}`;
  });
  await evaluate('exactly-one-physical-effect',async()=>{const lines=(await readFile(`${workspace}/eval-effects.log`,'utf8')).trim().split('\n').length;if(lines!==1)throw new Error(`eval-effects.log has ${lines} lines`);return 'eval-effects.log=1';});

  // ── Resource ceilings that are only observable by hitting them ───────────────────────────
  await evaluate('memory-ceiling-kills-the-workload',async()=>{
    const seed=await start('oom','timeout 8 node -e "const held=[];for(;;)held.push(Buffer.alloc(8*1024*1024).fill(1))" >/dev/null 2>&1; printf "mem_exit=%s oom_kill=%s\\n" "$?" "$(awk \'/^oom_kill /{print $2}\' /sys/fs/cgroup/memory.events 2>/dev/null)"',FULL_POLICY,LIMITS,20_000);
    const result=await client.executeTool(seed.execution);
    const code=/mem_exit=(\d+)/.exec(result.stdout)?.[1],kills=Number(/oom_kill=(\d+)/.exec(result.stdout)?.[1]);
    if(Number.isFinite(kills)&&kills>0)return `the kernel recorded ${kills} oom kill(s); the allocation exited ${code}`;
    if(code==='137')return 'the allocation was killed with SIGKILL at the memory ceiling';
    throw new Error(`allocation beyond the ceiling exited ${code??'unobserved'} with oom_kill=${/oom_kill=(\d*)/.exec(result.stdout)?.[1]??'unreadable'}`);
  });
  await evaluate('pid-ceiling-bounds-a-fork-storm',async()=>{
    // A bash fork storm cannot measure itself: bash retries every refused fork with a sleep, so the shell
    // outlives its own ceiling. One process spawns the storm and reports what the kernel refused.
    const storm=['node -e \'const cp=require("child_process");let started=0,refused=0;for(let i=0;i<200;i++){const child=cp.spawn("sleep",["1"],{stdio:"ignore"});child.on("error",()=>{refused++;});child.on("spawn",()=>{started++;});}setTimeout(()=>{console.log("spawn_started="+started+" spawn_refused="+refused);process.exit(0);},3000);\'',
      'while read -r key value; do printf "pidevent_%s=%s\\n" "$key" "$value"; done < /sys/fs/cgroup/pids.events'].join('; ');
    const seed=await start('pids',storm,FULL_POLICY,LIMITS,20_000);
    const result=await client.executeTool(seed.execution);
    const refused=Number(/spawn_refused=(\d+)/.exec(result.stdout)?.[1]),started=Number(/spawn_started=(\d+)/.exec(result.stdout)?.[1]);
    const events=Number(/pidevent_max=(\d+)/.exec(result.stdout)?.[1]);
    if(!Number.isFinite(refused))throw new Error(`no spawn outcome observed in ${JSON.stringify(result.stdout).slice(0,220)}`);
    if(refused===0)throw new Error(`all ${started} of 200 requested processes started against a pid ceiling of ${LIMITS.pids}`);
    return `the pid ceiling of ${LIMITS.pids} started ${started} of 200 and refused ${refused}${Number.isFinite(events)?`; the cgroup recorded ${events} refusal(s)`:''}`;
  });
  await evaluate('output-flood-is-bounded',async()=>{
    const seed=await start('flood','head -c 4000000 /dev/zero | tr "\\0" "x"',FULL_POLICY,LIMITS,20_000);
    const result=await client.executeTool(seed.execution);
    const bytes=result.stdout.length+result.stderr.length;
    if(bytes>LIMITS.outputBytes*4)throw new Error(`${bytes} bytes returned against a ceiling of ${LIMITS.outputBytes}`);
    return `flood truncated to ${bytes} bytes (ceiling ${LIMITS.outputBytes})`;
  });
  await evaluate('no-workspace-policy-denies-writes',async()=>{
    const command='err=$( { head -c 1024 /dev/zero > denied.bin; } 2>&1 ); printf "exit=%s size=%s err=%s\\n" "$?" "$(wc -c < denied.bin 2>/dev/null || printf 0)" "$(printf %s "$err" | tr -d "\\n" | tail -c 100 | tr " " "_")"';
    const seed=await start('no-workspace',command,{...FULL_POLICY,readWorkspace:false,mutateWorkspace:false},LIMITS,20_000);
    const result=await client.executeTool(seed.execution);
    const size=Number(/size=(\d+)/.exec(result.stdout)?.[1]),code=/exit=(\d+)/.exec(result.stdout)?.[1];
    if(!Number.isFinite(size))throw new Error(`no outcome observed in ${JSON.stringify(result.stdout).slice(0,200)}`);
    if(code==='0'||size>0)throw new Error(`a sandbox with no workspace policy wrote ${size} bytes`);
    return `a policy granting no workspace left nothing writable (exit ${code}, ${size} bytes)`;
  });
  await evaluate('workspace-byte-ceiling-is-kernel-enforced',async()=>{
    /* The ceiling is now a property of the workspace's own backing store, so it is proven the only way a
       storage limit can be: by trying to exceed it several ways and measuring what the kernel allowed. */
    const probe=[
      'single=$(head -c 8000000 /dev/zero > single.bin 2>&1; echo $?)',
      'repeated=0; for i in $(seq 1 40); do head -c 262144 /dev/zero >> repeated.bin 2>/dev/null || break; repeated=$i; done',
      'truncate -s 64000000 sparse.bin 2>/dev/null; sparse_apparent=$(wc -c < sparse.bin 2>/dev/null || printf 0)',
      'for i in 1 2 3 4; do (head -c 4000000 /dev/zero > "concurrent-$i.bin" 2>/dev/null) & done; wait',
      'ln -s /etc link-out 2>/dev/null; linked=$(head -c 1000 /dev/zero > link-out/escape.bin 2>&1; echo $?)',
      'printf "single_exit=%s repeated_rounds=%s sparse_apparent=%s link_exit=%s\\n" "$single" "$repeated" "$sparse_apparent" "$linked"',
      'printf "used_kb=%s avail_kb=%s\\n" "$(du -sk . | cut -f1)" "$(df -k . | awk \'NR==2{print $4}\')"',
    ].join('; ');
    const seed=await start('quota',probe,FULL_POLICY,LIMITS,20_000);
    const result=await client.executeTool(seed.execution);
    const used=Number(/used_kb=(\d+)/.exec(result.stdout)?.[1]);
    const ceilingKb=Math.ceil(LIMITS.workspaceBytes/1024);
    if(!Number.isFinite(used))throw new Error(`no usage observed in ${JSON.stringify(result.stdout).slice(0,240)}`);
    // Everything above tried to write far more than the ceiling, by five different routes at once.
    if(used>ceilingKb)throw new Error(`the workspace holds ${used} KiB against a ${ceilingKb} KiB ceiling: ${result.stdout.replace(/\s+/g,' ').slice(0,200)}`);
    if(/link_exit=0/.test(result.stdout))throw new Error('a symlink out of the workspace accepted a write');
    return `${ceilingKb} KiB ceiling held at ${used} KiB against a single 8 MB write, 40 appends, a 64 MB sparse file, four concurrent writers and a symlink escape`;
  });
  await evaluate('workspace-ceiling-is-refused-when-it-cannot-be-enforced',async()=>{
    // Declaring a ceiling smaller than the store that backs it is a claim nothing can hold, so it is refused
    // rather than recorded — which is exactly the state this eval used to report BLOCKED.
    const seed=await seedFor('unenforceable','printf never');
    await client.createSandbox({identity:seed.identity,limits:{...LIMITS,workspaceBytes:65_536},policy:FULL_POLICY});
    let outcome='accepted';
    try{await client.prepareWorkspace({sandboxId:seed.identity.sandboxId,sourceRef:workspace,expectedLeaseGeneration:LEASE});}
    catch(error){outcome=error instanceof Error?error.message:String(error);}
    if(!outcome.includes('sandbox_workspace_ceiling_unenforceable'))throw new Error(`observed "${outcome}"`);
    return outcome;
  });
  await evaluate('timeout-kills-the-process-tree',async()=>{
    const seed=await start('timeout','nohup sh -c "sleep 12; printf late >> late-effect.log" >/dev/null 2>&1 & sleep 30',FULL_POLICY,LIMITS,2_000);
    let outcome='resolved';
    try{const result=await client.executeTool(seed.execution);outcome=result.status;}catch(error){outcome=error instanceof Error?error.message:String(error);}
    await new Promise(resolve=>setTimeout(resolve,14_000));
    const survived=await readFile(`${workspace}/late-effect.log`,'utf8').then(()=>true,()=>false);
    if(survived)throw new Error('a daemonised descendant outlived the timeout');
    return `timeout outcome ${outcome}; no descendant survived`;
  });
  await evaluate('cancellation-kills-the-process-tree',async()=>{
    const seed=await start('cancel','nohup sh -c "sleep 4; printf late >> cancel-effect.log" >/dev/null 2>&1 & sleep 25',FULL_POLICY,LIMITS,25_000);
    const running=client.executeTool(seed.execution).then(()=>'completed',error=>error instanceof Error?error.message:String(error));
    await new Promise(resolve=>setTimeout(resolve,2_500));
    const cancelled=await client.cancelExecution({sandboxId:seed.identity.sandboxId,invocationId:seed.invocationId,expectedLeaseGeneration:LEASE});
    const outcome=await running;
    await new Promise(resolve=>setTimeout(resolve,4_000));
    const survived=await readFile(`${workspace}/cancel-effect.log`,'utf8').then(()=>true,()=>false);
    if(survived)throw new Error('a daemonised descendant outlived cancellation');
    return `cancel=${cancelled}; execution answered ${outcome}; no descendant survived`;
  });

  // ── Policy and lease refusals ───────────────────────────────────────────────────────────
  const processDenied=await start('process-denied','printf denied',{...FULL_POLICY,executeProcess:false});
  await refuses('process-execution-denied-by-policy',()=>client.executeTool(processDenied.execution),'sandbox_process_denied');
  const stale=await start('stale','printf stale');
  await refuses('stale-worker-lease-refused',()=>client.executeTool({...stale.execution,expectedLeaseGeneration:LEASE+9}),'sandbox_stale_lease');
  await evaluate('stale-sandbox-refused',async()=>{
    const seed=await start('expired','printf expired');
    await pool.query(`UPDATE relay_wonderland.julius_sandboxes SET expires_at=clock_timestamp()-interval '1 second' WHERE sandbox_id=$1`,[seed.identity.sandboxId]);
    let outcome='resolved';
    try{await client.executeTool(seed.execution);}catch(error){outcome=error instanceof Error?error.message:String(error);}
    if(!outcome.includes('sandbox_expired'))throw new Error(`observed "${outcome}"`);
    return outcome;
  });

  // ── Protocol refusals over the real wire ────────────────────────────────────────────────
  const post=(operation:string,credential:string,payload:unknown)=>fetch(new URL('/v1/execute',endpoint()),{method:'POST',headers:{authorization:`Bearer ${credential}`,'x-julius-operation':operation,'content-type':'application/json'},body:typeof payload==='string'?payload:JSON.stringify(payload)});
  const read=async(response:Response)=>({status:response.status,error:((await response.json().catch(()=>({}))) as {error?:string}).error??''});
  const refusesOverWire=(id:string,operation:string,credential:string,payload:unknown,status:number,code?:string)=>evaluate(id,async()=>{
    const answer=await read(await post(operation,credential,payload));
    if(answer.status!==status||(code!==undefined&&answer.error!==code))throw new Error(`${answer.status} ${answer.error}, expected ${status} ${code??''}`);
    return `${answer.status} ${answer.error}`;
  });
  const envelope=(overrides:Record<string,unknown>={})=>envelopeFor(containment,{nonce:randomUUID(),...overrides});
  const past=new Date(Date.now()-900_000),future=new Date(Date.now()+900_000);
  await refusesOverWire('expired-envelope-refused','execute',scoped.get('execute')!,envelope({issuedAt:past.toISOString(),expiresAt:new Date(past.getTime()+60_000).toISOString()}),400,'INVALID_REQUEST:execution_envelope_expired');
  await refusesOverWire('future-skew-envelope-refused','execute',scoped.get('execute')!,envelope({issuedAt:future.toISOString(),expiresAt:new Date(future.getTime()+60_000).toISOString()}),400,'INVALID_REQUEST:execution_envelope_not_yet_valid');
  await refusesOverWire('malformed-envelope-refused','execute',scoped.get('execute')!,envelope({unexpected:1}),400,'INVALID_REQUEST:execution_envelope:fields_invalid');
  await refusesOverWire('malformed-operation-request-refused','create',scoped.get('create')!,{identity:{},policy:{},limits:{},extra:true},400);
  await refusesOverWire('unauthenticated-request-refused','discover','not-a-credential-at-all',{},401,'unauthorized');
  await refusesOverWire('unknown-operation-refused','sandbox:root',scoped.get('execute')!,{},400,'operation_invalid');
  await refusesOverWire('scope-escalation-refused','destroy',scoped.get('execute')!,{sandboxId:containment.identity.sandboxId,expectedLeaseGeneration:LEASE,reason:'escalation'},403,'operation_scope_refused');
  await refusesOverWire('cross-scope-inspect-from-execute-credential-refused','inspect',scoped.get('execute')!,{sandboxId:containment.identity.sandboxId,tenantId:TENANT,projectId:PROJECT},403,'operation_scope_refused');
  await evaluate('request-replay-returns-original-terminal-material',async()=>{
    const replayed=await client.executeTool(containment.execution);
    if(JSON.stringify(replayed)!==JSON.stringify(containmentResult))throw new Error('replayed material differed from the original');
    const lines=(await readFile(`${workspace}/eval-effects.log`,'utf8')).trim().split('\n').length;
    if(lines!==1)throw new Error(`replay produced a second effect: ${lines} lines`);
    return 'identical terminal material, still exactly one effect';
  });
  await refusesOverWire('asserted-request-digest-refused','execute',scoped.get('execute')!,envelope({requestDigest:'b'.repeat(64)}),400,'INVALID_REQUEST:execution_envelope_request_digest_mismatch');
  await refusesOverWire('request-conflict-is-a-hard-security-failure','execute',scoped.get('execute')!,divergentEnvelope(containment),409,'SECURITY_FAILURE:execution_identity_conflict');

  // ── Cross-tenant isolation ──────────────────────────────────────────────────────────────
  const other=process.env.JULIUS_OTHER_SCOPED_CREDENTIALS?scopedCredentials('JULIUS_OTHER_SCOPED_CREDENTIALS'):null;
  if(other){
    const otherCallerId=required('JULIUS_OTHER_CALLER_ID');
    await refusesOverWire('cross-tenant-invocation-refused','execute',other.get('execute')!,envelope({callerId:otherCallerId}),409,'SECURITY_FAILURE:executor_tenant_scope_refused');
    await refusesOverWire('foreign-caller-identity-refused','execute',other.get('execute')!,envelope(),400,'INVALID_REQUEST:execution_envelope_scope_refused');
    await refusesOverWire('cross-tenant-inspection-refused','inspect',other.get('inspect')!,{sandboxId:containment.identity.sandboxId,tenantId:TENANT,projectId:PROJECT},409,'SECURITY_FAILURE:executor_tenant_scope_refused');
    await refusesOverWire('cross-tenant-artifact-collection-refused','artifacts',other.get('artifacts')!,{sandboxId:containment.identity.sandboxId,invocationId:containment.invocationId,expectedLeaseGeneration:LEASE},409,'SECURITY_FAILURE:executor_tenant_scope_refused');
    await refusesOverWire('cross-tenant-destruction-refused','destroy',other.get('destroy')!,{sandboxId:containment.identity.sandboxId,expectedLeaseGeneration:LEASE,reason:'cross-tenant'},409,'SECURITY_FAILURE:executor_tenant_scope_refused');
  } else {
    for(const id of ['cross-tenant-invocation-refused','foreign-caller-identity-refused','cross-tenant-inspection-refused','cross-tenant-artifact-collection-refused','cross-tenant-destruction-refused'])
      results.push({id,verdict:'BLOCKED',detail:'no second tenant configured: set JULIUS_OTHER_SCOPED_CREDENTIALS'});
  }

  // ── Receipt forgery and receipt replay ──────────────────────────────────────────────────
  const terminal=await (await post('execute',scoped.get('execute')!,envelopeFor(containment))).json() as {attestations:readonly SignedExecutorAttestation[];receiptBodies:Record<'BEFORE'|'AFTER',string>};
  const genuine=terminal.attestations.find(item=>item.attestation.phase==='AFTER')!;
  await evaluate('forged-receipt-refused',async()=>{
    const forged={...genuine,attestation:{...genuine.attestation,receiptDigest:sha('a receipt the executor never signed')}};
    try{verifyExecutorAttestation(forged as SignedExecutorAttestation,trustedReceiptKeys,{phase:'AFTER',executionIdentity:forged.attestation.executionIdentity,invocationId:forged.attestation.invocationId,dispatchGeneration:forged.attestation.dispatchGeneration,sandboxId:forged.attestation.sandboxId,requestDigest:forged.attestation.requestDigest,receiptDigest:forged.attestation.receiptDigest});}
    catch(error){return error instanceof Error?error.message:String(error);}
    throw new Error('a forged receipt digest verified against the executor public key');
  });
  await evaluate('signed-receipt-replay-across-executions-refused',async()=>{
    try{verifyExecutorAttestation(genuine,trustedReceiptKeys,{phase:'AFTER',executionIdentity:'other-invocation:1:other-sandbox',invocationId:'other-invocation',dispatchGeneration:1,sandboxId:'other-sandbox',requestDigest:genuine.attestation.requestDigest,receiptDigest:genuine.attestation.receiptDigest});}
    catch(error){return error instanceof Error?error.message:String(error);}
    throw new Error('a genuine receipt verified for a different execution identity');
  });

  // ── Scheduler and reconciliation ────────────────────────────────────────────────────────
  await evaluate('concurrent-scheduler-claims-are-exclusive',async()=>{
    const seed=await seedFor('claims','printf never',10_000,false);
    const now=new Date().toISOString(),until=new Date(Date.now()+120_000).toISOString();
    const [left,right]=await Promise.all([tools.claimDispatch({claimedBy:'scheduler-a',now,claimedUntil:until,limit:8}),tools.claimDispatch({claimedBy:'scheduler-b',now,claimedUntil:until,limit:8})]);
    const winners=[...left,...right].filter(entry=>entry.invocation.invocationId===seed.invocationId);
    if(winners.length!==1)throw new Error(`${winners.length} schedulers claimed the same dispatch`);
    return 'exactly one scheduler claimed the dispatch';
  });
  await evaluate('cross-tenant-workspace-mount-refused',async()=>{
    const foreign=process.env.JULIUS_FOREIGN_WORKSPACE;
    if(!foreign)throw new Blocked('no second tenant workspace configured: set JULIUS_FOREIGN_WORKSPACE');
    const seed=await seedFor('foreign-workspace','printf never');
    await client.createSandbox({identity:seed.identity,limits:LIMITS,policy:FULL_POLICY});
    const direct=await read(await post('prepare',scoped.get('prepare')!,{sandboxId:seed.identity.sandboxId,sourceRef:foreign,expectedLeaseGeneration:LEASE}));
    if(direct.status!==409||direct.error!=='SECURITY_FAILURE:executor_workspace_tenant_scope_refused')throw new Error(`direct: ${direct.status} ${direct.error}`);
    // The direct form was never the interesting one: a symlink planted inside the tenant's own workspace
    // is lexically contained and resolves elsewhere, which is how the first version of this gate was beaten.
    const planted=`${workspace}/escape-to-other-tenant`;
    // Unguarded, and confirmed to be a symlink: swallowing the failure would let this case pass while
    // refusing a path that simply does not exist, proving nothing about the boundary it names.
    await rm(planted,{force:true});
    await symlink(foreign,planted);
    if(!(await lstat(planted)).isSymbolicLink())throw new Error('symlink_not_planted');
    const viaSymlink=await read(await post('prepare',scoped.get('prepare')!,{sandboxId:seed.identity.sandboxId,sourceRef:planted,expectedLeaseGeneration:LEASE}));
    if(viaSymlink.status!==409||viaSymlink.error!=='SECURITY_FAILURE:executor_workspace_tenant_scope_refused')throw new Error(`symlink: ${viaSymlink.status} ${viaSymlink.error}`);
    return `direct and symlinked both ${viaSymlink.status} ${viaSymlink.error}`;
  });
  const operator=process.env.JULIUS_OPERATOR_SCOPED_CREDENTIALS?scopedCredentials('JULIUS_OPERATOR_SCOPED_CREDENTIALS'):null;
  for(const fleet of ['discover','reconcile','quarantine'] as const)
    await refusesOverWire(`tenant-credential-refused-${fleet}`,fleet,scoped.get('execute')!,fleet==='quarantine'?{runtimeId:'julius-postgres',reason:'x'}:{},403,'operation_scope_refused');
  if(operator){
    // The scope reaches `docker rm -f`, so a runtime id that is not a Julius sandbox must be refused outright.
    await refusesOverWire('quarantine-of-a-non-sandbox-container-refused','quarantine',operator.get('quarantine')!,{runtimeId:'julius-postgres',reason:'audit'},409,'SECURITY_FAILURE:executor_quarantine_target_unknown');
    await refusesOverWire('quarantine-of-an-unknown-runtime-id-refused','quarantine',operator.get('quarantine')!,{runtimeId:'definitely-not-a-container',reason:'audit'},409,'SECURITY_FAILURE:executor_quarantine_target_unknown');
  } else for(const id of ['quarantine-of-a-non-sandbox-container-refused','quarantine-of-an-unknown-runtime-id-refused'])
    results.push({id,verdict:'BLOCKED',detail:'no operator authority configured: set JULIUS_OPERATOR_SCOPED_CREDENTIALS'});
  await evaluate('orphan-sandbox-quarantined',async()=>{
    if(!process.env.JULIUS_ORPHAN_EXPECTED)throw new Blocked('no orphan container was planted: set JULIUS_ORPHAN_EXPECTED=1');
    if(!operator)throw new Blocked('reconciliation is an operator authority: set JULIUS_OPERATOR_SCOPED_CREDENTIALS');
    const operatorClient=new RemoteExecutorControlPlane({endpoint:endpoint(),serviceCredential:operator.get('reconcile')!,scopedCredentials:operator,callerId:'julius-operator',tenantId:TENANT,requestTimeoutMs:60_000,trustedReceiptKeys,allowInsecureLoopbackForTests:true});
    const reconciliation=await operatorClient.reconcileSandboxes();
    if(reconciliation.quarantined<1)throw new Error(`quarantined=${reconciliation.quarantined}`);
    return `quarantined=${reconciliation.quarantined} destroyed=${reconciliation.destroyed} recovered=${reconciliation.recovered}`;
  });
  // Last: an oversized body is refused mid-upload, which retires the connection it arrived on.
  await evaluate('oversized-request-refused',async()=>{
    // Posted on an operation this tenant actually holds: an unheld scope answers 401 before the body is read.
    try{const answer=await read(await post('create',scoped.get('create')!,`{"pad":"${'p'.repeat(1_200_000)}"}`));
      if(answer.status!==413)throw new Error(`${answer.status} ${answer.error}`);return `${answer.status} ${answer.error}`;}
    catch(error){const message=error instanceof Error?error.message:String(error);if(/^\d{3} /.test(message))throw error;return `transport refused the oversized body: ${message}`;}
  });
  results.push({id:'bounded-subagent-fan-out',verdict:'BLOCKED',detail:'the subagent bound is a Julius kernel property with no executor surface; it is covered by the offline suite (julius-subagent-runtime.test.ts) and is not exercised by this sibling harness'});
  results.push({id:'crash-after-effect-and-before-only-unknown',verdict:'BLOCKED',detail:'exercised by the interrupted and replay phases of julius-sibling-e2e, not by this suite'});

  await pool.end();
  const width=Math.max(...results.map(entry=>entry.id.length));
  for(const entry of results)process.stdout.write(`${entry.verdict.padEnd(7)} ${entry.id.padEnd(width)}  ${entry.detail}\n`);
  const failed=results.filter(entry=>entry.verdict==='FAIL');
  process.stdout.write(`\nEVALS pass=${results.filter(entry=>entry.verdict==='PASS').length} fail=${failed.length} blocked=${results.filter(entry=>entry.verdict==='BLOCKED').length}\n`);
  if(failed.length)throw new Error(`provider_independent_evals_failed:${failed.map(entry=>entry.id).join(',')}`);
  process.stdout.write('PROVIDER_INDEPENDENT_EVALS_GREEN\n');
}

void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:error}\n`);process.exitCode=1;});
