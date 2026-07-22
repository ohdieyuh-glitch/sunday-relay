/**
 * Mission projection layer (Prompt 8.1). PURE, browser-safe read-model
 * projections DERIVED from canonical Relay state — not a second source of
 * truth and not a second workflow engine. Consumed by the CLI now and the
 * future graphical Mission Control.
 */

export * from './contracts';
export {
  buildMissionContract, validateMissionSpec, stableDigest, bindingFields,
  isBindingChange, handoffIsStale,
} from './mission';
export {
  buildExecutionAttestation, attestsSuccessfulExecution, hasAttestedExecutionBy,
  type ExecutionFacts,
} from './attestation';
export {
  projectReviewLedger, reviewHasActionableFinding, repairExpandsFileClaims,
  openBlockingFindings, type ReviewInput, type ProjectReviewInput,
} from './review-repair';
export { evaluateMissionVerdict, claimedCompleteVerdict, type MissionVerdictInput } from './verdict';
export { buildMissionTimeline, type TimelineEventInput, type TimelineContext } from './timeline';
export { projectMission, type MissionProjectionInput, type MissionProjectionBundle } from './read-models';
