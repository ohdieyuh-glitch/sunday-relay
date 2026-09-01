import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { JuliusToolRecoveryPostgresRepository } from '../../persistence/julius-tool-recovery-postgres';
import { DockerJuliusSandboxAdapter, permittedWorkspace } from './docker-sandbox-adapter';
import { FilesystemExecutionLedger, FilesystemSandboxTenancyLedger } from './durable-execution-ledger';
import { createDurableReceiptAttestor, createExecutorControlPlaneService } from './executor-control-plane-service';
import { DockerExecutorReceiptStore } from './executor-receipt-store';
import { deriveCallerAuthorities, parseExecutorCallers } from './executor-scoped-credential';


const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`executor_config_missing:${name}`);return value;};
/** Identifiers reach filesystem paths, so the single-caller fallback validates them exactly as the caller table does. */
const identifier=(name:string):string=>{const value=required(name);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw new Error(`executor_config_invalid:${name}`);return value;};
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
  const declared=process.env.EXECUTOR_CALLERS?parseExecutorCallers(process.env.EXECUTOR_CALLERS):[{callerId:identifier('JULIUS_CALLER_ID'),tenantId:identifier('JULIUS_TENANT_ID'),credentialRoot:required('EXECUTOR_CREDENTIAL_ROOT')}];
  // Fleet authority is whatever the caller table granted, never what its operation list implies: inferring it
  // made every gate reading it satisfied by definition, since reaching one required holding that operation.
  const callerAuthorities=declared.flatMap(caller=>
    deriveCallerAuthorities({rootSecret:caller.credentialRoot,callerId:caller.callerId,tenantId:caller.tenantId,operations:caller.operations}).map(authority=>({...authority,fleet:caller.fleet===true})));
  // With more than one tenant, a shared workspace root is no isolation at all, so it stops being optional.
  const tenants=new Set(declared.map(caller=>caller.tenantId));
  const tenantWorkspaceRoot=tenants.size>1?required('EXECUTOR_TENANT_WORKSPACE_ROOT'):process.env.EXECUTOR_TENANT_WORKSPACE_ROOT;
  // A tenant root outside the fleet root refuses every prepare. Fail at boot rather than per request.
  if(tenantWorkspaceRoot&&!await permittedWorkspace(workspaceRootEarly,tenantWorkspaceRoot))throw new Error('executor_config_invalid:EXECUTOR_TENANT_WORKSPACE_ROOT');
  const store=recoveryStore;
  const service=createExecutorControlPlaneService({callerAuthorities,keyId:required('EXECUTOR_KEY_ID'),privateSigningKey,physical,receipts,executionLedger,tenancyLedger,
    tenantWorkspaceRoot:tenantWorkspaceRoot,
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
