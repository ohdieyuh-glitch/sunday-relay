import { describe, expect, it } from 'vitest';
import { createInMemoryDurableBacking } from '../durable/durable-store';
import {
  JULIUS_SPEND_DISABLED,
  SANDBOX_FUNDS_LABEL,
  WALLET_FORBIDDEN_FIELDS,
  appendLedgerEntry,
  assertWalletOwner,
  authorizePurchase,
  commitPurchase,
  createWonderlandWalletStore,
  deriveBalance,
  evaluateSpendingPolicy,
  explainReceipt,
  explainSpend,
  failPurchase,
  formatMoney,
  markPurchaseSubmitted,
  openSandboxWallet,
  reconcileSubmittedPurchase,
  reserveFundsForPurchase,
  setSpendingPolicy,
  summarisePolicy,
  summariseWallet,
  syncBalances,
  type JuliusSpendingPolicy,
  type Money,
  type PurchaseQuote,
  type WalletLedgerEntry,
  type WonderlandWalletDraft,
} from './index';

const USER_A = 'ghu-1001';
const USER_B = 'ghu-2002';
const T = (n: number) => new Date(Date.UTC(2026, 8, 15, 12, n)).toISOString();
const usd = (minor: number): Money => ({ amountMinor: minor, currency: 'USD' });

function walletFor(user: string, id = 'wal_a') {
  const opened = openSandboxWallet({ walletId: id, ownerUserId: user, createdAtIso: T(0) });
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}

const FIFTY_DOLLAR_POLICY: JuliusSpendingPolicy = {
  enabled: true,
  maxPerTransaction: usd(5_000),
  maxPerDay: usd(15_000),
  maxPerMission: usd(10_000),
  requiresConfirmationAbove: usd(0),
  physicalGoodsAllowed: true,
  digitalGoodsAllowed: true,
  recurringPurchasesAllowed: false,
  allowedCategories: ['physical_print', 'physical_plush', 'digital_asset'],
  allowedMerchants: ['sandbox-print-co'],
};

const quote = (totalMinor: number, over: Partial<PurchaseQuote> = {}): PurchaseQuote => ({
  quoteId: 'qte_1',
  merchantId: 'sandbox-print-co',
  itemDescription: 'Wonderland shirt, one unit',
  category: 'physical_print',
  itemPrice: usd(totalMinor - 500 - 200),
  shipping: usd(500),
  tax: usd(200),
  total: usd(totalMinor),
  quotedAtIso: T(1),
  expiresAtIso: null,
  ...over,
});

/** Drive a purchase all the way through. Returns everything a test may assert. */
function buyThrough(
  wallet: WonderlandWalletDraft,
  entries: readonly WalletLedgerEntry[],
  total: number,
  opts: { key?: string; missionId?: string | null; approval?: { approvedByUserId: string; approvedTotal: Money } | null } = {},
) {
  const authorized = authorizePurchase({
    purchaseId: 'pur_1',
    wallet,
    requesterUserId: wallet.ownerUserId,
    quote: quote(total),
    rights: 'USER_OWNS_RIGHTS',
    entries,
    missionId: opts.missionId ?? 'mis_1',
    projectId: 'prj_1',
    creationId: 'cre_1',
    idempotencyKey: opts.key ?? 'idem-1',
    nowIso: T(2),
    humanApproval: opts.approval ?? null,
  });
  if (!authorized.ok) throw new Error(authorized.error.message);
  return authorized.value;
}

/* ------------------------------------------------------------------------ */

describe('money is an integer, and the ledger is the authority', () => {
  it('opens a sandbox wallet with a labelled balance and NO spending permission', () => {
    const { wallet, entries } = walletFor(USER_A);
    expect(wallet.fundingSource).toBe('SANDBOX');
    expect(wallet.availableBalance).toEqual(usd(50_000));
    expect(wallet.policy).toEqual(JULIUS_SPEND_DISABLED);
    expect(summariseWallet(wallet).fundingLabel).toBe(SANDBOX_FUNDS_LABEL);
    expect(deriveBalance(entries, 'USD').available).toEqual(usd(50_000));
  });

  it('keeps the cached balance equal to the derivation at every step', () => {
    let { wallet, entries } = walletFor(USER_A);
    const policied = setSpendingPolicy(wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    wallet = policied.value;

    const authorized = buyThrough(wallet, entries, 3_200);
    if (authorized.kind !== 'authorized') throw new Error('expected authorization');

    const reserved = reserveFundsForPurchase(authorized.intent, entries, wallet, T(3));
    if (!reserved.ok) throw new Error('reserve refused');
    entries = reserved.value.entries;
    wallet = syncBalances(wallet, entries);
    expect(wallet.availableBalance).toEqual(deriveBalance(entries, 'USD').available);
    expect(wallet.reservedBalance).toEqual(usd(3_200));

    const submitted = markPurchaseSubmitted(reserved.value.intent, entries, T(4));
    if (!submitted.ok) throw new Error('submit refused');
    const committed = commitPurchase(submitted.value.intent, entries, wallet, 'ord_1', T(5));
    if (!committed.ok) throw new Error('commit refused');
    entries = committed.value.entries;
    wallet = syncBalances(wallet, entries);

    expect(wallet.availableBalance).toEqual(deriveBalance(entries, 'USD').available);
    expect(wallet.reservedBalance).toEqual(usd(0));
    expect(wallet.availableBalance).toEqual(usd(46_800));
  });

  it('refuses a non-integer or negative amount', () => {
    const { wallet, entries } = walletFor(USER_A);
    const bad = appendLedgerEntry(
      entries,
      {
        entryId: 'x', walletId: wallet.walletId, type: 'CREDIT',
        amount: { amountMinor: 10.5, currency: 'USD' }, occurredAtIso: T(1),
        idempotencyKey: 'k', reference: 'r', authorizationSource: 'system',
        purchaseId: null, missionId: null, projectId: null, merchantRef: null, orderRef: null,
      },
      'USD',
    );
    expect(bad.ok).toBe(false);
  });

  it('refuses a reservation larger than the available balance', () => {
    const { wallet, entries } = walletFor(USER_A);
    const over = appendLedgerEntry(
      entries,
      {
        entryId: 'x', walletId: wallet.walletId, type: 'RESERVATION',
        amount: usd(999_999), occurredAtIso: T(1), idempotencyKey: 'k2',
        reference: 'r', authorizationSource: 'system',
        purchaseId: 'p', missionId: null, projectId: null, merchantRef: null, orderRef: null,
      },
      'USD',
    );
    expect(over.ok).toBe(false);
  });

  it('refuses a purchase with no matching reservation', () => {
    const { wallet, entries } = walletFor(USER_A);
    const orphan = appendLedgerEntry(
      entries,
      {
        entryId: 'x', walletId: wallet.walletId, type: 'PURCHASE',
        amount: usd(100), occurredAtIso: T(1), idempotencyKey: 'k3',
        reference: 'r', authorizationSource: 'julius_autonomous',
        purchaseId: 'p', missionId: null, projectId: null, merchantRef: null, orderRef: null,
      },
      'USD',
    );
    expect(orphan.ok).toBe(false);
  });
});

describe('funds existing is not permission to spend them', () => {
  it('refuses every purchase when autonomous spend is off', () => {
    const { wallet, entries } = walletFor(USER_A);
    const decision = evaluateSpendingPolicy({
      policy: wallet.policy, quote: quote(1_000), rights: 'USER_OWNS_RIGHTS',
      entries, currency: 'USD', missionId: null, nowIso: T(1), walletActive: true,
    });
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') return;
    expect(decision.reason).toBe('autonomous_spend_disabled');
  });

  it('refuses a merchant that is not approved', () => {
    const { wallet, entries } = walletFor(USER_A);
    const policied = setSpendingPolicy(wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    const decision = evaluateSpendingPolicy({
      policy: policied.value.policy,
      quote: quote(1_000, { merchantId: 'some-random-shop' }),
      rights: 'USER_OWNS_RIGHTS', entries, currency: 'USD',
      missionId: null, nowIso: T(1), walletActive: true,
    });
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') return;
    expect(decision.reason).toBe('merchant_not_allowed');
  });

  it('refuses manufacturing when rights are unresolved, even with funds and policy', () => {
    const { wallet, entries } = walletFor(USER_A);
    const policied = setSpendingPolicy(wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    const decision = evaluateSpendingPolicy({
      policy: policied.value.policy, quote: quote(1_000),
      // The DEFAULT classification. "We never checked" must not behave like "fine".
      rights: 'REQUIRES_RIGHTS_REVIEW',
      entries, currency: 'USD', missionId: null, nowIso: T(1), walletActive: true,
    });
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') return;
    expect(decision.reason).toBe('rights_not_cleared');
  });

  it('tells Julius plainly that funds are not permission', () => {
    const summary = summarisePolicy(FIFTY_DOLLAR_POLICY);
    expect(summary.sentences.join(' ')).toContain('not permission to spend');
  });

  it('refuses a per-transaction limit above the daily limit', () => {
    const { wallet } = walletFor(USER_A);
    const bad = setSpendingPolicy(
      wallet,
      { ...FIFTY_DOLLAR_POLICY, maxPerTransaction: usd(20_000), maxPerDay: usd(10_000) },
      T(1),
    );
    expect(bad.ok).toBe(false);
  });
});

describe('ADVERSARIAL — one wallet, one owner', () => {
  it('refuses user B every operation on user A\'s wallet', () => {
    const { wallet, entries } = walletFor(USER_A);
    expect(assertWalletOwner(wallet, USER_B).ok).toBe(false);
    const attempt = authorizePurchase({
      purchaseId: 'pur_x', wallet, requesterUserId: USER_B, quote: quote(100),
      rights: 'USER_OWNS_RIGHTS', entries, missionId: null, projectId: null,
      creationId: null, idempotencyKey: 'k', nowIso: T(2),
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.code).toBe('permission-denied');
  });

  it('gives each account a separate wallet', async () => {
    const store = createWonderlandWalletStore(createInMemoryDurableBacking());
    await store.write(walletFor(USER_A, 'wal_a').wallet);
    await store.write(walletFor(USER_B, 'wal_b').wallet);

    expect((await store.findByOwner(USER_A))?.walletId).toBe('wal_a');
    expect((await store.findByOwner(USER_B))?.walletId).toBe('wal_b');
    expect((await store.findByOwner('ghu-9999'))).toBeNull();
  });

  it('carries no payment instrument anywhere in the record', () => {
    const { wallet } = walletFor(USER_A);
    const wire = JSON.stringify(wallet).toLowerCase();
    for (const forbidden of WALLET_FORBIDDEN_FIELDS) {
      expect(wire, `a wallet carries ${forbidden}`).not.toContain(forbidden.toLowerCase());
    }
  });
});

/* ======================= THE FOUNDER'S PROOF SEQUENCE ==================== */

describe('the private-beta wallet proof', () => {
  it('steps 1-12: an authorized $32 purchase settles exactly once and B is isolated', async () => {
    // 1 & 2 — two separate sandbox wallets.
    const a = walletFor(USER_A, 'wal_a');
    const b = walletFor(USER_B, 'wal_b');
    expect(a.wallet.ownerUserId).not.toBe(b.wallet.ownerUserId);

    // 3 — user A gives Julius a $50 autonomous limit.
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    let wallet = policied.value;
    let entries = a.entries;

    // 4 & 5 — Julius requests $32; the wallet authorizes it autonomously.
    const authorized = buyThrough(wallet, entries, 3_200);
    if (authorized.kind !== 'authorized') throw new Error('expected autonomous authorization');
    expect(authorized.intent.authorizationSource).toBe('julius_autonomous');

    // 6 — $32 becomes reserved.
    const reserved = reserveFundsForPurchase(authorized.intent, entries, wallet, T(3));
    if (!reserved.ok) throw new Error('reserve refused');
    entries = reserved.value.entries;
    wallet = syncBalances(wallet, entries);
    expect(wallet.reservedBalance).toEqual(usd(3_200));
    expect(wallet.availableBalance).toEqual(usd(46_800));

    // 7 & 8 — the merchant succeeds and the reservation becomes a settled debit.
    const submitted = markPurchaseSubmitted(reserved.value.intent, entries, T(4));
    if (!submitted.ok) throw new Error('submit refused');
    const committed = commitPurchase(submitted.value.intent, entries, wallet, 'ord_32', T(5));
    if (!committed.ok) throw new Error('commit refused');
    entries = committed.value.entries;
    wallet = syncBalances(wallet, entries);

    // 9 — a receipt exists and answers the question.
    const receipt = committed.value.receipt;
    expect(receipt.total).toEqual(usd(3_200));
    expect(explainReceipt(receipt, entries)).toContain('$32.00');

    // 10 — the balance is right, and derived.
    expect(wallet.reservedBalance).toEqual(usd(0));
    expect(wallet.availableBalance).toEqual(usd(46_800));
    expect(wallet.availableBalance).toEqual(deriveBalance(entries, 'USD').available);

    // 11 — RETRYING THE SAME PURCHASE DOES NOT CHARGE TWICE.
    const retry = commitPurchase(committed.value.intent, entries, wallet, 'ord_32', T(6));
    if (!retry.ok) throw new Error('retry refused');
    const afterRetry = syncBalances(wallet, retry.value.entries);
    expect(retry.value.entries).toHaveLength(entries.length);
    expect(afterRetry.availableBalance).toEqual(usd(46_800));

    // 12 — user B cannot reach the transaction.
    expect(assertWalletOwner(wallet, USER_B).ok).toBe(false);
    const store = createWonderlandWalletStore(createInMemoryDurableBacking());
    await store.write(wallet);
    await store.writeLedger(wallet.walletId, entries);
    expect((await store.findByOwner(USER_B))).toBeNull();
  });

  it('steps 13-17: a $90 purchase needs a human, and then completes exactly once', () => {
    const a = walletFor(USER_A, 'wal_a');
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    let wallet = policied.value;
    let entries = a.entries;

    // 13 & 14 — $90 exceeds the $50 autonomous limit.
    const attempted = buyThrough(wallet, entries, 9_000);
    expect(attempted.kind).toBe('requires_human');

    // 15 — an approval request is created, itemised.
    if (attempted.kind !== 'requires_human') return;
    expect(attempted.decision.outcome).toBe('requires_human');
    expect(attempted.decision.detail).toContain('$50.00');

    // 16 — the user approves, and the purchase proceeds.
    const approved = buyThrough(wallet, entries, 9_000, {
      approval: { approvedByUserId: USER_A, approvedTotal: usd(9_000) },
    });
    if (approved.kind !== 'authorized') throw new Error('expected approval to authorize');
    expect(approved.intent.authorizationSource).toBe('user_approved');

    const reserved = reserveFundsForPurchase(approved.intent, entries, wallet, T(3));
    if (!reserved.ok) throw new Error('reserve refused');
    const submitted = markPurchaseSubmitted(reserved.value.intent, reserved.value.entries, T(4));
    if (!submitted.ok) throw new Error('submit refused');
    const committed = commitPurchase(submitted.value.intent, submitted.value.entries, wallet, 'ord_90', T(5));
    if (!committed.ok) throw new Error('commit refused');
    entries = committed.value.entries;
    wallet = syncBalances(wallet, entries);

    // 17 — exactly once.
    expect(wallet.availableBalance).toEqual(usd(41_000));
    expect(entries.filter((e) => e.type === 'PURCHASE')).toHaveLength(1);
    expect(committed.value.receipt.humanApprovalRequired).toBe(true);
  });

  it('refuses an approval for a DIFFERENT amount than the quote', () => {
    const a = walletFor(USER_A, 'wal_a');
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    // The user approved $32; the merchant now wants $90. Silently spending the
    // difference is the exact failure the direction forbids.
    const slipped = authorizePurchase({
      purchaseId: 'pur_slip', wallet: policied.value, requesterUserId: USER_A,
      quote: quote(9_000), rights: 'USER_OWNS_RIGHTS', entries: a.entries,
      missionId: null, projectId: null, creationId: null,
      idempotencyKey: 'k', nowIso: T(2),
      humanApproval: { approvedByUserId: USER_A, approvedTotal: usd(3_200) },
    });
    expect(slipped.ok).toBe(false);
    if (slipped.ok) return;
    expect(slipped.error.message).toContain('new authorization');
  });

  it('steps 18-21: a disconnect after submission reconciles without double-charging', () => {
    const a = walletFor(USER_A, 'wal_a');
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    let wallet = policied.value;
    let entries = a.entries;

    const authorized = buyThrough(wallet, entries, 3_200);
    if (authorized.kind !== 'authorized') throw new Error('expected authorization');
    const reserved = reserveFundsForPurchase(authorized.intent, entries, wallet, T(3));
    if (!reserved.ok) throw new Error('reserve refused');
    const submitted = markPurchaseSubmitted(reserved.value.intent, reserved.value.entries, T(4));
    if (!submitted.ok) throw new Error('submit refused');

    // 18 — the network dies HERE. The order may or may not have been placed.
    expect(submitted.value.intent.state).toBe('SUBMITTED');

    // 19 & 20 — on resume, the provider is asked and gives an authoritative answer.
    const reconciled = reconcileSubmittedPurchase(
      submitted.value.intent, submitted.value.entries, wallet,
      { settled: true, orderRef: 'ord_32' }, T(9),
    );
    if (!reconciled.ok) throw new Error('reconcile refused');
    entries = reconciled.value.entries;
    wallet = syncBalances(wallet, entries);
    expect(reconciled.value.intent.state).toBe('PURCHASED');

    // 21 — NO DUPLICATE. Reconciling again is idempotent on the same key.
    const again = reconcileSubmittedPurchase(
      reconciled.value.intent, entries, wallet,
      { settled: true, orderRef: 'ord_32' }, T(10),
    );
    if (!again.ok) throw new Error('second reconcile refused');
    expect(again.value.entries).toHaveLength(entries.length);
    expect(syncBalances(wallet, again.value.entries).availableBalance).toEqual(usd(46_800));
    expect(entries.filter((e) => e.type === 'PURCHASE')).toHaveLength(1);
  });

  it('releases the reservation when the merchant did NOT settle', () => {
    const a = walletFor(USER_A, 'wal_a');
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    let wallet = policied.value;

    const authorized = buyThrough(wallet, a.entries, 3_200);
    if (authorized.kind !== 'authorized') throw new Error('expected authorization');
    const reserved = reserveFundsForPurchase(authorized.intent, a.entries, wallet, T(3));
    if (!reserved.ok) throw new Error('reserve refused');
    const submitted = markPurchaseSubmitted(reserved.value.intent, reserved.value.entries, T(4));
    if (!submitted.ok) throw new Error('submit refused');

    const reconciled = reconcileSubmittedPurchase(
      submitted.value.intent, submitted.value.entries, wallet,
      { settled: false, reason: 'merchant rejected the order' }, T(9),
    );
    if (!reconciled.ok) throw new Error('reconcile refused');
    wallet = syncBalances(wallet, reconciled.value.entries);

    expect(reconciled.value.intent.state).toBe('FAILED');
    expect(wallet.reservedBalance).toEqual(usd(0));
    // Every cent is back.
    expect(wallet.availableBalance).toEqual(usd(50_000));
    expect(reconciled.value.receipt).toBeNull();
  });

  it('releases a reservation on an ordinary failure too', () => {
    const a = walletFor(USER_A, 'wal_a');
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    const authorized = buyThrough(policied.value, a.entries, 3_200);
    if (authorized.kind !== 'authorized') throw new Error('expected authorization');
    const reserved = reserveFundsForPurchase(authorized.intent, a.entries, policied.value, T(3));
    if (!reserved.ok) throw new Error('reserve refused');

    const failed = failPurchase(
      reserved.value.intent, reserved.value.entries, policied.value, 'provider timeout', T(5),
    );
    if (!failed.ok) throw new Error('fail refused');
    expect(syncBalances(policied.value, failed.value.entries).availableBalance).toEqual(usd(50_000));
  });
});

describe('why did Julius spend $42', () => {
  it('answers with the exact ledger rows', () => {
    const a = walletFor(USER_A, 'wal_a');
    const policied = setSpendingPolicy(a.wallet, FIFTY_DOLLAR_POLICY, T(1));
    if (!policied.ok) throw new Error('policy refused');
    const authorized = buyThrough(policied.value, a.entries, 4_200);
    if (authorized.kind !== 'authorized') throw new Error('expected authorization');
    const reserved = reserveFundsForPurchase(authorized.intent, a.entries, policied.value, T(3));
    if (!reserved.ok) throw new Error('reserve refused');
    const submitted = markPurchaseSubmitted(reserved.value.intent, reserved.value.entries, T(4));
    if (!submitted.ok) throw new Error('submit refused');
    const committed = commitPurchase(submitted.value.intent, submitted.value.entries, policied.value, 'ord_42', T(5));
    if (!committed.ok) throw new Error('commit refused');

    const explanation = explainSpend(committed.value.entries, 'pur_1');
    expect(explanation.some((line) => line.includes('RESERVATION'))).toBe(true);
    expect(explanation.some((line) => line.includes('PURCHASE'))).toBe(true);
    expect(explanation.some((line) => line.includes('julius_autonomous'))).toBe(true);

    const prose = explainReceipt(committed.value.receipt, committed.value.entries);
    expect(prose).toContain('$42.00');
    expect(prose).toContain('mis_1');
    expect(prose).toContain('autonomous spending limits');
    expect(formatMoney(usd(4_200))).toBe('$42.00');
  });
});
