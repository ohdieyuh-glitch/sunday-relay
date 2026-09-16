import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import type { RelayBetaWave } from '../beta';
import {
  WONDERLAND_ACCOUNT_SCHEMA_VERSION,
  WONDERLAND_DEFAULT_PREFERENCES,
  WONDERLAND_EMPTY_OWNED_STATE,
  isWonderlandUserId,
  wonderlandUserIdFor,
  type WonderlandAccountDraft,
  type WonderlandIdentityProvider,
  type WonderlandOwnedState,
  type WonderlandPreferences,
} from './account-contracts';

/**
 * SIGN IN, RETURN, AND OWN THINGS.
 *
 * Pure and total. The bridge performs the OAuth exchange and hands this module a
 * verified provider subject; this module decides what the durable account looks
 * like afterwards. The exchange and the record are deliberately on opposite
 * sides of that line — nothing here can perform a network call, so nothing here
 * can be tricked into treating an unverified claim as an identity.
 */

/* -------------------------------------------------------------- sign in */

export interface VerifiedIdentity {
  readonly provider: WonderlandIdentityProvider;
  /** Verified by the bridge against the provider. Never taken from a client. */
  readonly providerSubject: string;
  readonly displayName: string;
}

export type SignInOutcome =
  | { readonly kind: 'created'; readonly account: WonderlandAccountDraft }
  | { readonly kind: 'returned'; readonly account: WonderlandAccountDraft };

/**
 * FIRST SIGN-IN AND EVERY SIGN-IN AFTER IT, in one function.
 *
 * `existing === null` means we have never seen this person; anything else means
 * they are back. Returning a discriminated outcome rather than a bare account
 * lets the caller tell a new user from a returning one without comparing
 * timestamps — and it makes the "same account is recovered" property the thing
 * the type expresses.
 *
 * A RETURNING USER'S OWNED STATE IS NEVER REBUILT. Only `lastSeenAt` and the
 * display name move. That is the guarantee the whole priority exists for: leave,
 * come back, and the projects are still yours.
 */
export function signInToWonderland(input: {
  readonly identity: VerifiedIdentity;
  readonly existing: WonderlandAccountDraft | null;
  readonly atIso: string;
}): RelayResult<SignInOutcome> {
  const userId = wonderlandUserIdFor(input.identity.provider, input.identity.providerSubject);
  if (userId === null) {
    return fail(
      relayError('validation-failed', 'That identity does not yield a usable Wonderland user id.'),
    );
  }
  const displayName = input.identity.displayName.trim() === ''
    ? userId
    : input.identity.displayName.trim();

  if (input.existing === null) {
    return ok({
      kind: 'created',
      account: {
        schemaVersion: WONDERLAND_ACCOUNT_SCHEMA_VERSION,
        userId,
        displayName,
        identityProvider: input.identity.provider,
        providerSubject: input.identity.providerSubject,
        status: 'ACTIVE',
        createdAt: input.atIso,
        lastSeenAt: input.atIso,
        betaWave: null,
        betaEnrolledAt: null,
        preferences: WONDERLAND_DEFAULT_PREFERENCES,
        owned: WONDERLAND_EMPTY_OWNED_STATE,
        version: 1,
      },
    });
  }

  // The stored account must actually belong to this identity. A mismatch here
  // means the caller looked up the wrong record, and continuing would sign
  // somebody into a stranger's account.
  if (input.existing.userId !== userId) {
    return fail(
      relayError('permission-denied', 'The stored account does not belong to this identity.', {
        entityIds: { userId },
      }),
    );
  }
  if (input.existing.status === 'SUSPENDED') {
    return fail(
      relayError('permission-denied', 'This Wonderland account is suspended.', {
        entityIds: { userId },
      }),
    );
  }

  return ok({
    kind: 'returned',
    account: {
      ...input.existing,
      displayName,
      lastSeenAt: input.atIso,
      version: input.existing.version + 1,
    },
  });
}

/**
 * SIGN OUT.
 *
 * Deliberately does almost nothing to the account, and that is the correct
 * behaviour: signing out ends a SESSION, and the session lives in the bridge.
 * Destroying durable state on logout is how a user loses their work by pressing
 * the wrong button. The only durable effect is the timestamp.
 */
export function signOutOfWonderland(
  account: WonderlandAccountDraft,
  atIso: string,
): WonderlandAccountDraft {
  return { ...account, lastSeenAt: atIso, version: account.version + 1 };
}

/* --------------------------------------------------------- beta access */

/**
 * Record that this account was admitted to a private-beta wave.
 *
 * The DECISION is not made here — `mission/beta` already owns wave state, seat
 * counting and the six refusal reasons, and reimplementing any of that would
 * create a second opinion about who is allowed in. This function only writes
 * down the outcome.
 */
export function enrolAccountInBetaWave(
  account: WonderlandAccountDraft,
  wave: RelayBetaWave,
  atIso: string,
): RelayResult<WonderlandAccountDraft> {
  if (account.betaWave !== null) {
    return fail(
      relayError('validation-failed', `This account is already enrolled in ${account.betaWave}.`, {
        entityIds: { userId: account.userId },
      }),
    );
  }
  return ok({
    ...account,
    betaWave: wave,
    betaEnrolledAt: atIso,
    version: account.version + 1,
  });
}

export function suspendAccount(
  account: WonderlandAccountDraft,
  atIso: string,
): WonderlandAccountDraft {
  return { ...account, status: 'SUSPENDED', lastSeenAt: atIso, version: account.version + 1 };
}

export function restoreAccount(
  account: WonderlandAccountDraft,
  atIso: string,
): WonderlandAccountDraft {
  return { ...account, status: 'ACTIVE', lastSeenAt: atIso, version: account.version + 1 };
}

/* ---------------------------------------------------------- owned state */

/** The reference lists an account may accumulate. Keyed so each has one path. */
export type OwnedReferenceKind =
  | 'projectIds'
  | 'creationIds'
  | 'projectAvatarIds'
  | 'importedAgentIds'
  | 'commandPresetIds';

/**
 * Attach a reference the account owns. Idempotent — attaching twice does not
 * append a duplicate id that a later reader would count twice.
 */
export function attachOwnedReference(
  account: WonderlandAccountDraft,
  kind: OwnedReferenceKind,
  id: string,
): RelayResult<WonderlandAccountDraft> {
  if (id.trim() === '') {
    return fail(relayError('validation-failed', 'A reference needs an id.'));
  }
  const current = account.owned[kind];
  if (current.includes(id)) return ok(account);
  const owned: WonderlandOwnedState = { ...account.owned, [kind]: [...current, id] };
  return ok({ ...account, owned, version: account.version + 1 });
}

export function detachOwnedReference(
  account: WonderlandAccountDraft,
  kind: OwnedReferenceKind,
  id: string,
): WonderlandAccountDraft {
  const current = account.owned[kind];
  if (!current.includes(id)) return account;
  const owned: WonderlandOwnedState = {
    ...account.owned,
    [kind]: current.filter((candidate) => candidate !== id),
  };
  return { ...account, owned, version: account.version + 1 };
}

/** Equip an imported AI. Refuses one the account has not imported. */
export function equipAgent(
  account: WonderlandAccountDraft,
  agentId: string | null,
): RelayResult<WonderlandAccountDraft> {
  if (agentId !== null && !account.owned.importedAgentIds.includes(agentId)) {
    return fail(
      relayError('permission-denied', 'This account has not imported that agent.', {
        entityIds: { userId: account.userId, agentId },
      }),
    );
  }
  return ok({
    ...account,
    owned: { ...account.owned, equippedAgentId: agentId },
    version: account.version + 1,
  });
}

/** Bind the account's one wallet. Refuses to silently replace an existing one. */
export function bindWallet(
  account: WonderlandAccountDraft,
  walletId: string,
): RelayResult<WonderlandAccountDraft> {
  if (account.owned.walletId !== null && account.owned.walletId !== walletId) {
    return fail(
      relayError('immutable', 'This account already has a wallet.', {
        entityIds: { userId: account.userId, walletId: account.owned.walletId },
      }),
    );
  }
  return ok({
    ...account,
    owned: { ...account.owned, walletId },
    version: account.version + 1,
  });
}

export function updatePreferences(
  account: WonderlandAccountDraft,
  preferences: Partial<WonderlandPreferences>,
): WonderlandAccountDraft {
  return {
    ...account,
    preferences: { ...account.preferences, ...preferences },
    version: account.version + 1,
  };
}

/* ------------------------------------------------- multiplayer identity */

/**
 * The identity this account presents in a multiplayer session.
 *
 * Exactly two fields, and that is the point: a session needs to know who you are
 * and what to call you, and nothing else about you should travel to other
 * players. Returning a purpose-built pair rather than the account itself means
 * a caller cannot accidentally hand the whole record to the replication layer.
 */
export interface WonderlandMultiplayerIdentity {
  readonly userId: string;
  readonly displayName: string;
}

export function multiplayerIdentityOf(
  account: WonderlandAccountDraft,
): WonderlandMultiplayerIdentity {
  return { userId: account.userId, displayName: account.displayName };
}

/** True when this account may enter Wonderland at all. */
export function accountMayEnterWonderland(account: WonderlandAccountDraft): boolean {
  return account.status === 'ACTIVE' && isWonderlandUserId(account.userId);
}
