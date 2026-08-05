/**
 * SUNDAY RELAY — PROJECT BRAIN LLMOPS (barrel).
 *
 * The operational half of the Project Brain: what a run cost in time, where it
 * failed, what it waited for, who judged it, and whether the repair loops
 * converged. Money is modelled in `../economics` and cited, never recomputed.
 */

export {
  RELAY_ERROR_KINDS,
  RELAY_EVALUATION_VERDICTS,
  RELAY_LATENCY_PHASES,
  RELAY_REPAIR_OUTCOMES,
  RELAY_WAIT_REASONS,
  WAITING_ON_USER_REASONS,
  emptyOperationalRecord,
  isIndependentEvaluation,
} from './llmops-contracts';
export type {
  RelayAttemptBase,
  RelayErrorEvent,
  RelayErrorKind,
  RelayEvaluation,
  RelayEvaluationVerdict,
  RelayLatencyPhase,
  RelayLatencySample,
  RelayOperationalRecord,
  RelayRepairCycle,
  RelayRepairLoop,
  RelayRepairOutcome,
  RelayWaitInterval,
  RelayWaitReason,
} from './llmops-contracts';

export {
  HEALTH_STALE_AFTER_MS,
  MIN_SAMPLES_FOR_TAIL,
  RELAY_HEALTH_STATES,
  RELAY_UNKNOWN_REASONS,
  knownFigure,
  projectOperations,
  unknownFigure,
} from './llmops-projection';
export type {
  RelayErrorView,
  RelayEvaluationView,
  RelayFigure,
  RelayHealthState,
  RelayLatencyPhaseView,
  RelayOperationsView,
  RelayRepairView,
  RelayUnknownReason,
  RelayWaitView,
} from './llmops-projection';

export {
  BRAIN_DOC_STALE_AFTER_MS,
  RELAY_MEMORY_SOURCES,
  RELAY_OBSERVATION_KINDS,
  SHORT_TERM_CAPACITY,
  emptyShortTermMemory,
  isSelfApproved,
  proposePromotion,
  refreshBrainDocument,
  rememberShortTerm,
} from './brain-memory';
export type {
  RelayBrainDocument,
  RelayBrainDocumentSection,
  RelayLongTermEntry,
  RelayMemorySource,
  RelayObservationKind,
  RelayPromotionProposal,
  RelayShortTermEntry,
  RelayShortTermMemory,
} from './brain-memory';

export {
  errorFromFailure,
  ingest,
  noteObservation,
  samplesFromTurn,
} from './operational-intake';
export type { ObservedFailure, ObservedTurn } from './operational-intake';

export {
  TOKEN_UNITS,
  citeSpend,
  emptySpendCitation,
  formatMicros,
} from './spend-citation';
export type {
  RelayCurrencyTotal,
  RelaySpendCitation,
  RelayTokenTotals,
} from './spend-citation';

export { observeRun } from './run-observation';
export type {
  ObservedRun,
  ObservedRunTermination,
  ObservedRunUsage,
  RunObservation,
} from './run-observation';
