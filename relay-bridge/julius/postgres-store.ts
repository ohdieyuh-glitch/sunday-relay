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
import type { JuliusApprovalStore, JuliusRecoveryDriver, JuliusRuntimeReader, JuliusRuntimeStore, JuliusTimelineReader } from '../../src/relay/mission/julius';
import { JuliusPostgresRepository } from '../../src/relay/persistence/julius-postgres';
import { JuliusRecoveryPostgresRepository } from '../../src/relay/persistence/julius-recovery-postgres';
import { JuliusContextPostgresRepository } from '../../src/relay/persistence/julius-context-postgres';
import { JuliusReadPostgresRepository } from '../../src/relay/persistence/julius-read-postgres';
import { JuliusVerificationPostgresRepository } from '../../src/relay/persistence/julius-verification-postgres';
import { JuliusEventPostgresRepository } from '../../src/relay/persistence/julius-event-postgres';
import { JuliusTrajectoryPostgresRepository } from '../../src/relay/persistence/julius-trajectory-postgres';
import { JuliusContractPostgresRepository } from '../../src/relay/persistence/julius-contract-postgres';
import { JuliusTimelinePostgresRepository } from '../../src/relay/persistence/julius-timeline-postgres';
import { JuliusClaimPostgresRepository } from '../../src/relay/persistence/julius-claim-postgres';
import { JuliusLifecyclePostgresRepository } from '../../src/relay/persistence/julius-lifecycle-postgres';
import { ProjectBrainPostgresStore } from '../../src/relay/persistence/project-brain-postgres';

/**
 * THE TIMELINE READER IS IN THE RETURN TYPE, not left to a structural probe.
 *
 * WHY IT HAS TO BE. `JuliusTimelineReader` is NOT part of `JuliusRuntimeStore`,
 * so the conformance test this file's own comment relies on could never have
 * noticed it missing — a conformance test proves the REQUIRED ports are
 * implemented and says nothing about an optional capability. And both consumers
 * of this one are bound behind `typeof store.timeline === 'function'`:
 *
 *   - the research meter's `durableLedger`, which rebuilds a slot's retrieval
 *     spend from the run's own rows. Unbound, the mediator keeps its
 *     in-process Map, and a bridge restart forgets what every slot has already
 *     spent — the exact defect the durable projection was built to close, still
 *     live in production because the store could not serve the read.
 *   - `deps.timeline` on the pipeline, which projects the per-slot money ledger
 *     from `budget.reserved` and `budget.settled`. Unbound, allocation falls
 *     back to counting rounds off the task rows: a lower bound that cannot tell
 *     an open reservation from one settled for less.
 *
 * `JuliusTimelinePostgresRepository` had existed, implemented the reader, and
 * had NO production caller at all — its only references were its own
 * declaration and the barrel that exports it. Naming the capability in this
 * signature is what makes the next one impossible to drop silently: a structural
 * probe fails quietly, a missing declared method fails at the type.
 */
export function createJuliusPostgresRuntimeStore(
  pool: Pool,
): JuliusRuntimeStore & JuliusRecoveryDriver & JuliusTimelineReader
  & Required<Pick<JuliusRuntimeReader, 'haltingFailureClasses'>>
  & Required<Pick<JuliusApprovalStore, 'pendingApprovals' | 'deniedApprovals' | 'requestApproval' | 'requestApprovalAndBlock' | 'loadApproval'>> {
  const runs = new JuliusPostgresRepository(pool);
  const results = new JuliusRecoveryPostgresRepository(pool);
  const contexts = new JuliusContextPostgresRepository(pool);
  const reader = new JuliusReadPostgresRepository(pool);
  const findings = new JuliusVerificationPostgresRepository(pool);
  const events = new JuliusEventPostgresRepository(pool);
  const trajectories = new JuliusTrajectoryPostgresRepository(pool);
  const contracts = new JuliusContractPostgresRepository(pool);
  const timeline = new JuliusTimelinePostgresRepository(pool);
  const claims = new JuliusClaimPostgresRepository(pool);
  const lifecycle = new JuliusLifecyclePostgresRepository(pool);
  const projectBrain = new ProjectBrainPostgresStore(pool);
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
    /**
     * THE ONE PROJECT BRAIN, AS JULIUS READS IT: this run's own entries, then what
     * people stated to the project (project-wide, or about this run) through
     * Wonderland or the operator. Those arrive as user-stated, unverified
     * instructions (`projectBrainContextEntries`), so the context compiler ranks
     * them below the locked contract, Julius's decisions and cited findings. A
     * store error is thrown, never swallowed: a packet compiled without the Brain
     * it was supposed to see would be a silent wrong answer.
     */
    brainEntriesForRun: async (runId, projectId) => {
      const [own, stated] = await Promise.all([
        reader.brainEntriesForRun(runId, projectId),
        projectBrain.contextEntriesForRun(runId, projectId),
      ]);
      return [...own, ...stated];
    },
    repairRoundsFor: reader.repairRoundsFor.bind(reader),
    activeTaskCount: reader.activeTaskCount.bind(reader),
    executedBindingFor: reader.executedBindingFor.bind(reader),
    // A coder answered by a model it did not ask for ENDS THE RUN (`advanceRun`),
    // and the dispatch boundary refuses the run's claims. Both read the class
    // back off `task.failed` through this. Unbound, the run would fail as
    // TASK_FAILED and a sibling would still be dispatched.
    haltingFailureClasses: reader.haltingFailureClasses.bind(reader),
    recordFinding: findings.recordFinding.bind(findings),
    putTaskContract: contracts.putTaskContract.bind(contracts),
    challengeTaskContract: contracts.challengeTaskContract.bind(contracts),
    lockTaskContract: contracts.lockTaskContract.bind(contracts),
    loadTaskContract: contracts.loadTaskContract.bind(contracts),
    taskContractRevisions: contracts.taskContractRevisions.bind(contracts),
    timeline: timeline.timeline.bind(timeline),
    claimsForRun: claims.claimsForRun.bind(claims),
    recordClaimStanding: claims.recordClaimStanding.bind(claims),
    // Read by `advanceRun` so a run holding on a PENDING approval (written by
    // the bridge's lifecycle repository, same table) is never walked out of
    // BLOCKED by the task graph. Without it the live job could not see a gate.
    pendingApprovals: lifecycle.pendingApprovals.bind(lifecycle),
    // And the denials: a run holding one ENDS (`advanceRun`), and its claimed
    // task ends at the dispatch boundary, even when the denial's own move to
    // FAILED lost a race and never happened.
    deniedApprovals: lifecycle.deniedApprovals.bind(lifecycle),
    // THE C.A.R.D. GATE AT DISPATCH ASKS THROUGH THESE (`prepareClaimedTask`).
    // Bound from the same repository and table the bridge decides approvals
    // in. Without them the live job's gate has nowhere to put the question and
    // fails closed as APPROVAL_UNSERVED — refused, never granted.
    // `requestApprovalAndBlock` is the atomic one: the PENDING row and the run's
    // move to BLOCKED are one serializable transaction.
    requestApproval: lifecycle.requestApproval.bind(lifecycle),
    requestApprovalAndBlock: lifecycle.requestApprovalAndBlock.bind(lifecycle),
    loadApproval: lifecycle.loadApproval.bind(lifecycle),
  };
}
