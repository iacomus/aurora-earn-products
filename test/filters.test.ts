import { describe, it, expect } from "vitest";
import {
  passesAllFilters,
  STRATEGY_FILTERS,
  type FilterInput,
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

const input = (over: Partial<FilterInput> = {}): FilterInput => ({
  strategy: strategy(),
  asset: enabledAsset,
  tier: "Premium",
  ...over,
});

describe("passesAllFilters", () => {
  it("keeps a fully-qualifying strategy", () => {
    expect(passesAllFilters(input())).toBe(true);
  });

  it("drops a flex strategy (lock-type filter)", () => {
    expect(
      passesAllFilters(
        input({ strategy: strategy({ lock_type: { type: "flex" } }) }),
      ),
    ).toBe(false);
  });

  it("drops a strategy with can_allocate:false (can-allocate filter)", () => {
    expect(
      passesAllFilters(input({ strategy: strategy({ can_allocate: false }) })),
    ).toBe(false);
  });

  it("drops a strategy whose asset is not enabled (asset-status filter)", () => {
    expect(
      passesAllFilters(
        input({ asset: { altname: "ETH", status: "disabled" } }),
      ),
    ).toBe(false);
  });

  it("drops a sub-3% strategy, comparing the boundary in exact decimal (apy-threshold filter)", () => {
    // "2.9999999999999999" parses to the double 3.0 but is < 3 as an exact decimal.
    expect(
      passesAllFilters(
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
      passesAllFilters(input({ strategy: bonded, tier: "Standard" })),
    ).toBe(false);
    expect(passesAllFilters(input({ strategy: bonded, tier: "Premium" }))).toBe(
      true,
    );
  });
});

describe("STRATEGY_FILTERS", () => {
  it("exposes named rules in application order", () => {
    expect(STRATEGY_FILTERS.map((f) => f.name)).toEqual([
      "lock-type",
      "can-allocate",
      "asset-status",
      "apy-threshold",
      "tier-eligibility",
    ]);
  });

  it("lets a single rule be run in isolation", () => {
    const apyFilter = STRATEGY_FILTERS.find((f) => f.name === "apy-threshold");
    expect(
      apyFilter?.keep(
        input({ strategy: strategy({ apr_estimate: { low: "1.0000" } }) }),
      ),
    ).toBe(false);
    expect(apyFilter?.keep(input())).toBe(true);
  });
});
