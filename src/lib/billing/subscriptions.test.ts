import { describe, expect, it } from 'vitest';
import { isBillingDate, parseBillingPrice } from './subscriptions';

describe('billing inputs', () => {
  it('parses reais into exact centavos', () => {
    expect(parseBillingPrice(' 199,90 ')).toBe(19990);
    expect(parseBillingPrice('12.1')).toBe(1210);
    expect(parseBillingPrice('0,01')).toBe(1);
  });

  it('rejects zero, malformed or out-of-range amounts', () => {
    for (const value of [
      '0',
      '-1',
      '1,000',
      '1e2',
      '1.000,00',
      '1000001',
      '',
    ]) {
      expect(parseBillingPrice(value)).toBeNull();
    }
  });

  it('rejects normalized or invalid period dates', () => {
    expect(isBillingDate('2028-02-29')).toBe(true);
    expect(isBillingDate('2027-02-29')).toBe(false);
    expect(isBillingDate('2026-13-01')).toBe(false);
    expect(isBillingDate('25/11/2026')).toBe(false);
  });
});
