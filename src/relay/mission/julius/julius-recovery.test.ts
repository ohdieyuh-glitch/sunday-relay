import { describe, expect, it } from 'vitest';
import { planJuliusRecovery, resumableJuliusState } from './julius-recovery';

const candidate = { runId:'run', projectId:'project', runState:'EXECUTING' as const, taskId:'task', attempt:1, maxRetries:2, leaseGeneration:4 };
describe('Julius recovery planning', () => {
  it('requeues an expired lease while retries remain', () => expect(planJuliusRecovery(candidate)).toEqual({ action:'REQUEUE', reasonCode:'LEASE_EXPIRED', runId:'run', taskId:'task', expectedLeaseGeneration:4 }));
  it('fails exhausted work and cancels late work for cancelled runs', () => {
    expect(planJuliusRecovery({ ...candidate, attempt:3 }).action).toBe('FAIL_TASK');
    expect(planJuliusRecovery({ ...candidate, runState:'CANCELLED' }).action).toBe('CANCEL_TASK');
  });
  it('recognizes restart-safe in-flight states without reviving terminal runs', () => {
    for (const state of ['EXECUTING','WAITING','REVIEWING','REPAIRING','VERIFYING'] as const) expect(resumableJuliusState(state)).toBe(true);
    expect(resumableJuliusState('COMPLETED')).toBe(false); expect(resumableJuliusState('CANCELLED')).toBe(false);
  });
});
