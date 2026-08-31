import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { JuliusToolRecoveryPostgresRepository } from '../../persistence/julius-tool-recovery-postgres';
import { DockerJuliusSandboxAdapter } from './docker-sandbox-adapter';
import { FilesystemExecutionLedger } from './durable-execution-ledger';
import { createDurableReceiptAttestor, createExecutorControlPlaneService } from './executor-control-plane-service';
import { DockerExecutorReceiptStore } from './executor-receipt-store';

const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`executor_config_missing:${name}`);return value;};
const operations=new Set(['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile'] as const);
const port=Number(process.env.EXECUTOR_PORT??'8787');
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('executor_config_invalid:EXECUTOR_PORT');

async function main():Promise<void>{
  const pool=new Pool({connectionString:required('DATABASE_URL')});
  const receipts=new DockerExecutorReceiptStore(required('EXECUTOR_RECEIPT_ROOT'));
  const executionLedger=new FilesystemExecutionLedger(required('EXECUTOR_LEDGER_ROOT'));
  const privateSigningKey=createPrivateKey(await readFile(required('EXECUTOR_SIGNING_KEY_PATH'),'utf8'));
  const attestor=createDurableReceiptAttestor({keyId:required('EXECUTOR_KEY_ID'),privateSigningKey,receipts,executionLedger});
  const physical=new DockerJuliusSandboxAdapter({
    image:required('JULIUS_SANDBOX_IMAGE'),enabled:true,dockerBinary:process.env.DOCKER_BINARY??'/usr/bin/docker',
    allowedWorkspaceRoot:required('EXECUTOR_WORKSPACE_ROOT'),
    durability:{store:new JuliusToolRecoveryPostgresRepository(pool),receipts,runtimeInstanceId:required('EXECUTOR_RUNTIME_ID'),executorVersion:required('EXECUTOR_VERSION'),attestReceipt:attestor},
  });
  const service=createExecutorControlPlaneService({callerAuthorities:[{callerId:required('JULIUS_CALLER_ID'),credential:required('JULIUS_EXECUTOR_CREDENTIAL'),operations}],keyId:required('EXECUTOR_KEY_ID'),privateSigningKey,physical,receipts,executionLedger});
  service.listen(port,'0.0.0.0',()=>process.stdout.write(`executor_ready:${port}\n`));
  const shutdown=async()=>{service.close();await pool.end();};
  process.once('SIGTERM',()=>void shutdown());
  process.once('SIGINT',()=>void shutdown());
}
void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'executor_start_failed'}\n`);process.exitCode=1;});
