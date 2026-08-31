import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual, type KeyObject } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SandboxExecutionPort } from '../../mission/julius';
import { receiptDigest, signExecutorAttestation, type SignedExecutorAttestation } from './executor-attestation';
import type { DockerExecutorReceiptStore } from './executor-receipt-store';

const MAX_BODY_BYTES = 1024 * 1024;
type Operation = 'create'|'prepare'|'execute'|'cancel'|'destroy'|'inspect'|'artifacts'|'discover'|'quarantine'|'reconcile';
const OPERATIONS = new Set<Operation>(['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile']);
const equal = (left:string,right:string) => { const a=Buffer.from(left),b=Buffer.from(right); return a.length===b.length&&timingSafeEqual(a,b); };

export interface ExecutorControlPlaneServiceConfig {
  readonly callerCredential: string;
  readonly keyId: string;
  readonly privateSigningKey: KeyObject;
  readonly physical: SandboxExecutionPort;
  readonly receipts: DockerExecutorReceiptStore;
}

export function createDurableReceiptAttestor(config:Pick<ExecutorControlPlaneServiceConfig,'keyId'|'privateSigningKey'|'receipts'>) {
  return async(input:{phase:'BEFORE'|'AFTER';executionTokenHash:string;sandboxId:string}):Promise<void>=>{
    const directory=config.receipts.directory(input.executionTokenHash,input.sandboxId);
    const manifest=JSON.parse(await readFile(join(directory,'request.json'),'utf8')) as {invocationId:string;dispatchGeneration:number;sandboxId:string;requestDigest:string};
    if(manifest.sandboxId!==input.sandboxId)throw new Error('executor_attestation_scope_mismatch');
    const raw=await readFile(join(directory,`${input.phase.toLowerCase()}.receipt`),'utf8');
    const signed=signExecutorAttestation({version:1,keyId:config.keyId,phase:input.phase,executionIdentity:`${manifest.invocationId}:${manifest.dispatchGeneration}:${manifest.sandboxId}`,invocationId:manifest.invocationId,dispatchGeneration:manifest.dispatchGeneration,sandboxId:manifest.sandboxId,requestDigest:manifest.requestDigest,receiptDigest:receiptDigest(raw),issuedAt:new Date().toISOString()},config.privateSigningKey);
    const path=join(directory,`${input.phase.toLowerCase()}.attestation`),serialized=JSON.stringify(signed);
    try{await writeFile(path,serialized,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const prior=await readFile(path,'utf8');if(prior!==serialized)throw new Error('executor_attestation_conflict');}
  };
}

async function body(request: IncomingMessage):Promise<unknown>{
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of request){const value=Buffer.from(chunk);bytes+=value.length;if(bytes>MAX_BODY_BYTES)throw new Error('request_too_large');chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Minimal privileged boundary: transport/authentication/attestation only; C.A.R.D. and mission truth remain in Julius. */
export function createExecutorControlPlaneService(config:ExecutorControlPlaneServiceConfig):Server {
  if(!config.callerCredential||!config.keyId)throw new Error('executor_service_config_invalid');
  return createServer(async(request,response)=>{
    response.setHeader('content-type','application/json');
    try{
      if(request.method!=='POST'||request.url!=='/v1/execute'){response.statusCode=404;response.end('{"error":"not_found"}');return;}
      const supplied=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';
      if(!equal(supplied,config.callerCredential)){response.statusCode=401;response.end('{"error":"unauthorized"}');return;}
      const operation=request.headers['x-julius-operation'];
      if(typeof operation!=='string'||!OPERATIONS.has(operation as Operation)){response.statusCode=400;response.end('{"error":"operation_invalid"}');return;}
      const input=await body(request) as any;let value:unknown;let attestations:readonly SignedExecutorAttestation[]|undefined;let receiptBodies:Readonly<Record<'BEFORE'|'AFTER',string>>|undefined;let terminalPayload:Readonly<Record<'stdout'|'stderr'|'changedPaths',string>>|undefined;
      switch(operation as Operation){
        case 'create':value=await config.physical.createSandbox(input);break;
        case 'prepare':value=await config.physical.prepareWorkspace(input);break;
        case 'cancel':value=await config.physical.cancelExecution(input);break;
        case 'destroy':value=await config.physical.destroySandbox(input);break;
        case 'inspect':value=await config.physical.inspectSandbox(input);break;
        case 'artifacts':value=await config.physical.collectArtifacts(input);break;
        case 'discover':value=await config.physical.discoverSandboxes();break;
        case 'quarantine':value=await config.physical.quarantineSandbox(input);break;
        case 'reconcile':value=await config.physical.reconcileSandboxes();break;
        case 'execute': {
          value=await config.physical.executeTool(input);
          const directory=config.receipts.directory(input.executionTokenHash,input.sandboxId);
          const before=await readFile(join(directory,'before.receipt'),'utf8');
          const after=await readFile(join(directory,'after.receipt'),'utf8');
          attestations=await Promise.all((['before','after'] as const).map(async phase=>JSON.parse(await readFile(join(directory,`${phase}.attestation`),'utf8')) as SignedExecutorAttestation));
          receiptBodies={BEFORE:before,AFTER:after};
          terminalPayload={stdout:await readFile(join(directory,'stdout'),'utf8'),stderr:await readFile(join(directory,'stderr'),'utf8'),changedPaths:await readFile(join(directory,'changed-paths'),'utf8')};
          break;
        }
      }
      const encoded=JSON.stringify({value,attestations,receiptBodies,terminalPayload});if(Buffer.byteLength(encoded)>2*1024*1024)throw new Error('executor_response_too_large');response.statusCode=200;response.end(encoded);
    }catch(error){const message=error instanceof Error?error.message:'executor_failure';response.statusCode=message.includes('conflict')?409:message==='request_too_large'?413:500;response.end(JSON.stringify({error:message.replace(/[^A-Za-z0-9_:.-]/g,'_')}));}
  });
}
