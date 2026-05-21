// src/meridian/client.ts
import type { RawStrategy, AssetMap } from './schema';

/**
 * Models the two Meridian Earn endpoints the service depends on.
 * The shipped implementation reads captured responses from disk; a production
 * implementation would call POST /private/Earn/Strategies and GET /public/Assets.
 */
export interface MeridianEarnClient {
  /** POST /private/Earn/Strategies — all earn strategies available to the account. */
  listStrategies(): Promise<RawStrategy[]>;
  /** GET /public/Assets — asset metadata, keyed by Meridian internal asset code. */
  listAssets(): Promise<AssetMap>;
}
