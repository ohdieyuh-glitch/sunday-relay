import { afterEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { SandboxExecutionPort, ToolInvocationResult } from '../../mission/julius';
import { DockerExecutorReceiptStore } from './executor-receipt-store';
import { createDurableReceiptAttestor, createExecutorControlPlaneService } from './executor-control-plane-service';
import { RemoteExecutorControlPlane } from './remote-executor-control-plane';
import { FilesystemExecutionLedger, FilesystemSandboxTenancyLedger } from './durable-execution-ledger';
import { deriveScopedCredential, deriveCallerAuthorities } from './executor-scoped-credential';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

const sha=(value:string)=>createHash('sha256').update(value).digest('hex'),digest=sha('scope');
const beforeBody=`receiptVersion=1\nphase=BEFORE\nmanifestDigest=${digest}\ninvocationId=inv\ndispatchGeneration=2\nsandboxId=sandbox\ntenantDigest=${digest}\nprojectDigest=${digest}\nrunDigest=${digest}\ntaskDigest=${digest}\nworkerDigest=${digest}\ntoolId=shell.bash\ntoolVersion=1\nrequestDigest=${'a'.repeat(64)}\npolicyDigest=${digest}\nleaseGeneration=1\nimageDigest=${digest}\nexecutorIdentity=executor\npreTreeDigest=${digest}\nstartedAt=2026-08-31T00:00:00.000Z\n`;
const afterDigest=sha(['0','1',sha(''),sha(''),digest,sha('')].join('\n'));
const afterBody=`receiptVersion=1\nphase=AFTER\nmanifestDigest=${digest}\ninvocationId=inv\ndispatchGeneration=2\nsandboxId=sandbox\nrequestDigest=${'a'.repeat(64)}\nexecutorIdentity=executor\nterminalState=SUCCEEDED\nexitCode=0\ndurationMs=1\nfinishedAt=2026-08-31T00:00:01.000Z\nstdoutDigest=${sha('')}\nstderrDigest=${sha('')}\npreTreeDigest=${digest}\npostTreeDigest=${digest}\nchangedPathsDigest=${sha('')}\noutputBytes=0\nexecutorResultDigest=${afterDigest}\n`;
const result:ToolInvocationResult={invocationId:'inv',status:'SUCCEEDED',exitCode:0,safeSummary:'Sandbox command completed.',stdout:'',stderr:'',stdoutRef:null,stderrRef:null,artifacts:[],evidence:[],durationMs:1,resourceUsage:{toolCalls:1,runtimeMs:1,outputBytes:0},policyDecisionRef:'policy',mutations:[]};
const physical = (execute:()=>Promise<ToolInvocationResult>):SandboxExecutionPort => ({
  createSandbox:async input=>({...input.identity,state:'CREATING',workspaceRef:null,runtimeKind:'test',limits:input.limits,policy:input.policy,safeFailure:null}),
  prepareWorkspace:async()=>{throw new Error("ENOENT: no such file or directory, open '/tmp/julius-executor/receipts/abc/before.receipt'");},executeTool:async()=>execute(),cancelExecution:async()=>true,destroySandbox:async()=>true,
  inspectSandbox:async()=>null,collectArtifacts:async()=>[],discoverSandboxes:async()=>[],quarantineSandbox:async()=>true,reconcileSandboxes:async()=>({recovered:0,lost:0,quarantined:0,destroyed:0}),
});

describe('executor control-plane service',()=>{
  it('keeps the private key server-side and returns verified BEFORE and AFTER attestations',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-control-plane-'));roots.push(root);
    const receipts=new DockerExecutorReceiptStore(root),token='e'.repeat(64),sandboxId='sandbox';
    const directory=receipts.directory(token,sandboxId);await mkdir(directory,{recursive:true});
    const keys=generateKeyPairSync('ed25519');
    const executionLedger=new FilesystemExecutionLedger(join(root,'ledger')),tenancyLedger=new FilesystemSandboxTenancyLedger(join(root,'tenancy'));
    const attest=createDurableReceiptAttestor({keyId:'current',privateSigningKey:keys.privateKey,receipts,executionLedger});
    const allOperations=new Set(['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile'] as const);
    let physicalEffects=0;
    const server=createExecutorControlPlaneService({callerAuthorities:[{callerId:'julius-prod',tenantId:'tenant',credential:'caller',operations:allOperations},{callerId:'execute-only',tenantId:'tenant',credential:'execute-only-secret',operations:new Set(['execute'] as const)},{callerId:'other-tenant',tenantId:'other',credential:'other-tenant-secret',operations:allOperations}],keyId:'current',privateSigningKey:keys.privateKey,receipts,executionLedger,tenancyLedger,physical:physical(async()=>{physicalEffects++;await writeFile(join(directory,'request.json'),JSON.stringify({invocationId:'inv',dispatchGeneration:2,sandboxId,requestDigest:'a'.repeat(64)}),{flag:'wx'});await writeFile(join(directory,'before.receipt'),beforeBody,{flag:'wx'});await writeFile(join(directory,'stdout'),'',{flag:'wx'});await writeFile(join(directory,'stderr'),'',{flag:'wx'});await writeFile(join(directory,'changed-paths'),'',{flag:'wx'});await attest({phase:'BEFORE',executionTokenHash:token,sandboxId});await writeFile(join(directory,'after.receipt'),afterBody,{flag:'wx'});await attest({phase:'AFTER',executionTokenHash:token,sandboxId});return result;})});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address() as AddressInfo;
      const client=new RemoteExecutorControlPlane({endpoint:new URL(`http://127.0.0.1:${address.port}`),serviceCredential:'caller',callerId:'julius-prod',tenantId:'tenant',requestTimeoutMs:1000,trustedReceiptKeys:new Map([['current',keys.publicKey]]),allowInsecureLoopbackForTests:true});
      const execution={sandboxId,expectedLeaseGeneration:1,dispatchGeneration:2,requestDigest:'a'.repeat(64),executionTokenHash:token,effectClassification:'NON_IDEMPOTENT_MUTATION' as const,request:{invocationId:'inv',projectId:'project',runId:'run',taskId:'task',workerId:'worker',toolId:'shell.bash' as const,toolVersion:'1',arguments:{command:'true'},cwd:'.',timeoutMs:1000,idempotencyKey:'key',expectedMutation:'WORKSPACE' as const}};
      const identity={sandboxId,invocationId:'inv',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',leaseGeneration:1,policyRevision:'policy',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
      const limits={cpuCount:1,memoryBytes:134_217_728,pids:32,openFiles:128,workspaceBytes:10_485_760,outputBytes:32_768,wallClockMs:10_000,concurrentProcesses:4};
      const policy={readWorkspace:true,mutateWorkspace:true,executeProcess:true,network:'DENY' as const,allowedTools:['shell.bash']};
      await expect(client.createSandbox({identity,policy,limits})).resolves.toMatchObject({sandboxId,state:'CREATING'});
      await expect(client.executeTool(execution)).resolves.toEqual(result);
      await expect(client.executeTool(execution)).resolves.toEqual(result);
      expect(physicalEffects).toBe(1);
      await expect(fetch(`http://127.0.0.1:${address.port}/v1/execute`,{method:'POST',headers:{authorization:'Bearer wrong','x-julius-operation':'discover','content-type':'application/json'},body:'{}'}).then(x=>x.status)).resolves.toBe(401);
      await expect(fetch(`http://127.0.0.1:${address.port}/v1/execute`,{method:'POST',headers:{authorization:'Bearer execute-only-secret','x-julius-operation':'discover','content-type':'application/json'},body:'{}'}).then(x=>x.status)).resolves.toBe(403);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });

  it('refuses every bypass of the one production execution path',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-control-plane-bypass-'));roots.push(root);
    const receipts=new DockerExecutorReceiptStore(root),token='f'.repeat(64),sandboxId='sandbox';
    const directory=receipts.directory(token,sandboxId);await mkdir(directory,{recursive:true});
    const keys=generateKeyPairSync('ed25519');
    const executionLedger=new FilesystemExecutionLedger(join(root,'ledger')),tenancyLedger=new FilesystemSandboxTenancyLedger(join(root,'tenancy'));
    const attest=createDurableReceiptAttestor({keyId:'current',privateSigningKey:keys.privateKey,receipts,executionLedger});
    const rootSecret='executor-root-secret-value';
    let physicalEffects=0,release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    const server=createExecutorControlPlaneService({callerAuthorities:[...deriveCallerAuthorities({rootSecret,callerId:'julius-prod',tenantId:'tenant'}),{callerId:'other-tenant',tenantId:'other',credential:'other-tenant-secret',operations:new Set(['create'] as const)}],keyId:'current',privateSigningKey:keys.privateKey,receipts,executionLedger,tenancyLedger,physical:physical(async()=>{physicalEffects++;await gate;await writeFile(join(directory,'request.json'),JSON.stringify({invocationId:'inv',dispatchGeneration:2,sandboxId,requestDigest:'a'.repeat(64)}),{flag:'wx'});await writeFile(join(directory,'before.receipt'),beforeBody,{flag:'wx'});await writeFile(join(directory,'stdout'),'',{flag:'wx'});await writeFile(join(directory,'stderr'),'',{flag:'wx'});await writeFile(join(directory,'changed-paths'),'',{flag:'wx'});await attest({phase:'BEFORE',executionTokenHash:token,sandboxId});await writeFile(join(directory,'after.receipt'),afterBody,{flag:'wx'});await attest({phase:'AFTER',executionTokenHash:token,sandboxId});return result;})});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address() as AddressInfo,base=`http://127.0.0.1:${address.port}/v1/execute`;
      const post=(operation:string,credential:string,payload:unknown)=>fetch(base,{method:'POST',headers:{authorization:`Bearer ${credential}`,'x-julius-operation':operation,'content-type':'application/json'},body:JSON.stringify(payload)});
      const read=async(response:Response)=>({status:response.status,error:((await response.json()) as {error?:string}).error});
      const scoped=(operation:Parameters<typeof deriveScopedCredential>[1])=>deriveScopedCredential(rootSecret,operation);
      const identity={sandboxId,invocationId:'inv',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',leaseGeneration:1,policyRevision:'policy',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
      const limits={cpuCount:1,memoryBytes:134_217_728,pids:32,openFiles:128,workspaceBytes:10_485_760,outputBytes:32_768,wallClockMs:10_000,concurrentProcesses:4};
      const policy={readWorkspace:true,mutateWorkspace:true,executeProcess:true,network:'DENY',allowedTools:['shell.bash']};
      const envelope=(overrides:Record<string,unknown>={})=>({schemaVersion:1,callerId:'julius-prod',callerScope:'sandbox:execute',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',invocationId:'inv',dispatchGeneration:2,sandboxId,requestDigest:'a'.repeat(64),executionIdentity:`inv:2:${sandboxId}`,nonce:'nonce',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),payload:{expectedLeaseGeneration:1,executionTokenHash:token,effectClassification:'NON_IDEMPOTENT_MUTATION',request:{invocationId:'inv',projectId:'project',runId:'run',taskId:'task',workerId:'worker',toolId:'shell.bash',toolVersion:'1',arguments:{command:'true'},cwd:'.',timeoutMs:1000,idempotencyKey:'key',expectedMutation:'WORKSPACE'}},...overrides});

      // One operation is one credential: the execute credential can never destroy, and the create credential can never execute.
      expect(scoped('execute')).not.toBe(scoped('destroy'));
      expect(await read(await post('destroy',scoped('execute'),{sandboxId,expectedLeaseGeneration:1,reason:'x'}))).toMatchObject({status:403,error:'operation_scope_refused'});
      expect(await read(await post('execute',scoped('create'),envelope()))).toMatchObject({status:403});

      // A caller-shaped object never reaches the physical adapter: unknown and malformed fields are refused at the boundary.
      expect((await read(await post('create',scoped('create'),{identity,policy,limits,extra:1}))).status).toBe(400);
      expect((await read(await post('create',scoped('create'),{identity:{...identity,leaseGeneration:0},policy,limits}))).status).toBe(400);
      expect((await read(await post('quarantine',scoped('quarantine'),{runtimeId:'r'}))).status).toBe(400);

      // A sandbox belongs to the tenant that created it, and to no other.
      expect(await read(await post('create',scoped('create'),{identity:{...identity,tenantId:'other'},policy,limits}))).toMatchObject({status:409,error:'SECURITY_FAILURE:executor_tenant_scope_refused'});
      expect(await read(await post('execute',scoped('execute'),envelope()))).toMatchObject({status:409,error:'SECURITY_FAILURE:executor_sandbox_unbound'});
      expect((await post('create',scoped('create'),{identity,policy,limits})).status).toBe(200);
      expect(await read(await post('create','other-tenant-secret',{identity:{...identity,tenantId:'other'},policy,limits}))).toMatchObject({status:409,error:'SECURITY_FAILURE:executor_tenant_scope_refused'});

      // An envelope that has already expired is refused against this service's clock, never against its own issuedAt.
      const stale=new Date(Date.now()-600_000);
      expect(await read(await post('execute',scoped('execute'),envelope({issuedAt:stale.toISOString(),expiresAt:new Date(stale.getTime()+60_000).toISOString()})))).toMatchObject({status:400,error:'INVALID_REQUEST:execution_envelope_expired'});
      const future=new Date(Date.now()+600_000);
      expect(await read(await post('execute',scoped('execute'),envelope({issuedAt:future.toISOString(),expiresAt:new Date(future.getTime()+60_000).toISOString()})))).toMatchObject({status:400,error:'INVALID_REQUEST:execution_envelope_not_yet_valid'});
      expect(physicalEffects).toBe(0);

      // Two concurrent identical requests: the reservation, not the lookup, decides, so only one can reach a physical effect.
      const concurrent=Promise.all([post('execute',scoped('execute'),envelope()),post('execute',scoped('execute'),envelope())]);
      await new Promise(resolve=>setTimeout(resolve,50));release();
      const [first,second]=await concurrent;const outcomes=[await read(first),await read(second)].sort((a,b)=>a.status-b.status);
      expect(physicalEffects).toBe(1);
      expect(outcomes[0].status).toBe(200);
      expect(outcomes[1]).toMatchObject({status:409,error:'STARTED_UNKNOWN_OUTCOME'});

      // The same execution identity carrying a different request is a hard conflict, never a second execution.
      expect(await read(await post('execute',scoped('execute'),envelope({requestDigest:'b'.repeat(64)})))).toMatchObject({status:409,error:'SECURITY_FAILURE:execution_identity_conflict'});
      expect(physicalEffects).toBe(1);
      // A filesystem message never crosses the boundary: Julius is not allowed to learn the receipt-store path.
      const leaky=await read(await post('prepare',scoped('prepare'),{sandboxId,sourceRef:'/tmp/nowhere',expectedLeaseGeneration:1}));
      expect(leaky).toMatchObject({status:500,error:'executor_failure'});

      // The settled execution replays its original terminal material verbatim.
      expect((await post('execute',scoped('execute'),envelope())).status).toBe(200);
      expect(physicalEffects).toBe(1);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  },20_000);
});
