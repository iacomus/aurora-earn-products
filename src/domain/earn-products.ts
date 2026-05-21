// src/domain/earn-products.ts
import type Big from "big.js";
import type { MeridianEarnClient } from "../meridian/client";
import { computeApy } from "./apy";
import { passesAllFilters } from "./filters";
import { buildProduct, resolveAsset, type EarnProduct } from "./transform";
import type { Tier } from "./tiers";

/**
 * Loads strategies + assets, runs each strategy through the eligibility filter
 * pipeline, and returns the catalog products visible to `tier`, sorted by APY
 * descending (strategyId ascending breaks ties).
 *
 * The sort compares the exact-decimal APY, so two products that round to the
 * same displayed apyValue are still ordered by their true rate.
 */
export async function getEarnProducts(
  client: MeridianEarnClient,
  tier: Tier,
): Promise<EarnProduct[]> {
  const [strategies, assets] = await Promise.all([
    client.listStrategies(),
    client.listAssets(),
  ]);

  const scored: { product: EarnProduct; apyExact: Big }[] = [];
  for (const strategy of strategies) {
    const asset = resolveAsset(strategy, assets);
    if (!passesAllFilters({ strategy, asset, tier })) continue;

    // The apy-threshold filter has passed, so computeApy is non-null here.
    const apyExact = computeApy(strategy);
    if (apyExact === null) continue;

    scored.push({ product: buildProduct(strategy, asset, apyExact), apyExact });
  }

  return scored
    .sort(
      (a, b) =>
        b.apyExact.cmp(a.apyExact) ||
        a.product.strategyId.localeCompare(b.product.strategyId),
    )
    .map((s) => s.product);
}
