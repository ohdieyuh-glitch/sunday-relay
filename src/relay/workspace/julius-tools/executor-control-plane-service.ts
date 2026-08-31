import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, timingSafeEqual, type KeyObject } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SandboxExecutionPort } from '../../mission/julius';
import { receiptDigest, signExecutorAttestation, type SignedExecutorAttestation } from './executor-attestation';
import type { DockerExecutorReceiptStore } from './executor-receipt-store';
import { executionEnvelopeDigest, parseExecutorExecutionEnvelope } from './execution-envelope';
import { EXECUTOR_OPERATION_SET, SANDBOX_SCOPED, parseExecutorOperationRequest, type ExecutorOperation } from './executor-operation-request';
import { FilesystemExecutionLedger, FilesystemSandboxTenancyLedger } from './durable-execution-ledger';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const equal = (left:string,right:string) => { const a=Buffer.from(left),b=Buffer.from(right); return a.length===b.length&&timingSafeEqual(a,b); };

export interface ExecutorCallerAuthority {readonly callerId:string;readonly tenantId:string;readonly credential:string;readonly operations:ReadonlySet<ExecutorOperation>;}
export interface ExecutorControlPlaneServiceConfig {
  readonly callerAuthorities: readonly ExecutorCallerAuthority[];
  readonly keyId: string;
  readonly privateSigningKey: KeyObject;
  readonly physical: SandboxExecutionPort;
  readonly receipts: DockerExecutorReceiptStore;
  readonly executionLedger: FilesystemExecutionLedger;
  readonly tenancyLedger: FilesystemSandboxTenancyLedger;
}

async function durableExclusiveWrite(path:string,body:string):Promise<void>{const handle=await open(path,'wx',0o600);try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}}

export function createDurableReceiptAttestor(config:Pick<ExecutorControlPlaneServiceConfig,'keyId'|'privateSigningKey'|'receipts'> & {executionLedger?:FilesystemExecutionLedger}) {
  return async(input:{phase:'BEFORE'|'AFTER';executionTokenHash:string;sandboxId:string}):Promise<void>=>{
    const directory=config.receipts.directory(input.executionTokenHash,input.sandboxId);
    const manifest=JSON.parse(await readFile(join(directory,'request.json'),'utf8')) as {invocationId:string;dispatchGeneration:number;sandboxId:string;requestDigest:string};
    if(manifest.sandboxId!==input.sandboxId)throw new Error('executor_attestation_scope_mismatch');
    const raw=await readFile(join(directory,`${input.phase.toLowerCase()}.receipt`),'utf8');
    const signed=signExecutorAttestation({version:1,keyId:config.keyId,phase:input.phase,executionIdentity:`${manifest.invocationId}:${manifest.dispatchGeneration}:${manifest.sandboxId}`,invocationId:manifest.invocationId,dispatchGeneration:manifest.dispatchGeneration,sandboxId:manifest.sandboxId,requestDigest:manifest.requestDigest,receiptDigest:receiptDigest(raw),issuedAt:new Date().toISOString()},config.privateSigningKey);
    const path=join(directory,`${input.phase.toLowerCase()}.attestation`),serialized=JSON.stringify(signed);
    try{await durableExclusiveWrite(path,serialized);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const prior=await readFile(path,'utf8');if(!prior)throw new Error('executor_attestation_conflict');}
    if(config.executionLedger){const executionIdentity=`${manifest.invocationId}:${manifest.dispatchGeneration}:${manifest.sandboxId}`,now=new Date().toISOString();if(input.phase==='BEFORE'){await config.executionLedger.transition({executionIdentity,requestDigest:manifest.requestDigest,from:'PREPARED',to:'BEFORE_DURABLE',now});await config.executionLedger.transition({executionIdentity,requestDigest:manifest.requestDigest,from:'BEFORE_DURABLE',to:'RUNNING',now:new Date().toISOString()});}else await config.executionLedger.transition({executionIdentity,requestDigest:manifest.requestDigest,from:'RUNNING',to:'AFTER_DURABLE',now});}
  };
}

async function body(request: IncomingMessage):Promise<unknown>{
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of request){const value=Buffer.from(chunk);bytes+=value.length;if(bytes>MAX_BODY_BYTES)throw new Error('request_too_large');chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const statusFor=(message:string):number=>message==='STARTED_UNKNOWN_OUTCOME'?409:message.startsWith('SECURITY_FAILURE:')?409:message.includes('conflict')?409:message==='request_too_large'?413:message.startsWith('execution_envelope_')||message.startsWith('executor_operation_invalid')||message.startsWith('execution_request:')||message.startsWith('executor_')&&message.includes(':fields_invalid')?400:500;

/** Minimal privileged boundary: transport/authentication/attestation only; C.A.R.D. and mission truth remain in Julius. */
export function createExecutorControlPlaneService(config:ExecutorControlPlaneServiceConfig):Server {
  if(!config.keyId||config.callerAuthorities.length<1||config.callerAuthorities.some(authority=>!authority.callerId||!authority.tenantId||!authority.credential||authority.operations.size<1))throw new Error('executor_service_config_invalid');
  return createServer(async(request,response)=>{
    response.setHeader('content-type','application/json');
    try{
      if(request.method!=='POST'||request.url!=='/v1/execute'){response.statusCode=404;response.end('{"error":"not_found"}');return;}
      const supplied=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';
      const header=request.headers['x-julius-operation'];
      if(typeof header!=='string'||!EXECUTOR_OPERATION_SET.has(header as ExecutorOperation)){response.statusCode=400;response.end('{"error":"operation_invalid"}');return;}
      const operation=header as ExecutorOperation;
      const authority=config.callerAuthorities.find(candidate=>equal(supplied,candidate.credential));
      if(!authority){response.statusCode=401;response.end('{"error":"unauthorized"}');return;}
      // One operation is one narrowly scoped authority: the execute credential cannot destroy, the inspect credential cannot execute.
      if(!authority.operations.has(operation)){response.statusCode=403;response.end('{"error":"operation_scope_refused"}');return;}
      const input=await body(request);let value:unknown;let attestations:readonly SignedExecutorAttestation[]|undefined;let receiptBodies:Readonly<Record<'BEFORE'|'AFTER',string>>|undefined;let terminalPayload:Readonly<Record<'stdout'|'stderr'|'changedPaths',string>>|undefined;
      if(operation!=='execute'){
        const parsed=parseExecutorOperationRequest(operation,input,{tenantId:authority.tenantId});
        if(operation==='create')await config.tenancyLedger.bind({sandboxId:(parsed as {identity:{sandboxId:string}}).identity.sandboxId,tenantId:authority.tenantId});
        else if(SANDBOX_SCOPED.has(operation))await config.tenancyLedger.assert({sandboxId:(parsed as {sandboxId:string}).sandboxId,tenantId:authority.tenantId});
        switch(operation){
          case 'create':value=await config.physical.createSandbox(parsed as Parameters<SandboxExecutionPort['createSandbox']>[0]);break;
          case 'prepare':value=await config.physical.prepareWorkspace(parsed as Parameters<SandboxExecutionPort['prepareWorkspace']>[0]);break;
          case 'cancel':value=await config.physical.cancelExecution(parsed as Parameters<SandboxExecutionPort['cancelExecution']>[0]);break;
          case 'destroy':value=await config.physical.destroySandbox(parsed as Parameters<SandboxExecutionPort['destroySandbox']>[0]);break;
          case 'inspect':value=await config.physical.inspectSandbox(parsed as Parameters<SandboxExecutionPort['inspectSandbox']>[0]);break;
          case 'artifacts':value=await config.physical.collectArtifacts(parsed as Parameters<SandboxExecutionPort['collectArtifacts']>[0]);break;
          case 'discover':value=await config.physical.discoverSandboxes();break;
          case 'quarantine':value=await config.physical.quarantineSandbox(parsed as Parameters<SandboxExecutionPort['quarantineSandbox']>[0]);break;
          case 'reconcile':value=await config.physical.reconcileSandboxes();break;
        }
        const encoded=JSON.stringify({value});if(Buffer.byteLength(encoded)>MAX_RESPONSE_BYTES)throw new Error('executor_response_too_large');
        response.statusCode=200;response.end(encoded);return;
      }
      // The envelope is parsed exactly once, against this service's clock. A caller-supplied timestamp never decides expiry.
      const envelope=parseExecutorExecutionEnvelope(input,{allowedCallerIds:new Set([authority.callerId])});
      if(envelope.tenantId!==authority.tenantId)throw new Error('SECURITY_FAILURE:executor_tenant_scope_refused');
      await config.tenancyLedger.assert({sandboxId:envelope.sandboxId,tenantId:authority.tenantId});
      // Reserve before any physical effect and branch on the reservation itself: two concurrent identical requests cannot both execute.
      const reservation=await config.executionLedger.reserve({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,envelopeDigest:executionEnvelopeDigest(envelope),now:new Date().toISOString()});
      if(reservation.kind==='EXISTING'){
        if(reservation.entry.state==='TERMINAL'&&reservation.entry.terminalResponse){response.statusCode=200;response.end(reservation.entry.terminalResponse);return;}
        throw new Error('STARTED_UNKNOWN_OUTCOME');
      }
      value=await config.physical.executeTool({sandboxId:envelope.sandboxId,expectedLeaseGeneration:envelope.payload.expectedLeaseGeneration,dispatchGeneration:envelope.dispatchGeneration,requestDigest:envelope.requestDigest,executionTokenHash:envelope.payload.executionTokenHash,effectClassification:envelope.payload.effectClassification,request:envelope.payload.request});
      const directory=config.receipts.directory(envelope.payload.executionTokenHash,envelope.sandboxId);
      receiptBodies={BEFORE:await readFile(join(directory,'before.receipt'),'utf8'),AFTER:await readFile(join(directory,'after.receipt'),'utf8')};
      attestations=await Promise.all((['before','after'] as const).map(async phase=>JSON.parse(await readFile(join(directory,`${phase}.attestation`),'utf8')) as SignedExecutorAttestation));
      terminalPayload={stdout:await readFile(join(directory,'stdout'),'utf8'),stderr:await readFile(join(directory,'stderr'),'utf8'),changedPaths:await readFile(join(directory,'changed-paths'),'utf8')};
      const encoded=JSON.stringify({value,attestations,receiptBodies,terminalPayload});if(Buffer.byteLength(encoded)>MAX_RESPONSE_BYTES)throw new Error('executor_response_too_large');
      await config.executionLedger.transition({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,from:'AFTER_DURABLE',to:'TERMINAL',resultDigest:createHash('sha256').update(encoded).digest('hex'),terminalResponse:encoded,now:new Date().toISOString()});
      response.statusCode=200;response.end(encoded);
    }catch(error){const message=error instanceof Error?error.message:'executor_failure';response.statusCode=statusFor(message);response.end(JSON.stringify({error:message.replace(/[^A-Za-z0-9_:.-]/g,'_')}));}
  });
}
