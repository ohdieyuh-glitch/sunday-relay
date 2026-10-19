import{describe,expect,it}from'vitest';import{advanceGauntlet,type GauntletRun}from'./gauntlet-machine';

/**
 * #172'S STOPPING RULES, UNCHANGED, IN THEIR NEW HOME.
 *
 * This is the inherited `bounded gauntlet` suite moved out of
 * `mission/julius/` with its assertions untouched. The behaviour it pins —
 * explicit scheduled rounds rather than recursion, and halting on retry, spend
 * and stale-writer bounds — is exactly what it pinned before; only the module
 * it belongs to changed.
 */
const gauntlet=():GauntletRun=>({gauntletId:'g',runId:'run',taskId:'task',limits:{maxRounds:2,maxRetries:1,maxDurationMs:100,maxUsdMicros:100},state:'READY',round:0,retries:0,usedDurationMs:0,usedUsdMicros:0,haltReason:null,version:1});
describe('bounded gauntlet',()=>{it('persists explicit scheduled rounds rather than recursing',()=>{let run=advanceGauntlet(gauntlet(),{expectedVersion:1,action:'START',durationMs:1,usdMicros:1});expect(run).toMatchObject({state:'RUNNING',round:1});run=advanceGauntlet(run,{expectedVersion:2,action:'VERIFY_FAIL',durationMs:1,usdMicros:1});expect(run.state).toBe('REPAIRING');run=advanceGauntlet(run,{expectedVersion:3,action:'REPAIR_COMPLETE',durationMs:0,usdMicros:0});expect(run.state).toBe('READY');});it('halts on retry, spend, and stale-writer bounds',()=>{const running=advanceGauntlet(gauntlet(),{expectedVersion:1,action:'START',durationMs:0,usdMicros:0});const repairing=advanceGauntlet(running,{expectedVersion:2,action:'VERIFY_FAIL',durationMs:0,usdMicros:0});const ready=advanceGauntlet(repairing,{expectedVersion:3,action:'REPAIR_COMPLETE',durationMs:0,usdMicros:0});const again=advanceGauntlet(ready,{expectedVersion:4,action:'START',durationMs:0,usdMicros:0});expect(advanceGauntlet(again,{expectedVersion:5,action:'VERIFY_FAIL',durationMs:0,usdMicros:0}).haltReason).toBe('retry_limit');expect(advanceGauntlet(running,{expectedVersion:2,action:'VERIFY_PASS',durationMs:0,usdMicros:101}).haltReason).toBe('budget_limit');expect(()=>advanceGauntlet(running,{expectedVersion:1,action:'VERIFY_PASS',durationMs:0,usdMicros:0})).toThrow('stale_gauntlet_version');});});
