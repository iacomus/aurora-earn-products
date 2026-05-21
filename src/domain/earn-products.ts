// src/domain/earn-products.ts
import type { MeridianEarnClient } from '../meridian/client';
import { toProduct, type EarnProduct } from './transform';
import type { Tier } from './tiers';

/**
 * Loads strategies + assets via the client, transforms and filters them, then returns the
 * products visible to `tier`, sorted by APY descending (strategyId ascending breaks ties).
 */
export async function getEarnProducts(
  client: MeridianEarnClient,
  tier: Tier,
): Promise<EarnProduct[]> {
  const [strategies, assets] = await Promise.all([client.listStrategies(), client.listAssets()]);

  const products: EarnProduct[] = [];
  for (const strategy of strategies) {
    const product = toProduct(strategy, assets);
    if (product) products.push(product);
  }

  return products
    .filter((p) => p.eligibleTiers.includes(tier))
    .sort((a, b) => b.apyValue - a.apyValue || a.strategyId.localeCompare(b.strategyId));
}
