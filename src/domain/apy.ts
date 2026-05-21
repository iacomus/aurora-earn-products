import type { RawStrategy, RawAutoCompound } from '../meridian/schema';

const SECONDS_PER_YEAR = 31_536_000; // 365 days

/** Whether rewards effectively compound, per the auto_compound field. */
export function isCompounding(autoCompound: RawAutoCompound | undefined): boolean {
  if (!autoCompound) return false;
  if (autoCompound.type === 'enabled') return true;
  if (autoCompound.type === 'optional') return autoCompound.default === true;
  return false; // 'disabled', or any unknown type
}

/** Compounding periods per year, from a payout frequency in seconds. */
export function compoundingPeriodsPerYear(payoutFrequencySeconds: number): number {
  return Math.round(SECONDS_PER_YEAR / payoutFrequencySeconds);
}

/**
 * The strategy's APY as a percentage number (e.g. 8.32), unrounded.
 * Returns null when the strategy has no apr_estimate (the MINA case).
 *
 * APY = (1 + APR/n)^n - 1, gated on auto_compound. Falls back to APY = APR when
 * compounding is off or payout_frequency is absent/non-positive (n undeterminable).
 */
export function computeApy(strategy: RawStrategy): number | null {
  const apr = strategy.apr_estimate;
  if (!apr) return null;

  const aprFraction = Number(apr.low) / 100;
  const payoutFrequency = strategy.lock_type.payout_frequency;

  if (
    !isCompounding(strategy.auto_compound) ||
    payoutFrequency === undefined ||
    payoutFrequency <= 0
  ) {
    return aprFraction * 100;
  }

  const n = compoundingPeriodsPerYear(payoutFrequency);
  const apyFraction = Math.pow(1 + aprFraction / n, n) - 1;
  return apyFraction * 100;
}
