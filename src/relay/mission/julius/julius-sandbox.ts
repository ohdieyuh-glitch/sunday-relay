import type { ToolInvocationRequest, ToolInvocationResult } from './julius-tools';

export type JuliusSandboxState='CREATING'|'READY'|'RUNNING'|'DESTROYING'|'DESTROYED'|'FAILED'|'EXPIRED';
export interface JuliusSandboxIdentity {readonly sandboxId:string;readonly tenantId:string;readonly projectId:string;readonly runId:string;readonly taskId:string;readonly leaseGeneration:number;readonly policyRevision:string;readonly createdAt:string;readonly expiresAt:string;}
export interface JuliusSandboxLimits {readonly cpuCount:number;readonly memoryBytes:number;readonly pids:number;readonly openFiles:number;readonly workspaceBytes:number;readonly outputBytes:number;readonly wallClockMs:number;readonly concurrentProcesses:number;}
export interface JuliusSandboxPolicy {readonly readWorkspace:boolean;readonly mutateWorkspace:boolean;readonly executeProcess:boolean;readonly network:'DENY'|'MEDIATED';readonly allowedTools:readonly string[];}
export interface JuliusSandboxRecord extends JuliusSandboxIdentity {readonly state:JuliusSandboxState;readonly workspaceRef:string|null;readonly runtimeKind:string;readonly limits:JuliusSandboxLimits;readonly policy:JuliusSandboxPolicy;readonly safeFailure:string|null;}
export interface JuliusSandboxInspection {readonly record:JuliusSandboxRecord;readonly alive:boolean;readonly processCount:number|null;readonly workspaceBytes:number|null;}
export interface JuliusCollectedArtifact {readonly path:string;readonly kind:string;readonly contentType:string;readonly byteSize:number;readonly contentHash:string;}

/** Provider-neutral boundary. Julius never imports a container implementation. */
export interface SandboxExecutionPort {
 createSandbox(input:{identity:JuliusSandboxIdentity;policy:JuliusSandboxPolicy;limits:JuliusSandboxLimits}):Promise<JuliusSandboxRecord>;
 prepareWorkspace(input:{sandboxId:string;sourceRef:string;expectedLeaseGeneration:number}):Promise<JuliusSandboxRecord>;
 executeTool(input:{sandboxId:string;expectedLeaseGeneration:number;request:ToolInvocationRequest}):Promise<ToolInvocationResult>;
 cancelExecution(input:{sandboxId:string;invocationId:string;expectedLeaseGeneration:number}):Promise<boolean>;
 destroySandbox(input:{sandboxId:string;expectedLeaseGeneration:number;reason:string}):Promise<boolean>;
 inspectSandbox(input:{sandboxId:string;tenantId:string;projectId:string}):Promise<JuliusSandboxInspection|null>;
 collectArtifacts(input:{sandboxId:string;invocationId:string;expectedLeaseGeneration:number}):Promise<readonly JuliusCollectedArtifact[]>;
}

export function assertSandboxIdentity(identity:JuliusSandboxIdentity):void {if(!identity.sandboxId.trim()||!identity.tenantId.trim()||!identity.projectId.trim()||!identity.runId.trim()||!identity.taskId.trim()||!identity.policyRevision.trim())throw new Error('sandbox_identity_required');if(!Number.isSafeInteger(identity.leaseGeneration)||identity.leaseGeneration<1)throw new Error('sandbox_lease_generation_invalid');if(Date.parse(identity.expiresAt)<=Date.parse(identity.createdAt))throw new Error('sandbox_expiry_invalid');}
export function assertSandboxLimits(limits:JuliusSandboxLimits):void {for(const [key,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1)throw new Error(`sandbox_limit_invalid:${key}`);if(limits.cpuCount>64||limits.pids>4096||limits.concurrentProcesses>256)throw new Error('sandbox_limit_exceeds_ceiling');}
