import type{Pool}from'pg';
import{JuliusWorkArtifactConflict,juliusWorkArtifactId,validateJuliusWorkArtifact,type JuliusWorkArtifactKind,type JuliusWorkArtifactRecord,type JuliusWorkArtifactScope,type JuliusWorkArtifactStore}from'../mission/julius';

/**
 * WHICH BODY BELONGS TO WHICH ATTEMPT.
 *
 * The bytes live in the content store, which hashes them on write and
 * re-hashes them on read. This is the row a later process reads to find one —
 * the only thing that makes an artifact reference resolve after a restart.
 *
 * APPEND ONLY, like every other durable fact in this schema: `DO NOTHING` on
 * conflict, no UPDATE path at all. A repeated write of the SAME body is the
 * same artifact; a DIFFERENT body under a used id is refused, because
 * accepting it would silently replace the record of what an attempt actually
 * produced.
 */
const map=(row:Record<string,unknown>):JuliusWorkArtifactRecord=>({
 artifactId:String(row.artifact_id),projectId:String(row.project_id),runId:String(row.run_id),
 taskId:String(row.task_id),leaseGeneration:Number(row.lease_generation),role:String(row.role),
 kind:String(row.kind)as JuliusWorkArtifactKind,contentType:String(row.content_type),
 byteSize:Number(row.byte_size),contentHash:String(row.content_hash),storageRef:String(row.storage_ref),
 occurredAt:row.occurred_at instanceof Date?row.occurred_at.toISOString():String(row.occurred_at),
});

export class JuliusWorkArtifactPostgresRepository implements JuliusWorkArtifactStore{
 constructor(private readonly pool:Pool){}

 async recordWorkArtifact(record:JuliusWorkArtifactRecord):Promise<{recorded:boolean}>{
  validateJuliusWorkArtifact(record);
  const inserted=await this.pool.query(
   `INSERT INTO relay_wonderland.julius_work_artifacts(artifact_id,project_id,run_id,task_id,lease_generation,role,kind,content_type,byte_size,content_hash,storage_ref,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(artifact_id) DO NOTHING`,
   [record.artifactId,record.projectId,record.runId,record.taskId,record.leaseGeneration,record.role,record.kind,record.contentType,record.byteSize,record.contentHash,record.storageRef,record.occurredAt],
  );
  if(inserted.rowCount===1)return{recorded:true};
  // Already there. The same bytes are the same artifact; anything else is a
  // rewrite of history and is refused by name.
  const existing=await this.pool.query('SELECT content_hash,byte_size FROM relay_wonderland.julius_work_artifacts WHERE artifact_id=$1',[record.artifactId]);
  const row=existing.rows[0] as{content_hash:string;byte_size:string}|undefined;
  if(row===undefined)throw new JuliusWorkArtifactConflict(record.artifactId);
  if(row.content_hash!==record.contentHash||Number(row.byte_size)!==record.byteSize)throw new JuliusWorkArtifactConflict(record.artifactId);
  return{recorded:false};
 }

 async workArtifact(scope:JuliusWorkArtifactScope):Promise<JuliusWorkArtifactRecord|null>{
  const result=await this.pool.query('SELECT * FROM relay_wonderland.julius_work_artifacts WHERE artifact_id=$1 AND project_id=$2',[juliusWorkArtifactId(scope),scope.projectId]);
  return result.rows[0]?map(result.rows[0] as Record<string,unknown>):null;
 }

 /**
  * The newest attempt's artifact of this kind. A reviewer asking for "the
  * plan" wants whichever attempt produced the one in force, not a particular
  * generation — while every earlier generation stays exactly where it was.
  */
 async latestWorkArtifact(input:{projectId:string;runId:string;taskId:string;kind:JuliusWorkArtifactKind}):Promise<JuliusWorkArtifactRecord|null>{
  const result=await this.pool.query(
   'SELECT * FROM relay_wonderland.julius_work_artifacts WHERE project_id=$1 AND run_id=$2 AND task_id=$3 AND kind=$4 ORDER BY lease_generation DESC LIMIT 1',
   [input.projectId,input.runId,input.taskId,input.kind],
  );
  return result.rows[0]?map(result.rows[0] as Record<string,unknown>):null;
 }

 async workArtifactsForRun(input:{projectId:string;runId:string}):Promise<readonly JuliusWorkArtifactRecord[]>{
  const result=await this.pool.query('SELECT * FROM relay_wonderland.julius_work_artifacts WHERE project_id=$1 AND run_id=$2 ORDER BY occurred_at,artifact_id',[input.projectId,input.runId]);
  return result.rows.map(row=>map(row as Record<string,unknown>));
 }
}
