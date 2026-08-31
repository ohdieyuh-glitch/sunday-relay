import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type DurableExecutionState='PREPARED'|'BEFORE_DURABLE'|'RUNNING'|'AFTER_DURABLE'|'TERMINAL';
export interface DurableExecutionEntry {readonly executionIdentity:string;readonly requestDigest:string;readonly envelopeDigest:string;readonly state:DurableExecutionState;readonly resultDigest:string|null;readonly terminalResponse:string|null;readonly terminalStatus:number|null;readonly updatedAt:string;}
const STATES:readonly DurableExecutionState[]=['PREPARED','BEFORE_DURABLE','RUNNING','AFTER_DURABLE','TERMINAL'];
const KEYS='envelopeDigest,executionIdentity,requestDigest,resultDigest,state,terminalResponse,terminalStatus,updatedAt';
const LEGACY_KEYS='envelopeDigest,executionIdentity,requestDigest,resultDigest,state,terminalResponse,updatedAt';
const key=(identity:string)=>createHash('sha256').update(identity).digest('hex');
const validate=(value:unknown):DurableExecutionEntry=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('execution_ledger_corrupt');const x=value as Record<string,unknown>;
  // An entry written before terminalStatus existed is upgraded on read: refusing it would make an already
  // settled execution's terminal answer unreachable for ever, which is the one thing the ledger exists to keep.
  if(Object.keys(x).sort().join(',')===LEGACY_KEYS)x.terminalStatus=x.state==='TERMINAL'?200:null;
  if(Object.keys(x).sort().join(',')!==KEYS||typeof x.executionIdentity!=='string'||typeof x.requestDigest!=='string'||typeof x.envelopeDigest!=='string'||!STATES.includes(x.state as DurableExecutionState)||(x.resultDigest!==null&&typeof x.resultDigest!=='string')||(x.terminalResponse!==null&&typeof x.terminalResponse!=='string')||(x.terminalStatus!==null&&!Number.isSafeInteger(x.terminalStatus))||typeof x.updatedAt!=='string'||(x.state==='TERMINAL')!==(typeof x.terminalResponse==='string'))throw new Error('execution_ledger_corrupt');return x as unknown as DurableExecutionEntry;};

/**
 * Publishes a file that is either absent or complete, never both-visible-and-empty.
 * `open(path,'wx')` creates the directory entry before the content is written, and a reader that
 * only tests for existence — the in-sandbox attestation gate does exactly that — can observe the
 * gap. Writing a temporary, syncing it, then `link`ing it into place keeps the exclusive-create
 * semantics (link fails EEXIST) while making the name appear only once the bytes are durable.
 */
export async function durablePublish(path:string,body:string):Promise<void>{
  // Only the link's EEXIST may mean "the target already exists"; a temporary-name collision is retried, or
  // callers would read a collision as a prior reservation and answer a corrupt-ledger error for a fresh one.
  let handle;let temporary='';
  for(let attempt=0;;attempt++){
    temporary=`${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try{handle=await open(temporary,'wx',0o600);break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||attempt>=4)throw error;}
  }
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  try{await link(temporary,path);}finally{await unlink(temporary).catch(()=>undefined);}
  const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
}

/** Executor-owned filesystem ledger. Exclusive publication and atomic rename make replay state survive service restarts. */
export class FilesystemExecutionLedger {
  constructor(private readonly root:string){}
  private path(identity:string){return join(this.root,`${key(identity)}.json`);}
  async reserve(input:{executionIdentity:string;requestDigest:string;envelopeDigest:string;now:string}):Promise<{kind:'NEW'|'EXISTING';entry:DurableExecutionEntry}>{
    await mkdir(this.root,{recursive:true,mode:0o700});const entry:DurableExecutionEntry={executionIdentity:input.executionIdentity,requestDigest:input.requestDigest,envelopeDigest:input.envelopeDigest,state:'PREPARED',resultDigest:null,terminalResponse:null,terminalStatus:null,updatedAt:input.now};
    try{await durablePublish(this.path(input.executionIdentity),JSON.stringify(entry));return {kind:'NEW',entry};}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await this.load(input.executionIdentity);if(!existing)throw new Error('execution_ledger_corrupt');if(existing.requestDigest!==input.requestDigest)throw new Error('SECURITY_FAILURE:execution_identity_conflict');
      // The same identity replayed with a materially different envelope is a conflict, not a replay.
      if(existing.envelopeDigest!==input.envelopeDigest)throw new Error('SECURITY_FAILURE:execution_envelope_conflict');
      return {kind:'EXISTING',entry:existing};}
  }
  async load(identity:string):Promise<DurableExecutionEntry|null>{try{return validate(JSON.parse(await readFile(this.path(identity),'utf8')) as unknown);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  /** Releases a reservation whose execution provably never started, so an honest retry is not refused forever. */
  async release(input:{executionIdentity:string;requestDigest:string;expected:DurableExecutionState}):Promise<boolean>{
    const current=await this.load(input.executionIdentity);
    if(!current||current.requestDigest!==input.requestDigest||current.state!==input.expected)return false;
    await rm(this.path(input.executionIdentity),{force:true});return true;
  }
  async transition(input:{executionIdentity:string;requestDigest:string;from:DurableExecutionState;to:DurableExecutionState;resultDigest?:string|null;terminalResponse?:string|null;terminalStatus?:number|null;now:string}):Promise<DurableExecutionEntry>{
    const current=await this.load(input.executionIdentity);if(!current)throw new Error('execution_identity_not_reserved');if(current.requestDigest!==input.requestDigest)throw new Error('SECURITY_FAILURE:execution_identity_conflict');
    if(current.state===input.to){if((input.resultDigest??null)!==current.resultDigest||(input.terminalResponse??null)!==current.terminalResponse)throw new Error('SECURITY_FAILURE:execution_terminal_conflict');return current;}
    if(current.state!==input.from||STATES.indexOf(input.to)!==STATES.indexOf(input.from)+1)throw new Error('execution_state_conflict');
    if(input.to==='TERMINAL'&&(typeof input.terminalResponse!=='string'||!input.resultDigest))throw new Error('execution_terminal_material_required');
    if(input.to!=='TERMINAL'&&input.terminalResponse!==undefined&&input.terminalResponse!==null)throw new Error('execution_terminal_material_early');
    const next:DurableExecutionEntry={...current,state:input.to,resultDigest:input.resultDigest??null,terminalResponse:input.terminalResponse??null,terminalStatus:input.to==='TERMINAL'?(input.terminalStatus??200):null,updatedAt:input.now};
    const path=this.path(input.executionIdentity),temporary=`${path}.${process.pid}.${Date.now()}.tmp`;const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(next));await handle.sync();}finally{await handle.close();}await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}return next;
  }
  async removeForTests(identity:string):Promise<void>{await rm(this.path(identity),{force:true});}
}

/**
 * Executor-owned sandbox->tenant binding, written once a sandbox physically exists and released when it
 * is destroyed. Keyed on the sandbox id alone rather than on (tenant, sandbox): the physical record is
 * keyed on the sandbox id too, so a per-tenant namespace would let a second tenant bind an id the first
 * tenant already owns and then act on that tenant's sandbox.
 */
export class FilesystemSandboxTenancyLedger {
  constructor(private readonly root:string){}
  private path(sandboxId:string){return join(this.root,`${key(sandboxId)}.tenant`);}
  async bind(input:{sandboxId:string;tenantId:string}):Promise<void>{
    await mkdir(this.root,{recursive:true,mode:0o700});
    try{await durablePublish(this.path(input.sandboxId),input.tenantId);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await this.assert(input);}
  }
  async boundTenant(sandboxId:string):Promise<string|null>{
    try{return await readFile(this.path(sandboxId),'utf8');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  async assert(input:{sandboxId:string;tenantId:string}):Promise<void>{
    const bound=await this.boundTenant(input.sandboxId);
    if(bound===null)throw new Error('SECURITY_FAILURE:executor_sandbox_unbound');
    if(bound!==input.tenantId)throw new Error('SECURITY_FAILURE:executor_tenant_scope_refused');
  }
  /** A destroyed sandbox releases its identifier, so the namespace is not a permanent first-come claim. */
  async unbind(input:{sandboxId:string;tenantId:string}):Promise<void>{
    await this.assert(input);await rm(this.path(input.sandboxId),{force:true});
  }
}
