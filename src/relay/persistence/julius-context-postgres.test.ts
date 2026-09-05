import{describe,expect,it}from'vitest';import type{Pool}from'pg';import{JuliusContextPostgresRepository}from'./julius-context-postgres';class PoolStub{rows:{context_id:string}[]=[{context_id:'context'}];sql='';statements:string[]=[];replies:{context_id:string}[][]|null=null;async query(text:string){this.sql=text;this.statements.push(text);const scripted=this.replies?.[this.statements.length-1];return{rows:scripted??this.rows,rowCount:(scripted??this.rows).length}}async connect(){throw new Error('unused')}async end(){}}const snapshot={contextId:'context',runId:'run',taskId:'task',workerId:'worker',workerRole:'CODING_AGENT',compilerVersion:'julius-context.v1' as const,missionContractRevision:1,cardRevision:'card',projectBrainRevision:2,sourceEntryIds:['entry'],dependencyTaskIds:['dependency'],evidenceIds:['evidence'],findingIds:['finding'],acceptanceCriterionIds:['criterion'],contentHash:'sha256:x',characterCount:10,redactionCount:1,truncated:false,packet:{missionId:'mission',taskId:'task',workerId:'worker',sourceEntryIds:['entry'],blocks:[],truncated:false}};describe('Julius context persistence',()=>{
 it('tenant-scopes and idempotently stores snapshot metadata rather than arbitrary transcripts',async()=>{
  const pool=new PoolStub();
  expect(await new JuliusContextPostgresRepository(pool as unknown as Pool).persist({projectId:'project',snapshot})).toBe('context');
  expect(pool.sql).toContain('project_id=$19');
  expect(pool.sql).toContain('ON CONFLICT(task_id,worker_id,content_hash) DO NOTHING');
  expect(pool.sql).not.toContain('packet');
 });

 /**
  * THE ID THAT IS STORED IS THE ONE THE CALLER MUST USE.
  *
  * Paid Mission #2 crashed on `julius_trajectory_events_context_id_fkey`: a
  * retry minted a new id, the dedupe matched the existing row, nothing was
  * inserted, and the caller referenced the id it had minted. The statement must
  * therefore ANSWER with an id, and answer with the surviving row's id when its
  * own insert did nothing.
  */
 it('answers with the surviving row when its insert deduplicated away',async()=>{
  const pool=new PoolStub();
  pool.rows=[{context_id:'context#already-stored'}];
  const effective=await new JuliusContextPostgresRepository(pool as unknown as Pool).persist({projectId:'project',snapshot:{...snapshot,contextId:'context#freshly-minted'}});
  expect(effective,'the stored id, not the minted one').toBe('context#already-stored');
 });

 it('reads the surviving row in the SAME statement, so no other writer can slip between',async()=>{
  const pool=new PoolStub();
  await new JuliusContextPostgresRepository(pool as unknown as Pool).persist({projectId:'project',snapshot});
  // A separate SELECT after a DO NOTHING is a race: the row a concurrent
  // transaction is inserting is not visible until it commits.
  expect(pool.sql).toContain('WITH inserted AS');
  expect(pool.sql).toContain('RETURNING context_id');
  expect(pool.sql).toContain('UNION ALL');
  expect(pool.sql).toContain('NOT EXISTS(SELECT 1 FROM inserted)');
 });

 /**
  * A CONCURRENT INSERTER IS NOT AN ABSENT ROW.
  *
  * `ON CONFLICT DO NOTHING` can block on another transaction and then skip,
  * and that row is invisible to the first statement's snapshot. Answering null
  * there would fail a perfectly valid task as `context_not_persisted` — a fix
  * for a crash turned into an availability bug.
  */
 it('looks again in a fresh statement when the conflicting row was invisible',async()=>{
  const pool=new PoolStub();
  pool.replies=[[],[{context_id:'context#committed-by-the-other-writer'}]];
  const effective=await new JuliusContextPostgresRepository(pool as unknown as Pool).persist({projectId:'project',snapshot});
  expect(effective,'the row the other transaction committed').toBe('context#committed-by-the-other-writer');
  expect(pool.statements.length,'a SECOND statement, so it takes a new snapshot').toBe(2);
  expect(pool.statements[1]).not.toContain('INSERT');
 });

 it('answers null rather than naming a context it did not store',async()=>{
  // The run guard refused the insert and there is no surviving row: unknown is
  // not a reference, and the caller must fail closed rather than invent one.
  const pool=new PoolStub();
  pool.rows=[];
  // Null only after the fresh look as well: still nothing means there is
  // genuinely nothing, and failing closed is then honest rather than a race.
  expect(await new JuliusContextPostgresRepository(pool as unknown as Pool).persist({projectId:'wrong-project',snapshot})).toBeNull();
  expect(pool.statements.length).toBe(2);
 });
});
