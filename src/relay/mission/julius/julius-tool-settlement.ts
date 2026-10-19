import type {JuliusArtifactMetadata} from './julius-artifacts';
import type {JuliusToolEvidence,ToolInvocationResult} from './julius-tools';

export interface JuliusToolSettlementCommand {
 readonly settlementId:string;readonly invocationId:string;readonly dispatchGeneration:number;readonly resultDigest:string;
 readonly result:ToolInvocationResult;readonly artifacts:readonly JuliusArtifactMetadata[];readonly evidence:readonly JuliusToolEvidence[];
 readonly taskOutcome:{readonly state:'SUCCEEDED'|'FAILED';readonly verificationDecisionId:string}|null;readonly occurredAt:string;
}
export interface JuliusToolSettlementResult {readonly created:boolean;readonly settlementId:string;readonly invocationId:string;readonly resultDigest:string;}
export interface JuliusToolSettlementStore {settle(command:JuliusToolSettlementCommand):Promise<JuliusToolSettlementResult>;}
export class JuliusToolSettlementService implements JuliusToolSettlementStore {
 constructor(private readonly artifacts:import('./julius-artifacts').ArtifactStorePort,private readonly store:JuliusToolSettlementStore){}
 async settle(command:JuliusToolSettlementCommand):Promise<JuliusToolSettlementResult>{for(const metadata of command.artifacts){const stored=await this.artifacts.get(metadata);if(!stored||stored.metadata.contentHash!==metadata.contentHash||stored.metadata.byteSize!==metadata.byteSize||stored.metadata.storageRef!==metadata.storageRef)throw new Error('tool_settlement_artifact_bytes_unavailable');}return this.store.settle(command);}
}
