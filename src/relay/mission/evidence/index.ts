/**
 * EVIDENCE — the barrel. Pure domain; sanitization happens in the composition
 * root and arrives here as data, which is what keeps this module free of the
 * scanner and free of Node.
 */
export {
  EVIDENCE_AUTHORITY,
  EVIDENCE_FRESHNESS,
  EVIDENCE_FRESHNESS_LABEL,
  EVIDENCE_SANITIZATION,
  contentFingerprint,
  evidenceAge,
  outranks,
} from './evidence-contracts';
export type {
  EvidenceAge,
  EvidenceArtifact,
  EvidenceAuthority,
  EvidenceConflict,
  EvidenceFreshness,
  EvidencePack,
  EvidenceSanitization,
} from './evidence-contracts';
export {
  buildEvidencePack,
  describeConflict,
  evidenceReference,
  newestPublished,
  normalizeObservation,
  renderForPrompt,
} from './evidence-normalizer';
export type { EvidenceReference, RawObservation } from './evidence-normalizer';
export {
  EVIDENCE_MEMORY_SOURCE,
  EVIDENCE_OBSERVATION_KIND,
  describeObservation,
  evidenceCitation,
  evidenceObservation,
  proposeEvidence,
} from './evidence-brain-link';
export type { EvidencePromotionDraft } from './evidence-brain-link';
