import { digestOf } from '../durable/durable-digest';
import type { DurableKeyValueBacking } from '../durable/durable-store';
import {
  SUPPORTED_WONDERLAND_ACCOUNT_SCHEMA_VERSIONS,
  WONDERLAND_ACCOUNT_STATUSES,
  isWonderlandUserId,
  type WonderlandAccount,
  type WonderlandAccountDraft,
} from './account-contracts';

/**
 * THE ACCOUNT STORE — the thing that was missing.
 *
 * Keyed by `userId`, which is derived from the identity provider's stable
 * subject, which means the key is reproducible from a fresh sign-in on a
 * different machine. That is what makes "leave, come back, everything is still
 * yours" true, and it is also the entire account-recovery mechanism: there is
 * nothing to reset because there is nothing secret to lose.
 *
 * `findByProviderSubject` exists because the sign-in path has a provider
 * subject and needs the account BEFORE it has decided the user id is valid.
 */

export function sealWonderlandAccount(
  draft: WonderlandAccountDraft | WonderlandAccount,
): WonderlandAccount {
  const { checksum: _stale, ...rest } = draft as WonderlandAccount;
  return { ...rest, checksum: digestOf(rest) };
}

export function wonderlandAccountDraftFrom(record: WonderlandAccount): WonderlandAccountDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export type WonderlandAccountReadResult =
  | { readonly ok: true; readonly record: WonderlandAccount }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

export function readWonderlandAccount(raw: unknown): WonderlandAccountReadResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored account is not an object' };
  }
  const candidate = raw as Record<string, unknown>;

  const version = candidate.schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'stored account declares no schema version' };
  }
  if (!(SUPPORTED_WONDERLAND_ACCOUNT_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, reason: 'unsupported_version', detail: version };
  }
  // A malformed user id must never read as absent: `undefined` would compare
  // unequal to every owner and look like a correct denial rather than a corrupt
  // record that has just detached a user from everything they own.
  if (!isWonderlandUserId(candidate.userId)) {
    return { ok: false, reason: 'corrupt', detail: 'stored account has no usable user id' };
  }
  if (typeof candidate.providerSubject !== 'string' || candidate.providerSubject === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored account names no provider subject' };
  }
  if (
    typeof candidate.status !== 'string' ||
    !(WONDERLAND_ACCOUNT_STATUSES as readonly string[]).includes(candidate.status)
  ) {
    return { ok: false, reason: 'corrupt', detail: 'stored account has an unknown status' };
  }
  if (candidate.owned === null || typeof candidate.owned !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored account has no owned-state record' };
  }
  if (typeof candidate.checksum !== 'string' || candidate.checksum === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored account carries no checksum' };
  }

  const record = candidate as unknown as WonderlandAccount;
  const { checksum, ...rest } = record;
  if (digestOf(rest) !== checksum) {
    return { ok: false, reason: 'corrupt', detail: 'stored account failed its checksum' };
  }
  return { ok: true, record };
}

export interface WonderlandAccountStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(userId: string): Promise<WonderlandAccountReadResult>;
  write(draft: WonderlandAccountDraft): Promise<{ ok: boolean; record?: WonderlandAccount; reason?: string }>;
  /** The sign-in lookup: provider subject -> account, or null for a new user. */
  findByProviderSubject(
    provider: string,
    providerSubject: string,
  ): Promise<WonderlandAccount | null>;
  listAllIds(): Promise<readonly string[]>;
}

const KEY_PREFIX = 'wonderland-account:';
const keyFor = (userId: string): string => `${KEY_PREFIX}${userId}`;

export function createWonderlandAccountStore(
  backing: DurableKeyValueBacking,
): WonderlandAccountStorePort {
  const readOne = async (userId: string): Promise<WonderlandAccountReadResult> => {
    let text: string | null;
    try {
      text = await backing.getText(keyFor(userId));
    } catch (error) {
      return { ok: false, reason: 'corrupt', detail: safeReason(error) };
    }
    if (text === null) return { ok: false, reason: 'not_found' };
    try {
      return readWonderlandAccount(JSON.parse(text));
    } catch {
      return { ok: false, reason: 'corrupt', detail: 'stored account is not valid JSON' };
    }
  };

  const allIds = async (): Promise<readonly string[]> => {
    try {
      const keys = await backing.listKeys();
      return keys.filter((k) => k.startsWith(KEY_PREFIX)).map((k) => k.slice(KEY_PREFIX.length));
    } catch {
      return [];
    }
  };

  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,
    read: readOne,

    async write(draft) {
      const record = sealWonderlandAccount(draft);
      try {
        await backing.putText(keyFor(record.userId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async findByProviderSubject(provider, providerSubject) {
      for (const id of await allIds()) {
        const result = await readOne(id);
        if (
          result.ok &&
          result.record.identityProvider === provider &&
          result.record.providerSubject === providerSubject
        ) {
          return result.record;
        }
      }
      return null;
    },

    listAllIds: allIds,
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable account write failed';
  }
  return 'durable account write failed';
}
