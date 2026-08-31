import { createHash } from 'node:crypto';
import { digest as sha256, exact, exactOptional, identifier, integer as wholeNumber, iso as isoTimestamp, json as jsonValue, str, type JsonValue } from './executor-schema';
import type { JuliusToolEffectClassification } from '../../mission/julius/julius-tool-lifecycle';
import type { JuliusToolId, ToolInvocationRequest } from '../../mission/julius/julius-tools';


export interface ExecutorExecutionEnvelope {
  readonly schemaVersion: 1;
  readonly callerId: string;
  readonly callerScope: 'sandbox:execute';
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly invocationId: string;
  readonly dispatchGeneration: number;
  readonly sandboxId: string;
  readonly requestDigest: string;
  readonly executionIdentity: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly payload: {
    readonly expectedLeaseGeneration: number;
    readonly executionTokenHash: string;
    readonly effectClassification: JuliusToolEffectClassification;
    readonly request: ToolInvocationRequest;
  };
}

const TOOL_IDS = new Set<JuliusToolId>(['fs.read','fs.write','fs.patch','fs.list','fs.stat','fs.mkdir','fs.move','fs.copy','fs.remove','search.grep','search.find','search.glob','process.exec','shell.bash','git.status','git.diff','git.show','git.log','git.apply','test.run','build.run']);
const EFFECTS = new Set<JuliusToolEffectClassification>(['READ_ONLY','IDEMPOTENT_MUTATION','NON_IDEMPOTENT_MUTATION','PROCESS_WITH_EXTERNAL_EFFECT']);
const E='execution_envelope_invalid';
const string=(value:unknown,name:string,max=256)=>str(value,name,E,max);
const id=(value:unknown,name:string)=>identifier(value,name,E);
const integer=(value:unknown,name:string,min=1,max=Number.MAX_SAFE_INTEGER)=>wholeNumber(value,name,E,min,max);
const iso=(value:unknown,name:string)=>isoTimestamp(value,name,E);
const digest=(value:unknown,name:string)=>sha256(value,name,E);
const json=(value:unknown)=>jsonValue(value,E);

function parseRequest(value:unknown):ToolInvocationRequest {
  const request=exactOptional(value,['invocationId','runId','taskId','projectId','workerId','toolId','toolVersion','arguments','idempotencyKey','expectedMutation'],['cwd','timeoutMs'],'execution_request');
  if(!request.arguments||typeof request.arguments!=='object'||Array.isArray(request.arguments))throw new Error('execution_arguments:object_required');
  // Budgeted so the whole envelope still fits the digest walk's depth limit; otherwise arguments could parse
  // here and then fail as an executor fault when the envelope is digested.
  const args=jsonValue(request.arguments,E,3) as Readonly<Record<string,JsonValue>>;
  if(Object.keys(args).length>64||JSON.stringify(args).length>64*1024)throw new Error('execution_envelope_invalid:arguments');
  const cwd=request.cwd===undefined?undefined:string(request.cwd,'cwd',1024);
  if(cwd!==undefined&&(cwd.startsWith('/')||cwd.split(/[\\/]/).includes('..')))throw new Error('execution_envelope_invalid:cwd');
  const timeoutMs=request.timeoutMs===undefined?undefined:integer(request.timeoutMs,'timeoutMs',1,3_600_000);
  if(!TOOL_IDS.has(request.toolId as JuliusToolId))throw new Error('execution_envelope_invalid:toolId');
  if(request.expectedMutation!=='NONE'&&request.expectedMutation!=='WORKSPACE')throw new Error('execution_envelope_invalid:expectedMutation');
  return {invocationId:id(request.invocationId,'request.invocationId'),runId:id(request.runId,'request.runId'),taskId:id(request.taskId,'request.taskId'),projectId:id(request.projectId,'request.projectId'),workerId:id(request.workerId,'workerId'),toolId:request.toolId as JuliusToolId,toolVersion:string(request.toolVersion,'toolVersion',64),arguments:args,cwd,idempotencyKey:id(request.idempotencyKey,'idempotencyKey'),timeoutMs,expectedMutation:request.expectedMutation};
}

export function parseExecutorExecutionEnvelope(value:unknown,options:{now?:Date;maximumLifetimeMs?:number;maximumFutureSkewMs?:number;allowedCallerIds?:ReadonlySet<string>}={}):ExecutorExecutionEnvelope {
  const input=exact(value,['schemaVersion','callerId','callerScope','tenantId','projectId','runId','taskId','invocationId','dispatchGeneration','sandboxId','requestDigest','executionIdentity','nonce','issuedAt','expiresAt','payload'],'execution_envelope');
  if(input.schemaVersion!==1||input.callerScope!=='sandbox:execute')throw new Error('execution_envelope_invalid:schema_or_scope');
  const callerId=id(input.callerId,'callerId');if(options.allowedCallerIds&&!options.allowedCallerIds.has(callerId))throw new Error('execution_envelope_scope_refused');
  const payload=exact(input.payload,['expectedLeaseGeneration','executionTokenHash','effectClassification','request'],'execution_payload');
  const request=parseRequest(payload.request);const issuedAt=iso(input.issuedAt,'issuedAt'),expiresAt=iso(input.expiresAt,'expiresAt');
  const now=(options.now??new Date()).getTime(),issued=Date.parse(issuedAt),expires=Date.parse(expiresAt),maxLifetime=options.maximumLifetimeMs??300_000,skew=options.maximumFutureSkewMs??30_000;
  if(issued>now+skew)throw new Error('execution_envelope_not_yet_valid');if(expires<=now)throw new Error('execution_envelope_expired');if(expires<=issued||expires-issued>maxLifetime)throw new Error('execution_envelope_lifetime_invalid');
  const invocationId=id(input.invocationId,'invocationId'),dispatchGeneration=integer(input.dispatchGeneration,'dispatchGeneration'),sandboxId=id(input.sandboxId,'sandboxId'),requestDigest=digest(input.requestDigest,'requestDigest');
  const projectId=id(input.projectId,'projectId'),runId=id(input.runId,'runId'),taskId=id(input.taskId,'taskId');
  if(request.invocationId!==invocationId||request.projectId!==projectId||request.runId!==runId||request.taskId!==taskId)throw new Error('execution_envelope_scope_mismatch');
  const executionIdentity=id(input.executionIdentity,'executionIdentity');if(executionIdentity!==`${invocationId}:${dispatchGeneration}:${sandboxId}`)throw new Error('execution_envelope_identity_mismatch');
  if(!EFFECTS.has(payload.effectClassification as JuliusToolEffectClassification))throw new Error('execution_envelope_invalid:effectClassification');
  // The executor digests the request itself. A digest the caller merely asserts binds nothing.
  if(requestDigest!==canonicalRequestDigest(request))throw new Error('execution_envelope_request_digest_mismatch');
  return {schemaVersion:1,callerId,callerScope:'sandbox:execute',tenantId:id(input.tenantId,'tenantId'),projectId,runId,taskId,invocationId,dispatchGeneration,sandboxId,requestDigest,executionIdentity,nonce:id(input.nonce,'nonce'),issuedAt,expiresAt,payload:{expectedLeaseGeneration:integer(payload.expectedLeaseGeneration,'expectedLeaseGeneration'),executionTokenHash:digest(payload.executionTokenHash,'executionTokenHash'),effectClassification:payload.effectClassification as JuliusToolEffectClassification,request}};
}

export function executionEnvelopeDigest(envelope:ExecutorExecutionEnvelope):string {return createHash('sha256').update(JSON.stringify(json(envelope))).digest('hex');}

/**
 * The envelope minus the three fields a legitimate retry is expected to change. Two envelopes sharing an
 * execution identity must agree on everything else, so a caller cannot present one identity with a
 * different request and be answered with the first request's terminal material.
 */
export function executionReplayDigest(envelope:ExecutorExecutionEnvelope):string {
  const {nonce:_nonce,issuedAt:_issuedAt,expiresAt:_expiresAt,...stable}=envelope;
  return createHash('sha256').update(JSON.stringify(json(stable))).digest('hex');
}

/** The digest the executor computes for itself, so a caller's claim about its own request is never taken on trust. */
export function canonicalRequestDigest(request:ToolInvocationRequest):string {
  // Absent optional fields and fields present as undefined are the same request, so they must digest alike.
  const defined=Object.fromEntries(Object.entries(request).filter(([,value])=>value!==undefined));
  return createHash('sha256').update(JSON.stringify(jsonValue(defined,E,3))).digest('hex');
}
