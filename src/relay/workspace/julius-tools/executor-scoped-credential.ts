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
