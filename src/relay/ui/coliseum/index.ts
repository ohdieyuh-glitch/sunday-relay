/**
 * SUNDAY RELAY — WONDERLAND COLISEUM (barrel).
 *
 * The Coliseum console surface. Renders only what THE ONE shared duel view
 * model (`src/relay/mission/coliseum/duel-results-projection.ts`) records —
 * the view contract is imported from the mission barrel, never re-declared.
 *
 * RelayProofMeter is deliberately NOT exported: it renders under
 * RelayDuelResults, which carries the required `source` and its SIMULATED
 * DATA banner. Both public components require `source`, so fixture data can
 * never render without its disclosure.
 */

export {
  RelayColiseumConsole,
  type ColiseumDataSource,
  type RelayColiseumConsoleProps,
} from './RelayColiseumConsole';
export { RelayDuelResults } from './RelayDuelResults';
export {
  DUEL_COMMAND_NAMES,
  DUEL_MODE_LABEL,
  DUEL_PARTICIPANT_KIND_LABEL,
  DUEL_STATUS_LABEL,
  PROOF_CATEGORY_LABEL,
  formatDelta,
  formatMaybe,
  parseDuelCommand,
  proofEntryVerdict,
  type DuelCommandBindingState,
  type DuelCommandName,
  type DuelCommandView,
  type DuelParticipantKind,
  type DuelParticipantResultView,
  type DuelResultsView,
  type DuelStatusView,
  type ProofCategory,
  type ProofEntryView,
  type VerifiedFixView,
} from './projections';
export {
  ACTIVE_AUTOMATION_DUEL_FIXTURE,
  CHALLENGED_DUEL_FIXTURE,
  COLISEUM_FIXTURE_DISCLOSURE,
  CONCLUDED_MANUAL_DUEL_FIXTURE,
} from './fixtures';
