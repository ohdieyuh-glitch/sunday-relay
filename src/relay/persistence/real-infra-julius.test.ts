import{execFile}from'node:child_process';import{promisify}from'node:util';import{chmod,mkdtemp,readFile,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';import{Pool}from'pg';import{afterAll,beforeAll,describe,expect,it}from'vitest';import{TransactionalWonderlandDatabase,WONDERLAND_MIGRATIONS,migrationVersion}from'./wonderland-postgres';import{JuliusToolPostgresRepository}from'./julius-tool-postgres';import{JuliusPostgresRepository}from'./julius-postgres';import type{JuliusBrainEntry}from'../mission/julius';import{JuliusToolRecoveryPostgresRepository}from'./julius-tool-recovery-postgres';import{JuliusToolSettlementPostgresRepository}from'./julius-tool-settlement-postgres';import{JuliusContractPostgresRepository}from'./julius-contract-postgres';import{juliusTaskContractBindingDigest,reviseJuliusTaskContract,mayDispatchUnderContract,type JuliusTaskContract}from'../mission/julius';import{DockerJuliusSandboxAdapter}from'../workspace/julius-tools/docker-sandbox-adapter';import{DockerExecutorReceiptStore}from'../workspace/julius-tools/executor-receipt-store';import{enforceableCeilingFor}from'../workspace/julius-tools/workspace-provisioning';
const stable=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;const sha=(value:any)=>createHash('sha256').update(stable(value)).digest('hex');const run=promisify(execFile);
const postgresEnabled=process.env.JULIUS_REAL_INFRA==='1'||process.env.JULIUS_REAL_POSTGRES==='1',dockerEnabled=process.env.JULIUS_REAL_INFRA==='1'&&Boolean(process.env.JULIUS_SANDBOX_IMAGE),suite=postgresEnabled||dockerEnabled?describe:describe.todo,postgresTest=postgresEnabled?it:it.todo,dockerTest=dockerEnabled?it:it.todo;let pool:Pool;
suite('Julius real PostgreSQL and Docker infrastructure',()=>{beforeAll(async()=>{if(!postgresEnabled)return;pool=new Pool({connectionString:process.env.DATABASE_URL});await new TransactionalWonderlandDatabase(pool).migrate();await pool.query(`INSERT INTO relay_wonderland.players(player_id)VALUES('tenant');INSERT INTO relay_wonderland.projects(project_id)VALUES('project');INSERT INTO relay_wonderland.project_members(project_id,player_id,role)VALUES('project','tenant','OWNER');INSERT INTO relay_wonderland.agents(agent_id,owner_id)VALUES('agent','tenant');INSERT INTO relay_wonderland.card_versions(card_version_id,agent_id,owner_id,version,snapshot)VALUES('card-v','agent','tenant',1,'{}');INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot)VALUES('mission','project','READY','hash','{}');INSERT INTO relay_wonderland.execution_sessions(execution_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint)VALUES('execution','mission','project','tenant','agent','card-v','RUNNING','sandbox','{}','{}');INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)VALUES('run','mission','project','EXECUTING','1','card',1,0);INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal,worker_id,lease_owner,lease_generation,lease_expires_at)VALUES('task','run','CODING_AGENT','code','ACTIVE',1,'worker','scheduler',3,now()+interval '10 minutes');INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,role,task_type,state,ordinal,next_attempt_at)VALUES('claim-task','run','CODING_AGENT','code','RUNNABLE',2,now());INSERT INTO relay_wonderland.budget_reservations(reservation_id,execution_id,worker_id,operation_key,idempotency_key,state,tool_calls,runtime_ms,expires_at)VALUES('budget','execution','worker','tool','tool-inv','RESERVED',1,10000,now()+interval '10 minutes')`);});afterAll(async()=>pool?.end());
 postgresTest('applies every migration from empty and preserves the feature boundary',async()=>{const versions=await pool.query('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version');/* Derived, not pinned: this literal named the previous last migration and went stale the moment one was added, silently, because no workflow runs this file. */expect(versions.rows.map((row:any)=>String(row.version))).toEqual(WONDERLAND_MIGRATIONS.map(sql=>migrationVersion(sql)));expect((await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'julius_gauntlet%'`)).rows).toEqual([]);});
 postgresTest('uses real serialization, stale-lease fencing and SKIP LOCKED',async()=>{const repo=new JuliusToolPostgresRepository(pool),request={invocationId:'inv',idempotencyKey:'key',requestDigest:'a'.repeat(64),tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',workerId:'worker',leaseGeneration:3,policyRevision:'card',toolId:'shell.bash' as const,toolVersion:'1',mutationClass:'WORKSPACE' as const,requestedAt:new Date().toISOString()};const [a,b]=await Promise.all([repo.request(request),repo.request(request)]);expect([a.created,b.created].sort()).toEqual([false,true]);await expect(repo.request({...request,requestDigest:'b'.repeat(64)})).rejects.toThrow('tool_idempotency_digest_conflict');await expect(repo.request({...request,invocationId:'stale',idempotencyKey:'stale',leaseGeneration:2})).rejects.toThrow('tool_stale_authority');expect(await repo.authorize({invocationId:'inv',tenantId:'tenant',projectId:'project',requestDigest:'a'.repeat(64),policyRevision:'card',budgetReservationId:'budget',authorizedAt:new Date().toISOString()})).toBe(true);expect(await repo.claimDispatch({claimedBy:'dispatcher',now:new Date().toISOString(),claimedUntil:new Date(Date.now()+120000).toISOString(),limit:1})).toHaveLength(1);});
 postgresTest('proves concurrent task claims and stale fencing',async()=>{const repo=new JuliusPostgresRepository(pool),now=new Date().toISOString(),expires=new Date(Date.now()+60000).toISOString(),[a,b]=await Promise.all([repo.claimRunnable({owner:'a',now,leaseExpiresAt:expires,limit:1,projectId:'project'}),repo.claimRunnable({owner:'b',now,leaseExpiresAt:expires,limit:1,projectId:'project'})]);expect([...a,...b].filter(x=>x.taskId==='claim-task')).toHaveLength(1);});
 /**
  * THE PROJECT BRAIN'S WRITE PATH, ON A REAL DATABASE.
  *
  * Two of its properties cannot be proven anywhere else. `UNIQUE(run_id,revision)`
  * is a real constraint only in PostgreSQL, so "the store allocates the revision,
  * never the caller" is a claim the in-memory model is structurally unable to
  * test. And the CHECK on `entry_kind` is what would have rejected OBJECTIVE,
  * REQUIREMENT and EVIDENCE — precisely the failure `brainKindToStored` exists to
  * prevent, and precisely the failure an in-memory suite would never see, because
  * a Map has no constraints. This is the case that would have caught it inside a
  * paid mission instead.
  */
 postgresTest('allocates Project Brain revisions atomically and carries every domain kind',async()=>{
  const repo=new JuliusPostgresRepository(pool),at=new Date().toISOString();
  const counter=async()=>String((await pool.query(`SELECT project_brain_revision AS r FROM relay_wonderland.julius_runs WHERE run_id='run'`)).rows[0].r);
  const append=(entryId:string,kind:JuliusBrainEntry['kind'],safeText:string,taskId:string|null='task')=>repo.appendBrainEntry({runId:'run',projectId:'project',taskId,workerId:'worker',entryId,kind,safeText,evidenceIds:[],occurredAt:at});
  /* Concurrent appends to ONE run. The counter UPDATE takes that run row's lock, so these serialise and land on distinct revisions instead of racing to the same one and violating the unique index. */
  expect(await Promise.all([append('brain-a','DECISION','a'),append('brain-b','FINDING','b')])).toEqual([true,true]);
  const afterTwo=await counter();
  /* A replay writes nothing AND leaves the counter alone: the NOT EXISTS guard is on the UPDATE, not only on the INSERT. */
  expect(await append('brain-a','DECISION','a')).toBe(false);
  expect(await counter(),'a refused replay must not advance the revision').toBe(afterTwo);
  /* The three domain kinds the CHECK constraint refuses are carried, not rejected. */
  expect(await Promise.all([append('brain-objective','OBJECTIVE','o',null),append('brain-requirement','REQUIREMENT','r'),append('brain-evidence','EVIDENCE','e')])).toEqual([true,true,true]);
  const rows=(await pool.query(`SELECT entry_id,entry_kind,revision,task_id FROM relay_wonderland.julius_brain_entries WHERE run_id='run' ORDER BY revision`)).rows as any[];
  expect(rows).toHaveLength(5);
  expect(new Set(rows.map(row=>Number(row.revision))).size,'every revision distinct').toBe(5);
  expect(Object.fromEntries(rows.map(row=>[row.entry_id,row.entry_kind]))).toMatchObject({'brain-a':'DECISION','brain-b':'FINDING','brain-objective':'CONSTRAINT','brain-requirement':'ACCEPTANCE_UPDATE','brain-evidence':'ARTIFACT'});
  expect(rows.find(row=>row.entry_id==='brain-objective').task_id,'run-level knowledge names no task').toBeNull();
  /* And an unknown run writes nothing rather than inventing one. */
  expect(await repo.appendBrainEntry({runId:'no-such-run',projectId:'project',taskId:null,workerId:'worker',entryId:'brain-nowhere',kind:'DECISION',safeText:'x',evidenceIds:[],occurredAt:at})).toBe(false);
 });
 dockerTest('recovers executor-owned receipts after the orchestrator dies and settles exactly once',async()=>{const image=process.env.JULIUS_SANDBOX_IMAGE!,dockerBinary=process.env.DOCKER_BINARY??'/usr/bin/docker',workspace=await mkdtemp(join(tmpdir(),'julius-workspace-')),receiptRoot=await mkdtemp(join(tmpdir(),'julius-receipts-'));await chmod(workspace,0o777);await writeFile(join(workspace,'fixture.txt'),'safe');const store=new JuliusToolRecoveryPostgresRepository(pool),receipts=new DockerExecutorReceiptStore(receiptRoot),identity={sandboxId:'sandbox',invocationId:'inv',tenantId:'tenant',projectId:'project',runId:'run',taskId:'task',leaseGeneration:3,policyRevision:'card',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()},limits={cpuCount:1,memoryBytes:134217728,pids:32,openFiles:128,workspaceBytes:await enforceableCeilingFor(workspace),outputBytes:32768,wallClockMs:10000,concurrentProcesses:4};const crashed=new DockerJuliusSandboxAdapter({image,enabled:true,dockerBinary,allowedWorkspaceRoot:workspace,faultAfterExecutor:true,durability:{store,receipts,runtimeInstanceId:'runtime-before-crash',executorVersion:'docker-executor.v1'}});await crashed.createSandbox({identity,limits,policy:{readWorkspace:true,mutateWorkspace:true,executeProcess:true,network:'DENY',allowedTools:['shell.bash']}});await crashed.prepareWorkspace({sandboxId:'sandbox',sourceRef:workspace,expectedLeaseGeneration:3});const request={invocationId:'inv',runId:'run',taskId:'task',projectId:'project',workerId:'worker',toolId:'shell.bash' as const,toolVersion:'1',arguments:{command:`test "$(id -u)" = 65532 && printf 'effect\\n' >> effect.log && test ! -S /var/run/docker.sock && test -z "$SSH_AUTH_SOCK" && node -e "fetch('http://example.com').then(()=>process.exit(2)).catch(()=>process.exit(0))" && { nohup sh -c 'sleep 1; echo escaped > late-effect.log' >/dev/null 2>&1 & }`},cwd:'.',idempotencyKey:'shell',timeoutMs:5000,expectedMutation:'WORKSPACE' as const};await expect(crashed.executeTool({sandboxId:'sandbox',expectedLeaseGeneration:3,dispatchGeneration:1,requestDigest:'a'.repeat(64),executionTokenHash:'b'.repeat(64),effectClassification:'NON_IDEMPOTENT_MUTATION',request})).rejects.toThrow('injected_after_executor_effect:0:terminal:');const executorProof=await receipts.consume('b'.repeat(64),'sandbox');expect(executorProof?.receipt.result,await Promise.all(['executor.stage','stderr.tmp','stderr'].map(name=>readFile(join(receipts.directory('b'.repeat(64),'sandbox'),name),'utf8').catch(error=>String(error)))).then(parts=>parts.join(' | '))).toMatchObject({status:'SUCCEEDED',exitCode:0});expect(await readFile(join(workspace,'effect.log'),'utf8')).toBe('effect\n');await new Promise(resolve=>setTimeout(resolve,1200));await expect(readFile(join(workspace,'late-effect.log'),'utf8')).rejects.toThrow();let settlementCommand:any;const premature=new DockerJuliusSandboxAdapter({image,enabled:true,dockerBinary,allowedWorkspaceRoot:workspace,durability:{store,receipts,runtimeInstanceId:'premature-runtime',executorVersion:'docker-executor.v1'}});expect((await premature.reconcileSandboxes()).recovered).toBe(0);await pool.query(`UPDATE relay_wonderland.julius_sandboxes SET owner_expires_at=clock_timestamp()-interval '1 second' WHERE sandbox_id='sandbox'`);const restarted=new DockerJuliusSandboxAdapter({image,enabled:true,dockerBinary,allowedWorkspaceRoot:workspace,durability:{store,receipts,runtimeInstanceId:'runtime-after-crash',executorVersion:'docker-executor.v1',settleRecovered:async consumed=>{const result=consumed.receipt.result!;settlementCommand={settlementId:'settlement-inv-1',invocationId:'inv',dispatchGeneration:1,resultDigest:sha(result),result,artifacts:[],evidence:[{evidenceId:'execution-evidence',type:'COMMAND_EXECUTION',integrityHash:'e'.repeat(64),facts:{safeSummary:'Executor effect and receipt verified.'}}],taskOutcome:null,occurredAt:new Date().toISOString()};await new JuliusToolSettlementPostgresRepository(pool).settle(settlementCommand);}}});const reconciliation=await restarted.reconcileSandboxes();expect(reconciliation.recovered).toBe(1);await expect(crashed.executeTool({sandboxId:'sandbox',expectedLeaseGeneration:3,dispatchGeneration:1,requestDigest:'a'.repeat(64),executionTokenHash:'b'.repeat(64),effectClassification:'NON_IDEMPOTENT_MUTATION',request})).rejects.toThrow('sandbox_execution_authority_lost');expect(await readFile(join(workspace,'effect.log'),'utf8')).toBe('effect\n');const settlement=new JuliusToolSettlementPostgresRepository(pool);expect((await settlement.settle(settlementCommand)).created).toBe(false);await expect(settlement.settle({...settlementCommand,resultDigest:'c'.repeat(64)})).rejects.toThrow();const truth=await pool.query(`SELECT i.state,b.state budget,t.state task,(SELECT count(*) FROM relay_wonderland.julius_tool_settlements WHERE invocation_id='inv') settlements,(SELECT count(*) FROM relay_wonderland.julius_evidence WHERE evidence_id='execution-evidence') evidence FROM relay_wonderland.julius_tool_invocations i JOIN relay_wonderland.budget_reservations b ON b.reservation_id=i.budget_reservation_id JOIN relay_wonderland.julius_tasks t ON t.task_id=i.task_id WHERE i.invocation_id='inv'`);expect(truth.rows[0]).toMatchObject({state:'SUCCEEDED',budget:'COMMITTED',task:'ACTIVE',settlements:'1',evidence:'1'});expect(await restarted.destroySandbox({sandboxId:'sandbox',expectedLeaseGeneration:3,reason:'test'})).toBe(true);},60000);
 dockerTest('quarantines an unowned Julius-labeled container',async()=>{const image=process.env.JULIUS_SANDBOX_IMAGE!,dockerBinary=process.env.DOCKER_BINARY??'/usr/bin/docker';const {stdout}=await run(dockerBinary,['create','--label','julius.sandbox=orphan-sandbox',image,'sleep','infinity']);const id=stdout.trim();const adapter=new DockerJuliusSandboxAdapter({image,enabled:true,dockerBinary,durability:{store:new JuliusToolRecoveryPostgresRepository(pool),receipts:new DockerExecutorReceiptStore(await mkdtemp(join(tmpdir(),'orphan-receipts-'))),runtimeInstanceId:'orphan-reaper',executorVersion:'docker-executor.v1'}});expect((await adapter.reconcileSandboxes()).quarantined).toBeGreaterThanOrEqual(1);await expect(run(dockerBinary,['inspect',id])).rejects.toThrow();},30000);

 /**
  * THE TASK/SPRINT CONTRACT, ON A REAL DATABASE.
  *
  * Three of its properties are claims about PostgreSQL and cannot be proven by
  * the in-memory model, which is a program that agrees with itself:
  *
  *   `julius_task_contract_single_lock` is a PARTIAL UNIQUE INDEX. "At most one
  *   locked revision" is enforced by the database or it is enforced by nothing —
  *   two ticks that both read "nothing locked yet" and both write are exactly
  *   the case an application check cannot decide.
  *
  *   `julius_task_contract_binding` is a CHECK. A draft carrying a binding
  *   digest is the dangerous shape — a dispatch could cite a binding no
  *   evaluator accepted — and the model can only refuse to construct one.
  *
  *   `safe_terms` is JSONB. The digest is computed over the terms and re-derived
  *   on read, so this is where "a document survives a round trip through the
  *   storage engine without changing what it hashes to" is actually tested,
  *   rather than assumed by a model that never serialises anything.
  */
 postgresTest('holds the task contract lock, the binding CHECK and a jsonb round trip',async()=>{
  const repo=new JuliusContractPostgresRepository(pool);
  const draft:JuliusTaskContract={contractId:'contract-real',runId:'run',taskId:'task',missionContractRevision:1,contractRevision:1,
   objective:'Add a deterministic slug helper and prove it.',responsibilityBoundary:'Implementation and its unit tests only.',
   requiredInputs:['the locked plan'],expectedOutputs:['a unified diff'],inScope:['src/slug.ts'],outOfScope:['package.json'],
   blockingAcceptanceCriteria:[{criterionId:'AC-1',statement:'slug("A  B") === "a-b"',requiredEvidenceTypes:['TEST']}],
   requiredEvidence:['TEST'],requiredChecks:['npm test -- src/slug.test.ts'],permittedPaths:['src/slug.ts'],prohibitedActions:[],
   dependencyTaskIds:['run:plan'],reviewCriteria:['Does the diff satisfy AC-1?'],failureConditions:['the suite does not pass'],
   repairRules:[],budget:{ceilingUsdMicros:5_000_000,maxRepairRounds:3},stoppingCondition:'Stop when the suite passes.',
   state:'DRAFT',bindingDigest:null,lockedAt:null,lockedByEvaluatorId:null};
  const at=new Date().toISOString();

  expect(await repo.putTaskContract({projectId:'project',contract:draft,occurredAt:at})).toBe(true);
  // A REPLAY IS A NO-OP; different terms at a stored revision are refused.
  expect(await repo.putTaskContract({projectId:'project',contract:draft,occurredAt:at})).toBe(false);
  await expect(repo.putTaskContract({projectId:'project',contract:{...draft,inScope:['src/everything.ts']},occurredAt:at}))
   .rejects.toThrow('julius_task_contract_revision_conflict');

  // THE JSONB ROUND TRIP. The digest of what came back must equal the digest of
  // what went in, or every binding comparison downstream compares the wrong thing.
  const readBack=await repo.loadTaskContract({projectId:'project',taskId:'task'});
  expect(juliusTaskContractBindingDigest(readBack!)).toBe(juliusTaskContractBindingDigest(draft));
  expect(readBack).toMatchObject({state:'DRAFT',contractRevision:1,bindingDigest:null,lockedAt:null});

  // TWO CONCURRENT LOCKS OF ONE REVISION: the index decides, and exactly one wins.
  const digest=juliusTaskContractBindingDigest(draft);
  const lockArgs={projectId:'project',contractId:'contract-real',contractRevision:1,bindingDigest:digest,lockedAt:at,evaluatorId:'evaluator-1'};
  const [a,b]=await Promise.all([repo.lockTaskContract(lockArgs),repo.lockTaskContract(lockArgs)]);
  expect([a.locked,b.locked].sort()).toEqual([false,true]);
  expect((await pool.query(`SELECT count(*) c FROM relay_wonderland.julius_task_contracts WHERE contract_id='contract-real' AND state='LOCKED'`)).rows[0].c).toBe('1');
  const locked=await repo.loadTaskContract({projectId:'project',taskId:'task'});
  expect(mayDispatchUnderContract(locked).permitted).toBe(true);

  // LOCKING TERMS TO ANOTHER DOCUMENT'S DIGEST IS REFUSED.
  const revised=reviseJuliusTaskContract({contract:locked!,proposal:{outOfScope:['package.json','README.md']}});
  if(revised.outcome!=='REVISED')throw new Error('unreachable');
  expect(await repo.putTaskContract({projectId:'project',contract:revised.contract,occurredAt:at})).toBe(true);
  expect(await repo.lockTaskContract({projectId:'project',contractId:'contract-real',contractRevision:2,bindingDigest:digest,lockedAt:at,evaluatorId:'evaluator-2'}))
   .toMatchObject({locked:false,reasonCode:'binding_digest_mismatch'});

  // LOCKING REVISION 2 SUPERSEDES REVISION 1 IN ONE WRITE, and the superseded
  // row keeps the digest work was dispatched under.
  const promoted=await repo.lockTaskContract({projectId:'project',contractId:'contract-real',contractRevision:2,bindingDigest:juliusTaskContractBindingDigest(revised.contract),lockedAt:at,evaluatorId:'evaluator-2'});
  expect(promoted).toMatchObject({locked:true,supersededRevision:1});
  const rows=await repo.taskContractRevisions({projectId:'project',taskId:'task'});
  expect(rows.map(row=>[row.contractRevision,row.state])).toEqual([[1,'SUPERSEDED'],[2,'LOCKED']]);
  expect(rows[0]!.bindingDigest).not.toBeNull();
  // AN AGREEMENT DOES NOT ROLL BACK.
  expect(await repo.lockTaskContract({projectId:'project',contractId:'contract-real',contractRevision:1,bindingDigest:digest,lockedAt:at,evaluatorId:'evaluator-3'}))
   .toMatchObject({locked:false,reasonCode:'newer_revision_is_locked',lockedRevision:2});

  // THE DATABASE REFUSES A DRAFT CARRYING A BINDING, which is the shape a
  // downstream dispatch could cite without any evaluator having accepted it.
  await expect(pool.query(`INSERT INTO relay_wonderland.julius_task_contracts(contract_id,contract_revision,run_id,project_id,task_id,mission_contract_revision,state,safe_terms,binding_digest,locked_at,locked_by_evaluator_id,created_at) VALUES('contract-forged',1,'run','project','task',1,'DRAFT','{}'::jsonb,'sha256:0',now(),'nobody',now())`))
   .rejects.toThrow(/julius_task_contract_binding/u);
  // AND A LOCKED ROW WITH NO BINDING, which would be a lock nobody could check.
  await expect(pool.query(`INSERT INTO relay_wonderland.julius_task_contracts(contract_id,contract_revision,run_id,project_id,task_id,mission_contract_revision,state,safe_terms,created_at) VALUES('contract-bare',1,'run','project','task',1,'LOCKED','{}'::jsonb,now())`))
   .rejects.toThrow(/julius_task_contract_binding/u);
  // ONE CONTRACT PER TASK: a second contract_id collides at revision 1.
  await expect(pool.query(`INSERT INTO relay_wonderland.julius_task_contracts(contract_id,contract_revision,run_id,project_id,task_id,mission_contract_revision,state,safe_terms,created_at) VALUES('contract-second',1,'run','project','task',1,'DRAFT','{}'::jsonb,now())`))
   .rejects.toThrow(/julius_task_contract_one_per_task/u);

  // A LOCKED ROW WHOSE TERMS NO LONGER HASH TO ITS BINDING IS REFUSED ON READ.
  // Written straight past this code, exactly as an outside edit would be.
  await pool.query(`UPDATE relay_wonderland.julius_task_contracts SET safe_terms=jsonb_set(safe_terms,'{objective}','"something else entirely"') WHERE contract_id='contract-real' AND contract_revision=2`);
  expect(await repo.loadTaskContract({projectId:'project',taskId:'task'})).toBeNull();
  expect(mayDispatchUnderContract(await repo.loadTaskContract({projectId:'project',taskId:'task'})))
   .toEqual({permitted:false,reasonCode:'contract_absent'});
 },30000);
});
