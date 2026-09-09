/**
 * THE DURABLE JULIUS RUNTIME STORE, COMPOSED FROM THE REAL REPOSITORIES.
 *
 * This is the production twin of the composition proven shape-complete by
 * `src/relay/persistence/julius-store-conformance.test.ts` — the same
 * repositories bound to the same ports, with a live `Pool` instead of a null
 * one. If a port method is added without a repository implementing it, the
 * conformance test fails before this file can compile against the barrel.
 *
 * PostgreSQL is authoritative for everything here. Nothing in this module
 * falls back to memory: a deployment without a database does not get a
 * quieter store, it gets no store, and composition fails closed upstream.
 */

import type { Pool } from 'pg';
import type { JuliusRecoveryDriver, JuliusRuntimeStore } from '../../src/relay/mission/julius';
import { JuliusPostgresRepository } from '../../src/relay/persistence/julius-postgres';
import { JuliusRecoveryPostgresRepository } from '../../src/relay/persistence/julius-recovery-postgres';
import { JuliusContextPostgresRepository } from '../../src/relay/persistence/julius-context-postgres';
import { JuliusReadPostgresRepository } from '../../src/relay/persistence/julius-read-postgres';
import { JuliusVerificationPostgresRepository } from '../../src/relay/persistence/julius-verification-postgres';
import { JuliusEventPostgresRepository } from '../../src/relay/persistence/julius-event-postgres';
import { JuliusTrajectoryPostgresRepository } from '../../src/relay/persistence/julius-trajectory-postgres';

export function createJuliusPostgresRuntimeStore(pool: Pool): JuliusRuntimeStore & JuliusRecoveryDriver {
  const runs = new JuliusPostgresRepository(pool);
  const results = new JuliusRecoveryPostgresRepository(pool);
  const contexts = new JuliusContextPostgresRepository(pool);
  const reader = new JuliusReadPostgresRepository(pool);
  const findings = new JuliusVerificationPostgresRepository(pool);
  const events = new JuliusEventPostgresRepository(pool);
  const trajectories = new JuliusTrajectoryPostgresRepository(pool);
  return {
    loadRun: runs.loadRun.bind(runs),
    transition: runs.transition.bind(runs),
    addTask: runs.addTask.bind(runs),
    claimRunnable: runs.claimRunnable.bind(runs),
    // The claim takes ownership; THIS spends the execution attempt, immediately
    // before the run loop dispatches a provider-capable worker.
    admitTask: runs.admitTask.bind(runs),
    heartbeat: runs.heartbeat.bind(runs),
    finishTask: runs.finishTask.bind(runs),
    appendEvidence: runs.appendEvidence.bind(runs),
    appendDecision: runs.appendDecision.bind(runs),
    appendBrainEntry: runs.appendBrainEntry.bind(runs),
    acceptWorkerResult: results.acceptWorkerResult.bind(results),
    recoverExpired: results.recoverExpired.bind(results),
    persist: contexts.persist.bind(contexts),
    appendEvent: async (event) => (await events.append(event)).recorded,
    appendTrajectory: (event) => trajectories.append(event),
    tasksForRun: reader.tasksForRun.bind(reader),
    evidenceForRun: reader.evidenceForRun.bind(reader),
    findingsForRun: reader.findingsForRun.bind(reader),
    criteriaForRun: reader.criteriaForRun.bind(reader),
    decisionsForRun: reader.decisionsForRun.bind(reader),
    brainEntriesForRun: reader.brainEntriesForRun.bind(reader),
    repairRoundsFor: reader.repairRoundsFor.bind(reader),
    reviewCompletedFor: reader.reviewCompletedFor.bind(reader),
    activeTaskCount: reader.activeTaskCount.bind(reader),
    recordFinding: findings.recordFinding.bind(findings),
  };
}
