// src/domain/transform.ts
import { AppError } from "../errors";
import type { AssetMap, RawAsset, RawStrategy } from "../meridian/schema";
import { accessModel, eligibleTiers, type Tier } from "./tiers";

/** The customer-facing earn product — the service's output shape. */
export interface EarnProduct {
  strategyId: string;
  asset: string;
  displayName: string;
  lockType: string;
  apyDisplay: string;
  apyValue: number;
  eligibleTiers: Tier[];
  minimumAmount: string;
}

const LOCK_WORD: Record<string, string> = {
  instant: "Flexible",
  flex: "Flexible",
  bonded: "Bonded",
  timed: "Fixed-Term",
};

const YIELD_WORD: Record<string, string> = {
  staking: "Staking",
  defi: "DeFi Vault",
  opt_in_rewards: "Rewards",
};

/** Synthesises a customer-facing product name — the source data carries no name field. */
export function displayName(strategy: RawStrategy, altname: string): string {
  const lockWord = LOCK_WORD[strategy.lock_type.type] ?? "";
  const yieldWord = YIELD_WORD[strategy.yield_source?.type ?? ""] ?? "Earn";
  return [altname, lockWord, yieldWord].filter((w) => w !== "").join(" ");
}

/**
 * Resolves the asset a strategy references. A dangling reference is malformed
 * data, not an eligibility decision — so this throws rather than filtering.
 */
export function resolveAsset(
  strategy: RawStrategy,
  assets: AssetMap,
): RawAsset {
  const asset = assets[strategy.asset];
  if (!asset) {
    throw new AppError(
      "DATA_MALFORMED",
      `Strategy ${strategy.id} references unknown asset code "${strategy.asset}"`,
    );
  }
  return asset;
}

/**
 * Builds the customer-facing EarnProduct for a strategy that has already passed
 * asset resolution and every eligibility filter. Pure: no filtering, no I/O.
 *
 * `apyExact` is the unrounded APY (see computeApy), passed in so it is computed
 * once and shared with the caller's sort rather than recomputed here.
 */
export function buildProduct(
  strategy: RawStrategy,
  asset: RawAsset,
  apyExact: number,
): EarnProduct {
  const apyValue = Math.round(apyExact * 100) / 100;
  return {
    strategyId: strategy.id,
    asset: asset.altname,
    displayName: displayName(strategy, asset.altname),
    lockType: strategy.lock_type.type,
    apyDisplay: `${apyValue.toFixed(2)}%`,
    apyValue,
    eligibleTiers: eligibleTiers(accessModel(strategy.lock_type)),
    minimumAmount: strategy.user_min_allocation,
  };
}
