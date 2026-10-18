import type{Pool}from'pg';import{JULIUS_ATTEMPT_KINDS,JULIUS_PRE_PROVIDER_REFUSALS,JULIUS_TRAJECTORY_KINDS,validateTrajectoryEvent,type JuliusEvalSummary,type JuliusTrajectoryEvent,type JuliusTrajectoryKind}from'../mission/julius';import{JULIUS_READ_LIMIT}from'./julius-read-postgres';const json=(v:unknown)=>JSON.stringify(v);
/**
 * A PROVIDER ATTEMPT, in SQL: exactly `isJuliusProviderAttempt`. A DISPATCH row, or the RETRY
 * row of an attempt the run requeued, that is neither a tool step (a non-empty STRING `toolId`
 * in its facts) nor a pre-provider refusal (a refusal outcome with no provider, no context and
 * no measure at all).
 * TWO-VALUED ON PURPOSE: a missing `toolId` or a NULL outcome makes the bare comparison NULL,
 * and a NULL inside FILTER drops the row. The TypeScript counts that row as an attempt, so
 * the COALESCE and the IS NOT NULL keep the two summaries in agreement.
 */
const TOOL_STEP=`COALESCE(jsonb_typeof(safe_facts->'toolId')='string' AND safe_facts->>'toolId'<>'',false)`;
const REFUSAL=`(outcome IS NOT NULL AND outcome IN (${JULIUS_PRE_PROVIDER_REFUSALS.map((outcome)=>`'${outcome}'`).join(',')}) AND provider_id IS NULL AND context_id IS NULL AND duration_ms IS NULL AND usd_micros IS NULL AND input_tokens IS NULL AND output_tokens IS NULL)`;
export const JULIUS_PROVIDER_ATTEMPT_SQL=`event_kind IN (${JULIUS_ATTEMPT_KINDS.map((kind)=>`'${kind}'`).join(',')}) AND NOT ${TOOL_STEP} AND NOT ${REFUSAL}`;
export class JuliusTrajectoryPostgresRepository{constructor(private readonly pool:Pool){}async append(event:JuliusTrajectoryEvent):Promise<boolean>{validateTrajectoryEvent(event);const result=await this.pool.query(`INSERT INTO relay_wonderland.julius_trajectory_events(trajectory_event_id,run_id,project_id,event_kind,task_id,worker_id,provider_id,context_id,runtime_version,policy_version,card_revision,mission_contract_revision,project_brain_revision,duration_ms,usd_micros,input_tokens,output_tokens,outcome,safe_facts,idempotency_key,occurred_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21 WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$3) ON CONFLICT(run_id,idempotency_key) DO NOTHING`,[event.trajectoryEventId,event.runId,event.projectId,event.kind,event.taskId,event.workerId,event.providerId,event.contextId,event.runtimeVersion,event.policyVersion,event.cardRevision,event.missionContractRevision,event.projectBrainRevision,event.durationMs,event.usdMicros,event.inputTokens,event.outputTokens,event.outcome,json(event.safeFacts),event.idempotencyKey,event.occurredAt]);return result.rowCount===1;}
 async summarize(input:{projectId:string;runtimeVersion:string;from:string;to:string}):Promise<JuliusEvalSummary>{const result=await this.pool.query<Record<string,string|null>>(`WITH scoped AS (SELECT * FROM relay_wonderland.julius_trajectory_events WHERE project_id=$1 AND runtime_version=$2 AND occurred_at>=$3 AND occurred_at<$4),runs AS (SELECT DISTINCT run_id FROM scoped),completed AS (SELECT DISTINCT run_id FROM scoped WHERE event_kind='COMPLETION' AND outcome='VERIFIED') SELECT (SELECT count(*) FROM runs)::text runs,(SELECT count(*) FROM completed)::text verified,COALESCE(sum(usd_micros),0)::text usd,count(*) FILTER(WHERE ${JULIUS_PROVIDER_ATTEMPT_SQL} AND usd_micros IS NULL)::text unknown_cost,avg(duration_ms) FILTER(WHERE ${JULIUS_PROVIDER_ATTEMPT_SQL})::text duration,count(*) FILTER(WHERE event_kind='RETRY')::text retries,count(*) FILTER(WHERE event_kind='FALLBACK')::text fallbacks,count(*) FILTER(WHERE event_kind='REPAIR')::text repairs,count(*) FILTER(WHERE event_kind='RECOVERY')::text recoveries FROM scoped`,[input.projectId,input.runtimeVersion,input.from,input.to]);const row=result.rows[0]??{};const runs=Number(row.runs??0),verified=Number(row.verified??0),usd=Number(row.usd??0),unknownCost=Number(row.unknown_cost??0);
  /* `sum` SKIPS NULLS, so this used to publish the sum of the dispatches that
     reported a cost under a name that promised all of them. The count beside it
     is the pure summary's `unknownCostComponents` computed the same way: over
     PROVIDER ATTEMPTS only, because a tool step reports a literal zero and a
     pre-provider refusal called nobody. The average is over the same rows, so
     a tool step's milliseconds never dilute a provider's minutes. The sum stays
     over every kind, and the pure summary now sums exactly that too. */
  return{runtimeVersion:input.runtimeVersion,runs,verifiedCompletions:verified,verifiedCompletionRate:runs?verified/runs:0,knownUsdMicros:usd,unknownCostComponents:unknownCost,costComplete:unknownCost===0,knownCostPerVerifiedCompletion:verified?usd/verified:null,averageDurationMs:row.duration===null?null:Number(row.duration),retries:Number(row.retries??0),fallbacks:Number(row.fallbacks??0),repairs:Number(row.repairs??0),recoveries:Number(row.recoveries??0)};}
 /**
  * ONE RUN'S ROWS BACK, EXACTLY AS `append` WROTE THEM. The Learning Loop's runtime caller
  * projects a mission from these and from nothing else, so nothing here is summarised, defaulted
  * or dropped. PROJECT-SCOPED like every read: a run id from another tenant reads nothing. In the
  * ledger's own order, which is the `julius_trajectory_run` index (`occurred_at`, then the row's
  * id). Every row goes back through `validateTrajectoryEvent` and a closed kind check, so a row
  * this build could not have appended is refused rather than measured. ONE ROW OVER THE CEILING
  * is fetched, so a run larger than `JULIUS_READ_LIMIT` refuses: a truncated trajectory is a
  * measurement of a different mission, and the evidence readers' "truthful partial answer" is
  * not one here.
  */
 async forRun(runId:string,projectId:string):Promise<readonly JuliusTrajectoryEvent[]>{const result=await this.pool.query<Record<string,unknown>>(`SELECT trajectory_event_id,run_id,project_id,event_kind,task_id,worker_id,provider_id,context_id,runtime_version,policy_version,card_revision,mission_contract_revision,project_brain_revision,duration_ms,usd_micros,input_tokens,output_tokens,outcome,safe_facts,idempotency_key,occurred_at FROM relay_wonderland.julius_trajectory_events WHERE run_id=$1 AND project_id=$2 ORDER BY occurred_at,trajectory_event_id LIMIT $3`,[runId,projectId,JULIUS_READ_LIMIT+1]);if(result.rows.length>JULIUS_READ_LIMIT)throw new Error('trajectory_read_exceeds_limit');return result.rows.map(trajectoryEventOf);}}
/**
 * A STORED ROW, AS THE EVENT THAT WAS APPENDED. The `bigint` columns arrive from the driver as
 * text and become numbers here; `validateTrajectoryEvent` then refuses any that is not a safe
 * non-negative integer, so a value too large to round-trip is an error and never a rounded
 * measurement. The instant is read as the ISO form the runtime writes (`clock.now()`), from the
 * driver's `Date` directly: through `String(date)` it would lose its milliseconds. The facts are
 * the stored object, scalars only, as `append` accepted them.
 */
function trajectoryEventOf(row:Record<string,unknown>):JuliusTrajectoryEvent{const kind=String(row.event_kind);if(!(JULIUS_TRAJECTORY_KINDS as readonly string[]).includes(kind))throw new Error('trajectory_kind_unknown');const text=(value:unknown):string|null=>value===null||value===undefined?null:String(value);const integer=(value:unknown):number|null=>value===null||value===undefined?null:Number(value);const facts=typeof row.safe_facts==='string'?JSON.parse(row.safe_facts) as unknown:row.safe_facts;if(facts===null||typeof facts!=='object'||Array.isArray(facts))throw new Error('trajectory_facts_invalid');for(const value of Object.values(facts))if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new Error('trajectory_facts_invalid');const occurred=row.occurred_at instanceof Date?row.occurred_at:new Date(String(row.occurred_at));if(Number.isNaN(occurred.getTime()))throw new Error('trajectory_occurred_at_invalid');
  const event:JuliusTrajectoryEvent={trajectoryEventId:String(row.trajectory_event_id),runId:String(row.run_id),projectId:String(row.project_id),kind:kind as JuliusTrajectoryKind,taskId:text(row.task_id),workerId:text(row.worker_id),providerId:text(row.provider_id),contextId:text(row.context_id),runtimeVersion:String(row.runtime_version),policyVersion:String(row.policy_version),cardRevision:String(row.card_revision),missionContractRevision:Number(row.mission_contract_revision),projectBrainRevision:Number(row.project_brain_revision),durationMs:integer(row.duration_ms),usdMicros:integer(row.usd_micros),inputTokens:integer(row.input_tokens),outputTokens:integer(row.output_tokens),outcome:text(row.outcome),safeFacts:facts as JuliusTrajectoryEvent['safeFacts'],idempotencyKey:String(row.idempotency_key),occurredAt:occurred.toISOString()};validateTrajectoryEvent(event);return event;}
