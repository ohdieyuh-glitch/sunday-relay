import type { ToolInvocationRequest, ToolInvocationResult } from './julius-tools';

export type JuliusSandboxState='CREATING'|'READY'|'RUNNING'|'RECONCILING'|'DESTROYING'|'DESTROYED'|'FAILED'|'EXPIRED'|'LOST';
export interface JuliusSandboxIdentity {readonly sandboxId:string;readonly invocationId:string;readonly tenantId:string;readonly projectId:string;readonly runId:string;readonly taskId:string;readonly leaseGeneration:number;readonly policyRevision:string;readonly createdAt:string;readonly expiresAt:string;}
export interface JuliusSandboxLimits {readonly cpuCount:number;readonly memoryBytes:number;readonly pids:number;readonly openFiles:number;readonly workspaceBytes:number;readonly outputBytes:number;readonly wallClockMs:number;readonly concurrentProcesses:number;}
export interface JuliusSandboxPolicy {readonly readWorkspace:boolean;readonly mutateWorkspace:boolean;readonly executeProcess:boolean;readonly network:'DENY'|'MEDIATED';readonly allowedTools:readonly string[];}
export interface JuliusSandboxRecord extends JuliusSandboxIdentity {readonly state:JuliusSandboxState;readonly workspaceRef:string|null;readonly runtimeKind:string;readonly limits:JuliusSandboxLimits;readonly policy:JuliusSandboxPolicy;readonly safeFailure:string|null;}
export interface JuliusSandboxInspection {readonly record:JuliusSandboxRecord;readonly alive:boolean;readonly processCount:number|null;readonly workspaceBytes:number|null;}
export interface JuliusPhysicalSandbox {readonly sandboxId:string;readonly runtimeId:string;readonly state:string;readonly labels:Readonly<Record<string,string>>;}
export interface JuliusCollectedArtifact {readonly path:string;readonly kind:string;readonly contentType:string;readonly byteSize:number;readonly contentHash:string;}

/** Provider-neutral boundary. Julius never imports a container implementation. */
export interface SandboxExecutionPort {
 createSandbox(input:{identity:JuliusSandboxIdentity;policy:JuliusSandboxPolicy;limits:JuliusSandboxLimits}):Promise<JuliusSandboxRecord>;
 prepareWorkspace(input:{sandboxId:string;sourceRef:string;expectedLeaseGeneration:number}):Promise<JuliusSandboxRecord>;
 executeTool(input:{sandboxId:string;expectedLeaseGeneration:number;dispatchGeneration:number;requestDigest:string;executionTokenHash:string;effectClassification:import('./julius-tool-lifecycle').JuliusToolEffectClassification;request:ToolInvocationRequest}):Promise<ToolInvocationResult>;
 cancelExecution(input:{sandboxId:string;invocationId:string;expectedLeaseGeneration:number}):Promise<boolean>;
 destroySandbox(input:{sandboxId:string;expectedLeaseGeneration:number;reason:string}):Promise<boolean>;
 inspectSandbox(input:{sandboxId:string;tenantId:string;projectId:string}):Promise<JuliusSandboxInspection|null>;
 collectArtifacts(input:{sandboxId:string;invocationId:string;expectedLeaseGeneration:number}):Promise<readonly JuliusCollectedArtifact[]>;
 discoverSandboxes():Promise<readonly JuliusPhysicalSandbox[]>;
 quarantineSandbox(input:{runtimeId:string;reason:string}):Promise<boolean>;
 reconcileSandboxes():Promise<{recovered:number;lost:number;quarantined:number;destroyed:number}>;
}

export interface JuliusSandboxRecoveryClaim {readonly record:JuliusSandboxRecord;readonly recoveryGeneration:number;readonly claimedUntil:string;}
export interface JuliusDurableSandbox extends JuliusSandboxRecord {readonly runtimeInstanceId:string;readonly containerId:string|null;readonly imageDigest:string;readonly recoveryGeneration:number;readonly dispatchGeneration:number|null;readonly executionTokenHash:string|null;}
export interface JuliusSandboxStore {
 save(record:JuliusSandboxRecord&{readonly invocationId:string;readonly runtimeInstanceId:string;readonly containerId:string|null;readonly imageDigest:string;readonly lastHeartbeatAt:string}):Promise<boolean>;
 bindPhysical(input:{sandboxId:string;runtimeInstanceId:string;leaseGeneration:number;containerId:string;workspaceRef:string}):Promise<boolean>;
 adoptPhysical(input:{sandboxId:string;runtimeInstanceId:string;leaseGeneration:number;recoveryGeneration:number;containerId:string}):Promise<boolean>;
 load(input:{sandboxId:string;tenantId:string;projectId:string}):Promise<JuliusDurableSandbox|null>;
 loadOwned(sandboxId:string):Promise<JuliusDurableSandbox|null>;
 authorizeExecution(input:{sandboxId:string;runtimeInstanceId:string;invocationId:string;leaseGeneration:number;dispatchGeneration:number;requestDigest:string;executionTokenHash:string}):Promise<JuliusDurableSandbox>;
 recordReceipt(receipt:import('./julius-tool-lifecycle').JuliusExecutionReceipt&{readonly projectId:string}):Promise<boolean>;
 heartbeat(input:{sandboxId:string;runtimeInstanceId:string;leaseGeneration:number;expiresAt:string;state:'READY'|'RUNNING'}):Promise<boolean>;
 beginDestroy(input:{sandboxId:string;runtimeInstanceId:string;leaseGeneration:number}):Promise<boolean>;
 finishDestroy(input:{sandboxId:string;runtimeInstanceId:string;leaseGeneration:number}):Promise<boolean>;
 markLost(input:{sandboxId:string;runtimeInstanceId:string;recoveryGeneration:number}):Promise<boolean>;
 listRecoverable(input:{runtimeInstanceId:string;now:string;limit:number}):Promise<readonly JuliusSandboxRecoveryClaim[]>;
 transition(input:{sandboxId:string;runtimeInstanceId:string;leaseGeneration:number;recoveryGeneration:number;from:readonly JuliusSandboxState[];to:JuliusSandboxState;now:string;safeFailure?:string|null}):Promise<boolean>;
}

export function assertSandboxIdentity(identity:JuliusSandboxIdentity):void {if(!identity.sandboxId.trim()||!identity.invocationId.trim()||!identity.tenantId.trim()||!identity.projectId.trim()||!identity.runId.trim()||!identity.taskId.trim()||!identity.policyRevision.trim())throw new Error('sandbox_identity_required');if(!Number.isSafeInteger(identity.leaseGeneration)||identity.leaseGeneration<1)throw new Error('sandbox_lease_generation_invalid');if(Date.parse(identity.expiresAt)<=Date.parse(identity.createdAt))throw new Error('sandbox_expiry_invalid');}
export function assertSandboxLimits(limits:JuliusSandboxLimits):void {for(const [key,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1)throw new Error(`sandbox_limit_invalid:${key}`);if(limits.cpuCount>64||limits.pids>4096||limits.concurrentProcesses>256)throw new Error('sandbox_limit_exceeds_ceiling');}
