import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, createPublicKey, timingSafeEqual, type KeyObject } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SandboxExecutionPort } from '../../mission/julius';
import { receiptDigest, signExecutorAttestation, type SignedExecutorAttestation } from './executor-attestation';
import type { DockerExecutorReceiptStore } from './executor-receipt-store';
import { executionReplayDigest, parseExecutorExecutionEnvelope } from './execution-envelope';
import { EXECUTOR_OPERATION_SET, MAX_EXECUTOR_RESPONSE_BYTES, SANDBOX_SCOPED, parseExecutorOperationRequest, type ExecutorOperation } from './executor-operation-request';
import { permittedWorkspace } from './docker-sandbox-adapter';
import { verifyExecutorAttestation } from './executor-attestation';
import { parseExecutorAfterReceipt, parseExecutorBeforeReceipt } from './executor-terminal-receipt';
import { FilesystemExecutionLedger, FilesystemSandboxTenancyLedger, durablePublish } from './durable-execution-ledger';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = MAX_EXECUTOR_RESPONSE_BYTES;
const equal = (left:string,right:string) => { const a=Buffer.from(left),b=Buffer.from(right); return a.length===b.length&&timingSafeEqual(a,b); };

export interface ExecutorCallerAuthority {
  readonly callerId:string;readonly tenantId:string;readonly credential:string;readonly operations:ReadonlySet<ExecutorOperation>;
  /** Fleet authority acts beyond one tenant: it alone may sweep the host or touch a sandbox nobody owns. */
  readonly fleet?:boolean;
}
export interface ExecutorControlPlaneServiceConfig {
  readonly callerAuthorities: readonly ExecutorCallerAuthority[];
  readonly keyId: string;
  readonly privateSigningKey: KeyObject;
  readonly physical: SandboxExecutionPort;
  readonly receipts: DockerExecutorReceiptStore;
  readonly executionLedger: FilesystemExecutionLedger;
  readonly tenancyLedger: FilesystemSandboxTenancyLedger;
  /** When set, a tenant may only mount a workspace beneath its own subdirectory of this root. */
  readonly tenantWorkspaceRoot?: string;
  /** Recovers a completed execution's result from durable receipts, without executing anything. */
  readonly recoverTerminal?: (input:{executionTokenHash:string;sandboxId:string}) => Promise<unknown|null>;
}

export function createDurableReceiptAttestor(config:Pick<ExecutorControlPlaneServiceConfig,'keyId'|'privateSigningKey'|'receipts'> & {executionLedger?:FilesystemExecutionLedger}) {
  return async(input:{phase:'BEFORE'|'AFTER';executionTokenHash:string;sandboxId:string}):Promise<void>=>{
    const directory=config.receipts.directory(input.executionTokenHash,input.sandboxId);
    const manifest=JSON.parse(await readFile(join(directory,'request.json'),'utf8')) as {invocationId:string;dispatchGeneration:number;sandboxId:string;requestDigest:string};
    if(typeof manifest?.invocationId!=='string'||!Number.isSafeInteger(manifest?.dispatchGeneration)||typeof manifest?.sandboxId!=='string'||!/^[a-f0-9]{64}$/.test(String(manifest?.requestDigest)))throw new Error('executor_attestation_manifest_invalid');
    if(manifest.sandboxId!==input.sandboxId)throw new Error('executor_attestation_scope_mismatch');
    const raw=await readFile(join(directory,`${input.phase.toLowerCase()}.receipt`),'utf8');
    // The signature is the artefact third parties trust, so the bytes are parsed and reconciled with the
    // manifest BEFORE they are signed. Signing first and validating on the way out is the wrong order.
    const receipt=input.phase==='BEFORE'?parseExecutorBeforeReceipt(raw):parseExecutorAfterReceipt(raw);
    if(receipt.invocationId!==manifest.invocationId||Number(receipt.dispatchGeneration)!==manifest.dispatchGeneration||receipt.sandboxId!==manifest.sandboxId||receipt.requestDigest!==manifest.requestDigest)throw new Error('executor_attestation_scope_mismatch');
    const signed=signExecutorAttestation({version:1,keyId:config.keyId,phase:input.phase,executionIdentity:`${manifest.invocationId}:${manifest.dispatchGeneration}:${manifest.sandboxId}`,invocationId:manifest.invocationId,dispatchGeneration:manifest.dispatchGeneration,sandboxId:manifest.sandboxId,requestDigest:manifest.requestDigest,receiptDigest:receiptDigest(raw),issuedAt:new Date().toISOString()},config.privateSigningKey);
    const path=join(directory,`${input.phase.toLowerCase()}.attestation`),serialized=JSON.stringify(signed);
    const executionIdentity=`${manifest.invocationId}:${manifest.dispatchGeneration}:${manifest.sandboxId}`;
    /* The ledger must leave PREPARED BEFORE the gate is published, not after. The gate is what permits the
       untrusted command to start, so if publication came first a failure in between left a running workload
       behind a PREPARED reservation — and a reservation released on the strength of "still PREPARED" would
       then be released after a real effect. Ordering it this way makes PREPARED mean the gate never opened. */
    if(config.executionLedger&&input.phase==='BEFORE'){
      const entry=await config.executionLedger.load(executionIdentity);
      if(entry?.state==='PREPARED')await config.executionLedger.transition({executionIdentity,requestDigest:manifest.requestDigest,from:'PREPARED',to:'BEFORE_DURABLE',now:new Date().toISOString()});
    }
    // The in-sandbox gate polls for this file's existence, so it must appear only once its bytes are durable.
    try{await durablePublish(path,serialized);}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      // A prior attestation is acceptable only if it is a complete, correctly scoped one: `issuedAt` differs
      // per call so the bytes cannot be compared, but a torn or foreign file must not be taken as agreement.
      const prior=JSON.parse(await readFile(path,'utf8')) as typeof signed;
      try{verifyExecutorAttestation(prior,new Map([[config.keyId,createPublicKey(config.privateSigningKey)]]),{phase:input.phase,executionIdentity:signed.attestation.executionIdentity,invocationId:signed.attestation.invocationId,dispatchGeneration:signed.attestation.dispatchGeneration,sandboxId:signed.attestation.sandboxId,requestDigest:signed.attestation.requestDigest,receiptDigest:signed.attestation.receiptDigest});}
      catch{throw new Error('executor_attestation_conflict');}
    }
    if(config.executionLedger){
      const now=new Date().toISOString();
      if(input.phase==='BEFORE'){const entry=await config.executionLedger.load(executionIdentity);if(entry?.state==='BEFORE_DURABLE')await config.executionLedger.transition({executionIdentity,requestDigest:manifest.requestDigest,from:'BEFORE_DURABLE',to:'RUNNING',now});}
      else await config.executionLedger.transition({executionIdentity,requestDigest:manifest.requestDigest,from:'RUNNING',to:'AFTER_DURABLE',now});
    }
  };
}

async function body(request: IncomingMessage):Promise<unknown>{
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of request){const value=Buffer.from(chunk);bytes+=value.length;if(bytes>MAX_BODY_BYTES)throw new Error('request_too_large');chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw new Error('executor_request_body_malformed');}
}

const SAFE_CODE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const LEDGER_CONFLICTS=new Set(['execution_state_conflict','execution_identity_not_reserved','executor_attestation_conflict']);
const statusFor=(message:string):number=>message.startsWith('SECURITY_FAILURE:')||message==='STARTED_UNKNOWN_OUTCOME'||LEDGER_CONFLICTS.has(message)?409:message==='request_too_large'?413:message.startsWith('INVALID_REQUEST:')?400:500;
/** Every shape refusal answers as one family, so a caller can tell a malformed request from an executor fault. */
const validated=async<T>(parse:()=>T|Promise<T>):Promise<T>=>{try{return await parse();}catch(error){const message=error instanceof Error?error.message:'invalid';throw new Error(message.startsWith('SECURITY_FAILURE:')||message==='request_too_large'?message:`INVALID_REQUEST:${message}`);}};

/**
 * Commits the one terminal answer for an execution whose effect has happened and whose receipts are signed.
 * A response too large to return is still a terminal fact and is recorded as one: leaving the entry at
 * AFTER_DURABLE would report a known outcome as unknown for ever, and no retry could clear it.
 */
async function sealTerminal(config:ExecutorControlPlaneServiceConfig,envelope:{executionIdentity:string;requestDigest:string;sandboxId:string;payload:{executionTokenHash:string}},value:unknown):Promise<{status:number;body:string}>{
  const directory=config.receipts.directory(envelope.payload.executionTokenHash,envelope.sandboxId);
  const receiptBodies={BEFORE:await readFile(join(directory,'before.receipt'),'utf8'),AFTER:await readFile(join(directory,'after.receipt'),'utf8')};
  const attestations=await Promise.all((['before','after'] as const).map(async phase=>JSON.parse(await readFile(join(directory,`${phase}.attestation`),'utf8')) as SignedExecutorAttestation));
  // Base64 so the bytes the receipt digested are the bytes Julius verifies; a UTF-8 round trip rewrites them.
  const terminalPayload={stdout:(await readFile(join(directory,'stdout'))).toString('base64'),stderr:(await readFile(join(directory,'stderr'))).toString('base64'),changedPaths:(await readFile(join(directory,'changed-paths'))).toString('base64')};
  // The encoding is stamped in the body: a terminal answer stored by an earlier version carried UTF-8, and
  // an unversioned switch would make every already-settled execution permanently unreplayable.
  const encoded=JSON.stringify({value,attestations,receiptBodies,terminalPayload,terminalPayloadEncoding:'base64'});
  const oversize=Buffer.byteLength(encoded)>MAX_RESPONSE_BYTES;
  const body=oversize?JSON.stringify({error:'TERMINAL_FAILURE:executor_response_too_large'}):encoded,status=oversize?500:200;
  await config.executionLedger.transition({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,from:'AFTER_DURABLE',to:'TERMINAL',resultDigest:createHash('sha256').update(body).digest('hex'),terminalResponse:body,terminalStatus:status,now:new Date().toISOString()});
  return {status,body};
}

async function visibleSandboxes(config:ExecutorControlPlaneServiceConfig,tenantId:string){
  const discovered=await config.physical.discoverSandboxes();
  const owners=await Promise.all(discovered.map(sandbox=>config.tenancyLedger.boundTenant(sandbox.sandboxId)));
  return discovered.filter((_sandbox,index)=>owners[index]===null||owners[index]===tenantId);
}

async function assertQuarantineTarget(config:ExecutorControlPlaneServiceConfig,authority:ExecutorCallerAuthority,runtimeId:string):Promise<void>{
  const target=(await config.physical.discoverSandboxes()).find(sandbox=>sandbox.runtimeId===runtimeId);
  if(!target)throw new Error('SECURITY_FAILURE:executor_quarantine_target_unknown');
  const owner=await config.tenancyLedger.boundTenant(target.sandboxId);
  // Every other sandbox-scoped operation refuses an unowned sandbox. This one destroys a container, so it
  // must refuse it at least as firmly: only fleet authority may act where there is no owner to consult.
  if(owner===null){if(!authority.fleet)throw new Error('SECURITY_FAILURE:executor_sandbox_unbound');return;}
  if(owner!==authority.tenantId)throw new Error('SECURITY_FAILURE:executor_tenant_scope_refused');
}

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
      const input=await validated(()=>body(request));let value:unknown;
      if(operation!=='execute'){
        const parsed=await validated(()=>parseExecutorOperationRequest(operation,input,{tenantId:authority.tenantId}));
        if(SANDBOX_SCOPED.has(operation))await config.tenancyLedger.assert({sandboxId:(parsed as {sandboxId:string}).sandboxId,tenantId:authority.tenantId});
        // The sandbox is this tenant's; the directory it mounts must be too. One shared root would otherwise let
        // any tenant mount another tenant's workspace read-write on a sandbox it legitimately owns.
        if(operation==='prepare'&&config.tenantWorkspaceRoot){
          // The same routine the adapter uses to decide what it will mount, against this tenant's own root.
          const permitted=await permittedWorkspace(resolve(config.tenantWorkspaceRoot,authority.tenantId),(parsed as {sourceRef:string}).sourceRef);
          if(!permitted)throw new Error('SECURITY_FAILURE:executor_workspace_tenant_scope_refused');
        }
        // `quarantine` destroys a container outright and names it by runtime id, so the id must first be
        // shown to belong to a Julius sandbox that is either this tenant's or unowned. Without this the
        // scope reaches an arbitrary `docker rm -f` on the executor host, including its own database.
        if(operation==='quarantine')await assertQuarantineTarget(config,authority,(parsed as {runtimeId:string}).runtimeId);
        // Reconciliation sweeps every tenant's sandboxes at once, so it is fleet authority by definition.
        if(operation==='reconcile'&&!authority.fleet)throw new Error('SECURITY_FAILURE:executor_fleet_authority_required');
        switch(operation){
          case 'create':{
            // Bound after the sandbox physically exists: binding first lets a tenant squat identifiers it never creates.
            value=await config.physical.createSandbox(parsed as Parameters<SandboxExecutionPort['createSandbox']>[0]);
            await config.tenancyLedger.bind({sandboxId:(parsed as {identity:{sandboxId:string}}).identity.sandboxId,tenantId:authority.tenantId});
            break;
          }
          case 'prepare':value=await config.physical.prepareWorkspace(parsed as Parameters<SandboxExecutionPort['prepareWorkspace']>[0]);break;
          case 'cancel':{
            value=await config.physical.cancelExecution(parsed as Parameters<SandboxExecutionPort['cancelExecution']>[0]);
            // cancelExecution destroys the sandbox, so it releases the identifier exactly as destroy does.
            if(value===true)await config.tenancyLedger.unbind({sandboxId:(parsed as {sandboxId:string}).sandboxId,tenantId:authority.tenantId}).catch(()=>undefined);
            break;
          }
          case 'destroy':{
            value=await config.physical.destroySandbox(parsed as Parameters<SandboxExecutionPort['destroySandbox']>[0]);
            // A destroyed sandbox releases its identifier so the namespace is not a permanent first-come claim.
            if(value===true)await config.tenancyLedger.unbind({sandboxId:(parsed as {sandboxId:string}).sandboxId,tenantId:authority.tenantId}).catch(()=>undefined);
            break;
          }
          case 'inspect':value=await config.physical.inspectSandbox(parsed as Parameters<SandboxExecutionPort['inspectSandbox']>[0]);break;
          case 'artifacts':value=await config.physical.collectArtifacts(parsed as Parameters<SandboxExecutionPort['collectArtifacts']>[0]);break;
          // A caller sees its own sandboxes and unowned ones; another tenant's sandbox ids are not enumerable.
          case 'discover':value=await visibleSandboxes(config,authority.tenantId);break;
          case 'quarantine':value=await config.physical.quarantineSandbox(parsed as Parameters<SandboxExecutionPort['quarantineSandbox']>[0]);break;
          case 'reconcile':value=await config.physical.reconcileSandboxes();break;
        }
        const encoded=JSON.stringify({value});if(Buffer.byteLength(encoded)>MAX_RESPONSE_BYTES)throw new Error('executor_response_too_large');
        response.statusCode=200;response.end(encoded);return;
      }
      // The envelope is parsed exactly once, against this service's clock. A caller-supplied timestamp never decides expiry.
      const envelope=await validated(()=>parseExecutorExecutionEnvelope(input,{allowedCallerIds:new Set([authority.callerId])}));
      if(envelope.tenantId!==authority.tenantId)throw new Error('SECURITY_FAILURE:executor_tenant_scope_refused');
      await config.tenancyLedger.assert({sandboxId:envelope.sandboxId,tenantId:authority.tenantId});
      // Reserve before any physical effect and branch on the reservation itself: two concurrent identical requests cannot both execute.
      const reservation=await config.executionLedger.reserve({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,envelopeDigest:executionReplayDigest(envelope),now:new Date().toISOString()});
      if(reservation.kind==='EXISTING'){
        if(reservation.entry.state==='TERMINAL'&&reservation.entry.terminalResponse){response.statusCode=reservation.entry.terminalStatus??200;response.end(reservation.entry.terminalResponse);return;}
        // An execution that reached a durable AFTER has an outcome, whatever interrupted the reply. It is
        // recovered from the receipts rather than reported unknown, and nothing is executed a second time.
        if(reservation.entry.state==='AFTER_DURABLE'&&config.recoverTerminal){
          // A failure to recover is not an answer. Anything thrown here falls through to the honest unknown
          // rather than escaping as an opaque fault that a caller cannot distinguish from a transient one.
          const sealed=await (async()=>{
            const recovered=await config.recoverTerminal!({executionTokenHash:envelope.payload.executionTokenHash,sandboxId:envelope.sandboxId});
            return recovered?await sealTerminal(config,envelope,recovered):null;
          })().catch(()=>null);
          if(sealed){response.statusCode=sealed.status;response.end(sealed.body);return;}
        }
        throw new Error('STARTED_UNKNOWN_OUTCOME');
      }
      try{
        value=await config.physical.executeTool({sandboxId:envelope.sandboxId,expectedLeaseGeneration:envelope.payload.expectedLeaseGeneration,dispatchGeneration:envelope.dispatchGeneration,requestDigest:envelope.requestDigest,executionTokenHash:envelope.payload.executionTokenHash,effectClassification:envelope.payload.effectClassification,request:envelope.payload.request});
      }catch(error){
        /* The gate the untrusted command waits on is the BEFORE attestation. If it is not on disk the
           workload provably never started, whether the ledger stopped at PREPARED or at BEFORE_DURABLE —
           the transition now precedes the publish. Releasing then lets an honest retry through instead of
           burning the identity; if the gate exists, nothing is released and the answer stays unknown. */
        const gate=join(config.receipts.directory(envelope.payload.executionTokenHash,envelope.sandboxId),'before.attestation');
        const opened=await access(gate).then(()=>true,()=>false);
        if(!opened)for(const expected of ['PREPARED','BEFORE_DURABLE'] as const)
          await config.executionLedger.release({executionIdentity:envelope.executionIdentity,requestDigest:envelope.requestDigest,expected}).catch(()=>undefined);
        throw error;
      }
      const sealed=await sealTerminal(config,envelope,value);
      response.statusCode=sealed.status;response.end(sealed.body);
    }catch(error){
      const message=error instanceof Error?error.message:'executor_failure';
      response.statusCode=statusFor(message);
      // The client is still uploading a body this service refused to read, so the socket cannot be reused.
      if(message==='request_too_large')response.setHeader('connection','close');
      // Only this service's own refusal codes cross the boundary. A filesystem or driver message would
      // hand Julius the receipt-store path it is not allowed to know, so anything else answers as a fault.
      response.end(JSON.stringify({error:SAFE_CODE.test(message)?message:'executor_failure'}));
    }
  });
}
