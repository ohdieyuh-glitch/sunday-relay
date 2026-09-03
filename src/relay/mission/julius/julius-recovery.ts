import type { JuliusMissionState } from './julius-runtime';

export interface JuliusRecoveryCandidate {
  readonly runId: string;
  readonly projectId: string;
  readonly runState: JuliusMissionState;
  readonly taskId: string;
  /** EXECUTION admissions this task has consumed — not claims. */
  readonly attempt: number;
  readonly maxRetries: number;
  readonly leaseGeneration: number;
  /**
   * How many times recovery has already requeued this task from an expired
   * lease. Additive: omitted behaves exactly as before.
   */
  readonly recoveries?: number;
  /** The ceiling for {@link recoveries}. Omitted means {@link MAX_TASK_RECOVERIES}. */
  readonly maxRecoveries?: number;
}

export interface JuliusRecoveryAction {
  readonly action: 'REQUEUE' | 'FAIL_TASK' | 'CANCEL_TASK' | 'RESUME_RUN';
  readonly reasonCode: 'LEASE_EXPIRED' | 'RETRIES_EXHAUSTED' | 'RECOVERY_LIMIT_REACHED' | 'RUN_CANCELLED' | 'RUN_RESUMABLE';
  readonly runId: string;
  readonly taskId: string | null;
  readonly expectedLeaseGeneration: number | null;
}

/**
 * THE CEILING ON RECOVERY ITSELF, which the execution-attempt counter cannot
 * express.
 *
 * `attempt` counts EXECUTION ADMISSIONS. A task that is claimed, crashes
 * before it is ever admitted, and is recovered leaves that number untouched —
 * correctly, since no worker ran — so recovery bounded only by `attempt` would
 * requeue such a task forever. This is the bound for that loop: how many times
 * recovery has reclaimed this task's expired lease, whatever came of it.
 *
 * The two ceilings are deliberately the same number and deliberately NOT the
 * same counter. Sharing one counter is what made a scheduling hand-back spend
 * a provider retry.
 */
export const MAX_TASK_RECOVERIES = 3;

/** Deterministic recovery plan derived exclusively from durable state. */
export function planJuliusRecovery(candidate: JuliusRecoveryCandidate): JuliusRecoveryAction {
  if (candidate.runState === 'CANCELLED') return { action: 'CANCEL_TASK', reasonCode: 'RUN_CANCELLED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  if (candidate.attempt >= candidate.maxRetries + 1) return { action: 'FAIL_TASK', reasonCode: 'RETRIES_EXHAUSTED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  // The recovery ceiling is checked SECOND so an execution-exhausted task keeps
  // reporting RETRIES_EXHAUSTED, which is the cause an operator acts on; a task
  // that never got to execute reports the loop that actually stopped it.
  if ((candidate.recoveries ?? 0) >= (candidate.maxRecoveries ?? MAX_TASK_RECOVERIES)) {
    return { action: 'FAIL_TASK', reasonCode: 'RECOVERY_LIMIT_REACHED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  }
  return { action: 'REQUEUE', reasonCode: 'LEASE_EXPIRED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
}

export function resumableJuliusState(state: JuliusMissionState): boolean {
  return ['EXECUTING', 'WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING'].includes(state);
}
