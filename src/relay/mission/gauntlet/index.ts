/**
 * THE GAUNTLET LOOP — a user-activated review command.
 *
 * `/gauntletloop` runs an iterative Gauntlet process through the Independent
 * Reviewer Harness. It is NOT a Julius runtime, subsystem, execution mode or
 * lifecycle: Julius does not activate it, own state for it, implement it, or
 * know that a feature called Gauntlet Loop exists.
 *
 * Everything this module needs from whatever executes work is declared in
 * `gauntlet-ports.ts`, in the gauntlet's own vocabulary. Nothing here imports
 * from `mission/julius/**`, and `gauntlet-boundary.test.ts` proves it in both
 * directions.
 */

export {
  advanceGauntlet,
  type GauntletLimits, type GauntletRun, type GauntletState,
} from './gauntlet-machine';

export {
  GAUNTLET_ACTIVATIONS, GAUNTLET_PHASES,
  activateGauntlet, advanceGauntletCommand, cancelGauntlet,
  gauntletWorkId, openNextGauntletRound, runGauntletReview,
  type GauntletActivation, type GauntletActivationCommand, type GauntletActivationOutcome,
  type GauntletAdvanceOutcome, type GauntletCommandRecord, type GauntletDependencies,
  type GauntletPhase, type GauntletRoundRecord, type GauntletStepInput, type GauntletStore,
} from './gauntlet-command';

export {
  type GauntletClock, type GauntletIds, type GauntletPolicy,
  type GauntletReviewPort, type GauntletUsage, type GauntletWorkPort,
} from './gauntlet-ports';

export { createGauntletMemoryStore, type GauntletMemoryStore } from './gauntlet-memory-store';
