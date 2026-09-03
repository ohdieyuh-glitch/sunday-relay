import{describe,expect,it}from'vitest';import{JuliusExecutionCoordinator,JuliusProviderHealthRegistry,JuliusProviderRouter,JuliusWorkerRegistry,type JuliusCardPolicy,type JuliusExecutionPorts,type JuliusProviderAdapter}from'.';
const policy:JuliusCardPolicy={revision:'card',autonomy:'AUTONOMOUS',allowedProviders:['provider'],capabilities:['code'],network:false,filesystemMutation:true,fallback:false,automaticRetry:true,subagents:{allowed:false,maxDepth:0,maxActive:0,maxTotal:0},iterativeReview:{allowed:false,maxRounds:0},concurrency:1,approvals:[]};
const claim={runId:'run',projectId:'project',taskId:'task',leaseOwner:'scheduler',leaseGeneration:1,capability:'code',contextId:'context',task:{taskId:'task',missionId:'mission',parentTaskId:null,dependencyIds:[],requiredEvidenceTypes:['TEST' as const],taskType:'implementation',role:'CODING_AGENT' as const,ordinal:0,state:'ACTIVE' as const}};
const resources={usdMicros:10,inputTokens:10,outputTokens:10,toolCalls:1,runtimeMs:100};
const harness=(adapter:JuliusProviderAdapter,overrides:Partial<JuliusExecutionPorts>={})=>{const order:string[]=[];const registry=new JuliusWorkerRegistry();registry.register({workerId:'worker',role:'CODING_AGENT',adapterId:'adapter',providerId:'provider',capabilities:['code'],taskTypes:['implementation'],concurrencyLimit:1,timeoutMs:100,maxRetries:2,status:'AVAILABLE'});const ports:JuliusExecutionPorts={async reserve(){order.push('reserve');return{reservationId:'reservation',state:'RESERVED',denialReason:null}},async commit(){order.push('commit')},async release(){order.push('release')},async persistEvidence(){order.push('evidence')},async acceptResult(){order.push('result');return{duplicate:false}},async recordEvent(input){order.push(input.type)},...overrides};return{order,coordinator:new JuliusExecutionCoordinator(new JuliusProviderRouter(registry,new Map([['adapter',adapter]]),new JuliusProviderHealthRegistry()),ports)};};
const success:JuliusProviderAdapter={adapterId:'adapter',async dispatch(){return{workerId:'worker',providerId:'provider',status:'SUCCEEDED',safeSummary:'done',evidence:[{type:'TEST',status:'PASSED',safeSummary:'tests pass'}],usage:{usdMicros:8}}}};
const request={claim,policy,role:'CODING_AGENT' as const,taskType:'implementation',capability:'code',resources,operationId:'operation'};
describe('authoritative Julius execution coordinator',()=>{it('enforces selection and reservation before dispatch, then evidence, result, and settlement',async()=>{const h=harness(success);expect(await h.coordinator.execute(request)).toMatchObject({status:'COMPLETED',workerId:'worker'});expect(h.order.indexOf('reserve')).toBeLessThan(h.order.indexOf('worker.dispatched'));expect(h.order.indexOf('evidence')).toBeLessThan(h.order.indexOf('result'));expect(h.order.indexOf('result')).toBeLessThan(h.order.indexOf('commit'));});it('never dispatches when policy or budget denies',async()=>{const adapter={...success,async dispatch(){throw new Error('must not dispatch')}};const policyDenied=harness(adapter);expect((await policyDenied.coordinator.execute({...request,policy:{...policy,allowedProviders:[]}})).status).toBe('DENIED');expect(policyDenied.order).not.toContain('reserve');const budget=harness(adapter,{async reserve(){return{reservationId:'denied',state:'DENIED',denialReason:'usd'}}});expect(await budget.coordinator.execute(request)).toMatchObject({status:'DENIED',code:'BUDGET_DENIED'});expect(budget.order).not.toContain('worker.dispatched');});it('releases reservations and retries only transient policy-authorized failures',async()=>{const timeout:JuliusProviderAdapter={adapterId:'adapter',async dispatch(){throw{code:'TIMEOUT'}}};const h=harness(timeout);expect(await h.coordinator.execute(request)).toEqual({status:'RETRY',code:'TIMEOUT',failureClass:null});expect(h.order).toContain('release');expect(h.order).toContain('retry.scheduled');const auth=harness({adapterId:'adapter',async dispatch(){throw{code:401}}});expect(await auth.coordinator.execute(request)).toEqual({status:'FAILED',code:'AUTH_CONFIGURATION',failureClass:null});expect(auth.order).not.toContain('retry.scheduled');});it('releases budget when evidence persistence or provider validation fails',async()=>{const malformed=harness({adapterId:'adapter',async dispatch(){return{workerId:'forged',providerId:'provider',status:'SUCCEEDED',safeSummary:'done',evidence:[],usage:{}}}});expect(await malformed.coordinator.execute(request)).toMatchObject({status:'FAILED',code:'INVALID_REQUEST'});expect(malformed.order).toContain('release');const persistence=harness(success,{async persistEvidence(){throw new Error('database unavailable')}});expect((await persistence.coordinator.execute(request)).status).toBe('FAILED');expect(persistence.order).toContain('release');expect(persistence.order).not.toContain('result');});
/**
 * A THROW THAT IS NOT A DISPATCH ERROR MUST STILL NAME A CAUSE.
 *
 * `select` models every routing outcome it knows as a JuliusDispatchError, but
 * this catch used to CAST rather than check. Any other throw — a programming
 * error in the registry or in the C.A.R.D. evaluation — read `.code`,
 * `.retryable` and `.failureClass` off an object with none, and the port
 * stringifies a non-primitive, so the row that ENDS the task carried the
 * literal `undefined` three times in the one artifact built to explain a paid
 * failure. The exception text carries a secret here to prove that normalizing
 * does not smuggle one in either.
 */
it('normalizes a non-dispatch throw from selection rather than writing "undefined" facts',async()=>{const rows:Record<string,unknown>[]=[];const registry=new JuliusWorkerRegistry();registry.register({workerId:'worker',role:'CODING_AGENT',adapterId:'adapter',providerId:'provider',capabilities:['code'],taskTypes:['implementation'],concurrencyLimit:1,timeoutMs:100,maxRetries:2,status:'AVAILABLE'});const router=new JuliusProviderRouter(registry,new Map([['adapter',success]]),new JuliusProviderHealthRegistry());(router as unknown as{select:()=>never}).select=()=>{throw new Error('Authorization: Bearer FAKESECRET123456789')};const ports:JuliusExecutionPorts={async reserve(){return{reservationId:'reservation',state:'RESERVED',denialReason:null}},async commit(){},async release(){},async persistEvidence(){},async acceptResult(){return{duplicate:false}},async recordEvent(input){rows.push({type:input.type,taskId:input.taskId,...input.payload})}};
  expect(await new JuliusExecutionCoordinator(router,ports).execute(request)).toEqual({status:'FAILED',code:'WORKER_EXECUTION_FAILURE',failureClass:null});
  const row=rows.at(-1)!;
  expect(row.type,'the selection failure ends the task').toBe('task.failed');
  expect(row.code,'a real code, never the string "undefined"').toBe('WORKER_EXECUTION_FAILURE');
  expect(row.errorRetryable,'a real boolean, never the string "undefined"').toBe(false);
  expect(row.failureClass,'unknown is null, not "undefined"').toBeNull();
  expect(JSON.stringify(rows),'and no part of the exception text reaches the durable row').not.toContain('FAKESECRET123456789');
  /* A SELECTION FAILURE IS NEVER RETRYABLE, which is the property the choice of
   * narrowing is FOR. Routing this through `normalizeProviderError` — which
   * reads a provider's `.code` — classifies the same throw as a retryable
   * TIMEOUT and writes `errorRetryable: true` beside a status that ENDS the
   * task. `select` contacts nobody, so there is no transient condition to
   * report. `{code:'TIMEOUT'}` is one of NINE `.code` values on which the two
   * narrowings differ — 429, RATE_LIMIT, ETIMEDOUT, TIMEOUT, 401, 403, AUTH,
   * CONFIGURATION, ABORT_ERR — and one of the four that also flip
   * `errorRetryable` to true, which is the half that does the damage. */
  const coded:Record<string,unknown>[]=[];
  const codedRouter=new JuliusProviderRouter(registry,new Map([['adapter',success]]),new JuliusProviderHealthRegistry());
  (codedRouter as unknown as{select:()=>never}).select=()=>{throw{code:'TIMEOUT'}};
  const outcome=await new JuliusExecutionCoordinator(codedRouter,{...ports,async recordEvent(input){coded.push({type:input.type,...input.payload})}}).execute(request);
  expect(outcome,'a throw from selection is a programming error, not a transient provider condition').toEqual({status:'FAILED',code:'WORKER_EXECUTION_FAILURE',failureClass:null});
  expect(coded.at(-1)!.errorRetryable,'never retryable-true on the row that ends the task').toBe(false);});});
