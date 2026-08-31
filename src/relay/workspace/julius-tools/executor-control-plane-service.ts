import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, timingSafeEqual, type KeyObject } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SandboxExecutionPort } from '../../mission/julius';
import { receiptDigest, signExecutorAttestation, type SignedExecutorAttestation } from './executor-attestation';
import type { DockerExecutorReceiptStore } from './executor-receipt-store';
import { executionEnvelopeDigest, parseExecutorExecutionEnvelope } from './execution-envelope';
import { FilesystemExecutionLedger } from './durable-execution-ledger';

const MAX_BODY_BYTES = 1024 * 1024;
type Operation = 'create'|'prepare'|'execute'|'cancel'|'destroy'|'inspect'|'artifacts'|'discover'|'quarantine'|'reconcile';
const OPERATIONS = new Set<Operation>(['create','prepare','execute','cancel','destroy','inspect','artifacts','discover','quarantine','reconcile']);
const equal = (left:string,right:string) => { const a=Buffer.from(left),b=Buffer.from(right); return a.length===b.length&&timingSafeEqual(a,b); };

export interface ExecutorControlPlaneServiceConfig {
  readonly callerAuthorities: readonly {readonly callerId:string;readonly credential:string;readonly operations:ReadonlySet<Operation>}[];
  readonly keyId: string;
  readonly privateSigningKey: KeyObject;
  readonly physical: SandboxExecutionPort;
  readonly receipts: DockerExecutorReceiptStore;
  readonly executionLedger: FilesystemExecutionLedger;
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

/** Minimal privileged boundary: transport/authentication/attestation only; C.A.R.D. and mission truth remain in Julius. */
export function createExecutorControlPlaneService(config:ExecutorControlPlaneServiceConfig):Server {
  if(!config.keyId||config.callerAuthorities.length<1||config.callerAuthorities.some(authority=>!authority.callerId||!authority.credential||authority.operations.size<1))throw new Error('executor_service_config_invalid');
  return createServer(async(request,response)=>{
    response.setHeader('content-type','application/json');
    try{
      if(request.method!=='POST'||request.url!=='/v1/execute'){response.statusCode=404;response.end('{"error":"not_found"}');return;}
      const supplied=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';
      const operation=request.headers['x-julius-operation'];
      if(typeof operation!=='string'||!OPERATIONS.has(operation as Operation)){response.statusCode=400;response.end('{"error":"operation_invalid"}');return;}
      const authority=config.callerAuthorities.find(candidate=>equal(supplied,candidate.credential));
      if(!authority){response.statusCode=401;response.end('{"error":"unauthorized"}');return;}
      if(!authority.operations.has(operation as Operation)){response.statusCode=403;response.end('{"error":"operation_scope_refused"}');return;}
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
          const structural=parseExecutorExecutionEnvelope(input,{now:new Date(input.issuedAt),allowedCallerIds:new Set([authority.callerId])});
          const envelopeDigest=executionEnvelopeDigest(structural),existing=await config.executionLedger.load(structural.executionIdentity);
          if(existing){
            if(existing.requestDigest!==structural.requestDigest)throw new Error('SECURITY_FAILURE:execution_identity_conflict');
            if(existing.state==='TERMINAL'&&existing.terminalResponse){response.statusCode=200;response.end(existing.terminalResponse);return;}
            throw new Error('execution_outcome_unknown');
          }
          const envelope=parseExecutorExecutionEnvelope(input,{allowedCallerIds:new Set([authority.callerId])});
          await config.executionLedger.reserve({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,envelopeDigest,now:new Date().toISOString()});
          const physicalInput={sandboxId:envelope.sandboxId,expectedLeaseGeneration:envelope.payload.expectedLeaseGeneration,dispatchGeneration:envelope.dispatchGeneration,requestDigest:envelope.requestDigest,executionTokenHash:envelope.payload.executionTokenHash,effectClassification:envelope.payload.effectClassification,request:envelope.payload.request};
          value=await config.physical.executeTool(physicalInput);
          const directory=config.receipts.directory(envelope.payload.executionTokenHash,envelope.sandboxId);
          const before=await readFile(join(directory,'before.receipt'),'utf8');
          const after=await readFile(join(directory,'after.receipt'),'utf8');
          attestations=await Promise.all((['before','after'] as const).map(async phase=>JSON.parse(await readFile(join(directory,`${phase}.attestation`),'utf8')) as SignedExecutorAttestation));
          receiptBodies={BEFORE:before,AFTER:after};
          terminalPayload={stdout:await readFile(join(directory,'stdout'),'utf8'),stderr:await readFile(join(directory,'stderr'),'utf8'),changedPaths:await readFile(join(directory,'changed-paths'),'utf8')};
          break;
        }
      }
      const encoded=JSON.stringify({value,attestations,receiptBodies,terminalPayload});if(Buffer.byteLength(encoded)>2*1024*1024)throw new Error('executor_response_too_large');
      if(operation==='execute'){
        const envelope=parseExecutorExecutionEnvelope(input,{now:new Date(input.issuedAt),allowedCallerIds:new Set([authority.callerId])});
        await config.executionLedger.transition({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,from:'AFTER_DURABLE',to:'TERMINAL',resultDigest:createHash('sha256').update(encoded).digest('hex'),terminalResponse:encoded,now:new Date().toISOString()});
      }
      response.statusCode=200;response.end(encoded);
    }catch(error){const message=error instanceof Error?error.message:'executor_failure';response.statusCode=message.includes('conflict')?409:message==='request_too_large'?413:500;response.end(JSON.stringify({error:message.replace(/[^A-Za-z0-9_:.-]/g,'_')}));}
  });
}
