export type JuliusArtifactKind='STDOUT'|'STDERR'|'PATCH'|'TEST_REPORT'|'BUILD_LOG'|'GENERATED_FILE'|'REVIEW_REPORT'|'STRUCTURED_OUTPUT';
export interface JuliusArtifactMetadata {readonly artifactId:string;readonly tenantId:string;readonly projectId:string;readonly runId:string;readonly taskId:string;readonly invocationId:string;readonly kind:JuliusArtifactKind;readonly contentType:string;readonly byteSize:number;readonly contentHash:string;readonly storageRef:string;readonly createdAt:string;readonly expiresAt:string|null;}
export interface JuliusArtifactScope {readonly artifactId:string;readonly tenantId:string;readonly projectId:string;readonly runId:string;readonly taskId:string;readonly invocationId:string;}
export interface ArtifactStorePort {put(input:{metadata:Omit<JuliusArtifactMetadata,'byteSize'|'contentHash'|'storageRef'>;content:Uint8Array}):Promise<JuliusArtifactMetadata>;get(input:JuliusArtifactScope):Promise<{metadata:JuliusArtifactMetadata;content:Uint8Array}|null>;remove(input:JuliusArtifactScope):Promise<boolean>;}
export interface JuliusStagedArtifact {readonly stagingId:string;readonly metadata:Omit<JuliusArtifactMetadata,'storageRef'>;}
export interface StagedArtifactStorePort extends ArtifactStorePort {
 stage(input:{metadata:Omit<JuliusArtifactMetadata,'byteSize'|'contentHash'|'storageRef'>;content:Uint8Array}):Promise<JuliusStagedArtifact>;
 finalize(staged:JuliusStagedArtifact):Promise<JuliusArtifactMetadata>;
 abandon(staged:JuliusStagedArtifact):Promise<boolean>;
}
