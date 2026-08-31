import { describe, expect, it } from 'vitest';
import { executionEnvelopeDigest, parseExecutorExecutionEnvelope } from './execution-envelope';

const now=new Date('2026-08-31T12:00:00.000Z');
const valid=()=>({schemaVersion:1,callerId:'julius-prod',callerScope:'sandbox:execute',tenantId:'tenant-a',projectId:'project-a',runId:'run-a',taskId:'task-a',invocationId:'inv-a',dispatchGeneration:2,sandboxId:'sandbox-a',requestDigest:'a'.repeat(64),executionIdentity:'inv-a:2:sandbox-a',nonce:'nonce-a',issuedAt:'2026-08-31T11:59:55.000Z',expiresAt:'2026-08-31T12:01:00.000Z',payload:{expectedLeaseGeneration:3,executionTokenHash:'b'.repeat(64),effectClassification:'NON_IDEMPOTENT_MUTATION',request:{invocationId:'inv-a',runId:'run-a',taskId:'task-a',projectId:'project-a',workerId:'worker-a',toolId:'shell.bash',toolVersion:'1',arguments:{command:'echo safe'},cwd:'src',idempotencyKey:'idem-a',timeoutMs:1000,expectedMutation:'WORKSPACE'}}});

describe('executor execution envelope',()=>{
  it('validates an exact scoped expiring execution request',()=>{const parsed=parseExecutorExecutionEnvelope(valid(),{now,allowedCallerIds:new Set(['julius-prod'])});expect(parsed.executionIdentity).toBe('inv-a:2:sandbox-a');expect(executionEnvelopeDigest(parsed)).toMatch(/^[a-f0-9]{64}$/);});
  it('canonicalizes tool argument field order for replay identity',()=>{const first:any=valid(),second:any=valid();first.payload.request.arguments={alpha:1,beta:2};second.payload.request.arguments={beta:2,alpha:1};expect(executionEnvelopeDigest(parseExecutorExecutionEnvelope(first,{now}))).toBe(executionEnvelopeDigest(parseExecutorExecutionEnvelope(second,{now})));});
  it.each([
    ['unknown field',(input:any)=>{input.admin=true;}],
    ['expired',(input:any)=>{input.expiresAt='2026-08-31T11:59:59.000Z';}],
    ['future issued',(input:any)=>{input.issuedAt='2026-08-31T12:01:00.000Z';input.expiresAt='2026-08-31T12:02:00.000Z';}],
    ['scope escalation',(input:any)=>{input.callerScope='sandbox:destroy';}],
    ['scope mismatch',(input:any)=>{input.taskId='task-b';}],
    ['path traversal',(input:any)=>{input.payload.request.cwd='../host';}],
    ['oversized arguments',(input:any)=>{input.payload.request.arguments={value:'x'.repeat(70_000)};}],
  ])('rejects %s',(_name,mutate)=>{const input=valid();mutate(input);expect(()=>parseExecutorExecutionEnvelope(input,{now,allowedCallerIds:new Set(['julius-prod'])})).toThrow();});
  it('refuses an otherwise valid caller outside the operation allowlist',()=>expect(()=>parseExecutorExecutionEnvelope(valid(),{now,allowedCallerIds:new Set(['another-service'])})).toThrow('execution_envelope_scope_refused'));
});
