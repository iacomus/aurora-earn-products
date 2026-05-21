import { describe, it, expect } from 'vitest';
import { isCompounding, compoundingPeriodsPerYear, computeApy } from '../src/domain/apy';
import type { RawStrategy } from '../src/meridian/schema';

const base: RawStrategy = {
  id: 'S',
  asset: 'XETH',
  lock_type: { type: 'instant', payout_frequency: 604800 },
  apr_estimate: { low: '8.0000', high: '12.0000' },
  user_min_allocation: '0.01',
  auto_compound: { type: 'enabled' },
  can_allocate: true,
};

describe('isCompounding', () => {
  it('is true for enabled', () => expect(isCompounding({ type: 'enabled' })).toBe(true));
  it('is false for disabled', () => expect(isCompounding({ type: 'disabled' })).toBe(false));
  it('follows default for optional', () => {
    expect(isCompounding({ type: 'optional', default: true })).toBe(true);
    expect(isCompounding({ type: 'optional', default: false })).toBe(false);
    expect(isCompounding({ type: 'optional' })).toBe(false);
  });
  it('is false for undefined or an unknown type', () => {
    expect(isCompounding(undefined)).toBe(false);
    expect(isCompounding({ type: 'mystery' })).toBe(false);
  });
});

describe('compoundingPeriodsPerYear', () => {
  it('maps payout frequencies (seconds) to period counts', () => {
    expect(compoundingPeriodsPerYear(604800)).toBe(52);
    expect(compoundingPeriodsPerYear(432000)).toBe(73);
    expect(compoundingPeriodsPerYear(2592000)).toBe(12);
  });
});

describe('computeApy', () => {
  it('returns null when apr_estimate is absent', () => {
    const { apr_estimate, ...noApr } = base;
    expect(computeApy(noApr as RawStrategy)).toBeNull();
  });

  it('compounds weekly when auto_compound is enabled', () => {
    expect(computeApy(base)).toBeCloseTo(8.32, 2);
  });

  it('returns APY = APR when auto_compound is disabled', () => {
    const s: RawStrategy = { ...base, apr_estimate: { low: '4.0000' }, auto_compound: { type: 'disabled' } };
    expect(computeApy(s)).toBeCloseTo(4.0, 5);
  });

  it('returns APY = APR when payout_frequency is absent (flex)', () => {
    const s: RawStrategy = { ...base, lock_type: { type: 'flex' }, apr_estimate: { low: '6.0000' } };
    expect(computeApy(s)).toBeCloseTo(6.0, 5);
  });

  it('returns APY = APR for optional auto_compound defaulting off', () => {
    const s: RawStrategy = {
      ...base,
      apr_estimate: { low: '9.5000' },
      auto_compound: { type: 'optional', default: false },
    };
    expect(computeApy(s)).toBeCloseTo(9.5, 5);
  });
});
