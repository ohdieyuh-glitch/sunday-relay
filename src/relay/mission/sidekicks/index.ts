/**
 * WONDERLAND SIDEKICKS — the LLM Companion and Jhinn, and whatever real thing is behind them.
 *
 * Julius is not here: it is the compound agent and the mission authority, and a sidekick never becomes one.
 */
export {
  AUTHORITY_BY_KIND,
  FAILURE_WORDS,
  JULIUS_AUTHORITY,
  MASCOT_STATES,
  SIDEKICK_AUTH_MECHANISMS,
  SIDEKICK_AUTHORITIES,
  SIDEKICK_EDGES,
  SIDEKICK_FAILURES,
  SIDEKICK_KINDS,
  SIDEKICK_STATES,
  TURN_STATES,
  authorityOf,
  chooseAuth,
  isLegalSidekickTransition,
  isLiveState,
  isSidekickAuthority,
  looksLikeSecret,
  mascotStateFor,
  type MascotState,
  type SidekickAuditRow,
  type SidekickAuthMechanism,
  type SidekickAuthOption,
  type SidekickFailure,
  type SidekickKind,
  type SidekickModel,
  type SidekickProvider,
  type SidekickSession,
  type SidekickState,
  type SidekickTurn,
  type TurnState,
} from './sidekick-contracts';

export { SIDEKICK_REGISTRY, developmentProviderFor, findProvider, providersFor } from './sidekick-registry';

export {
  JHINN,
  LLM_COMPANION,
  askSidekick,
  changeModel,
  completeConnection,
  connectSidekick,
  disconnectSidekick,
  emptySidekickWorld,
  failTurn,
  findSidekick,
  finishTurn,
  grantAuthority,
  liveTurn,
  markTurn,
  mascotOf,
  recoverInterruptedTurns,
  type SidekickClock,
  type SidekickPresence,
  type SidekickWorld,
} from './sidekick-runtime';
