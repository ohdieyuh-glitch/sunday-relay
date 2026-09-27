import type{Pool}from'pg';import{JuliusEventIdConflict,canonicalJuliusEventIdentity,validateJuliusEvent,type JuliusOperationalEvent}from'../mission/julius';const json=(v:unknown)=>JSON.stringify(v);
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
/** Safe authoritative source only. Presentation and terminal wording are downstream concerns. */
export class JuliusEventPostgresRepository{constructor(private readonly pool:Pool){}async append(event:JuliusOperationalEvent):Promise<{recorded:boolean;sequence:number}>{const client=await this.pool.connect();try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const outcome=await appendJuliusEventWithin(client,event);await client.query('COMMIT');return outcome;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}}
