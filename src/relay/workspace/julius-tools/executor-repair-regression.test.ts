import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { permittedWorkspace, workspaceContained } from './docker-sandbox-adapter';
import { FilesystemExecutionLedger, durablePublish } from './durable-execution-ledger';
import { parseExecutorCallers } from './executor-scoped-credential';
import { canonicalRequestDigest, executionReplayDigest, parseExecutorExecutionEnvelope } from './execution-envelope';

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
