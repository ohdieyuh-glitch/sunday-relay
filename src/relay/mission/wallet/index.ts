/**
 * THE WONDERLAND WEB WALLET — the barrel.
 *
 * A wallet bound to a persistent account, an append-only ledger that is the
 * authority on balance, explicit spending permissions Julius cannot argue its
 * way around, and a purchase flow that cannot charge twice.
 *
 * SANDBOX ONLY. Real-money custody is not implemented and cannot be selected.
 * A licensed payment provider integrates behind `CommerceProviderPort` when the
 * founder decides to activate one.
 */

export {
  JULIUS_SPEND_DISABLED,
  PHYSICAL_CATEGORIES,
  PURCHASE_CATEGORIES,
  PURCHASE_STATES,
  PURCHASE_STATES_REQUIRING_RECONCILIATION,
  RIGHTS_CLASSIFICATIONS,
  RIGHTS_CLEARED_FOR_MANUFACTURE,
  SANDBOX_FUNDS_LABEL,
  SANDBOX_OPENING_BALANCE_MINOR,
  SUPPORTED_WONDERLAND_WALLET_SCHEMA_VERSIONS,
  WALLET_AUTHORIZATION_SOURCES,
  WALLET_ENTRY_TYPES,
  WALLET_FORBIDDEN_FIELDS,
  WALLET_STATUSES,
  WONDERLAND_CURRENCIES,
  WONDERLAND_FUNDING_SOURCES,
  WONDERLAND_WALLET_SCHEMA_V1,
  WONDERLAND_WALLET_SCHEMA_VERSION,
  ZERO_USD,
  formatMoney,
  isValidMoney,
} from './wallet-contracts';
export type {
  JuliusSpendingPolicy,
  Money,
  PurchaseCategory,
  PurchaseIntent,
  PurchaseQuote,
  PurchaseReceipt,
  PurchaseState,
  RightsClassification,
  WalletAuthorizationSource,
  WalletEntryType,
  WalletLedgerEntry,
  WalletStatus,
  WonderlandCurrency,
  WonderlandFundingSource,
  WonderlandWallet,
  WonderlandWalletDraft,
  WonderlandWalletSchemaVersion,
} from './wallet-contracts';

export {
  appendLedgerEntry,
  deriveBalance,
  entriesForPurchase,
  explainSpend,
  spentOnDay,
  spentOnMission,
} from './wallet-ledger';
export type { DerivedBalance, LedgerAppendResult } from './wallet-ledger';

export {
  POLICY_REFUSALS,
  buildApprovalRequest,
  evaluateSpendingPolicy,
} from './wallet-policy';
export type {
  PolicyDecision,
  PolicyEvaluationInput,
  PolicyRefusal,
  PurchaseApprovalRequest,
} from './wallet-policy';

export {
  assertWalletOwner,
  authorizePurchase,
  commitPurchase,
  failPurchase,
  isLegalPurchaseTransition,
  markPurchaseSubmitted,
  reconcileSubmittedPurchase,
  refundPurchase,
  reserveFundsForPurchase,
} from './wallet-purchase';
export type {
  AuthorizeOutcome,
  AuthorizePurchaseInput,
  MerchantOutcome,
  PurchaseStep,
} from './wallet-purchase';

export {
  createWonderlandWalletStore,
  openSandboxWallet,
  readWonderlandWallet,
  sealWonderlandWallet,
  setSpendingPolicy,
  syncBalances,
} from './wallet-store';
export type {
  WonderlandWalletReadResult,
  WonderlandWalletStorePort,
} from './wallet-store';

export {
  CONSERVATIVE_RIGHTS_CLASSIFIER,
  explainReceipt,
  summarisePolicy,
  summariseWallet,
} from './wallet-julius';
export type {
  CommerceProviderPort,
  JuliusWalletPort,
  RequestPurchaseInput,
  RequestPurchaseResult,
  RightsClassifierPort,
  SpendingPolicySummary,
  WalletSummary,
} from './wallet-julius';
