import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactStorePort, JuliusArtifactMetadata,JuliusArtifactScope } from '../../mission/julius';

const sha256=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const segment=(value:string)=>{if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))throw new Error('artifact_scope_invalid');return sha256(value);};

/** Development/local durable adapter. The storage reference never contains tenant input. */
export class LocalJuliusArtifactStore implements ArtifactStorePort {
 constructor(private readonly root:string,private readonly maxArtifactBytes=64*1024*1024){}
 async put(input:{metadata:Omit<JuliusArtifactMetadata,'byteSize'|'contentHash'|'storageRef'>;content:Uint8Array}):Promise<JuliusArtifactMetadata>{if(input.content.byteLength>this.maxArtifactBytes)throw new Error('artifact_too_large');const directory=join(this.root,segment(input.metadata.tenantId),segment(input.metadata.projectId));await mkdir(directory,{recursive:true,mode:0o700});const name=segment(input.metadata.artifactId),contentHash=sha256(input.content);const contentPath=join(directory,`${name}.blob`),metadataPath=join(directory,`${name}.json`);const metadata:JuliusArtifactMetadata={...input.metadata,byteSize:input.content.byteLength,contentHash,storageRef:`local://${segment(input.metadata.tenantId)}/${segment(input.metadata.projectId)}/${name}`};const nonce=`${process.pid}-${Date.now()}`;await writeFile(`${contentPath}.${nonce}`,input.content,{flag:'wx',mode:0o600});await writeFile(`${metadataPath}.${nonce}`,JSON.stringify(metadata),{flag:'wx',mode:0o600});await rename(`${contentPath}.${nonce}`,contentPath);await rename(`${metadataPath}.${nonce}`,metadataPath);return metadata;}
 async get(input:JuliusArtifactScope):Promise<{metadata:JuliusArtifactMetadata;content:Uint8Array}|null>{const directory=join(this.root,segment(input.tenantId),segment(input.projectId)),name=segment(input.artifactId);try{const metadata=JSON.parse(await readFile(join(directory,`${name}.json`),'utf8')) as JuliusArtifactMetadata;for(const key of['artifactId','tenantId','projectId','runId','taskId','invocationId']as const)if(metadata[key]!==input[key])throw new Error('artifact_scope_mismatch');const content=await readFile(join(directory,`${name}.blob`));if(content.byteLength!==metadata.byteSize||sha256(content)!==metadata.contentHash)throw new Error('artifact_integrity_failure');return{metadata,content};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
 async remove(input:JuliusArtifactScope):Promise<boolean>{const directory=join(this.root,segment(input.tenantId),segment(input.projectId)),name=segment(input.artifactId);const existing=await this.get(input);if(!existing)return false;await Promise.all([rm(join(directory,`${name}.blob`)),rm(join(directory,`${name}.json`))]);return true;}
}
