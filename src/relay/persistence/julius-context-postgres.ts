import type{Pool}from'pg';import type{JuliusContextSnapshot}from'../mission/julius';const json=(value:unknown)=>JSON.stringify(value);/**
 * NULL SURVIVES AS NULL. `JSON.stringify(null)` is the four-character string
 * `"null"`, which Postgres stores as a jsonb null VALUE — a row that says the
 * integrity decision was the JSON null rather than a row that says no decision
 * was made. The column is nullable precisely so those stay different.
 */
const jsonOrNull=(value:unknown)=>value===null||value===undefined?null:JSON.stringify(value);export class JuliusContextPostgresRepository{constructor(private readonly pool:Pool){}/**
 * THE ID THAT IS ACTUALLY STORED, not the one the caller minted.
 *
 * Context ids are minted per compile while this table deduplicates on
 * (task_id, worker_id, content_hash). A RETRY of a task whose context has not
 * changed therefore mints a fresh id, matches the existing row, inserts
 * nothing, and — when the caller assumed its own id had been stored — leaves a
 * trajectory event pointing at a row that does not exist. Paid Mission #2
 * crashed on that foreign key, reachable for the first time because a review
 * timeout became retryable.
 *
 * ONE STATEMENT, so the read cannot straddle another writer's commit: the CTE
 * inserts if it can and the UNION reads the surviving row otherwise. The `WHERE
 * EXISTS` run guard is unchanged, so a snapshot for a run this project does not
 * own still stores nothing — and now SAYS so by returning null instead of
 * letting the caller reference it anyway.
 */
async persist(input:{projectId:string;snapshot:JuliusContextSnapshot}):Promise<string|null>{const s=input.snapshot;const result=await this.pool.query<{context_id:string}>(`WITH inserted AS(INSERT INTO relay_wonderland.julius_context_snapshots(context_id,run_id,task_id,worker_id,worker_role,compiler_version,mission_contract_revision,card_revision,project_brain_revision,source_entry_ids,dependency_task_ids,evidence_ids,finding_ids,acceptance_criterion_ids,content_hash,character_count,redaction_count,truncated,integrity_version,integrity_conflicts,integrity_excluded_entry_ids,integrity_evicted_entry_ids) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$20,$21::jsonb,$22::jsonb,$23::jsonb WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$19) ON CONFLICT(task_id,worker_id,content_hash) DO NOTHING RETURNING context_id) SELECT context_id FROM inserted UNION ALL SELECT c.context_id FROM relay_wonderland.julius_context_snapshots c WHERE c.task_id=$3 AND c.worker_id=$4 AND c.content_hash=$15 AND NOT EXISTS(SELECT 1 FROM inserted) AND EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$19) LIMIT 1`,[s.contextId,s.runId,s.taskId,s.workerId,s.workerRole,s.compilerVersion,s.missionContractRevision,s.cardRevision,s.projectBrainRevision,json(s.sourceEntryIds),json(s.dependencyTaskIds),json(s.evidenceIds),json(s.findingIds),json(s.acceptanceCriterionIds),s.contentHash,s.characterCount,s.redactionCount,s.truncated,input.projectId,s.integrityVersion,jsonOrNull(s.integrityConflicts),jsonOrNull(s.integrityExcludedEntryIds),jsonOrNull(s.integrityEvictedEntryIds)]);const found=result.rows[0]?.context_id;if(found!==undefined)return found;
/**
 * ONE MORE LOOK, IN A FRESH STATEMENT.
 *
 * `ON CONFLICT DO NOTHING` can BLOCK on a concurrent inserter and then skip —
 * and that row is invisible to this statement's snapshot, so the `UNION ALL`
 * above returns nothing even though the context now exists. Answering `null`
 * there would make the pipeline fail a perfectly valid task as
 * `context_not_persisted`, turning a fix for a crash into an availability bug.
 *
 * A second statement takes a NEW snapshot and sees the committed row. Still
 * `null` after that means there genuinely is none, and failing closed is then
 * the honest answer rather than a race.
 */
/**
 * ON ITS OWN CONNECTION, so the snapshot cannot be inherited.
 *
 * The recovery read is only correct if it sees the row the winning transaction
 * committed. Issuing it as a second statement on the SAME session gives that
 * only under READ COMMITTED and only while nothing wraps this call in an
 * explicit transaction — an implicit requirement that no code states and no
 * test can see. This repository already writes the pattern that would break it:
 * `julius-event-postgres` and `julius-recovery-postgres` both take a client and
 * `BEGIN ISOLATION LEVEL SERIALIZABLE`. Under a fixed snapshot the recovery
 * would find nothing, `persist` would answer null, and the pipeline would fail
 * a perfectly valid task as `context_not_persisted`.
 *
 * A DEDICATED CONNECTION IS A SEPARATE SESSION. Its first statement takes a new
 * snapshot whatever the caller is doing, so the guarantee stops depending on
 * the caller's isolation level and starts being structural. The read is a
 * single row of immutable dedupe metadata, so running it outside a caller's
 * transaction changes nothing else.
 *
 * If no independent connection can be had, this answers null. Reusing the
 * possibly-transactional handle would be the silent wrong answer this exists to
 * prevent, and unknown is not an id.
 */
if(typeof this.pool.connect!=='function')return null;
let client;
try{client=await this.pool.connect();}catch{return null;}
try{
 const settled=await client.query<{context_id:string}>(`SELECT c.context_id FROM relay_wonderland.julius_context_snapshots c WHERE c.task_id=$1 AND c.worker_id=$2 AND c.content_hash=$3 AND EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$4 AND project_id=$5) LIMIT 1`,[s.taskId,s.workerId,s.contentHash,s.runId,input.projectId]);
 return settled.rows[0]?.context_id??null;
}finally{client.release();}}}
