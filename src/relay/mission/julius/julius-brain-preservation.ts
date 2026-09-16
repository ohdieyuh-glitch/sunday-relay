import type { JuliusBrainRecord } from './julius-brain-contracts';
import { juliusBrainStateHashAt } from './julius-brain-export';
import type { JuliusBrainEntityState } from './julius-brain-projection';

/**
 * WHETHER A RUN IS PRESERVED, READ FROM THE BRAIN ITSELF — NEVER GUESSED.
 *
 * A live run leaves three pieces of durable evidence, each written by Julius:
 *
 *   run-opened:<run>   written only after bootstrap verified the Brain
 *   run-sealed:<run>   written at the end: how many of the run's v1 entries
 *                      the Brain holds with the right content, and which not
 *   CHECKPOINT         labelled `run-preserved:<run>`, taken after the seal
 *
 * From those and nothing else:
 *
 *   PRESERVED            opened, sealed with nothing missing, and a checkpoint
 *                        covering the seal that re-derives from the ledger
 *   PARTIALLY_PRESERVED  some live evidence exists — the run was opened, or
 *                        its writes reached the Brain — but not all of the above
 *   NOT_PRESERVED        nothing of the live run is durable
 *
 * Evidence a lesser principal wrote does not count: workers and tools may write
 * traces, and a trace named `run-sealed:` written by one is not a seal. Records
 * an archive import or recovery wrote are not live evidence either; they are
 * listed as recoveries, and never turn a run PRESERVED — preservation is what
 * the live run achieved, recovery is what was done about it afterwards.
 */

export const JULIUS_BRAIN_PRESERVATION_STATUSES = ['PRESERVED', 'PARTIALLY_PRESERVED', 'NOT_PRESERVED'] as const;
export type JuliusBrainPreservationStatus = typeof JULIUS_BRAIN_PRESERVATION_STATUSES[number];

export const juliusRunOpenedEntityId = (brainRunId: string): string => `run-opened:${brainRunId}`;
export const juliusRunSealedEntityId = (brainRunId: string): string => `run-sealed:${brainRunId}`;
export const juliusRunPreservedCheckpointLabel = (brainRunId: string): string => `run-preserved:${brainRunId}`;
export const juliusArchiveRecoveryEntityId = (brainRunId: string, archiveContentHash: string): string => `archive-recovery:${brainRunId}:${archiveContentHash.slice(7, 23)}`;

export interface JuliusRunOpenedFacts {
  readonly brainRunId: string;
  readonly juliusRunId: string;
  readonly missionId: string;
  readonly acceptedMainSha: string | null;
}

export function juliusRunOpenedBody(facts: JuliusRunOpenedFacts) {
  return {
    traceClass: 'LIFECYCLE',
    summary: `Run ${facts.brainRunId} opened against a verified Brain`,
    facts: { brainRunId: facts.brainRunId, juliusRunId: facts.juliusRunId, missionId: facts.missionId, acceptedMainSha: facts.acceptedMainSha },
  };
}

export interface JuliusRunSealedFacts {
  readonly brainRunId: string;
  readonly expectedEntries: number;
  readonly writtenEntries: number;
  readonly missingEntryIds: readonly string[];
}

export function juliusRunSealedBody(facts: JuliusRunSealedFacts) {
  const missing = facts.expectedEntries - facts.writtenEntries;
  return {
    traceClass: 'LIFECYCLE',
    summary: `Run ${facts.brainRunId} sealed: ${facts.writtenEntries} of ${facts.expectedEntries} v1 entries held${missing > 0 ? `, ${missing} missing` : ''}`,
    facts: {
      brainRunId: facts.brainRunId, expectedEntries: facts.expectedEntries, writtenEntries: facts.writtenEntries, missingEntries: missing,
      missingEntryIds: facts.missingEntryIds.length === 0 ? null : facts.missingEntryIds.join(',').slice(0, 512),
    },
  };
}

/**
 * WHAT THE RUN ACHIEVED WHILE IT RAN, AND WHAT HISTORY HOLDS NOW — two facts,
 * never one. A run that finished PARTIALLY_PRESERVED stays PARTIALLY_PRESERVED
 * however completely the archive recovered it afterwards; the recovery is its
 * own fact beside it.
 */
export const JULIUS_BRAIN_COMPLETENESS = ['PRESERVED_LIVE', 'RECOVERED_AFTER_RUN', 'NOT_RECOVERED'] as const;
export type JuliusBrainCompleteness = typeof JULIUS_BRAIN_COMPLETENESS[number];

export interface JuliusBrainRunPreservation {
  readonly brainRunId: string;
  /** What the live run achieved. Recovery never changes it. */
  readonly status: JuliusBrainPreservationStatus;
  /** What the Brain holds of the attempt now, including anything recovered after the run. */
  readonly completeness: JuliusBrainCompleteness;
  readonly evidence: {
    readonly opened: { readonly sequence: number; readonly juliusRunId: string | null; readonly missionId: string | null; readonly acceptedMainSha: string | null } | null;
    readonly sealed: { readonly sequence: number; readonly expectedEntries: number; readonly writtenEntries: number; readonly missingEntries: number } | null;
    readonly checkpoint: { readonly entityId: string; readonly throughSequence: number; readonly matches: boolean } | null;
    /** Records scoped to the run that the live run wrote (not an archive import or recovery). */
    readonly liveRecords: number;
    readonly recoveries: readonly { readonly entityId: string; readonly sequence: number; readonly facts: Readonly<Record<string, unknown>> }[];
  };
  readonly reasons: readonly string[];
}

const byJulius = (state: JuliusBrainEntityState) => state.createdBy.kind === 'JULIUS';
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Pure: the run's preservation, from the Brain's records and current state. */
export function deriveJuliusBrainRunPreservation(input: {
  readonly brainId: string;
  readonly brainRunId: string;
  readonly records: readonly JuliusBrainRecord[];
  readonly entities: readonly JuliusBrainEntityState[];
}): JuliusBrainRunPreservation {
  const { brainRunId } = input;
  const reasons: string[] = [];
  const entity = (entityId: string) => input.entities.find((state) => state.entityId === entityId);

  const openedState = entity(juliusRunOpenedEntityId(brainRunId));
  let opened: JuliusBrainRunPreservation['evidence']['opened'] = null;
  if (openedState !== undefined && (!byJulius(openedState) || openedState.kind !== 'TRACE')) reasons.push('a run-opened record exists that Julius did not write; it is not evidence');
  else if (openedState !== undefined) {
    const facts = openedState.body.facts as Record<string, unknown>;
    opened = { sequence: openedState.createdSequence, juliusRunId: str(facts.juliusRunId), missionId: str(facts.missionId), acceptedMainSha: str(facts.acceptedMainSha) };
  }

  const sealedState = entity(juliusRunSealedEntityId(brainRunId));
  let sealed: JuliusBrainRunPreservation['evidence']['sealed'] = null;
  if (sealedState !== undefined && (!byJulius(sealedState) || sealedState.kind !== 'TRACE')) reasons.push('a run-sealed record exists that Julius did not write; it is not evidence');
  else if (sealedState !== undefined) {
    const facts = sealedState.body.facts as Record<string, unknown>;
    const expectedEntries = num(facts.expectedEntries);
    const writtenEntries = num(facts.writtenEntries);
    if (expectedEntries === null || writtenEntries === null) reasons.push('the seal does not say how many entries it expected and held');
    else sealed = { sequence: sealedState.createdSequence, expectedEntries, writtenEntries, missingEntries: expectedEntries - writtenEntries };
  }

  const label = juliusRunPreservedCheckpointLabel(brainRunId);
  const checkpointState = input.entities
    .filter((state) => state.kind === 'CHECKPOINT' && state.body.label === label && byJulius(state))
    .sort((a, b) => b.createdSequence - a.createdSequence)[0];
  let checkpoint: JuliusBrainRunPreservation['evidence']['checkpoint'] = null;
  if (checkpointState !== undefined) {
    const throughSequence = num(checkpointState.body.throughSequence) ?? -1;
    const matches = throughSequence >= 0 && throughSequence <= input.records.length
      && juliusBrainStateHashAt(input.brainId, input.records, throughSequence) === checkpointState.body.stateHash;
    checkpoint = { entityId: checkpointState.entityId, throughSequence, matches };
  }

  const recoveryPrefix = `archive-recovery:${brainRunId}:`;
  const liveRecords = input.records.filter((record) => record.scope.runId === brainRunId && !record.entityId.startsWith('archive:') && !record.entityId.startsWith(recoveryPrefix)).length;
  const recoveries = input.entities
    .filter((state) => state.entityId.startsWith(recoveryPrefix) && state.kind === 'TRACE' && byJulius(state))
    .sort((a, b) => a.createdSequence - b.createdSequence)
    .map((state) => ({ entityId: state.entityId, sequence: state.createdSequence, facts: state.body.facts as Record<string, unknown> }));

  if (opened === null) reasons.push('the run was never opened against a verified Brain');
  if (sealed === null) reasons.push('the run was never sealed');
  else if (sealed.missingEntries !== 0) reasons.push(`${sealed.missingEntries} of the run's ${sealed.expectedEntries} v1 entries did not reach the Brain`);
  if (checkpoint === null) reasons.push('no checkpoint was committed for the run');
  else if (!checkpoint.matches) reasons.push('the run checkpoint does not re-derive from the ledger');
  else if (sealed !== null && checkpoint.throughSequence < sealed.sequence) reasons.push('the run checkpoint was taken before the seal');

  const preserved = opened !== null && sealed !== null && sealed.missingEntries === 0 && checkpoint !== null && checkpoint.matches && checkpoint.throughSequence >= sealed.sequence;
  const status: JuliusBrainPreservationStatus = preserved ? 'PRESERVED' : opened !== null || liveRecords > 0 ? 'PARTIALLY_PRESERVED' : 'NOT_PRESERVED';
  // A recovery is history arriving later, never a live run rewritten.
  const completeness: JuliusBrainCompleteness = preserved ? 'PRESERVED_LIVE' : recoveries.length > 0 ? 'RECOVERED_AFTER_RUN' : 'NOT_RECOVERED';
  if (completeness === 'RECOVERED_AFTER_RUN') {
    reasons.push(`the attempt was recovered after the run from the paid-run archive (${recoveries.length} recovery record${recoveries.length === 1 ? '' : 's'}); it was not preserved live`);
  }
  return { brainRunId, status, completeness, evidence: { opened, sealed, checkpoint, liveRecords, recoveries }, reasons: preserved ? [] : reasons };
}
