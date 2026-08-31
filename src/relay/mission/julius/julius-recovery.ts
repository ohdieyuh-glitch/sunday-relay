import type { JuliusMissionState } from './julius-runtime';

export interface JuliusRecoveryCandidate {
  readonly runId: string;
  readonly projectId: string;
  readonly runState: JuliusMissionState;
  readonly taskId: string;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly leaseGeneration: number;
}

export interface JuliusRecoveryAction {
  readonly action: 'REQUEUE' | 'FAIL_TASK' | 'CANCEL_TASK' | 'RESUME_RUN';
  readonly reasonCode: 'LEASE_EXPIRED' | 'RETRIES_EXHAUSTED' | 'RUN_CANCELLED' | 'RUN_RESUMABLE';
  readonly runId: string;
  readonly taskId: string | null;
  readonly expectedLeaseGeneration: number | null;
}

/** Deterministic recovery plan derived exclusively from durable state. */
export function planJuliusRecovery(candidate: JuliusRecoveryCandidate): JuliusRecoveryAction {
  if (candidate.runState === 'CANCELLED') return { action: 'CANCEL_TASK', reasonCode: 'RUN_CANCELLED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  if (candidate.attempt >= candidate.maxRetries + 1) return { action: 'FAIL_TASK', reasonCode: 'RETRIES_EXHAUSTED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  return { action: 'REQUEUE', reasonCode: 'LEASE_EXPIRED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
}

export function resumableJuliusState(state: JuliusMissionState): boolean {
  return ['EXECUTING', 'WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING'].includes(state);
}
