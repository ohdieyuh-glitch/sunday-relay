/**
 * WONDERLAND COLISEUM — the duel domain barrel. PURE and browser-safe:
 * contracts, lifecycle, the sandbox guarantee, the command console, the proof
 * meter, rewards, the durable store, the results projection, and fixtures.
 */

export {
  DUEL_KIND_COMPATIBILITY, DUEL_PARTICIPANT_KINDS, DUEL_STATUSES,
  kindsAreCompatible,
  type DuelMode, type DuelParticipant, type DuelRecord, type DuelStatus,
  type SandboxFacts,
} from './duel-contracts';
export {
  isSandboxProvisioned, provisionSandbox,
  type ProvisionSandboxInput, type SandboxProvisioned,
} from './duel-sandbox';
export {
  abortDuel, acceptChallenge, activateDuel, beginProvisioning, concludeDuel,
  createChallenge,
  type ChallengeInput, type DuelTransitionOk, type DuelTransitionRefused,
  type DuelTransitionResult,
} from './duel-lifecycle';
export {
  DUEL_COMMANDS, DUEL_COMMAND_NAMES, commandSpec, planAutomationFight,
  resolveCommand,
  type AutomationFightLane, type AutomationFightLimits, type AutomationFightPlan,
  type AutomationFightRefused, type DuelAutomationLoopPort, type DuelCommandDispatch,
  type DuelCommandExecution, type DuelCommandRefusal, type DuelCommandSpec,
  type DuelEnginePorts, type DuelSandboxRepairPort, type DuelTraceEntryView,
  type DuelTracePort, type DuelVerifyPort,
} from './duel-commands';
export {
  FALSE_CLAIM_PENALTY, PROOF_CATEGORIES, PROOF_CATEGORY_POINTS,
  SANDBOX_BREAK_PENALTY, readProofMeter, scoreProofEntry, verificationIsIndependent,
  type ProofEntry, type ProofMeterReading, type ProofVerificationState,
  type ScoredProofEntry,
} from './proof-meter';
export {
  EVALUATION_DEPTH_XP_DIVISOR, OPPONENT_FIX_BONUS_XP, RUN_EXTENSION_XP_DIVISOR,
  WINNER_BONUS_XP, computeDuelReward,
  type DuelReward, type DuelRewardInput,
} from './duel-rewards';
export {
  createDuelStore, totalXp,
  type AgentXpLedger, type DuelReadResult, type DuelStorePort,
  type DuelStoreWriteResult, type XpLedgerEntry,
} from './duel-store';
export {
  projectDuelResults,
  type DuelCommandBindingState, type DuelCommandName, type DuelCommandView,
  type DuelParticipantKind, type DuelParticipantResultView, type DuelResultsView,
  type DuelStatusView, type ParticipantMeasurements, type ProjectDuelResultsInput,
  type ProofCategory, type ProofEntryView, type VerifiedFixFact, type VerifiedFixView,
} from './duel-results-projection';
export {
  ACTIVE_AUTOMATION_FIGHT, CHALLENGED_DUEL, CONCLUDED_MANUAL_DUEL,
  CONCLUDED_MANUAL_PROOF_ENTRIES, CONCLUDED_MANUAL_VERIFIED_FIXES,
  activeAutomationFightResults, challengedDuelResults, concludedManualDuelResults,
} from './duel-fixtures';
