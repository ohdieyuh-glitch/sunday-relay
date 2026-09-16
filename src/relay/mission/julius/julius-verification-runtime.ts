import { missionMayComplete, verifyTask, type JuliusEvidence, type JuliusRecordedDecision, type JuliusTask, type JuliusVerificationDecision } from './julius-runtime';
export interface JuliusAcceptanceCriterion{readonly criterionId:string;readonly description:string;readonly requiredEvidenceTypes:readonly JuliusEvidence['type'][];}
export interface JuliusReviewerFinding{readonly findingId:string;readonly runId:string;readonly taskId:string;readonly reviewerWorkerId:string;readonly severity:'INFO'|'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';readonly category:string;readonly claim:string;readonly criterionId:string|null;readonly evidenceIds:readonly string[];readonly blocking:boolean;readonly status:'OPEN'|'RESOLVED'|'DISMISSED';readonly createdAt:string;}
/**
 * `maxCoderSegments` bounds how many times ONE unit of coder work may pause at
 * a checkpoint and resume. It is not a repair bound and is counted separately:
 * a repair means the work was rejected, a segment boundary means the coder
 * needed something. Without it a coder that asks at every segment mints a
 * continuation forever and the mission never completes — the unbounded-loop
 * twin of the unroutable repair task that sat RUNNABLE forever on paid run
 * 34037313976. Absent means the default below, never unbounded.
 */
export interface JuliusVerificationPolicy{readonly revision:string;readonly reviewerRequired:boolean;readonly maxRepairRounds:number;readonly maxCoderSegments?:number;
 /**
  * THE WARNING CATEGORIES JULIUS TREATS AS BLOCKING. A reviewer's WARNING is
  * retained and does not interrupt; a warning whose category is named here is
  * promoted by Julius to a blocking finding, and the work is repaired. Absent or
  * empty, no warning blocks — the reviewer cannot promote its own.
  */
 readonly promotedWarningCategories?:readonly string[];}
/** Enough for real mid-mission collaboration, far short of a loop. */
export const JULIUS_DEFAULT_MAX_CODER_SEGMENTS=4;
export type JuliusVerificationAction={readonly action:'SCHEDULE_REVIEW';readonly role:'INDEPENDENT_REVIEWER'}|{readonly action:'DECIDE';readonly decision:JuliusVerificationDecision;readonly criteriaSatisfied:readonly string[];readonly criteriaMissing:readonly string[];readonly missionCompletable:boolean};
export function evaluateJuliusVerification(input:{task:JuliusTask;evidence:readonly JuliusEvidence[];criteria:readonly JuliusAcceptanceCriterion[];findings:readonly JuliusReviewerFinding[];policy:JuliusVerificationPolicy;reviewCompleted:boolean;allTasks:readonly JuliusTask[];priorDecisions:readonly JuliusRecordedDecision[]}):JuliusVerificationAction{
 if(input.policy.reviewerRequired&&!input.reviewCompleted)return{action:'SCHEDULE_REVIEW',role:'INDEPENDENT_REVIEWER'};
 for(const finding of input.findings)if(finding.evidenceIds.length===0)throw new Error('reviewer_finding_requires_evidence');
 const evidenceIds=new Set(input.evidence.map(value=>value.evidenceId));for(const finding of input.findings)if(finding.evidenceIds.some(id=>!evidenceIds.has(id)))throw new Error('reviewer_finding_evidence_not_found');
 /**
  * ACCEPTANCE CRITERIA ARE A MISSION CONDITION, judged when acceptance would
  * complete the mission. They used to be judged against THIS task's evidence
  * at every ACCEPT — so an accepted PLAN was halted for lacking the TEST
  * evidence only the build can produce. That never surfaced while the build
  * ran before the plan review (paid run 34037313976's own ordering); with the
  * declared graph enforced, the plan is accepted first, and a plan cannot be
  * held to the build's criteria. A criterion is satisfied by PASSED evidence
  * of every type it requires, from any task in the run.
  */
 const criteriaSatisfied:string[]=[];const criteriaMissing:string[]=[];for(const criterion of input.criteria){const satisfied=criterion.requiredEvidenceTypes.every(type=>input.evidence.some(value=>value.type===type&&value.status==='PASSED'));(satisfied?criteriaSatisfied:criteriaMissing).push(criterion.criterionId);}
 const blocking=input.findings.filter(value=>value.taskId===input.task.taskId&&value.blocking&&value.status==='OPEN').length;let decision=verifyTask(input.task,input.evidence,blocking);
 // The decision being made RIGHT NOW is about `input.task` and is, by
 // construction, that task's newest entry — appended last so the effective
 // rule reads it as current.
 const wouldComplete=decision.action==='ACCEPT'&&missionMayComplete({state:'VERIFYING',tasks:input.allTasks,decisions:[...input.priorDecisions,{...decision,taskId:input.task.taskId}]});
 if(criteriaMissing.length&&wouldComplete)decision={action:'HALT',reasonCode:'ACCEPTANCE_CRITERIA_UNSATISFIED',evidenceIds:input.evidence.map(value=>value.evidenceId),safeSummary:'Required acceptance criteria lack passing evidence.'};
 return{action:'DECIDE',decision,criteriaSatisfied,criteriaMissing,missionCompletable:decision.action==='ACCEPT'&&wouldComplete};
}
