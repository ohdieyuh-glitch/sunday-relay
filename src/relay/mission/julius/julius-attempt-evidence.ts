/**
 * WHICH ATTEMPT A ROW OF EVIDENCE BELONGS TO (defect A).
 *
 * Evidence reaches a task's rows from outside the lease fence: the tool settlement writes each
 * executor effect's row while the attempt runs, and the coordinator persists a result's evidence
 * before the result is accepted. An attempt that then fails, or loses its lease, leaves its rows
 * behind, and a decision that read them all judged the next attempt by the last one's failures.
 *
 * Every row Julius writes already names its attempt's lease generation:
 *   `<task>:<generation>:<n>`                    the coordinator (`juliusMintedEvidenceId`)
 *   `<task>:<generation>:workspace|scope`        the pipeline's own attribution and scope rows
 *   `tool:<invocation>:g<generation>`            the tool settlement (`executorInvocationId`)
 * THE ATTEMPT A DECISION IS ABOUT IS THE ONE THE TASK ROW NAMES. A SUCCEEDED task takes no claim
 * after its accepted attempt, so its row's lease generation IS that attempt. An earlier version
 * took "the latest generation that wrote a row" instead, and that heuristic was a false accept
 * (review of 785aa19c, DA1): an accepted attempt that wrote nothing was judged on the PASSED row a
 * lost lease had left behind. The heuristic remains only for a task the store could not name a
 * generation for. A row that names no generation is kept: never assume a row away.
 */

import type { JuliusEvidence, JuliusTask } from './julius-runtime';

const GENERATION_AFTER_TASK = /^(\d+):/u;
const TOOL_GENERATION = /:g(\d+)$/u;

/** The lease generation a Julius-written evidence id names, or null when it names none this module knows. */
export function juliusEvidenceGeneration(evidence: JuliusEvidence): number | null {
  const id = evidence.evidenceId;
  const own = `${evidence.taskId}:`;
  if (id.startsWith(own)) {
    const match = GENERATION_AFTER_TASK.exec(id.slice(own.length));
    if (match !== null) return Number(match[1]);
  }
  if (id.startsWith('tool:')) {
    const match = TOOL_GENERATION.exec(id);
    if (match !== null) return Number(match[1]);
  }
  return null;
}

/**
 * Each task's evidence reduced to the attempt its task row names, plus every row that names no
 * attempt. A task the rows do not describe, or whose row names no generation, falls back to its
 * latest generation with evidence.
 */
export function juliusCurrentAttemptEvidence(
  evidence: readonly JuliusEvidence[],
  tasks: readonly Pick<JuliusTask, 'taskId' | 'leaseGeneration'>[] = [],
): readonly JuliusEvidence[] {
  const current = new Map<string, number>();
  for (const task of tasks) {
    if (typeof task.leaseGeneration === 'number' && Number.isSafeInteger(task.leaseGeneration)) current.set(task.taskId, task.leaseGeneration);
  }
  const latest = new Map<string, number>();
  for (const item of evidence) {
    if (current.has(item.taskId)) continue;
    const generation = juliusEvidenceGeneration(item);
    if (generation !== null && generation > (latest.get(item.taskId) ?? -1)) latest.set(item.taskId, generation);
  }
  return evidence.filter((item) => {
    const generation = juliusEvidenceGeneration(item);
    return generation === null || generation === (current.get(item.taskId) ?? latest.get(item.taskId));
  });
}
