import{createHash}from'node:crypto';import{describe,expect,it}from'vitest';import type{Pool}from'pg';import{JuliusToolSettlementPostgresRepository}from'./julius-tool-settlement-postgres';import{CommitOutcomeUnknownError}from'./postgres-serializable';const stable=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;const result:any={invocationId:'inv',status:'SUCCEEDED',exitCode:0,safeSummary:'ok',stdout:'',stderr:'',stdoutRef:null,stderrRef:null,artifacts:[],evidence:[],durationMs:5,resourceUsage:{toolCalls:1,runtimeMs:5,outputBytes:0},policyDecisionRef:'card',mutations:[]};const command:any={settlementId:'settle',invocationId:'inv',dispatchGeneration:1,resultDigest:createHash('sha256').update(stable(result)).digest('hex'),result,artifacts:[],evidence:[],taskOutcome:null,occurredAt:'2026-08-31T00:00:00Z'};
class Client{commands:string[]=[];async query(sql:string){this.commands.push(sql);if(sql.startsWith('SELECT settlement_id'))return{rows:[],rowCount:0};if(sql.includes('SELECT i.*'))return{rows:[{invocation_id:'inv',dispatch_generation:1,state:'RUNNING',project_id:'project',tenant_id:'tenant',run_id:'run',task_id:'task',worker_id:'worker',lease_generation:3,budget_reservation_id:'budget',runtime_version:'1',card_revision:'card',mission_id:'mission',mission_contract_revision:1,project_brain_revision:0,task_state:'ACTIVE',task_lease_generation:3,task_worker_id:'worker',tool_id:'shell.bash'}],rowCount:1};if(sql.includes('julius_tool_execution_receipts WHERE'))return{rows:[{result,result_digest:command.resultDigest}],rowCount:1};if(sql.includes('budget_reservations b JOIN'))return{rows:[{state:'RESERVED'}],rowCount:1};if(sql.includes('RETURNING next_sequence'))return{rows:[{sequence:'1'}],rowCount:1};return{rows:[],rowCount:1};}release(){}}
describe('exactly-once tool settlement',()=>{it('places budget, task, trajectory, event, outbox, invocation and settlement under one transaction',async()=>{const client=new Client(),repo=new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool);expect((await repo.settle(command)).created).toBe(true);expect(client.commands[0]).toContain('SERIALIZABLE');const joined=client.commands.join('\n');for(const authority of['budget_reservations','julius_trajectory_events','relay_wonderland.events','relay_wonderland.outbox','julius_tool_invocations SET state','julius_tool_settlements'])expect(joined).toContain(authority);expect(client.commands.at(-1)).toBe('COMMIT');});it('rolls the whole settlement back on a mid-transaction failure',async()=>{const client=new Client(),original=client.query.bind(client);client.query=async sql=>{if(sql.includes('julius_trajectory_events'))throw new Error('injected');return original(sql);};await expect(new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool).settle(command)).rejects.toThrow('injected');expect(client.commands.at(-1)).toBe('ROLLBACK');});});

describe('settlement fault injection',()=>{for(const point of['AFTER_BUDGET','AFTER_EVIDENCE','AFTER_TASK','BEFORE_COMMIT'] as const)it(`rolls back at ${point}`,async()=>{const client=new Client(),repo=new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool,undefined,current=>{if(current===point)throw new Error(`fault:${point}`);});await expect(repo.settle(command)).rejects.toThrow(`fault:${point}`);expect(client.commands.at(-1)).toBe('ROLLBACK');});});

describe('artifact settlement integrity',()=>{it('rejects metadata-backed content whose bytes do not hash',async()=>{const metadata:any={artifactId:'artifact',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',invocationId:'inv',kind:'TEST_REPORT',contentType:'text/plain',byteSize:4,contentHash:createHash('sha256').update('good').digest('hex'),storageRef:'object://final',createdAt:command.occurredAt,expiresAt:null};const artifactStore:any={async get(){return{metadata,content:Buffer.from('evil')}}};await expect(new JuliusToolSettlementPostgresRepository({connect:async()=>new Client()}as unknown as Pool,artifactStore).settle({...command,artifacts:[metadata]})).rejects.toThrow('tool_settlement_artifact_bytes_unavailable');});});

/**
 * THE COMMIT BOUNDARY AFTER ADOPTING `serializableTransaction`.
 *
 * This repository stayed outside the shared retry helper until the helper could
 * keep the real COMMIT between `fault('BEFORE_COMMIT')` and
 * `fault('AFTER_COMMIT')` — the four cases above are what that protects, and
 * these are what it adds. Exactly once is the property; "at least once with a
 * good excuse" is the failure.
 */
describe('settlement under a retrying commit boundary',()=>{
 /** A client whose COMMIT can be scripted per attempt. */
 class CommitScriptedClient extends Client{
  attempts=0;
  constructor(private readonly onCommit:(attempt:number)=>unknown){super();}
  override async query(sql:string){
   if(sql==='COMMIT'){this.attempts+=1;this.commands.push(sql);const failure=this.onCommit(this.attempts);if(failure!==null)throw failure;return{rows:[],rowCount:0} as never;}
   return super.query(sql);
  }
 }
 const transient=()=>Object.assign(new Error('could not serialize access due to read/write dependencies among transactions'),{code:'40001'});

 it('a serialization failure AT COMMIT settles on the retry, re-reading its identity first',async()=>{
  const client=new CommitScriptedClient(attempt=>attempt===1?transient():null);
  const repo=new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool);
  expect((await repo.settle(command)).created).toBe(true);
  expect(client.attempts,'committed on the second attempt').toBe(2);
  // THE REPLAY IS SAFE BECAUSE OF THIS: every attempt begins with the
  // settlement identity read, so a second run cannot double-settle.
  expect(client.commands.filter(c=>c.startsWith('SELECT settlement_id')),'identity read once per attempt').toHaveLength(2);
  expect(client.commands.filter(c=>c==='ROLLBACK'),'the aborted attempt rolled back').toHaveLength(1);
 });

 it('any OTHER commit failure is UNKNOWN and is never retried',async()=>{
  // The settlement may be durable and unreported. Running it again is how
  // exactly-once becomes twice; the caller resolves it by identity later.
  const client=new CommitScriptedClient(()=>Object.assign(new Error('Connection terminated unexpectedly'),{code:'ECONNRESET'}));
  const repo=new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool);
  const error=await repo.settle(command).then(()=>null).catch((e:unknown)=>e);
  expect(error).toBeInstanceOf(CommitOutcomeUnknownError);
  expect(client.attempts,'asked exactly once').toBe(1);
 });

 it('an AFTER_COMMIT crash leaves the settlement durable and never replays it',async()=>{
  const client=new CommitScriptedClient(()=>null);
  const repo=new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool,undefined,point=>{if(point==='AFTER_COMMIT')throw new Error('fault:AFTER_COMMIT');});
  await expect(repo.settle(command)).rejects.toThrow('fault:AFTER_COMMIT');
  expect(client.attempts,'committed exactly once').toBe(1);
  expect(client.commands,'and a committed transaction is not rolled back').not.toContain('ROLLBACK');
 });

 it('BEFORE_COMMIT still precedes the commit, which is what the drill measures',async()=>{
  const client=new CommitScriptedClient(()=>null);
  const repo=new JuliusToolSettlementPostgresRepository({connect:async()=>client}as unknown as Pool,undefined,point=>{if(point==='BEFORE_COMMIT')throw new Error('fault:BEFORE_COMMIT');});
  await expect(repo.settle(command)).rejects.toThrow('fault:BEFORE_COMMIT');
  expect(client.attempts,'nothing was committed').toBe(0);
  expect(client.commands.at(-1)).toBe('ROLLBACK');
 });
});
