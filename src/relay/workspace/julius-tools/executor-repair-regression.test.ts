import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { SandboxExecutionPort } from '../../mission/julius';
import { createExecutorControlPlaneService, executionGateOpened } from './executor-control-plane-service';
import { DockerExecutorReceiptStore } from './executor-receipt-store';
import { FilesystemSandboxTenancyLedger } from './durable-execution-ledger';
import { DockerJuliusSandboxAdapter, admitAcrossRoots, permittedWorkspace, workspaceContained } from './docker-sandbox-adapter';
import { RemoteExecutorControlPlane, assertKnownPayloadEncoding } from './remote-executor-control-plane';
import { FilesystemExecutionLedger, durablePublish } from './durable-execution-ledger';
import { parseExecutorCallers } from './executor-scoped-credential';
import { canonicalRequestDigest, executionReplayDigest, parseExecutorExecutionEnvelope } from './execution-envelope';
import { deriveToolInvocationResult, parseExecutorAfterReceipt } from './executor-terminal-receipt';

/*
 * Each case here is a branch that a previous review round repaired and left untested — which is exactly
 * where the following round found the next defect. They are held here so the next repair cannot quietly
 * undo one of them.
 */

const REQUEST={invocationId:'inv',runId:'run',taskId:'task',projectId:'project',workerId:'worker',toolId:'shell.bash' as const,toolVersion:'1',arguments:{command:'true'},idempotencyKey:'key',expectedMutation:'WORKSPACE' as const};
const envelopeFor=(request:typeof REQUEST)=>({schemaVersion:1,callerId:'julius-prod',callerScope:'sandbox:execute',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',invocationId:'inv',dispatchGeneration:1,sandboxId:'sandbox',requestDigest:canonicalRequestDigest(request),executionIdentity:'inv:1:sandbox',nonce:'nonce',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),payload:{expectedLeaseGeneration:1,executionTokenHash:'b'.repeat(64),effectClassification:'NON_IDEMPOTENT_MUTATION',request}});

describe('repairs that previous rounds left untested',()=>{
  it('refuses a workspace reached through a symlink the tenant planted in its own',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-ws-'));
    await mkdir(join(root,'mine'));await mkdir(join(root,'theirs'));
    await writeFile(join(root,'theirs','private.txt'),'secret');
    await symlink(join(root,'theirs'),join(root,'mine','escape'));
    // The lexical shape is contained; only resolving it shows where it actually goes.
    expect(workspaceContained(join(root,'mine'),join(root,'mine','escape'))).toBe(true);
    expect(await permittedWorkspace(join(root,'mine'),join(root,'mine','escape'))).toBeNull();
    expect(await permittedWorkspace(join(root,'mine'),join(root,'mine'))).toBe(resolve(root,'mine'));
    expect(await permittedWorkspace(join(root,'mine'),join(root,'theirs'))).toBeNull();
    // A real subdirectory must be ADMITTED, or a gate that refuses everything but the root passes this case.
    await mkdir(join(root,'mine','project'));
    expect(await permittedWorkspace(join(root,'mine'),join(root,'mine','project'))).toBe(resolve(root,'mine','project'));
    // And a root legitimately reached through a symlink must still work, or ordinary deployments break.
    await symlink(join(root,'mine'),join(root,'mine-link'));
    expect(await permittedWorkspace(join(root,'mine-link'),join(root,'mine-link','project'))).toBe(resolve(root,'mine','project'));
  });

  /* An empty root resolves to the process's own working directory, so a path under THAT directory is the
     only place the missing guard shows: anywhere else, containment against cwd refuses it anyway and the
     assertion passes while blind. */
  it('refuses an empty root outright rather than resolving it to the working directory',async()=>{
    expect(await permittedWorkspace('',process.cwd())).toBeNull();
    expect(await permittedWorkspace(process.cwd(),process.cwd())).toBe(process.cwd());
  });

  it('accepts a child whose name merely begins with two dots',()=>{
    expect(workspaceContained('/srv/ws','/srv/ws/..foo')).toBe(true);
    expect(workspaceContained('/srv/ws','/srv/foo')).toBe(false);
    expect(workspaceContained('/srv/ws','/srv/ws')).toBe(true);
  });

  it('digests an envelope that omits every optional field',()=>{
    const parsed=parseExecutorExecutionEnvelope(envelopeFor(REQUEST));
    expect(executionReplayDigest(parsed)).toMatch(/^[a-f0-9]{64}$/);
    const withCwd=parseExecutorExecutionEnvelope(envelopeFor({...REQUEST,cwd:'sub'} as never));
    expect(executionReplayDigest(withCwd)).not.toBe(executionReplayDigest(parsed));
    // The point of the replay digest is that a legitimately reissued envelope matches. Without this a digest
    // that included the nonce would pass every other assertion and refuse every honest retry.
    const retry=parseExecutorExecutionEnvelope({...envelopeFor(REQUEST),nonce:'a-different-nonce',issuedAt:new Date(Date.now()+1_000).toISOString(),expiresAt:new Date(Date.now()+61_000).toISOString()});
    expect(executionReplayDigest(retry)).toBe(executionReplayDigest(parsed));
  });

  it('reads a ledger entry written before terminalStatus existed',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-legacy-'));
    const ledger=new FilesystemExecutionLedger(root);
    const identity='inv:1:sandbox',requestDigest='a'.repeat(64);
    const legacy={executionIdentity:identity,requestDigest,envelopeDigest:'b'.repeat(64),state:'TERMINAL',resultDigest:'c'.repeat(64),terminalResponse:'{"original":true}',updatedAt:new Date().toISOString()};
    await mkdir(root,{recursive:true});
    await durablePublish(join(root,`${(await import('node:crypto')).createHash('sha256').update(identity).digest('hex')}.json`),JSON.stringify(legacy));
    const entry=await ledger.load(identity);
    expect(entry).toMatchObject({state:'TERMINAL',terminalResponse:'{"original":true}',terminalStatus:200});
  });

  it('seals a terminal answer twice over without colliding on its own temporary file',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-seal-'));
    const ledger=new FilesystemExecutionLedger(root);
    const identity='inv:1:sandbox',requestDigest='a'.repeat(64),now=new Date().toISOString();
    await ledger.reserve({executionIdentity:identity,requestDigest,envelopeDigest:'b'.repeat(64),now});
    let from:'PREPARED'|'BEFORE_DURABLE'|'RUNNING'='PREPARED';
    for(const to of ['BEFORE_DURABLE','RUNNING','AFTER_DURABLE'] as const){await ledger.transition({executionIdentity:identity,requestDigest,from,to,now});from=to as typeof from;}
    const seal=()=>ledger.transition({executionIdentity:identity,requestDigest,from:'AFTER_DURABLE',to:'TERMINAL',resultDigest:'c'.repeat(64),terminalResponse:'{"sealed":true}',terminalStatus:200,now});
    const settled=await Promise.allSettled([seal(),seal(),seal(),seal()]);
    expect(settled.filter(entry=>entry.status==='rejected').map(entry=>(entry as PromiseRejectedResult).reason?.message)).toEqual([]);
  });

  it('grants fleet authority only where the caller table says so',()=>{
    const root='a-root-secret-long-enough-to-pass';
    expect(parseExecutorCallers(JSON.stringify([{callerId:'operator',tenantId:'tenant',credentialRoot:root,operations:['discover','reconcile','quarantine'],fleet:true}]))[0].fleet).toBe(true);
    // Declaring an operator operation must not confer the authority the gates reading it check for.
    expect(parseExecutorCallers(JSON.stringify([{callerId:'operator',tenantId:'tenant',credentialRoot:root,operations:['quarantine']}]))[0].fleet).toBe(false);
    // A caller is a tenant or a fleet operator, never both.
    expect(()=>parseExecutorCallers(JSON.stringify([{callerId:'mixed',tenantId:'tenant',credentialRoot:root,operations:['execute','quarantine']}]))).toThrow('executor_callers_mixed_authority');
    expect(()=>parseExecutorCallers(JSON.stringify([{callerId:'mixed',tenantId:'tenant',credentialRoot:root,operations:['execute'],fleet:true}]))).toThrow('executor_callers_invalid');
  });
});

/*
 * The cases above bind helpers. Three review rounds found their Critical in a GATE, not in a helper — a
 * lexical check in front of a realpath, a fleet flag nothing could fail, a release keyed on a file whose
 * path omits part of the identity. These stand the real service up and post at it.
 */
describe('the gates themselves, not the helpers behind them',()=>{
  const physical=(received:{input?:{sourceRef:string;permittedWorkspaceRoot?:string}}):SandboxExecutionPort=>({
    createSandbox:async input=>({...input.identity,state:'CREATING',workspaceRef:null,runtimeKind:'test',limits:input.limits,policy:input.policy,safeFailure:null}),
    prepareWorkspace:async input=>{received.input=input as typeof received.input;throw new Error('prepare_reached_the_adapter');},
    executeTool:async()=>{throw new Error('unused');},cancelExecution:async()=>true,destroySandbox:async()=>true,
    inspectSandbox:async()=>null,collectArtifacts:async()=>[],discoverSandboxes:async()=>[],quarantineSandbox:async()=>true,reconcileSandboxes:async()=>({recovered:0,lost:0,quarantined:0,destroyed:0}),
  });

  it('refuses a workspace outside the tenant root, and one reached by a symlink planted inside it',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-gate-'));
    const workspaces=join(root,'workspaces');
    await mkdir(join(workspaces,'tenant'),{recursive:true});await mkdir(join(workspaces,'other'),{recursive:true});
    await symlink(join(workspaces,'other'),join(workspaces,'tenant','escape'));
    const keys=generateKeyPairSync('ed25519');
    const received:{input?:{sourceRef:string;permittedWorkspaceRoot?:string}}={};
    // prepare is sandbox scoped, so the sandbox must already belong to this tenant for the request to
    // reach the workspace gate at all — otherwise the test would pass on the wrong refusal.
    const tenancyLedger=new FilesystemSandboxTenancyLedger(join(root,'tenancy'));
    await tenancyLedger.bind({sandboxId:'sandbox',tenantId:'tenant'});
    const server=createExecutorControlPlaneService({
      callerAuthorities:[{callerId:'julius-prod',tenantId:'tenant',credential:'tenant-secret',operations:new Set(['prepare'] as const)}],
      keyId:'current',privateSigningKey:keys.privateKey,physical:physical(received),
      receipts:new DockerExecutorReceiptStore(join(root,'receipts')),
      executionLedger:new FilesystemExecutionLedger(join(root,'ledger')),
      tenancyLedger,
      tenantWorkspaceRoot:workspaces,
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const port=(server.address() as AddressInfo).port;
      const prepare=(sourceRef:string)=>fetch(`http://127.0.0.1:${port}/v1/execute`,{method:'POST',headers:{authorization:'Bearer tenant-secret','x-julius-operation':'prepare','content-type':'application/json'},body:JSON.stringify({sandboxId:'sandbox',sourceRef,expectedLeaseGeneration:1})}).then(async response=>({status:response.status,error:((await response.json()) as {error?:string}).error}));
      const refusal={status:409,error:'SECURITY_FAILURE:executor_workspace_tenant_scope_refused'};
      expect(await prepare(join(workspaces,'other'))).toMatchObject(refusal);
      expect(await prepare(join(workspaces,'tenant','escape'))).toMatchObject(refusal);
      /* The tenant's own workspace must get PAST the gate and reach the adapter, or a gate that refuses
         everything would satisfy the two refusals above and this test would prove nothing. And what reaches
         the adapter must be the RESOLVED path plus the tenant's root: forwarding the caller's raw string, or
         dropping the root, silently returns the boundary to the form that let a relink cross tenants. */
      /* Posted through a symlinked spelling so the raw and resolved forms DIFFER: with a path that is already
         its own realpath, forwarding the caller's string is indistinguishable from forwarding the resolved
         one, and the assertion proves nothing. */
      await symlink(join(workspaces,'tenant'),join(workspaces,'tenant-alias'));
      expect((await prepare(join(workspaces,'tenant-alias'))).error).toBe('prepare_reached_the_adapter');
      expect(received.input).toEqual({sandboxId:'sandbox',expectedLeaseGeneration:1,sourceRef:await realpath(join(workspaces,'tenant')),permittedWorkspaceRoot:join(workspaces,'tenant')});
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  },20_000);
});

/*
 * A mutation battery showed four of the last round's repairs could be silently undone: the release gate's
 * identity comparison, the encoding stamp, the additive receipt field, and its value guard. Each is bound here.
 */
describe('repairs a mutation battery showed were undefended',()=>{
  const gateFor=(executionIdentity:string)=>JSON.stringify({attestation:{version:1,keyId:'k',phase:'BEFORE',executionIdentity,invocationId:'inv',dispatchGeneration:1,sandboxId:'sandbox',requestDigest:'a'.repeat(64),receiptDigest:'b'.repeat(64),issuedAt:new Date().toISOString()},signature:'x'});
  // The real predicate the service uses, not a copy of it: a test that reimplements the rule it checks
  // passes whatever the production code does, which is how the last round's suite missed this repair.
  const opened=async(body:string|null,identity:string)=>{
    const root=await mkdtemp(join(tmpdir(),'julius-gate-file-'));const gate=join(root,'before.attestation');
    if(body!==null)await writeFile(gate,body);
    return executionGateOpened(gate,identity);
  };
  it('releases only when the gate provably never opened for this execution',async()=>{
    expect(await opened(null,'inv:1:sandbox')).toBe(false);                    // absent: never opened, release
    expect(await opened(gateFor('inv:1:sandbox'),'inv:1:sandbox')).toBe(true); // this execution: hold
    expect(await opened(gateFor('inv:2:sandbox'),'inv:1:sandbox')).toBe(false);// a foreign generation: release
    expect(await opened('{not json',  'inv:1:sandbox')).toBe(true);            // torn: may have opened, hold
    expect(await opened('null',       'inv:1:sandbox')).toBe(true);            // shapeless: hold
    // Only ENOENT proves it never opened; every other read failure must hold the reservation.
    const directoryRoot=await mkdtemp(join(tmpdir(),'julius-gate-dir-'));
    await mkdir(join(directoryRoot,'before.attestation'));
    expect(await executionGateOpened(join(directoryRoot,'before.attestation'),'inv:1:sandbox')).toBe(true);
  });

  it('reads a terminal payload whose encoding predates the stamp, and refuses one it does not know',()=>{
    const payload=Buffer.from('ok','utf8');
    const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
    const empty=digest(Buffer.alloc(0));
    const resultDigest=createHash('sha256').update(['0','1',digest(payload),empty,'d'.repeat(64),empty].join('\n')).digest('hex');
    const after=`receiptVersion=1\nphase=AFTER\nmanifestDigest=${'d'.repeat(64)}\ninvocationId=inv\ndispatchGeneration=1\nsandboxId=sandbox\nrequestDigest=${'a'.repeat(64)}\nexecutorIdentity=executor\nterminalState=SUCCEEDED\nexitCode=0\ndurationMs=1\nfinishedAt=2026-08-31T00:00:01.000Z\nstdoutDigest=${digest(payload)}\nstderrDigest=${empty}\npreTreeDigest=${'d'.repeat(64)}\npostTreeDigest=${'d'.repeat(64)}\nchangedPathsDigest=${empty}\noutputBytes=${payload.byteLength}\nexecutorResultDigest=${resultDigest}\n`;
    // A receipt written before the availability field existed must still parse, or a sandbox image not yet
    // repinned makes every execution unanswerable.
    const parsed=parseExecutorAfterReceipt(after);
    expect(parsed.changedPathsAvailable).toBeUndefined();
    // And the availability value is constrained, so the field cannot carry anything it likes.
    expect(()=>parseExecutorAfterReceipt(after.replace('outputBytes=','changedPathsAvailable=2\noutputBytes='))).toThrow('changedPathsAvailable');
    expect(parseExecutorAfterReceipt(after.replace('outputBytes=','changedPathsAvailable=0\noutputBytes=')).changedPathsAvailable).toBe('0');
    // The payload is base64 whether or not the answer stamped its encoding: base64 landed first.
    const derived=deriveToolInvocationResult(parsed,{stdout:payload.toString('base64'),stderr:'',changedPaths:'',policyDecisionRef:'policy'});
    expect(derived.stdout).toBe('ok');
  });
});

describe('the adapter gate that actually produces the mount',()=>{
  /* The service-level gate can be absent — tenantWorkspaceRoot is optional for a single tenant — and then
     this is the only containment between a caller's string and `docker --mount src=`. */
  it('refuses a workspace outside its own allowed root, and admits one inside it',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-adapter-'));
    const fleet=join(root,'fleet');await mkdir(join(fleet,'work'),{recursive:true});await mkdir(join(root,'elsewhere'));
    await symlink(join(root,'elsewhere'),join(fleet,'escape'));
    const adapter=new DockerJuliusSandboxAdapter({image:`sha256:${'a'.repeat(64)}`,enabled:true,unsafeDevelopmentMode:true,allowedWorkspaceRoot:fleet,dockerBinary:join(root,'no-such-docker')});
    const identity={sandboxId:'sandbox',invocationId:'inv',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',leaseGeneration:1,policyRevision:'policy',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
    /* workspaceBytes is declared larger than any store this test runs on, so the storage ceiling is satisfied
       and what these cases actually exercise — containment and ancestry — is what decides the outcome. */
    const limits={cpuCount:1,memoryBytes:134_217_728,pids:32,openFiles:128,workspaceBytes:Number.MAX_SAFE_INTEGER,outputBytes:32_768,wallClockMs:10_000,concurrentProcesses:4};
    const policy={readWorkspace:true,mutateWorkspace:true,executeProcess:true,network:'DENY' as const,allowedTools:['shell.bash']};
    await adapter.createSandbox({identity,limits,policy});
    const prepare=(sourceRef:string,permittedWorkspaceRoot?:string)=>adapter.prepareWorkspace({sandboxId:'sandbox',sourceRef,expectedLeaseGeneration:1,permittedWorkspaceRoot}).then(()=>'accepted',(error:Error)=>error.message);
    expect(await prepare(join(root,'elsewhere'))).toBe('sandbox_workspace_invalid');
    expect(await prepare(join(fleet,'escape'))).toBe('sandbox_workspace_invalid');
    // A path carrying a mount delimiter would splice a field into the --mount specification.
    await mkdir(join(fleet,'a,b'));
    expect(await prepare(join(fleet,'a,b'))).toBe('sandbox_workspace_invalid');
    // A path inside the root must get PAST the gate and fail on something else, or a gate that refuses
    // everything would satisfy the refusals above and this test would prove nothing.
    /* Named, not negated: `not.toBe(...)` is satisfied by any other refusal, including ones this case has
       nothing to do with, which is how the storage ceiling silently emptied it. Reaching the (absent)
       docker binary is what proves the path got past every gate. */
    const reachedTheRuntime=/^spawn .*no-such-docker/;
    expect(await prepare(join(fleet,'work'))).toMatch(reachedTheRuntime);

    /* The caller-scoped root is what the Critical repair added, and it must NARROW the fleet root: a sibling
       tenant sits inside the fleet and must still be refused. Testing only the fleet path leaves the whole
       repair — including a wholesale revert to the previous behaviour — invisible to this suite. */
    await mkdir(join(fleet,'tenant-a','work'),{recursive:true});await mkdir(join(fleet,'tenant-b'),{recursive:true});
    const tenantA=join(fleet,'tenant-a');
    expect(await prepare(join(fleet,'tenant-b'),tenantA)).toBe('sandbox_workspace_invalid');
    expect(await prepare(join(fleet,'work'),tenantA)).toBe('sandbox_workspace_invalid');
    expect(await prepare(join(tenantA,'work'),tenantA)).toMatch(reachedTheRuntime);
    /* An empty root is "supplied" and falsy at once; it must not be the cheapest way past both checks. The
       path must sit INSIDE the fleet root, or the fleet check refuses it anyway and the assertion proves
       nothing about the empty root — which is how the previous version of this case passed while blind. */
    expect(await prepare(join(fleet,'tenant-b'),'')).toBe('sandbox_workspace_invalid');
    // Likewise a caller root outside the fleet root: the tenant check alone would admit its own child.
    await mkdir(join(root,'elsewhere','deep'),{recursive:true});
    expect(await prepare(join(root,'elsewhere','deep'),join(root,'elsewhere'))).toBe('sandbox_workspace_invalid');
    // A root spelled through a symlink must still work, or ordinary deployments lose prepare entirely.
    await symlink(fleet,join(root,'fleet-link'));
    expect(await prepare(join(root,'fleet-link','tenant-a','work'),join(root,'fleet-link','tenant-a'))).toMatch(reachedTheRuntime);
  },20_000);

  /* Two independent reviewers measured this one line: removing it let a relink between the tenant-root and
     fleet-root resolutions mount another tenant in 2,690 of 4,000 raced attempts, and 135 of 827 in a second
     harness — while the whole suite stayed green. The race cannot be written as a deterministic test, so the
     resolver is injectable and the rule is exercised directly. */
  it('refuses a path the declared roots resolve differently',async()=>{
    const roots=['/fleet/tenant-a','/fleet'];
    const agreeing=async()=>'/fleet/tenant-a/work';
    expect(await admitAcrossRoots(roots,'/fleet/tenant-a/work',agreeing)).toBe('/fleet/tenant-a/work');
    // The second root resolving somewhere else is exactly what a mid-flight relink produces.
    let call=0;
    const disagreeing=async()=>(call++===0?'/fleet/tenant-a/work':'/fleet/tenant-b/work');
    expect(await admitAcrossRoots(roots,'/fleet/tenant-a/work',disagreeing)).toBeNull();
    // A root that refuses outright still refuses, whichever one it is.
    expect(await admitAcrossRoots(roots,'x',async(root:string)=>root==='/fleet'?null:'/fleet/tenant-a/work')).toBeNull();
    expect(await admitAcrossRoots(roots,'x',async(root:string)=>root==='/fleet'?'/fleet/tenant-a/work':null)).toBeNull();
  });

  /* The containment root is chosen by the trusted boundary, which is on the far side of this transport.
     A caller that supplies one is told, rather than having it silently replaced. */
  it('refuses to carry a caller-supplied containment root over the wire',()=>{
    const client=new RemoteExecutorControlPlane({endpoint:new URL('https://executor.internal'),serviceCredential:'scoped',callerId:'julius-prod',tenantId:'tenant',requestTimeoutMs:50});
    expect(()=>client.prepareWorkspace({sandboxId:'sandbox',sourceRef:'/ws',expectedLeaseGeneration:1,permittedWorkspaceRoot:'/'})).toThrow('executor_workspace_root_is_boundary_owned');
    expect(()=>client.prepareWorkspace({sandboxId:'sandbox',sourceRef:'/ws',expectedLeaseGeneration:1})).not.toThrow();
  });

  it('refuses a terminal payload encoding it does not implement',()=>{
    expect(()=>assertKnownPayloadEncoding(undefined)).not.toThrow();
    expect(()=>assertKnownPayloadEncoding('base64')).not.toThrow();
    for(const unknown of ['utf8','hex','',null,2]) expect(()=>assertKnownPayloadEncoding(unknown)).toThrow('SECURITY_FAILURE:executor_terminal_payload_encoding_unknown');
  });
});
