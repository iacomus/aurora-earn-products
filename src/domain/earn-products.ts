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
 *
 * `locale` formats each product's apyDisplay (the validated `?locale` query
 * param, defaulting to en-US).
 */
export async function getEarnProducts(
  client: MeridianEarnClient,
  tier: Tier,
  locale: string = "en-US",
): Promise<EarnProduct[]> {
  const [strategies, assets] = await Promise.all([
    client.listStrategies(),
    client.listAssets(),
  ]);

  const scored: { product: EarnProduct; apyExact: Big }[] = [];
  for (const strategy of strategies) {
    // Phase 1: the cheap, strategy-only exclusions.
    if (!passes(PRE_ASSET_FILTERS, { strategy, tier })) continue;

    // A genuine catalog candidate: resolve the asset, then compute the APY
    // once — it is the costly step, and the apy-threshold filter and
    // buildProduct both consume the result.
    const asset = resolveAsset(strategy, assets);
    const apy = computeApy(strategy);
    // No apr_estimate (e.g. MINA) → no APY → not a catalog product.
    if (apy === null) continue;

    // Phase 2: the asset-aware eligibility filters.
    if (!passes(POST_ASSET_FILTERS, { strategy, asset, tier, apy })) continue;

    scored.push({
      product: buildProduct(strategy, asset, apy, locale),
      apyExact: apy,
    });
  }

  return scored
    .sort(
      (a, b) =>
        b.apyExact.cmp(a.apyExact) ||
        a.product.strategyId.localeCompare(b.product.strategyId),
    )
    .map((s) => s.product);
}
