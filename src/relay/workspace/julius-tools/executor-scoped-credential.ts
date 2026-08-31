import { createHmac } from 'node:crypto';
import { EXECUTOR_OPERATIONS, operationScope, type ExecutorOperation } from './executor-operation-request';
import type { ExecutorCallerAuthority } from './executor-control-plane-service';

/**
 * One credential per operation, derived from a root secret the executor alone holds.
 * Julius is handed only the scopes it needs; holding the execute credential neither
 * grants nor reveals the destroy credential, because deriving a sibling requires the root.
 */
export function deriveScopedCredential(rootSecret:string,operation:ExecutorOperation):string {
  if(!rootSecret||rootSecret.length<16)throw new Error('executor_credential_root_too_weak');
  return createHmac('sha256',rootSecret).update(`julius-executor-scope:${operationScope(operation)}`).digest('base64url');
}

export function deriveCallerAuthorities(input:{rootSecret:string;callerId:string;tenantId:string;operations?:readonly ExecutorOperation[]}):readonly ExecutorCallerAuthority[] {
  return (input.operations??EXECUTOR_OPERATIONS).map(operation=>({callerId:input.callerId,tenantId:input.tenantId,credential:deriveScopedCredential(input.rootSecret,operation),operations:new Set<ExecutorOperation>([operation])}));
}

export function deriveScopedCredentialMap(rootSecret:string,operations?:readonly ExecutorOperation[]):ReadonlyMap<ExecutorOperation,string> {
  return new Map((operations??EXECUTOR_OPERATIONS).map(operation=>[operation,deriveScopedCredential(rootSecret,operation)]));
}

export interface ExecutorCallerDeclaration {readonly callerId:string;readonly tenantId:string;readonly credentialRoot:string;}
/** Parses the executor-only caller table. Each declared caller gets one narrowly scoped credential per operation. */
export function parseExecutorCallers(value:string):readonly ExecutorCallerDeclaration[] {
  const parsed=JSON.parse(value) as unknown;
  if(!Array.isArray(parsed)||parsed.length<1||parsed.length>16)throw new Error('executor_callers_invalid');
  const declarations=parsed.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('executor_callers_invalid');
    const record=entry as Record<string,unknown>;
    if(Object.keys(record).sort().join(',')!=='callerId,credentialRoot,tenantId')throw new Error('executor_callers_invalid');
    const callerId=String(record.callerId),tenantId=String(record.tenantId),credentialRoot=String(record.credentialRoot);
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(callerId)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(tenantId)||credentialRoot.length<16)throw new Error('executor_callers_invalid');
    return {callerId,tenantId,credentialRoot};
  });
  if(new Set(declarations.map(entry=>entry.callerId)).size!==declarations.length)throw new Error('executor_callers_invalid');
  if(new Set(declarations.map(entry=>entry.credentialRoot)).size!==declarations.length)throw new Error('executor_callers_shared_root');
  return declarations;
}
