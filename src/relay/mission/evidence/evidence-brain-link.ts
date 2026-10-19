import { evidenceReference, type EvidenceReference } from './evidence-normalizer';
import type { EvidenceArtifact } from './evidence-contracts';
import type {
  RelayObservationKind,
  RelayMemorySource,
  RelayShortTermEntry,
} from '../../shared/llmops/brain-memory';

/**
 * EVIDENCE REACHING THE PROJECT BRAIN — as a reference, never as a fact.
 *
 * The Brain already models exactly the two states this needs, and neither had
 * to be invented:
 *
 *   SHORT TERM   something was observed. Provisional, capped, and evicted when
 *                the buffer fills. This is where a retrieval goes.
 *   LONG TERM    something is KNOWN about this project. Requires an approver
 *                who is not the proposer — `isSelfApproved` exists precisely
 *                so an agent cannot promote its own claim.
 *
 * A retrieved artifact is an observation, not knowledge. It becomes a
 * short-term entry immediately and a PROPOSAL for long-term memory, and it
 * gets no further without someone approving it. That is the difference between
 * "the internet said this" and "this project knows this", and collapsing the
 * two is how a Brain fills up with whatever a page happened to claim.
 *
 * WHAT CROSSES OVER IS THE CITATION, NOT THE CONTENT. The proposal carries the
 * evidence id, the reference and the fingerprint, so anyone can go and check —
 * and re-fetching later can tell whether the source changed underneath the
 * claim. The observation's summary is about the OBSERVATION: what was read,
 * from where, how fresh it was, and which backend served it.
 */

/**
 * Observations from Live Reach are notes.
 *
 * `note` rather than a new kind, and deliberately: the Brain's kinds describe
 * what happened to a MISSION — a run outcome, an error, a repair, a cost — and
 * a retrieval is none of those. Adding an eighth kind would put a source class
 * into a vocabulary about mission events, and every exhaustive switch over
 * that vocabulary would have to grow a branch that means "not a mission event".
 */
export const EVIDENCE_OBSERVATION_KIND: RelayObservationKind = 'note';

/**
 * Retrieved evidence is research, and research needs approval.
 *
 * `research_approved` is the Brain's own source class for exactly this, which
 * is worth noticing: the vocabulary already assumed that research reaches
 * long-term memory only through approval.
 */
export const EVIDENCE_MEMORY_SOURCE: RelayMemorySource = 'research_approved';

/** How a retrieval is described when the Brain lists what it has seen. */
export function describeObservation(artifact: EvidenceArtifact): string {
  const freshness = artifact.age.minutes === null
    ? 'publication time unknown'
    : `published ${String(artifact.age.minutes)} minutes before retrieval`;
  const backend = artifact.attempt.actualBackendId ?? 'an unrecorded backend';
  const fallback = artifact.attempt.fallbackOccurred ? ', after a fallback' : '';
  return `Read ${artifact.reference} from ${artifact.source} (${freshness}), via ${backend}${fallback}.`;
}

/**
 * The short-term entry for one artifact.
 *
 * `observedBy` names Live Reach rather than an agent: the retrieval was
 * Relay's, and attributing it to whichever agent asked would credit a
 * component that never touched the network.
 */
export function evidenceObservation(
  artifact: EvidenceArtifact,
  observedBy = 'live-reach',
): RelayShortTermEntry {
  return {
    entryId: artifact.evidenceId,
    kind: EVIDENCE_OBSERVATION_KIND,
    summary: describeObservation(artifact),
    observedAt: artifact.retrievedAt,
    observedBy,
    ...(artifact.missionId === '' ? {} : { missionId: artifact.missionId }),
  };
}

/**
 * A citation a person can follow and a machine can re-check.
 *
 * The fingerprint is part of it on purpose: a citation that names only a URL
 * cannot tell you the page changed after the claim was approved.
 */
export function evidenceCitation(reference: EvidenceReference): string {
  return `${reference.reference} @ ${reference.retrievedAt} [${reference.contentFingerprint}]`;
}

export interface EvidencePromotionDraft {
  readonly entry: RelayShortTermEntry;
  readonly statement: string;
  readonly source: RelayMemorySource;
  readonly citation: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
}

/**
 * Propose that something read becomes something the project knows.
 *
 * THE STATEMENT IS THE CALLER'S, and that is the safeguard. This function will
 * not manufacture a claim from retrieved text: whoever proposes has to say
 * what they think is true, in their own words, and stand behind it. Copying a
 * sentence out of a page and calling it project knowledge is exactly the
 * silent absorption this linkage exists to prevent.
 *
 * `proposedAt` arrives from the caller — this module has no clock.
 */
export function proposeEvidence(input: {
  readonly artifact: EvidenceArtifact;
  readonly statement: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly observedBy?: string;
}): EvidencePromotionDraft {
  return {
    entry: evidenceObservation(
      input.artifact,
      ...(input.observedBy === undefined ? [] : [input.observedBy]) as [string?],
    ),
    statement: input.statement,
    source: EVIDENCE_MEMORY_SOURCE,
    citation: evidenceCitation(evidenceReference(input.artifact)),
    proposedBy: input.proposedBy,
    proposedAt: input.proposedAt,
  };
}
