import { describe, expect, it } from 'vitest';

import { citeSpend, emptySpendCitation, formatMicros } from './spend-citation';
import type { RelayCostReceipt } from '../../mission/economics/cost-receipt-types';

/**
 * TOKENS AND COST, CITED.
 *
 * The economics module already models this carefully. What is tested here is
 * that reading it does not undo that care — which is the only way a citing
 * module can fail.
 */

const receipt = (over: Partial<RelayCostReceipt> = {}): RelayCostReceipt => ({
  receiptId: 'rc_1',
  projectId: 'p_1',
  missionId: 'm_1',
  category: 'model_inference',
  costClass: 'actual',
  status: 'finalized',
  source: 'provider_reported',
  amount: { currency: 'USD', amountMicros: '1500000' },
  integrity: 'source_attested',
  redactionStatus: 'not_required',
  missionRevision: 1,
  occurredAt: '2026-08-05T12:00:00.000Z',
  recordedAt: '2026-08-05T12:00:01.000Z',
  metadata: {},
  ...over,
});

describe('an unknown amount is never a zero', () => {
  it('counts a pending receipt as unknown rather than as free', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a' }),
      receipt({ receiptId: 'b', status: 'pending', amount: null }),
    ]);
    expect(cited.actual).toEqual([{ currency: 'USD', amountMicros: '1500000', receipts: 1 }]);
    // Reported beside the total, so a small total cannot read as a cheap run.
    expect(cited.amountUnknown).toBe(1);
    expect(cited.receiptsRead).toBe(2);
  });

  it('a malformed amount reduces what is known rather than throwing', () => {
    const cited = citeSpend([
      receipt({ amount: { currency: 'USD', amountMicros: '1.5' } }),
      receipt({ receiptId: 'b', amount: { currency: 'usd', amountMicros: '10' } }),
    ]);
    // UNREADABLE, not unknown. A receipt that has an amount nobody can parse is
    // a different fact from one that has no amount yet, and "no cost recorded
    // yet" is the wrong sentence for it.
    expect(cited.amountUnreadable).toBe(2);
    expect(cited.amountUnknown).toBe(0);
    expect(cited.actual).toEqual([]);
  });

  it('a refund is subtracted, not silently dropped', () => {
    // `adjustment` is the ONLY category permitted a negative amount, so it is
    // how this repository records a credit or a correction. Excluding it made
    // every refund invisible and every total too high.
    const cited = citeSpend([
      receipt({ receiptId: 'a', amount: { currency: 'USD', amountMicros: '100000000' } }),
      receipt({
        receiptId: 'b', category: 'adjustment',
        amount: { currency: 'USD', amountMicros: '-40000000' },
      }),
    ]);
    expect(cited.actual).toEqual([{ currency: 'USD', amountMicros: '60000000', receipts: 2 }]);
    expect(formatMicros('USD', cited.actual[0].amountMicros)).toBe('USD 60.00');
  });

  it('a receipt excluded by category is COUNTED, so no total quietly omits one', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a' }),
      receipt({ receiptId: 'b', category: 'human_intervention' }),
    ]);
    expect(cited.excludedByCategory).toBe(1);
    expect(cited.receiptsRead).toBe(2);
  });

  it('an empty citation is empty, not zeroed', () => {
    const empty = emptySpendCitation();
    expect(empty.actual).toEqual([]);
    expect(empty.receiptsRead).toBe(0);
    expect(empty.excludedByCategory).toBe(0);
    expect(empty.amountUnreadable).toBe(0);
    expect(empty.tokens.total).toBe('0');
  });
});

describe('estimated and actual are different facts', () => {
  it('never sums a projection into billed spend', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a', costClass: 'actual' }),
      receipt({ receiptId: 'b', costClass: 'estimated', amount: { currency: 'USD', amountMicros: '9000000' } }),
    ]);
    expect(cited.actual).toEqual([{ currency: 'USD', amountMicros: '1500000', receipts: 1 }]);
    expect(cited.estimated).toEqual([{ currency: 'USD', amountMicros: '9000000', receipts: 1 }]);
  });

  it('keeps currencies apart rather than converting at an invented rate', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a' }),
      receipt({ receiptId: 'b', amount: { currency: 'EUR', amountMicros: '2000000' } }),
    ]);
    expect(cited.actual.map((t) => t.currency)).toEqual(['EUR', 'USD']);
  });
});

describe('a receipt that did not stand is not spend', () => {
  it('excludes voided and disputed receipts, and says how many', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a' }),
      receipt({ receiptId: 'b', status: 'voided' }),
      receipt({ receiptId: 'c', status: 'disputed' }),
    ]);
    expect(cited.actual).toEqual([{ currency: 'USD', amountMicros: '1500000', receipts: 1 }]);
    expect(cited.voidedOrDisputed).toBe(2);
  });

  it('keeps human time out of provider spend', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a' }),
      receipt({ receiptId: 'b', category: 'human_intervention' }),
    ]);
    expect(cited.actual[0].receipts).toBe(1);
  });

  it('counts fixture-sourced receipts separately, so a fixture is never a bill', () => {
    const cited = citeSpend([receipt({ source: 'development_fixture' })]);
    expect(cited.fixtureSourced).toBe(1);
  });
});

describe('token counts are exact integers, never floats', () => {
  it('adds the three token units and reports them separately', () => {
    const cited = citeSpend([
      receipt({ receiptId: 'a', quantity: { unit: 'input_token', value: '1200' } }),
      receipt({ receiptId: 'b', quantity: { unit: 'output_token', value: '340' } }),
      receipt({ receiptId: 'c', quantity: { unit: 'cached_input_token', value: '900' } }),
    ]);
    expect(cited.tokens).toMatchObject({
      input: '1200', output: '340', cachedInput: '900', total: '2440',
    });
  });

  it('survives counts beyond what a double can hold exactly', () => {
    // 2^53 + 1. A float-based sum reports 9007199254740992 for both of these.
    const huge = '9007199254740993';
    const cited = citeSpend([
      receipt({ receiptId: 'a', quantity: { unit: 'input_token', value: huge } }),
      receipt({ receiptId: 'b', quantity: { unit: 'output_token', value: '1' } }),
    ]);
    expect(cited.tokens.input).toBe(huge);
    expect(cited.tokens.total).toBe('9007199254740994');
  });

  it('counts tokens even when the money is still unknown', () => {
    // The tokens WERE spent; only the bill has not landed.
    const cited = citeSpend([
      receipt({ status: 'pending', amount: null, quantity: { unit: 'output_token', value: '55' } }),
    ]);
    expect(cited.tokens.output).toBe('55');
    expect(cited.amountUnknown).toBe(1);
  });

  it('reports an unreadable token value rather than guessing at it', () => {
    const cited = citeSpend([
      receipt({ quantity: { unit: 'input_token', value: '1.5e3' } }),
    ]);
    expect(cited.tokens.unreadable).toBe(1);
    expect(cited.tokens.input).toBe('0');
  });

  it('ignores quantities that are not tokens', () => {
    const cited = citeSpend([
      receipt({ quantity: { unit: 'agent_second', value: '30' } }),
    ]);
    expect(cited.tokens.total).toBe('0');
  });
});

describe('money is formatted from integers, without floating point', () => {
  it('formats micros exactly, rounding rather than truncating', () => {
    expect(formatMicros('USD', '1500000')).toBe('USD 1.50');
    expect(formatMicros('USD', '0')).toBe('USD 0.00');
    expect(formatMicros('USD', '1')).toBe('USD 0.00');
    expect(formatMicros('USD', '-2500000')).toBe('-USD 2.50');
    // Truncation printed this as 0.99, understating every total by up to a
    // cent while looking exact.
    expect(formatMicros('USD', '999999')).toBe('USD 1.00');
    expect(formatMicros('USD', '994999')).toBe('USD 0.99');
    expect(formatMicros('USD', '995000')).toBe('USD 1.00');
  });

  it('is exact far above the range a double holds', () => {
    // Number(micros)/1e6 loses exactness here, and loses it invisibly.
    expect(formatMicros('USD', '9007199254740993000000')).toBe('USD 9007199254740993.00');
  });

  it('refuses to format a malformed amount', () => {
    expect(formatMicros('USD', '1.5')).toBe('USD —');
  });
});
