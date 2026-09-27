/**
 * THE WONDERLAND ACCOUNT — the barrel.
 *
 * Persistent identity: who a user is, what they own, and the fact that all of it
 * survives leaving. Keyed by a user id derived from an identity provider's
 * stable subject, so ownership belongs to a PERSON rather than to a process, a
 * machine or a Windows login.
 *
 * Holds no credential of any kind. The beta-access DECISION is delegated to
 * `mission/beta`, which already owns waves, seats and refusal reasons.
 */

export {
  ACCOUNT_FORBIDDEN_FIELDS,
  SUPPORTED_WONDERLAND_ACCOUNT_SCHEMA_VERSIONS,
  WONDERLAND_ACCOUNT_SCHEMA_V1,
  WONDERLAND_ACCOUNT_SCHEMA_VERSION,
  WONDERLAND_ACCOUNT_STATUSES,
  WONDERLAND_DEFAULT_PREFERENCES,
  WONDERLAND_EMPTY_OWNED_STATE,
  WONDERLAND_IDENTITY_PROVIDERS,
  WONDERLAND_USER_ID_PATTERN,
  isWonderlandUserId,
  wonderlandUserIdFor,
} from './account-contracts';
export type {
  WonderlandAccount,
  WonderlandAccountDraft,
  WonderlandAccountSchemaVersion,
  WonderlandAccountStatus,
  WonderlandIdentityProvider,
  WonderlandOwnedState,
  WonderlandPreferences,
} from './account-contracts';

export {
  accountMayEnterWonderland,
  attachOwnedReference,
  bindWallet,
  detachOwnedReference,
  enrolAccountInBetaWave,
  equipAgent,
  multiplayerIdentityOf,
  restoreAccount,
  signInToWonderland,
  signOutOfWonderland,
  suspendAccount,
  updatePreferences,
} from './account-lifecycle';
export type {
  OwnedReferenceKind,
  SignInOutcome,
  VerifiedIdentity,
  WonderlandMultiplayerIdentity,
} from './account-lifecycle';

export {
  createWonderlandAccountStore,
  readWonderlandAccount,
  sealWonderlandAccount,
  wonderlandAccountDraftFrom,
} from './account-store';
export type {
  WonderlandAccountReadResult,
  WonderlandAccountStorePort,
} from './account-store';
