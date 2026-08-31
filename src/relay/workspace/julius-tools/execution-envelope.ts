import { createHash } from 'node:crypto';
import type { JuliusToolEffectClassification } from '../../mission/julius/julius-tool-lifecycle';
import type { JuliusToolId, ToolInvocationRequest } from '../../mission/julius/julius-tools';

export type ExecutorCallerScope = 'sandbox:create'|'sandbox:execute'|'sandbox:inspect'|'sandbox:cancel'|'sandbox:destroy'|'sandbox:reconcile';
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
const exact=(value:unknown,keys:readonly string[],code:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${code}:object_required`);const record=value as Record<string,unknown>;const actual=Object.keys(record).sort();const expected=[...keys].sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw new Error(`${code}:fields_invalid`);return record;};
const exactOptional=(value:unknown,required:readonly string[],optional:readonly string[],code:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${code}:object_required`);const record=value as Record<string,unknown>,allowed=new Set([...required,...optional]);if(required.some(key=>!(key in record))||Object.keys(record).some(key=>!allowed.has(key)))throw new Error(`${code}:fields_invalid`);return record;};
const string=(value:unknown,name:string,max=256):string=>{if(typeof value!=='string'||value.length<1||value.length>max||/[\u0000-\u001f]/.test(value))throw new Error(`execution_envelope_invalid:${name}`);return value;};
const id=(value:unknown,name:string):string=>{const result=string(value,name,128);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result))throw new Error(`execution_envelope_invalid:${name}`);return result;};
const integer=(value:unknown,name:string,min=1,max=Number.MAX_SAFE_INTEGER):number=>{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw new Error(`execution_envelope_invalid:${name}`);return Number(value);};
const iso=(value:unknown,name:string):string=>{const result=string(value,name,40);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result)||!Number.isFinite(Date.parse(result)))throw new Error(`execution_envelope_invalid:${name}`);return result;};
const digest=(value:unknown,name:string):string=>{const result=string(value,name,128);if(!/^[a-f0-9]{64}$/.test(result))throw new Error(`execution_envelope_invalid:${name}`);return result;};
type JsonValue=null|boolean|number|string|readonly JsonValue[]|{readonly [key:string]:JsonValue};
const json=(value:unknown,depth=0):JsonValue=>{if(depth>8)throw new Error('execution_envelope_invalid:arguments_depth');if(value===null||typeof value==='boolean')return value;if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('execution_envelope_invalid:arguments_number');return value;}if(typeof value==='string'){if(value.length>16_384)throw new Error('execution_envelope_invalid:arguments_string');return value;}if(Array.isArray(value)){if(value.length>256)throw new Error('execution_envelope_invalid:arguments_array');return value.map(item=>json(item,depth+1));}if(value&&typeof value==='object'){const record=value as Record<string,unknown>,keys=Object.keys(record).sort();if(keys.length>64||keys.some(key=>!key||key.length>128||/[\u0000-\u001f]/.test(key)))throw new Error('execution_envelope_invalid:arguments_keys');return Object.fromEntries(keys.map(key=>[key,json(record[key],depth+1)]));}throw new Error('execution_envelope_invalid:arguments_value');};

function parseRequest(value:unknown):ToolInvocationRequest {
  const request=exactOptional(value,['invocationId','runId','taskId','projectId','workerId','toolId','toolVersion','arguments','idempotencyKey','expectedMutation'],['cwd','timeoutMs'],'execution_request');
  const args=json(exact(request.arguments,Object.keys(request.arguments as object),'execution_arguments')) as Readonly<Record<string,JsonValue>>;
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
  return {schemaVersion:1,callerId,callerScope:'sandbox:execute',tenantId:id(input.tenantId,'tenantId'),projectId,runId,taskId,invocationId,dispatchGeneration,sandboxId,requestDigest,executionIdentity,nonce:id(input.nonce,'nonce'),issuedAt,expiresAt,payload:{expectedLeaseGeneration:integer(payload.expectedLeaseGeneration,'expectedLeaseGeneration'),executionTokenHash:digest(payload.executionTokenHash,'executionTokenHash'),effectClassification:payload.effectClassification as JuliusToolEffectClassification,request}};
}

export function executionEnvelopeDigest(envelope:ExecutorExecutionEnvelope):string {return createHash('sha256').update(JSON.stringify(json(envelope))).digest('hex');}
