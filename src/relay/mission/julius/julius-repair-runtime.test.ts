import{describe,expect,it}from'vitest';import{planJuliusRepair,type JuliusTask}from'.';const task:JuliusTask={taskId:'task',missionId:'mission',parentTaskId:null,dependencyIds:[],requiredEvidenceTypes:['TEST'],taskType:'implementation',role:'CODING_AGENT',ordinal:1,state:'SUCCEEDED'};const input={runId:'run',originalTask:task,decision:{action:'REPAIR' as const,reasonCode:'EVIDENCE_FAILED',evidenceIds:['evidence'],safeSummary:'repair'},findings:[],priorRounds:0,policy:{revision:'policy',reviewerRequired:true,maxRepairRounds:2},budgetReservationId:'reservation',now:'now'};
describe('Julius repair planning',()=>{it('creates bounded parent-linked repair work with evidence provenance',()=>{expect(planJuliusRepair(input)).toMatchObject({repairId:'repair:task:1',round:1,evidenceIds:['evidence'],task:{parentTaskId:'task',state:'RUNNABLE',role:'CODING_AGENT'}});});it('requires an authoritative repair decision, evidence and pre-reserved budget',()=>{expect(()=>planJuliusRepair({...input,decision:{...input.decision,action:'HALT'}})).toThrow('repair_decision_required');expect(()=>planJuliusRepair({...input,budgetReservationId:''})).toThrow('repair_budget_reservation_required');expect(()=>planJuliusRepair({...input,decision:{...input.decision,evidenceIds:[]}})).toThrow('repair_evidence_required');});it('halts deterministically at the configured repair bound',()=>expect(()=>planJuliusRepair({...input,priorRounds:2})).toThrow('repair_round_limit'));});
describe('DEFECT 3 — a repair inherits its subject\'s role and stage',()=>{
 const plan:JuliusTask={...task,taskId:'plan-1',taskType:'plan',role:'PROMPT_ARCHITECT',requiredEvidenceTypes:['ARTIFACT']};
 it('a rejected PLAN is revised by the Prompt Architect, never repaired by the Coding Agent',()=>{
  const revision=planJuliusRepair({...input,originalTask:plan});
  expect(revision.task).toMatchObject({taskId:'repair:plan-1:1:task',parentTaskId:'plan-1',role:'PROMPT_ARCHITECT',taskType:'repair:plan',requiredEvidenceTypes:['ARTIFACT'],state:'RUNNABLE',dependencyIds:[]});
 });
 it('a rejected BUILD is repaired by the Coding Agent, and a second round keeps the stage type',()=>{
  const build:JuliusTask={...task,taskId:'build-1',taskType:'build'};
  const first=planJuliusRepair({...input,originalTask:build}).task;
  expect(first).toMatchObject({role:'CODING_AGENT',taskType:'repair:build'});
  const second=planJuliusRepair({...input,originalTask:first,priorRounds:1}).task;
  expect(second).toMatchObject({role:'CODING_AGENT',taskType:'repair:build',parentTaskId:first.taskId,ordinal:first.ordinal+2});
 });
 it('the objective and criteria are not the repair\'s to change: it carries the subject\'s evidence requirement and nothing else new',()=>{
  const revision=planJuliusRepair({...input,originalTask:plan});
  expect(Object.keys(revision.task).sort()).toEqual(['dependencyIds','missionId','ordinal','parentTaskId','requiredEvidenceTypes','role','state','taskId','taskType']);
  expect(revision.task.missionId).toBe(plan.missionId);
 });
});
