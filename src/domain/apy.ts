import Big from "big.js";
import type { RawStrategy, RawAutoCompound } from "../meridian/schema";

const SECONDS_PER_YEAR = 31_536_000; // 365 days

/** The hard APY floor, as a percentage — a strategy below this is never shown. */
const APY_THRESHOLD_PERCENT = 3;

/** Whether rewards effectively compound, per the auto_compound field. */
export function isCompounding(
  autoCompound: RawAutoCompound | undefined,
): boolean {
  if (!autoCompound) return false;
  if (autoCompound.type === "enabled") return true;
  if (autoCompound.type === "optional") return autoCompound.default === true;
  return false; // 'disabled', or any unknown type
}

/**
 * Compounding periods per year, from a payout frequency in seconds.
 *
 * The result is a whole number: payouts are discrete events, and the APY
 * formula raises the per-period rate to this power with `Big.pow`, which only
 * accepts an integer exponent. A fractional "exact ratio" is therefore neither
 * meaningful nor representable here.
 */
export function compoundingPeriodsPerYear(
  payoutFrequencySeconds: number,
): number {
  return Math.round(SECONDS_PER_YEAR / payoutFrequencySeconds);
}

/**
 * Compounding periods per year for the strategy, or null if it does not
 * effectively compound — auto_compound is off, there is no usable
 * payout_frequency, or the frequency is so long it rounds to under one period a
 * year (treated as non-compounding: APY = APR, and avoids a division by zero).
 */
function compoundingPeriods(strategy: RawStrategy): number | null {
  const frequency = strategy.lock_type.payout_frequency;
  if (
    !isCompounding(strategy.auto_compound) ||
    frequency === undefined ||
    frequency <= 0
  ) {
    return null;
  }
  const periods = compoundingPeriodsPerYear(frequency);
  return periods >= 1 ? periods : null;
}

/**
 * The strategy's APY as a percentage, in exact decimal — the value used for the
 * ≥3% threshold, the sort order, and (rounded) display. Returns null when the
 * strategy has no apr_estimate (the MINA case).
 *
 * APY = (1 + APR/n)^n - 1 when the strategy compounds; otherwise APY = APR,
 * taken straight from the apr_estimate string. All arithmetic runs on `big.js`
 * decimals, never IEEE-754 float: a regulated bank's rate maths should not
 * depend on binary floating-point rounding. The float boundary is the JSON
 * response — see buildProduct.
 */
export function computeApy(strategy: RawStrategy): Big | null {
  const apr = strategy.apr_estimate;
  if (!apr) return null;

  const aprPercent = new Big(apr.low);
  const n = compoundingPeriods(strategy);
  if (n === null) return aprPercent;

  const perPeriodRate = aprPercent.div(100).div(n);
  return new Big(1).plus(perPeriodRate).pow(n).minus(1).times(100);
}

/**
 * Whether the strategy clears the hard ≥3% APY threshold. computeApy returns an
 * exact-decimal value, so this is a single exact comparison — no floating-point
 * boundary ambiguity, and no compounding/non-compounding special-casing.
 */
export function meetsApyThreshold(strategy: RawStrategy): boolean {
  return computeApy(strategy)?.gte(APY_THRESHOLD_PERCENT) ?? false;
}
