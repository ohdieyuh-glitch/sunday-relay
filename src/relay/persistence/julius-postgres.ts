import type { Pool } from 'pg';
import { JULIUS_RUNTIME_VERSION, JULIUS_TERMINAL_MISSION_STATES, transitionMission, type JuliusBrainEntry, type JuliusEvidence, type JuliusMissionState, type JuliusOperationalEvent, type JuliusTask, type JuliusVerificationDecision } from '../mission/julius';
import { brainKindToStored } from './julius-brain-kinds';
import { appendJuliusEventWithin } from './julius-event-postgres';

export interface JuliusRunRecord { readonly runId:string;readonly missionId:string;readonly projectId:string;readonly state:JuliusMissionState;readonly cardRevision:string;readonly missionContractRevision:number;readonly projectBrainRevision:number;readonly version:number; }
export interface ClaimedJuliusTask { readonly taskId:string;readonly runId:string;readonly role:string;readonly taskType:string;readonly leaseGeneration:number;readonly attempt:number; }
/**
 * THE ERROR A REFUSED SECOND ACTIVE RUN RAISES, with the run that already holds
 * the mission and the state it is in. Thrown rather than returned because it
 * travels out of a transaction; the bootstrap port turns it into a refusal.
 */
export const JULIUS_MISSION_ACTIVE_ERROR = 'mission_run_already_active';
export const juliusMissionActiveError = (runId: string, state: string): Error =>
  new Error(`${JULIUS_MISSION_ACTIVE_ERROR}:${runId}:${state}`);
export const parseJuliusMissionActiveError = (error: unknown): { readonly runId: string; readonly state: string } | null => {
  const message = error instanceof Error ? error.message : '';
  if (!message.startsWith(`${JULIUS_MISSION_ACTIVE_ERROR}:`)) return null;
  const parts = message.split(':');
  const state = parts[parts.length - 1];
  const runId = parts.slice(1, -1).join(':');
  return runId === '' || state === undefined ? null : { runId, state };
};

export interface CreateJuliusRun {
  readonly commandId:string;readonly runId:string;readonly missionId:string;readonly projectId:string;
  readonly cardRevision:string;readonly missionContractRevision:number;readonly projectBrainRevision:number;readonly occurredAt:string;
  /**
   * REFUSE THIS RUN IF THE MISSION ALREADY HAS A NON-TERMINAL ONE. The
   * bootstrap sets it for an ordinary create and clears it for an explicit
   * rerun; absent means the old behaviour, so no existing caller changes.
   */
  readonly refuseIfMissionActive?:boolean;
}
const json=(value:unknown)=>JSON.stringify(value);

/** PostgreSQL authority for Julius. Every externally visible mutation writes the existing event/outbox ledger in the same serializable transaction. */
export class JuliusPostgresRepository {
  constructor(private readonly pool:Pool){}
  /**
   * ONE RETRY ON A SERIALIZATION FAILURE, AND ONLY HERE.
   *
   * The active-run check and the insert are one SERIALIZABLE transaction, so two
   * concurrent creates cannot both decide the mission is free — PostgreSQL
   * aborts the loser with 40001. Left to surface, that abort answers a client
   * that merely pressed a button twice with "the store refused", when the truth
   * is "your run already exists". So the loser is retried exactly once, which is
   * safe because this call is idempotent by construction: the same request finds
   * its own idempotency row and returns the run it already made, and a DIFFERENT
   * request now sees the committed run and is refused by name. Not generalised
   * to every transaction: a blanket retry would re-run effects nobody proved
   * idempotent.
   */
  async createRun(input:CreateJuliusRun):Promise<JuliusRunRecord>{
    try{return await this.createRunOnce(input);}
    catch(error){
      const code=error!==null&&typeof error==='object'&&'code' in error?String((error as {code:unknown}).code):'';
      if(code!=='40001'&&code!=='40P01')throw error;
      return this.createRunOnce(input);
    }
  }
  private async createRunOnce(input:CreateJuliusRun):Promise<JuliusRunRecord>{
    return this.transaction(async client=>{
      const duplicate=await client.query('SELECT response,request_hash FROM relay_wonderland.idempotency WHERE scope=$1 AND command_id=$2 FOR UPDATE',['julius.run.create',input.commandId]);
      const hash=json({runId:input.runId,missionId:input.missionId,projectId:input.projectId,cardRevision:input.cardRevision,missionContractRevision:input.missionContractRevision,projectBrainRevision:input.projectBrainRevision});
      if(duplicate.rows[0]){if(duplicate.rows[0].request_hash!==hash)throw new Error('idempotency_payload_conflict');return this.parseRun(duplicate.rows[0].response);}
      /**
       * ONE ACTIVE RUN PER MISSION, UNLESS SOMEBODY MEANT TWO.
       *
       * AFTER the idempotency short-circuit, deliberately: a replay of the SAME
       * request resumes the run it already made and must never be refused by
       * the run it is. What is refused is a SECOND, DIFFERENT execution of a
       * mission still in flight — an operator resubmitting an edited draft, a
       * client retrying with a changed field — because that starts a second
       * paid execution nobody asked for. An explicit rerun clears the flag; a
       * terminal prior run (FAILED, COMPLETED, CANCELLED) is not active and
       * never locks a mission.
       *
       * INSIDE THIS TRANSACTION, which is SERIALIZABLE: the check and the
       * insert are one atomic act, so two concurrent creates cannot both read
       * "no active run" and both insert — the second fails serialization and
       * its retry sees the first. A check outside the transaction would be a
       * race with a comforting shape.
       */
      if(input.refuseIfMissionActive===true){
        const active=await client.query('SELECT run_id,state FROM relay_wonderland.julius_runs WHERE mission_id=$1 AND project_id=$2 AND NOT (state=ANY($3::text[])) ORDER BY created_at LIMIT 1',[input.missionId,input.projectId,[...JULIUS_TERMINAL_MISSION_STATES]]);
        const held=active.rows[0] as {run_id:string;state:string}|undefined;
        if(held!==undefined&&held.run_id!==input.runId)throw juliusMissionActiveError(held.run_id,held.state);
      }
      const run:JuliusRunRecord={runId:input.runId,missionId:input.missionId,projectId:input.projectId,state:'CREATED',cardRevision:input.cardRevision,missionContractRevision:input.missionContractRevision,projectBrainRevision:input.projectBrainRevision,version:1};
      await client.query(`INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'CREATED',$4,$5,$6,$7)`,[input.runId,input.missionId,input.projectId,JULIUS_RUNTIME_VERSION,input.cardRevision,input.missionContractRevision,input.projectBrainRevision]);
      await this.event(client,{eventId:`julius:${input.commandId}`,projectId:input.projectId,streamId:input.runId,type:'julius.run.created',occurredAt:input.occurredAt,payload:{runId:input.runId,missionId:input.missionId,state:'CREATED',runtimeVersion:JULIUS_RUNTIME_VERSION}});
      await client.query('INSERT INTO relay_wonderland.idempotency(scope,command_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',['julius.run.create',input.commandId,hash,json(run)]);return run;
    });
  }
  /** The mission's most recent run, newest first by creation. */
  async latestRunForMission(missionId:string,projectId:string):Promise<{readonly runId:string}|null>{
    const result=await this.pool.query<{run_id:string}>('SELECT run_id FROM relay_wonderland.julius_runs WHERE mission_id=$1 AND project_id=$2 ORDER BY created_at DESC,run_id DESC LIMIT 1',[missionId,projectId]);
    const row=result.rows[0];return row===undefined?null:{runId:row.run_id};
  }
  async loadRun(runId:string,projectId:string):Promise<JuliusRunRecord|null>{const result=await this.pool.query<Record<string,unknown>>('SELECT * FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2',[runId,projectId]);return result.rows[0]?this.mapRun(result.rows[0]):null;}
  async transition(input:{commandId:string;runId:string;projectId:string;expectedVersion:number;to:JuliusMissionState;reasonCode:string;safeSummary:string;evidenceIds:readonly string[];occurredAt:string}):Promise<JuliusRunRecord>{
    return this.transaction(async client=>{const current=await client.query('SELECT * FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE',[input.runId,input.projectId]);if(!current.rows[0])throw new Error('julius_run_not_found');const run=this.mapRun(current.rows[0]);if(run.version!==input.expectedVersion)throw Object.assign(new Error('optimistic_concurrency_conflict'),{code:'40001',retryable:false});
      const transition=transitionMission({transitionId:`transition:${input.commandId}`,missionId:run.missionId,current:run.state,to:input.to,reasonCode:input.reasonCode,safeSummary:input.safeSummary,evidenceIds:input.evidenceIds,occurredAt:input.occurredAt});
      const updated=await client.query('UPDATE relay_wonderland.julius_runs SET state=$2,version=version+1,updated_at=$3 WHERE run_id=$1 AND version=$4 RETURNING *',[input.runId,input.to,input.occurredAt,input.expectedVersion]);if(updated.rowCount!==1)throw Object.assign(new Error('optimistic_concurrency_conflict'),{code:'40001'});
      await client.query(`INSERT INTO relay_wonderland.julius_transitions(transition_id,run_id,from_state,to_state,reason_code,safe_summary,evidence_ids,runtime_version,occurred_at,sequence) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,[transition.transitionId,input.runId,transition.from,transition.to,transition.reasonCode,transition.safeSummary,json(transition.evidenceIds),transition.runtimeVersion,transition.occurredAt,run.version]);
      await this.event(client,{eventId:`julius:${input.commandId}`,projectId:input.projectId,streamId:input.runId,type:'julius.run.transitioned',occurredAt:input.occurredAt,payload:transition});return this.mapRun(updated.rows[0]);});
  }
  async addTask(input:{commandId:string;runId:string;projectId:string;task:JuliusTask}):Promise<boolean>{return this.transaction(async client=>{const run=await client.query('SELECT project_id,mission_id FROM relay_wonderland.julius_runs WHERE run_id=$1 FOR UPDATE',[input.runId]);if(!run.rows[0]||run.rows[0].project_id!==input.projectId||run.rows[0].mission_id!==input.task.missionId)throw new Error('julius_run_not_found');
    const inserted=await client.query(`INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,parent_task_id,role,task_type,state,ordinal,required_evidence_types) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(task_id) DO NOTHING`,[input.task.taskId,input.runId,input.task.parentTaskId,input.task.role,input.task.taskType,input.task.state,input.task.ordinal,json(input.task.requiredEvidenceTypes)]);if(inserted.rowCount!==1)return false;
    for(const dependency of input.task.dependencyIds)await client.query('INSERT INTO relay_wonderland.julius_task_dependencies(task_id,dependency_task_id) VALUES($1,$2)',[input.task.taskId,dependency]);
    await this.event(client,{eventId:`julius:${input.commandId}`,projectId:input.projectId,streamId:input.runId,type:'julius.task.created',occurredAt:new Date().toISOString(),payload:{taskId:input.task.taskId,state:input.task.state,role:input.task.role}});return true;});}
  /**
   * A PENDING OR DENIED APPROVAL HOLDS THE RUN AT THE CLAIM (`julius_approvals`),
   * not only through the run's state: a gated run left claimable by a lost
   * race or another writer's transition must still start nothing, and a denial
   * whose move to FAILED lost a race must still stop the work. The state list
   * is `JULIUS_CLAIMABLE_RUN_STATES` (pinned to it by a test). The in-memory
   * claim carries the same rule.
   */
  async claimRunnable(input:{owner:string;now:string;leaseExpiresAt:string;limit:number;projectId?:string}):Promise<ClaimedJuliusTask[]>{if(!input.owner.trim()||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100)throw new Error('invalid_julius_claim');const result=await this.pool.query<Record<string,unknown>>(`WITH candidates AS (SELECT t.task_id FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id WHERE r.state IN('READY','EXECUTING','WAITING','REVIEWING','REPAIRING','VERIFYING') AND ($5::text IS NULL OR r.project_id=$5) AND t.next_attempt_at<=$2 AND t.state='RUNNABLE' AND NOT EXISTS(SELECT 1 FROM relay_wonderland.julius_approvals a WHERE a.run_id=t.run_id AND a.state IN('PENDING','DENIED')) AND NOT EXISTS(SELECT 1 FROM relay_wonderland.julius_task_dependencies d JOIN relay_wonderland.julius_tasks dep ON dep.task_id=d.dependency_task_id WHERE d.task_id=t.task_id AND dep.state NOT IN('SUCCEEDED','SKIPPED')) ORDER BY r.created_at,t.ordinal,t.created_at FOR UPDATE OF t SKIP LOCKED LIMIT $4) UPDATE relay_wonderland.julius_tasks t SET state='ACTIVE',lease_owner=$1,lease_generation=t.lease_generation+1,lease_expires_at=$3,last_heartbeat=$2,version=t.version+1,updated_at=$2 FROM candidates c WHERE t.task_id=c.task_id RETURNING t.task_id,t.run_id,t.role,t.task_type,t.lease_generation,t.attempt`,[input.owner,input.now,input.leaseExpiresAt,input.limit,input.projectId??null]);return result.rows.map(row=>({taskId:String(row.task_id),runId:String(row.run_id),role:String(row.role),taskType:String(row.task_type),leaseGeneration:Number(row.lease_generation),attempt:Number(row.attempt)}));}
  /**
   * ONE ATOMIC WRITE, and the attempt is spent only if it lands.
   *
   * The lease conditions are the heartbeat's and `finishTask`'s: state ACTIVE,
   * this owner, this generation. A caller whose lease was reclaimed while it
   * decided gets `null` and must not run the task — it no longer owns it, and
   * the owner that does will admit it itself. `RETURNING attempt` is read from
   * the row the UPDATE actually wrote, so two workers racing the same stale
   * generation cannot both believe they hold attempt N.
   */
  async admitTask(input:{taskId:string;owner:string;leaseGeneration:number;now:string}):Promise<number|null>{const result=await this.pool.query<{attempt:string}>(`UPDATE relay_wonderland.julius_tasks SET attempt=attempt+1,version=version+1,updated_at=$4 WHERE task_id=$1 AND state='ACTIVE' AND lease_owner=$2 AND lease_generation=$3 RETURNING attempt`,[input.taskId,input.owner,input.leaseGeneration,input.now]);return result.rows[0]===undefined?null:Number(result.rows[0].attempt);}
  async heartbeat(input:{taskId:string;owner:string;leaseGeneration:number;now:string;leaseExpiresAt:string}):Promise<boolean>{const result=await this.pool.query(`UPDATE relay_wonderland.julius_tasks SET last_heartbeat=$4,lease_expires_at=$5,updated_at=$4 WHERE task_id=$1 AND state='ACTIVE' AND lease_owner=$2 AND lease_generation=$3`,[input.taskId,input.owner,input.leaseGeneration,input.now,input.leaseExpiresAt]);return result.rowCount===1;}
  /**
   * HANDED BACK IS NOT FAILED, AND THIS STORE USED TO DISAGREE WITH THE OTHER.
   *
   * `finishTask(state:'FAILED', nextAttemptAt)` is the runtime's "give this
   * task back" call: the run loop uses it to yield a claim when the C.A.R.D.
   * concurrency allowance is already spent, and the pipeline uses it to requeue
   * a retryable failure the policy authorized. The memory store answers by
   * setting the task RUNNABLE; this store set it FAILED, where no claim query
   * can ever reach it again (a claim needs RUNNABLE, BLOCKED, or an ACTIVE task
   * whose lease expired). So in production — the only place this repository
   * runs — a yielded or retried task was destroyed, silently, for a benign
   * scheduling reason. The run loop's own comment at the yield site says
   * "HANDED BACK, NOT HELD… returns to RUNNABLE immediately"; this makes that
   * true here too. Found by review of PR #215; not introduced by it.
   *
   * THE CASTS ARE LOAD-BEARING. `$6` used to appear only inside
   * `COALESCE($6,next_attempt_at)`, where PostgreSQL infers timestamptz from
   * the column beside it. A bare `$6 IS NOT NULL` offers nothing to infer
   * from, and the whole statement fails to plan with 42P08 — every finish,
   * not only a handed-back one. `$4` is in the same position inside the CASE.
   * Proven by the real-PostgreSQL cases in the sibling workflow, which is
   * where the uncast first version was caught.
   */
  async finishTask(input:{taskId:string;owner:string;leaseGeneration:number;state:'SUCCEEDED'|'FAILED'|'CANCELLED'|'SKIPPED';now:string;nextAttemptAt?:string}):Promise<boolean>{const result=await this.pool.query(`UPDATE relay_wonderland.julius_tasks SET state=CASE WHEN $4::text='FAILED' AND $6::timestamptz IS NOT NULL THEN 'RUNNABLE'::text ELSE $4::text END,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=COALESCE($6::timestamptz,next_attempt_at),version=version+1,updated_at=$5 WHERE task_id=$1 AND state='ACTIVE' AND lease_owner=$2 AND lease_generation=$3`,[input.taskId,input.owner,input.leaseGeneration,input.state,input.now,input.nextAttemptAt??null]);return result.rowCount===1;}
  async appendEvidence(input:{runId:string;projectId:string;idempotencyKey:string;evidence:JuliusEvidence}):Promise<boolean>{return this.transaction(async client=>{const result=await client.query(`INSERT INTO relay_wonderland.julius_evidence(evidence_id,run_id,task_id,worker_id,evidence_type,status,safe_summary,artifact_ref,integrity_hash,occurred_at,idempotency_key) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$12) ON CONFLICT(run_id,idempotency_key) DO NOTHING`,[input.evidence.evidenceId,input.runId,input.evidence.taskId,input.evidence.workerId,input.evidence.type,input.evidence.status,input.evidence.safeSummary,input.evidence.artifactRef,input.evidence.integrityHash,input.evidence.occurredAt,input.idempotencyKey,input.projectId]);if(result.rowCount!==1)return false;await this.event(client,{eventId:`julius:evidence:${input.evidence.evidenceId}`,projectId:input.projectId,streamId:input.runId,type:'julius.evidence.recorded',occurredAt:input.evidence.occurredAt,/* THE DIGEST TRAVELS WITH THE ANNOUNCEMENT. The event carried the sentence and
      dropped both machine-readable fields, so the stream was a weaker record than
      the row it announced — and the stream is what a projection, an eval or
      Project Brain reads. Null where the row is null: an artifact nobody can
      identify says so here too. */
     payload:{evidenceId:input.evidence.evidenceId,taskId:input.evidence.taskId,type:input.evidence.type,status:input.evidence.status,safeSummary:input.evidence.safeSummary,artifactRef:input.evidence.artifactRef,integrityHash:input.evidence.integrityHash}});return true;});}
  /**
   * RUNNABLE ONLY IN THE CLAIM, AND THE RELEASE RIDES WITH THE DECISION.
   *
   * The claim above used to offer BLOCKED work beside RUNNABLE work once every
   * dependency had SUCCEEDED, which is how paid run 34037313976 ran `build`
   * before the plan review: SUCCEEDED is not ACCEPTED. Julius is the only thing
   * that moves BLOCKED to RUNNABLE, and it does so HERE, inside the transaction
   * that records the accepting decision, so a crash between the two is not a
   * state that can exist. A duplicate decision (`ON CONFLICT DO NOTHING`)
   * releases nothing — the transaction that recorded it first already did.
   * Only BLOCKED tasks of this run move; the update is a no-op for any other.
   */
  /**
   * THE DECISION, ITS RELEASE AND THE EVENTS THAT EXPLAIN THEM — ONE
   * TRANSACTION.
   *
   * The events used to be appended after this returned, each in a transaction
   * of its own. A crash in the gap left the decision and the release standing
   * with nothing in the ledger to explain either, and nothing ever repaired
   * it: the resume sweep skips a task that already has a decision, so those
   * events were lost for good. The run's history could not say a verification
   * was decided, or that a task had become runnable, while the rows saying so
   * stood beside it.
   */
  async appendDecision(input:{decisionId:string;runId:string;taskId:string;policyRevision:string;idempotencyKey:string;occurredAt:string;decision:JuliusVerificationDecision;releaseTaskIds?:readonly string[];events?:readonly JuliusOperationalEvent[]}):Promise<boolean>{return this.transaction(async client=>{const result=await client.query(`INSERT INTO relay_wonderland.julius_verification_decisions(decision_id,run_id,task_id,action,reason_code,safe_summary,evidence_ids,policy_revision,occurred_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) ON CONFLICT(run_id,idempotency_key) DO NOTHING`,[input.decisionId,input.runId,input.taskId,input.decision.action,input.decision.reasonCode,input.decision.safeSummary,json(input.decision.evidenceIds),input.policyRevision,input.occurredAt,input.idempotencyKey]);if(result.rowCount!==1)return false;const releases=[...new Set(input.releaseTaskIds??[])];if(releases.length>0){await client.query(`UPDATE relay_wonderland.julius_tasks SET state='RUNNABLE',version=version+1,updated_at=$3 WHERE run_id=$1 AND task_id=ANY($2::text[]) AND state='BLOCKED'`,[input.runId,releases,input.occurredAt]);}for(const event of input.events??[])await appendJuliusEventWithin(client,event);return true;});}
  /**
   * ONE STATEMENT, AND THE RUN ROW IS THE COUNTER.
   *
   * `UNIQUE(run_id,revision)` cannot be satisfied by two callers that each read
   * `max(revision)+1`, so the revision is allocated by an UPDATE of the run row,
   * which takes that row's lock for the duration and therefore serialises
   * concurrent appends to one run without a retry loop and without SERIALIZABLE.
   *
   * `GREATEST(project_brain_revision, max(revision))` because the bootstrap
   * seeds entries at revisions 1..N and leaves the run's own counter at 0: the
   * first runtime append has to continue the sequence rather than collide with
   * it. From then on the column IS the counter, which is what it was for —
   * nothing else advanced it.
   *
   * `NOT EXISTS` on the entry id makes a replay a true no-op. Without it the
   * UPDATE would still fire, the INSERT would be swallowed by ON CONFLICT, and
   * the revision would drift upward on every retried tick — a counter counting
   * attempts instead of entries.
   */
  async appendBrainEntry(input:{runId:string;projectId:string;taskId:string|null;workerId:string;entryId:string;kind:JuliusBrainEntry['kind'];safeText:string;evidenceIds:readonly string[];occurredAt:string}):Promise<boolean>{
    const result=await this.pool.query(
      `WITH allocated AS (
         UPDATE relay_wonderland.julius_runs r
            SET project_brain_revision = GREATEST(
                  r.project_brain_revision,
                  COALESCE((SELECT max(b.revision) FROM relay_wonderland.julius_brain_entries b WHERE b.run_id = r.run_id), 0)
                ) + 1
          WHERE r.run_id = $2 AND r.project_id = $3
            AND NOT EXISTS (SELECT 1 FROM relay_wonderland.julius_brain_entries e WHERE e.entry_id = $1)
          RETURNING r.project_brain_revision AS revision
       )
       INSERT INTO relay_wonderland.julius_brain_entries(entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,allocated.revision,$9 FROM allocated
       ON CONFLICT(entry_id) DO NOTHING`,
      [input.entryId,input.runId,input.projectId,input.taskId,input.workerId,brainKindToStored(input.kind),input.safeText,json([...input.evidenceIds]),input.occurredAt],
    );
    return result.rowCount===1;
  }
  private async event(client:{query:(sql:string,values?:readonly unknown[])=>Promise<{rows:any[];rowCount:number|null}>},input:{eventId:string;projectId:string;streamId:string;type:string;occurredAt:string;payload:unknown}){const sequence=await client.query('INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2) ON CONFLICT(stream_id) DO UPDATE SET next_sequence=relay_wonderland.stream_sequences.next_sequence+1 RETURNING next_sequence-1 AS sequence',[input.streamId]);await client.query(`INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'PROJECT',$6::jsonb,$7)`,[input.eventId,input.streamId,input.projectId,Number(sequence.rows[0].sequence),input.type,json({schemaVersion:'relay-julius-event.v1',...input}),input.occurredAt]);await client.query('INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES($1,$2,$3)',[`outbox:${input.eventId}`,input.eventId,input.projectId]);}
  private mapRun(row:Record<string,unknown>):JuliusRunRecord{return{runId:String(row.run_id),missionId:String(row.mission_id),projectId:String(row.project_id),state:String(row.state)as JuliusMissionState,cardRevision:String(row.card_revision),missionContractRevision:Number(row.mission_contract_revision),projectBrainRevision:Number(row.project_brain_revision),version:Number(row.version)};}
  private parseRun(value:unknown):JuliusRunRecord{return typeof value==='string'?JSON.parse(value)as JuliusRunRecord:value as JuliusRunRecord;}
  private async transaction<T>(effect:(client:any)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const value=await effect(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}
}
