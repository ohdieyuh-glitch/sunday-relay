import type { RelayBetaWave } from '../beta';

/**
 * THE WONDERLAND ACCOUNT — who a user IS, durably.
 *
 * Before this module the identity story had a hole in the middle, and it is
 * worth stating plainly because everything here is shaped by it: the HTTP layer
 * minted `ghu-<githubId>` into an in-memory session with a thirty-minute TTL,
 * and the database's `players` table only ever held the literal string
 * `'tenant'`. The two never met. A restart was a total logout, and no durable
 * record anywhere said that a particular human had ever been here.
 *
 * So ownership in this system was, in practice, attached to a process. This
 * record is what attaches it to a PERSON instead.
 *
 * WHAT THIS IS NOT. It is not a credential store. It holds no password, no
 * token, no refresh token, no API key and no secret of any kind — the identity
 * provider holds those, and this record holds only the provider's stable
 * SUBJECT (a public numeric user id). `wonderland-account.test.ts` greps a
 * serialized account for secret-shaped strings, so a future field cannot
 * quietly become one.
 *
 * WHY THAT ALSO GIVES US RECOVERY FOR FREE. There is no password to reset,
 * because there is no password. Recovery is: sign in again with the same
 * provider identity, and the same `userId` is derived, and every project,
 * creation and wallet keyed to it is found. The recovery path and the login path
 * are the same path, which is the safest arrangement available — nothing to
 * leak, nothing to socially engineer, and no reset token to intercept.
 */

/* ------------------------------------------------------------- versioning */

export const WONDERLAND_ACCOUNT_SCHEMA_V1 = 'relay-wonderland-account.v1' as const;
export const WONDERLAND_ACCOUNT_SCHEMA_VERSION = WONDERLAND_ACCOUNT_SCHEMA_V1;
export const SUPPORTED_WONDERLAND_ACCOUNT_SCHEMA_VERSIONS = [
  WONDERLAND_ACCOUNT_SCHEMA_V1,
] as const;
export type WonderlandAccountSchemaVersion =
  (typeof SUPPORTED_WONDERLAND_ACCOUNT_SCHEMA_VERSIONS)[number];

/* ------------------------------------------------------------ vocabularies */

/**
 * Where the identity came from. A closed vocabulary so a second provider is a
 * deliberate addition rather than a free-text string nobody validates.
 */
export const WONDERLAND_IDENTITY_PROVIDERS = ['github'] as const;
export type WonderlandIdentityProvider = (typeof WONDERLAND_IDENTITY_PROVIDERS)[number];

/**
 * `SUSPENDED` is reversible and is the only negative state. There is no
 * `DELETED`, for the same reason a project cannot be deleted: this system has no
 * restore path, and an irreversible operation without one is a trap.
 */
export const WONDERLAND_ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type WonderlandAccountStatus = (typeof WONDERLAND_ACCOUNT_STATUSES)[number];

/**
 * THE PARTICIPANT ID GRAMMAR, matching the pattern the bridge already enforces
 * in `browser-session/grants.ts`. Restated here rather than imported because the
 * mission layer may not reach into the bridge; `wonderland-account.test.ts` pins
 * the two against each other so they cannot drift.
 */
export const WONDERLAND_USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isWonderlandUserId(value: unknown): value is string {
  return typeof value === 'string' && WONDERLAND_USER_ID_PATTERN.test(value);
}

/**
 * Derive the durable user id from a provider subject.
 *
 * This mirrors `participantIdForIdentity` in the bridge exactly — `ghu-<id>` —
 * so the id the HTTP layer already mints and the id this record is keyed by are
 * THE SAME STRING. That identity is the whole point: it is what closes the gap
 * between the session layer and the durable layer.
 */
export function wonderlandUserIdFor(
  provider: WonderlandIdentityProvider,
  providerSubject: string,
): string | null {
  if (provider !== 'github') return null;
  if (!/^\d+$/.test(providerSubject)) return null;
  const id = `ghu-${providerSubject}`;
  return isWonderlandUserId(id) ? id : null;
}

/* ------------------------------------------------------------ preferences */

/**
 * Basic Wonderland preferences. Deliberately tiny — this is not a settings
 * system, it is the handful of things that should survive a machine change.
 */
export interface WonderlandPreferences {
  readonly reducedMotion: boolean;
  readonly terminalVisible: boolean;
  readonly preferredSessionName: string | null;
}

export const WONDERLAND_DEFAULT_PREFERENCES: WonderlandPreferences = Object.freeze({
  reducedMotion: false,
  terminalVisible: true,
  preferredSessionName: null,
});

/* ----------------------------------------------------------- owned state */

/**
 * WHAT THE USER OWNS — as REFERENCES, never as contents.
 *
 * Every field here is a list of ids. The projects live in the project store, the
 * creations in the Wonder Web store, the agents in whichever module owns them.
 * Copying any of it here would create a second copy that drifts, and would also
 * put a user's whole world inside the one record that the login path reads on
 * every request.
 *
 * `importedAgentIds` and `equippedAgentId` are REFERENCES to AI identities
 * another lane owns. This module stores that the user has them; it does not
 * store what they are.
 */
export interface WonderlandOwnedState {
  readonly projectIds: readonly string[];
  readonly creationIds: readonly string[];
  readonly projectAvatarIds: readonly string[];
  readonly importedAgentIds: readonly string[];
  readonly equippedAgentId: string | null;
  readonly commandPresetIds: readonly string[];
  /** The wallet, once Priority 5 issues one. One per account. */
  readonly walletId: string | null;
}

export const WONDERLAND_EMPTY_OWNED_STATE: WonderlandOwnedState = Object.freeze({
  projectIds: [],
  creationIds: [],
  projectAvatarIds: [],
  importedAgentIds: [],
  equippedAgentId: null,
  commandPresetIds: [],
  walletId: null,
});

/* --------------------------------------------------------------- the record */

export interface WonderlandAccount {
  readonly schemaVersion: WonderlandAccountSchemaVersion;
  /** `ghu-<id>`. The value every other store keys ownership by. */
  readonly userId: string;
  readonly displayName: string;
  readonly identityProvider: WonderlandIdentityProvider;
  /**
   * The provider's stable public subject — a numeric GitHub user id. NOT a
   * token, NOT an email, and deliberately not the login handle, which a user can
   * change out from under us.
   */
  readonly providerSubject: string;
  readonly status: WonderlandAccountStatus;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  /** Which private-beta wave admitted them. Null until enrolled. */
  readonly betaWave: RelayBetaWave | null;
  readonly betaEnrolledAt: string | null;
  readonly preferences: WonderlandPreferences;
  readonly owned: WonderlandOwnedState;
  readonly version: number;
  readonly checksum: string;
}

export type WonderlandAccountDraft = Omit<WonderlandAccount, 'checksum'>;

/**
 * FIELD NAMES THAT MUST NEVER APPEAR ON AN ACCOUNT.
 *
 * Named so a test can look for them. An account that grew a `token` field would
 * put a credential into the record that the login path reads, writes and logs
 * most often — which is the worst possible place for one.
 */
export const ACCOUNT_FORBIDDEN_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'secret',
  'clientSecret',
  'cvv',
  'cardNumber',
] as const;
