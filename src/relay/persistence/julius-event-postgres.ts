import type{Pool}from'pg';import{juliusSerializable}from'./julius-serializable';import{JuliusEventIdConflict,canonicalJuliusEventIdentity,juliusLateSettlementDecision,juliusSettlementConflictEvent,validateJuliusEvent,type JuliusOperationalEvent,type JuliusPriorSettlement}from'../mission/julius';const json=(v:unknown)=>JSON.stringify(v);
/**
 * IS THE ROW ALREADY THIS EVENT?
 *
 * Extracted so the decision is provable without a database: it is the reason a
 * replay is idempotent and a rewrite is a conflict, and it used to be
 * `JSON.stringify` of a payload that had been through `jsonb` — which reorders
 * keys, so it answered "different" for events that were identical.
 */
export const sameStoredJuliusEvent=(storedPayload:unknown,event:JuliusOperationalEvent):boolean=>
 canonicalJuliusEventIdentity((storedPayload??{})as never)===canonicalJuliusEventIdentity(event);
/** What the events table stores. One shape, wherever the row is written from. */
export const juliusEventPayload=(event:JuliusOperationalEvent)=>({schemaVersion:'relay-julius-event.v1',runId:event.runId,projectId:event.projectId,type:event.type,taskId:event.taskId,workerId:event.workerId,correlationId:event.correlationId,causationId:event.causationId,occurredAt:event.occurredAt,facts:event.facts});
/** An open transaction. Whose it is, is the caller's business. */
export interface JuliusEventTransaction{query:(sql:string,values?:readonly unknown[])=>Promise<{rows:any[];rowCount:number|null}>}
/**
 * THE APPEND ITSELF, INSIDE SOMEONE ELSE'S TRANSACTION.
 *
 * Separated from the repository because an event that explains a decision has
 * to be written in the decision's OWN transaction. Appended after it, a crash
 * in between left the decision and its release standing with nothing in the
 * history to explain either — permanently, because the resume sweep skips a
 * task that already has a decision, so nothing ever wrote them afterwards.
 *
 * The rules do not change with the caller: the same identity comparison, the
 * same typed conflict, the same run-ownership check, the same sequence
 * allocation, the same outbox row. It takes no BEGIN and no COMMIT, so these
 * events land exactly when the work they describe does.
 */
export async function appendJuliusEventWithin(client:JuliusEventTransaction,event:JuliusOperationalEvent):Promise<{recorded:boolean;sequence:number}>{
 validateJuliusEvent(event);
 const existing=await client.query('SELECT sequence,payload FROM relay_wonderland.events WHERE event_id=$1 FOR UPDATE',[event.eventId]);
 if(existing.rows[0]){const payload=typeof existing.rows[0].payload==='string'?JSON.parse(existing.rows[0].payload):existing.rows[0].payload;if(!sameStoredJuliusEvent(payload,event))throw new JuliusEventIdConflict(event.eventId);return{recorded:false,sequence:Number(existing.rows[0].sequence)};}
 const owned=await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE',[event.runId,event.projectId]);
 if(!owned.rows[0])throw new Error('julius_run_not_found');
 const allocated=await client.query('INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2) ON CONFLICT(stream_id) DO UPDATE SET next_sequence=relay_wonderland.stream_sequences.next_sequence+1 RETURNING next_sequence-1 AS sequence',[event.runId]);
 const sequence=Number(allocated.rows[0].sequence);
 await client.query(`INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'PROJECT',$6::jsonb,$7)`,[event.eventId,event.runId,event.projectId,sequence,`julius.${event.type}`,json(juliusEventPayload(event)),event.occurredAt]);
 await client.query('INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES($1,$2,$3)',[`outbox:${event.eventId}`,event.eventId,event.projectId]);
 return{recorded:true,sequence};
}
/**
 * Safe authoritative source only. Presentation and terminal wording are downstream concerns.
 *
 * The append is ONE serializable transaction, and a serialization failure is
 * retried (bounded) by `juliusSerializable`: the body is SQL over an event the
 * caller built, and a replay of the same event is idempotent by its id anyway.
 * Unretried, one 40001 against a concurrent writer threw out of the run loop's
 * tick and stranded every task it had claimed.
 */
export class JuliusEventPostgresRepository{constructor(private readonly pool:Pool){}async append(event:JuliusOperationalEvent):Promise<{recorded:boolean;sequence:number}>{return juliusSerializable(this.pool,(client)=>appendJuliusEventWithin(client,event));}
/**
 * THE HANDOFF, FENCED BY THE LEASE ((a2)). The task row is read FOR SHARE in the same
 * serializable transaction as the insert. A recovery that already holds it (`FOR UPDATE OF t
 * SKIP LOCKED`) makes this wait, then see the cleared lease and answer LEASE_LOST, and nothing
 * is dispatched. A recovery that comes second skips this locked task and reads the committed
 * handoff on its next sweep.
 */
async appendHandoff(input:{event:JuliusOperationalEvent;owner:string;leaseGeneration:number}):Promise<'RECORDED'|'DUPLICATE'|'LEASE_LOST'>{return juliusSerializable(this.pool,async(client)=>{const held=await client.query(`SELECT 1 FROM relay_wonderland.julius_tasks WHERE task_id=$1 AND run_id=$2 AND state='ACTIVE' AND lease_owner=$3 AND lease_generation=$4 FOR SHARE`,[input.event.taskId,input.event.runId,input.owner,input.leaseGeneration]);if(!held.rows[0])return'LEASE_LOST' as const;return(await appendJuliusEventWithin(client,input.event)).recorded?'RECORDED' as const:'DUPLICATE' as const;});}
/**
 * A RELEASE, DECIDED AGAINST ITS RESERVATION'S SETTLEMENTS ((a2) step 3). The run row is locked FOR UPDATE
 * first, the lock every append of this run takes, so no two writers of one reservation decide at once. The
 * settlements the reservation already carries are read, `juliusLateSettlementDecision` decides, and the
 * release (with a named conflict when there is one) is appended in the same serializable transaction.
 * A sweep that closed the reservation after this snapshot moved the run's stream counter, so this fails
 * with 40001, is retried by `juliusSerializable`, and the retry decides against the close.
 */
async appendSettlement(event:JuliusOperationalEvent):Promise<'RECORDED'|'DUPLICATE'|'SAME_MEANING'|'CONFLICT'>{return juliusSerializable(this.pool,async(client)=>{validateJuliusEvent(event);const owned=await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE',[event.runId,event.projectId]);if(!owned.rows[0])throw new Error('julius_run_not_found');const reservationId=typeof event.facts.reservationId==='string'?event.facts.reservationId:null;const rows:Array<{event_id:string;released:string|null;reason:string|null}>=reservationId===null?[]:(await client.query(`SELECT event_id,payload->'facts'->>'released' AS released,payload->'facts'->>'reason' AS reason FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.budget.settled' AND payload->'facts'->>'reservationId'=$2 ORDER BY sequence`,[event.runId,reservationId])).rows;if(rows.some((row)=>row.event_id===event.eventId))return(await appendJuliusEventWithin(client,event)).recorded?'RECORDED' as const:'DUPLICATE' as const;const prior:JuliusPriorSettlement[]=rows.map((row)=>({eventId:row.event_id,released:row.released==='true',reason:row.reason}));const decision=juliusLateSettlementDecision({released:event.facts.released===true},prior);if(decision==='SAME_MEANING')return'SAME_MEANING' as const;await appendJuliusEventWithin(client,event);if(decision==='CONFLICT'){await appendJuliusEventWithin(client,juliusSettlementConflictEvent({release:event,prior}));return'CONFLICT' as const;}return'RECORDED' as const;});}}
