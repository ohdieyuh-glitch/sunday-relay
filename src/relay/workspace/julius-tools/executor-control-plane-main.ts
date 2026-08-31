import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { JuliusToolRecoveryPostgresRepository } from '../../persistence/julius-tool-recovery-postgres';
import { DockerJuliusSandboxAdapter } from './docker-sandbox-adapter';
import { FilesystemExecutionLedger, FilesystemSandboxTenancyLedger } from './durable-execution-ledger';
import { createDurableReceiptAttestor, createExecutorControlPlaneService } from './executor-control-plane-service';
import { DockerExecutorReceiptStore } from './executor-receipt-store';
import { deriveCallerAuthorities, parseExecutorCallers } from './executor-scoped-credential';
import { OPERATOR_OPERATIONS, type ExecutorOperation } from './executor-operation-request';

const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`executor_config_missing:${name}`);return value;};
const port=Number(process.env.EXECUTOR_PORT??'8787');
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('executor_config_invalid:EXECUTOR_PORT');

async function main():Promise<void>{
  const pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{});
  const receipts=new DockerExecutorReceiptStore(required('EXECUTOR_RECEIPT_ROOT'));
  const ledgerRoot=required('EXECUTOR_LEDGER_ROOT');
  const executionLedger=new FilesystemExecutionLedger(ledgerRoot),tenancyLedger=new FilesystemSandboxTenancyLedger(`${ledgerRoot}/tenancy`);
  const privateSigningKey=createPrivateKey(await readFile(required('EXECUTOR_SIGNING_KEY_PATH'),'utf8'));
  const attestor=createDurableReceiptAttestor({keyId:required('EXECUTOR_KEY_ID'),privateSigningKey,receipts,executionLedger});
  const workspaceRootEarly=required('EXECUTOR_WORKSPACE_ROOT');
  const recoveryStore=new JuliusToolRecoveryPostgresRepository(pool);
  const physical=new DockerJuliusSandboxAdapter({
    image:required('JULIUS_SANDBOX_IMAGE'),enabled:true,dockerBinary:process.env.DOCKER_BINARY??'/usr/bin/docker',
    allowedWorkspaceRoot:workspaceRootEarly,
    durability:{store:recoveryStore,receipts,runtimeInstanceId:required('EXECUTOR_RUNTIME_ID'),executorVersion:required('EXECUTOR_VERSION'),attestReceipt:attestor},
  });
  // The root secret never leaves this process. Julius receives only the per-operation credentials derived from it.
  const declared=process.env.EXECUTOR_CALLERS?parseExecutorCallers(process.env.EXECUTOR_CALLERS):[{callerId:required('JULIUS_CALLER_ID'),tenantId:required('JULIUS_TENANT_ID'),credentialRoot:required('EXECUTOR_CREDENTIAL_ROOT')}];
  // A caller that declares any fleet-wide operation is fleet authority: only it may sweep the host or act
  // on a sandbox nobody owns. A tenant caller declares none and so is never granted it.
  const fleetOperations=new Set<ExecutorOperation>(OPERATOR_OPERATIONS);
  const callerAuthorities=declared.flatMap(caller=>{
    const fleet=(caller.operations??[]).some(operation=>fleetOperations.has(operation));
    return deriveCallerAuthorities({rootSecret:caller.credentialRoot,callerId:caller.callerId,tenantId:caller.tenantId,operations:caller.operations}).map(authority=>({...authority,fleet}));
  });
  const store=recoveryStore;
  const service=createExecutorControlPlaneService({callerAuthorities,keyId:required('EXECUTOR_KEY_ID'),privateSigningKey,physical,receipts,executionLedger,tenancyLedger,
    tenantWorkspaceRoot:process.env.EXECUTOR_TENANT_WORKSPACE_ROOT,
    /* Completes an execution whose effect happened and whose receipts are signed but whose reply was lost.
       It reads durable state and records the receipt Julius needs to settle; it never executes anything. */
    recoverTerminal:async input=>{
      const consumed=await receipts.consume(input.executionTokenHash,input.sandboxId);
      if(!consumed?.receipt.result)return null;
      await store.recordReceipt({...consumed.receipt,projectId:consumed.manifest.projectId});
      return consumed.receipt.result;
    }});
  // Loopback unless a deployment explicitly accepts a wider bind: this process holds Docker, the signing
  // key and the receipt store, and the transport is plaintext HTTP with a bearer credential on it.
  const address=process.env.EXECUTOR_BIND_ADDRESS??'127.0.0.1';
  if(address!=='127.0.0.1'&&address!=='::1'&&process.env.EXECUTOR_ALLOW_NON_LOOPBACK_BIND!=='1')throw new Error('executor_config_invalid:EXECUTOR_BIND_ADDRESS');
  service.headersTimeout=30_000;service.requestTimeout=120_000;service.maxConnections=256;
  service.listen(port,address,()=>process.stdout.write(`executor_ready:${port}\n`));
  const shutdown=async()=>{service.close();await pool.end();};
  process.once('SIGTERM',()=>void shutdown());
  process.once('SIGINT',()=>void shutdown());
}
void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'executor_start_failed'}\n`);process.exitCode=1;});
