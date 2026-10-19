import {describe,expect,it} from 'vitest';
import type {Pool} from 'pg';
import {JuliusToolRecoveryPostgresRepository} from './julius-tool-recovery-postgres';

class StubPool {commands:string[]=[];async query(sql:string){this.commands.push(sql);return{rowCount:0,rows:[]};}}

describe('durable Julius tool recovery repository',()=>{
 it('atomically claims sandbox reconciliation instead of returning an unlocked selection',async()=>{const pool=new StubPool();await new JuliusToolRecoveryPostgresRepository(pool as unknown as Pool).listRecoverable({runtimeInstanceId:'worker-2',now:'2026-08-30T00:00:00Z',limit:10});expect(pool.commands[0]).toContain("UPDATE relay_wonderland.julius_sandboxes");expect(pool.commands[0]).toContain("state='RECONCILING'");expect(pool.commands[0]).toContain('SKIP LOCKED');});
 it('claims expired invocation recovery with a durable claim deadline',async()=>{const pool=new StubPool();await new JuliusToolRecoveryPostgresRepository(pool as unknown as Pool).claimInvocationReconciliation({runtimeInstanceId:'worker-2',now:'2026-08-30T00:00:00Z',limit:10});expect(pool.commands[0]).toContain("recovery_claimed_until=clock_timestamp()+interval '30 seconds'");expect(pool.commands[0]).toContain("i.state IN('DISPATCHING','RUNNING')");});
});
