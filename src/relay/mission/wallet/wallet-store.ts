import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import { digestOf } from '../durable/durable-digest';
import type { DurableKeyValueBacking } from '../durable/durable-store';
import {
  JULIUS_SPEND_DISABLED,
  SANDBOX_OPENING_BALANCE_MINOR,
  SUPPORTED_WONDERLAND_WALLET_SCHEMA_VERSIONS,
  WALLET_STATUSES,
  WONDERLAND_WALLET_SCHEMA_VERSION,
  ZERO_USD,
  type JuliusSpendingPolicy,
  type WalletLedgerEntry,
  type WonderlandWallet,
  type WonderlandWalletDraft,
} from './wallet-contracts';
import { appendLedgerEntry, deriveBalance } from './wallet-ledger';

/**
 * WALLET CREATION, THE CACHED BALANCE, AND DURABILITY.
 *
 * `syncBalances` is the only function permitted to write the cached balance
 * fields, and it computes them from the ledger. Nothing else assigns them, so
 * the cache cannot be updated by one code path and missed by another — which is
 * the specific way a displayed balance drifts from what was actually spent.
 */

/* --------------------------------------------------------------- create */

/**
 * Open a SANDBOX wallet.
 *
 * Deterministic opening balance, `fundingSource: 'SANDBOX'`, and a policy of
 * `JULIUS_SPEND_DISABLED`. A new wallet holds money and permits nothing — the
 * user switches spending on deliberately, which is the only safe default for a
 * system that will eventually place real orders.
 *
 * REAL-MONEY FUNDING IS NOT IMPLEMENTED and cannot be selected here. Integrating
 * a licensed payment provider is a founder decision with real consequences, and
 * a function that could quietly produce a `PROVIDER` wallet is how that decision
 * would get made by accident.
 */
export function openSandboxWallet(input: {
  readonly walletId: string;
  readonly ownerUserId: string;
  readonly createdAtIso: string;
  readonly openingBalanceMinor?: number;
}): RelayResult<{ readonly wallet: WonderlandWalletDraft; readonly entries: readonly WalletLedgerEntry[] }> {
  if (input.walletId.trim() === '') {
    return fail(relayError('validation-failed', 'A wallet needs an id.'));
  }
  if (input.ownerUserId.trim() === '') {
    return fail(relayError('validation-failed', 'A wallet must name the account that owns it.'));
  }
  const opening = input.openingBalanceMinor ?? SANDBOX_OPENING_BALANCE_MINOR;
  if (!Number.isSafeInteger(opening) || opening < 0) {
    return fail(relayError('validation-failed', 'An opening balance must be a non-negative integer.'));
  }

  const seeded = appendLedgerEntry(
    [],
    {
      entryId: `led_${input.walletId}_opening`,
      walletId: input.walletId,
      type: 'CREDIT',
      amount: { amountMinor: opening, currency: 'USD' },
      occurredAtIso: input.createdAtIso,
      idempotencyKey: `${input.walletId}:opening`,
      reference: 'Sandbox opening balance. Development funds, not real money.',
      authorizationSource: 'system',
      purchaseId: null,
      missionId: null,
      projectId: null,
      merchantRef: null,
      orderRef: null,
    },
    'USD',
  );
  if (!seeded.ok) return seeded;

  const wallet: WonderlandWalletDraft = {
    schemaVersion: WONDERLAND_WALLET_SCHEMA_VERSION,
    walletId: input.walletId,
    ownerUserId: input.ownerUserId,
    status: 'ACTIVE',
    currency: 'USD',
    fundingSource: 'SANDBOX',
    availableBalance: ZERO_USD,
    reservedBalance: ZERO_USD,
    policy: JULIUS_SPEND_DISABLED,
    createdAt: input.createdAtIso,
    updatedAt: input.createdAtIso,
    version: 1,
  };

  return ok({ wallet: syncBalances(wallet, seeded.value.entries), entries: seeded.value.entries });
}

/**
 * THE ONLY WRITER OF THE CACHED BALANCES. Always from the ledger, never from an
 * increment.
 */
export function syncBalances(
  wallet: WonderlandWalletDraft,
  entries: readonly WalletLedgerEntry[],
): WonderlandWalletDraft {
  const derived = deriveBalance(entries, wallet.currency);
  return {
    ...wallet,
    availableBalance: derived.available,
    reservedBalance: derived.reserved,
    version: wallet.version + 1,
  };
}

/** Set the spending policy. Only the owner; the caller checks that first. */
export function setSpendingPolicy(
  wallet: WonderlandWalletDraft,
  policy: JuliusSpendingPolicy,
  atIso: string,
): RelayResult<WonderlandWalletDraft> {
  for (const limit of [
    policy.maxPerTransaction, policy.maxPerDay,
    policy.maxPerMission, policy.requiresConfirmationAbove,
  ]) {
    if (!Number.isSafeInteger(limit.amountMinor) || limit.amountMinor < 0) {
      return fail(relayError('validation-failed', 'Every spending limit must be a non-negative integer.'));
    }
    if (limit.currency !== wallet.currency) {
      return fail(relayError('validation-failed', 'A spending limit must match the wallet currency.'));
    }
  }
  // A per-transaction ceiling above the daily one cannot be honoured and would
  // read to a user as permission they do not actually have.
  if (policy.enabled && policy.maxPerTransaction.amountMinor > policy.maxPerDay.amountMinor) {
    return fail(
      relayError('validation-failed', 'A per-transaction limit cannot exceed the daily limit.'),
    );
  }
  return ok({ ...wallet, policy, updatedAt: atIso, version: wallet.version + 1 });
}

/* ------------------------------------------------------------ durability */

export function sealWonderlandWallet(
  draft: WonderlandWalletDraft | WonderlandWallet,
): WonderlandWallet {
  const { checksum: _stale, ...rest } = draft as WonderlandWallet;
  return { ...rest, checksum: digestOf(rest) };
}

export type WonderlandWalletReadResult =
  | { readonly ok: true; readonly record: WonderlandWallet }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

export function readWonderlandWallet(raw: unknown): WonderlandWalletReadResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet is not an object' };
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.schemaVersion !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet declares no schema version' };
  }
  if (!(SUPPORTED_WONDERLAND_WALLET_SCHEMA_VERSIONS as readonly string[]).includes(candidate.schemaVersion)) {
    return { ok: false, reason: 'unsupported_version', detail: candidate.schemaVersion };
  }
  if (typeof candidate.walletId !== 'string' || candidate.walletId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet has no id' };
  }
  // An owner that reads as absent would detach a wallet from its person and
  // compare unequal to everyone — which looks like a correct denial.
  if (typeof candidate.ownerUserId !== 'string' || candidate.ownerUserId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet names no owning account' };
  }
  if (
    typeof candidate.status !== 'string' ||
    !(WALLET_STATUSES as readonly string[]).includes(candidate.status)
  ) {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet has an unknown status' };
  }
  if (candidate.policy === null || typeof candidate.policy !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet has no spending policy' };
  }
  if (typeof candidate.checksum !== 'string' || candidate.checksum === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet carries no checksum' };
  }
  const record = candidate as unknown as WonderlandWallet;
  const { checksum, ...rest } = record;
  if (digestOf(rest) !== checksum) {
    return { ok: false, reason: 'corrupt', detail: 'stored wallet failed its checksum' };
  }
  return { ok: true, record };
}

export interface WonderlandWalletStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(walletId: string): Promise<WonderlandWalletReadResult>;
  write(draft: WonderlandWalletDraft): Promise<{ ok: boolean; record?: WonderlandWallet; reason?: string }>;
  readLedger(walletId: string): Promise<readonly WalletLedgerEntry[]>;
  writeLedger(walletId: string, entries: readonly WalletLedgerEntry[]): Promise<boolean>;
  findByOwner(ownerUserId: string): Promise<WonderlandWallet | null>;
}

const WALLET_PREFIX = 'wonderland-wallet:';
const LEDGER_PREFIX = 'wonderland-ledger:';

export function createWonderlandWalletStore(
  backing: DurableKeyValueBacking,
): WonderlandWalletStorePort {
  const readOne = async (walletId: string): Promise<WonderlandWalletReadResult> => {
    let text: string | null;
    try {
      text = await backing.getText(`${WALLET_PREFIX}${walletId}`);
    } catch {
      return { ok: false, reason: 'corrupt', detail: 'wallet read failed' };
    }
    if (text === null) return { ok: false, reason: 'not_found' };
    try {
      return readWonderlandWallet(JSON.parse(text));
    } catch {
      return { ok: false, reason: 'corrupt', detail: 'stored wallet is not valid JSON' };
    }
  };

  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,
    read: readOne,

    async write(draft) {
      const record = sealWonderlandWallet(draft);
      try {
        await backing.putText(`${WALLET_PREFIX}${record.walletId}`, JSON.stringify(record));
      } catch {
        return { ok: false, reason: 'durable wallet write failed' };
      }
      return { ok: true, record };
    },

    async readLedger(walletId) {
      try {
        const text = await backing.getText(`${LEDGER_PREFIX}${walletId}`);
        if (text === null) return [];
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? (parsed as WalletLedgerEntry[]) : [];
      } catch {
        return [];
      }
    },

    async writeLedger(walletId, entries) {
      try {
        await backing.putText(`${LEDGER_PREFIX}${walletId}`, JSON.stringify(entries));
        return true;
      } catch {
        return false;
      }
    },

    async findByOwner(ownerUserId) {
      let keys: readonly string[];
      try {
        keys = await backing.listKeys();
      } catch {
        return null;
      }
      for (const key of keys.filter((k) => k.startsWith(WALLET_PREFIX))) {
        const result = await readOne(key.slice(WALLET_PREFIX.length));
        if (result.ok && result.record.ownerUserId === ownerUserId) return result.record;
      }
      return null;
    },
  };
}
