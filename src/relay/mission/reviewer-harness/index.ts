/**
 * REVIEWER HARNESS — the canonical, provider-neutral adapter contract, the
 * truthful harness catalog, tool/finding/verdict validation, the independence
 * assessment, the one projection both surfaces render, and the store.
 * Pure domain: no process, no network, no clock.
 */
export {
  ACTIVE_HARNESS_STATES, BLOCKING_HARNESS_STATES, FORBIDDEN_REVIEWER_TOOLS,
  HARNESS_CONNECTION_STATES, INDEPENDENCE_VERDICTS, NO_HARNESS_CAPABILITIES,
  PROPOSED_VERDICTS, REVIEWER_HARNESS_CAPABILITIES, REVIEWER_HARNESS_SCHEMA_V1,
  REVIEWER_HARNESS_SCHEMA_VERSION, REVIEWER_TOOLS,
  SUPPORTED_REVIEWER_HARNESS_VERSIONS, UNKNOWN_HARNESS_USAGE,
} from './harness-contracts';
export type {
  HarnessConnectionState, IndependenceAssessment, IndependenceVerdict,
  ProposedFinding, ProposedReviewResult, ProposedVerdict,
  ReviewerHarnessCapabilities, ReviewerHarnessCapability, ReviewerHarnessIdentity,
  ReviewerHarnessRecord, ReviewerHarnessRecordDraft, ReviewerHarnessSchemaVersion,
  ReviewerHarnessUsage, ReviewerIdentityEvidence, ReviewerTool,
} from './harness-contracts';
export {
  CATALOG_STATUS_LABEL, HARNESS_INSTALL_STATES, HARNESS_INTEGRATION_STATUSES,
  REVIEWER_HARNESS_CATALOG, findCatalogEntry, harnessIsSelectableForRun, renderCatalogLine,
} from './harness-catalog';
export type {
  HarnessInstallState, HarnessIntegrationStatus, ReviewerHarnessCatalogEntry,
} from './harness-catalog';
export {
  UNKNOWN_INDEPENDENCE, assessIndependence, blockingFindings, grantReviewerTools,
  isForbiddenReviewerTool, validateProposedFinding, validateProposedResult, validatedVerdictFor,
} from './harness-validation';
export type { FindingValidation, ResultValidation, ToolGrantResult } from './harness-validation';
export {
  classifyRecoveredHarness, harnessDraftFrom, idleHarnessRecord, readHarnessRecord,
  retryHarnessRun, sealHarnessRecord, verifyHarnessChecksum,
} from './harness-record';
export type { HarnessReadResult } from './harness-record';
export {
  HARNESS_STATE_LABEL, NO_PROVEN_CAPABILITIES_LABEL, REVIEWER_BRIDGE_REQUIRED_LABEL,
  REVIEWER_HARNESS_NOT_CONNECTED_LABEL, REVIEWER_SIMULATED_LABEL, UNKNOWN_LABEL,
  projectHarnessCatalog, projectReviewerHarness, renderHarnessCatalogLines,
  renderReviewerStatusLines, reviewerNotification,
} from './harness-projection';
export type {
  HarnessCapabilityView, HarnessCatalogEntryView, ReviewerHarnessCatalogView,
  ReviewerHarnessView, ReviewerIdentityRow, ReviewerProjectionOptions,
} from './harness-projection';
export { createReviewerHarnessStore } from './harness-store';
export type { HarnessWriteResult, ReviewerHarnessStorePort } from './harness-store';
export {
  FAKE_CLEAN_RESULT, FAKE_HARNESS_ADAPTER_ID, FAKE_HARNESS_CAPABILITIES,
  FAKE_KNOWN_USAGE, fakeHarnessIdentity, fakeHarnessResult,
} from './harness-fixtures';
export type { FakeHarnessScenario } from './harness-fixtures';
