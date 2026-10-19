/**
 * THE WONDERLAND WEB WALLET — the financial permission layer.
 *
 * Eventually this is what lets a user say "Julius, turn this design into a shirt
 * and mail it to my house" and have that be safe. For the private beta it is the
 * FOUNDATION: a wallet bound to a persistent account, an append-only ledger that
 * is the authority on balance, explicit spending permissions Julius cannot talk
 * its way around, and a purchase flow that cannot charge twice.
 *
 * FIVE RULES THIS FILE ENCODES, each of which is a way money gets lost:
 *
 *   1. MONEY IS AN INTEGER. Every amount is minor units (cents) as a whole
 *      number. Floating point is not used anywhere in this module for any
 *      reason. `0.1 + 0.2 !== 0.3` is not a curiosity when it is somebody's
 *      money, and a rounding convention applied in two places is a rounding
 *      convention applied two different ways.
 *
 *   2. THE LEDGER IS THE AUTHORITY. The wallet record carries balances, but they
 *      are a CACHE. `deriveBalance` recomputes from entries, and a test asserts
 *      the two agree after every operation. A displayed balance that is its own
 *      source of truth is a balance that can drift from what was actually spent.
 *
 *   3. FUNDS ARE RESERVED BEFORE THEY ARE SPENT. Reservation is a real ledger
 *      entry, not a flag, so two concurrent purchases cannot both see the same
 *      dollar as available.
 *
 *   4. EVERY COMMERCE OPERATION CARRIES AN IDEMPOTENCY KEY. A retry is not a
 *      second purchase. This is the rule the Continuation Loop depends on.
 *
 *   5. FUNDS EXISTING IS NOT PERMISSION TO SPEND THEM. Policy is evaluated
 *      separately from balance, and both must pass. Julius must never infer
 *      financial permission from conversational enthusiasm.
 *
 * PURE. No clock, no network, no provider. A commerce provider is an adapter the
 * caller supplies; nothing here knows what a printing company is.
 */

/* ------------------------------------------------------------- versioning */

export const WONDERLAND_WALLET_SCHEMA_V1 = 'relay-wonderland-wallet.v1' as const;
export const WONDERLAND_WALLET_SCHEMA_VERSION = WONDERLAND_WALLET_SCHEMA_V1;
export const SUPPORTED_WONDERLAND_WALLET_SCHEMA_VERSIONS = [
  WONDERLAND_WALLET_SCHEMA_V1,
] as const;
export type WonderlandWalletSchemaVersion =
  (typeof SUPPORTED_WONDERLAND_WALLET_SCHEMA_VERSIONS)[number];

/* ----------------------------------------------------------------- money */

/**
 * Currency, as a closed vocabulary. One member today — adding a second is a
 * deliberate act that forces every conversion question to be answered, rather
 * than a free string that lets two currencies silently add together.
 */
export const WONDERLAND_CURRENCIES = ['USD'] as const;
export type WonderlandCurrency = (typeof WONDERLAND_CURRENCIES)[number];

/**
 * An amount of money. ALWAYS minor units, ALWAYS a non-negative integer.
 *
 * Direction is carried by the ledger ENTRY TYPE, never by the sign of an amount:
 * a negative credit and a positive debit would be the same thing written two
 * ways, and a reader would have to know which convention a given row used.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: WonderlandCurrency;
}

export const ZERO_USD: Money = Object.freeze({ amountMinor: 0, currency: 'USD' });

export function isValidMoney(value: Money): boolean {
  return (
    Number.isSafeInteger(value.amountMinor) &&
    value.amountMinor >= 0 &&
    (WONDERLAND_CURRENCIES as readonly string[]).includes(value.currency)
  );
}

/** Display only. Never used for arithmetic, never parsed back. */
export function formatMoney(value: Money): string {
  const whole = Math.floor(value.amountMinor / 100);
  const part = String(value.amountMinor % 100).padStart(2, '0');
  return `$${whole}.${part}`;
}

/* -------------------------------------------------------------- funding */

/**
 * WHERE THE MONEY COMES FROM.
 *
 * `SANDBOX` is the only funding source this build has, and it is labelled
 * everywhere it is shown. Real-money custody is deliberately NOT implemented:
 * building an unlicensed custody or payment network is not something to do by
 * accident, and a provider abstraction is the right shape for integrating a
 * licensed one later.
 */
export const WONDERLAND_FUNDING_SOURCES = ['SANDBOX', 'PROVIDER'] as const;
export type WonderlandFundingSource = (typeof WONDERLAND_FUNDING_SOURCES)[number];

/** Rendered wherever a sandbox balance is shown. Not decoration — a claim. */
export const SANDBOX_FUNDS_LABEL = 'DEVELOPMENT / SANDBOX FUNDS — NOT REAL MONEY';

/** The deterministic starting balance for a private-beta sandbox wallet. */
export const SANDBOX_OPENING_BALANCE_MINOR = 50_000;

/* --------------------------------------------------------------- ledger */

/**
 * THE SEVEN ENTRY TYPES.
 *
 * `RESERVATION` holds funds; `RESERVATION_RELEASE` returns them; `PURCHASE`
 * converts a held reservation into a settled debit. Keeping those three separate
 * is what makes a failed purchase recoverable without guessing: the ledger says
 * whether money was held, returned, or actually spent.
 */
export const WALLET_ENTRY_TYPES = [
  'CREDIT',
  'DEBIT',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'PURCHASE',
  'REFUND',
  'ADJUSTMENT',
] as const;
export type WalletEntryType = (typeof WALLET_ENTRY_TYPES)[number];

/**
 * WHO AUTHORIZED THIS.
 *
 * `julius_autonomous` means a policy permitted it with no human present.
 * `user_approved` means a human said yes to a specific request. The distinction
 * is the audit trail's most important column — "why did Julius spend $42" is
 * answered first by this field.
 */
export const WALLET_AUTHORIZATION_SOURCES = [
  'system',
  'user_direct',
  'user_approved',
  'julius_autonomous',
] as const;
export type WalletAuthorizationSource = (typeof WALLET_AUTHORIZATION_SOURCES)[number];

/**
 * One immutable row. Entries are APPENDED and never edited — a correction is a
 * new `ADJUSTMENT`, so the history of what was believed remains readable.
 */
export interface WalletLedgerEntry {
  readonly entryId: string;
  readonly walletId: string;
  readonly type: WalletEntryType;
  readonly amount: Money;
  readonly occurredAtIso: string;
  /**
   * THE DUPLICATE GUARD. Two appends with the same key are the same event, and
   * the second one is dropped rather than applied. This is what makes a retry
   * after a lost connection safe.
   */
  readonly idempotencyKey: string;
  /** A human-readable sentence. Never a raw provider payload. */
  readonly reference: string;
  readonly authorizationSource: WalletAuthorizationSource;
  /** Set when a reservation, purchase or release belongs to one purchase. */
  readonly purchaseId: string | null;
  readonly missionId: string | null;
  readonly projectId: string | null;
  readonly merchantRef: string | null;
  readonly orderRef: string | null;
}

/* --------------------------------------------------------------- policy */

/**
 * WHAT JULIUS MAY SPEND WITHOUT ASKING.
 *
 * Deliberately small. The direction was explicit that a smaller permission model
 * proving the architecture beats dozens of confusing controls, so this is four
 * limits and three switches, and every one of them is a sentence a user can read
 * back to themselves.
 *
 * `enabled: false` is the DEFAULT and means no autonomous spend at all. A wallet
 * with funds and no policy spends nothing.
 */
export interface JuliusSpendingPolicy {
  readonly enabled: boolean;
  readonly maxPerTransaction: Money;
  readonly maxPerDay: Money;
  readonly maxPerMission: Money;
  /** Above this, a human approves even when the limits would allow it. */
  readonly requiresConfirmationAbove: Money;
  readonly physicalGoodsAllowed: boolean;
  readonly digitalGoodsAllowed: boolean;
  /** Recurring charges are a different risk and are off unless chosen. */
  readonly recurringPurchasesAllowed: boolean;
  /** Empty means NO category is allowed — fail closed, like every other grant. */
  readonly allowedCategories: readonly PurchaseCategory[];
  /** Empty means no merchant is pre-approved. */
  readonly allowedMerchants: readonly string[];
}

/** The fail-closed default. A new wallet gets this, not a permissive one. */
export const JULIUS_SPEND_DISABLED: JuliusSpendingPolicy = Object.freeze({
  enabled: false,
  maxPerTransaction: ZERO_USD,
  maxPerDay: ZERO_USD,
  maxPerMission: ZERO_USD,
  requiresConfirmationAbove: ZERO_USD,
  physicalGoodsAllowed: false,
  digitalGoodsAllowed: false,
  recurringPurchasesAllowed: false,
  allowedCategories: [],
  allowedMerchants: [],
});

export const PURCHASE_CATEGORIES = [
  'physical_print',
  'physical_plush',
  'physical_figure',
  'digital_asset',
  'service',
  'other',
] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

/** Which categories are physical goods. Used to apply the physical switch. */
export const PHYSICAL_CATEGORIES: readonly PurchaseCategory[] = [
  'physical_print',
  'physical_plush',
  'physical_figure',
];

/* -------------------------------------------------------------- rights */

/**
 * THE PRE-PURCHASE RIGHTS HOOK.
 *
 * A reference image does not imply the right to manufacture it. Before anything
 * is physically produced, the pipeline must be able to say which of these it is
 * — and `REQUIRES_RIGHTS_REVIEW` is the DEFAULT, because "we did not classify
 * it" must never behave like "it is fine".
 *
 * The wallet does not bypass this simply because funds are available. A purchase
 * of a physical good whose rights are unresolved is refused at policy time.
 */
export const RIGHTS_CLASSIFICATIONS = [
  'REQUIRES_RIGHTS_REVIEW',
  'AUTHORIZED_ORIGINAL',
  'USER_OWNS_RIGHTS',
  'LICENSED',
  'TRANSFORMED_ORIGINAL_DESIGN',
] as const;
export type RightsClassification = (typeof RIGHTS_CLASSIFICATIONS)[number];

/** The classifications that permit manufacturing. Everything else does not. */
export const RIGHTS_CLEARED_FOR_MANUFACTURE: readonly RightsClassification[] = [
  'AUTHORIZED_ORIGINAL',
  'USER_OWNS_RIGHTS',
  'LICENSED',
  'TRANSFORMED_ORIGINAL_DESIGN',
];

/* ------------------------------------------------------------- purchase */

/**
 * THE CONTINUATION STATES.
 *
 * These exist so a mission interrupted mid-purchase can be resumed SAFELY. The
 * critical one is `SUBMITTED`: the request reached the merchant and the outcome
 * is unknown. A resumed mission must RECONCILE that against the provider, never
 * retry it — "I do not know what happened" is not permission to charge somebody
 * a second time.
 */
export const PURCHASE_STATES = [
  'NOT_STARTED',
  'AUTHORIZED',
  'FUNDS_RESERVED',
  'SUBMITTED',
  'PURCHASED',
  'FAILED',
  'REFUNDED',
] as const;
export type PurchaseState = (typeof PURCHASE_STATES)[number];

/** States from which a blind retry would risk a double charge. */
export const PURCHASE_STATES_REQUIRING_RECONCILIATION: readonly PurchaseState[] = ['SUBMITTED'];

/** A merchant's price for a specific thing, at a moment. */
export interface PurchaseQuote {
  readonly quoteId: string;
  readonly merchantId: string;
  readonly itemDescription: string;
  readonly category: PurchaseCategory;
  readonly itemPrice: Money;
  readonly shipping: Money;
  readonly tax: Money;
  readonly total: Money;
  readonly quotedAtIso: string;
  readonly expiresAtIso: string | null;
}

export interface PurchaseIntent {
  readonly purchaseId: string;
  readonly walletId: string;
  readonly ownerUserId: string;
  readonly quote: PurchaseQuote;
  readonly state: PurchaseState;
  readonly rights: RightsClassification;
  readonly missionId: string | null;
  readonly projectId: string | null;
  readonly creationId: string | null;
  /** The amount actually authorized. A later quote above this needs new authority. */
  readonly authorizedTotal: Money;
  readonly authorizationSource: WalletAuthorizationSource;
  /** Stable across retries. The same intent always presents the same key. */
  readonly idempotencyKey: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly merchantOrderRef: string | null;
  readonly failureReason: string | null;
}

/* ---------------------------------------------------------------- wallet */

export const WALLET_STATUSES = ['ACTIVE', 'FROZEN', 'CLOSED'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export interface WonderlandWallet {
  readonly schemaVersion: WonderlandWalletSchemaVersion;
  readonly walletId: string;
  /** The persistent Wonderland account. Never a display name, never a session. */
  readonly ownerUserId: string;
  readonly status: WalletStatus;
  readonly currency: WonderlandCurrency;
  readonly fundingSource: WonderlandFundingSource;
  /**
   * CACHED, and labelled as such. `deriveBalance` over the ledger is the
   * authority, and a test asserts these agree after every operation.
   */
  readonly availableBalance: Money;
  readonly reservedBalance: Money;
  readonly policy: JuliusSpendingPolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly checksum: string;
}

export type WonderlandWalletDraft = Omit<WonderlandWallet, 'checksum'>;

/* -------------------------------------------------------------- receipts */

/**
 * WHY DID JULIUS SPEND $42.
 *
 * Every field needed to answer that exactly, including whether a human approved
 * it and which mission caused it. A receipt is durable evidence, not a
 * notification.
 */
export interface PurchaseReceipt {
  readonly receiptId: string;
  readonly purchaseId: string;
  readonly walletId: string;
  readonly ownerUserId: string;
  readonly merchantId: string;
  readonly orderRef: string;
  readonly itemDescription: string;
  readonly category: PurchaseCategory;
  readonly itemPrice: Money;
  readonly shipping: Money;
  readonly tax: Money;
  readonly total: Money;
  readonly occurredAtIso: string;
  readonly missionId: string | null;
  readonly projectId: string | null;
  readonly authorizationSource: WalletAuthorizationSource;
  readonly humanApprovalRequired: boolean;
  readonly rights: RightsClassification;
  readonly refunded: boolean;
}

/** Field names a wallet record or receipt must NEVER carry. */
export const WALLET_FORBIDDEN_FIELDS = [
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'expiry',
  'bankAccount',
  'routingNumber',
  'iban',
  'bankPassword',
  'providerSecret',
  'apiKey',
] as const;
