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
 * A task that SUCCEEDED takes no claim after its accepted attempt, and a late writer from a lost
 * lease carries an older generation, so a task's latest generation with evidence is the attempt its
 * decision is about. A row that names no generation is kept: never assume a row away.
 */

import type { JuliusEvidence } from './julius-runtime';

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

/** Each task's evidence reduced to its latest attempt, plus every row that names no attempt. */
export function juliusCurrentAttemptEvidence(evidence: readonly JuliusEvidence[]): readonly JuliusEvidence[] {
  const latest = new Map<string, number>();
  for (const item of evidence) {
    const generation = juliusEvidenceGeneration(item);
    if (generation !== null && generation > (latest.get(item.taskId) ?? -1)) latest.set(item.taskId, generation);
  }
  return evidence.filter((item) => {
    const generation = juliusEvidenceGeneration(item);
    return generation === null || generation === latest.get(item.taskId);
  });
}
