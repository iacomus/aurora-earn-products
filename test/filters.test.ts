import { describe, it, expect } from "vitest";
import {
  passes,
  PRE_ASSET_FILTERS,
  POST_ASSET_FILTERS,
  type FilterInput,
  type StrategyContext,
} from "../src/domain/filters";
import type { RawAsset, RawStrategy } from "../src/meridian/schema";

const strategy = (over: Partial<RawStrategy> = {}): RawStrategy => ({
  id: "S",
  asset: "XETH",
  lock_type: { type: "instant", payout_frequency: 604800 },
  apr_estimate: { low: "8.0000" },
  user_min_allocation: "0.01",
  auto_compound: { type: "disabled" },
  can_allocate: true,
  ...over,
});

const enabledAsset: RawAsset = { altname: "ETH", status: "enabled" };

const context = (over: Partial<StrategyContext> = {}): StrategyContext => ({
  strategy: strategy(),
  tier: "Premium",
  ...over,
});

const input = (over: Partial<FilterInput> = {}): FilterInput => ({
  ...context(),
  asset: enabledAsset,
  ...over,
});

describe("PRE_ASSET_FILTERS — cheap, strategy-only exclusions", () => {
  it("exposes its named rules in application order", () => {
    expect(PRE_ASSET_FILTERS.map((f) => f.name)).toEqual([
      "lock-type",
      "can-allocate",
    ]);
  });

  it("keeps a strategy that clears every cheap exclusion", () => {
    expect(passes(PRE_ASSET_FILTERS, context())).toBe(true);
  });

  it("drops a flex strategy (lock-type filter)", () => {
    expect(
      passes(
        PRE_ASSET_FILTERS,
        context({ strategy: strategy({ lock_type: { type: "flex" } }) }),
      ),
    ).toBe(false);
  });

  it("drops a strategy with can_allocate:false (can-allocate filter)", () => {
    expect(
      passes(
        PRE_ASSET_FILTERS,
        context({ strategy: strategy({ can_allocate: false }) }),
      ),
    ).toBe(false);
  });
});

describe("POST_ASSET_FILTERS — asset-aware eligibility rules", () => {
  it("exposes its named rules in application order", () => {
    expect(POST_ASSET_FILTERS.map((f) => f.name)).toEqual([
      "asset-status",
      "apy-threshold",
      "tier-eligibility",
    ]);
  });

  it("keeps a fully-qualifying strategy", () => {
    expect(passes(POST_ASSET_FILTERS, input())).toBe(true);
  });

  it("drops a strategy whose asset is not enabled (asset-status filter)", () => {
    expect(
      passes(
        POST_ASSET_FILTERS,
        input({ asset: { altname: "ETH", status: "disabled" } }),
      ),
    ).toBe(false);
  });

  it("drops a sub-3% strategy, comparing the boundary in exact decimal (apy-threshold filter)", () => {
    // "2.9999999999999999" parses to the double 3.0 but is < 3 as an exact decimal.
    expect(
      passes(
        POST_ASSET_FILTERS,
        input({
          strategy: strategy({ apr_estimate: { low: "2.9999999999999999" } }),
        }),
      ),
    ).toBe(false);
  });

  it("drops a strategy the requested tier may not see (tier-eligibility filter)", () => {
    // A bonded strategy is restricted to Premium/Private — not visible to Standard.
    const bonded = strategy({
      lock_type: { type: "bonded", unbonding_period: 1000 },
    });
    expect(
      passes(POST_ASSET_FILTERS, input({ strategy: bonded, tier: "Standard" })),
    ).toBe(false);
    expect(
      passes(POST_ASSET_FILTERS, input({ strategy: bonded, tier: "Premium" })),
    ).toBe(true);
  });

  it("lets a single rule be run in isolation", () => {
    const apyFilter = POST_ASSET_FILTERS.find(
      (f) => f.name === "apy-threshold",
    );
    expect(
      apyFilter?.keep(
        input({ strategy: strategy({ apr_estimate: { low: "1.0000" } }) }),
      ),
    ).toBe(false);
    expect(apyFilter?.keep(input())).toBe(true);
  });
});
