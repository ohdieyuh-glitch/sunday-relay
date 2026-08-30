import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import type { JuliusPolicyDecision, JuliusToolAdapter, JuliusToolDefinition, JuliusToolEvidence, ToolInvocationRequest, ToolInvocationResult, JuliusToolExecutionContext } from '../../mission/julius';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const SECRET=/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s'\"]+)/gi;
const redact=(value:string)=>value.replace(SECRET,'[REDACTED]');
const text=(args:Readonly<Record<string,unknown>>,key:string):string=>{const value=args[key];if(typeof value!=='string')throw new Error(`tool_argument_${key}_required`);return value;};

async function boundedPath(root:string,requested:string,forCreation=false):Promise<string>{
 if(!requested||isAbsolute(requested))throw new Error('workspace_path_refused');const rootReal=await realpath(root);const candidate=resolve(rootReal,requested);const rel=relative(rootReal,candidate);if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('workspace_path_refused');
 let existing=forCreation?candidate:candidate;if(forCreation){for(;;){try{await lstat(existing);break;}catch{const parent=dirname(existing);if(parent===existing)throw new Error('workspace_path_refused');existing=parent;}}}const existingReal=await realpath(existing);const existingRel=relative(rootReal,existingReal);if(existingRel==='..'||existingRel.startsWith(`..${sep}`)||isAbsolute(existingRel))throw new Error('workspace_symlink_escape_refused');return candidate;
}
const evidence=(request:ToolInvocationRequest,type:JuliusToolEvidence['type'],facts:JuliusToolEvidence['facts']):JuliusToolEvidence=>{const integrityHash=hash(JSON.stringify(facts));return{evidenceId:`tool-evidence:${request.invocationId}:${type.toLowerCase()}`,type,integrityHash,facts};};

export class NodeJuliusToolAdapter implements JuliusToolAdapter {
 async execute(definition:JuliusToolDefinition,request:ToolInvocationRequest,context:JuliusToolExecutionContext,decision:JuliusPolicyDecision):Promise<ToolInvocationResult>{
  const started=Date.now();try{
   if(definition.executesProcess)return await this.process(definition,request,context,decision,started);
   return await this.filesystem(definition,request,context,decision,started);
  }catch(error){const safe=error instanceof Error?redact(error.message):'Tool execution failed.';return this.result(request,decision,started,'FAILED',null,safe,'','',[],[]);}
 }
 private async filesystem(definition:JuliusToolDefinition,request:ToolInvocationRequest,context:JuliusToolExecutionContext,decision:JuliusPolicyDecision,started:number):Promise<ToolInvocationResult>{
  if(definition.mutatesFilesystem&&context.filesystemIsolation!=='WORKSPACE_ONLY')throw new Error('workspace_is_read_only');const args=request.arguments;const requested=text(args,'path');const creating=['fs.write','fs.mkdir'].includes(request.toolId);const path=await boundedPath(context.workspaceRoot,requested,creating);let stdout='';const mutations:{path:string;beforeHash:string|null;afterHash:string|null}[]=[];
  const before=async(p:string)=>{try{return hash(await readFile(p));}catch{return null;}};
  switch(request.toolId){
   case'fs.read':stdout=(await readFile(path,'utf8')).slice(0,definition.outputCeilingBytes);break;
   case'fs.list':stdout=this.cap(JSON.stringify(await readdir(path,{withFileTypes:true}).then(rows=>rows.map(row=>({name:row.name,type:row.isDirectory()?'directory':row.isFile()?'file':'other'})))),definition.outputCeilingBytes);break;
   case'fs.stat':{const row=await stat(path);stdout=JSON.stringify({size:row.size,mode:row.mode&0o777,isFile:row.isFile(),isDirectory:row.isDirectory(),modifiedAt:row.mtime.toISOString()});break;}
   case'fs.write':{const prior=await before(path);await mkdir(dirname(path),{recursive:true});await writeFile(path,text(args,'content'),{flag:args.createOnly===true?'wx':'w'});mutations.push({path:requested,beforeHash:prior,afterHash:await before(path)});break;}
   case'fs.patch':{const prior=await before(path);const content=await readFile(path,'utf8');const oldText=text(args,'oldText'),newText=text(args,'newText');const occurrences=content.split(oldText).length-1;if(occurrences!==1)throw new Error(occurrences===0?'patch_context_not_found':'patch_context_not_unique');if(typeof args.beforeHash==='string'&&args.beforeHash!==prior)throw new Error('patch_before_hash_mismatch');await writeFile(path,content.replace(oldText,newText));mutations.push({path:requested,beforeHash:prior,afterHash:await before(path)});break;}
   case'fs.mkdir':await mkdir(path,{recursive:args.recursive===true});mutations.push({path:requested,beforeHash:null,afterHash:hash('directory')});break;
   case'fs.remove':{const prior=await before(path);await rm(path,{recursive:args.recursive===true,force:false});mutations.push({path:requested,beforeHash:prior,afterHash:null});break;}
   case'fs.copy':case'fs.move':{const destinationRequested=text(args,'destination');const destination=await boundedPath(context.workspaceRoot,destinationRequested,true);const prior=await before(destination);if(request.toolId==='fs.copy')await copyFile(path,destination,constants.COPYFILE_EXCL);else await rename(path,destination);mutations.push({path:destinationRequested,beforeHash:prior,afterHash:await before(destination)});break;}
   case'search.grep':{const pattern=text(args,'pattern');const regex=new RegExp(pattern,args.ignoreCase===true?'i':'');const files=await this.walk(path,Number(args.maxFiles??1000));const matches:string[]=[];for(const file of files){const content=await readFile(file,'utf8');content.split('\n').forEach((line,index)=>{if(regex.test(line)&&matches.length<1000)matches.push(`${relative(context.workspaceRoot,file)}:${index+1}:${line}`);});}stdout=matches.join('\n');break;}
   case'search.find':case'search.glob':{const needle=String(args.pattern??'');stdout=(await this.walk(path,Number(args.maxFiles??1000))).map(file=>relative(context.workspaceRoot,file)).filter(file=>file.includes(needle.replaceAll('*',''))).join('\n');break;}
   default:throw new Error('tool_not_implemented');
  }
  const type=mutations.length?'FILE_MUTATION':'ARTIFACT';const facts={toolId:request.toolId,pathsChanged:mutations.length,outputBytes:Buffer.byteLength(stdout)};return this.result(request,decision,started,'SUCCEEDED',0,'Tool completed.',redact(stdout),'',mutations,[evidence(request,type,facts)]);
 }
 private async process(definition:JuliusToolDefinition,request:ToolInvocationRequest,context:JuliusToolExecutionContext,decision:JuliusPolicyDecision,started:number):Promise<ToolInvocationResult>{
  // General processes can mutate and open sockets. Both isolation attestations
  // are mandatory in addition to C.A.R.D.; a deployment unable to provide
  // them fails closed rather than pretending command inspection is a sandbox.
  if(context.filesystemIsolation!=='WORKSPACE_ONLY')throw new Error('process_requires_writable_workspace_isolation');
  if(context.networkIsolation!=='MEDIATED_ALLOW')throw new Error('process_requires_network_mediation');
  const cwd=await boundedPath(context.workspaceRoot,request.cwd??'.');let executable:string;let args:string[];
  const command=typeof request.arguments.command==='string'?request.arguments.command:'';
  if(request.toolId==='shell.bash'||request.toolId==='process.exec'||request.toolId==='test.run'||request.toolId==='build.run'){if(!command)throw new Error('tool_argument_command_required');executable='/bin/bash';args=['--noprofile','--norc','-lc',command];}
  else {executable='/usr/bin/git';args=this.gitArguments(request.toolId,command);}
  const cap=definition.outputCeilingBytes;let stdout:Buffer<ArrayBufferLike>=Buffer.alloc(0),stderr:Buffer<ArrayBufferLike>=Buffer.alloc(0),totalBytes=0,truncatedOut=false,truncatedErr=false,timedOut=false,cancelled=false;const environment:Record<string,string>={...context.safeEnvironment,PATH:'/usr/local/bin:/usr/bin:/bin',HOME:context.workspaceRoot,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TMPDIR:join(context.workspaceRoot,'.julius-tmp')};await mkdir(environment.TMPDIR,{recursive:true});
  if(context.signal?.aborted)return this.result(request,decision,started,'CANCELLED',null,'Command cancelled before execution.','','',[],[]);const child=spawn(executable,args,{cwd,env:environment,detached:true,stdio:['pipe','pipe','pipe']});const append=(current:Buffer,chunk:Buffer,onTruncate:()=>void)=>{const remaining=Math.max(0,cap-totalBytes);const used=Math.min(remaining,chunk.length);totalBytes+=used;if(chunk.length>used)onTruncate();return used?Buffer.concat([current,chunk.subarray(0,used)]):current;};child.stdout.on('data',(chunk:Buffer)=>stdout=append(stdout,chunk,()=>truncatedOut=true));child.stderr.on('data',(chunk:Buffer)=>stderr=append(stderr,chunk,()=>truncatedErr=true));const stdin=request.arguments.stdin;if(typeof stdin==='string')child.stdin.end(stdin);else child.stdin.end();
  const terminate=()=>{try{process.kill(-child.pid!,'SIGTERM');setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},100).unref();}catch{}};const timeout=setTimeout(()=>{timedOut=true;terminate();},request.timeoutMs??definition.timeoutCeilingMs);const abort=()=>{cancelled=true;terminate();};context.signal?.addEventListener('abort',abort,{once:true});const exitCode=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timeout);context.signal?.removeEventListener('abort',abort);
  const out=redact(stdout.toString('utf8')),err=redact(stderr.toString('utf8'));const status=cancelled?'CANCELLED':timedOut?'TIMED_OUT':exitCode===0?'SUCCEEDED':'FAILED';const summary=status==='SUCCEEDED'?'Command completed.':status==='TIMED_OUT'?'Command timed out; its process group was terminated.':status==='CANCELLED'?'Command cancelled; its process group was terminated.':'Command exited unsuccessfully.';const type=request.toolId==='test.run'?'TEST_RESULT':request.toolId==='build.run'?'BUILD_RESULT':'COMMAND_EXECUTION';const facts={command:request.toolId==='shell.bash'?'bash invocation':request.toolId,exitCode,durationMs:Date.now()-started,stdoutTruncated:truncatedOut,stderrTruncated:truncatedErr};return this.result(request,decision,started,status,exitCode,summary,out,err,[],[evidence(request,type,facts)]);
 }
 private gitArguments(toolId:string,argument:string):string[]{switch(toolId){case'git.status':return['status','--short'];case'git.diff':return argument==='stat'?['diff','--stat']:['diff','--no-ext-diff'];case'git.show':return['show','--no-ext-diff','--stat','--oneline','--',argument||'HEAD'];case'git.log':return['log','-n','20','--oneline','--no-decorate'];case'git.apply':if(!argument)throw new Error('tool_argument_command_required');return['apply','--',argument];default:throw new Error('git_tool_not_implemented');}}
 private cap(value:string,bytes:number):string {const buffer=Buffer.from(value);return buffer.length<=bytes?value:buffer.subarray(0,bytes).toString('utf8');}
 private async walk(root:string,limit:number):Promise<string[]>{const result:string[]=[];const visit=async(path:string):Promise<void>=>{for(const row of await readdir(path,{withFileTypes:true})){if(result.length>=limit)return;const child=join(path,row.name);const info=await lstat(child);if(info.isSymbolicLink())continue;if(row.isDirectory())await visit(child);else if(row.isFile())result.push(child);}};await visit(root);return result;}
 private result(request:ToolInvocationRequest,decision:JuliusPolicyDecision,started:number,status:ToolInvocationResult['status'],exitCode:number|null,safeSummary:string,stdout:string,stderr:string,mutations:ToolInvocationResult['mutations'],evidenceRows:readonly JuliusToolEvidence[]):ToolInvocationResult{return{invocationId:request.invocationId,status,exitCode,safeSummary,stdout,stderr,stdoutRef:null,stderrRef:null,artifacts:[],evidence:evidenceRows,durationMs:Date.now()-started,resourceUsage:{toolCalls:1,runtimeMs:Date.now()-started,outputBytes:Buffer.byteLength(stdout)+Buffer.byteLength(stderr)},policyDecisionRef:decision.reasonCode,mutations};}
}
