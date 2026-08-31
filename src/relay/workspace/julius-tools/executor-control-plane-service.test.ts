import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { SandboxExecutionPort, ToolInvocationResult } from '../../mission/julius';
import { DockerExecutorReceiptStore } from './executor-receipt-store';
import { createExecutorControlPlaneService } from './executor-control-plane-service';
import { RemoteExecutorControlPlane } from './remote-executor-control-plane';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

const result:ToolInvocationResult={invocationId:'inv',status:'SUCCEEDED',exitCode:0,safeSummary:'done',stdout:'',stderr:'',stdoutRef:null,stderrRef:null,artifacts:[],evidence:[],durationMs:1,resourceUsage:{toolCalls:1,runtimeMs:1,outputBytes:0},policyDecisionRef:'policy',mutations:[]};
const physical = (execute:()=>Promise<ToolInvocationResult>):SandboxExecutionPort => ({
  createSandbox:async input=>({...input.identity,state:'CREATING',workspaceRef:null,runtimeKind:'test',limits:input.limits,policy:input.policy,safeFailure:null}),
  prepareWorkspace:async()=>{throw new Error('unused');},executeTool:async()=>execute(),cancelExecution:async()=>true,destroySandbox:async()=>true,
  inspectSandbox:async()=>null,collectArtifacts:async()=>[],discoverSandboxes:async()=>[],quarantineSandbox:async()=>true,reconcileSandboxes:async()=>({recovered:0,lost:0,quarantined:0,destroyed:0}),
});

describe('executor control-plane service',()=>{
  it('keeps the private key server-side and returns verified BEFORE and AFTER attestations',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-control-plane-'));roots.push(root);
    const receipts=new DockerExecutorReceiptStore(root),token='e'.repeat(64),sandboxId='sandbox';
    const directory=receipts.directory(token,sandboxId);await mkdir(directory,{recursive:true});
    const keys=generateKeyPairSync('ed25519');
    const server=createExecutorControlPlaneService({callerCredential:'caller',keyId:'current',privateSigningKey:keys.privateKey,receipts,physical:physical(async()=>{await writeFile(join(directory,'before.receipt'),'before',{flag:'wx'});await writeFile(join(directory,'after.receipt'),'after',{flag:'wx'});return result;})});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address() as AddressInfo;
      const client=new RemoteExecutorControlPlane({endpoint:new URL(`http://127.0.0.1:${address.port}`),serviceCredential:'caller',requestTimeoutMs:1000,trustedReceiptKeys:new Map([['current',keys.publicKey]]),allowInsecureLoopbackForTests:true});
      await expect(client.executeTool({sandboxId,expectedLeaseGeneration:1,dispatchGeneration:2,requestDigest:'a'.repeat(64),executionTokenHash:token,effectClassification:'NON_IDEMPOTENT_MUTATION',request:{invocationId:'inv',projectId:'project',runId:'run',taskId:'task',workerId:'worker',toolId:'shell.bash',toolVersion:'1',arguments:{command:'true'},cwd:'.',timeoutMs:1000,idempotencyKey:'key',expectedMutation:'WORKSPACE'}})).resolves.toEqual(result);
      await expect(fetch(`http://127.0.0.1:${address.port}/v1/execute`,{method:'POST',headers:{authorization:'Bearer wrong','x-julius-operation':'discover','content-type':'application/json'},body:'{}'}).then(x=>x.status)).resolves.toBe(401);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
