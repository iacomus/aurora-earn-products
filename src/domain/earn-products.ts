// src/domain/earn-products.ts
import type { MeridianEarnClient } from '../meridian/client';
import { computeApy } from './apy';
import { toProduct, type EarnProduct } from './transform';
import type { Tier } from './tiers';

/**
 * Loads strategies + assets via the client, transforms and filters them, then returns the
 * products visible to `tier`, sorted by APY descending (strategyId ascending breaks ties).
 *
 * The sort key is the *unrounded* APY, so two strategies that round to the same displayed
 * `apyValue` are still ordered by their true rate.
 */
export async function getEarnProducts(
  client: MeridianEarnClient,
  tier: Tier,
): Promise<EarnProduct[]> {
  const [strategies, assets] = await Promise.all([client.listStrategies(), client.listAssets()]);

  const scored: { product: EarnProduct; apyExact: number }[] = [];
  for (const strategy of strategies) {
    const product = toProduct(strategy, assets);
    // toProduct only returns a product when computeApy yielded a value (>= 3%),
    // so the cast is safe here.
    if (product) scored.push({ product, apyExact: computeApy(strategy) as number });
  }

  return scored
    .filter((s) => s.product.eligibleTiers.includes(tier))
    .sort(
      (a, b) => b.apyExact - a.apyExact || a.product.strategyId.localeCompare(b.product.strategyId),
    )
    .map((s) => s.product);
}
