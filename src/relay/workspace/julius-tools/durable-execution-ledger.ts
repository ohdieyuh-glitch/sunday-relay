import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type DurableExecutionState='PREPARED'|'BEFORE_DURABLE'|'RUNNING'|'AFTER_DURABLE'|'TERMINAL';
export interface DurableExecutionEntry {readonly executionIdentity:string;readonly requestDigest:string;readonly envelopeDigest:string;readonly state:DurableExecutionState;readonly resultDigest:string|null;readonly terminalResponse:string|null;readonly updatedAt:string;}
const STATES:readonly DurableExecutionState[]=['PREPARED','BEFORE_DURABLE','RUNNING','AFTER_DURABLE','TERMINAL'];
const key=(identity:string)=>createHash('sha256').update(identity).digest('hex');
const validate=(value:unknown):DurableExecutionEntry=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('execution_ledger_corrupt');const x=value as Record<string,unknown>;if(Object.keys(x).sort().join(',')!=='envelopeDigest,executionIdentity,requestDigest,resultDigest,state,terminalResponse,updatedAt'||typeof x.executionIdentity!=='string'||typeof x.requestDigest!=='string'||typeof x.envelopeDigest!=='string'||!STATES.includes(x.state as DurableExecutionState)||(x.resultDigest!==null&&typeof x.resultDigest!=='string')||(x.terminalResponse!==null&&typeof x.terminalResponse!=='string')||typeof x.updatedAt!=='string'||(x.state==='TERMINAL')!==(typeof x.terminalResponse==='string'))throw new Error('execution_ledger_corrupt');return x as unknown as DurableExecutionEntry;};

/** Executor-owned filesystem ledger. Exclusive create and atomic rename make replay state survive service restarts. */
export class FilesystemExecutionLedger {
  constructor(private readonly root:string){}
  private path(identity:string){return join(this.root,`${key(identity)}.json`);}
  async reserve(input:{executionIdentity:string;requestDigest:string;envelopeDigest:string;now:string}):Promise<{kind:'NEW'|'EXISTING';entry:DurableExecutionEntry}>{
    await mkdir(this.root,{recursive:true,mode:0o700});const entry:DurableExecutionEntry={executionIdentity:input.executionIdentity,requestDigest:input.requestDigest,envelopeDigest:input.envelopeDigest,state:'PREPARED',resultDigest:null,terminalResponse:null,updatedAt:input.now};const path=this.path(input.executionIdentity);
    try{const handle=await open(path,'wx',0o600);try{await handle.writeFile(JSON.stringify(entry));await handle.sync();}finally{await handle.close();}const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}return {kind:'NEW',entry};}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await this.load(input.executionIdentity);if(!existing)throw new Error('execution_ledger_corrupt');if(existing.requestDigest!==input.requestDigest)throw new Error('SECURITY_FAILURE:execution_identity_conflict');return {kind:'EXISTING',entry:existing};}
  }
  async load(identity:string):Promise<DurableExecutionEntry|null>{try{return validate(JSON.parse(await readFile(this.path(identity),'utf8')) as unknown);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async transition(input:{executionIdentity:string;requestDigest:string;from:DurableExecutionState;to:DurableExecutionState;resultDigest?:string|null;terminalResponse?:string|null;now:string}):Promise<DurableExecutionEntry>{
    const current=await this.load(input.executionIdentity);if(!current)throw new Error('execution_identity_not_reserved');if(current.requestDigest!==input.requestDigest)throw new Error('SECURITY_FAILURE:execution_identity_conflict');
    if(current.state===input.to){if((input.resultDigest??null)!==current.resultDigest||(input.terminalResponse??null)!==current.terminalResponse)throw new Error('SECURITY_FAILURE:execution_terminal_conflict');return current;}
    if(current.state!==input.from||STATES.indexOf(input.to)!==STATES.indexOf(input.from)+1)throw new Error('execution_state_conflict');
    if(input.to==='TERMINAL'&&(typeof input.terminalResponse!=='string'||!input.resultDigest))throw new Error('execution_terminal_material_required');
    if(input.to!=='TERMINAL'&&input.terminalResponse!==undefined&&input.terminalResponse!==null)throw new Error('execution_terminal_material_early');
    const next:DurableExecutionEntry={...current,state:input.to,resultDigest:input.resultDigest??null,terminalResponse:input.terminalResponse??null,updatedAt:input.now};const path=this.path(input.executionIdentity),temporary=`${path}.${process.pid}.${Date.now()}.tmp`;const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(next));await handle.sync();}finally{await handle.close();}await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}return next;
  }
  async removeForTests(identity:string):Promise<void>{await rm(this.path(identity),{force:true});}
}
