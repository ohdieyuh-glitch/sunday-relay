import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { JuliusToolRecoveryPostgresRepository } from '../../persistence/julius-tool-recovery-postgres';
import { DockerJuliusSandboxAdapter } from './docker-sandbox-adapter';
import { FilesystemExecutionLedger, FilesystemSandboxTenancyLedger } from './durable-execution-ledger';
import { createDurableReceiptAttestor, createExecutorControlPlaneService } from './executor-control-plane-service';
import { DockerExecutorReceiptStore } from './executor-receipt-store';
import { deriveCallerAuthorities, parseExecutorCallers } from './executor-scoped-credential';

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
  const physical=new DockerJuliusSandboxAdapter({
    image:required('JULIUS_SANDBOX_IMAGE'),enabled:true,dockerBinary:process.env.DOCKER_BINARY??'/usr/bin/docker',
    allowedWorkspaceRoot:required('EXECUTOR_WORKSPACE_ROOT'),
    durability:{store:new JuliusToolRecoveryPostgresRepository(pool),receipts,runtimeInstanceId:required('EXECUTOR_RUNTIME_ID'),executorVersion:required('EXECUTOR_VERSION'),attestReceipt:attestor},
  });
  // The root secret never leaves this process. Julius receives only the per-operation credentials derived from it.
  const declared=process.env.EXECUTOR_CALLERS?parseExecutorCallers(process.env.EXECUTOR_CALLERS):[{callerId:required('JULIUS_CALLER_ID'),tenantId:required('JULIUS_TENANT_ID'),credentialRoot:required('EXECUTOR_CREDENTIAL_ROOT')}];
  const callerAuthorities=declared.flatMap(caller=>deriveCallerAuthorities({rootSecret:caller.credentialRoot,callerId:caller.callerId,tenantId:caller.tenantId,operations:caller.operations}));
  const service=createExecutorControlPlaneService({callerAuthorities,keyId:required('EXECUTOR_KEY_ID'),privateSigningKey,physical,receipts,executionLedger,tenancyLedger});
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
