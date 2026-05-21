import type { RawAsset, RawStrategy } from "../meridian/schema";
import { meetsApyThreshold } from "./apy";
import { accessModel, eligibleTiers, type Tier } from "./tiers";

/** Everything an eligibility filter may need to judge a single strategy. */
export interface FilterInput {
  strategy: RawStrategy;
  /** The asset the strategy references, already resolved — see resolveAsset. */
  asset: RawAsset;
  /** The customer tier the request is being evaluated for. */
  tier: Tier;
}

/**
 * A named eligibility rule. `keep` returns true to keep the strategy in the
 * catalog, false to drop it.
 */
export interface StrategyFilter {
  name: string;
  keep: (input: FilterInput) => boolean;
}

/**
 * The eligibility filters, in application order — the single source of truth
 * for catalog membership. A strategy becomes a product for the requested tier
 * only if it passes every one. Add, remove, or reorder a rule by editing this
 * list; each rule is independent and individually testable.
 *
 * Asset resolution is intentionally not a filter: a strategy referencing an
 * unknown asset code is malformed data (DATA_MALFORMED), not a merely
 * ineligible strategy. It runs before this pipeline — see resolveAsset.
 */
export const STRATEGY_FILTERS: readonly StrategyFilter[] = [
  {
    name: "lock-type",
    // `flex` is Meridian Rewards — an account-wide passive yield, not a
    // per-strategy allocation a customer can pick — so it is not a catalog
    // product. (Some flex records carry `can_allocate: true`, contradicting
    // Meridian's model; the exclusion keys off the lock type, not that flag.)
    keep: ({ strategy }) => strategy.lock_type.type !== "flex",
  },
  {
    name: "can-allocate",
    // The /private/ Strategies response is account-scoped: `can_allocate: false`
    // means Aurora's account cannot invest, so its customers cannot either.
    keep: ({ strategy }) => strategy.can_allocate !== false,
  },
  {
    name: "asset-status",
    // The underlying asset is not operational platform-wide on Meridian.
    keep: ({ asset }) => asset.status === "enabled",
  },
  {
    name: "apy-threshold",
    // Hard ≥3% rule. meetsApyThreshold compares in exact decimal on the
    // non-compounding boundary, and is false when the strategy has no APY.
    keep: ({ strategy }) => meetsApyThreshold(strategy),
  },
  {
    name: "tier-eligibility",
    // The requested customer tier must be allowed to see this strategy.
    keep: ({ strategy, tier }) =>
      eligibleTiers(accessModel(strategy.lock_type)).includes(tier),
  },
];

/** True when the strategy passes every eligibility filter for the input. */
export function passesAllFilters(input: FilterInput): boolean {
  return STRATEGY_FILTERS.every((filter) => filter.keep(input));
}
