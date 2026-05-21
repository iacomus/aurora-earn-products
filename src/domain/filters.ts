import type { RawAsset, RawStrategy } from "../meridian/schema";
import { meetsApyThreshold } from "./apy";
import { accessModel, eligibleTiers, type Tier } from "./tiers";

/**
 * What the strategy-only filters need to judge a strategy: the strategy record
 * and the requested tier. It deliberately carries no asset — these filters run
 * before the strategy's asset is resolved.
 */
export interface StrategyContext {
  strategy: RawStrategy;
  /** The customer tier the request is being evaluated for. */
  tier: Tier;
}

/** A StrategyContext plus the resolved asset — what the asset-aware filters need. */
export interface FilterInput extends StrategyContext {
  /** The asset the strategy references, already resolved — see resolveAsset. */
  asset: RawAsset;
}

/**
 * A named eligibility rule. `keep` returns true to keep the strategy in the
 * catalog, false to drop it. The type parameter records whether the rule needs
 * the resolved asset (`FilterInput`) or only the strategy (`StrategyContext`),
 * so the two phases below cannot be wired up the wrong way round.
 */
export interface StrategyFilter<I extends StrategyContext = FilterInput> {
  name: string;
  keep: (input: I) => boolean;
}

/**
 * Phase 1 — the cheap exclusions, in application order. Each rule judges a
 * strategy from the strategy record alone, so the whole phase runs *before*
 * the strategy's asset is resolved.
 *
 * That ordering is the point. A strategy dropped here never triggers a
 * resolveAsset call, so a dangling asset reference on a strategy that is not a
 * catalog candidate in the first place — a `flex` record, an unallocatable one
 * — cannot fail the request. Asset resolution, which treats a dangling
 * reference as malformed data, is reserved for genuine candidates (phase 2).
 */
export const PRE_ASSET_FILTERS: readonly StrategyFilter<StrategyContext>[] = [
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
];

/**
 * Phase 2 — the asset-aware eligibility rules, in application order, applied
 * once the strategy's asset has been resolved. A strategy reaching this phase
 * has cleared the cheap exclusions and is a genuine catalog candidate.
 */
export const POST_ASSET_FILTERS: readonly StrategyFilter[] = [
  {
    name: "asset-status",
    // The underlying asset is not operational platform-wide on Meridian.
    keep: ({ asset }) => asset.status === "enabled",
  },
  {
    name: "apy-threshold",
    // Hard ≥3% rule. meetsApyThreshold compares in exact decimal, and is false
    // when the strategy has no APY.
    keep: ({ strategy }) => meetsApyThreshold(strategy),
  },
  {
    name: "tier-eligibility",
    // The requested customer tier must be allowed to see this strategy.
    keep: ({ strategy, tier }) =>
      eligibleTiers(accessModel(strategy.lock_type)).includes(tier),
  },
];

/** True when `input` passes every filter in `filters`. */
export function passes<I extends StrategyContext>(
  filters: readonly StrategyFilter<I>[],
  input: I,
): boolean {
  return filters.every((filter) => filter.keep(input));
}
