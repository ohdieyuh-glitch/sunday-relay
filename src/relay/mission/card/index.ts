/**
 * C.A.R.D. — the barrel.
 *
 * The durable, user-owned configuration of a Compound AI Agent, plus the
 * lifecycle that creates, validates, activates and restores it, and the entry
 * decision Wonderland must ask Relay for.
 *
 * NOT re-exported through `src/relay/mission/index.ts`, for the same reason
 * `wonderland` is not: that barrel is reachable from the browser entry point,
 * and widening it is how server-side names end up in the bundle. A surface that
 * needs cards imports this path, and that edge gets reviewed then.
 */

export type {
  CardAutonomyBound,
  CardBudget,
  CardDogCoat,
  CardEvent,
  CardEventType,
  CardIdentity,
  CardProjectBrainConfig,
  CardRoleSlot,
  CardSchemaVersion,
  CardState,
  CardVerificationPolicy,
  RelayCard,
  WonderlandEntryDecision,
  WonderlandEntryDenied,
  WonderlandEntryGrant,
  WonderlandEntryRefusal,
} from './card-contracts';

export {
  CARD_AUTONOMY_BOUNDS,
  CARD_DOG_COATS,
  CARD_EVENT_TYPES,
  CARD_SCHEMA_V1,
  CARD_STATES,
  CARD_VERIFICATION_POLICIES,
  SUPPORTED_CARD_SCHEMA_VERSIONS,
  WONDERLAND_ENTRY_REFUSALS,
} from './card-contracts';

export type { CardActivation, CardRestoration, CardRestoreOutcome, CardValidation } from './card-lifecycle';
export {
  CARD_RESTORE_OUTCOMES,
  activateCard,
  cardEvent,
  decideWonderlandEntry,
  restoreCard,
  standardCard,
  updateCard,
  validateCard,
} from './card-lifecycle';

export type { CardSaveFailed, CardSaveOk, CardSaveResult, RelayCardStore } from './card-store';
export { createRelayCardStore } from './card-store';
