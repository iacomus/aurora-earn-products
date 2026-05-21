// src/domain/earn-products.ts
import type Big from "big.js";
import type { MeridianEarnClient } from "../meridian/client";
import { computeApy } from "./apy";
import { PRE_ASSET_FILTERS, POST_ASSET_FILTERS, passes } from "./filters";
import { buildProduct, resolveAsset, type EarnProduct } from "./transform";
import type { Tier } from "./tiers";

/**
 * Loads strategies + assets, runs each strategy through the eligibility filter
 * pipeline, and returns the catalog products visible to `tier`, sorted by APY
 * descending (strategyId ascending breaks ties).
 *
 * The pipeline runs in two phases. The cheap, strategy-only exclusions go
 * first; only a strategy that survives them has its asset resolved (a dangling
 * reference is malformed data and throws), then faces the asset-aware filters.
 * So a broken asset reference on a strategy the cheap exclusions already
 * dropped never fails the request — see filters.ts.
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
    // Phase 1: cheap, strategy-only exclusions. A strategy dropped here never
    // reaches resolveAsset, so a dangling asset reference on a non-catalog
    // strategy cannot fail the whole request.
    if (!passes(PRE_ASSET_FILTERS, { strategy, tier })) continue;

    // The strategy is a genuine catalog candidate: resolve its asset. A
    // dangling reference is now malformed data — resolveAsset throws.
    const asset = resolveAsset(strategy, assets);

    // Phase 2: the asset-aware eligibility filters.
    if (!passes(POST_ASSET_FILTERS, { strategy, asset, tier })) continue;

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
