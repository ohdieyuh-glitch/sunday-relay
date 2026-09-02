import{chmod,mkdtemp,readFile,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{describe,expect,it}from'vitest';import{DockerJuliusSandboxAdapter,dockerFailureClass}from'./docker-sandbox-adapter';import{createHash}from'node:crypto';import{DockerExecutorReceiptStore}from'./executor-receipt-store';import type{JuliusSandboxStore}from'../../mission/julius';
const identity={sandboxId:'sandbox',invocationId:'inv',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',leaseGeneration:2,policyRevision:'card',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};const limits={cpuCount:1,memoryBytes:134217728,pids:16,openFiles:64,workspaceBytes:1048576,outputBytes:4096,wallClockMs:5000,concurrentProcesses:2};
describe('Docker Julius sandbox adapter',()=>{it('is fail-closed and requires a content-addressed image',()=>{expect(()=>new DockerJuliusSandboxAdapter({image:'node:latest',enabled:true})).toThrow('sandbox_image_must_be_digest_pinned');const adapter=new DockerJuliusSandboxAdapter({image:`sha256:${'a'.repeat(64)}`,enabled:false});expect(adapter.createSandbox({identity,limits,policy:{readWorkspace:true,mutateWorkspace:false,executeProcess:true,network:'DENY',allowedTools:[]}})).rejects.toThrow('production_sandbox_disabled');});it('compiles policy and resources into fixed Docker arguments without a host shell',async()=>{const root=await mkdtemp(join(tmpdir(),'julius-docker-adapter-')),log=join(root,'args.log'),binary=join(root,'docker');await writeFile(binary,`#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`);await chmod(binary,0o700);const adapter=new DockerJuliusSandboxAdapter({dockerBinary:binary,image:`sha256:${'a'.repeat(64)}`,enabled:true,unsafeDevelopmentMode:true});await adapter.createSandbox({identity,limits,policy:{readWorkspace:true,mutateWorkspace:false,executeProcess:true,network:'DENY',allowedTools:['shell.bash']}});await adapter.prepareWorkspace({sandboxId:'sandbox',sourceRef:root,expectedLeaseGeneration:2});const args=await readFile(log,'utf8');expect(args).toContain('--read-only');expect(args).toContain('--cap-drop=ALL');expect(args).toContain('--cap-add=DAC_OVERRIDE');expect(args).toContain('--cap-add=SETUID');expect(args).toContain('--cap-add=SETGID');expect(args).toContain('--cap-add=KILL');expect(args).toContain('--security-opt=no-new-privileges:true');expect(args).toContain('--network none');expect(args).toContain('--pids-limit 16');expect(args).toContain(`type=bind,src=${root},dst=/workspace,readonly`);});});

describe('docker failure classes',()=>{it('names the class of a refused docker command as a short code, never the daemon prose',()=>{
  const cls=(text:string)=>dockerFailureClass(Buffer.from(text));
  // The refusal free dry run #2's receipt transport must produce: a bind source the host daemon cannot see.
  expect(cls('docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /executor-private/receipts/abc.')).toBe('bind_source_missing');
  expect(cls('docker: Error response from daemon: invalid mount config for type "bind": field Source must not be empty.')).toBe('mount_config_invalid');
  expect(cls('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?')).toBe('daemon_unreachable');
  expect(cls("Unable to find image 'sha256:abc' locally")).toBe('image_missing');
  expect(cls('docker: Error response from daemon: Conflict. The container name "/julius-x" is already in use by container "y".')).toBe('name_conflict');
  expect(cls('Error response from daemon: No such container: julius-x')).toBe('container_missing');
  expect(cls('something the classifier has never seen')).toBe('docker_error');
  for(const text of ['bind source path does not exist: /executor-private/receipts/abc','','permission denied while trying to connect to the Docker daemon socket'])expect(cls(text)).toMatch(/^[a-z_]+$/u);
});});

describe('scoped receipt mounts',()=>{it('hands a sandbox only its own sha256-scoped receipt subtree, never the root, the key or the ledger',async()=>{
  // PR #214: the receipt root is a host directory shared with the executor; a sandbox must see one subtree of it and nothing else.
  const root=await mkdtemp(join(tmpdir(),'julius-scoped-receipts-')),log=join(root,'args.log'),binary=join(root,'docker'),receiptRoot=join(root,'receipts');
  await writeFile(binary,`#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`);await chmod(binary,0o700);
  const saved=new Map<string,any>();
  const store={async save(record:any){saved.set(record.sandboxId,record);return true;},async load(){return null;},async loadOwned(id:string){return saved.get(id)??null;},async bindPhysical(){return true;}} as unknown as JuliusSandboxStore;
  const adapter=new DockerJuliusSandboxAdapter({dockerBinary:binary,image:`sha256:${'a'.repeat(64)}`,enabled:true,unsafeDevelopmentMode:true,durability:{store,receipts:new DockerExecutorReceiptStore(receiptRoot),runtimeInstanceId:'executor-test',executorVersion:'docker-executor.v1'}});
  await adapter.createSandbox({identity,limits,policy:{readWorkspace:true,mutateWorkspace:false,executeProcess:true,network:'DENY',allowedTools:['shell.bash']}});
  await adapter.prepareWorkspace({sandboxId:'sandbox',sourceRef:root,expectedLeaseGeneration:2});
  const args=await readFile(log,'utf8');
  const scope=createHash('sha256').update('sandbox').digest('hex');
  expect(args).toContain(`type=bind,src=${join(receiptRoot,scope)},dst=/julius-receipts-root`);
  // Never the root itself, never a sibling scope, never anything private.
  expect(args).not.toContain(`src=${receiptRoot},dst=`);
  expect(args).not.toContain(`src=${receiptRoot}/,dst=`);
  for(const forbidden of ['private.pem','ledger','executor-private'])expect(args).not.toContain(forbidden);
  expect((args.match(/dst=\/julius-receipts-root/gu)??[]).length).toBe(1);
});});
