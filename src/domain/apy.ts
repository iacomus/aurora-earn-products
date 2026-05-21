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

/** Compounding periods per year, from a payout frequency in seconds. */
export function compoundingPeriodsPerYear(
  payoutFrequencySeconds: number,
): number {
  return Math.round(SECONDS_PER_YEAR / payoutFrequencySeconds);
}

/**
 * Compounding periods per year for the strategy, or null if it does not
 * effectively compound — auto_compound is off, or there is no usable
 * payout_frequency to derive a period count from.
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
  return compoundingPeriodsPerYear(frequency);
}

/**
 * The strategy's APY as a percentage number (e.g. 8.32), unrounded — the figure
 * shown to customers and used as the sort key. Returns null when the strategy
 * has no apr_estimate (the MINA case).
 *
 * APY = (1 + APR/n)^n - 1 when the strategy compounds; otherwise APY = APR.
 * This is a floating-point value, fine for display and ordering. The hard ≥3%
 * eligibility gate is `meetsApyThreshold`, which compares in exact decimal.
 */
export function computeApy(strategy: RawStrategy): number | null {
  const apr = strategy.apr_estimate;
  if (!apr) return null;

  // apr_estimate values are already percentages (e.g. "4.0000" → 4).
  const aprPercent = Number(apr.low);
  const n = compoundingPeriods(strategy);
  if (n === null) return aprPercent;

  const aprFraction = aprPercent / 100;
  const apyFraction = Math.pow(1 + aprFraction / n, n) - 1;
  return apyFraction * 100;
}

/**
 * Whether the strategy clears the hard ≥3% APY threshold.
 *
 * For a non-compounding strategy the APY *is* the APR, taken straight from the
 * apr_estimate string — so the comparison is done in exact decimal (big.js),
 * not IEEE-754 doubles. This matters at the boundary: POL's apr_estimate.low
 * "2.9999999999999999" is below 3 as an exact decimal even though it parses to
 * the double 3.0, so POL is correctly treated as sub-threshold.
 *
 * A compounding strategy's APY is (1 + r/n)^n - 1 — irreducibly floating-point —
 * so its check uses the computed double. There is no exact source decimal to
 * preserve there, and no string-parsing artifact at the boundary.
 */
export function meetsApyThreshold(strategy: RawStrategy): boolean {
  const apr = strategy.apr_estimate;
  if (!apr) return false;

  if (compoundingPeriods(strategy) !== null) {
    const apy = computeApy(strategy);
    return apy !== null && apy >= APY_THRESHOLD_PERCENT;
  }

  return new Big(apr.low).gte(APY_THRESHOLD_PERCENT);
}
