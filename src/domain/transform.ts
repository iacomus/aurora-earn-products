// src/domain/transform.ts
import { AppError } from "../errors";
import type { RawStrategy, AssetMap } from "../meridian/schema";
import { computeApy } from "./apy";
import { accessModel, eligibleTiers, type Tier } from "./tiers";

const APY_THRESHOLD = 3; // percent

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
 * Transforms one raw strategy into an EarnProduct, or null if it is filtered out
 * (can_allocate:false, non-enabled asset, or APY below 3% / absent).
 * Throws AppError(DATA_MALFORMED) if the strategy references an unknown asset code.
 */
export function toProduct(
  strategy: RawStrategy,
  assets: AssetMap,
): EarnProduct | null {
  // 1. Resolve the asset — a dangling reference is malformed data.
  const asset = assets[strategy.asset];
  if (!asset) {
    throw new AppError(
      "DATA_MALFORMED",
      `Strategy ${strategy.id} references unknown asset code "${strategy.asset}"`,
    );
  }

  // 2. Availability filter — the account cannot allocate.
  if (strategy.can_allocate === false) return null;

  // 3. Asset-status filter — the asset is not operational platform-wide.
  if (asset.status !== "enabled") return null;

  // 4 & 5. APY + the hard ≥3% filter, on the unrounded value.
  const apyExact = computeApy(strategy);
  if (apyExact === null || apyExact < APY_THRESHOLD) return null;

  // 6 & 7. Build the output object (apyValue rounded to 2 decimals for display).
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
