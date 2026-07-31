import { describe, expect, it } from 'vitest';

import {
  addMoney,
  basisPointsOf,
  compareMoney,
  createMoney,
  formatMoney,
  isNegative,
  isZero,
  money,
  moneyEquals,
  moneyFromDecimalString,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  toBigIntMicros,
} from './money';

import type { EconomicsResult } from './economics-errors';

/** Unwraps a successful result, keeping its real type. */
function ok<T>(result: EconomicsResult<T>): T {
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('money construction', () => {
  it('accepts a valid USD amount and canonicalizes it', () => {
    const value = ok(createMoney('USD', '1000000'));
    expect(value).toEqual({ currency: 'USD', amountMicros: '1000000' });
  });

  it('collapses leading zeros and normalizes negative zero', () => {
    expect(ok(createMoney('USD', '0001500')).amountMicros).toBe('1500');
    expect(ok(createMoney('USD', '-0')).amountMicros).toBe('0');
    expect(ok(createMoney('USD', '000')).amountMicros).toBe('0');
  });

  it('normalizes a lowercase currency code to uppercase', () => {
    expect(ok(createMoney('usd', '1')).currency).toBe('USD');
  });

  it.each([
    ['a non-ISO code', 'DOLLARS', '1'],
    ['a two-letter code', 'US', '1'],
    ['an empty code', '', '1'],
  ])('rejects %s', (_label, currency, amount) => {
    const result = createMoney(currency, amount);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MONEY_INVALID_CURRENCY');
  });

  it.each([
    ['a decimal point', '1.5'],
    ['exponent notation', '1e6'],
    ['a comma separator', '1,000000'],
    ['leading whitespace', ' 100'],
    ['trailing whitespace', '100 '],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['-Infinity', '-Infinity'],
    ['a plus sign', '+100'],
    ['an empty amount', ''],
  ])('rejects %s in amountMicros', (_label, amount) => {
    const result = createMoney('USD', amount);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MONEY_INVALID_AMOUNT');
    expect(result.error.safeNextAction).toBeTruthy();
  });

  it('rejects a numeric amount — money is never a float', () => {
    const result = createMoney('USD', 1_000_000 as unknown as string);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MONEY_INVALID_AMOUNT');
    expect(result.error.reason).toMatch(/never a number/u);
  });

  it('stores a JSON-serializable, frozen value', () => {
    const value = money('USD', '2150000');
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('handles amounts far beyond float precision exactly', () => {
    const huge = '9007199254740993000000'; // > Number.MAX_SAFE_INTEGER micros
    expect(ok(createMoney('USD', huge)).amountMicros).toBe(huge);
  });
});

describe('exact arithmetic', () => {
  it('adds exactly, including the classic float trap', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as floats; here it is exactly 0.3.
    const a = ok(moneyFromDecimalString('USD', '0.1'));
    const b = ok(moneyFromDecimalString('USD', '0.2'));
    const total = ok(addMoney(a, b));
    expect(total.amountMicros).toBe('300000');
    expect(formatMoney(total)).toBe('$0.30');
  });

  it('subtracts exactly and may go negative', () => {
    const result = ok(
      subtractMoney(money('USD', '250000'), money('USD', '1000000')),
    );
    expect(result.amountMicros).toBe('-750000');
    expect(isNegative(result)).toBe(true);
  });

  it('multiplies by an integer quantity', () => {
    expect(ok(multiplyMoney(money('USD', '250000'), 4)).amountMicros).toBe(
      '1000000',
    );
    expect(ok(multiplyMoney(money('USD', '3'), '1000000')).amountMicros).toBe(
      '3000000',
    );
  });

  it('refuses a fractional multiplier rather than rounding silently', () => {
    const result = multiplyMoney(money('USD', '1000000'), '1.5');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MONEY_INVALID_AMOUNT');
  });

  it('compares exactly', () => {
    expect(ok(compareMoney(money('USD', '1'), money('USD', '2')))).toBe(-1);
    expect(ok(compareMoney(money('USD', '2'), money('USD', '1')))).toBe(1);
    expect(ok(compareMoney(money('USD', '2'), money('USD', '2')))).toBe(0);
    expect(moneyEquals(money('USD', '5'), money('USD', '5'))).toBe(true);
    expect(moneyEquals(money('USD', '5'), money('EUR', '5'))).toBe(false);
  });

  it.each([
    ['addition', addMoney],
    ['subtraction', subtractMoney],
    ['comparison', compareMoney],
  ] as const)('rejects a currency mismatch in %s', (_label, operation) => {
    const result = operation(money('USD', '1'), money('EUR', '1'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MONEY_CURRENCY_MISMATCH');
    expect(result.error.reason).toMatch(/no currency conversion/u);
  });

  it('sums a list, and an EMPTY list is null — never a fabricated zero', () => {
    expect(ok(sumMoney([]))).toBeNull();
    const total = ok(
      sumMoney([money('USD', '200000'), money('USD', '800000'), money('USD', '1000000')]),
    );
    expect(total?.amountMicros).toBe('2000000');
  });

  it('never mutates its inputs', () => {
    const a = money('USD', '1000000');
    const b = money('USD', '500000');
    const snapshot = [JSON.stringify(a), JSON.stringify(b)];
    addMoney(a, b);
    subtractMoney(a, b);
    multiplyMoney(a, 3);
    expect([JSON.stringify(a), JSON.stringify(b)]).toEqual(snapshot);
  });

  it('reports zero and sign correctly', () => {
    expect(isZero(money('USD', '0'))).toBe(true);
    expect(isZero(money('USD', '1'))).toBe(false);
    expect(toBigIntMicros(money('USD', '-42'))).toBe(-42n);
  });
});

describe('basis-point thresholds', () => {
  it('computes 80% of $10.00 as exactly $8.00', () => {
    const threshold = ok(basisPointsOf(money('USD', '10000000'), 8000));
    expect(threshold.amountMicros).toBe('8000000');
    expect(formatMoney(threshold)).toBe('$8.00');
  });

  it('handles 0% and 100% exactly', () => {
    expect(ok(basisPointsOf(money('USD', '10000000'), 0)).amountMicros).toBe('0');
    expect(
      ok(basisPointsOf(money('USD', '10000000'), 10_000)).amountMicros,
    ).toBe('10000000');
  });

  it('truncates toward zero so a threshold is never rounded past', () => {
    // 33.33% of $0.000010 = 0.0000033… micros → truncates to 3.
    expect(ok(basisPointsOf(money('USD', '10'), 3333)).amountMicros).toBe('3');
  });

  it.each([-1, 10_001, 1.5, Number.NaN])('rejects an invalid basis-point value %s', (bp) => {
    const result = basisPointsOf(money('USD', '1000000'), bp);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_WARNING_THRESHOLD');
  });
});

describe('decimal parsing and presentation', () => {
  it.each([
    ['1.00', '1000000', '$1.00'],
    ['0.25', '250000', '$0.25'],
    ['0.000001', '1', '$0.000001'],
    ['2.15', '2150000', '$2.15'],
    ['-0.25', '-250000', '-$0.25'],
    ['10', '10000000', '$10.00'],
  ])('parses %s to %s micros and formats it back', (decimal, micros, formatted) => {
    const value = ok(moneyFromDecimalString('USD', decimal));
    expect(value.amountMicros).toBe(micros);
    expect(formatMoney(value)).toBe(formatted);
  });

  it('refuses more than six decimal places rather than rounding money away', () => {
    const result = moneyFromDecimalString('USD', '0.0000001');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MONEY_UNSAFE_PRECISION');
  });

  it('never renders a real sub-cent charge as $0.00', () => {
    expect(formatMoney(money('USD', '1'))).toBe('$0.000001');
    expect(formatMoney(money('USD', '500'))).toBe('$0.0005');
  });

  it('renders a non-USD currency with its code', () => {
    expect(formatMoney(money('EUR', '1500000'))).toBe('EUR 1.50');
  });
});
