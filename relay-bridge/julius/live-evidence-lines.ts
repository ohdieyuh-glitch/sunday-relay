/**
 * THE LIVE REPORT'S EVIDENCE LINES, AND WHICH ATTEMPT EACH ONE BELONGS TO (defect A's A-6).
 *
 * The entrypoint prints every evidence row of the run after its RESULT. A decision reads only the
 * attempt each task row names (`juliusCurrentAttemptEvidence`), so a row a failed or lost lease left
 * behind decided nothing, and printed like any other it read as part of the result: a FAILED test
 * beside a task that was accepted. Such a row is LABELLED, not hidden. The report is the run's
 * history, and a row that is on the record stays on it.
 *
 * THE SHAPE IS THE ONE THE ALLOWLIST KEEPS. `scripts/julius-live-evidence.mjs` admits
 * `^  evidence <id> [<TYPE>/<STATUS>] .*$`, so the label goes at the END of the free-text tail, where
 * the allowlist already accepts anything and the secret rejectors still read it. A label inside the
 * brackets would turn a kept line into a dropped one. A row of the attempt the decision read prints
 * byte for byte as it always did.
 */

import { juliusCurrentAttemptEvidence } from '../../src/relay/mission/julius/julius-attempt-evidence';
import type { JuliusEvidence, JuliusTask } from '../../src/relay/mission/julius/julius-runtime';

/** Appended to a row from an attempt other than the one its task row names. */
export const LIVE_EVIDENCE_SUPERSEDED_LABEL = ' (superseded attempt)';

export function liveEvidenceLines(
  evidence: readonly JuliusEvidence[],
  tasks: readonly Pick<JuliusTask, 'taskId' | 'leaseGeneration'>[],
): string[] {
  // The reducer keeps the very row objects it was given, so membership is by identity: two rows
  // that happened to share an id could never be confused.
  const read = new Set<JuliusEvidence>(juliusCurrentAttemptEvidence(evidence, tasks));
  return evidence.map((item) =>
    `  evidence ${item.evidenceId} [${item.type}/${item.status}] ${item.safeSummary}${read.has(item) ? '' : LIVE_EVIDENCE_SUPERSEDED_LABEL}`);
}
