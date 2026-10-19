import type { JuliusToolArtifact,JuliusToolEvidence,JuliusToolId,ToolInvocationResult } from './julius-tools';
export type JuliusToolInvocationState='REQUESTED'|'AUTHORIZED'|'DISPATCHING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'DENIED'|'CANCELLED'|'TIMED_OUT';
export type JuliusToolEffectClassification='READ_ONLY'|'IDEMPOTENT_MUTATION'|'NON_IDEMPOTENT_MUTATION'|'PROCESS_WITH_EXTERNAL_EFFECT';
export type JuliusExecutionReceiptState='NEVER_STARTED'|'STARTED_UNKNOWN_OUTCOME'|'STILL_RUNNING'|'COMPLETED_WITH_RESULT'|'FAILED_WITH_RESULT'|'SANDBOX_GONE';
export interface JuliusExecutionReceipt {readonly invocationId:string;readonly dispatchGeneration:number;readonly sandboxId:string;readonly executionTokenHash:string;readonly requestDigest:string;readonly effectClassification:JuliusToolEffectClassification;readonly state:JuliusExecutionReceiptState;readonly startedAt:string|null;readonly completedAt:string|null;readonly resultDigest:string|null;readonly beforeStateDigest:string|null;readonly afterStateDigest:string|null;readonly result:ToolInvocationResult|null;}
export type JuliusReconciliationAction='SETTLE_RECEIPT'|'WAIT_FOR_EXECUTOR'|'VERIFY_WORKSPACE_STATE'|'RETRY_SAFE'|'REQUIRE_AUTHORIZED_DECISION';

/** Fail-closed recovery policy. Unknown destructive effects are never replayed. */
export function decideToolReconciliation(input:{effectClassification:JuliusToolEffectClassification;receiptState:JuliusExecutionReceiptState;afterStateMatches?:boolean}):JuliusReconciliationAction {
 if(input.receiptState==='COMPLETED_WITH_RESULT'||input.receiptState==='FAILED_WITH_RESULT')return'SETTLE_RECEIPT';
 if(input.receiptState==='STILL_RUNNING')return'WAIT_FOR_EXECUTOR';
 if(input.afterStateMatches===true)return'SETTLE_RECEIPT';
 if(input.effectClassification==='IDEMPOTENT_MUTATION'&&input.receiptState==='STARTED_UNKNOWN_OUTCOME')return'VERIFY_WORKSPACE_STATE';
 if(input.effectClassification==='READ_ONLY'&&(input.receiptState==='NEVER_STARTED'||input.receiptState==='SANDBOX_GONE'))return'RETRY_SAFE';
 return'REQUIRE_AUTHORIZED_DECISION';
}
export interface JuliusDurableToolInvocation {readonly invocationId:string;readonly idempotencyKey:string;readonly requestDigest:string;readonly tenantId:string;readonly projectId:string;readonly runId:string;readonly taskId:string;readonly workerId:string;readonly leaseGeneration:number;readonly policyRevision:string;readonly toolId:JuliusToolId;readonly toolVersion:string;readonly mutationClass:'NONE'|'WORKSPACE';readonly state:JuliusToolInvocationState;readonly sandboxId:string|null;readonly budgetReservationId:string|null;readonly exitCode:number|null;readonly safeSummary:string|null;readonly stdoutPreview:string;readonly stdoutArtifactId:string|null;readonly stderrPreview:string;readonly stderrArtifactId:string|null;readonly evidenceIds:readonly string[];readonly artifactIds:readonly string[];readonly durationMs:number|null;readonly requestedAt:string;readonly authorizedAt:string|null;readonly startedAt:string|null;readonly completedAt:string|null;}
export interface JuliusToolDispatchClaim {readonly invocation:JuliusDurableToolInvocation;readonly dispatchGeneration:number;readonly claimedBy:string;}
export interface JuliusToolInvocationStore {
 request(input:Omit<JuliusDurableToolInvocation,'state'|'sandboxId'|'budgetReservationId'|'exitCode'|'safeSummary'|'stdoutPreview'|'stdoutArtifactId'|'stderrPreview'|'stderrArtifactId'|'evidenceIds'|'artifactIds'|'durationMs'|'authorizedAt'|'startedAt'|'completedAt'>):Promise<{created:boolean;invocation:JuliusDurableToolInvocation}>;
 authorize(input:{invocationId:string;tenantId:string;projectId:string;requestDigest:string;policyRevision:string;budgetReservationId:string;authorizedAt:string}):Promise<boolean>;
 deny(input:{invocationId:string;tenantId:string;projectId:string;requestDigest:string;safeSummary:string;completedAt:string}):Promise<boolean>;
 /**
  * Claims AUTHORIZED invocations for dispatch. Unscoped, it is a fleet dispatcher's sweep: any run,
  * any project. A caller dispatching ONE invocation names it (and its project), and nothing else is
  * touched: a swept invocation belongs to a caller that will never execute it (defect B). Both or
  * neither: naming only one is refused (`tool_dispatch_claim_half_scoped`). An invocation named
  * without its project would rest tenancy on the caller, and a project named without an
  * invocation is defect B's sweep inside that project.
  */
 claimDispatch(input:{claimedBy:string;now:string;claimedUntil:string;limit:number;invocationId?:string;projectId?:string}):Promise<readonly JuliusToolDispatchClaim[]>;
 markRunning(input:{invocationId:string;claimedBy:string;dispatchGeneration:number;sandboxId:string;startedAt:string}):Promise<boolean>;
 complete(input:{invocationId:string;claimedBy:string;dispatchGeneration:number;result:ToolInvocationResult;artifacts:readonly JuliusToolArtifact[];evidence:readonly JuliusToolEvidence[];completedAt:string}):Promise<boolean>;
 load(input:{invocationId:string;tenantId:string;projectId:string}):Promise<JuliusDurableToolInvocation|null>;
}
