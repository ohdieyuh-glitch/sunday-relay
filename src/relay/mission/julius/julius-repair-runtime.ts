import type { JuliusReviewerFinding, JuliusVerificationPolicy } from './julius-verification-runtime';
import type { JuliusTask, JuliusVerificationDecision } from './julius-runtime';

export interface JuliusRepairRequest { readonly runId:string;readonly originalTask:JuliusTask;readonly decision:JuliusVerificationDecision;readonly findings:readonly JuliusReviewerFinding[];readonly priorRounds:number;readonly policy:JuliusVerificationPolicy;readonly budgetReservationId:string;readonly now:string; }
export interface JuliusRepairPlan { readonly repairId:string;readonly round:number;readonly task:JuliusTask;readonly findingIds:readonly string[];readonly evidenceIds:readonly string[];readonly budgetReservationId:string; }

export function planJuliusRepair(input:JuliusRepairRequest):JuliusRepairPlan{
 if(input.decision.action!=='REPAIR')throw new Error('repair_decision_required');
 if(!input.budgetReservationId.trim())throw new Error('repair_budget_reservation_required');
 const round=input.priorRounds+1;if(round>input.policy.maxRepairRounds)throw new Error('repair_round_limit');
 const findings=input.findings.filter(value=>value.taskId===input.originalTask.taskId&&value.blocking&&value.status==='OPEN');
 const evidenceIds=[...new Set([...input.decision.evidenceIds,...findings.flatMap(value=>value.evidenceIds)])];
 if(evidenceIds.length===0)throw new Error('repair_evidence_required');
 const repairId=`repair:${input.originalTask.taskId}:${round}`;
 return{repairId,round,findingIds:findings.map(value=>value.findingId),evidenceIds,budgetReservationId:input.budgetReservationId,task:{taskId:`${repairId}:task`,missionId:input.originalTask.missionId,parentTaskId:input.originalTask.taskId,dependencyIds:[],requiredEvidenceTypes:input.originalTask.requiredEvidenceTypes,taskType:`repair:${input.originalTask.taskType}`,role:'CODING_AGENT',ordinal:input.originalTask.ordinal+round,state:'RUNNABLE'}};
}
