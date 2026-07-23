export { RelayProjectWorkspace } from './RelayProjectWorkspace';
export { RelayProjectHeader } from './RelayProjectHeader';
export { RelayWorkforceStrip } from './RelayWorkforceStrip';
export { RelayProjectConversation } from './RelayProjectConversation';
export { RelayConsole } from './RelayConsole';
export { RelayLiveTerminalPanel } from './RelayLiveTerminalPanel';
export { RelayTerminalEvent } from './RelayTerminalEvent';
export { RelayProjectPhaseRail } from './RelayProjectPhaseRail';
export { RelayManualTaskPanel } from './RelayManualTaskPanel';
export { RelayReviewerStatus } from './RelayReviewerStatus';
export { RelayFindingPanel } from './RelayFindingPanel';
export { RelayRepairPanel } from './RelayRepairPanel';
export { RelayVerificationSummary } from './RelayVerificationSummary';
export { RelayResearchStatus } from './RelayResearchStatus';
export { RelayProjectBrainStatus } from './RelayProjectBrainStatus';
export { RelayWorkspaceDog } from './RelayWorkspaceDog';
export { RelayProjectFooter } from './RelayProjectFooter';

export * from './contracts';
export {
  TRUTH_BADGE,
  CATEGORY_LABEL,
  OUTPUT_STATE_LABEL,
  REVIEWER_STATE_LABEL,
  DOG_PRESENTATION,
  formatEventTime,
  phaseRailSteps,
  completionDisplay,
} from './projections';
export type {
  PhaseRailInput,
  PhaseRailStep,
  CompletionDisplay,
  CompletionDisplayInput,
  DogPresentation,
} from './projections';
export {
  WORKSPACE_FIXTURES,
  WORKSPACE_FIXTURE_KEYS,
} from './fixtures';
export type { WorkspaceFixture, WorkspaceFixtureKey } from './fixtures';
